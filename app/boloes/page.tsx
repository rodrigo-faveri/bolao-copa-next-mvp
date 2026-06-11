import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { prisma } from "../../lib/prisma";
import { createPool, joinPool } from "./actions";

export const dynamic = "force-dynamic";

function getInviteUrl(inviteCode: string) {
  const baseUrl = process.env.AUTH_URL || "http://localhost:3000";
  return `${baseUrl.replace(/\/$/, "")}/boloes?convite=${inviteCode}`;
}

export default async function BoloesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");

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
      <CupHeader active="boloes" title="Meus bolões" description="Crie grupos privados, compartilhe o convite e dispute com seus amigos." />

      <section className="poolActionsGrid">
        <article className="poolActionCard">
          <span className="badge badgeGold">Criar</span>
          <h2>Novo bolão privado</h2>
          <form action={createPool} className="poolForm">
            <label>
              <span>Nome do bolão</span>
              <input maxLength={48} minLength={3} name="name" placeholder="Ex.: Família Copa 2026" required type="text" />
            </label>
            <button type="submit">Criar bolão</button>
          </form>
        </article>

        <article className="poolActionCard">
          <span className="badge">Entrar</span>
          <h2>Tenho um convite</h2>
          <form action={joinPool} className="poolForm">
            <label>
              <span>Código do convite</span>
              <input defaultValue={inviteParam} maxLength={24} minLength={6} name="inviteCode" placeholder="ABC12345" required type="text" />
            </label>
            <button className="buttonSecondary" type="submit">Entrar no bolão</button>
          </form>
        </article>
      </section>

      <section className="poolListCard">
        <div className="rankingHeader">
          <div>
            <span className="badge badgeGold">Privados</span>
            <h2>Bolões que participo</h2>
          </div>
          <span className="muted">{user.poolMemberships.length} bolão(ões)</span>
        </div>

        {user.poolMemberships.length > 0 ? (
          <div className="poolList">
            {user.poolMemberships.map((membership) => {
              const ownerName = membership.pool.createdBy?.nickname || membership.pool.createdBy?.name || "Participante";
              const inviteUrl = getInviteUrl(membership.pool.inviteCode);

              return (
                <article className="poolListItem" key={membership.id}>
                  <div>
                    <span className="badge">{membership.role === "owner" ? "Dono" : "Membro"}</span>
                    <h3>{membership.pool.name}</h3>
                    <p className="muted">{membership.pool._count.members} participante(s) · criado por {ownerName}</p>
                  </div>
                  <div className="poolInviteBox">
                    <span>Código</span>
                    <strong>{membership.pool.inviteCode}</strong>
                    <input readOnly value={inviteUrl} aria-label={`Link de convite do bolão ${membership.pool.name}`} />
                    <Link className="buttonLink" href={`/bolao?bolao=${membership.pool.inviteCode}`}>Palpitar neste bolão</Link>
                    <Link className="buttonLink buttonSecondary" href={`/boloes/${membership.pool.inviteCode}`}>Detalhes</Link>
                    <Link className="buttonLink buttonSecondary" href={`/ranking?bolao=${membership.pool.inviteCode}`}>Ver ranking</Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="emptyRanking muted">Você ainda não participa de nenhum bolão privado.</p>
        )}
      </section>
    </main>
  );
}
