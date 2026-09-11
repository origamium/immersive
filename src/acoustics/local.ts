import type { AnalysisResult, Experiment, LocalCapture } from "./types";

const DB = "immersive-acoustics-v1";
export function captureTabId() {
  let id = sessionStorage.getItem("acoustic-tab-id");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("acoustic-tab-id", id);
  }
  return id;
}
export async function recoverCaptures() {
  const tab = captureTabId();
  for (const capture of await localCaptures()) {
    if (
      capture.status === "recording" &&
      (capture.ownerTabId === tab ||
        Date.now() - Date.parse(capture.createdAt) > 125000)
    ) {
      await putLocal("captures", capture.id, {
        ...capture,
        status: "interrupted",
        reason: "録音中に画面が終了しました。保存済みチャンクを復旧しました。",
      });
    }
  }
}
export function openLocal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const name of [
        "results",
        "captures",
        "chunks",
        "experiments",
        "settings",
      ])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function putLocal(store: string, key: string, value: unknown) {
  const db = await openLocal();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("保存が中断されました"));
    });
  } finally {
    db.close();
  }
}
export async function getLocal<T>(
  store: string,
  key: string
): Promise<T | undefined> {
  const db = await openLocal();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function listLocal<T>(store: string): Promise<T[]> {
  const db = await openLocal();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export const localResults = () => listLocal<AnalysisResult>("results");
export const localCaptures = () => listLocal<LocalCapture>("captures");
export const localExperiments = () => listLocal<Experiment>("experiments");
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
