import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("a seven-slide mixed document survives editing, real PPTX downloads and repeated reopening without private metadata", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  const bytes = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { createTable, createTableElement } = await import("/src/table.ts");
    const { exportPptx } = await import("/src/io.ts");
    const d = blankDeck();
    d.name = "분기 업무 보고 검수";
    d.slides = [newSlide("title"), ...Array.from({ length: 6 }, () => newSlide())];
    d.slides[0].elements[0].text = "분기 업무 보고";
    d.slides[0].notes = "첫 발표자 메모\n\n빈 줄이 있는 한글 메모";
    d.slides[1].elements = [element("text", {
      text: "• 고객 반응\n• 품질 개선\n• 다음 계획", x: 100, y: 120, width: 900, height: 350,
      paragraphs: ["고객 반응", "품질 개선", "다음 계획"].map((text, i) => ({
        bulletPrefix: "• ", indent: -30, marginLeft: 30,
        runs: [{ text: "• " + text, bold: i === 0, italic: i === 1, color: i === 2 ? "#1177AA" : "#233D35" }],
      })),
    })];
    d.slides[2].elements = [
      element("shape", { shape: "ellipse", groups: ["outer", "inner"], x: 100, y: 130, width: 220, height: 220, fill: "#4472C4", stroke: "#111111", strokeWidth: 3, text: "시작", fontSize: 30 }),
      element("shape", { shape: "triangle", groups: ["outer", "inner"], x: 430, y: 130, width: 220, height: 220, fill: "transparent", stroke: "#111111", strokeWidth: 3, rotation: -15 }),
      element("text", { text: "묶음 도형", groups: ["outer"], x: 100, y: 400, width: 550, height: 100 }),
    ];
    const table = createTable(3, 3);
    table.cells = [["지표", "이전", "현재"], ["완료 건수", "10", "20"], ["메모\n두 번째 줄", "", "한글"]];
    table.cellStyles = [[null, null, null], [null, null, { italic: true, color: "#AA2233" }], [null, null, null]];
    d.slides[3].elements = [{ ...createTableElement(table), x: 90, y: 100, width: 1050, height: 400 }];
    const canvas = document.createElement("canvas"); canvas.width = 200; canvas.height = 120;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#4472C4"; ctx.fillRect(0, 0, 100, 120); ctx.fillStyle = "#D4613F"; ctx.fillRect(100, 0, 100, 120);
    d.slides[4].elements = [element("image", { x: 180, y: 120, width: 800, height: 480, src: canvas.toDataURL(), crop: [0.1, 0.2, 0.1, 0.1], alt: "파란색과 주황색 이미지" })];
    d.slides[5].transition = "fade";
    d.slides[5].backgroundGradient = { kind: "linear", angle: 30, stops: [{ offset: 0, color: "#224466" }, { offset: 1, color: "#FFFFFF" }] };
    d.slides[5].elements = [element("text", { text: "자료 보기", hyperlink: { url: "https://example.com/report?year=2026&quarter=4" } }), element("shape", { x: 700, shape: "rect", hyperlink: { slideId: d.slides[0].id } })];
    d.slides[6].hidden = true;
    d.slides[6].notes = "숨긴 부록 발표자 메모";
    d.slides[6].elements = [element("text", { text: "부록: 전체 수치", x: 90, y: 100, width: 1000, height: 100 })];
    return Array.from(await exportPptx(d));
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: "분기 업무 보고.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: Buffer.from(bytes) });
  await expect(page.locator(".thumbnail-row")).toHaveCount(7);
  const title = page.locator('.editable-slide [data-type="text"]').filter({ hasText: "분기 업무 보고" });
  await title.dblclick();
  const editor = page.getByRole("textbox", { name: "슬라이드 텍스트 편집", exact: true });
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("최종 분기 보고 — Alpha Beta");
  await editor.press("Escape");
  await page.getByRole("textbox", { name: "발표자 노트", exact: true }).fill("수정한 발표자 노트\n\n둘째 단락을 보존합니다.");
  await page.getByTestId("slide-canvas").click({ position: { x: 10, y: 10 } });
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByTestId("slide-canvas").screenshot({ path: info.outputPath("before-save.png") });
  const files: string[] = [];
  for (let round = 0; round < 3; round++) {
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "PPTX 저장", exact: true }).click();
    const download = await downloading;
    const path = info.outputPath(`mixed-round-${round + 1}.pptx`);
    await download.saveAs(path);
    files.push(path);
    await page.locator('input[accept*=".pptx"]').setInputFiles(path);
    await expect(page.locator(".thumbnail-row")).toHaveCount(7);
    await expect(page.locator('.editable-slide [data-type="text"]').first()).toContainText("최종 분기 보고 — Alpha Beta");
    await expect(page.getByRole("textbox", { name: "발표자 노트", exact: true })).toHaveValue("수정한 발표자 노트\n\n둘째 단락을 보존합니다.");
  }
  const result = await page.evaluate(async (bytes) => {
    const { importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const zip = await JSZip.loadAsync(Uint8Array.from(bytes));
    const xmls: string[] = [];
    for (const path of Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))) {
      const xml = await zip.file(path)!.async("string"); xmls.push(xml);
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      for (const ext of Array.from(doc.getElementsByTagNameNS("*", "ext")))
        if (Array.from(ext.children).some((n) => n.namespaceURI?.startsWith("urn:slide-studio:"))) ext.remove();
      zip.file(path, new XMLSerializer().serializeToString(doc));
    }
    const imported = await importPptx(await zip.generateAsync({ type: "uint8array" }));
    const d = imported.deck;
    return {
      count: d.slides.length, title: d.slides[0].elements[0].text, notes: d.slides.map((s) => s.notes),
      bullets: d.slides[1].elements[0].paragraphs?.map((p) => ({ prefix: p.bulletPrefix, text: p.runs.map((r) => r.text).join(""), italic: p.runs.some((r) => r.italic) })),
      groups: d.slides[2].elements.map((e) => e.groups?.length),
      table: d.slides[3].elements[0].table,
      image: d.slides[4].elements[0],
      transition: d.slides[5].transition, gradient: d.slides[5].backgroundGradient,
      url: d.slides[5].elements[0].hyperlink?.url,
      internalLink: d.slides[5].elements[1].hyperlink?.slideId === d.slides[0].id,
      hidden: d.slides[6].hidden, warnings: imported.warnings,
      nativeCounts: { table: xmls.filter((x) => x.includes("<a:tbl>")).length, groups: xmls.filter((x) => x.includes("<p:grpSp>")).length, bullets: xmls.filter((x) => x.includes("<a:buChar")).length },
    };
  }, Array.from(await fs.readFile(files.at(-1)!)));
  expect(result.count).toBe(7);
  expect(result.title).toBe("최종 분기 보고 — Alpha Beta");
  expect(result.notes[0]).toBe("수정한 발표자 노트\n\n둘째 단락을 보존합니다.");
  expect(result.notes[6]).toBe("숨긴 부록 발표자 메모");
  expect(result.bullets?.map((p) => p.text)).toEqual(["• 고객 반응", "• 품질 개선", "• 다음 계획"]);
  expect(result.bullets?.every((p) => p.prefix === "• ")).toBe(true);
  expect(result.bullets?.[1].italic).toBe(true);
  expect(result.groups).toEqual([2, 2, 1]);
  expect(result.table?.cells).toEqual([["지표", "이전", "현재"], ["완료 건수", "10", "20"], ["메모\n두 번째 줄", "", "한글"]]);
  expect(result.table?.cellStyles?.[1][2]?.italic).toBe(true);
  expect(result.image).toMatchObject({ type: "image", crop: [0.1, 0.2, 0.1, 0.1], alt: "파란색과 주황색 이미지" });
  expect(result.transition).toBe("fade");
  expect(result.gradient).toMatchObject({ kind: "linear", angle: 30 });
  expect(result.url).toBe("https://example.com/report?year=2026&quarter=4");
  expect(result.internalLink).toBe(true);
  expect(result.hidden).toBe(true);
  expect(result.warnings).toEqual([]);
  expect(result.nativeCounts).toEqual({ table: 1, groups: 1, bullets: 1 });
  await page.getByTestId("slide-canvas").screenshot({ path: info.outputPath("after-reopen.png") });
  await fs.writeFile(info.outputPath("roundtrip-result.json"), JSON.stringify(result, null, 2));
});
