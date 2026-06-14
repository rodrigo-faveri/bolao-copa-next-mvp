import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { RankingDetails, type RankingHit, type RankingRow } from "../../components/RankingDetails";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
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

type PoolRules = {
  exactScorePoints: number;
  outcomePoints: number;
};

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function calculateRankingPoints(
  prediction: { goalsA: number; goalsB: number },
  result: { goalsA: number; goalsB: number },
  rules: PoolRules | null,
) {
  if (prediction.goalsA === result.goalsA && prediction.goalsB === result.goalsB) {
    return rules?.exactScorePoints ?? 5;
  }

  if (getOutcome(prediction.goalsA, prediction.goalsB) === getOutcome(result.goalsA, result.goalsB)) {
    return rules?.outcomePoints ?? 3;
  }

  return 0;
}

function formatUserName(user: { id: string; name: string | null; nickname: string | null }) {
  return user.nickname?.trim() || user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

function buildRankingRows(users: RankingUser[], rules: PoolRules | null = null) {
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
        const points = calculateRankingPoints(
          { goalsA: prediction.goalsA, goalsB: prediction.goalsB },
          { goalsA: match.resultGoalsA, goalsB: match.resultGoalsB },
          rules,
        );
        if (points <= 0) continue;

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
          points,
          kind: isExact ? "exact" : "outcome",
        });
      }

      const points = user.predictions.reduce((sum, prediction) => {
        const { match } = prediction;
        if (match.resultGoalsA === null || match.resultGoalsB === null) return sum;
        return sum + calculateRankingPoints(
          { goalsA: prediction.goalsA, goalsB: prediction.goalsB },
          { goalsA: match.resultGoalsA, goalsB: match.resultGoalsB },
          rules,
        );
      }, 0);
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

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const params = await searchParams;
  const poolInviteCode = typeof params?.bolao === "string" ? params.bolao.toUpperCase() : null;
  let poolName: string | null = null;
  let poolRules: PoolRules | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: { pool: { select: { name: true, exactScorePoints: true, outcomePoints: true } } },
    });

    if (!membership) redirect("/boloes");
    poolName = membership.pool.name;
    poolRules = {
      exactScorePoints: membership.pool.exactScorePoints,
      outcomePoints: membership.pool.outcomePoints,
    };
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

  const rankingRows: RankingRow[] = buildRankingRows(users, poolRules);
  const podium = rankingRows.slice(0, 3);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="ranking"
        title={poolName ? formatMessage(copy.ranking.poolTitle, { pool: poolName }) : copy.ranking.title}
        description={poolName ? copy.ranking.poolDescription : copy.ranking.description}
      />

      {podium.length > 0 && (
        <section className="podiumGrid">
          {podium.map((row) => (
            <article className={`podiumCard podiumCard${row.position}`} key={row.userId}>
              <span className="podiumPosition">{formatMessage(copy.ranking.place, { position: row.position })}</span>
              <h2>{row.name}</h2>
              <strong>{row.points} pts</strong>
              <p>{row.exactHits} {copy.ranking.exact} · {row.outcomeHits} {copy.ranking.outcomes} · {row.predictions} {copy.ranking.predictions}</p>
            </article>
          ))}
        </section>
      )}

      <div className="rankingCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">{copy.ranking.classification}</span>
            <h2>{poolName ? copy.ranking.poolParticipants : copy.ranking.participants}</h2>
          </div>
          <span className="muted">{formatMessage(copy.ranking.playersCount, { count: rankingRows.length })}</span>
        </div>

        {rankingRows.length > 0 ? (
          <RankingDetails locale={locale} rows={rankingRows} />
        ) : (
          <p className="emptyRanking muted">{copy.ranking.empty}</p>
        )}

        <div className="rankingRules">
          <strong>{copy.ranking.tiebreaker}</strong> {copy.ranking.tiebreakerText}
        </div>
      </div>
    </main>
  );
}
