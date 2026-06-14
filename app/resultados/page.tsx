import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { ResultsExplorer, type ResultFilter, type ResultItem } from "../../components/ResultsExplorer";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t, type AppLocale } from "../../lib/i18n-shared";
import { calculatePredictionPoints } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getTeamDisplayName } from "../../lib/teams";
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

function explainPoints({
  locale,
  predictedA,
  predictedB,
  resultA,
  resultB,
}: {
  locale: AppLocale;
  predictedA: number | null;
  predictedB: number | null;
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
    return {
      label: copy.results.noPrediction,
      text: copy.results.noPredictionText,
    };
  }

  const points = calculatePredictionPoints(predictedA, predictedB, resultA, resultB);
  if (points === 5) {
    return {
      label: copy.results.exact,
      text: copy.results.exactText,
    };
  }

  if (points === 3 && getOutcome(predictedA, predictedB) === getOutcome(resultA, resultB)) {
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
  prediction: { goalsA: number; goalsB: number; points: number } | null;
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

  if (prediction.points === 3) {
    return formatMessage(copy.results.autoSummaryOutcome, values);
  }

  return formatMessage(copy.results.autoSummaryMiss, values);
}

function getResultFilter(prediction: { goalsA: number; goalsB: number; points: number } | null, resultA: number | null, resultB: number | null): ResultFilter {
  if (resultA === null || resultB === null) return "pending";
  if (!prediction) return "noPrediction";
  if (prediction.points === 5) return "exact";
  if (prediction.points === 3) return "outcome";
  return "miss";
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
  const matches = await prisma.match.findMany({
    where: {
      OR: [
        { resultGoalsA: { not: null }, resultGoalsB: { not: null } },
        { startsAt: { lte: now } },
      ],
    },
    include: {
      predictions: {
        where: { userId: user.id },
        select: { goalsA: true, goalsB: true, points: true },
        take: 1,
      },
    },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
  });

  const resolvedMatches = matches.filter((match) => match.resultGoalsA !== null && match.resultGoalsB !== null);
  const waitingMatches = matches.filter((match) => match.resultGoalsA === null || match.resultGoalsB === null);
  const totalPoints = resolvedMatches.reduce((sum, match) => sum + (match.predictions[0]?.points ?? 0), 0);
  const exactHits = resolvedMatches.filter((match) => {
    const prediction = match.predictions[0];
    return prediction && prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB;
  }).length;
  const outcomeHits = resolvedMatches.filter((match) => match.predictions[0]?.points === 3).length;
  const predictionsCount = matches.filter((match) => Boolean(match.predictions[0])).length;
  const resultItems: ResultItem[] = matches.map((match) => {
    const prediction = match.predictions[0] ?? null;
    const resultA = match.resultGoalsA;
    const resultB = match.resultGoalsB;
    const hasOfficialResult = resultA !== null && resultB !== null;
    const explanation = explainPoints({
      locale,
      predictedA: prediction?.goalsA ?? null,
      predictedB: prediction?.goalsB ?? null,
      resultA,
      resultB,
    });

    return {
      id: match.id,
      group: match.group,
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
          }}
        />
      )}
    </main>
  );
}
