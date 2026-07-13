import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { auditKnowledgeRetrieval, getKnowledgeQueryTerms } from "../lib/knowledge";

type EvaluationCase = {
  expectedSources?: string[];
  expectedTerms?: string[];
  id: string;
  minimumScore?: number;
  question: string;
};

type EvaluationResult = {
  id: string;
  missingSources: string[];
  missingTerms: string[];
  notes: string[];
  passed: boolean;
  score: number;
};

const prisma = new PrismaClient();

function shouldPersist() {
  return process.argv.includes("--persist") || process.env.AI_EVALUATION_PERSIST === "true";
}

function readPositiveNumber(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function gitValue(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function readCases() {
  const filePath = path.join(process.cwd(), "data", "ai-evaluation-cases.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error("data/ai-evaluation-cases.json precisa ser uma lista.");

  return parsed.map((item) => {
    if (typeof item !== "object" || item === null) throw new Error("Caso de avaliacao invalido.");
    const candidate = item as Partial<EvaluationCase>;
    if (!candidate.id || !candidate.question) throw new Error("Cada caso precisa de id e question.");
    return {
      expectedSources: candidate.expectedSources ?? [],
      expectedTerms: candidate.expectedTerms ?? [],
      id: candidate.id,
      minimumScore: candidate.minimumScore ?? 50,
      question: candidate.question,
    };
  });
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function scoreCase(testCase: EvaluationCase, observed: {
  combinedCount: number;
  embeddedDocumentsInSample: number;
  embeddingsConfigured: boolean;
  queryEmbeddingAvailable: boolean;
  retrievedSources: Set<string>;
  terms: string[];
  totalDocuments: number;
}) {
  const expectedTerms = testCase.expectedTerms ?? [];
  const expectedSources = testCase.expectedSources ?? [];
  const normalizedTerms = new Set(observed.terms.map(normalize));
  const missingTerms = expectedTerms.filter((term) => !normalizedTerms.has(normalize(term)));
  const missingSources = expectedSources.filter((source) => !observed.retrievedSources.has(source));
  const notes: string[] = [];
  let score = 100;

  score -= missingTerms.length * 12;
  score -= missingSources.length * 18;
  if (observed.combinedCount === 0) {
    score -= 35;
    notes.push("Nenhuma fonte recuperada no ranking combinado.");
  }
  if (observed.totalDocuments === 0) {
    score -= 40;
    notes.push("KnowledgeDocument esta vazio. Rode indexacao/seed antes da avaliacao.");
  }
  if (observed.embeddingsConfigured && !observed.queryEmbeddingAvailable) {
    score -= 15;
    notes.push("Embeddings estao configurados, mas a consulta vetorial falhou.");
  }
  if (!observed.embeddingsConfigured) {
    notes.push("Embeddings nao configurados; avaliacao considera fallback textual.");
  } else if (observed.embeddedDocumentsInSample === 0) {
    score -= 20;
    notes.push("Embeddings configurados, mas nenhum documento da amostra possui vetor.");
  }

  const finalScore = Math.max(0, Math.min(100, score));
  return {
    missingSources,
    missingTerms,
    notes,
    passed: finalScore >= (testCase.minimumScore ?? 50),
    score: finalScore,
  };
}

async function evaluateCase(testCase: EvaluationCase): Promise<EvaluationResult> {
  const audit = await auditKnowledgeRetrieval(prisma, testCase.question, 8);
  const retrievedSources = new Set(audit.combined.map((item) => item.source));
  const scoring = scoreCase(testCase, {
    combinedCount: audit.combined.length,
    embeddedDocumentsInSample: audit.embeddedDocumentsInSample,
    embeddingsConfigured: audit.embeddingsConfigured,
    queryEmbeddingAvailable: audit.queryEmbeddingAvailable,
    retrievedSources,
    terms: audit.terms.length > 0 ? audit.terms : getKnowledgeQueryTerms(testCase.question),
    totalDocuments: audit.totalDocuments,
  });

  return {
    id: testCase.id,
    ...scoring,
  };
}

async function main() {
  const cases = readCases();
  const results = await Promise.all(cases.map(evaluateCase));
  const average = results.reduce((sum, result) => sum + result.score, 0) / Math.max(1, results.length);
  const failed = results.filter((result) => !result.passed);
  const passed = results.length - failed.length;

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.info(`${status} ${result.id}: ${result.score}/100`);
    if (result.missingTerms.length > 0) console.info(`  termos ausentes: ${result.missingTerms.join(", ")}`);
    if (result.missingSources.length > 0) console.info(`  fontes ausentes: ${result.missingSources.join(", ")}`);
    for (const note of result.notes) console.info(`  nota: ${note}`);
  }

  console.info(`Media geral: ${average.toFixed(1)}/100 (${results.length} caso(s))`);

  if (shouldPersist()) {
    const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
    const previousRun = await prisma.aiEvaluationRun.findFirst({
      orderBy: { createdAt: "desc" },
      select: { averageScore: true, id: true },
    });
    const previousAverageScore = previousRun?.averageScore ?? null;
    const scoreDelta = previousAverageScore === null ? null : average - previousAverageScore;
    const alertThreshold = readPositiveNumber("AI_EVALUATION_ALERT_DROP_POINTS", 8);
    const qualityAlert = scoreDelta !== null && previousAverageScore !== null && scoreDelta <= -alertThreshold
      ? `Queda de ${Math.abs(scoreDelta).toFixed(1)} ponto(s) contra a avaliacao anterior (${previousAverageScore.toFixed(1)} -> ${average.toFixed(1)}).`
      : failed.length > 0
        ? `${failed.length} caso(s) abaixo do minimo nesta avaliacao.`
        : null;

    const run = await prisma.aiEvaluationRun.create({
      data: {
        averageScore: average,
        embeddingsEnabled: Boolean(process.env.EMBEDDINGS_API_KEY),
        failedCases: failed.length,
        gitBranch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
        gitCommit: gitValue(["rev-parse", "--short", "HEAD"]),
        passedCases: passed,
        previousAverageScore,
        qualityAlert,
        scoreDelta,
        totalCases: results.length,
        webSearchEnabled: process.env.AI_WEB_SEARCH_ENABLED === "true",
        caseResults: {
          create: results.map((result) => {
            const testCase = caseById.get(result.id);
            return {
              caseId: result.id,
              minimumScore: testCase?.minimumScore ?? 50,
              missingSources: result.missingSources,
              missingTerms: result.missingTerms,
              notes: result.notes,
              passed: result.passed,
              question: testCase?.question ?? result.id,
              score: result.score,
            };
          }),
        },
      },
    });

    console.info(`Historico salvo no banco: ${run.id}`);
    if (qualityAlert) console.warn(`ALERTA IA: ${qualityAlert}`);
  }

  if (failed.length > 0) {
    console.error(`${failed.length} avaliacao(oes) abaixo do minimo.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
