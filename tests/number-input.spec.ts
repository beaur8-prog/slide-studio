import { test, expect, type Page } from "@playwright/test";

const arrow = (page: Page) => page.locator('[data-element-id="arrow-a"]');
const number = (page: Page, name: string) =>
  page.getByRole("spinbutton", { name, exact: true });

async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "arrow-a",
        shape: "arrow",
        x: 100,
        y: 100,
        width: 260,
        height: 100,
      }),
      element("shape", {
        id: "arrow-b",
        shape: "arrow",
        x: 500,
        y: 300,
        width: 260,
        height: 100,
      }),
      element("text", {
        id: "text-c",
        text: "크기 확인",
        x: 100,
        y: 450,
        width: 400,
        height: 100,
        fontSize: 32,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(3);
  await arrow(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "개체 서식", exact: true }).click();
  await expect(number(page, "너비")).toHaveValue("260");
}

async function typeNumber(page: Page, name: string, value: string) {
  const field = number(page, name);
  await field.focus();
  await field.press("ControlOrMeta+a");
  await field.pressSequentially(value);
  return field;
}

for (const width of ["200", "160"]) {
  test(`typing arrow width ${width} does not clamp intermediate digits`, async ({
    page,
  }) => {
    await open(page);
    const field = await typeNumber(page, "너비", width);
    await expect(field).toHaveValue(width);
    await expect(arrow(page)).toHaveCSS("width", "260px");
    await field.press("Enter");
    await expect(arrow(page)).toHaveCSS("width", `${width}px`);
    await expect(field).toHaveValue(width);
  });
}

test("width commits once, supports one-step undo/redo and persists after reload", async ({
  page,
}) => {
  await open(page);
  const field = await typeNumber(page, "너비", "200");
  await field.press("Enter");
  await expect(arrow(page)).toHaveCSS("width", "200px");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(arrow(page)).toHaveCSS("width", "260px");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(arrow(page)).toHaveCSS("width", "200px");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.reload();
  await expect(arrow(page)).toHaveCSS("width", "200px");
});

test("Tab commits, Escape cancels, and empty or incomplete values restore the original", async ({
  page,
}) => {
  await open(page);
  const width = await typeNumber(page, "너비", "160");
  await width.press("Tab");
  await expect(arrow(page)).toHaveCSS("width", "160px");
  await typeNumber(page, "너비", "500");
  await width.press("Escape");
  await expect(width).toHaveValue("160");
  await expect(arrow(page)).toHaveCSS("width", "160px");
  await width.fill("");
  await width.press("Enter");
  await expect(width).toHaveValue("160");
  await typeNumber(page, "너비", "-");
  await width.press("Tab");
  await expect(width).toHaveValue("160");
  await expect(arrow(page)).toHaveCSS("width", "160px");
});

test("switching objects commits the old object's draft without applying it to the new object", async ({
  page,
}) => {
  await open(page);
  await typeNumber(page, "너비", "200");
  await page.locator('[data-element-id="arrow-b"]').click();
  await expect(arrow(page)).toHaveCSS("width", "200px");
  await expect(page.locator('[data-element-id="arrow-b"]')).toHaveCSS(
    "width",
    "260px",
  );
  await expect(number(page, "너비")).toHaveValue("260");
  await number(page, "너비").focus();
  await number(page, "너비").press("Tab");
  await expect(page.locator('[data-element-id="arrow-b"]')).toHaveCSS(
    "width",
    "260px",
  );
});

test("signed and decimal geometry and stroke values survive sequential typing", async ({
  page,
}) => {
  await open(page);
  for (const [name, value] of [
    ["X", "-25.5"],
    ["Y", "-10.5"],
    ["너비", "200.5"],
    ["높이", "80.5"],
    ["회전", "-45"],
    ["불투명도", "75.5"],
    ["선 두께", "0.5"],
  ]) {
    const field = await typeNumber(page, name, value);
    await expect(field).toHaveValue(value);
    await field.press("Enter");
    await expect(field).toHaveValue(value);
  }
  await expect(arrow(page)).toHaveCSS("left", "-25.5px");
  await expect(arrow(page)).toHaveCSS("top", "-10.5px");
  await expect(arrow(page)).toHaveCSS("width", "200.5px");
  await expect(arrow(page)).toHaveCSS("height", "80.5px");
  await expect(arrow(page)).toHaveCSS("opacity", "0.755");
});

test("bounds are applied only when committing and arrow keys still step values", async ({
  page,
}) => {
  await open(page);
  const width = await typeNumber(page, "너비", "2");
  await expect(width).toHaveValue("2");
  await expect(arrow(page)).toHaveCSS("width", "260px");
  await width.press("Enter");
  await expect(width).toHaveValue("16");
  await expect(arrow(page)).toHaveCSS("width", "16px");
  await width.press("ArrowUp");
  await expect(width).toHaveValue("17");
  await expect(arrow(page)).toHaveCSS("width", "17px");
  await width.press("ArrowDown");
  await expect(width).toHaveValue("16");
  const rotation = await typeNumber(page, "회전", "-500");
  await expect(rotation).toHaveValue("-500");
  await rotation.press("Enter");
  await expect(rotation).toHaveValue("-360");
  const opacity = await typeNumber(page, "불투명도", "150");
  await expect(opacity).toHaveValue("150");
  await opacity.press("Enter");
  await expect(opacity).toHaveValue("100");
});

