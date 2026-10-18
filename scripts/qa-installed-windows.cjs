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
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 30000 });
    const version = await app.evaluate(({ app }) => app.getVersion());
    expect(version).toBe(process.env.EXPECTED_APP_VERSION);
    expect(await page.locator('.thumbnail-button').count()).toBeGreaterThan(1);
    const pointerTools = version.localeCompare('1.5.3', undefined, { numeric: true }) >= 0;
    const ribbonLayouts = [];
    if (pointerTools) {
      await page.getByRole('button', { name: '슬라이드 쇼', exact: true }).click();
      for (const [width, height] of [[1080, 720], [1543, 1001]]) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
        const layout = await page.locator('.ribbon').evaluate(ribbon => {
          const bounds = ribbon.getBoundingClientRect();
          return { width: innerWidth, height: innerHeight, unclipped: Array.from(ribbon.querySelectorAll('button')).every(button => {
            return [button, ...button.querySelectorAll('svg, span')].every(item => { const r = item.getBoundingClientRect(); return r.top >= bounds.top && r.bottom <= bounds.bottom; });
          }) };
        });
        expect(layout.unclipped).toBe(true);
        ribbonLayouts.push(layout);
      }
      await page.screenshot({ path: path.join(output, 'windows-ribbon-fixed.png') });
    }
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
    await expect(presentation).toBeHidden();
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
      version, installedApplicationLaunched: true, editorRendered: true,
      slideshowWheel: true, escapeRestoresEditor: true,
      runningAppBlocksSilentUpdate: true, runningApplicationPreserved: true,
      ...(pointerTools ? { ribbonLayouts, unclippedNotes: true, laserPointer: true, penDrawing: true, eraser: true, nativeInkUndoRedo: true, contextTools: true } : {}),
    }, null, 2) + '\n');
  } catch (error) {
    try { await app.windows()[0]?.screenshot({ path: path.join(output, 'native-failed.png') }); } catch {}
    throw error;
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
