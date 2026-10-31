import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

test('native file transport accepts typed byte slices without expanding or leaking surrounding bytes', () => {
  const filename = path.resolve('electron/main.cjs');
  const realRequire = createRequire(filename);
  const sandbox: any = {
    __dirname: path.dirname(filename), process, Buffer, Uint8Array, URL,
    require: (id: string) => id === 'electron' ? { app: {
      isPackaged: true, setName() {}, setPath() {}, getPath() { return '/tmp'; },
      setAppUserModelId() {},
      requestSingleInstanceLock() { return false; }, quit() {},
    } } : realRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nthis.decode = decodeFilePayload;', sandbox);
  const bytes = new Uint8Array([99, 80, 75, 3, 4, 88]);
  const output = sandbox.decode({ name: '한글 문서.pptx', extensions: ['pptx'], data: bytes.subarray(1, 5) });
  expect([...output.data]).toEqual([80, 75, 3, 4]);
  expect(output.data.buffer).toBe(bytes.buffer);
  expect(output.name).toBe('한글 문서.pptx');
  expect(() => sandbox.decode({ name: 'bad', extensions: ['pptx'], data: [1, 2, 3] })).toThrow();
  expect(() => sandbox.decode({ name: 'bad', extensions: ['exe'], data: bytes })).toThrow();
});

test('Windows save names avoid reserved devices without changing Korean names', () => {
  const filename = path.resolve('electron/main.cjs');
  const realRequire = createRequire(filename);
  let appId = '';
  const sandbox: any = {
    __dirname: path.dirname(filename), process: { ...process, platform: 'win32' }, Buffer, Uint8Array, URL,
    require: (id: string) => id === 'electron' ? { app: {
      isPackaged: true, setName() {}, setPath() {}, getPath() { return 'C:\\Users\\test'; },
      setAppUserModelId(value: string) { appId = value; },
      requestSingleInstanceLock() { return false; }, quit() {},
    } } : realRequire(id),
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nthis.filename = safeFilename;', sandbox);
  expect(appId).toBe('local.slidestudio.app');
  expect(sandbox.filename('CON', 'pptx')).toBe('_CON.pptx');
  expect(sandbox.filename('lpt1.slide', 'slide')).toBe('_lpt1.slide');
  expect(sandbox.filename('COM¹.pptx', 'pptx')).toBe('_COM¹.pptx');
  expect(sandbox.filename('기획안... ', 'slide')).toBe('기획안.slide');
  expect(sandbox.filename('한글 문서.pptx', 'pptx')).toBe('한글 문서.pptx');
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} window chrome preserves native shortcuts and accepts only trusted theme updates`, async () => {
    const filename = path.resolve('electron/main.cjs');
    const realRequire = createRequire(filename);
    const handlers = new Map<string, (event: any, value?: unknown) => unknown>();
    const overlays: unknown[] = [];
    const menuVisibility: boolean[] = [];
    const sentActions: unknown[] = [];
    let options: any;
    let installedMenu: any[] = [];
    let destroyed = false;
    const clipboardActions: string[] = [];
    let aboutShown = 0;
    const contents = {
      copy() { clipboardActions.push("copy"); },
      cut() { clipboardActions.push("cut"); },
      pasteAndMatchStyle() { clipboardActions.push("paste"); },
      paste() { clipboardActions.push("table-paste"); },
      mainFrame: { url: pathToFileURL(path.resolve('dist/index.html')).href },
      on() {}, setWindowOpenHandler() {},
      send(...args: unknown[]) { sentActions.push(args); },
    };
    const sandbox: any = {
      __dirname: path.dirname(filename), process: { ...process, platform }, Buffer, Uint8Array, URL,
      require: (id: string) => id === 'electron' ? {
        app: {
          isPackaged: true, setName() {}, setPath() {}, getPath() { return '/tmp'; },
          setAppUserModelId() {}, requestSingleInstanceLock() { return false; }, quit() {},
          showAboutPanel() { aboutShown++; },
        },
        BrowserWindow: class {
          webContents = contents;
          constructor(config: unknown) { options = config; }
          isDestroyed() { return destroyed; }
          isFullScreen() { return false; }
          on() {} once() {}
          async loadFile() {}
          setMenuBarVisibility(visible: boolean) { menuVisibility.push(visible); }
          setTitleBarOverlay(overlay: unknown) { overlays.push(overlay); }
        },
        ipcMain: {
          handle(channel: string, callback: (event: any, value?: unknown) => unknown) { handlers.set(channel, callback); },
          on() {},
        },
        Menu: {
          buildFromTemplate(template: any[]) { return template; },
          setApplicationMenu(menu: any[]) { installedMenu = menu; },
        },
      } : realRequire(id),
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nthis.startWindow = createWindow; this.installIPC = installIPC; this.installMenu = installMenu; this.presenterWindows = presenterWindows;', sandbox);
    sandbox.installIPC();
    sandbox.installMenu();
    await sandbox.startWindow();
    for (const command of ['get-update-state', 'check-updates', 'download-update', 'install-update', 'cancel-update', 'reveal-update', 'open-update-page']) {
      const handler = handlers.get('slide-studio:' + command)!;
      expect(handler).toBeTruthy();
      await assert.rejects(handler({ sender: {}, senderFrame: contents.mainFrame }), /editor window/);
      await assert.rejects(handler({ sender: contents, senderFrame: { url: contents.mainFrame.url } }), /editor window/);
      await assert.rejects(handler({ sender: contents, senderFrame: contents.mainFrame }, 'C:\\untrusted.exe'), /인수가 필요하지 않습니다/);
    }
    await assert.rejects(handlers.get('slide-studio:set-automatic-updates')!({ sender: contents, senderFrame: contents.mainFrame }, 'true'), /올바르지 않습니다/);
    const updateSnapshot = await handlers.get('slide-studio:get-update-state')!({ sender: contents, senderFrame: contents.mainFrame });
    expect(updateSnapshot.phase).toBe('idle');
    expect(updateSnapshot.file).toBeUndefined();

    const saveItem = installedMenu.find(item => item.label === 'File')?.submenu
      .find((item: any) => item.accelerator === 'CmdOrCtrl+S');
    expect(saveItem).toBeTruthy();
    const updateMenu = installedMenu.find(item => item.label === '도움말')?.submenu;
    expect(updateMenu?.find((item: any) => item.label === '업데이트 확인…')).toBeTruthy();
    expect(updateMenu?.find((item: any) => item.label === '수동 업데이트…')).toBeTruthy();
    updateMenu?.find((item: any) => item.label === 'Slide Studio 정보').click();
    expect(aboutShown).toBe(1);
    saveItem.click();
    expect(sentActions).toEqual([['slide-studio:menu', 'save']]);
    expect(options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    if (platform === 'win32') {
      expect(options).toMatchObject({
        titleBarStyle: 'hidden', autoHideMenuBar: true,
        titleBarOverlay: { color: '#151515', symbolColor: '#f2f2f2', height: 40 },
      });
      expect(menuVisibility).toEqual([false]);
    } else {
      expect(options.titleBarStyle).toBeUndefined();
      expect(options.titleBarOverlay).toBeUndefined();
      expect(options.autoHideMenuBar).toBe(false);
      expect(menuVisibility).toEqual([]);
    }

    const updateTheme = handlers.get('slide-studio:set-chrome-theme')!;
    const event = { sender: contents, senderFrame: contents.mainFrame };
    const textClipboard = handlers.get('slide-studio:edit-text-clipboard')!;
    for (const action of ['copy','cut','paste']) textClipboard(event, action);
    expect(clipboardActions).toEqual(['copy','cut','paste']);
    const pasteTable = handlers.get('slide-studio:paste-table-clipboard')!;
    pasteTable(event);expect(clipboardActions.at(-1)).toBe('table-paste');
    expect(() => pasteTable(event, 'extra')).toThrow();
    expect(() => pasteTable({ ...event, sender: {} })).toThrow('editor window');
    expect(() => pasteTable({ ...event, senderFrame: { url: contents.mainFrame.url } })).toThrow('editor window');
    for (const action of ['read', 'execute', null, {}]) expect(() => textClipboard(event, action)).toThrow('Unknown text clipboard action');
    expect(() => textClipboard({ ...event, sender: {} }, 'copy')).toThrow('editor window');
    expect(() => textClipboard({ ...event, senderFrame: { url: contents.mainFrame.url } }, 'paste')).toThrow('editor window');
    const loadCalibri = handlers.get('slide-studio:load-office-calibri-fonts')!;
    expect(() => loadCalibri({ ...event, sender: {} })).toThrow('editor window');
    expect(() => loadCalibri({ ...event, senderFrame: { url: contents.mainFrame.url } })).toThrow('editor window');
    expect(() => loadCalibri(event, '/private/calibri.ttf')).toThrow('no paths or arguments');
    const loadFont = handlers.get('slide-studio:load-office-light-font')!;
    expect(() => loadFont({ ...event, sender: {} })).toThrow('editor window');
    expect(() => loadFont({ ...event, senderFrame: { url: contents.mainFrame.url } })).toThrow('editor window');
    expect(() => loadFont(event, 'C:\\private.ttf')).toThrow('no paths or arguments');
    const presenterFrame = { url: contents.mainFrame.url + '#presenter=00000000-0000-4000-8000-000000000001' };
    const presenterContents = { mainFrame: presenterFrame };
    const presenter = { isDestroyed: () => false, webContents: presenterContents };
    sandbox.presenterWindows.add(presenter);
    const presenterEvent = { sender: presenterContents, senderFrame: presenterFrame };
    expect(() => loadFont(presenterEvent, '/private/font.ttf')).toThrow('no paths or arguments');
    expect(() => textClipboard(presenterEvent, 'copy')).toThrow('editor window');
    expect(() => updateTheme(presenterEvent, 'light')).toThrow('editor window');
    if (platform === 'darwin') expect(await loadFont(presenterEvent)).toBeNull();
    presenterFrame.url = 'https://example.com/#presenter=00000000-0000-4000-8000-000000000001';
    expect(() => loadFont(presenterEvent)).toThrow('editor window');
    presenterFrame.url = contents.mainFrame.url;
    expect(() => loadFont(presenterEvent)).toThrow('editor window');
    sandbox.presenterWindows.delete(presenter);
    if (platform === 'darwin') expect(await loadFont(event)).toBeNull();
    updateTheme(event, 'light');
    updateTheme(event, 'dark');
    expect(overlays).toHaveLength(platform === 'win32' ? 2 : 0);
    if (platform === 'win32') {
      expect(overlays).toEqual([
        { color: '#f3f3f3', symbolColor: '#242424', height: 40 },
        { color: '#151515', symbolColor: '#f2f2f2', height: 40 },
      ]);
    }
    const count = overlays.length;
    for (const invalid of ['system', '__proto__', { color: '#ff0000' }, null]) {
      expect(() => updateTheme(event, invalid)).toThrow('dark or light');
    }
    expect(() => updateTheme({ ...event, sender: {} }, 'light')).toThrow('editor window');
    expect(() => updateTheme({ ...event, senderFrame: { url: contents.mainFrame.url } }, 'light')).toThrow('editor window');
    contents.mainFrame.url = 'https://example.com/';
    expect(() => updateTheme(event, 'light')).toThrow('editor window');
    contents.mainFrame.url = pathToFileURL(path.resolve('dist/index.html')).href;
    destroyed = true;
    expect(() => updateTheme(event, 'light')).toThrow('editor window');
    expect(overlays).toHaveLength(count);
  });
}

test('preload exposes an immutable platform and a narrow theme command', async () => {
  let bridge: any;
  const calls: unknown[] = [];
  const subscriptions = new Map<string, (...args: any[]) => void>();
  const removed: unknown[] = [];
  const sandbox = {
    process: { platform: 'win32' },
    window: { addEventListener() {} },
    require: () => ({
      contextBridge: { exposeInMainWorld(name: string, value: unknown) { expect(name).toBe('desktop'); bridge = value; } },
      ipcRenderer: {
        invoke(...args: unknown[]) { calls.push(args); return Promise.resolve(); },
        on(channel: string, callback: (...args: any[]) => void) { subscriptions.set(channel, callback); },
        removeListener(channel: string, callback: unknown) { removed.push([channel, callback]); },
      },
    }),
  };
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/preload.cjs'), 'utf8'), sandbox);
  expect(bridge.platform).toBe('win32');
  expect(Object.isFrozen(bridge)).toBe(true);
  await bridge.editTextClipboard('copy');
  await bridge.setChromeTheme('light');
  await bridge.loadOfficeLightFont('ignored/path.ttf');
  await bridge.loadOfficeCalibriFonts('ignored/path.ttf');
  expect(calls).toEqual([['slide-studio:edit-text-clipboard', 'copy'], ['slide-studio:set-chrome-theme', 'light'], ['slide-studio:load-office-light-font'], ['slide-studio:load-office-calibri-fonts']]);
  await bridge.getUpdateState('/private/ignored');
  await bridge.checkUpdates('https://untrusted.example');
  await bridge.downloadUpdate('/private/installer.exe');
  await bridge.installUpdate(true);
  await bridge.openUpdatePage('https://untrusted.example');
  await bridge.setAutomaticUpdates(false);
  expect(calls.slice(4)).toEqual([['slide-studio:get-update-state'], ['slide-studio:check-updates'], ['slide-studio:download-update'], ['slide-studio:install-update'], ['slide-studio:open-update-page'], ['slide-studio:set-automatic-updates', false]]);
  const payloads: unknown[] = [];
  const unsubscribe = bridge.onUpdateState((...args: unknown[]) => payloads.push(args));
  const listener = subscriptions.get('slide-studio:update-state')!;
  listener({ privileged: true }, { phase: 'downloading', percent: 42 });
  expect(payloads).toEqual([[{ phase: 'downloading', percent: 42 }]]);
  unsubscribe();
  expect(removed).toEqual([['slide-studio:update-state', listener]]);
  expect(() => bridge.onUpdateState(null)).toThrow();
  expect(bridge.invoke).toBeUndefined();
  expect(bridge.send).toBeUndefined();
});

test('presenter preload loads matching desktop fonts without exposing editing or file capabilities', async () => {
  let bridge: any;
  const calls: unknown[] = [];
  vm.runInNewContext(fs.readFileSync(path.resolve('electron/presenter-preload.cjs'), 'utf8'), {
    process: { platform: 'darwin' },
    require: () => ({
      contextBridge: { exposeInMainWorld(name: string, value: unknown) { expect(name).toBe('desktop'); bridge = value; } },
      ipcRenderer: { invoke(...args: unknown[]) { calls.push(args); return Promise.resolve([]); } },
    }),
  });
  expect(Object.isFrozen(bridge)).toBe(true);
  expect(Object.keys(bridge).sort()).toEqual(['loadOfficeCalibriFonts', 'loadOfficeLightFont', 'platform']);
  await bridge.loadOfficeCalibriFonts('/private/font.ttf');
  await bridge.loadOfficeLightFont('/private/font.ttf');
  expect(calls).toEqual([['slide-studio:load-office-calibri-fonts'], ['slide-studio:load-office-light-font']]);
});
