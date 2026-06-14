import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, t } from "./i18n-shared";

export async function getCurrentLocale() {
  const cookieStore = await cookies();
  return parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);
}

export { t };
