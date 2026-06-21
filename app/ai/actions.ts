"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { createAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { assertRateLimit } from "../../lib/rate-limit";
import { getTeamDisplayName } from "../../lib/teams";

const CreateMatchAlertSchema = z.object({
  leadMinutes: z.coerce.number().int().refine((value) => [30, 60, 120].includes(value)),
  matchId: z.string().cuid(),
});

export type CreateMatchAlertState = {
  message?: string;
  status: "idle" | "success" | "error";
  submittedAt?: number;
};

export async function createAssistantMatchAlert(
  _previousState: CreateMatchAlertState,
  formData: FormData,
): Promise<CreateMatchAlertState> {
  void _previousState;

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { message: "Faca login para criar alertas.", status: "error", submittedAt: Date.now() };

  await assertRateLimit(`assistant-alert:${email}`, 8, 60 * 1000);

  const parsed = CreateMatchAlertSchema.safeParse({
    leadMinutes: formData.get("leadMinutes"),
    matchId: formData.get("matchId"),
  });
  if (!parsed.success) return { message: "Alerta invalido.", status: "error", submittedAt: Date.now() };

  try {
    const alert = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (!user) throw new Error("Usuario nao encontrado.");

      const match = await transaction.match.findUnique({
        where: { id: parsed.data.matchId },
        select: { id: true, resultGoalsA: true, resultGoalsB: true, startsAt: true, teamA: true, teamB: true },
      });
      if (!match) throw new Error("Partida nao encontrada.");
      if (!match.startsAt) throw new Error("Esta partida ainda nao tem horario definido.");
      if (match.resultGoalsA !== null && match.resultGoalsB !== null) throw new Error("Esta partida ja foi encerrada.");

      const savedAlert = await transaction.userMatchAlert.upsert({
        where: {
          userId_matchId_kind: {
            kind: "pick_deadline",
            matchId: match.id,
            userId: user.id,
          },
        },
        update: {
          enabled: true,
          leadMinutes: parsed.data.leadMinutes,
          note: "Criado pela assistente IA",
          source: "assistant",
        },
        create: {
          kind: "pick_deadline",
          leadMinutes: parsed.data.leadMinutes,
          matchId: match.id,
          note: "Criado pela assistente IA",
          source: "assistant",
          userId: user.id,
        },
        select: { id: true },
      });

      await createAuditLog(transaction, {
        actorId: user.id,
        actorEmail: email,
        action: "assistant_match_alert_saved",
        entity: "match",
        entityId: match.id,
        metadata: {
          alertId: savedAlert.id,
          leadMinutes: parsed.data.leadMinutes,
        },
      });

      return {
        id: savedAlert.id,
        label: `${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)}`,
      };
    });

    revalidatePath("/perfil");
    return {
      message: `Alerta salvo para ${alert.label}.`,
      status: "success",
      submittedAt: Date.now(),
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Nao foi possivel criar o alerta.",
      status: "error",
      submittedAt: Date.now(),
    };
  }
}
