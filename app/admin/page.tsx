import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { AdminSyncFeedbackForm } from "../../components/AdminSyncFeedbackForm";
import { CupHeader } from "../../components/CupHeader";
import { isAdminEmail } from "../../lib/access-control";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t, type AppLocale } from "../../lib/i18n-shared";
import { MAX_GOALS, PREDICTION_CLOSE_MINUTES } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { readPositiveInt } from "../../lib/result-sync";
import { getTeamDisplayName } from "../../lib/teams";
import { getMatchVenue } from "../../lib/venues";
import { saveMatchEvent, saveMatchLiveUrl, saveMatchResult, saveMatchStatus, syncPendingResultsWithFeedback } from "./actions";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatMatchDate(startsAt: Date | null, locale: AppLocale) {
  if (!startsAt) return t(locale).common.noDate;
  return `${dateFormatter.format(startsAt)} as ${timeFormatter.format(startsAt)}`;
}

function formatDateTime(date: Date, locale: AppLocale) {
  return `${dateFormatter.format(date)} ${timeFormatter.format(date)} ${locale === "en-US" ? "BRT" : "BRT"}`;
}

function formatMatchStatus(status: string, hasResult: boolean, locale: AppLocale) {
  const copy = t(locale);
  if (hasResult || status === "finished") return copy.common.finished;
  if (status === "live") return copy.common.live;
  return copy.admin.scheduled;
}

function formatSyncStatus(status: string, locale: AppLocale) {
  const copy = t(locale);
  if (status === "running") return copy.admin.syncRunning;
  if (status === "failed") return copy.admin.syncFailed;
  return copy.admin.syncSuccess;
}

type JobRunLike = {
  errorMessage?: string | null;
  finishedAt: Date | null;
  startedAt: Date;
  status: string;
};

function minutesBetween(later: Date, earlier: Date) {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 60000));
}

function buildJobAlert({
  jobName,
  now,
  run,
  runningStaleMinutes,
  staleMinutes,
  locale,
}: {
  jobName: string;
  now: Date;
  run: JobRunLike | null;
  runningStaleMinutes: number;
  staleMinutes: number;
  locale: AppLocale;
}) {
  const copy = t(locale);

  if (!run) {
    return {
      level: "warning" as const,
      message: formatMessage(copy.admin.jobAlertNeverRan, { job: jobName }),
    };
  }

  if (run.status === "failed") {
    return {
      level: "error" as const,
      message: formatMessage(copy.admin.jobAlertFailed, { job: jobName, error: run.errorMessage ?? copy.admin.emptyValue }),
    };
  }

  if (run.status === "running") {
    const runningMinutes = minutesBetween(now, run.startedAt);
    if (runningMinutes > runningStaleMinutes) {
      return {
        level: "warning" as const,
        message: formatMessage(copy.admin.jobAlertRunningTooLong, { job: jobName, minutes: runningMinutes }),
      };
    }
    return null;
  }

  const lastSeenAt = run.finishedAt ?? run.startedAt;
  const staleForMinutes = minutesBetween(now, lastSeenAt);
  if (staleForMinutes > staleMinutes) {
    return {
      level: "warning" as const,
      message: formatMessage(copy.admin.jobAlertStale, { job: jobName, minutes: staleForMinutes }),
    };
  }

  return null;
}

type JobHealthAlert = NonNullable<ReturnType<typeof buildJobAlert>>;

function maskEmail(email: string | null, locale: AppLocale) {
  if (!email) return t(locale).common.system;
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}

function readMetadata(metadata: unknown) {
  return typeof metadata === "object" && metadata !== null ? metadata as Record<string, unknown> : {};
}

