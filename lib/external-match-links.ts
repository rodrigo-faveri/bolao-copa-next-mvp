export function buildSofaScoreSearchUrl(teamA: string, teamB: string, startsAt?: Date | string | null) {
  const date = startsAt ? new Date(startsAt) : null;
  const year = date && !Number.isNaN(date.getTime()) ? ` ${date.getFullYear()}` : "";
  const query = `site:sofascore.com/football/match ${teamA} ${teamB}${year}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
