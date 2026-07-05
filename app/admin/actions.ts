"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { isAdminEmail } from "../../lib/access-control";
import { createAuditLog } from "../../lib/audit";
import { materializeKnockoutMatches } from "../../lib/knockout-materialization";
import { logger } from "../../lib/logger";
import { MAX_GOALS } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { assertRateLimit } from "../../lib/rate-limit";
import { setMatchResult } from "../../lib/results";
import { readPositiveInt, syncPendingSerpApiResults } from "../../lib/result-sync";

const ResultSchema = z.object({
  matchId: z.string().cuid(),
  goalsA: z.coerce.number().int().min(0).max(MAX_GOALS),
  goalsB: z.coerce.number().int().min(0).max(MAX_GOALS),
  winnerTeam: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(80).nullable(),
  ),
});

const MatchStatusSchema = z.object({
  matchId: z.string().cuid(),
  status: z.enum(["scheduled", "live"]),
});

const MatchEventSchema = z.object({
  matchId: z.string().cuid(),
  minute: z.string().trim().min(1).max(12),
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(280),
});

const MatchLiveUrlSchema = z.object({
  matchId: z.string().cuid(),
  liveUrl: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().url().max(500).nullable(),
  ),
});

const adminActionRateLimitWindowMs = 60 * 1000;
const adminSyncRateLimitWindowMs = 5 * 60 * 1000;

export type AdminSyncFeedbackState = {
  candidates?: number;
  imported?: number;
  message?: string;
  skipped?: number;
  status: "idle" | "success" | "error";
  submittedAt?: number;
};

async function assertAdminAction(adminEmail: string | null, action: string) {
  await assertRateLimit(`admin:any:${adminEmail ?? "anonymous"}`, 20, adminActionRateLimitWindowMs);

  if (!isAdminEmail(adminEmail)) {
    logger.warn(`${action}_denied`, { emailDomain: adminEmail?.split("@")[1]?.toLowerCase() ?? null });
    await createAuditLog(prisma, {
      actorEmail: adminEmail,
      action: `${action}_denied`,
    }).catch((error) => logger.error("audit_log_write_failed", { action: `${action}_denied`, message: error instanceof Error ? error.message : "unknown" }));
    throw new Error("Voce nao tem permissao para executar esta acao.");
  }
}

export async function saveMatchResult(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;
  await assertAdminAction(adminEmail, "admin_result");
  await assertRateLimit(`admin:result:${adminEmail}`, 30, adminActionRateLimitWindowMs);

  const result = ResultSchema.safeParse({
    matchId: formData.get("matchId"),
    goalsA: formData.get("goalsA"),
    goalsB: formData.get("goalsB"),
    winnerTeam: formData.get("winnerTeam"),
  });

  if (!result.success) throw new Error("Resultado invalido.");

  await prisma.$transaction(async (transaction) => {
    const previousResult = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { resultGoalsA: true, resultGoalsB: true, finishedAt: true, winnerTeam: true },
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
        previousWinnerTeam: previousResult?.winnerTeam ?? null,
        goalsA: result.data.goalsA,
        goalsB: result.data.goalsB,
        winnerTeam: result.data.winnerTeam,
      },
    });
  });

  await materializeKnockoutMatches(prisma);

  logger.info("admin_result_saved", {
    matchId: result.data.matchId,
    goalsA: result.data.goalsA,
    goalsB: result.data.goalsB,
    winnerTeam: result.data.winnerTeam ?? null,
  });

  revalidatePath("/admin");
  revalidatePath("/ranking");
  revalidatePath("/bolao");
  revalidatePath("/simulador");
  revalidatePath(`/tempo-real/${result.data.matchId}`);
}

async function runAdminResultSync() {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;
  await assertAdminAction(adminEmail, "admin_serpapi_sync");
  await assertRateLimit(`admin:serpapi-sync:${adminEmail}`, 3, adminSyncRateLimitWindowMs);

  const summary = await syncPendingSerpApiResults({
    debug: process.env.SERPAPI_DEBUG === "true",
    delayMinutes: readPositiveInt("SERPAPI_RESULT_DELAY_MINUTES", 120),
    maxMatches: readPositiveInt("SERPAPI_RESULT_MAX_MATCHES", 12),
    prisma,
    triggeredBy: adminEmail,
  });

  await createAuditLog(prisma, {
    actorEmail: adminEmail,
    action: "admin_serpapi_sync_triggered",
    entity: "result_sync_run",
    entityId: summary.runId,
    metadata: summary,
  });

  logger.info("admin_serpapi_sync_triggered", {
    adminEmailDomain: adminEmail?.split("@")[1]?.toLowerCase() ?? null,
    candidates: summary.candidates,
    imported: summary.imported,
    skipped: summary.skipped,
  });

  revalidatePath("/admin");
  revalidatePath("/ranking");
  revalidatePath("/bolao");
  revalidatePath("/simulador");
  revalidatePath("/resultados");

  return summary;
}

