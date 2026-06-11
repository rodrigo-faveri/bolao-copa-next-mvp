import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { getApiFootballLiveMatch } from "../../../../../lib/sports-api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { externalFixtureId: true },
  });

  if (!match) {
    return NextResponse.json({ error: "Partida nao encontrada." }, { status: 404 });
  }

  const liveData = await getApiFootballLiveMatch(match.externalFixtureId);
  return NextResponse.json(liveData);
}