function formatAuditAction(action: string, metadata: unknown, locale: AppLocale) {
  const copy = t(locale);
  const details = readMetadata(metadata);

  if (action === "prediction_saved") {
    return formatMessage(copy.admin.auditPredictionSaved, { goalsA: String(details.goalsA ?? "?"), goalsB: String(details.goalsB ?? "?") });
  }

  if (action === "admin_result_saved") {
    return formatMessage(copy.admin.auditResultSaved, { goalsA: String(details.goalsA ?? "?"), goalsB: String(details.goalsB ?? "?") });
  }

  if (action === "admin_match_status_saved") {
    return formatMessage(copy.admin.auditStatusSaved, { status: details.status === "live" ? copy.common.live : String(details.status ?? copy.admin.scheduled) });
  }

  if (action === "admin_external_fixture_saved") {
    return formatMessage(copy.admin.auditFixtureSaved, { fixture: String(details.externalFixtureId ?? copy.admin.emptyValue) });
  }

  if (action === "profile_updated") return copy.admin.auditProfileUpdated;
  if (action === "pool_created") return formatMessage(copy.admin.auditPoolCreated, { name: String(details.name ?? copy.admin.withoutName) });
  if (action === "pool_joined") return copy.admin.auditPoolJoined;
  if (action === "pool_renamed") return formatMessage(copy.admin.auditPoolRenamed, { name: String(details.name ?? copy.admin.withoutName) });
  if (action === "pool_rules_updated") return copy.admin.auditPoolRulesUpdated;
  if (action === "pool_invite_regenerated") return copy.admin.auditInviteRegenerated;
  if (action === "pool_member_removed") return copy.admin.auditMemberRemoved;
  if (action === "assistant_answer_generated") {
    const source = details.source === "openrouter" ? "OpenRouter" : "fallback local";
    return `Assistente IA respondeu via ${source}`;
  }
  if (action.endsWith("_denied")) return copy.admin.auditDenied;
  if (action === "serpapi_result_imported") return "SerpAPI result imported";

  return action.replaceAll("_", " ");
}

function formatAuditEntity(entity: string | null, entityId: string | null, locale: AppLocale) {
  if (!entity) return t(locale).common.generalEvent;
  if (!entityId) return entity;
  return `${entity} ${entityId.slice(0, 8)}`;
}

