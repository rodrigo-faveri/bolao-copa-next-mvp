import { CupHeader } from "../../components/CupHeader";
import { NewsFilters } from "../../components/NewsFilters";
import { getCurrentLocale, t } from "../../lib/i18n";
import { getLatestNews } from "../../lib/news";

export const dynamic = "force-dynamic";

export default async function NoticiasPage() {
  const locale = await getCurrentLocale();
  const copy = t(locale);
  const news = await getLatestNews(30);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="noticias"
        title={copy.news.title}
        description={copy.news.description}
      />

      <section className="pageToolbar">
        <div>
          <span className="badge badgeGold">{copy.news.autoUpdate}</span>
          <h2>{copy.news.latest}</h2>
        </div>
        <div className="toolbarTips">
          <span>{copy.news.filterTip}</span>
          <span>{copy.news.feedTip}</span>
        </div>
      </section>

      {news.length === 0 ? (
        <div className="notice">{copy.news.loadError}</div>
      ) : (
        <NewsFilters locale={locale} news={news} />
      )}
    </main>
  );
}
