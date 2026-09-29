"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { loginWithGoogle, logout, watchAuth } from "@/lib/auth";
import {
  addExpenseCatalogItem,
  createExpense,
  ensureExpenseCatalogs,
  expenseCatalogSelection,
  removeExpense,
  removeExpenseCatalogItem,
  updateExpense,
  updateExpenseCatalogItem,
  watchExpenseCatalogs,
  watchExpenses,
  watchProfiles,
  type Expense,
  type ExpenseCatalogItem,
  type ExpenseCatalogType,
  type Profile,
} from "@/lib/firestore";

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATALOG_LABELS: Record<ExpenseCatalogType, string> = {
  category: "Categories",
  paymentMethod: "Payment methods",
  nature: "Nature",
  relevance: "Relevance",
  frequency: "Frequency",
};

export default function ExpensesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [catalogs, setCatalogs] = useState<ExpenseCatalogItem[]>([]);
  const [expenseModal, setExpenseModal] = useState(false);
  const [catalogModal, setCatalogModal] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => watchAuth((u) => { setUser(u); setAuthReady(true); }), []);

  useEffect(() => {
    if (!user) { setProfiles([]); setProfileId(null); return; }
    let unsub = () => {};
    (async () => {
      const pref = await getDoc(doc(db, "users", user.uid));
      const saved = pref.data()?.activeProfileId;
      unsub = watchProfiles(user.uid, (items) => {
        setProfiles(items);
        setProfileId((current) => {
          if (current && items.some((p) => p.id === current)) return current;
          if (typeof saved === "string" && items.some((p) => p.id === saved)) return saved;
          return items[0]?.id ?? null;
        });
      });
    })().catch((e) => setError(e instanceof Error ? e.message : "Could not load profiles."));
    return () => unsub();
  }, [user]);

  useEffect(() => {
    if (!profileId) { setExpenses([]); setCatalogs([]); return; }
    ensureExpenseCatalogs(profileId).catch(console.error);
    const unExpenses = watchExpenses(profileId, setExpenses);
    const unCatalogs = watchExpenseCatalogs(profileId, setCatalogs);
    return () => { unExpenses(); unCatalogs(); };
  }, [profileId]);

  const activeProfile = profiles.find((p) => p.id === profileId) ?? null;
  const currentMonth = todayIso().slice(0, 7);
  const monthExpenses = expenses.filter((e) => e.date.startsWith(currentMonth));
  const monthTotal = monthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  const byType = useMemo(() => {
    const map = {} as Record<ExpenseCatalogType, ExpenseCatalogItem[]>;
    (Object.keys(CATALOG_LABELS) as ExpenseCatalogType[]).forEach((type) => {
      map[type] = catalogs.filter((c) => c.catalogType === type).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    });
    return map;
  }, [catalogs]);

  async function selectProfile(id: string) {
    setProfileId(id);
    if (user) await setDoc(doc(db, "users", user.uid), { activeProfileId: id }, { merge: true });
  }

  function openNew() { setEditing(null); setExpenseModal(true); }
  function openEdit(expense: Expense) { setEditing(expense); setExpenseModal(true); }

  async function saveExpense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!profileId) return;
    const f = new FormData(e.currentTarget);
    const find = (type: ExpenseCatalogType, id: string) => byType[type].find((x) => x.id === id);
    const category = find("category", String(f.get("categoryId") || ""));
    const payment = find("paymentMethod", String(f.get("paymentMethodId") || ""));
    const nature = find("nature", String(f.get("natureId") || ""));
    const relevance = find("relevance", String(f.get("relevanceId") || ""));
    const frequency = find("frequency", String(f.get("frequencyId") || ""));
    const c = expenseCatalogSelection(category), p = expenseCatalogSelection(payment), n = expenseCatalogSelection(nature), r = expenseCatalogSelection(relevance), q = expenseCatalogSelection(frequency);
    const payload: Omit<Expense, "id" | "profileId"> = {
      concept: String(f.get("concept") || "").trim(),
      amount: Number(f.get("amount")),
      date: String(f.get("date")),
      note: String(f.get("note") || "").trim() || undefined,
      categoryId: c.id, categoryName: c.name,
      paymentMethodId: p.id, paymentMethodName: p.name,
      natureId: n.id, natureName: n.name,
      relevanceId: r.id, relevanceName: r.name,
      frequencyId: q.id, frequencyName: q.name,
    };
    if (!payload.concept || !payload.date || !Number.isFinite(payload.amount) || payload.amount <= 0) return;
    try {
      setSaving(true); setError("");
      if (editing) await updateExpense(profileId, editing.id, payload);
      else await createExpense(profileId, payload);
      setExpenseModal(false); setEditing(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save expense."); }
    finally { setSaving(false); }
  }

  async function deleteExpense(expense: Expense) {
    if (!profileId || !confirm(`Delete ${expense.concept}?`)) return;
    await removeExpense(profileId, expense.id);
  }

  async function addCatalog(e: FormEvent<HTMLFormElement>, type: ExpenseCatalogType) {
    e.preventDefault(); if (!profileId) return;
    const form = e.currentTarget;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;
    await addExpenseCatalogItem(profileId, type, name); form.reset();
  }

  if (!authReady) return <main className="app-shell"><section className="expense-loading">Loading BillTrack…</section></main>;
  if (!user) return <main className="app-shell"><section className="expense-login"><div className="brandmark">✓</div><h1>BillTrack Expenses</h1><p>Sign in to access your profiles and expense history.</p><button className="primary" onClick={() => loginWithGoogle()}>Sign in with Google</button></section></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brandmark">✓</div><div><h1>BillTrack</h1><span>Remember what matters. Understand where it goes.</span></div></div>
        <div className="account-actions"><Link className="ghost nav-link" href="/">Commitments</Link><button className="ghost" onClick={() => logout()}>Sign out</button></div>
      </header>

      <nav className="module-nav"><Link href="/">Commitments</Link><Link className="active" href="/expenses">Expenses</Link><span>Planning</span></nav>

      <section className="content expenses-content">
        {error && <div className="data-error">{error}</div>}
        <div className="expense-head">
          <div><p className="eyebrow">EXPENSES</p><h2>Relevant spending, without doing accounting.</h2><p>Record the expenses worth remembering. Classify them so BillTrack can reveal patterns and future commitments.</p></div>
          <div className="expense-actions"><button className="ghost" onClick={() => setCatalogModal(true)}>Manage catalogs</button><button className="primary" onClick={openNew} disabled={!activeProfile}>＋ Add expense</button></div>
        </div>

        <div className="profiles expense-profiles">
          {profiles.map((p) => <button key={p.id} className={`profile ${profileId === p.id ? "active" : ""}`} onClick={() => selectProfile(p.id)}><span>{p.initials}</span><b>{p.name}</b><small>{profileId === p.id ? "Active profile" : "Open profile"}</small></button>)}
        </div>

        {activeProfile ? <>
          <div className="expense-summary">
            <div><small>PROFILE</small><strong>{activeProfile.name}</strong></div>
            <div><small>RECORDED THIS MONTH</small><strong>{money(monthTotal)}</strong></div>
            <div><small>EXPENSES THIS MONTH</small><strong>{monthExpenses.length}</strong></div>
            <div><small>ALL RECORDED</small><strong>{expenses.length}</strong></div>
          </div>

          <div className="expense-list-head"><div><p className="eyebrow">HISTORY</p><h3>Recorded expenses</h3></div></div>
          <div className="expense-list">
            {!expenses.length && <div className="empty">No expenses recorded for this profile yet.</div>}
            {expenses.map((expense) => <article className="expense-row" key={expense.id} onClick={() => openEdit(expense)}>
              <div className="expense-date"><b>{new Date(`${expense.date}T12:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</b><small>{expense.date.slice(0, 4)}</small></div>
              <div className="expense-main"><h4>{expense.concept}</h4><p>{[expense.categoryName, expense.natureName, expense.frequencyName].filter(Boolean).join(" · ") || "Unclassified"}</p></div>
              <div className="expense-meta"><small>{expense.paymentMethodName || "Payment not set"}</small><span>{expense.relevanceName || ""}</span></div>
              <strong className="expense-amount">{money(expense.amount)}</strong>
              <button className="delete" aria-label={`Delete ${expense.concept}`} onClick={(e) => { e.stopPropagation(); deleteExpense(expense); }}>×</button>
            </article>)}
          </div>
        </> : <div className="empty">Create or select a profile in Commitments first.</div>}
      </section>

      {expenseModal && activeProfile && <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && setExpenseModal(false)}><div className="modal expense-modal"><button className="close" onClick={() => setExpenseModal(false)}>×</button><p className="eyebrow">{activeProfile.name.toUpperCase()}</p><h3>{editing ? "Edit expense" : "Add expense"}</h3>
        <form onSubmit={saveExpense}>
          <div className="grid2"><label>Amount<input name="amount" type="number" min="0.01" step="0.01" required defaultValue={editing?.amount ?? ""} /></label><label>Date<input name="date" type="date" required defaultValue={editing?.date ?? todayIso()} /></label></div>
          <label>Concept<input name="concept" required placeholder="Costco, gas, support to Mom…" defaultValue={editing?.concept ?? ""} /></label>
          <CatalogSelect label="Category" name="categoryId" items={byType.category} value={editing?.categoryId} />
          <div className="grid2"><CatalogSelect label="Payment method" name="paymentMethodId" items={byType.paymentMethod} value={editing?.paymentMethodId} /><CatalogSelect label="Nature" name="natureId" items={byType.nature} value={editing?.natureId} /></div>
          <div className="grid2"><CatalogSelect label="Relevance" name="relevanceId" items={byType.relevance} value={editing?.relevanceId} /><CatalogSelect label="Frequency" name="frequencyId" items={byType.frequency} value={editing?.frequencyId} /></div>
          <label>Note <small>(optional)</small><textarea name="note" rows={3} defaultValue={editing?.note ?? ""} placeholder="Anything useful to remember about this expense." /></label>
          <button className="primary full" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save expense"}</button>
        </form>
      </div></div>}

      {catalogModal && activeProfile && <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && setCatalogModal(false)}><div className="modal catalog-modal"><button className="close" onClick={() => setCatalogModal(false)}>×</button><p className="eyebrow">{activeProfile.name.toUpperCase()}</p><h3>Expense catalogs</h3><p className="catalog-intro">These options belong to this profile. Add your own, rename them, deactivate them, or remove them. Existing expenses keep their saved labels.</p>
        <div className="catalog-groups">{(Object.keys(CATALOG_LABELS) as ExpenseCatalogType[]).map((type) => <section className="catalog-group" key={type}><h4>{CATALOG_LABELS[type]}</h4><form className="catalog-add" onSubmit={(e) => addCatalog(e, type)}><input name="name" placeholder={`Add ${CATALOG_LABELS[type].toLowerCase().replace(/s$/, "")}`} /><button className="ghost">＋ Add</button></form>
          <div>{byType[type].map((item) => <CatalogRow key={item.id} item={item} profileId={activeProfile.id} />)}</div></section>)}</div>
      </div></div>}
    </main>
  );
}

function CatalogSelect({ label, name, items, value }: { label: string; name: string; items: ExpenseCatalogItem[]; value?: string }) {
  const active = items.filter((x) => x.active || x.id === value);
  return <label>{label}<select name={name} defaultValue={value ?? ""}><option value="">Not specified</option>{active.map((item) => <option key={item.id} value={item.id}>{item.name}{!item.active ? " (inactive)" : ""}</option>)}</select></label>;
}

function CatalogRow({ item, profileId }: { item: ExpenseCatalogItem; profileId: string }) {
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);
  return <div className={`catalog-row ${item.active ? "" : "inactive"}`}><input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== item.name && updateExpenseCatalogItem(profileId, item.id, { name })} /><button className="catalog-toggle" onClick={() => updateExpenseCatalogItem(profileId, item.id, { active: !item.active })}>{item.active ? "Active" : "Inactive"}</button><button className="delete" title="Remove catalog item" onClick={() => confirm(`Remove ${item.name}? Existing expenses will keep their saved label.`) && removeExpenseCatalogItem(profileId, item.id)}>×</button></div>;
}
