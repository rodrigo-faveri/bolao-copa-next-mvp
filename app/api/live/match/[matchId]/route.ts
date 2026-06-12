import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "../../../../../lib/prisma";
import { assertRateLimit } from "../../../../../lib/rate-limit";
import { getClientIp } from "../../../../../lib/request-client";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  matchId: z.string().cuid(),
});

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function getStatusLabel(match: {
  startsAt: Date | null;
  status: string;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
}) {
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  if (hasResult || match.status === "finished") return "Encerrada";
  if (match.status === "live") return "Ao vivo";
  if (!match.startsAt) return "Agendada";

  const elapsedMinutes = Math.floor((Date.now() - match.startsAt.getTime()) / 60000);
  if (elapsedMinutes < 0) return "Agendada";
  if (elapsedMinutes <= 45) return "1o tempo";
  if (elapsedMinutes <= 60) return "Intervalo previsto";
  if (elapsedMinutes <= 105) return "2o tempo";
  if (elapsedMinutes <= 130) return "Acrescimos/encerramento previsto";
  return "Aguardando resultado";
}

export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const parsedParams = ParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return jsonNoStore({ error: "Partida invalida." }, { status: 400 });
  }

  try {
    await assertRateLimit(`live-match:${getClientIp(request)}`, 60, 60 * 1000);
  } catch (error) {
    return jsonNoStore({ error: error instanceof Error ? error.message : "Aguarde um minuto e tente novamente." }, { status: 429 });
  }

  const match = await prisma.match.findUnique({
    where: { id: parsedParams.data.matchId },
    select: {
      id: true,
      teamA: true,
      teamB: true,
      startsAt: true,
      status: true,
      liveUrl: true,
      resultGoalsA: true,
      resultGoalsB: true,
      events: {
        orderBy: { createdAt: "desc" },
        select: { id: true, minute: true, title: true, description: true, createdAt: true },
      },
    },
  });

  if (!match) {
    return jsonNoStore({ error: "Partida nao encontrada." }, { status: 404 });
  }

  return jsonNoStore({
    source: "local",
    available: true,
    matchId: match.id,
    teamA: match.teamA,
    teamB: match.teamB,
    statusLabel: getStatusLabel(match),
    liveUrl: match.liveUrl,
    goalsA: match.resultGoalsA,
    goalsB: match.resultGoalsB,
    events: match.events.map((event) => ({
      id: event.id,
      minute: event.minute,
      title: event.title,
      description: event.description,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}
