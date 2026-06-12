"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "../../auth";
import { createAuditLog } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { assertRateLimit } from "../../lib/rate-limit";

const PoolNameSchema = z.object({
  name: z.string().trim().min(3, "Nome muito curto.").max(48, "Nome muito longo."),
});

const InviteCodeSchema = z.object({
  inviteCode: z.string().trim().min(6).max(24).transform((value) => value.toUpperCase()),
});

const PoolIdSchema = z.object({
  poolId: z.string().cuid(),
});

const RemoveMemberSchema = z.object({
  poolId: z.string().cuid(),
  memberId: z.string().cuid(),
});

const poolActionRateLimitWindowMs = 60 * 1000;

function makeInviteCode() {
  return randomBytes(6).toString("base64url").replace(/[-_]/g, "").slice(0, 8).toUpperCase();
}

async function getCurrentUser() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error("Voce precisa estar logado.");

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) throw new Error("Usuario nao encontrado.");
  return user;
}

async function assertPoolOwner(poolId: string, userId: string) {
  const membership = await prisma.poolMember.findUnique({
    where: { poolId_userId: { poolId, userId } },
    select: { role: true },
  });

  if (membership?.role !== "owner") {
    throw new Error("Voce precisa ser dono do bolao para fazer esta acao.");
  }
}

export async function createPool(formData: FormData) {
  const user = await getCurrentUser();
  await assertRateLimit(`pool:create:${user.email}`, 5, poolActionRateLimitWindowMs);

  const result = PoolNameSchema.safeParse({ name: formData.get("name") });
  if (!result.success) throw new Error("Nome de bolao invalido.");

  const pool = await prisma.$transaction(async (transaction) => {
    let inviteCode = makeInviteCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await transaction.pool.findUnique({ where: { inviteCode }, select: { id: true } });
      if (!existing) break;
      inviteCode = makeInviteCode();
    }

    const created = await transaction.pool.create({
      data: {
        name: result.data.name,
        inviteCode,
        createdById: user.id,
        members: { create: { userId: user.id, role: "owner" } },
      },
      select: { id: true, inviteCode: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: user.email,
      action: "pool_created",
      entity: "pool",
      entityId: created.id,
      metadata: { inviteCode: created.inviteCode, name: result.data.name },
    });

    return created;
  });

  revalidatePath("/boloes");
  redirect(`/boloes?criado=${pool.inviteCode}`);
}

export async function joinPool(formData: FormData) {
  const user = await getCurrentUser();
  await assertRateLimit(`pool:join:${user.email}`, 12, poolActionRateLimitWindowMs);

  const result = InviteCodeSchema.safeParse({ inviteCode: formData.get("inviteCode") });
  if (!result.success) throw new Error("Codigo de convite invalido.");

  const pool = await prisma.pool.findUnique({
    where: { inviteCode: result.data.inviteCode },
    select: { id: true },
  });
  if (!pool) throw new Error("Bolao nao encontrado.");

  await prisma.$transaction(async (transaction) => {
    await transaction.poolMember.upsert({
      where: { poolId_userId: { poolId: pool.id, userId: user.id } },
      update: {},
      create: { poolId: pool.id, userId: user.id, role: "member" },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: user.email,
      action: "pool_joined",
      entity: "pool",
      entityId: pool.id,
      metadata: { inviteCode: result.data.inviteCode },
    });
  });

  revalidatePath("/boloes");
  redirect("/boloes?entrou=1");
}

export async function renamePool(formData: FormData) {
  const user = await getCurrentUser();
  await assertRateLimit(`pool:rename:${user.email}`, 10, poolActionRateLimitWindowMs);

  const poolResult = PoolIdSchema.safeParse({ poolId: formData.get("poolId") });
  const nameResult = PoolNameSchema.safeParse({ name: formData.get("name") });
  if (!poolResult.success || !nameResult.success) throw new Error("Dados invalidos.");

  await assertPoolOwner(poolResult.data.poolId, user.id);

  const pool = await prisma.$transaction(async (transaction) => {
    const updated = await transaction.pool.update({
      where: { id: poolResult.data.poolId },
      data: { name: nameResult.data.name },
      select: { id: true, inviteCode: true, name: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: user.email,
      action: "pool_renamed",
      entity: "pool",
      entityId: updated.id,
      metadata: { name: updated.name },
    });

    return updated;
  });

  revalidatePath("/boloes");
  revalidatePath(`/boloes/${pool.inviteCode}`);
}

export async function regeneratePoolInvite(formData: FormData) {
  const user = await getCurrentUser();
  await assertRateLimit(`pool:invite:${user.email}`, 5, poolActionRateLimitWindowMs);

  const result = PoolIdSchema.safeParse({ poolId: formData.get("poolId") });
  if (!result.success) throw new Error("Bolao invalido.");

  await assertPoolOwner(result.data.poolId, user.id);

  const pool = await prisma.$transaction(async (transaction) => {
    const current = await transaction.pool.findUnique({
      where: { id: result.data.poolId },
      select: { id: true, inviteCode: true },
    });
    if (!current) throw new Error("Bolao nao encontrado.");

    let inviteCode = makeInviteCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await transaction.pool.findUnique({ where: { inviteCode }, select: { id: true } });
      if (!existing) break;
      inviteCode = makeInviteCode();
    }

    const updated = await transaction.pool.update({
      where: { id: current.id },
      data: { inviteCode },
      select: { id: true, inviteCode: true },
    });

    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: user.email,
      action: "pool_invite_regenerated",
      entity: "pool",
      entityId: updated.id,
      metadata: { previousInviteCode: current.inviteCode, inviteCode: updated.inviteCode },
    });

    return updated;
  });

  revalidatePath("/boloes");
  redirect(`/boloes/${pool.inviteCode}`);
}

export async function removePoolMember(formData: FormData) {
  const user = await getCurrentUser();
  await assertRateLimit(`pool:remove-member:${user.email}`, 10, poolActionRateLimitWindowMs);

  const result = RemoveMemberSchema.safeParse({
    poolId: formData.get("poolId"),
    memberId: formData.get("memberId"),
  });
  if (!result.success) throw new Error("Membro invalido.");

  await assertPoolOwner(result.data.poolId, user.id);

  const pool = await prisma.$transaction(async (transaction) => {
    const member = await transaction.poolMember.findUnique({
      where: { id: result.data.memberId },
      select: { id: true, role: true, userId: true, poolId: true, pool: { select: { inviteCode: true } } },
    });
    if (!member || member.poolId !== result.data.poolId) throw new Error("Membro nao encontrado.");
    if (member.role === "owner") throw new Error("Nao e possivel remover o dono do bolao.");

    await transaction.poolMember.delete({ where: { id: member.id } });
    await createAuditLog(transaction, {
      actorId: user.id,
      actorEmail: user.email,
      action: "pool_member_removed",
      entity: "pool",
      entityId: member.poolId,
      metadata: { removedUserId: member.userId },
    });

    return member.pool;
  });

  revalidatePath("/boloes");
  revalidatePath(`/boloes/${pool.inviteCode}`);
}
