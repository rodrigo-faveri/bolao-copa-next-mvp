import type { PrismaClient } from "@prisma/client";
import { logger } from "./logger";
import { namesLookRelated } from "./teams";

type SerpApiCalendarGame = {
  date?: string;
  game_date?: string;
  game_spotlight?: unknown;
  status?: string;
  teams?: Array<{ name?: string }>;
  time?: string;
  tournament?: string;
  venue?: string;
};

type SerpApiCalendarResponse = {
  error?: string;
  sports_results?: {
    game_spotlight?: SerpApiCalendarGame;
    games?: SerpApiCalendarGame[];
  };
};

type CalendarCandidate = {
  rawDate: string | null;
  rawTime: string | null;
  startsAt: Date | null;
  teamA: string;
  teamB: string;
};

const scheduleQueries = [
  "Copa do Mundo 2026 jogos de hoje mata-mata",
  "World Cup 2026 knockout schedule today",
  "World Cup 2026 round of 32 schedule",
];

function parseMonth(value: string) {
  const normalized = value.toLowerCase();
  const months: Record<string, number> = {
    apr: 3,
    abril: 3,
    ago: 7,
    aug: 7,
    agosto: 7,
    dez: 11,
    dec: 11,
    dezembro: 11,
    fev: 1,
    feb: 1,
    fevereiro: 1,
    jan: 0,
    janeiro: 0,
    jul: 6,
    julho: 6,
    jun: 5,
    junho: 5,
    mai: 4,
    maio: 4,
    mar: 2,
    marco: 2,
    mar\u00e7o: 2,
    nov: 10,
    novembro: 10,
    oct: 9,
    outubro: 9,
    out: 9,
    sep: 8,
    setembro: 8,
    set: 8,
  };

  return months[normalized.slice(0, 3)] ?? months[normalized] ?? null;
}

function parseHour(rawTime: string | null) {
  if (!rawTime) return null;
  const normalized = rawTime.trim().toLowerCase();
  const match = normalized.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const suffix = match[3];

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  return { hour, minute };
}

function getSaoPauloDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { day: get("day"), month: get("month") - 1, year: get("year") };
}

function parseRelativeGameDate(rawDate: string, rawTime: string | null) {
  const normalized = rawDate
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const dayOffset = /\b(hoje|today)\b/.test(normalized)
    ? 0
    : /\b(amanha|tomorrow)\b/.test(normalized)
      ? 1
      : null;
  if (dayOffset === null) return null;

  const timeText = rawTime ?? rawDate;
  const time = parseHour(timeText);
  if (!time) return null;

  const { hour, minute } = time;
  const { day, month, year } = getSaoPauloDateParts();
  const date = new Date(Date.UTC(year, month, day + dayOffset, hour + 3, minute));
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseGameDate(rawDate: string | null, rawTime: string | null) {
  if (!rawDate) return null;
  const relativeDate = parseRelativeGameDate(rawDate, rawTime);
  if (relativeDate) return relativeDate;

  if (/\d{4}/.test(rawDate)) {
    const isoCandidate = new Date(rawDate);
    if (Number.isFinite(isoCandidate.getTime())) return isoCandidate;
  }

  const monthDay = rawDate.match(/([A-Za-z\u00c0-\u017F]{3,})\.?\s+(\d{1,2})/);
  const dayMonth = rawDate.match(/(\d{1,2})\s+(?:de\s+)?([A-Za-z\u00c0-\u017F]{3,})/);
  const match = monthDay
    ? { day: Number(monthDay[2]), month: parseMonth(monthDay[1]) }
    : dayMonth
      ? { day: Number(dayMonth[1]), month: parseMonth(dayMonth[2]) }
      : null;
  if (!match || match.month === null || !Number.isInteger(match.day)) return null;

  const time = parseHour(rawTime ?? rawDate);
  if (!time) return null;

  const { hour, minute } = time;
  return new Date(Date.UTC(2026, match.month, match.day, hour + 3, minute));
}

function extractCandidates(payload: SerpApiCalendarResponse) {
  const games = [
    ...(payload.sports_results?.game_spotlight ? [payload.sports_results.game_spotlight] : []),
    ...(payload.sports_results?.games ?? []),
  ];

  return games.flatMap((game): CalendarCandidate[] => {
    const teams = game.teams ?? [];
    if (teams.length < 2 || !teams[0]?.name || !teams[1]?.name) return [];
    const rawDate = game.date ?? game.game_date ?? null;
    const rawTime = game.time ?? null;
    return [{
      rawDate,
      rawTime,
      startsAt: parseGameDate(rawDate, rawTime),
      teamA: teams[0].name,
      teamB: teams[1].name,
    }];
  });
}

async function fetchCalendarCandidates(apiKey: string) {
  const candidates: CalendarCandidate[] = [];

  for (const query of scheduleQueries) {
    const url = new URL("https://serpapi.com/search");
    url.searchParams.set("engine", "google");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "pt-br");
    url.searchParams.set("gl", "br");
    url.searchParams.set("api_key", apiKey);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`SerpAPI calendario retornou HTTP ${response.status}.`);
    const payload = (await response.json()) as SerpApiCalendarResponse;
    if (payload.error) throw new Error(payload.error);
    candidates.push(...extractCandidates(payload));
  }

  return candidates;
}

function findLocalMatch<TMatch extends { resultGoalsA: number | null; resultGoalsB: number | null; teamA: string; teamB: string }>(
  candidate: CalendarCandidate,
  matches: TMatch[],
) {
  return matches.find((match) =>
    (
      namesLookRelated(candidate.teamA, match.teamA)
      && namesLookRelated(candidate.teamB, match.teamB)
    )
    || (
      namesLookRelated(candidate.teamA, match.teamB)
      && namesLookRelated(candidate.teamB, match.teamA)
    ),
  );
}

export async function reconcileSerpApiCalendar({
  prisma,
}: {
  prisma: PrismaClient;
}) {
  if (process.env.SERPAPI_CALENDAR_RECONCILE === "false") return { checked: 0, updated: 0 };
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return { checked: 0, updated: 0 };

  try {
    const candidates = await fetchCalendarCandidates(apiKey);
    if (candidates.length === 0) return { checked: 0, updated: 0 };

    const localMatches = await prisma.match.findMany({
      where: {
        resultGoalsA: null,
        resultGoalsB: null,
        startsAt: { not: null },
      },
    });
    let updated = 0;

    for (const candidate of candidates) {
      if (!candidate.startsAt) continue;
      const match = findLocalMatch(candidate, localMatches);
      if (!match) continue;

      const currentTime = match.startsAt?.getTime();
      const nextTime = candidate.startsAt.getTime();
      if (currentTime && Math.abs(currentTime - nextTime) < 10 * 60 * 1000) continue;

      await prisma.match.update({
        where: { id: match.id },
        data: { startsAt: candidate.startsAt },
      });
      updated += 1;
      logger.info("serpapi_calendar_match_updated", {
        group: match.group,
        matchId: match.id,
        rawDate: candidate.rawDate,
        rawTime: candidate.rawTime,
        teamA: match.teamA,
        teamB: match.teamB,
      });
    }

    return { checked: candidates.length, updated };
  } catch (error) {
    logger.warn("serpapi_calendar_reconcile_failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return { checked: 0, updated: 0 };
  }
}
