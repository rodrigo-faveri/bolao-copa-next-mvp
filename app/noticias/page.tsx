import { CupHeader } from "../../components/CupHeader";
import { NewsFilters } from "../../components/NewsFilters";
import { getLatestNews } from "../../lib/news";

export const dynamic = "force-dynamic";

export default async function NoticiasPage() {
  const news = await getLatestNews(30);

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="noticias"
        title="Notícias da Copa"
        description="Acompanhe manchetes recentes sobre a Copa do Mundo 2026 em fontes como ge, ESPN e FIFA."
      />

      <section className="pageToolbar">
        <div>
          <span className="badge badgeGold">Atualização automática</span>
          <h2>Últimas notícias</h2>
        </div>
        <div className="toolbarTips">
          <span>Filtre por fonte, data e palavra-chave</span>
          <span>Feeds atualizados a cada 15 min</span>
        </div>
      </section>

      {news.length === 0 ? (
        <div className="notice">Não foi possível carregar notícias agora. Tente novamente em alguns minutos.</div>
      ) : (
        <NewsFilters news={news} />
      )}
    </main>
  );
}
