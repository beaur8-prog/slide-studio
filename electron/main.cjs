'use strict';

const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, session, shell, Notification, screen, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { readOfficeArialNovaLight, readOfficeCalibriFonts } = require('./office-fonts.cjs');
const { RecentFiles } = require('./recent-files.cjs');
const { createPresentationWindowController } = require('./presentation-window.cjs');
const { createStudioUpdater } = require('./studio-updater.cjs');
const { FileOpenRequests } = require('./file-open-requests.cjs');
const { FileContexts } = require('./file-contexts.cjs');
const { createPresentationSaver } = require('./presentation-save.cjs');
const { createRecoverySaver } = require('./recovery-save.cjs');
const { createFileDialogs } = require('./file-dialogs.cjs');
const { atomicWrite } = require('./atomic-write.cjs');

const PRODUCT_NAME = 'Slide Studio';
const APP_ICON = path.join(__dirname, 'assets', 'SlideStudio.png');
const DEV_URL = 'http://127.0.0.1:5190';
const IS_DEV = !app.isPackaged && process.env.SLIDE_STUDIO_DEV === '1';
const INDEX_PATH = path.resolve(__dirname, '..', 'dist', 'index.html');
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const OPEN_EXTENSIONS = new Set(['slide', 'pptx']);
const recentFiles = new RecentFiles(() => path.join(app.getPath('userData'), 'recent-presentations.json'), atomicWrite);
const CHROME_THEMES = {
  dark: { color: '#151515', symbolColor: '#f2f2f2', height: 40 },
  light: { color: '#f3f3f3', symbolColor: '#242424', height: 40 },
};

let mainWindow = null;
const fileOpenRequests = new FileOpenRequests();
const fileContexts = new FileContexts({ maxBytes: MAX_FILE_BYTES });
const presenterWindows = new Set();
let nativeOperationPending = false;
let documentDirectory;
let dialogDirectoryLoaded = false;
let officeLightFont;
let officeCalibriFonts;
let presentationWindowController = null;
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
  finally { captureOperationPending = false; notifyFileOpenRequests(); }
}

app.setName(PRODUCT_NAME);
const customUserData=app.commandLine?.getSwitchValue?.('user-data-dir')||'';
app.setPath('userData',customUserData&&path.isAbsolute(customUserData)?path.resolve(customUserData):path.join(app.getPath('appData'), PRODUCT_NAME));
const fileDialogs = createFileDialogs({ dialog, systemPreferences, getHome: () => app.getPath('home'), platform: process.platform });
const updates = createStudioUpdater({ app, dialog, shell, Notification, id: 'slide', getWindow: () => mainWindow, platform: process.platform, arch: process.arch,
  onOpen: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    mainWindow.show(); mainWindow.focus(); sendMenuAction('updates-manual'); return true;
  },
});
updates.onChange(() => {
  installMenu();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('slide-studio:update-state', updates.getState());
});
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

function requireTrustedFontSender(event) {
  for (const child of presenterWindows) {
    if (!child.isDestroyed() && event.sender === child.webContents &&
        event.senderFrame === child.webContents.mainFrame &&
        isTrustedURL(event.senderFrame.url) &&
        /^#presenter=[0-9a-f-]{36}$/i.test(new URL(event.senderFrame.url).hash)) return;
  }
  requireTrustedSender(event);
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
  if (!Array.isArray(extensions) || extensions.length !== 1 || extensions[0] !== 'pptx') {
    throw new Error('Presentations are saved as .pptx files.');
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
    notifyFileOpenRequests();
  }
}


function dialogDirectoryFile() {
  return path.join(app.getPath('userData'), 'file-dialog-location.json');
}

async function defaultDialogPath(name) {
  if (!dialogDirectoryLoaded) {
    dialogDirectoryLoaded = true;
    try {
      const file = dialogDirectoryFile();
      if ((await fs.stat(file)).size <= 64 * 1024) {
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        if (saved.version === 1 && typeof saved.directory === 'string' &&
            path.isAbsolute(saved.directory)) documentDirectory = saved.directory;
      }
    } catch { /* First launch or unavailable preference storage. */ }
  }
  let directory = app.getPath('documents');
  try {
    if (documentDirectory && (await fs.stat(documentDirectory)).isDirectory())
      directory = documentDirectory;
  } catch { /* A moved/deleted folder falls back to Documents. */ }
  return name ? path.join(directory, name) : directory;
}

async function rememberDocumentDirectory(filename) {
  documentDirectory = path.dirname(filename);
  dialogDirectoryLoaded = true;
  try {
    await atomicWrite(dialogDirectoryFile(), Buffer.from(JSON.stringify({
      version: 1, directory: documentDirectory,
    })));
  } catch { /* Saving a preference must not fail the user's file operation. */ }
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('slide-studio:menu', action);
  }
}

