export const LOCALE_COOKIE = "bolao_locale";
export const locales = ["pt-BR", "en-US", "es-ES"] as const;

export type AppLocale = (typeof locales)[number];

const localeLabels: Record<AppLocale, string> = {
  "pt-BR": "Português",
  "en-US": "English",
  "es-ES": "Español",
};

export function parseLocale(value: string | undefined | null): AppLocale {
  return locales.find((locale) => locale === value) ?? "pt-BR";
}

export function getLocaleLabel(locale: AppLocale) {
  return localeLabels[locale];
}
