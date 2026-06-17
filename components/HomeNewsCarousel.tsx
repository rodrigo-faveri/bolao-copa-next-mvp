"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AppLocale } from "../lib/i18n-shared";
import { t } from "../lib/i18n-shared";
import type { NewsItem } from "../lib/news";

function formatNewsDate(value: string | null, locale: AppLocale) {
  if (!value) return "";

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

export function HomeNewsCarousel({ locale = "pt-BR", news }: { locale?: AppLocale; news: NewsItem[] }) {
  const copy = t(locale);
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleNews = useMemo(() => news.slice(0, 5), [news]);

  useEffect(() => {
    if (visibleNews.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % visibleNews.length);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [visibleNews.length]);

  if (visibleNews.length === 0) {
    return (
      <section className="homePanel">
        <div className="homePanelHeader">
          <div>
            <span className="badge badgeGold">{copy.home.newsBadge}</span>
            <h2>{copy.home.newsTitle}</h2>
          </div>
          <Link className="buttonLink buttonSecondary" href="/noticias">{copy.home.newsCta}</Link>
        </div>
        <p className="muted">{copy.news.loadError}</p>
      </section>
    );
  }

  const active = visibleNews[activeIndex] ?? visibleNews[0];

  return (
    <section className="homePanel homeNewsPanel">
      <div className="homePanelHeader">
        <div>
          <span className="badge badgeGold">{copy.home.newsBadge}</span>
          <h2>{copy.home.newsTitle}</h2>
        </div>
        <Link className="buttonLink buttonSecondary" href="/noticias">{copy.home.newsCta}</Link>
      </div>

      <article className="homeNewsFeature">
        <div className="newsMeta">
          <span>{active.source}</span>
          <span>{formatNewsDate(active.publishedAt, locale)}</span>
        </div>
        <h3>{active.title}</h3>
        <p>{active.description}</p>
        <a className="buttonLink" href={active.link} rel="noreferrer" target="_blank">{copy.news.read}</a>
      </article>

      <div className="homeNewsDots" aria-label={copy.home.newsDotsAria}>
        {visibleNews.map((item, index) => (
          <button
            aria-label={`${copy.home.newsDotAria} ${index + 1}`}
            aria-pressed={index === activeIndex}
            key={`${item.source}-${item.link}`}
            onClick={() => setActiveIndex(index)}
            type="button"
          />
        ))}
      </div>
    </section>
  );
}
