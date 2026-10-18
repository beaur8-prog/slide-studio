import { test, expect, type Page } from "@playwright/test";

async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { saveAutosave } = await import("/src/storage.ts");
    const deck = blankDeck();
    deck.slides[0].elements = [
      element("shape", {
        id: "shape-a",
        x: 100,
        y: 100,
        width: 200,
        height: 150,
        fill: "#d4613f",
      }),
      element("text", {
        id: "text-b",
        x: 450,
        y: 100,
        width: 400,
        height: 150,
        text: "한글 텍스트",
      }),
      element("shape", {
        id: "locked-c",
        x: 100,
        y: 400,
        width: 200,
        height: 100,
        locked: true,
      }),
    ];
    await saveAutosave(deck);
  });
  await page.reload();
  await expect(page.getByTestId("slide-element")).toHaveCount(3);
}
const item = (page: Page, id: string) =>
  page.locator(`[data-element-id="${id}"]`);
const menu = (page: Page) => page.getByRole("menu", { name: "개체 편집" });
const action = (page: Page, name: string) =>
  menu(page).getByRole("menuitem", { name, exact: true });

test("right click selects its target; copy, paste, delete and undo use the chosen objects", async ({
  page,
}) => {
  await open(page);
  await item(page, "text-b").click();
  await item(page, "shape-a").click({ button: "right" });
  await expect(item(page, "shape-a")).toHaveClass(/selected/);
  await expect(item(page, "text-b")).not.toHaveClass(/selected/);
  await expect(action(page, "텍스트 편집")).toHaveCount(0);
  await expect(action(page, "붙여넣기")).toBeDisabled();
  await action(page, "복사").click();
  await item(page, "shape-a").click({ button: "right" });
  await action(page, "붙여넣기").click();
  await expect(page.getByTestId("slide-element")).toHaveCount(4);
  await page.locator(".slide-element.selected").click({ button: "right" });
  await action(page, "삭제").click();
  await expect(page.getByTestId("slide-element")).toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("slide-element")).toHaveCount(4);
});

test("right click preserves a multi-selection and cut/paste do not affect unrelated objects", async ({
  page,
}) => {
  await open(page);
  await item(page, "shape-a").click();
  await item(page, "text-b").click({ modifiers: ["Shift"] });
  await item(page, "shape-a").click({ button: "right" });
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
  await action(page, "잘라내기").click();
  await expect(page.getByTestId("slide-element")).toHaveCount(1);
  await item(page, "locked-c").click({ button: "right" });
  await action(page, "붙여넣기").click();
  await expect(page.getByTestId("slide-element")).toHaveCount(3);
  await expect(page.locator(".slide-element.selected")).toHaveCount(2);
});

test("right click while editing text opens the object menu and preserves entered text and undo", async ({
  page,
}) => {
  await open(page);
  await item(page, "text-b").dblclick();
  const input = page.getByRole("textbox", { name: "슬라이드 텍스트 편집" });
  await input.fill("오른쪽 버튼으로 수정한 한글");
  await input.click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(input).toBeHidden();
  await expect(item(page, "text-b")).toContainText(
    "오른쪽 버튼으로 수정한 한글",
  );
  await action(page, "개체 서식").click();
  await expect(page.locator(".inspector")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item(page, "text-b")).toContainText("한글 텍스트");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(item(page, "text-b")).toContainText(
    "오른쪽 버튼으로 수정한 한글",
  );
  await item(page, "text-b").click({ button: "right" });
  await action(page, "텍스트 편집").click();
  await expect(input).toBeFocused();
  await input.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(item(page, "text-b")).toHaveClass(/selected/);
});

test("layer changes and lock protection support undo without deleting locked content", async ({
  page,
}) => {
  await open(page);
  await item(page, "shape-a").click({ button: "right" });
  await action(page, "맨 앞으로 가져오기").click();
  await expect(page.getByTestId("slide-element").last()).toHaveAttribute(
    "data-element-id",
    "shape-a",
  );
  await item(page, "shape-a").click({ button: "right" });
  await action(page, "맨 뒤로 보내기").click();
  await expect(page.getByTestId("slide-element").first()).toHaveAttribute(
    "data-element-id",
    "shape-a",
  );
  await item(page, "shape-a").click({ button: "right" });
  await action(page, "잠금").click();
  await item(page, "shape-a").click({ button: "right" });
  for (const name of ["잘라내기", "삭제", "앞으로 한 단계"])
    await expect(action(page, name)).toBeDisabled();
  await action(page, "잠금 해제").click();
  await expect(item(page, "shape-a")).not.toHaveClass(/locked/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(item(page, "shape-a")).toHaveClass(/locked/);
});

test("menu fits window edges, keyboard navigation and Escape preserve selection, outside click dismisses", async ({
  page,
}, info) => {
  await open(page);
  await item(page, "text-b").focus();
  await page.keyboard.press("Shift+F10");
  await expect(action(page, "잘라내기")).toBeFocused();
  await page.keyboard.press("End");
  await expect(action(page, "개체 서식")).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await expect(action(page, "복사")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await expect(item(page, "text-b")).toHaveClass(/selected/);
  await item(page, "shape-a").evaluate((host) =>
    host.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 1438,
        clientY: 898,
        button: 2,
      }),
    ),
  );
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThan(1000);
  expect(box.y).toBeGreaterThan(400);
  expect(box.x + box.width).toBeLessThanOrEqual(1432);
  expect(box.y + box.height).toBeLessThanOrEqual(892);
  await page.screenshot({ path: info.outputPath("object-context-menu.png") });
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).click();
  await expect(menu(page)).toBeHidden();
  await item(page, "text-b").click({ button: "right" });
  await page.setViewportSize({ width: 1080, height: 720 });
  await expect(menu(page)).toBeHidden();
});
