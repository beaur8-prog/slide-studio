import { expect, test } from "@playwright/test";

test("a single transfer line ending preserves a PPTX and its native source through saving", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts"),
      { importPptx, exportPptx } = await import("/src/io.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const d = blankDeck(),
      zip = await JSZip.loadAsync(await exportPptx(d));
    const part = "ppt/slides/slide1.xml";
    zip.file(
      part,
      (await zip.file(part)!.async("string")).replace(
        "</p:sld>",
        "<p:transition><p:push/></p:transition></p:sld>",
      ),
    );
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const results = [];
    for (const ending of [[10], [13, 10]]) {
      const padded = new Uint8Array(bytes.length + ending.length);
      padded.set(bytes);
      padded.set(ending, bytes.length);
      let deck = (await importPptx(padded)).deck;
      const hadSource = !!deck.pptxSources;
      deck = (await importPptx(await exportPptx(deck))).deck;
      results.push({
        hadSource,
        slides: deck.slides.length,
        text: deck.slides[0].elements.map((e) => e.text),
      });
    }
    return results;
  });
  expect(result[0].hadSource).toBe(true);
  expect(result[1]).toEqual(result[0]);
  expect(result[0].slides).toBe(1);
});

test("ZIP comments ending in newlines remain intact, while other trailing data stays rejected", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { checkZip } = await import("/src/pptx-package.ts"),
      { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<presentation/>");
    const comments = [];
    for (const comment of ["", "comment\n", "comment\r\n", "x".repeat(65535)]) {
      const bytes = await zip.generateAsync({ type: "uint8array", comment });
      for (const tail of [[], [10], [13, 10]]) {
        const padded = new Uint8Array(bytes.length + tail.length);
        padded.set(bytes);
        padded.set(tail, bytes.length);
        checkZip(padded);
        comments.push((await JSZip.loadAsync(padded)).comment ?? "");
      }
    }
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const invalid = [
      [0],
      [32],
      [13],
      [10, 10],
      [13, 10, 13, 10],
      [88, 10],
      [10, 88],
    ];
    const rejections = invalid.map((tail) => {
      const input = new Uint8Array(bytes.length + tail.length);
      input.set(bytes);
      input.set(tail, bytes.length);
      try {
        checkZip(input);
        return false;
      } catch {
        return true;
      }
    });
    return { comments, rejections };
  });
  expect(result.comments).toEqual([
    "",
    "",
    "",
    ...Array(3).fill("comment\n"),
    ...Array(3).fill("comment\r\n"),
    ...Array(3).fill("x".repeat(65535)),
  ]);
  expect(result.rejections).toEqual(Array(7).fill(true));
});
