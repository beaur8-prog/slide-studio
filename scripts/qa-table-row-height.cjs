'use strict';
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

// Exercise the distributed application, using a native DrawingML table whose
// outer frame is 72pt but whose four explicit row heights are 32pt each.
module.exports = async function verifyTableRowHeight(page, output, { app }) {
  await fs.mkdir(output, { recursive: true });
  const fixture = path.resolve(__dirname, '../tests/fixtures/table-frame-72pt-rows-32pt-x4.pptx');
  await page.locator('input[accept*=".pptx"]').setInputFiles(fixture);
  const table = page.locator('.editable-slide [data-type="table"]');
  await expect(table).toHaveCount(1);
  const check = async () => {
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    const result = await table.evaluate(element => {
      const cells = Array.from(element.querySelectorAll('.inserted-table [role="cell"]'));
      return {
        heightPt: parseFloat(getComputedStyle(element).height) * .75,
        rowsPt: cells.map(cell => parseFloat(getComputedStyle(cell).height) * .75),
        text: cells.map(cell => cell.textContent),
        clipped: cells.map(cell => {
          const range = document.createRange();
          range.selectNodeContents(cell.querySelector('.table-cell-text'));
          const text = range.getBoundingClientRect(), box = cell.getBoundingClientRect();
          return Math.max(box.top - text.top, text.bottom - box.bottom) > 1;
        }),
      };
    });
    expect(result.heightPt).toBeCloseTo(128, 1);
    expect(result.rowsPt).toHaveLength(4);
    result.rowsPt.forEach(row => expect(row).toBeCloseTo(32, 1));
    expect(result.text).toEqual(['한글 1행', '한글 2행', '한글 3행', '한글 4행']);
    expect(result.clipped).toEqual([false, false, false, false]);
    return result;
  };
  const imported = await check();
  await page.reload();
  const restored = await check();
  await page.screenshot({ path: path.join(output, 'table-row-height.png') });
  const result = {
    version: await app.evaluate(({ app }) => app.getVersion()),
    platform: process.platform, imported, restored,
    rowHeightsPreserved: true, frameExpanded: true,
    koreanTextUnclipped: true, autosaveReload: true,
  };
  await fs.writeFile(path.join(output, 'table-row-height.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Native table: four 32pt rows preserved, 128pt frame, Korean text and reload verified.');
};
