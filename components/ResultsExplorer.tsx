"use client";

import { useMemo, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
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

function filterLabel(filter: ResultFilter) {
  const labels: Record<ResultFilter, string> = {
    all: "Todos",
    exact: "Placar exato",
    outcome: "Resultado certo",
    miss: "Erros",
    pending: "Pendentes",
    noPrediction: "Sem palpite",
  };
  return labels[filter];
}

export function ResultsExplorer({ items, locale = "pt-BR", summary }: { items: ResultItem[]; locale?: AppLocale; summary: ResultsSummary }) {
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
      "Meu desempenho no Bolao Copa 2026:",
      `${summary.totalPoints} pts | ${summary.exactHits} placares exatos | ${summary.outcomeHits} resultados certos`,
      `${summary.predictionsCount} palpites em ${summary.resolvedMatches} jogos finalizados`,
    ].join("\n");

    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  return (
    <>
      <section className="resultsSummary">
        <article>
          <span className="badge badgeGold">Total</span>
          <strong>{summary.totalPoints} pts</strong>
          <p className="muted">Somados nas partidas encerradas.</p>
        </article>
        <article>
          <span className="badge badgeGold">Placares exatos</span>
          <strong>{summary.exactHits}</strong>
          <p className="muted">Valem 5 pontos cada.</p>
        </article>
        <article>
          <span className="badge badgeGold">Resultados certos</span>
          <strong>{summary.outcomeHits}</strong>
          <p className="muted">Vencedor ou empate corretos.</p>
        </article>
        <article>
          <span className="badge badgeGold">Palpites</span>
          <strong>{summary.predictionsCount}</strong>
          <p className="muted">Em jogos ja acompanhados.</p>
        </article>
      </section>

      <section className="resultsFilters card" aria-label="Filtros de resultados">
        <label>
          <span>Grupo</span>
          <select onChange={(event) => setGroup(event.target.value)} value={group}>
            <option value="all">Todos</option>
            {groups.map((item) => <option key={item} value={item}>Grupo {item}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select onChange={(event) => setFilter(event.target.value as ResultFilter)} value={filter}>
            {(["all", "exact", "outcome", "miss", "pending", "noPrediction"] as ResultFilter[]).map((item) => (
              <option key={item} value={item}>{filterLabel(item)}</option>
            ))}
          </select>
        </label>
        <button className="buttonSecondary" onClick={() => { setGroup("all"); setFilter("all"); }} type="button">
          Limpar filtros
        </button>
        <button onClick={copySummary} type="button">
          {copied ? "Resumo copiado!" : "Copiar resumo"}
        </button>
      </section>

      {filteredItems.length === 0 ? (
        <section className="card">
          <h2>Nenhum resultado encontrado</h2>
          <p className="muted">Tente limpar os filtros para ver outros jogos.</p>
        </section>
      ) : (
        <section className="resultsList">
          {filteredItems.map((item) => (
            <article className={`resultCard ${item.hasOfficialResult ? "" : "resultCardPending"}`} key={item.id}>
              <div className="resultCardHeader">
                <div>
                  <span className="badge">Grupo {item.group}</span>
                  <h2 title={`${teamLabel(item.teamA, locale)} x ${teamLabel(item.teamB, locale)}`}>{teamLabel(item.teamA, locale)} x {teamLabel(item.teamB, locale)}</h2>
                  <p className="muted">{item.startsAtLabel} - {item.venue}</p>
                </div>
                <div className="resultStatusStack">
                  <span className={item.hasOfficialResult ? "badge" : "badge badgeLive"}>{item.phase}</span>
                  <strong className="resultPoints">{item.hasOfficialResult ? `${item.points ?? 0} pts` : "Pendente"}</strong>
                </div>
              </div>

              <div className="resultComparison">
                <div>
                  <span>Resultado oficial</span>
                  <strong>{item.hasOfficialResult ? <>{flagFor(item.teamA)} {item.resultA} x {item.resultB} {flagFor(item.teamB)}</> : "Aguardando placar"}</strong>
                </div>
                <div>
                  <span>Seu palpite</span>
                  <strong>{item.predictionA !== null && item.predictionB !== null ? `${item.predictionA} x ${item.predictionB}` : "Sem palpite"}</strong>
                </div>
                <details className="resultInfo">
                  <summary aria-label="Explicar pontuacao">i</summary>
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
