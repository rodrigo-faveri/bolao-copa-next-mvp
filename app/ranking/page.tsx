import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { RankingDetails, type RankingHit, type RankingRow } from "../../components/RankingDetails";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { prisma } from "../../lib/prisma";

export const dynamic = "force-dynamic";

const groupStageCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

type RankingUser = {
  id: string;
  name: string | null;
  nickname: string | null;
  knockoutPredictions: Array<{
    awayGoals: number | null;
    awayTeam: string | null;
    bracketMatchId: string;
    bracketRound: string;
    homeGoals: number | null;
    homeTeam: string | null;
    winnerTeam: string;
  }>;
  predictions: Array<{
    goalsA: number;
    goalsB: number;
    points: number;
    updatedAt: Date;
    match: {
      id: string;
      teamA: string;
      teamB: string;
      group: string;
      resultGoalsA: number | null;
      resultGoalsB: number | null;
    };
  }>;
};

type FinishedKnockoutMatch = {
  id: string;
  group: string;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  teamA: string;
  teamB: string;
  winnerTeam: string | null;
};

type PoolRules = {
  exactScorePoints: number;
  groupStageExactScorePoints: number;
  groupStageOutcomePoints: number;
  knockoutExactScorePoints: number;
  knockoutOutcomePoints: number;
  outcomePoints: number;
};

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function calculateRankingPoints(
  prediction: { goalsA: number; goalsB: number },
  result: { goalsA: number; goalsB: number; phase: "groups" | "knockout" },
  rules: PoolRules | null,
) {
  const exactScorePoints = result.phase === "knockout"
    ? rules?.knockoutExactScorePoints ?? rules?.exactScorePoints ?? 5
    : rules?.groupStageExactScorePoints ?? rules?.exactScorePoints ?? 5;
  const outcomePoints = result.phase === "knockout"
    ? rules?.knockoutOutcomePoints ?? rules?.outcomePoints ?? 3
    : rules?.groupStageOutcomePoints ?? rules?.outcomePoints ?? 3;

  if (prediction.goalsA === result.goalsA && prediction.goalsB === result.goalsB) {
    return exactScorePoints;
  }

  if (getOutcome(prediction.goalsA, prediction.goalsB) === getOutcome(result.goalsA, result.goalsB)) {
    return outcomePoints;
  }

  return 0;
}

function getMatchCompetitionPhase(match: { group: string }) {
  return /^[A-L]$/.test(match.group) ? "groups" as const : "knockout" as const;
}

