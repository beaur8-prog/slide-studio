import { test, expect } from '@playwright/test';

test('Windows shortcut labels, Ctrl save and desktop print actions work in the shared renderer', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    (window as any).__saved = null;
    (window as any).__prints = 0;
    window.desktop = {
      saveFile: async payload => { (window as any).__saved = { ...payload, data: [...payload.data] }; return 'saved.slide'; },
      openFile: async () => null,
      exportPDF: async () => null,
      print: async () => { (window as any).__prints++; return true; },
      onMenu: callback => { (window as any).__menu = callback; return () => {}; },
    };
  });
  await page.goto('http://127.0.0.1:5190');
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toHaveAttribute('title', '실행 취소 Ctrl+Z');
  await expect(page.getByRole('button', { name: '다시 실행', exact: true })).toHaveAttribute('title', '다시 실행 Ctrl+Y');
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await expect(page.getByRole('button', { name: '프로젝트 저장' })).toContainText('Ctrl+S');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as any).__saved?.extensions)).toEqual(['slide']);
  const saved = await page.evaluate(() => JSON.parse(new TextDecoder().decode(Uint8Array.from((window as any).__saved.data))));
  expect(JSON.stringify(saved)).toContain('slides');
  // Electron consumes Ctrl+P through its native menu before renderer keydown.
  // Exercise the actual menu-to-renderer callback with the desktop bridge mock.
  await page.evaluate(() => (window as any).__menu('print'));
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(1);
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await expect(page.getByRole('button', { name: '인쇄' })).toContainText('Ctrl+P');
  await page.getByRole('button', { name: '인쇄' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toBe(2);
  await page.keyboard.press('Escape');
  await page.locator('.toast button').click();
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.screenshot({ path: testInfo.outputPath('editor-windows-shortcuts.png') });
});
