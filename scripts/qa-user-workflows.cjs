'use strict';

// Run against a packaged executable, using only disposable documents/profile.
// node scripts/qa-user-workflows.cjs '/path/Slide Studio.app/Contents/MacOS/Slide Studio' [output]
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

(async () => {
  if (!process.argv[2]) throw new Error('A packaged executable path is required.');
  const executablePath = path.resolve(process.argv[2]);
  const output = path.resolve(process.argv[3] || '.cache/qa-user-workflows-native');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-user-workflow-native-'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  let app;
  let passed = false;
  try {
    app = await electron.launch({ executablePath, args: ['--user-data-dir=' + profile], env, timeout: 45000 });
    // Native unload warnings concern only the generated QA documents.
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    const fixtureDialogs = await require('./qa-generated-documents.cjs')(page, app);
    for (const script of ['qa-save-startup', 'qa-current-release', 'qa-editing-regressions', 'qa-remaining-regressions'])
      await require('./' + script + '.cjs')(page, output, { app });
    const { fixtureDiscardConfirmations } = fixtureDialogs();
    passed = true;
    await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({
      version: await app.evaluate(({ app }) => app.getVersion()),
      platform: process.platform, passed, executablePath,
      isolatedProfile: true, controlledNativeChoosers: true,
      fixtureDiscardConfirmations,
    }, null, 2) + '\n');
    console.log('Packaged UI, save/reopen, PDF, editing and presentation checks passed.');
  } finally {
    if (app) {
      if (!passed) app.process().kill('SIGKILL'); // Only the disposable process launched above.
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
