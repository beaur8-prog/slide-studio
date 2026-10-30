import { test, expect, type Page } from "@playwright/test";
async function seed(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "a",
        name: "Back",
        x: 30,
        y: 50,
        width: 100,
        height: 100,
      }),
      element("text", {
        id: "b",
        name: "Title",
        text: "한글 제목",
        x: 200,
        y: 100,
        width: 300,
        height: 100,
      }),
      element("shape", {
        id: "c",
        name: "Child A",
        x: 600,
        y: 50,
        width: 100,
        height: 100,
        groups: ["g"],
        groupNames: ["Team"],
      }),
      element("shape", {
        id: "d",
        name: "Child B",
        x: 800,
        y: 50,
        width: 100,
        height: 100,
        groups: ["g"],
        groupNames: ["Team"],
        hidden: true,
      }),
      element("shape", {
        id: "e",
        name: "Front",
        x: 1000,
        y: 50,
        width: 100,
        height: 100,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await page.keyboard.press("Alt+F10");
  await expect(page.getByRole("tree", { name: "슬라이드 개체" })).toBeVisible();
}
const row = (page: Page, name: string) =>
  page.getByRole("treeitem", { name, exact: true });
const selected = (page: Page) => page.getByRole("treeitem", { selected: true });
const canvasItem = (page: Page, id: string) =>
  page.locator(`.editable-slide [data-element-id="${id}"]`);

test("selection pane supports Ctrl/Shift selection, focus follows keyboard and opening/selecting is not dirty", async ({
  page,
}) => {
  await seed(page);
  await row(page, "Front").click();
  await row(page, "Title").click({ modifiers: ["ControlOrMeta"] });
  await expect(selected(page)).toHaveCount(2);
  await expect(canvasItem(page, "b")).toHaveClass(/selected/);
  await row(page, "Back").click({ modifiers: ["Shift"] });
  await expect(row(page, "Title")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Back")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "Front")).toHaveAttribute("aria-selected", "false");
  await row(page, "Front").focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, "Team")).toBeFocused();
  await expect(row(page, "Team")).toHaveAttribute("aria-selected", "true");
  await expect(canvasItem(page, "c")).toHaveCSS("left", "600px");
  await expect(
    page.getByRole("button", { name: /^실행 취소/ }).first(),
  ).toBeDisabled();
});

test("rename uses F2/Enter, cancellation and no-op do not add history, rename undo works", async ({
  page,
}) => {
  await seed(page);
  await row(page, "Title").click();
  await page.keyboard.press("F2");
  await page.getByRole("textbox", { name: "개체 이름" }).fill("한글 제목 이름");
  await page.keyboard.press("Escape");
  await expect(row(page, "Title")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^실행 취소/ }).first(),
  ).toBeDisabled();
  await row(page, "Title").dblclick();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: /^실행 취소/ }).first(),
  ).toBeDisabled();
  await row(page, "Title").dblclick();
  await page.getByRole("textbox", { name: "개체 이름" }).fill("한글 제목 이름");
  await page.keyboard.press("Enter");
  await expect(row(page, "한글 제목 이름")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(row(page, "Title")).toBeVisible();
});

test("group hide and show retains child visibility; show all, undo and slide show agree", async ({
  page,
}) => {
  await seed(page);
  await expect(canvasItem(page, "d")).toHaveCount(0);
  await page.getByRole("button", { name: "Team 숨기기", exact: true }).click();
  await expect(canvasItem(page, "c")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Child B 표시", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Team 표시", exact: true }).click();
  await expect(canvasItem(page, "c")).toBeVisible();
  await expect(canvasItem(page, "d")).toHaveCount(0);
  await page.getByRole("button", { name: "모두 표시", exact: true }).click();
  await expect(canvasItem(page, "d")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(canvasItem(page, "d")).toHaveCount(0);
  await page.keyboard.press("F5");
  await expect(page.locator('.presentation [data-element-id="d"]')).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
});

test("layer arrows and drag insertion reorder groups together and undo restores order", async ({
  page,
}) => {
  await seed(page);
  const names = () =>
    page
      .getByRole("treeitem")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  const before = await names();
  await row(page, "Team").click();
  await page
    .getByRole("button", { name: "선택 개체 앞으로", exact: true })
    .click();
  expect((await names()).slice(0, 4)).toEqual([
    "Team",
    "Child B",
    "Child A",
    "Front",
  ]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await names()).toEqual(before);
  const target = (await row(page, "Back").boundingBox())!;
  const source = (await row(page, "Front").boundingBox())!;
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height - 2,
    { steps: 12 },
  );
  await page.mouse.move(
    target.x + target.width / 2 + 1,
    target.y + target.height - 2,
  );
  await expect(page.locator(".layer-row.drop-below")).toHaveCount(1);
  await page.mouse.up();
  expect((await names()).slice(-2)).toEqual(["Back", "Front"]);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await names()).toEqual(before);
});