function notifyFileOpenRequests() {
  if (fileOpenRequests.size && mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send('slide-studio:open-requested');
}

function showEditorForFileOpen() {
  if (!app.isReady()) return;
  if (!mainWindow) { void createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  notifyFileOpenRequests();
}

function setPresentationMode(enabled) {
  let refreshFullscreen = false;
  if (enabled && process.platform === 'win32' && mainWindow?.isFullScreen()) {
    const bounds = mainWindow.getBounds();
    const display = screen.getDisplayMatching(bounds).bounds;
    refreshFullscreen = bounds.width !== display.width || bounds.height !== display.height;
  }
  presentationWindowController?.set(enabled, refreshFullscreen);
}

async function preparePrint(contents) {
  // Font and image decoding must finish before Chromium snapshots the print layout.
  await contents.executeJavaScript(`(async () => {
    window.dispatchEvent(new Event('beforeprint'));
    await document.fonts.ready;
    await Promise.all(Array.from(document.querySelectorAll('.print-deck img'),
      image => image.decode().catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
}

async function releasePrint(contents) {
  // Also release after failures/cancellation; Chromium does not always emit
  // afterprint when a native print job fails before its preview opens.
  await contents.executeJavaScript("window.dispatchEvent(new Event('afterprint'))").catch(() => {});
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
        { label: 'Save PowerPoint', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Save PowerPoint As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { label: 'Export PDF…', click: () => sendMenuAction('export-pdf') },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction('print') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuAction('undo') },
      { label: 'Redo', accelerator: process.platform === 'darwin' ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y', click: () => sendMenuAction('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { label: 'Start Presentation', accelerator: 'CmdOrCtrl+Enter', click: () => sendMenuAction('present') },
      { type: 'separator' }, { role: 'togglefullscreen' },
      ...(IS_DEV ? [{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] : []),
    ] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' },
      ...(process.platform === 'darwin' ? [{ role: 'front' }] : [])] },
    { label: '도움말', submenu: [
      ...updates.menuTemplate().map((item, index) => index === 0 ? { ...item, enabled: updates.getState().phase !== 'installing', click: () => sendMenuAction('updates-check') } : item),
      { label: '수동 업데이트…', click: () => sendMenuAction('updates-manual') },
      { type: 'separator' },
      { label: 'Slide Studio 정보', click: () => app.showAboutPanel() },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function readPresentationFile(filename) {
  const extension = path.extname(filename).slice(1).toLowerCase();
  if (!OPEN_EXTENSIONS.has(extension)) throw new Error('Choose a .slide or .pptx presentation.');
  const handle = await fs.open(filename, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Choose a presentation no larger than 256 MiB.');
    const buffer = await handle.readFile();
    if (buffer.length > MAX_FILE_BYTES) throw new Error('Choose a presentation no larger than 256 MiB.');
    await rememberDocumentDirectory(filename);
    await recentFiles.remember(filename).catch(() => {});
    const realPath = await fs.realpath(filename).catch(() => undefined);
    const context = extension === 'pptx' && realPath && /\.pptx$/i.test(realPath) ? fileContexts.issue(realPath, buffer) : undefined;
    return { name: path.basename(filename),
      data: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), ...(context ? { context } : {}) };
  } finally {
    await handle.close();
  }
}

function installIPC() {
  const updateCommands = {
    'get-update-state': () => updates.getState(),
    'check-updates': () => updates.checkOnly(),
    'download-update': () => updates.downloadUpdate(),
    'install-update': () => updates.installNow(),
    'cancel-update': () => updates.cancelDownload(),
    'reveal-update': () => updates.revealDownload(),
    'open-update-page': () => updates.openReleasePage(),
  };
  for (const [command, run] of Object.entries(updateCommands)) {
    ipcMain.handle('slide-studio:' + command, async (event, ...args) => {
      requireTrustedSender(event);
      if (args.length) throw new TypeError('업데이트 요청에는 경로나 인수가 필요하지 않습니다.');
      if (command === 'install-update' && (nativeOperationPending || captureOperationPending || presentationWindowController?.isPresenting)) throw new Error('열려 있는 창이나 발표를 마친 뒤 업데이트해 주세요.');
      await run();
      return updates.getState();
    });
  }
  ipcMain.handle('slide-studio:set-automatic-updates', async (event, enabled, ...args) => {
    requireTrustedSender(event);
    if (typeof enabled !== 'boolean' || args.length) throw new TypeError('자동 업데이트 설정이 올바르지 않습니다.');
    await updates.setAutomatic(enabled);
    return updates.getState();
  });
  ipcMain.handle('slide-studio:take-requested-file', (event, ...args) => {
    requireTrustedSender(event);
    if (args.length) throw new TypeError('파일 열기 요청에는 경로나 인수가 필요하지 않습니다.');
    // Another native chooser/capture will notify the editor again when done.
    if (!fileOpenRequests.size || nativeOperationPending || captureOperationPending) return null;
    return withNativeDialog(event, () => readPresentationFile(fileOpenRequests.take()));
  });
  ipcMain.handle('slide-studio:recent-files', (event, ...args) => {
    requireTrustedSender(event);
    if (args.length) throw new TypeError('최근 파일 요청에는 인수가 필요하지 않습니다.');
    return recentFiles.list();
  });
  ipcMain.handle('slide-studio:open-recent-file', (event, id) => withNativeDialog(event, async () => {
    return readPresentationFile(await recentFiles.resolve(id));
  }));
  ipcMain.handle('slide-studio:paste-table-clipboard', (event, ...args) => {
    requireTrustedSender(event);
    if(args.length || presentationWindowController?.isPresenting || nativeOperationPending) throw new Error('지금은 표를 붙여넣을 수 없습니다.');
    event.sender.paste();
  });
  ipcMain.handle('slide-studio:edit-text-clipboard', (event, ...args) => {
    requireTrustedSender(event);
    const action = args[0];
    if (args.length !== 1 || !['copy', 'cut', 'paste'].includes(action)) throw new TypeError('Unknown text clipboard action');
    if (presentationWindowController?.isPresenting || nativeOperationPending) throw new Error('Text editing is not available now');
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

  ipcMain.handle('slide-studio:load-office-calibri-fonts', (event, ...args) => {
    requireTrustedFontSender(event);
    if (args.length) throw new TypeError('This font request takes no paths or arguments.');
    officeCalibriFonts ??= readOfficeCalibriFonts({ platform: process.platform });
    return officeCalibriFonts;
  });

  ipcMain.handle('slide-studio:load-office-light-font', (event, ...args) => {
    requireTrustedFontSender(event);
    if (args.length) throw new TypeError('This font request takes no paths or arguments.');
    officeLightFont ??= readOfficeArialNovaLight({ platform: process.platform });
    return officeLightFont;
  });

  ipcMain.handle('slide-studio:set-chrome-theme', (event, theme) => {
    requireTrustedSender(event);
    if (theme !== 'dark' && theme !== 'light') throw new TypeError('Choose a dark or light window theme.');
    if (process.platform === 'win32') mainWindow.setTitleBarOverlay(CHROME_THEMES[theme]);
  });

  const savePresentation = createPresentationSaver({
    contexts: fileContexts, dialog: fileDialogs, getWindow: () => mainWindow,
    defaultPath: defaultDialogPath, atomicWrite,
    onSaved: async filename => {
      await rememberDocumentDirectory(filename);
      await recentFiles.remember(filename).catch(() => {});
    },
  });
  ipcMain.handle('slide-studio:save-file', (event, payload) => withNativeDialog(event, () =>
    savePresentation(decodeFilePayload(payload), payload.context)));

  const saveRecovery = createRecoverySaver({ dialog: fileDialogs, getWindow: () => mainWindow,
    defaultPath: defaultDialogPath, atomicWrite, safeFilename });
  ipcMain.handle('slide-studio:save-recovery-data', (event, payload) => withNativeDialog(event, () => saveRecovery(payload)));

  ipcMain.handle('slide-studio:open-file', event => withNativeDialog(event, async () => {
    const result = await fileDialogs.showOpenDialog(mainWindow, {
      title: 'Open Presentation',
      defaultPath: await defaultDialogPath(),
      filters: [{ name: 'Presentations', extensions: ['slide', 'pptx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    return readPresentationFile(result.filePaths[0]);
  }));

  ipcMain.handle('slide-studio:export-pdf', (event, name) => withNativeDialog(event, async () => {
    if (typeof name !== 'string') throw new Error('The PDF is missing a name.');
    const result = await fileDialogs.showSaveDialog(mainWindow, {
      title: 'Export PDF',
      defaultPath: await defaultDialogPath(safeFilename(name, 'pdf')),
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    const contents = mainWindow.webContents;
    try {
      await preparePrint(contents);
      const buffer = await contents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: { width: 13.333333, height: 7.5 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        displayHeaderFooter: false,
      });
      await atomicWrite(result.filePath, buffer);
      return result.filePath;
    } finally { await releasePrint(contents); }
  }));

  ipcMain.handle('slide-studio:print', event => withNativeDialog(event, async () => {
    const contents = mainWindow.webContents;
    try {
      await preparePrint(contents);
      return await new Promise((resolve, reject) => {
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
    } finally { await releasePrint(contents); }
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
      "media-src 'self' data: blob:",
      "worker-src 'self' blob:",
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
    minWidth: 970,
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
      additionalArguments: ['--slide-studio-window-session=' + randomUUID()],
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // The presenter has no Node or access to editor-only native IPC.
    let target;
    try { target = new URL(url); } catch { return { action: 'deny' }; }
    if (!isTrustedURL(url) || !/^#presenter=[0-9a-f-]{36}$/i.test(target.hash)) return { action: 'deny' };
    return { action: 'allow', overrideBrowserWindowOptions: {
      title: 'Slide Studio — 발표자 보기', width: 1180, height: 780,
      minWidth: 800, minHeight: 600, autoHideMenuBar: true, fullscreenable: false,
      webPreferences: { preload: path.join(__dirname, 'presenter-preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webSecurity: true, webviewTag: false, backgroundThrottling: false },
    } };
  });
  mainWindow.webContents.on('did-create-window', child => {
    presenterWindows.add(child);
    child.on('closed', () => presenterWindows.delete(child));
    if (process.platform === 'darwin') child.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    child.webContents.on('will-navigate', (event, url) => { if (!isTrustedURL(url)) event.preventDefault(); });
  });
  presentationWindowController = createPresentationWindowController(mainWindow, {
    onEntered: () => {
      // macOS creates a new Space for the audience window. Keep the movable
      // presenter window accessible there after a completed transition.
      for (const child of presenterWindows) {
        if (!child.isDestroyed()) { child.show(); child.focus(); }
      }
    },
    onEnded: () => mainWindow.webContents.send('slide-studio:presentation-ended'),
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    // Native Edit/Print accelerators otherwise consume these before the
    // renderer can choose a slideshow pointer or undo a session ink stroke.
    if (!presentationWindowController?.isPresenting || input.type !== 'keyDown' || input.alt ||
        !(input.control || input.meta)) return;
    const command = { a: 'arrow', l: 'laser', p: 'pen', h: 'highlighter', e: 'eraser',
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
      title: 'Slide Studio 닫기',
      message: 'PPTX 파일에 저장하지 않은 변경 사항이 있습니다.',
      detail: '계속 편집한 뒤 PPTX로 저장해 주세요. 저장하지 않고 닫으면 다음 실행에서 이 내용이 열리지 않습니다.',
      buttons: ['계속 편집', '저장하지 않고 닫기'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (response === 1) event.preventDefault();
    else void updates.cancelInstall();
  });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { clearCaptureSources(); setPresentationMode(false); }
  });
  mainWindow.webContents.on('render-process-gone', () => { clearCaptureSources(); setPresentationMode(false); });
  mainWindow.on('closed', () => { fileContexts.clear(); for(const child of presenterWindows)if(!child.isDestroyed())child.destroy();presenterWindows.clear();clearCaptureSources(); presentationWindowController?.dispose(); presentationWindowController = null; mainWindow = null; });
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
  // Finder can deliver this before ready, well before the renderer subscribes.
  app.on('open-file', (event, filename) => {
    event.preventDefault();
    fileOpenRequests.add(filename);
    showEditorForFileOpen();
  });
  fileOpenRequests.addArguments(process.argv, process.cwd());
  app.on('second-instance', (_event, argv, workingDirectory) => {
    fileOpenRequests.addArguments(argv, workingDirectory);
    showEditorForFileOpen();
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
    await updates.start();
    app.on('activate', () => { if (!mainWindow) void createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
