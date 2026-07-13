"use client";

import { useMemo, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { t } from "../lib/i18n-shared";
import { getTeamDisplayName, getTeamFlagUrl } from "../lib/teams";

export type ResultFilter = "all" | "exact" | "outcome" | "miss" | "pending" | "noPrediction";

export type ResultItem = {
  competitionPhase: "groups" | "knockout";
  decisionLabel?: string | null;
  explanationLabel: string;
  explanationText: string;
  filter: ResultFilter;
  group: string;
  groupFilterKey?: string;
  groupLabel?: string;
  hasOfficialResult: boolean;
  id: string;
  liveUrl?: string | null;
  phase: string;
  points: number | null;
  predictionA: number | null;
  predictionB: number | null;
  resultA: number | null;
  resultB: number | null;
  stageLabel: string;
  startsAtLabel: string;
  statsUrl?: string | null;
  summary: string;
  teamA: string;
  teamB: string;
  venue: string;
};

export type ResultsSummary = {
  averagePoints: string;
  exactHits: number;
  exactScorers: string[];
  hardestMatch: string;
  hardestMatchHitRate: string;
  knockoutExactHits: number;
  knockoutOutcomeHits: number;
  knockoutPoints: number;
  knockoutResolvedMatches: number;
  outcomeHits: number;
  outcomeScorers: string[];
  predictionsCount: number;
  resolvedMatches: number;
  totalPoints: number;
  waitingMatches: number;
};

function flagFor(team: string) {
  const flagUrl = getTeamFlagUrl(team);
  if (!flagUrl) return <span className="teamFlagPlaceholder" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="teamFlag" src={flagUrl} alt={`Bandeira de ${getTeamDisplayName(team)}`} loading="lazy" />;
}

function teamLabel(team: string, locale: AppLocale = "pt-BR") {
  return getTeamDisplayName(team, locale);
}

function isKnockoutGroup(group: string) {
  return /^(R32|R16|QF|SF|FINAL)-\d+$/i.test(group);
}

function getGroupFilterKey(item: ResultItem) {
  return item.groupFilterKey ?? (isKnockoutGroup(item.group) ? "knockout" : item.group);
}

function getGroupLabel(item: ResultItem, locale: AppLocale) {
  const copy = t(locale);
  return item.groupLabel ?? (isKnockoutGroup(item.group) ? copy.simulator.knockout : `${copy.results.group} ${item.group}`);
}

function filterLabel(filter: ResultFilter, locale: AppLocale) {
  const copy = t(locale);
  const labels: Record<ResultFilter, string> = {
    all: copy.results.all,
    exact: copy.results.exact,
    miss: copy.results.miss,
    noPrediction: copy.results.noPrediction,
    outcome: copy.results.outcome,
    pending: copy.results.pending,
  };
  return labels[filter];
}

function phaseTitle(phase: ResultItem["competitionPhase"], locale: AppLocale) {
  const copy = t(locale);
  return phase === "knockout" ? copy.simulator.knockout : copy.simulator.groupStage;
}

export function ResultsExplorer({ items, locale = "pt-BR", summary }: { items: ResultItem[]; locale?: AppLocale; summary: ResultsSummary }) {
  const copy = t(locale);
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [copied, setCopied] = useState(false);
  const groups = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const item of items) {
      const key = getGroupFilterKey(item);
      byKey.set(key, getGroupLabel(item, locale));
    }

    return Array.from(byKey.entries()).sort(([keyA], [keyB]) => {
      if (keyA === "knockout") return 1;
      if (keyB === "knockout") return -1;
      return keyA.localeCompare(keyB);
    });
  }, [items, locale]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const groupMatches = group === "all" || getGroupFilterKey(item) === group;
      const filterMatches = filter === "all" || item.filter === filter;
      return groupMatches && filterMatches;
    });
  }, [filter, group, items]);

  const filteredSections = useMemo(() => {
    const groupItems = filteredItems.filter((item) => item.competitionPhase === "groups");
    const knockoutItems = filteredItems.filter((item) => item.competitionPhase === "knockout");
    return [
      groupItems.length > 0 ? { items: groupItems, phase: "groups" as const } : null,
      knockoutItems.length > 0 ? { items: knockoutItems, phase: "knockout" as const } : null,
    ].filter((section): section is { items: ResultItem[]; phase: ResultItem["competitionPhase"] } => Boolean(section));
  }, [filteredItems]);

  async function copySummary() {
    const text = [
      `${copy.results.title}:`,
      `${summary.totalPoints} pts | ${summary.exactHits} ${copy.results.exactHits} | ${summary.outcomeHits} ${copy.results.outcomeHits}`,
      `${summary.predictionsCount} ${copy.results.predictions} | ${summary.resolvedMatches} ${copy.common.finished}`,
    ].join("\n");

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      <section className="resultsSummary">
        <article>
          <span className="badge badgeGold">{copy.results.total}</span>
          <strong>{summary.totalPoints} pts</strong>
          <p className="muted">{copy.results.addedInFinished}</p>
        </article>
        <article>
          <span className="badge badgeGold">{copy.results.exactHits}</span>
          <strong>{summary.exactHits}</strong>
          <p className="muted">{copy.results.exactWorth}</p>
        </article>
        <article>
          <span className="badge badgeGold">{copy.results.outcomeHits}</span>
          <strong>{summary.outcomeHits}</strong>
          <p className="muted">{copy.results.outcomeDescription}</p>
        </article>
        <article>
          <span className="badge badgeGold">{copy.results.predictions}</span>
          <strong>{summary.predictionsCount}</strong>
          <p className="muted">{copy.results.trackedPredictions}</p>
        </article>
      </section>

      <section className="resultsInsights card">
        <div>
          <span className="badge badgeGold">{copy.results.postGameSummary}</span>
          <h2>{copy.results.postGameTitle}</h2>
          <p className="muted">{copy.results.postGameDescription}</p>
        </div>
        <div className="resultsInsightsGrid">
          <article>
            <span>{copy.results.averagePoints}</span>
            <strong>{summary.averagePoints}</strong>
          </article>
          <article>
            <span>{copy.results.exactScorers}</span>
            <strong>{summary.exactScorers.length > 0 ? summary.exactScorers.join(", ") : copy.results.noScorersYet}</strong>
          </article>
          <article>
            <span>{copy.results.outcomeScorers}</span>
            <strong>{summary.outcomeScorers.length > 0 ? summary.outcomeScorers.join(", ") : copy.results.noScorersYet}</strong>
          </article>
          <article>
            <span>{copy.results.hardestMatch}</span>
            <strong>{summary.hardestMatch}</strong>
            <small>{summary.hardestMatchHitRate}</small>
          </article>
        </div>
      </section>

      <section className="resultsKnockoutSummary card">
        <div>
          <span className="badge badgeGold">{copy.simulator.knockout}</span>
          <h2>{copy.results.knockoutSummaryTitle}</h2>
          <p className="muted">{copy.results.knockoutSummaryDescription}</p>
        </div>
        <div className="resultsInsightsGrid">
          <article>
            <span>{copy.results.points}</span>
            <strong>{summary.knockoutPoints}</strong>
          </article>
          <article>
            <span>{copy.results.exactHits}</span>
            <strong>{summary.knockoutExactHits}</strong>
          </article>
          <article>
            <span>{copy.results.outcomeHits}</span>
            <strong>{summary.knockoutOutcomeHits}</strong>
          </article>
          <article>
            <span>{copy.common.finished}</span>
            <strong>{summary.knockoutResolvedMatches}</strong>
          </article>
        </div>
      </section>

      <section className="resultsFilters card" aria-label={copy.results.filtersAria}>
        <label>
          <span>{copy.results.group}</span>
          <select onChange={(event) => setGroup(event.target.value)} value={group}>
            <option value="all">{copy.results.all}</option>
            {groups.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          <span>{copy.results.status}</span>
          <select onChange={(event) => setFilter(event.target.value as ResultFilter)} value={filter}>
            {(["all", "exact", "outcome", "miss", "pending", "noPrediction"] as ResultFilter[]).map((item) => (
              <option key={item} value={item}>{filterLabel(item, locale)}</option>
            ))}
          </select>
        </label>
        <button className="buttonSecondary" onClick={() => { setGroup("all"); setFilter("all"); }} type="button">
          {copy.results.clearFilters}
        </button>
        <button onClick={copySummary} type="button">
          {copied ? copy.results.copiedSummary : copy.results.copySummary}
        </button>
      </section>

      {filteredItems.length === 0 ? (
        <section className="card">
          <h2>{copy.results.noResultsTitle}</h2>
          <p className="muted">{copy.results.noResultsText}</p>
        </section>
      ) : (
        <div className="resultsPhaseSections">
          {filteredSections.map((section) => (
            <section className="resultsPhaseSection" key={section.phase}>
              <div className="resultsPhaseHeader">
                <span className="badge badgeGold">{phaseTitle(section.phase, locale)}</span>
                <strong>{section.items.length} {section.items.length === 1 ? copy.results.match : copy.results.matches}</strong>
              </div>
              <div className="resultsList">
                {section.items.map((item) => (
                  <article className={`resultCard ${item.hasOfficialResult ? "" : "resultCardPending"}`} key={item.id}>
                    <div className="resultCardHeader">
                      <div>
                        <span className="badge">{isKnockoutGroup(item.group) ? `${item.stageLabel} - ${item.group}` : `${copy.results.group} ${item.group}`}</span>
                        <h2 title={`${teamLabel(item.teamA, locale)} x ${teamLabel(item.teamB, locale)}`}>{teamLabel(item.teamA, locale)} x {teamLabel(item.teamB, locale)}</h2>
                        <p className="muted">{item.startsAtLabel} - {item.venue}</p>
                      </div>
                      <div className="resultStatusStack">
                        <span className={item.hasOfficialResult ? "badge" : "badge badgeLive"}>{item.phase}</span>
                        <strong className="resultPoints">{item.hasOfficialResult ? `${item.points ?? 0} pts` : copy.common.pending}</strong>
                      </div>
                    </div>

                    <div className="resultComparison">
                      <div>
                        <span>{copy.results.officialResult}</span>
                        <strong>{item.hasOfficialResult ? <>{flagFor(item.teamA)} {item.resultA} x {item.resultB} {flagFor(item.teamB)}</> : copy.results.waitingScore}</strong>
                        {item.decisionLabel && <small>{item.decisionLabel}</small>}
                      </div>
                      <div>
                        <span>{copy.results.yourPrediction}</span>
                        <strong>{item.predictionA !== null && item.predictionB !== null ? `${item.predictionA} x ${item.predictionB}` : copy.results.noPrediction}</strong>
                      </div>
                      <details className="resultInfo">
                        <summary aria-label={copy.results.explainAria}>i</summary>
                        <div>
                          <strong>{item.explanationLabel}</strong>
                          <p>{item.explanationText}</p>
                        </div>
                      </details>
                    </div>
                    <p className="resultAutoSummary">{item.summary}</p>
                    {item.statsUrl && (
                      <div className="resultExternalLinks">
                        <a className="buttonLink buttonSecondary" href={item.statsUrl} rel="noreferrer" target="_blank">
                          {item.liveUrl ? copy.results.externalStats : copy.results.sofaScoreSearch}
                        </a>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
