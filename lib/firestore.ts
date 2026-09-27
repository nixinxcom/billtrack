import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export type Profile = {
  id: string;
  name: string;
  initials: string;
  ownerUid: string;
  memberUids: string[];
  memberRoles: Record<string, "owner" | "editor" | "viewer">;
};

export type Recurrence = "monthly" | "one-time";
export type ItemType = string;

export type Obligation = {
  id: string;
  profileId: string;
  title: string;
  type: string;
  recurrence: Recurrence;
  dueDay?: number;
  dueDate?: string;
  startDate: string;
  endDate?: string;
  statementDay?: number;
  amount?: number;
  note?: string;
  reminderDays: number[];
};

export type Occurrence = {
  id: string;
  profileId: string;
  obligationId: string;
  dueDate: string;
  expectedAmount?: number;
  paidDate?: string;
  paidAmount?: number;
  paid: boolean;
};

export type Category = { id: string; name: string };

const DEFAULT_CATEGORIES = [
  "Credit Card", "Mortgage", "Rent", "Auto Loan", "Auto Lease",
  "Insurance", "Utility", "Subscription", "Loan", "Tax", "Tuition", "Other",
];

function isoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dateForMonth(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

function occurrenceSpecs(item: Omit<Obligation, "id" | "profileId">) {
  if (item.recurrence === "one-time") {
    const dueDate = item.dueDate || item.startDate;
    return [{ id: dueDate, dueDate }];
  }

  const start = parseLocalDate(item.startDate);
  const configuredEnd = item.endDate ? parseLocalDate(item.endDate) : null;
  const rollingEnd = new Date();
  rollingEnd.setMonth(rollingEnd.getMonth() + 24);
  const end = configuredEnd && configuredEnd < rollingEnd ? configuredEnd : rollingEnd;
  const specs: Array<{ id: string; dueDate: string }> = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const finalMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  while (cursor <= finalMonth && specs.length < 240) {
    const due = dateForMonth(cursor.getFullYear(), cursor.getMonth(), item.dueDay || start.getDate());
    if (due >= start && (!configuredEnd || due <= configuredEnd)) {
      const dueDate = isoDate(due);
      specs.push({ id: dueDate.slice(0, 7), dueDate });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return specs;
}

async function writeOccurrenceSpecs(profileId: string, obligationId: string, item: Omit<Obligation, "id" | "profileId">) {
  const specs = occurrenceSpecs(item);
  const ref = collection(db, "profiles", profileId, "obligations", obligationId, "occurrences");
  const existing = await getDocs(ref);
  const existingIds = new Set(existing.docs.map((d) => d.id));
  const missing = specs.filter((spec) => !existingIds.has(spec.id));
  for (let i = 0; i < missing.length; i += 400) {
    const batch = writeBatch(db);
    missing.slice(i, i + 400).forEach((spec) => {
      batch.set(doc(ref, spec.id), {
        profileId, obligationId, dueDate: spec.dueDate, expectedAmount: item.amount ?? null, paid: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    });
    await batch.commit();
  }
}

export async function ensureOccurrences(profileId: string, item: Obligation) {
  await writeOccurrenceSpecs(profileId, item.id, item);
}

export function watchProfiles(uid: string, callback: (profiles: Profile[]) => void) {
  const q = query(collection(db, "profiles"), where("memberUids", "array-contains", uid));
  return onSnapshot(q, (snapshot) => callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Profile)).sort((a, b) => a.name.localeCompare(b.name))));
}

export async function createProfile(uid: string, name: string) {
  const ref = doc(collection(db, "profiles"));
  await setDoc(ref, {
    name,
    initials: name[0].toUpperCase(),
    ownerUid: uid,
    memberUids: [uid],
    memberRoles: { [uid]: "owner" },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function watchObligations(profileId: string, callback: (items: Obligation[]) => void) {
  return onSnapshot(collection(db, "profiles", profileId, "obligations"), (snapshot) => {
    callback(snapshot.docs.map((d) => {
      const data = d.data();
      const today = isoDate(new Date());
      return {
        id: d.id,
        profileId,
        ...data,
        recurrence: data.recurrence ?? "monthly",
        startDate: data.startDate ?? today,
      } as Obligation;
    }));
  });
}

export function watchOccurrences(profileId: string, obligationIds: string[], callback: (items: Occurrence[]) => void) {
  if (!obligationIds.length) { callback([]); return () => {}; }
  const byObligation = new Map<string, Occurrence[]>();
  const unsubs: Unsubscribe[] = obligationIds.map((obligationId) =>
    onSnapshot(collection(db, "profiles", profileId, "obligations", obligationId, "occurrences"), (snapshot) => {
      byObligation.set(obligationId, snapshot.docs.map((d) => ({ id: d.id, profileId, obligationId, ...d.data() } as Occurrence)));
      callback(Array.from(byObligation.values()).flat());
    })
  );
  return () => unsubs.forEach((u) => u());
}

export function watchCategories(profileId: string, callback: (categories: Category[]) => void) {
  return onSnapshot(collection(db, "profiles", profileId, "categories"), (snapshot) => {
    const custom = snapshot.docs.map((d) => ({ id: d.id, name: String(d.data().name) }));
    const names = [...DEFAULT_CATEGORIES, ...custom.map((c) => c.name)];
    callback([...new Set(names)].sort().map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name })));
  });
}

export async function addCategory(profileId: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  await addDoc(collection(db, "profiles", profileId, "categories"), { name: clean, createdAt: serverTimestamp() });
}

export async function createObligation(profileId: string, item: Omit<Obligation, "id" | "profileId">) {
  const payload: Record<string, unknown> = {
    title: item.title, type: item.type, recurrence: item.recurrence,
    startDate: item.startDate, reminderDays: item.reminderDays,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
  if (item.dueDay !== undefined) payload.dueDay = item.dueDay;
  if (item.dueDate) payload.dueDate = item.dueDate;
  if (item.endDate) payload.endDate = item.endDate;
  if (item.statementDay !== undefined) payload.statementDay = item.statementDay;
  if (item.amount !== undefined) payload.amount = item.amount;
  if (item.note) payload.note = item.note;
  const ref = await addDoc(collection(db, "profiles", profileId, "obligations"), payload);
  await writeOccurrenceSpecs(profileId, ref.id, item);
}

export async function updateObligation(profileId: string, obligationId: string, item: Omit<Obligation, "id" | "profileId">) {
  await updateDoc(doc(db, "profiles", profileId, "obligations", obligationId), {
    title: item.title,
    type: item.type,
    recurrence: item.recurrence,
    startDate: item.startDate,
    dueDay: item.dueDay !== undefined ? item.dueDay : deleteField(),
    dueDate: item.dueDate || deleteField(),
    endDate: item.endDate || deleteField(),
    statementDay: item.statementDay !== undefined ? item.statementDay : deleteField(),
    amount: item.amount !== undefined ? item.amount : deleteField(),
    note: item.note || deleteField(),
    reminderDays: item.reminderDays,
    updatedAt: serverTimestamp(),
  });
  await writeOccurrenceSpecs(profileId, obligationId, item);
}

export async function markOccurrencePaid(profileId: string, occurrence: Occurrence, paidDate: string, paidAmount?: number) {
  await updateDoc(doc(db, "profiles", profileId, "obligations", occurrence.obligationId, "occurrences", occurrence.id), {
    paid: true,
    paidDate,
    paidAmount: paidAmount ?? deleteField(),
    markedPaidAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function markOccurrenceUnpaid(profileId: string, occurrence: Occurrence) {
  await updateDoc(doc(db, "profiles", profileId, "obligations", occurrence.obligationId, "occurrences", occurrence.id), {
    paid: false,
    paidDate: deleteField(),
    paidAmount: deleteField(),
    markedPaidAt: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export async function removeObligation(profileId: string, obligationId: string) {
  const occ = await getDocs(collection(db, "profiles", profileId, "obligations", obligationId, "occurrences"));
  for (let i = 0; i < occ.docs.length; i += 400) {
    const batch = writeBatch(db);
    occ.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, "profiles", profileId, "obligations", obligationId));
}

export async function deleteProfileWithCommitments(profileId: string) {
  const obligations = await getDocs(collection(db, "profiles", profileId, "obligations"));
  for (const obligation of obligations.docs) await removeObligation(profileId, obligation.id);
  const categories = await getDocs(collection(db, "profiles", profileId, "categories"));
  if (!categories.empty) {
    const batch = writeBatch(db);
    categories.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await deleteDoc(doc(db, "profiles", profileId));
}

export async function migrateLocalData(uid: string) {
  if (typeof window === "undefined") return;
  const marker = `billtrack.firestoreMigrated.${uid}`;
  if (localStorage.getItem(marker) === "1") return;
  const profileRaw = localStorage.getItem("billtrack.v2.profiles");
  const itemRaw = localStorage.getItem("billtrack.v2.items");
  if (!profileRaw) { localStorage.setItem(marker, "1"); return; }
  const existing = await getDocs(query(collection(db, "profiles"), where("memberUids", "array-contains", uid)));
  if (!existing.empty) { localStorage.setItem(marker, "1"); return; }
  const localProfiles = JSON.parse(profileRaw) as Array<{ id: string; name: string }>;
  const localItems = itemRaw ? JSON.parse(itemRaw) as Array<Partial<Obligation> & { profileId: string }> : [];
  const today = isoDate(new Date());
  for (const p of localProfiles) {
    const newProfileId = await createProfile(uid, p.name);
    for (const item of localItems.filter((x) => x.profileId === p.id)) {
      await createObligation(newProfileId, {
        title: item.title || "Commitment", type: item.type || "Other", recurrence: "monthly",
        dueDay: item.dueDay || 1, startDate: today, statementDay: item.statementDay,
        amount: item.amount, note: item.note, reminderDays: item.reminderDays ?? [10, 7, 3, 0],
      });
    }
  }
  localStorage.setItem(marker, "1");
}
