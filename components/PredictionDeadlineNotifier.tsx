"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMessage, t, type AppLocale } from "../lib/i18n-shared";
import { PREDICTION_CLOSE_MINUTES } from "../lib/prediction";
import { getTeamDisplayName } from "../lib/teams";

type DeadlineNotificationMatch = {
  id: string;
  group: string;
  roundNumber: number;
  teamA: string;
  teamB: string;
  startsAt: string | null;
  hasPrediction: boolean;
};

type ScheduledReminder = {
  id: string;
  title: string;
  body: string;
  notifyAt: number;
};

const storageEnabledKey = "bolao_deadline_notifications_enabled";
const storageSentPrefix = "bolao_deadline_notification_sent";
const storageDismissPrefix = "bolao_deadline_prompt_dismissed";
const reminderWindows = [
  { key: "30m", minutesBeforeDeadline: 30 },
  { key: "5m", minutesBeforeDeadline: 5 },
];

function supportsNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function sentKey(matchId: string, reminderKey: string) {
  return `${storageSentPrefix}:${matchId}:${reminderKey}`;
}

function formatRelativeTime(target: number, locale: AppLocale) {
  const diffMinutes = Math.max(0, Math.ceil((target - Date.now()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  if (hours <= 0) return formatMessage(t(locale).bolao.notificationMinutes, { minutes });
  return formatMessage(t(locale).bolao.notificationHoursMinutes, { hours, minutes });
}

function buildReminder(match: DeadlineNotificationMatch, locale: AppLocale, reminderKey: string, notifyAt: number): ScheduledReminder {
  const copy = t(locale);
  const teamA = getTeamDisplayName(match.teamA, locale);
  const teamB = getTeamDisplayName(match.teamB, locale);

  return {
    id: sentKey(match.id, reminderKey),
    title: copy.bolao.notificationTitle,
    body: formatMessage(copy.bolao.notificationBody, {
      match: `${teamA} x ${teamB}`,
      time: formatRelativeTime(notifyAt, locale),
    }),
    notifyAt,
  };
}

function roundLabel(match: DeadlineNotificationMatch, locale: AppLocale) {
  const groupLabel = locale === "en-US" ? "Group" : "Grupo";
  const roundWord = locale === "en-US" ? "round" : locale === "es-ES" ? "ronda" : "rodada";
  return `${groupLabel} ${match.group} · ${match.roundNumber}a ${roundWord}`;
}

function getPendingReminders(matches: DeadlineNotificationMatch[], locale: AppLocale) {
  const now = Date.now();
  const reminders: ScheduledReminder[] = [];

  for (const match of matches) {
    if (match.hasPrediction || !match.startsAt) continue;

    const startsAt = new Date(match.startsAt).getTime();
    const deadline = startsAt - PREDICTION_CLOSE_MINUTES * 60 * 1000;
    if (!Number.isFinite(deadline) || deadline <= now) continue;

    for (const reminder of reminderWindows) {
      const notifyAt = deadline - reminder.minutesBeforeDeadline * 60 * 1000;
      const effectiveNotifyAt = Math.max(now + 1500, notifyAt);
      if (effectiveNotifyAt > deadline) continue;
      reminders.push(buildReminder(match, locale, reminder.key, effectiveNotifyAt));
    }
  }

  return reminders.sort((a, b) => a.notifyAt - b.notifyAt);
}

function getPromptMatches(matches: DeadlineNotificationMatch[]) {
  const now = Date.now();
  const next24Hours = now + 24 * 60 * 60 * 1000;

  return matches
    .filter((match) => {
      if (match.hasPrediction || !match.startsAt) return false;
      const startsAt = new Date(match.startsAt).getTime();
      const deadline = startsAt - PREDICTION_CLOSE_MINUTES * 60 * 1000;
      return Number.isFinite(deadline) && deadline > now && deadline <= next24Hours;
    })
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime())
    .slice(0, 3);
}

function dismissKey(matches: DeadlineNotificationMatch[]) {
  const ids = getPromptMatches(matches).map((match) => match.id).join("-");
  return `${storageDismissPrefix}:${ids || "empty"}`;
}

export function PredictionDeadlineNotifier({ locale = "pt-BR", matches }: { locale?: AppLocale; matches: DeadlineNotificationMatch[] }) {
  const copy = t(locale);
  const [isMounted, setIsMounted] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [enabled, setEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  const reminders = useMemo(() => {
    if (!isMounted) return [];
    return getPendingReminders(matches, locale);
  }, [isMounted, locale, matches]);
  const promptMatches = useMemo(() => {
    if (!isMounted) return [];
    return getPromptMatches(matches);
  }, [isMounted, matches]);

  useEffect(() => {
    setIsMounted(true);
    if (!supportsNotifications()) {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission);
      setEnabled(window.localStorage.getItem(storageEnabledKey) === "true" && Notification.permission === "granted");
    }

    setDismissed(window.sessionStorage.getItem(dismissKey(matches)) === "true");
  }, [matches]);

  useEffect(() => {
    if (!enabled || permission !== "granted") return;

    const timers = reminders.map((reminder) => {
      const delay = Math.max(0, reminder.notifyAt - Date.now());
      return window.setTimeout(() => {
        if (window.localStorage.getItem(reminder.id) === "true") return;
        new Notification(reminder.title, { body: reminder.body, tag: reminder.id });
        window.localStorage.setItem(reminder.id, "true");
      }, delay);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [enabled, permission, reminders]);

  async function enableNotifications() {
    if (!supportsNotifications()) {
      setPermission("unsupported");
      return;
    }

    const nextPermission = await Notification.requestPermission();
    setPermission(nextPermission);
    const nextEnabled = nextPermission === "granted";
    setEnabled(nextEnabled);
    window.localStorage.setItem(storageEnabledKey, String(nextEnabled));
  }

  function disableNotifications() {
    setEnabled(false);
    window.localStorage.setItem(storageEnabledKey, "false");
  }

  function closePrompt() {
    setDismissed(true);
    window.sessionStorage.setItem(dismissKey(matches), "true");
  }

  function goToPicks(matchId = promptMatches[0]?.id) {
    closePrompt();
    if (matchId) {
      window.history.replaceState(null, "", `?focus=${matchId}#bolao-confrontos`);
      window.dispatchEvent(new CustomEvent("bolao:focus-match", { detail: { matchId } }));
    }
    document.getElementById("bolao-confrontos")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!isMounted || promptMatches.length === 0 || dismissed) return null;

  const firstMatch = promptMatches[0];
  const firstDeadline = firstMatch.startsAt
    ? new Date(new Date(firstMatch.startsAt).getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000).getTime()
    : Date.now();

  return (
    <div className="deadlineModalOverlay" role="presentation">
      <section aria-modal="true" className="deadlineModal" role="dialog" aria-labelledby="deadline-modal-title">
        <button className="deadlineModalClose" onClick={closePrompt} type="button" aria-label={copy.bolao.notificationClose}>
          x
        </button>
        <span className="badge badgeGold">{copy.bolao.notificationBadge}</span>
        <h2 id="deadline-modal-title">{copy.bolao.notificationPopupTitle}</h2>
        <p className="muted">
          {formatMessage(copy.bolao.notificationPopupText, {
            count: promptMatches.length,
            time: formatRelativeTime(firstDeadline, locale),
          })}
        </p>
        <div className="deadlineModalMatches">
          {promptMatches.map((match) => (
            <article key={match.id}>
              <div>
                <strong>{getTeamDisplayName(match.teamA, locale)} x {getTeamDisplayName(match.teamB, locale)}</strong>
                <small>{roundLabel(match, locale)}</small>
              </div>
              <button className="deadlineModalMatchButton" onClick={() => goToPicks(match.id)} type="button">
                {match.startsAt ? formatRelativeTime(new Date(match.startsAt).getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000, locale) : copy.common.undefinedSchedule}
              </button>
            </article>
          ))}
        </div>
        <div className="deadlineModalActions">
          <button onClick={() => goToPicks()} type="button">{copy.bolao.notificationPickNow}</button>
          <button className="buttonSecondary" onClick={closePrompt} type="button">{copy.bolao.notificationClose}</button>
        </div>
        {permission !== "unsupported" && (
          <button className="deadlineModalReminder" onClick={enabled ? disableNotifications : enableNotifications} type="button">
            {enabled ? copy.bolao.notificationDisable : permission === "denied" ? copy.bolao.notificationDenied : copy.bolao.notificationEnable}
          </button>
        )}
      </section>
    </div>
  );
}
