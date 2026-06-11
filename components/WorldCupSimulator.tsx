"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MAX_GOALS } from "../lib/prediction";
import { getTeamFlagUrl } from "../lib/teams";

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
  ["1E", "3º"],
  ["1I", "3º"],
  ["2A", "2B"],
  ["1F", "2C"],
  ["2K", "2L"],
  ["1H", "2J"],
  ["1D", "3º"],
  ["1G", "3º"],
  ["1C", "2F"],
  ["2E", "2I"],
  ["1A", "3º"],
  ["1L", "3º"],
  ["1J", "2H"],
  ["2D", "2G"],
  ["1B", "3º"],
  ["1K", "3º"],
] as const;

function flagFor(team: string) {
  const flagUrl = getTeamFlagUrl(team);
  if (!flagUrl) return <span className="teamFlagPlaceholder" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${team}`} loading="lazy" />;
}

function formatWeekday(date: Date) {
  return weekdayFormatter.format(date).replace(".", "").toUpperCase();
}

function formatVenue(venue: string) {
  return venue.length > 16 ? `${venue.slice(0, 14)}...` : venue;
}

function formatCountdown(startsAt: Date | null, now: Date) {
  if (!startsAt) return "Horário a definir";

  const remainingSeconds = Math.max(0, Math.floor((startsAt.getTime() - now.getTime()) / 1000));
  if (remainingSeconds <= 0) return "Partida iniciada";

  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);
  const seconds = remainingSeconds % 60;

  if (days > 0) return `Começa em ${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `Começa em ${hours}h ${minutes}m ${seconds}s`;
  return `Começa em ${minutes}m ${seconds}s`;
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

    const score = scores[match.id];
    if (!score || score.goalsA === "" || score.goalsB === "") continue;

    const goalsA = Number(score.goalsA);
    const goalsB = Number(score.goalsB);
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
    if (label === "3º") {
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

function roundLabel(roundIndex: number) {
  return `${roundIndex + 1}ª RODADA`;
}

function shortTeamName(team: string) {
  return team
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

export function WorldCupSimulator({
  canSave,
  enableKnockout = false,
  knockoutVariant = "bracket",
  matches,
  saveAction,
  showStandings = true,
}: {
  canSave: boolean;
  enableKnockout?: boolean;
  knockoutVariant?: KnockoutVariant;
  matches: SimulatorMatch[];
  saveAction?: (formData: FormData) => void | Promise<void>;
  showStandings?: boolean;
}) {
  const [scores, setScores] = useState(() => makeInitialScores(matches));
  const [roundByGroup, setRoundByGroup] = useState<Record<string, number>>({});
  const [knockoutWinners, setKnockoutWinners] = useState<Record<string, string>>({});
  const [knockoutRoundIndex, setKnockoutRoundIndex] = useState(0);
  const [stageView, setStageView] = useState<StageView>("groups");
  const [now, setNow] = useState(() => new Date());
  const [isHydrated, setIsHydrated] = useState(false);
  const [aiAnalysisByMatch, setAiAnalysisByMatch] = useState<Record<string, MatchAiState>>({});
  useEffect(() => {
    setIsHydrated(true);
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);
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

  function chooseWinner(match: BracketMatch, team?: string) {
    if (!team) return;
    if (![match.home.team, match.away.team].includes(team)) return;
    setKnockoutWinners((current) => ({ ...current, [match.id]: team }));
  }

  function applyAiPick(matchId: string, goalsA: number, goalsB: number) {
    setScores((current) => ({
      ...current,
      [matchId]: { goalsA: String(goalsA), goalsB: String(goalsB) },
    }));
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

    return (
      <div className="knockoutCard" key={match.id}>
        <div className="knockoutCardHeader">
          <span className="badge">Jogo {index + 1}</span>
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
              <span>{slot.team ?? "A definir"}</span>
            </button>
          ))}
        </div>
        <p className="muted">{selectedWinner ? `Palpite: ${selectedWinner} avança` : "Escolha quem avança para liberar a próxima fase."}</p>
      </div>
    );
  }

  const [roundOf32, roundOf16, quarterFinals, semiFinals, finalRound] = bracketRounds;

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
            Fase de grupos
          </button>
          <button
            aria-selected={stageView === "knockout"}
            className={`stageTab ${stageView === "knockout" ? "stageTabActive" : ""}`}
            onClick={() => setStageView("knockout")}
            role="tab"
            type="button"
          >
            Mata-mata
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
                  <h2>Grupo {group}</h2>
                  {showStandings && <span className="badge">Top 2 avançam</span>}
                </div>

                <div className="roundPager">
                  <button aria-label={`Ver rodada anterior do grupo ${group}`} className="roundArrow" disabled={currentRound === 0} onClick={() => setRoundByGroup((current) => ({ ...current, [group]: currentRound - 1 }))} type="button">‹</button>
                  <strong>{roundLabel(currentRound)}</strong>
                  <button aria-label={`Ver próxima rodada do grupo ${group}`} className="roundArrow" disabled={currentRound === rounds.length - 1} onClick={() => setRoundByGroup((current) => ({ ...current, [group]: currentRound + 1 }))} type="button">›</button>
                </div>

                <div className="simulatorMatches">
                  {roundMatches.map((match) => {
                    const score = scores[match.id] ?? { goalsA: "", goalsB: "" };
                    const startsAt = match.startsAt ? new Date(match.startsAt) : null;
                    const hasOfficialResult = match.resultGoalsA !== null && match.resultGoalsB !== null;
                    const inputsDisabled = !match.isOpen || hasOfficialResult;
                    const canSubmit = canSave && match.isOpen && !hasOfficialResult && score.goalsA !== "" && score.goalsB !== "" && Boolean(saveAction);
                    const aiState = aiAnalysisByMatch[match.id] ?? { status: "idle" };
                    const matchIsLive = !hasOfficialResult && isMatchLive(match.status, startsAt, now, isHydrated);

                    return (
                      <form action={saveAction} className="simulatorMatch" key={match.id}>
                        <div className="matchMeta">
                          <span>{startsAt ? formatWeekday(startsAt) : "--"}</span>
                          <strong>{startsAt ? dateFormatter.format(startsAt) : "Sem data"}</strong>
                          <span title={match.venue}>{formatVenue(match.venue)}</span>
                          <strong>{startsAt ? timeFormatter.format(startsAt) : "--:--"}</strong>
                          {isHydrated && (
                            <span className={`matchCountdown ${startsAt && startsAt.getTime() <= now.getTime() ? "matchCountdownClosed" : ""}`}>
                              {formatCountdown(startsAt, now)}
                            </span>
                          )}
                        </div>
                        {matchIsLive && (
                          <Link className="matchLiveBadge" href={`/tempo-real/${match.id}`}>
                            <span className="livePulse" aria-hidden="true" />
                            Ao vivo - acompanhar lances
                          </Link>
                        )}
                        <input type="hidden" name="matchId" value={match.id} />
                        <span className="teamName teamLeft">{flagFor(match.teamA)}<span>{match.teamA}</span></span>
                        <input aria-label={`Gols de ${match.teamA}`} disabled={inputsDisabled} max={MAX_GOALS} min="0" name="goalsA" onChange={(event) => setScores((current) => ({ ...current, [match.id]: { ...(current[match.id] ?? score), goalsA: event.target.value } }))} required type="number" value={score.goalsA} />
                        <span className="versus">x</span>
                        <input aria-label={`Gols de ${match.teamB}`} disabled={inputsDisabled} max={MAX_GOALS} min="0" name="goalsB" onChange={(event) => setScores((current) => ({ ...current, [match.id]: { ...(current[match.id] ?? score), goalsB: event.target.value } }))} required type="number" value={score.goalsB} />
                        <span className="teamName teamRight">{flagFor(match.teamB)}<span>{match.teamB}</span></span>
                        <div className="matchActions">
                          {hasOfficialResult ? <span className="saveHint">Encerrado</span> : canSave ? <button disabled={!canSubmit} type="submit">Salvar</button> : <span className="saveHint">Entre para salvar</span>}
                          <button className="aiHelpButton" disabled={hasOfficialResult || aiState.status === "loading"} onClick={() => requestMatchAnalysis(match.id)} type="button">
                            {aiState.status === "loading" ? "..." : "IA"}
                          </button>
                        </div>
                        {hasOfficialResult && (
                          <div className="matchResultSummary">
                            <span>Resultado final: <strong>{match.resultGoalsA} x {match.resultGoalsB}</strong></span>
                            <span className="matchResultPoints">{match.points === null ? "Sem palpite salvo" : `Voce fez ${match.points} pts`}</span>
                          </div>
                        )}
                        {aiState.status === "error" && <div className="matchAiPanel matchAiError">{aiState.message}</div>}
                        {aiState.status === "ready" && (
                          <div className="matchAiPanel">
                            <div className="matchAiHeader">
                              <div className="matchAiMeta">
                                <span className="badge badgeGold">{aiState.analysis.source === "local" ? "Assistente local" : "OpenRouter IA"}</span>
                                <span>Favorito: <strong>{aiState.analysis.favorite}</strong></span>
                                <span>Risco: <strong>{aiState.analysis.risk}</strong></span>
                              </div>
                              <button className="matchAiClose" onClick={() => closeMatchAnalysis(match.id)} type="button" aria-label="Fechar sugestao da IA">Fechar</button>
                            </div>
                            <p>{aiState.analysis.explanation}</p>
                            <div className="matchAiPicks">
                              <button disabled={inputsDisabled} onClick={() => applyAiPick(match.id, aiState.analysis.conservativeGoalsA, aiState.analysis.conservativeGoalsB)} type="button">
                                Conservador: {aiState.analysis.conservativeGoalsA} x {aiState.analysis.conservativeGoalsB}
                              </button>
                              <button disabled={inputsDisabled} onClick={() => applyAiPick(match.id, aiState.analysis.boldGoalsA, aiState.analysis.boldGoalsB)} type="button">
                                Ousado: {aiState.analysis.boldGoalsA} x {aiState.analysis.boldGoalsB}
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
                        <tr><th>Seleção</th><th className="numberCell">Pts</th><th className="numberCell">J</th><th className="numberCell">SG</th><th className="numberCell">GP</th></tr>
                      </thead>
                      <tbody>
                        {standings.map((team, index) => (
                          <tr className={index < 2 ? "qualifiedRow" : ""} key={team.team}>
                            <td><span className="teamName">{flagFor(team.team)}<span>{team.team}</span></span></td>
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
              <span className="badge badgeGold">Mata-mata</span>
              <h2>{showStandings ? "Chave eliminatória" : "Palpites do mata-mata"}</h2>
              <p>{showStandings ? "Complete os grupos para liberar os classificados e clique nos vencedores para avançar até a final." : "Escolha uma fase, marque quem avança e percorra o mata-mata no mesmo estilo dos palpites."}</p>
            </div>
            <button className="buttonSecondary" onClick={() => setKnockoutWinners({})} type="button">Limpar chave</button>
          </div>

          {renderKnockoutPhaseTabs()}

          {knockoutVariant === "cards" ? (
            <div className="knockoutCards" aria-label={`Confrontos de ${selectedKnockoutRound.title}`}>
              {selectedKnockoutRound.matches.map((match, index) => renderKnockoutCardMatch(match, index))}
            </div>
          ) : (
            <>
              <div className="knockoutFocus">
                <span className="badge">{selectedKnockoutRound.title}</span>
                <strong>{selectedKnockoutRound.matches.length} confrontos nesta fase</strong>
              </div>

              <div className="knockoutTree" aria-label="Chave do mata-mata da Copa">
                <div className="bracketSide bracketSideLeft">
                  {renderBracketColumn(roundOf32, 0, 8, "left")}
                  {renderBracketColumn(roundOf16, 0, 4, "left")}
                  {renderBracketColumn(quarterFinals, 0, 2, "left")}
                  {renderBracketColumn(semiFinals, 0, 1, "left")}
                </div>

                <div className="bracketCenter">
                  <div className="trophyMark">Taça</div>
                  {finalRound.matches.map((match) => renderBracketMatch(match))}
                  <div className="championCard">
                    <span>Campeão</span>
                    {champion ? (
                      <strong>{flagFor(champion)}{champion}</strong>
                    ) : (
                      <strong>A definir</strong>
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
