"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { isAdminEmail } from "../../lib/access-control";
import { createAuditLog } from "../../lib/audit";
import { logger } from "../../lib/logger";
import { MAX_GOALS } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { setMatchResult } from "../../lib/results";

const ResultSchema = z.object({
  matchId: z.string().cuid(),
  goalsA: z.coerce.number().int().min(0).max(MAX_GOALS),
  goalsB: z.coerce.number().int().min(0).max(MAX_GOALS),
});

const MatchStatusSchema = z.object({
  matchId: z.string().cuid(),
  status: z.enum(["scheduled", "live"]),
});

const ExternalFixtureSchema = z.object({
  matchId: z.string().cuid(),
  externalFixtureId: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.coerce.number().int().positive().nullable(),
  ),
});

export async function saveMatchResult(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;

  if (!isAdminEmail(adminEmail)) {
    logger.warn("admin_result_denied", { emailDomain: adminEmail?.split("@")[1]?.toLowerCase() ?? null });
    await createAuditLog(prisma, {
      actorEmail: adminEmail,
      action: "admin_result_denied",
      entity: "match",
      entityId: typeof formData.get("matchId") === "string" ? String(formData.get("matchId")) : null,
    }).catch((error) => logger.error("audit_log_write_failed", { action: "admin_result_denied", message: error instanceof Error ? error.message : "unknown" }));
    throw new Error("Você não tem permissão para lançar resultados.");
  }

  const result = ResultSchema.safeParse({
    matchId: formData.get("matchId"),
    goalsA: formData.get("goalsA"),
    goalsB: formData.get("goalsB"),
  });

  if (!result.success) throw new Error("Resultado inválido.");

  await prisma.$transaction(async (transaction) => {
    const previousResult = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { resultGoalsA: true, resultGoalsB: true, finishedAt: true },
    });

    await setMatchResult(transaction, result.data);
    await createAuditLog(transaction, {
      actorEmail: adminEmail,
      action: "admin_result_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        previousGoalsA: previousResult?.resultGoalsA ?? null,
        previousGoalsB: previousResult?.resultGoalsB ?? null,
        previousFinishedAt: previousResult?.finishedAt?.toISOString() ?? null,
        goalsA: result.data.goalsA,
        goalsB: result.data.goalsB,
      },
    });
  });
  logger.info("admin_result_saved", {
    matchId: result.data.matchId,
    goalsA: result.data.goalsA,
    goalsB: result.data.goalsB,
  });

  revalidatePath("/admin");
  revalidatePath("/ranking");
  revalidatePath("/bolao");
  revalidatePath("/simulador");
}

export async function saveMatchStatus(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;

  if (!isAdminEmail(adminEmail)) {
    logger.warn("admin_status_denied", { emailDomain: adminEmail?.split("@")[1]?.toLowerCase() ?? null });
    await createAuditLog(prisma, {
      actorEmail: adminEmail,
      action: "admin_status_denied",
      entity: "match",
      entityId: typeof formData.get("matchId") === "string" ? String(formData.get("matchId")) : null,
    }).catch((error) => logger.error("audit_log_write_failed", { action: "admin_status_denied", message: error instanceof Error ? error.message : "unknown" }));
    throw new Error("VocÃª nÃ£o tem permissÃ£o para alterar o status da partida.");
  }

  const result = MatchStatusSchema.safeParse({
    matchId: formData.get("matchId"),
    status: formData.get("status"),
  });

  if (!result.success) throw new Error("Status invÃ¡lido.");

  await prisma.$transaction(async (transaction) => {
    const previousMatch = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { status: true, finishedAt: true, resultGoalsA: true, resultGoalsB: true },
    });

    if (!previousMatch) throw new Error("Partida nÃ£o encontrada.");
    if (previousMatch.resultGoalsA !== null && previousMatch.resultGoalsB !== null) {
      throw new Error("Partida com resultado oficial deve permanecer encerrada.");
    }

    await transaction.match.update({
      where: { id: result.data.matchId },
      data: { status: result.data.status },
    });

    await createAuditLog(transaction, {
      actorEmail: adminEmail,
      action: "admin_match_status_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        previousStatus: previousMatch.status,
        status: result.data.status,
      },
    });
  });

  logger.info("admin_match_status_saved", {
    matchId: result.data.matchId,
    status: result.data.status,
  });

  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/bolao");
  revalidatePath("/simulador");
}

export async function saveExternalFixtureId(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;

  if (!isAdminEmail(adminEmail)) {
    logger.warn("admin_fixture_mapping_denied", { emailDomain: adminEmail?.split("@")[1]?.toLowerCase() ?? null });
    throw new Error("VocÃª nÃ£o tem permissÃ£o para mapear fixtures.");
  }

  const result = ExternalFixtureSchema.safeParse({
    matchId: formData.get("matchId"),
    externalFixtureId: formData.get("externalFixtureId"),
  });

  if (!result.success) throw new Error("Fixture externo invÃ¡lido.");

  await prisma.$transaction(async (transaction) => {
    const previousMatch = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { externalFixtureId: true },
    });

    if (!previousMatch) throw new Error("Partida nÃ£o encontrada.");

    await transaction.match.update({
      where: { id: result.data.matchId },
      data: { externalFixtureId: result.data.externalFixtureId },
    });

    await createAuditLog(transaction, {
      actorEmail: adminEmail,
      action: "admin_external_fixture_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        previousExternalFixtureId: previousMatch.externalFixtureId,
        externalFixtureId: result.data.externalFixtureId,
      },
    });
  });

  logger.info("admin_external_fixture_saved", {
    matchId: result.data.matchId,
    externalFixtureId: result.data.externalFixtureId,
  });

  revalidatePath("/admin");
  revalidatePath(`/tempo-real/${result.data.matchId}`);
}
