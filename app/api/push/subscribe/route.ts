import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "../../../../auth";
import { prisma } from "../../../../lib/prisma";

const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const parsed = PushSubscriptionSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

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

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = z.object({ endpoint: z.string().url() }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });

  await prisma.pushSubscription.deleteMany({
    where: {
      endpoint: parsed.data.endpoint,
      user: { email },
    },
  });

  return NextResponse.json({ ok: true });
}
