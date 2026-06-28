import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { NewsItem } from "./news";
import { getTeamDisplayName } from "./teams";

type PrismaTransactionLike = PrismaClient;

type KnowledgeInput = {
  content: string;
  metadata?: Prisma.InputJsonObject;
  source: string;
  sourceId: string;
  title: string;
  url?: string | null;
};

export type RetrievedKnowledge = {
  content: string;
  label: string;
  score: number;
  source: string;
  title: string;
  url?: string | null;
};

export type KnowledgeAuditItem = {
  combinedScore: number;
  content: string;
  lexicalScore: number;
  semanticScore: number;
  source: string;
  sourceId: string;
  title: string;
  updatedAt: Date;
  url: string | null;
};

export type KnowledgeAuditResult = {
  combined: KnowledgeAuditItem[];
  embeddedDocumentsInSample: number;
  embeddingError: string | null;
  embeddingsConfigured: boolean;
  lexical: KnowledgeAuditItem[];
  query: string;
  queryEmbeddingAvailable: boolean;
  sampleSize: number;
  semantic: KnowledgeAuditItem[];
  terms: string[];
  totalDocuments: number;
};

function hashContent(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function embeddingsEnabled() {
  return Boolean(process.env.EMBEDDINGS_API_KEY);
}

function embeddingText(input: Pick<KnowledgeInput, "content" | "source" | "title">) {
  return [`Fonte: ${input.source}`, `Titulo: ${input.title}`, input.content].join("\n").slice(0, 8000);
}

async function createEmbeddings(texts: string[]) {
  if (!embeddingsEnabled() || texts.length === 0) return [];

  const baseUrl = process.env.EMBEDDINGS_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.EMBEDDINGS_MODEL || "text-embedding-3-small";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/embeddings`, {
    body: JSON.stringify({ input: texts, model }),
    headers: {
      Authorization: `Bearer ${process.env.EMBEDDINGS_API_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) throw new Error(`Embeddings API returned ${response.status}`);
  const payload: unknown = await response.json();
  if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error("Embeddings API returned invalid payload.");
  }

  const embeddings = (payload as { data: Array<{ embedding?: unknown }> }).data.map((item) => item.embedding);
  if (embeddings.length !== texts.length || embeddings.some((embedding) => !Array.isArray(embedding) || embedding.some((value) => typeof value !== "number"))) {
    throw new Error("Embeddings API returned invalid vectors.");
  }

  return embeddings as number[][];
}

function isNumberVector(value: Prisma.JsonValue | null): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number");
}

