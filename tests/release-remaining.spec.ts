import { test } from '@playwright/test';
import { createRequire } from 'node:module';
const verifyRemaining = createRequire(import.meta.url)('../scripts/qa-remaining-regressions.cjs');

test('release fixture verifies shape paste, groups, merged cells, presenter control and retained highlighter', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.desktop = { setPresentationMode: async () => {}, onMenu: () => () => {} } as any;
  });
  await page.goto('http://127.0.0.1:5190');
  await verifyRemaining(page, testInfo.outputPath('remaining'));
});
