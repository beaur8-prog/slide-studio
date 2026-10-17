'use strict';

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createIcon } = require('./create-icon.cjs');

const root = path.resolve(__dirname, '..');
const PRODUCT_NAME = 'Slide Studio';
const APP_ID = 'local.slidestudio.app';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

function plistSet(filename, key, value, type = 'string') {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, filename], { stdio: 'ignore' });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, filename], { stdio: 'ignore' });
  }
}

async function findElectronBundle() {
  const packageCandidates = [root, path.dirname(root)].map(directory => path.join(directory, 'node_modules', 'electron'));
  for (const directory of packageCandidates) {
    const bundle = path.join(directory, 'dist', 'Electron.app');
    if (fsSync.existsSync(path.join(bundle, 'Contents', 'MacOS', 'Electron'))) {
      return { directory, bundle };
    }
  }
  throw new Error('Electron.app is missing. Run node node_modules/electron/install.js to install the Electron runtime, then package again.');
}

async function packageMac() {
  if (process.platform !== 'darwin') throw new Error('Build this macOS application on a Mac.');
  if (!fsSync.existsSync(path.join(root, 'dist', 'index.html'))) throw new Error('Run npm run build before packaging.');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const asar = require(require.resolve('@electron/asar', { paths: [root, path.dirname(root)] }));
  const electron = await findElectronBundle();
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-build-'));
  const release = path.join(root, 'release');
  const destination = path.join(release, `${PRODUCT_NAME}.app`);
  const bundle = path.join(work, `${PRODUCT_NAME}.app`);
  let preserveVerifiedBundle = false;
  try {
    await fs.cp(electron.bundle, bundle, { recursive: true, dereference: false, verbatimSymlinks: true });
    const contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources');
    const appSource = path.join(work, 'app-source');
    await fs.mkdir(appSource);
    await fs.cp(path.join(root, 'dist'), path.join(appSource, 'dist'), { recursive: true });
    await fs.cp(path.join(root, 'electron'), path.join(appSource, 'electron'), { recursive: true });
    await fs.writeFile(path.join(appSource, 'package.json'), JSON.stringify({
      name: manifest.name, version: manifest.version, description: manifest.description,
      author: manifest.author, main: 'electron/main.cjs',
    }, null, 2));
    await fs.rm(path.join(resources, 'default_app.asar'), { force: true });
    await asar.createPackage(appSource, path.join(resources, 'app.asar'));
    const icon = await createIcon(path.join(work, 'artwork'));
    await fs.copyFile(icon, path.join(resources, 'SlideStudio.icns'));
    for (const filename of ['LICENSE', 'LICENSES.chromium.html']) {
      await fs.copyFile(path.join(electron.directory, 'dist', filename), path.join(resources, `Electron-${filename}`));
    }

    const plist = path.join(contents, 'Info.plist');
    const executable = path.join(contents, 'MacOS');
    await fs.rename(path.join(executable, 'Electron'), path.join(executable, PRODUCT_NAME));
    for (const [key, value] of Object.entries({
      CFBundleDisplayName: PRODUCT_NAME,
      CFBundleName: PRODUCT_NAME,
      CFBundleExecutable: PRODUCT_NAME,
      CFBundleIdentifier: APP_ID,
      CFBundleIconFile: 'SlideStudio.icns',
      CFBundleShortVersionString: manifest.version,
      CFBundleVersion: manifest.version,
      LSApplicationCategoryType: 'public.app-category.productivity',
      NSHumanReadableCopyright: 'An independent presentation editor. Not affiliated with Microsoft.',
    })) plistSet(plist, key, value);
    // The stock integrity record refers to default_app.asar, which is removed.
    try { execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Delete :ElectronAsarIntegrity', plist], { stdio: 'ignore' }); } catch {}

    const frameworks = path.join(contents, 'Frameworks');
    for (const suffix of ['', ' (GPU)', ' (Plugin)', ' (Renderer)']) {
      const oldName = `Electron Helper${suffix}`;
      const newName = `${PRODUCT_NAME} Helper${suffix}`;
      const helper = path.join(frameworks, `${oldName}.app`);
      const helperContents = path.join(helper, 'Contents');
      await fs.rename(path.join(helperContents, 'MacOS', oldName), path.join(helperContents, 'MacOS', newName));
      const helperPlist = path.join(helperContents, 'Info.plist');
      plistSet(helperPlist, 'CFBundleExecutable', newName);
      plistSet(helperPlist, 'CFBundleName', newName);
      plistSet(helperPlist, 'CFBundleDisplayName', newName);
      plistSet(helperPlist, 'CFBundleIdentifier', `${APP_ID}.helper${suffix ? `.${suffix.replace(/[ ()]/g, '').toLowerCase()}` : ''}`);
      await fs.rename(helper, path.join(frameworks, `${newName}.app`));
    }

    run('/usr/bin/xattr', ['-cr', bundle]);
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
    await fs.mkdir(release, { recursive: true });
    // Replace only the generated app. Keep any unrelated files in release intact.
    const backup = `${destination}.previous`;
    await fs.rm(backup, { recursive: true, force: true });
    if (fsSync.existsSync(destination)) await fs.rename(destination, backup);
    try {
      await fs.cp(bundle, destination, { recursive: true, dereference: false, verbatimSymlinks: true });
    } catch (error) {
      await fs.rm(destination, { recursive: true, force: true });
      if (fsSync.existsSync(backup)) await fs.rename(backup, destination);
      throw error;
    }
    await fs.rm(backup, { recursive: true, force: true });
    const archive = path.join(release, `Slide-Studio-mac-${process.arch}.zip`);
    run('/usr/bin/ditto', ['-c', '-k', '--keepParent', bundle, archive]);
    await fs.copyFile(icon, path.join(release, 'SlideStudio.icns'));
    await fs.writeFile(path.join(release, 'BUILD.json'), JSON.stringify({
      product: PRODUCT_NAME, version: manifest.version, platform: 'darwin', architecture: process.arch,
      builtAt: new Date().toISOString(), signing: 'ad-hoc (local use; not Apple notarized)',
      minimumMacOS: '12.0', archive: path.basename(archive),
      verifiedBundle: bundle,
    }, null, 2));
    preserveVerifiedBundle = true;
    console.log(`\nBuilt ${destination}\nArchive ${archive}\nVerified app ${bundle}`);
  } finally {
    if (preserveVerifiedBundle) {
      await fs.rm(path.join(work, 'app-source'), { recursive: true, force: true });
      await fs.rm(path.join(work, 'artwork'), { recursive: true, force: true });
    } else {
      await fs.rm(work, { recursive: true, force: true });
    }
  }
}

packageMac().catch(error => { console.error(error.message); process.exitCode = 1; });
