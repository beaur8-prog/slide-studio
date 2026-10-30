import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Execute the real main-process file handlers against temporary on-disk files;
 * replace only Electron window/dialog surfaces, never the filesystem. */
export async function nativeDesktop(profile: string, documents: string) {
  const filename = path.resolve("electron/main.cjs"),
    realRequire = createRequire(filename),
    handlers = new Map<string, (event: any, payload?: any) => Promise<any>>();
  const dialogs: { kind: string; options: any }[] = [],
    replies: any[] = [];
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
      "\nmainWindow=windowUnderTest;installIPC();",
    sandbox,
  );
  const event = { sender: contents, senderFrame: frame };
  const invoke = async (name: string, payload?: unknown, from = event) => {
    try {
      return await handlers.get(`slide-studio:${name}`)!(from, payload);
    } catch (error: any) {
      throw Object.assign(new Error(error.message), { code: error.code });
    }
  };
  return {
    dialogs,
    replies,
    event,
    call: invoke,
    open: () => invoke("open-file"),
    save: (options: Record<string, unknown> = {}) =>
      invoke("save-file", {
        name: "검수.pptx",
        extensions: ["pptx"],
        data: new Uint8Array([80, 75, 3, 4]),
        ...options,
      }),
  };
}
