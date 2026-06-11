import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { isPredictionOpen, PREDICTION_CLOSE_MINUTES } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";
import { savePrediction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BolaoPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const canSave = Boolean(session?.user?.email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const user = session?.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null;
  const predictions = user ? await prisma.prediction.findMany({ where: { userId: user.id } }) : [];
  const predictionMap = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));

  return (
    <main className="container bolaoPage">
      <CupHeader active="bolao" title="Meus palpites" description="Escolha os placares rodada por rodada e acompanhe sua disputa com os amigos." />

      {allowUnscheduledPredictions && (
        <div className="notice noticeCompact noticeInline"><strong>Modo local</strong><span>Partidas sem horário definido ficam abertas para teste.</span></div>
      )}

      {!session?.user && <div className="notice">Faça login para salvar seus palpites.</div>}

      <section className="pageToolbar">
        <div><span className="badge badgeGold">Bolão Copa 2026</span><h2>Palpites por etapa</h2></div>
        <div className="toolbarTips"><span>Use as abas para alternar etapas</span><span>Fecha {PREDICTION_CLOSE_MINUTES} min antes</span></div>
      </section>

      {matches.length === 0 && <div className="notice">Nenhuma partida foi importada.</div>}

      <WorldCupSimulator
        canSave={canSave}
        enableKnockout
        knockoutVariant="cards"
        saveAction={savePrediction}
        showStandings={false}
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
