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
      const input = ext === 'gif' ? page.getByLabel("그림 삽입 파일", { exact: true }) : page.locator('input[accept*="video/mp4"]');
      await input.setInputFiles(path.resolve(__dirname, `../tests/fixtures/media/animated.${ext}`));
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      await page.reload();
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      let gifOriginal, gifStill;
      if (ext === 'gif') {
        gifOriginal = 'data:image/gif;base64,' + (await fs.readFile(path.resolve(__dirname, '../tests/fixtures/media/animated.gif'))).toString('base64');
        const preview = page.locator('.editable-slide img.element-image');
        gifStill = await preview.getAttribute('src');
        expect(gifStill).not.toBe(gifOriginal);
        const decoded = Buffer.from(gifStill.split(',')[1], 'base64');
        expect((await sharp(decoded, { animated: true }).metadata()).pages ?? 1).toBe(1);
        await expect(page.locator('.thumbnail-list img.element-image')).toHaveAttribute('src', gifStill);
        const version = await app.evaluate(({ app }) => app.getVersion());
        if (version.localeCompare('1.6.16', undefined, { numeric: true }) >= 0) {
          // Print content now exists only during a native print/PDF request.
          // Inspect the real PDF input before its lifecycle cleanup, rather
          // than requiring every slide to stay mounted while editing.
          await expect(page.locator('.print-slide')).toHaveCount(0);
          const pdf = path.join(directory, 'gif-static-frame.pdf');
          await app.evaluate(({ BrowserWindow, dialog }, filePath) => {
            const contents = BrowserWindow.getAllWindows()[0].webContents;
            contents.__qaGifPDF = contents.printToPDF;
            dialog.__qaGifSave = dialog.showSaveDialog;
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
            contents.printToPDF = async function (options) {
              this.__qaGifPrintSource = await this.executeJavaScript("document.querySelector('.print-deck img.element-image')?.getAttribute('src')");
              return this.__qaGifPDF.call(this, options);
            };
          }, pdf);
          try {
            expect(await page.evaluate(() => window.desktop.exportPDF('GIF 고정 프레임 검증'))).toBe(pdf);
            expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.__qaGifPrintSource)).toBe(gifStill);
            expect((await fs.stat(pdf)).size).toBeGreaterThan(1000);
            await expect(page.locator('.print-slide')).toHaveCount(0);
          } finally {
            await app.evaluate(({ BrowserWindow, dialog }) => {
              const contents = BrowserWindow.getAllWindows()[0].webContents;
              contents.printToPDF = contents.__qaGifPDF;
              dialog.showSaveDialog = dialog.__qaGifSave;
              delete contents.__qaGifPDF; delete contents.__qaGifPrintSource; delete dialog.__qaGifSave;
            });
          }
        } else {
          await expect(page.locator('.print-deck img.element-image')).toHaveAttribute('src', gifStill);
        }
        await expect(page.locator(`img[src="${gifOriginal}"]`)).toHaveCount(0);
        await page.screenshot({ path: path.join(directory, 'gif-editor-still.png') });
      }
      await page.getByRole('button', { name: '발표 모드', exact: true }).click();
      await expect(page.locator('.present-notes-toggle')).toHaveCount(0);
      const media = page.locator(`.present-slide ${ext === 'gif' ? 'img.element-image' : 'video'}`);
      await expect(media).toBeVisible();
      if (ext === 'gif') await expect(media).toHaveAttribute('src', gifOriginal);
      if (ext !== 'gif') await expect.poll(() => media.evaluate(v => !v.paused && v.currentTime > 0)).toBe(true);
      // Screenshot capture takes longer than a frame on Windows CI. Observe
      // every presented video frame as well, so screenshots cannot repeatedly
      // miss a short red frame while playback and looping are working.
      if (ext !== 'gif') await media.evaluate(v => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        v.__qaFrames = [];
        const sample = (_now, metadata) => {
          context.drawImage(v, 0, 0, 1, 1);
          v.__qaFrames.push({ time: metadata.mediaTime, rgb: [...context.getImageData(0, 0, 1, 1).data].slice(0, 3) });
          v.__qaFrameCallback = v.requestVideoFrameCallback(sample);
        };
        v.__qaFrameCallback = v.requestVideoFrameCallback(sample);
      });
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
      if (ext === 'gif') expect([...colors].sort()).toEqual(['blue', 'red']);
      else {
        const presented = await media.evaluate(v => {
          v.cancelVideoFrameCallback(v.__qaFrameCallback);
          const frames = v.__qaFrames; delete v.__qaFrames; delete v.__qaFrameCallback; return frames;
        });
        await fs.writeFile(path.join(directory, `${ext}-presented-frames.json`), JSON.stringify(presented, null, 2) + '\n');
        expect([...new Set(presented.map(f => f.rgb[0] > f.rgb[2] ? 'red' : 'blue'))].sort()).toEqual(['blue', 'red']);
        // Also require visible screenshot pixels to change, rather than only
        // trusting the decoder, playback clock, or video properties.
        expect(Math.max(...samples.flatMap(a => samples.map(b => Math.max(...a.rgb.map((c, i) => Math.abs(c - b.rgb[i]))))))).toBeGreaterThan(20);
        expect(times.some((t, i) => i && t < times[i - 1] - 0.2)).toBe(true);
      }
      await page.screenshot({ path: path.join(directory, `${ext}-presentation.png`) });
      await page.keyboard.press('Escape');
      await expect(page.locator('video')).toHaveCount(0);
      if (ext === 'gif') {
        await expect(page.locator('.editable-slide img.element-image')).toHaveAttribute('src', gifStill);
        await expect(page.locator(`img[src="${gifOriginal}"]`)).toHaveCount(0);
      }
      results.push({ format: ext, autoSaveReload: true, animatedPixels: true, loop: ext === 'gif' ? 'original GIF loop preserved' : true, stoppedOnExit: true, ...(ext === 'gif' ? { staticEditorThumbnailPrint: true } : {}) });
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
    const fixtureDialogs = await require('./qa-generated-documents.cjs')(page, app, output);
    await verifyAnimatedMedia(page, output, { app });
    fixtureDialogs();
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    }).catch(() => {});
    await app.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
