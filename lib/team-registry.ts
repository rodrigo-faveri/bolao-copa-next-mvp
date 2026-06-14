import type { AppLocale } from "./i18n-shared";

type TeamDefinition = {
  key: string;
  displayName: string;
  displayNames?: Partial<Record<AppLocale, string>>;
  flagCode: string;
  aliases?: string[];
};

const teamDefinitions: TeamDefinition[] = [
  { key: "Algeria", displayName: "Argelia", flagCode: "dz", aliases: ["argelia"] },
  { key: "Argentina", displayName: "Argentina", flagCode: "ar" },
  { key: "Australia", displayName: "Australia", flagCode: "au" },
  { key: "Austria", displayName: "Austria", flagCode: "at" },
  { key: "Belgium", displayName: "Belgica", flagCode: "be", aliases: ["belgica"] },
  { key: "Bosnia and Herzegovina", displayName: "Bosnia e Herzegovina", flagCode: "ba", aliases: ["bosnia e herzegovina"] },
  { key: "Brazil", displayName: "Brasil", flagCode: "br", aliases: ["brasil"] },
  { key: "Cabo Verde", displayName: "Cabo Verde", flagCode: "cv", aliases: ["cape verde"] },
  { key: "Canada", displayName: "Canada", flagCode: "ca" },
  { key: "Colombia", displayName: "Colombia", flagCode: "co", aliases: ["colombia"] },
  { key: "Congo DR", displayName: "Congo DR", flagCode: "cd", aliases: ["rd congo", "dr congo"] },
  { key: "Cote d'Ivoire", displayName: "Costa do Marfim", flagCode: "ci", aliases: ["cote d ivoire", "cote divoire", "costa do marfim"] },
  { key: "Croatia", displayName: "Croacia", flagCode: "hr", aliases: ["croacia"] },
  { key: "Curacao", displayName: "Curacao", flagCode: "cw", aliases: ["curacao"] },
  { key: "Czechia", displayName: "Tchequia", flagCode: "cz", aliases: ["republica tcheca", "tchequia"] },
  { key: "Ecuador", displayName: "Equador", flagCode: "ec", aliases: ["equador"] },
  { key: "Egypt", displayName: "Egito", flagCode: "eg", aliases: ["egito"] },
  { key: "England", displayName: "Inglaterra", flagCode: "gb-eng", aliases: ["inglaterra"] },
  { key: "France", displayName: "Franca", flagCode: "fr", aliases: ["franca"] },
  { key: "Germany", displayName: "Alemanha", flagCode: "de", aliases: ["alemanha"] },
  { key: "Ghana", displayName: "Gana", flagCode: "gh", aliases: ["gana"] },
  { key: "Haiti", displayName: "Haiti", flagCode: "ht" },
  { key: "IR Iran", displayName: "Ira", flagCode: "ir", aliases: ["ira", "iran", "ir iran"] },
  { key: "Iraq", displayName: "Iraque", flagCode: "iq", aliases: ["iraque"] },
  { key: "Japan", displayName: "Japao", flagCode: "jp", aliases: ["japao"] },
  { key: "Jordan", displayName: "Jordania", flagCode: "jo", aliases: ["jordania"] },
  { key: "Korea Republic", displayName: "Coreia do Sul", flagCode: "kr", aliases: ["coreia", "coreia do sul", "south korea"] },
  { key: "Mexico", displayName: "Mexico", flagCode: "mx", aliases: ["mexico"] },
  { key: "Morocco", displayName: "Marrocos", flagCode: "ma", aliases: ["marrocos"] },
  { key: "Netherlands", displayName: "Holanda", flagCode: "nl", aliases: ["holanda", "paises baixos"] },
  { key: "New Zealand", displayName: "Nova Zelandia", flagCode: "nz", aliases: ["nova zelandia"] },
  { key: "Norway", displayName: "Noruega", flagCode: "no", aliases: ["noruega"] },
  { key: "Panama", displayName: "Panama", flagCode: "pa" },
  { key: "Paraguay", displayName: "Paraguai", flagCode: "py", aliases: ["paraguai"] },
  { key: "Portugal", displayName: "Portugal", flagCode: "pt" },
  { key: "Qatar", displayName: "Catar", flagCode: "qa", aliases: ["catar"] },
  { key: "Saudi Arabia", displayName: "Arabia Saudita", flagCode: "sa", aliases: ["arabia saudita"] },
  { key: "Scotland", displayName: "Escocia", flagCode: "gb-sct", aliases: ["escocia"] },
  { key: "Senegal", displayName: "Senegal", flagCode: "sn" },
  { key: "South Africa", displayName: "Africa do Sul", flagCode: "za", aliases: ["africa do sul"] },
  { key: "Spain", displayName: "Espanha", flagCode: "es", aliases: ["espanha"] },
  { key: "Sweden", displayName: "Suecia", flagCode: "se", aliases: ["suecia"] },
  { key: "Switzerland", displayName: "Suica", flagCode: "ch", aliases: ["suica"] },
  { key: "Tunisia", displayName: "Tunisia", flagCode: "tn" },
  { key: "Türkiye", displayName: "Turquia", flagCode: "tr", aliases: ["turkiye", "turkey", "turquia"] },
  { key: "Uruguay", displayName: "Uruguai", flagCode: "uy", aliases: ["uruguai"] },
  { key: "USA", displayName: "Estados Unidos", flagCode: "us", aliases: ["united states", "estados unidos", "eua", "usa"] },
  { key: "Uzbekistan", displayName: "Uzbequistao", flagCode: "uz", aliases: ["uzbequistao"] },
];

const teamsByKey = new Map(teamDefinitions.map((team) => [team.key, team]));
const aliasToKey = new Map<string, string>();

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

for (const team of teamDefinitions) {
  const aliases = [team.key, team.displayName, ...(team.aliases ?? [])];
  for (const alias of aliases) {
    aliasToKey.set(normalizeText(alias), team.key);
  }
}

export function normalizeTeamName(value: string) {
  const normalized = normalizeText(value);
  return aliasToKey.get(normalized) ?? normalized;
}

export function namesLookRelated(expected: string, actual: string) {
  const expectedName = normalizeTeamName(expected);
  const actualName = normalizeTeamName(actual);
  return expectedName === actualName || expectedName.includes(actualName) || actualName.includes(expectedName);
}

export function getTeamDisplayName(team: string, locale: AppLocale = "pt-BR") {
  const key = normalizeTeamName(team);
  const definition = teamsByKey.get(key);
  if (!definition) return team;
  if (locale === "en-US") return definition.displayNames?.[locale] ?? definition.key;
  return definition.displayNames?.[locale] ?? definition.displayName;
}

export function getTeamFlagUrl(team: string) {
  const key = normalizeTeamName(team);
  const code = teamsByKey.get(key)?.flagCode;
  return code ? `https://flagcdn.com/${code}.svg` : null;
}
