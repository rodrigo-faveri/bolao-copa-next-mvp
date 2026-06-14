import Link from "next/link";
import { notFound } from "next/navigation";
import { CupHeader } from "../../../components/CupHeader";
import { getCurrentLocale } from "../../../lib/i18n";
import { getTeamDisplayName, getTeamFlagUrl } from "../../../lib/teams";
import { prisma } from "../../../lib/prisma";
import { getMatchVenue } from "../../../lib/venues";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function flagFor(team: string) {
  const flagUrl = getTeamFlagUrl(team);
  if (!flagUrl) return <span className="teamFlagPlaceholder" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${getTeamDisplayName(team)}`} loading="lazy" />;
}

function getAutomaticStatus(match: { startsAt: Date | null; status: string; resultGoalsA: number | null; resultGoalsB: number | null }, now = new Date()) {
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  if (hasResult || match.status === "finished") return "Encerrada";
  if (match.status === "live") return "Ao vivo";
  if (!match.startsAt) return "Agendada";

  const elapsedMinutes = Math.floor((now.getTime() - match.startsAt.getTime()) / 60000);
  if (elapsedMinutes < 0) return "Agendada";
  if (elapsedMinutes <= 45) return "1o tempo";
  if (elapsedMinutes <= 60) return "Intervalo previsto";
  if (elapsedMinutes <= 105) return "2o tempo";
  if (elapsedMinutes <= 130) return "Acréscimos/encerramento previsto";
  return "Aguardando resultado";
}

function buildTimeline(match: {
  startsAt: Date | null;
  status: string;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  teamA: string;
  teamB: string;
}) {
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  const events: Array<{ minute: string; title: string; description: string }> = [];
  const now = new Date();
  const elapsedMinutes = match.startsAt ? Math.floor((now.getTime() - match.startsAt.getTime()) / 60000) : null;

  if (hasResult) {
    events.push({
      minute: "FIM",
      title: "Fim de jogo",
      description: `${getTeamDisplayName(match.teamA)} ${match.resultGoalsA} x ${match.resultGoalsB} ${getTeamDisplayName(match.teamB)}.`,
    });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 105 && !hasResult) {
    events.push({
      minute: "90'",
      title: "Fim previsto",
      description: "Tempo regulamentar estimado encerrado. Aguardando confirmacao do resultado oficial.",
    });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 60) {
    events.push({
      minute: "46'",
      title: "Segundo tempo previsto",
      description: "A partida entrou na janela estimada do segundo tempo.",
    });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 45) {
    events.push({
      minute: "45'",
      title: "Intervalo previsto",
      description: "A partida entrou na janela estimada de intervalo.",
    });
  }

  if (match.status === "live") {
    events.push({
      minute: "AGORA",
      title: "Partida em andamento",
      description: "Status marcado como ao vivo no admin.",
    });
  }

  if (match.startsAt) {
    events.push({
      minute: "00'",
      title: "Inicio previsto",
      description: `Partida marcada para ${dateFormatter.format(match.startsAt)}.`,
    });
  }

  return events;
}

export default async function RealTimePage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { events: { orderBy: { createdAt: "desc" } } },
  });

  if (!match) notFound();
  const locale = await getCurrentLocale();

  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  const venue = getMatchVenue(match.group, match.teamA, match.teamB);
  const manualEvents = match.events.map((event) => ({
    minute: event.minute,
    title: event.title,
    description: event.description,
  }));
  const timeline = manualEvents.length > 0 ? manualEvents : buildTimeline(match);
  const hasDisplayScore = hasResult;
  const statusLabel = getAutomaticStatus(match);
  const teamALabel = getTeamDisplayName(match.teamA, locale);
  const teamBLabel = getTeamDisplayName(match.teamB, locale);
  const isLiveLike = ["Ao vivo", "1o tempo", "Intervalo previsto", "2o tempo", "Acréscimos/encerramento previsto"].includes(statusLabel);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="bolao"
        eyebrow="Tempo real"
        title={`${teamALabel} x ${teamBLabel}`}
        description="Acompanhe o status da partida e a linha do tempo dos principais lances."
      />

      <section className="realTimeHero">
        <div className="realTimeScoreboard">
          <div className="realTimeTeam">
            {flagFor(match.teamA)}
            <strong>{teamALabel}</strong>
          </div>
          <div className="realTimeScore">
            <span className={isLiveLike ? "badge badgeLive" : "badge"}>{statusLabel}</span>
            <strong>{hasDisplayScore ? `${match.resultGoalsA} x ${match.resultGoalsB}` : "x"}</strong>
            <small>{match.startsAt ? dateFormatter.format(match.startsAt) : "Horario a definir"}</small>
          </div>
          <div className="realTimeTeam realTimeTeamRight">
            {flagFor(match.teamB)}
            <strong>{teamBLabel}</strong>
          </div>
        </div>

        <div className="realTimeMeta">
          <span>Grupo {match.group}</span>
          <span>{venue}</span>
          <span>{manualEvents.length} lance(s) cadastrado(s)</span>
          {match.liveUrl && <a href={match.liveUrl} target="_blank" rel="noreferrer">Ver fonte externa</a>}
          <Link href="/bolao">Voltar para palpites</Link>
        </div>
      </section>

      <section className="realTimeTimeline">
        <div className="realTimeTimelineHeader">
          <span className="badge badgeGold">Lances</span>
          <h2>Tempo real</h2>
          <p>{manualEvents.length > 0 ? "Lances cadastrados pelo admin do bolao." : "Linha do tempo automatica baseada no horario da partida. Para lances detalhados, use o link externo quando disponivel."}</p>
        </div>

        <div className="timelineList">
          {timeline.map((event) => (
            <article className="timelineItem" key={`${event.minute}-${event.title}`}>
              <span>{event.minute}</span>
              <div>
                <strong>{event.title}</strong>
                <p>{event.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
