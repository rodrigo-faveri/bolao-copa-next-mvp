import { isPredictionOpen } from "./prediction";

type KnockoutMatchSchedule = {
  startsAt: Date;
  venue?: string;
};

const knockoutSchedule: Record<string, KnockoutMatchSchedule> = {
  "r32-1": { startsAt: new Date("2026-06-29T17:30:00-03:00") },
  "r32-2": { startsAt: new Date("2026-06-30T18:00:00-03:00") },
  "r32-3": { startsAt: new Date("2026-06-28T16:00:00-03:00") },
  "r32-4": { startsAt: new Date("2026-06-29T22:00:00-03:00") },
  "r32-5": { startsAt: new Date("2026-07-02T20:00:00-03:00") },
  "r32-6": { startsAt: new Date("2026-07-02T16:00:00-03:00") },
  "r32-7": { startsAt: new Date("2026-07-01T21:00:00-03:00") },
  "r32-8": { startsAt: new Date("2026-07-01T17:00:00-03:00") },
  "r32-9": { startsAt: new Date("2026-06-29T14:00:00-03:00") },
  "r32-10": { startsAt: new Date("2026-06-30T14:00:00-03:00") },
  "r32-11": { startsAt: new Date("2026-06-30T22:00:00-03:00") },
  "r32-12": { startsAt: new Date("2026-07-01T13:00:00-03:00") },
  "r32-13": { startsAt: new Date("2026-07-03T19:00:00-03:00") },
  "r32-14": { startsAt: new Date("2026-07-03T15:00:00-03:00") },
  "r32-15": { startsAt: new Date("2026-07-03T00:00:00-03:00") },
  "r32-16": { startsAt: new Date("2026-07-03T22:30:00-03:00") },
  "r16-1": { startsAt: new Date("2026-07-04T13:00:00-03:00") },
  "r16-2": { startsAt: new Date("2026-07-04T17:00:00-03:00") },
  "r16-3": { startsAt: new Date("2026-07-06T16:00:00-03:00") },
  "r16-4": { startsAt: new Date("2026-07-06T21:00:00-03:00") },
  "r16-5": { startsAt: new Date("2026-07-05T17:00:00-03:00") },
  "r16-6": { startsAt: new Date("2026-07-05T21:00:00-03:00") },
  "r16-7": { startsAt: new Date("2026-07-07T13:00:00-03:00") },
  "r16-8": { startsAt: new Date("2026-07-07T17:00:00-03:00") },
  "qf-1": { startsAt: new Date("2026-07-09T17:00:00-03:00") },
  "qf-2": { startsAt: new Date("2026-07-10T16:00:00-03:00") },
  "qf-3": { startsAt: new Date("2026-07-11T18:00:00-03:00") },
  "qf-4": { startsAt: new Date("2026-07-12T18:00:00-03:00") },
  "sf-1": { startsAt: new Date("2026-07-14T21:00:00-03:00") },
  "sf-2": { startsAt: new Date("2026-07-15T21:00:00-03:00") },
  "final-1": { startsAt: new Date("2026-07-19T16:00:00-03:00") },
};

export function getKnockoutMatchSchedule(matchId: string) {
  return knockoutSchedule[matchId] ?? null;
}

export function getFirstKnockoutMatchStartsAt() {
  return Object.values(knockoutSchedule)
    .map((schedule) => schedule.startsAt)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

export function isKnockoutPredictionOpen(matchId: string, now = new Date()) {
  const schedule = getKnockoutMatchSchedule(matchId);
  if (!schedule) return false;
  return isPredictionOpen(schedule.startsAt, now, false);
}
