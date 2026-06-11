import type { Prisma, PrismaClient } from "@prisma/client";
import { calculatePredictionPoints } from "./prediction";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function setMatchResult(
  transaction: TransactionClient,
  {
    allowFutureResult = false,
    goalsA,
    goalsB,
    matchId,
  }: {
    allowFutureResult?: boolean;
    goalsA: number;
    goalsB: number;
    matchId: string;
  },
) {
  const match = await transaction.match.findUnique({ where: { id: matchId } });
  if (!match) throw new Error("Partida não encontrada.");
  if (!allowFutureResult && match.startsAt && match.startsAt > new Date()) {
    throw new Error("Não é permitido registrar resultado antes do início da partida.");
  }

  const predictions = await transaction.prediction.findMany({ where: { matchId } });
  const updates: Prisma.PrismaPromise<unknown>[] = predictions.map((prediction) =>
    transaction.prediction.update({
      where: { id: prediction.id },
      data: { points: calculatePredictionPoints(prediction.goalsA, prediction.goalsB, goalsA, goalsB) },
    }),
  );

  updates.push(
    transaction.match.update({
      where: { id: matchId },
      data: { resultGoalsA: goalsA, resultGoalsB: goalsB, finishedAt: new Date() },
    }),
  );

  await Promise.all(updates);

  return {
    predictionsUpdated: predictions.length,
  };
}
