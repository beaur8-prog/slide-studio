// Chromium bounds one IndexedDB structured value at about 127 MiB. Blob bytes
// are stored outside that value, so large recovery documents use an atomic
// Blob envelope. Small documents retain the existing structured-clone path.
const INLINE_BUDGET = 32 * 1024 * 1024;
const STRING_CHUNK = 256 * 1024;
const FORMAT = "slide-studio-recovery-json";
const MAX_JSON_CHARS = 200 * 1024 * 1024;

function estimate(value: unknown, remaining: number): number {
  if (typeof value === "string") return 2 * value.length + 16;
  if (!value || typeof value !== "object") return 16;
  let size = 64;
  for (const [key, child] of Object.entries(value)) {
    size += 2 * key.length + 32 + estimate(child, remaining - size);
    if (size > remaining) break;
  }
  return size;
}

/** Encode JSON in bounded string fragments, never stringify the whole deck or
 * one entire base64 asset. Chunk boundaries also preserve lone surrogates. */
export function jsonBlob(value: unknown): Blob {
  const parts: string[] = [];
  let buffer = "";
  const append = (text: string) => {
    if (buffer.length + text.length > STRING_CHUNK) {
      if (buffer) parts.push(buffer);
      buffer = "";
    }
    if (text.length >= STRING_CHUNK) parts.push(text);
    else buffer += text;
  };
  const parents = new Set<object>();
  const write = (item: unknown) => {
    if (typeof item === "string") {
      append('"');
      for (let start = 0; start < item.length; start += STRING_CHUNK)
        append(
          JSON.stringify(item.slice(start, start + STRING_CHUNK)).slice(1, -1),
        );
      append('"');
    } else if (!item || typeof item !== "object") {
      append(JSON.stringify(item) ?? "null");
    } else {
      if (parents.has(item))
        throw new TypeError("복구 데이터에 순환 참조가 있습니다.");
      parents.add(item);
      if (Array.isArray(item)) {
        append("[");
        for (let i = 0; i < item.length; i++) {
          if (i) append(",");
          write(item[i]);
        }
        append("]");
      } else {
        append("{");
        let count = 0;
        for (const [key, child] of Object.entries(item)) {
          if (child === undefined) continue;
          if (count++) append(",");
          write(key);
          append(":");
          write(child);
        }
        append("}");
      }
      parents.delete(item);
    }
  };
  write(value);
  if (buffer) parts.push(buffer);
  return new Blob(parts, { type: "application/json" });
}

export function encodeRecovery<T>(
  value: T,
): T | { format: string; version: 1; data: Blob } {
  return estimate(value, INLINE_BUDGET) <= INLINE_BUDGET
    ? value
    : {
        format: FORMAT,
        version: 1,
        data: jsonBlob(value),
      };
}

export async function decodeRecovery<T>(value: unknown): Promise<T> {
  if (
    value &&
    typeof value === "object" &&
    "format" in value &&
    value.format === FORMAT
  ) {
    const envelope = value as { version?: unknown; data?: unknown };
    if (
      envelope.version !== 1 ||
      !(envelope.data instanceof Blob) ||
      envelope.data.size > MAX_JSON_CHARS * 3 ||
      envelope.data.type !== "application/json"
    )
      throw new Error("복구 저장 형식을 읽을 수 없습니다.");
    const text = await envelope.data.text();
    if (text.length > MAX_JSON_CHARS)
      throw new Error("복구 문서가 너무 큽니다.");
    return JSON.parse(text) as T;
  }
  return value as T;
}
