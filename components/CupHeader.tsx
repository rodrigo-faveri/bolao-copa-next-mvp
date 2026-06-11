import Link from "next/link";
import { AuthButton } from "./AuthButton";

type ActivePage = "home" | "bolao" | "boloes" | "simulador" | "ranking" | "noticias" | "admin" | "perfil";

const navItems = [
  { href: "/", label: "Início", key: "home" },
  { href: "/bolao", label: "Palpites", key: "bolao" },
  { href: "/boloes", label: "Bolões", key: "boloes" },
  { href: "/simulador", label: "Simulador", key: "simulador" },
  { href: "/ranking", label: "Ranking", key: "ranking" },
  { href: "/noticias", label: "Notícias", key: "noticias" },
] as const;

export function CupHeader({
  active,
  eyebrow = "Bolão Copa 2026",
  title,
  description,
}: {
  active: ActivePage;
  eyebrow?: string;
  title: string;
  description: string;
}) {
  return (
    <section className="cupHeader">
      <div className="cupHeaderGlow" aria-hidden="true" />
      <div className="cupHeaderContent">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="pillNav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <Link
              className={`pillLink ${active === item.key ? "pillLinkActive" : ""}`}
              href={item.href}
              key={item.key}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="cupHeaderAccount">
        <AuthButton />
      </div>
    </section>
  );
}
