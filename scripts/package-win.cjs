'use strict';

// Cross-platform Windows ZIP packager. Only the official, checksum-verified
// Electron runtime and the production app are distributed.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const JSZip = require('jszip');
const asar = require('@electron/asar');
const ResEdit = require('resedit');
const { createWindowsIcon } = require('./create-icon.cjs');
const root = path.resolve(__dirname, '..');
const product = 'Slide Studio';
const executable = product + '.exe';

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function runtime() {
  const electronDirectory = path.dirname(require.resolve('electron/package.json'));
  const { version } = JSON.parse(await fs.readFile(path.join(electronDirectory, 'package.json'), 'utf8'));
  const filename = 'electron-v' + version + '-win32-x64.zip';
  const checksums = JSON.parse(await fs.readFile(path.join(electronDirectory, 'checksums.json'), 'utf8'));
  const expected = checksums[filename];
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('No published checksum for ' + filename);
  const cache = path.join(root, '.cache', 'electron');
  await fs.mkdir(cache, { recursive: true });
  const file = path.join(cache, filename);
  const url = 'https://github.com/electron/electron/releases/download/v' + version + '/' + filename;
  if (!fsSync.existsSync(file)) {
    console.log('Downloading ' + url);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || !response.body) throw new Error('Electron download failed: HTTP ' + response.status);
    await pipeline(Readable.fromWeb(response.body), fsSync.createWriteStream(file + '.partial', { flags: 'w' }));
    if (await hashFile(file + '.partial') !== expected) throw new Error('Electron checksum mismatch');
    await fs.rename(file + '.partial', file);
  }
  if (await hashFile(file) !== expected) throw new Error('Cached Electron checksum mismatch');
  return { version, file, sha256: expected, url };
}

function verifyPE(bytes) {
  if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Missing DOS header');
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.readUInt32LE(pe) !== 0x4550 || bytes.readUInt16LE(pe + 4) !== 0x8664 ||
      bytes.readUInt16LE(pe + 24) !== 0x20b) throw new Error('Expected a Windows x64 PE32+ executable');
}

