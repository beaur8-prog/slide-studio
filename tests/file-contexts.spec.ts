import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const { FileContexts } = createRequire(import.meta.url)(
  "../electron/file-contexts.cjs",
);

test("file capabilities detect external content changes and deletion without relying on timestamps", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-file-context-"));
  try {
    const input = path.join(root, "기획.pptx"),
      bytes = Buffer.from("original");
    await fs.writeFile(input, bytes);
    const contexts = new FileContexts(),
      issued = contexts.issue(input, bytes),
      file = contexts.get(issued.token);
    expect(issued.path).toBe(input);
    expect((await contexts.inspect(file)).status).toBe("unchanged");
    const stat = await fs.stat(input);
    await fs.writeFile(input, "external");
    await fs.utimes(input, stat.atime, stat.mtime);
    expect((await contexts.inspect(file)).status).toBe("changed");
    await fs.writeFile(input, bytes);
    expect((await contexts.inspect(file)).status).toBe("unchanged");
    await fs.rm(input);
    expect((await contexts.inspect(file)).status).toBe("missing");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("file capabilities do not accept a renderer path, remain bounded and expire on reset", () => {
  const contexts = new FileContexts({ limit: 2 });
  for (const bad of [
    "/tmp/private.pptx",
    "https://example.test/file",
    {},
    null,
    1,
  ])
    expect(() => contexts.get(bad)).toThrow("Invalid");
  expect(contexts.get(undefined)).toBeUndefined();
  expect(() => contexts.issue("relative.pptx", Buffer.from("a"))).toThrow();
  expect(() => contexts.issue("/tmp/legacy.slide", Buffer.from("a"))).toThrow();
  const a = contexts.issue("/tmp/a.pptx", Buffer.from("a")),
    b = contexts.issue("/tmp/b.pptx", Buffer.from("b")),
    c = contexts.issue("/tmp/c.pptx", Buffer.from("c"));
  expect(contexts.get(a.token)).toBeUndefined();
  expect(contexts.get(b.token).path).toBe("/tmp/b.pptx");
  expect(contexts.get(c.token).path).toBe("/tmp/c.pptx");
  contexts.clear();
  expect(contexts.get(c.token)).toBeUndefined();
});

test("large-file fingerprints cover chunk boundaries and refuse files above the actual byte budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-file-chunks-"));
  try {
    const file = path.join(root, "large.pptx"),
      bytes = Buffer.alloc(1024 * 1024 + 17, 42),
      contexts = new FileContexts({ maxBytes: bytes.length });
    await fs.writeFile(file, bytes);
    const entry = contexts.get(contexts.issue(file, bytes).token);
    expect((await contexts.inspect(entry)).status).toBe("unchanged");
    bytes[256 * 1024] = 43;
    await fs.writeFile(file, bytes);
    expect((await contexts.inspect(entry)).status).toBe("changed");
    await fs.appendFile(file, Buffer.from([1]));
    expect(await contexts.inspect(entry)).toEqual({ status: "changed" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a destination modified while the temporary file is written is preserved and the temporary file is removed", async () => {
  const { createPresentationSaver } = createRequire(import.meta.url)(
      "../electron/presentation-save.cjs",
    ),
    { createAtomicWriter } = createRequire(import.meta.url)(
      "../electron/atomic-write.cjs",
    );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-file-race-"));
  try {
    const input = path.join(root, "guard.pptx"),
      bytes = Buffer.from("original");
    await fs.writeFile(input, bytes);
    const contexts = new FileContexts(),
      context = contexts.issue(input, bytes),
      dialogs: unknown[] = [];
    const atomicWrite = createAtomicWriter({
      ...fs,
      writeFile: async (name: string, data: Uint8Array, options: any) => {
        await fs.writeFile(name, data, options);
        await fs.writeFile(input, "changed during save");
      },
    });
    const saver = createPresentationSaver({
      contexts,
      dialog: {
        showSaveDialog: async () => {
          dialogs.push("Save");
          return { canceled: true };
        },
      },
      getWindow: () => null,
      defaultPath: async () => input,
      atomicWrite,
      onSaved: async () => {},
    });
    await expect(
      saver(
        { name: "guard.pptx", data: Buffer.from("our edit") },
        { token: context.token },
      ),
    ).rejects.toMatchObject({ code: "SLIDE_FILE_CHANGED" });
    expect(await fs.readFile(input, "utf8")).toBe("changed during save");
    expect(await fs.readdir(root)).toEqual(["guard.pptx"]);
    expect(dialogs).toHaveLength(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
