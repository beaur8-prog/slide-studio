import type { Deck } from "./types";
import { encodeRecovery, decodeRecovery, jsonBlob, JsonBlobSizeError } from "./recovery-encoding";
import { documentCapacityError } from "./document-limits";
const DB_NAME = "slide-studio";
const REVISION_KEY = "current-revision";
const PRESERVATION_REQUIRED = "recovery-required";
const validRevision = (value: unknown): value is string => typeof value === "string" && /^[\da-f-]{36}$/i.test(value);
const DATA_PREFIX = "recovery-quarantine:data:";
const META_PREFIX = "recovery-quarantine:meta:";
const LOCK_NAME = "slide-studio-recovery-current";
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_BLOBS = 65533; // With record.json, stay below ZIP2's 0xffff ZIP64 sentinel.
const downloadSizeError = () => new Error("복구 데이터가 256 MiB보다 커서 이 창에서 내려받을 수 없습니다. 원본은 앱에 보관되어 있습니다.");
function boundedRecoveryJson(value: unknown, maximum = MAX_DOWNLOAD_BYTES) {
  try { return jsonBlob(value, maximum); }
  catch (error) { if (error instanceof JsonBlobSizeError) throw downloadSizeError(); throw error; }
}
let autosaveBlocked = false;
type RecoveryValidator = (value: unknown) => Deck | Promise<Deck>;
let writeEpoch = 0;
let pendingLoad: { validate?: RecoveryValidator; epoch: number; promise: Promise<Deck | undefined> } | undefined;

