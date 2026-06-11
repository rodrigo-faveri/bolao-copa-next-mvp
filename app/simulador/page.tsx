import { auth } from "../../auth";
import { savePrediction } from "../bolao/actions";
import { CupHeader } from "../../components/CupHeader";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { isPredictionOpen } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";

export const dynamic = "force-dynamic";

export default async function SimuladorPage() {
  const session = await auth();
  const canSave = Boolean(session?.user?.email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null;
  const predictions = user ? await prisma.prediction.findMany({ where: { userId: user.id } }) : [];
  const predictionMap = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));

  return (
    <main className="container bolaoPage">
      <CupHeader active="simulador" title="Simulador da Copa" description="Preencha a fase de grupos, veja a classificação mudar e avance os vencedores no mata-mata." />

      {!session?.user && <div className="notice">Faça login para salvar seus palpites no simulador.</div>}

      <WorldCupSimulator
        canSave={canSave}
        enableKnockout
        knockoutVariant="cards"
        saveAction={savePrediction}
        matches={matches.map((match) => {
          const prediction = predictionMap.get(match.id);
          return {
            id: match.id,
            group: match.group,
            teamA: match.teamA,
            teamB: match.teamB,
            startsAt: match.startsAt?.toISOString() ?? null,
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
