"use strict";
// Production-bundle QA in a disposable profile. Dialog answers are supplied to
// Electron, while real menu commands, renderer, IPC and filesystem do the work.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { _electron } = require("playwright"),
  { expect } = require("@playwright/test"),
  PptxGenJS = require("pptxgenjs"),
  JSZip = require("jszip");
const [executable, directory] = process.argv.slice(2);
if (!executable)
  throw Error(
    "Usage: node scripts/qa-save-native.cjs <app-executable> [output]",
  );
const output = path.resolve(directory || "qa/results/native-save");
const hash = async (file) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const exists = async (file) => !!(await fs.stat(file).catch(() => null));
const geometry = async (file) => {
  const zip = await JSZip.loadAsync(await fs.readFile(file)),
    xml = await zip.file("ppt/slides/slide1.xml").async("string");
  // The slide group's own transform has a zero extent. Read the actual shape,
  // independently of any private Studio metadata in the archive.
  const shape = xml.match(/<p:sp[\s>]([\s\S]*?)<\/p:sp>/)?.[1];
  const ext = shape?.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  assert(ext, "editable shape extent missing");
  return Number(ext[1]) / 9525;
};
(async () => {
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-save-native-"),
  );
  const original = path.join(output, "원본 발표.pptx"),
    copy = path.join(output, "다른 이름.pptx"),
    recovered = path.join(output, "외부 변경 보존.pptx");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.addSlide().addShape(pptx.ShapeType.rect, {
    x: 1,
    y: 1,
    w: 260 / 96,
    h: 100 / 96,
    fill: { color: "4472C4" },
  });
  await pptx.writeFile({ fileName: original });
  for (const name of [copy, recovered]) await fs.rm(name, { force: true });
  let app;
  const results = [],
    errors = [];
  const launchStarted = Date.now();
  let bootReadyMs;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.SLIDE_STUDIO_DEV;
    app = await _electron.launch({
      executablePath: path.resolve(executable),
      args: [
        ...(env.QA_APP_ROOT ? [path.resolve(env.QA_APP_ROOT)] : []),
        "--user-data-dir=" + profile,
        "--mute-audio",
        ...(process.platform === "linux" && env.QA_NO_SANDBOX === "1"
          ? ["--no-sandbox"]
          : []),
      ],
      env,
      timeout: 45000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => {
      void d.accept().catch(() => {});
    });
    await expect(page.locator(".save-indicator")).toHaveText("저장됨", {
      timeout: 20000,
    });
    bootReadyMs = Date.now() - launchStarted;
    await app.evaluate(({ dialog }) => {
      global.__saveQA = { open: [], save: [], messages: [], seen: [] };
      const q = global.__saveQA;
      dialog.showOpenDialog = async (_, options) => {
        q.seen.push({ kind: "open", options });
        return q.open.shift() || { canceled: true, filePaths: [] };
      };
      dialog.showSaveDialog = async (_, options) => {
        q.seen.push({ kind: "save", options });
        return q.save.shift() || { canceled: true };
      };
      dialog.showMessageBox = async (_, options) => {
        q.seen.push({ kind: "message", options });
        return q.messages.shift() || { response: 2 };
      };
    });
    const menu = (label) =>
      app.evaluate(({ Menu }, label) => {
        const item = Menu.getApplicationMenu()
          .items.flatMap((i) => i.submenu?.items || [])
          .find((i) => i.label === label);
        if (!item) throw Error("Missing menu " + label);
        item.click();
      }, label);
    const queue = (kind, reply) =>
      app.evaluate((_, { kind, reply }) => global.__saveQA[kind].push(reply), {
        kind,
        reply,
      });
    const seen = (kind) =>
      app.evaluate(
        (_, kind) => global.__saveQA.seen.filter((s) => s.kind === kind),
        kind,
      );
    const idle = async () => {
      await expect(page.locator(".busy-backdrop")).toHaveCount(0);
    };
    const dirty = () =>
      page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty"));
    const open = async (file) => {
      const n = (await seen("open")).length;
      await queue("open", { canceled: false, filePaths: [file] });
      await menu("Open…");
      await expect.poll(async () => (await seen("open")).length).toBe(n + 1);
      await idle();
    };
    const shape = () => page.locator('.editable-slide [data-type="shape"]');
    const changeWidth = async (value, commit = true) => {
      await shape().click();
      const field = page.getByRole("spinbutton", { name: "너비", exact: true });
      if (!(await field.isVisible()))
        await page.getByRole("button", { name: "서식", exact: true }).click();
      await field.fill(String(value));
      if (commit) await field.press("Enter");
      return field;
    };
    await open(original);
    await expect(shape()).toHaveCount(1);
    results.push("native-open-sets-original-file-context");
    const first = await hash(original);
    await changeWidth(200, false);
    await menu("Save PowerPoint");
    await expect.poll(() => hash(original)).not.toBe(first);
    await idle();
    assert.equal(await geometry(original), 200);
    assert.equal((await seen("save")).length, 0);
    await expect.poll(dirty).toBe("false");
    results.push(
      "native-menu-save-commits-number-draft-and-overwrites-without-chooser",
    );
    const originalHash = await hash(original);
    await queue("save", { canceled: false, filePath: copy });
    await menu("Save PowerPoint As…");
    await expect.poll(() => exists(copy)).toBe(true);
    await idle();
    assert.equal(await hash(original), originalHash);
    assert.equal(await geometry(copy), 200);
    results.push("native-save-as-preserves-original");
    const copyHash = await hash(copy);
    await changeWidth(210);
    await menu("Save PowerPoint");
    await expect.poll(() => hash(copy)).not.toBe(copyHash);
    await idle();
    assert.equal(await geometry(copy), 210);
    assert.equal(await hash(original), originalHash);
    assert.equal((await seen("save")).length, 1);
    results.push("native-save-after-save-as-targets-copy");
    await changeWidth(220);
    await fs.writeFile(copy, "external edit");
    await queue("messages", { response: 2 });
    await menu("Save PowerPoint");
    await expect.poll(async () => (await seen("message")).length).toBe(1);
    await idle();
    assert.equal(await fs.readFile(copy, "utf8"), "external edit");
    await expect.poll(dirty).toBe("true");
    results.push(
      "native-external-conflict-cancel-retains-dirty-document-and-original",
    );
    await queue("messages", { response: 0 });
    await queue("save", { canceled: false, filePath: recovered });
    await menu("Save PowerPoint");
    await expect.poll(() => exists(recovered)).toBe(true);
    await idle();
    assert.equal(await fs.readFile(copy, "utf8"), "external edit");
    assert.equal(await geometry(recovered), 220);
    await expect.poll(dirty).toBe("false");
    results.push("native-external-conflict-save-as-keeps-both-versions");
    await changeWidth(230);
    const saveCountBeforeCancel = (await seen("save")).length;
    await queue("save", { canceled: true });
    await menu("Save PowerPoint As…");
    await expect
      .poll(async () => (await seen("save")).length)
      .toBe(saveCountBeforeCancel + 1);
    await idle();
    await expect.poll(dirty).toBe("true");
    assert.equal(await geometry(recovered), 220);
    results.push("native-save-as-cancel-does-not-mark-saved");
    await menu("Save PowerPoint");
    await expect.poll(() => geometry(recovered)).toBe(230);
    await idle();
    results.push("native-save-after-cancel-keeps-working-file-context");
    const broken = path.join(output, "손상.pptx");
    await fs.writeFile(broken, "broken");
    await open(broken);
    await expect(page.locator(".toast")).toContainText("파일 열기 실패");
    await changeWidth(240);
    await menu("Save PowerPoint");
    await expect.poll(() => geometry(recovered)).toBe(240);
    await idle();
    assert.equal(await fs.readFile(broken, "utf8"), "broken");
    results.push("native-failed-import-keeps-current-file-context");
    await fs.rm(recovered);
    await changeWidth(250);
    await queue("save", { canceled: true });
    const count = (await seen("save")).length;
    await menu("Save PowerPoint");
    await expect.poll(async () => (await seen("save")).length).toBe(count + 1);
    await idle();
    assert.equal(await exists(recovered), false);
    results.push("native-deleted-file-falls-back-to-chooser");
    await menu("New Presentation");
    // Electron routes window.confirm through the same native message-box
    // surface. Explicitly confirm discarding this disposable dirty QA deck.
    await queue("messages", { response: 0 });
    await page.getByRole("button", { name: "만들기", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "만들기", exact: true }),
    ).toHaveCount(0);
    const before = (await seen("save")).length;
    await queue("save", { canceled: true });
    await menu("Save PowerPoint");
    await expect.poll(async () => (await seen("save")).length).toBe(before + 1);
    await idle();
    assert.equal(await hash(original), originalHash);
    assert.equal(await fs.readFile(copy, "utf8"), "external edit");
    results.push("native-new-document-cannot-overwrite-previous-destination");
    const items = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items.flatMap((i) => i.submenu?.items || [])
        .filter((i) => i.label.startsWith("Save PowerPoint"))
        .map((i) => ({ label: i.label, accelerator: i.accelerator })),
    );
    assert(items.some((i) => i.accelerator === "CmdOrCtrl+S"));
    assert(items.some((i) => i.accelerator === "CmdOrCtrl+Shift+S"));
    results.push("native-save-and-save-as-have-distinct-keyboard-accelerators");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, "finished.png") });
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify(
        {
          status: "passed",
          bootReadyMs,
          results,
          errors,
          dialogs: await app.evaluate(() => global.__saveQA.seen),
        },
        null,
        2,
      ),
    );
    await fs.rm(path.join(output, "failure.json"), { force: true });
    console.log(JSON.stringify({ status: "passed", results }, null, 2));
  } catch (error) {
    await (await app?.firstWindow())
      ?.screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
    await fs.writeFile(
      path.join(output, "failure.json"),
      JSON.stringify(
        { error: String(error.stack || error), results, errors },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    // This profile and every file are disposable test data. A deliberately
    // dirty final document must not leave QA waiting on the OS close prompt.
    if (app) {
      await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await app.close().catch(() => {});
    }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