export async function syncPendingResultsNow() {
  await runAdminResultSync();
}

export async function syncPendingResultsWithFeedback(
  _previousState: AdminSyncFeedbackState,
  _formData: FormData,
): Promise<AdminSyncFeedbackState> {
  void _previousState;
  void _formData;

  try {
    const summary = await runAdminResultSync();
    return {
      candidates: summary.candidates,
      imported: summary.imported,
      message: "Sincronizacao concluida.",
      skipped: summary.skipped,
      status: "success",
      submittedAt: Date.now(),
    };
  } catch (error) {
    logger.error("admin_serpapi_sync_feedback_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    revalidatePath("/admin");
    return {
      message: error instanceof Error ? error.message : "Nao foi possivel sincronizar resultados agora.",
      status: "error",
      submittedAt: Date.now(),
    };
  }
}

export async function saveMatchStatus(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;
  await assertAdminAction(adminEmail, "admin_status");
  await assertRateLimit(`admin:status:${adminEmail}`, 30, adminActionRateLimitWindowMs);

  const result = MatchStatusSchema.safeParse({
    matchId: formData.get("matchId"),
    status: formData.get("status"),
  });

  if (!result.success) throw new Error("Status invalido.");

  await prisma.$transaction(async (transaction) => {
    const previousMatch = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { status: true, finishedAt: true, resultGoalsA: true, resultGoalsB: true },
    });

    if (!previousMatch) throw new Error("Partida nao encontrada.");
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
  revalidatePath(`/tempo-real/${result.data.matchId}`);
}

export async function saveMatchLiveUrl(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;
  await assertAdminAction(adminEmail, "admin_live_url");
  await assertRateLimit(`admin:live-url:${adminEmail}`, 30, adminActionRateLimitWindowMs);

  const result = MatchLiveUrlSchema.safeParse({
    matchId: formData.get("matchId"),
    liveUrl: formData.get("liveUrl"),
  });

  if (!result.success) throw new Error("URL de tempo real invalida.");

  await prisma.$transaction(async (transaction) => {
    const previousMatch = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { liveUrl: true },
    });

    if (!previousMatch) throw new Error("Partida nao encontrada.");

    await transaction.match.update({
      where: { id: result.data.matchId },
      data: { liveUrl: result.data.liveUrl },
    });

    await createAuditLog(transaction, {
      actorEmail: adminEmail,
      action: "admin_match_live_url_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        previousLiveUrl: previousMatch.liveUrl,
        liveUrl: result.data.liveUrl,
      },
    });
  });

  logger.info("admin_match_live_url_saved", {
    matchId: result.data.matchId,
    hasLiveUrl: Boolean(result.data.liveUrl),
  });

  revalidatePath("/admin");
  revalidatePath(`/tempo-real/${result.data.matchId}`);
}

export async function saveMatchEvent(formData: FormData) {
  const session = await auth();
  const adminEmail = session?.user?.email ?? null;
  await assertAdminAction(adminEmail, "admin_match_event");
  await assertRateLimit(`admin:event:${adminEmail}`, 30, adminActionRateLimitWindowMs);

  const result = MatchEventSchema.safeParse({
    matchId: formData.get("matchId"),
    minute: formData.get("minute"),
    title: formData.get("title"),
    description: formData.get("description"),
  });

  if (!result.success) throw new Error("Lance invalido.");

  await prisma.$transaction(async (transaction) => {
    const match = await transaction.match.findUnique({
      where: { id: result.data.matchId },
      select: { id: true },
    });

    if (!match) throw new Error("Partida nao encontrada.");

    const event = await transaction.matchEvent.create({
      data: {
        matchId: result.data.matchId,
        minute: result.data.minute,
        title: result.data.title,
        description: result.data.description,
      },
      select: { id: true },
    });

    await createAuditLog(transaction, {
      actorEmail: adminEmail,
      action: "admin_match_event_saved",
      entity: "match",
      entityId: result.data.matchId,
      metadata: {
        eventId: event.id,
        minute: result.data.minute,
        title: result.data.title,
      },
    });
  });

  logger.info("admin_match_event_saved", {
    matchId: result.data.matchId,
    minute: result.data.minute,
  });

  revalidatePath("/admin");
  revalidatePath(`/tempo-real/${result.data.matchId}`);
}
