/**
 * Stores a user-provided caption font (.ttf / .otf) in IndexedDB so exports
 * can burn it in offline. Nothing is uploaded to a server.
 */

const DB_NAME = "clippilot-caption-fonts";
const STORE = "fonts";
const KEY = "custom-caption-font";

export interface StoredCaptionFont {
  /** Original file name */
  fileName: string;
  /** Family name to put in the ASS Style line (user can edit). */
  familyName: string;
  /** Raw font bytes */
  data: ArrayBuffer;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

export async function saveCustomCaptionFont(
  file: File,
  familyName?: string,
): Promise<StoredCaptionFont> {
  const buf = await file.arrayBuffer();
  const nameFromFile = file.name.replace(/\.(ttf|otf|woff2?)$/i, "").trim();
  const entry: StoredCaptionFont = {
    fileName: file.name,
    familyName: (familyName || nameFromFile || "CustomCaption").trim() || "CustomCaption",
    data: buf,
    savedAt: new Date().toISOString(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("font save failed"));
  });
  db.close();
  return entry;
}

export async function loadCustomCaptionFont(): Promise<StoredCaptionFont | null> {
  try {
    const db = await openDb();
    const entry = await new Promise<StoredCaptionFont | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredCaptionFont) ?? null);
      req.onerror = () => reject(req.error ?? new Error("font load failed"));
    });
    db.close();
    return entry;
  } catch {
    return null;
  }
}

export async function clearCustomCaptionFont(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("font clear failed"));
    });
    db.close();
  } catch {
    /* ignore */
  }
}

/** Meta only (no large buffer) for UI. */
export async function loadCustomCaptionFontMeta(): Promise<{
  fileName: string;
  familyName: string;
} | null> {
  const f = await loadCustomCaptionFont();
  if (!f) return null;
  return { fileName: f.fileName, familyName: f.familyName };
}

export async function updateCustomFontFamilyName(familyName: string): Promise<void> {
  const existing = await loadCustomCaptionFont();
  if (!existing) return;
  existing.familyName = familyName.trim() || existing.familyName;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(existing, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("font update failed"));
  });
  db.close();
}
