'use strict';

// Native file-open regression checks run only in a disposable user profile.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron, expect } = require('@playwright/test');
const PptxGenJS = require('pptxgenjs');

(async () => {
  const executablePath = process.argv[2];
  if (!executablePath) throw new Error('Pass the packaged application executable.');
  const baseline = process.argv.includes('--baseline');
  const output = path.resolve(process.argv[3] || '.cache/file-open/native');
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-qa-file-open-'));
  const profile = path.join(temporary, 'profile');
  const documents = path.join(temporary, '한글과 공백이 있는 폴더');
  await fs.mkdir(documents);
  async function fixture(name, slides) {
    const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE';
    for (let i = 0; i < slides; i++) {
      const slide = deck.addSlide();
      slide.addText(name + ' ' + (i + 1), { x: 1, y: 1, w: 10, h: 1, fontSize: 32 });
      slide.addNotes('발표자 메모 ' + name);
    }
    const filename = path.join(documents, name + '.PPTX');
    await deck.writeFile({ fileName: filename }); return filename;
  }
  const first = await fixture('첫 번째 외부 파일', 2);
  const second = await fixture('두 번째 외부 파일', 3);
  const broken = path.join(documents, '깨진 파일.pptx'); await fs.writeFile(broken, 'not a zip');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SLIDE_STUDIO_DEV;
  const result = { platform: process.platform, baseline, isolatedProfile: true, checks: [] };
  let app;
  const launch = async (files = []) => electron.launch({ executablePath,
    args: ['--user-data-dir=' + profile, ...files], env, timeout: 45000 });
  const emit = (...files) => app.evaluate(({ app }, filenames) => {
    return filenames.map(filename => app.emit('open-file', { preventDefault() {} }, filename));
  }, files);
  const shown = async (page, title, count) => {
    await expect(page.locator('.editable-slide')).toContainText(title + ' 1');
    await expect(page.locator('.thumbnail-button')).toHaveCount(count);
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  };
  try {
    app = await launch([first]);
    let page = await app.firstWindow(); page.setDefaultTimeout(15000);
    if (baseline) {
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      expect(await page.locator('.editable-slide').textContent()).not.toContain('첫 번째 외부 파일');
      expect(await emit(first)).toEqual([false]);
      result.checks.push('reproduced: launch path ignored and macOS open-file event has no listener');
    } else {
      await shown(page, '첫 번째 외부 파일', 2); result.checks.push('cold launch with Korean/space path');
      await emit(second); await shown(page, '두 번째 외부 파일', 3); result.checks.push('running application open-file');
      await page.evaluate(() => {
        window.__fileOpenQA = { allow: false, confirmations: [] };
        window.confirm = message => { window.__fileOpenQA.confirmations.push(message); return window.__fileOpenQA.allow; };
      });
      const notes = page.getByRole('textbox', { name: '발표자 노트', exact: true });
      await notes.fill('저장 전 내용을 보존합니다'); await notes.blur();
      await emit(first);
      await expect.poll(() => page.evaluate(() => window.__fileOpenQA.confirmations.length)).toBe(1);
      await expect(notes).toHaveValue('저장 전 내용을 보존합니다');
      await shown(page, '두 번째 외부 파일', 3); result.checks.push('cancel replacement preserves unsaved edits');
      await page.evaluate(() => { window.__fileOpenQA.allow = true; });
      await emit(first); await shown(page, '첫 번째 외부 파일', 2); result.checks.push('confirmed replacement opens requested file');
      await emit(broken, second); await shown(page, '두 번째 외부 파일', 3); result.checks.push('corrupt file does not block next request');
      await emit(path.join(documents, 'missing.pptx'), first); await shown(page, '첫 번째 외부 파일', 2);
      result.checks.push('missing file does not block next request');
      await app.evaluate(({ dialog }) => {
        global.__openDialogPath = null;
        dialog.showOpenDialog = async (_window, options) => { global.__openDialogPath = options.defaultPath; return { canceled: true }; };
      });
      await page.evaluate(() => window.desktop.openFile());
      expect(await app.evaluate(() => global.__openDialogPath)).toBe(documents);
      result.checks.push('file chooser follows externally opened folder');
      const closed = page.waitForEvent('close');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed;
      const newWindow = app.waitForEvent('window');
      await emit(first, second); page = await newWindow; page.setDefaultTimeout(15000);
      await shown(page, '두 번째 외부 파일', 3); result.checks.push('closed editor recreated; startup queue drains in order');
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
      result.checks.push('all requests share one editor');
      await page.screenshot({ path: path.join(output, 'native-opened.png') });
      await app.close(); app = await launch(); page = await app.firstWindow();
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      await expect(page.locator('.editable-slide')).toContainText('프레젠테이션 제목');
      await expect(page.locator('.thumbnail-button')).toHaveCount(1);
      result.checks.push('plain launch still starts a new title slide');
    }
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    if (app) await app.close().catch(() => app.process().kill('SIGKILL'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
