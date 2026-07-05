"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { createAuditLog } from "../../lib/audit";
import { isKnockoutPredictionOpen } from "../../lib/knockout-schedule";
import { prisma } from "../../lib/prisma";
import { isPredictionOpen, MAX_GOALS } from "../../lib/prediction";
import { assertRateLimit } from "../../lib/rate-limit";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";

const predictionRateLimitWindowMs = 60 * 1000;
const predictionRateLimitMaxAttempts = 30;
const groupStageCodes = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);

const PredictionSchema = z.object({
  matchId: z.string().cuid(),
  goalsA: z.coerce.number().int().min(0).max(MAX_GOALS),
  goalsB: z.coerce.number().int().min(0).max(MAX_GOALS),
});

const KnockoutPredictionSchema = z.object({
  awayLabel: z.string().trim().min(1).max(40),
  awayGoals: z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.number().int().min(0).max(MAX_GOALS).optional()),
  awayTeam: z.string().trim().max(80).optional(),
  bracketMatchId: z.string().trim().min(2).max(60),
  bracketRound: z.string().trim().min(1).max(40),
  homeGoals: z.preprocess((value) => value === "" || value === null ? undefined : value, z.coerce.number().int().min(0).max(MAX_GOALS).optional()),
  homeLabel: z.string().trim().min(1).max(40),
  homeTeam: z.string().trim().max(80).optional(),
  poolInviteCode: z.string().trim().max(24).optional(),
  winnerTeam: z.string().trim().min(1).max(80),
}).refine((data) => (data.homeGoals === undefined && data.awayGoals === undefined) || (data.homeGoals !== undefined && data.awayGoals !== undefined), {
  message: "Informe os dois placares ou deixe ambos vazios.",
  path: ["homeGoals"],
}).refine((data) => data.homeGoals === undefined || data.awayGoals === undefined || data.homeGoals !== data.awayGoals, {
  message: "No mata-mata, o placar precisa ter um vencedor.",
  path: ["homeGoals"],
});

const DeleteKnockoutPredictionSchema = z.object({
  bracketMatchId: z.string().trim().min(2).max(60),
  poolInviteCode: z.string().trim().max(24).optional(),
});

const ClearKnockoutPredictionsSchema = z.object({
  poolInviteCode: z.string().trim().max(24).optional(),
});

