import type { Match, PrismaClient } from "@prisma/client";
import { getKnockoutMatchSchedule } from "./knockout-schedule";
import { normalizeTeamName } from "./teams";

type Standing = {
  goalDifference: number;
  goalsFor: number;
  group: string;
  points: number;
  team: string;
};

type KnockoutMatchup = {
  awayTeam: string;
  group: string;
  homeTeam: string;
  id: string;
  startsAt: Date | null;
};

const groupCodes = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
const knockoutRoundSpecs = [
  { count: 16, groupPrefix: "R32", idPrefix: "r32", nextGroupPrefix: "R16", nextIdPrefix: "r16" },
  { count: 8, groupPrefix: "R16", idPrefix: "r16", nextGroupPrefix: "QF", nextIdPrefix: "qf" },
  { count: 4, groupPrefix: "QF", idPrefix: "qf", nextGroupPrefix: "SF", nextIdPrefix: "sf" },
  { count: 2, groupPrefix: "SF", idPrefix: "sf", nextGroupPrefix: "FINAL", nextIdPrefix: "final" },
] as const;

const roundOf32Template: Array<readonly [string, string]> = [
  ["1E", "3D"],
  ["1I", "3F"],
  ["2A", "2B"],
  ["1F", "2C"],
  ["2K", "2L"],
  ["1H", "2J"],
  ["1D", "3B"],
  ["1G", "3I"],
  ["1C", "2F"],
  ["2E", "2I"],
  ["1A", "3E"],
  ["1L", "3K"],
  ["1J", "2H"],
  ["2D", "2G"],
  ["1B", "3J"],
  ["1K", "3L"],
];

function emptyStanding(group: string, team: string): Standing {
  return {
    goalDifference: 0,
    goalsFor: 0,
    group,
    points: 0,
    team,
  };
}

function sortStandings(a: Standing, b: Standing) {
  return (
    b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.team.localeCompare(b.team)
  );
}

function buildGroupStandings(matches: Match[]) {
  const byGroup = new Map<string, Map<string, Standing>>();
  const completedGroups = new Set<string>();

  for (const match of matches) {
    const group = byGroup.get(match.group) ?? new Map<string, Standing>();
    byGroup.set(match.group, group);
    group.set(match.teamA, group.get(match.teamA) ?? emptyStanding(match.group, match.teamA));
    group.set(match.teamB, group.get(match.teamB) ?? emptyStanding(match.group, match.teamB));
  }

  for (const groupCode of groupCodes) {
    const groupMatches = matches.filter((match) => match.group === groupCode);
    if (groupMatches.length !== 6) continue;
    if (groupMatches.every((match) => match.resultGoalsA !== null && match.resultGoalsB !== null)) {
      completedGroups.add(groupCode);
    }
  }

  for (const match of matches) {
    if (match.resultGoalsA === null || match.resultGoalsB === null) continue;
    const group = byGroup.get(match.group);
    if (!group) continue;
    const teamA = group.get(match.teamA);
    const teamB = group.get(match.teamB);
    if (!teamA || !teamB) continue;

    teamA.goalsFor += match.resultGoalsA;
    teamB.goalsFor += match.resultGoalsB;
    teamA.goalDifference += match.resultGoalsA - match.resultGoalsB;
    teamB.goalDifference += match.resultGoalsB - match.resultGoalsA;

    if (match.resultGoalsA > match.resultGoalsB) teamA.points += 3;
    else if (match.resultGoalsA < match.resultGoalsB) teamB.points += 3;
    else {
      teamA.points += 1;
      teamB.points += 1;
    }
  }

  return {
    completedGroups,
    standingsByGroup: new Map(
      Array.from(byGroup.entries()).map(([group, standings]) => [group, Array.from(standings.values()).sort(sortStandings)]),
    ),
  };
}

function normalizePair(teamA: string, teamB: string) {
  return [normalizeTeamName(teamA), normalizeTeamName(teamB)].sort().join("|");
}

function resolveRoundOf32Matchups(standingsByGroup: Map<string, Standing[]>) {
  const qualified = new Map<string, string>();
  const thirdPlaces: Standing[] = [];

  for (const groupCode of groupCodes) {
    const [first, second, third] = standingsByGroup.get(groupCode) ?? [];
    if (first) qualified.set(`1${groupCode}`, first.team);
    if (second) qualified.set(`2${groupCode}`, second.team);
    if (third) thirdPlaces.push(third);
  }

  const qualifiedThirdGroups = new Set(thirdPlaces.sort(sortStandings).slice(0, 8).map((standing) => standing.group));

  return roundOf32Template.flatMap(([homeLabel, awayLabel], index) => {
    const resolveSlot = (label: string) => {
      if (!label.startsWith("3")) return qualified.get(label);
      const group = label.slice(1);
      if (!qualifiedThirdGroups.has(group)) return undefined;
      return standingsByGroup.get(group)?.[2]?.team;
    };
    const homeTeam = resolveSlot(homeLabel);
    const awayTeam = resolveSlot(awayLabel);
    if (!homeTeam || !awayTeam) return [];
    return [{
      awayTeam,
      group: `R32-${index + 1}`,
      homeTeam,
      id: `r32-${index + 1}`,
      startsAt: getKnockoutMatchSchedule(`r32-${index + 1}`)?.startsAt ?? null,
    }];
  });
}

function getMatchWinner(match: Match) {
  if (match.winnerTeam) return match.winnerTeam;
  if (match.resultGoalsA === null || match.resultGoalsB === null || match.resultGoalsA === match.resultGoalsB) return null;
  return match.resultGoalsA > match.resultGoalsB ? match.teamA : match.teamB;
}

