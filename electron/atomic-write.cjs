"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function createAtomicWriter(filesystem = fs) {
  return async function atomicWrite(
    filename,
    buffer,
    { mode = 0o600, beforeReplace } = {},
  ) {
    const temporary = path.join(
      path.dirname(filename),
      `.${path.basename(filename)}.${randomUUID()}.tmp`,
    );
    try {
      await filesystem.writeFile(temporary, buffer, { flag: "wx", mode });
      // Validate immediately before replacing the destination, after potentially
      // expensive serialization and disk I/O have completed.
      await beforeReplace?.();
      await filesystem.rename(temporary, filename);
    } finally {
      await filesystem.rm(temporary, { force: true }).catch(() => {});
    }
  };
}
module.exports = { atomicWrite: createAtomicWriter(), createAtomicWriter };
