'use strict';

const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { readOfficeArialNovaLight } = require('./office-fonts.cjs');

const PRODUCT_NAME = 'Slide Studio';
const APP_ICON = path.join(__dirname, 'assets', 'SlideStudio.png');
const DEV_URL = 'http://127.0.0.1:5190';
const IS_DEV = !app.isPackaged && process.env.SLIDE_STUDIO_DEV === '1';
const INDEX_PATH = path.resolve(__dirname, '..', 'dist', 'index.html');
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['slide', 'pptx']);
const CHROME_THEMES = {
  dark: { color: '#151515', symbolColor: '#f2f2f2', height: 40 },
  light: { color: '#f3f3f3', symbolColor: '#242424', height: 40 },
};

let mainWindow = null;
let nativeOperationPending = false;
let officeLightFont;
let presentationWindowState = null;
const captureSources = new Map();
let captureExpiry;
let captureOperationPending = false;
const CAPTURE_SOURCE_LIMIT = 24;
const CAPTURE_LIFETIME_MS = 60000;

function clearCaptureSources() {
  captureSources.clear();
  clearTimeout(captureExpiry);
  captureExpiry = undefined;
}

async function withCaptureOperation(event, task) {
  requireTrustedSender(event);
  if (captureOperationPending || nativeOperationPending) throw new Error('다른 캡처 또는 파일 작업이 끝난 후 다시 시도하세요.');
  captureOperationPending = true;
  try { return await task(); }
  finally { captureOperationPending = false; }
}

app.setName(PRODUCT_NAME);
app.setPath('userData', path.join(app.getPath('appData'), PRODUCT_NAME));
if (process.platform === 'win32') app.setAppUserModelId('local.slidestudio.app');

function isTrustedURL(value) {
  try {
    const url = new URL(value);
    if (IS_DEV) return url.origin === DEV_URL && url.pathname === '/';
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === INDEX_PATH;
  } catch {
    return false;
  }
}

function requireTrustedSender(event) {
  if (
    !mainWindow || mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isTrustedURL(event.senderFrame.url)
  ) throw new Error('This operation is available only to the editor window.');
}

function safeFilename(input, extension) {
  let name = path.basename(String(input || 'Untitled presentation'))
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 160)
    .trim().replace(/[. ]+$/, '') || 'Untitled presentation';
  // Windows device names remain reserved even when followed by an extension.
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name.toLowerCase().endsWith(`.${extension}`) ? name : `${name}.${extension}`;
}

function decodeFilePayload(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.name !== 'string') {
    throw new Error('The file is missing a name.');
  }
  const extensions = payload.extensions;
  if (!Array.isArray(extensions) || extensions.length < 1 || extensions.length > 2 ||
      extensions.some(extension => !ALLOWED_EXTENSIONS.has(extension))) {
    throw new Error('Only Slide Studio and PowerPoint files can be saved.');
  }
  const data = payload.data;
  if (!(data instanceof Uint8Array) || data.byteLength === 0 || data.byteLength > MAX_FILE_BYTES) {
    throw new Error('Choose a presentation no larger than 256 MiB.');
  }
  return { name: safeFilename(payload.name, extensions[0]), extensions,
    data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) };
}

async function withNativeDialog(event, task) {
  requireTrustedSender(event);
  if (nativeOperationPending || captureOperationPending) throw new Error('Finish the open file, print, or screenshot operation first.');
  nativeOperationPending = true;
  try {
    return await task();
  } finally {
    nativeOperationPending = false;
  }
}

async function atomicWrite(filename, buffer) {
  const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('slide-studio:menu', action);
  }
}

function setPresentationMode(enabled) {
  if (enabled) {
    // Let the OS cover the taskbar and preserve the window's normal/maximized
    // bounds. A renderer overlay alone only fills the existing client area.
    presentationWindowState ??= {
      fullScreen: mainWindow.isFullScreen(),
      menuBarVisible: mainWindow.isMenuBarVisible(),
    };
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setFullScreen(true);
  } else if (presentationWindowState) {
    const previous = presentationWindowState;
    presentationWindowState = null;
    mainWindow.setFullScreen(previous.fullScreen);
    mainWindow.setMenuBarVisibility(previous.menuBarVisible);
  }
}

