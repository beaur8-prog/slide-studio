import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";

const origin = "http://127.0.0.1:5190";
const fixture = path.resolve("qa/samples/poi-shapes.pptx");

test("native hyperlinks use the unvisited theme appearance independently of target policy", async ({
  page,
}) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { readTextBody } = await import("/src/pptx-text.ts");
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    const parse = (content: string) =>
      new DOMParser().parseFromString(
        `<a:txBody xmlns:a="${A}"><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr u="none"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:pPr>${content}</a:p></a:txBody>`,
        "application/xml",
      ).documentElement;
    const source = parse(
      [
        '<a:r><a:rPr><a:hlinkClick history="1" highlightClick="1"/></a:rPr><a:t>Default</a:t></a:r>',
        '<a:r><a:rPr u="none"><a:solidFill><a:srgbClr val="C00000"><a:alpha val="40000"/></a:srgbClr></a:solidFill><a:hlinkClick/></a:rPr><a:t>Explicit</a:t></a:r>',
        '<a:r><a:rPr u="dbl"><a:hlinkClick/></a:rPr><a:t>Underline</a:t></a:r>',
        "<a:r><a:rPr/><a:t>Plain</a:t></a:r>",
      ].join(""),
    );
    const before = new XMLSerializer().serializeToString(source);
    const context = {
      nodes: [],
      font: (s: string) => s,
      defaultFont: "Arial",
      defaultColor: "#000000",
      hyperlinkColor: "#123ABC",
      color: (n: Element | undefined) => {
        const rgb =
          n?.localName === "srgbClr"
            ? n
            : n?.getElementsByTagNameNS(A, "srgbClr")[0];
        if (!rgb) return;
        return {
          color: "#" + rgb.getAttribute("val"),
          opacity:
            Number(
              rgb.getElementsByTagNameNS(A, "alpha")[0]?.getAttribute("val") ??
                100000,
            ) / 100000,
        };
      },
      geometry: { x: 0, y: 0, width: 800, height: 100, rotation: 0 },
      sx: 1,
      sy: 1,
    };
    let calls = 0;
    const supported = readTextBody(source, {
      ...context,
      link: (n) => {
        if (!n) return;
        calls++;
        return { url: "https://example.com/unused" };
      },
    });
    const unsupported = readTextBody(source, {
      ...context,
      link: () => undefined,
    });
    const defaults = readTextBody(
      parse("<a:r><a:rPr><a:hlinkClick/></a:rPr><a:t>Fallback</a:t></a:r>"),
      { ...context, hyperlinkColor: undefined },
    );
    return {
      calls,
      supported: supported.paragraphs![0].runs.map(
        ({ text, color, opacity, underline, hyperlink }) => ({
          text,
          color,
          opacity,
          underline,
          hyperlink,
        }),
      ),
      unsupported: unsupported.paragraphs![0].runs.map(
        ({ color, underline, hyperlink }) => ({ color, underline, hyperlink }),
      ),
      fallback: defaults.paragraphs![0].runs[0].color,
      sourceUnchanged: before === new XMLSerializer().serializeToString(source),
    };
  });
  expect(result.calls).toBe(3);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.supported).toEqual([
    {
      text: "Default",
      color: "#123ABC",
      opacity: 1,
      underline: true,
      hyperlink: { url: "https://example.com/unused" },
    },
    {
      text: "Explicit",
      color: "#C00000",
      opacity: 0.4,
      underline: false,
      hyperlink: { url: "https://example.com/unused" },
    },
    {
      text: "Underline",
      color: "#123ABC",
      opacity: 1,
      underline: true,
      hyperlink: { url: "https://example.com/unused" },
    },
    { text: "Plain", color: "#000000", opacity: 1, underline: false },
  ]);
  expect(result.unsupported).toEqual([
    { color: "#123ABC", underline: true },
    { color: "#C00000", underline: false },
    { color: "#123ABC", underline: true },
    { color: "#000000", underline: false },
  ]);
  expect(result.fallback).toBe("#0563C1");
});

