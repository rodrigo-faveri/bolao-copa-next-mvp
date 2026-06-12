import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { isAdminEmail } from "../../lib/access-control";
import { MAX_GOALS } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getMatchVenue } from "../../lib/venues";
import { saveMatchEvent, saveMatchLiveUrl, saveMatchResult, saveMatchStatus } from "./actions";

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
  return `${dateFormatter.format(startsAt)} as ${timeFormatter.format(startsAt)}`;
}

function formatMatchStatus(status: string, hasResult: boolean) {
  if (hasResult || status === "finished") return "Encerrada";
  if (status === "live") return "Ao vivo";
  return "Agendada";
}

export default async function AdminPage() {
  const session = await auth();

  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const matches = await prisma.match.findMany({
    include: { _count: { select: { events: true, predictions: true } } },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
  });

  const finishedCount = matches.filter((match) => match.finishedAt).length;

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="admin"
        eyebrow="Area protegida"
        title="Admin do bolao"
        description="Lance resultados oficiais, altere status e cadastre lances do tempo real."
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
          const matchStatus = formatMatchStatus(match.status, hasResult);

          return (
            <article className="adminResultCard" key={match.id}>
              <div className="adminResultHeader">
                <div>
                  <span className="badge">Grupo {match.group}</span>
                  <h2>{match.teamA} x {match.teamB}</h2>
                  <p className="muted">{formatMatchDate(match.startsAt)} - {getMatchVenue(match.group, match.teamA, match.teamB)}</p>
                </div>
                <div className="adminResultStatus">
                  <strong>{hasResult ? `${match.resultGoalsA} x ${match.resultGoalsB}` : "Pendente"}</strong>
                  <span>{matchStatus} - {match._count.predictions} palpite(s) - {match._count.events} lance(s)</span>
                </div>
              </div>

              {!hasResult && (
                <form action={saveMatchStatus} className="adminStatusForm">
                  <input name="matchId" type="hidden" value={match.id} />
                  <label>
                    <span>Status da partida</span>
                    <select name="status" defaultValue={match.status}>
                      <option value="scheduled">Agendada</option>
                      <option value="live">Ao vivo</option>
                    </select>
                  </label>
                  <button className="buttonSecondary" type="submit">Atualizar status</button>
                </form>
              )}

              <form action={saveMatchLiveUrl} className="adminStatusForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>URL externa do tempo real</span>
                  <input
                    aria-label={`URL externa do tempo real de ${match.teamA} x ${match.teamB}`}
                    defaultValue={match.liveUrl ?? ""}
                    name="liveUrl"
                    placeholder="https://..."
                    type="url"
                  />
                </label>
                <button className="buttonSecondary" type="submit">Salvar link</button>
              </form>

              <form action={saveMatchEvent} className="adminEventForm">
                <input name="matchId" type="hidden" value={match.id} />
                <label>
                  <span>Minuto</span>
                  <input aria-label={`Minuto do lance de ${match.teamA} x ${match.teamB}`} name="minute" placeholder="23' ou 45+2'" type="text" />
                </label>
                <label>
                  <span>Titulo do lance</span>
                  <input aria-label={`Titulo do lance de ${match.teamA} x ${match.teamB}`} name="title" placeholder="Gol, cartao, chance..." type="text" />
                </label>
                <label>
                  <span>Descricao</span>
                  <input aria-label={`Descricao do lance de ${match.teamA} x ${match.teamB}`} name="description" placeholder="Descreva rapidamente o que aconteceu" type="text" />
                </label>
                <button className="buttonSecondary" type="submit">Adicionar lance</button>
              </form>

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