async function preparePrint(contents) {
  // Font and image decoding must finish before Chromium snapshots the print layout.
  await contents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll('.print-deck img'),
      image => image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
}

function installMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: PRODUCT_NAME,
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Presentation', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { type: 'separator' },
        { label: 'Save Slide Studio File…', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Export PowerPoint…', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenuAction('export-pptx') },
        { label: 'Export PDF…', click: () => sendMenuAction('export-pdf') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction('print') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { label: 'Start Presentation', accelerator: 'CmdOrCtrl+Enter', click: () => sendMenuAction('present') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(IS_DEV ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' },
      ...(process.platform === 'darwin' ? [{ role: 'front' }] : [])] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installIPC() {
  ipcMain.handle('slide-studio:edit-text-clipboard', (event, ...args) => {
    requireTrustedSender(event);
    const action = args[0];
    if (args.length !== 1 || !['copy', 'cut', 'paste'].includes(action)) throw new TypeError('Unknown text clipboard action');
    if (presentationWindowState || nativeOperationPending) throw new Error('Text editing is not available now');
    if (action === 'copy') event.sender.copy();
    else if (action === 'cut') event.sender.cut();
    else event.sender.pasteAndMatchStyle();
  });
  ipcMain.handle('slide-studio:list-capture-sources', (event, ...args) => withCaptureOperation(event, async () => {
    if (args.length) throw new TypeError('이 요청에는 인수가 필요하지 않습니다.');
    clearCaptureSources();
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false,
    });
    requireTrustedSender(event);
    const ownWindow = mainWindow.getMediaSourceId();
    const expires = Date.now() + CAPTURE_LIFETIME_MS;
    const choices = [];
    for (const source of sources) {
      if (choices.length >= CAPTURE_SOURCE_LIMIT) break;
      if (source.id === ownWindow || source.thumbnail.isEmpty()) continue;
      const type = source.id.startsWith('screen:') ? 'screen' : source.id.startsWith('window:') ? 'window' : null;
      if (!type) continue;
      const id = randomUUID();
      captureSources.set(id, { sourceId: source.id, name: source.name, type, expires });
      choices.push({ id, name: String(source.name).slice(0, 240), thumbnail: source.thumbnail.toDataURL() });
    }
    // Keep only bounded source identifiers, never NativeImages or image data.
    captureExpiry = setTimeout(clearCaptureSources, CAPTURE_LIFETIME_MS);
    captureExpiry.unref();
    return choices;
  }));

  ipcMain.handle('slide-studio:capture-source', (event, id) => withCaptureOperation(event, async () => {
    const selected = typeof id === 'string' && id.length <= 64 ? captureSources.get(id) : undefined;
    if (!selected || Date.now() >= selected.expires) {
      clearCaptureSources();
      throw new Error('캡처 목록이 만료되었습니다. 새로 고침 후 다시 선택하세요.');
    }
    // A selection is single-use; late or repeated requests cannot reuse it.
    clearCaptureSources();
    const window = mainWindow;
    const wasVisible = window.isVisible();
    const wasFocused = window.isFocused();
    try {
      // The source picker must not appear in a full-screen screenshot.
      if (wasVisible) window.hide();
      await new Promise(resolve => setTimeout(resolve, 180));
      requireTrustedSender(event);
      const sources = await desktopCapturer.getSources({
        types: [selected.type], thumbnailSize: { width: 1920, height: 1080 }, fetchWindowIcons: false,
      });
      requireTrustedSender(event);
      const source = sources.find(item => item.id === selected.sourceId && item.name === selected.name);
      if (!source || source.thumbnail.isEmpty()) throw new Error('선택한 창을 캡처할 수 없습니다. 창이 열려 있는지 확인하세요.');
      let image = source.thumbnail;
      const size = image.getSize();
      if (size.width > 1920 || size.height > 1080) {
        const ratio = Math.min(1920 / size.width, 1080 / size.height);
        image = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) });
      }
      const png = image.toPNG();
      if (!png.length || png.length > 15 * 1024 * 1024) throw new Error('캡처 이미지가 너무 큽니다. 더 작은 창을 선택하세요.');
      return `data:image/png;base64,${png.toString('base64')}`;
    } finally {
      if (wasVisible && !window.isDestroyed()) {
        window.show();
        if (wasFocused) window.focus();
      }
    }
  }));

  ipcMain.handle('slide-studio:set-presentation-mode', (event, enabled) => {
    requireTrustedSender(event);
    if (typeof enabled !== 'boolean') throw new TypeError('Presentation mode must be a boolean.');
    setPresentationMode(enabled);
  });

  ipcMain.handle('slide-studio:load-office-light-font', (event, ...args) => {
    requireTrustedSender(event);
    if (args.length) throw new TypeError('This font request takes no paths or arguments.');
    officeLightFont ??= readOfficeArialNovaLight({ platform: process.platform });
    return officeLightFont;
  });

  ipcMain.handle('slide-studio:set-chrome-theme', (event, theme) => {
    requireTrustedSender(event);
    if (theme !== 'dark' && theme !== 'light') throw new TypeError('Choose a dark or light window theme.');
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay(CHROME_THEMES[theme]);
  });

  ipcMain.handle('slide-studio:save-file', (event, payload) => withNativeDialog(event, async () => {
    const file = decodeFilePayload(payload);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: file.extensions[0] === 'pptx' ? 'Export PowerPoint' : 'Save Presentation',
      defaultPath: path.join(app.getPath('documents'), file.name),
      filters: [{ name: file.extensions[0] === 'pptx' ? 'PowerPoint Presentation' : 'Slide Studio Presentation', extensions: file.extensions }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    await atomicWrite(result.filePath, file.data);
    return result.filePath;
  }));

  ipcMain.handle('slide-studio:open-file', event => withNativeDialog(event, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Presentation',
      filters: [{ name: 'Presentations', extensions: ['slide', 'pptx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const filename = result.filePaths[0];
    const extension = path.extname(filename).slice(1).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error('Choose a .slide or .pptx presentation.');
    const handle = await fs.open(filename, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Choose a presentation no larger than 256 MiB.');
      const buffer = await handle.readFile();
      if (buffer.length > MAX_FILE_BYTES) throw new Error('Choose a presentation no larger than 256 MiB.');
      // Typed-array IPC avoids expanding every file byte into a JS number.
      return { name: path.basename(filename),
        data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
    } finally {
      await handle.close();
    }
  }));

  ipcMain.handle('slide-studio:export-pdf', (event, name) => withNativeDialog(event, async () => {
    if (typeof name !== 'string') throw new Error('The PDF is missing a name.');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export PDF',
      defaultPath: path.join(app.getPath('documents'), safeFilename(name, 'pdf')),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    await preparePrint(mainWindow.webContents);
    const buffer = await mainWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: { width: 13.333333, height: 7.5 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      displayHeaderFooter: false,
    });
    await atomicWrite(result.filePath, buffer);
    return result.filePath;
  }));

  ipcMain.handle('slide-studio:print', event => withNativeDialog(event, async () => {
    const contents = mainWindow.webContents;
    await preparePrint(contents);
    return new Promise((resolve, reject) => {
      contents.print({
        silent: false,
        printBackground: true,
        landscape: true,
        usePrinterDefaultPageSize: true,
        margins: { marginType: 'printableArea' },
      }, (success, failureReason) => {
        if (success) resolve(true);
        else if (/cancel(?:led|ed)/i.test(failureReason)) resolve(false);
        else reject(new Error(failureReason || 'The print job could not be submitted.'));
      });
    });
  }));

  // This channel is private to the preload's trusted click handler. It is never
  // exposed on window.desktop, so synthetic renderer clicks cannot launch URLs.
  ipcMain.on('slide-studio:open-external', (event, href) => {
    try {
      requireTrustedSender(event);
      if (typeof href !== 'string' || href.length > 2048) return;
      const url = new URL(href);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
      void shell.openExternal(url.href).catch(() => {});
    } catch {
      // Untrusted frames and malformed links have no side effects.
    }
  });
}

function hardenSession() {
  const editorSession = session.defaultSession;
  editorSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  editorSession.setPermissionCheckHandler(() => false);
  editorSession.on('will-download', event => event.preventDefault());
  editorSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      const url = new URL(details.url);
      const localProtocol = ['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol);
      const localDevelopment = IS_DEV && ['http:', 'ws:'].includes(url.protocol) && url.hostname === '127.0.0.1' && url.port === '5190';
      callback({ cancel: !localProtocol && !localDevelopment });
    } catch {
      callback({ cancel: true });
    }
  });
  editorSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isTrustedURL(details.url)) return callback({ responseHeaders: details.responseHeaders });
    const policy = [
      "default-src 'self'",
      `script-src 'self'${IS_DEV ? " 'unsafe-inline'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${IS_DEV ? 'http://127.0.0.1:5190 ws://127.0.0.1:5190' : "'none'"}`,
      "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
    ].join('; ');
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } });
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 1000,
    minWidth: 1080,
    minHeight: 720,
    title: PRODUCT_NAME,
    icon: APP_ICON,
    backgroundColor: process.platform === 'win32' ? '#151515' : '#f8f7f4',
    show: false,
    autoHideMenuBar: process.platform === 'win32',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: CHROME_THEMES.dark,
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  // Keep the native menu installed for accelerators while the renderer owns the
  // visible ribbon. Window Controls Overlay retains Windows' native caption buttons.
  if (process.platform === 'win32') mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Native Edit/Print accelerators otherwise consume these before the
    // renderer can choose a slideshow pointer or undo a session ink stroke.
    if (!presentationWindowState || input.type !== 'keyDown' || input.alt ||
        !(input.control || input.meta)) return;
    const command = { a: 'arrow', l: 'laser', p: 'pen', e: 'eraser',
      z: input.shift ? 'redo' : 'undo', y: 'redo' }[input.key.toLowerCase()];
    if (command) { event.preventDefault(); if (!input.isAutoRepeat) sendMenuAction('presentation-' + command); }
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedURL(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Close Slide Studio?',
      message: 'Some changes may not have been saved.',
      detail: 'Keep editing to save your presentation, or close without saving the pending changes.',
      buttons: ['Keep Editing', 'Close Without Saving'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) event.preventDefault();
  });
  mainWindow.on('leave-full-screen', () => {
    // Native fullscreen shortcuts must also dismiss the renderer's slideshow.
    if (!presentationWindowState) return;
    const previous = presentationWindowState;
    presentationWindowState = null;
    mainWindow.setMenuBarVisibility(previous.menuBarVisible);
    mainWindow.webContents.send('slide-studio:presentation-ended');
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { clearCaptureSources(); setPresentationMode(false); }
  });
  mainWindow.webContents.on('render-process-gone', () => { clearCaptureSources(); setPresentationMode(false); });
  mainWindow.on('closed', () => { clearCaptureSources(); presentationWindowState = null; mainWindow = null; });
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  try {
    if (IS_DEV) await mainWindow.loadURL(DEV_URL);
    else await mainWindow.loadFile(INDEX_PATH);
  } catch (error) {
    dialog.showErrorBox('Slide Studio could not start', IS_DEV
      ? 'Start the development server with npm run dev, then run npm run desktop.'
      : `The editor could not be loaded. Rebuild the app with npm run package.\n\n${error.message}`);
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    // A direct Electron/QA launch does not inherit the packaged app's ICNS.
    if (process.platform === 'darwin') app.dock.setIcon(APP_ICON);
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      iconPath: APP_ICON,
      copyright: 'An independent presentation editor. Not affiliated with Microsoft.',
    });
    hardenSession();
    installIPC();
    installMenu();
    await createWindow();
    app.on('activate', () => { if (!mainWindow) void createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
