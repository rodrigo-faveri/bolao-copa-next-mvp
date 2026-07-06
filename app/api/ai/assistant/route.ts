import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { auth } from "../../../../auth";
import { createAuditLog } from "../../../../lib/audit";
import { searchFootballWeb } from "../../../../lib/ai-web-search";
import { getKnowledgeQueryTerms, indexMatchKnowledge, indexNewsKnowledge, retrieveKnowledge, scoreKnowledgeText } from "../../../../lib/knowledge";
import { logger } from "../../../../lib/logger";
import { getOpenRouterModels } from "../../../../lib/openrouter";
import { getLatestNews, getTeamNews, type NewsItem } from "../../../../lib/news";
import { prisma } from "../../../../lib/prisma";
import { assertRateLimit } from "../../../../lib/rate-limit";
import { PREDICTION_CLOSE_MINUTES } from "../../../../lib/prediction";
import { getTeamDisplayName } from "../../../../lib/teams";

export const runtime = "nodejs";

const requestSchema = z.object({
  question: z.string().trim().min(4).max(800),
});

const groupStageCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const groupStageCodeSet = new Set(groupStageCodes);

type AssistantSource = {
  label: string;
  url?: string;
};

type AssistantAction =
  | {
    href: string;
    label: string;
    type: "link";
  }
  | {
    leadMinutes: number;
    label: string;
    matchId: string;
    type: "create_alert";
  }
  | {
    href: string;
    label: string;
    matchId: string;
    type: "focus_match";
  }
  | {
    goalsA: number;
    goalsB: number;
    href: string;
    label: string;
    matchId: string;
    type: "apply_pick";
  };

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

const AssistantState = Annotation.Root({
  actions: Annotation<AssistantAction[]>,
  answer: Annotation<string>,
  context: Annotation<string>,
  diagnostics: Annotation<Prisma.InputJsonObject>,
  email: Annotation<string>,
  intent: Annotation<string>,
  question: Annotation<string>,
  source: Annotation<"openrouter" | "local">,
  sources: Annotation<AssistantSource[]>,
  tools: Annotation<string[]>,
});

function formatDate(value: Date | null) {
  if (!value) return "sem horario";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(value);
}

function simpleSeed(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function buildSuggestedPick(match: { group: string; id: string; teamA: string; teamB: string }): AssistantAction {
  const seed = simpleSeed(`${match.group}:${match.teamA}:${match.teamB}`);
  const options = [
    { goalsA: 1, goalsB: 0 },
    { goalsA: 1, goalsB: 1 },
    { goalsA: 0, goalsB: 1 },
    { goalsA: 2, goalsB: 1 },
  ];
  const pick = options[seed % options.length];

  return {
    goalsA: pick.goalsA,
    goalsB: pick.goalsB,
    href: `/bolao?focus=${encodeURIComponent(match.id)}#bolao-confrontos`,
    label: `Usar palpite ${pick.goalsA} x ${pick.goalsB}`,
    matchId: match.id,
    type: "apply_pick",
  };
}

function buildFocusMatchAction(match: { id: string; teamA: string; teamB: string }): AssistantAction {
  return {
    href: `/bolao?focus=${encodeURIComponent(match.id)}#bolao-confrontos`,
    label: `Abrir ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)}`,
    matchId: match.id,
    type: "focus_match",
  };
}

function groupToBracketMatchId(group: string) {
  const match = /^(R32|R16|QF|SF|FINAL)-(\d+)$/i.exec(group);
  if (!match) return null;

  const prefixMap: Record<string, string> = {
    FINAL: "final",
    QF: "qf",
    R16: "r16",
    R32: "r32",
    SF: "sf",
  };
  const prefix = prefixMap[match[1].toUpperCase()];
  return prefix ? `${prefix}-${match[2]}` : null;
}

function buildCreateAlertAction(match: { id: string; teamA: string; teamB: string }, leadMinutes: number): AssistantAction {
  return {
    label: `Criar alerta ${leadMinutes} min antes`,
    leadMinutes,
    matchId: match.id,
    type: "create_alert",
  };
}

type ScenarioMatch = {
  group: string;
  id: string;
  penaltyGoalsA?: number | null;
  penaltyGoalsB?: number | null;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  resultMethod?: string | null;
  startsAt: Date | null;
  teamA: string;
  teamB: string;
  winnerTeam?: string | null;
};

type ScenarioPrediction = {
  goalsA: number;
  goalsB: number;
  matchId: string;
};

function getScenarioScore(match: ScenarioMatch, predictionsByMatchId: Map<string, ScenarioPrediction>) {
  if (match.resultGoalsA !== null && match.resultGoalsB !== null) {
    return { goalsA: match.resultGoalsA, goalsB: match.resultGoalsB, source: "oficial" };
  }

  const prediction = predictionsByMatchId.get(match.id);
  if (prediction) return { goalsA: prediction.goalsA, goalsB: prediction.goalsB, source: "seu palpite" };
  return null;
}

function formatDecisionMethod(match: ScenarioMatch) {
  if (!match.resultMethod && match.resultGoalsA !== match.resultGoalsB) return "";
  const method = match.resultMethod ?? (match.resultGoalsA === match.resultGoalsB && match.winnerTeam ? "penalties" : null);
  const label = method === "penalties"
    ? "penaltis"
    : method === "extra_time"
      ? "prorrogacao"
      : method === "regular"
        ? "tempo normal"
        : "decisao apos empate";
  const penalties = match.penaltyGoalsA !== null
    && match.penaltyGoalsA !== undefined
    && match.penaltyGoalsB !== null
    && match.penaltyGoalsB !== undefined
    ? `, penaltis ${match.penaltyGoalsA} x ${match.penaltyGoalsB}`
    : "";
  const winner = match.winnerTeam ? `, classificado: ${getTeamDisplayName(match.winnerTeam)}` : "";
  return ` (${label}${penalties}${winner})`;
}

function buildScenarioStandings(matches: ScenarioMatch[], predictions: ScenarioPrediction[]) {
  const predictionsByMatchId = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
  const rows = new Map<string, { goalDifference: number; goalsFor: number; played: number; points: number; team: string }>();
  const pending: ScenarioMatch[] = [];

  for (const match of matches) {
    rows.set(match.teamA, rows.get(match.teamA) ?? { goalDifference: 0, goalsFor: 0, played: 0, points: 0, team: match.teamA });
    rows.set(match.teamB, rows.get(match.teamB) ?? { goalDifference: 0, goalsFor: 0, played: 0, points: 0, team: match.teamB });

    const score = getScenarioScore(match, predictionsByMatchId);
    if (!score) {
      pending.push(match);
      continue;
    }

    const teamA = rows.get(match.teamA)!;
    const teamB = rows.get(match.teamB)!;
    teamA.played += 1;
    teamB.played += 1;
    teamA.goalsFor += score.goalsA;
    teamB.goalsFor += score.goalsB;
    teamA.goalDifference += score.goalsA - score.goalsB;
    teamB.goalDifference += score.goalsB - score.goalsA;

    if (score.goalsA > score.goalsB) teamA.points += 3;
    else if (score.goalsA < score.goalsB) teamB.points += 3;
    else {
      teamA.points += 1;
      teamB.points += 1;
    }
  }

  return {
    pending,
    standings: Array.from(rows.values()).sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || getTeamDisplayName(a.team).localeCompare(getTeamDisplayName(b.team)),
    ),
  };
}