export default async function AdminPage() {
  const session = await auth();

  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const locale = await getCurrentLocale();
  const copy = t(locale);

  const matches = await prisma.match.findMany({
    include: { _count: { select: { events: true, predictions: true } } },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
  });
  const auditLogs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  const syncRuns = await prisma.resultSyncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  const scheduledJobRuns = await prisma.scheduledJobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 6,
  });

  const finishedCount = matches.filter((match) => match.finishedAt).length;
  const latestSyncRun = syncRuns[0] ?? null;
  const latestPushJobRun = scheduledJobRuns.find((run) => run.jobName === "push_pending_picks") ?? null;
  const latestResultPushJobRun = scheduledJobRuns.find((run) => run.jobName === "push_results") ?? null;
  const now = new Date();
  const syncDelayMinutes = readPositiveInt("SERPAPI_RESULT_DELAY_MINUTES", 120);
  const staleSyncMinutes = readPositiveInt("SERPAPI_STALE_ALERT_MINUTES", syncDelayMinutes + 60);
  const jobRunningStaleMinutes = readPositiveInt("JOB_RUNNING_STALE_MINUTES", 20);
  const resultSyncJobStaleMinutes = readPositiveInt("JOB_RESULT_SYNC_STALE_MINUTES", 180);
  const pushReminderJobStaleMinutes = readPositiveInt("JOB_PUSH_REMINDER_STALE_MINUTES", 180);
  const resultPushJobStaleMinutes = readPositiveInt("JOB_RESULT_PUSH_STALE_MINUTES", 180);
  const staleCutoff = new Date(now.getTime() - staleSyncMinutes * 60 * 1000);
  const stalePendingMatches = matches.filter((match) =>
    match.startsAt
    && match.startsAt <= staleCutoff
    && match.resultGoalsA === null
    && match.resultGoalsB === null
  );
  const operationalMatches = matches
    .filter((match) => match.startsAt && match.resultGoalsA === null && match.resultGoalsB === null)
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0))
    .slice(0, 8);
  const jobHealthAlerts = [
    buildJobAlert({
      jobName: copy.admin.jobResultSync,
      locale,
      now,
      run: latestSyncRun,
      runningStaleMinutes: jobRunningStaleMinutes,
      staleMinutes: resultSyncJobStaleMinutes,
    }),
    buildJobAlert({
      jobName: copy.admin.jobPushReminders,
      locale,
      now,
      run: latestPushJobRun,
      runningStaleMinutes: jobRunningStaleMinutes,
      staleMinutes: pushReminderJobStaleMinutes,
    }),
    buildJobAlert({
      jobName: copy.admin.jobResultPushes,
      locale,
      now,
      run: latestResultPushJobRun,
      runningStaleMinutes: jobRunningStaleMinutes,
      staleMinutes: resultPushJobStaleMinutes,
    }),
  ].filter((alert): alert is JobHealthAlert => Boolean(alert));

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="admin"
        eyebrow={copy.admin.eyebrow}
        title={copy.admin.title}
        description={copy.admin.description}
      />

      <section className="pageToolbar">
        <div>
          <span className="badge badgeGold">{copy.admin.results}</span>
          <h2>{copy.admin.groupMatches}</h2>
        </div>
        <div className="toolbarTips">
          <Link className="adminAiAuditButton" href="/admin/ia" aria-label="Abrir auditoria da assistente de IA">
            <span>Auditar IA</span>
            <small>RAG, embeddings e historico</small>
          </Link>
          <span>{formatMessage(copy.admin.finishedCount, { count: finishedCount })}</span>
          <span>{formatMessage(copy.admin.matchesCount, { count: matches.length })}</span>
        </div>
      </section>

      <section className="adminSyncCard">
        <div className="adminSyncHeader">
          <div>
            <span className="badge badgeGold">{copy.admin.syncBadge}</span>
            <h2>{copy.admin.syncTitle}</h2>
            <p>{copy.admin.syncDescription}</p>
            <AdminSyncFeedbackForm
              action={syncPendingResultsWithFeedback}
              buttonLabel={copy.admin.syncNow}
              closeLabel={copy.admin.syncToastClose}
              errorTitle={copy.admin.syncToastErrorTitle}
              hint={copy.admin.syncNowHint}
              loadingLabel={copy.admin.syncToastLoadingButton}
              runningText={copy.admin.syncToastRunningText}
              runningTitle={copy.admin.syncToastRunningTitle}
              successSummary={copy.admin.syncToastSuccessSummary}
              successTitle={copy.admin.syncToastSuccessTitle}
            />
          </div>
          {latestSyncRun ? (
            <div className={`adminSyncStatus adminSyncStatus${latestSyncRun.status === "failed" ? "Failed" : latestSyncRun.status === "running" ? "Running" : "Success"}`}>
              <span>{copy.admin.syncLastRun}</span>
              <strong>{formatSyncStatus(latestSyncRun.status, locale)}</strong>
              <time dateTime={latestSyncRun.startedAt.toISOString()}>{dateFormatter.format(latestSyncRun.startedAt)} {timeFormatter.format(latestSyncRun.startedAt)}</time>
            </div>
          ) : (
            <p className="muted">{copy.admin.syncNoRuns}</p>
          )}
        </div>

        {latestSyncRun && (
          <div className="adminSyncMetrics">
            <span>{formatMessage(copy.admin.syncImported, { count: latestSyncRun.imported })}</span>
            <span>{formatMessage(copy.admin.syncSkipped, { count: latestSyncRun.skipped })}</span>
            <span>{formatMessage(copy.admin.syncCandidates, { count: latestSyncRun.candidates })}</span>
          </div>
        )}

        {latestSyncRun?.errorMessage && (
          <p className="adminSyncError"><strong>{copy.admin.syncError}:</strong> {latestSyncRun.errorMessage}</p>
        )}

        <div className="adminSyncAlerts">
          <h3>{copy.admin.syncAlertsTitle}</h3>
          {latestSyncRun?.status === "failed" && <p className="adminSyncError">{copy.admin.syncFailedAlert}</p>}
          {stalePendingMatches.length > 0 && <p className="adminSyncWarning">{formatMessage(copy.admin.syncStaleAlert, { count: stalePendingMatches.length })}</p>}
          {latestSyncRun?.status !== "failed" && stalePendingMatches.length === 0 && <p className="muted">{copy.admin.syncNoAlerts}</p>}
        </div>

        {syncRuns.length > 0 && (
          <div className="adminSyncRuns">
            <h3>{copy.admin.syncRecentRuns}</h3>
            {syncRuns.map((run) => (
              <article className="adminSyncRun" key={run.id}>
                <div>
                  <strong>{formatSyncStatus(run.status, locale)}</strong>
                  <span>{formatMessage(copy.admin.syncCandidates, { count: run.candidates })} - {formatMessage(copy.admin.syncImported, { count: run.imported })}</span>
                </div>
                <div>
                  <span>{copy.admin.syncStartedAt}: {dateFormatter.format(run.startedAt)} {timeFormatter.format(run.startedAt)}</span>
                  <span>{copy.admin.syncFinishedAt}: {run.finishedAt ? `${dateFormatter.format(run.finishedAt)} ${timeFormatter.format(run.finishedAt)}` : copy.common.loading}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="adminSyncCard">
        <div className="adminSyncHeader">
          <div>
            <span className="badge badgeGold">{copy.admin.jobHealthBadge}</span>
            <h2>{copy.admin.jobHealthTitle}</h2>
            <p>{copy.admin.jobHealthDescription}</p>
          </div>
        </div>

        <div className="adminJobHealthGrid">
          <article>
            <span>{copy.admin.jobResultSync}</span>
            <strong>{latestSyncRun ? formatSyncStatus(latestSyncRun.status, locale) : copy.admin.syncNoRuns}</strong>
            <small>{latestSyncRun ? `${dateFormatter.format(latestSyncRun.startedAt)} ${timeFormatter.format(latestSyncRun.startedAt)}` : copy.admin.jobNeverRan}</small>
          </article>
          <article>
            <span>{copy.admin.jobPushReminders}</span>
            <strong>{latestPushJobRun ? formatSyncStatus(latestPushJobRun.status, locale) : copy.admin.syncNoRuns}</strong>
            <small>{latestPushJobRun ? `${dateFormatter.format(latestPushJobRun.startedAt)} ${timeFormatter.format(latestPushJobRun.startedAt)}` : copy.admin.jobNeverRan}</small>
          </article>
          <article>
            <span>{copy.admin.jobResultPushes}</span>
            <strong>{latestResultPushJobRun ? formatSyncStatus(latestResultPushJobRun.status, locale) : copy.admin.syncNoRuns}</strong>
            <small>{latestResultPushJobRun ? `${dateFormatter.format(latestResultPushJobRun.startedAt)} ${timeFormatter.format(latestResultPushJobRun.startedAt)}` : copy.admin.jobNeverRan}</small>
          </article>
        </div>

        <div className="adminSyncAlerts">
          <h3>{copy.admin.jobAlertsTitle}</h3>
          {jobHealthAlerts.length > 0 ? (
            jobHealthAlerts.map((alert) => (
              <p className={alert.level === "error" ? "adminSyncError" : "adminSyncWarning"} key={alert.message}>{alert.message}</p>
            ))
          ) : (
            <p className="muted">{copy.admin.jobNoAlerts}</p>
          )}
        </div>

        {scheduledJobRuns.length > 0 && (
          <div className="adminSyncRuns">
            <h3>{copy.admin.jobRecentRuns}</h3>
            {scheduledJobRuns.map((run) => (
              <article className="adminSyncRun" key={run.id}>
                <div>
                  <strong>{run.jobName === "push_pending_picks" ? copy.admin.jobPushReminders : run.jobName === "push_results" ? copy.admin.jobResultPushes : run.jobName}</strong>
                  <span>{formatSyncStatus(run.status, locale)}</span>
                </div>
                <div>
                  <span>{copy.admin.syncStartedAt}: {dateFormatter.format(run.startedAt)} {timeFormatter.format(run.startedAt)}</span>
                  <span>{copy.admin.syncFinishedAt}: {run.finishedAt ? `${dateFormatter.format(run.finishedAt)} ${timeFormatter.format(run.finishedAt)}` : copy.common.loading}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="adminOpsCalendar">
        <div className="adminOpsCalendarHeader">
          <span className="badge badgeGold">{copy.admin.opsCalendar}</span>
          <h2>{copy.admin.opsCalendar}</h2>
          <p>{copy.admin.opsCalendarDescription}</p>
        </div>
        <div className="adminOpsList">
          {operationalMatches.map((match) => {
            const startsAt = match.startsAt as Date;
            const pickClosesAt = new Date(startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000);
            const syncAt = new Date(startsAt.getTime() + syncDelayMinutes * 60 * 1000);
            return (
              <article className="adminOpsItem" key={match.id}>
                <strong>{getTeamDisplayName(match.teamA, locale)} x {getTeamDisplayName(match.teamB, locale)}</strong>
                <span>{copy.admin.opsMatchStarts}: {formatDateTime(startsAt, locale)}</span>
                <span>{copy.admin.opsPicksClose}: {formatDateTime(pickClosesAt, locale)}</span>
                <span>{copy.admin.opsSyncAt}: {formatDateTime(syncAt, locale)}</span>
              </article>
            );
          })}
        </div>
      </section>

      <section className="adminActivityCard">
        <div className="adminActivityHeader">
          <div>
            <span className="badge badgeGold">{copy.admin.audit}</span>
            <h2>{copy.admin.recentActivity}</h2>
          </div>
          <span>{formatMessage(copy.admin.eventsCount, { count: auditLogs.length })}</span>
        </div>

        {auditLogs.length === 0 ? (
          <p className="muted">{copy.admin.noEvents}</p>
        ) : (
          <div className="adminActivityList">
            {auditLogs.map((log) => (
              <article className="adminActivityItem" key={log.id}>
                <div>
                  <strong>{formatAuditAction(log.action, log.metadata, locale)}</strong>
                  <span>{formatAuditEntity(log.entity, log.entityId, locale)} - {maskEmail(log.actorEmail, locale)}</span>
                </div>
                <time dateTime={log.createdAt.toISOString()}>{dateFormatter.format(log.createdAt)} {timeFormatter.format(log.createdAt)}</time>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="adminResultsList">
        {matches.map((match) => {
          const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
          const matchStatus = formatMatchStatus(match.status, hasResult, locale);
          const teamALabel = getTeamDisplayName(match.teamA, locale);
          const teamBLabel = getTeamDisplayName(match.teamB, locale);

          return (
            <article className="adminResultCard" key={match.id}>
              <div className="adminResultHeader">
                <div>
                  <span className="badge">{copy.common.group} {match.group}</span>
                  <h2>{teamALabel} x {teamBLabel}</h2>
                  <p className="muted">{formatMatchDate(match.startsAt, locale)} - {getMatchVenue(match.group, match.teamA, match.teamB)}</p>
                </div>
                <div className="adminResultStatus">
                  <strong>{hasResult ? `${match.resultGoalsA} x ${match.resultGoalsB}` : copy.admin.pending}</strong>
                  <span>{matchStatus} - {formatMessage(copy.admin.predictionsCount, { count: match._count.predictions })} - {formatMessage(copy.admin.eventsLabel, { count: match._count.events })}</span>
                </div>
              </div>

              {!hasResult && (
                <form action={saveMatchStatus} className="adminStatusForm">
                  <input name="matchId" type="hidden" value={match.id} />
                  <label>
                    <span>{copy.admin.statusLabel}</span>
                    <select name="status" defaultValue={match.status}>
                      <option value="scheduled">{copy.admin.scheduled}</option>
                      <option value="live">{copy.admin.live}</option>
                    </select>
                  </label>
                  <button className="buttonSecondary" type="submit">{copy.admin.updateStatus}</button>
                </form>
              )}

              <form action={saveMatchLiveUrl} className="adminStatusForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>{copy.admin.externalLiveUrl}</span>
                  <input
                    aria-label={`${copy.admin.externalLiveUrl}: ${teamALabel} x ${teamBLabel}`}
                    defaultValue={match.liveUrl ?? ""}
                    name="liveUrl"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
                <button className="buttonSecondary" type="submit">{copy.admin.saveLink}</button>
              </form>

              <form action={saveMatchEvent} className="adminEventForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>{copy.admin.minute}</span>
                  <input aria-label={`${copy.admin.minute}: ${teamALabel} x ${teamBLabel}`} name="minute" placeholder={copy.admin.minutePlaceholder} type="text" />
                </label>
                <label>
                  <span>{copy.admin.eventTitle}</span>
                  <input aria-label={`${copy.admin.eventTitle}: ${teamALabel} x ${teamBLabel}`} name="title" placeholder={copy.admin.eventTitlePlaceholder} type="text" />
                </label>
                <label>
                  <span>{copy.admin.descriptionLabel}</span>
                  <input aria-label={`${copy.admin.descriptionLabel}: ${teamALabel} x ${teamBLabel}`} name="description" placeholder={copy.admin.eventDescriptionPlaceholder} type="text" />
                </label>
                <button className="buttonSecondary" type="submit">{copy.admin.addEvent}</button>
              </form>

              <form action={saveMatchResult} className="adminResultForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>{teamALabel}</span>
                  <input
                    aria-label={teamALabel}
                    defaultValue={match.resultGoalsA ?? ""}
                    max={MAX_GOALS}
                    min="0"
                    name="goalsA"
                    required
                    type="number"
                  />
                </label>
                <span className="versus">x</span>
                <label>
                  <span>{teamBLabel}</span>
                  <input
                    aria-label={teamBLabel}
                    defaultValue={match.resultGoalsB ?? ""}
                    max={MAX_GOALS}
                    min="0"
                    name="goalsB"
                    required
                    type="number"
                  />
                </label>
                <label>
                  <span>Classificado</span>
                  <select
                    aria-label={`Classificado: ${teamALabel} x ${teamBLabel}`}
                    defaultValue={match.winnerTeam ?? ""}
                    name="winnerTeam"
                  >
                    <option value="">Inferir pelo placar</option>
                    <option value={match.teamA}>{teamALabel}</option>
                    <option value={match.teamB}>{teamBLabel}</option>
                  </select>
                </label>
                <label>
                  <span>Decisao</span>
                  <select
                    aria-label={`Decisao: ${teamALabel} x ${teamBLabel}`}
                    defaultValue={match.resultMethod ?? ""}
                    name="resultMethod"
                  >
                    <option value="">Inferir</option>
                    <option value="regular">Tempo normal</option>
                    <option value="extra_time">Prorrogacao</option>
                    <option value="penalties">Penaltis</option>
                  </select>
                </label>
                <label>
                  <span>Penaltis {teamALabel}</span>
                  <input
                    aria-label={`Penaltis ${teamALabel}`}
                    defaultValue={match.penaltyGoalsA ?? ""}
                    max={30}
                    min="0"
                    name="penaltyGoalsA"
                    type="number"
                  />
                </label>
                <label>
                  <span>Penaltis {teamBLabel}</span>
                  <input
                    aria-label={`Penaltis ${teamBLabel}`}
                    defaultValue={match.penaltyGoalsB ?? ""}
                    max={30}
                    min="0"
                    name="penaltyGoalsB"
                    type="number"
                  />
                </label>
                <button type="submit">{hasResult ? copy.admin.updateResult : copy.admin.saveResult}</button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
