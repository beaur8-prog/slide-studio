'use strict';

// Wrap the verified Windows payload without changing the application itself.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const ResEdit = require('resedit');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function findTool(name, candidates, args) {
  for (const file of [process.env[name], ...candidates].filter(Boolean)) {
    try { return { file, version: execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }; }
    catch {}
  }
  throw new Error(`${name} is required. On macOS: brew install makensis sevenzip. On Windows: install NSIS and 7-Zip, or set ${name} to its executable path.`);
}

function quote(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid NSIS path');
  return '"' + value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"') + '"';
}

async function packageSetup() {
  const compiler = findTool('MAKENSIS', ['makensis', 'C:\\Program Files (x86)\\NSIS\\makensis.exe', 'C:\\Program Files\\NSIS\\makensis.exe'], ['-VERSION']);
  const sevenZip = findTool('SEVENZIP', ['7zz', '7z', 'C:\\Program Files\\7-Zip\\7z.exe'], ['i']);
  const release = path.join(root, 'release');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Expected a numeric three-part app version');
  const portable = JSON.parse(await fs.readFile(path.join(release, 'BUILD-win-x64.json'), 'utf8'));
  const archive = await fs.readFile(path.join(release, 'Slide-Studio-win-x64.zip'));
  if (portable.version !== manifest.version || digest(archive) !== portable.archiveSHA256 || archive.length !== portable.archiveBytes) {
    throw new Error('Windows ZIP does not match its build record; run npm run package:win');
  }
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-setup-'));
  const output = path.join(release, 'Slide-Studio-Setup-x64.exe');
  const temporaryOutput = output + '.partial';
  try {
    const payload = path.join(work, 'payload');
    const zip = await JSZip.loadAsync(archive, { checkCRC32: true });
    const files = [];
    const dirs = new Set();
    let totalBytes = 0;
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.unsafeOriginalName && entry.unsafeOriginalName !== name) throw new Error('Unsafe ZIP path');
      if (!name.startsWith('Slide Studio/')) throw new Error('Unexpected Windows payload root');
      const relative = name.slice('Slide Studio/'.length);
      if (!relative || entry.dir) continue;
      // The portable ZIP's extraction instructions do not belong in Setup.
      if (relative === '시작하기.txt') continue;
      if (relative.includes('\\') || relative.split('/').some(p => !p || p === '.' || p === '..' || /[<>:"|?*\r\n\0]/.test(p))) throw new Error('Unsafe Windows payload path');
      const file = path.resolve(payload, relative);
      if (!file.startsWith(payload + path.sep)) throw new Error('Unsafe payload path');
      const bytes = await entry.async('nodebuffer');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
      files.push({ name: relative, bytes: bytes.length, sha256: digest(bytes) });
      totalBytes += bytes.length;
      let dir = path.posix.dirname(relative);
      while (dir !== '.') { dirs.add(dir); dir = path.posix.dirname(dir); }
    }
    files.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const [name, expected] of [['resources/app.asar', portable.appAsarSHA256], ['Slide Studio.exe', portable.executableSHA256]]) {
      if (files.find(f => f.name === name)?.sha256 !== expected) throw new Error('Payload digest mismatch: ' + name);
    }
    const appAsar = path.join(payload, 'resources/app.asar');
    if (JSON.parse(asar.extractFile(appAsar, 'package.json')).version !== manifest.version) throw new Error('ASAR version mismatch');
    asar.extractFile(appAsar, path.join('electron', 'assets', 'SlideStudio.png'));
    const install = path.join(work, 'install-files.nsh');
    const uninstall = path.join(work, 'remove-files.nsh');
    const qTarget = name => '"$INSTDIR\\' + name.replaceAll('/', '\\').replace(/\$/g, '$$$$').replace(/"/g, '$\\"') + '"';
    await fs.writeFile(install, files.map(f => `SetOutPath ${qTarget(path.posix.dirname(f.name) === '.' ? '' : path.posix.dirname(f.name))}\nFile ${quote(path.join(payload, f.name))}`).join('\n') + '\n');
    await fs.writeFile(uninstall, [
      ...files.map(f => `Delete ${qTarget(f.name)}`),
      ...[...dirs].sort((a, b) => b.split('/').length - a.split('/').length).map(d => `RMDir ${qTarget(d)}`),
    ].join('\n') + '\n');
    const args = [
      '-V3', '-WX', '-INPUTCHARSET', 'UTF8',
      '-DAPP_VERSION=' + manifest.version,
      '-DOUTPUT_FILE=' + temporaryOutput,
      '-DAPP_ICON=' + path.join(payload, 'SlideStudio.ico'),
      '-DPAYLOAD_FILES=' + install,
      '-DREMOVE_FILES=' + uninstall,
      '-DINSTALLED_KIB=' + Math.ceil(totalBytes / 1024),
      path.join(root, 'scripts/windows-installer.nsi'),
    ];
    execFileSync(compiler.file, args, { stdio: 'inherit' });
    const setupBytes = await fs.readFile(temporaryOutput);
    const exe = ResEdit.NtExecutable.from(setupBytes, { ignoreCert: true });
    const resources = ResEdit.NtExecutableResource.from(exe).entries;
    const versions = ResEdit.Resource.VersionInfo.fromEntries(resources);
    if (!versions.some(info => info.getAllLanguagesForStringValues().some(lang => {
      const values = info.getStringValues(lang);
      return values.ProductName === 'Slide Studio Setup' && values.ProductVersion === manifest.version;
    }))) throw new Error('Installer version resources do not match the app');
    const windowsManifest = resources.find(entry => entry.type === 24);
    if (!windowsManifest || !Buffer.from(windowsManifest.bin).toString('utf8').includes('level="asInvoker"')) throw new Error('Installer must use per-user privileges');
    if (!ResEdit.Resource.IconGroupEntry.fromEntries(resources).length) throw new Error('Installer icon is missing');
    execFileSync(sevenZip.file, ['t', temporaryOutput], { stdio: 'inherit' });
    const extracted = path.join(work, 'verified');
    execFileSync(sevenZip.file, ['x', '-y', '-o' + extracted, temporaryOutput], { stdio: 'inherit' });
    for (const file of files) {
      const extractedBytes = await fs.readFile(path.join(extracted, file.name));
      if (extractedBytes.length !== file.bytes || digest(extractedBytes) !== file.sha256) throw new Error('Installer payload mismatch: ' + file.name);
    }
    await fs.rename(temporaryOutput, output);
    const metadata = {
      product: 'Slide Studio', version: manifest.version, platform: 'win32', architecture: 'x64',
      format: 'NSIS per-user Setup.exe', signing: 'unsigned', builtAt: new Date().toISOString(),
      installer: path.basename(output), installerBytes: setupBytes.length, installerSHA256: digest(setupBytes),
      compiler: compiler.version, appAsarSHA256: portable.appAsarSHA256,
      sourceArchiveSHA256: portable.archiveSHA256, payloadFiles: files.length, payloadBytes: totalBytes,
      excludedPortableFiles: ['시작하기.txt'],
      installDirectory: '%LOCALAPPDATA%\\Programs\\Slide Studio',
      shortcuts: ['Start menu', 'Desktop (optional)'], uninstallRegistry: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\SlideStudio',
      fileAssociations: { extensions: ['pptx', 'slide'], scope: 'current user', defaultAppUnchanged: true },
      checks: { portableChecksum: true, portableCRC32: true, installerArchiveIntegrity: true,
        extractedPayloadSHA256: true, versionAndIcon: true, perUserManifest: true,
        uninstallerExcludesUserProfile: true, nativeWindowsInstall: false },
    };
    await fs.writeFile(path.join(release, 'BUILD-win-setup-x64.json'), JSON.stringify(metadata, null, 2) + '\n');
    await fs.writeFile(path.join(release, 'SETUP-PAYLOAD.json'), JSON.stringify(files, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    await fs.rm(temporaryOutput, { force: true });
    await fs.rm(work, { recursive: true, force: true });
  }
}

packageSetup().catch(error => { console.error(error.stack); process.exitCode = 1; });
