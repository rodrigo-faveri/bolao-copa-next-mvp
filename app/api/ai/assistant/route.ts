import { NextResponse } from "next/server";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { auth } from "../../../../auth";
import { getKnowledgeQueryTerms, indexMatchKnowledge, indexNewsKnowledge, retrieveKnowledge, scoreKnowledgeText } from "../../../../lib/knowledge";
import { logger } from "../../../../lib/logger";
import { getLatestNews } from "../../../../lib/news";
import { prisma } from "../../../../lib/prisma";
import { assertRateLimit } from "../../../../lib/rate-limit";
import { getTeamDisplayName } from "../../../../lib/teams";

export const runtime = "nodejs";

const requestSchema = z.object({
  question: z.string().trim().min(4).max(800),
});

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

async function buildAssistantContext(email: string, question: string, tools: string[]) {
  const terms = getKnowledgeQueryTerms(question);
  const uses = (tool: string) => tools.includes(tool) || tools.includes("all");
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, nickname: true },
  });
  if (!user) throw new Error("Usuario nao encontrado.");

  const [pendingMatches, finishedMatches, predictions, knockoutPredictions, users, news] = await Promise.all([
    prisma.match.findMany({
      orderBy: [{ startsAt: "asc" }, { group: "asc" }],
      take: 18,
      where: {
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
    getLatestNews(18).catch(() => []),
  ]);
  await Promise.all([
    indexNewsKnowledge(prisma, news),
    indexMatchKnowledge(prisma),
  ]).catch((error) => {
    logger.warn("knowledge_index_failed", { message: error instanceof Error ? error.message : "unknown" });
  });
  const retrievedKnowledge = await retrieveKnowledge(prisma, question, 8);

  const predictedMatchIds = new Set(predictions.map((prediction) => prediction.matchId));
  const missingPicks = pendingMatches.filter((match) => !predictedMatchIds.has(match.id)).slice(0, 8);
  const suggestedPickMatch = missingPicks[0] ?? pendingMatches[0] ?? null;
  const relevantNews = [...news]
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
      score: scoreKnowledgeText(`${match.teamA} ${match.teamB} ${match.group}`, terms),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ match }) => match);

  const ranking = users
    .map((rankingUser) => {
      const points = rankingUser.predictions.reduce((sum, prediction) => sum + prediction.points, 0);
      const name = rankingUser.nickname?.trim() || rankingUser.name?.trim() || `Participante ${rankingUser.id.slice(-6)}`;
      return { id: rankingUser.id, name, points, predictions: rankingUser.predictions.length };
    })
    .sort((a, b) => b.points - a.points || b.predictions - a.predictions || a.name.localeCompare(b.name))
    .slice(0, 8);

  const contextLines = [
    `Usuario: ${user.nickname || user.name || "participante"}.`,
    `Palpites salvos: ${predictions.length}. Palpites mata-mata: ${knockoutPredictions.length}.`,
    `Ferramentas internas usadas: ${tools.join(", ")}.`,
    ...(uses("upcoming_matches") ? [
      "Proximos jogos sem resultado:",
      ...pendingMatches.slice(0, 10).map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | grupo ${match.group} | ${formatDate(match.startsAt)}`),
    ] : []),
    ...(uses("pending_picks") ? [
      "Palpites pendentes do usuario:",
      ...(missingPicks.length > 0
        ? missingPicks.map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | ${formatDate(match.startsAt)}`)
        : ["- Nenhum nos proximos jogos carregados."]),
    ] : []),
    ...(uses("recent_results") ? [
      "Resultados recentes:",
      ...finishedMatches.slice(0, 8).map((match) => `- ${getTeamDisplayName(match.teamA)} ${match.resultGoalsA} x ${match.resultGoalsB} ${getTeamDisplayName(match.teamB)} | grupo ${match.group}`),
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
    ] : []),
    ...(uses("knowledge_base") ? [
      "Trechos recuperados da base de conhecimento:",
      ...(retrievedKnowledge.length > 0
        ? retrievedKnowledge.map((document) => `- ${document.label}: ${document.content.replace(/\s+/g, " ").slice(0, 420)}`)
        : ["- Nenhum trecho recuperado."]),
    ] : []),
    ...(uses("relevant_matches") ? [
      "Partidas relevantes para a pergunta:",
      ...(relevantMatches.length > 0
        ? relevantMatches.map((match) => `- ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} | grupo ${match.group} | ${match.resultGoalsA ?? "?"} x ${match.resultGoalsB ?? "?"}`)
        : ["- Nenhuma partida especifica detectada."]),
    ] : []),
  ];

  const sources: AssistantSource[] = [
    { label: "Dados internos: partidas, palpites, ranking e resultados" },
    ...retrievedKnowledge.slice(0, 5).map((item) => ({ label: item.label, url: item.url ?? undefined })),
    ...relevantNews.slice(0, 5).map((item) => ({ label: `${item.source}: ${item.title}`, url: item.link })),
  ];

  return {
    context: contextLines.join("\n").slice(0, 9000),
    sources,
    suggestedPickAction: suggestedPickMatch ? buildSuggestedPick(suggestedPickMatch) : null,
  };
}

