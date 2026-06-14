import { PrismaClient } from "@prisma/client";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";
import { setMatchResult } from "../lib/results";
import { fetchSerpApiMatchDebug, fetchSerpApiMatchResult } from "../lib/serpapi-results";

const prisma = new PrismaClient();

function readPositiveInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  if (!process.env.SERPAPI_KEY) {
    console.info("SERPAPI_KEY nao configurada. Nada a sincronizar.");
    return;
  }

  const delayMinutes = readPositiveInt("SERPAPI_RESULT_DELAY_MINUTES", 130);
  const maxMatches = readPositiveInt("SERPAPI_RESULT_MAX_MATCHES", 12);
  const dryRun = hasFlag("--dry-run") || process.env.SERPAPI_DRY_RUN === "true";
  const debug = process.env.SERPAPI_DEBUG === "true";
  const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000);

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
        });

        await createAuditLog(transaction, {
          action: "serpapi_result_imported",
          entity: "match",
          entityId: match.id,
          metadata: {
            goalsA: result.goalsA,
            goalsB: result.goalsB,
            sourceStatus: result.sourceStatus,
            query: result.query,
          },
        });

        for (const event of result.events) {
          await transaction.matchEvent.create({
            data: {
              matchId: match.id,
              minute: event.minute,
              title: event.title,
              description: event.description,
            },
          });
        }

        return saved;
      });

      imported += 1;
      logger.info("serpapi_result_imported", {
        matchId: match.id,
        goalsA: result.goalsA,
        goalsB: result.goalsB,
        predictionsUpdated: update.predictionsUpdated,
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

  console.info(`Sincronizacao concluida: ${imported} importado(s), ${skipped} ignorado(s), ${matches.length} candidato(s).`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
