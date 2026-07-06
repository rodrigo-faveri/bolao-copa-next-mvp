import { getTeamDisplayName, namesLookRelated, normalizeTeamName } from "./teams";

export type SerpApiMatchResult = {
  goalsA: number;
  goalsB: number;
  penaltyGoalsA?: number | null;
  penaltyGoalsB?: number | null;
  resultMethod?: string | null;
  winnerTeam: string | null;
  events: Array<{ minute: string; title: string; description: string }>;
  sourceStatus: string;
  verificationSources: Array<{ label: string; url?: string }>;
  verificationStatus: "secondary_confirmed" | "organic_only" | "unverified";
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
    penalty_score?: number;
    goal_summary?: SerpApiGoalSummary[];
    red_cards_summary?: SerpApiCardSummary[];
  }>;
};

type SerpApiSportsResponse = {
  organic_results?: Array<{
    link?: string;
    snippet?: string;
    title?: string;
  }>;
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

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function teamAliases(team: string) {
  return Array.from(new Set([
    team,
    getTeamDisplayName(team, "pt-BR"),
    getTeamDisplayName(team, "en-US"),
    getTeamDisplayName(team, "es-ES"),
  ].map(normalizeSearchText).filter(Boolean)));
}

function findTeamAliasIndex(text: string, aliases: string[]) {
  return aliases
    .map((alias) => ({ alias, index: text.indexOf(alias) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0] ?? null;
}

function inferWinnerByVictoryPhrase(text: string, teamA: string, teamB: string) {
  const normalized = normalizeSearchText(text);
  const aliasesA = teamAliases(teamA);
  const aliasesB = teamAliases(teamB);
  const victoryWords = "(bateu?|venceu?|eliminou?|elimina|superou?|derrotou?|classificou|avancou)";

  for (const winnerAlias of aliasesA) {
    for (const loserAlias of aliasesB) {
      if (new RegExp(`${winnerAlias}.{0,80}${victoryWords}.{0,80}${loserAlias}`).test(normalized)) return teamA;
      if (new RegExp(`${winnerAlias}.{0,80}(nos penaltis|nas penalidades|penalty shootout).{0,80}(classificado|oitavas|quartas|semis|final)`).test(normalized)) return teamA;
    }
  }

  for (const winnerAlias of aliasesB) {
    for (const loserAlias of aliasesA) {
      if (new RegExp(`${winnerAlias}.{0,80}${victoryWords}.{0,80}${loserAlias}`).test(normalized)) return teamB;
      if (new RegExp(`${winnerAlias}.{0,80}(nos penaltis|nas penalidades|penalty shootout).{0,80}(classificado|oitavas|quartas|semis|final)`).test(normalized)) return teamB;
    }
  }

  return null;
}

function parsePenaltyScoreFromText(text: string, teamA: string, teamB: string) {
  const normalized = normalizeSearchText(text);
  if (!/(penalt|penalty|shootout|\(\d+\))/.test(normalized)) return null;

  const teamAHit = findTeamAliasIndex(normalized, teamAliases(teamA));
  const teamBHit = findTeamAliasIndex(normalized, teamAliases(teamB));
  if (!teamAHit || !teamBHit) return null;

  const firstTeam = teamAHit.index < teamBHit.index ? teamA : teamB;
  const secondTeam = firstTeam === teamA ? teamB : teamA;
  const start = Math.min(teamAHit.index, teamBHit.index);
  const end = Math.max(teamAHit.index + teamAHit.alias.length, teamBHit.index + teamBHit.alias.length);
  const numbers = (normalized.slice(start, end).match(/\d+/g) ?? []).map(Number);
  if (numbers.length < 4) return null;

  let firstGoals: number | null = null;
  let secondGoals: number | null = null;
  let firstPenalties: number | null = null;
  let secondPenalties: number | null = null;

  const [a, b, c, d] = numbers;
  if (a === d && b !== c) {
    firstGoals = a;
    secondGoals = d;
    firstPenalties = b;
    secondPenalties = c;
  } else if (b === c && a !== d) {
    firstGoals = b;
    secondGoals = c;
    firstPenalties = a;
    secondPenalties = d;
  }

  if (firstGoals === null || secondGoals === null || firstPenalties === null || secondPenalties === null) return null;

  const firstWinner = firstPenalties > secondPenalties;
  const winnerTeam = firstWinner ? firstTeam : secondTeam;
  return firstTeam === teamA
    ? { goalsA: firstGoals, goalsB: secondGoals, winnerTeam }
    : { goalsA: secondGoals, goalsB: firstGoals, winnerTeam };
}

function parseScoreFromText(text: string, teamA: string, teamB: string) {
  const normalized = normalizeSearchText(text);
  const teamAHit = findTeamAliasIndex(normalized, teamAliases(teamA));
  const teamBHit = findTeamAliasIndex(normalized, teamAliases(teamB));
  if (!teamAHit || !teamBHit) return null;

  const firstTeam = teamAHit.index < teamBHit.index ? teamA : teamB;
  const firstHit = teamAHit.index < teamBHit.index ? teamAHit : teamBHit;
  const secondHit = firstHit === teamAHit ? teamBHit : teamAHit;
  const firstTeamIsA = firstTeam === teamA;
  const searchStart = firstHit.index;
  const searchEnd = secondHit.index + secondHit.alias.length;
  const windowText = normalized.slice(searchStart, searchEnd);
  const numbers = (windowText.match(/\d+/g) ?? []).map(Number);
  if (numbers.length < 2) return null;

  const [firstGoals, secondGoals] = numbers.slice(-2);
  return firstTeamIsA
    ? { goalsA: firstGoals, goalsB: secondGoals }
    : { goalsA: secondGoals, goalsB: firstGoals };
}

function inferOrganicResult(payload: SerpApiSportsResponse, teamA: string, teamB: string) {
  for (const item of payload.organic_results ?? []) {
    const text = `${item.title ?? ""} ${item.snippet ?? ""}`;
    const score = parsePenaltyScoreFromText(text, teamA, teamB);
    if (score) return score;
  }

  return null;
}

function findOrganicVerificationSources({
  goalsA,
  goalsB,
  payload,
  teamA,
  teamB,
  winnerTeam,
}: {
  goalsA: number;
  goalsB: number;
  payload: SerpApiSportsResponse;
  teamA: string;
  teamB: string;
  winnerTeam: string | null;
}) {
  return (payload.organic_results ?? [])
    .flatMap((item) => {
      const text = `${item.title ?? ""} ${item.snippet ?? ""}`;
      const score = parseScoreFromText(text, teamA, teamB) ?? parsePenaltyScoreFromText(text, teamA, teamB);
      const winner = inferWinnerByVictoryPhrase(text, teamA, teamB);
      const confirmsScore = score?.goalsA === goalsA && score?.goalsB === goalsB;
      const confirmsWinner = winnerTeam !== null && winner === winnerTeam;
      if (!confirmsScore && !confirmsWinner) return [];

      return [{
        label: item.title ?? "Resultado organico",
        url: item.link,
      }];
    })
    .slice(0, 3);
}

function inferOrganicWinner(payload: SerpApiSportsResponse, teamA: string, teamB: string) {
  for (const item of payload.organic_results ?? []) {
    const winner = inferWinnerByVictoryPhrase(`${item.title ?? ""} ${item.snippet ?? ""}`, teamA, teamB);
    if (winner) return winner;
  }

  return null;
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
  if (!game || !isFinalStatus(game.status)) {
    const organicResult = inferOrganicResult(payload, teamA, teamB);
    if (!organicResult) return null;

    return {
      ...organicResult,
      events: [],
      penaltyGoalsA: null,
      penaltyGoalsB: null,
      resultMethod: organicResult.goalsA === organicResult.goalsB && organicResult.winnerTeam ? "penalties" : null,
      sourceStatus: "organic_penalties",
      verificationSources: findOrganicVerificationSources({
        goalsA: organicResult.goalsA,
        goalsB: organicResult.goalsB,
        payload,
        teamA,
        teamB,
        winnerTeam: organicResult.winnerTeam,
      }),
      verificationStatus: "organic_only",
      query,
    };
  }

  const teams = game.teams ?? [];
  const [firstTeam, secondTeam] = teams;
  const firstScore = parseScore(firstTeam?.score);
  const secondScore = parseScore(secondTeam?.score);
  if (firstScore === null || secondScore === null) return null;

  const firstName = firstTeam?.name ?? "";
  const secondName = secondTeam?.name ?? "";
  const isDirectOrder = namesLookRelated(teamA, firstName) && namesLookRelated(teamB, secondName);
  const goalsA = isDirectOrder ? firstScore : secondScore;
  const goalsB = isDirectOrder ? secondScore : firstScore;
  const firstPenaltyScore = typeof firstTeam?.penalty_score === "number" ? firstTeam.penalty_score : null;
  const secondPenaltyScore = typeof secondTeam?.penalty_score === "number" ? secondTeam.penalty_score : null;
  const penaltiesWinner = goalsA === goalsB && firstPenaltyScore !== null && secondPenaltyScore !== null && firstPenaltyScore !== secondPenaltyScore
    ? (isDirectOrder
      ? firstPenaltyScore > secondPenaltyScore ? teamA : teamB
      : firstPenaltyScore > secondPenaltyScore ? teamB : teamA)
    : null;
  const organicWinner = goalsA === goalsB && !penaltiesWinner ? inferOrganicWinner(payload, teamA, teamB) : null;
  const winnerTeam = goalsA > goalsB ? teamA : goalsB > goalsA ? teamB : penaltiesWinner ?? organicWinner;
  const verificationSources = findOrganicVerificationSources({
    goalsA,
    goalsB,
    payload,
    teamA,
    teamB,
    winnerTeam,
  });

  return {
    goalsA,
    goalsB,
    penaltyGoalsA: goalsA === goalsB ? (isDirectOrder ? firstPenaltyScore : secondPenaltyScore) : null,
    penaltyGoalsB: goalsA === goalsB ? (isDirectOrder ? secondPenaltyScore : firstPenaltyScore) : null,
    resultMethod: penaltiesWinner ? "penalties" : goalsA === goalsB && winnerTeam ? "extra_time" : null,
    winnerTeam,
    events: buildEvents(teams),
    sourceStatus: `${game.status ?? "FT"}${verificationSources.length > 0 ? "+secondary_confirmed" : "+unverified"}`,
    verificationSources,
    verificationStatus: verificationSources.length > 0 ? "secondary_confirmed" : "unverified",
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
