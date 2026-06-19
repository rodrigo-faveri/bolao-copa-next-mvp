import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { CupHeader } from "../../../components/CupHeader";
import { getCurrentLocale } from "../../../lib/i18n";
import { formatMessage, t } from "../../../lib/i18n-shared";
import { prisma } from "../../../lib/prisma";
import { regeneratePoolInvite, removePoolMember, renamePool, updatePoolRules } from "../actions";

export const dynamic = "force-dynamic";

function getInviteUrl(inviteCode: string) {
  const baseUrl = process.env.AUTH_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/boloes?convite=${inviteCode}`;
}

function displayName(user: { id: string; name: string | null; nickname: string | null; email: string | null }, fallback: string) {
  return user.nickname?.trim() || user.name?.trim() || user.email || `${fallback} ${user.id.slice(-6)}`;
}

function getPoolModeLabel(mode: string, copy: ReturnType<typeof t>) {
  if (mode === "family") return copy.pools.mode_family;
  if (mode === "competitive") return copy.pools.mode_competitive;
  return copy.pools.mode_friends;
}

export default async function PoolDetailsPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

  const locale = await getCurrentLocale();
  const copy = t(locale);
  const { inviteCode } = await params;
  const normalizedInviteCode = inviteCode.toUpperCase();

  const pool = await prisma.pool.findUnique({
    where: { inviteCode: normalizedInviteCode },
    include: {
      createdBy: { select: { id: true, name: true, nickname: true, email: true } },
      members: {
        include: { user: { select: { id: true, name: true, nickname: true, email: true } } },
        orderBy: [{ role: "desc" }, { joinedAt: "asc" }],
      },
    },
  });

  if (!pool) redirect("/boloes");

  const currentMember = pool.members.find((member) => member.user.email === email);
  if (!currentMember) redirect("/boloes");

  const isOwner = currentMember.role === "owner";
  const inviteUrl = getInviteUrl(pool.inviteCode);

  return (
    <main className="container bolaoPage">
      <CupHeader active="boloes" title={pool.name} description={copy.pools.detailsDescription} />

      <section className="poolDetailsGrid">
        <article className="poolActionCard">
          <span className="badge badgeGold">{copy.pools.invite}</span>
          <h2>{copy.pools.share}</h2>
          <div className="poolInviteBox">
            <span>{copy.pools.code}</span>
            <strong>{pool.inviteCode}</strong>
            <p className="poolRulesSummary">
              <span>{getPoolModeLabel(pool.mode, copy)}</span>
              <span>{formatMessage(copy.pools.groupStageRule, { exact: pool.groupStageExactScorePoints, outcome: pool.groupStageOutcomePoints })}</span>
              <span>{formatMessage(copy.pools.knockoutRule, { exact: pool.knockoutExactScorePoints, outcome: pool.knockoutOutcomePoints })}</span>
            </p>
            <input readOnly value={inviteUrl} aria-label={formatMessage(copy.pools.inviteAria, { pool: pool.name })} />
            <Link className="buttonLink" href={`/bolao?bolao=${pool.inviteCode}`}>{copy.pools.pickInPool}</Link>
            <Link className="buttonLink" href={`/ranking?bolao=${pool.inviteCode}`}>{copy.pools.openPrivateRanking}</Link>
          </div>
        </article>

        {isOwner && (
          <article className="poolActionCard">
            <span className="badge">{copy.pools.owner}</span>
            <h2>{copy.pools.settings}</h2>
            <form action={renamePool} className="poolForm">
              <input name="poolId" type="hidden" value={pool.id} />
              <label>
                <span>{copy.pools.poolName}</span>
                <input defaultValue={pool.name} maxLength={48} minLength={3} name="name" required type="text" />
              </label>
              <button type="submit">{copy.pools.saveName}</button>
            </form>
            <form action={regeneratePoolInvite} className="poolForm">
              <input name="poolId" type="hidden" value={pool.id} />
              <button className="buttonSecondary" type="submit">{copy.pools.regenerateInvite}</button>
            </form>
            <form action={updatePoolRules} className="poolForm poolRulesForm">
              <input name="poolId" type="hidden" value={pool.id} />
              <label>
                <span>{copy.pools.mode}</span>
                <select defaultValue={pool.mode} name="mode">
                  <option value="friends">{copy.pools.mode_friends}</option>
                  <option value="family">{copy.pools.mode_family}</option>
                  <option value="competitive">{copy.pools.mode_competitive}</option>
                </select>
              </label>
              <fieldset className="poolRulesFieldset">
                <legend>{copy.pools.groupStageRules}</legend>
                <label>
                  <span>{copy.pools.exactScorePoints}</span>
                  <input defaultValue={pool.groupStageExactScorePoints} max={20} min={1} name="groupStageExactScorePoints" required type="number" />
                </label>
                <label>
                  <span>{copy.pools.outcomePoints}</span>
                  <input defaultValue={pool.groupStageOutcomePoints} max={20} min={0} name="groupStageOutcomePoints" required type="number" />
                </label>
              </fieldset>
              <fieldset className="poolRulesFieldset">
                <legend>{copy.pools.knockoutRules}</legend>
                <label>
                  <span>{copy.pools.exactScorePoints}</span>
                  <input defaultValue={pool.knockoutExactScorePoints} max={30} min={1} name="knockoutExactScorePoints" required type="number" />
                </label>
                <label>
                  <span>{copy.pools.outcomePoints}</span>
                  <input defaultValue={pool.knockoutOutcomePoints} max={30} min={0} name="knockoutOutcomePoints" required type="number" />
                </label>
              </fieldset>
              <button type="submit">{copy.pools.saveRules}</button>
            </form>
          </article>
        )}
      </section>

      <section className="poolListCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">{copy.pools.members}</span>
            <h2>{copy.pools.participants}</h2>
          </div>
          <span className="muted">{formatMessage(copy.pools.participantsCount, { count: pool.members.length })}</span>
        </div>

        <div className="poolMemberList">
          {pool.members.map((member) => (
            <article className="poolMemberItem" key={member.id}>
              <div>
                <strong>{displayName(member.user, copy.auth.guest)}</strong>
                <span>{member.role === "owner" ? copy.pools.owner : copy.pools.member}</span>
              </div>
              {isOwner && member.role !== "owner" && (
                <form action={removePoolMember}>
                  <input name="poolId" type="hidden" value={pool.id} />
                  <input name="memberId" type="hidden" value={member.id} />
                  <button className="buttonDanger" type="submit">{copy.pools.remove}</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
