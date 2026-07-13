import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { prisma } from "../../lib/prisma";
import { getTeamDisplayName } from "../../lib/teams";
import { deleteMatchAlert, saveNotificationPreferences, saveProfile, updateMatchAlert } from "./actions";

export const dynamic = "force-dynamic";

const avatarColors = ["#116530", "#0f766e", "#1d4ed8", "#7a4d00", "#9a3412", "#6d28d9"] as const;

type PredictionWithMatch = Awaited<ReturnType<typeof getUserProfileData>>["predictions"][number];
type NotificationLogWithMatch = Awaited<ReturnType<typeof getUserProfileData>>["pushNotificationLogs"][number];
type UserMatchAlertWithMatch = Awaited<ReturnType<typeof getUserProfileData>>["matchAlerts"][number];
type ProfileCopy = ReturnType<typeof t>["profile"];

async function getUserProfileData(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      nickname: true,
      avatarColor: true,
      notifyPickDeadlines: true,
      notifyResults: true,
      notifyRoundSummary: true,
      notificationLeadMinutes: true,
      matchAlerts: {
        include: {
          match: {
            select: {
              group: true,
              startsAt: true,
              teamA: true,
              teamB: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      },
      predictions: {
        include: { match: true },
        orderBy: { updatedAt: "desc" },
      },
      pushNotificationLogs: {
        include: {
          match: {
            select: {
              group: true,
              startsAt: true,
              teamA: true,
              teamB: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!user) redirect("/");
  return user;
}

function displayName(user: { name: string | null; nickname: string | null; id: string }) {
  return user.nickname?.trim() || user.name?.trim() || `Participante ${user.id.slice(-6)}`;
}

function alertMatchLabel(alert: UserMatchAlertWithMatch, locale: Parameters<typeof getTeamDisplayName>[1]) {
  return `${getTeamDisplayName(alert.match.teamA, locale)} x ${getTeamDisplayName(alert.match.teamB, locale)}`;
}

function groupRoundKey(prediction: PredictionWithMatch, groupMatches: PredictionWithMatch[]) {
  const sorted = [...groupMatches].sort((a, b) => {
    const timeA = a.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const timeB = b.match.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB || a.match.teamA.localeCompare(b.match.teamA);
  });
  const index = sorted.findIndex((item) => item.matchId === prediction.matchId);
  return Math.floor(Math.max(index, 0) / 2) + 1;
}

function buildRoundHistory(predictions: PredictionWithMatch[]) {
  const byGroup = new Map<string, PredictionWithMatch[]>();
  for (const prediction of predictions) {
    const groupPredictions = byGroup.get(prediction.match.group) ?? [];
    groupPredictions.push(prediction);
    byGroup.set(prediction.match.group, groupPredictions);
  }

  const rounds = new Map<number, { round: number; points: number; exactHits: number; outcomeHits: number; resolved: number; predictions: number }>();

  for (const prediction of predictions) {
    const round = groupRoundKey(prediction, byGroup.get(prediction.match.group) ?? []);
    const current = rounds.get(round) ?? { round, points: 0, exactHits: 0, outcomeHits: 0, resolved: 0, predictions: 0 };
    current.predictions += 1;
    current.points += prediction.points;

    const { match } = prediction;
    if (match.resultGoalsA !== null && match.resultGoalsB !== null) {
      current.resolved += 1;
      const exact = prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB;
      if (exact) current.exactHits += 1;
      else if (prediction.points > 0) current.outcomeHits += 1;
    }

    rounds.set(round, current);
  }

  return Array.from(rounds.values()).sort((a, b) => a.round - b.round);
}

function buildProfileStats(predictions: PredictionWithMatch[], roundHistory: ReturnType<typeof buildRoundHistory>) {
  const resolvedPredictions = predictions.filter((prediction) => prediction.match.resultGoalsA !== null && prediction.match.resultGoalsB !== null);
  const exactHits = resolvedPredictions.filter((prediction) => prediction.goalsA === prediction.match.resultGoalsA && prediction.goalsB === prediction.match.resultGoalsB).length;
  const outcomeHits = resolvedPredictions.filter((prediction) => prediction.points > 0 && !(prediction.goalsA === prediction.match.resultGoalsA && prediction.goalsB === prediction.match.resultGoalsB)).length;
  const pendingPredictions = predictions.length - resolvedPredictions.length;
  const scoringHits = exactHits + outcomeHits;
  const bestRound = roundHistory.reduce<(typeof roundHistory)[number] | null>((best, round) => {
    if (!best || round.points > best.points) return round;
    return best;
  }, null);

  return {
    accuracy: resolvedPredictions.length > 0 ? Math.round((scoringHits / resolvedPredictions.length) * 100) : 0,
    exactHits,
    outcomeHits,
    pendingPredictions,
    resolvedPredictions: resolvedPredictions.length,
    scoringHits,
    bestRound,
  };
}

function buildAssistantRecommendations({
  copy,
  predictions,
  roundHistory,
  stats,
}: {
  copy: ProfileCopy;
  predictions: PredictionWithMatch[];
  roundHistory: ReturnType<typeof buildRoundHistory>;
  stats: ReturnType<typeof buildProfileStats>;
}) {
  const recommendations: Array<{ actionHref: string; actionLabel: string; body: string; metric: string; title: string }> = [];
  const pendingRate = predictions.length > 0 ? Math.round((stats.pendingPredictions / predictions.length) * 100) : 0;
  const exactRate = stats.resolvedPredictions > 0 ? Math.round((stats.exactHits / stats.resolvedPredictions) * 100) : 0;
  const outcomeRate = stats.resolvedPredictions > 0 ? Math.round((stats.outcomeHits / stats.resolvedPredictions) * 100) : 0;
  const misses = Math.max(0, stats.resolvedPredictions - stats.scoringHits);
  const recentRounds = [...roundHistory].filter((round) => round.resolved > 0).slice(-2);
  const recentPoints = recentRounds.reduce((sum, round) => sum + round.points, 0);
  const recentPredictions = recentRounds.reduce((sum, round) => sum + round.resolved, 0);
  const recentAverage = recentPredictions > 0 ? recentPoints / recentPredictions : 0;

  if (predictions.length === 0) {
    recommendations.push({
      actionHref: "/bolao",
      actionLabel: copy.recommendationActionPick,
      body: copy.recommendationNoDataText,
      metric: copy.recommendationNoDataMetric,
      title: copy.recommendationNoDataTitle,
    });
    return recommendations;
  }

  if (stats.pendingPredictions > 0) {
    recommendations.push({
      actionHref: "/bolao",
      actionLabel: copy.recommendationActionPending,
      body: formatMessage(copy.recommendationPendingText, { count: stats.pendingPredictions, rate: pendingRate }),
      metric: `${stats.pendingPredictions}`,
      title: copy.recommendationPendingTitle,
    });
  }

  if (stats.resolvedPredictions >= 3 && exactRate < 18 && outcomeRate >= 25) {
    recommendations.push({
      actionHref: "/resultados?resultado=outcome",
      actionLabel: copy.recommendationActionResults,
      body: formatMessage(copy.recommendationExactText, { exactRate, outcomeRate }),
      metric: `${exactRate}%`,
      title: copy.recommendationExactTitle,
    });
  }

  if (stats.resolvedPredictions >= 3 && misses >= Math.ceil(stats.resolvedPredictions / 2)) {
    recommendations.push({
      actionHref: "/noticias",
      actionLabel: copy.recommendationActionNews,
      body: formatMessage(copy.recommendationRiskText, { misses, resolved: stats.resolvedPredictions }),
      metric: `${misses}/${stats.resolvedPredictions}`,
      title: copy.recommendationRiskTitle,
    });
  }

  if (recentPredictions >= 2 && recentAverage >= 3) {
    recommendations.push({
      actionHref: "/ranking",
      actionLabel: copy.recommendationActionRanking,
      body: formatMessage(copy.recommendationMomentumText, { average: recentAverage.toFixed(1) }),
      metric: `${recentAverage.toFixed(1)} pts`,
      title: copy.recommendationMomentumTitle,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      actionHref: "/simulador",
      actionLabel: copy.recommendationActionSimulator,
      body: copy.recommendationBalancedText,
      metric: `${stats.accuracy}%`,
      title: copy.recommendationBalancedTitle,
    });
  }

  return recommendations.slice(0, 3);
}

function notificationFallbackTitle(kind: string, copy: ReturnType<typeof t>["profile"]) {
  if (kind === "pick_deadline") return copy.notificationKindPickDeadline;
  if (kind === "match_result") return copy.notificationKindMatchResult;
  if (kind.startsWith("round_summary")) return copy.notificationKindRoundSummary;
  return copy.notificationKindGeneric;
}

function notificationFallbackBody(log: NotificationLogWithMatch, copy: ReturnType<typeof t>["profile"]) {
  const matchLabel = `${getTeamDisplayName(log.match.teamA)} x ${getTeamDisplayName(log.match.teamB)}`;
  if (log.kind === "pick_deadline") return formatMessage(copy.notificationFallbackPickDeadline, { match: matchLabel });
  if (log.kind === "match_result") return formatMessage(copy.notificationFallbackMatchResult, { match: matchLabel });
  if (log.kind.startsWith("round_summary")) return formatMessage(copy.notificationFallbackRoundSummary, { group: log.match.group });
  return matchLabel;
}

export default async function PerfilPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const user = await getUserProfileData(email);
  const name = displayName(user);
  const initial = name.slice(0, 1).toUpperCase();
  const avatarColor = user.avatarColor ?? avatarColors[0];
  const totalPoints = user.predictions.reduce((sum, prediction) => sum + prediction.points, 0);
  const roundHistory = buildRoundHistory(user.predictions);
  const stats = buildProfileStats(user.predictions, roundHistory);
  const assistantRecommendations = buildAssistantRecommendations({
    copy: copy.profile,
    predictions: user.predictions,
    roundHistory,
    stats,
  });
  const notificationDateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  return (
    <main className="container bolaoPage">
      <CupHeader active="perfil" title={copy.profile.title} description={copy.profile.description} />

      <section className="profileGrid">
        <article className="profileCard">
          <div className="profilePreview">
            <span className="profileAvatar" style={{ backgroundColor: avatarColor }}>{initial}</span>
            <div>
              <span className="badge badgeGold">{copy.profile.publicProfile}</span>
              <h2>{name}</h2>
              <p className="muted">{formatMessage(copy.profile.accumulated, { points: totalPoints, predictions: user.predictions.length })}</p>
            </div>
          </div>

          <div className="profileStatsGrid">
            <article>
              <span>{copy.profile.accuracy}</span>
              <strong>{stats.accuracy}%</strong>
            </article>
            <article>
              <span>{copy.profile.exactHits}</span>
              <strong>{stats.exactHits}</strong>
            </article>
            <article>
              <span>{copy.profile.outcomeHits}</span>
              <strong>{stats.outcomeHits}</strong>
            </article>
            <article>
              <span>{copy.profile.pending}</span>
              <strong>{stats.pendingPredictions}</strong>
            </article>
            <article className="profileStatsWide">
              <span>{copy.profile.bestRound}</span>
              <strong>{stats.bestRound ? formatMessage(copy.profile.bestRoundValue, { round: stats.bestRound.round, points: stats.bestRound.points }) : copy.profile.noBestRound}</strong>
            </article>
          </div>

          <form action={saveProfile} className="profileForm">
            <label>
              <span>{copy.profile.nickname}</span>
              <input defaultValue={user.nickname ?? user.name ?? ""} maxLength={32} minLength={2} name="nickname" required type="text" />
            </label>
            <fieldset>
              <legend>{copy.profile.avatarColor}</legend>
              <div className="avatarColorGrid">
                {avatarColors.map((color) => (
                  <label key={color}>
                    <input defaultChecked={color === avatarColor} name="avatarColor" type="radio" value={color} />
                    <span style={{ backgroundColor: color }} />
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit">{copy.profile.save}</button>
          </form>
        </article>

        <article className="profileCard profileAssistantRecommendations">
          <span className="badge badgeGold">{copy.profile.assistantRecommendations}</span>
          <h2>{copy.profile.assistantRecommendationsTitle}</h2>
          <p className="muted">{copy.profile.assistantRecommendationsDescription}</p>
          <div className="assistantRecommendationList">
            {assistantRecommendations.map((recommendation) => (
              <article className="assistantRecommendationItem" key={recommendation.title}>
                <div>
                  <span>{recommendation.metric}</span>
                  <strong>{recommendation.title}</strong>
                  <p>{recommendation.body}</p>
                </div>
                <a className="buttonLink buttonSecondary" href={recommendation.actionHref}>{recommendation.actionLabel}</a>
              </article>
            ))}
          </div>
        </article>

        <article className="profileCard">
          <span className="badge badgeGold">{copy.profile.notifications}</span>
          <h2>{copy.profile.notificationPreferences}</h2>
          <p className="muted">{copy.profile.notificationDescription}</p>

          <form action={saveNotificationPreferences} className="profileForm">
            <label className="notificationToggle">
              <input defaultChecked={user.notifyPickDeadlines} name="notifyPickDeadlines" type="checkbox" />
              <span>
                <strong>{copy.profile.pickDeadlineNotifications}</strong>
                <small>{copy.profile.pickDeadlineNotificationsText}</small>
              </span>
            </label>

            <label className="notificationToggle">
              <input defaultChecked={user.notifyResults} name="notifyResults" type="checkbox" />
              <span>
                <strong>{copy.profile.resultNotifications}</strong>
                <small>{copy.profile.resultNotificationsText}</small>
              </span>
            </label>

            <label className="notificationToggle">
              <input defaultChecked={user.notifyRoundSummary} name="notifyRoundSummary" type="checkbox" />
              <span>
                <strong>{copy.profile.roundSummaryNotifications}</strong>
                <small>{copy.profile.roundSummaryNotificationsText}</small>
              </span>
            </label>

            <label>
              <span>{copy.profile.leadTime}</span>
              <select defaultValue={user.notificationLeadMinutes} name="notificationLeadMinutes">
                <option value="30">{copy.profile.lead30}</option>
                <option value="60">{copy.profile.lead60}</option>
                <option value="120">{copy.profile.lead120}</option>
              </select>
            </label>

            <button type="submit">{copy.profile.saveNotifications}</button>
          </form>
        </article>

        <article className="profileCard">
          <span className="badge badgeGold">{copy.profile.notificationHistory}</span>
          <h2>{copy.profile.notificationHistoryTitle}</h2>
          {user.pushNotificationLogs.length > 0 ? (
            <div className="notificationHistory">
              {user.pushNotificationLogs.map((log) => (
                <article className="notificationHistoryItem" key={log.id}>
                  <div>
                    <strong>{log.title ?? notificationFallbackTitle(log.kind, copy.profile)}</strong>
                    <p>{log.body ?? notificationFallbackBody(log, copy.profile)}</p>
                    <small>{notificationDateFormatter.format(log.createdAt)}</small>
                  </div>
                  {log.url && <a className="buttonLink buttonSecondary" href={log.url}>{copy.profile.notificationHistoryLink}</a>}
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">{copy.profile.emptyNotificationHistory}</p>
          )}
        </article>

        <article className="profileCard">
          <span className="badge badgeGold">{copy.profile.assistantAlerts}</span>
          <h2>{copy.profile.assistantAlertsTitle}</h2>
          {user.matchAlerts.length > 0 ? (
            <div className="notificationHistory">
              {user.matchAlerts.map((alert) => (
                <article className="notificationHistoryItem" key={alert.id}>
                  <div>
                    <strong>{alertMatchLabel(alert, locale)}</strong>
                    <p>{formatMessage(copy.profile.assistantAlertLead, { minutes: alert.leadMinutes })}</p>
                    <small>{alert.enabled ? copy.profile.assistantAlertActive : copy.profile.assistantAlertInactive}</small>
                  </div>
                  <div className="assistantAlertControls">
                    <form action={updateMatchAlert} className="assistantAlertForm">
                      <input name="alertId" type="hidden" value={alert.id} />
                      <label>
                        <span>{copy.profile.leadTime}</span>
                        <select defaultValue={alert.leadMinutes} name="leadMinutes">
                          <option value="30">{copy.profile.lead30}</option>
                          <option value="60">{copy.profile.lead60}</option>
                          <option value="120">{copy.profile.lead120}</option>
                        </select>
                      </label>
                      <label className="assistantAlertToggle">
                        <input defaultChecked={alert.enabled} name="enabled" type="checkbox" />
                        <span>{copy.profile.assistantAlertActive}</span>
                      </label>
                      <button className="buttonSecondary" type="submit">{copy.profile.assistantAlertSave}</button>
                    </form>
                    <form action={deleteMatchAlert}>
                      <input name="alertId" type="hidden" value={alert.id} />
                      <button className="buttonDanger" type="submit">{copy.profile.assistantAlertRemove}</button>
                    </form>
                    <a className="buttonLink buttonSecondary" href={`/bolao?focus=${alert.matchId}#bolao-confrontos`}>{copy.profile.notificationHistoryLink}</a>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">{copy.profile.emptyAssistantAlerts}</p>
          )}
        </article>

        <article className="profileCard">
          <span className="badge">{copy.profile.history}</span>
          <h2>{copy.profile.performance}</h2>
          {roundHistory.length > 0 ? (
            <div className="roundHistory">
              {roundHistory.map((round) => (
                <div className="roundHistoryItem" key={round.round}>
                  <strong>{formatMessage(copy.profile.round, { round: round.round })}</strong>
                  <span>{round.points} pts</span>
                  <small>{round.exactHits} {copy.ranking.exact} · {round.outcomeHits} {copy.ranking.outcomes} · {formatMessage(copy.profile.finished, { resolved: round.resolved, predictions: round.predictions })}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">{copy.profile.emptyHistory}</p>
          )}
        </article>
      </section>
    </main>
  );
}
