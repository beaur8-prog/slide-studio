import { expect, test, type Page } from "@playwright/test";
import type { InsertContentKind } from "../src/insert-content";

async function mountDialog(page: Page, kind: InsertContentKind) {
  await page.goto("http://127.0.0.1:5190");
  await page.evaluate(async (kind) => {
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const {
      default: { createRoot },
    } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { InsertContentDialog } = await import(
      "/src/InsertContentDialog.tsx"
    );
    const host = document.createElement("div");
    host.className = "office-shell";
    document.body.append(host);
    const root = createRoot(host);
    (window as any).__inserted = undefined;
    root.render(
      React.createElement(InsertContentDialog, {
        kind,
        deck: { width: 1280, height: 720, theme: "studio" },
        onInsert: (elements: unknown) => {
          (window as any).__inserted = elements;
          root.unmount();
          host.remove();
        },
        onCancel: () => {
          root.unmount();
          host.remove();
        },
      }),
    );
  }, kind);
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("chart data accepts CSV, TSV and values while refusing silent data loss", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { parseChartData, createChart } = await import(
      "/src/insert-content.ts"
    );
    const invalid = [
      "A,1,2",
      "A,Infinity",
      "A,",
      '"A,3',
      "A,1e10",
      Array.from({ length: 13 }, (_, i) => `${i}`).join("\n"),
    ];
    return {
      csv: parseChartData('항목,값\n"서울, 경기",12.5\n"A ""인용""",-3'),
      tsv: parseChartData("이름\tvalue\n영업\t0\n지원\t-2"),
      values: parseChartData("12\n-2.5\n1e2"),
      whitespace: parseChartData("서울 지역 25\n부산 13"),
      invalid: invalid.map((value) => {
        try {
          parseChartData(value);
          return false;
        } catch {
          return true;
        }
      }),
      badPie: ["A,-1\nB,2", "A,0"].map((value) => {
        try {
          createChart("pie", parseChartData(value), "", {
            width: 1280,
            height: 720,
            color: "#0077AA",
          });
          return false;
        } catch {
          return true;
        }
      }),
    };
  });
  expect(result.csv).toEqual([
    { label: "서울, 경기", value: 12.5 },
    { label: 'A "인용"', value: -3 },
  ]);
  expect(result.tsv).toEqual([
    { label: "영업", value: 0 },
    { label: "지원", value: -2 },
  ]);
  expect(result.values.map((d) => d.value)).toEqual([12, -2.5, 100]);
  expect(result.whitespace[0]).toEqual({ label: "서울 지역", value: 25 });
  expect(result.invalid.every(Boolean)).toBe(true);
  expect(result.badPie).toEqual([true, true]);
});

test("all insertion families remain editable through slide and PPTX round trips", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const lib = await import("/src/insert-content.ts");
    const { parseDeckJson, serializeDeck, exportPptx, importPptx } =
      await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const canvas = {
      width: 1280,
      height: 720,
      color: "#286CB5",
      textColor: "#243247",
    };
    const families = [
      ...(["column", "bar", "line", "pie"] as const).map((kind) =>
        lib.createChart(
          kind,
          lib.parseChartData("A,12\nB,25\nC,8"),
          kind,
          canvas,
        ),
      ),
      ...(["process", "cycle", "organization", "pyramid"] as const).map(
        (kind) => lib.createDiagram(kind, ["계획", "실행", "검증"], canvas),
      ),
      ...lib.INSERT_ICONS.map((icon) => lib.createIcon(icon.id, canvas)),
      ...(["bold", "italic", "underline", "badge"] as const).map((style) =>
        lib.createWordArt("편집할 제목", style, canvas),
      ),
      lib.createEquation("E = mc²", canvas),
      lib.createEquation("", canvas, { numerator: "a + b", denominator: "c" }),
      lib.createSymbol("αβγ", canvas),
    ];
    const deck = {
      version: 1 as const,
      id: "insert-roundtrip",
      name: "삽입 왕복 검증",
      width: 1280,
      height: 720,
      theme: "studio",
      slides: families.map((elements, i) => ({
        id: `insert-${i}`,
        background: "#FFFFFF",
        notes: "",
        transition: "none" as const,
        elements,
      })),
    };
    const parsed = parseDeckJson(serializeDeck(deck));
    const data = await exportPptx(parsed),
      zip = await JSZip.loadAsync(data);
    const slideXml = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async("string")),
    );
    const imported = await importPptx(data);
    return {
      count: families.length,
      parsedCount: parsed.slides.length,
      importedCount: imported.deck.slides.length,
      allEditable: imported.deck.slides.every((slide) =>
        slide.elements.every((el) => el.type !== "image"),
      ),
      expectedPaths: families.flat().filter((e) => e.shape === "custom").length,
      exportedPaths: slideXml.reduce(
        (total, xml) => total + (xml.match(/<a:custGeom>/g) ?? []).length,
        0,
      ),
      importedPaths: imported.deck.slides
        .flatMap((s) => s.elements)
        .filter((e) => e.shape === "custom").length,
      missing: families
        .map((elements, i) => ({
          index: i,
          expected: elements.length,
          actual: imported.deck.slides[i]?.elements.length,
        }))
        .filter((item) => item.expected !== item.actual),
      warnings: imported.warnings,
      finite: families
        .flat()
        .every(
          (e) =>
            [e.x, e.y, e.width, e.height].every(Number.isFinite) &&
            e.width > 0 &&
            e.height > 0,
        ),
    };
  });
  expect(result.parsedCount).toBe(result.count);
  expect(result.importedCount).toBe(result.count);
  expect(result.finite).toBe(true);
  expect(result.allEditable).toBe(true);
  expect(result.exportedPaths).toBe(result.expectedPaths);
  expect(result.importedPaths).toBe(result.expectedPaths);
  expect(result.missing).toEqual([]);
  expect(result.warnings).toEqual([]);
});

