import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { getCurrentLocale, t } from "../lib/i18n";

type ActivePage = "home" | "bolao" | "boloes" | "simulador" | "ranking" | "resultados" | "noticias" | "admin" | "perfil";

const navItems = [
  { href: "/", key: "home" },
  { href: "/bolao", key: "bolao" },
  { href: "/boloes", key: "boloes" },
  { href: "/simulador", key: "simulador" },
  { href: "/ranking", key: "ranking" },
  { href: "/resultados", key: "resultados" },
  { href: "/noticias", key: "noticias" },
] as const;

export async function CupHeader({
  active,
  eyebrow = "Bolao Copa 2026",
  title,
  description,
}: {
  active: ActivePage;
  eyebrow?: string;
  title: string;
  description: string;
}) {
  const locale = await getCurrentLocale();
  const copy = t(locale);

  return (
    <section className="cupHeader">
      <div className="cupHeaderGlow" aria-hidden="true" />
      <div className="cupHeaderContent">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="pillNav" aria-label="Navegacao principal">
          {navItems.map((item) => (
            <Link
              className={`pillLink ${active === item.key ? "pillLinkActive" : ""}`}
              href={item.href}
              key={item.key}
            >
              {copy.nav[item.key]}
            </Link>
          ))}
        </div>
      </div>
      <div className="cupHeaderAccount">
        <LanguageSwitcher ariaLabel={copy.language.ariaLabel} label={copy.language.label} locale={locale} />
        <AuthButton />
      </div>
    </section>
  );
}