function buildTeamSearchText(team: string) {
  return [
    team,
    getTeamDisplayName(team),
    getTeamDisplayName(team, "en-US"),
    getTeamDisplayName(team, "es-ES"),
  ].join(" ");
}

function detectMentionedTeams(question: string, matches: ScenarioMatch[], limit = 4) {
  const terms = getKnowledgeQueryTerms(question);
  if (terms.length === 0) return [];

  const teamScores = new Map<string, number>();
  for (const match of matches) {
    for (const team of [match.teamA, match.teamB]) {
      const score = scoreKnowledgeText(buildTeamSearchText(team), terms);
      if (score > 0) teamScores.set(team, Math.max(teamScores.get(team) ?? 0, score));
    }
  }

  return Array.from(teamScores.entries())
    .sort((a, b) => b[1] - a[1] || getTeamDisplayName(a[0]).localeCompare(getTeamDisplayName(b[0])))
    .map(([team]) => getTeamDisplayName(team))
    .slice(0, limit);
}

async function buildAssistantContext(email: string, question: string, tools: string[]) {
  const terms = getKnowledgeQueryTerms(question);
  const uses = (tool: string) => tools.includes(tool) || tools.includes("all");
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, nickname: true, notificationLeadMinutes: true },
  });
  if (!user) throw new Error("Usuario nao encontrado.");

  const [pendingMatches, finishedMatches, allMatches, predictions, knockoutPredictions, users] = await Promise.all([
    prisma.match.findMany({
      orderBy: [{ startsAt: "asc" }, { group: "asc" }],
      take: 18,
      where: {
        group: { in: groupStageCodes },
        resultGoalsA: null,
        resultGoalsB: null,
        startsAt: { gte: now },
      },
    }),
    prisma.match.findMany({
      orderBy: [{ finishedAt: "desc" }, { startsAt: "desc" }],
      take: 12,
      where: {
        resultGoalsA: { not: null },
        resultGoalsB: { not: null },
      },
    }),
    prisma.match.findMany({
      orderBy: [{ group: "asc" }, { startsAt: "asc" }],
      take: 160,
    }),
    prisma.prediction.findMany({
      include: { match: true },
      orderBy: { updatedAt: "desc" },
      take: 40,
      where: { userId: user.id },
    }),
    prisma.knockoutPrediction.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 24,
      where: { userId: user.id },
    }),
    prisma.user.findMany({
      include: {
        predictions: {
          include: { match: true },
        },
      },
      take: 80,
    }),
  ]);
  const mentionedTeamNames = detectMentionedTeams(question, allMatches);
  const shouldFetchNews = uses("relevant_news");
  const [news, teamNews] = shouldFetchNews
    ? await Promise.all([
      getLatestNews(18).catch(() => []),
      getTeamNews(mentionedTeamNames, 12).catch(() => []),
    ])
    : [[], []];
  const combinedNews = [...teamNews, ...news];
  await Promise.all([
    indexNewsKnowledge(prisma, combinedNews),
    indexMatchKnowledge(prisma),
  ]).catch((error) => {
    logger.warn("knowledge_index_failed", { message: error instanceof Error ? error.message : "unknown" });
  });
  let retrievedKnowledge = await retrieveKnowledge(prisma, question, 8);
  let webSearchReason: string | null = null;
  let webSearchNews: NewsItem[] = [];
  const shouldSearchWeb = uses("web_search")
    && (
      retrievedKnowledge.length < 3
      || (retrievedKnowledge[0]?.score ?? 0) < 2
      || (uses("relevant_news") && mentionedTeamNames.length > 0)
    );

  if (shouldSearchWeb) {
    try {
      const webSearch = await searchFootballWeb({
        focusTerms: mentionedTeamNames,
        forceFootballScope: mentionedTeamNames.length > 0,
        question,
      });
      webSearchReason = webSearch.reason;
      webSearchNews = webSearch.items;
      if (webSearch.items.length > 0) {
        await indexNewsKnowledge(prisma, webSearch.items);
        retrievedKnowledge = await retrieveKnowledge(prisma, question, 8);
      }
    } catch (error) {
      webSearchReason = "failed";
      logger.warn("ai_web_search_failed", { message: error instanceof Error ? error.message : "unknown" });
    }
  }

  const predictedMatchIds = new Set(predictions.map((prediction) => prediction.matchId));
  const predictedKnockoutMatchIds = new Set(knockoutPredictions.map((prediction) => prediction.bracketMatchId));
  const predictionScenarios = predictions.map((prediction) => ({
    goalsA: prediction.goalsA,
    goalsB: prediction.goalsB,
    matchId: prediction.matchId,
  }));
  const missingPicks = pendingMatches.filter((match) => !predictedMatchIds.has(match.id)).slice(0, 8);
  const missingKnockoutPicks = allMatches
    .filter((match) =>
      !groupStageCodeSet.has(match.group)
      && match.resultGoalsA === null
      && match.resultGoalsB === null
      && (!match.startsAt || match.startsAt >= now)
    )
    .flatMap((match) => {
      const bracketMatchId = groupToBracketMatchId(match.group);
      return bracketMatchId ? [{ match, bracketMatchId }] : [];
    })
    .filter((item) => !predictedKnockoutMatchIds.has(item.bracketMatchId))
    .sort((a, b) => {
      const timeA = a.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const timeB = b.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    })
    .slice(0, 8);
  const suggestedPickMatch = missingPicks[0] ?? null;
  const knockoutPendingAction: AssistantAction | null = missingKnockoutPicks.length > 0
    ? { href: "/bolao?fase=mata-mata#bolao-confrontos", label: "Abrir mata-mata", type: "link" }
    : null;
  const relevantNews = [...webSearchNews, ...combinedNews]
    .map((item) => ({
      item,
      score: scoreKnowledgeText(`${item.title} ${item.description} ${item.source}`, terms),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ item }) => item);
  const relevantMatches = [...pendingMatches, ...finishedMatches]
    .map((match) => ({
      match,
      score: scoreKnowledgeText([
        match.teamA,
        match.teamB,
        getTeamDisplayName(match.teamA),
        getTeamDisplayName(match.teamB),
        getTeamDisplayName(match.teamA, "en-US"),
        getTeamDisplayName(match.teamB, "en-US"),
        getTeamDisplayName(match.teamA, "es-ES"),
        getTeamDisplayName(match.teamB, "es-ES"),
        match.group,
      ].join(" "), terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ match }) => match);
  const scenarioGroup = relevantMatches[0]?.group
    ?? allMatches.find((match) => scoreKnowledgeText(`${match.group} grupo ${match.group}`, terms) > 0)?.group
    ?? null;
  const scenarioMatches = scenarioGroup ? allMatches.filter((match) => match.group === scenarioGroup) : [];
  const scenario = scenarioMatches.length > 0 ? buildScenarioStandings(scenarioMatches, predictionScenarios) : null;

  const ranking = users
    .map((rankingUser) => {
      const points = rankingUser.predictions.reduce((sum, prediction) => sum + prediction.points, 0);
      const name = rankingUser.nickname?.trim() || rankingUser.name?.trim() || `Participante ${rankingUser.id.slice(-6)}`;
      return { id: rankingUser.id, name, points, predictions: rankingUser.predictions.length };
    })
    .sort((a, b) => b.points - a.points || b.predictions - a.predictions || a.name.localeCompare(b.name))
    .slice(0, 8);
  const pickTargetMatch = relevantMatches.find((match) => match.resultGoalsA === null && match.resultGoalsB === null)
    ?? suggestedPickMatch
    ?? pendingMatches[0]
    ?? null;
  const pickDossier = uses("pick_dossier")
    ? buildAgenticPickDossier({
      matches: allMatches,
      news: relevantNews,
      question,
      targetMatch: pickTargetMatch,
    })
    : null;
  const agentPlan = buildAgenticActionPlan({
    hasScenario: Boolean(scenario),
    missingKnockoutPicks,
    missingPicks,
    pickDossier,
    rankingLeader: ranking[0] ?? null,
  });

  const contextLines = [
    `Usuario: ${user.nickname || user.name || "participante"}.`,
    `Palpites salvos: ${predictions.length}. Palpites mata-mata: ${knockoutPredictions.length}.`,
    `Ferramentas internas usadas: ${tools.join(", ")}.`,
    "Plano agentico sugerido:",
    ...agentPlan.map((item) => `- ${item}`),
    ...(uses("upcoming_matches") ? [
      "Proximos jogos sem resultado:",
      ...pendingMatches.slice(0, 10).map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | grupo ${match.group} | ${formatDate(match.startsAt)}`),
    ] : []),
    ...(uses("pending_picks") ? [
      "Palpites pendentes do usuario na fase de grupos:",
      ...(missingPicks.length > 0
        ? missingPicks.map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | ${formatDate(match.startsAt)}`)
        : ["- Nenhum nos proximos jogos de grupos carregados."]),
      "Palpites pendentes do usuario no mata-mata:",
      ...(missingKnockoutPicks.length > 0
        ? missingKnockoutPicks.map(({ bracketMatchId, match }) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | ${match.group}/${bracketMatchId} | ${formatDate(match.startsAt)} | usar aba Mata-mata em /bolao`)
        : ["- Nenhum confronto de mata-mata pendente carregado."]),
    ] : []),
    ...(uses("recent_results") ? [
      "Resultados recentes:",
      ...finishedMatches.slice(0, 8).map((match) => `- ${getTeamDisplayName(match.teamA)} ${match.resultGoalsA} x ${match.resultGoalsB} ${getTeamDisplayName(match.teamB)}${formatDecisionMethod(match)} | grupo/fase ${match.group}`),
    ] : []),
    ...(uses("ranking_snapshot") ? [
      "Ranking geral parcial:",
      ...ranking.map((row, index) => `- ${index + 1}. ${row.name}: ${row.points} pts, ${row.predictions} palpites`),
    ] : []),
    ...(uses("relevant_news") ? [
      "Noticias relevantes:",
      ...(relevantNews.length > 0
        ? relevantNews.map((item) => `- [${item.source}] ${item.title}`)
        : ["- Nenhuma noticia relevante carregada agora."]),
      ...(mentionedTeamNames.length > 0 ? [`Selecoes pesquisadas especificamente: ${mentionedTeamNames.join(", ")}.`] : []),
      ...(mentionedTeamNames.length > 0 ? [
        "Instrucao para noticias por selecao: priorize informacoes diretamente ligadas as selecoes mencionadas pelo usuario; se a fonte for geral, diga que e contexto indireto.",
      ] : []),
    ] : []),
    ...(uses("web_search") ? [
      "Busca web controlada:",
      webSearchReason
        ? `- Status: ${webSearchReason}. Dominios permitidos e escopo futebol/Copa aplicados.`
        : "- Nao acionada porque a base local foi suficiente ou a pergunta nao exigiu busca externa.",
      ...(webSearchNews.length > 0
        ? webSearchNews.map((item) => `- [${item.source}] ${item.title}`)
        : []),
    ] : []),
    ...(uses("knowledge_base") ? [
      "Trechos recuperados da base de conhecimento:",
      ...(retrievedKnowledge.length > 0
        ? retrievedKnowledge.map((document) => `- ${document.label}: ${document.content.replace(/\s+/g, " ").slice(0, 420)}`)
        : ["- Nenhum trecho recuperado."]),
    ] : []),
    ...(uses("pick_dossier") ? [
      "Dossie agentico para palpite:",
      ...(pickDossier
        ? [
          `- Confronto alvo: ${getTeamDisplayName(pickDossier.targetMatch.teamA)} x ${getTeamDisplayName(pickDossier.targetMatch.teamB)} | grupo/fase ${pickDossier.targetMatch.group} | ${formatDate(pickDossier.targetMatch.startsAt)}`,
          `- Forma ${getTeamDisplayName(pickDossier.targetMatch.teamA)}: ${pickDossier.teamAForm.played} jogo(s), ${pickDossier.teamAForm.wins}V ${pickDossier.teamAForm.draws}E ${pickDossier.teamAForm.losses}D, gols ${pickDossier.teamAForm.goalsFor}-${pickDossier.teamAForm.goalsAgainst}.`,
          `- Forma ${getTeamDisplayName(pickDossier.targetMatch.teamB)}: ${pickDossier.teamBForm.played} jogo(s), ${pickDossier.teamBForm.wins}V ${pickDossier.teamBForm.draws}E ${pickDossier.teamBForm.losses}D, gols ${pickDossier.teamBForm.goalsFor}-${pickDossier.teamBForm.goalsAgainst}.`,
          `- Sugestao calculada: ${pickDossier.suggested.goalsA} x ${pickDossier.suggested.goalsB} (${pickDossier.suggested.label}).`,
          ...(pickDossier.newsSignals.length > 0
            ? ["- Sinais de noticia conectados ao confronto:", ...pickDossier.newsSignals.map((item) => `  - [${item.source}] ${item.title}`)]
            : ["- Nenhum sinal de noticia especifico suficiente; trate como palpite conservador."]),
          "- Instrucao: use este dossie como eixo da resposta. Cite risco, nao afirme certeza e diferencie dado oficial de inferencia.",
        ]
        : ["- Nenhum confronto alvo pendente identificado para montar dossie."]),
    ] : []),
    ...(uses("relevant_matches") ? [
      "Partidas relevantes para a pergunta:",
      ...(relevantMatches.length > 0
        ? relevantMatches.map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | grupo/fase ${match.group} | ${match.resultGoalsA ?? "?"} x ${match.resultGoalsB ?? "?"}${formatDecisionMethod(match)}`)
        : ["- Nenhuma partida especifica detectada."]),
    ] : []),
    ...(uses("classification_scenarios") ? [
      "Cenario de classificacao:",
      ...(scenario
        ? [
          `- Grupo/fase analisado: ${scenarioGroup}. Resultados oficiais prevalecem; palpites do usuario entram apenas onde nao ha resultado oficial.`,
          ...scenario.standings.map((row, index) => `- ${index + 1}. ${getTeamDisplayName(row.team)}: ${row.points} pts, SG ${row.goalDifference}, GP ${row.goalsFor}, J ${row.played}`),
          ...(scenario.pending.length > 0
            ? ["Jogos ainda sem resultado/palpite no cenario:", ...scenario.pending.map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | ${formatDate(match.startsAt)}`)]
            : ["- Todos os jogos do cenario possuem resultado oficial ou palpite preenchido."]),
        ]
        : ["- Nao identifiquei um grupo ou confronto suficiente para montar cenario."]),
    ] : []),
    ...(uses("custom_alerts") ? [
      "Plano de alerta personalizado:",
      ...(missingPicks.length > 0
        ? missingPicks.slice(0, 4).map((match) => {
          const deadline = match.startsAt ? new Date(match.startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000) : null;
          return `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | fechamento do palpite: ${formatDate(deadline)} | acao sugerida: configurar lembrete no perfil e abrir confronto.`;
        })
        : missingKnockoutPicks.length > 0
          ? missingKnockoutPicks.slice(0, 4).map(({ match }) => {
            const deadline = match.startsAt ? new Date(match.startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000) : null;
            return `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | mata-mata | fechamento do palpite: ${formatDate(deadline)} | acao sugerida: abrir a aba Mata-mata em /bolao.`;
          })
          : ["- Nao encontrei palpites pendentes nos proximos jogos carregados."]),
    ] : []),
  ];

  const sources: AssistantSource[] = [
    { label: "Dados internos: partidas, palpites, ranking e resultados" },
    ...retrievedKnowledge.slice(0, 5).map((item) => ({ label: item.label, url: item.url ?? undefined })),
    ...webSearchNews.slice(0, 5).map((item) => ({ label: `${item.source}: ${item.title}`, url: item.link })),
    ...relevantNews.slice(0, 5).map((item) => ({ label: `${item.source}: ${item.title}`, url: item.link })),
  ];

  return {
    context: contextLines.join("\n").slice(0, 9000),
    createAlertAction: missingPicks[0] ? buildCreateAlertAction(missingPicks[0], user.notificationLeadMinutes ?? 60) : null,
    focusMatchAction: pickDossier?.targetMatch ? buildFocusMatchAction(pickDossier.targetMatch) : relevantMatches[0] ? buildFocusMatchAction(relevantMatches[0]) : null,
    hasAlertPlan: uses("custom_alerts") && missingPicks.length > 0,
    hasScenario: Boolean(scenario),
    knockoutPendingAction,
    diagnostics: {
      knowledgeHits: retrievedKnowledge.length,
      mentionedTeams: mentionedTeamNames,
      newsItems: relevantNews.length,
      planSteps: agentPlan.length,
      pickDossierMatch: pickDossier ? `${pickDossier.targetMatch.teamA} x ${pickDossier.targetMatch.teamB}` : null,
      sourceCount: sources.length,
      webSearchItems: webSearchNews.length,
      webSearchReason,
    },
    sources,
    suggestedPickAction: pickDossier
      ? {
        goalsA: pickDossier.suggested.goalsA,
        goalsB: pickDossier.suggested.goalsB,
        href: `/bolao?focus=${encodeURIComponent(pickDossier.targetMatch.id)}#bolao-confrontos`,
        label: `Usar palpite ${pickDossier.suggested.goalsA} x ${pickDossier.suggested.goalsB}`,
        matchId: pickDossier.targetMatch.id,
        type: "apply_pick" as const,
      }
      : suggestedPickMatch ? buildSuggestedPick(suggestedPickMatch) : null,
  };
}

function getMatchOutcomeForTeam(match: Pick<ScenarioMatch, "resultGoalsA" | "resultGoalsB" | "teamA" | "teamB">, team: string) {
  if (match.resultGoalsA === null || match.resultGoalsB === null) return null;
  const isTeamA = match.teamA === team;
  const goalsFor = isTeamA ? match.resultGoalsA : match.resultGoalsB;
  const goalsAgainst = isTeamA ? match.resultGoalsB : match.resultGoalsA;
  return {
    goalsAgainst,
    goalsFor,
    outcome: goalsFor > goalsAgainst ? "vitoria" : goalsFor < goalsAgainst ? "derrota" : "empate",
  };
}

function buildTeamFormSummary(team: string, matches: ScenarioMatch[]) {
  const finished = matches
    .filter((match) => (match.teamA === team || match.teamB === team) && match.resultGoalsA !== null && match.resultGoalsB !== null)
    .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0))
    .slice(0, 5);

  const totals = finished.reduce((summary, match) => {
    const outcome = getMatchOutcomeForTeam(match, team);
    if (!outcome) return summary;
    summary.goalsFor += outcome.goalsFor;
    summary.goalsAgainst += outcome.goalsAgainst;
    if (outcome.outcome === "vitoria") summary.wins += 1;
    if (outcome.outcome === "empate") summary.draws += 1;
    if (outcome.outcome === "derrota") summary.losses += 1;
    return summary;
  }, { draws: 0, goalsAgainst: 0, goalsFor: 0, losses: 0, wins: 0 });

  return {
    finished,
    ...totals,
    played: finished.length,
  };
}

function buildAgenticPickDossier({
  matches,
  news,
  question,
  targetMatch,
}: {
  matches: ScenarioMatch[];
  news: NewsItem[];
  question: string;
  targetMatch: ScenarioMatch | null;
}) {
  if (!targetMatch) return null;

  const teamAForm = buildTeamFormSummary(targetMatch.teamA, matches);
  const teamBForm = buildTeamFormSummary(targetMatch.teamB, matches);
  const terms = getKnowledgeQueryTerms([
    question,
    getTeamDisplayName(targetMatch.teamA),
    getTeamDisplayName(targetMatch.teamB),
  ].join(" "));
  const newsSignals = news
    .map((item) => ({
      item,
      score: scoreKnowledgeText(`${item.title} ${item.description} ${item.source}`, terms),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(({ item }) => item);

  const formScoreA = teamAForm.wins * 3 + teamAForm.draws + teamAForm.goalsFor * 0.25 - teamAForm.goalsAgainst * 0.2;
  const formScoreB = teamBForm.wins * 3 + teamBForm.draws + teamBForm.goalsFor * 0.25 - teamBForm.goalsAgainst * 0.2;
  const edge = formScoreA - formScoreB;
  const suggested = Math.abs(edge) < 1.2
    ? { goalsA: 1, goalsB: 1, label: "equilibrio" }
    : edge > 0
      ? { goalsA: 2, goalsB: 1, label: "leve vantagem do mandante da chave" }
      : { goalsA: 1, goalsB: 2, label: "leve vantagem do visitante da chave" };

  return {
    newsSignals,
    suggested,
    targetMatch,
    teamAForm,
    teamBForm,
  };
}

function buildAgenticActionPlan({
  hasScenario,
  missingKnockoutPicks,
  missingPicks,
  pickDossier,
  rankingLeader,
}: {
  hasScenario: boolean;
  missingKnockoutPicks: Array<{ bracketMatchId: string; match: ScenarioMatch }>;
  missingPicks: ScenarioMatch[];
  pickDossier: ReturnType<typeof buildAgenticPickDossier>;
  rankingLeader?: { name: string; points: number } | null;
}) {
  const plan: string[] = [];

  if (missingPicks.length > 0) {
    const first = missingPicks[0];
    plan.push(`Prioridade 1: preencher ${getTeamDisplayName(first.teamA)} x ${getTeamDisplayName(first.teamB)} antes do fechamento (${formatDate(first.startsAt)}).`);
  } else if (missingKnockoutPicks.length > 0) {
    const first = missingKnockoutPicks[0].match;
    plan.push(`Prioridade 1: abrir a aba Mata-mata e preencher ${getTeamDisplayName(first.teamA)} x ${getTeamDisplayName(first.teamB)} (${formatDate(first.startsAt)}).`);
  } else {
    plan.push("Prioridade 1: nao ha palpite pendente carregado; revisar ranking/resultados pode ser mais util agora.");
  }

  if (pickDossier) {
    plan.push(`Recomendacao de palpite: considerar ${pickDossier.suggested.goalsA} x ${pickDossier.suggested.goalsB} em ${getTeamDisplayName(pickDossier.targetMatch.teamA)} x ${getTeamDisplayName(pickDossier.targetMatch.teamB)}, com risco recreativo e sem tratar como certeza.`);
  }

  if (hasScenario) {
    plan.push("Cenario: usar resultados oficiais como verdade e palpites apenas onde ainda nao existe placar final.");
  }

  if (rankingLeader) {
    plan.push(`Competicao: lider parcial ${rankingLeader.name} com ${rankingLeader.points} pts; evite palpites exagerados se estiver perto no ranking.`);
  }

  return plan.slice(0, 4);
}

function localAnswer(question: string, context: string) {
  const pendingGroupPicks = extractContextList(context, "Palpites pendentes do usuario na fase de grupos:");
  const pendingKnockoutPicks = extractContextList(context, "Palpites pendentes do usuario no mata-mata:");
  const agentPlan = extractContextList(context, "Plano agentico sugerido:");

  if (/(pendente|preciso|falta|fech)/i.test(question)) {
    const groupLines = pendingGroupPicks.filter((line) => !line.includes("Nenhum"));
    const knockoutLines = pendingKnockoutPicks.filter((line) => !line.includes("Nenhum"));
    if (groupLines.length === 0 && knockoutLines.length === 0) {
      return [
        "Nao consegui consultar o LLM agora, mas verifiquei os dados internos.",
        "Nao encontrei palpites pendentes nos proximos jogos carregados.",
      ].join("\n\n");
    }

    return [
      "Nao consegui consultar o LLM agora, mas verifiquei os dados internos.",
      groupLines.length > 0 ? `Fase de grupos:\n${groupLines.slice(0, 6).map((line) => `- ${line}`).join("\n")}` : null,
      knockoutLines.length > 0 ? `Mata-mata:\n${knockoutLines.slice(0, 6).map((line) => `- ${line}`).join("\n")}` : null,
      agentPlan.length > 0 ? `Proximo passo:\n${agentPlan.slice(0, 2).map((line) => `- ${line}`).join("\n")}` : "Abra /bolao para preencher os confrontos pendentes.",
    ].filter(Boolean).join("\n\n");
  }

  const missingLine = pendingGroupPicks.some((line) => !line.includes("Nenhum")) || pendingKnockoutPicks.some((line) => !line.includes("Nenhum"))
    ? "Vi que existem palpites pendentes nos proximos jogos carregados. Vale abrir /bolao e preencher esses confrontos primeiro."
    : "Voce nao parece ter palpites pendentes nos proximos jogos carregados.";

  return [
    "Nao consegui consultar o LLM agora, entao usei uma resposta local com base nos dados do app.",
    missingLine,
    "Para palpites, eu iria de placares conservadores em jogos equilibrados e ajustaria quando houver noticias relevantes sobre titulares, lesoes ou contexto de grupo.",
    `Pergunta recebida: ${question}`,
  ].join("\n\n");
}

function extractContextList(context: string, heading: string) {
  const start = context.indexOf(heading);
  if (start < 0) return [];

  const lines = context.slice(start + heading.length).split("\n");
  const items: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("- ")) break;
    items.push(line.slice(2).trim());
  }
  return items;
}

function classifyIntent(question: string) {
  const normalizedQuestion = question.toLowerCase();
  if (/(alerta|aviso|avisar|lembrete|notific)/i.test(normalizedQuestion)) return "custom_alerts";
  if (/(classifica|classificacao|classifica[cç][aã]o|cenario|cen[aá]rio|avanca|avan[cç]a|passa|grupo)/i.test(normalizedQuestion)) return "classification_scenarios";
  if (/(pendente|preciso|falta|fech)/i.test(normalizedQuestion)) return "pending_picks";
  if (/(ranking|posicao|lider|pontos|pontu)/i.test(normalizedQuestion)) return "ranking";
  if (/(noticia|lesao|convoc|titular|fonte)/i.test(normalizedQuestion)) return "news";
  if (/(palpite|placar|sugest|estrateg)/i.test(normalizedQuestion)) return "pick_strategy";
  return "general";
}

function selectToolsForIntent(intent: string) {
  if (intent === "custom_alerts") return ["custom_alerts", "pending_picks", "upcoming_matches", "relevant_matches", "knowledge_base"];
  if (intent === "classification_scenarios") return ["classification_scenarios", "relevant_matches", "pending_picks", "upcoming_matches", "knowledge_base"];
  if (intent === "pending_picks") return ["pending_picks", "upcoming_matches", "knowledge_base"];
  if (intent === "ranking") return ["ranking_snapshot", "recent_results", "knowledge_base"];
  if (intent === "news") return ["relevant_news", "web_search", "knowledge_base", "relevant_matches"];
  if (intent === "pick_strategy") return ["pick_dossier", "pending_picks", "upcoming_matches", "recent_results", "relevant_news", "web_search", "knowledge_base", "relevant_matches"];
  return ["pending_picks", "upcoming_matches", "ranking_snapshot", "relevant_news", "web_search", "relevant_matches", "knowledge_base"];
}

function selectActionsForIntent(intent: string, tools: string[]) {
  const actions: AssistantAction[] = [];
  if (tools.includes("pending_picks") || tools.includes("upcoming_matches")) {
    actions.push({ href: "/bolao#bolao-confrontos", label: "Abrir palpites", type: "link" });
  }
  if (intent === "ranking" || tools.includes("ranking_snapshot")) {
    actions.push({ href: "/ranking", label: "Ver ranking", type: "link" });
  }
  if (intent === "news" || tools.includes("relevant_news")) {
    actions.push({ href: "/noticias", label: "Ver noticias", type: "link" });
  }
  if (tools.includes("recent_results")) {
    actions.push({ href: "/resultados", label: "Ver resultados", type: "link" });
  }
  if (tools.includes("custom_alerts")) {
    actions.push({ href: "/perfil", label: "Configurar notificacoes", type: "link" });
  }
  if (tools.includes("classification_scenarios")) {
    actions.push({ href: "/simulador", label: "Abrir simulador", type: "link" });
  }
  if (intent === "pick_strategy") {
    actions.push({ href: "/simulador", label: "Abrir simulador", type: "link" });
  }

  return actions.filter((action, index, list) => list.findIndex((item) => {
    if (!("href" in item) || !("href" in action)) return false;
    return item.href === action.href;
  }) === index).slice(0, 4);
}

function mergeActions(...actionGroups: Array<Array<AssistantAction | null | undefined>>) {
  return actionGroups
    .flat()
    .filter((action): action is AssistantAction => Boolean(action))
    .filter((action, index, list) => {
      const actionKey = "href" in action ? `${action.type}:${action.href}:${action.label}` : `${action.type}:${action.matchId}:${action.label}`;
      return list.findIndex((item) => {
        const itemKey = "href" in item ? `${item.type}:${item.href}:${item.label}` : `${item.type}:${item.matchId}:${item.label}`;
        return itemKey === actionKey;
      }) === index;
    })
    .slice(0, 4);
}

function messageContentToText(content: unknown) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null && "text" in item && typeof item.text === "string") return item.text;
      return "";
    }).join("\n").trim();
  }
  return "";
}

