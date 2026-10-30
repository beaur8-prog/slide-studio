import type { Deck } from "./types";
import { encodeRecovery, decodeRecovery } from "./recovery-encoding";
const DB_NAME = "slide-studio";
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("저장소를 열 수 없습니다. 다른 창을 닫아주세요."));
  });
}
export async function loadAutosave(): Promise<Deck | undefined> {
  const db = await database();
  try {
    const stored = await new Promise((resolve, reject) => {
      const request = db
        .transaction("documents")
        .objectStore("documents")
        .get("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await decodeRecovery<Deck | undefined>(stored);
  } finally {
    db.close();
  }
}
export async function saveAutosave(deck: Deck): Promise<void> {
  const stored = encodeRecovery(deck);
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("documents", "readwrite");
      tx.objectStore("documents").put(stored, "current");
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error("복구 데이터를 저장하지 못했습니다."));
      tx.onabort = () =>
        reject(tx.error || new Error("저장이 취소되었습니다."));
    });
  } finally {
    db.close();
  }
}
