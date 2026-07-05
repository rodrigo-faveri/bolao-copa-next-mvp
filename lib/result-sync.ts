import type { PrismaClient } from "@prisma/client";
import { createAuditLog } from "./audit";
import { materializeKnockoutMatches } from "./knockout-materialization";
import { logger } from "./logger";
import { setMatchResult } from "./results";
import { reconcileSerpApiCalendar } from "./serpapi-calendar";
import { fetchSerpApiMatchDebug, fetchSerpApiMatchResult } from "./serpapi-results";

export type ResultSyncSummary = {
  candidates: number;
  imported: number;
  skipped: number;
  runId: string;
};

export function readPositiveInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function syncPendingSerpApiResults({
  debug = false,
  delayMinutes = readPositiveInt("SERPAPI_RESULT_DELAY_MINUTES", 120),
  dryRun = false,
  maxMatches = readPositiveInt("SERPAPI_RESULT_MAX_MATCHES", 12),
  prisma,
  triggeredBy,
}: {
  debug?: boolean;
  delayMinutes?: number;
  dryRun?: boolean;
  maxMatches?: number;
  prisma: PrismaClient;
  triggeredBy?: string | null;
}): Promise<ResultSyncSummary> {
  const syncRun = await prisma.resultSyncRun.create({
    data: {
      provider: "serpapi",
      status: "running",
    },
  });

  if (!process.env.SERPAPI_KEY) {
    const errorMessage = "SERPAPI_KEY nao configurada.";
    await prisma.resultSyncRun.update({
      where: { id: syncRun.id },
      data: {
        errorMessage,
        finishedAt: new Date(),
        status: "failed",
      },
    });
    throw new Error(errorMessage);
  }

  const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000);
  const materializedKnockoutMatches = dryRun ? 0 : await materializeKnockoutMatches(prisma);
  if (materializedKnockoutMatches > 0) {
    logger.info("knockout_matches_materialized", { count: materializedKnockoutMatches });
  }
  const calendarReconciliation = dryRun ? { checked: 0, updated: 0 } : await reconcileSerpApiCalendar({ prisma });
  if (calendarReconciliation.checked > 0) {
    logger.info("serpapi_calendar_reconciled", calendarReconciliation);
  }

  const matches = await prisma.match.findMany({
    where: {
      startsAt: { lte: cutoff },
      resultGoalsA: null,
      resultGoalsB: null,
    },
    orderBy: { startsAt: "asc" },
    take: maxMatches,
  });

  let imported = 0;
  let skipped = 0;

  try {
    for (const match of matches) {
      try {
        const result = await fetchSerpApiMatchResult({
          startsAt: match.startsAt,
          teamA: match.teamA,
          teamB: match.teamB,
        });

        if (!result) {
          skipped += 1;
          console.info(`Sem resultado final confiavel: ${match.teamA} x ${match.teamB}`);
          if (debug) {
            const debugResult = await fetchSerpApiMatchDebug({
              startsAt: match.startsAt,
              teamA: match.teamA,
              teamB: match.teamB,
            });
            console.info(JSON.stringify(debugResult, null, 2));
          }
          continue;
        }

        if (dryRun) {
          console.info(`[dry-run] ${match.teamA} ${result.goalsA} x ${result.goalsB} ${match.teamB}`);
          imported += 1;
          continue;
        }

        const update = await prisma.$transaction(async (transaction) => {
          const saved = await setMatchResult(transaction, {
            allowFutureResult: true,
            matchId: match.id,
            goalsA: result.goalsA,
            goalsB: result.goalsB,
            winnerTeam: result.winnerTeam,
          });

          await createAuditLog(transaction, {
            actorEmail: triggeredBy ?? null,
            action: triggeredBy ? "admin_serpapi_sync_imported" : "serpapi_result_imported",
            entity: "match",
            entityId: match.id,
            metadata: {
              goalsA: result.goalsA,
              goalsB: result.goalsB,
              winnerTeam: result.winnerTeam,
              query: result.query,
              sourceStatus: result.sourceStatus,
            },
          });

          for (const event of result.events) {
            await transaction.matchEvent.create({
              data: {
                description: event.description,
                matchId: match.id,
                minute: event.minute,
                title: event.title,
              },
            });
          }

          return saved;
        });

        imported += 1;
        logger.info("serpapi_result_imported", {
          goalsA: result.goalsA,
          goalsB: result.goalsB,
          matchId: match.id,
          predictionsUpdated: update.predictionsUpdated,
          triggeredBy: triggeredBy ? "admin" : "job",
        });
        console.info(`${match.teamA} ${result.goalsA} x ${result.goalsB} ${match.teamB} importado.`);
      } catch (error) {
        skipped += 1;
        logger.warn("serpapi_result_import_failed", {
          matchId: match.id,
          message: error instanceof Error ? error.message : "unknown",
        });
        console.warn(`Falha ao importar ${match.teamA} x ${match.teamB}.`);
      }
    }

    await prisma.resultSyncRun.update({
      where: { id: syncRun.id },
      data: {
        candidates: matches.length,
        finishedAt: new Date(),
        imported,
        skipped,
        status: "success",
      },
    });

    if (!dryRun && imported > 0) {
      const materializedAfterImport = await materializeKnockoutMatches(prisma);
      if (materializedAfterImport > 0) {
        logger.info("knockout_matches_materialized_after_result_sync", { count: materializedAfterImport });
      }
    }

    return {
      candidates: matches.length,
      imported,
      runId: syncRun.id,
      skipped,
    };
  } catch (error) {
    await prisma.resultSyncRun.update({
      where: { id: syncRun.id },
      data: {
        candidates: matches.length,
        errorMessage: error instanceof Error ? error.message : "unknown",
        finishedAt: new Date(),
        imported,
        skipped,
        status: "failed",
      },
    });
    throw error;
  }
}
