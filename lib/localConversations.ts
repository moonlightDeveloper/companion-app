/**
 * On-device storage for raw conversations (CLAUDE.md §2.1).
 *
 * Conversations live ONLY here, in the browser's IndexedDB, tagged with
 * personId + reportId. They are never sent to or stored in Postgres. We keep at
 * most 10 per person (rolling) and evict anything older than 30 days, lazily —
 * on app-open and on every write.
 *
 * Client-only: every function no-ops safely if IndexedDB isn't available.
 */

const DB_NAME = "companion";
const DB_VERSION = 1;
const STORE = "conversations";
const MAX_PER_PERSON = 10;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface LocalConversation {
  reportId: string;
  personId: string;
  text: string;
  createdAt: number;
}

function hasIDB(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "reportId" });
        os.createIndex("personId", "personId", { unique: false });
        os.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db: IDBDatabase): Promise<LocalConversation[]> {
  return reqP(db.transaction(STORE, "readonly").objectStore(STORE).getAll());
}

function byPerson(db: IDBDatabase, personId: string): Promise<LocalConversation[]> {
  const idx = db.transaction(STORE, "readonly").objectStore(STORE).index("personId");
  return reqP(idx.getAll(personId));
}

function deleteKeys(db: IDBDatabase, reportIds: string[]): Promise<void> {
  if (reportIds.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    reportIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Remove conversations older than the TTL. Safe to call anytime. */
export async function evictExpired(): Promise<void> {
  if (!hasIDB()) return;
  try {
    const db = await openDB();
    const cutoff = Date.now() - TTL_MS;
    const expired = (await getAll(db))
      .filter((c) => c.createdAt < cutoff)
      .map((c) => c.reportId);
    await deleteKeys(db, expired);
  } catch {
    /* best-effort; never block the UI on local cleanup */
  }
}

/** Trim a person's conversations down to the most recent MAX_PER_PERSON. */
async function enforceCap(db: IDBDatabase, personId: string): Promise<void> {
  const items = (await byPerson(db, personId)).sort((a, b) => b.createdAt - a.createdAt);
  await deleteKeys(db, items.slice(MAX_PER_PERSON).map((c) => c.reportId));
}

/** Store a conversation, then lazily evict (TTL + rolling per-person cap). */
export async function saveConversation(c: {
  reportId: string;
  personId: string;
  text: string;
}): Promise<void> {
  if (!hasIDB() || !c.reportId || !c.personId) return;
  try {
    const db = await openDB();
    const record: LocalConversation = { ...c, createdAt: Date.now() };
    await reqP(db.transaction(STORE, "readwrite").objectStore(STORE).put(record));
    await evictExpired();
    await enforceCap(db, c.personId);
  } catch {
    /* never block the read on local persistence */
  }
}

/** The text of one stored conversation, or null if it's gone. */
export async function getConversation(reportId: string): Promise<string | null> {
  if (!hasIDB()) return null;
  try {
    const db = await openDB();
    const r = await reqP<LocalConversation | undefined>(
      db.transaction(STORE, "readonly").objectStore(STORE).get(reportId),
    );
    return r?.text ?? null;
  } catch {
    return null;
  }
}

/** A person's most recent conversations (default 3, for reply assistance). */
export async function getRecentConversations(
  personId: string,
  limit = 3,
): Promise<LocalConversation[]> {
  if (!hasIDB()) return [];
  try {
    const db = await openDB();
    return (await byPerson(db, personId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}