async function rebrand(file, icon, version) {
  const original = await fs.readFile(file);
  verifyPE(original);
  const exe = ResEdit.NtExecutable.from(original, { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(exe);
  const icons = ResEdit.Data.IconFile.from(await fs.readFile(icon));
  for (const group of ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons.icons.map(i => i.data));
  }
  for (const info of ResEdit.Resource.VersionInfo.fromEntries(resources.entries)) {
    info.setFileVersion(version + '.0');
    info.setProductVersion(version + '.0');
    for (const language of info.getAllLanguagesForStringValues()) info.setStringValues(language, {
      CompanyName: product, FileDescription: product, ProductName: product,
      InternalName: product, OriginalFilename: executable,
      FileVersion: version, ProductVersion: version,
      LegalCopyright: 'Independent presentation editor. Not affiliated with Microsoft.',
    });
    info.outputToResourceEntries(resources.entries);
  }
  // These inherited resources refer to Electron's removed default_app.asar.
  resources.entries = resources.entries.filter(entry => entry.type !== 'INTEGRITY');
  resources.outputResource(exe);
  const output = Buffer.from(exe.generate());
  verifyPE(output);
  // PE editing must preserve every executable code section byte-for-byte.
  const parsed = ResEdit.NtExecutable.from(output);
  for (const section of exe.getAllSections().filter(s => s.info.characteristics & 0x20000000)) {
    const after = parsed.getAllSections().find(s => s.info.name === section.info.name);
    if (!after || !Buffer.from(section.data).equals(Buffer.from(after.data))) throw new Error('Code section changed');
  }
  const verifiedInfo = ResEdit.Resource.VersionInfo.fromEntries(ResEdit.NtExecutableResource.from(parsed).entries);
  if (!verifiedInfo.some(info => info.getAllLanguagesForStringValues().some(lang =>
    info.getStringValues(lang).ProductName === product && info.getStringValues(lang).ProductVersion === version))) {
    throw new Error('Windows product metadata verification failed');
  }
  await fs.writeFile(path.join(path.dirname(file), executable), output);
  await fs.unlink(file);
}

async function packageWindows() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (!fsSync.existsSync(path.join(root, 'dist/index.html'))) throw new Error('Run npm run build first');
  const electron = await runtime();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-windows-'));
  try {
    const app = path.join(work, product);
    await fs.mkdir(app);
    const runtimeZip = await JSZip.loadAsync(await fs.readFile(electron.file), { checkCRC32: true });
    for (const [name, entry] of Object.entries(runtimeZip.files)) {
      if (name === 'resources/default_app.asar') continue;
      if (entry.unsafeOriginalName && entry.unsafeOriginalName !== name) throw new Error('Unsafe runtime ZIP entry');
      const target = path.resolve(app, name);
      if (!target.startsWith(app + path.sep)) throw new Error('Unsafe runtime ZIP path');
      if (entry.dir) await fs.mkdir(target, { recursive: true });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, await entry.async('nodebuffer'));
      }
    }
    const source = path.join(work, 'app-source');
    await fs.mkdir(source);
    for (const directory of ['dist', 'electron']) await fs.cp(path.join(root, directory), path.join(source, directory), { recursive: true });
    await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({
      name: manifest.name, version: manifest.version, description: manifest.description,
      author: manifest.author, main: 'electron/main.cjs',
    }, null, 2));
    const appAsar = path.join(app, 'resources/app.asar');
    await asar.createPackage(source, appAsar);
    const icon = await createWindowsIcon(path.join(work, 'artwork'));
    await rebrand(path.join(app, 'electron.exe'), icon, manifest.version);
    await fs.copyFile(icon, path.join(app, 'SlideStudio.ico'));
    const readme = [
      'Slide Studio ' + manifest.version + ' | Windows 10/11 x64',
      '',
      '1. ZIP 파일 전체를 원하는 폴더에 압축 해제합니다.',
      '2. 압축을 푼 폴더의 Slide Studio.exe를 실행합니다.',
      '3. 파일 > 파일 열기에서 .pptx 또는 .slide 파일을 선택합니다.',
      '',
      'EXE만 이동하지 말고 resources, locales, DLL을 포함한 폴더 전체를 보관하세요.',
      'PowerPoint, Node.js, 인터넷 연결을 별도로 설치하거나 준비할 필요가 없습니다.',
      '자동 저장은 현재 PC의 사용자 계정에 저장됩니다. 이동과 백업은 .slide 파일로 하세요.',
      'Ctrl+S 저장 / Ctrl+O 열기 / Ctrl+P 인쇄 / Ctrl+Enter 발표',
      '',
      '이 빌드는 배포용 코드 서명이 없습니다. Windows 실행·프린터 실기 검증 전입니다.',
      'Microsoft PowerPoint의 독립 대체 편집기이며 모든 PPTX 기능을 지원하지 않습니다.',
      'OS 보안 정책으로 실행이 차단되면 해당 정책을 따르세요.',
      '',
    ].join('\r\n');
    await fs.writeFile(path.join(app, '시작하기.txt'), '\ufeff' + readme);
    const required = [
      executable, 'resources/app.asar', 'locales/ko.pak', 'locales/en-US.pak',
      'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin', 'ffmpeg.dll',
      'libEGL.dll', 'libGLESv2.dll', 'LICENSE', 'LICENSES.chromium.html',
    ];
    for (const file of required) {
      if (!(await fs.stat(path.join(app, file))).size) throw new Error('Empty required file: ' + file);
    }
    const packedManifest = JSON.parse(asar.extractFile(appAsar, 'package.json'));
    if (packedManifest.version !== manifest.version) throw new Error('App version mismatch');
    for (const file of ['dist/index.html', 'electron/main.cjs', 'electron/preload.cjs']) asar.extractFile(appAsar, file);
    const zip = new JSZip();
    async function add(directory, prefix) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) await add(path.join(directory, entry.name), prefix + entry.name + '/');
        else zip.file(prefix + entry.name, fsSync.createReadStream(path.join(directory, entry.name)));
      }
    }
    await add(app, product + '/');
    const release = path.join(root, 'release');
    await fs.mkdir(release, { recursive: true });
    const archive = path.join(release, 'Slide-Studio-win-x64.zip');
    await pipeline(zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 6 } }), fsSync.createWriteStream(archive + '.partial'));
    await fs.rename(archive + '.partial', archive);
    const metadata = {
      product, version: manifest.version, platform: 'win32', architecture: 'x64',
      minimumWindows: '10', format: 'portable ZIP', signing: 'unsigned',
      builtAt: new Date().toISOString(), archive: path.basename(archive),
      archiveBytes: (await fs.stat(archive)).size, archiveSHA256: await hashFile(archive),
      appAsarSHA256: await hashFile(appAsar), executableSHA256: await hashFile(path.join(app, executable)),
      electronVersion: electron.version, electronSource: electron.url, electronSHA256: electron.sha256,
      checks: { runtimeChecksum: true, runtimeCRC32: true, peX64: true, productMetadata: true,
        codeSectionsPreserved: true, requiredRuntimeFiles: true, productionAsar: true, nativeWindowsExecution: false },
    };
    await fs.writeFile(path.join(release, 'BUILD-win-x64.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.log(JSON.stringify(metadata, null, 2));
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

packageWindows().catch(error => { console.error(error.stack); process.exitCode = 1; });
