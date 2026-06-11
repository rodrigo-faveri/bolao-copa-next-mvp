import { logger } from "./logger";

type ApiFootballFixtureResponse = {
  response?: Array<{
    fixture?: {
      id?: number;
      status?: {
        long?: string;
        short?: string;
        elapsed?: number | null;
      };
    };
    teams?: {
      home?: { name?: string };
      away?: { name?: string };
    };
    goals?: {
      home?: number | null;
      away?: number | null;
    };
  }>;
};

type ApiFootballEventsResponse = {
  response?: Array<{
    time?: { elapsed?: number | null; extra?: number | null };
    team?: { name?: string };
    player?: { name?: string };
    assist?: { name?: string };
    type?: string;
    detail?: string;
    comments?: string | null;
  }>;
};

export type LiveMatchEvent = {
  minute: string;
  title: string;
  description: string;
};

export type LiveMatchData = {
  source: "api-football" | "local";
  available: boolean;
  statusLabel?: string;
  statusShort?: string;
  elapsed?: number | null;
  goalsA?: number | null;
  goalsB?: number | null;
  events: LiveMatchEvent[];
  message?: string;
};

function apiFootballBaseUrl() {
  return process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
}

function cacheSeconds() {
  const parsed = Number(process.env.SPORTS_API_CACHE_SECONDS ?? "60");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

function eventMinute(elapsed?: number | null, extra?: number | null) {
  if (!elapsed) return "AGORA";
  return extra ? `${elapsed}+${extra}'` : `${elapsed}'`;
}

function describeEvent(event: NonNullable<ApiFootballEventsResponse["response"]>[number]) {
  const player = event.player?.name;
  const assist = event.assist?.name;
  const team = event.team?.name;
  const detail = event.detail ?? event.type ?? "Lance";
  const pieces = [player, team ? `(${team})` : null, assist ? `Assistencia: ${assist}` : null, event.comments].filter(Boolean);

  return {
    minute: eventMinute(event.time?.elapsed, event.time?.extra),
    title: detail,
    description: pieces.length > 0 ? pieces.join(" - ") : "Lance registrado pela API esportiva.",
  };
}

async function apiFootballFetch<T>(path: string): Promise<T | null> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) return null;

  const response = await fetch(`${apiFootballBaseUrl()}${path}`, {
    headers: { "x-apisports-key": apiKey },
    next: { revalidate: cacheSeconds() },
  });

  if (!response.ok) {
    logger.warn("sports_api_request_failed", { path, status: response.status });
    return null;
  }

  return response.json() as Promise<T>;
}

export async function getApiFootballLiveMatch(fixtureId: number | null | undefined): Promise<LiveMatchData> {
  if (!fixtureId) {
    return {
      source: "local",
      available: false,
      events: [],
      message: "Partida sem fixture externo configurado.",
    };
  }

  if (!process.env.API_FOOTBALL_KEY) {
    return {
      source: "local",
      available: false,
      events: [],
      message: "API-Football nao configurada.",
    };
  }

  const [fixturePayload, eventsPayload] = await Promise.all([
    apiFootballFetch<ApiFootballFixtureResponse>(`/fixtures?id=${fixtureId}`),
    apiFootballFetch<ApiFootballEventsResponse>(`/fixtures/events?fixture=${fixtureId}`),
  ]);

  const fixture = fixturePayload?.response?.[0];
  if (!fixture) {
    return {
      source: "api-football",
      available: false,
      events: [],
      message: "Fixture nao encontrado na API-Football.",
    };
  }

  const events = (eventsPayload?.response ?? []).map(describeEvent).reverse();

  return {
    source: "api-football",
    available: true,
    statusLabel: fixture.fixture?.status?.long,
    statusShort: fixture.fixture?.status?.short,
    elapsed: fixture.fixture?.status?.elapsed ?? null,
    goalsA: fixture.goals?.home ?? null,
    goalsB: fixture.goals?.away ?? null,
    events,
  };
}
