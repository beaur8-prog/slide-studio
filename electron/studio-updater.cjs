'use strict';

// Canonical updater source. sync-updater.cjs copies this module and its Windows
// helper into each independent app before its existing ASAR packaging step.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

const MAX_METADATA = 1024 * 1024;
const MAX_DOWNLOAD = 2 * 1024 * 1024 * 1024;
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const PRODUCTS = { sheet: 'Sheet Studio', slide: 'Slide Studio', word: 'Word Studio' };

function versionParts(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  if (!match || match.slice(1).some(v => !Number.isSafeInteger(Number(v)))) throw new Error('지원하지 않는 버전 정보입니다.');
  return match.slice(1).map(Number);
}
function newer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function selectRelease(release, { id, currentVersion, platform, arch }) {
  if (!Object.hasOwn(PRODUCTS, id)) throw new Error('알 수 없는 Studio 앱입니다.');
  if (release.draft || release.prerelease) return null;
  const version = versionParts(release.tag_name).join('.');
  if (!newer(version, currentVersion)) return null;
  if (!['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch) || platform === 'win32' && arch !== 'x64') return null;
  const names = platform === 'win32'
    ? { sheet: `Sheet-Studio-${version}-Windows-x64-Setup.exe`, slide: 'Slide-Studio-Setup-x64.exe', word: `Word-Studio-${version}-windows-x64-setup.exe` }
    : { sheet: `Sheet-Studio-${version}-macOS-${arch}.zip`, slide: `Slide-Studio-mac-${arch}.zip`, word: `Word-Studio-${version}-mac-${arch}.zip` };
  const matches = (release.assets || []).filter(asset => asset.name === names[id] && asset.state === 'uploaded');
  if (matches.length !== 1) throw new Error('이 기기에 맞는 업데이트 파일을 찾을 수 없습니다.');
  const asset = matches[0];
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw new Error('업데이트 파일의 무결성 정보를 확인할 수 없습니다.');
  const expected = `https://github.com/beaur8-prog/${id}-studio/releases/download/${release.tag_name}/${asset.name}`;
  if (asset.browser_download_url !== expected) throw new Error('허용되지 않는 업데이트 주소입니다.');
  return { version, filename: asset.name, bytes: asset.size, sha256: asset.digest.slice(7), url: expected };
}
// Mac releases can be published independently with GitHub's make_latest=false.
// Keep the existing Windows /latest feed unchanged for installed Windows apps.
function selectMacRelease(releases, options) {
  if (!Array.isArray(releases) || releases.length > 20 || options.platform !== 'darwin') throw new Error('Mac 업데이트 목록이 올바르지 않습니다.');
  let selected = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name || '')) continue;
    const version = versionParts(release.tag_name).join('.');
    const expected = { sheet: `Sheet-Studio-${version}-macOS-${options.arch}.zip`, slide: `Slide-Studio-mac-${options.arch}.zip`, word: `Word-Studio-${version}-mac-${options.arch}.zip` }[options.id];
    if (!(release.assets || []).some(asset => asset.name === expected && asset.state === 'uploaded')) continue;
    const candidate = selectRelease(release, options);
    if (candidate && (!selected || newer(candidate.version, selected.version))) selected = candidate;
  }
  return selected;
}
async function readJSON(response) {
  if (!response.ok || !response.body) throw new Error('업데이트 서버에 연결할 수 없습니다. HTTP ' + response.status);
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_METADATA) throw new Error('업데이트 응답이 너무 큽니다.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verifyFile(file, asset, verifying = () => {}) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.size !== asset.bytes) throw new Error('업데이트 파일이 원본과 일치하지 않습니다.');
  verifying();
  if (await hashFile(file) !== asset.sha256) throw new Error('업데이트 파일이 원본과 일치하지 않습니다.');
}
async function download(asset, cache, fetchImpl, signal, progress = () => {}, lifecycle = {}) {
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  const directory = path.join(cache, asset.sha256);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, asset.filename);
  try { await verifyFile(destination, asset, lifecycle.verifying); progress(100, asset.bytes); return destination; }
  catch (error) {
    if (error.code !== 'ENOENT') await fs.rm(destination, { force: true });
  }
  const temporary = destination + '.' + randomUUID() + '.partial';
  try {
    lifecycle.downloading?.();
    const response = await fetchImpl(asset.url, { signal });
    if (!response.ok || !response.body) throw new Error('업데이트 다운로드에 실패했습니다. HTTP ' + response.status);
    const handle = await fs.open(temporary, 'wx', 0o600);
    const hash = createHash('sha256');
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        signal?.throwIfAborted();
        bytes += chunk.length;
        if (bytes > asset.bytes) throw new Error('업데이트 크기가 배포 정보와 다릅니다.');
        hash.update(chunk);
        await handle.writeFile(chunk);
        progress(Math.floor(bytes / asset.bytes * 100), bytes);
      }
      lifecycle.verifying?.();
      if (bytes !== asset.bytes || hash.digest('hex') !== asset.sha256) throw new Error('업데이트 파일이 원본과 일치하지 않습니다.');
      await handle.sync();
    } finally { await handle.close(); }
    signal?.throwIfAborted();
    await fs.rename(temporary, destination);
    return destination;
  } finally { await fs.rm(temporary, { force: true }); }
}
async function readInstallResult(filename) {
  let handle;
  try {
    handle = await fs.open(filename, fsSync.constants.O_RDONLY | (fsSync.constants.O_NOFOLLOW || 0));
    if (!(await handle.stat()).isFile()) return null;
    const buffer = Buffer.alloc(8193);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 8192) return null;
    const result = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
    if (!['installed', 'failed'].includes(result.status) || typeof result.message !== 'string' ||
        typeof result.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(result.version) ||
        typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.completedAt))) return null;
    return { status: result.status, version: result.version, message: result.message.slice(0, 300), completedAt: result.completedAt };
  } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ELOOP' && !(error instanceof SyntaxError)) throw error; return null; }
  finally { await handle?.close(); }
}
function powershellCommand(script, jobFile) {
  if (/[\r\n\0]/.test(jobFile)) throw new Error('Invalid update job path');
  const literal = "'" + jobFile.replaceAll("'", "''") + "'";
  return Buffer.from('& {\n' + script + '\n} -JobFile ' + literal, 'utf16le').toString('base64');
}

