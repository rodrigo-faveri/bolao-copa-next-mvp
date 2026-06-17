import Link from "next/link";
import { CupHeader } from "../components/CupHeader";
import { HomeNewsCarousel } from "../components/HomeNewsCarousel";
import { getCurrentLocale, t } from "../lib/i18n";
import { prisma } from "../lib/prisma";
import { getTeamDisplayName } from "../lib/teams";
import { getMatchVenue } from "../lib/venues";
import { getLatestNews } from "../lib/news";

export const dynamic = "force-dynamic";

const homeDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function isLiveMatch(match: { status: string; startsAt: Date | null; resultGoalsA: number | null; resultGoalsB: number | null }, now: Date) {
  if (match.resultGoalsA !== null && match.resultGoalsB !== null) return false;
  if (match.status === "live") return true;
  if (!match.startsAt || match.status === "finished") return false;

  const startTime = match.startsAt.getTime();
  const expectedEnd = startTime + 130 * 60 * 1000;
  return now.getTime() >= startTime && now.getTime() <= expectedEnd;
}

export default async function Home() {
  const locale = await getCurrentLocale();
  const copy = t(locale);
  const now = new Date();
  const liveWindowStart = new Date(now.getTime() - 130 * 60 * 1000);
  const [matches, news] = await Promise.all([
    prisma.match.findMany({
      where: {
        OR: [
          { status: "live" },
          { startsAt: { gte: liveWindowStart, lte: now } },
          { startsAt: { gte: now } },
        ],
      },
      orderBy: [{ startsAt: "asc" }, { group: "asc" }],
      take: 12,
    }),
    getLatestNews(5),
  ]);
  const liveMatches = matches.filter((match) => isLiveMatch(match, now));
  const featuredMatches = (liveMatches.length > 0 ? liveMatches : matches.filter((match) => match.startsAt && match.startsAt >= now)).slice(0, 4);

  return (
    <main className="homeShell">
      <div className="stadiumBackdrop" aria-hidden="true" />

      <div className="container bolaoPage homeContent">
        <CupHeader
          active="home"
          title={copy.home.title}
          description={copy.home.description}
        />

        <section className="homeGrid">
          <article className="featureCard">
            <span className="badge badgeGold">{copy.home.picksBadge}</span>
            <h2>{copy.home.picksTitle}</h2>
            <p className="muted">{copy.home.picksDescription}</p>
            <Link className="buttonLink" href="/bolao">{copy.home.picksCta}</Link>
          </article>
          <article className="featureCard featureCardDark">
            <span className="badge">{copy.home.simulatorBadge}</span>
            <h2>{copy.home.simulatorTitle}</h2>
            <p>{copy.home.simulatorDescription}</p>
            <Link className="buttonLink buttonLight" href="/simulador">{copy.home.simulatorCta}</Link>
          </article>
        </section>

        <section className="homePanel">
          <div className="homePanelHeader">
            <div>
              <span className={`badge ${liveMatches.length > 0 ? "badgeLive" : "badgeGold"}`}>{liveMatches.length > 0 ? copy.home.liveBadge : copy.home.nextMatchesBadge}</span>
              <h2>{liveMatches.length > 0 ? copy.home.liveTitle : copy.home.nextMatchesTitle}</h2>
            </div>
            <Link className="buttonLink buttonSecondary" href="/bolao">{copy.home.matchesCta}</Link>
          </div>

          {featuredMatches.length === 0 ? (
            <p className="muted">{copy.home.noMatches}</p>
          ) : (
            <div className="homeMatchGrid">
              {featuredMatches.map((match) => {
                const live = isLiveMatch(match, now);
                return (
                  <article className="homeMatchCard" key={match.id}>
                    <div className="homeMatchCardHeader">
                      <span className={live ? "badge badgeLive" : "badge"}>{live ? copy.common.live : `${copy.common.group} ${match.group}`}</span>
                      <strong>{match.startsAt ? homeDateFormatter.format(match.startsAt) : copy.common.undefinedSchedule}</strong>
                    </div>
                    <h3>{getTeamDisplayName(match.teamA, locale)} x {getTeamDisplayName(match.teamB, locale)}</h3>
                    <p className="muted">{getMatchVenue(match.group, match.teamA, match.teamB)}</p>
                    {match.resultGoalsA !== null && match.resultGoalsB !== null && (
                      <strong className="homeMatchScore">{match.resultGoalsA} x {match.resultGoalsB}</strong>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <HomeNewsCarousel locale={locale} news={news} />
      </div>
    </main>
  );
}
