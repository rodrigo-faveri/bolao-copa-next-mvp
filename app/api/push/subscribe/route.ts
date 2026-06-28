import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { prisma } from "../../../../lib/prisma";
import { assertRateLimit } from "../../../../lib/rate-limit";

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });

  try {
    await assertRateLimit(`push-subscribe:${email}`, 12, 60 * 1000);
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "Too many requests" }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return jsonNoStore({ error: "User not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = PushSubscriptionSchema.safeParse(body);
  if (!parsed.success) return jsonNoStore({ error: "Invalid subscription" }, { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      auth: parsed.data.keys.auth,
      p256dh: parsed.data.keys.p256dh,
      userAgent: request.headers.get("user-agent"),
      userId: user.id,
    },
    create: {
      auth: parsed.data.keys.auth,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      userAgent: request.headers.get("user-agent"),
      userId: user.id,
    },
  });

  return jsonNoStore({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return jsonNoStore({ error: "Unauthorized" }, { status: 401 });

  try {
    await assertRateLimit(`push-unsubscribe:${email}`, 20, 60 * 1000);
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "Too many requests" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(body);
  if (!parsed.success) return jsonNoStore({ error: "Invalid subscription" }, { status: 400 });

  await prisma.pushSubscription.deleteMany({
    where: {
      endpoint: parsed.data.endpoint,
      user: { email },
    },
  });

  return jsonNoStore({ ok: true });
}
