import { equal } from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { setMatchResult } from "../lib/results";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  console.info("results integration test skipped: set TEST_DATABASE_URL to run against PostgreSQL.");
  process.exit(0);
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});

const testRunId = `integration-${Date.now()}`;

async function cleanup() {
  await prisma.prediction.deleteMany({ where: { matchId: { startsWith: testRunId } } });
  await prisma.match.deleteMany({ where: { id: { startsWith: testRunId } } });
  await prisma.user.deleteMany({ where: { email: { contains: `${testRunId}@example.test` } } });
}

async function main() {
  const matchId = `${testRunId}-match`;
  const exactUserId = `${testRunId}-exact`;
  const outcomeUserId = `${testRunId}-outcome`;
  const missUserId = `${testRunId}-miss`;

  await cleanup();

  await prisma.user.createMany({
    data: [
      { id: exactUserId, email: `${testRunId}@example.test`, name: "Exact User" },
      { id: outcomeUserId, email: `${testRunId}-outcome@example.test`, name: "Outcome User" },
      { id: missUserId, email: `${testRunId}-miss@example.test`, name: "Miss User" },
    ],
  });

  await prisma.match.create({
    data: {
      id: matchId,
      group: `T-${Date.now()}`,
      teamA: `${testRunId} Team A`,
      teamB: `${testRunId} Team B`,
      startsAt: new Date("2026-06-01T18:00:00.000Z"),
    },
  });

  await prisma.prediction.createMany({
    data: [
      { userId: exactUserId, matchId, goalsA: 2, goalsB: 1 },
      { userId: outcomeUserId, matchId, goalsA: 1, goalsB: 0 },
      { userId: missUserId, matchId, goalsA: 0, goalsB: 2 },
    ],
  });

  const result = await prisma.$transaction((transaction) =>
    setMatchResult(transaction, { goalsA: 2, goalsB: 1, matchId }),
  );

  equal(result.predictionsUpdated, 3);

  const [match, exact, outcome, miss] = await Promise.all([
    prisma.match.findUniqueOrThrow({ where: { id: matchId } }),
    prisma.prediction.findUniqueOrThrow({ where: { userId_matchId: { userId: exactUserId, matchId } } }),
    prisma.prediction.findUniqueOrThrow({ where: { userId_matchId: { userId: outcomeUserId, matchId } } }),
    prisma.prediction.findUniqueOrThrow({ where: { userId_matchId: { userId: missUserId, matchId } } }),
  ]);

  equal(match.status, "finished");
  equal(match.resultGoalsA, 2);
  equal(match.resultGoalsB, 1);
  equal(exact.points, 5);
  equal(outcome.points, 3);
  equal(miss.points, 0);
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
    console.info("results integration tests passed");
  })
  .catch(async (error) => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
    console.error(error);
    process.exit(1);
  });
