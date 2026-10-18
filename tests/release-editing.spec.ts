import { test } from '@playwright/test';
import { createRequire } from 'node:module';
const verifyEditing = createRequire(import.meta.url)('../scripts/qa-editing-regressions.cjs');

test('release editing checks use the production document input and preserve both fixes', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.goto('http://127.0.0.1:5190');
  await verifyEditing(page, testInfo.outputPath('editing'));
});
