'use strict';

// Packaged-app verification with a disposable profile and generated documents.
// Never attach to the user's running editor or overwrite their presentations.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, expect } = require('@playwright/test');

(async () => {
  const executablePath = process.argv[2];
  if (!executablePath) throw Error('Pass the packaged Slide Studio executable.');
  const output = path.resolve(process.argv[3] || '.cache/document-changes/native');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(output, 'view-only.slide');
  const saved = path.join(output, 'saved-document.pptx');
  const base = { x: 100, y: 80, width: 350, height: 8, rotation: 0, opacity: 1 };
  const slide = (id, elements) => ({ id, background: '#FFFFFF', notes: '', transition: 'none', elements });
  await fs.writeFile(source, JSON.stringify({
    version: 1, id: 'qa-document-changes', name: '수정 상태 네이티브 검증',
    width: 1280, height: 720, theme: 'studio', slides: [
      slide('first', [
        { ...base, id: 'text', type: 'text', text: '자동 높이를 계산해도\n수정으로 기록하지 않습니다.', autoHeight: true, fontSize: 32 },
        { ...base, id: 'shape', type: 'shape', shape: 'triangle', y: 340, width: 200, height: 140, fill: '#4472C4' },
        { ...base, id: 'date', type: 'text', field: 'date', text: '2000-01-01', x: 700, y: 600, height: 70, fontSize: 24 },
      ]),
      slide('second', [{ ...base, id: 'next-text', type: 'text', text: '다음 페이지에서도 자동 높이를 계산합니다.', autoHeight: true, fontSize: 32 }]),
    ],
  }));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-qa-document-changes-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.SLIDE_STUDIO_DEV;
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + profile, source], env, timeout: 45000 });
  const result = { isolatedProfile: true, generatedDocumentsOnly: true, checks: [] };
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await app.evaluate(({ dialog }, saved) => {
      globalThis.__qaCloseWarnings = 0;
      dialog.showMessageBoxSync = () => { globalThis.__qaCloseWarnings++; return 0; };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
    }, saved);
    const item = (id = 'shape') => page.locator(`.editable-slide [data-element-id="${id}"]`);
    const undo = page.getByRole('button', { name: '실행 취소', exact: true });
    const redo = page.getByRole('button', { name: '다시 실행', exact: true });
    const clean = async (value = true) => {
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem('slide-studio-file-dirty'))).toBe(String(!value));
      expect(await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event); return event.defaultPrevented;
      })).toBe(!value);
    };
    const drag = async () => {
      const box = await item().boundingBox();
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await page.mouse.move(start.x, start.y); await page.mouse.down();
      await page.mouse.move(start.x + 60, start.y + 30, { steps: 4 });
      return start;
    };
    await expect(page.locator('.thumbnail-button')).toHaveCount(2);
    await expect.poll(() => item('text').evaluate(el => parseFloat(el.style.height))).toBeGreaterThan(8);
    await clean();
    for (const index of [1, 0]) {
      await page.locator('.thumbnail-button').nth(index).click(); await clean();
    }
    await item('text').dblclick();
    await page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true }).press('Escape');
    await item().click(); await clean(); await expect(undo).toBeDisabled();
    result.checks.push('native file open, automatic layout, page viewing and unchanged text selection stay clean');

    const start = await drag();
    await page.mouse.move(start.x, start.y); await page.mouse.up();
    await clean(); await expect(undo).toBeDisabled();
    await item().click(); await page.keyboard.press('ArrowRight'); await undo.click();
    await expect(redo).toBeEnabled(); await item().click();
    await drag(); await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(item()).toHaveCSS('left', '100px'); await clean();
    await expect(undo).toBeDisabled(); await expect(redo).toBeEnabled();
    result.checks.push('returning to the original position and cancelling a move preserve clean state and redo');

    await redo.click(); await clean(false);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    expect(page.isClosed()).toBe(false);
    expect(await app.evaluate(() => globalThis.__qaCloseWarnings)).toBe(1);
    result.checks.push('actual native close still warns and preserves an unsaved real edit');
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect(page.locator('.busy-backdrop')).toHaveCount(0); await clean();
    expect((await fs.stat(saved)).size).toBeGreaterThan(1000);
    await page.locator('.editable-slide').screenshot({ path: path.join(output, 'clean-after-save.png') });
    await app.evaluate(({ app }, filename) => app.emit('open-file', { preventDefault() {} }, filename), saved);
    await expect(page.locator('.editable-slide [data-element-id="shape"]')).toHaveCount(0);
    await expect(page.locator('.thumbnail-button')).toHaveCount(2); await clean();
    result.checks.push('PPTX save and native reopen retain a clean document after layout');
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(await app.evaluate(() => globalThis.__qaCloseWarnings)).toBe(1);
    result.checks.push('a clean native document closes without another save warning');
    result.passed = true;
  } finally {
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
    if (!result.passed)
      await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {});
    try { await app.close(); }
    finally { await fs.rm(profile, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
