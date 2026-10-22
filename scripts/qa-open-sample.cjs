'use strict';

const { expect } = require('@playwright/test');

// Multi-slide interaction checks must choose their fixture explicitly; a fresh
// installation starts with a single title slide.
module.exports = async function openSample(page) {
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.getByRole('button', { name: '파일', exact: true }).click();
  await page.getByRole('button', { name: '새 프레젠테이션', exact: true }).click();
  await page.getByRole('button', { name: '예제 프레젠테이션', exact: true }).click();
  await expect(page.locator('.thumbnail-button')).toHaveCount(4);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
};
