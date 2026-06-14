import Link from "next/link";
import { PREDICTION_CLOSE_MINUTES } from "../lib/prediction";
import { getTeamDisplayName } from "../lib/teams";

type DeadlineAlertMatch = {
  id: string;
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

export function PredictionDeadlineAlerts({ matches, now = new Date() }: { matches: DeadlineAlertMatch[]; now?: Date }) {
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
            <span className="badge badgeGold">Tudo em dia</span>
            <h2>Nenhum palpite pendente</h2>
          </div>
          <Link className="buttonLink buttonSecondary" href="/bolao">Revisar jogos</Link>
        </div>
        <p>Voce ja preencheu todos os jogos disponiveis.</p>
      </section>
    );
  }

  if (upcoming.length === 0) {
    return (
      <section className="deadlineAlerts">
        <div>
          <span className="badge">Avisos</span>
          <h2>{pendingMatches.length} palpite(s) pendente(s)</h2>
        </div>
        <div className="deadlineAlertsActions">
          {closedWithoutPrediction.length > 0 && <span>{closedWithoutPrediction.length} ja fechado(s) sem palpite</span>}
          <Link className="buttonLink buttonSecondary" href="/bolao">Preencher agora</Link>
        </div>
        <p>Nenhum palpite aberto fecha nas proximas 24 horas.</p>
      </section>
    );
  }

  return (
    <section className="deadlineAlerts deadlineAlertsUrgent">
      <div className="deadlineAlertsHeader">
        <div>
          <span className="badge badgeGold">Fecha em breve</span>
          <h2>{upcoming.length} palpite(s) perto do fechamento</h2>
        </div>
        <div className="deadlineAlertsActions">
          <span>{pendingMatches.length} pendente(s) no total</span>
          {closedWithoutPrediction.length > 0 && <span>{closedWithoutPrediction.length} ja fechado(s)</span>}
          <Link className="buttonLink" href="/bolao">Palpitar agora</Link>
        </div>
      </div>
      <div className="deadlineAlertList">
        {upcoming.map((match) => (
          <article className="deadlineAlertItem" key={match.id}>
            <strong>{getTeamDisplayName(match.teamA)} x {getTeamDisplayName(match.teamB)}</strong>
            <span>Fecha em {formatRemaining(match.deadline, now)}</span>
            <small>{dateFormatter.format(match.deadline)}</small>
          </article>
        ))}
      </div>
    </section>
  );
}
