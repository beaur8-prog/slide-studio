import { expect, test, type Page } from '@playwright/test';

async function openSlides(page: Page, count: number) {
  await page.goto('http://127.0.0.1:5190');
  const json = await page.evaluate(async count => {
    const { blankDeck, newSlide } = await import('/src/model.ts');
    const deck = blankDeck();
    deck.name = '슬라이드 개수 제한 검증';
    deck.slides = Array.from({ length: count }, () => newSlide('blank'));
    return JSON.stringify(deck);
  }, count);
  await page.locator('input[type=file][accept*=".pptx"]').setInputFiles({
    name: 'limit.slide', mimeType: 'application/json', buffer: Buffer.from(json),
  });
  await expect(page.locator('.thumbnail-row')).toHaveCount(count);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
}

test('adding slides at the 500-slide boundary cannot make the document unsavable', async ({ page }) => {
  test.setTimeout(60000);
  await openSlides(page, 500);
  await page.getByRole('button', { name: '슬라이드 추가', exact: true }).click();
  await expect(page.locator('.thumbnail-row')).toHaveCount(500);
  await expect(page.locator('.toast')).toContainText('500');
  await page.keyboard.press('ControlOrMeta+m');
  await expect(page.locator('.thumbnail-row')).toHaveCount(500);
  await page.locator('.thumbnail-button').first().click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.thumbnail-row')).toHaveCount(499);
  await page.getByRole('button', { name: '슬라이드 추가', exact: true }).click();
  await expect(page.locator('.thumbnail-row')).toHaveCount(500);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('.thumbnail-row')).toHaveCount(499);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(page.locator('.thumbnail-row')).toHaveCount(500);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
  const file = await downloading;
  expect(await file.failure()).toBeNull();
});

test('pasting multiple slides rejects the entire paste when it exceeds 500', async ({ page }) => {
  test.setTimeout(60000);
  await openSlides(page, 499);
  await page.locator('.thumbnail-button').first().click();
  await page.locator('.thumbnail-button').nth(1).click({ modifiers: ['Shift'] });
  await expect(page.locator('.thumbnail-button[aria-pressed="true"]')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('.toast')).toContainText('500');
  await expect(page.locator('.thumbnail-row')).toHaveCount(499);
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled();
});
