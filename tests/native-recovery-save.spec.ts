import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { createRecoverySaver, decodeRecoveryPayload } = require("../electron/recovery-save.cjs");
const { createAtomicWriter } = require("../electron/atomic-write.cjs");
function safeName(input: string, extension: string) {
  let value = path.win32.basename(path.posix.basename(input)).replace(/[\x00-\x1f<>:"/\\|?*]/g, "-").replace(/^\.+/, "").replace(/[. ]+$/, "") || "recovery";
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(value)) value = "_" + value;
  return value.toLowerCase().endsWith("." + extension) ? value : value + "." + extension;
}
async function ipc(profile: string, platform: string) {
  const filename = path.resolve("electron/main.cjs"), realRequire = createRequire(filename);
  const handlers = new Map<string, any>(), replies: any[] = [], dialogs: any[] = [];
  const frame = { url: pathToFileURL(path.resolve("dist/index.html")).href }, contents = { mainFrame: frame, executeJavaScript: async () => true };
  const sandbox: any = { __dirname: path.dirname(filename), process: { ...process, platform }, Buffer, Uint8Array, URL,
    windowUnderTest: { webContents: contents, isDestroyed: () => false },
    require: (id: string) => id === "electron" ? {
      app: { isPackaged: true, setName() {}, setPath() {}, setAppUserModelId() {}, getPath: () => profile, requestSingleInstanceLock: () => false, quit() {} },
      ipcMain: { handle: (name: string, callback: any) => handlers.set(name, callback), on() {} },
      dialog: { showSaveDialog: async (_window: unknown, options: any) => { dialogs.push(options); return replies.shift() ?? { canceled: true }; },
        showMessageBox: async () => replies.shift() ?? { response: 1 } },
    } : realRequire(id),
  };
  vm.runInNewContext((await fs.readFile(filename, "utf8")) + "\nmainWindow=windowUnderTest; installIPC(); this.contexts=fileContexts;", sandbox);
  const trusted = { sender: contents, senderFrame: frame };
  return { dialogs, replies, trusted, contexts: sandbox.contexts,
    call: async (payload: unknown, event = trusted) => { try { return await handlers.get("slide-studio:save-recovery-data")(event, payload); } catch (error: any) { throw new Error(error.message); } } };
}
for (const platform of ["win32", "darwin"]) test(`${platform} recovery IPC only permits a trusted editor and user-chosen diagnostic save without changing presentation context`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-native-recovery-"));
  try {
    const app = await ipc(root, platform), data = new Uint8Array([99, 123, 34, 65, 34, 125, 88]).subarray(1, 6);
    const input = path.join(root, "current.pptx"); await fs.writeFile(input, "source PPTX");
    const issued = app.contexts.issue(input, Buffer.from("source PPTX"));
    const payload = { name: "한글 복구.json", data, extension: "json" };
    await expect(app.call(payload, { sender: {}, senderFrame: app.trusted.senderFrame } as any)).rejects.toThrow("editor window");
    await expect(app.call(payload, { sender: app.trusted.sender, senderFrame: { url: app.trusted.senderFrame.url } } as any)).rejects.toThrow("editor window");
    expect(app.dialogs).toHaveLength(0);
    expect(await app.call(payload)).toBe(false); // Cancel never writes.
    expect(app.dialogs.at(-1).filters).toEqual([{ name: "Recovery data", extensions: ["json"] }]);
    expect(app.dialogs.at(-1).defaultPath).toBe(path.join(root, "한글 복구.json"));
    const output = path.join(root, "기존.json"); await fs.writeFile(output, "old recovery"); await fs.chmod(output, 0o640);
    // VM platform labels do not change the real host filesystem. Windows
    // exposes writable mode bits differently from POSIX, so preserve what the
    // host actually reports while keeping a strict Unix fixture assertion.
    const originalMode = (await fs.stat(output)).mode & 0o777;
    if (process.platform !== "win32") expect(originalMode).toBe(0o640);
    app.replies.push({ canceled: false, filePath: output });
    expect(await app.call(payload)).toBe(true); expect([...await fs.readFile(output)]).toEqual([...data]);
    expect((await fs.stat(output)).mode & 0o777).toBe(originalMode);
    expect(app.contexts.get(issued.token).path).toBe(input); expect(app.contexts.files.size).toBe(1);
    expect(await fs.readFile(input, "utf8")).toBe("source PPTX");
    expect(await fs.readdir(root)).not.toContain("recent-presentations.json");
    expect(await fs.readdir(root)).not.toContain("file-dialog-location.json");
    for (const bad of [{ ...payload, path: output }, { ...payload, context: { token: issued.token } },
      { ...payload, extension: "exe" }, { ...payload, data: [1] }, null]) await expect(app.call(bad)).rejects.toThrow("recovery data");
    expect(app.dialogs).toHaveLength(2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test("recovery payloads preserve byte slices, bound size, and sanitise Mac/Windows filename suggestions", () => {
  const data = new Uint8Array([9, 1, 2, 3, 8]).subarray(1, 4);
  expect([...decodeRecoveryPayload({ name: "../한글.json", data, extension: "json" }, safeName).data]).toEqual([1, 2, 3]);
  expect(decodeRecoveryPayload({ name: "C:\\Users\\x\\CON", data, extension: "bin" }, safeName).name).toBe("_CON.bin");
  expect(decodeRecoveryPayload({ name: "/Users/x/복구 자료", data, extension: "zip" }, safeName).name).toBe("복구 자료.zip");
  const huge = new Uint8Array(1); Object.defineProperty(huge, "byteLength", { value: 256 * 1024 * 1024 + 1 });
  expect(() => decodeRecoveryPayload({ name: "huge", data: huge, extension: "json" }, safeName)).toThrow("256 MiB");
  expect(decodeRecoveryPayload({ name: "empty", data: new Uint8Array(0), extension: "bin" }, safeName).data.length).toBe(0);
});
test("recovery save confirms appended-extension collisions and preserves a file changed during atomic write", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "slide-recovery-race-"));
  try {
    const chosen = path.join(root, "자료.pptx"), output = chosen + ".json";
    await fs.writeFile(output, "previous");
    const replies: any[] = [{ canceled: false, filePath: chosen }, { response: 1 }];
    const dialog = { showSaveDialog: async () => replies.shift(), showMessageBox: async () => replies.shift() };
    const file = { name: "../recovery", data: new Uint8Array([1, 2]), extension: "json" };
    const make = (atomicWrite = createAtomicWriter()) => createRecoverySaver({ dialog, getWindow: () => ({}), defaultPath: async (name: string) => path.join(root, name), safeFilename: safeName, atomicWrite });
    expect(await make()(file)).toBe(false); expect(await fs.readFile(output, "utf8")).toBe("previous");
    replies.push({ canceled: false, filePath: chosen }, { response: 0 });
    expect(await make()(file)).toBe(true); expect([...await fs.readFile(output)]).toEqual([1, 2]);
    expect(await fs.stat(chosen).then(() => true, () => false)).toBe(false);
    replies.push({ canceled: false, filePath: output });
    const atomic = createAtomicWriter({ ...fs, writeFile: async (...args: any[]) => { await (fs.writeFile as any)(...args); await fs.writeFile(output, "changed elsewhere"); } });
    await expect(make(atomic)(file)).rejects.toThrow("파일이 변경");
    expect(await fs.readFile(output, "utf8")).toBe("changed elsewhere");
    expect((await fs.readdir(root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
