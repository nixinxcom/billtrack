"use strict";

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

/*
 * -------------------------------------------------------
 * Firebase initialization
 * -------------------------------------------------------
 */

initializeApp();

setGlobalOptions({
  region: "northamerica-northeast1",
  maxInstances: 2,
});

function getDb() {
  return getFirestore();
}

/*
 * -------------------------------------------------------
 * Date helpers
 * -------------------------------------------------------
 */

function torontoToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type) =>
    parts.find((part) => part.type === type)?.value;

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);

  const date = new Date(
    Date.UTC(year, month - 1, day)
  );

  date.setUTCDate(
    date.getUTCDate() + days
  );

  return date.toISOString().slice(0, 10);
}

function money(value) {
  if (typeof value !== "number") {
    return "";
  }

  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

/*
 * -------------------------------------------------------
 * Push tokens
 * -------------------------------------------------------
 */

async function tokensForUsers(uids) {
  const db = getDb();

  const uniqueUids = [
    ...new Set(
      (uids || []).filter(Boolean)
    ),
  ];

  if (!uniqueUids.length) {
    return [];
  }

  const tokenSnapshots =
    await Promise.all(
      uniqueUids.map((uid) =>
        db
          .collection("users")
          .doc(uid)
          .collection("pushTokens")
          .where("enabled", "==", true)
          .get()
      )
    );

  const result = [];

  tokenSnapshots.forEach(
    (snapshot, userIndex) => {
      snapshot.forEach((doc) => {
        const data = doc.data();

        if (!data.token) {
          return;
        }

        result.push({
          uid: uniqueUids[userIndex],
          ref: doc.ref,
          token: data.token,
        });
      });
    }
  );

  return result;
}

/*
 * -------------------------------------------------------
 * Duplicate notification protection
 * -------------------------------------------------------
 */

async function claimNotification(
  key,
  data
) {
  const db = getDb();

  const ref = db
    .collection("notificationLogs")
    .doc(key);

  try {
    await ref.create({
      ...data,
      createdAt:
        FieldValue.serverTimestamp(),
    });

    return true;
  } catch (error) {
    if (
      error?.code === 6 ||
      error?.code === "already-exists"
    ) {
      return false;
    }

    throw error;
  }
}

/*
 * -------------------------------------------------------
 * Remove invalid FCM tokens
 * -------------------------------------------------------
 */

async function cleanInvalidTokens(
  response,
  recipients
) {
  const invalidCodes = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ]);

  const cleanup = [];

  response.responses.forEach(
    (result, index) => {
      if (
        !result.success &&
        invalidCodes.has(
          result.error?.code
        )
      ) {
        cleanup.push(
          recipients[index].ref.delete()
        );
      }
    }
  );

  if (cleanup.length) {
    await Promise.allSettled(cleanup);
  }
}

/*
 * -------------------------------------------------------
 * Send one payment reminder
 * -------------------------------------------------------
 */

