"use client";

import { getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";
import app from "./firebase";
import { savePushToken } from "./firestore";

export type NotificationStatus =
  | "unsupported"
  | "denied"
  | "prompt"
  | "enabled";

export function notificationStatus(): NotificationStatus {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "enabled";
  if (Notification.permission === "denied") return "denied";
  return "prompt";
}

export async function enablePushNotifications(uid: string) {
  if (!(await isSupported())) throw new Error("Push notifications are not supported on this browser.");
  if (!("serviceWorker" in navigator)) throw new Error("Service workers are not supported on this browser.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notification permission was not granted.");

  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("NEXT_PUBLIC_FIREBASE_VAPID_KEY is not configured.");

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) throw new Error("Firebase did not return a push registration token.");

  await savePushToken(uid, token, {
    userAgent: navigator.userAgent,
    platform: navigator.platform || "web",
  });

  return token;
}

export async function refreshPushRegistration(uid: string) {
  if (notificationStatus() !== "enabled") return;
  try {
    await enablePushNotifications(uid);
  } catch (error) {
    console.error("Unable to refresh push registration:", error);
  }
}

export async function listenForForegroundMessages() {
  if (!(await isSupported())) return () => {};
  const messaging = getMessaging(app);
  return onMessage(messaging, (payload) => {
    if (Notification.permission !== "granted") return;
    const title = payload.notification?.title ?? "BillTrack";
    const body = payload.notification?.body ?? payload.data?.body ?? "You have a BillTrack reminder.";
    new Notification(title, {
      body,
      icon: "/icons/icon-192.png",
      tag: payload.data?.tag ?? "billtrack-reminder",
    });
  });
}

export async function sendTestPush() {
  const functions = getFunctions(app, "northamerica-northeast1");
  const call = httpsCallable(functions, "sendTestNotification");
  return call();
}