function cosineSimilarity(a: number[], b: number[]) {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function getKnowledgeQueryTerms(question: string) {
  const stopWords = new Set([
    "para",
    "como",
    "qual",
    "quais",
    "sobre",
    "voce",
    "meu",
    "minha",
    "dos",
    "das",
    "uma",
    "com",
    "que",
    "the",
    "and",
    "hoje",
    "jogo",
    "jogos",
  ]);

  return normalize(question)
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((term) => term.length >= 3 && !stopWords.has(term))
    .slice(0, 16);
}

export function scoreKnowledgeText(text: string, terms: string[]) {
  const normalizedText = normalize(text);
  return terms.reduce((score, term) => score + (normalizedText.includes(term) ? 1 : 0), 0);
}

async function upsertKnowledgeDocuments(prisma: PrismaTransactionLike, inputs: KnowledgeInput[]) {
  if (inputs.length === 0) return;

  const documents = inputs.map((input) => ({
    ...input,
    contentHash: hashContent(input.content),
  }));
  const existingDocuments = await prisma.knowledgeDocument.findMany({
    select: { contentHash: true, embedding: true, source: true, sourceId: true },
    where: {
      OR: documents.map((document) => ({ source: document.source, sourceId: document.sourceId })),
    },
  });
  const existingByKey = new Map(existingDocuments.map((document) => [`${document.source}:${document.sourceId}`, document]));
  const documentsNeedingEmbedding = documents.filter((document) => {
    if (!embeddingsEnabled()) return false;
    const existing = existingByKey.get(`${document.source}:${document.sourceId}`);
    return !existing || existing.contentHash !== document.contentHash || !isNumberVector(existing.embedding);
  });
  const embeddings = new Map<string, number[]>();

  if (documentsNeedingEmbedding.length > 0) {
    for (let index = 0; index < documentsNeedingEmbedding.length; index += 64) {
      const batch = documentsNeedingEmbedding.slice(index, index + 64);
      const vectors = await createEmbeddings(batch.map(embeddingText));
      vectors.forEach((vector, vectorIndex) => {
        const document = batch[vectorIndex];
        embeddings.set(`${document.source}:${document.sourceId}`, vector);
      });
    }
  }

  await Promise.all(documents.map((document) => {
    const embedding = embeddings.get(`${document.source}:${document.sourceId}`);
    return prisma.knowledgeDocument.upsert({
      where: { source_sourceId: { source: document.source, sourceId: document.sourceId } },
      update: {
        content: document.content,
        contentHash: document.contentHash,
        ...(embedding ? { embedding } : {}),
        metadata: document.metadata,
        title: document.title,
        url: document.url,
      },
      create: {
        content: document.content,
        contentHash: document.contentHash,
        embedding,
        metadata: document.metadata,
        source: document.source,
        sourceId: document.sourceId,
        title: document.title,
        url: document.url,
      },
    });
  }));
}

export async function indexNewsKnowledge(prisma: PrismaTransactionLike, news: NewsItem[]) {
  await upsertKnowledgeDocuments(prisma, news.map((item) => ({
    content: [item.title, item.description, item.publishedAt ? `Publicado em ${item.publishedAt}` : ""].filter(Boolean).join("\n"),
    metadata: { publishedAt: item.publishedAt, sourceName: item.source },
    source: "news",
    sourceId: item.link,
    title: item.title,
    url: item.link,
  })));
}

export async function indexMatchKnowledge(prisma: PrismaTransactionLike) {
  const matches = await prisma.match.findMany({
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
    take: 160,
  });

  await upsertKnowledgeDocuments(prisma, matches.map((match) => {
    const result = match.resultGoalsA !== null && match.resultGoalsB !== null
      ? `Resultado: ${match.resultGoalsA} x ${match.resultGoalsB}`
      : "Resultado pendente";
    const startsAt = match.startsAt?.toISOString() ?? "Horario a definir";
    return {
      content: [
        `Partida: ${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)}`,
        `Grupo/fase: ${match.group}`,
        `Horario: ${startsAt}`,
        `Status: ${match.status}`,
        result,
      ].join("\n"),
      metadata: { group: match.group, startsAt, status: match.status },
      source: "match",
      sourceId: match.id,
      title: `${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)}`,
      url: `/tempo-real/${match.id}`,
    };
  }));
}

export async function retrieveKnowledge(prisma: PrismaTransactionLike, question: string, limit = 8) {
  const terms = getKnowledgeQueryTerms(question);
  if (terms.length === 0) return [];
  const queryEmbeddings = embeddingsEnabled()
    ? await createEmbeddings([question]).catch(() => [])
    : [];
  const queryEmbedding = queryEmbeddings[0];

  const documents = await prisma.knowledgeDocument.findMany({
    orderBy: { updatedAt: "desc" },
    take: 220,
  });

  return documents
    .map((document) => {
      const lexicalScore = scoreKnowledgeText(`${document.title}\n${document.content}\n${document.source}`, terms);
      const semanticScore = queryEmbedding && isNumberVector(document.embedding)
        ? cosineSimilarity(queryEmbedding, document.embedding)
        : 0;
      return {
        content: document.content,
        label: `${document.source}: ${document.title}`,
        score: lexicalScore + semanticScore * 3,
        source: document.source,
        title: document.title,
        url: document.url,
      };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export async function auditKnowledgeRetrieval(prisma: PrismaTransactionLike, question: string, limit = 8): Promise<KnowledgeAuditResult> {
  const query = question.trim().slice(0, 240);
  const terms = getKnowledgeQueryTerms(query);
  let embeddingError: string | null = null;
  const queryEmbeddings = embeddingsEnabled() && query.length > 0
    ? await createEmbeddings([query]).catch((error) => {
      embeddingError = error instanceof Error ? error.message : "unknown";
      return [];
    })
    : [];
  const queryEmbedding = queryEmbeddings[0];
  const [totalDocuments, documents] = await Promise.all([
    prisma.knowledgeDocument.count(),
    prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
    }),
  ]);

  const scoredDocuments = documents.map((document) => {
    const lexicalScore = scoreKnowledgeText(`${document.title}\n${document.content}\n${document.source}`, terms);
    const semanticScore = queryEmbedding && isNumberVector(document.embedding)
      ? cosineSimilarity(queryEmbedding, document.embedding)
      : 0;
    return {
      combinedScore: lexicalScore + semanticScore * 3,
      content: document.content,
      lexicalScore,
      semanticScore,
      source: document.source,
      sourceId: document.sourceId,
      title: document.title,
      updatedAt: document.updatedAt,
      url: document.url,
    };
  });

  const byTitle = (a: KnowledgeAuditItem, b: KnowledgeAuditItem) => a.title.localeCompare(b.title);

  return {
    combined: scoredDocuments
      .filter((document) => document.combinedScore > 0)
      .sort((a, b) => b.combinedScore - a.combinedScore || byTitle(a, b))
      .slice(0, limit),
    embeddedDocumentsInSample: documents.filter((document) => isNumberVector(document.embedding)).length,
    embeddingError,
    embeddingsConfigured: embeddingsEnabled(),
    lexical: scoredDocuments
      .filter((document) => document.lexicalScore > 0)
      .sort((a, b) => b.lexicalScore - a.lexicalScore || byTitle(a, b))
      .slice(0, limit),
    query,
    queryEmbeddingAvailable: Boolean(queryEmbedding),
    sampleSize: documents.length,
    semantic: scoredDocuments
      .filter((document) => document.semanticScore > 0)
      .sort((a, b) => b.semanticScore - a.semanticScore || byTitle(a, b))
      .slice(0, limit),
    terms,
    totalDocuments,
  };
}
