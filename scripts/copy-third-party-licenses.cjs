'use strict';
// Retain complete copyright/license texts for production npm dependencies.
// Fonts and Apache preset geometry also have their own notices in this folder.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const texts = ['Slide Studio — third-party npm notices\n\nThese notices apply to the components named below, not to Slide Studio as a whole.\nJSZip is used under its MIT licensing option. Electron/Chromium notices accompany the packaged runtime separately.\n'];
let count = 0;
for (const [relative, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!relative || entry.dev) continue;
  const directory = path.resolve(root, relative);
  if (!directory.startsWith(path.join(root, 'node_modules') + path.sep)) throw Error('Unexpected dependency path');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  if (manifest.version !== entry.version) throw Error('Install locked dependencies before building: ' + relative);
  // This obsolete npm dependency contains metadata only. HTTPS is a Node
  // built-in, and no code from this empty package is shipped by Vite.
  if (manifest.name === 'https' && fs.readdirSync(directory).every(name => name === 'package.json')) continue;
  const files = fs.readdirSync(directory).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name) && fs.statSync(path.join(directory, name)).isFile()).sort();
  if (!files.length) {
    const readme = fs.readdirSync(directory).find(name => /^readme(?:\.|$)/i.test(name));
    if (readme && /Permission is hereby granted|Permission to use, copy|Redistribution and use/.test(fs.readFileSync(path.join(directory, readme), 'utf8'))) files.push(readme);
  }
  if (!files.length) throw Error('Missing license text: ' + manifest.name);
  texts.push('\n' + '='.repeat(72) + `\n${manifest.name} ${manifest.version}\nLicense: ${entry.license || manifest.license}\n`);
  for (const name of files) texts.push(`\n--- ${name} ---\n` + fs.readFileSync(path.join(directory, name), 'utf8'));
  if (manifest.name === 'pako') {
    const source = fs.readFileSync(path.join(directory, 'lib/zlib/deflate.js'), 'utf8');
    const end = source.indexOf('\nvar ');
    if (end < 0 || !source.slice(0, end).includes('Jean-loup Gailly')) throw Error('Missing embedded zlib notice');
    texts.push('\n--- embedded zlib notice ---\n' + source.slice(0, end));
  }
  count++;
}
const destination = path.join(root, 'public/licenses/THIRD-PARTY-NOTICES.txt');
fs.mkdirSync(path.dirname(destination), { recursive: true });
const result = texts.join('\n') + '\n';
if (!fs.existsSync(destination) || fs.readFileSync(destination, 'utf8') !== result) fs.writeFileSync(destination, result);
console.log('Included license texts for ' + count + ' production npm components.');
