import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

async function desktop(platform: string, argv: string[] = []) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-file-open-'));
  const filename = path.resolve('electron/main.cjs');
  const require = createRequire(filename);
  let resolveReady!: () => void;
  let ready = false;
  const whenReady = new Promise<void>(resolve => { resolveReady = resolve; });
  const events = new EventEmitter();
  const handlers = new Map<string, (...args: any[]) => any>();
  const frame = { url: pathToFileURL(path.resolve('dist/index.html')).href };
  const notices: unknown[][] = [];
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    setWindowOpenHandler() {},
    send: (...args: unknown[]) => notices.push(args),
  });
  let windowCount = 0, destroyed = false;
  let resolveDialog!: (value: any) => void;
  const app = Object.assign(events, {
    isPackaged: true, setName() {}, setPath() {}, setAppUserModelId() {},
    getPath: () => profile, getVersion: () => 'test',
    requestSingleInstanceLock: () => true, quit() {},
    isReady: () => ready, whenReady: () => whenReady,
    setAboutPanelOptions() {}, dock: { setIcon() {} },
  });
  const sandbox: any = {
    __dirname: path.dirname(filename), process: { ...process, platform, argv: ['Slide Studio', ...argv] },
    Buffer, Uint8Array, URL, setTimeout, clearTimeout,
    require: (id: string) => id === 'electron' ? {
      app,
      BrowserWindow: class extends EventEmitter {
        webContents = contents;
        constructor() { super(); windowCount++; }
        isDestroyed() { return destroyed; }
        isMinimized() { return false; }
        isFullScreen() { return false; }
        show() {} focus() {} setMenuBarVisibility() {}
        async loadFile() {}
      },
      ipcMain: { handle: (name: string, fn: any) => handlers.set(name, fn), on() {} },
      dialog: { showOpenDialog: () => new Promise(resolve => { resolveDialog = resolve; }) },
      Menu: { buildFromTemplate: (value: any) => value, setApplicationMenu() {} },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
        on() {}, webRequest: { onBeforeRequest() {}, onHeadersReceived() {} } } },
    } : id === './studio-updater.cjs' ? { createStudioUpdater: () => ({
      onChange() {}, start() {}, menuTemplate: () => [],
    }) } : require(id),
  };
  vm.runInNewContext(await fs.readFile(filename, 'utf8'), sandbox);
  const event = { sender: contents, senderFrame: frame };
  return {
    profile, events, handlers, notices, event,
    count: () => windowCount,
    async ready() { ready = true; resolveReady(); await new Promise(resolve => setTimeout(resolve, 20)); },
    take: (...args: any[]) => handlers.get('slide-studio:take-requested-file')!(event, ...args),
    finishDialog: (value: any) => resolveDialog(value),
    destroy() { destroyed = true; },
  };
}

test('Finder requests received before ready survive until the trusted editor asks for the file', async () => {
  const app = await desktop('darwin');
  try {
    const file = path.join(app.profile, '한글 발표 자료.PPTX');
    await fs.writeFile(file, Buffer.from([80, 75, 3, 4]));
    let prevented = 0;
    const event = { preventDefault: () => prevented++ };
    app.events.emit('open-file', event, file);
    app.events.emit('open-file', event, file);
    expect(app.count()).toBe(0);
    await app.ready();
    expect(prevented).toBe(2);
    expect(app.count()).toBe(1);
    expect(app.notices).toEqual([]); // No push can race renderer startup.
    expect(await app.take()).toMatchObject({ name: '한글 발표 자료.PPTX' });
    expect(await app.take()).toBeNull();
    const recent = JSON.parse(await fs.readFile(path.join(app.profile, 'recent-presentations.json'), 'utf8'));
    expect(JSON.stringify(recent)).toContain(file);
    const directory = JSON.parse(await fs.readFile(path.join(app.profile, 'file-dialog-location.json'), 'utf8'));
    expect(directory.directory).toBe(app.profile);
  } finally { await fs.rm(app.profile, { recursive: true, force: true }); }
});

for (const platform of ['win32', 'linux']) test(`${platform} startup and second-instance launch arguments open in order in one editor`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-launch-paths-'));
  const first = path.join(root, '첫 발표.pptx'), second = path.join(root, '두 번째.pptx');
  await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
  const app = await desktop(platform, ['--inspect=0', '--log-file=ignored.pptx', first, 'https://example.com/no.pptx']);
  try {
    await app.ready();
    expect((await app.take()).name).toBe('첫 발표.pptx');
    app.events.emit('second-instance', {}, ['Slide Studio', '두 번째.pptx', first], root);
    expect(app.notices.some(item => item[0] === 'slide-studio:open-requested')).toBe(true);
    expect((await app.take()).name).toBe('두 번째.pptx');
    expect((await app.take()).name).toBe('첫 발표.pptx');
    expect(await app.take()).toBeNull();
    app.events.emit('second-instance', {}, ['Slide Studio', pathToFileURL(second).href], root);
    expect((await app.take()).name).toBe('두 번째.pptx');
    expect(app.count()).toBe(1);
  } finally { await fs.rm(root, { recursive: true, force: true }); await fs.rm(app.profile, { recursive: true, force: true }); }
});

