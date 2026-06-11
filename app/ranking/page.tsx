import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { RankingDetails, type RankingHit, type RankingRow } from "../../components/RankingDetails";
import { prisma } from "../../lib/prisma";

export const dynamic = "force-dynamic";

type RankingUser = {
  id: string;
  name: string | null;
  nickname: string | null;
  predictions: Array<{
    goalsA: number;
    goalsB: number;
    points: number;
    updatedAt: Date;
    match: {
      id: string;
      teamA: string;
      teamB: string;
      resultGoalsA: number | null;
      resultGoalsB: number | null;
    };
  }>;
};

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function formatUserName(user: { id: string; name: string | null; nickname: string | null }) {
  return user.nickname?.trim() || user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

function buildRankingRows(users: RankingUser[]) {
  return users
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
}

export default async function RankingPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const params = await searchParams;
  const poolInviteCode = typeof params?.bolao === "string" ? params.bolao.toUpperCase() : null;
  let poolName: string | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: { pool: { select: { name: true } } },
    });

    if (!membership) redirect("/boloes");
    poolName = membership.pool.name;
  }

  const users = await prisma.user.findMany({
    where: poolInviteCode ? { poolMemberships: { some: { pool: { inviteCode: poolInviteCode } } } } : undefined,
    include: {
      predictions: {
        include: { match: true },
        orderBy: [{ points: "desc" }, { updatedAt: "desc" }],
      },
    },
  });

  const rankingRows: RankingRow[] = buildRankingRows(users);
  const podium = rankingRows.slice(0, 3);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="ranking"
        title={poolName ? `Ranking: ${poolName}` : "Ranking"}
        description={poolName ? "Acompanhe a disputa apenas entre participantes deste bolao privado." : "Acompanhe quem esta mandando melhor nos palpites da Copa."}
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
            <span className="badge badgeGold">Classificacao</span>
            <h2>{poolName ? "Participantes do bolao" : "Participantes"}</h2>
          </div>
          <span className="muted">{rankingRows.length} jogador(es)</span>
        </div>

        {rankingRows.length > 0 ? (
          <RankingDetails rows={rankingRows} />
        ) : (
          <p className="emptyRanking muted">O ranking aparecera apos o primeiro palpite.</p>
        )}

        <div className="rankingRules">
          <strong>Desempate:</strong> pontos, placares exatos, resultados corretos, palpites enviados e nome.
        </div>
      </div>
    </main>
  );
}
