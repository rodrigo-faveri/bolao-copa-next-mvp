import type { PushSubscription } from "web-push";
import { PrismaClient } from "@prisma/client";
import { getTeamDisplayName } from "../lib/teams";
import { sendPushNotification } from "../lib/push";

const prisma = new PrismaClient();

type GroupMatch = {
  id: string;
  resultGoalsA: number | null;
  resultGoalsB: number | null;
  startsAt: Date | null;
  teamA: string;
};

function getBaseUrl() {
  return (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

function getOutcome(goalsA: number, goalsB: number) {
  return Math.sign(goalsA - goalsB);
}

function splitGroupRounds<T extends { startsAt: Date | null; teamA: string }>(matches: T[]) {
  const sorted = [...matches].sort((a, b) => {
    const timeA = a.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const timeB = b.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return timeA - timeB || a.teamA.localeCompare(b.teamA);
  });

  const rounds = new Map<string, number>();
  for (const [index, match] of sorted.entries()) {
    rounds.set(match.teamA, Math.floor(index / 2) + 1);
  }
  return rounds;
}

async function main() {
  const jobRun = await prisma.scheduledJobRun.create({
    data: {
      jobName: "push_results",
      status: "running",
    },
  });

  let sent = 0;
  let skipped = 0;

  try {
    const finishedMatches = await prisma.match.findMany({
      where: {
        resultGoalsA: { not: null },
        resultGoalsB: { not: null },
      },
      include: {
        predictions: {
          include: {
            user: {
              include: {
                pushSubscriptions: true,
              },
            },
          },
        },
      },
      orderBy: [{ finishedAt: "desc" }, { startsAt: "desc" }],
      take: 24,
    });

    const matchesByGroup = new Map<string, GroupMatch[]>();
    for (const group of new Set(finishedMatches.map((match) => match.group))) {
      matchesByGroup.set(group, await prisma.match.findMany({
        orderBy: [{ startsAt: "asc" }],
        select: {
          id: true,
          resultGoalsA: true,
          resultGoalsB: true,
          startsAt: true,
          teamA: true,
        },
        where: { group },
      }));
    }

    for (const match of finishedMatches) {
      if (match.resultGoalsA === null || match.resultGoalsB === null) continue;
      const teamA = getTeamDisplayName(match.teamA);
      const teamB = getTeamDisplayName(match.teamB);
      const matchLabel = `${teamA} ${match.resultGoalsA} x ${match.resultGoalsB} ${teamB}`;

      for (const prediction of match.predictions) {
        if (!prediction.user.notifyResults && !prediction.user.notifyRoundSummary) {
          skipped += 1;
          continue;
        }

        const subscriptions = prediction.user.pushSubscriptions;
        if (subscriptions.length === 0) {
          skipped += 1;
          continue;
        }

        if (prediction.user.notifyResults) {
          const existingResultLog = await prisma.pushNotificationLog.findUnique({
            where: {
              userId_matchId_kind: {
                kind: "match_result",
                matchId: match.id,
                userId: prediction.userId,
              },
            },
          });

          if (!existingResultLog) {
            const resultKind = prediction.points > 0 ? "pontuou" : "nao pontuou";
            const payload = {
              body: `${matchLabel}. Voce fez ${prediction.points} pts e ${resultKind} neste jogo.`,
              tag: `match-result-${match.id}`,
              title: "Resultado final disponivel",
              url: `${getBaseUrl()}/resultados`,
            };
            let deliveredCount = 0;
            for (const subscription of subscriptions) {
              const delivered = await sendToSubscription(subscription, payload);
              if (delivered) {
                deliveredCount += 1;
                sent += 1;
              } else {
                skipped += 1;
              }
            }

            if (deliveredCount > 0) {
              await prisma.pushNotificationLog.create({
                data: {
                  body: payload.body,
                  kind: "match_result",
                  matchId: match.id,
                  title: payload.title,
                  url: payload.url,
                  userId: prediction.userId,
                },
              });
            }
          }
        }

        if (!prediction.user.notifyRoundSummary || !/^[A-L]$/.test(match.group)) continue;

        const groupMatches = matchesByGroup.get(match.group) ?? [];
        const roundByTeamA = splitGroupRounds(groupMatches);
        const roundNumber = roundByTeamA.get(match.teamA);
        if (!roundNumber) continue;

        const roundMatches = groupMatches.filter((item) => roundByTeamA.get(item.teamA) === roundNumber);
        const isRoundFinished = roundMatches.length > 0 && roundMatches.every((item) => item.resultGoalsA !== null && item.resultGoalsB !== null);
        if (!isRoundFinished) continue;

        const summaryKind = `round_summary_${match.group}_${roundNumber}`;
        const existingSummaryLog = await prisma.pushNotificationLog.findFirst({
          where: {
            kind: summaryKind,
            userId: prediction.userId,
          },
        });
        if (existingSummaryLog) continue;

        const userPredictions = await prisma.prediction.findMany({
          where: {
            matchId: { in: roundMatches.map((item) => item.id) },
            userId: prediction.userId,
          },
        });
        const roundPoints = userPredictions.reduce((sum, item) => sum + item.points, 0);
        const exactHits = userPredictions.filter((item) => {
          const roundMatch = roundMatches.find((candidate) => candidate.id === item.matchId);
          return roundMatch?.resultGoalsA === item.goalsA && roundMatch?.resultGoalsB === item.goalsB;
        }).length;
        const outcomeHits = userPredictions.filter((item) => {
          const roundMatch = roundMatches.find((candidate) => candidate.id === item.matchId);
          if (!roundMatch || roundMatch.resultGoalsA === null || roundMatch.resultGoalsB === null) return false;
          return getOutcome(item.goalsA, item.goalsB) === getOutcome(roundMatch.resultGoalsA, roundMatch.resultGoalsB)
            && !(roundMatch.resultGoalsA === item.goalsA && roundMatch.resultGoalsB === item.goalsB);
        }).length;

        let deliveredSummaryCount = 0;
        const summaryPayload = {
          body: `Grupo ${match.group}, ${roundNumber}a rodada: ${roundPoints} pts, ${exactHits} exato(s), ${outcomeHits} resultado(s).`,
          tag: `round-summary-${match.group}-${roundNumber}`,
          title: "Resumo da sua rodada",
          url: `${getBaseUrl()}/resultados`,
        };
        for (const subscription of subscriptions) {
          const delivered = await sendToSubscription(subscription, summaryPayload);
          if (delivered) {
            deliveredSummaryCount += 1;
            sent += 1;
          } else {
            skipped += 1;
          }
        }

        if (deliveredSummaryCount > 0) {
          await prisma.pushNotificationLog.create({
            data: {
              body: summaryPayload.body,
              kind: summaryKind,
              matchId: match.id,
              title: summaryPayload.title,
              url: summaryPayload.url,
              userId: prediction.userId,
            },
          });
        }
      }
    }

    await prisma.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        details: { matches: finishedMatches.length, sent, skipped },
        finishedAt: new Date(),
        status: "success",
      },
    });

    console.info(`Push de resultados concluido: ${sent} enviado(s), ${skipped} ignorado(s), ${finishedMatches.length} partida(s).`);
  } catch (error) {
    await prisma.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        errorMessage: error instanceof Error ? error.message : "unknown",
        finishedAt: new Date(),
        status: "failed",
      },
    });
    throw error;
  }
}

async function sendToSubscription(
  subscription: { auth: string; endpoint: string; p256dh: string },
  payload: { title: string; body: string; url: string; tag: string },
) {
  const endpoint: PushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      auth: subscription.auth,
      p256dh: subscription.p256dh,
    },
  };

  try {
    await sendPushNotification(endpoint, payload);
    return true;
  } catch (error) {
    const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : null;
    if (statusCode === 404 || statusCode === 410) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
    }
    console.warn(`Falha ao enviar push de resultado: ${error instanceof Error ? error.message : "unknown"}`);
    return false;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
