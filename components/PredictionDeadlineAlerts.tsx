import Link from "next/link";
import type { AppLocale } from "../lib/i18n-shared";
import { PREDICTION_CLOSE_MINUTES } from "../lib/prediction";
import { getTeamDisplayName } from "../lib/teams";

type DeadlineAlertMatch = {
  id: string;
  group: string;
  roundNumber: number;
  teamA: string;
  teamB: string;
  startsAt: Date | null;
  hasPrediction: boolean;
};

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatRemaining(deadline: Date, now: Date) {
  const remainingMinutes = Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / 60000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}min`;
}

function roundLabel(match: DeadlineAlertMatch, locale: AppLocale) {
  const groupLabel = locale === "en-US" ? "Group" : "Grupo";
  const roundWord = locale === "en-US" ? "round" : locale === "es-ES" ? "ronda" : "rodada";
  return `${groupLabel} ${match.group} · ${match.roundNumber}a ${roundWord}`;
}

export function PredictionDeadlineAlerts({ locale = "pt-BR", matches, now = new Date() }: { locale?: AppLocale; matches: DeadlineAlertMatch[]; now?: Date }) {
  const pendingMatches = matches.filter((match) => !match.hasPrediction && match.startsAt);
  const matchesWithDeadlines = pendingMatches
    .map((match) => {
      const startsAt = match.startsAt!;
      const deadline = new Date(startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000);
      return { ...match, deadline };
    });
  const closedWithoutPrediction = matchesWithDeadlines.filter((match) => match.deadline.getTime() <= now.getTime());
  const upcoming = matchesWithDeadlines
    .filter((match) => match.deadline.getTime() > now.getTime() && match.deadline.getTime() <= now.getTime() + 24 * 60 * 60 * 1000)
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
    .slice(0, 5);

  if (pendingMatches.length === 0) {
    return (
      <section className="deadlineAlerts deadlineAlertsOk">
        <div className="deadlineAlertsHeader">
          <div>
            <span className="badge badgeGold">{locale === "pt-BR" ? "Tudo em dia" : locale === "en-US" ? "All set" : "Todo listo"}</span>
            <h2>{locale === "pt-BR" ? "Nenhum palpite pendente" : locale === "en-US" ? "No pending picks" : "Sin pronosticos pendientes"}</h2>
          </div>
          <Link className="buttonLink buttonSecondary" href="/bolao">{locale === "pt-BR" ? "Revisar jogos" : locale === "en-US" ? "Review matches" : "Revisar partidos"}</Link>
        </div>
        <p>{locale === "pt-BR" ? "Voce ja preencheu todos os jogos disponiveis." : locale === "en-US" ? "You have filled all available matches." : "Ya completaste todos los partidos disponibles."}</p>
      </section>
    );
  }

  if (upcoming.length === 0) {
    return (
      <section className="deadlineAlerts">
        <div>
          <span className="badge">{locale === "pt-BR" ? "Avisos" : locale === "en-US" ? "Alerts" : "Avisos"}</span>
          <h2>{pendingMatches.length} {locale === "pt-BR" ? "palpite(s) pendente(s)" : locale === "en-US" ? "pending pick(s)" : "pronostico(s) pendiente(s)"}</h2>
        </div>
        <div className="deadlineAlertsActions">
          {closedWithoutPrediction.length > 0 && <span>{closedWithoutPrediction.length} {locale === "pt-BR" ? "ja fechado(s) sem palpite" : locale === "en-US" ? "already closed without a pick" : "ya cerrado(s) sin pronostico"}</span>}
          <Link className="buttonLink buttonSecondary" href="/bolao">{locale === "pt-BR" ? "Preencher agora" : locale === "en-US" ? "Fill now" : "Completar ahora"}</Link>
        </div>
        <p>{locale === "pt-BR" ? "Nenhum palpite aberto fecha nas proximas 24 horas." : locale === "en-US" ? "No open pick closes in the next 24 hours." : "Ningun pronostico abierto cierra en las proximas 24 horas."}</p>
      </section>
    );
  }

  return (
    <section className="deadlineAlerts deadlineAlertsUrgent">
      <div className="deadlineAlertsHeader">
        <div>
          <span className="badge badgeGold">{locale === "pt-BR" ? "Fecha em breve" : locale === "en-US" ? "Closing soon" : "Cierra pronto"}</span>
          <h2>{upcoming.length} {locale === "pt-BR" ? "palpite(s) perto do fechamento" : locale === "en-US" ? "pick(s) close soon" : "pronostico(s) cerca del cierre"}</h2>
        </div>
        <div className="deadlineAlertsActions">
          <span>{pendingMatches.length} {locale === "pt-BR" ? "pendente(s) no total" : locale === "en-US" ? "pending total" : "pendiente(s) en total"}</span>
          {closedWithoutPrediction.length > 0 && <span>{closedWithoutPrediction.length} {locale === "pt-BR" ? "ja fechado(s)" : locale === "en-US" ? "already closed" : "ya cerrado(s)"}</span>}
          <Link className="buttonLink" href={`/bolao?focus=${upcoming[0]?.id ?? ""}#bolao-confrontos`}>{locale === "pt-BR" ? "Palpitar agora" : locale === "en-US" ? "Pick now" : "Pronosticar ahora"}</Link>
        </div>
      </div>
      <div className="deadlineAlertList">
        {upcoming.map((match) => (
          <article className="deadlineAlertItem" key={match.id}>
            <strong>{getTeamDisplayName(match.teamA, locale)} x {getTeamDisplayName(match.teamB, locale)}</strong>
            <small>
              {roundLabel(match, locale)}
            </small>
            <span>{locale === "pt-BR" ? "Fecha em" : locale === "en-US" ? "Closes in" : "Cierra en"} {formatRemaining(match.deadline, now)}</span>
            <small>{dateFormatter.format(match.deadline)}</small>
            <Link className="deadlineAlertLink" href={`/bolao?focus=${match.id}#bolao-confrontos`}>
              {locale === "pt-BR" ? "Ir para este jogo" : locale === "en-US" ? "Go to this match" : "Ir a este partido"}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
