"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { formatMessage, t } from "../lib/i18n-shared";
import { MAX_GOALS } from "../lib/prediction";
import { getTeamDisplayName, getTeamFlagUrl } from "../lib/teams";

type SimulatorMatch = {
  id: string;
  group: string;
  teamA: string;
  teamB: string;
  startsAt: string | null;
  status?: string | null;
  venue: string;
  isOpen: boolean;
  goalsA: number | null;
  goalsB: number | null;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  points: number | null;
};

type Score = { goalsA: string; goalsB: string };
type ScoreDrafts = Record<string, Score>;
type StageView = "groups" | "knockout";
type KnockoutVariant = "bracket" | "cards";

type MatchAiAnalysis = {
  favorite: string;
  risk: "Baixo" | "Medio" | "Alto";
  conservativeGoalsA: number;
  conservativeGoalsB: number;
  boldGoalsA: number;
  boldGoalsB: number;
  explanation: string;
  source?: "openrouter" | "local";
};

type MatchAiState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; analysis: MatchAiAnalysis }
  | { status: "error"; message: string };

type SaveFeedback =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

type Standing = {
  team: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

type SimulatorGroup = {
  group: string;
  rounds: SimulatorMatch[][];
  standings: Standing[];
  isComplete: boolean;
};

type QualifiedSlot = {
  label: string;
  team?: string;
};

type BracketMatch = {
  id: string;
  home: QualifiedSlot;
  away: QualifiedSlot;
};

type BracketRound = {
  id: string;
  title: string;
  matches: BracketMatch[];
};

const weekdayFormatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "America/Sao_Paulo" });
const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });

const roundOf32Template = [
  ["1E", "3Âº"],
  ["1I", "3Âº"],
  ["2A", "2B"],
  ["1F", "2C"],
  ["2K", "2L"],
  ["1H", "2J"],
  ["1D", "3Âº"],
  ["1G", "3Âº"],
  ["1C", "2F"],
  ["2E", "2I"],
  ["1A", "3Âº"],
  ["1L", "3Âº"],
  ["1J", "2H"],
  ["2D", "2G"],
  ["1B", "3Âº"],
  ["1K", "3Âº"],
] as const;
const scoreDraftsStorageKey = "bolao_score_drafts_v1";