async function sendReminder({
  profile,
  obligation,
  occurrence,
  kind,
  offset,
}) {
  const messaging = getMessaging();

  const profileData = profile.data();
  const obligationData =
    obligation.data();
  const occurrenceData =
    occurrence.data();

  const key =
    `${profile.id}_${obligation.id}_${occurrence.id}_${kind}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

  const memberUids =
    Array.isArray(
      profileData.memberUids
    ) &&
    profileData.memberUids.length
      ? profileData.memberUids
      : [profileData.ownerUid];

  const recipients =
    await tokensForUsers(memberUids);

  if (!recipients.length) {
    return 0;
  }

  /*
   * Claim before sending so a retry does not
   * produce the same notification twice.
   */
  const claimed =
    await claimNotification(key, {
      profileId: profile.id,
      obligationId:
        obligation.id,
      occurrenceId:
        occurrence.id,
      kind,
      dueDate:
        occurrenceData.dueDate,
    });

  if (!claimed) {
    return 0;
  }

  const amount = money(
    occurrenceData.expectedAmount
  );

  let title;
  let body;

  if (offset === -1) {
    title =
      "BillTrack · Payment overdue";

    body =
      `${obligationData.title}` +
      `${amount ? ` · ${amount}` : ""}` +
      ` was due ${occurrenceData.dueDate}.`;
  } else if (offset === 0) {
    title =
      "BillTrack · Payment due today";

    body =
      `${obligationData.title}` +
      `${amount ? ` · ${amount}` : ""}` +
      " is due today.";
  } else {
    title =
      "BillTrack · Payment reminder";

    body =
      `${obligationData.title}` +
      `${amount ? ` · ${amount}` : ""}` +
      ` is due in ${offset} day${
        offset === 1 ? "" : "s"
      }.`;
  }

  try {
    const response =
      await messaging.sendEachForMulticast({
        tokens: recipients.map(
          (recipient) =>
            recipient.token
        ),

        notification: {
          title,
          body,
        },

        data: {
          title,
          body,
          tag: key,
          url: "/",
          profileId:
            profile.id,
          obligationId:
            obligation.id,
          occurrenceId:
            occurrence.id,
        },

        webpush: {
          fcmOptions: {
            link: "https://billtrack.casa/",
          },

          notification: {
            icon: "https://billtrack.casa/icons/icon-192.png",
            badge:
              "https://billtrack.casa/icons/icon-192.png",
            tag: key,
          },
        },
      });

    await cleanInvalidTokens(
      response,
      recipients
    );

    return response.successCount;
  } catch (error) {
    logger.error(
      "Failed to send BillTrack reminder",
      {
        profileId:
          profile.id,
        obligationId:
          obligation.id,
        occurrenceId:
          occurrence.id,
        error,
      }
    );

    throw error;
  }
}

/*
 * -------------------------------------------------------
 * Scheduled reminder engine
 *
 * Runs every day at 9:00 AM Toronto time.
 *
 * For each unpaid occurrence:
 *   reminderDays: 10, 7, 3, 0
 *
 * It also checks yesterday (-1) so an
 * unpaid payment gets one overdue alert.
 * -------------------------------------------------------
 */

exports.sendBillTrackReminders =
  onSchedule(
    {
      schedule: "0 9 * * *",
      timeZone:
        "America/Toronto",
      retryCount: 1,
      memory: "256MiB",
      timeoutSeconds: 300,
    },

    async () => {
      const db = getDb();

      const today =
        torontoToday();

      logger.info(
        "Starting BillTrack reminder scan",
        { today }
      );

      const profiles =
        await db
          .collection("profiles")
          .get();

      let sent = 0;
      let checkedProfiles = 0;
      let checkedObligations = 0;

      for (const profile of profiles.docs) {
        checkedProfiles += 1;

        const obligations =
          await profile.ref
            .collection(
              "obligations"
            )
            .get();

        for (
          const obligation of
          obligations.docs
        ) {
          checkedObligations += 1;

          const data =
            obligation.data();

          const reminderDays =
            Array.isArray(
              data.reminderDays
            )
              ? data.reminderDays
                  .map(Number)
                  .filter(
                    (value) =>
                      Number.isFinite(
                        value
                      ) &&
                      value >= 0
                  )
              : [];

          /*
           * Add -1 for the one-day-overdue
           * notification.
           */
          const offsets = [
            ...new Set([
              ...reminderDays,
              -1,
            ]),
          ];

          for (
            const offset of offsets
          ) {
            /*
             * Example:
             *
             * today Sep 20 + 10
             * = payment due Sep 30
             *
             * today Sep 30 + 0
             * = payment due today
             *
             * today Oct 1 + (-1)
             * = payment due yesterday
             */
            const dueDate =
              addDays(
                today,
                offset
              );

            /*
             * Current occurrence IDs:
             *
             * monthly -> YYYY-MM
             * one-time -> YYYY-MM-DD
             */
            const occurrenceId =
              data.recurrence ===
              "one-time"
                ? dueDate
                : dueDate.slice(
                    0,
                    7
                  );

            const occurrence =
              await obligation.ref
                .collection(
                  "occurrences"
                )
                .doc(
                  occurrenceId
                )
                .get();

            if (
              !occurrence.exists
            ) {
              continue;
            }

            const occurrenceData =
              occurrence.data();

            if (
              occurrenceData.paid
            ) {
              continue;
            }

            if (
              occurrenceData.dueDate !==
              dueDate
            ) {
              continue;
            }

            sent +=
              await sendReminder({
                profile,
                obligation,
                occurrence,
                kind:
                  offset === -1
                    ? "overdue-1"
                    : `due-${offset}`,
                offset,
              });
          }
        }
      }

      logger.info(
        "BillTrack reminder scan complete",
        {
          today,
          checkedProfiles,
          checkedObligations,
          sent,
        }
      );

      return null;
    }
  );

/*
 * -------------------------------------------------------
 * Test notification
 *
 * Called directly from BillTrack after the
 * user enables notifications.
 * -------------------------------------------------------
 */

exports.sendTestNotification =
  onCall(
    {
      region:
        "northamerica-northeast1",
      memory: "256MiB",
      timeoutSeconds: 60,
    },

    async (request) => {
      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "Sign in first."
        );
      }

      const recipients =
        await tokensForUsers([
          request.auth.uid,
        ]);

      if (!recipients.length) {
        throw new HttpsError(
          "failed-precondition",
          "No notification-enabled device is registered."
        );
      }

      const title =
        "BillTrack notifications are on";

      const body =
        "You will receive reminders for the payment days you selected.";

      const messaging =
        getMessaging();

      const response =
        await messaging.sendEachForMulticast({
          tokens:
            recipients.map(
              (recipient) =>
                recipient.token
            ),

          notification: {
            title,
            body,
          },

          data: {
            title,
            body,
            tag: `billtrack-test-${Date.now()}`,
            url: "/",
          },

          webpush: {
            fcmOptions: {
              link: "https://billtrack.casa/",
            },

            notification: {
              icon: "https://billtrack.casa/icons/icon-192.png",
              badge:
                "https://billtrack.casa/icons/icon-192.png",
            },
          },
        });

      await cleanInvalidTokens(
        response,
        recipients
      );

      logger.info(
        "BillTrack test notification sent",
        {
          uid:
            request.auth.uid,
          successCount:
            response.successCount,
          failureCount:
            response.failureCount,
        }
      );

      return {
        successCount:
          response.successCount,

        failureCount:
          response.failureCount,
      };
    }
  );