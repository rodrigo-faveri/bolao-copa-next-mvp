import type { AppLocale } from "./i18n-shared";

const teamFlagCodes: Record<string, string> = {
  Algeria: "dz",
  Argentina: "ar",
  Australia: "au",
  Austria: "at",
  Belgium: "be",
  "Bosnia and Herzegovina": "ba",
  Brazil: "br",
  "Cabo Verde": "cv",
  Canada: "ca",
  Colombia: "co",
  "Congo DR": "cd",
  "Côte d'Ivoire": "ci",
  Croatia: "hr",
  Curaçao: "cw",
  Czechia: "cz",
  Ecuador: "ec",
  Egypt: "eg",
  England: "gb-eng",
  France: "fr",
  Germany: "de",
  Ghana: "gh",
  Haiti: "ht",
  "IR Iran": "ir",
  Iraq: "iq",
  Japan: "jp",
  Jordan: "jo",
  "Korea Republic": "kr",
  Mexico: "mx",
  Morocco: "ma",
  Netherlands: "nl",
  "New Zealand": "nz",
  Norway: "no",
  Panama: "pa",
  Paraguay: "py",
  Portugal: "pt",
  Qatar: "qa",
  "Saudi Arabia": "sa",
  Scotland: "gb-sct",
  Senegal: "sn",
  "South Africa": "za",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tunisia: "tn",
  Türkiye: "tr",
  Uruguay: "uy",
  USA: "us",
  Uzbekistan: "uz",
};

const teamDisplayNames: Partial<Record<AppLocale, Record<string, string>>> = {
  "pt-BR": {
    Algeria: "Argelia",
    Belgium: "Belgica",
    "Bosnia and Herzegovina": "Bosnia e Herzegovina",
    Brazil: "Brasil",
    "Congo DR": "RD Congo",
    "Côte d'Ivoire": "Costa do Marfim",
    "CÃ´te d'Ivoire": "Costa do Marfim",
    Croatia: "Croacia",
    Curaçao: "Curacao",
    "CuraÃ§ao": "Curacao",
    Czechia: "Tchequia",
    Ecuador: "Equador",
    Egypt: "Egito",
    England: "Inglaterra",
    France: "Franca",
    Germany: "Alemanha",
    Ghana: "Gana",
    "IR Iran": "Ira",
    Iraq: "Iraque",
    Japan: "Japao",
    Jordan: "Jordania",
    "Korea Republic": "Coreia do Sul",
    Morocco: "Marrocos",
    Netherlands: "Holanda",
    "New Zealand": "Nova Zelandia",
    Norway: "Noruega",
    Paraguay: "Paraguai",
    Qatar: "Catar",
    "Saudi Arabia": "Arabia Saudita",
    Scotland: "Escocia",
    "South Africa": "Africa do Sul",
    Spain: "Espanha",
    Sweden: "Suecia",
    Switzerland: "Suica",
    Uruguay: "Uruguai",
    USA: "Estados Unidos",
    Uzbekistan: "Uzbequistao",
  },
  "es-ES": {
    Algeria: "Argelia",
    Belgium: "Belgica",
    "Bosnia and Herzegovina": "Bosnia y Herzegovina",
    "Congo DR": "RD Congo",
    "Côte d'Ivoire": "Costa de Marfil",
    "CÃ´te d'Ivoire": "Costa de Marfil",
    Croatia: "Croacia",
    Curaçao: "Curacao",
    "CuraÃ§ao": "Curacao",
    Czechia: "Chequia",
    Ecuador: "Ecuador",
    Egypt: "Egipto",
    England: "Inglaterra",
    France: "Francia",
    Germany: "Alemania",
    "IR Iran": "Iran",
    Iraq: "Irak",
    Japan: "Japon",
    Jordan: "Jordania",
    "Korea Republic": "Corea del Sur",
    Morocco: "Marruecos",
    Netherlands: "Paises Bajos",
    "New Zealand": "Nueva Zelanda",
    Norway: "Noruega",
    Qatar: "Catar",
    "Saudi Arabia": "Arabia Saudita",
    Scotland: "Escocia",
    "South Africa": "Sudafrica",
    Spain: "Espana",
    Sweden: "Suecia",
    Switzerland: "Suiza",
    Tunisia: "Tunez",
    USA: "Estados Unidos",
    Uzbekistan: "Uzbekistan",
  },
};

const teamAliases: Record<string, string> = {
  "cote d ivoire": "Côte d'Ivoire",
  "cote divoire": "Côte d'Ivoire",
  "costa do marfim": "Côte d'Ivoire",
  "curacao": "Curaçao",
  "curaçao": "Curaçao",
  "curaa ao": "Curaçao",
  "rd congo": "Congo DR",
  "dr congo": "Congo DR",
  "south korea": "Korea Republic",
  "coreia do sul": "Korea Republic",
  "ira": "IR Iran",
  "iran": "IR Iran",
  "eua": "USA",
  "estados unidos": "USA",
  "turkey": "TÃ¼rkiye",
  "turkiye": "TÃ¼rkiye",
  "turquia": "TÃ¼rkiye",
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function normalizeTeamName(value: string) {
  const normalized = normalizeText(value);
  const direct = Object.keys(teamFlagCodes).find((team) => normalizeText(team) === normalized);
  return direct ?? teamAliases[normalized] ?? normalized;
}

export function namesLookRelated(expected: string, actual: string) {
  const expectedName = normalizeTeamName(expected);
  const actualName = normalizeTeamName(actual);
  return expectedName === actualName || expectedName.includes(actualName) || actualName.includes(expectedName);
}

export function getTeamFlagUrl(team: string) {
  const code = teamFlagCodes[normalizeTeamName(team)] ?? teamFlagCodes[team];
  return code ? `https://flagcdn.com/${code}.svg` : null;
}

export function getTeamDisplayName(team: string, locale: AppLocale = "pt-BR") {
  const normalized = normalizeTeamName(team);
  if (locale === "en-US") return normalized;
  return teamDisplayNames[locale]?.[normalized] ?? teamDisplayNames[locale]?.[team] ?? normalized;
}
