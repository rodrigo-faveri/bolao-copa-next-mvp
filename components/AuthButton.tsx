import Link from "next/link";
import { auth, signIn, signOut } from "../auth";
import { isAdminEmail } from "../lib/access-control";
import { getCurrentLocale, t } from "../lib/i18n";

export async function AuthButton() {
  const session = await auth();
  const locale = await getCurrentLocale();
  const copy = t(locale);
  const displayName = session?.user?.name?.trim() || copy.auth.guest;
  const initial = displayName.slice(0, 1).toUpperCase();
  const isAdmin = isAdminEmail(session?.user?.email);

  if (!session?.user) {
    return (
      <form action={async () => { "use server"; await signIn("google", { redirectTo: "/bolao" }); }}>
        <button className="authLoginButton" type="submit">{copy.auth.login}</button>
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
        <Link className="authMenuItem" href="/perfil">{copy.auth.profile}</Link>
        <Link className="authMenuItem" href="/boloes">{copy.auth.pools}</Link>
        <Link className="authMenuItem" href="/bolao">{copy.auth.predictions}</Link>
        <Link className="authMenuItem" href="/ranking">{copy.auth.ranking}</Link>
        <Link className="authMenuItem" href="/simulador">{copy.auth.simulator}</Link>
        <Link className="authMenuItem" href="/noticias">{copy.auth.news}</Link>
        {isAdmin && <Link className="authMenuItem" href="/admin">{copy.auth.admin}</Link>}
        <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
          <button className="authMenuItem authMenuLogout" type="submit">{copy.auth.logout}</button>
        </form>
      </div>
    </details>
  );
}
