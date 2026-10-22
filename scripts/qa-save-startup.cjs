'use strict';
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const JSZip = require('jszip');

// Run on a clean, disposable application profile, before importing QA fixtures.
// Dialog responses are controlled; real production IPC and disk I/O are used.
module.exports = async function verifySaveStartup(page, output, { app }) {
  await fs.mkdir(output, { recursive: true });
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await expect(page.locator('.thumbnail-button')).toHaveCount(1);
  await expect(page.locator('.editable-slide [data-element-id]')).toHaveCount(3);
  await expect(page.locator('.editable-slide [data-type="text"]')).toHaveText([
    '프레젠테이션 제목', '이야기의 시작을 적어보세요',
  ]);
  await expect(page.getByRole('textbox', { name: '프레젠테이션 이름', exact: true })).toHaveValue('제목 없는 프레젠테이션');
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('');
  await page.screenshot({ path: path.join(output, 'first-launch.png') });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-save-startup-'));
  const sourceFolder = path.join(directory, '원본');
  const savedFolder = path.join(directory, '저장');
  const pdfFolder = path.join(directory, 'PDF');
  await Promise.all([sourceFolder, savedFolder, pdfFolder].map(folder => fs.mkdir(folder)));
  const original = path.join(sourceFolder, '이전 문서.slide');
  const saved = path.join(savedFolder, '저장한 문서.pptx');
  const pdf = path.join(pdfFolder, '배포본.pdf');
  const bytes = await fs.readFile(path.resolve(__dirname, '../tests/fixtures/native-validation.slide'));
  const legacy = JSON.parse(bytes);
  await fs.writeFile(original, bytes);
  await app.evaluate(({ dialog }) => {
    global.__saveStartup = { open: dialog.showOpenDialog, save: dialog.showSaveDialog, calls: [] };
  });
  async function chooser(reply = {}) {
    await app.evaluate(({ dialog }, reply) => {
      dialog.showOpenDialog = async (_window, options) => {
        global.__saveStartup.calls.push({ kind: 'open', ...options });
        return { canceled: !reply.open, filePaths: reply.open ? [reply.open] : [] };
      };
      dialog.showSaveDialog = async (_window, options) => {
        global.__saveStartup.calls.push({ kind: 'save', ...options });
        return { canceled: !reply.save, filePath: reply.save };
      };
    }, reply);
  }
  const last = () => app.evaluate(() => global.__saveStartup.calls.at(-1));
  async function menu(label) {
    await app.evaluate(({ Menu }, label) => {
      const item = Menu.getApplicationMenu().items.find(x => x.label === 'File').submenu.items.find(x => x.label === label);
      if (!item) throw Error('Missing native menu: ' + label);
      item.click();
    }, label);
  }
  async function idle() {
    await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  }
  try {
    await chooser({ open: original }); await menu('Open…');
    await expect(page.locator('.thumbnail-button')).toHaveCount(legacy.slides.length);
    await idle();
    await chooser(); await page.evaluate(() => window.desktop.openFile());
    expect((await last()).defaultPath).toBe(sourceFolder);
    await chooser({ save: saved });
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect.poll(() => fs.stat(saved).then(() => true, () => false)).toBe(true);
    await idle();
    const saveOptions = await last();
    expect(path.dirname(saveOptions.defaultPath)).toBe(sourceFolder);
    expect(saveOptions.filters[0].extensions).toEqual(['pptx']);
    const zip = await JSZip.loadAsync(await fs.readFile(saved), { checkCRC32: true });
    expect(zip.file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(legacy.slides.length);
    expect((await fs.readFile(original)).equals(bytes)).toBe(true);
    await chooser({ save: pdf }); await menu('Export PDF…');
    await expect.poll(() => fs.stat(pdf).then(() => true, () => false)).toBe(true);
    await idle();
    expect(path.dirname((await last()).defaultPath)).toBe(savedFolder);
    expect((await fs.readFile(pdf)).subarray(0, 4).toString()).toBe('%PDF');
    await chooser(); await page.evaluate(() => window.desktop.openFile());
    expect((await last()).defaultPath).toBe(savedFolder);
    const userData = await app.evaluate(({ app }) => app.getPath('userData'));
    const preference = JSON.parse(await fs.readFile(path.join(userData, 'file-dialog-location.json'), 'utf8'));
    expect(preference.directory).toBe(savedFolder);
    const name = page.getByRole('textbox', { name: '프레젠테이션 이름', exact: true });
    await expect(name).toHaveValue(legacy.name);
    await page.reload(); await idle();
    await expect(name).toHaveValue(legacy.name);
    await expect(page.locator('.thumbnail-button')).toHaveCount(legacy.slides.length);
    await page.screenshot({ path: path.join(output, 'pptx-save.png') });
    const nativeMenu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(x => x.label === 'File').submenu.items.map(x => x.label));
    expect(nativeMenu.filter(x => x.startsWith('Save'))).toEqual(['Save PowerPoint…']);
    expect(nativeMenu).not.toContain('Export PowerPoint…');
    const result = {
      version: await app.evaluate(({ app }) => app.getVersion()), platform: process.platform,
      freshTitleDocument: true, pptxOnlySave: true, legacyDocumentMigration: true,
      legacyOriginalUnchanged: true, currentFolderOnOpen: true, currentFolderOnSave: true,
      pdfUsesDocumentFolder: true, pdfPreservesDocumentFolder: true,
      folderPreferencePersisted: true, autosaveRestored: true, nativeMenu,
    };
    await fs.writeFile(path.join(output, 'save-startup.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('Native startup, PPTX saving, legacy migration, document folders, PDF and restore verified.');
    return result;
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = global.__saveStartup.open;
      dialog.showSaveDialog = global.__saveStartup.save;
      delete global.__saveStartup;
    });
    await fs.rm(directory, { recursive: true, force: true });
  }
};