function localAnswer(question: string, context: string) {
  const missingLine = context.includes("Palpites pendentes do usuario:\n- Nenhum")
    ? "Voce nao parece ter palpites pendentes nos proximos jogos carregados."
    : "Vi que existem palpites pendentes nos proximos jogos carregados. Vale abrir /bolao e preencher esses confrontos primeiro.";

  return [
    "Nao consegui consultar o LLM agora, entao usei uma resposta local com base nos dados do app.",
    missingLine,
    "Para palpites, eu iria de placares conservadores em jogos equilibrados e ajustaria quando houver noticias relevantes sobre titulares, lesoes ou contexto de grupo.",
    `Pergunta recebida: ${question}`,
  ].join("\n\n");
}

function classifyIntent(question: string) {
  const normalizedQuestion = question.toLowerCase();
  if (/(pendente|preciso|falta|fech)/i.test(normalizedQuestion)) return "pending_picks";
  if (/(ranking|posicao|lider|pontos|pontu)/i.test(normalizedQuestion)) return "ranking";
  if (/(noticia|lesao|convoc|titular|fonte)/i.test(normalizedQuestion)) return "news";
  if (/(palpite|placar|sugest|estrateg)/i.test(normalizedQuestion)) return "pick_strategy";
  return "general";
}

function selectToolsForIntent(intent: string) {
  if (intent === "pending_picks") return ["pending_picks", "upcoming_matches", "knowledge_base"];
  if (intent === "ranking") return ["ranking_snapshot", "recent_results", "knowledge_base"];
  if (intent === "news") return ["relevant_news", "knowledge_base", "relevant_matches"];
  if (intent === "pick_strategy") return ["pending_picks", "upcoming_matches", "recent_results", "relevant_news", "knowledge_base"];
  return ["pending_picks", "upcoming_matches", "ranking_snapshot", "knowledge_base"];
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
  if (intent === "pick_strategy") {
    actions.push({ href: "/simulador", label: "Abrir simulador", type: "link" });
  }

  return actions.filter((action, index, list) => list.findIndex((item) => item.href === action.href) === index).slice(0, 4);
}

function mergeActions(...actionGroups: Array<Array<AssistantAction | null | undefined>>) {
  return actionGroups
    .flat()
    .filter((action): action is AssistantAction => Boolean(action))
    .filter((action, index, list) => list.findIndex((item) => item.href === action.href && item.label === action.label) === index)
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

function makeOpenRouterModel() {
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
    model: process.env.OPENROUTER_MODEL || "nex-agi/nex-n2-pro:free",
    temperature: 0.35,
  });
}

async function runAssistantGraph(email: string, question: string) {
  const graph = new StateGraph(AssistantState)
    .addNode("plan", async (state) => ({
      actions: selectActionsForIntent(classifyIntent(state.question), selectToolsForIntent(classifyIntent(state.question))),
      intent: classifyIntent(state.question),
      tools: selectToolsForIntent(classifyIntent(state.question)),
    }))
    .addNode("retrieve", async (state) => {
      const { context, sources, suggestedPickAction } = await buildAssistantContext(state.email, state.question, state.tools);
      const shouldSuggestPick = state.intent === "pick_strategy" || state.intent === "pending_picks";
      return {
        actions: mergeActions(shouldSuggestPick ? [suggestedPickAction] : [], state.actions),
        context,
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
        const model = makeOpenRouterModel();
        const response = await model.invoke([
          {
            role: "system",
            content: [
              "Voce e um assistente do Bolao Copa 2026.",
              `Intencao detectada pelo LangGraph: ${state.intent}.`,
              `Ferramentas executadas: ${state.tools.join(", ")}.`,
              "Use apenas o contexto fornecido. Se faltar dado, diga que nao ha dado suficiente.",
              "Nao invente placares oficiais, lesoes ou noticias.",
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

        logger.info("langgraph_openrouter_assistant_success", { intent: state.intent, model: process.env.OPENROUTER_MODEL || "nex-agi/nex-n2-pro:free" });
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
  return jsonNoStore({
    actions: result.actions,
    answer: result.answer,
    source: result.source,
    sources: result.sources,
    toolsUsed: result.tools,
  });
}