test("public POI table links restore blue underline while mailto remains unlinked and warned", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(fixture),
    "Download the pinned public POI shapes fixture.",
  );
  await page.goto(origin);
  const result = await page.evaluate(
    async (bytes) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { tableCellStyle } = await import("/src/table.ts");
      const first = await importPptx(new Uint8Array(bytes));
      let deck = first.deck;
      const rounds = [];
      for (let i = 0; i < 4; i++) {
        const table = deck.slides[4].elements.find(
          (e) => e.type === "table",
        )!.table!;
        rounds.push(
          [1, 2, 3].map((r) => {
            const style = tableCellStyle(table, r, 0);
            const run = style
              .paragraphs!.flatMap((p) => p.runs)
              .find((r) => r.text.trim())!;
            return {
              text: run.text,
              color: run.color ?? style.color,
              underline: run.underline ?? style.underline,
              url: run.hyperlink?.url,
              internal: run.hyperlink?.slideId === deck.slides[1].id,
            };
          }),
        );
        // Change actual table content before every save, exercising regenerated
        // native runs rather than only passthrough of unchanged source XML.
        if (i < 3) {
          table.cells[4][1] = `Edited unrelated cell ${i}`;
          deck = (await importPptx(await exportPptx(deck))).deck;
        }
      }
      return { warnings: first.warnings, rounds };
    },
    [...fs.readFileSync(fixture)],
  );
  expect(result.warnings).toContain(
    "지원하지 않는 주소의 하이퍼링크를 제외했습니다.",
  );
  for (const round of result.rounds) {
    expect(round).toEqual([
      {
        text: "Web Page",
        color: "#0000FF",
        underline: true,
        url: "http://poi.apache.org/",
        internal: false,
      },
      {
        text: "Place in this document",
        color: "#0000FF",
        underline: true,
        internal: true,
      },
      { text: "Email", color: "#0000FF", underline: true, internal: false },
    ]);
  }
});

test("native table link explicit formatting wins over theme defaults across saves", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(fixture),
    "Download the pinned public POI shapes fixture.",
  );
  const zip = await JSZip.loadAsync(fs.readFileSync(fixture));
  const part = "ppt/slides/slide5.xml";
  const source = await zip.file(part)!.async("string");
  zip.file(
    part,
    source.replace(
      /<a:rPr([^>]*)><a:hlinkClick r:id="rId2"\/><\/a:rPr>/,
      '<a:rPr$1 u="none"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:hlinkClick r:id="rId2"/></a:rPr>',
    ),
  );
  await page.goto(origin);
  const result = await page.evaluate(
    async (bytes) => {
      const { importPptx, exportPptx } = await import("/src/io.ts");
      const { tableCellStyle } = await import("/src/table.ts");
      let deck = (await importPptx(new Uint8Array(bytes))).deck;
      const rounds = [];
      for (let i = 0; i < 4; i++) {
        const table = deck.slides[4].elements.find(
          (e) => e.type === "table",
        )!.table!;
        const style = tableCellStyle(table, 1, 0);
        const run = style.paragraphs![0].runs[0];
        rounds.push({
          text: run.text,
          color: run.color ?? style.color,
          underline: run.underline ?? style.underline,
          url: run.hyperlink?.url,
        });
        if (i < 3) {
          table.cells[4][1] = `Changed ${i}`;
          deck = (await importPptx(await exportPptx(deck))).deck;
        }
      }
      return rounds;
    },
    [...(await zip.generateAsync({ type: "uint8array" }))],
  );
  expect(result).toEqual(
    Array.from({ length: 4 }, () => ({
      text: "Web Page",
      color: "#C00000",
      underline: false,
      url: "http://poi.apache.org/",
    })),
  );
});

test("table presentation retains supported targets and activates an internal link without external navigation", async ({
  page,
}) => {
  test.skip(
    !fs.existsSync(fixture),
    "Download the pinned public POI shapes fixture.",
  );
  await page.goto(origin);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page
    .locator('input[type="file"][accept*=".pptx"]')
    .setInputFiles(fixture);
  await expect(page.locator(".thumbnail-row")).toHaveCount(6);
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await page.locator(".thumbnail-row").nth(4).click();
  await page.keyboard.press("Shift+F5");
  const show = page.getByTestId("presentation-view");
  await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 5 / 6");
  const web = show.getByRole("link", { name: "Web Page", exact: true });
  await expect(web).toHaveAttribute("href", "http://poi.apache.org/");
  await expect(web).toHaveCSS("color", "rgb(0, 0, 255)");
  await expect(web).toHaveCSS("text-decoration-line", "underline");
  await expect(
    show.getByRole("link", { name: "Email", exact: true }),
  ).toHaveCount(0);
  await expect(
    show.getByRole("button", { name: "Email", exact: true }),
  ).toHaveCount(0);
  await show.screenshot({
    path: test.info().outputPath("public-poi-table-links.png"),
  });
  await show
    .getByRole("button", { name: "Place in this document", exact: true })
    .press("Enter");
  await expect(show).toHaveAttribute("aria-label", "발표 슬라이드 2 / 6");
  expect(page.context().pages()).toHaveLength(1);
});
