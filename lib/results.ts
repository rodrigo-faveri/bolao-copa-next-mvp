import type { Prisma, PrismaClient } from "@prisma/client";
import { calculatePredictionPoints } from "./prediction";

type TransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const groupStageCodes = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);

export async function setMatchResult(
  transaction: TransactionClient,
  {
    allowFutureResult = false,
    goalsA,
    goalsB,
    matchId,
    penaltyGoalsA,
    penaltyGoalsB,
    resultMethod,
    winnerTeam,
  }: {
    allowFutureResult?: boolean;
    goalsA: number;
    goalsB: number;
    matchId: string;
    penaltyGoalsA?: number | null;
    penaltyGoalsB?: number | null;
    resultMethod?: string | null;
    winnerTeam?: string | null;
  },
) {
  const match = await transaction.match.findUnique({ where: { id: matchId } });
  if (!match) throw new Error("Partida nao encontrada.");
  if (!allowFutureResult && match.startsAt && match.startsAt > new Date()) {
    throw new Error("Nao e permitido registrar resultado antes do inicio da partida.");
  }

  const isKnockoutMatch = !groupStageCodes.has(match.group);
  const officialWinner = goalsA > goalsB
    ? match.teamA
    : goalsB > goalsA
      ? match.teamB
      : winnerTeam?.trim() || null;

  if (isKnockoutMatch && goalsA === goalsB && !officialWinner) {
    throw new Error("Informe o classificado para partidas de mata-mata empatadas.");
  }

  if (officialWinner && ![match.teamA, match.teamB].includes(officialWinner)) {
    throw new Error("Classificado invalido para esta partida.");
  }

  const normalizedResultMethod = resultMethod?.trim() || (isKnockoutMatch && goalsA === goalsB && officialWinner ? "penalties" : null);
  if ((penaltyGoalsA == null) !== (penaltyGoalsB == null)) {
    throw new Error("Informe os dois placares de penaltis ou deixe ambos vazios.");
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
      data: {
        finishedAt: new Date(),
        penaltyGoalsA: penaltyGoalsA ?? null,
        penaltyGoalsB: penaltyGoalsB ?? null,
        resultGoalsA: goalsA,
        resultGoalsB: goalsB,
        resultMethod: normalizedResultMethod,
        status: "finished",
        winnerTeam: officialWinner,
      },
    }),
  );

  await Promise.all(updates);

  return {
    predictionsUpdated: predictions.length,
  };
}
