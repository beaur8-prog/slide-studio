'use strict';

// Isolated packaged-app QA. The original PPTX is read only; all chooser writes
// go to output. Pass: source.pptx packaged-executable [output-directory].
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron, expect } = require('@playwright/test');
const JSZip = require('jszip');

(async () => {
  const source = path.resolve(process.argv[2]);
  const executablePath = process.argv[3];
  if (!executablePath) throw Error('Pass the source PPTX and packaged executable.');
  const output = path.resolve(process.argv[4] || '.cache/chart-import/native');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-qa-chart-'));
  const saved = path.join(output, 'native-chart-roundtrip.pptx'), pdf = path.join(output, 'native-chart.pdf');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SLIDE_STUDIO_DEV;
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + profile, source], env, timeout: 45000 });
  const result = { isolatedProfile: true, sourceReadOnly: true, checks: [] };
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await expect(page.locator('.thumbnail-button')).toHaveCount(15);
    await page.getByRole('button', { name: /^슬라이드 10:/ }).click();
    const chart = page.locator('.editable-slide [data-type="chart"]');
    await expect(chart.locator('[data-chart-line]')).toHaveCount(3);
    await expect(chart).toContainText('U(1)Y'); await expect(chart).toContainText('SU(3)C');
    result.checks.push('cold native file open displays all three lines and legends on slide 10');
    await page.locator('.editable-slide').screenshot({ path: path.join(output, 'native-slide-10.png') });
    await chart.click();
    if (!await page.locator('.inspector').isVisible()) await page.getByRole('button', { name: '서식', exact: true }).click();
    const width = page.getByRole('spinbutton', { name: '너비', exact: true });
    const before = Number(await width.inputValue());
    await width.fill('800'); await width.press('Enter');
    await expect(width).toHaveValue('800');
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await chart.click();
    await expect(width).toHaveValue(String(Math.round(before * 100) / 100));
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    await chart.click();
    await expect(width).toHaveValue('800');
    result.checks.push('native chart resize, undo and redo retain the data');
    await app.evaluate(({ dialog }, paths) => {
      dialog.showSaveDialog = async (_window, options) => ({ canceled: false, filePath: options.title === 'Export PDF' ? paths.pdf : paths.saved });
      dialog.showMessageBoxSync = () => 1;
    }, { saved, pdf });
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect.poll(() => fs.stat(saved).then(s => s.size, () => 0)).toBeGreaterThan(1000);
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    const originalZip = await JSZip.loadAsync(await fs.readFile(source));
    const savedZip = await JSZip.loadAsync(await fs.readFile(saved));
    async function chartValues(zip) {
      const values = [];
      for (const name of Object.keys(zip.files).filter(n => /\.xml$/.test(n) && n.includes('/charts/'))) {
        const xml = await zip.file(name).async('string');
        if (/<(?:\w+:)?chartSpace\b/.test(xml)) values.push([...xml.matchAll(/<(?:\w+:)?v(?:\s[^>]*)?>(.*?)<\/(?:\w+:)?v>/g)].map(m => m[1]));
      }
      return values;
    }
    expect(await chartValues(savedZip)).toEqual(await chartValues(originalZip));
    const slideXML = await savedZip.file('ppt/slides/slide10.xml').async('string');
    expect(slideXML).toContain('<c:chart '); expect(slideXML).toContain('<p:graphicFrame>');
    result.checks.push('disk PPTX contains a native chart with every original cached data value');
    await page.evaluate(() => window.desktop.exportPDF('chart-native'));
    expect((await fs.stat(pdf)).size).toBeGreaterThan(1000);
    result.checks.push('PDF export completes with vector charts');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
    await expect(page.locator('.thumbnail-button')).toHaveCount(15);
    await page.getByRole('button', { name: /^슬라이드 10:/ }).click();
    await expect(chart.locator('[data-chart-line]')).toHaveCount(3);
    result.checks.push('window recovery buffer reload retains chart');
    const oldId = await chart.getAttribute('data-element-id');
    await app.evaluate(({ app }, filename) => app.emit('open-file', { preventDefault() {} }, filename), saved);
    await expect(page.locator(`[data-element-id="${oldId}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: /^슬라이드 10:/ }).click();
    await expect(chart).not.toHaveAttribute('data-element-id', oldId);
    await expect(chart.locator('[data-chart-line]')).toHaveCount(3);
    result.checks.push('saved native PPTX reopens with chart');
    await page.getByRole('button', { name: '발표하기', exact: true }).click();
    await expect(page.locator('.presentation-view [data-chart-line]')).toHaveCount(3);
    await page.locator('.presentation-view').screenshot({ path: path.join(output, 'native-presentation.png') });
    await page.keyboard.press('Escape');
    await expect(page.locator('.presentation-view')).toHaveCount(0);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
    result.checks.push('slide show displays chart; normal edit view restored');
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    await app.close().catch(() => app.process().kill('SIGKILL'));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
