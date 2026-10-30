import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";

const wave = (() => {
  const rate = 8000,
    frames = rate * 2,
    bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  // Quiet deterministic PCM; Chrome is also launched with --mute-audio.
  for (let i = 0; i < frames; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 300),
      44 + i * 2,
    );
  return bytes;
})();
const source = `data:audio/wav;base64,${wave.toString("base64")}`;
async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
}
async function seed(page: Page, settings: Record<string, unknown> = {}) {
  await open(page);
  await page.evaluate(
    async ({ source, settings }) => {
      const { blankDeck, newSlide, element } = await import("/src/model.ts"),
        { saveAutosave } = await import("/src/storage.ts"),
        { AUDIO_ICON } = await import("/src/audio-icon.ts");
      const d = blankDeck();
      d.slides = [newSlide(), newSlide(), newSlide()];
      d.slides[0].elements = [
        element("audio", {
          id: "audio-one",
          src: source,
          poster: AUDIO_ICON,
          x: 500,
          y: 250,
          width: 96,
          height: 96,
          autoPlay: true,
          loop: false,
          muted: false,
          volume: 0.4,
          alt: "검수 소리.wav",
          ...settings,
        }),
      ];
      await saveAutosave(d);
    },
    { source, settings },
  );
  await page.reload();
}
const show = (page: Page) => page.getByTestId("presentation-view");
const track = (page: Page) =>
  show(page).locator('audio[data-audio-id="audio-one"]');
const current = (page: Page) =>
  track(page).evaluate((audio: HTMLAudioElement) => ({
    paused: audio.paused,
    time: audio.currentTime,
    loop: audio.loop,
    volume: audio.volume,
    muted: audio.muted,
  }));

test("audio insertion and playback settings support undo, reload and native PPTX without transcoding", async ({
  page,
}, info) => {
  await open(page);
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "오디오", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("오디오 삽입 파일", { exact: true })
    .setInputFiles({
      name: "테스트 녹음.wav",
      mimeType: "audio/wav",
      buffer: wave,
    });
  const icon = page.locator('.editable-slide [data-type="audio"]');
  await expect(icon).toBeVisible();
  const preview = page.getByLabel("선택한 오디오 미리 듣기", { exact: true });
  await expect
    .poll(() => preview.evaluate((a: HTMLAudioElement) => a.readyState))
    .toBeGreaterThan(0);
  expect(
    await preview.evaluate((a: HTMLAudioElement) => ({
      paused: a.paused,
      time: a.currentTime,
    })),
  ).toEqual({ paused: true, time: 0 });
  await page.getByRole("checkbox", { name: "반복 재생", exact: true }).check();
  const volume = page.getByRole("spinbutton", {
    name: "오디오 볼륨 (%)",
    exact: true,
  });
  await volume.fill("55");
  await volume.press("Enter");
  await page
    .getByRole("checkbox", {
      name: "다음 슬라이드에서도 계속 재생",
      exact: true,
    })
    .check();
  const count = page.getByRole("spinbutton", {
    name: "재생할 슬라이드 수",
    exact: true,
  });
  await count.fill("2");
  await count.press("Enter");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(count).toHaveValue("999");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(count).toHaveValue("2");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const d = (await loadAutosave())!,
      e = d.slides[0].elements.find((e) => e.type === "audio")!;
    const raw = await exportPptx(d),
      zip = await JSZip.loadAsync(raw);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    zip.remove("slide-studio/document.json");
    const native = await zip.generateAsync({ type: "uint8array" }),
      imported = await importPptx(native);
    const audio = imported.deck.slides[0].elements.find(
      (e) => e.type === "audio",
    )!;
    return {
      source: e.src,
      sourceAfter: audio?.src,
      settings: {
        autoPlay: audio?.autoPlay,
        loop: audio?.loop,
        muted: audio?.muted,
        volume: audio?.volume,
        playAcrossSlides: audio?.playAcrossSlides,
        audioSlideCount: audio?.audioSlideCount,
      },
      xml,
      warnings: imported.warnings,
      bytes: Array.from(native),
    };
  });
  expect(result.source).toBe(source);
  expect(result.sourceAfter).toBe(source);
  expect(result.settings).toEqual({
    autoPlay: true,
    loop: true,
    muted: false,
    volume: 0.55,
    playAcrossSlides: true,
    audioSlideCount: 2,
  });
  expect(result.xml).toContain("a:audioFile");
  expect(result.xml).not.toContain("a:videoFile");
  expect(result.xml).toContain("<p:audio>");
  expect(result.warnings).toEqual([]);
  await fs.writeFile(
    info.outputPath("audio-native.pptx"),
    Buffer.from(result.bytes),
  );
});

