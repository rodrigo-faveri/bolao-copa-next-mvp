import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = PrismaClient | Prisma.TransactionClient;

type AuditLogInput = {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export async function createAuditLog(client: AuditClient, input: AuditLogInput) {
  await client.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
    },
  });
}
