import { expect, test } from "@playwright/test";

test("all save commands create PPTX, legacy documents remain readable and repeated saves share one operation", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = {
      files: [] as any[],
      release: (_result: string | null) => {},
      menu: (_action: string) => {},
    };
    (window as any).__saving = state;
    window.desktop = {
      platform: "win32",
      setChromeTheme: async () => {},
      openFile: async () => null,
      exportPDF: async () => null,
      print: async () => false,
      saveFile: (payload) => {
        state.files.push({ ...payload, data: Array.from(payload.data) });
        return new Promise((resolve) => {
          state.release = resolve;
        });
      },
      onMenu: (callback) => {
        state.menu = callback;
        return () => {};
      },
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const legacy = await page.evaluate(async () => {
    const { blankDeck, element } = await import("/src/model.ts");
    const { serializeDeck } = await import("/src/io.ts");
    const deck = blankDeck();
    deck.name = "한글 저장";
    deck.slides[0].notes = "발표자 노트도 보존합니다.";
    deck.slides[0].elements = [
      element("text", { text: "이전 문서의 한글 내용", x: 100, y: 80 }),
    ];
    return serializeDeck(deck);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "이전.slide",
    mimeType: "application/json",
    buffer: Buffer.from(legacy),
  });
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름" }),
  ).toHaveValue("한글 저장");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "파일", exact: true }).click();
  expect(await page.locator(".file-popover").innerText()).not.toContain(
    "프로젝트 저장",
  );
  expect(await page.locator(".file-popover").innerText()).not.toContain(
    ".slide",
  );
  await page
    .locator(".file-popover")
    .getByRole("button", { name: /^PPTX 저장/ })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__saving.files.length))
    .toBe(1);
  await page.evaluate(() => {
    (window as any).__saving.menu("save");
    (window as any).__saving.menu("save");
  });
  expect(await page.evaluate(() => (window as any).__saving.files.length)).toBe(
    1,
  );
  await page.evaluate(() => (window as any).__saving.release(null));
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  for (const [index, command] of [
    "quick",
    "button",
    "native",
    "search",
  ].entries()) {
    if (command === "quick")
      await page
        .getByRole("button", { name: "빠른 저장", exact: true })
        .click();
    if (command === "button")
      await page
        .getByRole("button", { name: "PPTX 저장", exact: true })
        .click();
    if (command === "native")
      await page.evaluate(() => (window as any).__saving.menu("save"));
    if (command === "search") {
      await page
        .getByRole("button", { name: "명령 및 슬라이드 검색", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "명령 검색어" })
        .fill("PPTX 저장");
      await page.keyboard.press("Enter");
    }
    await expect
      .poll(() => page.evaluate(() => (window as any).__saving.files.length))
      .toBe(index + 2);
    await page.evaluate(() =>
      (window as any).__saving.release("한글 저장.pptx"),
    );
    await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  }
  const result = await page.evaluate(async () => {
    const files = (window as any).__saving.files;
    const { importPptx } = await import("/src/io.ts");
    const deck = (await importPptx(Uint8Array.from(files.at(-1).data))).deck;
    return {
      formats: files.map((file: any) => ({
        name: file.name,
        extensions: file.extensions,
        signature: file.data.slice(0, 2),
      })),
      text: deck.slides[0].elements[0].text,
      notes: deck.slides[0].notes,
    };
  });
  for (const format of result.formats)
    expect(format).toEqual({
      name: "한글 저장.pptx",
      extensions: ["pptx"],
      signature: [80, 75],
    });
  expect(result.text).toBe("이전 문서의 한글 내용");
  expect(result.notes).toBe("발표자 노트도 보존합니다.");
});