test("audience audio starts only in the show, click and Space pause without changing slides, and exit releases the source", async ({
  page,
}) => {
  await seed(page);
  expect(
    await page.locator(".thumbnail-list audio,.editable-slide audio").count(),
  ).toBe(0);
  await page.keyboard.press("F5");
  await expect
    .poll(async () => (await current(page)).time)
    .toBeGreaterThan(0.1);
  expect((await current(page)).volume).toBe(0.4);
  const handle = await track(page).elementHandle();
  await show(page)
    .getByRole("button", { name: "일시 정지: 검수 소리.wav", exact: true })
    .click();
  await expect.poll(async () => (await current(page)).paused).toBe(true);
  await expect(show(page)).toHaveAttribute("aria-label", "발표 슬라이드 1 / 3");
  await show(page)
    .getByRole("button", { name: "재생: 검수 소리.wav", exact: true })
    .press("Space");
  await expect.poll(async () => (await current(page)).paused).toBe(false);
  await expect(show(page)).toHaveAttribute("aria-label", "발표 슬라이드 1 / 3");
  await show(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(track(page)).toHaveCount(0);
  expect(
    await handle!.evaluate((a: HTMLAudioElement) => ({
      paused: a.paused,
      src: a.getAttribute("src"),
    })),
  ).toEqual({ paused: true, src: null });
  await page.keyboard.press("Escape");
  await expect(show(page)).toHaveCount(0);
});

test("background audio survives slide changes without restarting, pauses on blackout, stops after its slide count and never leaves playback on exit", async ({
  page,
}) => {
  await seed(page, {
    loop: true,
    playAcrossSlides: true,
    audioSlideCount: 2,
    hideDuringShow: true,
  });
  await page.keyboard.press("F5");
  await expect
    .poll(async () => (await current(page)).time)
    .toBeGreaterThan(0.2);
  const handle = await track(page).elementHandle(),
    before = (await current(page)).time;
  await expect(show(page).locator(".audio-play-button")).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(show(page)).toHaveAttribute("aria-label", "발표 슬라이드 2 / 3");
  expect(
    await handle!.evaluate(
      (a: HTMLAudioElement) =>
        a === document.querySelector('[data-audio-id="audio-one"]'),
    ),
  ).toBe(true);
  await expect
    .poll(async () => (await current(page)).time)
    .toBeGreaterThan(before);
  await page.keyboard.press("b");
  await expect.poll(async () => (await current(page)).paused).toBe(true);
  const paused = (await current(page)).time;
  await page.keyboard.press("b");
  await expect
    .poll(async () => (await current(page)).time)
    .toBeGreaterThan(paused);
  await page.keyboard.press("ArrowRight");
  await expect(track(page)).toHaveCount(0);
  expect(await handle!.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("audio[data-audio-id]")).toHaveCount(0);
});

test("manual audio remains paused until its icon is clicked and can repeat without advancing", async ({
  page,
}) => {
  await seed(page, { autoPlay: false, loop: true });
  await page.keyboard.press("F5");
  await expect(track(page)).toHaveCount(1);
  expect(await current(page)).toMatchObject({
    paused: true,
    time: 0,
    loop: true,
  });
  await show(page)
    .getByRole("button", { name: "재생: 검수 소리.wav", exact: true })
    .click();
  await expect
    .poll(async () => (await current(page)).time)
    .toBeGreaterThan(0.1);
  await page.keyboard.press("Escape");
  await expect(show(page)).toHaveCount(0);
});

test("audio parser rejects remote sources, mismatched bytes, oversize files and fractional playback counts", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async (source) => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { validateDeck } = await import("/src/io.ts"),
      { safeAudio, readAudio, MAX_AUDIO_BYTES } = await import("/src/audio.ts");
    const rejected = [];
    for (const value of [
      "https://example.test/sound.mp3",
      source.replace("audio/wav", "audio/mpeg"),
      "data:audio/mpeg;base64,AAAA",
    ]) {
      try {
        safeAudio(value);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    for (const extra of [
      { volume: -1 },
      { volume: 1.01 },
      { audioSlideCount: 0 },
      { audioSlideCount: 2.5 },
      { autoPlay: "true" },
      { hideDuringShow: "yes" },
    ]) {
      const d = blankDeck();
      d.slides[0].elements = [element("audio", { src: source, ...extra })];
      try {
        validateDeck(d);
        rejected.push(false);
      } catch {
        rejected.push(true);
      }
    }
    try {
      await readAudio(
        new File([new Uint8Array(MAX_AUDIO_BYTES + 1)], "huge.wav", {
          type: "audio/wav",
        }),
      );
      rejected.push(false);
    } catch {
      rejected.push(true);
    }
    try {
      await readAudio(
        new File(
          [new Uint8Array([0x49, 0x44, 0x33, 0, 0, 0, 0, 0, 0, 0, 0])],
          "broken.mp3",
          { type: "audio/mpeg" },
        ),
      );
      rejected.push(false);
    } catch {
      rejected.push(true);
    }
    return rejected;
  }, source);
  expect(result).toEqual(Array(11).fill(true));
});

