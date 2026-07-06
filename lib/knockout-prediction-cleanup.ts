import type { PrismaClient } from "@prisma/client";
import { normalizeTeamName } from "./teams";

const knockoutGroupToBracketPrefix: Record<string, string> = {
  FINAL: "final",
  QF: "qf",
  R16: "r16",
  R32: "r32",
  SF: "sf",
};

function bracketMatchIdFromGroup(group: string) {
  const [prefix, rawNumber] = group.split("-");
  const number = Number(rawNumber);
  const bracketPrefix = knockoutGroupToBracketPrefix[prefix];
  return bracketPrefix && Number.isInteger(number) ? `${bracketPrefix}-${number}` : null;
}

function getWinner(match: { resultGoalsA: number | null; resultGoalsB: number | null; teamA: string; teamB: string; winnerTeam: string | null }) {
  if (match.winnerTeam) return match.winnerTeam;
  if (match.resultGoalsA === null || match.resultGoalsB === null || match.resultGoalsA === match.resultGoalsB) return null;
  return match.resultGoalsA > match.resultGoalsB ? match.teamA : match.teamB;
}

export async function pruneInvalidKnockoutPredictions(prisma: PrismaClient) {
  const knockoutMatches = await prisma.match.findMany({
    where: {
      OR: [
        { group: { startsWith: "R32-" } },
        { group: { startsWith: "R16-" } },
        { group: { startsWith: "QF-" } },
        { group: { startsWith: "SF-" } },
        { group: { startsWith: "FINAL-" } },
      ],
    },
    select: {
      group: true,
      resultGoalsA: true,
      resultGoalsB: true,
      teamA: true,
      teamB: true,
      winnerTeam: true,
    },
  });

  const materializedTeamsByBracketId = new Map<string, Set<string>>();
  const eliminatedInMatchByTeam = new Map<string, Set<string>>();

  for (const match of knockoutMatches) {
    const bracketMatchId = bracketMatchIdFromGroup(match.group);
    if (!bracketMatchId) continue;

    materializedTeamsByBracketId.set(bracketMatchId, new Set([
      normalizeTeamName(match.teamA),
      normalizeTeamName(match.teamB),
    ]));

    const winner = getWinner(match);
    if (!winner) continue;

    for (const team of [match.teamA, match.teamB]) {
      if (normalizeTeamName(team) === normalizeTeamName(winner)) continue;
      const normalizedLoser = normalizeTeamName(team);
      const preservedMatchIds = eliminatedInMatchByTeam.get(normalizedLoser) ?? new Set<string>();
      preservedMatchIds.add(bracketMatchId);
      eliminatedInMatchByTeam.set(normalizedLoser, preservedMatchIds);
    }
  }

  const predictions = await prisma.knockoutPrediction.findMany({
    select: {
      bracketMatchId: true,
      id: true,
      winnerTeam: true,
    },
  });
  const invalidPredictionIds: string[] = [];

  for (const prediction of predictions) {
    const normalizedWinner = normalizeTeamName(prediction.winnerTeam);
    const validTeams = materializedTeamsByBracketId.get(prediction.bracketMatchId);
    if (validTeams && !validTeams.has(normalizedWinner)) {
      invalidPredictionIds.push(prediction.id);
      continue;
    }

    const preservedMatchIds = eliminatedInMatchByTeam.get(normalizedWinner);
    if (preservedMatchIds && !preservedMatchIds.has(prediction.bracketMatchId)) {
      invalidPredictionIds.push(prediction.id);
    }
  }

  if (invalidPredictionIds.length === 0) {
    return { deleted: 0 };
  }

  const deleted = await prisma.knockoutPrediction.deleteMany({
    where: { id: { in: invalidPredictionIds } },
  });

  return { deleted: deleted.count };
}
