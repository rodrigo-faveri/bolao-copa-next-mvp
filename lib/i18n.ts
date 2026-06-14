import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale, type AppLocale } from "./i18n-shared";

const dictionary = {
  "pt-BR": {
    nav: {
      home: "Inicio",
      bolao: "Palpites",
      boloes: "Boloes",
      simulador: "Simulador",
      ranking: "Ranking",
      resultados: "Resultados",
      noticias: "Noticias",
    },
    auth: {
      login: "Entrar com Google",
      profile: "Meu perfil",
      pools: "Meus boloes",
      predictions: "Meus palpites",
      ranking: "Ranking",
      simulator: "Simulador",
      news: "Noticias",
      admin: "Admin",
      logout: "Sair",
      guest: "Participante",
    },
    language: {
      label: "Idioma",
      ariaLabel: "Escolher idioma da pagina",
    },
  },
  "en-US": {
    nav: {
      home: "Home",
      bolao: "Picks",
      boloes: "Pools",
      simulador: "Simulator",
      ranking: "Ranking",
      resultados: "Results",
      noticias: "News",
    },
    auth: {
      login: "Sign in with Google",
      profile: "My profile",
      pools: "My pools",
      predictions: "My picks",
      ranking: "Ranking",
      simulator: "Simulator",
      news: "News",
      admin: "Admin",
      logout: "Sign out",
      guest: "Player",
    },
    language: {
      label: "Language",
      ariaLabel: "Choose page language",
    },
  },
  "es-ES": {
    nav: {
      home: "Inicio",
      bolao: "Pronosticos",
      boloes: "Grupos",
      simulador: "Simulador",
      ranking: "Ranking",
      resultados: "Resultados",
      noticias: "Noticias",
    },
    auth: {
      login: "Entrar con Google",
      profile: "Mi perfil",
      pools: "Mis grupos",
      predictions: "Mis pronosticos",
      ranking: "Ranking",
      simulator: "Simulador",
      news: "Noticias",
      admin: "Admin",
      logout: "Salir",
      guest: "Participante",
    },
    language: {
      label: "Idioma",
      ariaLabel: "Elegir idioma de la pagina",
    },
  },
} as const;

export async function getCurrentLocale() {
  const cookieStore = await cookies();
  return parseLocale(cookieStore.get(LOCALE_COOKIE)?.value);
}

export function t(locale: AppLocale) {
  return dictionary[locale];
}