function normalizeTeamName(team: string | null | undefined) {
  return (team ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findFinishedKnockoutMatch(
  prediction: RankingUser["knockoutPredictions"][number],
  finishedMatches: FinishedKnockoutMatch[],
) {
  const homeTeam = normalizeTeamName(prediction.homeTeam);
  const awayTeam = normalizeTeamName(prediction.awayTeam);
  if (!homeTeam || !awayTeam) return null;

  return finishedMatches.find((match) => {
    const teamA = normalizeTeamName(match.teamA);
    const teamB = normalizeTeamName(match.teamB);
    return (teamA === homeTeam && teamB === awayTeam) || (teamA === awayTeam && teamB === homeTeam);
  }) ?? null;
}

function getMatchWinner(match: FinishedKnockoutMatch) {
  if (match.winnerTeam) return match.winnerTeam;
  if (match.resultGoalsA === null || match.resultGoalsB === null || match.resultGoalsA === match.resultGoalsB) return null;
  return match.resultGoalsA > match.resultGoalsB ? match.teamA : match.teamB;
}

function getKnockoutPredictionScoreInOfficialOrder(
  prediction: RankingUser["knockoutPredictions"][number],
  officialMatch: FinishedKnockoutMatch,
) {
  if (prediction.homeGoals === null || prediction.awayGoals === null) return null;

  const predictionHome = normalizeTeamName(prediction.homeTeam);
  const predictionAway = normalizeTeamName(prediction.awayTeam);
  const officialTeamA = normalizeTeamName(officialMatch.teamA);
  const officialTeamB = normalizeTeamName(officialMatch.teamB);

  if (predictionHome === officialTeamA && predictionAway === officialTeamB) {
    return { goalsA: prediction.homeGoals, goalsB: prediction.awayGoals };
  }

  if (predictionHome === officialTeamB && predictionAway === officialTeamA) {
    return { goalsA: prediction.awayGoals, goalsB: prediction.homeGoals };
  }

  return null;
}

function calculateKnockoutPredictionPoints(
  prediction: RankingUser["knockoutPredictions"][number],
  officialMatch: FinishedKnockoutMatch,
  rules: PoolRules | null,
) {
  if (officialMatch.resultGoalsA === null || officialMatch.resultGoalsB === null) return 0;

  const predictionScore = getKnockoutPredictionScoreInOfficialOrder(prediction, officialMatch);
  if (predictionScore) {
    return calculateRankingPoints(
      predictionScore,
      { goalsA: officialMatch.resultGoalsA, goalsB: officialMatch.resultGoalsB, phase: "knockout" },
      rules,
    );
  }

  const winner = getMatchWinner(officialMatch);
  if (!winner) return 0;
  return normalizeTeamName(prediction.winnerTeam) === normalizeTeamName(winner)
    ? rules?.knockoutOutcomePoints ?? rules?.outcomePoints ?? 3
    : 0;
}

function getKnockoutHitKind(
  prediction: RankingUser["knockoutPredictions"][number],
  officialMatch: FinishedKnockoutMatch,
) {
  if (officialMatch.resultGoalsA === null || officialMatch.resultGoalsB === null) return "outcome" as const;
  const predictionScore = getKnockoutPredictionScoreInOfficialOrder(prediction, officialMatch);
  if (
    predictionScore
    && predictionScore.goalsA === officialMatch.resultGoalsA
    && predictionScore.goalsB === officialMatch.resultGoalsB
  ) {
    return "exact" as const;
  }

  return "outcome" as const;
}

function formatUserName(user: { id: string; name: string | null; nickname: string | null }) {
  return user.nickname?.trim() || user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

function buildRankingRows(users: RankingUser[], finishedKnockoutMatches: FinishedKnockoutMatch[], rules: PoolRules | null = null) {
  return users
    .map((user) => {
      const hits: RankingHit[] = [];
      let exactHits = 0;
      let outcomeHits = 0;
      let resolvedPredictions = 0;
      let points = 0;

      for (const prediction of user.predictions) {
        const { match } = prediction;
        if (match.resultGoalsA === null || match.resultGoalsB === null) continue;
        resolvedPredictions += 1;
        const predictionPoints = calculateRankingPoints(
          { goalsA: prediction.goalsA, goalsB: prediction.goalsB },
          { goalsA: match.resultGoalsA, goalsB: match.resultGoalsB, phase: getMatchCompetitionPhase(match) },
          rules,
        );
        points += predictionPoints;
        if (predictionPoints <= 0) continue;

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
          points: predictionPoints,
          kind: isExact ? "exact" : "outcome",
        });
      }

      for (const prediction of user.knockoutPredictions) {
        const officialMatch = findFinishedKnockoutMatch(prediction, finishedKnockoutMatches);
        if (!officialMatch) continue;
        resolvedPredictions += 1;

        const predictionPoints = calculateKnockoutPredictionPoints(prediction, officialMatch, rules);
        points += predictionPoints;
        if (predictionPoints <= 0) continue;

        const kind = getKnockoutHitKind(prediction, officialMatch);
        if (kind === "exact") exactHits += 1;
        else outcomeHits += 1;

        hits.push({
          kind,
          matchId: prediction.bracketMatchId,
          points: predictionPoints,
          prediction: prediction.homeGoals !== null && prediction.awayGoals !== null
            ? `${prediction.homeGoals} x ${prediction.awayGoals}`
            : prediction.winnerTeam,
          result: `${officialMatch.resultGoalsA} x ${officialMatch.resultGoalsB}`,
          teamA: officialMatch.teamA,
          teamB: officialMatch.teamB,
        });
      }

      const scoringHits = exactHits + outcomeHits;

      return {
        userId: user.id,
        name: formatUserName(user),
        position: 0,
        points,
        predictions: user.predictions.length + user.knockoutPredictions.length,
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

function buildKnockoutRankingRows(users: RankingUser[], finishedMatches: FinishedKnockoutMatch[], rules: PoolRules | null = null) {
  return users
    .map((user) => {
      const hits: RankingHit[] = [];
      let resolvedPredictions = 0;
      let exactHits = 0;
      let outcomeHits = 0;
      let points = 0;

      for (const prediction of user.knockoutPredictions) {
        const officialMatch = findFinishedKnockoutMatch(prediction, finishedMatches);
        if (!officialMatch) continue;

        resolvedPredictions += 1;
        const predictionPoints = calculateKnockoutPredictionPoints(prediction, officialMatch, rules);
        points += predictionPoints;
        if (predictionPoints <= 0) continue;

        const kind = getKnockoutHitKind(prediction, officialMatch);
        if (kind === "exact") exactHits += 1;
        else outcomeHits += 1;
        hits.push({
          kind,
          matchId: prediction.bracketMatchId,
          points: predictionPoints,
          prediction: prediction.homeGoals !== null && prediction.awayGoals !== null
            ? `${prediction.homeGoals} x ${prediction.awayGoals}`
            : prediction.winnerTeam,
          result: `${officialMatch.resultGoalsA} x ${officialMatch.resultGoalsB}`,
          teamA: officialMatch.teamA,
          teamB: officialMatch.teamB,
        });
      }

      return {
        accuracy: resolvedPredictions > 0 ? Math.round(((exactHits + outcomeHits) / resolvedPredictions) * 100) : 0,
        exactHits,
        hits,
        name: formatUserName(user),
        outcomeHits,
        points,
        position: 0,
        predictions: user.knockoutPredictions.length,
        userId: user.id,
      };
    })
    .filter((row) => row.predictions > 0 || row.points > 0)
    .sort((a, b) =>
      b.points - a.points
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
  let poolId: string | null = null;
  let poolRules: PoolRules | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: {
        pool: {
          select: {
            exactScorePoints: true,
            groupStageExactScorePoints: true,
            groupStageOutcomePoints: true,
            knockoutExactScorePoints: true,
            knockoutOutcomePoints: true,
            id: true,
            name: true,
            outcomePoints: true,
          },
        },
      },
    });

    if (!membership) redirect("/boloes");
    poolId = membership.pool.id;
    poolName = membership.pool.name;
    poolRules = {
      exactScorePoints: membership.pool.exactScorePoints,
      groupStageExactScorePoints: membership.pool.groupStageExactScorePoints,
      groupStageOutcomePoints: membership.pool.groupStageOutcomePoints,
      knockoutExactScorePoints: membership.pool.knockoutExactScorePoints,
      knockoutOutcomePoints: membership.pool.knockoutOutcomePoints,
      outcomePoints: membership.pool.outcomePoints,
    };
  }

  const users = await prisma.user.findMany({
    where: poolInviteCode ? { poolMemberships: { some: { pool: { inviteCode: poolInviteCode } } } } : undefined,
    include: {
      knockoutPredictions: {
        where: { poolScope: poolId ?? "global" },
        orderBy: [{ bracketRound: "asc" }, { updatedAt: "desc" }],
      },
      predictions: {
        where: { match: { group: { in: groupStageCodes } } },
        include: { match: true },
        orderBy: [{ points: "desc" }, { updatedAt: "desc" }],
      },
    },
  });
  const finishedKnockoutMatches = await prisma.match.findMany({
    where: {
      group: { notIn: groupStageCodes },
      resultGoalsA: { not: null },
      resultGoalsB: { not: null },
    },
    select: {
      group: true,
      id: true,
      resultGoalsA: true,
      resultGoalsB: true,
      teamA: true,
      teamB: true,
      winnerTeam: true,
    },
  });

  const rankingRows: RankingRow[] = buildRankingRows(users, finishedKnockoutMatches, poolRules);
  const knockoutRankingRows: RankingRow[] = buildKnockoutRankingRows(users, finishedKnockoutMatches, poolRules);
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

      <div className="rankingCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">{copy.ranking.knockoutClassification}</span>
            <h2>{copy.ranking.knockoutParticipants}</h2>
          </div>
          <span className="muted">{formatMessage(copy.ranking.playersCount, { count: knockoutRankingRows.length })}</span>
        </div>

        {knockoutRankingRows.length > 0 ? (
          <RankingDetails locale={locale} rows={knockoutRankingRows} />
        ) : (
          <p className="emptyRanking muted">{copy.ranking.empty}</p>
        )}

        <div className="rankingRules">
          <strong>{copy.ranking.tiebreaker}</strong> {copy.ranking.knockoutDescription}
        </div>
      </div>
    </main>
  );
}
