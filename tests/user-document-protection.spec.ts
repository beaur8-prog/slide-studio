import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  await page.addInitScript(() => {
    (window as any).__savedFiles = [];
    window.desktop = {
      platform: 'darwin', windowSessionId: 'qa-protection-window',
      onMenu: () => () => {}, openFile: async () => null,
      exportPDF: async () => null, print: async () => false,
      saveFile: async (payload) => {
        (window as any).__savedFiles.push(Array.from(payload.data));
        return (window as any).__cancelSave ? null : '/tmp/QA.pptx';
      },
    };
  });
  await page.goto('http://127.0.0.1:5190');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
}
async function prevented(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}
async function edit(page: Page, text = 'PPTX 파일에는 아직 저장하지 않은 발표자 노트') {
  await page.getByRole('textbox', { name: '발표자 노트', exact: true }).fill(text);
  await page.getByRole('textbox', { name: '프레젠테이션 이름', exact: true }).click();
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
}

test('autosave does not clear unsaved file protection; PPTX save and undo to saved state do', async ({ page }) => {
  await open(page);
  expect(await prevented(page)).toBe(false);
  await edit(page);
  expect(await prevented(page)).toBe(true);
  await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  expect(await prevented(page)).toBe(false);
  await edit(page, '저장 후 수정');
  expect(await prevented(page)).toBe(true);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  expect(await prevented(page)).toBe(false);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  expect(await prevented(page)).toBe(true);
});

test('new document cancellation preserves unsaved content and explicit discard replaces it', async ({ page }) => {
  await open(page);
  await edit(page);
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '새 프레젠테이션', exact: true }).click();
  let confirmations = 0;
  page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('PPTX 파일에는 아직 저장하지 않은 발표자 노트');
  expect(confirmations).toBe(1);
  page.removeAllListeners('dialog');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  expect(await prevented(page)).toBe(false);
});

test('cancelled and failed PPTX saves keep close protection and file-open cancellation keeps edits', async ({ page }) => {
  await open(page);
  await edit(page, '보존할 메모');
  await page.evaluate(() => { (window as any).__cancelSave = true; });
  await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
  await expect(page.locator('.busy-backdrop')).toHaveCount(0);
  expect(await prevented(page)).toBe(true);
  await page.evaluate(() => { window.desktop!.saveFile = async () => { throw Error('QA: disk full'); }; });
  await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('disk full');
  expect(await prevented(page)).toBe(true);
  const fixture = Buffer.from(JSON.stringify({ version: 1, id: 'replacement', name: '새 원본', width: 1280, height: 720, theme: 'studio', slides: [{ id: 'slide', background: '#FFFFFF', notes: '', transition: 'none', elements: [] }] }));
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: '다른 파일.slide', mimeType: 'application/json', buffer: fixture });
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('보존할 메모');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: '다른 파일.slide', mimeType: 'application/json', buffer: fixture });
  await expect(page.getByRole('textbox', { name: '프레젠테이션 이름', exact: true })).toHaveValue('새 원본');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  expect(await prevented(page)).toBe(false);
});

test('same-window refresh retains unsaved protection and a failed import preserves content and undo', async ({ page }) => {
  await open(page);
  await edit(page, '새로 고침 뒤에도 지킬 내용');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('새로 고침 뒤에도 지킬 내용');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  expect(await prevented(page)).toBe(true);
  await edit(page, '가져오기 실패 뒤에도 지킬 내용');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: '손상.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from('not a zip') });
  await expect(page.locator('.toast')).toContainText('파일 열기 실패');
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('가져오기 실패 뒤에도 지킬 내용');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '발표자 노트', exact: true })).toHaveValue('새로 고침 뒤에도 지킬 내용');
});
