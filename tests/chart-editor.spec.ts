import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import PptxGenJS from "pptxgenjs";

async function open(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
  await page.getByRole("button", { name: "차트", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "차트 삽입", exact: true }),
  ).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(
    async () => (await (await import("/src/storage.ts")).loadAutosave())!,
  );
}
const chart = (page: Page) =>
  page.locator('.editable-slide [data-type="chart"]');
const edit = (page: Page) =>
  page.getByRole("dialog", { name: "차트 데이터 편집", exact: true });

test("native chart data, titles and embedded Excel values survive editing and repeated PPTX saves", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { createEditableChart, readEditableChart } = await import(
      "/src/chart-editing.ts"
    );
    const { exportPptx, importPptx, parseDeckJson } = await import(
      "/src/io.ts"
    );
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const data = [
      { label: '국내, 서울 "팀"', value: 123.5 },
      { label: "해외", value: 0 },
      { label: "신규", value: 71 },
    ];
    const elements = await Promise.all(
      (["column", "bar", "line", "pie"] as const).map((kind) =>
        createEditableChart(
          {
            kind,
            title: `한글 차트 ${kind}`,
            data,
            color: "#286cb5",
            textColor: "#243247",
            fontFamily: "Arial",
          },
          { width: 1280, height: 720 },
        ),
      ),
    );
    let deck = parseDeckJson(
      JSON.stringify({
        version: 1,
        id: "native-editor",
        name: "편집 가능한 차트",
        width: 1280,
        height: 720,
        theme: "studio",
        slides: elements.map((e, i) => ({
          id: `s${i}`,
          notes: "",
          background: "#FFFFFF",
          transition: "none",
          elements: [
            {
              ...e,
              name: `내 차트 ${i}`,
              x: 80,
              y: 90,
              rotation: 15,
              groups: ["g" + i],
              groupNames: ["한글 그룹"],
            },
          ],
        })),
      }),
    );
    let bytes: Uint8Array;
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      bytes = await exportPptx(deck);
      deck = (await importPptx(bytes)).deck;
      rounds.push(
        deck.slides.map((s) =>
          readEditableChart(s.elements.find((e) => e.type === "chart")!.chart),
        ),
      );
    }
    const zip = await JSZip.loadAsync(bytes!);
    const workbookPaths = Object.keys(zip.files).filter((p) =>
      p.endsWith(".xlsx"),
    );
    const workbooks = await Promise.all(
      workbookPaths.map(async (path) => {
        const workbook = await JSZip.loadAsync(
          await zip.file(path)!.async("uint8array"),
        );
        const xml = await workbook
          .file("xl/worksheets/sheet1.xml")!
          .async("string");
        const strings = await workbook
          .file("xl/sharedStrings.xml")
          ?.async("string");
        return { xml, strings };
      }),
    );
    return {
      rounds,
      workbooks,
      bytes: Array.from(bytes!),
      geometry: deck.slides.map((s) =>
        s.elements.find((e) => e.type === "chart"),
      ),
    };
  });
  for (const round of result.rounds) {
    expect(round.map((d) => d?.kind)).toEqual(["column", "bar", "line", "pie"]);
    for (const item of round) {
      expect(item?.data).toEqual([
        { label: '국내, 서울 "팀"', value: 123.5 },
        { label: "해외", value: 0 },
        { label: "신규", value: 71 },
      ]);
      expect(item?.title).toMatch(/^한글 차트 /);
      expect(item?.color.toLowerCase()).toBe("#286cb5");
    }
  }
  expect(result.workbooks).toHaveLength(4);
  for (const wb of result.workbooks) {
    expect(wb.xml).toContain("123.5");
    expect(wb.xml).toContain("71");
    expect(wb.strings).toContain("해외");
  }
  for (let i = 0; i < 4; i++)
    expect(result.geometry[i]).toMatchObject({
      name: `내 차트 ${i}`,
      x: 80,
      y: 90,
      rotation: 15,
      groupNames: ["한글 그룹"],
    });
  await fs.writeFile(
    info.outputPath("editable-charts.pptx"),
    Buffer.from(result.bytes),
  );
});

