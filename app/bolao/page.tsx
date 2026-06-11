import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { PredictionDeadlineAlerts } from "../../components/PredictionDeadlineAlerts";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { isPredictionOpen, PREDICTION_CLOSE_MINUTES } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";
import { savePrediction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BolaoPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const params = await searchParams;
  const poolInviteCode = typeof params?.bolao === "string" ? params.bolao.toUpperCase() : null;
  let selectedPool: { name: string; inviteCode: string } | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: { pool: { select: { name: true, inviteCode: true } } },
    });

    if (!membership) redirect("/boloes");
    selectedPool = membership.pool;
  }

  const canSave = Boolean(email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
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

      {selectedPool && (
        <section className="poolContextBanner">
          <div>
            <span className="badge badgeGold">Bolao privado</span>
            <h2>{selectedPool.name}</h2>
            <p className="muted">Seus palpites continuam pessoais; este contexto ajuda a acompanhar a disputa do grupo.</p>
          </div>
          <div className="poolContextActions">
            <Link className="buttonLink" href={`/ranking?bolao=${selectedPool.inviteCode}`}>Ranking do bolao</Link>
            <Link className="buttonLink buttonSecondary" href={`/boloes/${selectedPool.inviteCode}`}>Detalhes</Link>
          </div>
        </section>
      )}

      {matches.length === 0 && <div className="notice">Nenhuma partida foi importada.</div>}

      {matches.length > 0 && (
        <PredictionDeadlineAlerts
          matches={matches.map((match) => ({
            id: match.id,
            teamA: match.teamA,
            teamB: match.teamB,
            startsAt: match.startsAt,
            hasPrediction: predictionMap.has(match.id),
          }))}
        />
      )}

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
