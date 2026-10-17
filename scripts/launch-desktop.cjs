'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const suffix = process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron'
  : process.platform === 'win32' ? 'electron.exe' : 'electron';
const executable = [root, path.dirname(root)]
  .map(directory => path.join(directory, 'node_modules', 'electron', 'dist', suffix))
  .find(filename => fs.existsSync(filename));

if (!executable) {
  console.error('Electron is not installed. Run node node_modules/electron/install.js and try again.');
  process.exitCode = 1;
} else {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.argv.includes('--dev')) env.SLIDE_STUDIO_DEV = '1';
  const child = spawn(executable, [root], { cwd: root, stdio: 'inherit', env });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}