function makeOpenRouterModel(model: string) {
  return new ChatOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.AUTH_URL || "http://localhost:3000",
        "X-Title": "Bolao Copa 2026",
      },
    },
    maxRetries: 1,
    maxTokens: 900,
    model,
    temperature: 0.35,
  });
}

async function invokeOpenRouter(messages: Array<{ role: "system" | "user"; content: string }>) {
  const errors: string[] = [];
  for (const modelName of await getOpenRouterModels()) {
    try {
      const model = makeOpenRouterModel(modelName);
      const response = await model.invoke(messages);
      return { modelName, response };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      errors.push(`${modelName}: ${message}`);
      logger.warn("openrouter_model_attempt_failed", { message, model: modelName });
    }
  }

  throw new Error(errors.join(" | ") || "OpenRouter unavailable");
}

async function runAssistantGraph(email: string, question: string) {
  const graph = new StateGraph(AssistantState)
    .addNode("plan", async (state) => ({
      actions: selectActionsForIntent(classifyIntent(state.question), selectToolsForIntent(classifyIntent(state.question))),
      intent: classifyIntent(state.question),
      tools: selectToolsForIntent(classifyIntent(state.question)),
    }))
    .addNode("retrieve", async (state) => {
      const { context, createAlertAction, diagnostics, focusMatchAction, hasAlertPlan, hasScenario, knockoutPendingAction, sources, suggestedPickAction } = await buildAssistantContext(state.email, state.question, state.tools);
      const shouldSuggestPick = state.intent === "pick_strategy" || state.intent === "pending_picks";
      const shouldFocusMatch = state.tools.includes("relevant_matches") || state.intent === "general" || hasAlertPlan || hasScenario;
      return {
        actions: mergeActions(
          shouldFocusMatch ? [focusMatchAction] : [],
          hasAlertPlan ? [createAlertAction] : [],
          state.intent === "pending_picks" ? [knockoutPendingAction] : [],
          shouldSuggestPick ? [suggestedPickAction] : [],
          state.actions,
        ),
        context,
        diagnostics,
        sources,
      };
    })
    .addNode("generate", async (state) => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        logger.warn("ai_assistant_local_fallback", { reason: "missing_openrouter_key" });
        return {
          answer: localAnswer(state.question, state.context),
          source: "local" as const,
        };
      }

      try {
        const { modelName, response } = await invokeOpenRouter([
          {
            role: "system",
            content: [
              "Voce e um assistente do Bolao Copa 2026.",
              `Intencao detectada pelo LangGraph: ${state.intent}.`,
              `Ferramentas executadas: ${state.tools.join(", ")}.`,
              "Use apenas o contexto fornecido. Se faltar dado, diga que nao ha dado suficiente.",
              "Nao invente placares oficiais, lesoes ou noticias.",
              "Se houver 'Dossie agentico para palpite', use-o como base principal da recomendacao e separe fatos de inferencias.",
              "Se houver 'Plano agentico sugerido', transforme-o em proximos passos objetivos para o usuario.",
              "Responda em portugues do Brasil, com tom pratico e curto.",
              "Quando sugerir palpite, explique risco e deixe claro que e sugestao recreativa.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Contexto RAG:\n${state.context}\n\nPergunta do usuario:\n${state.question}`,
          },
        ]);
        const answer = messageContentToText(response.content);
        if (!answer) {
          logger.error("langgraph_openrouter_assistant_empty_content", { intent: state.intent });
          return {
            answer: localAnswer(state.question, state.context),
            source: "local" as const,
          };
        }

        logger.info("langgraph_openrouter_assistant_success", { intent: state.intent, model: modelName });
        return {
          answer,
          source: "openrouter" as const,
        };
      } catch (error) {
        logger.error("langgraph_openrouter_assistant_failed", {
          intent: state.intent,
          message: error instanceof Error ? error.message : "unknown",
        });
        return {
          answer: localAnswer(state.question, state.context),
          source: "local" as const,
        };
      }
    })
    .addEdge(START, "plan")
    .addEdge("plan", "retrieve")
    .addEdge("retrieve", "generate")
    .addEdge("generate", END)
    .compile();

  return graph.invoke({
    actions: [],
    answer: "",
    context: "",
    diagnostics: {},
    email,
    intent: "general",
    question,
    source: "local",
    sources: [],
    tools: [],
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: "Faca login para usar o assistente." }, { status: 401 });

  try {
    await assertRateLimit(`ai-assistant:${email}`, 10, 60 * 1000);
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "Aguarde um minuto e tente novamente." }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return jsonNoStore({ error: "Pergunta invalida." }, { status: 400 });

  const result = await runAssistantGraph(email, parsed.data.question);
  await createAuditLog(prisma, {
    actorEmail: email,
    action: "assistant_answer_generated",
    entity: "ai_assistant",
    metadata: {
      actionCount: result.actions.length,
      diagnostics: result.diagnostics,
      intent: result.intent,
      questionPreview: parsed.data.question.slice(0, 120),
      source: result.source,
      sourceCount: result.sources.length,
      tools: result.tools,
    },
  }).catch((error) => logger.warn("assistant_audit_log_failed", { message: error instanceof Error ? error.message : "unknown" }));

  return jsonNoStore({
    actions: result.actions,
    answer: result.answer,
    source: result.source,
    sources: result.sources,
    toolsUsed: result.tools,
  });
}
