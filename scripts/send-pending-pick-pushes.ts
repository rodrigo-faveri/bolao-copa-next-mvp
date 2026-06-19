import type { PushSubscription } from "web-push";
import { PrismaClient } from "@prisma/client";
import { PREDICTION_CLOSE_MINUTES } from "../lib/prediction";
import { sendPushNotification } from "../lib/push";
import { getTeamDisplayName } from "../lib/teams";

const prisma = new PrismaClient();

function readPositiveInt(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getBaseUrl() {
  return (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function main() {
  const jobRun = await prisma.scheduledJobRun.create({
    data: {
      jobName: "push_pending_picks",
      status: "running",
    },
  });
  const windowMinutes = Math.max(readPositiveInt("PUSH_REMINDER_WINDOW_MINUTES", 120), 120);
  const now = new Date();
  const reminderWindowEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const matchStartMin = new Date(now.getTime() + PREDICTION_CLOSE_MINUTES * 60 * 1000);
  const matchStartMax = new Date(reminderWindowEnd.getTime() + PREDICTION_CLOSE_MINUTES * 60 * 1000);

  const matches = await prisma.match.findMany({
    where: {
      resultGoalsA: null,
      resultGoalsB: null,
      startsAt: {
        gt: matchStartMin,
        lte: matchStartMax,
      },
    },
    include: {
      predictions: { select: { userId: true } },
    },
    orderBy: { startsAt: "asc" },
  });

  let sent = 0;
  let skipped = 0;

  try {
    for (const match of matches) {
      if (!match.startsAt) {
        skipped += 1;
        continue;
      }

      const predictedUserIds = new Set(match.predictions.map((prediction) => prediction.userId));
      const subscriptions = await prisma.pushSubscription.findMany({
        where: {
          user: {
            notifyPickDeadlines: true,
            predictions: {
              none: { matchId: match.id },
            },
          },
        },
        include: {
          user: { select: { id: true, notificationLeadMinutes: true } },
        },
      });

      for (const subscription of subscriptions) {
        const deadline = new Date(match.startsAt.getTime() - PREDICTION_CLOSE_MINUTES * 60 * 1000);
        const userReminderWindowEnd = new Date(now.getTime() + subscription.user.notificationLeadMinutes * 60 * 1000);
        if (deadline > userReminderWindowEnd) {
          skipped += 1;
          continue;
        }

        if (predictedUserIds.has(subscription.userId)) {
          skipped += 1;
          continue;
        }

        const log = await prisma.pushNotificationLog.findUnique({
          where: {
            userId_matchId_kind: {
              userId: subscription.userId,
              matchId: match.id,
              kind: "pick_deadline",
            },
          },
        });
        if (log) {
          skipped += 1;
          continue;
        }

        const endpoint: PushSubscription = {
          endpoint: subscription.endpoint,
          keys: {
            auth: subscription.auth,
            p256dh: subscription.p256dh,
          },
        };
        const payload = {
          body: `${getTeamDisplayName(match.teamA)} x ${getTeamDisplayName(match.teamB)} fecha em breve.`,
          tag: `pick-deadline-${match.id}`,
          title: "Palpite perto do fechamento",
          url: `${getBaseUrl()}/bolao?focus=${match.id}#bolao-confrontos`,
        };

        try {
          await sendPushNotification(endpoint, payload);

          await prisma.pushNotificationLog.create({
            data: {
              body: payload.body,
              kind: "pick_deadline",
              matchId: match.id,
              title: payload.title,
              url: payload.url,
              userId: subscription.userId,
            },
          });
          sent += 1;
        } catch (error) {
          skipped += 1;
          const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : null;
          if (statusCode === 404 || statusCode === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
          }
          console.warn(`Falha ao enviar push para ${subscription.userId}: ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
    }

    await prisma.scheduledJobRun.update({
      where: { id: jobRun.id },
      data: {
        details: { matches: matches.length, sent, skipped, windowMinutes },
        finishedAt: new Date(),
        status: "success",
      },
    });

    console.info(`Push de palpites concluido: ${sent} enviado(s), ${skipped} ignorado(s), ${matches.length} partida(s).`);
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

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
