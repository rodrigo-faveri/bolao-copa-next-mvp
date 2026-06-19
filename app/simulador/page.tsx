import { auth } from "../../auth";
import { saveKnockoutPrediction, savePrediction } from "../bolao/actions";
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

  return (
    <main className="container bolaoPage">
      <CupHeader active="simulador" title={copy.simulatorPage.title} description={copy.simulatorPage.description} />

      {!session?.user && <div className="notice">{copy.simulatorPage.loginNotice}</div>}

      <WorldCupSimulator
        canSave={canSave}
        enableKnockout
        initialKnockoutWinners={knockoutWinnerMap}
        knockoutVariant="cards"
        locale={locale}
        saveAction={savePrediction}
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
            points: prediction?.points ?? null,
          };
        })}
      />
    </main>
  );
}
