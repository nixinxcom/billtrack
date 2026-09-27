"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { loginWithGoogle, logout, watchAuth } from "@/lib/auth";

type Profile = { id: string; name: string; initials: string };
type ItemType = "Credit Card" | "Insurance" | "Rent" | "Utility" | "Subscription" | "Other";
type Obligation = {
  id: string;
  profileId: string;
  title: string;
  type: ItemType;
  dueDay: number;
  statementDay?: number;
  amount?: number;
  note?: string;
};

const PROFILE_STORAGE_KEY = "billtrack.v2.profiles";
const ITEM_STORAGE_KEY = "billtrack.v2.items";

function nextDate(day: number) {
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate())
  );
  d.setHours(23, 59, 59, 999);
  if (d < now) d.setMonth(d.getMonth() + 1);
  return d;
}

function daysUntil(day: number) {
  const now = new Date();
  const target = nextDate(day);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((end.getTime() - today.getTime()) / 86400000);
}

function formatDue(day: number) {
  return nextDate(day).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function iconFor(type: ItemType) {
  return ({
    "Credit Card": "▣",
    Insurance: "◇",
    Rent: "⌂",
    Utility: "ϟ",
    Subscription: "↻",
    Other: "•",
  } as Record<ItemType, string>)[type];
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");

  // A new BillTrack account starts empty. Profiles are people whose
  // commitments this signed-in account is allowed to manage.
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [items, setItems] = useState<Obligation[]>([]);
  const [profile, setProfile] = useState<string | null>(null);

  const [modal, setModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsubscribe = watchAuth((firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });
    return unsubscribe;
  }, []);

  // Temporary local persistence. v2 keys intentionally do not import the old
  // demo profiles (Alain / Family / Everyone-era prototype data).
  useEffect(() => {
    try {
      const storedProfiles = localStorage.getItem(PROFILE_STORAGE_KEY);
      const storedItems = localStorage.getItem(ITEM_STORAGE_KEY);
      const parsedProfiles: Profile[] = storedProfiles ? JSON.parse(storedProfiles) : [];
      const parsedItems: Obligation[] = storedItems ? JSON.parse(storedItems) : [];

      setProfiles(parsedProfiles);
      setItems(parsedItems);
      setProfile(parsedProfiles[0]?.id ?? null);
    } catch (error) {
      console.error("Unable to load BillTrack local data:", error);
      setProfiles([]);
      setItems([]);
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles, ready]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(ITEM_STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  // If the selected profile disappears, move to the first available profile.
  useEffect(() => {
    if (!ready) return;
    if (profile && profiles.some((p) => p.id === profile)) return;
    setProfile(profiles[0]?.id ?? null);
  }, [profiles, profile, ready]);

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === profile) ?? null,
    [profiles, profile]
  );

  // There is deliberately no "Everyone" aggregate. Each profile has its own
  // commitments and the dashboard only shows the selected profile.
  const visible = useMemo(() => {
    if (!profile) return [];
    return items
      .filter((item) => item.profileId === profile)
      .sort((a, b) => daysUntil(a.dueDay) - daysUntil(b.dueDay));
  }, [items, profile]);

  const urgent = visible.filter((item) => daysUntil(item.dueDay) <= 7);
  const later = visible.filter((item) => daysUntil(item.dueDay) > 7);

  async function handleLogin() {
    try {
      setAuthError("");
      await loginWithGoogle();
    } catch (error) {
      console.error("Google login failed:", error);
      setAuthError("Google sign-in could not be completed. Please try again.");
    }
  }

  async function handleLogout() {
    try {
      await logout();
      setProfile(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  }

  function openCommitmentModal() {
    if (!activeProfile) {
      setProfileModal(true);
      return;
    }
    setModal(true);
  }

  function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!activeProfile) return;

    const f = new FormData(e.currentTarget);
    const newItem: Obligation = {
      id: crypto.randomUUID(),
      profileId: activeProfile.id,
      title: String(f.get("title")).trim(),
      type: String(f.get("type")) as ItemType,
      dueDay: Number(f.get("dueDay")),
      statementDay: f.get("statementDay") ? Number(f.get("statementDay")) : undefined,
      amount: f.get("amount") ? Number(f.get("amount")) : undefined,
      note: String(f.get("note") || "").trim() || undefined,
    };

    setItems((current) => [...current, newItem]);
    setModal(false);
  }

  function addProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name")).trim();
    if (!name) return;

    const newProfile: Profile = {
      id: crypto.randomUUID(),
      name,
      initials: name[0].toUpperCase(),
    };

    setProfiles((current) => [...current, newProfile]);
    setProfile(newProfile.id);
    setProfileModal(false);
  }

  if (!authReady) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brandmark">✓</div><div><h1>BillTrack</h1><span>Stay ahead of what&apos;s due.</span></div></div>
        </header>
        <section className="hero"><div><p className="eyebrow">BILLTRACK</p><h2>Loading your<br />payment calendar.</h2></div></section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brandmark">✓</div><div><h1>BillTrack</h1><span>Stay ahead of what&apos;s due.</span></div></div>
        </header>
        <section className="hero">
          <div>
            <p className="eyebrow">YOUR PAYMENT CALENDAR</p>
            <h2>Nothing important<br />should surprise you.</h2>
            <p className="subtitle">One quiet place for cards, insurance, rent and recurring bills — without connecting a bank account.</p>
            <button className="primary" onClick={handleLogin}>Sign in with Google</button>
            {authError && <p style={{ marginTop: "16px" }}>{authError}</p>}
          </div>
          <div className="hero-card"><span>YOUR DATA</span><strong>✓</strong><p>Sign in to access BillTrack securely.</p></div>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brandmark">✓</div><div><h1>BillTrack</h1><span>Stay ahead of what&apos;s due.</span></div></div>
        <div className="account-actions">
          <button className="ghost" onClick={() => setProfileModal(true)}>＋ Profile</button>
          <button className="ghost" onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">YOUR PAYMENT CALENDAR</p>
          <h2>Nothing important<br />should surprise you.</h2>
          <p className="subtitle">
            {activeProfile
              ? `Viewing ${activeProfile.name}'s commitments. Each profile keeps its own payment calendar.`
              : "Create your first profile to start tracking that person's commitments."}
          </p>
        </div>
        <div className="hero-card">
          <span>{activeProfile ? `${activeProfile.name.toUpperCase()} · COMING UP` : "GET STARTED"}</span>
          <strong>{activeProfile ? urgent.length : "+"}</strong>
          <p>{activeProfile ? "payments in the next 7 days" : "Create a profile before adding commitments"}</p>
          <button onClick={openCommitmentModal}>{activeProfile ? "＋ Add commitment" : "＋ Add profile"}</button>
        </div>
      </section>

      <section className="content">
        <div className="section-head">
          <div><p className="eyebrow">PROFILES</p><h3>Whose commitments are you managing?</h3></div>
        </div>

        <div className="profiles">
          {profiles.map((p) => (
            <button key={p.id} className={`profile ${profile === p.id ? "active" : ""}`} onClick={() => setProfile(p.id)}>
              <span>{p.initials}</span>
              <b>{p.name}</b>
              <small>{items.filter((item) => item.profileId === p.id).length} commitments</small>
            </button>
          ))}
          <button className="profile add-profile" onClick={() => setProfileModal(true)}>
            <span>＋</span><b>Add profile</b><small>{profiles.length === 0 ? "Create your first profile" : "Add another person"}</small>
          </button>
        </div>

        <div className="list-head">
          <div>
            <p className="eyebrow">NEXT UP</p>
            <h3>{activeProfile ? `${activeProfile.name}'s commitments` : "No profile selected"}</h3>
          </div>
          {activeProfile && <button className="primary" onClick={openCommitmentModal}>＋ Add commitment</button>}
        </div>

        {!activeProfile ? (
          <div className="empty">Create a profile first. Commitments always belong to one specific person.</div>
        ) : visible.length === 0 ? (
          <div className="empty">{activeProfile.name} has no commitments yet. Add one when you&apos;re ready.</div>
        ) : null}

        <div className="bill-list">
          {[...urgent, ...later].map((item) => {
            const d = daysUntil(item.dueDay);
            return (
              <article className="bill" key={item.id}>
                <div className="bill-icon">{iconFor(item.type)}</div>
                <div className="bill-main">
                  <div className="bill-title"><h4>{item.title}</h4><span>{item.type}</span></div>
                  <p>{activeProfile?.name}{item.statementDay ? ` · Statement day ${item.statementDay}` : ""}{item.note ? ` · ${item.note}` : ""}</p>
                </div>
                <div className="due"><small>DUE</small><strong>{formatDue(item.dueDay)}</strong><span className={d <= 3 ? "danger" : d <= 7 ? "warn" : "safe"}>{d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`}</span></div>
                <div className="amount">{item.amount ? `$${item.amount.toLocaleString()}` : "—"}<small>{item.amount ? "expected" : "amount optional"}</small></div>
                <button className="delete" title="Delete" onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))}>×</button>
              </article>
            );
          })}
        </div>

        <p className="privacy">● Signed in securely · Each profile has its own commitments · No bank connection</p>
      </section>

      {modal && activeProfile && (
        <div className="backdrop" onMouseDown={() => setModal(false)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setModal(false)}>×</button>
            <p className="eyebrow">NEW COMMITMENT · {activeProfile.name.toUpperCase()}</p>
            <h3>Add something {activeProfile.name} doesn&apos;t want to forget</h3>
            <form onSubmit={addItem}>
              <label>Name<input name="title" placeholder="e.g. RBC Visa" required /></label>
              <label>Type<select name="type"><option>Credit Card</option><option>Insurance</option><option>Rent</option><option>Utility</option><option>Subscription</option><option>Other</option></select></label>
              <div className="grid2">
                <label>Due day<input name="dueDay" type="number" min="1" max="31" placeholder="28" required /></label>
                <label>Statement day (optional)<input name="statementDay" type="number" min="1" max="31" placeholder="7" /></label>
              </div>
              <label>Amount (optional)<input name="amount" type="number" min="0" step="0.01" placeholder="400" /></label>
              <label>Note (optional)<input name="note" placeholder="Pay total if possible" /></label>
              <button className="primary full">Save commitment</button>
            </form>
          </div>
        </div>
      )}

      {profileModal && (
        <div className="backdrop" onMouseDown={() => setProfileModal(false)}>
          <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
            <button className="close" onClick={() => setProfileModal(false)}>×</button>
            <p className="eyebrow">NEW PROFILE</p>
            <h3>Whose commitments will this profile track?</h3>
            <form onSubmit={addProfile}>
              <label>Name<input name="name" placeholder="e.g. Alain" autoFocus required /></label>
              <button className="primary full">Add profile</button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
