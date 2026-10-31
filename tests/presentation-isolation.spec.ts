import openSample from "../scripts/qa-open-sample.cjs";
import { expect, test, type Page } from "@playwright/test";

async function openDesktopEditor(page: Page) {
  await page.addInitScript(() => {
    const state = {
      openCalls: 0,
      saveCalls: 0,
      exportCalls: 0,
      printCalls: 0,
      modes: [] as boolean[],
      menu: (_action: string) => {},
      resolveOpen: (_file: { name: string; data: Uint8Array }) => {},
    };
    (window as any).__desktopTest = state;
    window.desktop = {
      openFile: () => {
        state.openCalls++;
        return new Promise((resolve) => {
          state.resolveOpen = resolve;
        });
      },
      saveFile: async () => {
        state.saveCalls++;
        return null;
      },
      exportPDF: async () => {
        state.exportCalls++;
        return null;
      },
      print: async () => {
        state.printCalls++;
        return false;
      },
      setPresentationMode: async (enabled) => {
        state.modes.push(enabled);
      },
      onMenu: (callback) => {
        state.menu = callback;
        return () => {};
      },
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await openSample(page);
}

test("native editor commands are ignored during a show and Ctrl+Enter advances it", async ({
  page,
}) => {
  await openDesktopEditor(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("ArrowRight");
  await page.evaluate(() => {
    for (const action of [
      "new",
      "open",
      "save",
      "export-pptx",
      "export-pdf",
      "print",
    ])
      (window as any).__desktopTest.menu(action);
  });
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    /^발표 슬라이드 2 \//,
  );
  const calls = await page.evaluate(() => {
    const { openCalls, saveCalls, exportCalls, printCalls, modes } = (
      window as any
    ).__desktopTest;
    return { openCalls, saveCalls, exportCalls, printCalls, modes };
  });
  expect(calls).toEqual({
    openCalls: 0,
    saveCalls: 0,
    exportCalls: 0,
    printCalls: 0,
    modes: [true],
  });
  await page.evaluate(() => (window as any).__desktopTest.menu("present"));
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    /^발표 슬라이드 3 \//,
  );
  expect(
    await page.evaluate(() => (window as any).__desktopTest.modes),
  ).toEqual([true]);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);
  await page.evaluate(() => (window as any).__desktopTest.menu("save"));
  await expect
    .poll(() => page.evaluate(() => (window as any).__desktopTest.saveCalls))
    .toBe(1);
});

test("a pending native file chooser prevents a show from starting before replacing the deck", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openDesktopEditor(page);
  await page.evaluate(() => (window as any).__desktopTest.menu("open"));
  await page.keyboard.press("F5");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".busy-backdrop")).toContainText("파일 열기 선택창을 기다리고 있습니다");
  await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { serializeDeck } = await import("/src/io.ts");
    const deck = blankDeck();
    deck.name = "Replacement deck";
    (window as any).__desktopTest.resolveOpen({
      name: "one-slide.slide",
      data: new TextEncoder().encode(serializeDeck(deck)),
    });
  });
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(page.locator(".thumbnail-button")).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름" }),
  ).toHaveValue("Replacement deck");
  await expect(page.locator(".thumbnail-button")).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(
    await page.evaluate(() => (window as any).__desktopTest.modes),
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("a native show takes keyboard focus and prevents editing or image paste behind it", async ({
  page,
}) => {
  await openDesktopEditor(page);
  const notes = page.getByRole("textbox", { name: "발표자 노트", exact: true });
  await notes.fill("Original notes");
  const count = await page.getByTestId("slide-element").count();
  await page.evaluate(() => (window as any).__desktopTest.menu("present"));
  await expect(page.getByTestId("presentation-view")).toBeFocused();
  await page.keyboard.type("xyz");
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest(".app-shell")),
  ).toBe(false);
  const prevented = await page.evaluate(() => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(["image"], "clipboard.png", { type: "image/png" }),
    );
    const event = new ClipboardEvent("paste", {
      clipboardData,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("presentation-view")).toBeHidden();
  await expect(notes).toHaveValue("Original notes");
  await expect(page.getByTestId("slide-element")).toHaveCount(count);
});

test("browser Ctrl+P is suppressed during a show and works again in the editor", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__printCalls = 0;
    window.print = () => {
      (window as any).__printCalls++;
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await openSample(page);
  await page.keyboard.press("F5");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Control+p");
  await expect(page.getByTestId("presentation-view")).toHaveAttribute(
    "aria-label",
    /^발표 슬라이드 2 \//,
  );
  expect(await page.evaluate(() => (window as any).__printCalls)).toBe(0);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+p");
  await expect
    .poll(() => page.evaluate(() => (window as any).__printCalls))
    .toBe(1);
});
