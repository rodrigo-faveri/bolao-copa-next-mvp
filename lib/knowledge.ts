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

function hashContent(value: string) {
  return createHash("sha256").update(value).digest("hex");
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

async function upsertKnowledgeDocument(prisma: PrismaTransactionLike, input: KnowledgeInput) {
  const contentHash = hashContent(input.content);

  await prisma.knowledgeDocument.upsert({
    where: { source_sourceId: { source: input.source, sourceId: input.sourceId } },
    update: {
      content: input.content,
      contentHash,
      metadata: input.metadata,
      title: input.title,
      url: input.url,
    },
    create: {
      content: input.content,
      contentHash,
      metadata: input.metadata,
      source: input.source,
      sourceId: input.sourceId,
      title: input.title,
      url: input.url,
    },
  });
}

export async function indexNewsKnowledge(prisma: PrismaTransactionLike, news: NewsItem[]) {
  await Promise.all(news.map((item) => upsertKnowledgeDocument(prisma, {
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

  await Promise.all(matches.map((match) => {
    const result = match.resultGoalsA !== null && match.resultGoalsB !== null
      ? `Resultado: ${match.resultGoalsA} x ${match.resultGoalsB}`
      : "Resultado pendente";
    const startsAt = match.startsAt?.toISOString() ?? "Horario a definir";
    return upsertKnowledgeDocument(prisma, {
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
    });
  }));
}

export async function retrieveKnowledge(prisma: PrismaTransactionLike, question: string, limit = 8) {
  const terms = getKnowledgeQueryTerms(question);
  if (terms.length === 0) return [];

  const documents = await prisma.knowledgeDocument.findMany({
    orderBy: { updatedAt: "desc" },
    take: 220,
  });

  return documents
    .map((document) => {
      const score = scoreKnowledgeText(`${document.title}\n${document.content}\n${document.source}`, terms);
      return {
        content: document.content,
        label: `${document.source}: ${document.title}`,
        score,
        source: document.source,
        title: document.title,
        url: document.url,
      };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
