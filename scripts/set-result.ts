import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { MAX_GOALS } from "../lib/prediction";
import { setMatchResult } from "../lib/results";

const input = z.object({
  matchId: z.string().cuid(),
  goalsA: z.coerce.number().int().min(0).max(MAX_GOALS),
  goalsB: z.coerce.number().int().min(0).max(MAX_GOALS),
}).safeParse({
  matchId: process.argv[2],
  goalsA: process.argv[3],
  goalsB: process.argv[4],
});

if (!input.success) {
  console.error("Uso: npm run result:set -- <matchId> <golsA> <golsB>");
  process.exit(1);
}

const parsedInput = input.data;
const prisma = new PrismaClient();

async function main() {
  const { matchId, goalsA, goalsB } = parsedInput;

  const result = await prisma.$transaction((transaction) =>
    setMatchResult(transaction, { matchId, goalsA, goalsB }),
  );

  console.info(`Resultado atualizado. ${result.predictionsUpdated} palpite(s) recalculado(s).`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
