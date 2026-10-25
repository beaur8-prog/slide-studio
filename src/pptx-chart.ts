import type JSZip from "jszip";
import type { ChartData, ChartPart, SlideElement } from "./types";
import {
  chartXml,
  chartPartText,
  decodeChartPart,
  validateChart,
  chartRelationshipAllowed,
  MAX_CHART_BYTES,
  DRAWING_NS,
} from "./chart";

const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const serial = (doc: Document) => new XMLSerializer().serializeToString(doc);
const list = (doc: Document, name: string) =>
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
          const color = chart.colors[scheme.getAttribute("val") ?? ""];
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
