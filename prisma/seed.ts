import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

function numberOrNull(value?: string) {
  if (!value) return null;
  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOrNull(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  const [headerLine, ...lines] = content.split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines.map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function matchKey(group: string, teamA: string, teamB: string) {
  return `${group}::${teamA}::${teamB}`;
}

async function main() {
  const filePath = path.join(process.cwd(), "data", "matches.csv");
  const schedulePath = path.join(process.cwd(), "data", "match-schedule.csv");
  const scheduleRows = fs.existsSync(schedulePath) ? readCsv(schedulePath) : [];
  const scheduleByMatch = new Map(
    scheduleRows.map((row) => [
      matchKey(row.group, row.team_a, row.team_b),
      dateOrNull(row.starts_at),
    ]),
  );
  let imported = 0;

  for (const row of readCsv(filePath)) {
    const group = row.group;
    const teamA = row.team_a;
    const teamB = row.team_b;
    if (!group || !teamA || !teamB) continue;

    const data = {
      probabilityTeamA: numberOrNull(row.prob_team_a_win_pct),
      probabilityDraw: numberOrNull(row.prob_draw_pct),
      probabilityTeamB: numberOrNull(row.prob_team_b_win_pct),
      expectedGoals: numberOrNull(row.expected_total_goals),
      mostLikelyScore: row.most_likely_score || null,
      topScores: row.top_3_scores || null,
      startsAt: dateOrNull(row.starts_at)
        ?? scheduleByMatch.get(matchKey(group, teamA, teamB))
        ?? scheduleByMatch.get(matchKey(group, teamB, teamA))
        ?? null,
    };

    await prisma.match.upsert({
      where: { group_teamA_teamB: { group, teamA, teamB } },
      update: data,
      create: { group, teamA, teamB, ...data },
    });
    imported += 1;
  }

  console.info(`${imported} partidas importadas.`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
