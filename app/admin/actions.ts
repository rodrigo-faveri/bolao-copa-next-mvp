"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "../../auth";
import { isAdminEmail } from "../../lib/access-control";
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

  if (!isAdminEmail(session?.user?.email)) {
    throw new Error("Você não tem permissão para lançar resultados.");
  }

  const result = ResultSchema.safeParse({
    matchId: formData.get("matchId"),
    goalsA: formData.get("goalsA"),
    goalsB: formData.get("goalsB"),
  });

  if (!result.success) throw new Error("Resultado inválido.");

  await prisma.$transaction((transaction) => setMatchResult(transaction, result.data));

  revalidatePath("/admin");
  revalidatePath("/ranking");
  revalidatePath("/bolao");
  revalidatePath("/simulador");
}
