import { pruneInvalidKnockoutPredictions } from "../lib/knockout-prediction-cleanup";
import { prisma } from "../lib/prisma";

async function main() {
  const result = await pruneInvalidKnockoutPredictions(prisma);
  console.info(`Palpites futuros invalidos removidos: ${result.deleted}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