test("a multi-selection receives exactly the committed size and undoes as one edit", async ({
  page,
}) => {
  await open(page);
  const second = page.locator('[data-element-id="arrow-b"]');
  await second.click({ modifiers: ["Shift"] });
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
  const width = await typeNumber(page, "너비", "160");
  await width.press("Enter");
  await expect(arrow(page)).toHaveCSS("width", "160px");
  await expect(second).toHaveCSS("width", "160px");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(arrow(page)).toHaveCSS("width", "260px");
  await expect(second).toHaveCSS("width", "260px");
});

test("Home font size also keeps small leading digits until the number is complete", async ({
  page,
}) => {
  await open(page);
  const text = page.locator('[data-element-id="text-c"]');
  await text.click();
  const size = await typeNumber(page, "글자 크기", "18");
  await expect(size).toHaveValue("18");
  await expect(text.locator(".element-text")).toHaveCSS("font-size", "32px");
  await size.press("Enter");
  await expect(text.locator(".element-text")).toHaveCSS("font-size", "24px");
});

for (const kind of ["text", "shape", "image"] as const) {
  test(`seven-slide document: ${kind} keeps width 200, height 200 and rotation -15`, async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:5190");
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await page.evaluate(async () => {
      const { blankDeck, newSlide, element } = await import("/src/model.ts");
      const { saveAutosave } = await import("/src/storage.ts");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#D4613F";
      ctx.fillRect(0, 0, 32, 32);
      const deck = blankDeck();
      deck.slides = Array.from({ length: 7 }, (_, i) => ({
        ...newSlide("blank"),
        elements: [
          element("text", {
            id: `text-${i}`,
            text: "Alpha Beta 한글 문장",
            x: 100,
            y: 100,
            width: 300,
            height: 120,
            fontSize: 32,
            autoHeight: false,
          }),
          element("shape", {
            id: `shape-${i}`,
            shape: "arrow",
            x: 550,
            y: 100,
            width: 260,
            height: 100,
          }),
          element("image", {
            id: `image-${i}`,
            src: canvas.toDataURL(),
            x: 550,
            y: 350,
            width: 260,
            height: 100,
          }),
        ],
      }));
      await saveAutosave(deck);
    });
    await page.reload();
    await expect(page.locator(".thumbnail-button")).toHaveCount(7);
    await page.locator(".thumbnail-button").nth(6).click();
    const target = page.locator(`[data-element-id="${kind}-6"]`);
    await target.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "개체 서식", exact: true })
      .click();
    for (const [label, property, before] of [
      ["너비", "width", kind === "text" ? "300px" : "260px"],
      ["높이", "height", kind === "text" ? "120px" : "100px"],
    ] as const) {
      const field = number(page, label);
      await field.focus();
      await field.press("ControlOrMeta+a");
      await field.pressSequentially("2");
      await expect(field).toHaveValue("2");
      await expect(target).toHaveCSS(property, before);
      await field.pressSequentially("00");
      await expect(field).toHaveValue("200");
      await field.press("Enter");
      await expect(target).toHaveCSS(property, "200px");
    }
    const rotation = await typeNumber(page, "회전", "-15");
    await expect(rotation).toHaveValue("-15");
    expect(await target.evaluate((el) => el.style.transform)).toBe(
      "rotate(0deg)",
    );
    await rotation.press("Enter");
    expect(await target.evaluate((el) => el.style.transform)).toBe(
      "rotate(-15deg)",
    );
    if (kind === "text") {
      const size = await typeNumber(page, "글자 크기", "18");
      await expect(size).toHaveValue("18");
      await size.press("Enter");
      await expect(target.locator(".element-text")).toHaveCSS(
        "font-size",
        "24px",
      );
    }
    await expect(page.locator(".save-indicator")).toHaveText("저장됨");
    await page.reload();
    const persisted = await page.evaluate(async (kind) => {
      const { loadAutosave } = await import("/src/storage.ts");
      const deck = (await loadAutosave())!;
      return {
        count: deck.slides.length,
        edited: deck.slides[6].elements.find((e) => e.id === `${kind}-6`)!,
        untouched: deck.slides[0].elements.find((e) => e.id === `${kind}-0`)!,
      };
    }, kind);
    expect(persisted.count).toBe(7);
    expect(persisted.edited).toMatchObject({
      width: 200,
      height: 200,
      rotation: -15,
      ...(kind === "text" ? { fontSize: 24 } : {}),
    });
    expect(persisted.untouched).toMatchObject({
      width: kind === "text" ? 300 : 260,
      height: kind === "text" ? 120 : 100,
      rotation: 0,
    });
  });
}
