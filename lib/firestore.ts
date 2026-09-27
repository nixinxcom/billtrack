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
} from "firebase/firestore";

import { db } from "./firebase";

export type Profile = {
  id: string;
  name: string;
  initials: string;
  ownerUid: string;
  memberUids: string[];
  memberRoles: Record<
    string,
    "owner" | "editor" | "viewer"
  >;
};

export type ItemType =
  | "Credit Card"
  | "Insurance"
  | "Rent"
  | "Utility"
  | "Subscription"
  | "Other";

export type Obligation = {
  id: string;
  profileId: string;
  title: string;
  type: ItemType;
  dueDay: number;
  statementDay?: number;
  amount?: number;
  note?: string;
  reminderDays: number[];
};

/* -------------------------------------------------------
   Profiles
------------------------------------------------------- */

export function watchProfiles(
  uid: string,
  callback: (profiles: Profile[]) => void
) {
  const q = query(
    collection(db, "profiles"),
    where("memberUids", "array-contains", uid)
  );

  return onSnapshot(q, (snapshot) => {
    callback(
      snapshot.docs
        .map(
          (d) =>
            ({
              id: d.id,
              ...d.data(),
            }) as Profile
        )
        .sort((a, b) =>
          a.name.localeCompare(b.name)
        )
    );
  });
}

export async function createProfile(
  uid: string,
  name: string
) {
  const ref = doc(collection(db, "profiles"));

  await setDoc(ref, {
    name,
    initials: name[0].toUpperCase(),

    ownerUid: uid,

    memberUids: [uid],

    memberRoles: {
      [uid]: "owner",
    },

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
}

/* -------------------------------------------------------
   Obligations
------------------------------------------------------- */

export function watchObligations(
  profileId: string,
  callback: (items: Obligation[]) => void
) {
  return onSnapshot(
    collection(
      db,
      "profiles",
      profileId,
      "obligations"
    ),
    (snapshot) => {
      callback(
        snapshot.docs.map(
          (d) =>
            ({
              id: d.id,
              profileId,
              ...d.data(),
            }) as Obligation
        )
      );
    }
  );
}

export async function createObligation(
  profileId: string,
  item: Omit<
    Obligation,
    "id" | "profileId"
  >
) {
  const payload: Record<string, unknown> = {
    title: item.title,
    type: item.type,
    dueDay: item.dueDay,
    reminderDays: item.reminderDays,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (item.statementDay !== undefined) {
    payload.statementDay =
      item.statementDay;
  }

  if (item.amount !== undefined) {
    payload.amount = item.amount;
  }

  if (item.note) {
    payload.note = item.note;
  }

  await addDoc(
    collection(
      db,
      "profiles",
      profileId,
      "obligations"
    ),
    payload
  );
}

/* -------------------------------------------------------
   Update obligation
------------------------------------------------------- */

export async function updateObligation(
  profileId: string,
  obligationId: string,
  item: Omit<
    Obligation,
    "id" | "profileId"
  >
) {
  const obligationRef = doc(
    db,
    "profiles",
    profileId,
    "obligations",
    obligationId
  );

  await updateDoc(obligationRef, {
    title: item.title,
    type: item.type,
    dueDay: item.dueDay,

    statementDay:
      item.statementDay !== undefined
        ? item.statementDay
        : deleteField(),

    amount:
      item.amount !== undefined
        ? item.amount
        : deleteField(),

    note:
      item.note
        ? item.note
        : deleteField(),

    reminderDays: item.reminderDays,

    updatedAt: serverTimestamp(),
  });
}

/* -------------------------------------------------------
   Delete obligation
------------------------------------------------------- */

export async function removeObligation(
  profileId: string,
  obligationId: string
) {
  await deleteDoc(
    doc(
      db,
      "profiles",
      profileId,
      "obligations",
      obligationId
    )
  );
}

/* -------------------------------------------------------
   Delete profile + all its obligations
------------------------------------------------------- */

export async function deleteProfileWithCommitments(
  profileId: string
) {
  const obligationsRef = collection(
    db,
    "profiles",
    profileId,
    "obligations"
  );

  const obligationsSnapshot =
    await getDocs(obligationsRef);

  const batch = writeBatch(db);

  obligationsSnapshot.forEach(
    (obligationDoc) => {
      batch.delete(obligationDoc.ref);
    }
  );

  batch.delete(
    doc(db, "profiles", profileId)
  );

  await batch.commit();
}

/* -------------------------------------------------------
   One-time migration from localStorage
------------------------------------------------------- */

export async function migrateLocalData(
  uid: string
) {
  if (typeof window === "undefined") {
    return;
  }

  const marker =
    `billtrack.firestoreMigrated.${uid}`;

  if (
    localStorage.getItem(marker) === "1"
  ) {
    return;
  }

  const profileRaw =
    localStorage.getItem(
      "billtrack.v2.profiles"
    );

  const itemRaw =
    localStorage.getItem(
      "billtrack.v2.items"
    );

  if (!profileRaw) {
    localStorage.setItem(marker, "1");
    return;
  }

  const existing = await getDocs(
    query(
      collection(db, "profiles"),
      where(
        "memberUids",
        "array-contains",
        uid
      )
    )
  );

  if (!existing.empty) {
    localStorage.setItem(marker, "1");
    return;
  }

  const localProfiles =
    JSON.parse(profileRaw) as Array<{
      id: string;
      name: string;
      initials: string;
    }>;

  const localItems = itemRaw
    ? (JSON.parse(itemRaw) as Array<
        Omit<
          Obligation,
          "reminderDays"
        > & {
          reminderDays?: number[];
        }
      >)
    : [];

  for (
    const localProfile of localProfiles
  ) {
    const newProfileId =
      await createProfile(
        uid,
        localProfile.name
      );

    const related =
      localItems.filter(
        (item) =>
          item.profileId ===
          localProfile.id
      );

    for (const item of related) {
      await createObligation(
        newProfileId,
        {
          title: item.title,
          type: item.type,
          dueDay: item.dueDay,

          statementDay:
            item.statementDay,

          amount:
            item.amount,

          note:
            item.note,

          reminderDays:
            item.reminderDays ??
            [10, 7, 3, 0],
        }
      );
    }
  }

  localStorage.setItem(
    marker,
    "1"
  );
}