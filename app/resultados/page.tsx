import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { CupHeader } from "../../components/CupHeader";
import { ResultsExplorer, type ResultFilter, type ResultItem } from "../../components/ResultsExplorer";
import { getCurrentLocale } from "../../lib/i18n";
import { calculatePredictionPoints } from "../../lib/prediction";
import { prisma } from "../../lib/prisma";
import { getTeamDisplayName } from "../../lib/teams";
import { getMatchVenue } from "../../lib/venues";

export const dynamic = "force-dynamic";

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function explainPoints({
  predictedA,
  predictedB,
  resultA,
  resultB,
}: {
  predictedA: number | null;
  predictedB: number | null;
  resultA: number | null;
  resultB: number | null;
}) {
  if (resultA === null || resultB === null) {
    return {
      label: "Aguardando resultado",
      text: "A partida ja entrou na janela de acompanhamento, mas o resultado oficial ainda nao foi registrado.",
    };
  }

  if (predictedA === null || predictedB === null) {
    return {
      label: "Sem palpite",
      text: "Voce nao tinha um palpite salvo para esta partida, entao nao pontuou.",
    };
  }

  const points = calculatePredictionPoints(predictedA, predictedB, resultA, resultB);
  if (points === 5) {
    return {
      label: "Placar exato",
      text: "Voce acertou exatamente os gols das duas selecoes. Por isso ganhou 5 pontos.",
    };
  }

  if (points === 3 && getOutcome(predictedA, predictedB) === getOutcome(resultA, resultB)) {
    return {
      label: "Resultado correto",
      text: "Voce acertou o vencedor ou empate, mas nao o placar exato. Por isso ganhou 3 pontos.",
    };
  }

  return {
    label: "Nao pontuou",
    text: "O resultado do seu palpite foi diferente do resultado oficial. Por isso ficou com 0 ponto.",
  };
}

function getMatchPhase(match: { startsAt: Date | null; resultGoalsA: number | null; resultGoalsB: number | null }, now = new Date()) {
  if (match.resultGoalsA !== null && match.resultGoalsB !== null) return "Encerrada";
  if (!match.startsAt) return "Sem horario";

  const elapsedMinutes = Math.floor((now.getTime() - match.startsAt.getTime()) / 60000);
  if (elapsedMinutes < 0) return "Agendada";
  if (elapsedMinutes <= 45) return "Ao vivo - 1o tempo";
  if (elapsedMinutes <= 60) return "Intervalo previsto";
  if (elapsedMinutes <= 105) return "Ao vivo - 2o tempo";
  if (elapsedMinutes <= 130) return "Fim previsto";
  return "Aguardando resultado";
}

function buildMatchSummary({
  prediction,
  resultA,
  resultB,
  teamA,
  teamB,
}: {
  prediction: { goalsA: number; goalsB: number; points: number } | null;
  resultA: number | null;
  resultB: number | null;
  teamA: string;
  teamB: string;
}) {
  if (resultA === null || resultB === null) {
    return "Resumo automatico: a partida ja esta no acompanhamento, mas ainda falta registrar o placar oficial para calcular sua pontuacao.";
  }

  if (!prediction) {
    return `Resumo automatico: ${teamA} ${resultA} x ${resultB} ${teamB}. Voce nao tinha palpite salvo para esse jogo.`;
  }

  if (prediction.points === 5) {
    return `Resumo automatico: ${teamA} ${resultA} x ${resultB} ${teamB}. Seu palpite foi perfeito e rendeu 5 pontos.`;
  }

  if (prediction.points === 3) {
    return `Resumo automatico: ${teamA} ${resultA} x ${resultB} ${teamB}. Voce acertou o resultado geral e somou 3 pontos.`;
  }

  return `Resumo automatico: ${teamA} ${resultA} x ${resultB} ${teamB}. Seu palpite nao acompanhou o resultado oficial desta vez.`;
}

function getResultFilter(prediction: { goalsA: number; goalsB: number; points: number } | null, resultA: number | null, resultB: number | null): ResultFilter {
  if (resultA === null || resultB === null) return "pending";
  if (!prediction) return "noPrediction";
  if (prediction.points === 5) return "exact";
  if (prediction.points === 3) return "outcome";
  return "miss";
}

export default async function ResultadosPage() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) redirect("/");
  const locale = await getCurrentLocale();

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) redirect("/");

  const now = new Date();
  const matches = await prisma.match.findMany({
    where: {
      OR: [
        { resultGoalsA: { not: null }, resultGoalsB: { not: null } },
        { startsAt: { lte: now } },
      ],
    },
    include: {
      predictions: {
        where: { userId: user.id },
        select: { goalsA: true, goalsB: true, points: true },
        take: 1,
      },
    },
    orderBy: [{ startsAt: "asc" }, { group: "asc" }],
  });

  const resolvedMatches = matches.filter((match) => match.resultGoalsA !== null && match.resultGoalsB !== null);
  const waitingMatches = matches.filter((match) => match.resultGoalsA === null || match.resultGoalsB === null);
  const totalPoints = resolvedMatches.reduce((sum, match) => sum + (match.predictions[0]?.points ?? 0), 0);
  const exactHits = resolvedMatches.filter((match) => {
    const prediction = match.predictions[0];
    return prediction && prediction.goalsA === match.resultGoalsA && prediction.goalsB === match.resultGoalsB;
  }).length;
  const outcomeHits = resolvedMatches.filter((match) => match.predictions[0]?.points === 3).length;
  const predictionsCount = matches.filter((match) => Boolean(match.predictions[0])).length;
  const resultItems: ResultItem[] = matches.map((match) => {
    const prediction = match.predictions[0] ?? null;
    const resultA = match.resultGoalsA;
    const resultB = match.resultGoalsB;
    const hasOfficialResult = resultA !== null && resultB !== null;
    const explanation = explainPoints({
      predictedA: prediction?.goalsA ?? null,
      predictedB: prediction?.goalsB ?? null,
      resultA,
      resultB,
    });

    return {
      id: match.id,
      group: match.group,
      teamA: match.teamA,
      teamB: match.teamB,
      startsAtLabel: match.startsAt ? dateFormatter.format(match.startsAt) : "Sem data",
      venue: getMatchVenue(match.group, match.teamA, match.teamB),
      phase: getMatchPhase(match, now),
      hasOfficialResult,
      resultA,
      resultB,
      predictionA: prediction?.goalsA ?? null,
      predictionB: prediction?.goalsB ?? null,
      points: prediction?.points ?? null,
      filter: getResultFilter(prediction, resultA, resultB),
      explanationLabel: explanation.label,
      explanationText: explanation.text,
      summary: buildMatchSummary({
        prediction,
        resultA,
        resultB,
        teamA: getTeamDisplayName(match.teamA, locale),
        teamB: getTeamDisplayName(match.teamB, locale),
      }),
    };
  });

  return (
    <main className="container bolaoPage">
      <CupHeader
        active="resultados"
        title="Meus resultados"
        description="Compare seus palpites com os placares oficiais e entenda exatamente por que pontuou ou nao."
      />

      {matches.length === 0 ? (
        <section className="card">
          <h2>Nenhuma partida em acompanhamento ainda</h2>
          <p className="muted">Quando uma partida comecar ou tiver placar oficial, ela aparece aqui automaticamente.</p>
        </section>
      ) : (
        <ResultsExplorer
          items={resultItems}
          locale={locale}
          summary={{
            totalPoints,
            exactHits,
            outcomeHits,
            resolvedMatches: resolvedMatches.length,
            waitingMatches: waitingMatches.length,
            predictionsCount,
          }}
        />
      )}
    </main>
  );
}
