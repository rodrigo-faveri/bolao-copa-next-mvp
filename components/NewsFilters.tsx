"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { formatMessage, t } from "../lib/i18n-shared";
import type { NewsItem } from "../lib/news";

type DateFilter = "all" | "today" | "7d" | "30d";
type ViewMode = "cards" | "list";

function formatNewsDate(value: string | null, locale: AppLocale, unavailableLabel: string) {
  if (!value) return unavailableLabel;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function matchesDateFilter(value: string | null, filter: DateFilter) {
  if (filter === "all") return true;
  if (!value) return false;

  const publishedAt = new Date(value).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  if (filter === "today") return now - publishedAt <= dayMs;
  if (filter === "7d") return now - publishedAt <= 7 * dayMs;
  return now - publishedAt <= 30 * dayMs;
}

export function NewsFilters({ locale = "pt-BR", news }: { locale?: AppLocale; news: NewsItem[] }) {
  const copy = t(locale);
  const [source, setSource] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const sources = useMemo(() => Array.from(new Set(news.map((item) => item.source))).sort(), [news]);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    const storedViewMode = window.localStorage.getItem("newsViewMode");
    if (storedViewMode === "cards" || storedViewMode === "list") {
      setViewMode(storedViewMode);
    }
  }, []);

  function changeViewMode(nextViewMode: ViewMode) {
    setViewMode(nextViewMode);
    window.localStorage.setItem("newsViewMode", nextViewMode);
  }

  const filteredNews = useMemo(() => {
    return news.filter((item) => {
      const sourceMatches = source === "all" || item.source === source;
      const dateMatches = matchesDateFilter(item.publishedAt, dateFilter);
      const queryMatches = normalizedQuery.length === 0
        || item.title.toLowerCase().includes(normalizedQuery)
        || item.description.toLowerCase().includes(normalizedQuery);

      return sourceMatches && dateMatches && queryMatches;
    });
  }, [dateFilter, news, normalizedQuery, source]);

  return (
    <>
      <section className="newsFilters card" aria-label={copy.news.filtersAria}>
        <label>
          <span>{copy.news.source}</span>
          <select onChange={(event) => setSource(event.target.value)} value={source}>
            <option value="all">{copy.news.allSources}</option>
            {sources.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <label>
          <span>{copy.news.date}</span>
          <select onChange={(event) => setDateFilter(event.target.value as DateFilter)} value={dateFilter}>
            <option value="all">{copy.news.anyDate}</option>
            <option value="today">{copy.news.last24h}</option>
            <option value="7d">{copy.news.last7d}</option>
            <option value="30d">{copy.news.last30d}</option>
          </select>
        </label>

        <label className="newsSearch">
          <span>{copy.news.search}</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.news.searchPlaceholder}
            type="search"
            value={query}
          />
        </label>

        <button className="buttonSecondary" onClick={() => { setSource("all"); setDateFilter("all"); setQuery(""); }} type="button">
          {copy.news.clearFilters}
        </button>
      </section>

      <div className="newsResultBar">
        <div className="newsResultCount">
          {formatMessage(copy.news.found, { count: filteredNews.length })}
        </div>

        <div className="newsViewToggle" aria-label={copy.news.viewAria}>
          <button aria-pressed={viewMode === "cards"} onClick={() => changeViewMode("cards")} type="button">
            {copy.news.cards}
          </button>
          <button aria-pressed={viewMode === "list"} onClick={() => changeViewMode("list")} type="button">
            {copy.news.list}
          </button>
        </div>
      </div>

      {filteredNews.length === 0 ? (
        <div className="notice">{copy.news.empty}</div>
      ) : (
        <section className={viewMode === "cards" ? "newsGrid" : "newsList"}>
          {filteredNews.map((item) => (
            <article className={viewMode === "cards" ? "newsCard" : "newsCard newsCardList"} key={`${item.source}-${item.link}`}>
              <div className="newsMeta">
                <span className="badge">{item.source}</span>
                <span>{formatNewsDate(item.publishedAt, locale, copy.news.unavailableDate)}</span>
              </div>
              <h2>{item.title}</h2>
              {item.description && <p>{item.description}</p>}
              <a className="buttonLink" href={item.link} rel="noreferrer" target="_blank">
                {copy.news.read}
              </a>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
