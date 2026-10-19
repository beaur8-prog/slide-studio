'use strict';
// Real-frame checks shared by packaged Mac and disposable Windows/Linux apps.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
async function verifyAnimatedMedia(page, output, { app }) {
  const directory = path.join(output, 'animated-media');
  await fs.mkdir(directory, { recursive: true });
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    const blank = path.join(directory, 'blank.slide');
    await fs.writeFile(blank, JSON.stringify({ version: 1, id: 'native-media', name: 'GIF MP4 WebM native QA', width: 1280, height: 720, theme: 'studio', slides: [{ id: 's1', background: '#FFFFFF', notes: '', transition: 'none', elements: [] }] }));
    const results = [];
    for (const ext of ['gif', 'mp4', 'webm']) {
      console.log('Native media verification: ' + ext);
      await page.locator('input[accept*=".pptx"]').setInputFiles(blank);
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(0);
      const input = ext === 'gif' ? page.locator('input[accept="image/png,image/jpeg,image/gif,image/webp"]') : page.locator('input[accept*="video/mp4"]');
      await input.setInputFiles(path.resolve(__dirname, `../tests/fixtures/media/animated.${ext}`));
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      await page.reload();
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      await page.getByRole('button', { name: '발표 모드', exact: true }).click();
      await expect(page.locator('.present-notes-toggle')).toHaveCount(0);
      const media = page.locator(`.present-slide ${ext === 'gif' ? 'img.element-image' : 'video'}`);
      await expect(media).toBeVisible();
      if (ext !== 'gif') await expect.poll(() => media.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
      const colors = new Set(), times = [], samples = [];
      // These clips alternate every 100 ms. A 100 ms screenshot plus a fixed
      // 100 ms wait can sample the same color forever on Xvfb. Use coprime,
      // varying intervals without weakening pixel/loop assertions.
      const intervals = [37, 83, 131, 59, 107, 71, 149];
      for (let i = 0; i < 18; i++) {
        const pixel = await sharp(await media.screenshot()).resize(1, 1).raw().toBuffer();
        colors.add(pixel[0] > pixel[2] ? 'red' : 'blue');
        const time = ext !== 'gif' ? await media.evaluate(v => v.currentTime) : null;
        if (time !== null) times.push(time);
        samples.push({ at: Date.now(), rgb: [...pixel.subarray(0, 3)], time });
        await page.waitForTimeout(intervals[i % intervals.length]);
      }
      await fs.writeFile(path.join(directory, `${ext}-frames.json`), JSON.stringify(samples, null, 2) + '\n');
      expect([...colors].sort()).toEqual(['blue', 'red']);
      if (ext !== 'gif') expect(times.some((t, i) => i && t < times[i - 1] - 0.2)).toBe(true);
      await page.screenshot({ path: path.join(directory, `${ext}-presentation.png`) });
      await page.keyboard.press('Escape');
      await expect(page.locator('video')).toHaveCount(0);
      results.push({ format: ext, autoSaveReload: true, animatedPixels: true, loop: ext === 'gif' ? 'original GIF loop preserved' : true, stoppedOnExit: true });
    }
    expect(errors).toEqual([]);
    const report = { version: await app.evaluate(({ app }) => app.getVersion()), platform: process.platform, results, errors };
    await fs.writeFile(path.join(output, 'animated-media.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Native GIF/MP4/WebM animation, looping and persistence verified');
    return report;
  } finally { page.off('pageerror', onError); }
}
module.exports = verifyAnimatedMedia;
if (require.main === module) (async () => {
  const executablePath = process.argv[2];
  if (!executablePath || !path.isAbsolute(executablePath)) throw Error('Pass the absolute packaged executable path');
  const output = path.resolve(process.argv[3] || 'qa/results/shapes-media/native');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-media-qa-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], chromiumSandbox: process.platform === 'linux', env, timeout: 45000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    await verifyAnimatedMedia(page, output, { app });
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
