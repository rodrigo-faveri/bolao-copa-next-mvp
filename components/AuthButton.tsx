import Link from "next/link";
import { auth, signIn, signOut } from "../auth";
import { isAdminEmail } from "../lib/access-control";

export async function AuthButton() {
  const session = await auth();
  const displayName = session?.user?.name?.trim() || "Participante";
  const initial = displayName.slice(0, 1).toUpperCase();
  const isAdmin = isAdminEmail(session?.user?.email);

  if (!session?.user) {
    return (
      <form action={async () => { "use server"; await signIn("google", { redirectTo: "/bolao" }); }}>
        <button className="authLoginButton" type="submit">Entrar com Google</button>
      </form>
    );
  }

  return (
    <details className="authControls authMenu">
      <summary className="authMenuTrigger">
        <span className="authAvatar" aria-hidden="true">{initial}</span>
        <span className="authName">{displayName}</span>
        <span className="authCaret" aria-hidden="true">v</span>
      </summary>
      <div className="authMenuPanel">
        {session.user.email && <span className="authEmail">{session.user.email}</span>}
        <Link className="authMenuItem" href="/perfil">Meu perfil</Link>
        <Link className="authMenuItem" href="/boloes">Meus bolões</Link>
        <Link className="authMenuItem" href="/bolao">Meus palpites</Link>
        <Link className="authMenuItem" href="/ranking">Ranking</Link>
        <Link className="authMenuItem" href="/simulador">Simulador</Link>
        <Link className="authMenuItem" href="/noticias">Notícias</Link>
        {isAdmin && <Link className="authMenuItem" href="/admin">Admin</Link>}
        <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
          <button className="authMenuItem authMenuLogout" type="submit">Sair</button>
        </form>
      </div>
    </details>
  );
}
