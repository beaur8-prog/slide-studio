'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="orange" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff874c"/><stop offset="1" stop-color="#d74b1f"/></linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fffdf7"/><stop offset="1" stop-color="#ffeadc"/></linearGradient>
  </defs>
  <rect x="62" y="62" width="900" height="900" rx="212" fill="url(#orange)"/>
  <rect x="184" y="254" width="656" height="444" rx="58" fill="#a73013" opacity=".18"/>
  <path d="M512 673v104m0-2-112 68m112-68 112 68" fill="none" stroke="#ffede0" stroke-width="42" stroke-linecap="round"/>
  <rect x="184" y="222" width="656" height="444" rx="58" fill="url(#paper)"/>
  <rect x="254" y="290" width="274" height="30" rx="15" fill="#db592b"/>
  <rect x="254" y="350" width="172" height="19" rx="9.5" fill="#ecb69c"/>
  <rect x="254" y="390" width="139" height="19" rx="9.5" fill="#ecb69c"/>
  <rect x="498" y="459" width="64" height="125" rx="13" fill="#ffb288"/>
  <rect x="591" y="398" width="64" height="186" rx="13" fill="#f48956"/>
  <rect x="684" y="334" width="64" height="250" rx="13" fill="#dc5e2e"/>
  <circle cx="309" cy="535" r="49" fill="#e67b4c"/>
  <path d="M309 486v49h49a49 49 0 0 0-49-49" fill="#f9c5a8"/>
</svg>`;

async function createIcon(destination) {
  const sharp = require(require.resolve('sharp', { paths: [root, path.dirname(root)] }));
  const iconset = path.join(destination, 'SlideStudio.iconset');
  await fs.mkdir(iconset, { recursive: true });
  await fs.writeFile(path.join(destination, 'SlideStudio.svg'), ICON_SVG);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
      await sharp(Buffer.from(ICON_SVG)).resize(size * scale, size * scale).png().toFile(path.join(iconset, filename));
    }
  }
  // Modern macOS accepts PNG representations inside an ICNS container. Write
  // the container directly so packaging does not need ImageIO system services.
  const representations = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
    ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];
  const chunks = [];
  for (const [type, size] of representations) {
    const png = await sharp(Buffer.from(ICON_SVG)).resize(size, size).png().toBuffer();
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((length, chunk) => length + chunk.length, 0), 4);
  const icon = path.join(destination, 'SlideStudio.icns');
  await fs.writeFile(icon, Buffer.concat([header, ...chunks]));
  return icon;
}

async function createWindowsIcon(destination) {
  const sharp = require(require.resolve('sharp', { paths: [root, path.dirname(root)] }));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(size => sharp(Buffer.from(ICON_SVG)).resize(size, size).png().toBuffer()));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  images.forEach((png, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = sizes[index] % 256;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await fs.mkdir(destination, { recursive: true });
  const icon = path.join(destination, 'SlideStudio.ico');
  await fs.writeFile(icon, Buffer.concat([directory, ...images]));
  return icon;
}

async function createRuntimeIcon() {
  const sharp = require(require.resolve('sharp', { paths: [root, path.dirname(root)] }));
  const destination = path.join(root, 'electron', 'assets');
  await fs.mkdir(destination, { recursive: true });
  const icon = path.join(destination, 'SlideStudio.png');
  await sharp(Buffer.from(ICON_SVG)).resize(1024, 1024).png().toFile(icon);
  return icon;
}

module.exports = { createIcon, createWindowsIcon, createRuntimeIcon };
if (require.main === module) {
  const task = process.argv.includes('--runtime')
    ? createRuntimeIcon()
    : createIcon(path.resolve(process.argv[2] || path.join(root, 'release', 'artwork')));
  task
    .then(filename => console.log(filename))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