export type RecoveryBackup = { id: string; createdAt: string; reason: string };
export class AutosaveRecoveryError extends Error {
  constructor(readonly backup?: RecoveryBackup) {
    super(backup
      ? "읽지 못한 복구 데이터를 별도로 보관했습니다."
      : "기존 복구 데이터를 보관하지 못해 자동 저장을 중지했습니다.");
    this.name = "AutosaveRecoveryError";
  }
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("저장소를 열 수 없습니다. 다른 창을 닫아주세요."));
  });
}
async function locked<T>(operation: () => Promise<T>): Promise<T> {
  // Serialise decode/validation and saves across editor windows. The revision
  // check below also protects browsers without the Web Locks API.
  return navigator.locks
    ? await navigator.locks.request(LOCK_NAME, operation)
    : operation();
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function snapshot(db: IDBDatabase) {
  const store = db.transaction("documents").objectStore("documents");
  const [raw, revision] = await Promise.all([
    requestValue(store.get("current")), requestValue(store.get(REVISION_KEY)),
  ]);
  return { raw, revision: typeof revision === "string" ? revision : undefined };
}
async function reviseIfCurrent(db: IDBDatabase, source: Awaited<ReturnType<typeof snapshot>>, revision: string) {
  if (source.revision === revision) return source;
  return new Promise<typeof source | undefined>((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite"), store = tx.objectStore("documents");
    let changed = false;
    const request = store.get(REVISION_KEY);
    request.onsuccess = () => {
      const previous = typeof request.result === "string" ? request.result : undefined;
      if (previous !== source.revision) { changed = true; return; }
      try { store.put(revision, REVISION_KEY); } catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve(changed ? undefined : { ...source, revision });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function quarantine(db: IDBDatabase, source: Awaited<ReturnType<typeof snapshot>>, reason: string) {
  const backup: RecoveryBackup = {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), reason,
  };
  return new Promise<RecoveryBackup | undefined>((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const store = tx.objectStore("documents");
    let changed = false;
    const request = store.get(REVISION_KEY);
    request.onsuccess = () => {
      const revision = typeof request.result === "string" ? request.result : undefined;
      if (revision !== source.revision) { changed = true; return; }
      // Commit raw bytes, metadata and removal of current in ONE transaction.
      // An abort (including quota exhaustion) leaves current intact. A crash
      // after commit cannot create the same backup again on the next launch.
      try {
        store.put(source.raw, DATA_PREFIX + backup.id);
        store.put(backup, META_PREFIX + backup.id);
        store.delete("current");
        store.put(crypto.randomUUID(), REVISION_KEY);
      } catch { tx.abort(); }
    };
    tx.oncomplete = () => resolve(changed ? undefined : backup);
    tx.onerror = () => reject(tx.error || new Error("복구 데이터를 보관하지 못했습니다."));
    tx.onabort = () => reject(tx.error || new Error("복구 데이터 보관이 취소되었습니다."));
  });
}
export function loadAutosave(validate?: RecoveryValidator): Promise<Deck | undefined> {
  // StrictMode and simultaneous callers may request the same start-up snapshot.
  // Reuse that in-flight read; a queued save invalidates reuse immediately.
  if (pendingLoad && pendingLoad.validate === validate && pendingLoad.epoch === writeEpoch)
    return pendingLoad.promise;
  const promise = locked(async () => {
    const db = await database();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const source = await snapshot(db);
        if (source.raw === undefined) {
          if (validate) autosaveBlocked = false;
          return undefined;
        }
        let decoded: Deck;
        let validating = false;
        try {
          decoded = await decodeRecovery<Deck>(source.raw);
          validating = true;
          if (validate) decoded = await validate(decoded);
        } catch (error) {
          const reason = validating && error instanceof Error
            ? error.message.slice(0, 300) : "복구 JSON 데이터를 읽을 수 없습니다.";
          let backup: RecoveryBackup | undefined;
          try {
            // Persist the protection before attempting a potentially large raw
            // backup. A quota-aborted backup must also block other windows.
            const protectedSource = await reviseIfCurrent(db, source, PRESERVATION_REQUIRED);
            if (!protectedSource) continue;
            backup = await quarantine(db, protectedSource, reason);
          } catch {
            autosaveBlocked = true;
            throw new AutosaveRecoveryError();
          }
          if (!backup) continue; // Another window saved a newer revision.
          autosaveBlocked = false;
          throw new AutosaveRecoveryError(backup);
        }
        if (validate) {
          if (!validRevision(source.revision)) {
            try {
              if (!await reviseIfCurrent(db, source, crypto.randomUUID())) continue;
            } catch {
              autosaveBlocked = true;
              throw new AutosaveRecoveryError();
            }
          }
          autosaveBlocked = false;
        }
        return decoded;
      }
      autosaveBlocked = true;
      throw new AutosaveRecoveryError();
    } finally { db.close(); }
  });
  pendingLoad = { validate, epoch: writeEpoch, promise };
  const clear = () => { if (pendingLoad?.promise === promise) pendingLoad = undefined; };
  void promise.then(clear, clear);
  return promise;
}
export async function listRecoveryBackups(): Promise<RecoveryBackup[]> {
  const db = await database();
  try {
    const rows = await requestValue(db.transaction("documents").objectStore("documents")
      .getAll(IDBKeyRange.bound(META_PREFIX, META_PREFIX + "\uffff")));
    return rows.filter((row): row is RecoveryBackup => row &&
      typeof row.id === "string" && /^[\da-f-]{36}$/i.test(row.id) &&
      typeof row.createdAt === "string" && typeof row.reason === "string")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } finally { db.close(); }
}
export async function recoveryDownload(id?: string): Promise<{ blob: Blob; name: string; description: string }> {
  if (id !== undefined && !/^[\da-f-]{36}$/i.test(id)) throw new Error("복구 기록을 찾을 수 없습니다.");
  const db = await database();
  let raw: unknown;
  try {
    raw = await requestValue(db.transaction("documents").objectStore("documents")
      .get(id ? DATA_PREFIX + id : "current"));
  } finally { db.close(); }
  if (raw === undefined) throw new Error("복구 기록을 찾을 수 없습니다.");
  // Known Blob envelopes contain the original JSON bytes. Do not parse or
  // re-encode even damaged JSON. Envelopes with extra fields are archived so
  // metadata and additional Blob values are not silently dropped on download.
  const envelope = raw && typeof raw === "object" && "format" in raw &&
    raw.format === "slide-studio-recovery-json" && "version" in raw && raw.version === 1 && "data" in raw && raw.data instanceof Blob
    ? raw as { data: Blob } : undefined;
  const data = raw instanceof Blob ? raw : envelope &&
    Object.keys(envelope).every(key => ["format", "version", "data"].includes(key)) ? envelope.data : undefined;
  let blob: Blob;
  let extension: "json" | "zip" | "bin";
  let description: string;
  if (data) {
    if (data.size > MAX_DOWNLOAD_BYTES) throw downloadSizeError();
    blob = data;
    extension = data.type === "application/json" ? "json" : data.type === "application/zip" ? "zip" : "bin";
    description = extension === "json"
      ? "저장 레코드 안의 JSON 원문입니다. PPTX 파일이 아니며 바로 열리지 않을 수 있습니다."
      : "저장된 원본 바이트입니다. PPTX로 변환하거나 자동 실행하지 않습니다.";
  } else {
    const attachments: Blob[] = [], parents = new Set<object>();
    const archiveValue = (value: unknown): unknown => {
      if (!value || typeof value !== "object") return value;
      if (value instanceof Blob) {
        if (attachments.length >= MAX_ARCHIVE_BLOBS)
          throw new Error("복구 원문의 첨부 파일이 너무 많아 ZIP으로 내려받을 수 없습니다. 원본은 앱에 보관되어 있습니다.");
        const index = attachments.push(value) - 1;
        return { recoveryBlob: `blobs/${index}.bin`, type: value.type, size: value.size };
      }
      if (parents.has(value) || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype))
        throw new Error("이 원문의 형식은 파일로 변환할 수 없습니다. 원본은 앱의 복구 저장소에 유지됩니다.");
      parents.add(value);
      const result = Array.isArray(value) ? value.map(archiveValue)
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, archiveValue(item)]));
      parents.delete(value);
      return result;
    };
    const record = archiveValue(raw);
    if (attachments.length) {
      // STORE, ASCII names, no directory entries/comments/extra fields and no
      // streaming data descriptors: EOCD22 + (local30 + central46 + 2*name).
      // Check the whole archive BEFORE reading any Blob into an ArrayBuffer.
      const names = attachments.map((_, i) => `blobs/${i}.bin`);
      let remaining = MAX_DOWNLOAD_BYTES - 22 - 76 - 2 * "record.json".length;
      names.forEach(name => { remaining -= 76 + 2 * name.length; });
      for (const attachment of attachments) {
        if (attachment.size > remaining) throw downloadSizeError();
        remaining -= attachment.size;
      }
      const manifest = boundedRecoveryJson({ format: "slide-studio-raw-recovery-archive", version: 1, record }, remaining);
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      zip.file("record.json", await manifest.arrayBuffer(), { createFolders: false });
      for (let i = 0; i < attachments.length; i++) zip.file(names[i], await attachments[i].arrayBuffer(), { createFolders: false });
      blob = await zip.generateAsync({ type: "blob", compression: "STORE", streamFiles: false });
      if (blob.size > MAX_DOWNLOAD_BYTES) throw downloadSizeError();
      extension = "zip";
      description = "원본 레코드와 Blob 원문을 담은 복구용 ZIP입니다. PPTX 파일이 아닙니다.";
    } else {
      blob = boundedRecoveryJson(raw); extension = "json";
      description = "복구용 JSON 원문입니다. PPTX 파일이 아니며 바로 열리지 않을 수 있습니다.";
    }
  }
  return { blob, name: `Slide-Studio-recovery-${id ?? "unpreserved"}.${extension}`, description };
}

