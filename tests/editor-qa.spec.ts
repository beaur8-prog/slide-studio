import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("Korean composition, mixed-language input, undo/redo and autosave survive a reload", async ({
  page,
  context,
}, testInfo) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { sampleDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = sampleDeck();
    deck.name = "한글 조합 검증";
    deck.slides = [deck.slides[0]];
    deck.slides[0].elements = [
      element("text", {
        text: "입력 전",
        x: 100,
        y: 100,
        width: 1000,
        height: 220,
        fontSize: 42,
        paragraphs: [{ runs: [{ text: "입력 전", fontSize: 42 }] }],
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.getByTestId("slide-element").dblclick();
  const input = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
  await input.press("ControlOrMeta+A");
  await input.press("Backspace");
  const cdp = await context.newCDPSession(page);
  // Chromium's composition engine generates composition/input events. This does
  // not claim to exercise the separate macOS Korean input-source UI.
  for (const syllables of [
    ["ㅎ", "하", "한"],
    ["ㄱ", "그", "글"],
  ]) {
    for (const text of syllables)
      await cdp.send("Input.imeSetComposition", {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    await cdp.send("Input.insertText", { text: syllables.at(-1)! });
  }
  await cdp.send("Input.insertText", { text: " 입력 정상 — Hello 123" });
  await input.press("Enter");
  await cdp.send("Input.insertText", { text: "둘째 줄: ㄱㄴㄷ, 값·꽃·읽기" });
  const expected = "한글 입력 정상 — Hello 123\n둘째 줄: ㄱㄴㄷ, 값·꽃·읽기";
  await expect(input).toHaveText(expected, { useInnerText: true });
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.getByTestId("slide-element")).toContainText("입력 전");
  await page.getByRole("button", { name: "다시 실행", exact: true }).click();
  await expect(page.getByTestId("slide-element")).toHaveText(expected, {
    useInnerText: true,
  });
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveText(expected, {
    useInnerText: true,
  });
  const roundTrip = await page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
      await import("/src/io.ts");
    const deck = await loadAutosave();
    return {
      json: parseDeckJson(serializeDeck(deck)).slides[0].elements[0].text,
      pptx: (await importPptx(await exportPptx(deck))).deck.slides[0]
        .elements[0].text,
    };
  });
  expect(roundTrip).toEqual({ json: expected, pptx: expected });
  await page
    .getByTestId("canvas-frame")
    .screenshot({ path: testInfo.outputPath("korean-composition.png") });
});

test("300-slide document stays editable and records interaction timings", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { sampleDeck, uid } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const original = sampleDeck();
    const slides = Array.from({ length: 300 }, (_, index) => ({
      ...structuredClone(original.slides[index % 4]),
      id: uid(),
    }));
    await saveAutosave({
      ...original,
      id: uid(),
      name: "300장 성능 검증",
      slides,
    });
  });
  const start = performance.now();
  await page.reload();
  await expect(page.locator(".thumbnail-row")).toHaveCount(300);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const loadMs = performance.now() - start;
  await page.locator(".thumbnail-button").nth(299).click();
  await expect(page.locator(".canvas-topline")).toContainText("300 / 300");
  await page.locator(".thumbnail-button").nth(0).click();
  const text = page.locator('.editable-slide [data-type="text"]').first();
  await text.dblclick();
  const editor = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
  const typingStart = performance.now();
  await editor.press("End");
  await editor.pressSequentially("1234567890", { delay: 0 });
  const typingMs = performance.now() - typingStart;
  await expect(editor).toContainText("1234567890");
  const blurStart = performance.now();
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const saveMs = performance.now() - blurStart;
  const metrics = {
    slides: 300,
    load_ms: loadMs,
    ten_key_input_ms: typingMs,
    blur_to_saved_ms: saveMs,
  };
  console.log("STRESS_METRICS " + JSON.stringify(metrics));
  await writeFile(
    testInfo.outputPath("300-slide-timings.json"),
    JSON.stringify(metrics, null, 2),
  );
  await testInfo.attach("300-slide-timings", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});
