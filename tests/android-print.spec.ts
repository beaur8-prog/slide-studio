import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs/promises";

test.use({ userAgent: "Mozilla/5.0 (Linux; Android 16; Tablet) AppleWebKit/537.36 Chrome/133.0.0.0 Safari/537.36", viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: true });

async function open(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.printCalls = [];
    state.slideStudioAndroid = { printDocument: (document: any) => {
      state.printCalls.push({ ...document, html: new TextDecoder().decode(document.data) });
      return new Promise((resolve, reject) => { state.finishPrint = resolve; state.failPrint = reject; });
    } };
    window.print = () => { throw new Error("Browser printing must not replace the APK print service"); };
  });
  await page.goto("http://127.0.0.1:5190");
  const json = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const deck = blankDeck();
    deck.name = "한글 인쇄 <검증>";
    const table = createTable(2, 2);
    table.cells = [["한글 표", "값"], ["인쇄 확인", "200"]];
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 40;
    canvas.getContext("2d")!.fillStyle = "#00AA55"; canvas.getContext("2d")!.fillRect(0, 0, 40, 40);
    deck.slides = [0, 1].map(index => ({ ...newSlide("blank"), background: index ? "#E6F2FF" : "#FFF7DD", elements: [
      element("text", { text: `한글 인쇄 검증 ${index + 1}`, x: 80, y: 60, width: 1000, height: 110, fontSize: 54 }),
      element("shape", { shape: "ellipse", fill: "#F04444", x: 1050, y: 50, width: 120, height: 120 }),
      element("image", { src: canvas.toDataURL(), x: 1000, y: 400, width: 160, height: 160 }),
      { ...createTableElement(table), x: 80, y: 230, width: 800, height: 280 },
    ] }));
    return JSON.stringify(deck);
  });
  await fs.writeFile("qa/results/android-print-20261108/fixture.slide", json);
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: "print.slide", mimeType: "application/json", buffer: Buffer.from(json) });
  await expect(page.getByTestId("android-slide-viewport")).toBeVisible();
}
async function readerPrint(page: Page) {
  await page.getByRole("button", { name: "문서 메뉴", exact: true }).click();
  await page.getByRole("button", { name: "인쇄·PDF 저장", exact: true }).click();
}

test("reader prints only artwork, blocks duplicates and recovers after cancel", async ({ page }) => {
  await open(page);
  await readerPrint(page);
  await expect.poll(() => page.evaluate(() => (window as any).printCalls.length)).toBe(1);
  await expect(page.locator(".busy-backdrop")).toContainText("시스템 인쇄 창");
  await page.keyboard.press("Control+p");
  expect(await page.evaluate(() => (window as any).printCalls.length)).toBe(1);
  const snapshot = await page.evaluate(() => {
    const call = (window as any).printCalls[0]; const doc = new DOMParser().parseFromString(call.html, "text/html");
    return { pages: call.pages, width: call.pageWidthMils, height: call.pageHeightMils,
      sheets: doc.querySelectorAll(".android-print-sheet").length, text: doc.body.textContent,
      images: doc.querySelectorAll("img").length, svg: doc.querySelectorAll("svg").length,
      chrome: !!doc.querySelector(".android-app,.topbar,.statusbar,.presentation-view,.toast"), title: doc.title };
  });
  expect(snapshot).toMatchObject({ pages: 2, sheets: 2, width: 13333, height: 7500, images: 2, chrome: false, title: "한글 인쇄 <검증>" });
  expect(snapshot.text).toContain("한글 인쇄 검증 2"); expect(snapshot.text).toContain("한글 표"); expect(snapshot.svg).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).finishPrint("cancelled"));
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(page.locator(".print-slide")).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("slide-studio-file-dirty"))).toBe("false");
  await readerPrint(page);
  await expect.poll(() => page.evaluate(() => (window as any).printCalls.length)).toBe(2);
  await page.evaluate(() => (window as any).finishPrint("submitted"));
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("인쇄 작업을 보냈습니다.");
});

test("phone editor exposes print and retains edits after native failure and retry", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await open(page);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(page.locator(".android-editor-phone")).toBeVisible();
  await page.getByRole("button", { name: "선택", exact: true }).click();
  await page.locator(".android-edit-panel").getByRole("button", { name: "한글 인쇄 검증 1", exact: true }).click();
  await page.getByRole("button", { name: "글자", exact: true }).click();
  await page.getByRole("button", { name: "선택한 텍스트 편집", exact: true }).click();
  await page.locator(".editing-text").fill("수정한 한글 인쇄");
  await page.getByRole("tab", { name: "보기", exact: true }).click();
  await page.getByRole("button", { name: "인쇄·PDF 저장", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).printCalls.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).printCalls[0].html)).toContain("수정한 한글 인쇄");
  await page.evaluate(() => (window as any).failPrint(new Error("QA: printer unavailable")));
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(page.locator(".print-slide")).toHaveCount(0);
  await expect(page.locator(".toast")).toContainText("인쇄 실패");
  await page.getByRole("button", { name: "인쇄·PDF 저장", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).printCalls.length)).toBe(2);
  await page.evaluate(() => (window as any).finishPrint("closed"));
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await expect(page.locator(".editable-slide")).toContainText("수정한 한글 인쇄");
});

test("blob artwork travels inside the print snapshot rather than an editor-only URL", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { androidPrintDocument } = await import("/src/android-print.ts");
    const node = document.createElement("div"); node.className = "print-slide";
    const blob = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="5"/></svg>'], { type: "image/svg+xml" }));
    node.innerHTML = `<img src="${blob}"><div style="background-image:url('${blob}')"></div>`;
    document.querySelector(".print-deck")!.append(node);
    try { const snapshot = await androidPrintDocument("blob", 720, 1280); return { html: new TextDecoder().decode(snapshot.data), width: snapshot.pageWidthMils, height: snapshot.pageHeightMils }; }
    finally { node.remove(); URL.revokeObjectURL(blob); }
  });
  expect(result.html).not.toContain("blob:"); expect(result.html).toContain("data:image/svg+xml;base64,");
  expect(result).toMatchObject({ width: 7500, height: 13333 });
});
