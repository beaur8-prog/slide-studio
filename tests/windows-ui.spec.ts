import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform} shows the package version in the editor and File menu at supported window sizes`, async ({ page }, info) => {
    await page.addInitScript(platform => {
      Object.defineProperty(navigator, 'platform', { get: () => platform === 'win32' ? 'Win32' : platform === 'darwin' ? 'MacIntel' : 'Linux' });
      window.desktop = { platform, onMenu: () => () => {} } as any;
    }, platform);
    await page.goto('http://127.0.0.1:5190');
    const badge = page.getByLabel(`앱 버전 ${version}`, { exact: true });
    for (const width of [970, 1080, 1280, 1540]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(`v${version}`);
      const bounds = await badge.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.width).toBeGreaterThan(20);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - (platform === 'win32' ? 150 : 0));
    }
    await page.getByRole('button', { name: '파일', exact: true }).click();
    await expect(page.locator('.file-popover')).toContainText(`Slide Studio v${version}`);
    await page.setViewportSize({ width: 970, height: 900 });
    await page.screenshot({ path: info.outputPath(`version-${platform}.png`) });
  });
}

test('Windows shortcut labels, Ctrl save and desktop print actions work in the shared renderer', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
    (window as any).__saved = null;
    (window as any).__prints = 0;
    window.desktop = {
      saveFile: async payload => { (window as any).__saved = { ...payload, data: [...payload.data] }; return 'saved.pptx'; },
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
  await expect(page.locator('.file-popover').getByRole('button', { name: /^PPTX 저장/ })).toContainText('Ctrl+S');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as any).__saved?.extensions)).toEqual(['pptx']);
  const saved = await page.evaluate(async () => {
    const { importPptx } = await import('/src/io.ts');
    return (await importPptx(Uint8Array.from((window as any).__saved.data))).deck;
  });
  expect(saved.slides.length).toBeGreaterThan(0);
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
