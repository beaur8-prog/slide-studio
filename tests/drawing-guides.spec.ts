import { test, expect } from "@playwright/test";
test("all 187 standard geometry presets resolve safe finite paths and nonrectangular text frames", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { presetNames, presetGeometry } = await import(
        "/src/drawing-presets.ts"
      ),
      { drawingPaths } = await import("/src/drawing-path.ts"),
      { drawingTextFrame, drawingGuides } = await import(
        "/src/drawing-guides.ts"
      );
    const failures: string[] = [];
    for (const name of presetNames()) {
      const g = presetGeometry(name)!;
      const paths = drawingPaths(g, { width: 9144000, height: 5143500 });
      if (!paths?.length || paths.some((p) => /NaN|Infinity/.test(p.d)))
        failures.push(name);
    }
    const custom = new DOMParser().parseFromString(
      '<custGeom><avLst><gd name="a" fmla="val 100"/></avLst><gdLst><gd name="x" fmla="*/ w a 1000"/><gd name="y" fmla="+- h 0 x"/></gdLst><pathLst><path><moveTo><pt x="x" y="0"/></moveTo><lnTo><pt x="w" y="y"/></lnTo></path></pathLst></custGeom>',
      "application/xml",
    ).documentElement;
    const resolver = drawingGuides(custom, 1000, 500);
    return {
      count: presetNames().length,
      failures,
      ellipse: drawingTextFrame(presetGeometry("ellipse"), 1000, 500),
      custom: drawingPaths(custom, { width: 1000, height: 500 }),
      y: resolver("y"),
    };
  });
  expect(result.count).toBe(187);
  expect(result.failures).toEqual([]);
  expect(result.y).toBe(400);
  expect(result.custom![0].d).toBe("M 100 0 L 1000 400");
  expect(result.ellipse![2]).toBeCloseTo(Math.SQRT1_2, 4);
});
