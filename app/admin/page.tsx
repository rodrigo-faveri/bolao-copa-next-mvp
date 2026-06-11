import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { isAdminEmail } from "../../lib/access-control";
import { MAX_GOALS } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getMatchVenue } from "../../lib/venues";
import { saveMatchResult } from "./actions";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatMatchDate(startsAt: Date | null) {
  if (!startsAt) return "Sem data";
  return `${dateFormatter.format(startsAt)} às ${timeFormatter.format(startsAt)}`;
}

export default async function AdminPage() {
  const session = await auth();

  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const matches = await prisma.match.findMany({
    include: { _count: { select: { predictions: true } } },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
  });

  const finishedCount = matches.filter((match) => match.finishedAt).length;

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="admin"
        eyebrow="Área protegida"
        title="Admin do bolão"
        description="Lance resultados oficiais e recalcule automaticamente a pontuação dos palpites."
      />

      <section className="pageToolbar">
        <div>
          <span className="badge badgeGold">Resultados</span>
          <h2>Partidas da fase de grupos</h2>
        </div>
        <div className="toolbarTips">
          <span>{finishedCount} finalizada(s)</span>
          <span>{matches.length} partida(s)</span>
        </div>
      </section>

      <section className="adminResultsList">
        {matches.map((match) => {
          const hasResult = match.resultGoalsA !== null && match.resultGoalsB !== null;

          return (
            <article className="adminResultCard" key={match.id}>
              <div className="adminResultHeader">
                <div>
                  <span className="badge">Grupo {match.group}</span>
                  <h2>{match.teamA} x {match.teamB}</h2>
                  <p className="muted">{formatMatchDate(match.startsAt)} · {getMatchVenue(match.group, match.teamA, match.teamB)}</p>
                </div>
                <div className="adminResultStatus">
                  <strong>{hasResult ? `${match.resultGoalsA} x ${match.resultGoalsB}` : "Pendente"}</strong>
                  <span>{match._count.predictions} palpite(s)</span>
                </div>
              </div>

              <form action={saveMatchResult} className="adminResultForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>{match.teamA}</span>
                  <input
                    aria-label={`Gols de ${match.teamA}`}
                    defaultValue={match.resultGoalsA ?? ""}
                    max={MAX_GOALS}
                    min="0"
                    name="goalsA"
                    required
                    type="number"
                  />
                </label>
                <span className="versus">x</span>
                <label>
                  <span>{match.teamB}</span>
                  <input
                    aria-label={`Gols de ${match.teamB}`}
                    defaultValue={match.resultGoalsB ?? ""}
                    max={MAX_GOALS}
                    min="0"
                    name="goalsB"
                    required
                    type="number"
                  />
                </label>
                <button type="submit">{hasResult ? "Atualizar resultado" : "Salvar resultado"}</button>
              </form>
            </article>
          );
        })}
      </section>
    </main>
  );
}
