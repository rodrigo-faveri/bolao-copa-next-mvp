import webpush, { type PushSubscription } from "web-push";

export function isPushConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
}

export function configureWebPush() {
  if (!isPushConfigured()) return false;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  return true;
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  if (!configureWebPush()) {
    throw new Error("Push notifications are not configured.");
  }

  return webpush.sendNotification(subscription, JSON.stringify(payload));
}