async function upsertKnockoutMatchups(prisma: PrismaClient, matchups: KnockoutMatchup[]) {
  if (matchups.length === 0) return 0;

  const existingKnockoutMatches = await prisma.match.findMany({
    where: {
      OR: [
        { group: { in: matchups.map((matchup) => matchup.group) } },
        ...matchups.map((matchup) => ({
          AND: [
            { teamA: { in: [matchup.homeTeam, matchup.awayTeam] } },
            { teamB: { in: [matchup.homeTeam, matchup.awayTeam] } },
          ],
        })),
      ],
    },
  });
  const existingByGroup = new Map(existingKnockoutMatches.map((match) => [match.group, match]));
  const existingPairs = new Map(existingKnockoutMatches.map((match) => [normalizePair(match.teamA, match.teamB), match]));
  let materialized = 0;

  for (const matchup of matchups) {
    const matchupPair = normalizePair(matchup.homeTeam, matchup.awayTeam);
    const existingByPair = existingPairs.get(matchupPair);
    const existingByTargetGroup = existingByGroup.get(matchup.group);
    const targetGroupHasSamePair = existingByTargetGroup && normalizePair(existingByTargetGroup.teamA, existingByTargetGroup.teamB) === matchupPair;
    const existing = existingByPair ?? (targetGroupHasSamePair ? existingByTargetGroup : undefined);

    if (!existing && existingByTargetGroup && !targetGroupHasSamePair && existingByTargetGroup.resultGoalsA === null && existingByTargetGroup.resultGoalsB === null) {
      await prisma.match.delete({ where: { id: existingByTargetGroup.id } });
    }

    if (existing) {
      if (existingByPair && existingByTargetGroup && existingByPair.id !== existingByTargetGroup.id && existingByTargetGroup.resultGoalsA === null && existingByTargetGroup.resultGoalsB === null) {
        await prisma.match.delete({ where: { id: existingByTargetGroup.id } });
      }

      if (existing.resultGoalsA !== null || existing.resultGoalsB !== null) {
        if (existing.group !== matchup.group || existing.startsAt?.getTime() !== matchup.startsAt?.getTime()) {
          await prisma.match.updateMany({
            where: { id: existing.id },
            data: {
              group: matchup.group,
              startsAt: matchup.startsAt,
            },
          });
        }
        continue;
      }

      const updated = await prisma.match.updateMany({
        where: { id: existing.id },
        data: {
          group: matchup.group,
          startsAt: matchup.startsAt,
          status: "scheduled",
          teamA: matchup.homeTeam,
          teamB: matchup.awayTeam,
        },
      });
      if (updated.count === 0) {
        await prisma.match.create({
          data: {
            group: matchup.group,
            startsAt: matchup.startsAt,
            status: "scheduled",
            teamA: matchup.homeTeam,
            teamB: matchup.awayTeam,
          },
        });
        materialized += 1;
      }
      continue;
    }

    await prisma.match.create({
      data: {
        group: matchup.group,
        startsAt: matchup.startsAt,
        status: "scheduled",
        teamA: matchup.homeTeam,
        teamB: matchup.awayTeam,
      },
    });
    materialized += 1;
  }

  return materialized;
}

async function materializeRoundOf32Matches(prisma: PrismaClient) {
  const groupMatches = await prisma.match.findMany({
    where: { group: { in: groupCodes } },
  });
  const { completedGroups, standingsByGroup } = buildGroupStandings(groupMatches);
  if (completedGroups.size < groupCodes.length) return 0;

  const matchups = resolveRoundOf32Matchups(standingsByGroup);
  return upsertKnockoutMatchups(prisma, matchups);
}

async function materializeNextKnockoutRound(prisma: PrismaClient, spec: typeof knockoutRoundSpecs[number]) {
  const sourceMatches = await prisma.match.findMany({
    where: { group: { startsWith: `${spec.groupPrefix}-` } },
    orderBy: { group: "asc" },
  });
  if (sourceMatches.length < spec.count) return 0;

  const sourceByNumber = new Map(
    sourceMatches.flatMap((match) => {
      const number = Number(match.group.split("-")[1]);
      return Number.isInteger(number) ? [[number, match] as const] : [];
    }),
  );
  const matchups: KnockoutMatchup[] = [];

  for (let index = 1; index <= spec.count; index += 2) {
    const homeSource = sourceByNumber.get(index);
    const awaySource = sourceByNumber.get(index + 1);
    if (!homeSource || !awaySource) continue;

    const homeWinner = getMatchWinner(homeSource);
    const awayWinner = getMatchWinner(awaySource);
    if (!homeWinner || !awayWinner) continue;

    const nextNumber = Math.floor(index / 2) + 1;
    const nextId = `${spec.nextIdPrefix}-${nextNumber}`;
    matchups.push({
      awayTeam: awayWinner,
      group: `${spec.nextGroupPrefix}-${nextNumber}`,
      homeTeam: homeWinner,
      id: nextId,
      startsAt: getKnockoutMatchSchedule(nextId)?.startsAt ?? null,
    });
  }

  return upsertKnockoutMatchups(prisma, matchups);
}

export async function materializeKnockoutMatches(prisma: PrismaClient) {
  let materialized = await materializeRoundOf32Matches(prisma);

  for (const spec of knockoutRoundSpecs) {
    materialized += await materializeNextKnockoutRound(prisma, spec);
  }

  return materialized;
}
