import Link from "next/link";
import { notFound } from "next/navigation";
import { CupHeader } from "../../../components/CupHeader";
import { getCurrentLocale } from "../../../lib/i18n";
import { formatMessage, t } from "../../../lib/i18n-shared";
import type { AppLocale } from "../../../lib/i18n-shared";
import { getTeamDisplayName, getTeamFlagUrl } from "../../../lib/teams";
import { prisma } from "../../../lib/prisma";
import { getMatchVenue } from "../../../lib/venues";

export const dynamic = "force-dynamic";

function formatMatchDate(date: Date, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function flagFor(team: string, locale: AppLocale) {
  const flagUrl = getTeamFlagUrl(team);
  if (!flagUrl) return <span className="teamFlagPlaceholder" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${getTeamDisplayName(team, locale)}`} loading="lazy" />;
}

function getAutomaticStatus(match: { startsAt: Date | null; status: string; resultGoalsA: number | null; resultGoalsB: number | null }, locale: AppLocale, now = new Date()) {
  const copy = t(locale);
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  if (hasResult || match.status === "finished") return copy.common.finished;
  if (match.status === "live") return copy.common.live;
  if (!match.startsAt) return copy.realtime.scheduled;

  const elapsedMinutes = Math.floor((now.getTime() - match.startsAt.getTime()) / 60000);
  if (elapsedMinutes < 0) return copy.realtime.scheduled;
  if (elapsedMinutes <= 45) return copy.realtime.firstHalf;
  if (elapsedMinutes <= 60) return copy.realtime.expectedHalftime;
  if (elapsedMinutes <= 105) return copy.realtime.secondHalf;
  if (elapsedMinutes <= 130) return copy.realtime.expectedEnding;
  return copy.realtime.waitingResult;
}

function buildTimeline(match: {
  startsAt: Date | null;
  status: string;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  teamA: string;
  teamB: string;
}, locale: AppLocale) {
  const copy = t(locale);
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  const events: Array<{ minute: string; title: string; description: string }> = [];
  const now = new Date();
  const elapsedMinutes = match.startsAt ? Math.floor((now.getTime() - match.startsAt.getTime()) / 60000) : null;

  if (hasResult) {
    events.push({
      minute: "FIM",
      title: copy.realtime.fullTime,
      description: `${getTeamDisplayName(match.teamA, locale)} ${match.resultGoalsA} x ${match.resultGoalsB} ${getTeamDisplayName(match.teamB, locale)}.`,
    });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 105 && !hasResult) {
    events.push({ minute: "90'", title: copy.realtime.expectedFullTime, description: copy.realtime.expectedFullTimeDescription });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 60) {
    events.push({ minute: "46'", title: copy.realtime.secondHalfExpected, description: copy.realtime.secondHalfDescription });
  }

  if (elapsedMinutes !== null && elapsedMinutes >= 45) {
    events.push({ minute: "45'", title: copy.realtime.halftimeExpected, description: copy.realtime.halftimeDescription });
  }

  if (match.status === "live") {
    events.push({ minute: "AGORA", title: copy.realtime.inProgress, description: copy.realtime.inProgressDescription });
  }

  if (match.startsAt) {
    events.push({
      minute: "00'",
      title: copy.realtime.startExpected,
      description: formatMessage(copy.realtime.startExpectedDescription, { date: formatMatchDate(match.startsAt, locale) }),
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
  const copy = t(locale);
  const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
  const venue = getMatchVenue(match.group, match.teamA, match.teamB);
  const manualEvents = match.events.map((event) => ({
    minute: event.minute,
    title: event.title,
    description: event.description,
  }));
  const timeline = manualEvents.length > 0 ? manualEvents : buildTimeline(match, locale);
  const statusLabel = getAutomaticStatus(match, locale);
  const teamALabel = getTeamDisplayName(match.teamA, locale);
  const teamBLabel = getTeamDisplayName(match.teamB, locale);
  const liveLabels: string[] = [
    copy.common.live,
    copy.realtime.firstHalf,
    copy.realtime.expectedHalftime,
    copy.realtime.secondHalf,
    copy.realtime.expectedEnding,
  ];
  const isLiveLike = liveLabels.includes(statusLabel);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="bolao"
        eyebrow={copy.realtime.eyebrow}
        title={`${teamALabel} x ${teamBLabel}`}
        description={copy.realtime.description}
      />

      <section className="realTimeHero">
        <div className="realTimeScoreboard">
          <div className="realTimeTeam">
            {flagFor(match.teamA, locale)}
            <strong>{teamALabel}</strong>
          </div>
          <div className="realTimeScore">
            <span className={isLiveLike ? "badge badgeLive" : "badge"}>{statusLabel}</span>
            <strong>{hasResult ? `${match.resultGoalsA} x ${match.resultGoalsB}` : "x"}</strong>
            <small>{match.startsAt ? formatMatchDate(match.startsAt, locale) : copy.realtime.unknownSchedule}</small>
          </div>
          <div className="realTimeTeam realTimeTeamRight">
            {flagFor(match.teamB, locale)}
            <strong>{teamBLabel}</strong>
          </div>
        </div>

        <div className="realTimeMeta">
          <span>{copy.common.group} {match.group}</span>
          <span>{venue}</span>
          <span>{formatMessage(copy.realtime.registeredEvents, { count: manualEvents.length })}</span>
          {match.liveUrl && <a href={match.liveUrl} target="_blank" rel="noreferrer">{copy.realtime.externalSource}</a>}
          <Link href="/bolao">{copy.common.backToPicks}</Link>
        </div>
      </section>

      <section className="realTimeTimeline">
        <div className="realTimeTimelineHeader">
          <span className="badge badgeGold">{copy.realtime.events}</span>
          <h2>{copy.realtime.timeline}</h2>
          <p>{manualEvents.length > 0 ? copy.realtime.adminEvents : copy.realtime.automaticTimeline}</p>
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
