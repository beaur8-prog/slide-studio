/** Extract standalone sfnt faces from a bounded TTC/OTC, adjusting absolute table offsets and checksums. Fonts stay local to this device. */
export function collectionFaces(
  bytes: Uint8Array,
  maximumBytes: number,
): Uint8Array[] {
  const bad = () => new Error("올바른 TTC 또는 OTC 글꼴 모음이 아닙니다.");
  if (bytes.length < 12 || bytes.length > maximumBytes) throw bad();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0x74746366) return [bytes];
  const version = view.getUint32(4),
    count = view.getUint32(8);
  if (
    ![0x10000, 0x20000].includes(version) ||
    count < 1 ||
    count > 128 ||
    12 + count * 4 > bytes.length
  )
    throw bad();
  const faces: Uint8Array[] = [];
  let total = 0;
  const checksum = (data: Uint8Array) => {
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      let word = 0;
      for (let j = 0; j < 4; j++) word = (word << 8) | (data[i + j] ?? 0);
      sum = (sum + (word >>> 0)) >>> 0;
    }
    return sum;
  };
  for (let i = 0; i < count; i++) {
    const offset = view.getUint32(12 + i * 4);
    if (offset + 12 > bytes.length) throw bad();
    const signature = view.getUint32(offset),
      tables = view.getUint16(offset + 4);
    if (
      ![0x10000, 0x4f54544f].includes(signature) ||
      tables < 1 ||
      tables > 100 ||
      offset + 12 + tables * 16 > bytes.length
    )
      throw bad();
    const records: {
      tag: number;
      offset: number;
      length: number;
      dest: number;
    }[] = [];
    let size = 12 + tables * 16;
    for (let t = 0; t < tables; t++) {
      const at = offset + 12 + t * 16,
        from = view.getUint32(at + 8),
        length = view.getUint32(at + 12),
        tag = view.getUint32(at);
      if (from > bytes.length || length > bytes.length - from) throw bad();
      records.push({ tag, offset: from, length, dest: size });
      size += (length + 3) & ~3;
      if (size > maximumBytes) throw bad();
    }
    total += size;
    if (total > 256 * 1024 * 1024)
      throw new Error(
        "글꼴 모음이 너무 큽니다. 필요한 글꼴을 개별 파일로 추가하세요.",
      );
    const face = new Uint8Array(size),
      out = new DataView(face.buffer);
    face.set(bytes.subarray(offset, offset + 12));
    let head: number | undefined;
    records.forEach((table, t) => {
      face.set(
        bytes.subarray(table.offset, table.offset + table.length),
        table.dest,
      );
      if (table.tag === 0x68656164) {
        if (table.length < 12) throw bad();
        head = table.dest;
        out.setUint32(head + 8, 0);
      }
      const at = 12 + t * 16;
      out.setUint32(at, table.tag);
      out.setUint32(
        at + 4,
        checksum(face.subarray(table.dest, table.dest + table.length)),
      );
      out.setUint32(at + 8, table.dest);
      out.setUint32(at + 12, table.length);
    });
    if (head !== undefined)
      out.setUint32(head + 8, (0xb1b0afba - checksum(face)) >>> 0);
    faces.push(face);
  }
  return faces;
}