test('OS file reads reject untrusted callers and arbitrary paths; a missing request does not block the next file', async () => {
  const app = await desktop('darwin');
  try {
    await app.ready();
    const file = path.join(app.profile, 'valid.pptx'); await fs.writeFile(file, 'valid');
    const open = (name: string) => app.events.emit('open-file', { preventDefault() {} }, path.join(app.profile, name));
    open('missing.pptx'); open('valid.pptx');
    const take = app.handlers.get('slide-studio:take-requested-file')!;
    expect(() => take({ ...app.event, sender: {} })).toThrow('editor window');
    expect(() => app.take('/private/arbitrary.pptx')).toThrow('경로나 인수');
    const error = await app.take().then(() => '', (error: unknown) => String(error));
    expect(error).toContain('ENOENT');
    expect((await app.take()).name).toBe('valid.pptx');
    expect(await app.take()).toBeNull();
  } finally { await fs.rm(app.profile, { recursive: true, force: true }); }
});

test('an OS request waits for an existing native file dialog without being consumed', async () => {
  const app = await desktop('darwin');
  try {
    await app.ready();
    const opening = app.handlers.get('slide-studio:open-file')!(app.event);
    await new Promise(resolve => setTimeout(resolve, 20));
    const file = path.join(app.profile, 'after-dialog.pptx'); await fs.writeFile(file, 'valid');
    app.events.emit('open-file', { preventDefault() {} }, file);
    expect(app.take()).toBeNull();
    app.finishDialog({ canceled: true }); await opening;
    expect((await app.take()).name).toBe('after-dialog.pptx');
    expect(await app.take()).toBeNull();
  } finally { await fs.rm(app.profile, { recursive: true, force: true }); }
});

test('renderer waits for startup and protects unsaved edits for externally requested PPTX files', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as any;
    state.__requested = JSON.parse(sessionStorage.getItem('__startupFileRequests') || '[]');
    state.__allowReplace = false;
    window.confirm = () => state.__allowReplace;
    window.desktop = {
      platform: 'darwin', windowSessionId: 'file-open-test',
      onMenu: () => () => {}, onOpenRequested: (callback: () => void) => { state.__openRequested = callback; return () => {}; },
      takeRequestedFile: async () => { const file = state.__requested.shift(); return file ? { name: file.name, data: new Uint8Array(file.data) } : null; },
    } as any;
  });
  await page.goto('http://127.0.0.1:5190');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  const bytes = await page.evaluate(async () => {
    const { blankDeck } = await import('/src/model.ts');
    const { exportPptx } = await import('/src/io.ts');
    const deck = blankDeck(); deck.name = '외부에서 연 발표';
    return [...await exportPptx(deck)];
  });
  const request = () => page.evaluate(data => {
    const state = window as any;
    state.__requested.push({ name: '외부에서 연 발표.pptx', data }); state.__openRequested();
  }, bytes);
  await page.getByRole('textbox', { name: '프레젠테이션 이름' }).fill('편집 중인 문서');
  await request();
  await expect(page.getByRole('textbox', { name: '프레젠테이션 이름' })).toHaveValue('편집 중인 문서');
  await expect.poll(() => page.evaluate(() => (window as any).__requested.length)).toBe(0);
  await page.evaluate(() => { (window as any).__allowReplace = true; });
  await request();
  await expect(page.getByRole('textbox', { name: '프레젠테이션 이름' })).toHaveValue('외부에서 연 발표');
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.evaluate(data => sessionStorage.setItem('__startupFileRequests', JSON.stringify([
    { name: '시작할 때 받은 파일.pptx', data },
  ])), bytes);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '프레젠테이션 이름' })).toHaveValue('외부에서 연 발표');
});

test('preload only takes OS-requested files and hides Electron event objects from subscribers', async () => {
  let bridge: any;
  const listeners = new Map<string, (...args: any[]) => void>();
  const calls: unknown[][] = [];
  vm.runInNewContext(await fs.readFile('electron/preload.cjs', 'utf8'), {
    process, window: { addEventListener() {} },
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } },
      ipcRenderer: {
        invoke: (...args: unknown[]) => { calls.push(args); return Promise.resolve(null); },
        on: (channel: string, listener: (...args: any[]) => void) => listeners.set(channel, listener),
        removeListener: (channel: string, listener: any) => { expect(listeners.get(channel)).toBe(listener); listeners.delete(channel); },
      },
    }),
  });
  await bridge.takeRequestedFile('/arbitrary/path.pptx');
  expect(calls).toEqual([['slide-studio:take-requested-file']]);
  let received: unknown[] | undefined;
  const unsubscribe = bridge.onOpenRequested((...args: unknown[]) => { received = args; });
  listeners.get('slide-studio:open-requested')!({ sender: 'private' }, '/private/path.pptx');
  expect(received).toEqual([]);
  unsubscribe(); expect(listeners.size).toBe(0);
});
