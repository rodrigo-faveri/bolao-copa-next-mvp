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
