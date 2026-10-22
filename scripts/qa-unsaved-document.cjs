// Native close protection + real PPTX disk writes in an isolated profile.
// Native chooser replies are controlled; production IPC and filesystem are real.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron, expect } = require('@playwright/test');
const JSZip = require('jszip');
(async () => {
  const output = path.resolve(process.argv[2] || '.cache/user-qa/native-protection');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-qa-unsaved-'));
  const file = path.join(profile, '저장 보호 검수.pptx');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executablePath = process.argv[3];
  if (!executablePath) env.SLIDE_STUDIO_DEV = '1';
  else delete env.SLIDE_STUDIO_DEV;
  const app = await electron.launch({ ...(executablePath ? { executablePath } : {}),
    ...(process.platform === 'linux' ? { chromiumSandbox: true } : {}),
    args: [...(executablePath ? [] : [process.cwd()]), '--user-data-dir=' + profile], env, timeout: 45000 });
  const result = { platform: process.platform, isolatedProfile: true, controlledChoosers: true, nativeClose: true };
  let finished = false;
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await app.evaluate(({ dialog }, filename) => {
      global.__qaClose = { calls: [], response: 0, filename };
      dialog.showMessageBoxSync = (_window, options) => {
        global.__qaClose.calls.push(options); return global.__qaClose.response;
      };
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, file);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    const notes = page.getByRole('textbox', { name: '발표자 노트', exact: true });
    await notes.fill('PPTX로 보존할 검수 내용 — 한글 123');
    await page.getByRole('textbox', { name: '프레젠테이션 이름', exact: true }).click();
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
    await expect.poll(() => app.evaluate(() => global.__qaClose.calls.length)).toBe(1);
    await expect(notes).toHaveValue('PPTX로 보존할 검수 내용 — 한글 123');
    result.cancelClosePreservesDocument = true;
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    await expect.poll(() => fs.stat(file).then(s => s.size, () => 0)).toBeGreaterThan(1000);
    const zip = await JSZip.loadAsync(await fs.readFile(file));
    expect(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string')).toContain('PPTX로 보존할 검수 내용');
    result.diskPptxContainsLatestNotes = true;
    const previousId = await page.locator('.editable-slide [data-element-id]').first().getAttribute('data-element-id');
    await app.evaluate(({ Menu }) => { Menu.getApplicationMenu().items.find(m => m.label === 'File').submenu.items.find(m => m.label === 'Open…').click(); });
    await expect(page.locator('.editable-slide [data-element-id]').first()).not.toHaveAttribute('data-element-id', previousId);
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    await expect(notes).toHaveValue('PPTX로 보존할 검수 내용 — 한글 123');
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    expect(await app.evaluate(() => global.__qaClose.calls.length)).toBe(1);
    const closed = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0); });
    await closed;
    // Windows/Linux quit with their final window. Closing with the warning
    // response still set to Cancel proves that no new warning blocked closing.
    result.savedAndReopenedDocumentClosesWithoutWarning = true;
    finished = true;
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    // This process owns only the disposable profile. A failed assertion may
    // leave a dirty document whose close guard would block graceful teardown.
    if (!finished) app.process().kill('SIGKILL');
    await app.close().catch(() => {});
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
