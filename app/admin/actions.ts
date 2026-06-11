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
