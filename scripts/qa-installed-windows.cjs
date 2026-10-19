'use strict';

// Run only on a disposable GitHub-hosted Windows runner after installation.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

(async () => {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw new Error('This check requires a disposable Windows CI runner');
  const executable = path.join(process.env.LOCALAPPDATA, 'Programs', 'Slide Studio', 'Slide Studio.exe');
  const output = path.resolve('qa/results/windows-setup-native');
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: executable, env, timeout: 45000 });
  let failed = false;
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(30000);
    console.log("Native app: window opened");
    await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 30000 });
    const version = await app.evaluate(({ app }) => app.getVersion());
    expect(version).toBe(process.env.EXPECTED_APP_VERSION);
    expect(await page.locator('.thumbnail-button').count()).toBeGreaterThan(1);
    const pointerTools = version.localeCompare('1.5.3', undefined, { numeric: true }) >= 0;
    const ribbonLayouts = [];
    if (pointerTools) {
      await page.getByRole('button', { name: '슬라이드 쇼', exact: true }).click();
      for (const [width, height] of [[970, 720], [1080, 720], [1280, 900], [1543, 1001], [1920, 1080]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
        const layout = await page.locator('.ribbon').evaluate(ribbon => {
          const bounds = ribbon.getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, unclipped: Array.from(ribbon.querySelectorAll('button')).every(button => {
            return [button, ...button.querySelectorAll('svg, span')].every(item => { const r = item.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom && r.left >= bounds.left && r.right <= bounds.right; });
          }) };
        });
        const horizontalLabels = await page.locator('.ribbon button').evaluateAll(buttons => buttons.every(button => {
          const label = button.querySelector('span'); if (!label) return false;
          const box = button.getBoundingClientRect(), range = document.createRange(); range.selectNodeContents(label);
          const text = range.getBoundingClientRect(); return text.left >= box.left + 5 && text.right <= box.right - 5;
        }));
        expect(horizontalLabels).toBe(true);
        layout.horizontalLabels = horizontalLabels;
        const hide = page.locator('.ribbon').getByRole('button', { name: '슬라이드 숨기기', exact: true });
        await hide.click();
        await page.locator('.ribbon').getByRole('button', { name: '숨김 해제', exact: true }).click();
        expect(layout.unclipped).toBe(true);
        ribbonLayouts.push(layout);
      }
      await page.screenshot({ path: path.join(output, 'windows-ribbon-fixed.png') });
    }
    console.log('Native app: ribbon verified');
    await page.keyboard.press('F5');
    const presentation = page.getByTestId('presentation-view');
    await expect(presentation).toHaveAttribute('aria-label', /^발표 슬라이드 1 \//);
    await presentation.hover();
    await page.mouse.wheel(0, 20);
    await expect(presentation).toHaveAttribute('aria-label', /^발표 슬라이드 2 \//);
    if (pointerTools) {
      const ink = page.getByTestId('presentation-ink');
      await page.keyboard.press('Control+l');
      await expect(ink).toHaveAttribute('data-tool', 'laser');
      await ink.hover();
      await expect(page.getByTestId('laser-pointer')).toBeVisible();
      await page.screenshot({ path: path.join(output, 'laser-pointer.png') });
      await page.keyboard.press('Control+p');
      await expect(ink).toHaveAttribute('data-tool', 'pen');
      const b = await ink.boundingBox();
      await page.mouse.move(b.x + b.width * .2, b.y + b.height * .65);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * .7, b.y + b.height * .65, { steps: 15 });
      await page.mouse.up();
      await expect(page.getByTestId('ink-stroke')).toHaveCount(1);
      await page.keyboard.press('Control+e');
      await expect(ink).toHaveAttribute('data-tool', 'eraser');
      await page.mouse.move(b.x + b.width * .5, b.y + b.height * .5);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * .5, b.y + b.height * .8, { steps: 10 });
      await page.mouse.up();
      await expect(page.getByTestId('ink-stroke')).toHaveCount(0);
      await page.keyboard.press('Control+z');
      await expect(page.getByTestId('ink-stroke')).toHaveCount(1);
      await page.keyboard.press('Control+Shift+z');
      await expect(page.getByTestId('ink-stroke')).toHaveCount(0);
      await page.keyboard.press('Control+z');
      await expect(page.getByTestId('ink-stroke')).toHaveCount(1);
      await page.keyboard.press('Control+a');
      await expect(ink).toHaveAttribute('data-tool', 'arrow');
      await page.keyboard.press('F1');
      await expect(page.getByRole('dialog', { name: '발표 도구', exact: true })).toBeVisible();
      await page.screenshot({ path: path.join(output, 'presentation-tools.png') });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '발표 도구', exact: true })).toBeHidden();
      await expect(presentation).toBeVisible();
    }
    await page.keyboard.press('Escape');
    if (await page.getByRole('button', { name: '판서 버리기', exact: true }).isVisible())
      await page.getByRole('button', { name: '판서 버리기', exact: true }).click();
    await expect(presentation).toBeHidden();
    const objectContext = version.localeCompare('1.5.4', undefined, { numeric: true }) >= 0;
    if (objectContext) {
      const text = page.locator('.slide-element[data-type="text"]').first();
      await text.click({ button: 'right' });
      const editMenu = page.getByRole('menu', { name: '개체 편집' });
      await expect(editMenu).toBeVisible();
      await expect(editMenu.getByRole('menuitem', { name: '텍스트 편집', exact: true })).toBeEnabled();
      await page.screenshot({ path: path.join(output, 'object-context-menu.png') });
      const count = await page.getByTestId('slide-element').count();
      await editMenu.getByRole('menuitem', { name: '복제', exact: true }).click();
      await expect(page.getByTestId('slide-element')).toHaveCount(count + 1);
      await page.keyboard.press('Control+z');
      await expect(page.getByTestId('slide-element')).toHaveCount(count);
    }
    console.log('Native app: presentation and object context verified');
    const textFormatting = version.localeCompare('1.5.5', undefined, { numeric: true }) >= 0;
    if (textFormatting) {
      await page.getByRole('button', { name: '홈', exact: true }).click();
      const text = page.locator('.slide-element[data-type="text"]').first();
      await text.dblclick();
      const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
      await expect(editor).toBeFocused();
      const originalText = await editor.innerText();
      await editor.press('Control+Home');
      await editor.press('Shift+ArrowRight');
      await editor.press('Shift+ArrowRight');
      const originalColor = await page.evaluate(() => getComputedStyle(getSelection().getRangeAt(0).startContainer.parentElement).color);
      const selected = await page.evaluate(() => getSelection()?.toString());
      expect(selected.length).toBe(2);
      const box = await editor.boundingBox();
      await editor.click({ button: 'right', position: { x: box.width - 5, y: box.height - 5 } });
      const textMenu = page.getByRole('menu', { name: '텍스트 편집', exact: true });
      await expect(textMenu).toBeVisible();
      expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
      await textMenu.getByRole('menuitem', { name: '복사', exact: true }).click();
      await expect.poll(async () => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(selected);
      await editor.click({ button: 'right', position: { x: box.width - 5, y: box.height - 5 } });
      await expect(textMenu).toBeVisible();
      await textMenu.getByRole('menuitem', { name: '글자 색', exact: true }).click();
      const colors = page.getByRole('dialog', { name: '글자 색', exact: true });
      await expect(colors).toBeVisible();
      await colors.getByRole('textbox', { name: '색상 코드', exact: true }).fill('#FF0000');
      await page.screenshot({ path: path.join(output, 'selected-text-color.png') });
      await colors.getByRole('button', { name: '적용', exact: true }).click();
      await expect(editor).toBeFocused();
      expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
      expect(await editor.innerText()).toBe(originalText);
      expect(await page.evaluate(() => {
        const range = getSelection().getRangeAt(0);
        return getComputedStyle(range.startContainer.parentElement).color;
      })).toBe('rgb(255, 0, 0)');
      await editor.press('Control+z');
      expect(await editor.innerText()).toBe(originalText);
      await expect.poll(async () => page.evaluate(() => getComputedStyle(getSelection().getRangeAt(0).startContainer.parentElement).color)).toBe(originalColor);
      console.log('Native app: selection, clipboard and partial color verified');
      await editor.press('Escape');
      await page.getByRole('button', { name: '파일', exact: true }).click();
      await page.getByRole('button', { name: '원본 글꼴 추가', exact: true }).click();
      const fonts = page.getByRole('dialog', { name: '원본 글꼴 추가', exact: true });
      await expect(fonts).toBeVisible();
      await page.screenshot({ path: path.join(output, 'source-fonts.png') });
      // Supply the file directly to the real input. An OS dialog can block
      // Electron's remote filechooser interception on a hosted desktop.
      await fonts.getByLabel('원본 글꼴 파일', { exact: true }).setInputFiles(path.resolve('public/fonts/NanumBarunGothic.ttf'));
      await expect(fonts.getByRole('status')).toContainText('적용됨');
      await fonts.getByRole('button', { name: '글꼴 관리 닫기', exact: true }).click();
      await page.reload();
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      expect(await page.evaluate(() => Array.from(document.fonts).some(f => f.family.includes('Slide Studio Local NanumBarunGothic') && f.status === 'loaded'))).toBe(true);
      await page.getByRole('button', { name: '파일', exact: true }).click();
      await page.getByRole('button', { name: '원본 글꼴 추가', exact: true }).click();
      await fonts.getByRole('button', { name: /NanumBarunGothic.*제거/ }).click();
      await expect(fonts.getByRole('status')).toContainText('제거했습니다');
      await fonts.getByRole('button', { name: '글꼴 관리 닫기', exact: true }).click();
    }
    console.log('Native app: source font import, reload and removal verified');
    const longTextFeatures = version.localeCompare('1.5.7', undefined, { numeric: true }) >= 0;
    if (longTextFeatures) {
      // Import a clean fixture through the real project input. This runner's
      // profile is disposable; no user's open document is involved.
      const fixture = path.join(output, 'blank-long-text.slide');
      await fs.writeFile(fixture, JSON.stringify({
        version: 1, id: 'qa-long-text', name: '긴 한글 표시 확인', width: 1280, height: 720, theme: 'studio',
        slides: [{ id: 'qa-slide', background: '#FAF8F2', notes: '', transition: 'none', elements: [] }],
      }));
      await page.locator('input[accept=".slide,.json,.pptx"]').setInputFiles(fixture);
      await expect(page.getByTestId('slide-element')).toHaveCount(0);
      await page.getByRole('button', { name: '삽입', exact: true }).click();
      await page.getByRole('button', { name: '텍스트 상자', exact: true }).click();
      const text = page.getByTestId('slide-element');
      await text.dblclick();
      const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
      const longText = '긴 한글 문장이 상자 너비에 맞춰 줄바꿈되고 마지막 글자까지 표시되는지 확인합니다. '.repeat(3);
      await editor.fill(longText);
      await expect.poll(() => text.evaluate(el => el.offsetHeight)).toBeGreaterThan(70);
      const complete = () => text.evaluate(el => {
        const host = el.querySelector('.element-text'), box = host.getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(host);
        return Array.from(range.getClientRects()).filter(r => r.width).every(r =>
          r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1);
      });
      await expect.poll(complete).toBe(true);
      await editor.press('Escape');
      await page.getByRole('button', { name: '서식', exact: true }).click();
      await expect(page.getByLabel('상자 너비에 맞춰 자동 줄바꿈')).toBeChecked();
      const automatic = page.getByLabel('내용에 맞춰 상자 높이 자동 조절');
      await expect(automatic).toBeChecked();
      await page.getByLabel('높이', { exact: true }).fill('70');
      await page.getByLabel('높이', { exact: true }).press('Enter');
      await expect(automatic).not.toBeChecked();
      await automatic.check();
      await expect.poll(complete).toBe(true);
      await page.screenshot({ path: path.join(output, 'long-text.png') });
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      await page.reload();
      await expect(text).toHaveText(longText);
      await expect.poll(complete).toBe(true);
      await page.getByRole('button', { name: '삽입', exact: true }).click();
      await page.getByRole('button', { name: '차트', exact: true }).click();
      const chart = page.getByRole('dialog', { name: '차트 삽입', exact: true });
      await expect(chart).toContainText('데이터 연동 안 됨');
      await expect(chart).toContainText('자동 갱신되지 않습니다');
      await page.screenshot({ path: path.join(output, 'chart-notice.png') });
      await chart.getByRole('button', { name: '취소', exact: true }).click();
      console.log('Native app: long Korean auto-height, persistence and chart notice verified');
    }
    if (version.localeCompare('1.5.8', undefined, { numeric: true }) >= 0) {
      await require('./qa-editing-regressions.cjs')(page, output);
      console.log('Native app: partial italic and numeric edits verified');
    }
    if (version.localeCompare('1.6.0', undefined, { numeric: true }) >= 0)
      await require('./qa-remaining-regressions.cjs')(page, output, { app });
    if (version.localeCompare('1.6.1', undefined, { numeric: true }) >= 0)
      await require('./qa-studio-clipboard.cjs')(page, output, { app });
    if (version.localeCompare('1.6.2', undefined, { numeric: true }) >= 0)
      await require('./qa-animated-media.cjs')(page, output, { app });
    // A silent update must fail rather than kill a running app or overwrite it.
    const busyExit = await new Promise((resolve, reject) => {
      execFile(process.env.SETUP_PATH, ['/S'], { timeout: 45000 }, error => {
        if (error?.killed) reject(error);
        else resolve(error?.code ?? 0);
      });
    });
    expect(busyExit).toBe(2);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    await page.screenshot({ path: path.join(output, 'installed-app.png') });
    await fs.writeFile(path.join(output, 'native-app.json'), JSON.stringify({
      version, objectContext, ...(textFormatting ? { textContextSelection: true, nativeTextClipboard: true, partialTextColor: true, nativeTextColorUndo: true, sourceFontImportPersistenceRemoval: true } : {}),
      ...(longTextFeatures ? { nativeLongTextAutoHeight: true, nativeHeightSettingsAndPersistence: true, chartDataNotice: true } : {}), installedApplicationLaunched: true, editorRendered: true,
      slideshowWheel: true, escapeRestoresEditor: true,
      runningAppBlocksSilentUpdate: true, runningApplicationPreserved: true,
      ...(pointerTools ? { ribbonLayouts, unclippedNotes: true, laserPointer: true, penDrawing: true, eraser: true, nativeInkUndoRedo: true, contextTools: true } : {}),
    }, null, 2) + '\n');
  } catch (error) {
    failed = true;
    console.error("Native verification failed:", error);
    try { await app.windows()[0]?.screenshot({ path: path.join(output, 'native-failed.png') }); } catch {}
    throw error;
  } finally {
    // This script is guarded to run only on a disposable CI desktop. A failed
    // assertion can leave unsaved state and trigger the app's unload dialog.
    if (failed) app.process().kill();
    await app.close().catch(() => {});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
