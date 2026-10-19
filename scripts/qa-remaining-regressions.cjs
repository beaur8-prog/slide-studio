'use strict';

// Exercise the packaged renderer through its public file input on disposable CI profiles.
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function verifyRemaining(page, output, { app } = {}) {
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await fs.mkdir(output, { recursive: true });
  const base = { rotation: 0, opacity: 1, fontFamily: 'Arial', fontSize: 30,
    color: '#233D35', fill: 'transparent', stroke: 'transparent', strokeWidth: 0,
    bold: false, italic: false, underline: false, align: 'left', verticalAlign: 'top', lineHeight: 1.2 };
  const fixture = path.join(output, 'remaining-features.slide');
  await fs.writeFile(fixture, JSON.stringify({
    version: 1, id: 'remaining-release', name: '1.6 편집과 발표 검증', width: 1280, height: 720, theme: 'studio',
    slides: [
      { id: 'remaining-one', background: '#FAF8F2', notes: '발표자만 보는 첫째 노트', transition: 'none', elements: [
        { ...base, id: 'qa-shape', type: 'shape', shape: 'ellipse', x: 100, y: 100, width: 500, height: 250, fill: '#D4613F', color: '#FFFFFF', text: '도형 안의 한글', align: 'center', verticalAlign: 'middle' },
        { ...base, id: 'qa-group-a', type: 'shape', shape: 'rect', x: 700, y: 100, width: 130, height: 130, fill: '#233D35', groups: ['qa-group'] },
        { ...base, id: 'qa-group-b', type: 'text', text: '그룹 이동', x: 850, y: 120, width: 280, height: 80, groups: ['qa-group'] },
      ] },
      { id: 'remaining-two', background: '#FAF8F2', notes: '발표자만 보는 둘째 노트', transition: 'none', elements: [
        { ...base, id: 'qa-table', type: 'table', x: 100, y: 100, width: 1050, height: 300, table: {
          cells: [['병합 셀', '', '다음 셀'], ['A', 'B', 'C']], merges: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 2 }],
          autoRows: true, header: true, striped: true, headerFill: '#233D35', headerColor: '#FFFFFF', fill: '#FFFFFF', stripeFill: '#EDF2EF', color: '#233D35',
          borderColor: '#AABCB3', borderWidth: 1, fontFamily: 'Arial', fontSize: 24, padding: 10, align: 'left', verticalAlign: 'middle',
        } },
      ] },
    ],
  }));
  await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(fixture);
  await expect(page.locator('.thumbnail-button')).toHaveCount(2);
  const shape = page.locator('.editable-slide [data-element-id="qa-shape"]');
  await shape.dblclick();
  const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
  await editor.press('ControlOrMeta+A');
  await editor.evaluate(host => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '도형 안에 붙여넣기\nBeta only');
    host.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  });
  await editor.press('Escape');
  await expect(shape).toHaveText('도형 안에 붙여넣기\nBeta only', { useInnerText: true });
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(3);
  await page.locator('.editable-slide [data-element-id="qa-group-a"]').click();
  await expect(page.locator('.editable-slide .slide-element.selected')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+d');
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(5);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(3);

  await page.locator('.thumbnail-button').nth(1).click();
  const table = page.locator('.editable-slide [data-type="table"]');
  await expect(table.locator('[data-row][data-column]')).toHaveCount(5);
  await table.locator('[data-row="0"][data-column="0"]').click();
  await page.keyboard.press('Enter');
  const cell = page.getByRole('textbox', { name: '1행 1열 셀 텍스트 편집', exact: true });
  await cell.fill('병합 셀 한글\nBeta only');
  await cell.press('Tab');
  await expect(page.getByRole('textbox', { name: '1행 3열 셀 텍스트 편집', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(table).toContainText('Beta only');
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.screenshot({ path: path.join(output, 'merged-table.png') });

  const editorViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.getByRole('button', { name: '슬라이드 쇼', exact: true }).click();
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: '발표자 보기', exact: true }).click();
  const popup = await opened;
  await expect(popup.locator('.presenter-private-notes')).toHaveText('발표자만 보는 첫째 노트');
  if (await popup.evaluate(() => Boolean(window.desktop?.platform))) {
    expect(await popup.evaluate(() => Object.keys(window.desktop).sort())).toEqual(['loadOfficeCalibriFonts', 'loadOfficeLightFont', 'platform']);
  }
  await popup.getByRole('button', { name: '다음', exact: true }).click();
  await expect(page.getByTestId('presentation-view')).toHaveAttribute('aria-label', '발표 슬라이드 2 / 2');
  await expect(popup.locator('.presenter-private-notes')).toHaveText('발표자만 보는 둘째 노트');
  await expect(page.locator('.present-notes')).toHaveCount(0);
  await popup.screenshot({ path: path.join(output, 'presenter.png') });
  await popup.getByRole('button', { name: '발표 종료', exact: true }).click();
  await expect(page.getByTestId('presentation-view')).toBeHidden();
  await popup.close();
  // Native window managers complete fullscreen exit/entry asynchronously.
  // Wait for the actual viewport and focus before calculating drag coordinates.
  await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual(editorViewport);
  await page.bringToFront();
  await page.getByTestId('canvas-frame').click({ position: { x: 15, y: 15 } });
  await page.keyboard.press('F5');
  const ink = page.getByTestId('presentation-ink');
  await expect(ink).toBeVisible();
  if (app) {
    const fullscreenGeometry = () => app.evaluate(({ BrowserWindow, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#presenter='));
      const display = screen.getDisplayMatching(win.getBounds());
      return { fullscreen: win.isFullScreen(), window: win.getBounds(), content: win.getContentBounds(),
        minimum: win.getMinimumSize(), display: display.bounds, scaleFactor: display.scaleFactor, platform: process.platform };
    });
    try {
      await expect.poll(async () => {
        const state = await fullscreenGeometry();
        return state.fullscreen && state.content.width === state.display.width && state.content.height === state.display.height;
      }).toBe(true);
    } finally {
      await fs.writeFile(path.join(output, 'fullscreen-geometry.json'), JSON.stringify(await fullscreenGeometry(), null, 2) + '\n');
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('#presenter='));
      win.focus(); win.webContents.focus();
    });
  }
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  await page.keyboard.press('ControlOrMeta+h');
  await expect(ink).toHaveAttribute('data-tool', 'highlighter');
  const bounds = await ink.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .6);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .6, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('ink-stroke')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '슬라이드에 보관', exact: true }).click();
  await expect(page.getByTestId('presentation-view')).toBeHidden();
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(3);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(4);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.reload();
  await expect(page.locator('.editable-slide .slide-element')).toHaveCount(4);
  await expect(shape).toContainText('Beta only');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.screenshot({ path: path.join(output, 'remaining-editor.png') });
  await fs.writeFile(path.join(output, 'remaining-regressions.json'), JSON.stringify({
    shapeTextPaste: true, pasteDoesNotDuplicateObjects: true, groupSelectionAndDuplicateUndo: true,
    nativeMergedTable: true, inlineKoreanCells: true, mergedCellTab: true,
    presenterControls: true, privateNotes: true, highlighter: true, retainedInk: true, undoRedoAndReload: true,
  }, null, 2) + '\n');
};
