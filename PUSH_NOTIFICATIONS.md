# BillTrack push notifications

Implemented:
- Browser/PWA permission button and device registration.
- FCM web token stored at `users/{uid}/pushTokens/{tokenHash}`.
- Immediate test push after enabling notifications.
- Daily scheduled reminder function at 09:00 America/Toronto.
- Uses each commitment's `reminderDays` (10/7/3/0, or any stored values).
- Sends a one-day overdue notification when an occurrence remains unpaid.
- Dedupe log prevents the same reminder from being sent twice.
- Invalid FCM tokens are removed automatically.
- Existing `/sw.js` handles PWA cache, background push, and notification clicks.

## One-time setup

1. Firebase Console > Project settings > Cloud Messaging > Web Push certificates > Generate key pair.
2. Copy the public key into local `.env.local` and Vercel as `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
3. Make sure the existing NEXT_PUBLIC_FIREBASE_* variables are also configured in Vercel.
4. Cloud Functions scheduled jobs require the Firebase project to use the Blaze plan and Cloud Scheduler API.
5. Deploy rules and functions:

   firebase deploy --only firestore:rules,functions

6. Deploy the web app through the normal Git/Vercel flow.
7. Open BillTrack and press `Enable notifications`. The app registers the device and sends an immediate test notification.

## iPhone/iPad

Web Push is available for Home Screen web apps on iOS/iPadOS 16.4+. Add billtrack.casa to the Home Screen, open BillTrack from its Home Screen icon, then press `Enable notifications` from inside the installed PWA.
