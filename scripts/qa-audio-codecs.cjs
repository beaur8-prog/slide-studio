"use strict";
// Read real public MP3 and locally generated AAC sources in Chrome, exercise the
// application UI and two native PPTX saves, and retain exact media-byte hashes.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const [mp3File, directory] = process.argv.slice(2);
if (!mp3File)
  throw Error(
    "Usage: node scripts/qa-audio-codecs.cjs <MP3-file> [output-directory]",
  );
const output = path.resolve(directory || "qa/results/audio-codecs");
const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:5190");
    const aac = Buffer.from(
      await page.evaluate(async () => {
        const context = new AudioContext(),
          destination = context.createMediaStreamDestination(),
          oscillator = context.createOscillator(),
          gain = context.createGain();
        gain.gain.value = 0.01;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        await context.resume();
        const recorder = new MediaRecorder(destination.stream, {
            mimeType: "audio/mp4;codecs=mp4a.40.2",
          }),
          chunks = [];
        const done = new Promise((resolve) => {
          recorder.ondataavailable = (e) => chunks.push(e.data);
          recorder.onstop = resolve;
        });
        recorder.start(100);
        const until = performance.now() + 6000;
        while (
          !chunks.some((chunk) => chunk.size > 0) &&
          performance.now() < until
        )
          await new Promise((resolve) => setTimeout(resolve, 100));
        await new Promise((resolve) => setTimeout(resolve, 800));
        recorder.stop();
        await done;
        oscillator.stop();
        destination.stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      }),
    );
    if (aac.length < 100) throw Error("AAC fixture encoder produced no frames");
    const m4aFile = path.join(output, "generated-aac.m4a");
    await fs.writeFile(m4aFile, aac);
    const results = [];
    await page.close();
    for (const [file, mime] of [
      [mp3File, "audio/mpeg"],
      [m4aFile, "audio/mp4"],
    ]) {
      const page = await browser.newPage();
      await page.goto("http://127.0.0.1:5190");
      await expect(page.locator(".save-indicator")).toHaveText("저장됨");
      await page
        .getByLabel("오디오 삽입 파일", { exact: true })
        .setInputFiles(path.resolve(file));
      await expect(
        page.locator('.editable-slide [data-type="audio"]'),
      ).toHaveCount(1);
      const raw = await fs.readFile(file),
        source = `data:${mime};base64,${raw.toString("base64")}`;
      await expect(
        page.getByLabel("선택한 오디오 미리 듣기", { exact: true }),
      ).toHaveAttribute("src", source);
      await expect
        .poll(() =>
          page.evaluate(async (source) => {
            const { loadAutosave } = await import("/src/storage.ts");
            return (
              (await loadAutosave())?.slides[0].elements.find(
                (e) => e.type === "audio",
              )?.src === source
            );
          }, source),
        )
        .toBe(true);
      const round = await page.evaluate(async (source) => {
        const { loadAutosave } = await import("/src/storage.ts"),
          { importPptx, exportPptx } = await import("/src/io.ts"),
          { bytesDataUrl } = await import("/src/video.ts");
        let deck = await loadAutosave(),
          bytes;
        for (let i = 0; i < 2; i++) {
          bytes = await exportPptx(deck);
          deck = (await importPptx(bytes)).deck;
          if (
            deck.slides[0].elements.find((e) => e.type === "audio")?.src !==
            source
          )
            throw Error(
              `Source bytes changed in round ${i + 1}: ${deck.slides[0].elements.map((e) => e.type).join(",")}`,
            );
        }
        return bytesDataUrl(bytes, "application/octet-stream").split(",")[1];
      }, source);
      await fs.writeFile(
        path.join(output, path.basename(file) + ".pptx"),
        Buffer.from(round, "base64"),
      );
      await page.keyboard.press("F5");
      const track = page
        .getByTestId("presentation-view")
        .locator("audio[data-audio-id]");
      await expect
        .poll(() => track.evaluate((a) => a.currentTime))
        .toBeGreaterThan(0.1);
      const playback = await track.evaluate((a) => ({
        readyState: a.readyState,
        error: a.error?.code ?? null,
        paused: a.paused,
      }));
      assert.equal(playback.error, null);
      assert.equal(playback.paused, false);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("presentation-view")).toHaveCount(0);
      results.push({
        name: path.basename(file),
        mime,
        bytes: raw.length,
        sha256: sha(raw),
        twoNativeRoundTrips: true,
        playback,
      });
      await page.close();
    }
    const fixturePage = await browser.newPage();
    await fixturePage.goto("http://127.0.0.1:5190");
    const wav = Buffer.alloc(44 + 8000 * 2);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    const sources = [
      `data:audio/mpeg;base64,${(await fs.readFile(mp3File)).toString("base64")}`,
      `data:audio/mp4;base64,${aac.toString("base64")}`,
      `data:audio/wav;base64,${wav.toString("base64")}`,
    ];
    const fixture = await fixturePage.evaluate(async (sources) => {
      const { blankDeck, newSlide, element } = await import("/src/model.ts"),
        { AUDIO_ICON } = await import("/src/audio-icon.ts"),
        { exportPptx } = await import("/src/io.ts"),
        { bytesDataUrl } = await import("/src/video.ts");
      const deck = blankDeck();
      deck.name = "설치형 오디오 검수";
      deck.slides = [
        "오디오와 한글 제목",
        "배경음 계속",
        "수동 AAC",
        "자동 WAV",
        "끝",
      ].map((text) => ({
        ...newSlide(),
        elements: [
          element("text", {
            x: 100,
            y: 100,
            width: 1000,
            height: 100,
            text,
            fontSize: 32,
          }),
        ],
      }));
      for (const [i, slideIndex] of [0, 2, 3].entries())
        deck.slides[slideIndex].elements.push(
          element("audio", {
            src: sources[i],
            poster: AUDIO_ICON,
            id: `native-audio-${i}`,
            alt: ["MP3 배경음", "AAC 수동 소리", "WAV 자동 소리"][i],
            x: 500,
            y: 300,
            width: 96,
            height: 96,
            autoPlay: i !== 1,
            loop: i === 0,
            muted: true,
            volume: 0.2,
            playAcrossSlides: i === 0,
            audioSlideCount: i === 0 ? 2 : 1,
            hideDuringShow: false,
          }),
        );
      return bytesDataUrl(
        await exportPptx(deck),
        "application/octet-stream",
      ).split(",")[1];
    }, sources);
    await fs.writeFile(
      path.join(output, "native-audio-workflow.pptx"),
      Buffer.from(fixture, "base64"),
    );
    await fixturePage.close();
    await fs.writeFile(
      path.join(output, "results.json"),
      JSON.stringify({ results }, null, 2) + "\n",
    );
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
