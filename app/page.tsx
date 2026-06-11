import Link from "next/link";
import { CupHeader } from "../components/CupHeader";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="homeShell">
      <div className="stadiumBackdrop" aria-hidden="true">
      </div>

      <div className="container bolaoPage homeContent">
        <CupHeader
          active="home"
          title="Bolão Copa 2026"
          description="Palpites recreativos entre amigos, com simulador de grupos, ranking e placares rodada por rodada."
        />

        <section className="homeGrid">
          <article className="featureCard">
            <span className="badge badgeGold">Palpites</span>
            <h2>Escolha seus placares</h2>
            <p className="muted">Navegue pelas rodadas da fase de grupos e salve seus palpites antes do fechamento.</p>
            <Link className="buttonLink" href="/bolao">Ir para o bolão</Link>
          </article>
          <article className="featureCard featureCardDark">
            <span className="badge">Simulador</span>
            <h2>Veja a tabela mudar</h2>
            <p>Preencha os resultados e acompanhe a classificação dos grupos em tempo real.</p>
            <Link className="buttonLink buttonLight" href="/simulador">Abrir simulador</Link>
          </article>
        </section>
      </div>
    </main>
  );
}
