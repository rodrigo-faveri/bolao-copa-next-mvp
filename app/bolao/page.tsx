import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { PredictionDeadlineAlerts } from "../../components/PredictionDeadlineAlerts";
import { PredictionDeadlineNotifier } from "../../components/PredictionDeadlineNotifier";
import { WorldCupSimulator } from "../../components/WorldCupSimulator";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { getFirstKnockoutMatchStartsAt } from "../../lib/knockout-schedule";
import { isPredictionOpen, PREDICTION_CLOSE_MINUTES } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { allowUnscheduledPredictions } from "../../lib/runtime-config";
import { getMatchVenue } from "../../lib/venues";
import { clearKnockoutPredictions, deleteKnockoutPrediction, saveKnockoutPrediction, savePrediction } from "./actions";

export const dynamic = "force-dynamic";

const groupStageCodes = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);

function getMatchRoundMap(matches: Array<{ id: string; group: string; startsAt: Date | null }>) {
  const byGroup = new Map<string, Array<{ id: string; startsAt: Date | null }>>();

  for (const match of matches) {
    const groupMatches = byGroup.get(match.group) ?? [];
    groupMatches.push({ id: match.id, startsAt: match.startsAt });
    byGroup.set(match.group, groupMatches);
  }

  const roundMap = new Map<string, number>();
  for (const groupMatches of byGroup.values()) {
    const sorted = [...groupMatches].sort((a, b) => {
      const timeA = a.startsAt ? a.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
      const timeB = b.startsAt ? b.startsAt.getTime() : Number.MAX_SAFE_INTEGER;
      return timeA - timeB;
    });

    sorted.forEach((match, index) => {
      roundMap.set(match.id, Math.floor(index / 2) + 1);
    });
  }

  return roundMap;
}

export default async function BolaoPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const params = await searchParams;
  const poolInviteCode = typeof params?.bolao === "string" ? params.bolao.toUpperCase() : null;
  const focusMatchId = typeof params?.focus === "string" ? params.focus : null;
  const phaseParam = typeof params?.fase === "string" ? params.fase.toLowerCase() : null;
  let selectedPool: { id: string; name: string; inviteCode: string } | null = null;

  if (poolInviteCode) {
    const membership = await prisma.poolMember.findFirst({
      where: {
        user: { email },
        pool: { inviteCode: poolInviteCode },
      },
      select: { pool: { select: { id: true, name: true, inviteCode: true } } },
    });

    if (!membership) redirect("/boloes");
    selectedPool = membership.pool;
  }

  const canSave = Boolean(email);
  const matches = await prisma.match.findMany({ orderBy: [{ group: "asc" }, { startsAt: "asc" }] });
  const groupStageMatches = matches.filter((match) => groupStageCodes.has(match.group));
  const user = email
    ? await prisma.user.findUnique({ where: { email }, select: { id: true } })
    : null;
  const predictions = user ? await prisma.prediction.findMany({ where: { userId: user.id } }) : [];
  const knockoutPredictions = user
    ? await prisma.knockoutPrediction.findMany({ where: { poolScope: selectedPool?.id ?? "global", userId: user.id } })
    : [];
  const predictionMap = new Map(predictions.map((prediction) => [prediction.matchId, prediction]));
  const knockoutWinnerMap = Object.fromEntries(knockoutPredictions.map((prediction) => [prediction.bracketMatchId, prediction.winnerTeam]));
  const knockoutScoreMap = Object.fromEntries(knockoutPredictions.map((prediction) => [
    prediction.bracketMatchId,
    {
      goalsA: prediction.homeGoals === null ? "" : String(prediction.homeGoals),
      goalsB: prediction.awayGoals === null ? "" : String(prediction.awayGoals),
    },
  ]));
  const roundMap = getMatchRoundMap(groupStageMatches);
  const firstKnockoutStartsAt = getFirstKnockoutMatchStartsAt();
  const initialStageView = focusMatchId
    ? "groups"
    : phaseParam === "mata-mata" || phaseParam === "knockout"
      ? "knockout"
      : phaseParam === "grupos" || phaseParam === "groups"
        ? "groups"
        : firstKnockoutStartsAt && firstKnockoutStartsAt.getTime() <= Date.now()
          ? "knockout"
          : "groups";

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

      {groupStageMatches.length === 0 && <div className="notice">{copy.bolao.noMatches}</div>}

      {groupStageMatches.length > 0 && (
        <>
          <PredictionDeadlineAlerts
            locale={locale}
            matches={groupStageMatches.map((match) => ({
              id: match.id,
              group: match.group,
              roundNumber: roundMap.get(match.id) ?? 1,
              teamA: match.teamA,
              teamB: match.teamB,
              startsAt: match.startsAt,
              hasPrediction: predictionMap.has(match.id),
            }))}
          />
          <PredictionDeadlineNotifier
            locale={locale}
            matches={groupStageMatches.map((match) => ({
              id: match.id,
              group: match.group,
              roundNumber: roundMap.get(match.id) ?? 1,
              teamA: match.teamA,
              teamB: match.teamB,
              startsAt: match.startsAt?.toISOString() ?? null,
              hasPrediction: predictionMap.has(match.id),
            }))}
          />
        </>
      )}

      <section id="bolao-confrontos">
        <WorldCupSimulator
          canSave={canSave}
          enableKnockout
          enforceKnockoutDeadlines
          focusMatchId={focusMatchId}
          initialStageView={initialStageView}
          initialKnockoutScores={knockoutScoreMap}
          initialKnockoutWinners={knockoutWinnerMap}
          knockoutPoolInviteCode={selectedPool?.inviteCode ?? null}
          knockoutScoreInputs
          knockoutVariant="bracket"
          locale={locale}
          saveAction={savePrediction}
          clearKnockoutAction={clearKnockoutPredictions}
          deleteKnockoutAction={deleteKnockoutPrediction}
          saveKnockoutAction={saveKnockoutPrediction}
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
              resultMethod: match.resultMethod,
              penaltyGoalsA: match.penaltyGoalsA,
              penaltyGoalsB: match.penaltyGoalsB,
              winnerTeam: match.winnerTeam,
              points: prediction?.points ?? null,
            };
          })}
        />
      </section>
    </main>
  );
}
