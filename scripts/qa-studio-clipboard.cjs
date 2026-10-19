'use strict';

// Call only with a disposable app profile. Exercise the OS clipboard and the
// installed renderer/IPC, without a sibling app or a mocked paste event.
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function verifyStudioClipboard(page, output, { app }) {
  const rich = JSON.parse(await fs.readFile(path.resolve('tests/fixtures/studio-table.json'), 'utf8'));
  const saved = await app.evaluate(({ clipboard }) => ({
    text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(),
    image: clipboard.readImage().toDataURL(),
  }));
  const write = async data => app.evaluate(({ clipboard }, value) => clipboard.write(value), data);
  await fs.mkdir(output, { recursive: true });
  try {
    const fixture = path.join(output, 'studio-clipboard.slide');
    await fs.writeFile(fixture, JSON.stringify({
      version: 1, id: 'clipboard-release', name: 'Studio 표 교환 검증', width: 1280, height: 720,
      theme: 'studio', slides: [{ id: 'clipboard-slide', background: '#FAF8F2',
        notes: '', transition: 'none', elements: [] }],
    }));
    await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(fixture);
    await expect(page.locator('.editable-slide .slide-element')).toHaveCount(0);
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await page.getByTestId('slide-canvas').click({ position: { x: 10, y: 10 } });
    await write(rich);
    await page.getByRole('button', { name: '붙여넣기', exact: true }).click();
    const tables = page.locator('.editable-slide [data-type=table]');
    await expect(tables).toHaveCount(1);
    const anchor = tables.first().locator('[data-row="0"][data-column="0"]');
    await expect(tables.first().locator('[data-row][data-column]')).toHaveCount(3);
    await expect(anchor).toHaveAttribute('aria-colspan', '2');
    await expect(anchor).toHaveCSS('background-color', 'rgb(255, 242, 204)');
    await expect(tables.first()).toContainText('줄1');
    await expect(tables.first()).toContainText('줄2');
    await page.screenshot({ path: path.join(output, 'studio-clipboard.png') });

    await page.getByRole('button', { name: '복사', exact: true }).first().click();
    await expect(page.locator('.toast')).toContainText('개체를 복사했습니다');
    const copied = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
    expect(copied.text).toBe(rich.text);
    expect(copied.html).toContain('colspan="2"');
    expect(copied.html).toContain('data-studio-table="1"');
    expect(copied.html).toContain('data-slide-studio-copy');

    // A later external copy must replace the app's in-memory object snapshot.
    await page.getByTestId('slide-canvas').click({ position: { x: 10, y: 10 } });
    await write({ text: rich.text.replace('보고서', '다른 앱의 표'), html: rich.html.replace('보고서', '다른 앱의 표') });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(tables).toHaveCount(2);
    await expect(tables.last()).toContainText('다른 앱의 표');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(tables).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(tables).toHaveCount(2);
    await expect(tables.last()).toContainText('다른 앱의 표');

    await tables.last().locator('[data-row="0"][data-column="0"]').click();
    await write({ text: '잘못된 범위', html: '<table><tr><td>잘못된 범위</td></tr></table>' });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('.toast')).toContainText('대상 병합 셀 전체');
    await expect(tables.last()).toContainText('다른 앱의 표');
    await expect(tables.last()).not.toContainText('잘못된 범위');
    await write({ text: rich.text.replace('보고서', '교체한 표'), html: rich.html.replace('보고서', '교체한 표') });
    await page.keyboard.press('ControlOrMeta+v');
    await expect(tables.last()).toContainText('교체한 표');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(tables.last()).toContainText('다른 앱의 표');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(tables.last()).toContainText('교체한 표');
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await page.reload();
    await expect(tables).toHaveCount(2);
    await expect(tables.last()).toContainText('교체한 표');
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await fs.writeFile(path.join(output, 'studio-clipboard.json'), JSON.stringify({
      nativeHomePaste: true, nativeKeyboardPaste: true, editableMergedTable: true,
      stylesAndKoreanAndLineBreaks: true, htmlAndQuotedTSVExport: true,
      currentExternalClipboardWins: true, partialMergeProtected: true,
      completeRangePaste: true, singleStepUndoRedo: true, reloadPersistence: true,
    }, null, 2) + '\n');
  } finally {
    await app.evaluate(({ clipboard, nativeImage }, value) => clipboard.write({
      ...value, image: nativeImage.createFromDataURL(value.image),
    }), saved);
  }
};
