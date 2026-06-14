import { getTeamDisplayName, namesLookRelated, normalizeTeamName } from "./teams";

export type SerpApiMatchResult = {
  goalsA: number;
  goalsB: number;
  events: Array<{ minute: string; title: string; description: string }>;
  sourceStatus: string;
  query: string;
};

export type SerpApiMatchDebug = {
  query: string;
  games: Array<{
    status: string | null;
    teams: Array<{ name: string | null; score: string | null }>;
  }>;
};

type SerpApiSportsGame = {
  status?: string;
  tournament?: string;
  teams?: Array<{
    name?: string;
    score?: string;
    goal_summary?: SerpApiGoalSummary[];
    red_cards_summary?: SerpApiCardSummary[];
  }>;
};

type SerpApiSportsResponse = {
  sports_results?: {
    game_spotlight?: SerpApiSportsGame;
    games?: SerpApiSportsGame[];
  };
  error?: string;
};

type SerpApiGoalSummary = {
  player?: { name?: string };
  goals?: Array<{ in_game_time?: { minute?: number; stoppage?: number } }>;
};

type SerpApiCardSummary = {
  player?: { name?: string };
  cards?: Array<{ in_game_time?: { minute?: number; stoppage?: number } }>;
};

function parseScore(value?: string) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d-]/g, ""));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isFinalStatus(status?: string) {
  if (!status) return false;
  const normalized = normalizeTeamName(status);
  return ["ft", "full time", "final", "finished", "encerrado", "fim"].some((item) => normalized.includes(item));
}

function findMatchingGame(payload: SerpApiSportsResponse, teamA: string, teamB: string) {
  const games = [
    ...(payload.sports_results?.game_spotlight ? [payload.sports_results.game_spotlight] : []),
    ...(payload.sports_results?.games ?? []),
  ];

  return games.find((game) => {
    const teams = game.teams ?? [];
    if (teams.length < 2) return false;

    const [home, away] = teams;
    const homeName = home.name ?? "";
    const awayName = away.name ?? "";

    return (
      (namesLookRelated(teamA, homeName) && namesLookRelated(teamB, awayName))
      || (namesLookRelated(teamA, awayName) && namesLookRelated(teamB, homeName))
    );
  });
}

function formatMinute(time?: { minute?: number; stoppage?: number }) {
  if (!time?.minute) return "INFO";
  return time.stoppage ? `${time.minute}+${time.stoppage}'` : `${time.minute}'`;
}

function buildEvents(teams: NonNullable<SerpApiSportsGame["teams"]>) {
  const events: Array<{ minute: string; title: string; description: string }> = [];

  for (const team of teams) {
    for (const summary of team.goal_summary ?? []) {
      for (const goal of summary.goals ?? []) {
        events.push({
          minute: formatMinute(goal.in_game_time),
          title: "Gol",
          description: `${summary.player?.name ?? "Jogador"} marcou para ${team.name ?? "selecao"}.`,
        });
      }
    }

    for (const summary of team.red_cards_summary ?? []) {
      for (const card of summary.cards ?? []) {
        events.push({
          minute: formatMinute(card.in_game_time),
          title: "Cartao vermelho",
          description: `${summary.player?.name ?? "Jogador"} recebeu vermelho por ${team.name ?? "selecao"}.`,
        });
      }
    }
  }

  return events.sort((a, b) => Number.parseInt(a.minute, 10) - Number.parseInt(b.minute, 10));
}

export function buildSerpApiResultQuery({
  startsAt,
  teamA,
  teamB,
}: {
  startsAt: Date | null;
  teamA: string;
  teamB: string;
}) {
  const year = startsAt?.getUTCFullYear() ?? 2026;
  return `${getTeamDisplayName(teamA)} ${getTeamDisplayName(teamB)} Copa do Mundo ${year} resultado`;
}

export async function fetchSerpApiMatchResult({
  apiKey = process.env.SERPAPI_KEY,
  startsAt,
  teamA,
  teamB,
}: {
  apiKey?: string;
  startsAt: Date | null;
  teamA: string;
  teamB: string;
}): Promise<SerpApiMatchResult | null> {
  if (!apiKey) return null;

  const query = buildSerpApiResultQuery({ startsAt, teamA, teamB });
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "pt-br");
  url.searchParams.set("gl", "br");
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SerpAPI retornou HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as SerpApiSportsResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }

  const game = findMatchingGame(payload, teamA, teamB);
  if (!game || !isFinalStatus(game.status)) return null;

  const teams = game.teams ?? [];
  const [firstTeam, secondTeam] = teams;
  const firstScore = parseScore(firstTeam?.score);
  const secondScore = parseScore(secondTeam?.score);
  if (firstScore === null || secondScore === null) return null;

  const firstName = firstTeam?.name ?? "";
  const secondName = secondTeam?.name ?? "";
  const isDirectOrder = namesLookRelated(teamA, firstName) && namesLookRelated(teamB, secondName);

  return {
    goalsA: isDirectOrder ? firstScore : secondScore,
    goalsB: isDirectOrder ? secondScore : firstScore,
    events: buildEvents(teams),
    sourceStatus: game.status ?? "FT",
    query,
  };
}

export async function fetchSerpApiMatchDebug({
  apiKey = process.env.SERPAPI_KEY,
  startsAt,
  teamA,
  teamB,
}: {
  apiKey?: string;
  startsAt: Date | null;
  teamA: string;
  teamB: string;
}): Promise<SerpApiMatchDebug | null> {
  if (!apiKey) return null;

  const query = buildSerpApiResultQuery({ startsAt, teamA, teamB });
  const url = new URL("https://serpapi.com/search");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "pt-br");
  url.searchParams.set("gl", "br");
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SerpAPI retornou HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as SerpApiSportsResponse;
  if (payload.error) {
    throw new Error(payload.error);
  }

  return {
    query,
    games: [
      ...(payload.sports_results?.game_spotlight ? [payload.sports_results.game_spotlight] : []),
      ...(payload.sports_results?.games ?? []),
    ].map((game) => ({
      status: game.status ?? null,
      teams: (game.teams ?? []).map((team) => ({
        name: team.name ?? null,
        score: team.score ?? null,
      })),
    })),
  };
}
