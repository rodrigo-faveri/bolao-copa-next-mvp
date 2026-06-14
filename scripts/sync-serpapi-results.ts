import { PrismaClient } from "@prisma/client";
import { syncPendingSerpApiResults } from "../lib/result-sync";

const prisma = new PrismaClient();

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  if (!process.env.SERPAPI_KEY) {
    console.info("SERPAPI_KEY nao configurada. Nada a sincronizar.");
    return;
  }

  const summary = await syncPendingSerpApiResults({
    debug: process.env.SERPAPI_DEBUG === "true",
    dryRun: hasFlag("--dry-run") || process.env.SERPAPI_DRY_RUN === "true",
    prisma,
  });

  console.info(`Sincronizacao concluida: ${summary.imported} importado(s), ${summary.skipped} ignorado(s), ${summary.candidates} candidato(s).`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
