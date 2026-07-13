import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { ResultsExplorer, type ResultFilter, type ResultItem } from "../../components/ResultsExplorer";
import { buildSofaScoreSearchUrl } from "../../lib/external-match-links";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t, type AppLocale } from "../../lib/i18n-shared";
import { calculatePredictionPoints } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getTeamDisplayName, normalizeTeamName } from "../../lib/teams";
import { getMatchVenue } from "../../lib/venues";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

const groupStageCodes = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);

type UserResultPrediction = {
  goalsA: number | null;
  goalsB: number | null;
  points: number | null;
};

type KnockoutPredictionForResult = {
  awayGoals: number | null;
  awayTeam: string | null;
  bracketMatchId: string;
  bracketRound: string;
  homeGoals: number | null;
  homeTeam: string | null;
  winnerTeam: string;
};

type MatchForResult = {
  group: string;
  penaltyGoalsA: number | null;
  penaltyGoalsB: number | null;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  resultMethod: string | null;
  teamA: string;
  teamB: string;
  winnerTeam: string | null;
};

function isKnockoutGroup(group: string) {
  return !groupStageCodes.has(group);
}

function bracketMatchIdFromGroup(group: string) {
  const [prefix, rawNumber] = group.split("-");
  const number = Number(rawNumber);
  if (!Number.isInteger(number)) return null;

  const idPrefixByGroup: Record<string, string> = {
    FINAL: "final",
    QF: "qf",
    R16: "r16",
    R32: "r32",
    SF: "sf",
  };
  const idPrefix = idPrefixByGroup[prefix];
  return idPrefix ? `${idPrefix}-${number}` : null;
}

function getKnockoutStageLabel(group: string, locale: AppLocale) {
  const prefix = group.split("-")[0];
  const labels: Record<string, Record<AppLocale, string>> = {
    FINAL: { "en-US": "Final", "es-ES": "Final", "pt-BR": "Final" },
    QF: { "en-US": "Quarter-finals", "es-ES": "Cuartos", "pt-BR": "Quartas" },
    R16: { "en-US": "Round of 16", "es-ES": "Octavos", "pt-BR": "Oitavas" },
    R32: { "en-US": "Round of 32", "es-ES": "16avos", "pt-BR": "16 avos" },
    SF: { "en-US": "Semi-finals", "es-ES": "Semis", "pt-BR": "Semis" },
  };
  return labels[prefix]?.[locale] ?? group;
}

function getMatchWinner(match: MatchForResult) {
  if (match.winnerTeam) return match.winnerTeam;
  if (match.resultGoalsA === null || match.resultGoalsB === null || match.resultGoalsA === match.resultGoalsB) return null;
  return match.resultGoalsA > match.resultGoalsB ? match.teamA : match.teamB;
}

function getPredictionScoreInOfficialOrder(prediction: KnockoutPredictionForResult, match: MatchForResult) {
  if (prediction.homeGoals === null || prediction.awayGoals === null) return null;

  const predictionHome = normalizeTeamName(prediction.homeTeam ?? "");
  const predictionAway = normalizeTeamName(prediction.awayTeam ?? "");
  const officialTeamA = normalizeTeamName(match.teamA);
  const officialTeamB = normalizeTeamName(match.teamB);

  if (predictionHome === officialTeamA && predictionAway === officialTeamB) {
    return { goalsA: prediction.homeGoals, goalsB: prediction.awayGoals };
  }

  if (predictionHome === officialTeamB && predictionAway === officialTeamA) {
    return { goalsA: prediction.awayGoals, goalsB: prediction.homeGoals };
  }

  return null;
}

function calculateKnockoutPoints(prediction: KnockoutPredictionForResult, match: MatchForResult) {
  if (match.resultGoalsA === null || match.resultGoalsB === null) return null;

  const predictionScore = getPredictionScoreInOfficialOrder(prediction, match);
  if (predictionScore) {
    return calculatePredictionPoints(predictionScore.goalsA, predictionScore.goalsB, match.resultGoalsA, match.resultGoalsB);
  }

  const winner = getMatchWinner(match);
  if (!winner) return 0;
  return normalizeTeamName(prediction.winnerTeam) === normalizeTeamName(winner) ? 3 : 0;
}

