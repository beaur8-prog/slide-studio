'use strict';

// Build an amd64 Debian package on macOS or Linux. Never disable Chromium's
// sandbox: the package installs the official helper root-owned, mode 4755.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const JSZip = require('jszip');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function packageLinux() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!fsSync.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Run npm run build first');
  const electronDir = path.dirname(require.resolve('electron/package.json'));
  const { version } = require(path.join(electronDir, 'package.json'));
  const filename = `electron-v${version}-linux-x64.zip`;
  const expected = require(path.join(electronDir, 'checksums.json'))[filename];
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('Missing official runtime checksum');
  const cache = path.join(root, '.cache/electron');
  await fs.mkdir(cache, { recursive: true });
  const runtime = path.join(cache, filename);
  const url = `https://github.com/electron/electron/releases/download/v${version}/${filename}`;
  if (!fsSync.existsSync(runtime)) {
    console.log('Downloading ' + url);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error('Runtime download failed: ' + response.status);
    await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(runtime + '.partial'));
    if (await hashFile(runtime + '.partial') !== expected) throw new Error('Runtime checksum mismatch');
    await fs.rename(runtime + '.partial', runtime);
  }
  if (await hashFile(runtime) !== expected) throw new Error('Cached runtime checksum mismatch');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-linux-'));
  try {
    const app = path.join(work, 'payload/opt/slide-studio');
    await fs.mkdir(app, { recursive: true });
    const zip = await JSZip.loadAsync(await fs.readFile(runtime), { checkCRC32: true });
    for (const [name, entry] of Object.entries(zip.files)) {
      if (name === 'resources/default_app.asar') continue;
      const target = path.resolve(app, name);
      const mode = Number(entry.unixPermissions || 0);
      if ((entry.unsafeOriginalName && entry.unsafeOriginalName !== name) ||
          !target.startsWith(app + path.sep) || (mode & 0o170000) === 0o120000) throw new Error('Unsafe runtime ZIP entry');
      if (entry.dir) await fs.mkdir(target, { recursive: true });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, await entry.async('nodebuffer'), { mode: mode & 0o111 ? 0o755 : 0o644 });
      }
    }
    const elf = await fs.readFile(path.join(app, 'electron'));
    if (!elf.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) || elf[4] !== 2 || elf[5] !== 1 || elf.readUInt16LE(18) !== 62) throw new Error('Expected ELF64 x86-64 runtime');
    await fs.rename(path.join(app, 'electron'), path.join(app, 'slide-studio'));
    // Explicit modes are portable even when packaging on macOS.
    for (const name of ['slide-studio', 'chrome-sandbox', 'chrome_crashpad_handler']) await fs.chmod(path.join(app, name), 0o755);
    const source = path.join(work, 'source');
    await fs.mkdir(source);
    for (const name of ['dist', 'electron']) await fs.cp(path.join(root, name), path.join(source, name), { recursive: true });
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
      name: manifest.name, version: manifest.version, description: manifest.description,
      author: manifest.author, main: 'electron/main.cjs',
    }, null, 2));
    const appAsar = path.join(app, 'resources/app.asar');
    await asar.createPackage(source, appAsar);
    for (const name of ['dist/index.html', 'electron/main.cjs', 'electron/preload.cjs']) asar.extractFile(appAsar, name);
    const payload = path.join(work, 'payload');
    const desktop = path.join(payload, 'usr/share/applications');
    const icons = path.join(payload, 'usr/share/icons/hicolor/512x512/apps');
    await fs.mkdir(desktop, { recursive: true });
    await fs.mkdir(icons, { recursive: true });
    await fs.mkdir(path.join(payload, 'usr/bin'), { recursive: true });
    await fs.symlink('/opt/slide-studio/slide-studio', path.join(payload, 'usr/bin/slide-studio'));
    await fs.copyFile(path.join(root, 'electron/assets/SlideStudio.png'), path.join(icons, 'slide-studio.png'));
    await fs.writeFile(path.join(desktop, 'slide-studio.desktop'), [
      '[Desktop Entry]', 'Type=Application', 'Name=Slide Studio', 'Comment=Presentation editor',
      'Comment[ko]=프레젠테이션 편집기', 'Exec=/opt/slide-studio/slide-studio %U',
      'TryExec=/opt/slide-studio/slide-studio', 'Icon=slide-studio', 'Terminal=false',
      'Categories=Office;Presentation;', 'StartupWMClass=slide-studio', '',
    ].join('\n'));
    for (const name of ['slide-studio', 'chrome-sandbox', 'chrome_crashpad_handler', 'resources/app.asar', 'locales/ko.pak', 'icudtl.dat', 'LICENSE', 'LICENSES.chromium.html']) {
      if (!(await fs.stat(path.join(app, name))).size) throw new Error('Missing required file: ' + name);
    }
    const release = path.join(root, 'release');
    await fs.mkdir(release, { recursive: true });
    const archive = path.join(release, 'Slide-Studio-linux-amd64.deb');
    const built = JSON.parse(execFileSync('python3', [path.join(__dirname, 'write-deb.py'), payload, archive + '.partial', manifest.version], { encoding: 'utf8' }));
    await fs.rename(archive + '.partial', archive);
    const metadata = {
      product: 'Slide Studio', version: manifest.version, platform: 'linux', architecture: 'amd64',
      format: 'Debian package', testedDistributions: [], signing: 'unsigned standalone deb',
      builtAt: new Date().toISOString(), archive: path.basename(archive),
      archiveBytes: (await fs.stat(archive)).size, archiveSHA256: await hashFile(archive),
      appAsarSHA256: await hashFile(appAsar), executableSHA256: await hashFile(path.join(app, 'slide-studio')),
      electronVersion: version, electronSource: url, electronSHA256: expected,
      checks: { runtimeChecksum: true, runtimeCRC32: true, elf64X64: true, productionAsar: true,
        rootOwnedPayload: true, sandboxHelper4755: true, debReadback: true, nativeLinuxInstall: false }, ...built,
    };
    await fs.writeFile(path.join(release, 'BUILD-linux-amd64.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}
packageLinux().catch(error => { console.error(error.stack); process.exitCode = 1; });
