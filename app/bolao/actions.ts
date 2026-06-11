"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { createAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { isPredictionOpen, MAX_GOALS } from "../../lib/prediction";
import { assertRateLimit } from "../../lib/rate-limit";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";

const predictionRateLimitWindowMs = 60 * 1000;
const predictionRateLimitMaxAttempts = 30;

const PredictionSchema = z.object({
  matchId: z.string().cuid(),
  goalsA: z.coerce.number().int().min(0).max(MAX_GOALS),
  goalsB: z.coerce.number().int().min(0).max(MAX_GOALS),
});

export async function savePrediction(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Você precisa estar logado.");

  assertRateLimit(`prediction:${email}`, predictionRateLimitMaxAttempts, predictionRateLimitWindowMs);

  const result = PredictionSchema.safeParse({
    matchId: formData.get("matchId"),
    goalsA: formData.get("goalsA"),
    goalsB: formData.get("goalsB"),
  });
  if (!result.success) throw new Error("Palpite inválido.");

  await prisma.$transaction(async (transaction) => {
    const [user, match] = await Promise.all([
      transaction.user.findUnique({ where: { email }, select: { id: true } }),
      transaction.match.findUnique({ where: { id: result.data.matchId }, select: { startsAt: true } }),
    ]);
    if (!user) throw new Error("Usuário não encontrado.");
    if (!match) throw new Error("Partida não encontrada.");
    if (!isPredictionOpen(match.startsAt, new Date(), allowUnscheduledPredictions)) {
      throw new Error("Os palpites para esta partida estão encerrados.");
    }

    await transaction.prediction.upsert({
      where: { userId_matchId: { userId: user.id, matchId: result.data.matchId } },
      update: { goalsA: result.data.goalsA, goalsB: result.data.goalsB },
      create: { userId: user.id, matchId: result.data.matchId, goalsA: result.data.goalsA, goalsB: result.data.goalsB },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "prediction_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        goalsA: result.data.goalsA,
        goalsB: result.data.goalsB,
      },
    });
  });

  revalidatePath("/bolao");
  revalidatePath("/ranking");
}
