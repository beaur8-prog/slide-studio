'use strict';

// Only exercise a real installed package in a disposable Linux CI desktop.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const pptxgen = require('pptxgenjs');
const output = path.resolve('qa/results/linux-native');
(async () => {
  if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true' || process.getuid() === 0) throw new Error('Disposable non-root Linux CI required');
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Playwright otherwise injects --no-sandbox into Electron by default.
  const app = await electron.launch({ executablePath: '/opt/slide-studio/slide-studio', chromiumSandbox: true, env, timeout: 45000 });
  let failed = false;
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 30000 });
    expect(await app.evaluate(({ app }) => app.getVersion())).toBe(process.env.EXPECTED_APP_VERSION);
    expect(await page.evaluate(() => window.desktop.platform)).toBe('linux');
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
    const protection = await app.evaluate(({ BrowserWindow, app }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'), userData: app.getPath('userData') };
    });
    expect(protection).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, noSandbox: false });
    expect(protection.userData).toBe(path.join(process.env.XDG_CONFIG_HOME, 'Slide Studio'));

    // Open a real PPTX through the production file input (no mocked renderer).
    const pptx = new pptxgen();
    pptx.layout = 'LAYOUT_WIDE';
    for (let n = 1; n <= 3; n++) {
      const slide = pptx.addSlide();
      slide.addText('리눅스 한글 발표 ' + n, { x: 1, y: 1, w: 9, h: 1, fontFace: 'NanumBarunGothic', fontSize: 32 });
      slide.addShape(pptx.ShapeType.rect, { x: 1, y: 3, w: 3, h: 2, fill: { color: 'E95834' } });
      slide.addNotes('발표자 노트 ' + n);
    }
    const input = path.join(output, 'linux-smoke.pptx');
    await pptx.writeFile({ fileName: input });
    await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(input);
    await expect(page.locator('.thumbnail-button')).toHaveCount(3);
    await expect(page.getByTestId('slide-canvas')).toContainText('리눅스 한글 발표 1');
    await page.screenshot({ path: path.join(output, 'editor.png') });

    const text = page.locator('.slide-element[data-type="text"]').first();
    await text.click({ button: 'right' });
    const objectMenu = page.getByRole('menu', { name: '개체 편집', exact: true });
    await expect(objectMenu).toBeVisible();
    await objectMenu.getByRole('menuitem', { name: '텍스트 편집', exact: true }).click();
    const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
    await expect(editor).toBeFocused();
    await editor.press('Control+Home');
    await editor.press('Shift+ArrowRight');
    await editor.press('Shift+ArrowRight');
    const selected = await page.evaluate(() => getSelection().toString());
    expect(selected).toBe('리눅');
    const bounds = await editor.boundingBox();
    await editor.click({ button: 'right', position: { x: bounds.width - 5, y: bounds.height - 5 } });
    const menu = page.getByRole('menu', { name: '텍스트 편집', exact: true });
    await menu.getByRole('menuitem', { name: '글자 색', exact: true }).click();
    const colors = page.getByRole('dialog', { name: '글자 색', exact: true });
    await colors.getByRole('textbox', { name: '색상 코드', exact: true }).fill('#FF0000');
    await colors.getByRole('button', { name: '적용', exact: true }).click();
    expect(await page.evaluate(() => getSelection().toString())).toBe(selected);
    expect(await page.evaluate(() => getComputedStyle(getSelection().getRangeAt(0).startContainer.parentElement).color)).toBe('rgb(255, 0, 0)');
    await editor.press('Control+z');
    await editor.press('Escape');
    await page.keyboard.press('F5');
    const show = page.getByTestId('presentation-view');
    await expect(show).toHaveAttribute('aria-label', /^발표 슬라이드 1 \//);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
    await show.hover();
    await page.mouse.wheel(0, 20);
    await expect(show).toHaveAttribute('aria-label', /^발표 슬라이드 2 \//);
    const ink = page.getByTestId('presentation-ink');
    await page.keyboard.press('Control+l');
    await expect(ink).toHaveAttribute('data-tool', 'laser');
    await ink.hover();
    await expect(page.getByTestId('laser-pointer')).toBeVisible();
    await page.keyboard.press('Control+p');
    await expect(ink).toHaveAttribute('data-tool', 'pen');
    const b = await ink.boundingBox();
    await page.mouse.move(b.x + b.width * .2, b.y + b.height * .6);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * .7, b.y + b.height * .6, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByTestId('ink-stroke')).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('ink-stroke')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'slideshow.png') });
    await page.keyboard.press('Escape');
    await expect(show).toBeHidden();

    // Native PDF export handler with only the OS save picker stubbed in CI.
    const pdf = path.join(output, 'linux-export.pdf');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, pdf);
    expect(await page.evaluate(() => window.desktop.exportPDF('Linux QA'))).toBe(pdf);
    const bytes = await fs.readFile(pdf);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5000);

    await page.getByRole('button', { name: '삽입', exact: true }).click();
    await page.getByRole('button', { name: '텍스트 상자', exact: true }).click();
    const newText = page.locator('.slide-element[data-type="text"]').last();
    await newText.dblclick();
    const longText = '긴 한글 문장이 리눅스에서도 마지막 글자까지 줄바꿈되어 표시됩니다. '.repeat(5);
    await editor.fill(longText);
    await expect.poll(() => newText.evaluate(el => el.offsetHeight)).toBeGreaterThan(70);
    await editor.press('Escape');
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await page.reload();
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    // Startup opens the first slide; this text was inserted on slide two.
    await page.locator('.thumbnail-button').nth(1).click();
    await expect(newText).toHaveText(longText);
    // Text-content assertions alone cannot catch missing Hangul glyphs (tofu).
    // Inspect the actual font used for Korean UI and default-font slide text.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    const elementID = await newText.getAttribute('data-element-id');
    const koreanFonts = {};
    // Query the actual text-bearing span: CDP's font query does not recurse
    // through every wrapper, so the outer .element-text reports no fonts.
    for (const [name, selector] of [['ui', '.tabs button'], ['defaultText', `[data-element-id="${elementID}"] .element-text [data-text-plain] > span`]]) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      koreanFonts[name] = fonts;
    }
    await cdp.detach();
    await fs.writeFile(path.join(output, 'korean-fonts.json'), JSON.stringify(koreanFonts, null, 2) + '\n');
    for (const fonts of Object.values(koreanFonts)) {
      expect(fonts.some(font => /Noto (Sans|Serif) CJK/.test(font.familyName) && font.glyphCount > 0)).toBe(true);
    }
    await page.getByRole('button', { name: '삽입', exact: true }).click();
    await page.getByRole('button', { name: '차트', exact: true }).click();
    const chart = page.getByRole('dialog', { name: '차트 삽입', exact: true });
    await expect(chart).toContainText('데이터 연동 안 됨');
    await chart.getByRole('button', { name: '취소', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'long-text.png') });
    if (process.env.EXPECTED_APP_VERSION.localeCompare('1.5.8', undefined, { numeric: true }) >= 0) {
      await require('./qa-editing-regressions.cjs')(page, output);
    }
    if (process.env.EXPECTED_APP_VERSION.localeCompare('1.6.0', undefined, { numeric: true }) >= 0)
      await require('./qa-remaining-regressions.cjs')(page, output, { app });
    await fs.writeFile(path.join(output, 'native-app.json'), JSON.stringify({
      version: process.env.EXPECTED_APP_VERSION, protection, installedApp: true, pptxImport: true,
      koreanText: true, systemKoreanFallback: true, objectContext: true, selectedTextColorAndSelection: true,
      nativeFullscreen: true, slideshowWheel: true, laserPointer: true, penAndUndo: true,
      nativePDFExport: true, longTextAutoHeight: true, autosaveReload: true, chartNotice: true,
      desktopSession: process.env.XDG_SESSION_TYPE || 'x11-xvfb',
    }, null, 2) + '\n');
  } catch (error) {
    failed = true;
    await app.windows()[0]?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (failed) app.process().kill();
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