export async function saveAutosave(deck: Deck): Promise<void> {
  if (autosaveBlocked) throw new AutosaveRecoveryError();
  const error = documentCapacityError(deck);
  if (error) throw new Error(error);
  const stored = encodeRecovery(deck);
  writeEpoch++;
  return locked(async () => {
    if (autosaveBlocked) throw new AutosaveRecoveryError();
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("documents", "readwrite");
        const store = tx.objectStore("documents");
        let protectedCurrent = false;
        const refuse = () => { protectedCurrent = true; autosaveBlocked = true; tx.abort(); };
        const write = () => {
          try { store.put(stored, "current"); store.put(crypto.randomUUID(), REVISION_KEY); }
          catch { tx.abort(); }
        };
        const request = store.get(REVISION_KEY);
        request.onsuccess = () => {
          if (request.result === PRESERVATION_REQUIRED) { refuse(); return; }
          if (validRevision(request.result)) { write(); return; }
          // Unversioned legacy data must pass the start-up validator before it
          // can be replaced. Checking its key does not clone the large value.
          const existing = store.getKey("current");
          existing.onsuccess = () => { if (existing.result !== undefined) refuse(); else write(); };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("복구 데이터를 저장하지 못했습니다."));
        tx.onabort = () => reject(protectedCurrent ? new AutosaveRecoveryError() : tx.error || new Error("저장이 취소되었습니다."));
      });
    } finally { db.close(); }
  });
}