function getDecisionLabel(match: MatchForResult, locale: AppLocale) {
  if (match.resultGoalsA === null || match.resultGoalsB === null) return null;
  const method = match.resultMethod ?? (match.resultGoalsA === match.resultGoalsB && match.winnerTeam ? "penalties" : "regular");
  const methodLabel = method === "penalties"
    ? locale === "en-US" ? "penalties" : locale === "es-ES" ? "penaltis" : "penaltis"
    : method === "extra_time"
      ? locale === "en-US" ? "extra time" : locale === "es-ES" ? "prorroga" : "prorrogacao"
      : locale === "en-US" ? "regular time" : locale === "es-ES" ? "tiempo normal" : "tempo normal";
  const penaltyScore = method === "penalties" && match.penaltyGoalsA !== null && match.penaltyGoalsB !== null
    ? ` (${match.penaltyGoalsA} x ${match.penaltyGoalsB})`
    : "";
  const winner = getMatchWinner(match);
  const winnerLabel = winner ? ` - ${getTeamDisplayName(winner, locale)}` : "";
  return `${methodLabel}${penaltyScore}${winnerLabel}`;
}

function explainPoints({
  locale,
  predictedA,
  predictedB,
  points,
  resultA,
  resultB,
}: {
  locale: AppLocale;
  predictedA: number | null;
  predictedB: number | null;
  points: number | null;
  resultA: number | null;
  resultB: number | null;
}) {
  const copy = t(locale);

  if (resultA === null || resultB === null) {
    return {
      label: copy.results.waitingResultLabel,
      text: copy.results.waitingResultText,
    };
  }

  if (predictedA === null || predictedB === null) {
    if (points !== null && points > 0) {
      return {
        label: copy.results.outcome,
        text: copy.results.outcomeText,
      };
    }

    return {
      label: copy.results.noPrediction,
      text: copy.results.noPredictionText,
    };
  }

  const calculatedPoints = calculatePredictionPoints(predictedA, predictedB, resultA, resultB);
  if (calculatedPoints === 5) {
    return {
      label: copy.results.exact,
      text: copy.results.exactText,
    };
  }

  if (calculatedPoints === 3 && getOutcome(predictedA, predictedB) === getOutcome(resultA, resultB)) {
    return {
      label: copy.results.outcome,
      text: copy.results.outcomeText,
    };
  }

  return {
    label: copy.results.missLabel,
    text: copy.results.missText,
  };
}

function getMatchPhase(match: { startsAt: Date | null; resultGoalsA: number | null; resultGoalsB: number | null }, locale: AppLocale, now = new Date()) {
  const copy = t(locale);
  if (match.resultGoalsA !== null && match.resultGoalsB !== null) return copy.common.finished;
  if (!match.startsAt) return copy.results.unscheduled;

  const elapsedMinutes = Math.floor((now.getTime() - match.startsAt.getTime()) / 60000);
  if (elapsedMinutes < 0) return copy.results.scheduled;
  if (elapsedMinutes <= 45) return copy.results.firstHalf;
  if (elapsedMinutes <= 60) return copy.results.halftime;
  if (elapsedMinutes <= 105) return copy.results.secondHalf;
  if (elapsedMinutes <= 130) return copy.results.expectedEnd;
  return copy.results.waitingResultLabel;
}

function buildMatchSummary({
  locale,
  prediction,
  resultA,
  resultB,
  teamA,
  teamB,
}: {
  locale: AppLocale;
  prediction: { goalsA: number | null; goalsB: number | null; points: number | null } | null;
  resultA: number | null;
  resultB: number | null;
  teamA: string;
  teamB: string;
}) {
  const copy = t(locale);

  if (resultA === null || resultB === null) {
    return copy.results.autoSummaryPending;
  }

  const values = { teamA, resultA, resultB, teamB };
  if (!prediction) {
    return formatMessage(copy.results.autoSummaryNoPrediction, values);
  }

  if (prediction.points === 5) {
    return formatMessage(copy.results.autoSummaryExact, values);
  }

  if ((prediction.points ?? 0) > 0) {
    return formatMessage(copy.results.autoSummaryOutcome, values);
  }

  return formatMessage(copy.results.autoSummaryMiss, values);
}

function getResultFilter(prediction: { goalsA: number | null; goalsB: number | null; points: number | null } | null, resultA: number | null, resultB: number | null): ResultFilter {
  if (resultA === null || resultB === null) return "pending";
  if (!prediction) return "noPrediction";
  if (prediction.goalsA === resultA && prediction.goalsB === resultB) return "exact";
  if ((prediction.points ?? 0) > 0) return "outcome";
  return "miss";
}

