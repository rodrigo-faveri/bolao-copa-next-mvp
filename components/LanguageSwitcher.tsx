"use client";

import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type AppLocale, getLocaleLabel, locales } from "../lib/i18n-shared";

export function LanguageSwitcher({
  ariaLabel,
  label,
  locale,
}: {
  ariaLabel: string;
  label: string;
  locale: AppLocale;
}) {
  const router = useRouter();

  function changeLocale(nextLocale: AppLocale) {
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <label className="languageSwitcher">
      <span>{label}</span>
      <select aria-label={ariaLabel} onChange={(event) => changeLocale(event.target.value as AppLocale)} value={locale}>
        {locales.map((item) => (
          <option key={item} value={item}>{getLocaleLabel(item)}</option>
        ))}
      </select>
    </label>
  );
}