test("insert, edit, cancel, unchanged apply, undo and redo work on the selected native chart", async ({
  page,
}, info) => {
  await open(page);
  let dialog = page.getByRole("dialog", { name: "차트 삽입", exact: true });
  await dialog.getByLabel("차트 제목").fill("분기별 매출");
  await dialog
    .getByLabel("차트 데이터", { exact: true })
    .fill('항목,값\n"서울, 경기",12\n부산,-8');
  await dialog.getByRole("button", { name: "삽입", exact: true }).click();
  await expect(chart(page)).toHaveCount(1);
  expect(
    (await saved(page)).slides[0].elements.filter((e) => e.type === "chart"),
  ).toHaveLength(1);
  const original = (await saved(page)).slides[0].elements.find(
    (e) => e.type === "chart",
  )!;
  await chart(page).dblclick();
  dialog = edit(page);
  await expect(dialog.getByLabel("차트 데이터", { exact: true })).toContainText(
    '"서울, 경기",12',
  );
  await dialog.getByLabel("차트 데이터", { exact: true }).fill("A,99\nB,10");
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  expect(
    (await saved(page)).slides[0].elements.find((e) => e.id === original.id),
  ).toEqual(original);
  await chart(page).focus();
  await page.keyboard.press("Enter");
  await expect(edit(page)).toBeVisible();
  await edit(page).getByRole("button", { name: "적용", exact: true }).click();
  expect(
    (await saved(page)).slides[0].elements.find((e) => e.id === original.id),
  ).toEqual(original);
  // No-op did not create an undo step: the next undo removes the insertion.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(chart(page)).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(chart(page)).toHaveCount(1);
  await chart(page).click({ button: "right" });
  await page.getByRole("menuitem", { name: "차트 데이터 편집" }).click();
  await edit(page)
    .getByLabel("차트 데이터", { exact: true })
    .fill("수익,200\n비용,80");
  await edit(page).getByLabel("차트 제목").fill("수정한 실적");
  await edit(page)
    .getByRole("button", { name: "가로 막대", exact: true })
    .click();
  await edit(page).getByLabel("삽입 색상").fill("#167c55");
  await edit(page).getByRole("button", { name: "적용", exact: true }).click();
  await expect(chart(page)).toContainText("수정한 실적");
  const changed = (await saved(page)).slides[0].elements.find(
    (e) => e.id === original.id,
  )!;
  expect(changed).toMatchObject({
    id: original.id,
    x: original.x,
    y: original.y,
    width: original.width,
    height: original.height,
  });
  await page.keyboard.press("ControlOrMeta+z");
  expect(
    (await saved(page)).slides[0].elements.find((e) => e.id === original.id),
  ).toEqual(original);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(chart(page)).toContainText("수정한 실적");
  const bytes = await page.evaluate(async () =>
    Array.from(
      await (
        await import("/src/io.ts")
      ).exportPptx((await (await import("/src/storage.ts")).loadAutosave())!),
    ),
  );
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "chart-reopen.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(bytes),
  });
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await chart(page).dblclick();
  await expect(
    edit(page).getByLabel("차트 데이터", { exact: true }),
  ).toContainText('"수익",200');
  await expect(
    edit(page).getByRole("button", { name: "가로 막대", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    edit(page).getByRole("button", { name: "적용", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("chart-editing-reopened.png"),
  });
  await edit(page).getByRole("button", { name: "취소", exact: true }).click();
});

test("PowerPoint cache edits override old values and unsupported added series retain read-only preservation", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { createEditableChart, readEditableChart } = await import(
      "/src/chart-editing.ts"
    );
    const { chartPartText, chartXml, CHART_NS } = await import("/src/chart.ts");
    const element = await createEditableChart(
      {
        kind: "line",
        title: "기존 제목",
        color: "#224488",
        textColor: "#112233",
        fontFamily: "Arial",
        data: [{ label: "A", value: 12 }],
      },
      { width: 1280, height: 720 },
    );
    const chart = element.chart!,
      part = chart.parts.find((p) => p.path === chart.root)!;
    const doc = chartXml(chartPartText(part.data));
    doc
      .getElementsByTagNameNS(CHART_NS, "numCache")[0]
      .getElementsByTagNameNS(CHART_NS, "v")[0].textContent = "93";
    const save = () =>
      (part.data = btoa(
        String.fromCharCode(
          ...new TextEncoder().encode(
            new XMLSerializer().serializeToString(doc),
          ),
        ),
      ));
    save();
    const externalChange = readEditableChart(chart);
    const series = doc.getElementsByTagNameNS(CHART_NS, "ser")[0];
    series.parentNode!.appendChild(series.cloneNode(true));
    save();
    return { externalChange, withAddedSeries: readEditableChart(chart) };
  });
  expect(result.externalChange?.data[0].value).toBe(93);
  expect(result.withAddedSeries).toBeNull();
});

test("invalid input, Escape and focus trapping never apply a stale chart preview", async ({
  page,
}) => {
  await open(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "원형", exact: true }).click();
  await dialog.getByLabel("차트 데이터", { exact: true }).fill("A,-1\nB,2");
  await expect(dialog.getByRole("alert")).toContainText("음수 없이");
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("차트 데이터", { exact: true }).fill("A,0\nB,0");
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("차트 데이터", { exact: true }).fill("A,9");
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "삽입", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "대화상자 닫기" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeFocused();
  await dialog.getByLabel("차트 데이터", { exact: true }).fill("A,10");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(chart(page)).toHaveCount(0);
  await page.waitForTimeout(250);
  await expect(chart(page)).toHaveCount(0);
});

test("ordinary imported PowerPoint charts keep original data and cannot enter the rebuilding editor", async ({
  page,
}) => {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck
    .addSlide()
    .addChart(
      deck.ChartType.line,
      [{ name: "Original", labels: ["A", "B"], values: [3, 9] }],
      { x: 1, y: 1, w: 8, h: 5 },
    );
  const bytes = (await deck.write({
    outputType: "uint8array",
    compression: true,
  })) as Uint8Array;
  await page.goto("http://127.0.0.1:5190");
  await page.locator('input[accept*=".pptx"]').setInputFiles({
    name: "external.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from(bytes),
  });
  await expect(chart(page)).toHaveCount(1);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await chart(page).dblclick();
  await expect(edit(page)).toHaveCount(0);
  await chart(page).click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "차트 데이터 편집" }),
  ).toHaveCount(0);
});

test("a chart exceeding the remaining embedded-media budget is refused before insertion", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async () => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { default: ChartEditorDialog } = await import(
      "/src/ChartEditorDialog.tsx"
    );
    const host = document.createElement("div");
    document.body.append(host);
    createRoot(host).render(
      React.createElement(ChartEditorDialog, {
        deck: { width: 1280, height: 720, theme: "studio" },
        assetBudget: 1,
        onApply: () => {
          throw Error("An oversized chart must never be applied");
        },
        onCancel: () => {},
      }),
    );
  });
  const dialog = page.getByRole("dialog", { name: "차트 삽입", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("100MB");
  await expect(
    dialog.getByRole("button", { name: "삽입", exact: true }),
  ).toBeDisabled();
});