export async function savePrediction(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Você precisa estar logado.");

  await assertRateLimit(`prediction:${email}`, predictionRateLimitMaxAttempts, predictionRateLimitWindowMs);

  const result = PredictionSchema.safeParse({
    matchId: formData.get("matchId"),
    goalsA: formData.get("goalsA"),
    goalsB: formData.get("goalsB"),
  });
  if (!result.success) throw new Error("Palpite inválido.");

  await prisma.$transaction(async (transaction) => {
    const [user, match] = await Promise.all([
      transaction.user.findUnique({ where: { email }, select: { id: true } }),
      transaction.match.findUnique({ where: { id: result.data.matchId }, select: { group: true, startsAt: true } }),
    ]);
    if (!user) throw new Error("Usuário não encontrado.");
    if (!match) throw new Error("Partida não encontrada.");
    if (!groupStageCodes.has(match.group)) {
      throw new Error("Palpites de mata-mata devem ser feitos na aba Mata-mata.");
    }
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

export async function saveKnockoutPrediction(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("VocÃª precisa estar logado.");

  await assertRateLimit(`knockout-prediction:${email}`, predictionRateLimitMaxAttempts, predictionRateLimitWindowMs);

  const result = KnockoutPredictionSchema.safeParse({
    awayLabel: formData.get("awayLabel"),
    awayGoals: formData.get("awayGoals"),
    awayTeam: formData.get("awayTeam") || undefined,
    bracketMatchId: formData.get("bracketMatchId"),
    bracketRound: formData.get("bracketRound"),
    homeGoals: formData.get("homeGoals"),
    homeLabel: formData.get("homeLabel"),
    homeTeam: formData.get("homeTeam") || undefined,
    poolInviteCode: formData.get("poolInviteCode") || undefined,
    winnerTeam: formData.get("winnerTeam"),
  });
  if (!result.success) throw new Error("Palpite do mata-mata invÃ¡lido.");

  const { poolInviteCode, winnerTeam, ...prediction } = result.data;
  if (!isKnockoutPredictionOpen(prediction.bracketMatchId)) {
    throw new Error("Os palpites para este confronto do mata-mata estao encerrados.");
  }

  const options = [prediction.homeTeam, prediction.awayTeam].filter(Boolean);
  if (prediction.homeGoals !== undefined && prediction.awayGoals !== undefined) {
    const scoreWinner = prediction.homeGoals > prediction.awayGoals ? prediction.homeTeam : prediction.awayTeam;
    if (scoreWinner && scoreWinner !== winnerTeam) {
      throw new Error("O vencedor precisa bater com o placar informado.");
    }
  }
  if (options.length > 0 && !options.includes(winnerTeam)) {
    throw new Error("O vencedor precisa ser uma das seleÃ§Ãµes do confronto.");
  }

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("UsuÃ¡rio nÃ£o encontrado.");

    let poolId: string | null = null;
    let poolScope = "global";
    const normalizedInviteCode = poolInviteCode?.toUpperCase();

    if (normalizedInviteCode) {
      const membership = await transaction.poolMember.findFirst({
        where: {
          pool: { inviteCode: normalizedInviteCode },
          userId: user.id,
        },
        select: { pool: { select: { id: true } } },
      });
      if (!membership) throw new Error("VocÃª nÃ£o participa deste bolÃ£o.");
      poolId = membership.pool.id;
      poolScope = membership.pool.id;
    }

    await transaction.knockoutPrediction.upsert({
      where: {
        userId_poolScope_bracketMatchId: {
          bracketMatchId: prediction.bracketMatchId,
          poolScope,
          userId: user.id,
        },
      },
      update: {
        ...prediction,
        poolId,
        winnerTeam,
      },
      create: {
        ...prediction,
        poolId,
        poolScope,
        userId: user.id,
        winnerTeam,
      },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "knockout_prediction_saved",
      entity: "knockout_prediction",
      entityId: prediction.bracketMatchId,
      metadata: {
        awayGoals: prediction.awayGoals ?? null,
        bracketRound: prediction.bracketRound,
        homeGoals: prediction.homeGoals ?? null,
        poolScope,
        winnerTeam,
      },
    });
  });

  revalidatePath("/bolao");
  revalidatePath("/simulador");
  revalidatePath("/ranking");
}

export async function deleteKnockoutPrediction(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`knockout-delete:${email}`, predictionRateLimitMaxAttempts, predictionRateLimitWindowMs);

  const result = DeleteKnockoutPredictionSchema.safeParse({
    bracketMatchId: formData.get("bracketMatchId"),
    poolInviteCode: formData.get("poolInviteCode") || undefined,
  });
  if (!result.success) throw new Error("Palpite do mata-mata invalido.");

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("Usuario nao encontrado.");

    let poolScope = "global";
    const normalizedInviteCode = result.data.poolInviteCode?.toUpperCase();

    if (normalizedInviteCode) {
      const membership = await transaction.poolMember.findFirst({
        where: {
          pool: { inviteCode: normalizedInviteCode },
          userId: user.id,
        },
        select: { pool: { select: { id: true } } },
      });
      if (!membership) throw new Error("Voce nao participa deste bolao.");
      poolScope = membership.pool.id;
    }

    await transaction.knockoutPrediction.deleteMany({
      where: {
        bracketMatchId: result.data.bracketMatchId,
        poolScope,
        userId: user.id,
      },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "knockout_prediction_deleted",
      entity: "knockout_prediction",
      entityId: result.data.bracketMatchId,
      metadata: { poolScope },
    });
  });

  revalidatePath("/bolao");
  revalidatePath("/simulador");
  revalidatePath("/ranking");
}

export async function clearKnockoutPredictions(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`knockout-clear:${email}`, predictionRateLimitMaxAttempts, predictionRateLimitWindowMs);

  const result = ClearKnockoutPredictionsSchema.safeParse({
    poolInviteCode: formData.get("poolInviteCode") || undefined,
  });
  if (!result.success) throw new Error("Escopo do mata-mata invalido.");

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new Error("Usuario nao encontrado.");

    let poolScope = "global";
    const normalizedInviteCode = result.data.poolInviteCode?.toUpperCase();

    if (normalizedInviteCode) {
      const membership = await transaction.poolMember.findFirst({
        where: {
          pool: { inviteCode: normalizedInviteCode },
          userId: user.id,
        },
        select: { pool: { select: { id: true } } },
      });
      if (!membership) throw new Error("Voce nao participa deste bolao.");
      poolScope = membership.pool.id;
    }

    const deleted = await transaction.knockoutPrediction.deleteMany({
      where: {
        poolScope,
        userId: user.id,
      },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "knockout_predictions_cleared",
      entity: "knockout_prediction",
      metadata: { deleted: deleted.count, poolScope },
    });
  });

  revalidatePath("/bolao");
  revalidatePath("/simulador");
  revalidatePath("/ranking");
}
