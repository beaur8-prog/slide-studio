import { test, expect } from "@playwright/test";

test("shape text stays one editable object with independent fill, line and rich text alpha over three PPTX rounds", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts");
    const d = blankDeck();
    d.slides[0].elements = [
      element("shape", {
        shape: "ellipse",
        x: 100,
        y: 100,
        width: 600,
        height: 300,
        rotation: 25,
        fill: "#FF0000",
        fillOpacity: 0.25,
        stroke: "#0000FF",
        strokeWidth: 3,
        strokeOpacity: 0.8,
        text: "한글 Alpha Beta",
        fontSize: 28,
        color: "#000000",
        textInsets: [4, 8, 12, 16],
        verticalAlign: "middle",
        paragraphs: [
          {
            runs: [
              { text: "한글 Alpha ", opacity: 0.6 },
              { text: "Beta", bold: true, color: "#008800", opacity: 1 },
            ],
          },
        ],
      }),
    ];
    let deck = d;
    for (let i = 0; i < 3; i++)
      deck = (await importPptx(await exportPptx(deck))).deck;
    const { saveAutosave } = await import("/src/storage.ts");
    await saveAutosave(deck);
    return deck.slides[0].elements;
  });
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({
    type: "shape",
    shape: "ellipse",
    text: "한글 Alpha Beta",
    fillOpacity: 0.25,
    strokeOpacity: 0.8,
    opacity: 1,
    textInsets: [4, 8, 12, 16],
    rotation: 25,
  });
  expect(r[0].paragraphs![0].runs[0].opacity).toBe(0.6);
  expect(r[0].paragraphs![0].runs[1].bold).toBe(true);
  await page.reload();
  const shape = page.locator('.editable-slide [data-type="shape"]');
  await expect(shape.locator(".shape-text-frame")).toContainText(
    "한글 Alpha Beta",
  );
  await shape.dblclick();
  const editor = page.getByRole("textbox", {
    name: "슬라이드 텍스트 편집",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("도형 안에서 직접 입력");
  await editor.press("Escape");
  await expect(shape).toContainText("도형 안에서 직접 입력");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(shape).toContainText("도형 안에서 직접 입력");
});

test("HSL luminance transforms change lightness rather than multiplying RGB channels", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const r = await page.evaluate(async () => {
    const { rgbToHsl, hslToRgb } = await import("/src/colors.ts");
    const hsl = rgbToHsl([255, 0, 0]);
    hsl[2] *= 0.5;
    hsl[2] += 0.5;
    return hslToRgb(hsl).map(Math.round);
  });
  expect(r).toEqual([255, 128, 128]);
});

test("gradient backgrounds, shape gradients, dashed outlines and outer shadows retain standard DrawingML over three rounds", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx, importPptx } = await import("/src/io.ts"),
      { saveAutosave } = await import("/src/storage.ts");
    let d = blankDeck();
    const gradient = {
      kind: "linear" as const,
      angle: 35,
      stops: [
        { offset: 0, color: "#FF0000", opacity: 0.3 },
        { offset: 0.5, color: "#00FF00", opacity: 1 },
        { offset: 1, color: "#0000FF", opacity: 0.8 },
      ],
    };
    d.slides[0].backgroundGradient = gradient;
    d.slides[0].elements = [
      element("shape", {
        shape: "roundRect",
        x: 100,
        y: 120,
        width: 500,
        height: 300,
        fill: "#FF0000",
        gradient,
        stroke: "#111111",
        strokeWidth: 3,
        strokeDash: [12, 9, 3, 9],
        strokeCap: "round",
        shadow: { color: "#123456", opacity: 0.4, blur: 12, dx: 8, dy: 6 },
      }),
    ];
    let warnings: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await importPptx(await exportPptx(d));
      d = r.deck;
      warnings.push(...r.warnings);
    }
    await saveAutosave(d);
    return { slide: d.slides[0], warnings };
  });
  expect(result.slide.backgroundGradient).toMatchObject({
    kind: "linear",
    angle: 35,
  });
  expect(result.slide.elements[0]).toMatchObject({
    gradient: { kind: "linear", angle: 35 },
    strokeDash: [12, 9, 3, 9],
    strokeCap: "round",
    shadow: { color: "#123456", opacity: 0.4, blur: 12 },
  });
  expect(result.slide.elements[0].shadow!.dx).toBeCloseTo(8, 3);
  expect(result.warnings.join(" ")).not.toMatch(/그라데이션|점선|그림자/);
  await page.reload();
  await expect(page.locator(".editable-slide")).toHaveCSS(
    "background-image",
    /linear-gradient/,
  );
  await expect(page.locator('.editable-slide [data-type="shape"]')).toHaveCSS(
    "filter",
    /drop-shadow/,
  );
  await expect(
    page.locator('.editable-slide [data-type="shape"] svg g'),
  ).toHaveAttribute("stroke-dasharray", "12 9 3 9");
});
