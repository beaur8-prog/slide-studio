'use strict';

// Exercise installer registration using tiny generated payloads. Native install
// checks run only on disposable CI hosts, never against a user's installation.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createWindowsIcon } = require('./create-icon.cjs');
const { writeLinuxFileAssociations } = require('./linux-file-associations.cjs');
const root = path.resolve(__dirname, '..');
const run = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const nsisQuote = value => '"' + value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"') + '"';
const mimeTypes = ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/x-slide-studio'];

async function windowsFixture(work) {
  const executable = path.join(work, 'Slide Studio.exe');
  if (process.platform === 'win32') await fs.copyFile(process.env.ComSpec, executable);
  else await fs.writeFile(executable, 'Cross-compiler fixture; not an application');
  const install = path.join(work, 'install-files.nsh'), remove = path.join(work, 'remove-files.nsh');
  await fs.writeFile(install, 'SetOutPath "$INSTDIR"\nFile ' + nsisQuote(executable) + '\n');
  await fs.writeFile(remove, 'Delete "$INSTDIR\\Slide Studio.exe"\n');
  const output = path.join(work, 'Registration-Setup.exe');
  const compiler = process.env.MAKENSIS || (process.platform === 'win32'
    ? path.join(process.env['ProgramFiles(x86)'], 'NSIS/makensis.exe') : 'makensis');
  run(compiler, ['-V2', '-WX', '-INPUTCHARSET', 'UTF8', '-DAPP_VERSION=0.0.0',
    '-DOUTPUT_FILE=' + output, '-DAPP_ICON=' + await createWindowsIcon(work),
    '-DPAYLOAD_FILES=' + install, '-DREMOVE_FILES=' + remove, '-DINSTALLED_KIB=512',
    path.join(root, 'scripts/windows-installer.nsi')]);
  assert.ok((await fs.stat(output)).size > 1000);
  if (process.platform === 'win32')
    run('pwsh', ['-NoProfile', '-File', path.join(root, 'scripts/qa-windows-file-registration.ps1'), '-Setup', output], { stdio: 'inherit' });
  return 'Windows installer compiles' + (process.platform === 'win32' ? '; native install/update/uninstall and shell registry checks pass' : ' (native checks run in Windows CI)');
}