function createStudioUpdater({ app, dialog, shell, Notification, id, getWindow, platform = process.platform, arch = process.arch,
  fetchImpl = globalThis.fetch, launch = spawn, executable = process.execPath, pid = process.pid, logger = console, onOpen,
  helperReadyTimeout = 15_000 }) {
  if (!Object.hasOwn(PRODUCTS, id)) throw new Error('Unknown Studio app');
  const product = PRODUCTS[id];
  const releasePage = `https://github.com/beaur8-prog/${id}-studio/releases/latest`;
  const cache = path.join(app.getPath('userData'), 'updates');
  const settingsFile = path.join(cache, 'settings.json');
  let enabled = true, busy = null, ready = null, pendingJob = null, controller = null, manualRequest = false;
  let startTimer, interval, disposed = false, manualWaiting = false, notification;
  let settingsWrite = Promise.resolve();
  const listeners = new Set();
  const changed = () => { for (const listener of listeners) listener(); };
  const state = { phase: 'idle', percent: 0, version: null, receivedBytes: 0, totalBytes: 0, checkedAt: null, error: null, lastInstall: null, revision: 0 };
  function update(patch) { Object.assign(state, patch, { revision: state.revision + 1 }); changed(); }
  function getState() {
    const manualOnly = platform === 'linux' || !app.isPackaged || !['darwin', 'win32'].includes(platform) || !['arm64', 'x64'].includes(arch) || platform === 'win32' && arch !== 'x64';
    return { ...state, automatic: enabled && !manualOnly, currentVersion: app.getVersion?.() || '', platform, manualOnly,
      downloaded: Boolean(ready), filename: ready?.asset.filename || null };
  }
  function window() { const win = getWindow?.(); return win && !win.isDestroyed() ? win : undefined; }
  function message(options) { const win = window(); return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options); }
  async function saveSettings() {
    await fs.mkdir(cache, { recursive: true, mode: 0o700 });
    const temporary = settingsFile + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, JSON.stringify({ automatic: enabled }), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, settingsFile); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async function cancelInstall() {
    const job = pendingJob;
    pendingJob = null;
    if (job) {
      await fs.rm(job, { force: true }).catch(() => {});
      await fs.rm(job + '.ready', { force: true }).catch(() => {});
      await fs.rm(job + '.ps1', { force: true }).catch(() => {});
    }
    if (ready) update({ phase: 'ready' });
  }
  async function installNow(freshlyChecked = false) {
    if (!freshlyChecked) return check(true);
    if (!ready || pendingJob || disposed) return;
    try {
      update({ phase: 'verifying', error: null });
      await verifyFile(ready.file, ready.asset);
      if (disposed || controller?.signal.aborted) { update({ phase: 'ready' }); return; }
      update({ phase: 'ready', percent: 100 });
      if (platform === 'darwin') {
        const answer = await message({ type: 'info', title: product + ' 업데이트', message: ready.asset.version + ' 버전 다운로드가 완료되었습니다.',
          detail: '현재 Mac 배포본은 자동 교체용 배포 서명이 없어 직접 교체해야 합니다. 문서를 저장하고 앱을 종료한 뒤, ZIP 압축을 풀어 응용 프로그램 폴더의 기존 앱을 교체하세요.',
          buttons: ['다운로드 파일 보기', '나중에'], defaultId: 1, cancelId: 1, noLink: true });
        if (answer.response === 0) shell.showItemInFolder(ready.file);
        return;
      }
      const siblings = await fs.readdir(path.dirname(executable));
      if (!siblings.some(name => /uninstall.*\.exe$/i.test(name))) {
        const answer = await message({ type: 'info', title: product + ' 업데이트', message: '설치형 앱으로 업데이트하세요.',
          detail: '현재 앱은 폴더에서 직접 실행 중입니다. 내려받은 Setup을 실행해 설치한 뒤 시작 메뉴에서 새 버전을 실행하세요.',
          buttons: ['설치 파일 보기', '나중에'], defaultId: 1, cancelId: 1, noLink: true });
        if (answer.response === 0) shell.showItemInFolder(ready.file);
        return;
      }
      const answer = await message({ type: 'info', title: product + ' 업데이트', message: ready.asset.version + ' 버전을 설치할까요?',
        detail: '앱을 종료한 뒤 새 버전을 설치하고 다시 실행합니다. 문서 저장·종료가 취소되면 업데이트도 취소됩니다.',
        buttons: ['종료하고 업데이트', '나중에'], defaultId: 1, cancelId: 1, noLink: true });
      if (answer.response !== 0 || disposed || controller?.signal.aborted) return;
      const job = path.join(path.dirname(ready.file), 'install-' + randomUUID() + '.json');
      await fs.writeFile(job, JSON.stringify({ schema: 1, id, parentPid: pid, installer: ready.file,
        bytes: ready.asset.bytes, sha256: ready.asset.sha256, executable, version: ready.asset.version,
        log: path.join(cache, 'last-install.log') }), { flag: 'wx', mode: 0o600 });
      pendingJob = job;
      update({ phase: 'installing' });
      // Office Studio PR #1: acknowledge the waiting helper before closing
      // the editor, while startup errors can still be shown in this window.
      if (!await prepareWindowsHelper(job)) return;
      if (pendingJob !== job || disposed) return;
      // Never use destroy(), exit(), or quitAndInstall(): normal app.quit()
      // lets the editor's existing recovery/save and beforeunload logic finish.
      window()?.focus?.();
      app.quit();
    } catch (error) {
      await cancelInstall();
      update({ phase: 'error', error: String(error.message).slice(0, 300) });
      await showError(error);
    }
  }
  async function showError(error) {
    logger.warn('Studio updater:', error.message);
    const manualInstaller = ready && platform === 'win32';
    const answer = await message({ type: 'warning', title: product + ' 업데이트', message: '업데이트를 완료하지 못했습니다.',
      detail: '작업은 계속할 수 있습니다. ' + (manualInstaller
        ? '문서를 저장하고 앱을 종료한 뒤 내려받은 설치 파일을 직접 실행할 수 있습니다.\n로그 폴더: ' + cache
        : '네트워크와 디스크 공간을 확인한 뒤 도움말에서 다시 시도하세요.') + '\n\n' + String(error.message).slice(0, 300),
      buttons: manualInstaller ? ['설치 파일 보기', '나중에'] : ['확인'], defaultId: manualInstaller ? 1 : 0, cancelId: manualInstaller ? 1 : 0, noLink: true });
    if (manualInstaller && answer.response === 0) shell.showItemInFolder(ready.file);
  }
  function notifyReady() {
    if (!Notification?.isSupported?.() || disposed) return;
    notification?.close();
    notification = new Notification({ title: product + ' 업데이트 준비됨', body: ready.asset.version + ' 버전을 내려받았습니다. 알림을 누르면 설치 방법을 확인할 수 있습니다.' });
    notification.on('click', () => { if (!onOpen?.()) void installNow(); });
    notification.show();
  }
  async function performCheck(intent) {
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    try {
      update({ phase: 'checking', percent: 0, receivedBytes: 0, error: null });
      const endpoint = platform === 'darwin' ? 'releases?per_page=20' : 'releases/latest';
      const response = await fetchImpl(`https://api.github.com/repos/beaur8-prog/${id}-studio/${endpoint}`, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': product.replaceAll(' ', '-') + '-Updater' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      const release = await readJSON(response);
      const options = { id, currentVersion: app.getVersion(), platform, arch };
      const asset = platform === 'darwin' ? selectMacRelease(release, options) : selectRelease(release, options);
      if (!asset) {
        ready = null; update({ phase: 'up-to-date', version: null, totalBytes: 0, checkedAt: Date.now() });
        if (manualWaiting) await message({ type: 'info', title: product + ' 업데이트', message: '최신 버전을 사용하고 있습니다.', buttons: ['확인'] });
        return;
      }
      if (ready && (ready.asset.sha256 !== asset.sha256 || ready.asset.bytes !== asset.bytes || ready.asset.version !== asset.version || ready.asset.filename !== asset.filename)) ready = null;
      update({ version: asset.version, totalBytes: asset.bytes, checkedAt: Date.now() });
      if (intent === 'check') {
        update({ phase: ready ? 'ready' : 'available', percent: ready ? 100 : 0, receivedBytes: ready ? asset.bytes : 0 });
        return;
      }
      ready = null;
      update({ phase: 'downloading', percent: 0, receivedBytes: 0 });
      let lastProgress = 0;
      const file = await download(asset, cache, fetchImpl, signal, (percent, receivedBytes) => {
        if (percent !== state.percent || Date.now() - lastProgress >= 150 || receivedBytes === asset.bytes) {
          lastProgress = Date.now(); update({ percent, receivedBytes });
        }
      }, {
        downloading: () => update({ phase: 'downloading', percent: 0, receivedBytes: 0 }),
        verifying: () => update({ phase: 'verifying', percent: 100, receivedBytes: asset.bytes }),
      });
      if (disposed) return;
      ready = { asset, file }; update({ phase: 'ready', percent: 100 });
      if (manualWaiting) await installNow(true); else if (intent === 'legacy') notifyReady();
    } catch (error) {
      if (!disposed && !controller.signal.aborted) {
        update({ phase: 'error', error: String(error.message).slice(0, 300) });
        if (manualWaiting) await showError(error); else logger.warn('Studio update check:', error.message);
      } else if (!disposed) update({ phase: ready ? 'ready' : 'cancelled' });
    } finally { controller = null; manualWaiting = false; manualRequest = false; }
  }
  async function check(manual = false, intent = 'legacy') {
    if (disposed) return;
    if (platform === 'linux') { update({ phase: 'manual', error: null }); if (manual && intent === 'legacy') await shell.openExternal(releasePage); return; }
    if (!app.isPackaged) { update({ phase: 'manual', error: null }); if (manual && intent === 'legacy') await message({ type: 'info', message: '설치된 배포 앱에서 업데이트를 확인할 수 있습니다.', buttons: ['확인'] }); return; }
    if (getState().manualOnly) { update({ phase: 'manual', error: null }); return; }
    if (manual && intent === 'legacy') manualWaiting = true;
    manualRequest ||= manual;
    if (busy) return busy;
    // Refresh release metadata even for cached files: removed/revoked releases
    // and downgrades must not be installed just because a cache exists.
    busy = performCheck(intent);
    try { await busy; } catch (error) { logger.warn('Studio updater:', error.message); } finally { busy = null; }
  }
  async function setAutomatic(value) {
    if (typeof value !== 'boolean') throw new TypeError('자동 업데이트 설정은 true 또는 false여야 합니다.');
    const write = async () => {
      const previous = enabled;
      enabled = value;
      try { await saveSettings(); }
      catch (error) { enabled = previous; update({ phase: 'error', error: String(error.message).slice(0, 300) }); await showError(error); return; }
      if (!enabled && !manualRequest) { controller?.abort(); update({ phase: ready ? 'ready' : 'idle', percent: 0 }); }
      update({});
    };
    const pending = settingsWrite.then(write, write);
    settingsWrite = pending.catch(() => {});
    return pending;
  }
  async function cancelDownload() {
    if (!['checking', 'downloading', 'verifying'].includes(state.phase)) return;
    controller?.abort();
    await busy;
  }
  async function revealDownload() {
    await check(true, 'download');
    if (!ready || disposed || state.phase !== 'ready') return;
    try { await verifyFile(ready.file, ready.asset); shell.showItemInFolder(ready.file); }
    catch (error) { ready = null; update({ phase: 'error', error: String(error.message).slice(0, 300) }); }
  }
  function menuTemplate() {
    if (platform === 'linux') return [{ label: '최신 버전 다운로드…', click: () => { void check(true); } }];
    const label = state.phase === 'downloading' ? `업데이트 다운로드 중… ${state.percent}%`
      : state.phase === 'checking' ? '업데이트 확인 중…' : state.phase === 'verifying' ? '업데이트 파일 검증 중…' : state.phase === 'installing' ? '업데이트 설치 대기 중…' : '업데이트 확인…';
    return [
      { label, enabled: !['checking', 'downloading', 'installing'].includes(state.phase), click: () => { void check(true); } },
      { label: '업데이트 자동 확인·다운로드', type: 'checkbox', checked: getState().automatic, enabled: !getState().manualOnly, click: item => { void setAutomatic(item.checked); } },
    ];
  }
  async function prepareWindowsHelper(job) {
    const log = path.join(cache, 'last-install.log');
    const startupLog = path.join(cache, 'helper-startup.log');
    const result = (status, message) => ({ status, version: ready.asset.version, message: String(message).slice(0, 300), completedAt: new Date().toISOString() });
    let descriptor, failure;
    try {
      await fs.writeFile(log, JSON.stringify(result('preparing', '설치 도우미를 시작하고 있습니다.')), { mode: 0o600 });
      const script = fsSync.readFileSync(path.join(__dirname, 'studio-update-windows.ps1'), 'utf8');
      await fs.writeFile(job + '.ps1', script, { flag: 'wx', mode: 0o600 });
      const digest = createHash('sha256').update(script).digest('hex');
      const bootstrap = "param($JobFile)\n$bytes = [IO.File]::ReadAllBytes($JobFile + '.ps1')\n" +
        "if ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-','').ToLowerInvariant() -ne '" + digest + "') { throw 'Update helper checksum mismatch.' }\n" +
        "& ([ScriptBlock]::Create([Text.Encoding]::UTF8.GetString($bytes))) -JobFile $JobFile";
      const encoded = powershellCommand(bootstrap, job);
      descriptor = fsSync.openSync(startupLog, 'w', 0o600);
      // A hidden cmd console lets PowerShell initialize and survive editor
      // shutdown. User paths appear only in the encoded, authenticated bootstrap.
      const command = 'start "" /b "%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -STA -NonInteractive -EncodedCommand ' + encoded;
      const helper = launch(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'),
        ['/d', '/s', '/c', command], { detached: false, stdio: ['ignore', descriptor, descriptor], windowsHide: true, windowsVerbatimArguments: true });
      helper.on('error', error => { failure = error; });
      helper.on('exit', code => { if (code !== 0) failure ||= new Error('업데이트 설치 도우미를 실행하지 못했습니다. 종료 코드: ' + code); });
      helper.unref();
      const deadline = Date.now() + helperReadyTimeout;
      while (Date.now() < deadline) {
        if (pendingJob !== job || disposed) return false;
        if (failure) break;
        try {
          const acknowledgement = JSON.parse((await fs.readFile(job + '.ready', 'utf8')).replace(/^\uFEFF/, ''));
          if (acknowledgement.schema !== 1 || acknowledgement.parentPid !== pid || acknowledgement.id !== id) throw new Error('업데이트 설치 도우미 응답이 올바르지 않습니다.');
          return true;
        } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw failure || new Error('업데이트 설치 도우미가 시작되지 않았습니다. helper-startup.log를 확인하세요.');
    } catch (error) {
      const lastInstall = result('failed', error.message);
      await fs.writeFile(log, JSON.stringify(lastInstall), { mode: 0o600 }).catch(reason => logger.warn('Studio helper log:', reason.message));
      update({ lastInstall });
      throw error;
    } finally { if (descriptor !== undefined) fsSync.closeSync(descriptor); }
  }
  async function start() {
    try { const saved = JSON.parse(await fs.readFile(settingsFile, 'utf8')); if (typeof saved.automatic === 'boolean') enabled = saved.automatic; }
    catch (error) { if (error.code !== 'ENOENT') logger.warn('Studio update preferences:', error.message); }
    try {
      const result = await readInstallResult(path.join(cache, 'last-install.log'));
      if (result) {
        if (result.status === 'installed' && result.version !== app.getVersion()) {
          result.status = 'failed'; result.message = '설치 결과와 실행 중인 앱 버전이 다릅니다. 공식 설치 파일로 다시 업데이트해 주세요.';
        }
        update({ lastInstall: result, phase: result.status === 'installed' ? 'installed' : 'error', error: result.status === 'failed' ? result.message : null });
        await fs.rename(path.join(cache, 'last-install.log'), path.join(cache, 'last-install-seen.log'));
      }
    } catch (error) { logger.warn('Studio update result:', error.message); }
    update({});
    if (disposed || !app.isPackaged || platform === 'linux' || process.env.STUDIO_DISABLE_UPDATES === '1') return;
    startTimer = setTimeout(() => { if (enabled) void check(); }, 15_000);
    interval = setInterval(() => { if (enabled && !busy && !pendingJob) void check(); }, CHECK_INTERVAL);
    startTimer.unref?.(); interval.unref?.();
  }
  function dispose() {
    disposed = true; clearTimeout(startTimer); clearInterval(interval); controller?.abort(); notification?.close();
    listeners.clear();
  }
  return { start, check, checkOnly: () => check(true, 'check'), downloadUpdate: () => check(true, 'download'), installNow, cancelInstall, cancelDownload, setAutomatic, revealDownload,
    openReleasePage: () => shell.openExternal(releasePage), menuTemplate, onChange: callback => { listeners.add(callback); return () => listeners.delete(callback); }, getState, dispose };
}

module.exports = { createStudioUpdater, selectRelease, selectMacRelease, newer, readJSON, download, verifyFile, powershellCommand, readInstallResult };
