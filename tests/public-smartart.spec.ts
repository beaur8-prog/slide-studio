import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("the Korean workplace organization chart keeps every label and geometry through three edited PPTX saves", async ({
  page,
}, info) => {
  test.skip(
    !fs.existsSync("qa/samples/dsu-korean.pptx"),
    "Download the pinned public corpus first",
  );
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    let deck = (
      await importPptx(
        await (await fetch("/qa/samples/dsu-korean.pptx")).arrayBuffer(),
      )
    ).deck;
    const record = () =>
      deck.slides[5].elements
        .filter((e) => e.text?.trim())
        .map((e) => ({
          text: e.text,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
        }));
    const before = record(),
      rounds = [];
    let bytes = new Uint8Array();
    for (let i = 0; i < 3; i++) {
      deck.slides[0].notes = `이웃 장 노트 편집 ${i + 1}`;
      const warnings: string[] = [];
      bytes = await exportPptx(deck, { onWarning: (m) => warnings.push(m) });
      deck = (await importPptx(bytes)).deck;
      rounds.push({ labels: record(), warnings });
    }
    return { before, rounds, bytes: [...bytes] };
  });
  fs.writeFileSync(
    info.outputPath("korean-smartart-roundtrip.pptx"),
    Buffer.from(result.bytes),
  );
  expect(result.before.map((e) => e.text)).toContain("고충처리위원회");
  for (const round of result.rounds) {
    expect(round.warnings).toEqual([]);
    expect(round.labels.map((e) => e.text)).toEqual(
      result.before.map((e) => e.text),
    );
    for (let i = 0; i < round.labels.length; i++)
      for (const key of ["x", "y", "width", "height"] as const)
        expect(round.labels[i][key]).toBeCloseTo(result.before[i][key], 1);
  }
});