test("chart preview validates data, applies color and inserts a native editable chart", async ({
  page,
}, testInfo) => {
  await mountDialog(page, "chart");
  await expect(page.getByRole("dialog")).toContainText("숫자를 바꾸면 차트가 갱신됩니다");
  await expect(page.getByRole("dialog")).toContainText(
    "외부 Excel 파일과 실시간 연동되지는 않습니다",
  );
  const preview = page.getByTestId("insert-content-preview");
  await expect(preview.locator(".slide-element").first()).toBeVisible();
  await page
    .getByLabel("차트 데이터", { exact: true })
    .fill("수익,20\n비용,-8");
  await page.getByRole("button", { name: "가로 막대", exact: true }).click();
  await page.getByLabel("삽입 색상", { exact: true }).fill("#286cb5");
  await expect(preview).toContainText("수익");
  await expect(preview).toContainText("-8");
  await page.getByRole("button", { name: "원형", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("음수 없이");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "삽입", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("차트 데이터", { exact: true })
    .fill('"국내, 서울",20\n해외,30');
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(preview.locator("[data-chart-slice]")).toHaveCount(2);
  await page
    .getByRole("dialog")
    .screenshot({ path: testInfo.outputPath("chart-dialog.png") });
  const count = await preview.locator(".slide-element").count();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "삽입", exact: true })
    .click();
  const inserted = await page.evaluate(() => (window as any).__inserted);
  expect(inserted).toHaveLength(count);
  expect(
    inserted.some((e: any) => e.type === "chart" && e.chart?.parts.length > 1),
  ).toBe(true);
});

test("diagram, icon, WordArt, formula and symbol dialogs preview actual content", async ({
  page,
}) => {
  for (const kind of [
    "diagram",
    "icons",
    "wordart",
    "equation",
    "symbol",
  ] as const) {
    await mountDialog(page, kind);
    const preview = page.getByTestId("insert-content-preview");
    if (kind === "diagram") {
      await page.getByRole("button", { name: "조직도", exact: true }).click();
      await page
        .getByLabel("단계 이름", { exact: true })
        .fill("총괄\n디자인\n개발");
      await expect(preview).toContainText("총괄");
    } else if (kind === "icons") {
      await page.getByRole("button", { name: "시간", exact: true }).click();
      await expect(preview.locator("svg path")).toHaveCount(1);
    } else if (kind === "wordart") {
      await page
        .getByLabel("WordArt 문구", { exact: true })
        .fill("우리의 미래");
      await page
        .getByRole("button", { name: "가나다 컬러 박스", exact: true })
        .click();
      await expect(preview).toContainText("우리의 미래");
    } else if (kind === "equation") {
      await page.getByRole("button", { name: "분수", exact: true }).click();
      await page.getByLabel("분자", { exact: true }).fill("x + 1");
      await page.getByLabel("분모", { exact: true }).fill("2");
      await expect(preview).toContainText("x + 1");
      await expect(preview.locator(".slide-element")).toHaveCount(3);
    } else {
      await page.getByRole("button", { name: "∞", exact: true }).click();
      await expect(preview).toContainText("∞");
    }
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "삽입", exact: true })
      .click();
    expect(
      await page.evaluate(() => (window as any).__inserted.length),
    ).toBeGreaterThan(0);
  }
});

test("insert dialog keeps keyboard focus inside and cancels without inserting", async ({
  page,
}) => {
  await mountDialog(page, "symbol");
  const dialog = page.getByRole("dialog");
  const close = dialog.getByRole("button", { name: "대화상자 닫기" });
  const insert = dialog.getByRole("button", { name: "삽입", exact: true });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(insert).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page
    .getByLabel("삽입할 기호", { exact: true })
    .dispatchEvent("keydown", { key: "Escape", isComposing: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__inserted)).toBeUndefined();
});
