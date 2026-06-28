"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { createAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { assertRateLimit } from "../../lib/rate-limit";

const allowedAvatarColors = ["#116530", "#0f766e", "#1d4ed8", "#7a4d00", "#9a3412", "#6d28d9"] as const;

const ProfileSchema = z.object({
  nickname: z.string().trim().min(2, "Apelido muito curto.").max(32, "Apelido muito longo."),
  avatarColor: z.enum(allowedAvatarColors),
});

const NotificationPreferencesSchema = z.object({
  notificationLeadMinutes: z.coerce.number().int().refine((value) => [30, 60, 120].includes(value)),
});

const MatchAlertSchema = z.object({
  alertId: z.string().cuid(),
});

const UpdateMatchAlertSchema = MatchAlertSchema.extend({
  enabled: z.preprocess((value) => value === "on", z.boolean()),
  leadMinutes: z.coerce.number().int().refine((value) => [30, 60, 120].includes(value)),
});

export async function saveProfile(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`profile:update:${email}`, 10, 60 * 1000);

  const result = ProfileSchema.safeParse({
    nickname: formData.get("nickname"),
    avatarColor: formData.get("avatarColor"),
  });
  if (!result.success) throw new Error("Perfil invalido.");

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.update({
      where: { email },
      data: {
        nickname: result.data.nickname,
        avatarColor: result.data.avatarColor,
      },
      select: { id: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "profile_updated",
      entity: "user",
      entityId: user.id,
      metadata: {
        nickname: result.data.nickname,
        avatarColor: result.data.avatarColor,
      },
    });
  });

  revalidatePath("/perfil");
  revalidatePath("/ranking");
}

export async function saveNotificationPreferences(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`profile:notifications:${email}`, 10, 60 * 1000);

  const result = NotificationPreferencesSchema.safeParse({
    notificationLeadMinutes: formData.get("notificationLeadMinutes"),
  });
  if (!result.success) throw new Error("Preferencias invalidas.");

  const notifyPickDeadlines = formData.get("notifyPickDeadlines") === "on";

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.update({
      where: { email },
      data: {
        notifyPickDeadlines,
        notifyResults: formData.get("notifyResults") === "on",
        notifyRoundSummary: formData.get("notifyRoundSummary") === "on",
        notificationLeadMinutes: result.data.notificationLeadMinutes,
      },
      select: { id: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "notification_preferences_updated",
      entity: "user",
      entityId: user.id,
      metadata: {
        notifyPickDeadlines,
        notifyResults: formData.get("notifyResults") === "on",
        notifyRoundSummary: formData.get("notifyRoundSummary") === "on",
        notificationLeadMinutes: result.data.notificationLeadMinutes,
      },
    });
  });

  revalidatePath("/perfil");
}

export async function updateMatchAlert(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`profile:match-alert:${email}`, 20, 60 * 1000);

  const result = UpdateMatchAlertSchema.safeParse({
    alertId: formData.get("alertId"),
    enabled: formData.get("enabled"),
    leadMinutes: formData.get("leadMinutes"),
  });
  if (!result.success) throw new Error("Alerta invalido.");

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) throw new Error("Usuario nao encontrado.");

    const existingAlert = await transaction.userMatchAlert.findFirst({
      where: { id: result.data.alertId, userId: user.id },
      select: { id: true, matchId: true },
    });
    if (!existingAlert) throw new Error("Alerta nao encontrado.");

    const alert = await transaction.userMatchAlert.update({
      where: { id: existingAlert.id },
      data: {
        enabled: result.data.enabled,
        leadMinutes: result.data.leadMinutes,
      },
      select: { id: true, matchId: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "match_alert_updated",
      entity: "match",
      entityId: alert.matchId,
      metadata: {
        alertId: alert.id,
        enabled: result.data.enabled,
        leadMinutes: result.data.leadMinutes,
      },
    });
  });

  revalidatePath("/perfil");
}

export async function deleteMatchAlert(formData: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  await assertRateLimit(`profile:match-alert-delete:${email}`, 20, 60 * 1000);

  const result = MatchAlertSchema.safeParse({
    alertId: formData.get("alertId"),
  });
  if (!result.success) throw new Error("Alerta invalido.");

  await prisma.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) throw new Error("Usuario nao encontrado.");

    const existingAlert = await transaction.userMatchAlert.findFirst({
      where: { id: result.data.alertId, userId: user.id },
      select: { id: true },
    });
    if (!existingAlert) throw new Error("Alerta nao encontrado.");

    const alert = await transaction.userMatchAlert.delete({
      where: { id: existingAlert.id },
      select: { id: true, matchId: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: email,
      action: "match_alert_deleted",
      entity: "match",
      entityId: alert.matchId,
      metadata: { alertId: alert.id },
    });
  });

  revalidatePath("/perfil");
}
