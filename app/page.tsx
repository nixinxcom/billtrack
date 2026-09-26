"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

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

const starterProfiles: Profile[] = [
  { id: "alain", name: "Alain", initials: "A" },
  { id: "family", name: "Family", initials: "F" },
];

const starterItems: Obligation[] = [
  { id: "rbc", profileId: "alain", title: "RBC Visa", type: "Credit Card", dueDay: 28, statementDay: 7, note: "Pay total if possible" },
  { id: "mercedes", profileId: "alain", title: "Mercedes Insurance", type: "Insurance", dueDay: 2, amount: 400 },
  { id: "hydro", profileId: "family", title: "Hydro", type: "Utility", dueDay: 6 },
];

function nextDate(day: number) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));
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
  return ({ "Credit Card": "▣", Insurance: "◇", Rent: "⌂", Utility: "ϟ", Subscription: "↻", Other: "•" } as Record<ItemType, string>)[type];
}

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>(starterProfiles);
  const [items, setItems] = useState<Obligation[]>(starterItems);
  const [profile, setProfile] = useState("all");
  const [modal, setModal] = useState(false);
  const [profileModal, setProfileModal] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const p = localStorage.getItem("billtrack.profiles");
    const i = localStorage.getItem("billtrack.items");
    if (p) setProfiles(JSON.parse(p));
    if (i) setItems(JSON.parse(i));
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem("billtrack.profiles", JSON.stringify(profiles)); }, [profiles, ready]);
  useEffect(() => { if (ready) localStorage.setItem("billtrack.items", JSON.stringify(items)); }, [items, ready]);

  const visible = useMemo(() => items.filter(i => profile === "all" || i.profileId === profile).sort((a,b) => daysUntil(a.dueDay)-daysUntil(b.dueDay)), [items, profile]);
  const urgent = visible.filter(i => daysUntil(i.dueDay) <= 7);
  const later = visible.filter(i => daysUntil(i.dueDay) > 7);

  function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setItems(v => [...v, {
      id: crypto.randomUUID(), profileId: String(f.get("profileId")), title: String(f.get("title")),
      type: String(f.get("type")) as ItemType, dueDay: Number(f.get("dueDay")),
      statementDay: f.get("statementDay") ? Number(f.get("statementDay")) : undefined,
      amount: f.get("amount") ? Number(f.get("amount")) : undefined,
      note: String(f.get("note") || "") || undefined,
    }]);
    setModal(false);
  }

  function addProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget); const name = String(f.get("name")).trim();
    if (!name) return;
    setProfiles(v => [...v, { id: crypto.randomUUID(), name, initials: name[0].toUpperCase() }]);
    setProfileModal(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brandmark">✓</div><div><h1>BillTrack</h1><span>Stay ahead of what&apos;s due.</span></div></div>
        <button className="ghost" onClick={() => setProfileModal(true)}>＋ Profile</button>
      </header>

      <section className="hero">
        <div><p className="eyebrow">YOUR PAYMENT CALENDAR</p><h2>Nothing important<br/>should surprise you.</h2><p className="subtitle">One quiet place for cards, insurance, rent and recurring bills — without connecting a bank account.</p></div>
        <div className="hero-card"><span>COMING UP</span><strong>{urgent.length}</strong><p>payments in the next 7 days</p><button onClick={() => setModal(true)}>＋ Add commitment</button></div>
      </section>

      <section className="content">
        <div className="section-head"><div><p className="eyebrow">PROFILES</p><h3>Who are you tracking?</h3></div></div>
        <div className="profiles">
          <button className={`profile ${profile === "all" ? "active" : ""}`} onClick={() => setProfile("all")}><span>◎</span><b>Everyone</b><small>{items.length} commitments</small></button>
          {profiles.map(p => <button key={p.id} className={`profile ${profile === p.id ? "active" : ""}`} onClick={() => setProfile(p.id)}><span>{p.initials}</span><b>{p.name}</b><small>{items.filter(i => i.profileId === p.id).length} commitments</small></button>)}
          <button className="profile add-profile" onClick={() => setProfileModal(true)}><span>＋</span><b>Add profile</b><small>Keep things organized</small></button>
        </div>

        <div className="list-head"><div><p className="eyebrow">NEXT UP</p><h3>What needs your attention</h3></div><button className="primary" onClick={() => setModal(true)}>＋ Add commitment</button></div>
        {visible.length === 0 && <div className="empty">No commitments here yet. Add one and BillTrack will keep it visible.</div>}
        <div className="bill-list">
          {[...urgent, ...later].map((item, idx) => {
            const d = daysUntil(item.dueDay); const p = profiles.find(x => x.id === item.profileId);
            return <article className="bill" key={item.id}>
              <div className="bill-icon">{iconFor(item.type)}</div>
              <div className="bill-main"><div className="bill-title"><h4>{item.title}</h4><span>{item.type}</span></div><p>{p?.name || "Profile"}{item.statementDay ? ` · Statement day ${item.statementDay}` : ""}{item.note ? ` · ${item.note}` : ""}</p></div>
              <div className="due"><small>DUE</small><strong>{formatDue(item.dueDay)}</strong><span className={d <= 3 ? "danger" : d <= 7 ? "warn" : "safe"}>{d === 0 ? "Today" : d === 1 ? "Tomorrow" : `In ${d} days`}</span></div>
              <div className="amount">{item.amount ? `$${item.amount.toLocaleString()}` : "—"}<small>{item.amount ? "expected" : "amount optional"}</small></div>
              <button className="delete" title="Delete" onClick={() => setItems(v => v.filter(x => x.id !== item.id))}>×</button>
            </article>
          })}
        </div>
        <p className="privacy">● Stored only on this device · No bank connection · No account required</p>
      </section>

      {modal && <div className="backdrop" onMouseDown={() => setModal(false)}><div className="modal" onMouseDown={e => e.stopPropagation()}><button className="close" onClick={() => setModal(false)}>×</button><p className="eyebrow">NEW COMMITMENT</p><h3>Add something you don&apos;t want to forget</h3><form onSubmit={addItem}>
        <label>Name<input name="title" placeholder="e.g. RBC Visa" required /></label>
        <div className="grid2"><label>Profile<select name="profileId">{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Type<select name="type"><option>Credit Card</option><option>Insurance</option><option>Rent</option><option>Utility</option><option>Subscription</option><option>Other</option></select></label></div>
        <div className="grid2"><label>Due day<input name="dueDay" type="number" min="1" max="31" placeholder="28" required /></label><label>Statement day (optional)<input name="statementDay" type="number" min="1" max="31" placeholder="7" /></label></div>
        <label>Amount (optional)<input name="amount" type="number" min="0" step="0.01" placeholder="400" /></label>
        <label>Note (optional)<input name="note" placeholder="Pay total if possible" /></label>
        <button className="primary full">Save commitment</button>
      </form></div></div>}

      {profileModal && <div className="backdrop" onMouseDown={() => setProfileModal(false)}><div className="modal small" onMouseDown={e => e.stopPropagation()}><button className="close" onClick={() => setProfileModal(false)}>×</button><p className="eyebrow">NEW PROFILE</p><h3>Who do you want to track?</h3><form onSubmit={addProfile}><label>Name<input name="name" placeholder="e.g. Sofia" autoFocus required /></label><button className="primary full">Add profile</button></form></div></div>}
    </main>
  );
}
