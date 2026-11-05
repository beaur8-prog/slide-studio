#!/usr/bin/env node
// Interleaved, disposable before/after runs. No personal profile or document.
import fs from "node:fs/promises";
import { createWriteStream, constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const [outputArg, beforeUrl, afterUrl, beforeCommit, afterCommit] = process.argv.slice(2);
assert(outputArg && beforeUrl && afterUrl && beforeCommit && afterCommit,
  "Usage: node scripts/qa-layout-performance.mjs <new qa/results directory> <before localhost URL> <after localhost URL> <before commit> <after commit>");
const output = path.resolve(outputArg);
assert(output.startsWith(path.join(root, "qa/results") + path.sep), "Use this checkout's ignored qa/results directory.");
for (const value of [beforeUrl, afterUrl]) {
  const url = new URL(value);
  assert(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)
    && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash,
  "Use dedicated localhost servers.");
}
for (const value of [beforeCommit, afterCommit]) assert(/^[0-9a-f]{40}$/i.test(value), "Use full source commit hashes.");
const samples = [
  { mode: "corpus-151", label: "cmu-151", sha256: "12a8a88d3e33a520c6c037debbbab47ef9a3f706dca2dbc450d7443150df03ca" },
  { mode: "generated", label: "mixed-300" },
];
const report = {
  startedAt: new Date().toISOString(), status: "running", repetitions: 5,
  environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), node: process.version },
  sources: { before: { url: beforeUrl, commit: beforeCommit }, after: { url: afterUrl, commit: afterCommit } },
  runs: [], summary: [],
  limitations: [
    "Dedicated development servers and fresh disposable Chromium profiles; not native application launch timing.",
    "Memory is post-GC JavaScript heap, not process RSS or peak resident memory.",
    "Five interleaved observations per version and sample; no p95 or universal performance guarantee.",
  ],
};
const record = () => fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2) + "\n");
function execute(args, env, filename) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(filename, { flags: "wx" });
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    let completed = false;
    const finish = error => {
      if (completed) return; completed = true;
      log.end(() => error ? reject(error) : resolve());
    };
    child.on("error", finish);
    child.on("close", (code, signal) => finish(code === 0 ? undefined : Error(`QA child exited ${code ?? signal}; see ${filename}`)));
    log.on("error", error => {
      child.kill();
      if (!completed) { completed = true; reject(error); }
    });
  });
}
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), observations: values };
};
await fs.mkdir(output, { recursive: false });
try {
  await record();
  for (const sample of samples) {
    let generatedFixture;
    for (let repeat = 1; repeat <= 5; repeat++) {
      // Reverse the order on alternate rounds to reduce consistent warm-cache bias.
      for (const variant of repeat % 2 ? ["before", "after"] : ["after", "before"]) {
        const relative = `${sample.label}/${variant}-${repeat}`;
        const directory = path.join(output, relative);
        await fs.mkdir(directory, { recursive: true });
        if (generatedFixture)
          await fs.copyFile(generatedFixture, path.join(directory, "mixed-300.pptx"), constants.COPYFILE_FICLONE);
        console.log(new Date().toISOString(), sample.label, variant, repeat, "started");
        await execute([path.join(root, "scripts/qa-large-workflow.cjs"), directory, sample.mode], {
          ...process.env, QA_BASE_URL: report.sources[variant].url,
          QA_SOURCE_COMMIT: report.sources[variant].commit, QA_LARGE_SLIDES: "300", QA_LARGE_REOPEN: "3",
        }, path.join(directory, "run.log"));
        if (sample.mode === "generated" && !generatedFixture)
          generatedFixture = path.join(directory, "mixed-300.pptx");
        const filename = path.join(directory, sample.label, "metrics.json");
        const metrics = JSON.parse(await fs.readFile(filename, "utf8"));
        assert.equal(metrics.status, "passed");
        assert.equal(metrics.sha256, sample.sha256 ?? report.runs.find(r => r.sample === sample.label)?.metrics.sha256 ?? metrics.sha256);
        report.runs.push({ sample: sample.label, variant, repeat, file: path.relative(output, filename), metrics });
        await record();
        console.log(new Date().toISOString(), sample.label, variant, repeat, "passed");
      }
    }
    const runs = report.runs.filter(r => r.sample === sample.label);
    const keys = ["open_ui_and_autosave", "navigate_first_to_last", "navigate_last_to_middle", "save_pptx_ui", "reopen_saved_ui_and_autosave"];
    const stages = Object.fromEntries(keys.map(key => {
      const before = distribution(runs.filter(r => r.variant === "before").map(r => r.metrics.stages[key].ms));
      const after = distribution(runs.filter(r => r.variant === "after").map(r => r.metrics.stages[key].ms));
      return [key, { before, after, medianChangePercent: (after.median / before.median - 1) * 100 }];
    }));
    const heaps = Object.fromEntries(["after_open", "after_reopen", "after_third_repeat"].map(key => [key, Object.fromEntries(
      ["before", "after"].map(variant => [variant, distribution(runs.filter(r => r.variant === variant).map(r =>
        (key === "after_third_repeat" ? r.metrics.repeated_reopen.at(-1) : r.metrics[key]).js_heap_mb))]),
    )]));
    report.summary.push({ sample: sample.label, sha256: runs[0].metrics.sha256, stages, heaps });
    await record();
  }
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await record();
}
