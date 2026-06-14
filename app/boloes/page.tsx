import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { getCurrentLocale } from "../../lib/i18n";
import { formatMessage, t } from "../../lib/i18n-shared";
import { prisma } from "../../lib/prisma";
import { createPool, joinPool } from "./actions";

export const dynamic = "force-dynamic";

function getInviteUrl(inviteCode: string) {
  const baseUrl = process.env.AUTH_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/boloes?convite=${inviteCode}`;
}

function getPoolModeLabel(mode: string, copy: ReturnType<typeof t>) {
  if (mode === "family") return copy.pools.mode_family;
  if (mode === "competitive") return copy.pools.mode_competitive;
  return copy.pools.mode_friends;
}

export default async function BoloesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const params = await searchParams;
  const inviteParam = typeof params?.convite === "string" ? params.convite.toUpperCase() : "";

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      poolMemberships: {
        include: {
          pool: {
            include: {
              _count: { select: { members: true } },
              createdBy: { select: { nickname: true, name: true } },
            },
          },
        },
        orderBy: { joinedAt: "desc" },
      },
    },
  });

  if (!user) redirect("/");

  return (
    <main className="container bolaoPage">
      <CupHeader active="boloes" title={copy.pools.title} description={copy.pools.description} />

      <section className="poolActionsGrid">
        <article className="poolActionCard">
          <span className="badge badgeGold">{copy.pools.create}</span>
          <h2>{copy.pools.newPrivate}</h2>
          <form action={createPool} className="poolForm">
            <label>
              <span>{copy.pools.poolName}</span>
              <input maxLength={48} minLength={3} name="name" placeholder={copy.pools.poolPlaceholder} required type="text" />
            </label>
            <button type="submit">{copy.pools.createPool}</button>
          </form>
        </article>

        <article className="poolActionCard">
          <span className="badge">{copy.pools.join}</span>
          <h2>{copy.pools.hasInvite}</h2>
          <form action={joinPool} className="poolForm">
            <label>
              <span>{copy.pools.inviteCode}</span>
              <input defaultValue={inviteParam} maxLength={24} minLength={6} name="inviteCode" placeholder="ABC12345" required type="text" />
            </label>
            <button className="buttonSecondary" type="submit">{copy.pools.joinPool}</button>
          </form>
        </article>
      </section>

      <section className="poolListCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">{copy.pools.private}</span>
            <h2>{copy.pools.participating}</h2>
          </div>
          <span className="muted">{formatMessage(copy.pools.poolCount, { count: user.poolMemberships.length })}</span>
        </div>

        {user.poolMemberships.length > 0 ? (
          <div className="poolList">
            {user.poolMemberships.map((membership) => {
              const ownerName = membership.pool.createdBy?.nickname || membership.pool.createdBy?.name || copy.auth.guest;
              const inviteUrl = getInviteUrl(membership.pool.inviteCode);
              const poolMode = getPoolModeLabel(membership.pool.mode, copy);

              return (
                <article className="poolListItem" key={membership.id}>
                  <div>
                    <span className="badge">{membership.role === "owner" ? copy.pools.owner : copy.pools.member}</span>
                    <h3>{membership.pool.name}</h3>
                    <p className="poolRulesSummary">
                      <span>{poolMode}</span>
                      <span>{formatMessage(copy.pools.exactRule, { points: membership.pool.exactScorePoints })}</span>
                      <span>{formatMessage(copy.pools.outcomeRule, { points: membership.pool.outcomePoints })}</span>
                    </p>
                    <p className="muted">{formatMessage(copy.pools.participantsCount, { count: membership.pool._count.members })} · {formatMessage(copy.pools.createdBy, { owner: ownerName })}</p>
                  </div>
                  <div className="poolInviteBox">
                    <span>{copy.pools.code}</span>
                    <strong>{membership.pool.inviteCode}</strong>
                    <input readOnly value={inviteUrl} aria-label={formatMessage(copy.pools.inviteAria, { pool: membership.pool.name })} />
                    <Link className="buttonLink" href={`/bolao?bolao=${membership.pool.inviteCode}`}>{copy.pools.pickInPool}</Link>
                    <Link className="buttonLink buttonSecondary" href={`/boloes/${membership.pool.inviteCode}`}>{copy.pools.details}</Link>
                    <Link className="buttonLink buttonSecondary" href={`/ranking?bolao=${membership.pool.inviteCode}`}>{copy.pools.seeRanking}</Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="emptyRanking muted">{copy.pools.empty}</p>
        )}
      </section>
    </main>
  );
}
