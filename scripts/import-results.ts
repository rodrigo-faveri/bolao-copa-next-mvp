import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { MAX_GOALS } from "../lib/prediction";
import { setMatchResult } from "../lib/results";

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

function readCsv(filePath: string) {
  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").trim();
  if (!content) return [];

  const [headerLine, ...lines] = content.split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines
    .filter((line) => line.trim())
    .map((line) => {
      const values = splitCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    });
}

const ResultRowSchema = z.object({
  match_id: z.string().trim().optional(),
  group: z.string().trim().optional(),
  team_a: z.string().trim().optional(),
  team_b: z.string().trim().optional(),
  goals_a: z.coerce.number().int().min(0).max(MAX_GOALS),
  goals_b: z.coerce.number().int().min(0).max(MAX_GOALS),
});

async function resolveMatch(row: z.infer<typeof ResultRowSchema>) {
  if (row.match_id) {
    return prisma.match.findUnique({ where: { id: row.match_id }, select: { id: true, teamA: true, teamB: true } });
  }

  if (!row.group || !row.team_a || !row.team_b) return null;

  return prisma.match.findUnique({
    where: { group_teamA_teamB: { group: row.group, teamA: row.team_a, teamB: row.team_b } },
    select: { id: true, teamA: true, teamB: true },
  });
}

async function main() {
  const filePath = path.resolve(process.argv[2] ?? path.join("data", "results.csv"));
  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo nao encontrado: ${filePath}`);
    console.error("Uso: npm run result:import -- data/results.csv");
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;
  let predictionsUpdated = 0;

  for (const [index, row] of readCsv(filePath).entries()) {
    const parsed = ResultRowSchema.safeParse(row);
    if (!parsed.success) {
      skipped += 1;
      console.warn(`Linha ${index + 2} ignorada: formato invalido.`);
      continue;
    }

    const match = await resolveMatch(parsed.data);
    if (!match) {
      skipped += 1;
      console.warn(`Linha ${index + 2} ignorada: partida nao encontrada.`);
      continue;
    }

    const result = await prisma.$transaction((transaction) =>
      setMatchResult(transaction, {
        allowFutureResult: true,
        matchId: match.id,
        goalsA: parsed.data.goals_a,
        goalsB: parsed.data.goals_b,
      }),
    );

    imported += 1;
    predictionsUpdated += result.predictionsUpdated;
    console.info(`${match.teamA} x ${match.teamB}: ${parsed.data.goals_a} x ${parsed.data.goals_b}`);
  }

  console.info(`Importacao concluida: ${imported} resultado(s), ${predictionsUpdated} palpite(s) recalculado(s), ${skipped} linha(s) ignorada(s).`);
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