function scorerName(user: { nickname: string | null; name: string | null; email: string | null }) {
  return user.nickname || user.name || user.email?.split("@")[0] || t("pt-BR").common.system;
}

function uniqueTopNames(names: string[], limit = 5) {
  return Array.from(new Set(names)).slice(0, limit);
}

function getUserResultPrediction({
  groupPrediction,
  knockoutPrediction,
  match,
}: {
  groupPrediction: { goalsA: number; goalsB: number; points: number } | null;
  knockoutPrediction: KnockoutPredictionForResult | null;
  match: MatchForResult;
}): UserResultPrediction | null {
  if (!isKnockoutGroup(match.group)) return groupPrediction;
  if (!knockoutPrediction) return null;

  const score = getPredictionScoreInOfficialOrder(knockoutPrediction, match);
  return {
    goalsA: score?.goalsA ?? null,
    goalsB: score?.goalsB ?? null,
    points: calculateKnockoutPoints(knockoutPrediction, match),
  };
}

export default async function ResultadosPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");
  const locale = await getCurrentLocale();
  const copy = t(locale);

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) redirect("/");

  const now = new Date();
  const [matches, knockoutPredictions] = await Promise.all([
    prisma.match.findMany({
      where: {
        OR: [
          { resultGoalsA: { not: null }, resultGoalsB: { not: null } },
          { startsAt: { lte: now } },
        ],
      },
      include: {
        predictions: {
          select: {
            goalsA: true,
            goalsB: true,
            points: true,
            userId: true,
            user: { select: { nickname: true, name: true, email: true } },
          },
        },
      },
      orderBy: [{ startsAt: "asc" }, { group: "asc" }],
    }),
    prisma.knockoutPrediction.findMany({
      where: { poolScope: "global", userId: user.id },
      select: {
        awayGoals: true,
        awayTeam: true,
        bracketMatchId: true,
        bracketRound: true,
        homeGoals: true,
        homeTeam: true,
        winnerTeam: true,
      },
    }),
  ]);
  const knockoutPredictionByMatchId = new Map(knockoutPredictions.map((prediction) => [prediction.bracketMatchId, prediction]));
  const resolveUserPrediction = (match: typeof matches[number]) => {
    const groupPrediction = match.predictions.find((item) => item.userId === user.id) ?? null;
    const knockoutPrediction = bracketMatchIdFromGroup(match.group)
      ? knockoutPredictionByMatchId.get(bracketMatchIdFromGroup(match.group)!) ?? null
      : null;
    return getUserResultPrediction({ groupPrediction, knockoutPrediction, match });
  };

  const resolvedMatches = matches.filter((match) => match.resultGoalsA !== null && match.resultGoalsB !== null);
  const waitingMatches = matches.filter((match) => match.resultGoalsA === null || match.resultGoalsB === null);
  const userResolvedResults = resolvedMatches.flatMap((match) => {
    const prediction = resolveUserPrediction(match);
    return prediction ? [{ match, prediction }] : [];
  });
  const knockoutResolvedResults = userResolvedResults.filter(({ match }) => isKnockoutGroup(match.group));
  const totalPoints = userResolvedResults.reduce((sum, item) => sum + (item.prediction.points ?? 0), 0);
  const exactHits = userResolvedResults.filter(({ match, prediction }) =>
    prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB,
  ).length;
  const outcomeHits = userResolvedResults.filter(({ match, prediction }) =>
    (prediction.points ?? 0) > 0 && !(prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB),
  ).length;
  const predictionsCount = matches.filter((match) => Boolean(resolveUserPrediction(match))).length;
  const knockoutPoints = knockoutResolvedResults.reduce((sum, item) => sum + (item.prediction.points ?? 0), 0);
  const knockoutExactHits = knockoutResolvedResults.filter(({ match, prediction }) =>
    prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB,
  ).length;
  const knockoutOutcomeHits = knockoutResolvedResults.filter(({ match, prediction }) =>
    (prediction.points ?? 0) > 0 && !(prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB),
  ).length;
  const allResolvedPredictions = resolvedMatches.flatMap((match) => match.predictions);
  const averagePoints = userResolvedResults.length > 0
    ? (userResolvedResults.reduce((sum, item) => sum + (item.prediction.points ?? 0), 0) / userResolvedResults.length).toFixed(1)
    : "0.0";
  const exactScorers = uniqueTopNames(allResolvedPredictions.filter((prediction) => prediction.points === 5).map((prediction) => scorerName(prediction.user)));
  const outcomeScorers = uniqueTopNames(allResolvedPredictions.filter((prediction) => prediction.points === 3).map((prediction) => scorerName(prediction.user)));
  const hardestMatch = resolvedMatches.reduce<null | { label: string; hitRate: number; predictions: number }>((hardest, match) => {
    const predictions = match.predictions.length;
    if (predictions === 0) return hardest;

    const hits = match.predictions.filter((prediction) => prediction.points > 0).length;
    const hitRate = hits / predictions;
    const label = `${getTeamDisplayName(match.teamA, locale)} x ${getTeamDisplayName(match.teamB, locale)}`;

    if (!hardest || hitRate < hardest.hitRate || (hitRate === hardest.hitRate && predictions > hardest.predictions)) {
      return { label, hitRate, predictions };
    }

    return hardest;
  }, null);
  const resultItems: ResultItem[] = matches.map((match) => {
    const prediction = resolveUserPrediction(match);
    const resultA = match.resultGoalsA;
    const resultB = match.resultGoalsB;
    const hasOfficialResult = resultA !== null && resultB !== null;
    const explanation = explainPoints({
      locale,
      predictedA: prediction?.goalsA ?? null,
      predictedB: prediction?.goalsB ?? null,
      points: prediction?.points ?? null,
      resultA,
      resultB,
    });

    return {
      id: match.id,
      group: match.group,
      competitionPhase: isKnockoutGroup(match.group) ? "knockout" : "groups",
      decisionLabel: getDecisionLabel(match, locale),
      groupLabel: isKnockoutGroup(match.group) ? getKnockoutStageLabel(match.group, locale) : undefined,
      liveUrl: match.liveUrl,
      stageLabel: isKnockoutGroup(match.group) ? getKnockoutStageLabel(match.group, locale) : copy.simulator.groupStage,
      statsUrl: hasOfficialResult ? match.liveUrl ?? buildSofaScoreSearchUrl(match.teamA, match.teamB, match.startsAt) : null,
      teamA: match.teamA,
      teamB: match.teamB,
      startsAtLabel: match.startsAt ? dateFormatter.format(match.startsAt) : copy.common.noDate,
      venue: getMatchVenue(match.group, match.teamA, match.teamB),
      phase: getMatchPhase(match, locale, now),
      hasOfficialResult,
      resultA,
      resultB,
      predictionA: prediction?.goalsA ?? null,
      predictionB: prediction?.goalsB ?? null,
      points: prediction?.points ?? null,
      filter: getResultFilter(prediction, resultA, resultB),
      explanationLabel: explanation.label,
      explanationText: explanation.text,
      summary: buildMatchSummary({
        locale,
        prediction,
        resultA,
        resultB,
        teamA: getTeamDisplayName(match.teamA, locale),
        teamB: getTeamDisplayName(match.teamB, locale),
      }),
    };
  });

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="resultados"
        title={copy.results.title}
        description={copy.results.description}
      />

      {matches.length === 0 ? (
        <section className="card">
          <h2>{copy.results.emptyTitle}</h2>
          <p className="muted">{copy.results.emptyText}</p>
        </section>
      ) : (
        <ResultsExplorer
          items={resultItems}
          locale={locale}
          summary={{
            totalPoints,
            exactHits,
            outcomeHits,
            resolvedMatches: resolvedMatches.length,
            waitingMatches: waitingMatches.length,
            predictionsCount,
            averagePoints,
            exactScorers,
            outcomeScorers,
            hardestMatch: hardestMatch?.label ?? copy.results.noFinishedStats,
            hardestMatchHitRate: hardestMatch ? formatMessage(copy.results.hitRate, { rate: Math.round(hardestMatch.hitRate * 100) }) : copy.results.noFinishedStats,
            knockoutExactHits,
            knockoutOutcomeHits,
            knockoutPoints,
            knockoutResolvedMatches: knockoutResolvedResults.length,
          }}
        />
      )}
    </main>
  );
}
