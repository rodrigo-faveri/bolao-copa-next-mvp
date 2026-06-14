import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { isAdminEmail } from "../../lib/access-control";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t, type AppLocale } from "../../lib/i18n-shared";
import { MAX_GOALS } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getTeamDisplayName } from "../../lib/teams";
import { getMatchVenue } from "../../lib/venues";
import { saveMatchEvent, saveMatchLiveUrl, saveMatchResult, saveMatchStatus } from "./actions";

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

function formatMatchStatus(status: string, hasResult: boolean, locale: AppLocale) {
  const copy = t(locale);
  if (hasResult || status === "finished") return copy.common.finished;
  if (status === "live") return copy.common.live;
  return copy.admin.scheduled;
}

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
  if (action === "pool_invite_regenerated") return copy.admin.auditInviteRegenerated;
  if (action === "pool_member_removed") return copy.admin.auditMemberRemoved;
  if (action.endsWith("_denied")) return copy.admin.auditDenied;

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

  const finishedCount = matches.filter((match) => match.finishedAt).length;

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
          <span>{formatMessage(copy.admin.finishedCount, { count: finishedCount })}</span>
          <span>{formatMessage(copy.admin.matchesCount, { count: matches.length })}</span>
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
                <button type="submit">{hasResult ? copy.admin.updateResult : copy.admin.saveResult}</button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
