import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { PredictionDeadlineAlerts } from "../../components/PredictionDeadlineAlerts";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { isPredictionOpen, PREDICTION_CLOSE_MINUTES } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";
import { savePrediction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BolaoPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const params = await searchParams;
  const poolInviteCode = typeof params?.bolao === "string" ? params.bolao.toUpperCase() : null;
  let selectedPool: { name: string; inviteCode: string } | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: { pool: { select: { name: true, inviteCode: true } } },
    });

    if (!membership) redirect("/boloes");
    selectedPool = membership.pool;
  }

  const canSave = Boolean(email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
    : null;
  const predictions = user ? await prisma.prediction.findMany({ where: { userId: user.id } }) : [];
  const predictionMap = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));

  return (
    <main className="container bolaoPage">
      <CupHeader active="bolao" title={copy.bolao.title} description={copy.bolao.description} />

      {allowUnscheduledPredictions && (
        <div className="notice noticeCompact noticeInline"><strong>{copy.bolao.localMode}</strong><span>{copy.bolao.localModeText}</span></div>
      )}

      {!session?.user && <div className="notice">{copy.bolao.loginNotice}</div>}

      <section className="pageToolbar">
        <div><span className="badge badgeGold">{copy.bolao.toolbarBadge}</span><h2>{copy.bolao.toolbarTitle}</h2></div>
        <div className="toolbarTips"><span>{copy.bolao.tabTip}</span><span>{formatMessage(copy.bolao.closesBefore, { minutes: PREDICTION_CLOSE_MINUTES })}</span></div>
      </section>

      {selectedPool && (
        <section className="poolContextBanner">
          <div>
            <span className="badge badgeGold">{copy.bolao.privatePool}</span>
            <h2>{selectedPool.name}</h2>
            <p className="muted">{copy.bolao.poolDescription}</p>
          </div>
          <div className="poolContextActions">
            <Link className="buttonLink" href={`/ranking?bolao=${selectedPool.inviteCode}`}>{copy.bolao.poolRanking}</Link>
            <Link className="buttonLink buttonSecondary" href={`/boloes/${selectedPool.inviteCode}`}>{copy.bolao.details}</Link>
          </div>
        </section>
      )}

      {matches.length === 0 && <div className="notice">{copy.bolao.noMatches}</div>}

      {matches.length > 0 && (
        <PredictionDeadlineAlerts
          locale={locale}
          matches={matches.map((match) => ({
            id: match.id,
            teamA: match.teamA,
            teamB: match.teamB,
            startsAt: match.startsAt,
            hasPrediction: predictionMap.has(match.id),
          }))}
        />
      )}

      <WorldCupSimulator
        canSave={canSave}
        enableKnockout
        knockoutVariant="cards"
        locale={locale}
        saveAction={savePrediction}
        showStandings={false}
        matches={matches.map((match) => {
          const prediction = predictionMap.get(match.id);
          return {
            id: match.id,
            group: match.group,
            teamA: match.teamA,
            teamB: match.teamB,
            startsAt: match.startsAt?.toISOString() ?? null,
            status: match.status,
            venue: getMatchVenue(match.group, match.teamA, match.teamB),
            isOpen: isPredictionOpen(match.startsAt, new Date(), allowUnscheduledPredictions),
            goalsA: prediction?.goalsA ?? null,
            goalsB: prediction?.goalsB ?? null,
            resultGoalsA: match.resultGoalsA,
            resultGoalsB: match.resultGoalsB,
            points: prediction?.points ?? null,
          };
        })}
      />
    </main>
  );
}
