import Link from "next/link";
import { CupHeader } from "../components/CupHeader";
import { getCurrentLocale, t } from "../lib/i18n";

export const dynamic = "force-dynamic";

export default async function Home() {
  const copy = t(await getCurrentLocale());

  return (
    <main className="homeShell">
      <div className="stadiumBackdrop" aria-hidden="true" />

      <div className="container bolaoPage homeContent">
        <CupHeader
          active="home"
          title={copy.home.title}
          description={copy.home.description}
        />

        <section className="homeGrid">
          <article className="featureCard">
            <span className="badge badgeGold">{copy.home.picksBadge}</span>
            <h2>{copy.home.picksTitle}</h2>
            <p className="muted">{copy.home.picksDescription}</p>
            <Link className="buttonLink" href="/bolao">{copy.home.picksCta}</Link>
          </article>
          <article className="featureCard featureCardDark">
            <span className="badge">{copy.home.simulatorBadge}</span>
            <h2>{copy.home.simulatorTitle}</h2>
            <p>{copy.home.simulatorDescription}</p>
            <Link className="buttonLink buttonLight" href="/simulador">{copy.home.simulatorCta}</Link>
          </article>
        </section>
      </div>
    </main>
  );
}
