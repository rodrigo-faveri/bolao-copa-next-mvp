import Link from "next/link";
import { notFound } from "next/navigation";
import { CupHeader } from "../../../components/CupHeader";
import { getTeamFlagUrl } from "../../../lib/teams";
import { prisma } from "../../../lib/prisma";
import { getApiFootballLiveMatch } from "../../../lib/sports-api";
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
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${team}`} loading="lazy" />;
}

function formatStatus(status: string, hasResult: boolean) {
  if (hasResult || status === "finished") return "Encerrada";
  if (status === "live") return "Ao vivo";
  return "Agendada";
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

  if (hasResult) {
    events.push({
      minute: "FIM",
      title: "Fim de jogo",
      description: `${match.teamA} ${match.resultGoalsA} x ${match.resultGoalsB} ${match.teamB}.`,
    });
  }

  if (match.status === "live") {
    events.push({
      minute: "AGORA",
      title: "Partida em andamento",
      description: "A linha do tempo esta pronta para receber lances em tempo real por API ou pelo admin.",
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
  const match = await prisma.match.findUnique({ where: { id: matchId } });

  if (!match) notFound();

  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  const venue = getMatchVenue(match.group, match.teamA, match.teamB);
  const liveData = await getApiFootballLiveMatch(match.externalFixtureId);
  const timeline = liveData.events.length > 0 ? liveData.events : buildTimeline(match);
  const displayGoalsA = liveData.available ? liveData.goalsA : match.resultGoalsA;
  const displayGoalsB = liveData.available ? liveData.goalsB : match.resultGoalsB;
  const hasDisplayScore = displayGoalsA !== null && displayGoalsB !== null && displayGoalsA !== undefined && displayGoalsB !== undefined;
  const statusLabel = liveData.statusLabel ?? formatStatus(match.status, hasResult);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="bolao"
        eyebrow="Tempo real"
        title={`${match.teamA} x ${match.teamB}`}
        description="Acompanhe o status da partida e a linha do tempo dos principais lances."
      />

      <section className="realTimeHero">
        <div className="realTimeScoreboard">
          <div className="realTimeTeam">
            {flagFor(match.teamA)}
            <strong>{match.teamA}</strong>
          </div>
          <div className="realTimeScore">
            <span className={match.status === "live" || liveData.statusShort === "1H" || liveData.statusShort === "2H" ? "badge badgeLive" : "badge"}>{statusLabel}</span>
            <strong>{hasDisplayScore ? `${displayGoalsA} x ${displayGoalsB}` : "x"}</strong>
            <small>{match.startsAt ? dateFormatter.format(match.startsAt) : "Horario a definir"}</small>
          </div>
          <div className="realTimeTeam realTimeTeamRight">
            {flagFor(match.teamB)}
            <strong>{match.teamB}</strong>
          </div>
        </div>

        <div className="realTimeMeta">
          <span>Grupo {match.group}</span>
          <span>{venue}</span>
          <span>{liveData.available ? "Dados: API-Football" : "Dados locais"}</span>
          <Link href="/bolao">Voltar para palpites</Link>
        </div>
      </section>

      <section className="realTimeTimeline">
        <div className="realTimeTimelineHeader">
          <span className="badge badgeGold">Lances</span>
          <h2>Tempo real</h2>
          <p>{liveData.available ? "Lances carregados da API-Football com cache para preservar o plano free." : liveData.message ?? "Sem fonte externa configurada para esta partida."}</p>
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
