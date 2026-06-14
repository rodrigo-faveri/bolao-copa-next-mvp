"use client";

import { useMemo, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { t } from "../lib/i18n-shared";
import { getTeamDisplayName, getTeamFlagUrl } from "../lib/teams";

export type ResultFilter = "all" | "exact" | "outcome" | "miss" | "pending" | "noPrediction";

export type ResultItem = {
  id: string;
  group: string;
  teamA: string;
  teamB: string;
  startsAtLabel: string;
  venue: string;
  phase: string;
  hasOfficialResult: boolean;
  resultA: number | null;
  resultB: number | null;
  predictionA: number | null;
  predictionB: number | null;
  points: number | null;
  filter: ResultFilter;
  explanationLabel: string;
  explanationText: string;
  summary: string;
};

export type ResultsSummary = {
  totalPoints: number;
  exactHits: number;
  outcomeHits: number;
  resolvedMatches: number;
  waitingMatches: number;
  predictionsCount: number;
  averagePoints: string;
  exactScorers: string[];
  outcomeScorers: string[];
  hardestMatch: string;
  hardestMatchHitRate: string;
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

function filterLabel(filter: ResultFilter, locale: AppLocale) {
  const copy = t(locale);
  const labels: Record<ResultFilter, string> = {
    all: copy.results.all,
    exact: copy.results.exact,
    outcome: copy.results.outcome,
    miss: copy.results.miss,
    pending: copy.results.pending,
    noPrediction: copy.results.noPrediction,
  };
  return labels[filter];
}

export function ResultsExplorer({ items, locale = "pt-BR", summary }: { items: ResultItem[]; locale?: AppLocale; summary: ResultsSummary }) {
  const copy = t(locale);
  const [group, setGroup] = useState("all");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [copied, setCopied] = useState(false);
  const groups = useMemo(() => Array.from(new Set(items.map((item) => item.group))).sort(), [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const groupMatches = group === "all" || item.group === group;
      const filterMatches = filter === "all" || item.filter === filter;
      return groupMatches && filterMatches;
    });
  }, [filter, group, items]);

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

      <section className="resultsFilters card" aria-label={copy.results.filtersAria}>
        <label>
          <span>{copy.results.group}</span>
          <select onChange={(event) => setGroup(event.target.value)} value={group}>
            <option value="all">{copy.results.all}</option>
            {groups.map((item) => <option key={item} value={item}>{copy.results.group} {item}</option>)}
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
        <section className="resultsList">
          {filteredItems.map((item) => (
            <article className={`resultCard ${item.hasOfficialResult ? "" : "resultCardPending"}`} key={item.id}>
              <div className="resultCardHeader">
                <div>
                  <span className="badge">{copy.results.group} {item.group}</span>
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
            </article>
          ))}
        </section>
      )}
    </>
  );
}
