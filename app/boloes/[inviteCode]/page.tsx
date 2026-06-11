import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "../../../auth";
import { CupHeader } from "../../../components/CupHeader";
import { prisma } from "../../../lib/prisma";
import { regeneratePoolInvite, removePoolMember, renamePool } from "../actions";

export const dynamic = "force-dynamic";

function getInviteUrl(inviteCode: string) {
  const baseUrl = process.env.AUTH_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/boloes?convite=${inviteCode}`;
}

function displayName(user: { id: string; name: string | null; nickname: string | null; email: string | null }) {
  return user.nickname?.trim() || user.name?.trim() || user.email || `Participante ${user.id.slice(-6)}`;
}

export default async function PoolDetailsPage({ params }: { params: Promise<{ inviteCode: string }> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

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
      <CupHeader active="boloes" title={pool.name} description="Gerencie o convite, acompanhe membros e abra o ranking privado deste bolão." />

      <section className="poolDetailsGrid">
        <article className="poolActionCard">
          <span className="badge badgeGold">Convite</span>
          <h2>Compartilhe com amigos</h2>
          <div className="poolInviteBox">
            <span>Código</span>
            <strong>{pool.inviteCode}</strong>
            <input readOnly value={inviteUrl} aria-label={`Link de convite do bolão ${pool.name}`} />
            <Link className="buttonLink" href={`/bolao?bolao=${pool.inviteCode}`}>Palpitar neste bolão</Link>
            <Link className="buttonLink" href={`/ranking?bolao=${pool.inviteCode}`}>Abrir ranking privado</Link>
          </div>
        </article>

        {isOwner && (
          <article className="poolActionCard">
            <span className="badge">Dono</span>
            <h2>Configurações</h2>
            <form action={renamePool} className="poolForm">
              <input name="poolId" type="hidden" value={pool.id} />
              <label>
                <span>Nome do bolão</span>
                <input defaultValue={pool.name} maxLength={48} minLength={3} name="name" required type="text" />
              </label>
              <button type="submit">Salvar nome</button>
            </form>
            <form action={regeneratePoolInvite} className="poolForm">
              <input name="poolId" type="hidden" value={pool.id} />
              <button className="buttonSecondary" type="submit">Gerar novo convite</button>
            </form>
          </article>
        )}
      </section>

      <section className="poolListCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">Membros</span>
            <h2>Participantes</h2>
          </div>
          <span className="muted">{pool.members.length} participante(s)</span>
        </div>

        <div className="poolMemberList">
          {pool.members.map((member) => (
            <article className="poolMemberItem" key={member.id}>
              <div>
                <strong>{displayName(member.user)}</strong>
                <span>{member.role === "owner" ? "Dono" : "Membro"}</span>
              </div>
              {isOwner && member.role !== "owner" && (
                <form action={removePoolMember}>
                  <input name="poolId" type="hidden" value={pool.id} />
                  <input name="memberId" type="hidden" value={member.id} />
                  <button className="buttonDanger" type="submit">Remover</button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
