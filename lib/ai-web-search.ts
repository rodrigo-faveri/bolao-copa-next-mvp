import type { NewsItem } from "./news";
import { getKnowledgeQueryTerms } from "./knowledge";

type SerpApiSearchResult = {
  date?: string;
  link?: string;
  position?: number;
  snippet?: string;
  source?: string;
  title?: string;
};

type SerpApiSearchPayload = {
  news_results?: SerpApiSearchResult[];
  organic_results?: SerpApiSearchResult[];
  error?: string;
};

const defaultAllowedDomains = [
  "fifa.com",
  "ge.globo.com",
  "espn.com.br",
  "lance.com.br",
  "uol.com.br",
  "terra.com.br",
  "cnnbrasil.com.br",
];

const footballTerms = [
  "copa",
  "copa do mundo",
  "fifa",
  "futebol",
  "selecao",
  "seleção",
  "jogo",
  "partida",
  "grupo",
  "classificacao",
  "classificação",
  "palpite",
  "resultado",
  "convocacao",
  "convocação",
  "lesao",
  "lesão",
  "titular",
  "escalação",
  "escalacao",
];

const cacheStore = globalThis as typeof globalThis & {
  __bolaoAiWebSearchCache?: Map<string, { expiresAt: number; items: NewsItem[] }>;
};

const cache = cacheStore.__bolaoAiWebSearchCache ?? new Map<string, { expiresAt: number; items: NewsItem[] }>();
cacheStore.__bolaoAiWebSearchCache = cache;

function splitEnvList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function readPositiveInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isAiWebSearchEnabled() {
  return process.env.AI_WEB_SEARCH_ENABLED === "true" && Boolean(process.env.SERPAPI_KEY);
}

export function getAiWebSearchAllowedDomains() {
  const configured = splitEnvList(process.env.AI_WEB_SEARCH_ALLOWED_DOMAINS);
  return configured.length > 0 ? configured : defaultAllowedDomains;
}

function hostnameFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isAllowedDomain(url: string, allowedDomains: string[]) {
  const hostname = hostnameFromUrl(url);
  if (!hostname) return false;
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function isFootballScoped(question: string) {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return footballTerms.some((term) => normalized.includes(term.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()));
}

function buildScopedQuery(question: string, allowedDomains: string[], focusTerms: string[] = []) {
  const terms = Array.from(new Set([
    ...getKnowledgeQueryTerms(question),
    ...focusTerms.flatMap((term) => getKnowledgeQueryTerms(term)),
  ])).slice(0, 12);
  const safeQuestion = terms.length > 0 ? terms.join(" ") : question.slice(0, 120);
  const domainClause = allowedDomains.map((domain) => `site:${domain}`).join(" OR ");
  return `(${safeQuestion}) (Copa do Mundo 2026 OR futebol OR FIFA OR selecao OR escalacao OR lesao) (${domainClause})`;
}

function normalizeDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toNewsItem(item: SerpApiSearchResult, sourceFallback: string): NewsItem | null {
  if (!item.title || !item.link) return null;
  const source = item.source || hostnameFromUrl(item.link) || sourceFallback;
  return {
    description: item.snippet ?? "",
    link: item.link,
    publishedAt: normalizeDate(item.date),
    source: `Web: ${source}`,
    title: item.title,
  };
}

export async function searchFootballWeb({
  focusTerms = [],
  forceFootballScope = false,
  question,
}: {
  focusTerms?: string[];
  forceFootballScope?: boolean;
  question: string;
}) {
  if (!isAiWebSearchEnabled()) {
    return { items: [] as NewsItem[], reason: "disabled" as const };
  }
  if (!forceFootballScope && !isFootballScoped(question)) {
    return { items: [] as NewsItem[], reason: "out_of_scope" as const };
  }

  const allowedDomains = getAiWebSearchAllowedDomains();
  const maxResults = Math.min(readPositiveInt("AI_WEB_SEARCH_MAX_RESULTS", 5), 10);
  const cacheMinutes = Math.min(readPositiveInt("AI_WEB_SEARCH_CACHE_MINUTES", 60), 24 * 60);
  const query = buildScopedQuery(question, allowedDomains, focusTerms);
  const cacheKey = `${allowedDomains.join(",")}:${maxResults}:${focusTerms.join("|")}:${query}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { items: cached.items, reason: "cache" as const };
  }

  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "pt-br");
  url.searchParams.set("gl", "br");
  url.searchParams.set("num", String(maxResults));
  url.searchParams.set("api_key", process.env.SERPAPI_KEY!);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`SerpAPI web search returned HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as SerpApiSearchPayload;
  if (payload.error) throw new Error(payload.error);

  const candidates = [...(payload.news_results ?? []), ...(payload.organic_results ?? [])];
  const byLink = new Map<string, NewsItem>();
  for (const item of candidates) {
    const newsItem = toNewsItem(item, "SerpAPI");
    if (!newsItem || !isAllowedDomain(newsItem.link, allowedDomains)) continue;
    if (!byLink.has(newsItem.link)) byLink.set(newsItem.link, newsItem);
  }

  const items = Array.from(byLink.values()).slice(0, maxResults);
  cache.set(cacheKey, {
    expiresAt: Date.now() + cacheMinutes * 60 * 1000,
    items,
  });

  return { items, reason: "serpapi" as const };
}
