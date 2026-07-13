import type { Prisma, PrismaClient } from "@prisma/client";

const provider = "serpapi";

type SyncAttemptLike = {
  createdAt: Date;
  reason: string | null;
  sourceStatus: string | null;
  status: string;
};

type MatchWithAttempts = {
  group: string;
  id: string;
  startsAt: Date | null;
  teamA: string;
  teamB: string;
  resultSyncAttempts: SyncAttemptLike[];
};

export type ResultSyncQueueStatus = "due" | "stale" | "waiting";

export type ResultSyncQueueItem = {
  attemptCount: number;
  elapsedMinutes: number;
  lastAttemptAt: Date | null;
  lastReason: string | null;
  match: MatchWithAttempts;
  nextAttemptAt: Date | null;
  status: ResultSyncQueueStatus;
};

function readPositiveInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRetrySchedule() {
  const raw = process.env.RESULT_SYNC_RETRY_MINUTES;
  const firstAttemptMinutes = readPositiveInt("SERPAPI_RESULT_DELAY_MINUTES", 120);
  const defaultRetryMinutes = [
    firstAttemptMinutes,
    firstAttemptMinutes + 60,
    firstAttemptMinutes + 180,
    firstAttemptMinutes + 360,
  ];
  if (!raw) return defaultRetryMinutes;

  const parsed = raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);

  return parsed.length > 0 ? Array.from(new Set(parsed)) : defaultRetryMinutes;
}

function maxDate(...dates: Date[]) {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

export function buildResultSyncQueue(matches: MatchWithAttempts[], now = new Date()): ResultSyncQueueItem[] {
  const retrySchedule = readRetrySchedule();
  const staleRetryMinutes = readPositiveInt("RESULT_SYNC_STALE_RETRY_MINUTES", 360);
  const minRetrySpacingMinutes = readPositiveInt("RESULT_SYNC_MIN_RETRY_SPACING_MINUTES", 45);

  return matches
    .filter((match) => match.startsAt && match.startsAt <= now)
    .map((match) => {
      const startsAt = match.startsAt as Date;
      const attempts = [...match.resultSyncAttempts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const attemptCount = attempts.length;
      const lastAttempt = attempts[0] ?? null;
      const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startsAt.getTime()) / 60000));
      const lastAttemptAt = lastAttempt?.createdAt ?? null;
      const lastReason = lastAttempt?.reason ?? lastAttempt?.sourceStatus ?? null;

      if (attemptCount >= retrySchedule.length) {
        const nextAttemptAt = lastAttemptAt
          ? new Date(lastAttemptAt.getTime() + staleRetryMinutes * 60 * 1000)
          : new Date(startsAt.getTime() + retrySchedule[retrySchedule.length - 1] * 60 * 1000);

        return {
          attemptCount,
          elapsedMinutes,
          lastAttemptAt,
          lastReason,
          match,
          nextAttemptAt,
          status: now >= nextAttemptAt ? "stale" as const : "waiting" as const,
        };
      }

      const scheduledFromKickoff = new Date(startsAt.getTime() + retrySchedule[attemptCount] * 60 * 1000);
      const scheduledFromLastAttempt = lastAttemptAt
        ? new Date(lastAttemptAt.getTime() + minRetrySpacingMinutes * 60 * 1000)
        : scheduledFromKickoff;
      const nextAttemptAt = maxDate(scheduledFromKickoff, scheduledFromLastAttempt);

      return {
        attemptCount,
        elapsedMinutes,
        lastAttemptAt,
        lastReason,
        match,
        nextAttemptAt,
        status: now >= nextAttemptAt ? "due" as const : "waiting" as const,
      };
    })
    .sort((a, b) => {
      const statusWeight = { stale: 0, due: 1, waiting: 2 };
      const statusDiff = statusWeight[a.status] - statusWeight[b.status];
      if (statusDiff !== 0) return statusDiff;
      return (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0);
    });
}

export async function getPendingResultSyncQueue(prisma: PrismaClient, now = new Date()) {
  const matches = await prisma.match.findMany({
    include: {
      resultSyncAttempts: {
        orderBy: { createdAt: "desc" },
        take: 10,
        where: { provider },
      },
    },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
    where: {
      resultGoalsA: null,
      resultGoalsB: null,
      startsAt: { lte: now },
    },
  });

  return buildResultSyncQueue(matches, now);
}

export async function recordResultSyncAttempt(
  prisma: PrismaClient | Prisma.TransactionClient,
  data: {
    matchId: string;
    metadata?: Prisma.InputJsonValue;
    reason?: string | null;
    runId?: string | null;
    sourceStatus?: string | null;
    status: "imported" | "skipped" | "failed";
  },
) {
  await prisma.resultSyncAttempt.create({
    data: {
      matchId: data.matchId,
      metadata: data.metadata ?? undefined,
      provider,
      reason: data.reason ?? null,
      runId: data.runId ?? null,
      sourceStatus: data.sourceStatus ?? null,
      status: data.status,
    },
  });
}