async function linuxFixture(work) {
  const payload = path.join(work, 'payload');
  await writeLinuxFileAssociations(payload);
  await fs.mkdir(path.join(payload, 'opt/slide-studio'), { recursive: true });
  await fs.mkdir(path.join(payload, 'usr/bin'), { recursive: true });
  await fs.writeFile(path.join(payload, 'opt/slide-studio/slide-studio'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$SLIDE_REGISTRATION_LOG"\n', { mode: 0o755 });
  await fs.writeFile(path.join(payload, 'opt/slide-studio/chrome-sandbox'), 'Archive mode fixture only');
  await fs.symlink('/opt/slide-studio/slide-studio', path.join(payload, 'usr/bin/slide-studio'));
  const deb = path.join(work, 'registration.deb');
  run(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [path.join(root, 'scripts/write-deb.py'), payload, deb, '0.0.0']);
  // Independently inspect the real ar/tar output, including script executability.
  run(process.env.PYTHON || 'python3', ['-c', `import io,sys,tarfile,pathlib
p=pathlib.Path(sys.argv[1]).read_bytes(); assert p[:8]==b'!<arch>\\n'
members={}; at=8
while at<len(p):
 h=p[at:at+60]; n=int(h[48:58]); members[h[:16].decode().strip().rstrip('/')]=p[at+60:at+60+n]; at+=60+n+(n%2)
t=tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']))
for name in ['postinst','postrm']:
 m=t.getmember('./'+name); assert m.mode==0o755; assert t.extractfile(m).read()==pathlib.Path(sys.argv[2], 'linux-'+name).read_bytes()
c=t.extractfile('./control').read(); assert b'desktop-file-utils' in c and b'shared-mime-info' in c
t=tarfile.open(fileobj=io.BytesIO(members['data.tar.gz']))
d=t.extractfile('./usr/share/applications/slide-studio.desktop').read(); assert b'MimeType=application/vnd.openxmlformats-officedocument.presentationml.presentation;application/x-slide-studio;' in d
assert b'*.slide' in t.extractfile('./usr/share/mime/packages/slide-studio.xml').read()
`, deb, path.join(root, 'scripts')]);
  if (process.platform === 'linux') await nativeLinux(payload, work);
  return 'DEB contents, dependencies and executable cache-maintenance scripts verified' + (process.platform === 'linux' ? '; native MIME registration, launch, reinstall and removal pass' : ' (native checks run in Linux CI)');
}

async function nativeLinux(payload, work) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Native registration checks require disposable CI');
  const desktop = '/usr/share/applications/slide-studio.desktop', mime = '/usr/share/mime/packages/slide-studio.xml';
  for (const name of [desktop, mime, '/opt/slide-studio'])
    await assert.rejects(fs.stat(name), 'Refuse to overwrite a pre-existing installation');
  const data = path.join(work, 'data'), config = path.join(work, 'config');
  await fs.mkdir(path.join(data, 'applications'), { recursive: true }); await fs.mkdir(config);
  const env = { ...process.env, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config, LANG: 'C', LC_ALL: 'C', SLIDE_REGISTRATION_LOG: path.join(work, 'launch-arguments.txt') };
  const sentinel = '[Desktop Entry]\nType=Application\nName=Existing app\nExec=/bin/true %U\nMimeType=' + mimeTypes.join(';') + ';\n';
  await fs.writeFile(path.join(data, 'applications/qa-existing.desktop'), sentinel);
  run('update-desktop-database', [path.join(data, 'applications')], { env });
  const defaults = '[Default Applications]\n' + mimeTypes.map(type => type + '=qa-existing.desktop;\n').join('');
  await fs.writeFile(path.join(config, 'mimeapps.list'), defaults);
  const install = () => {
    run('sudo', ['mkdir', '-p', '/opt/slide-studio']);
    run('sudo', ['cp', path.join(payload, 'opt/slide-studio/slide-studio'), '/opt/slide-studio/slide-studio']);
    run('sudo', ['cp', path.join(payload, desktop), desktop]);
    run('sudo', ['cp', path.join(payload, mime), mime]);
    run('sudo', ['sh', path.join(root, 'scripts/linux-postinst'), 'configure']);
  };
  try {
    for (let pass = 0; pass < 2; pass++) {
      install();
      run('desktop-file-validate', [desktop]);
      for (const type of mimeTypes) {
        const association = run('gio', ['mime', type], { env });
        assert.match(association, /Default application[^\n]*qa-existing\.desktop/);
        assert.ok(association.includes('slide-studio.desktop'));
      }
      assert.equal(await fs.readFile(path.join(config, 'mimeapps.list'), 'utf8'), defaults);
    }
    const filename = path.join(work, '한글 공백 파일.slide');
    await fs.writeFile(filename, '{"version":1}');
    assert.match(run('gio', ['info', '-a', 'standard::content-type', filename], { env }), /application\/x-slide-studio/);
    run('gio', ['launch', desktop, filename], { env });
    let args = '';
    for (let n = 0; n < 100; n++) {
      try { args = await fs.readFile(env.SLIDE_REGISTRATION_LOG, 'utf8'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.ok(args.includes('한글') || args.includes('%ED%95%9C%EA%B8%80'));
  } finally {
    run('sudo', ['rm', '-f', desktop, mime, '/opt/slide-studio/slide-studio']);
    run('sudo', ['rmdir', '/opt/slide-studio']);
    run('sudo', ['sh', path.join(root, 'scripts/linux-postrm'), 'remove']);
  }
  for (const type of mimeTypes) {
    const association = run('gio', ['mime', type], { env });
    assert.match(association, /Default application[^\n]*qa-existing\.desktop/);
    assert.ok(!association.includes('slide-studio.desktop'));
  }
  assert.equal(await fs.readFile(path.join(config, 'mimeapps.list'), 'utf8'), defaults);
}

(async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-qa-registration-'));
  const checks = [];
  try {
    if (process.platform !== 'linux') checks.push(await windowsFixture(work));
    if (process.platform !== 'win32') checks.push(await linuxFixture(work));
    console.log(JSON.stringify({ passed: true, platform: process.platform, checks }, null, 2));
  } finally { await fs.rm(work, { recursive: true, force: true }); }
})().catch(error => { console.error(error); if (error.stderr) console.error(error.stderr); process.exitCode = 1; });
