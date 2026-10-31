"use strict";
// Manual macOS panel QA in a disposable profile. Real OS dialogs are recorded,
// never answered or replaced by this script. Close through the app menu.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { _electron } = require("playwright");
const [executable, directory] = process.argv.slice(2);
if (process.platform !== "darwin" || !executable)
  throw Error(
    "Usage on macOS: node scripts/qa-file-panels-native.cjs <app-executable> [output]",
  );
(async () => {
  const output = path.resolve(directory || "qa/results/native-file-panels");
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-native-panels-profile-"),
  );
  const sentinel = path.join(profile, "recovery-preserve-sentinel.bin");
  await fs.writeFile(sentinel, "Preserve recovery fixture");
  const env = { ...process.env, STUDIO_DISABLE_UPDATES: "1" };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SLIDE_STUDIO_DEV;
  const app = await _electron.launch({
    executablePath: path.resolve(executable),
    args: ["--user-data-dir=" + profile],
    env,
  });
  await app.evaluate(({ app, dialog, systemPreferences }, output) => {
    const fs = process.getBuiltinModule("node:fs"),
      path = process.getBuiltinModule("node:path");
    const records = [];
    const persist = () =>
      fs.writeFileSync(
        path.join(output, "native-panels.json"),
        JSON.stringify(
          {
            version: app.getVersion(),
            profile: app.getPath("userData"),
            records,
          },
          null,
          2,
        ) + "\n",
      );
    for (const method of ["showOpenDialog", "showSaveDialog"]) {
      const native = dialog[method].bind(dialog);
      dialog[method] = async (...args) => {
        const options = args.at(-1),
          record = {
            method,
            defaultPath: options.defaultPath,
            filters: options.filters,
            root: systemPreferences.getUserDefault(
              "NSOSPLastRootDirectory",
              "string",
            ),
            startedAt: new Date().toISOString(),
          };
        records.push(record);
        persist();
        try {
          const result = await native(...args);
          Object.assign(record, {
            canceled: result.canceled,
            filePath: result.filePath,
            filePaths: result.filePaths,
          });
          return result;
        } catch (error) {
          record.error = String(error);
          throw error;
        } finally {
          record.finishedAt = new Date().toISOString();
          persist();
        }
      };
    }
    app.on("before-quit", persist);
    persist();
  }, output);
  const page = await app.firstWindow();
  await page.waitForSelector(".save-indicator");
  console.log(
    JSON.stringify({
      ready: true,
      profile,
      version: await app.evaluate(({ app }) => app.getVersion()),
    }),
  );
  await new Promise((resolve) => app.once("close", resolve));
  const bytes = await fs.readFile(sentinel);
  if (bytes.toString() !== "Preserve recovery fixture")
    throw Error("Recovery sentinel changed");
  await fs.writeFile(
    path.join(output, "native-profile.json"),
    JSON.stringify(
      { profile, recoveryPreserved: true, closedNormally: true },
      null,
      2,
    ) + "\n",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
