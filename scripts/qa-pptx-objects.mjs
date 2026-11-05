#!/usr/bin/env node
// Audits object presence independently of page screenshots. Source files are read-only.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const [manifestArg, outputArg, ...flags] = process.argv.slice(2);
if (!manifestArg || !outputArg)
  throw Error(
    "Usage: node scripts/qa-pptx-objects.mjs <source-inventory.json> <new qa/results/directory> [--round-trip] [--filter=name]",
  );
const out = path.resolve(outputArg);
if (!out.startsWith(path.join(root, "qa/results") + path.sep))
  throw Error("Output must be inside qa/results/");
await fs.mkdir(out, { recursive: false });
const filter = flags.find((f) => f.startsWith("--filter="))?.slice(9);
const exclude = flags.find((f) => f.startsWith("--exclude="))?.slice(10);
const manifest = JSON.parse(await fs.readFile(manifestArg, "utf8"));
const sampleRoot = path.resolve(
  flags.find((f) => f.startsWith("--sample-root="))?.slice(14) ??
    path.join(root, "qa/results/object-presence-samples"),
);
const sources = (Array.isArray(manifest) ? manifest : manifest.samples)
  .map((s) => ({ ...s, path: s.path ?? path.resolve(sampleRoot, s.file) }))
  .filter(
    (s) =>
      (!filter || s.file.includes(filter)) &&
      (!exclude || !s.file.includes(exclude)),
  );
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const source of sources) {
    const bytes = await fs.readFile(source.path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== source.sha256) throw Error(`Source changed: ${source.file}`);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const relative = path.relative(root, source.path);
    // Large route.fulfill bodies can exceed the DevTools message limit. Serve
    // in-workspace samples over actual HTTP; route only small external inputs.
    const sourceUrl =
      relative && !relative.startsWith("..") && !path.isAbsolute(relative)
        ? "/" + relative.split(path.sep).map(encodeURIComponent).join("/")
        : "/__object-audit.pptx";
    if (sourceUrl === "/__object-audit.pptx") {
      if (bytes.length > 32 * 1024 * 1024)
        throw Error(
          "Copy large external QA inputs under the workspace before auditing.",
        );
      await page.route("**/__object-audit.pptx", (route) =>
        route.fulfill({
          path: source.path,
          contentType: "application/octet-stream",
        }),
      );
    }
    try {
      await page.goto("http://127.0.0.1:5190");
      const result = await page.evaluate(
        async ({ roundTrip, sourceUrl }) => {
          const { importPptx, exportPptx } = await import("/src/io.ts");
          const { resolveDeckFields } = await import("/src/insert-fields.ts");
          const { default: JSZip } = await import(
            "/node_modules/.vite/deps/jszip.js"
          );
          const bytes = await (await fetch(sourceUrl)).arrayBuffer();
          const zip = await JSZip.loadAsync(bytes);
          const docs = new Map();
          const xml = async (part) => {
            if (!part || !zip.file(part)) return undefined;
            if (!docs.has(part))
              docs.set(
                part,
                new DOMParser().parseFromString(
                  await zip.file(part).async("string"),
                  "application/xml",
                ),
              );
            return docs.get(part);
          };
          const all = (n, name) =>
            Array.from(n?.getElementsByTagNameNS("*", name) ?? []);
          const child = (n, name) =>
            Array.from(n?.children ?? []).find((e) => e.localName === name);
          const cellText = (cell) =>
            all(cell, "p")
              .map((p) =>
                Array.from(p.children)
                  .map((n) =>
                    n.localName === "br"
                      ? "\n"
                      : all(n, "t")
                          .map((t) => t.textContent)
                          .join(""),
                  )
                  .join(""),
              )
              .join("\n");
          const id = (n, name = "id") =>
            Array.from(n?.attributes ?? []).find(
              (a) => a.localName === name && a.namespaceURI,
            )?.value;
          const resolve = (part, target) => {
            const url = new URL(
              decodeURIComponent(target),
              `https://package.test/${part}`,
            );
            return url.origin === "https://package.test"
              ? url.pathname.slice(1)
              : undefined;
          };
          const rels = async (part) => {
            const pieces = part.split("/"),
              name = pieces.pop();
            return all(
              await xml([...pieces, "_rels", name + ".rels"].join("/")),
              "Relationship",
            ).map((r) => ({
              id: r.getAttribute("Id"),
              type: r.getAttribute("Type"),
              path:
                r.getAttribute("TargetMode") === "External"
                  ? undefined
                  : resolve(part, r.getAttribute("Target")),
            }));
          };
          const rootRel = all(await xml("_rels/.rels"), "Relationship").find(
            (r) => r.getAttribute("Type").endsWith("/officeDocument"),
          );
          const pres = rootRel
            ? resolve("", rootRel.getAttribute("Target"))
            : "ppt/presentation.xml";
          const presRels = await rels(pres);
          const slides = [];
          const expected = [];
          const inspectTree = (tree, part, slide, decorations = false) => {
            if (!tree) return;
            for (const [index, top] of Array.from(tree.children).entries()) {
              if (decorations && all(top, "ph").length) continue;
              const visit = (node) => {
                if (node.localName === "AlternateContent") {
                  const fallback = child(node, "Fallback");
                  if (fallback) for (const n of fallback.children) visit(n);
                  else
                    expected.push({
                      slide,
                      part,
                      index,
                      kind: "choice-without-fallback",
                      shape: all(node, "cNvPr")[0]?.getAttribute("id"),
                      children: Array.from(node.children).map((n) => ({
                        kind: n.localName,
                        pictures: all(n, "pic").length,
                        tables: all(n, "tbl").length,
                      })),
                    });
                  return;
                }
                if (
                  node.localName === "pic" ||
                  (node.localName === "graphicFrame" && all(node, "tbl").length)
                ) {
                  const props = all(node, "cNvPr")[0];
                  expected.push({
                    slide,
                    part,
                    index,
                    kind: node.localName === "pic" ? "picture" : "table",
                    shape: props?.getAttribute("id") ?? "",
                    name: props?.getAttribute("name"),
                    hidden: ["1", "true"].includes(
                      props?.getAttribute("hidden"),
                    ),
                    media:
                      all(node, "videoFile").length +
                        all(node, "audioFile").length +
                        all(node, "wavAudioFile").length +
                        all(node, "media").length >
                      0,
                    texts:
                      node.localName === "pic"
                        ? undefined
                        : all(node, "tc").map(cellText),
                  });
                  return;
                }
                if (
                  node.localName === "sp" &&
                  all(child(node, "spPr"), "blipFill").length
                )
                  expected.push({
                    slide,
                    part,
                    index,
                    kind: "shape-picture-fill",
                    shape: all(node, "cNvPr")[0]?.getAttribute("id"),
                  });
                for (const n of node.children) visit(n);
              };
              visit(top);
            }
          };
          for (const s of Array.from(
            all(await xml(pres), "sldIdLst")[0]?.children ?? [],
          )) {
            const part = presRels.find((r) => r.id === id(s))?.path;
            const doc = await xml(part),
              sr = await rels(part);
            const layoutPart = sr.find((r) =>
              r.type.endsWith("/slideLayout"),
            )?.path;
            const layout = await xml(layoutPart),
              lr = layoutPart ? await rels(layoutPart) : [];
            const masterPart = lr.find((r) =>
              r.type.endsWith("/slideMaster"),
            )?.path;
            const slide = slides.length;
            if (
              !["0", "false"].includes(
                doc.documentElement.getAttribute("showMasterSp"),
              )
            ) {
              if (
                !["0", "false"].includes(
                  layout?.documentElement.getAttribute("showMasterSp"),
                )
              )
                inspectTree(
                  all(await xml(masterPart), "spTree")[0],
                  masterPart,
                  slide,
                  true,
                );
              inspectTree(all(layout, "spTree")[0], layoutPart, slide, true);
            }
            inspectTree(all(doc, "spTree")[0], part, slide);
            slides.push({ part });
          }
          const imported = await importPptx(bytes);
          let deck = imported.deck;
          const missing = [],
            missingCellText = [],
            missingPictureFills = [];
          for (const e of expected.filter((e) =>
            ["picture", "table"].includes(e.kind),
          )) {
            const elements = deck.slides[e.slide]?.elements ?? [];
            let matches = elements.filter(
              (m) =>
                m.pptxRef?.part === e.part &&
                m.pptxRef?.index === e.index &&
                m.pptxRef?.shape === e.shape,
            );
            if (!elements.some((m) => m.pptxRef) && e.name)
              matches = elements.filter((m) => m.name === e.name);
            if (e.kind === "picture")
              matches = matches.filter((m) =>
                ["image", "video", "audio"].includes(m.type),
              );
            if (!matches.length) missing.push(e);
            if (e.kind === "table" && matches.length) {
              const normal = (s) =>
                s
                  .split(/\r?\n/)
                  .map((line) =>
                    line.replace(/^\s*(?:[•◦▪●○■□‣⁃]|\d+[.)])\s*/, ""),
                  )
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim();
              const actual = matches
                .flatMap((m) =>
                  m.table
                    ? m.table.cells.flat()
                    : m.text !== undefined
                      ? [m.text]
                      : [],
                )
                .map(normal);
              const absent = [];
              for (const text of e.texts.map(normal).filter(Boolean)) {
                const at = actual.indexOf(text);
                if (at < 0) absent.push(text);
                else actual.splice(at, 1);
              }
              if (absent.length) missingCellText.push({ ...e, absent });
            }
          }
          for (const e of expected.filter(
            (e) => e.kind === "shape-picture-fill",
          )) {
            const elements = deck.slides[e.slide]?.elements ?? [];
            if (
              !elements.some(
                (m) =>
                  m.imageFill &&
                  m.pptxRef?.part === e.part &&
                  m.pptxRef?.index === e.index &&
                  m.pptxRef?.shape === e.shape,
              )
            )
              missingPictureFills.push(e);
          }
          const digest = async (value) =>
            Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  "SHA-256",
                  new TextEncoder().encode(value),
                ),
              ),
            )
              .map((n) => n.toString(16).padStart(2, "0"))
              .join("");
          const snapshot = async (deck) =>
            Promise.all(
              resolveDeckFields(deck).slides.map(async (s) => ({
                images: (
                  await Promise.all(
                    s.elements
                      .filter((e) =>
                        ["image", "video", "audio"].includes(e.type),
                      )
                      .map(async (e) => ({
                        type: e.type,
                        hash: await digest(e.src ?? ""),
                        poster: e.poster ? await digest(e.poster) : null,
                        hidden: !!e.hidden,
                      })),
                  )
                ).sort((a, b) =>
                  JSON.stringify(a).localeCompare(JSON.stringify(b)),
                ),
                background: s.backgroundImage
                  ? await digest(s.backgroundImage.src)
                  : null,
                pictureFills: (
                  await Promise.all(
                    s.elements
                      .filter((e) => e.imageFill)
                      .map((e) => digest(JSON.stringify(e.imageFill))),
                  )
                ).sort(),
                cells: s.elements
                  .flatMap((e) =>
                    e.table
                      ? e.table.cells.flat()
                      : e.text !== undefined
                        ? [e.text]
                        : [],
                  )
                  .filter(Boolean)
                  .sort(),
                tables: s.elements.filter((e) => e.table).length,
              })),
            );
          const baseline = await snapshot(deck),
            rounds = [],
            initialWarnings = imported.warnings;
          if (roundTrip)
            for (let round = 1; round <= 3; round++) {
              const exportWarnings = [];
              const next = await importPptx(
                await exportPptx(deck, {
                  onWarning: (w) => exportWarnings.push(w),
                }),
              );
              const current = await snapshot(next.deck);
              rounds.push({
                round,
                changedSlides: current.flatMap((s, i) =>
                  JSON.stringify(s) === JSON.stringify(baseline[i])
                    ? []
                    : [{ slide: i + 1, before: baseline[i], after: s }],
                ),
                warnings: next.warnings,
                exportWarnings,
              });
              deck = next.deck;
            }
          const { default: React } = await import(
            "/node_modules/.vite/deps/react.js"
          );
          const {
            default: { createRoot },
          } = await import("/node_modules/.vite/deps/react-dom_client.js");
          const { SlideVisual } = await import("/src/SlideCanvas.tsx");
          const host = document.createElement("div");
          host.style.cssText =
            "position:fixed;left:0;top:0;z-index:999999;background:white";
          document.body.append(host);
          const reactRoot = createRoot(host),
            decodeFailures = [];
          for (let offset = 0; offset < deck.slides.length; offset += 10) {
            reactRoot.render(
              React.createElement(
                React.Fragment,
                null,
                ...deck.slides.slice(offset, offset + 10).map((s, i) =>
                  React.createElement(
                    "div",
                    { key: s.id, "data-audit-slide": offset + i + 1 },
                    React.createElement(SlideVisual, {
                      slide: s,
                      width: deck.width,
                      height: deck.height,
                    }),
                  ),
                ),
              ),
            );
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(r)),
            );
            await Promise.all(
              Array.from(host.querySelectorAll("img,image")).map(
                async (element) => {
                  const src =
                    element.getAttribute("src") || element.getAttribute("href");
                  const img =
                    element instanceof HTMLImageElement
                      ? element
                      : Object.assign(new Image(), { src });
                  try {
                    await Promise.race([
                      img.decode(),
                      new Promise((_, reject) =>
                        setTimeout(() => reject(Error("decode timeout")), 5000),
                      ),
                    ]);
                    if (!img.naturalWidth) throw Error("zero width");
                  } catch (error) {
                    decodeFailures.push({
                      slide: Number(
                        element.closest("[data-audit-slide]").dataset
                          .auditSlide,
                      ),
                      kind: src.slice(0, 50),
                      error: String(error),
                    });
                  }
                },
              ),
            );
          }
          reactRoot.unmount();
          host.remove();
          return {
            status: "imported",
            slides: deck.slides.length,
            expected,
            missing,
            missingCellText,
            missingPictureFills,
            initialWarnings,
            imageCount: baseline.reduce((n, s) => n + s.images.length, 0),
            tableCount: baseline.reduce((n, s) => n + s.tables, 0),
            pictureFillCount: baseline.reduce(
              (n, s) => n + s.pictureFills.length,
              0,
            ),
            rounds,
            decodeFailures,
          };
        },
        { roundTrip: flags.includes("--round-trip"), sourceUrl },
      );
      results.push({
        file: source.file,
        bytes: bytes.length,
        sha256,
        ...result,
        pageErrors: errors,
      });
      console.log(
        JSON.stringify({
          file: source.file,
          slides: result.slides,
          expectedPictures: result.expected.filter((e) => e.kind === "picture")
            .length,
          expectedTables: result.expected.filter((e) => e.kind === "table")
            .length,
          missing: result.missing.length,
          missingCellText: result.missingCellText.length,
          pictureFills: result.pictureFillCount,
          missingPictureFills: result.missingPictureFills.length,
          decodeFailures: result.decodeFailures.length,
          roundTripChanges: result.rounds.map((r) => r.changedSlides.length),
        }),
      );
    } catch (error) {
      results.push({
        file: source.file,
        bytes: bytes.length,
        sha256,
        status: "rejected",
        error: String(error),
        pageErrors: errors,
      });
      console.log(JSON.stringify({ file: source.file, error: String(error) }));
    } finally {
      await context.close().catch(() => {});
      await fs.writeFile(
        path.join(out, "objects.json"),
        JSON.stringify(results, null, 2),
      );
    }
    if (
      createHash("sha256")
        .update(await fs.readFile(source.path))
        .digest("hex") !== sha256
    )
      throw Error(`Source modified: ${source.file}`);
  }
} finally {
  await browser.close();
}