test("edited native audio timing replaces only that sound while preserving animation and sound effects over three saves", async ({
  page,
}, info) => {
  await seed(page, {
    loop: true,
    playAcrossSlides: true,
    audioSlideCount: 3,
    volume: 0.8,
  });
  const result = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts"),
      { importPptx, exportPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js"),
      { bytesDataUrl } = await import("/src/video.ts");
    let deck = (await loadAutosave())!,
      zip = await JSZip.loadAsync(await exportPptx(deck));
    let xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    const id = xml.match(/<p:cNvPr[^>]*id="([^"]+)"[^>]*name="audio-one"/)![1];
    const effect = `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="98" dur="500"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
    const sound = `<p:audio><p:cMediaNode vol="70000"><p:cTn id="99" dur="indefinite"/><p:tgtEl><p:sndTgt r:embed="rIdSoundEffect" name="Effect"/></p:tgtEl></p:cMediaNode></p:audio>`;
    xml = xml.replace("</p:childTnLst>", effect + sound + "</p:childTnLst>");
    zip.file("ppt/slides/slide1.xml", xml);
    const relpath = "ppt/slides/_rels/slide1.xml.rels",
      rels = await zip.file(relpath)!.async("string"),
      target =
        rels.match(/Target="([^"]+)"[^>]*Type="http[^\"]+\/audio"/)?.[1] ??
        rels.match(/Type="http[^\"]+\/audio"[^>]*Target="([^"]+)"/)![1];
    zip.file(
      relpath,
      rels.replace(
        "</Relationships>",
        `<Relationship Id="rIdSoundEffect" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="${target}"/></Relationships>`,
      ),
    );
    deck = (await importPptx(await zip.generateAsync({ type: "uint8array" })))
      .deck;
    Object.assign(deck.slides[0].elements[0], {
      autoPlay: false,
      loop: false,
      muted: true,
      volume: 0.35,
      playAcrossSlides: false,
      hideDuringShow: true,
    });
    const rounds = [];
    let bytes: Uint8Array = new Uint8Array();
    for (let i = 0; i < 3; i++) {
      bytes = await exportPptx(deck);
      zip = await JSZip.loadAsync(bytes);
      xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
      deck = (await importPptx(bytes)).deck;
      const audio = deck.slides[0].elements.find((e) => e.type === "audio")!;
      rounds.push({
        source: audio.src,
        autoPlay: audio.autoPlay,
        loop: audio.loop,
        muted: audio.muted,
        volume: audio.volume,
        playAcrossSlides: audio.playAcrossSlides,
        hideDuringShow: audio.hideDuringShow,
        audios: (xml.match(/<p:audio>/g) ?? []).length,
        effects: (xml.match(/<p:animEffect/g) ?? []).length,
        soundTargets: (xml.match(/<p:sndTgt/g) ?? []).length,
      });
    }
    return {
      rounds,
      bytes: bytesDataUrl(bytes, "application/octet-stream").split(",")[1],
    };
  });
  expect(result.rounds).toEqual(
    Array(3).fill({
      source,
      autoPlay: false,
      loop: false,
      muted: true,
      volume: 0.35,
      playAcrossSlides: false,
      hideDuringShow: true,
      audios: 2,
      effects: 1,
      soundTargets: 1,
    }),
  );
  await fs.writeFile(
    info.outputPath("edited-native-audio.pptx"),
    Buffer.from(result.bytes, "base64"),
  );
});
