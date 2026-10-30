import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nativeDesktop } from "./helpers/native-desktop";

test("normal Save writes the currently opened PPTX without asking for its name again", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "현재 한글 발표.pptx");
    await fs.writeFile(input, "original");
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    const saved = await app.save({ context: { token: opened.context?.token } });
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(0);
    expect(saved?.path).toBe(await fs.realpath(input));
    expect([...(await fs.readFile(input))]).toEqual([80, 75, 3, 4]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a new presentation chooses a path once and subsequent saves reuse the returned context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      output = path.join(root, "새 발표.pptx");
    app.replies.push({ canceled: false, filePath: output });
    const first = await app.save({ context: {} });
    expect(first.path).toBe(output);
    expect(typeof first.token).toBe("string");
    const second = await app.save({
      context: { token: first.token },
      data: new Uint8Array([1, 2, 3]),
    });
    expect(second.path).toBe(output);
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(1);
    expect([...(await fs.readFile(output))]).toEqual([1, 2, 3]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Save As cancellation retains the original context; a successful copy becomes the next Save destination", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "원본.pptx"),
      copy = path.join(root, "사본.pptx");
    await fs.writeFile(input, "original");
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open(),
      context = { token: opened.context.token };
    app.replies.push({ canceled: true });
    expect(
      await app.save({ context: { ...context, saveAs: true } }),
    ).toBeNull();
    expect(await fs.readFile(input, "utf8")).toBe("original");
    app.replies.push({ canceled: false, filePath: copy });
    const copied = await app.save({ context: { ...context, saveAs: true } });
    expect(copied.path).toBe(copy);
    expect(await fs.readFile(input, "utf8")).toBe("original");
    const saves = app.dialogs.filter((d) => d.kind === "Save").length;
    await app.save({
      context: { token: copied.token },
      data: new Uint8Array([5, 6, 7]),
    });
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(saves);
    expect([...(await fs.readFile(copy))]).toEqual([5, 6, 7]);
    expect(await fs.readFile(input, "utf8")).toBe("original");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an external edit is preserved on cancellation and overwritten only after the actual conflict prompt is accepted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "외부 편집.pptx");
    await fs.writeFile(input, "original");
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    await fs.writeFile(input, "outside edit");
    app.replies.push({ response: 2 });
    expect(
      await app.save({ context: { token: opened.context.token } }),
    ).toBeNull();
    expect(await fs.readFile(input, "utf8")).toBe("outside edit");
    expect(app.dialogs.at(-1)?.options.message).toContain("다른 프로그램");
    app.replies.push({ response: 1 });
    const saved = await app.save({ context: { token: opened.context.token } });
    expect(saved.path).toBe(await fs.realpath(input));
    expect([...(await fs.readFile(input))]).toEqual([80, 75, 3, 4]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("an external edit can be saved as a separate file without altering the changed original", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "원본.pptx"),
      copy = path.join(root, "분리한 작업.pptx");
    await fs.writeFile(input, "original");
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    await fs.writeFile(input, "outside edit");
    app.replies.push({ response: 0 }, { canceled: false, filePath: copy });
    const saved = await app.save({ context: { token: opened.context.token } });
    expect(saved.path).toBe(copy);
    expect(await fs.readFile(input, "utf8")).toBe("outside edit");
    expect([...(await fs.readFile(copy))]).toEqual([80, 75, 3, 4]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a deleted source uses Save As and a legacy project cannot be an overwrite destination", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "삭제된.pptx"),
      legacy = path.join(root, "이전.slide");
    await fs.writeFile(input, "original");
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    await fs.rm(input);
    app.replies.push({ canceled: true });
    expect(
      await app.save({ context: { token: opened.context.token } }),
    ).toBeNull();
    expect(app.dialogs.at(-1)?.kind).toBe("Save");
    expect(await fs.stat(input).catch(() => null)).toBeNull();
    await fs.writeFile(legacy, "legacy");
    app.replies.push({ canceled: false, filePaths: [legacy] });
    expect((await app.open()).context).toBeUndefined();
    app.replies.push({ canceled: true });
    expect(await app.save({ context: {} })).toBeNull();
    expect(await fs.readFile(legacy, "utf8")).toBe("legacy");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("file-context payloads reject arbitrary paths and untrusted senders without modifying unrelated files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      secret = path.join(root, "다른 파일.pptx");
    await fs.writeFile(secret, "keep");
    for (const context of [
      { token: secret },
      { path: secret },
      [],
      null,
      { saveAs: "yes" },
    ])
      await expect(app.save({ context })).rejects.toThrow();
    await expect(
      app.call(
        "save-file",
        {
          name: "x.pptx",
          extensions: ["pptx"],
          data: new Uint8Array([1]),
          context: {},
        },
        { ...app.event, sender: {} } as any,
      ),
    ).rejects.toThrow("editor window");
    expect(await fs.readFile(secret, "utf8")).toBe("keep");
    expect(app.dialogs).toHaveLength(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("saving a current file retains its Unix access mode", async () => {
  test.skip(
    process.platform === "win32",
    "Unix mode bits are not a Windows file permission model",
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-current-save-"));
  try {
    const app = await nativeDesktop(root, root),
      input = path.join(root, "공유 발표.pptx");
    await fs.writeFile(input, "original", { mode: 0o640 });
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    await app.save({ context: { token: opened.context.token } });
    expect((await fs.stat(input)).mode & 0o777).toBe(0o640);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("read-only sources offer another destination without replacing the protected original", async () => {
  test.skip(
    process.platform === "win32",
    "Windows ACL permissions require the native Windows test environment",
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-readonly-save-"));
  const input = path.join(root, "읽기 전용.pptx");
  try {
    const app = await nativeDesktop(root, root),
      copy = path.join(root, "편집한 사본.pptx");
    await fs.writeFile(input, "protected", { mode: 0o444 });
    app.replies.push({ canceled: false, filePaths: [input] });
    const opened = await app.open();
    app.replies.push({ canceled: false, filePath: copy });
    const saved = await app.save({ context: { token: opened.context.token } });
    expect(saved.path).toBe(copy);
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(1);
    expect(await fs.readFile(input, "utf8")).toBe("protected");
    expect((await fs.stat(input)).mode & 0o777).toBe(0o444);
  } finally {
    await fs.chmod(input, 0o600).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("opening a symbolic link binds Save to its actual PPTX and retains the link", async () => {
  test.skip(
    process.platform === "win32",
    "Creating Windows symlinks requires separate privileges",
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-alias-save-"));
  try {
    const app = await nativeDesktop(root, root),
      target = path.join(root, "원본.pptx"),
      alias = path.join(root, "바로가기.pptx");
    await fs.writeFile(target, "original");
    await fs.symlink(target, alias);
    app.replies.push({ canceled: false, filePaths: [alias] });
    const opened = await app.open();
    expect(opened.context.path).toBe(await fs.realpath(target));
    await app.save({ context: { token: opened.context.token } });
    expect((await fs.lstat(alias)).isSymbolicLink()).toBe(true);
    expect([...(await fs.readFile(target))]).toEqual([80, 75, 3, 4]);
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a stale file token asks for a destination instead of silently selecting an old file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-stale-save-"));
  try {
    const app = await nativeDesktop(root, root);
    app.replies.push({ canceled: true });
    expect(
      await app.save({
        context: { token: "11111111-1111-4111-8111-111111111111" },
      }),
    ).toBeNull();
    expect(app.dialogs.filter((d) => d.kind === "Save")).toHaveLength(1);
    expect(await fs.readdir(root)).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
