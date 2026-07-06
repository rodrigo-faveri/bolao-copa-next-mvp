import { auth } from "../../auth";
import { clearKnockoutPredictions, deleteKnockoutPrediction, saveKnockoutPrediction, savePrediction } from "../bolao/actions";
import { CupHeader } from "../../components/CupHeader";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { getCurrentLocale } from "../../lib/i18n";
import { t } from "../../lib/i18n-shared";
import { isPredictionOpen } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";

export const dynamic = "force-dynamic";

export default async function SimuladorPage() {
  const session = await auth();
  const locale = await getCurrentLocale();
  const copy = t(locale);
  const canSave = Boolean(session?.user?.email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null;
  const predictions = user ? await prisma.prediction.findMany({ where: { userId: user.id } }) : [];
  const knockoutPredictions = user ? await prisma.knockoutPrediction.findMany({ where: { poolScope: "global", userId: user.id } }) : [];
  const predictionMap = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
  const knockoutWinnerMap = Object.fromEntries(knockoutPredictions.map((prediction) => [prediction.bracketMatchId, prediction.winnerTeam]));
  const knockoutScoreMap = Object.fromEntries(knockoutPredictions.map((prediction) => [
    prediction.bracketMatchId,
    {
      goalsA: prediction.homeGoals === null ? "" : String(prediction.homeGoals),
      goalsB: prediction.awayGoals === null ? "" : String(prediction.awayGoals),
    },
  ]));

  return (
    <main className="container bolaoPage">
      <CupHeader active="simulador" title={copy.simulatorPage.title} description={copy.simulatorPage.description} />

      {!session?.user && <div className="notice">{copy.simulatorPage.loginNotice}</div>}

      <WorldCupSimulator
        canSave={canSave}
        enableKnockout
        initialKnockoutScores={knockoutScoreMap}
        initialKnockoutWinners={knockoutWinnerMap}
        knockoutVariant="bracket"
        locale={locale}
        saveAction={savePrediction}
        clearKnockoutAction={clearKnockoutPredictions}
        deleteKnockoutAction={deleteKnockoutPrediction}
        saveKnockoutAction={saveKnockoutPrediction}
        matches={matches.map((match) => {
          const prediction = predictionMap.get(match.id);
          return {
            id: match.id,
            group: match.group,
            teamA: match.teamA,
            teamB: match.teamB,
            startsAt: match.startsAt?.toISOString() ?? null,
            status: match.status,
            venue: getMatchVenue(match.group, match.teamA, match.teamB),
            isOpen: isPredictionOpen(match.startsAt, new Date(), allowUnscheduledPredictions),
            goalsA: prediction?.goalsA ?? null,
            goalsB: prediction?.goalsB ?? null,
            resultGoalsA: match.resultGoalsA,
            resultGoalsB: match.resultGoalsB,
            resultMethod: match.resultMethod,
            penaltyGoalsA: match.penaltyGoalsA,
            penaltyGoalsB: match.penaltyGoalsB,
            winnerTeam: match.winnerTeam,
            points: prediction?.points ?? null,
          };
        })}
      />
    </main>
  );
}
