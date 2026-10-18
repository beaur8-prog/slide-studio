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
    await page.keyboard.press('F5');
    const presentation = page.getByTestId('presentation-view');
    await expect(presentation).toHaveAttribute('aria-label', /^발표 슬라이드 1 \//);
    await presentation.hover();
    await page.mouse.wheel(0, 20);
    await expect(presentation).toHaveAttribute('aria-label', /^발표 슬라이드 2 \//);
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
    }, null, 2) + '\n');
  } finally {
    await app.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
