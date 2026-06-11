import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { RankingDetails, type RankingHit, type RankingRow } from "../../components/RankingDetails";
import { prisma } from "../../lib/prisma";

export const dynamic = "force-dynamic";

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function formatUserName(user: { id: string; name: string | null }) {
  return user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

export default async function RankingPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const users = await prisma.user.findMany({
    include: {
      predictions: {
        include: { match: true },
        orderBy: [{ points: "desc" }, { updatedAt: "desc" }],
      },
    },
  });

  const rankingRows: RankingRow[] = users
    .map((user) => {
      const hits: RankingHit[] = [];
      let exactHits = 0;
      let outcomeHits = 0;
      let resolvedPredictions = 0;

      for (const prediction of user.predictions) {
        const { match } = prediction;
        if (match.resultGoalsA === null || match.resultGoalsB === null) continue;
        resolvedPredictions += 1;
        if (prediction.points <= 0) continue;

        const isExact = prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB;
        const isOutcome = getOutcome(prediction.goalsA, prediction.goalsB) === getOutcome(match.resultGoalsA, match.resultGoalsB);
        if (isExact) exactHits += 1;
        else if (isOutcome) outcomeHits += 1;

        hits.push({
          matchId: match.id,
          teamA: match.teamA,
          teamB: match.teamB,
          prediction: `${prediction.goalsA} x ${prediction.goalsB}`,
          result: `${match.resultGoalsA} x ${match.resultGoalsB}`,
          points: prediction.points,
          kind: isExact ? "exact" : "outcome",
        });
      }

      const points = user.predictions.reduce((sum, prediction) => sum + prediction.points, 0);
      const scoringHits = exactHits + outcomeHits;
      return {
        userId: user.id,
        name: formatUserName(user),
        position: 0,
        points,
        predictions: user.predictions.length,
        exactHits,
        outcomeHits,
        accuracy: resolvedPredictions > 0 ? Math.round((scoringHits / resolvedPredictions) * 100) : 0,
        hits,
      };
    })
    .sort((a, b) =>
      b.points - a.points
      || b.exactHits - a.exactHits
      || b.outcomeHits - a.outcomeHits
      || b.predictions - a.predictions
      || a.name.localeCompare(b.name),
    )
    .map((row, index) => ({ ...row, position: index + 1 }));

  const podium = rankingRows.slice(0, 3);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="ranking"
        title="Ranking"
        description="Acompanhe quem está mandando melhor nos palpites da Copa."
      />

      {podium.length > 0 && (
        <section className="podiumGrid">
          {podium.map((row) => (
            <article className={`podiumCard podiumCard${row.position}`} key={row.userId}>
              <span className="podiumPosition">{row.position}º lugar</span>
              <h2>{row.name}</h2>
              <strong>{row.points} pts</strong>
              <p>{row.exactHits} exatos · {row.outcomeHits} resultados · {row.predictions} palpites</p>
            </article>
          ))}
        </section>
      )}

      <div className="rankingCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">Classificação</span>
            <h2>Participantes</h2>
          </div>
          <span className="muted">{rankingRows.length} jogador(es)</span>
        </div>

        {rankingRows.length > 0 ? (
          <RankingDetails rows={rankingRows} />
        ) : (
          <p className="emptyRanking muted">O ranking aparecerá após o primeiro palpite.</p>
        )}

        <div className="rankingRules">
          <strong>Desempate:</strong> pontos, placares exatos, resultados corretos, palpites enviados e nome.
        </div>
      </div>
    </main>
  );
}
