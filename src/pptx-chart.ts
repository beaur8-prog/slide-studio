import type JSZip from "jszip";
import type { ChartData, ChartPart, SlideElement, Deck } from "./types";
import {
  chartXml,
  chartPartText,
  decodeChartPart,
  validateChart,
  chartRelationshipAllowed,
  MAX_CHART_BYTES,
  DRAWING_NS,
  readChartTheme,
} from "./chart";
import { resolvePart } from "./pptx-package";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const SS = "urn:slide-studio:object-state:v1";
const serial = (doc: Document) => new XMLSerializer().serializeToString(doc);
const list = (doc: Document | Element, name: string) =>
  Array.from(doc.getElementsByTagNameNS("*", name));
interface Relationship {
  id: string;
  type: string;
  path?: string;
  external: boolean;
  target?: string;
}
export async function readChartPackage(
  root: string,
  colors: Record<string, string>,
  fontFamily: string,
  readBytes: (path: string, limit?: number) => Promise<Uint8Array | undefined>,
  relationships: (path: string) => Promise<Relationship[]>,
): Promise<ChartData> {
  const contentBytes = await readBytes("[Content_Types].xml", 8 * 1024 * 1024);
  if (!contentBytes) throw Error("차트 파일 형식을 찾을 수 없습니다.");
  const types = chartXml(new TextDecoder().decode(contentBytes));
  const overrides = new Map(
    list(types, "Override").map((n) => [
      n.getAttribute("PartName")!.replace(/^\//, ""),
      n.getAttribute("ContentType")!,
    ]),
  );
  const defaults = new Map(
    list(types, "Default").map((n) => [
      n.getAttribute("Extension")!.toLowerCase(),
      n.getAttribute("ContentType")!,
    ]),
  );
  const parts: ChartPart[] = [],
    visited = new Set<string>();
  let size = 0;
  async function visit(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    if (visited.size > 128) throw Error("차트 첨부 파일이 너무 많습니다.");
    const bytes = await readBytes(path, MAX_CHART_BYTES - size);
    if (!bytes) throw Error("차트 첨부 파일이 누락되었습니다.");
    size += bytes.byteLength;
    if (size > MAX_CHART_BYTES)
      throw Error("차트 첨부 파일은 합계 16 MiB까지 지원합니다.");
    let raw = "";
    for (let offset = 0; offset < bytes.length; offset += 32768)
      raw += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const rels = await relationships(path);
    for (const rel of rels) {
      if (!chartRelationshipAllowed(rel.type))
        throw Error("지원하지 않는 차트 첨부 개체입니다.");
      if (!rel.external && !rel.path) throw Error("잘못된 차트 참조입니다.");
    }
    parts.push({
      path,
      contentType:
        overrides.get(path) ??
        defaults.get(path.split(".").pop()!.toLowerCase()) ??
        "",
      data: btoa(raw),
      relationships: rels.map((r) => ({
        id: r.id,
        type: r.type,
        target: r.external ? r.target! : r.path!,
        ...(r.external ? { external: true } : {}),
      })),
    });
    for (const rel of rels) if (!rel.external) await visit(rel.path!);
  }
  await visit(root);
  return validateChart({ root, parts, colors, fontFamily });
}

/** Replace a temporary shape with a native chart frame and its original parts.
 * All names are remapped so duplicates and charts from different decks cannot
 * overwrite each other's workbooks or chart styles. No external links are read.
 */
export async function writeCharts(
  zip: JSZip,
  doc: Document,
  relationshipDoc: Document,
  elements: SlideElement[],
) {
  const charts = elements.filter((e) => e.type === "chart" && e.chart);
  if (!charts.length) return;
  const contentTypes = chartXml(
    await zip.file("[Content_Types].xml")!.async("string"),
  );
  for (const element of charts) {
    const chart = element.chart!;
    const themeColors = readChartTheme(chart).colors;
    const props = list(doc, "cNvPr").find(
      (p) => p.getAttribute("name") === element.id,
    );
    const placeholder = props?.parentElement?.parentElement;
    if (!props || !placeholder)
      throw Error("차트 저장 위치를 찾을 수 없습니다.");
    const directory = "ppt/charts/ss-" + crypto.randomUUID();
    const mapped = new Map(
      chart.parts.map((part, i) => [
        part.path,
        `${directory}/part${i}.${part.path.split(".").pop()}`,
      ]),
    );
    for (const part of chart.parts) {
      const filename = mapped.get(part.path)!;
      let data = decodeChartPart(part.data);
      if (part.contentType.endsWith("+xml")) {
        const xml = chartXml(chartPartText(part.data));
        // A saved presentation uses its own theme. Resolve the source theme's
        // colors in chart XML/styles to keep the imported chart's appearance.
        for (const scheme of Array.from(
          xml.getElementsByTagNameNS(DRAWING_NS, "schemeClr"),
        )) {
          const color = themeColors[scheme.getAttribute("val") ?? ""];
          if (!color || color === "transparent") continue;
          const rgb = xml.createElementNS(DRAWING_NS, "a:srgbClr");
          rgb.setAttribute("val", color.slice(1));
          while (scheme.firstChild) rgb.append(scheme.firstChild);
          scheme.replaceWith(rgb);
        }
        data = new TextEncoder().encode(serial(xml));
      }
      zip.file(filename, data);
      const type = contentTypes.createElementNS(CT, "Override");
      type.setAttribute("PartName", "/" + filename);
      type.setAttribute("ContentType", part.contentType);
      contentTypes.documentElement.append(type);
      if (part.relationships.length) {
        const rels = chartXml(`<Relationships xmlns="${PR}"/>`);
        for (const relationship of part.relationships) {
          const rel = rels.createElementNS(PR, "Relationship");
          rel.setAttribute("Id", relationship.id);
          rel.setAttribute("Type", relationship.type);
          // OPC absolute part paths avoid assumptions about the original chart
          // folder (some writers put it under ppt/slides/charts).
          rel.setAttribute(
            "Target",
            relationship.external
              ? relationship.target
              : "/" + mapped.get(relationship.target)!,
          );
          if (relationship.external) rel.setAttribute("TargetMode", "External");
          rels.documentElement.append(rel);
        }
        const bits = filename.split("/"),
          name = bits.pop()!;
        zip.file([...bits, "_rels", name + ".rels"].join("/"), serial(rels));
      }
    }
    let id = "rIdChart" + crypto.randomUUID().replaceAll("-", "");
    while (
      list(relationshipDoc, "Relationship").some(
        (r) => r.getAttribute("Id") === id,
      )
    )
      id += "x";
    const relationship = relationshipDoc.createElementNS(PR, "Relationship");
    relationship.setAttribute("Id", id);
    relationship.setAttribute("Type", R + "/chart");
    relationship.setAttribute("Target", "/" + mapped.get(chart.root)!);
    relationshipDoc.documentElement.append(relationship);
    const frame = doc.createElementNS(P, "p:graphicFrame"),
      nv = doc.createElementNS(P, "p:nvGraphicFramePr");
    nv.append(
      props.cloneNode(true),
      doc.createElementNS(P, "p:cNvGraphicFramePr"),
      doc.createElementNS(P, "p:nvPr"),
    );
    frame.append(nv);
    const xf = doc.createElementNS(P, "p:xfrm");
    if (element.rotation)
      xf.setAttribute("rot", String(Math.round(element.rotation * 60000)));
    if (element.flipH) xf.setAttribute("flipH", "1");
    if (element.flipV) xf.setAttribute("flipV", "1");
    const off = doc.createElementNS(DRAWING_NS, "a:off"),
      ext = doc.createElementNS(DRAWING_NS, "a:ext");
    off.setAttribute("x", String(Math.round(element.x * 9525)));
    off.setAttribute("y", String(Math.round(element.y * 9525)));
    ext.setAttribute("cx", String(Math.round(element.width * 9525)));
    ext.setAttribute("cy", String(Math.round(element.height * 9525)));
    xf.append(off, ext);
    frame.append(xf);
    const graphic = doc.createElementNS(DRAWING_NS, "a:graphic"),
      graphicData = doc.createElementNS(DRAWING_NS, "a:graphicData"),
      node = doc.createElementNS(C, "c:chart");
    graphicData.setAttribute("uri", C);
    node.setAttributeNS(R, "r:id", id);
    graphicData.append(node);
    graphic.append(graphicData);
    frame.append(graphic);
    placeholder.replaceWith(frame);
  }
  zip.file("[Content_Types].xml", serial(contentTypes));
}

/** Run after original-node preservation. A copied chart's implicit palette and
 * theme fonts belong to its source, while the destination slide can use a
 * completely different theme. A chart-local override keeps both independent
 * without rebuilding series, formulas, styles, drawings or embedded workbooks.
 */
export async function writeChartThemes(zip: JSZip, deck: Deck) {
  if (
    !deck.slides.some((slide) =>
      slide.elements.some((element) => element.chart),
    )
  )
    return;
  const types = chartXml(
      await zip.file("[Content_Types].xml")!.async("string"),
    ),
    written = new Set<string>();
  for (const [index, slide] of deck.slides.entries()) {
    const elements = new Map(
      slide.elements
        .filter((element) => element.type === "chart" && element.chart)
        .map((element) => [element.id, element]),
    );
    if (!elements.size) continue;
    const slidePath = `ppt/slides/slide${index + 1}.xml`,
      doc = chartXml(await zip.file(slidePath)!.async("string")),
      slideRels = chartXml(
        await zip
          .file(`ppt/slides/_rels/slide${index + 1}.xml.rels`)!
          .async("string"),
      );
    const frames = list(doc, "graphicFrame").filter(
        (frame) => list(frame, "chart").length > 0,
      ),
      ordered = [...elements.values()],
      matched = new Set<string>();
    for (const [frameIndex, frame] of frames.entries()) {
      const props = list(frame, "cNvPr").find(
          (props) => props.parentElement?.parentElement === frame,
        ),
        key =
          props?.getElementsByTagNameNS(SS, "state")[0]?.getAttribute("key") ??
          props?.getAttribute("name"),
        named = ordered.filter(
          (element) =>
            element.name === props?.getAttribute("name") &&
            !matched.has(element.id),
        ),
        // Original-node preservation keeps source object names and z-order,
        // and can replace our generated state key. Fall back only when the
        // name is unique or the complete chart count still matches the model.
        element =
          (key ? elements.get(key) : undefined) ??
          (named.length === 1
            ? named[0]
            : frames.length === ordered.length
              ? ordered[frameIndex]
              : undefined),
        chart = list(frame, "chart")[0],
        id = chart?.getAttributeNS(R, "id"),
        rel = list(slideRels, "Relationship").find(
          (rel) =>
            rel.getAttribute("Id") === id &&
            rel.getAttribute("Type")?.endsWith("/chart") &&
            rel.getAttribute("TargetMode") !== "External",
        ),
        path = rel
          ? resolvePart(slidePath, rel.getAttribute("Target") ?? "")
          : undefined;
      if (!element?.chart || !path || written.has(path)) continue;
      matched.add(element.id);
      written.add(path);
      const source = element.chart,
        theme = readChartTheme(source),
        rootPart = source.parts.find((part) => part.path === source.root)!,
        themePath = rootPart.relationships.find(
          (rel) => rel.type.endsWith("/themeOverride") && !rel.external,
        )?.target,
        originalTheme = source.parts.find((part) => part.path === themePath),
        override = originalTheme
          ? chartXml(chartPartText(originalTheme.data))
          : chartXml(`<a:themeOverride xmlns:a="${DRAWING_NS}"/>`);
      if (
        !Array.from(override.documentElement.children).some(
          (child) => child.localName === "clrScheme",
        )
      ) {
        const scheme = override.createElementNS(DRAWING_NS, "a:clrScheme");
        scheme.setAttribute("name", "Source chart colors");
        for (const name of [
          "dk1",
          "lt1",
          "dk2",
          "lt2",
          "accent1",
          "accent2",
          "accent3",
          "accent4",
          "accent5",
          "accent6",
          "hlink",
          "folHlink",
        ]) {
          const entry = override.createElementNS(DRAWING_NS, "a:" + name),
            color = override.createElementNS(DRAWING_NS, "a:srgbClr");
          color.setAttribute("val", theme.colors[name].slice(1));
          entry.append(color);
          scheme.append(entry);
        }
        override.documentElement.insertBefore(
          scheme,
          override.documentElement.firstChild,
        );
      }
      if (
        !Array.from(override.documentElement.children).some(
          (child) => child.localName === "fontScheme",
        )
      ) {
        const fonts = override.createElementNS(DRAWING_NS, "a:fontScheme");
        fonts.setAttribute("name", "Source chart fonts");
        for (const [name, family] of [
          ["majorFont", theme.majorFont],
          ["minorFont", theme.minorFont],
        ]) {
          const font = override.createElementNS(DRAWING_NS, "a:" + name);
          for (const script of ["latin", "ea", "cs"]) {
            const face = override.createElementNS(DRAWING_NS, "a:" + script);
            face.setAttribute("typeface", script === "latin" ? family : "");
            font.append(face);
          }
          fonts.append(font);
        }
        const effects = Array.from(override.documentElement.children).find(
          (child) => child.localName === "fmtScheme",
        );
        override.documentElement.insertBefore(fonts, effects ?? null);
      }
      let outputPath = path.replace(/\.xml$/i, "") + "-source-theme.xml";
      const chartXmlDoc = chartXml(await zip.file(path)!.async("string")),
        map =
          Array.from(chartXmlDoc.documentElement.children).find(
            (child) => child.localName === "clrMapOvr",
          ) ?? chartXmlDoc.createElementNS(C, "c:clrMapOvr");
      for (const [key, value] of Object.entries(theme.mapping))
        map.setAttribute(key, value);
      if (!map.parentElement)
        chartXmlDoc.documentElement.insertBefore(
          map,
          Array.from(chartXmlDoc.documentElement.children).find((child) =>
            [
              "pivotSource",
              "protection",
              "chart",
              "spPr",
              "txPr",
              "externalData",
              "printSettings",
              "userShapes",
              "extLst",
            ].includes(child.localName),
          ) ?? null,
        );
      const bits = path.split("/"),
        name = bits.pop()!,
        relationshipPath = [...bits, "_rels", name + ".rels"].join("/"),
        relDoc = zip.file(relationshipPath)
          ? chartXml(await zip.file(relationshipPath)!.async("string"))
          : chartXml(`<Relationships xmlns="${PR}"/>`);
      let themeRel = list(relDoc, "Relationship").find((rel) =>
        rel.getAttribute("Type")?.endsWith("/themeOverride"),
      );
      // Our previous save already made this override independent. Reuse that
      // complete part instead of leaving a redundant theme at every roundtrip.
      if (
        originalTheme &&
        themeRel &&
        ["clrScheme", "fontScheme"].every((name) =>
          Array.from(
            chartXml(chartPartText(originalTheme.data)).documentElement
              .children,
          ).some((child) => child.localName === name),
        )
      )
        outputPath =
          resolvePart(path, themeRel.getAttribute("Target") ?? "") ??
          outputPath;
      if (!themeRel) {
        themeRel = relDoc.createElementNS(PR, "Relationship");
        themeRel.setAttribute(
          "Id",
          "rIdSourceTheme" + crypto.randomUUID().replaceAll("-", ""),
        );
        themeRel.setAttribute("Type", R + "/themeOverride");
        relDoc.documentElement.append(themeRel);
      }
      themeRel.setAttribute("Target", "/" + outputPath);
      themeRel.removeAttribute("TargetMode");
      zip.file(outputPath, serial(override));
      zip.file(path, serial(chartXmlDoc));
      zip.file(relationshipPath, serial(relDoc));
      const existingType = list(types, "Override").find(
          (type) => type.getAttribute("PartName") === "/" + outputPath,
        ),
        type = existingType ?? types.createElementNS(CT, "Override");
      type.setAttribute("PartName", "/" + outputPath);
      type.setAttribute(
        "ContentType",
        "application/vnd.openxmlformats-officedocument.themeOverride+xml",
      );
      if (!existingType) types.documentElement.append(type);
    }
  }
  zip.file("[Content_Types].xml", serial(types));
}
