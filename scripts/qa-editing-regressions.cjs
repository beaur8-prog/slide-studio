'use strict';

// Production renderer checks shared by browser QA and disposable installed-app CI.
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function verifyEditing(page, output) {
  await fs.mkdir(output, { recursive: true });
  const base = { x: 100, y: 100, width: 260, height: 100, rotation: 0, opacity: 1 };
  const fixture = path.join(output, 'seven-slide-editing.slide');
  await fs.writeFile(fixture, JSON.stringify({
    version: 1, id: 'qa-editing-158', name: '부분 서식과 숫자 입력 확인', width: 1280, height: 720, theme: 'studio',
    slides: Array.from({ length: 7 }, (_, i) => ({
      id: `slide-${i}`, background: '#FAF8F2', notes: '', transition: 'none',
      elements: [
        { ...base, id: `text-${i}`, type: 'text', text: 'Alpha Beta', width: 300, height: 120,
          fontSize: 32, fontFamily: 'Arial', color: '#233D35', align: 'left', verticalAlign: 'top', autoHeight: false },
        { ...base, id: `shape-${i}`, type: 'shape', x: 550, shape: 'arrow', fill: '#D4613F', stroke: 'transparent', strokeWidth: 0 },
        { ...base, id: `image-${i}`, type: 'image', x: 550, y: 350,
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=' },
      ],
    })),
  }));
  await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(fixture);
  await expect(page.locator('.thumbnail-button')).toHaveCount(7);
  await page.getByRole('button', { name: '홈', exact: true }).click();
  await page.locator('.thumbnail-button').nth(6).click();
  const text = page.locator('[data-element-id="text-6"]');
  await text.dblclick();
  const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
  await expect(editor).toBeFocused();
  await editor.evaluate(host => {
    const node = document.createTreeWalker(host, NodeFilter.SHOW_TEXT).nextNode();
    getSelection().setBaseAndExtent(node, 6, node, 10);
  });
  const styles = () => text.locator('.element-text').evaluate(host => {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), values = [];
    let node;
    while ((node = walker.nextNode())) values.push(...Array(node.textContent.length).fill(getComputedStyle(node.parentElement).fontStyle));
    return values;
  });
  const expected = [...Array(6).fill('normal'), ...Array(4).fill('italic')];
  await page.getByRole('button', { name: '기울임', exact: true }).click();
  await expect(editor).toBeFocused();
  expect(await page.evaluate(() => getSelection().toString())).toBe('Beta');
  await expect.poll(styles).toEqual(expected);
  await editor.press('ControlOrMeta+z');
  await expect.poll(styles).toEqual(Array(10).fill('normal'));
  await editor.press('ControlOrMeta+Shift+z');
  await expect.poll(styles).toEqual(expected);
  await page.screenshot({ path: path.join(output, 'partial-italic.png') });
  await editor.press('Escape');

  const field = name => page.getByRole('spinbutton', { name, exact: true });
  for (const kind of ['text', 'shape', 'image']) {
    const target = page.locator(`[data-element-id="${kind}-6"]`);
    await target.click({ button: 'right' });
    await page.getByRole('menuitem', { name: '개체 서식', exact: true }).click();
    for (const [label, property, before] of [
      ['너비', 'width', kind === 'text' ? '300px' : '260px'],
      ['높이', 'height', kind === 'text' ? '120px' : '100px'],
    ]) {
      await field(label).focus();
      await field(label).press('ControlOrMeta+a');
      await field(label).pressSequentially('2');
      await expect(field(label)).toHaveValue('2');
      await expect(target).toHaveCSS(property, before);
      await field(label).pressSequentially('00');
      await expect(field(label)).toHaveValue('200');
      await field(label).press('Enter');
      await expect(target).toHaveCSS(property, '200px');
    }
    await field('회전').focus();
    await field('회전').press('ControlOrMeta+a');
    await field('회전').pressSequentially('-15');
    await expect(field('회전')).toHaveValue('-15');
    expect(await target.evaluate(el => el.style.transform)).toBe('rotate(0deg)');
    await field('회전').press('Enter');
    expect(await target.evaluate(el => el.style.transform)).toBe('rotate(-15deg)');
    if (kind === 'text') {
      await field('글자 크기').focus();
      await field('글자 크기').press('ControlOrMeta+a');
      await field('글자 크기').pressSequentially('18');
      await expect(field('글자 크기')).toHaveValue('18');
      await field('글자 크기').press('Enter');
      await expect(text.locator('.element-text')).toHaveCSS('font-size', '24px');
    }
  }
  await page.screenshot({ path: path.join(output, 'number-input.png') });
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.reload();
  await expect(page.locator('.thumbnail-button')).toHaveCount(7);
  await expect(page.locator('[data-element-id="shape-0"]')).toHaveCSS('width', '260px');
  await page.locator('.thumbnail-button').nth(6).click();
  for (const kind of ['text', 'shape', 'image']) {
    const target = page.locator(`[data-element-id="${kind}-6"]`);
    await expect(target).toHaveCSS('width', '200px');
    await expect(target).toHaveCSS('height', '200px');
    expect(await target.evaluate(el => el.style.transform)).toBe('rotate(-15deg)');
  }
  await expect(text.locator('.element-text')).toHaveCSS('font-size', '24px');
  await expect.poll(styles).toEqual(expected);
  // Exercise the bullet regression through the installed/production renderer,
  // using a separate document after the numeric-persistence assertions above.
  const bulletFixture = path.join(output, 'bullet-list.slide');
  await fs.writeFile(bulletFixture, JSON.stringify({
    version: 1, id: 'qa-bullets-159', name: '글머리표 확인', width: 1280, height: 720, theme: 'studio',
    slides: [{ id: 'bullets', background: '#FAF8F2', notes: '', transition: 'none', elements: [
      { ...base, id: 'list', type: 'text', text: 'One\nTwo', width: 800, height: 400,
        fontSize: 32, fontFamily: 'Arial', color: '#233D35', align: 'left', verticalAlign: 'top' },
    ] }],
  }));
  // This fixture intentionally replaces edits already asserted above.
  if (!page.listenerCount('dialog')) page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('confirm');
    expect(dialog.message()).toContain('PPTX 파일에 저장하지 않은 변경 사항');
    await dialog.accept();
  });
  await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(bulletFixture);
  const list = page.locator('[data-element-id="list"]');
  const bulletButton = page.getByRole('button', { name: '• 글머리 기호', exact: true });
  const plain = () => list.locator('.element-text').innerText();
  await list.click();
  await bulletButton.click();
  await list.dblclick();
  await editor.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await editor.press('Enter');
  await editor.pressSequentially('Three');
  await expect.poll(plain).toBe('• One\n• Two\n• Three');
  await editor.press('Escape');
  await bulletButton.click();
  await expect.poll(plain).toBe('One\nTwo\nThree');
  await bulletButton.click();
  await expect(list.locator('[data-bullet]')).toHaveCount(3);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  await page.reload();
  await expect(list.locator('[data-bullet]')).toHaveCount(3);
  await expect(list.locator('.element-text')).toContainText('Three');
  await page.screenshot({ path: path.join(output, 'bullet-list.png') });
  await fs.writeFile(path.join(output, 'bullet-regressions.json'), JSON.stringify({
    enterContinues: true, wholeBoxOffOn: true, markersAfterReload: 3, reloadPersistence: true,
  }, null, 2) + '\n');
  // Reload schedules a fresh autosave. A native caller must not quit while
  // that write is pending, or the application's unsaved-work dialog blocks it.
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  const result = { partialItalic: true, selectionPreserved: true, nativeTextUndoRedo: true,
    sevenSlides: true, numericTypes: ['text', 'shape', 'image'], width: 200, height: 200,
    rotation: -15, fontSize: 24, draftsPreserved: true, reloadPersistence: true, firstSlideUntouched: true };
  await fs.writeFile(path.join(output, 'editing-regressions.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
};
