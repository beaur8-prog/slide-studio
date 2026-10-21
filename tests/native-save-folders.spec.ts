import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function failure(task: () => Promise<unknown>) {
  try {
    await task();
    return null;
  } catch (error) {
    return String(error);
  }
}

async function desktop(profile: string, documents: string) {
  const filename = path.resolve("electron/main.cjs");
  const realRequire = createRequire(filename);
  const handlers = new Map<
    string,
    (event: any, payload?: any) => Promise<any>
  >();
  const dialogs: { kind: string; options: any }[] = [];
  const replies: any[] = [];
  const frame = { url: pathToFileURL(path.resolve("dist/index.html")).href };
  const contents = {
    mainFrame: frame,
    executeJavaScript: async () => true,
    printToPDF: async () => Buffer.from("%PDF-test"),
  };
  const sandbox: any = {
    __dirname: path.dirname(filename),
    process,
    Buffer,
    Uint8Array,
    URL,
    windowUnderTest: { webContents: contents, isDestroyed: () => false },
    require: (id: string) =>
      id === "electron"
        ? {
            app: {
              isPackaged: true,
              setName() {},
              setPath() {},
              setAppUserModelId() {},
              getPath: (name: string) =>
                name === "documents" ? documents : profile,
              requestSingleInstanceLock: () => false,
              quit() {},
            },
            ipcMain: {
              handle: (name: string, callback: any) =>
                handlers.set(name, callback),
              on() {},
            },
            dialog: Object.fromEntries(
              ["Open", "Save", "MessageBox"].map((kind) => [
                kind === "MessageBox" ? "showMessageBox" : `show${kind}Dialog`,
                async (_window: unknown, options: unknown) => {
                  dialogs.push({ kind, options });
                  return replies.shift() ?? { canceled: true, filePaths: [] };
                },
              ]),
            ),
          }
        : realRequire(id),
  };
  vm.runInNewContext(
    (await fs.readFile(filename, "utf8")) +
      "\nmainWindow = windowUnderTest; installIPC();",
    sandbox,
  );
  const event = { sender: contents, senderFrame: frame };
  return {
    dialogs,
    replies,
    open: () => handlers.get("slide-studio:open-file")!(event),
    save: (name = "저장한 발표.pptx", extensions = ["pptx"]) =>
      handlers.get("slide-studio:save-file")!(event, {
        name,
        extensions,
        data: new Uint8Array([80, 75, 3, 4]),
      }),
    pdf: () => handlers.get("slide-studio:export-pdf")!(event, "공유본"),
  };
}

test("native open and save start in the document folder and remember it across restarts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-save-folder-"));
  try {
    const [profile, documents, source, destination, pdfFolder] = [
      "profile",
      "documents",
      "한글 원본",
      "다른 저장 위치",
      "PDF",
    ].map((n) => path.join(root, n));
    await Promise.all(
      [profile, documents, source, destination, pdfFolder].map((n) =>
        fs.mkdir(n),
      ),
    );
    const input = path.join(source, "원본.pptx");
    await fs.writeFile(input, "presentation");
    const app = await desktop(profile, documents);
    await app.open();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(documents);
    app.replies.push({ canceled: false, filePaths: [input] });
    expect((await app.open()).name).toBe("원본.pptx");
    await app.open();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(source);
    await app.save();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(
      path.join(source, "저장한 발표.pptx"),
    );
    expect(app.dialogs.at(-1)!.options.filters[0].extensions).toEqual(["pptx"]);
    const output = path.join(destination, "새 이름.pptx");
    app.replies.push({ canceled: false, filePath: output });
    expect(await app.save()).toBe(output);
    expect([...(await fs.readFile(output))]).toEqual([80, 75, 3, 4]);
    await app.pdf();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(
      path.join(destination, "공유본.pdf"),
    );
    app.replies.push({
      canceled: false,
      filePath: path.join(pdfFolder, "공유본.pdf"),
    });
    await app.pdf();
    await app.open();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(destination);
    const restarted = await desktop(profile, documents);
    await restarted.save();
    expect(restarted.dialogs.at(-1)!.options.defaultPath).toBe(
      path.join(destination, "저장한 발표.pptx"),
    );
    await fs.rm(destination, { recursive: true });
    await restarted.open();
    expect(restarted.dialogs.at(-1)!.options.defaultPath).toBe(documents);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("save always creates PPTX and confirms a collision after completing the extension", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-save-extension-"),
  );
  try {
    const profile = path.join(root, "profile");
    await fs.mkdir(profile);
    const app = await desktop(profile, root);
    const typed = path.join(root, "한글 발표.slide");
    app.replies.push({ canceled: false, filePath: typed });
    expect(await app.save()).toBe(typed + ".pptx");
    expect(
      await fs.stat(typed).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await fs.writeFile(typed + ".pptx", "previous presentation");
    app.replies.push({ canceled: false, filePath: typed }, { response: 1 });
    expect(await app.save()).toBeNull();
    expect(await fs.readFile(typed + ".pptx", "utf8")).toBe(
      "previous presentation",
    );
    expect(app.dialogs.at(-1)!.options.detail).toBe(typed + ".pptx");
    app.replies.push({ canceled: false, filePath: typed }, { response: 0 });
    expect(await app.save()).toBe(typed + ".pptx");
    expect([...(await fs.readFile(typed + ".pptx"))]).toEqual([80, 75, 3, 4]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cancelled or failed file operations keep the folder; legacy files open but cannot be saved", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-save-folder-"));
  try {
    const documents = path.join(root, "documents"),
      profile = path.join(root, "profile");
    await fs.mkdir(documents);
    await fs.mkdir(profile);
    const legacy = path.join(root, "以前の発表.slide");
    await fs.writeFile(legacy, "legacy file");
    const app = await desktop(profile, documents);
    app.replies.push({ canceled: false, filePaths: [legacy] });
    expect((await app.open()).name).toBe(path.basename(legacy));
    app.replies.push({
      canceled: true,
      filePath: path.join(documents, "取消.pptx"),
    });
    expect(await app.save()).toBeNull();
    app.replies.push({
      canceled: false,
      filePath: path.join(root, "missing", "失敗.pptx"),
    });
    expect(await failure(() => app.save())).toContain("ENOENT");
    app.replies.push({
      canceled: false,
      filePaths: [path.join(documents, "missing.pptx")],
    });
    expect(await failure(() => app.open())).toContain("ENOENT");
    await app.open();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(root);
    expect(await failure(() => app.save("backup.slide", ["slide"]))).toContain(
      ".pptx",
    );
    expect(
      await failure(() => app.save("mixed.pptx", ["pptx", "slide"])),
    ).toContain(".pptx");
    await app.save();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(
      path.join(root, "저장한 발표.pptx"),
    );
    // Preference writes can fail without turning a successful user save into an error.
    await fs.rm(profile, { recursive: true });
    await fs.writeFile(profile, "read-only preference location");
    app.replies.push({
      canceled: false,
      filePath: path.join(documents, "成功.pptx"),
    });
    expect(await app.save()).toBe(path.join(documents, "成功.pptx"));
    await app.open();
    expect(app.dialogs.at(-1)!.options.defaultPath).toBe(documents);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
