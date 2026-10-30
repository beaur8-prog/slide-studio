import { test, expect, type Page } from "@playwright/test";
const token = "11111111-1111-4111-8111-111111111111";
async function ready(page: Page) {
  await page.addInitScript(() => {
    const state: any = { files: [], queue: [], cancel: false, menu: () => {} };
    (window as any).__saveContext = state;
    window.desktop = {
      platform: "darwin",
      onMenu: (callback) => {
        state.menu = callback;
        return () => {};
      },
      openFile: async () => {
        const f = state.queue.shift();
        return f ? { ...f, data: Uint8Array.from(f.data) } : null;
      },
      saveFile: async (payload) => {
        state.files.push({ ...payload, data: Array.from(payload.data) });
        return state.cancel
          ? null
          : {
              path: "/tmp/저장한 발표.pptx",
              token: `22222222-2222-4222-8222-${String(state.files.length).padStart(12, "0")}`,
            };
      },
      exportPDF: async () => null,
      print: async () => false,
    };
  });
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.evaluate(async (token) => {
    const { blankDeck, element } = await import("/src/model.ts"),
      { exportPptx } = await import("/src/io.ts");
    const d = blankDeck();
    d.name = "원본 발표";
    d.slides[0].elements = [
      element("shape", { shape: "rect", width: 260, height: 100 }),
    ];
    (window as any).__saveContext.queue.push({
      name: "원본 발표.pptx",
      data: Array.from(await exportPptx(d)),
      context: { token, path: "/tmp/원본 발표.pptx" },
    });
  }, token);
  await openQueued(page);
}
async function openQueued(page: Page) {
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .locator(".file-popover")
    .getByRole("button", { name: /^파일 열기/ })
    .click();
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
}
async function save(page: Page, action = "save") {
  const before = await page.evaluate(
    () => (window as any).__saveContext.files.length,
  );
  await page.evaluate(
    (action) => (window as any).__saveContext.menu(action),
    action,
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__saveContext.files.length))
    .toBe(before + 1);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  return page.evaluate(
    () => (window as any).__saveContext.files.at(-1).context,
  );
}

test("native Save commits a focused numeric draft before exporting the document", async ({
  page,
}) => {
  await ready(page);
  await page.locator('.editable-slide [data-type="shape"]').click();
  await page.getByRole("button", { name: "서식", exact: true }).click();
  const width = page.getByRole("spinbutton", { name: "너비", exact: true });
  await width.fill("200");
  await save(page);
  const stored = await page.evaluate(async () => {
    const { importPptx } = await import("/src/io.ts");
    return (
      await importPptx(
        Uint8Array.from((window as any).__saveContext.files.at(-1).data),
      )
    ).deck.slides[0].elements[0].width;
  });
  expect(stored).toBe(200);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(width).toHaveValue("260");
});

test("open context flows to normal Save, Save As is explicit, and a new document has no old overwrite token", async ({
  page,
}) => {
  await ready(page);
  expect(await save(page)).toEqual({ token, saveAs: false });
  const savedToken = await page.evaluate(
    () => (window as any).__saveContext.files.length,
  );
  expect(await save(page, "save-as")).toEqual({
    token: `22222222-2222-4222-8222-${String(savedToken).padStart(12, "0")}`,
    saveAs: true,
  });
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("button", { name: "새 프레젠테이션", exact: true })
    .click();
  await page.getByRole("button", { name: "만들기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "만들기", exact: true }),
  ).toHaveCount(0);
  expect(await save(page)).toEqual({ saveAs: false });
});

test("cancelled saves and failed imports keep the current file context", async ({
  page,
}) => {
  await ready(page);
  await page.evaluate(() => ((window as any).__saveContext.cancel = true));
  expect(await save(page, "save-as")).toEqual({ token, saveAs: true });
  await page.evaluate(() => {
    (window as any).__saveContext.cancel = false;
    (window as any).__saveContext.queue.push({
      name: "broken.pptx",
      data: [0, 1, 2],
      context: {
        token: "33333333-3333-4333-8333-333333333333",
        path: "/tmp/broken.pptx",
      },
    });
  });
  await openQueued(page);
  await expect(page.locator(".toast")).toContainText("파일 열기 실패");
  expect(await save(page)).toEqual({ token, saveAs: false });
});

for (const action of ["export-pdf", "print"]) {
  test(`native ${action} commits a numeric draft before capturing output`, async ({
    page,
  }) => {
    await ready(page);
    await page.evaluate(() => {
      const state = (window as any).__saveContext;
      state.outputs = [];
      const capture = async () => {
        state.outputs.push(
          (
            document.querySelector(
              '.editable-slide [data-type="shape"]',
            ) as HTMLElement
          ).style.width,
        );
        return null;
      };
      window.desktop!.exportPDF = capture;
      window.desktop!.print = async () => {
        await capture();
        return false;
      };
    });
    await page.locator('.editable-slide [data-type="shape"]').click();
    await page.getByRole("button", { name: "서식", exact: true }).click();
    await page
      .getByRole("spinbutton", { name: "너비", exact: true })
      .fill("200");
    await page.evaluate(
      (action) => (window as any).__saveContext.menu(action),
      action,
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__saveContext.outputs))
      .toEqual(["200px"]);
    await page.getByRole("button", { name: "실행 취소", exact: true }).click();
    await expect(
      page.getByRole("spinbutton", { name: "너비", exact: true }),
    ).toHaveValue("260");
  });
}
