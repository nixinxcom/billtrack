"use client";

import Link from "next/link";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { loginWithGoogle, logout, watchAuth } from "@/lib/auth";
import {
  enablePushNotifications,
  listenForForegroundMessages,
  notificationStatus,
  refreshPushRegistration,
  sendTestPush,
  type NotificationStatus,
} from "@/lib/notifications";
import {
  addCategory,
  createObligation,
  createProfile,
  deleteProfileWithCommitments,
  ensureOccurrences,
  markOccurrencePaid,
  markOccurrenceUnpaid,
  migrateLocalData,
  removeObligation,
  updateObligation,
  watchCategories,
  watchObligations,
  watchOccurrences,
  watchProfiles,
  type Category,
  type Obligation,
  type Occurrence,
  type Profile,
  type Recurrence,
} from "@/lib/firestore";

const todayIso = () => {
  const d = new Date();

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
};

const parseDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

const daysBetween = (a: string, b: string) =>
  Math.round(
    (parseDate(b).getTime() - parseDate(a).getTime()) / 86400000
  );

const formatDate = (s: string) =>
  parseDate(s).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const money = (n?: number) =>
  n == null
    ? "—"
    : `$${n.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

function occurrenceState(o: Occurrence) {
  const today = todayIso();

  if (o.paid && o.paidDate) {
    const delta = daysBetween(o.dueDate, o.paidDate);

    if (delta < 0) {
      return {
        label: `Paid ${Math.abs(delta)}d early`,
        cls: "safe",
      };
    }

    if (delta === 0) {
      return {
        label: "Paid on due date",
        cls: "safe",
      };
    }

    return {
      label: `Paid ${delta}d late`,
      cls: "danger",
    };
  }

  const delta = daysBetween(today, o.dueDate);

  if (delta < 0) {
    return {
      label: `Overdue ${Math.abs(delta)}d`,
      cls: "danger",
    };
  }

  if (delta === 0) {
    return {
      label: "Due today",
      cls: "danger",
    };
  }

  if (delta <= 3) {
    return {
      label: `In ${delta} days`,
      cls: "danger",
    };
  }

  if (delta <= 7) {
    return {
      label: `In ${delta} days`,
      cls: "warn",
    };
  }

  return {
    label: `In ${delta} days`,
    cls: "safe",
  };
}

function iconFor(type: string) {
  const t = type.toLowerCase();

  if (t.includes("card")) return "▣";

  if (t.includes("mortgage") || t.includes("rent")) return "⌂";

  if (t.includes("auto") || t.includes("car")) return "◇";

  if (t.includes("utility")) return "ϟ";

  if (t.includes("subscription")) return "↻";

  return "•";
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [authError, setAuthError] = useState("");
  const [dataError, setDataError] = useState("");

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<string | null>(null);

  const [items, setItems] = useState<Obligation[]>([]);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);

  const [modal, setModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);

  const [editingItem, setEditingItem] =
    useState<Obligation | null>(null);

  const [paymentOccurrence, setPaymentOccurrence] =
    useState<Occurrence | null>(null);

  const [profileToDelete, setProfileToDelete] =
    useState<Profile | null>(null);

  const [saving, setSaving] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);

  const [recurrence, setRecurrence] =
    useState<Recurrence>("monthly");

  const [pushStatus, setPushStatus] =
    useState<NotificationStatus>("prompt");
  const [enablingPush, setEnablingPush] = useState(false);

  const [badgeHorizonDays, setBadgeHorizonDays] =
    useState(7);

    useEffect(() => {
      if (!user) {
        return;
      }

      const uid = user.uid;

      async function loadUserPreferences() {
        try {
          const snapshot =
            await getDoc(
              doc(db, "users", uid)
            );

          const data = snapshot.data();

          const configuredDays =
            data?.badgeHorizonDays;

          if (
            Number.isInteger(configuredDays) &&
            configuredDays >= 0 &&
            configuredDays <= 365
          ) {
            setBadgeHorizonDays(
              configuredDays
            );
          }

          const savedProfileId =
            data?.activeProfileId;

          if (
            typeof savedProfileId === "string" &&
            savedProfileId
          ) {
            setProfile(savedProfileId);
          }
        } catch (error) {
          console.error(
            "Could not load user preferences:",
            error
          );
        }
      }

      loadUserPreferences();
    }, [user]);

  useEffect(
    () =>
      watchAuth((u) => {
        setUser(u);
        setAuthReady(true);
      }),
    []
  );

  useEffect(() => {
    setPushStatus(notificationStatus());
    let unsubscribe = () => {};
    listenForForegroundMessages()
      .then((unsub) => { unsubscribe = unsub; })
      .catch(console.error);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    refreshPushRegistration(user.uid).then(() => {
      setPushStatus(notificationStatus());
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setProfiles([]);
      setProfile(null);
      return;
    }

    let unsub = () => {};

    migrateLocalData(user.uid)
      .catch(console.error)
      .finally(() => {
        unsub = watchProfiles(user.uid, (p) => {
          setProfiles(p);

          setProfile((cur) => {
            if (p.some((x) => x.id === cur)) {
              return cur;
            }

            return p[0]?.id ?? null;
          });
        });
      });

    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!profile) {
      setItems([]);
      return;
    }

    return watchObligations(profile, setItems);
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setCategories([]);
      return;
    }

    return watchCategories(profile, setCategories);
  }, [profile]);

  useEffect(() => {
    if (!profile || !items.length) {
      setOccurrences([]);
      return;
    }

    items.forEach((item) =>
      ensureOccurrences(profile, item).catch(console.error)
    );

    return watchOccurrences(
      profile,
      items.map((x) => x.id),
      setOccurrences
    );
  }, [profile, items]);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      return;
    }

    const badgeNavigator = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };

    const today = todayIso();

    const horizonDate = new Date(
      `${today}T12:00:00`
    );

    horizonDate.setDate(
      horizonDate.getDate() +
        badgeHorizonDays
    );

    const horizon =
      `${horizonDate.getFullYear()}-` +
      `${String(
        horizonDate.getMonth() + 1
      ).padStart(2, "0")}-` +
      `${String(
        horizonDate.getDate()
      ).padStart(2, "0")}`;

    const badgeCount =
      occurrences.filter(
        (o) =>
          !o.paid &&
          o.dueDate <= horizon
      ).length;

    if (
      badgeCount > 0 &&
      badgeNavigator.setAppBadge
    ) {
      badgeNavigator
        .setAppBadge(badgeCount)
        .catch(console.error);
    } else if (
      badgeCount === 0 &&
      badgeNavigator.clearAppBadge
    ) {
      badgeNavigator
        .clearAppBadge()
        .catch(console.error);
    }
  }, [
    occurrences,
    badgeHorizonDays,
  ]);

  const activeProfile =
    profiles.find((p) => p.id === profile) ?? null;

  const byObligation = useMemo(() => {
    const map = new Map<string, Occurrence[]>();

    occurrences.forEach((o) => {
      const arr = map.get(o.obligationId) ?? [];
      arr.push(o);
      map.set(o.obligationId, arr);
    });

    map.forEach((arr) =>
      arr.sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate)
      )
    );

    return map;
  }, [occurrences]);

  const currentOccurrence = (item: Obligation) => {
    const arr = byObligation.get(item.id) ?? [];

    return (
      arr.find(
        (o) =>
          !o.paid &&
          o.dueDate < todayIso()
      ) ??
      arr.find(
        (o) =>
          !o.paid &&
          o.dueDate >= todayIso()
      ) ??
      arr[arr.length - 1]
    );
  };

  const visible = useMemo(
    () =>
      [...items].sort((a, b) =>
        (
          currentOccurrence(a)?.dueDate ?? "9999"
        ).localeCompare(
          currentOccurrence(b)?.dueDate ?? "9999"
        )
      ),
    [items, occurrences]
  );

  const currentMonth = todayIso().slice(0, 7);

  const monthOccurrences = occurrences.filter((o) =>
    o.dueDate.startsWith(currentMonth)
  );

  const monthScheduled = monthOccurrences.reduce(
    (s, o) => s + (o.expectedAmount ?? 0),
    0
  );

  const monthPaid = monthOccurrences
    .filter((o) => o.paid)
    .reduce(
      (s, o) =>
        s +
        (o.paidAmount ??
          o.expectedAmount ??
          0),
      0
    );

  const monthOverdue = monthOccurrences
    .filter(
      (o) =>
        !o.paid &&
        o.dueDate < todayIso()
    )
    .reduce(
      (s, o) =>
        s + (o.expectedAmount ?? 0),
      0
    );

  const rollingMonths = useMemo(() => {
    const now = new Date();

    return Array.from(
      { length: 12 },
      (_, i) => {
        const d = new Date(
          now.getFullYear(),
          now.getMonth() + i,
          1
        );

        const key = `${d.getFullYear()}-${String(
          d.getMonth() + 1
        ).padStart(2, "0")}`;

        const monthItems =
          occurrences.filter((o) =>
            o.dueDate.startsWith(key)
          );

        return {
          key,
          month: d.toLocaleDateString(
            "en-CA",
            {
              month: "short",
            }
          ),
          year: d.getFullYear(),

          total: monthItems.reduce(
            (sum, o) =>
              sum +
              (o.expectedAmount ?? 0),
            0
          ),

          pending: monthItems
            .filter((o) => !o.paid)
            .reduce(
              (sum, o) =>
                sum +
                (o.expectedAmount ?? 0),
              0
            ),
        };
      }
    );
  }, [occurrences]);

  const pastDueMonths = useMemo(() => {
    const totals =
      new Map<string, number>();

    occurrences
      .filter(
        (o) =>
          !o.paid &&
          o.dueDate.slice(0, 7) <
            currentMonth
      )
      .forEach((o) => {
        const key =
          o.dueDate.slice(0, 7);

        totals.set(
          key,
          (totals.get(key) ?? 0) +
            (o.expectedAmount ?? 0)
        );
      });

    return [...totals.entries()]
      .sort(([a], [b]) =>
        a.localeCompare(b)
      )
      .map(([key, total]) => {
        const [year, month] = key
          .split("-")
          .map(Number);

        const d = new Date(
          year,
          month - 1,
          1
        );

        return {
          key,
          total,
          month: d.toLocaleDateString(
            "en-CA",
            {
              month: "short",
            }
          ),
          year,
        };
      });
  }, [occurrences, currentMonth]);

  async function handleLogin() {
    try {
      setAuthError("");
      await loginWithGoogle();
    } catch (e) {
      console.error(e);

      setAuthError(
        "Google sign-in could not be completed. Please try again."
      );
    }
  }

  async function handleEnableNotifications() {
    if (!user) return;
    try {
      setEnablingPush(true);
      setDataError("");
      await enablePushNotifications(user.uid);
      setPushStatus("enabled");
      await sendTestPush();
    } catch (error) {
      console.error(error);
      setPushStatus(notificationStatus());
      setDataError(
        error instanceof Error
          ? error.message
          : "BillTrack could not enable notifications."
      );
    } finally {
      setEnablingPush(false);
    }
  }

  async function handleLogout() {
    await logout();
    setProfile(null);
  }

  function openCommitmentModal() {
    if (!activeProfile) {
      setProfileModal(true);
      return;
    }

    setEditingItem(null);
    setRecurrence("monthly");
    setModal(true);
  }

  function openEdit(item: Obligation) {
    setEditingItem(item);

    setRecurrence(
      item.recurrence ?? "monthly"
    );

    setModal(true);
  }

  function closeCommitment() {
    setModal(false);
    setEditingItem(null);
  }

  async function saveItem(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!activeProfile) return;

    const f =
      new FormData(e.currentTarget);

    const rec = String(
      f.get("recurrence")
    ) as Recurrence;

    const dueDate =
      String(f.get("dueDate") || "") ||
      undefined;

    const startDate =
      rec === "one-time"
        ? dueDate ?? todayIso()
        : String(
            f.get("startDate") ||
              todayIso()
          );

    const data: Omit<
      Obligation,
      "id" | "profileId"
    > = {
      title: String(
        f.get("title")
      ).trim(),

      type: String(f.get("type")),

      recurrence: rec,

      startDate,

      dueDay:
        rec === "monthly"
          ? Number(f.get("dueDay"))
          : undefined,

      dueDate:
        rec === "one-time"
          ? dueDate
          : undefined,

      endDate:
        rec === "monthly"
          ? String(
              f.get("endDate") || ""
            ) || undefined
          : undefined,

      statementDay: f.get(
        "statementDay"
      )
        ? Number(
            f.get("statementDay")
          )
        : undefined,

      amount: f.get("amount")
        ? Number(f.get("amount"))
        : undefined,

      note:
        String(
          f.get("note") || ""
        ).trim() || undefined,

      reminderDays: f
        .getAll("reminderDays")
        .map(Number)
        .sort((a, b) => b - a),
    };

    try {
      setSaving(true);
      setDataError("");

      if (editingItem) {
        await updateObligation(
          activeProfile.id,
          editingItem.id,
          data
        );
      } else {
        await createObligation(
          activeProfile.id,
          data
        );
      }

      closeCommitment();
    } catch (e) {
      console.error(e);

      setDataError(
        "BillTrack could not save this commitment."
      );
    } finally {
      setSaving(false);
    }
  }

  async function addProfile(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!user) return;

    const name = String(
      new FormData(
        e.currentTarget
      ).get("name") || ""
    ).trim();

    if (!name) return;

    try {
      setSaving(true);

      const id =
        await createProfile(
          user.uid,
          name
        );

      setProfile(id);

      await setDoc(
        doc(db, "users", user.uid),
        {
          activeProfileId: id,
        },
        {
          merge: true,
        }
      );

      setProfileModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function addNewCategory(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (!activeProfile) return;

    const name = String(
      new FormData(
        e.currentTarget
      ).get("name") || ""
    ).trim();

    if (!name) return;

    await addCategory(
      activeProfile.id,
      name
    );

    setCategoryModal(false);
  }

  async function deleteItem(
    item: Obligation
  ) {
    if (!activeProfile) return;

    if (
      !confirm(
        `Delete ${item.title} and its payment history?`
      )
    )
      return;

    await removeObligation(
      activeProfile.id,
      item.id
    );
  }

  async function handleDeleteProfile() {
    if (!profileToDelete) return;

    try {
      setDeletingProfile(true);

      await deleteProfileWithCommitments(
        profileToDelete.id
      );

      setProfileToDelete(null);
    } catch (e) {
      console.error(e);

      setDataError(
        "BillTrack could not delete this profile."
      );
    } finally {
      setDeletingProfile(false);
    }
  }

  async function savePayment(
    e: FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();

    if (
      !activeProfile ||
      !paymentOccurrence
    )
      return;

    const f =
      new FormData(e.currentTarget);

    try {
      setSaving(true);

      await markOccurrencePaid(
        activeProfile.id,
        paymentOccurrence,
        String(f.get("paidDate")),
        f.get("paidAmount")
          ? Number(
              f.get("paidAmount")
            )
          : undefined
      );

      setPaymentOccurrence(null);
    } finally {
      setSaving(false);
    }
  }

  async function undoPayment(
    o: Occurrence
  ) {
    if (!activeProfile) return;

    await markOccurrenceUnpaid(
      activeProfile.id,
      o
    );
  }

  if (!authReady) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brandmark">
              ✓
            </div>

            <div>
              <h1>BillTrack</h1>
              <span>
                Stay ahead of what&apos;s
                due.
              </span>
            </div>
          </div>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">
              BILLTRACK
            </p>

            <h2>
              Loading your
              <br />
              payment calendar.
            </h2>
          </div>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brandmark">
              ✓
            </div>

            <div>
              <h1>BillTrack</h1>
              <span>
                Stay ahead of what&apos;s
                due.
              </span>
            </div>
          </div>
        </header>

        <section className="hero">
          <div>
            <p className="eyebrow">
              YOUR PAYMENT CALENDAR
            </p>

            <h2>
              Nothing important
              <br />
              should surprise you.
            </h2>

            <p className="subtitle">
              Track recurring and
              one-time commitments,
              actual payments and due
              dates — without connecting
              a bank account.
            </p>

            <button
              className="primary"
              onClick={handleLogin}
            >
              Sign in with Google
            </button>

            {authError && (
              <p>{authError}</p>
            )}
          </div>

          <div className="hero-card">
            <span>YOUR DATA</span>

            <strong>✓</strong>

            <p>
              Sign in to access BillTrack
              securely.
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandmark">
            ✓
          </div>

          <div>
            <h1>BillTrack</h1>
            <span>
              Stay ahead of what&apos;s
              due.
            </span>
          </div>
        </div>

        <div className="account-actions">
          <button
            className="ghost"
            onClick={() =>
              setProfileModal(true)
            }
          >
            ＋ Profile
          </button>

          <button
            className={`ghost notification-button ${pushStatus === "enabled" ? "notification-enabled" : ""}`}
            onClick={handleEnableNotifications}
            disabled={enablingPush || pushStatus === "unsupported"}
            title={
              pushStatus === "enabled"
                ? "Payment notifications are enabled"
                : pushStatus === "denied"
                ? "Notifications are blocked in browser settings"
                : "Enable payment notifications"
            }
          >
            {pushStatus === "enabled" ? "🔔 Notifications on" : enablingPush ? "Enabling…" : "🔔 Enable notifications"}
          </button>

          <label
            title="Payments due within this many days are included in the app badge"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>Badge</span>

            <input
              type="number"
              min="0"
              max="365"
              value={badgeHorizonDays}
              onChange={(e) => {
                const value = Math.max(
                  0,
                  Math.min(
                    365,
                    Number(e.target.value) || 0
                  )
                );

                setBadgeHorizonDays(value);

                if (user) {
                  setDoc(
                    doc(db, "users", user.uid),
                    {
                      badgeHorizonDays: value,
                    },
                    {
                      merge: true,
                    }
                  ).catch(console.error);
                }
              }}
              aria-label="Badge planning window in days"
              style={{
                width: "58px",
              }}
            />

            <span>days</span>
          </label>

          <Link className="ghost nav-link" href="/expenses">
            Expenses
          </Link>

          <Link className="ghost nav-link" href="/planning">
            Planning
          </Link>

          <button
            className="ghost"
            onClick={handleLogout}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Keep the large introduction only when there is no active profile */}
      {!activeProfile && (
        <section className="hero">
          <div>
            <p className="eyebrow">
              YOUR PAYMENT CALENDAR
            </p>

            <h2>
              Nothing important
              <br />
              should surprise you.
            </h2>

            <p className="subtitle">
              Create your first profile
              to start tracking
              commitments.
            </p>
          </div>

          <div className="hero-card">
            <span>GET STARTED</span>

            <strong>+</strong>

            <p>
              Create a profile before
              adding commitments.
            </p>

            <button
              onClick={() =>
                setProfileModal(true)
              }
            >
              ＋ Add profile
            </button>
          </div>
        </section>
      )}

      <section className="content">
        {dataError && (
          <div className="data-error">
            {dataError}
          </div>
        )}

        {/* Compact dashboard header when a profile is active */}
        <div
          className={
            activeProfile
              ? "profile-dashboard-head"
              : ""
          }
        >
          <div className="profile-dashboard-main">
            <div className="section-head">
              <div>
                <p className="eyebrow">
                  PROFILES
                </p>

                <h3>
                  Whose commitments are
                  you managing?
                </h3>
              </div>
            </div>

            <div className="profiles">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`profile profile-card ${
                    profile === p.id
                      ? "active"
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    className="profile-select"
                    onClick={() => {
                      setProfile(p.id);

                      setDoc(
                        doc(db, "users", user.uid),
                        {
                          activeProfileId: p.id,
                        },
                        {
                          merge: true,
                        }
                      ).catch(console.error);
                    }}
                  >
                    <span>
                      {p.initials}
                    </span>

                    <b>{p.name}</b>

                    <small>
                      {profile === p.id
                        ? `${items.length} commitments`
                        : "Open profile"}
                    </small>
                  </button>

                  {p.ownerUid ===
                    user.uid && (
                    <button
                      type="button"
                      className="profile-menu"
                      title={`Delete ${p.name}`}
                      aria-label={`Delete ${p.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setProfileToDelete(
                          p
                        );
                      }}
                    >
                      ⋯
                    </button>
                  )}
                </div>
              ))}

              <button
                className="profile add-profile"
                onClick={() =>
                  setProfileModal(true)
                }
              >
                <span>＋</span>
                <b>Add profile</b>
                <small>
                  Add another person
                </small>
              </button>
            </div>
          </div>

          {activeProfile && (
            <aside className="profile-month-card">
              <p className="eyebrow">
                {activeProfile.name.toUpperCase()}{" "}
                · THIS MONTH
              </p>

              <strong>
                {money(monthScheduled)}
              </strong>

              <p>
                {money(monthPaid)} paid ·{" "}
                {money(monthOverdue)}{" "}
                overdue
              </p>

              <button
                className="primary full"
                onClick={
                  openCommitmentModal
                }
              >
                ＋ Add commitment
              </button>
            </aside>
          )}
        </div>

        {activeProfile && (
          <>
            <div className="summary-grid">
              <div>
                <small>
                  SCHEDULED THIS MONTH
                </small>

                <strong>
                  {money(
                    monthScheduled
                  )}
                </strong>
              </div>

              <div>
                <small>
                  ACTUALLY PAID
                </small>

                <strong>
                  {money(monthPaid)}
                </strong>
              </div>

              <div>
                <small>OVERDUE</small>

                <strong>
                  {money(monthOverdue)}
                </strong>
              </div>

              <div>
                <small>
                  PAID CYCLES
                </small>

                <strong>
                  {
                    monthOccurrences.filter(
                      (o) => o.paid
                    ).length
                  }
                  /
                  {
                    monthOccurrences.length
                  }
                </strong>
              </div>
            </div>

            <div className="annual-summary">
              <div className="annual-summary-head">
                <div>
                  <p className="eyebrow">
                    12-MONTH COMMITMENTS
                  </p>

                  <h3>
                    Scheduled by month
                  </h3>
                </div>

                <small>
                  Rolling 12 months from
                  the current month
                </small>
              </div>

              <div className="annual-strip">
                {rollingMonths.map(
                  (m) => (
                    <div
                      className="annual-month"
                      key={m.key}
                    >
                      <b>
                        {m.month}
                      </b>

                      <span>
                        {m.year}
                      </span>

                      <strong>
                        {money(m.total)}
                      </strong>

                      <small>
                        {m.pending > 0
                          ? `${money(
                              m.pending
                            )} pending`
                          : "No pending"}
                      </small>
                    </div>
                  )
                )}
              </div>

              {pastDueMonths.length >
                0 && (
                <div className="past-due-summary">
                  <div className="past-due-label">
                    <b>
                      PAST DUE
                    </b>

                    <small>
                      Unpaid commitments
                      from previous months
                    </small>
                  </div>

                  <div className="past-due-strip">
                    {pastDueMonths.map(
                      (m) => (
                        <div
                          className="past-due-month"
                          key={m.key}
                        >
                          <b>
                            {m.month}{" "}
                            {m.year}
                          </b>

                          <strong>
                            {money(
                              m.total
                            )}
                          </strong>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="list-head">
              <div>
                <p className="eyebrow">
                  NEXT UP
                </p>

                <h3>
                  {
                    activeProfile.name
                  }
                  &apos;s commitments
                </h3>
              </div>

              <button
                className="primary"
                onClick={
                  openCommitmentModal
                }
              >
                ＋ Add commitment
              </button>
            </div>

            {visible.length === 0 && (
              <div className="empty">
                No commitments yet. Add
                one when you&apos;re
                ready.
              </div>
            )}

            <div className="bill-list">
              {visible.map((item) => {
                const current =
                  currentOccurrence(
                    item
                  );

                const state = current
                  ? occurrenceState(
                      current
                    )
                  : null;

                const cycles = (
                  byObligation.get(
                    item.id
                  ) ?? []
                ).slice(0, 12);

                return (
                  <article
                    className="bill bill-expanded"
                    key={item.id}
                  >
                    <div className="bill-icon">
                      {iconFor(
                        item.type
                      )}
                    </div>

                    <div className="bill-main">
                      <div className="bill-title">
                        <h4>
                          {item.title}
                        </h4>

                        <span>
                          {item.type}
                        </span>

                        <span>
                          {item.recurrence ===
                          "monthly"
                            ? "Monthly"
                            : "One time"}
                        </span>
                      </div>

                      <p>
                        {
                          activeProfile.name
                        }
                        {item.note
                          ? ` · ${item.note}`
                          : ""}
                      </p>
                    </div>

                    <div className="due">
                      <small>
                        {current?.paid
                          ? "LAST CYCLE"
                          : "DUE"}
                      </small>

                      <strong>
                        {current
                          ? formatDate(
                              current.dueDate
                            )
                          : "—"}
                      </strong>

                      {state && (
                        <span
                          className={
                            state.cls
                          }
                        >
                          {
                            state.label
                          }
                        </span>
                      )}
                    </div>

                    <div className="amount">
                      {money(
                        current?.expectedAmount ??
                          item.amount
                      )}

                      <small>
                        expected
                      </small>
                    </div>

                    <div className="bill-actions">
                      <button
                        className="bill-action"
                        title="Edit"
                        onClick={() =>
                          openEdit(item)
                        }
                      >
                        ✎
                      </button>

                      <button
                        className="bill-action delete-action"
                        title="Delete"
                        onClick={() =>
                          deleteItem(
                            item
                          )
                        }
                      >
                        ×
                      </button>
                    </div>

                    {current &&
                      !current.paid && (
                        <button
                          className="paid-button"
                          onClick={() =>
                            setPaymentOccurrence(
                              current
                            )
                          }
                        >
                          ✓ Mark paid
                        </button>
                      )}

                    <div className="cycle-strip">
                      {cycles.map(
                        (o) => {
                          const st =
                            occurrenceState(
                              o
                            );

                          return (
                            <button
                              key={
                                o.id
                              }
                              className={`cycle ${
                                o.paid
                                  ? "cycle-paid"
                                  : ""
                              }`}
                              title={`${formatDate(
                                o.dueDate
                              )} · ${
                                st.label
                              }`}
                              onClick={() =>
                                o.paid
                                  ? undoPayment(
                                      o
                                    )
                                  : setPaymentOccurrence(
                                      o
                                    )
                              }
                            >
                              <b>
                                {parseDate(
                                  o.dueDate
                                ).toLocaleDateString(
                                  "en-CA",
                                  {
                                    month:
                                      "short",
                                  }
                                )}
                              </b>

                              <span
                                className={
                                  st.cls
                                }
                              >
                                {o.paid
                                  ? "✓"
                                  : o.dueDate <
                                    todayIso()
                                  ? "!"
                                  : "○"}
                              </span>

                              <small>
                                {o.paid &&
                                o.paidAmount !=
                                  null
                                  ? money(
                                      o.paidAmount
                                    )
                                  : money(
                                      o.expectedAmount
                                    )}
                              </small>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <p className="privacy">
              ● Synced with Firestore ·
              Payment history stays with
              each cycle · No bank
              connection
            </p>
          </>
        )}
      </section>

      {modal && activeProfile && (
        <div
          className="backdrop"
          onMouseDown={
            closeCommitment
          }
        >
          <div
            className="modal"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <button
              className="close"
              onClick={
                closeCommitment
              }
            >
              ×
            </button>

            <p className="eyebrow">
              {editingItem
                ? "EDIT COMMITMENT"
                : "NEW COMMITMENT"}{" "}
              ·{" "}
              {activeProfile.name.toUpperCase()}
            </p>

            <h3>
              {editingItem
                ? "Edit commitment"
                : "Add a commitment"}
            </h3>

            <form
              key={
                editingItem?.id ??
                "new"
              }
              onSubmit={saveItem}
            >
              <label>
                Name
                <input
                  name="title"
                  defaultValue={
                    editingItem?.title ??
                    ""
                  }
                  placeholder="e.g. Ford F-150 Lease"
                  required
                />
              </label>

              <div className="grid2">
                <label>
                  Category
                  <select
                    name="type"
                    defaultValue={
                      editingItem?.type ??
                      categories[0]
                        ?.name ??
                      "Other"
                    }
                  >
                    {categories.map(
                      (c) => (
                        <option
                          key={
                            c.id
                          }
                        >
                          {
                            c.name
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>

                <label>
                  Recurrence
                  <select
                    name="recurrence"
                    value={
                      recurrence
                    }
                    onChange={(e) =>
                      setRecurrence(
                        e.target
                          .value as Recurrence
                      )
                    }
                  >
                    <option value="monthly">
                      Monthly
                    </option>

                    <option value="one-time">
                      One time
                    </option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setCategoryModal(
                    true
                  )
                }
              >
                ＋ Add category
              </button>

              {recurrence ===
              "monthly" ? (
                <>
                  <div className="grid2">
                    <label>
                      Due day
                      <input
                        name="dueDay"
                        type="number"
                        min="1"
                        max="31"
                        defaultValue={
                          editingItem?.dueDay ??
                          1
                        }
                        required
                      />
                    </label>

                    <label>
                      Statement day
                      (optional)
                      <input
                        name="statementDay"
                        type="number"
                        min="1"
                        max="31"
                        defaultValue={
                          editingItem?.statementDay ??
                          ""
                        }
                      />
                    </label>
                  </div>

                  <div className="grid2">
                    <label>
                      Starts
                      <input
                        name="startDate"
                        type="date"
                        defaultValue={
                          editingItem?.startDate ??
                          todayIso()
                        }
                        required
                      />
                    </label>

                    <label>
                      Ends (optional)
                      <input
                        name="endDate"
                        type="date"
                        defaultValue={
                          editingItem?.endDate ??
                          ""
                        }
                      />
                    </label>
                  </div>
                </>
              ) : (
                <label>
                  Due date
                  <input
                    name="dueDate"
                    type="date"
                    defaultValue={
                      editingItem?.dueDate ??
                      editingItem?.startDate ??
                      todayIso()
                    }
                    required
                  />
                </label>
              )}

              <label>
                Expected amount
                (optional)
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    editingItem?.amount ??
                    ""
                  }
                  placeholder="685.00"
                />
              </label>

              <label>
                Note (optional)
                <input
                  name="note"
                  defaultValue={
                    editingItem?.note ??
                    ""
                  }
                />
              </label>

              <fieldset className="reminders">
                <legend>
                  Payment reminders
                </legend>

                <p>
                  Choose when BillTrack
                  should notify you
                  before the due date.
                </p>

                <div className="reminder-options">
                  {[10, 7, 3, 0].map(
                    (d) => (
                      <label key={d}>
                        <input
                          type="checkbox"
                          name="reminderDays"
                          value={d}
                          defaultChecked={
                            editingItem
                              ? editingItem.reminderDays?.includes(
                                  d
                                )
                              : true
                          }
                        />

                        {d === 0
                          ? "On due date"
                          : `${d} days before`}
                      </label>
                    )
                  )}
                </div>
              </fieldset>

              <button
                className="primary full"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : editingItem
                  ? "Save changes"
                  : "Save commitment"}
              </button>
            </form>
          </div>
        </div>
      )}

      {paymentOccurrence && (
        <div
          className="backdrop"
          onMouseDown={() =>
            setPaymentOccurrence(
              null
            )
          }
        >
          <div
            className="modal small"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <button
              className="close"
              onClick={() =>
                setPaymentOccurrence(
                  null
                )
              }
            >
              ×
            </button>

            <p className="eyebrow">
              RECORD PAYMENT
            </p>

            <h3>
              Mark cycle as paid
            </h3>

            <p className="payment-context">
              Due{" "}
              {formatDate(
                paymentOccurrence.dueDate
              )}{" "}
              · Expected{" "}
              {money(
                paymentOccurrence.expectedAmount
              )}
            </p>

            <form
              onSubmit={
                savePayment
              }
            >
              <label>
                Actual amount paid
                <input
                  name="paidAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={
                    paymentOccurrence.expectedAmount ??
                    ""
                  }
                />
              </label>

              <label>
                Actual payment date
                <input
                  name="paidDate"
                  type="date"
                  defaultValue={
                    todayIso()
                  }
                  required
                />
              </label>

              <button
                className="primary full"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : "✓ Mark paid"}
              </button>
            </form>
          </div>
        </div>
      )}

      {categoryModal &&
        activeProfile && (
          <div
            className="backdrop"
            onMouseDown={() =>
              setCategoryModal(
                false
              )
            }
          >
            <div
              className="modal small"
              onMouseDown={(e) =>
                e.stopPropagation()
              }
            >
              <button
                className="close"
                onClick={() =>
                  setCategoryModal(
                    false
                  )
                }
              >
                ×
              </button>

              <p className="eyebrow">
                CATEGORY CATALOG
              </p>

              <h3>
                Add a category
              </h3>

              <form
                onSubmit={
                  addNewCategory
                }
              >
                <label>
                  Category name
                  <input
                    name="name"
                    placeholder="e.g. Condo Fee"
                    autoFocus
                    required
                  />
                </label>

                <button className="primary full">
                  Add category
                </button>
              </form>
            </div>
          </div>
        )}

      {profileModal && (
        <div
          className="backdrop"
          onMouseDown={() =>
            setProfileModal(false)
          }
        >
          <div
            className="modal small"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <button
              className="close"
              onClick={() =>
                setProfileModal(
                  false
                )
              }
            >
              ×
            </button>

            <p className="eyebrow">
              NEW PROFILE
            </p>

            <h3>
              Whose commitments will
              this profile track?
            </h3>

            <form
              onSubmit={
                addProfile
              }
            >
              <label>
                Name
                <input
                  name="name"
                  placeholder="e.g. Alain"
                  autoFocus
                  required
                />
              </label>

              <button
                className="primary full"
                disabled={saving}
              >
                {saving
                  ? "Saving..."
                  : "Add profile"}
              </button>
            </form>
          </div>
        </div>
      )}

      {profileToDelete && (
        <div
          className="backdrop"
          onMouseDown={() =>
            !deletingProfile &&
            setProfileToDelete(null)
          }
        >
          <div
            className="modal small"
            onMouseDown={(e) =>
              e.stopPropagation()
            }
          >
            <button
              className="close"
              disabled={
                deletingProfile
              }
              onClick={() =>
                setProfileToDelete(
                  null
                )
              }
            >
              ×
            </button>

            <p className="eyebrow">
              DELETE PROFILE
            </p>

            <h3>
              Delete{" "}
              {
                profileToDelete.name
              }
              ?
            </h3>

            <p className="delete-warning">
              This permanently deletes
              the profile, commitments
              and payment history.
            </p>

            <div className="delete-actions">
              <button
                className="ghost"
                disabled={
                  deletingProfile
                }
                onClick={() =>
                  setProfileToDelete(
                    null
                  )
                }
              >
                Cancel
              </button>

              <button
                className="danger-button"
                disabled={
                  deletingProfile
                }
                onClick={
                  handleDeleteProfile
                }
              >
                {deletingProfile
                  ? "Deleting..."
                  : "Delete profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}