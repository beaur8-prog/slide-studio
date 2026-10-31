import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const sample = "qa/samples/dickinson-workplace.pptx";

test("shared master themes are byte-identical independent parts, preserving relative assets and idempotent output", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const { separateMasterThemes } = await import("/src/pptx-master-themes.ts");
    const { relsPath, resolvePart } = await import("/src/pptx-package.ts");
    const zip = new JSZip(),
      P = "http://schemas.openxmlformats.org/package/2006/relationships";
    // A part-graph unit fixture isolates ownership from slide content.
    const owners = [
      "slideMaster",
      "slideMaster",
      "notesMaster",
      "handoutMaster",
    ];
    const paths = owners.map((role, i) => `ppt/${role}s/owner${i}.xml`);
    const theme =
      '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements/><a:objectDefaults/></a:theme>';
    const themePath = "ppt/theme/shared.xml",
      asset = "ppt/media/source.bin";
    const themeRels = `<Relationships xmlns="${P}"><Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/source.bin"/><Relationship Id="link" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/unchanged" TargetMode="External"/></Relationships>`;
    zip.file(themePath, theme);
    zip.file(relsPath(themePath), themeRels);
    zip.file(asset, new Uint8Array([1, 2, 3, 4]));
    for (const path of paths) {
      zip.file(path, "<owner/>");
      zip.file(
        relsPath(path),
        `<Relationships xmlns="${P}"><Relationship Id="theme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/shared.xml"/></Relationships>`,
      );
    }
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        paths
          .map(
            (path, i) =>
              `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${owners[i]}+xml"/>`,
          )
          .join("") +
        `<Override PartName="/${themePath}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    );
    await separateMasterThemes(zip);
    const targets = await Promise.all(
      paths.map(async (path) => {
        const doc = new DOMParser().parseFromString(
          await zip.file(relsPath(path))!.async("string"),
          "application/xml",
        );
        return resolvePart(
          path,
          doc
            .getElementsByTagNameNS("*", "Relationship")[0]
            .getAttribute("Target")!,
        )!;
      }),
    );
    const copied = await Promise.all(
      targets.map(async (path) => ({
        xml: await zip.file(path)!.async("string"),
        rels: await zip.file(relsPath(path))!.async("string"),
        asset: resolvePart(path, "../media/source.bin"),
      })),
    );
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(zip.files)
            .filter(([, file]) => !file.dir)
            .map(async ([path, file]) => [path, await file.async("base64")]),
        ),
      );
    const first = await snapshot();
    await separateMasterThemes(zip);
    const second = await snapshot();
    return {
      targets,
      copied,
      first,
      second,
      expected: { xml: theme, rels: themeRels, asset },
      assets: Object.keys(zip.files).filter((path) => path === asset).length,
    };
  });
  expect(new Set(result.targets).size).toBe(4);
  expect(result.copied).toEqual(
    Array.from({ length: 4 }, () => result.expected),
  );
  expect(result.second).toEqual(result.first);
  expect(result.assets).toBe(1);
});

test("public Dickinson edited three saves keeps native content and distinct owner themes without accumulating copies", async ({
  page,
}, info) => {
  test.skip(
    !existsSync(sample),
    "Fetch the pinned public layout corpus first.",
  );
  const input = [...(await readFile(sample))];
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async (input) => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const { readChartModel } = await import("/src/chart.ts");
    const { relsPath, resolvePart } = await import("/src/pptx-package.ts");
    let deck = (await importPptx(new Uint8Array(input))).deck;
    const chartSnapshot = () =>
      deck.slides.flatMap((slide) =>
        slide.elements
          .filter((e) => e.chart)
          .map((e) => ({
            model: readChartModel(e.chart!),
            workbooks: e
              .chart!.parts.filter((p) => p.path.endsWith(".xlsx"))
              .map((p) => p.data),
          })),
      );
    const before = chartSnapshot(),
      rounds = [];
    let output = new Uint8Array();
    for (let round = 0; round < 3; round++) {
      deck.slides[0].notes = `Theme ownership round ${round}`;
      output = await exportPptx(deck);
      const zip = await JSZip.loadAsync(output);
      const types = new DOMParser().parseFromString(
        await zip.file("[Content_Types].xml")!.async("string"),
        "application/xml",
      );
      const owners = Array.from(types.getElementsByTagNameNS("*", "Override"))
        .filter((n) =>
          /presentationml\.(?:slideMaster|notesMaster|handoutMaster)\+xml$/.test(
            n.getAttribute("ContentType") ?? "",
          ),
        )
        .map((n) => n.getAttribute("PartName")!.slice(1));
      const targets = await Promise.all(
        owners.map(async (path) => {
          const doc = new DOMParser().parseFromString(
            await zip.file(relsPath(path))!.async("string"),
            "application/xml",
          );
          const r = Array.from(
            doc.getElementsByTagNameNS("*", "Relationship"),
          ).find((r) => r.getAttribute("Type")?.endsWith("/theme"));
          return r ? resolvePart(path, r.getAttribute("Target")!) : undefined;
        }),
      );
      const expanded = (
        await Promise.all(
          Object.values(zip.files)
            .filter((file) => !file.dir)
            .map((file) =>
              file.async("uint8array").then((bytes) => bytes.length),
            ),
        )
      ).reduce((sum, size) => sum + size, 0);
      const masterCount = Array.from(
        types.getElementsByTagNameNS("*", "Override"),
      ).filter((n) =>
        /presentationml\.slideMaster\+xml$/.test(
          n.getAttribute("ContentType") ?? "",
        ),
      ).length;
      const layoutCount = Array.from(
        types.getElementsByTagNameNS("*", "Override"),
      ).filter((n) =>
        /presentationml\.slideLayout\+xml$/.test(
          n.getAttribute("ContentType") ?? "",
        ),
      ).length;
      deck = (await importPptx(output)).deck;
      rounds.push({
        bytes: output.length,
        expanded,
        masterCount,
        layoutCount,
        owners: owners.length,
        unique: new Set(targets.filter(Boolean)).size,
        themeCount: Array.from(
          types.getElementsByTagNameNS("*", "Override"),
        ).filter(
          (n) =>
            n.getAttribute("ContentType") ===
            "application/vnd.openxmlformats-officedocument.theme+xml",
        ).length,
        charts: chartSnapshot(),
        slides: deck.slides.length,
        title: deck.slides[0].elements.find((e) => e.type === "text")?.text,
        notes: deck.slides[0].notes,
      });
    }
    return { before, rounds, output: [...output] };
  }, input);
  for (const [round, saved] of result.rounds.entries()) {
    expect(saved.owners).toBeGreaterThan(1);
    expect(saved.unique).toBe(saved.owners);
    expect(saved.themeCount).toBe(saved.owners);
    expect(saved.slides).toBe(9);
    expect(saved.charts).toEqual(result.before);
    expect(saved.title).toContain("Presentation Title");
    expect(saved.notes).toBe(`Theme ownership round ${round}`);
  }
  expect(result.rounds[2].themeCount).toBe(result.rounds[1].themeCount);
  expect(result.rounds[2].masterCount).toBe(result.rounds[1].masterCount);
  expect(result.rounds[2].layoutCount).toBe(result.rounds[1].layoutCount);
  expect(
    Math.abs(result.rounds[2].expanded - result.rounds[1].expanded),
  ).toBeLessThan(8192);
  expect(
    Math.abs(result.rounds[2].bytes - result.rounds[1].bytes),
  ).toBeLessThan(8192);
  await writeFile(
    info.outputPath(
      "SS-QA-20261031-dickinson-master-theme-candidate-saved3.pptx",
    ),
    Buffer.from(result.output),
  );
  await writeFile(
    info.outputPath("rounds.json"),
    JSON.stringify(result.rounds, null, 2),
  );
});

test("new editable slides and notes survive three saves with stable independent themes", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { exportPptx, importPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    let deck = blankDeck(),
      output = new Uint8Array();
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      deck.slides[0].notes = `New notes ${round}`;
      output = await exportPptx(deck);
      const zip = await JSZip.loadAsync(output);
      const count = (
        await zip.file("[Content_Types].xml")!.async("string")
      ).match(
        /ContentType="application\/vnd.openxmlformats-officedocument.theme\+xml"/g,
      )?.length;
      deck = (await importPptx(output)).deck;
      rounds.push({
        count,
        notes: deck.slides[0].notes,
        slideCount: deck.slides.length,
        bytes: output.length,
      });
    }
    return { rounds, output: [...output] };
  });
  for (const [round, saved] of result.rounds.entries()) {
    expect(saved.notes).toBe(`New notes ${round}`);
    expect(saved.slideCount).toBe(1);
    expect(saved.count).toBeGreaterThanOrEqual(2);
  }
  expect(result.rounds[2].count).toBe(result.rounds[1].count);
  await writeFile(
    info.outputPath("SS-QA-20261031-native-master-theme-candidate-saved3.pptx"),
    Buffer.from(result.output),
  );
});

test("final PPTX export checks XML, part and combined expanded-size headers without reducing the 24 MiB part allowance", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { default: JSZip } = await import(
      "/node_modules/.vite/deps/jszip.js"
    );
    const { exportPptx } = await import("/src/io.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { checkZip, MAX_XML, MAX_PART } = await import(
      "/src/pptx-package.ts"
    );
    const original = JSZip.prototype.generateAsync;
    const run = async (kind: "xml" | "part" | "total" | "allowed") => {
      // Model highly-compressible large assets by their central-directory size
      // headers. No 200 MiB allocation or decompression is needed for this guard.
      JSZip.prototype.generateAsync = async function (
        options: any,
        callback?: any,
      ) {
        const final =
          options?.type === "uint8array" && this.file("ppt/theme/theme1-ss-owner-1.xml");
        if (final)
          for (let i = 0; i < (kind === "total" ? 9 : 1); i++)
            this.file(`ppt/media/guard-${i}.bin`, new Uint8Array([0]));
        const output = (await original.call(
          this,
          options,
          callback,
        )) as Uint8Array;
        if (!final) return output as any;
        const bytes = output.slice(),
          view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const end = bytes.length - 22,
          count = view.getUint16(end + 10, true);
        let at = view.getUint32(end + 16, true);
        for (let i = 0; i < count; i++) {
          const length = view.getUint16(at + 28, true),
            extra = view.getUint16(at + 30, true),
            comment = view.getUint16(at + 32, true);
          const name = new TextDecoder().decode(
            bytes.subarray(at + 46, at + 46 + length),
          );
          if (kind === "xml" && name === "ppt/presentation.xml")
            view.setUint32(at + 24, MAX_XML + 1, true);
          if (name.startsWith("ppt/media/guard-"))
            view.setUint32(
              at + 24,
              kind === "part"
                ? MAX_PART + 1
                : kind === "total" || kind === "allowed"
                  ? MAX_PART
                  : 1,
              true,
            );
          at += 46 + length + extra + comment;
        }
        return bytes as any;
      };
      try {
        const bytes = await exportPptx(blankDeck());
        return {
          error: "",
          partSize: checkZip(bytes).get("ppt/media/guard-0.bin"),
        };
      } catch (error) {
        return { error: (error as Error).message };
      } finally {
        JSZip.prototype.generateAsync = original;
      }
    };
    return {
      xml: await run("xml"),
      part: await run("part"),
      total: await run("total"),
      allowed: await run("allowed"),
      MAX_PART,
    };
  });
  expect(result.xml.error).toContain("XML 항목이 너무 큽니다");
  expect(result.part.error).toContain("압축 해제 크기가 제한을 초과");
  expect(result.total.error).toContain("압축 해제 크기가 제한을 초과");
  expect(result.allowed).toEqual({ error: "", partSize: result.MAX_PART });
});
