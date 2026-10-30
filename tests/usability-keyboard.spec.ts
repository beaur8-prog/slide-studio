import { expect, test, type Page } from "@playwright/test";

const item = (page: Page, id: string) => page.locator(`.editable-slide [data-element-id="${id}"]`);
const selected = (page: Page) => page.locator(".editable-slide .slide-element.selected");

async function seed(page: Page, grouped = false) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async grouped => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("text", { id: "first", text: "Alpha Beta", x: 70, y: 70, width: 500, height: 90, ...(grouped ? { groups: ["qa-group"] } : {}) }),
      element("text", { id: "second", text: "Second", x: 70, y: 230, width: 500, height: 90, ...(grouped ? { groups: ["qa-group"] } : {}) }),
      element("shape", { id: "third", shape: "rect", x: 800, y: 230, width: 200, height: 150, fill: "#3167C4" }),
    ];
    await saveAutosave(deck);
  }, grouped);
  await page.reload();
  await expect(item(page, "first")).toBeVisible();
}

test("Tab selects the focused object so moving and deleting affect that object, with undo", async ({ page }) => {
  await seed(page);
  await item(page, "first").click();
  await page.keyboard.press("Tab");
  await expect(item(page, "second")).toBeFocused();
  await expect(selected(page)).toHaveAttribute("data-element-id", "second");
  await page.keyboard.press("ArrowRight");
  await expect(item(page, "second")).toHaveCSS("left", "71px");
  await expect(item(page, "first")).toHaveCSS("left", "70px");
  await page.keyboard.press("Delete");
  await expect(item(page, "second")).toHaveCount(0);
  await expect(item(page, "first")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item(page, "second")).toBeVisible();
});

test("Tab wraps in both directions without creating document history or trapping ribbon focus", async ({ page }) => {
  await seed(page);
  await item(page, "first").click();
  await page.keyboard.press("Shift+Tab");
  await expect(item(page, "third")).toBeFocused();
  await expect(selected(page)).toHaveAttribute("data-element-id", "third");
  await page.keyboard.press("Tab");
  await expect(item(page, "first")).toBeFocused();
  await expect(page.getByRole("button", { name: "실행 취소", exact: true })).toBeDisabled();
  const ribbon = page.getByRole("button", { name: "텍스트", exact: true });
  await ribbon.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "도형", exact: true })).toBeFocused();
});

test("keyboard navigation treats grouped objects as one selection while pointer multi-select is preserved", async ({ page }) => {
  await seed(page, true);
  await item(page, "first").click();
  await expect(selected(page)).toHaveCount(2);
  await page.keyboard.press("Tab");
  await expect(item(page, "third")).toBeFocused();
  await expect(selected(page)).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(item(page, "first")).toBeFocused();
  await expect(selected(page)).toHaveCount(2);
  await item(page, "third").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
});

for (const [key, name] of [["b", "굵게"], ["i", "기울임"], ["u", "밑줄"]]) {
  test(`object ${key} shortcut applies to all selected text and supports undo`, async ({ page }) => {
    await seed(page);
    await item(page, "first").click();
    await item(page, "second").click({ modifiers: ["Shift"] });
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await item(page, "first").click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
    await item(page, "second").click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  });
}