function flagFor(team: string) {
  const flagUrl = getTeamFlagUrl(team);
  if (!flagUrl) return <span className="teamFlagPlaceholder" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${getTeamDisplayName(team)}`} loading="lazy" />;
}
function teamLabel(team: string, locale: AppLocale = "pt-BR") {
  return getTeamDisplayName(team, locale);
}

function formatWeekday(date: Date) {
  return weekdayFormatter.format(date).replace(".", "").toUpperCase();
}

function formatVenue(venue: string) {
  return venue.length > 16 ? `${venue.slice(0, 14)}...` : venue;
}

function formatCountdown(startsAt: Date | null, now: Date, locale: AppLocale, hasOfficialResult = false) {
  const copy = t(locale);
  if (hasOfficialResult) return copy.common.finished;
  if (!startsAt) return copy.common.undefinedSchedule;

  const remainingSeconds = Math.max(0, Math.floor((startsAt.getTime() - now.getTime()) / 1000));
  if (remainingSeconds <= 0) return copy.common.matchStarted;

  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;
  const prefix = locale === "en-US" ? "Starts in" : locale === "es-ES" ? "Empieza en" : "Comeca em";

  if (days > 0) return `${prefix} ${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${prefix} ${hours}h ${minutes}m ${seconds}s`;
  return `${prefix} ${minutes}m ${seconds}s`;
}
function isMatchLive(status: string | null | undefined, startsAt: Date | null, now: Date, isHydrated: boolean) {
  if (status === "live") return true;
  if (status === "finished") return false;
  if (!isHydrated || !startsAt) return false;

  const startTime = startsAt.getTime();
  const endTime = startTime + 130 * 60 * 1000;
  const currentTime = now.getTime();

  return currentTime >= startTime && currentTime <= endTime;
}

function makeInitialScores(matches: SimulatorMatch[]) {
  return Object.fromEntries(
    matches.map((match) => [
      match.id,
      {
        goalsA: match.goalsA === null ? "" : String(match.goalsA),
        goalsB: match.goalsB === null ? "" : String(match.goalsB),
      },
    ]),
  );
}

function isValidGoalDraft(value: unknown) {
  if (value === "") return true;
  if (typeof value !== "string") return false;
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_GOALS;
}

function isValidScoreDraft(value: unknown): value is Score {
  if (typeof value !== "object" || value === null) return false;
  const score = value as Partial<Score>;
  return isValidGoalDraft(score.goalsA) && isValidGoalDraft(score.goalsB);
}

function readScoreDrafts(): ScoreDrafts {
  try {
    const raw = window.localStorage.getItem(scoreDraftsStorageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Score] => isValidScoreDraft(entry[1])),
    );
  } catch {
    return {};
  }
}

function writeScoreDrafts(drafts: ScoreDrafts) {
  const entries = Object.entries(drafts);
  if (entries.length === 0) {
    window.localStorage.removeItem(scoreDraftsStorageKey);
    return;
  }

  window.localStorage.setItem(scoreDraftsStorageKey, JSON.stringify(Object.fromEntries(entries)));
}

function canUseScoreDraft(match: SimulatorMatch, currentScore: Score) {
  return match.isOpen
    && match.resultGoalsA === null
    && match.resultGoalsB === null
    && currentScore.goalsA === ""
    && currentScore.goalsB === "";
}

function emptyStanding(team: string): Standing {
  return {
    team,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

function calculateStandings(matches: SimulatorMatch[], scores: Record<string, Score>) {
  const standings = new Map<string, Standing>();

  for (const match of matches) {
    standings.set(match.teamA, standings.get(match.teamA) ?? emptyStanding(match.teamA));
    standings.set(match.teamB, standings.get(match.teamB) ?? emptyStanding(match.teamB));

    const officialGoalsA = match.resultGoalsA;
    const officialGoalsB = match.resultGoalsB;
    const hasOfficialResult = officialGoalsA !== null && officialGoalsB !== null;
    const score = scores[match.id];
    if (!hasOfficialResult && (!score || score.goalsA === "" || score.goalsB === "")) continue;

    const goalsA = hasOfficialResult ? officialGoalsA : Number(score.goalsA);
    const goalsB = hasOfficialResult ? officialGoalsB : Number(score.goalsB);
    if (!Number.isInteger(goalsA) || !Number.isInteger(goalsB)) continue;

    const teamA = standings.get(match.teamA)!;
    const teamB = standings.get(match.teamB)!;

    teamA.played += 1;
    teamB.played += 1;
    teamA.goalsFor += goalsA;
    teamA.goalsAgainst += goalsB;
    teamB.goalsFor += goalsB;
    teamB.goalsAgainst += goalsA;

    if (goalsA > goalsB) {
      teamA.wins += 1;
      teamB.losses += 1;
      teamA.points += 3;
    } else if (goalsA < goalsB) {
      teamB.wins += 1;
      teamA.losses += 1;
      teamB.points += 3;
    } else {
      teamA.draws += 1;
      teamB.draws += 1;
      teamA.points += 1;
      teamB.points += 1;
    }
  }

  return Array.from(standings.values())
    .map((team) => ({ ...team, goalDifference: team.goalsFor - team.goalsAgainst }))
    .sort((a, b) =>
      b.points - a.points
      || b.goalDifference - a.goalDifference
      || b.goalsFor - a.goalsFor
      || a.team.localeCompare(b.team),
    );
}

function hasCompleteScores(match: SimulatorMatch, scores: Record<string, Score>) {
  if (match.resultGoalsA !== null && match.resultGoalsB !== null) return true;
  const score = scores[match.id];
  if (!score || score.goalsA === "" || score.goalsB === "") return false;
  return Number.isInteger(Number(score.goalsA)) && Number.isInteger(Number(score.goalsB));
}

function sortThirdPlaces(a: Standing, b: Standing) {
  return (
    b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || a.team.localeCompare(b.team)
  );
}

function buildRoundOf32(groups: SimulatorGroup[]): BracketRound {
  const qualified = new Map<string, string>();
  const thirdPlaces: Standing[] = [];

  for (const group of groups) {
    if (!group.isComplete) continue;

    const [first, second, third] = group.standings;
    if (first) qualified.set(`1${group.group}`, first.team);
    if (second) qualified.set(`2${group.group}`, second.team);
    if (third) thirdPlaces.push(third);
  }

  const bestThirds = thirdPlaces.sort(sortThirdPlaces).slice(0, 8);
  let thirdIndex = 0;

  const resolveSlot = (label: string): QualifiedSlot => {
    if (label === "3Âº") {
      const team = bestThirds[thirdIndex]?.team;
      thirdIndex += 1;
      return { label, team };
    }

    return { label, team: qualified.get(label) };
  };

  return {
    id: "round-of-32",
    title: "16 avos",
    matches: roundOf32Template.map(([home, away], index) => ({
      id: `r32-${index + 1}`,
      home: resolveSlot(home),
      away: resolveSlot(away),
    })),
  };
}

function buildNextRound(previousRound: BracketRound, title: string, prefix: string, winners: Record<string, string>): BracketRound {
  const matches: BracketMatch[] = [];

  for (let index = 0; index < previousRound.matches.length; index += 2) {
    const homeMatch = previousRound.matches[index];
    const awayMatch = previousRound.matches[index + 1];
    const homeWinner = winners[homeMatch.id];
    const awayWinner = winners[awayMatch.id];

    matches.push({
      id: `${prefix}-${Math.floor(index / 2) + 1}`,
      home: {
        label: `Venc. ${Math.floor(index / 2) * 2 + 1}`,
        team: homeWinner && [homeMatch.home.team, homeMatch.away.team].includes(homeWinner) ? homeWinner : undefined,
      },
      away: {
        label: `Venc. ${Math.floor(index / 2) * 2 + 2}`,
        team: awayWinner && [awayMatch.home.team, awayMatch.away.team].includes(awayWinner) ? awayWinner : undefined,
      },
    });
  }

  return { id: prefix, title, matches };
}

function splitRounds(matches: SimulatorMatch[]) {
  const sorted = [...matches].sort((a, b) => {
    const timeA = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    const timeB = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
    return timeA - timeB;
  });
  return [sorted.slice(0, 2), sorted.slice(2, 4), sorted.slice(4, 6)];
}

function shortTeamName(team: string) {
  return teamLabel(team)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function WorldCupSimulator({
  canSave,
  clearKnockoutAction,
  deleteKnockoutAction,
  enableKnockout = false,
  focusMatchId,
  initialKnockoutWinners = {},
  knockoutPoolInviteCode,
  knockoutVariant = "bracket",
  locale = "pt-BR",
  matches,
  saveAction,
  saveKnockoutAction,
  showStandings = true,
}: {
  canSave: boolean;
  clearKnockoutAction?: (formData: FormData) => void | Promise<void>;
  deleteKnockoutAction?: (formData: FormData) => void | Promise<void>;
  enableKnockout?: boolean;
  focusMatchId?: string | null;
  initialKnockoutWinners?: Record<string, string>;
  knockoutPoolInviteCode?: string | null;
  knockoutVariant?: KnockoutVariant;
  locale?: AppLocale;
  matches: SimulatorMatch[];
  saveAction?: (formData: FormData) => void | Promise<void>;
  saveKnockoutAction?: (formData: FormData) => void | Promise<void>;
  showStandings?: boolean;
}) {
  const copy = t(locale);
  const [scores, setScores] = useState(() => makeInitialScores(matches));
  const [draftMatchIds, setDraftMatchIds] = useState<Set<string>>(() => new Set());
  const [roundByGroup, setRoundByGroup] = useState<Record<string, number>>({});
  const [knockoutWinners, setKnockoutWinners] = useState<Record<string, string>>(() => initialKnockoutWinners);
  const [knockoutRoundIndex, setKnockoutRoundIndex] = useState(0);
  const [stageView, setStageView] = useState<StageView>("groups");
  const [now, setNow] = useState(() => new Date());
  const [isHydrated, setIsHydrated] = useState(false);
  const [aiAnalysisByMatch, setAiAnalysisByMatch] = useState<Record<string, MatchAiState>>({});
  const [saveFeedbackByMatch, setSaveFeedbackByMatch] = useState<Record<string, SaveFeedback>>({});
  const saveFeedbackTimers = useRef<Record<string, number>>({});
  const lastFocusedMatch = useRef<string | null>(null);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  useEffect(() => {
    const timers = saveFeedbackTimers.current;
    setIsHydrated(true);
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearInterval(interval);
      for (const timer of Object.values(timers)) window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setKnockoutWinners(initialKnockoutWinners);
  }, [initialKnockoutWinners]);
  useEffect(() => {
    if (!canSave || !saveAction) return;

    const drafts = readScoreDrafts();
    const restoredDraftIds = new Set<string>();

    setScores((current) => {
      let hasChanges = false;
      const next = { ...current };

      for (const match of matches) {
        const draft = drafts[match.id];
        const currentScore = next[match.id] ?? { goalsA: "", goalsB: "" };
        if (!draft || !canUseScoreDraft(match, currentScore)) continue;

        next[match.id] = draft;
        restoredDraftIds.add(match.id);
        hasChanges = true;
      }

      return hasChanges ? next : current;
    });

    setDraftMatchIds(restoredDraftIds);
  }, [canSave, matches, saveAction]);
  const groups = useMemo<SimulatorGroup[]>(() => {
    const byGroup = new Map<string, SimulatorMatch[]>();
    for (const match of matches) {
      const groupMatches = byGroup.get(match.group) ?? [];
      groupMatches.push(match);
      byGroup.set(match.group, groupMatches);
    }

    return Array.from(byGroup.entries()).map(([group, groupMatches]) => {
      const sortedMatches = [...groupMatches].sort((a, b) => {
        const timeA = a.startsAt ? new Date(a.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const timeB = b.startsAt ? new Date(b.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return timeA - timeB;
      });

      return {
        group,
        rounds: splitRounds(sortedMatches),
        standings: calculateStandings(sortedMatches, scores),
        isComplete: sortedMatches.length > 0 && sortedMatches.every((match) => hasCompleteScores(match, scores)),
      };
    });
  }, [matches, scores]);
  const bracketRounds = useMemo(() => {
    const roundOf32 = buildRoundOf32(groups);
    const roundOf16 = buildNextRound(roundOf32, "Oitavas", "r16", knockoutWinners);
    const quarterFinals = buildNextRound(roundOf16, "Quartas", "qf", knockoutWinners);
    const semiFinals = buildNextRound(quarterFinals, "Semis", "sf", knockoutWinners);
    const final = buildNextRound(semiFinals, "Final", "final", knockoutWinners);

    return [roundOf32, roundOf16, quarterFinals, semiFinals, final];
  }, [groups, knockoutWinners]);
  const selectedKnockoutRound = bracketRounds[knockoutRoundIndex] ?? bracketRounds[0];
  const championMatch = bracketRounds.at(-1)?.matches[0];
  const champion = championMatch ? knockoutWinners[championMatch.id] : undefined;

  function getBracketRound(matchId: string) {
    return bracketRounds.find((round) => round.matches.some((match) => match.id === matchId)) ?? selectedKnockoutRound;
  }

  function buildKnockoutScopeFormData() {
    const formData = new FormData();
    if (knockoutPoolInviteCode) formData.set("poolInviteCode", knockoutPoolInviteCode);
    return formData;
  }

  function focusMatch(matchId: string) {
    const targetGroup = groups.find((item) => item.rounds.some((round) => round.some((match) => match.id === matchId)));
    if (!targetGroup) return;

    const roundIndex = targetGroup.rounds.findIndex((round) => round.some((match) => match.id === matchId));
    if (roundIndex < 0) return;

    setStageView("groups");
    setRoundByGroup((current) => ({ ...current, [targetGroup.group]: roundIndex }));
    window.setTimeout(() => {
      document.getElementById(`match-${matchId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  useEffect(() => {
    if (!focusMatchId) return;
    if (lastFocusedMatch.current === focusMatchId) return;
    lastFocusedMatch.current = focusMatchId;
    focusMatch(focusMatchId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMatchId, groups]);

  useEffect(() => {
    function handleFocus(event: Event) {
      const detail = (event as CustomEvent<{ matchId?: string }>).detail;
      if (detail?.matchId) {
        lastFocusedMatch.current = detail.matchId;
        focusMatch(detail.matchId);
      }
    }

    window.addEventListener("bolao:focus-match", handleFocus);
    return () => window.removeEventListener("bolao:focus-match", handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  useEffect(() => {
    function handleApplyPick(event: Event) {
      const detail = (event as CustomEvent<{ goalsA?: number; goalsB?: number; matchId?: string }>).detail;
      const goalsA = detail?.goalsA;
      const goalsB = detail?.goalsB;
      if (
        !detail?.matchId
        || typeof goalsA !== "number"
        || typeof goalsB !== "number"
        || !Number.isInteger(goalsA)
        || !Number.isInteger(goalsB)
      ) return;

      applyAiPick(detail.matchId, goalsA, goalsB);
      lastFocusedMatch.current = detail.matchId;
      focusMatch(detail.matchId);
    }

    window.addEventListener("bolao:apply-pick", handleApplyPick);
    return () => window.removeEventListener("bolao:apply-pick", handleApplyPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  async function chooseWinner(match: BracketMatch, team?: string) {
    if (!team) return;
    if (![match.home.team, match.away.team].includes(team)) return;
    setKnockoutWinners((current) => ({ ...current, [match.id]: team }));
    if (!canSave || !saveKnockoutAction) return;

    const feedbackKey = `knockout:${match.id}`;
    setSaveFeedbackByMatch((current) => ({ ...current, [feedbackKey]: { status: "saving" } }));

    const round = getBracketRound(match.id);
    const formData = new FormData();
    formData.set("bracketMatchId", match.id);
    formData.set("bracketRound", round.title);
    formData.set("homeLabel", match.home.label);
    formData.set("awayLabel", match.away.label);
    formData.set("homeTeam", match.home.team ?? "");
    formData.set("awayTeam", match.away.team ?? "");
    formData.set("winnerTeam", team);
    if (knockoutPoolInviteCode) formData.set("poolInviteCode", knockoutPoolInviteCode);

    try {
      await saveKnockoutAction(formData);
      showTemporarySaveFeedback(feedbackKey, { status: "saved", message: copy.simulator.saved });
    } catch (error) {
      showTemporarySaveFeedback(feedbackKey, {
        status: "error",
        message: error instanceof Error ? error.message : copy.simulator.saveError,
      });
    }
  }

  async function removeWinner(match: BracketMatch) {
    setKnockoutWinners((current) => {
      const next = { ...current };
      delete next[match.id];
      return next;
    });
    if (!canSave || !deleteKnockoutAction) return;

    const feedbackKey = `knockout:${match.id}`;
    setSaveFeedbackByMatch((current) => ({ ...current, [feedbackKey]: { status: "saving" } }));

    const formData = buildKnockoutScopeFormData();
    formData.set("bracketMatchId", match.id);

    try {
      await deleteKnockoutAction(formData);
      showTemporarySaveFeedback(feedbackKey, { status: "saved", message: copy.simulator.knockoutPickRemoved });
    } catch (error) {
      showTemporarySaveFeedback(feedbackKey, {
        status: "error",
        message: error instanceof Error ? error.message : copy.simulator.saveError,
      });
    }
  }

  async function clearKnockoutWinners() {
    setKnockoutWinners({});
    if (!canSave || !clearKnockoutAction) return;

    const feedbackKey = "knockout:clear";
    setSaveFeedbackByMatch((current) => ({ ...current, [feedbackKey]: { status: "saving" } }));

    try {
      await clearKnockoutAction(buildKnockoutScopeFormData());
      showTemporarySaveFeedback(feedbackKey, { status: "saved", message: copy.simulator.knockoutPicksCleared });
    } catch (error) {
      showTemporarySaveFeedback(feedbackKey, {
        status: "error",
        message: error instanceof Error ? error.message : copy.simulator.saveError,
      });
    }
  }

  function applyAiPick(matchId: string, goalsA: number, goalsB: number) {
    const nextScore = { goalsA: String(goalsA), goalsB: String(goalsB) };
    setScores((current) => ({
      ...current,
      [matchId]: nextScore,
    }));
    persistScoreDraft(matchId, nextScore);
    clearSaveFeedback(matchId);
  }

  function persistScoreDraft(matchId: string, nextScore: Score) {
    if (!canSave || !saveAction) return;
    const match = matchById.get(matchId);
    if (!match || !match.isOpen || match.resultGoalsA !== null || match.resultGoalsB !== null) return;

    const drafts = readScoreDrafts();
    if (nextScore.goalsA === "" && nextScore.goalsB === "") {
      delete drafts[matchId];
      setDraftMatchIds((current) => {
        if (!current.has(matchId)) return current;
        const next = new Set(current);
        next.delete(matchId);
        return next;
      });
    } else {
      drafts[matchId] = nextScore;
      setDraftMatchIds((current) => new Set(current).add(matchId));
    }
    writeScoreDrafts(drafts);
  }

  function clearScoreDraft(matchId: string) {
    const drafts = readScoreDrafts();
    delete drafts[matchId];
    writeScoreDrafts(drafts);
    setDraftMatchIds((current) => {
      if (!current.has(matchId)) return current;
      const next = new Set(current);
      next.delete(matchId);
      return next;
    });
  }

  function discardScoreDraft(matchId: string) {
    clearScoreDraft(matchId);
    clearSaveFeedback(matchId);
    setScores((current) => ({
      ...current,
      [matchId]: { goalsA: "", goalsB: "" },
    }));
  }

  function clearSaveFeedback(matchId: string) {
    const timer = saveFeedbackTimers.current[matchId];
    if (timer) window.clearTimeout(timer);
    delete saveFeedbackTimers.current[matchId];
    setSaveFeedbackByMatch((current) => {
      if (!current[matchId]) return current;
      const next = { ...current };
      delete next[matchId];
      return next;
    });
  }

  function showTemporarySaveFeedback(matchId: string, feedback: SaveFeedback) {
    const timer = saveFeedbackTimers.current[matchId];
    if (timer) window.clearTimeout(timer);

    setSaveFeedbackByMatch((current) => ({ ...current, [matchId]: feedback }));

    if (feedback.status === "saved") {
      saveFeedbackTimers.current[matchId] = window.setTimeout(() => {
        setSaveFeedbackByMatch((current) => {
          const currentFeedback = current[matchId];
          if (currentFeedback?.status !== "saved") return current;
          const next = { ...current };
          delete next[matchId];
          return next;
        });
        delete saveFeedbackTimers.current[matchId];
      }, 3500);
    }
  }

  function handleScoreChange(matchId: string, nextScore: Score) {
    clearSaveFeedback(matchId);
    persistScoreDraft(matchId, nextScore);
    setScores((current) => ({ ...current, [matchId]: nextScore }));
  }

  async function handleSavePrediction(matchId: string, formData: FormData) {
    if (!saveAction) return;

    closeMatchAnalysis(matchId);
    setSaveFeedbackByMatch((current) => ({ ...current, [matchId]: { status: "saving" } }));

    try {
      await saveAction(formData);
      clearScoreDraft(matchId);
      showTemporarySaveFeedback(matchId, { status: "saved", message: copy.simulator.saved });
    } catch (error) {
      showTemporarySaveFeedback(matchId, {
        status: "error",
        message: error instanceof Error ? error.message : copy.simulator.saveError,
      });
    }
  }

  async function requestMatchAnalysis(matchId: string) {
    setAiAnalysisByMatch((current) => ({ ...current, [matchId]: { status: "loading" } }));

    try {
      const response = await fetch("/api/ai/match-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : "Nao consegui consultar a IA agora.";
        setAiAnalysisByMatch((current) => ({ ...current, [matchId]: { status: "error", message } }));
        return;
      }

      setAiAnalysisByMatch((current) => ({ ...current, [matchId]: { status: "ready", analysis: payload as MatchAiAnalysis } }));
    } catch {
      setAiAnalysisByMatch((current) => ({ ...current, [matchId]: { status: "error", message: "Falha de conexao com o assistente." } }));
    }
  }

  function closeMatchAnalysis(matchId: string) {
    setAiAnalysisByMatch((current) => ({ ...current, [matchId]: { status: "idle" } }));
  }

  function renderBracketTeam(match: BracketMatch, slot: QualifiedSlot) {
    const selectedWinner = knockoutWinners[match.id];

    return (
      <button
        className={`bracketTeam ${selectedWinner === slot.team ? "bracketTeamSelected" : ""}`}
        disabled={!slot.team}
        key={`${match.id}-${slot.label}`}
        onClick={() => chooseWinner(match, slot.team)}
        type="button"
      >
        <span className="bracketSource">{slot.label}</span>
        <span className="bracketFlag">{slot.team ? flagFor(slot.team) : <span className="teamFlagPlaceholder" aria-hidden="true" />}</span>
        <span className="bracketTeamName">{slot.team ? shortTeamName(slot.team) : "..."}</span>
      </button>
    );
  }

  function renderBracketMatch(match: BracketMatch) {
    return (
      <div className="bracketMatch" key={match.id}>
        {[match.home, match.away].map((slot) => renderBracketTeam(match, slot))}
      </div>
    );
  }

  function renderBracketColumn(round: BracketRound, start: number, end: number, side: "left" | "right") {
    return (
      <div className={`bracketRound bracketRound${side === "left" ? "Left" : "Right"}`} key={`${round.id}-${start}-${end}`}>
        <h3>{round.title}</h3>
        <div className="bracketMatches">
          {round.matches.slice(start, end).map((match) => renderBracketMatch(match))}
        </div>
      </div>
    );
  }

  function renderKnockoutPhaseTabs() {
    return (
      <div className="knockoutPhaseTabs" role="tablist" aria-label="Fases do mata-mata">
        {bracketRounds.map((round, index) => (
          <button
            aria-selected={knockoutRoundIndex === index}
            className={`knockoutPhaseTab ${knockoutRoundIndex === index ? "knockoutPhaseTabActive" : ""}`}
            key={round.id}
            onClick={() => setKnockoutRoundIndex(index)}
            role="tab"
            type="button"
          >
            {round.title}
          </button>
        ))}
      </div>
    );
  }

  function renderKnockoutCardMatch(match: BracketMatch, index: number) {
    const selectedWinner = knockoutWinners[match.id];
    const saveFeedback = saveFeedbackByMatch[`knockout:${match.id}`] ?? { status: "idle" };

    return (
      <div className="knockoutCard" key={match.id}>
        <div className="knockoutCardHeader">
          <span className="badge">{copy.simulator.game} {index + 1}</span>
          <strong>{selectedKnockoutRound.title}</strong>
        </div>
        <div className="knockoutCardTeams">
          {[match.home, match.away].map((slot) => (
            <button
              className={`knockoutPickTeam ${selectedWinner === slot.team ? "knockoutPickTeamSelected" : ""}`}
              disabled={!slot.team}
              key={`${match.id}-${slot.label}`}
              onClick={() => chooseWinner(match, slot.team)}
              type="button"
            >
              <span className="knockoutPickSlot">{slot.label}</span>
              {slot.team ? flagFor(slot.team) : <span className="teamFlagPlaceholder" aria-hidden="true" />}
              <span title={slot.team ? teamLabel(slot.team, locale) : undefined}>{slot.team ? teamLabel(slot.team, locale) : copy.simulator.toDefine}</span>
            </button>
          ))}
        </div>
        <div className="knockoutCardFooter">
          <p className="muted">{selectedWinner ? formatMessage(copy.simulator.pickAdvances, { team: teamLabel(selectedWinner, locale) }) : copy.simulator.chooseAdvances}</p>
          {selectedWinner && (
            <button className="textButton" onClick={() => removeWinner(match)} type="button">
              {copy.simulator.removeKnockoutPick}
            </button>
          )}
        </div>
        {saveFeedback.status === "saving" && <div className="matchSaveFeedback" role="status">{copy.simulator.saving}</div>}
        {saveFeedback.status === "saved" && <div className="matchSaveFeedback matchSaveSuccess" role="status">{saveFeedback.message}</div>}
        {saveFeedback.status === "error" && <div className="matchSaveFeedback matchSaveError" role="alert">{saveFeedback.message}</div>}
      </div>
    );
  }

  const [roundOf32, roundOf16, quarterFinals, semiFinals, finalRound] = bracketRounds;
  const knockoutClearFeedback = saveFeedbackByMatch["knockout:clear"] ?? { status: "idle" };

  return (
    <div className="simulatorShell">
      {enableKnockout && (
        <div className="stageTabs" role="tablist" aria-label="Etapas do simulador">
          <button
            aria-selected={stageView === "groups"}
            className={`stageTab ${stageView === "groups" ? "stageTabActive" : ""}`}
            onClick={() => setStageView("groups")}
            role="tab"
            type="button"
          >
            {copy.simulator.groupStage}
          </button>
          <button
            aria-selected={stageView === "knockout"}
            className={`stageTab ${stageView === "knockout" ? "stageTabActive" : ""}`}
            onClick={() => setStageView("knockout")}
            role="tab"
            type="button"
          >
            {copy.simulator.knockout}
          </button>
        </div>
      )}

      {(!enableKnockout || stageView === "groups") && (
        <div className="simulatorGrid">
          {groups.map(({ group, rounds, standings }) => {
            const currentRound = roundByGroup[group] ?? 0;
            const roundMatches = rounds[currentRound] ?? [];

            return (
              <section className="simulatorGroup card" key={group}>
                <div className="cardHeader">
                  <h2>{copy.common.group} {group}</h2>
                  {showStandings && <span className="badge">{copy.simulator.top2Advance}</span>}
                </div>

                <div className="roundPager">
                  <button aria-label={formatMessage(copy.simulator.previousRound, { group })} className="roundArrow" disabled={currentRound === 0} onClick={() => setRoundByGroup((current) => ({ ...current, [group]: currentRound - 1 }))} type="button">â€¹</button>
                  <strong>{formatMessage(copy.simulator.roundLabel, { round: currentRound + 1 })}</strong>
                  <button aria-label={formatMessage(copy.simulator.nextRound, { group })} className="roundArrow" disabled={currentRound === rounds.length - 1} onClick={() => setRoundByGroup((current) => ({ ...current, [group]: currentRound + 1 }))} type="button">â€º</button>
                </div>

                <div className="simulatorMatches">
                  {roundMatches.map((match) => {
                    const score = scores[match.id] ?? { goalsA: "", goalsB: "" };
                    const startsAt = match.startsAt ? new Date(match.startsAt) : null;
                    const hasOfficialResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
                    const inputsDisabled = !match.isOpen || hasOfficialResult;
                    const canSubmit = canSave && match.isOpen && !hasOfficialResult && score.goalsA !== "" && score.goalsB !== "" && Boolean(saveAction);
                    const aiState = aiAnalysisByMatch[match.id] ?? { status: "idle" };
                    const saveFeedback = saveFeedbackByMatch[match.id] ?? { status: "idle" };
                    const isSaving = saveFeedback.status === "saving";
                    const matchIsLive = !hasOfficialResult && isMatchLive(match.status, startsAt, now, isHydrated);

                    return (
                      <form action={saveAction ? (formData) => handleSavePrediction(match.id, formData) : undefined} className="simulatorMatch" id={`match-${match.id}`} key={match.id}>
                        <div className="matchMeta">
                          <span>{startsAt ? formatWeekday(startsAt) : "--"}</span>
                          <strong>{startsAt ? dateFormatter.format(startsAt) : copy.common.noDate}</strong>
                          <span title={match.venue}>{formatVenue(match.venue)}</span>
                          <strong>{startsAt ? timeFormatter.format(startsAt) : copy.common.noTime}</strong>
                          {isHydrated && (
                            <span className={`matchCountdown ${hasOfficialResult || (startsAt && startsAt.getTime() <= now.getTime()) ? "matchCountdownClosed" : ""}`}>
                              {formatCountdown(startsAt, now, locale, hasOfficialResult)}
                            </span>
                          )}
                        </div>
                        {matchIsLive && (
                          <Link className="matchLiveBadge" href={`/tempo-real/${match.id}`}>
                            <span className="livePulse" aria-hidden="true" />
                            {copy.simulator.liveBadge}
                          </Link>
                        )}
                        <input type="hidden" name="matchId" value={match.id} />
                        <span className="teamName teamLeft" title={teamLabel(match.teamA, locale)}>{flagFor(match.teamA)}<span>{teamLabel(match.teamA, locale)}</span></span>
                        <input aria-label={`Gols de ${teamLabel(match.teamA, locale)}`} disabled={inputsDisabled || isSaving} max={MAX_GOALS} min="0" name="goalsA" onChange={(event) => handleScoreChange(match.id, { ...score, goalsA: event.target.value })} required type="number" value={score.goalsA} />
                        <span className="versus">x</span>
                        <input aria-label={`Gols de ${teamLabel(match.teamB, locale)}`} disabled={inputsDisabled || isSaving} max={MAX_GOALS} min="0" name="goalsB" onChange={(event) => handleScoreChange(match.id, { ...score, goalsB: event.target.value })} required type="number" value={score.goalsB} />
                        <span className="teamName teamRight" title={teamLabel(match.teamB, locale)}>{flagFor(match.teamB)}<span>{teamLabel(match.teamB, locale)}</span></span>
                        <div className="matchActions">
                          {hasOfficialResult ? <span className="saveHint">{copy.common.finished}</span> : canSave ? <button disabled={!canSubmit || isSaving} type="submit">{isSaving ? copy.simulator.saving : copy.simulator.save}</button> : <span className="saveHint">{copy.simulator.signInToSave}</span>}
                          <button className="aiHelpButton" disabled={hasOfficialResult || aiState.status === "loading"} onClick={() => requestMatchAnalysis(match.id)} type="button">
                            {aiState.status === "loading" ? "..." : copy.simulator.ai}
                          </button>
                        </div>
                        {draftMatchIds.has(match.id) && !hasOfficialResult && saveFeedback.status !== "saved" && (
                          <div className="matchDraftHint" role="status">
                            <span>{copy.simulator.localDraft}</span>
                            <button onClick={() => discardScoreDraft(match.id)} type="button">{copy.simulator.clearLocalDraft}</button>
                          </div>
                        )}
                        {saveFeedback.status === "saved" && <div className="matchSaveFeedback matchSaveSuccess" role="status">{saveFeedback.message}</div>}
                        {saveFeedback.status === "error" && <div className="matchSaveFeedback matchSaveError" role="alert">{saveFeedback.message}</div>}
                        {hasOfficialResult && (
                          <div className="matchResultSummary">
                            <span>{copy.simulator.resultFinal}: <strong>{match.resultGoalsA} x {match.resultGoalsB}</strong></span>
                            <span className="matchResultPoints">{match.points === null ? copy.results.noPrediction : formatMessage(copy.simulator.youScored, { points: match.points })}</span>
                          </div>
                        )}
                        {aiState.status === "error" && <div className="matchAiPanel matchAiError">{aiState.message}</div>}
                        {aiState.status === "ready" && (
                          <div className="matchAiPanel">
                            <div className="matchAiHeader">
                              <div className="matchAiMeta">
                                <span className="badge badgeGold">{aiState.analysis.source === "local" ? copy.simulator.aiLocal : copy.simulator.aiOpenRouter}</span>
                                <span>{copy.simulator.aiFavorite}: <strong>{teamLabel(aiState.analysis.favorite, locale)}</strong></span>
                                <span>{copy.simulator.aiRisk}: <strong>{aiState.analysis.risk}</strong></span>
                              </div>
                              <button className="matchAiClose" onClick={() => closeMatchAnalysis(match.id)} type="button" aria-label={copy.simulator.aiCloseAria}>{copy.simulator.aiClose}</button>
                            </div>
                            <p>{aiState.analysis.explanation}</p>
                            <div className="matchAiPicks">
                              <button disabled={inputsDisabled} onClick={() => applyAiPick(match.id, aiState.analysis.conservativeGoalsA, aiState.analysis.conservativeGoalsB)} type="button">
                                {copy.simulator.aiConservative}: {aiState.analysis.conservativeGoalsA} x {aiState.analysis.conservativeGoalsB}
                              </button>
                              <button disabled={inputsDisabled} onClick={() => applyAiPick(match.id, aiState.analysis.boldGoalsA, aiState.analysis.boldGoalsB)} type="button">
                                {copy.simulator.aiBold}: {aiState.analysis.boldGoalsA} x {aiState.analysis.boldGoalsB}
                              </button>
                            </div>
                          </div>
                        )}
                      </form>
                    );
                  })}
                </div>

                {showStandings && (
                  <div className="standingsTable">
                    <table>
                      <thead>
                        <tr><th>{copy.simulator.standingsTeam}</th><th className="numberCell">Pts</th><th className="numberCell">{copy.simulator.played}</th><th className="numberCell">{copy.simulator.goalDifference}</th><th className="numberCell">{copy.simulator.goalsFor}</th></tr>
                      </thead>
                      <tbody>
                        {standings.map((team, index) => (
                          <tr className={index < 2 ? "qualifiedRow" : ""} key={team.team}>
                            <td><span className="teamName" title={teamLabel(team.team, locale)}>{flagFor(team.team)}<span>{teamLabel(team.team, locale)}</span></span></td>
                            <td className="numberCell">{team.points}</td>
                            <td className="numberCell">{team.played}</td>
                            <td className="numberCell">{team.goalDifference}</td>
                            <td className="numberCell">{team.goalsFor}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {enableKnockout && stageView === "knockout" && (
        <section className="knockoutSection card">
          <div className="knockoutIntro">
            <div>
              <span className="badge badgeGold">{copy.simulator.knockout}</span>
              <h2>{showStandings ? copy.simulator.bracketTitle : copy.simulator.knockoutPicksTitle}</h2>
              <p>{showStandings ? copy.simulator.bracketDescription : copy.simulator.knockoutPicksDescription}</p>
            </div>
            <div className="knockoutIntroActions">
              <button className="buttonSecondary" onClick={clearKnockoutWinners} type="button">{copy.simulator.cleanBracket}</button>
              {knockoutClearFeedback.status === "saving" && <span className="muted">{copy.simulator.saving}</span>}
              {knockoutClearFeedback.status === "saved" && <span className="matchSaveSuccess">{knockoutClearFeedback.message}</span>}
              {knockoutClearFeedback.status === "error" && <span className="matchSaveError">{knockoutClearFeedback.message}</span>}
            </div>
          </div>

          {renderKnockoutPhaseTabs()}

          {knockoutVariant === "cards" ? (
            <div className="knockoutCards" aria-label={formatMessage(copy.simulator.matchupsAria, { stage: selectedKnockoutRound.title })}>
              {selectedKnockoutRound.matches.map((match, index) => renderKnockoutCardMatch(match, index))}
            </div>
          ) : (
            <>
              <div className="knockoutFocus">
                <span className="badge">{selectedKnockoutRound.title}</span>
                <strong>{formatMessage(copy.simulator.matchCount, { count: selectedKnockoutRound.matches.length })}</strong>
              </div>

              <div className="knockoutTree" aria-label="Chave do mata-mata da Copa">
                <div className="bracketSide bracketSideLeft">
                  {renderBracketColumn(roundOf32, 0, 8, "left")}
                  {renderBracketColumn(roundOf16, 0, 4, "left")}
                  {renderBracketColumn(quarterFinals, 0, 2, "left")}
                  {renderBracketColumn(semiFinals, 0, 1, "left")}
                </div>

                <div className="bracketCenter">
                  <div className="trophyMark">TaÃ§a</div>
                  {finalRound.matches.map((match) => renderBracketMatch(match))}
                  <div className="championCard">
                    <span>{copy.simulator.champion}</span>
                    {champion ? (
                      <strong>{flagFor(champion)}{teamLabel(champion, locale)}</strong>
                    ) : (
                      <strong>{copy.simulator.toDefine}</strong>
                    )}
                  </div>
                </div>

                <div className="bracketSide bracketSideRight">
                  {renderBracketColumn(semiFinals, 1, 2, "right")}
                  {renderBracketColumn(quarterFinals, 2, 4, "right")}
                  {renderBracketColumn(roundOf16, 4, 8, "right")}
                  {renderBracketColumn(roundOf32, 8, 16, "right")}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
