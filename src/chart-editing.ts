import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import type { ChartData, SlideElement } from "./types";
import type { ChartDatum, ChartKind, InsertCanvas } from "./insert-content";
import { element } from "./model";
import {
  chartPartText,
  chartXml,
  child,
  readChartModel,
  CHART_NS,
} from "./chart";
import { readChartPackage } from "./pptx-chart";

const EDITOR_NS = "https://slide-studio.local/chart-editor/1";
const EXTENSION = "{16AB29E1-5EE2-4CBC-8344-76AFDA2E574A}";

export interface EditableChart {
  kind: ChartKind;
  title: string;
  color: string;
  textColor: string;
  fontFamily: string;
  data: ChartDatum[];
}

export function validateEditableChart(draft: EditableChart) {
  if (
    !["column", "bar", "line", "pie"].includes(draft.kind) ||
    !/^#[\da-f]{6}$/i.test(draft.color) ||
    !/^#[\da-f]{6}$/i.test(draft.textColor) ||
    draft.title.length > 80 ||
    !draft.fontFamily ||
    draft.fontFamily.length > 200 ||
    !draft.data.length ||
    draft.data.length > 12 ||
    draft.data.some(
      (d) =>
        !d.label.trim() ||
        d.label.length > 30 ||
        /[\r\n]/.test(d.label) ||
        !Number.isFinite(d.value) ||
        Math.abs(d.value) > 1e9,
    )
  )
    throw Error(
      "차트의 제목·색상·데이터를 확인하세요. 항목은 1~12개까지 지원합니다.",
    );
  if (
    draft.kind === "pie" &&
    (draft.data.some((d) => d.value < 0) ||
      draft.data.reduce((sum, d) => sum + d.value, 0) <= 0)
  )
    throw Error("원형 차트는 음수 없이, 합계가 0보다 커야 합니다.");
}

/** Only charts authored with this editor are rebuilt. Other native charts keep
 * their original series, styling, external links and embedded workbook intact.
 * Always read standard OOXML values, rather than a redundant private snapshot,
 * so a later PowerPoint edit does not restore stale data on reopening here.
 */
export function readEditableChart(chart?: ChartData): EditableChart | null {
  if (!chart) return null;
  try {
    const root = chartXml(
      chartPartText(chart.parts.find((p) => p.path === chart.root)!.data),
    );
    if (!root.getElementsByTagNameNS(EDITOR_NS, "editableChart").length)
      return null;
    const model = readChartModel(chart),
      plot = model.plots[0];
    if (
      model.approximate ||
      model.plots.length !== 1 ||
      plot?.series.length !== 1 ||
      !["bar", "line", "pie"].includes(plot.kind) ||
      chart.parts.some((p) => p.relationships.some((r) => r.external))
    )
      return null;
    const series = plot.series[0];
    if (
      series.values.length !== series.labels.length ||
      series.values.some((v) => v === null)
    )
      return null;
    const draft: EditableChart = {
      kind:
        plot.kind === "bar"
          ? plot.horizontal
            ? "bar"
            : "column"
          : (plot.kind as "line" | "pie"),
      title: model.title,
      color:
        plot.kind === "pie"
          ? (series.pointColors[0] ?? series.color)
          : series.color,
      textColor: model.textColor,
      fontFamily: model.fontFamily,
      data: series.values.map((value, i) => ({
        label: series.labels[i],
        value: value!,
      })),
    };
    validateEditableChart(draft);
    return draft;
  } catch {
    return null;
  }
}

export const sameChartDraft = (a: EditableChart, b: EditableChart) =>
  a.kind === b.kind &&
  a.title.trim() === b.title.trim() &&
  a.color.toLowerCase() === b.color.toLowerCase() &&
  a.textColor.toLowerCase() === b.textColor.toLowerCase() &&
  a.fontFamily === b.fontFamily &&
  a.data.length === b.data.length &&
  a.data.every(
    (d, i) => d.label === b.data[i].label && d.value === b.data[i].value,
  );

export function chartDataText(data: ChartDatum[]) {
  // Quote every category: commas, tabs and literal quotes must survive editing.
  return (
    "항목,값\n" +
    data.map((d) => `"${d.label.replaceAll('"', '""')}",${d.value}`).join("\n")
  );
}

export async function createEditableChart(
  draft: EditableChart,
  canvas: Pick<InsertCanvas, "width" | "height">,
): Promise<SlideElement> {
  validateEditableChart(draft);
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "STUDIO_CHART",
    width: canvas.width / 96,
    height: canvas.height / 96,
  });
  pptx.layout = "STUDIO_CHART";
  pptx.theme = {
    headFontFace: draft.fontFamily,
    bodyFontFace: draft.fontFamily,
  };
  const frame = {
    x: canvas.width * 0.1,
    y: canvas.height * 0.12,
    width: canvas.width * 0.8,
    height: canvas.height * 0.76,
  };
  const palette = [
    draft.color.slice(1),
    "ED7D31",
    "70AD47",
    "8064A2",
    "5B9BD5",
    "FFC000",
  ];
  pptx.addSlide().addChart(
    draft.kind === "column" || draft.kind === "bar"
      ? pptx.ChartType.bar
      : pptx.ChartType[draft.kind],
    [
      {
        name: "값",
        labels: draft.data.map((d) => d.label),
        values: draft.data.map((d) => d.value),
      },
    ],
    {
      x: frame.x / 96,
      y: frame.y / 96,
      w: frame.width / 96,
      h: frame.height / 96,
      barDir: draft.kind === "bar" ? "bar" : "col",
      barGrouping: "clustered",
      chartColors: draft.kind === "pie" ? palette : [palette[0]],
      showTitle: !!draft.title.trim(),
      title: draft.title.trim(),
      titleFontFace: draft.fontFamily,
      titleFontSize: 24,
      titleColor: draft.textColor.slice(1),
      showLegend: draft.kind === "pie",
      legendPos: "b",
      legendFontFace: draft.fontFamily,
      legendFontSize: 14,
      legendColor: draft.textColor.slice(1),
      catAxisLabelFontFace: draft.fontFamily,
      valAxisLabelFontFace: draft.fontFamily,
      catAxisLabelFontSize: 14,
      valAxisLabelFontSize: 14,
      catAxisLabelColor: draft.textColor.slice(1),
      valAxisLabelColor: draft.textColor.slice(1),
      catGridLine: { style: "none" },
      valGridLine: { color: "D7DCE2", size: 0.5 },
      lineSize: 2.5,
      lineDataSymbol: "circle",
      lineDataSymbolSize: 5,
      showValue: false,
    },
  );
  const zip = await JSZip.loadAsync(
    await pptx.write({ outputType: "uint8array", compression: true }),
  );
  const rootPath = Object.keys(zip.files).find((p) =>
    /^ppt\/charts\/chart\d+\.xml$/.test(p),
  );
  if (!rootPath) throw Error("차트를 생성하지 못했습니다.");
  const colors = Object.fromEntries(
    palette.map((c, i) => [`accent${i + 1}`, "#" + c]),
  );
  const chart = await readChartPackage(
    rootPath,
    colors,
    draft.fontFamily,
    async (p) => zip.file(p)?.async("uint8array"),
    async (p) => {
      const bits = p.split("/"),
        name = bits.pop()!;
      const xml = await zip
        .file([...bits, "_rels", name + ".rels"].join("/"))
        ?.async("string");
      if (!xml) return [];
      return Array.from(chartXml(xml).documentElement.children).map((r) => {
        const external = r.getAttribute("TargetMode") === "External",
          target = r.getAttribute("Target")!;
        const resolved = target.startsWith("/")
          ? target.slice(1)
          : new URL(target, "https://opc.invalid/" + p).pathname.slice(1);
        return {
          id: r.getAttribute("Id")!,
          type: r.getAttribute("Type")!,
          external,
          ...(external ? { target } : { path: resolved }),
        };
      });
    },
  );
  const part = chart.parts.find((p) => p.path === chart.root)!;
  const doc = chartXml(chartPartText(part.data));
  // Store only an editor/version marker. The native chart and workbook remain
  // the single source of data and can be edited by PowerPoint without us.
  const extensions =
    child(doc.documentElement, "extLst") ??
    doc.createElementNS(CHART_NS, "c:extLst");
  const extension = doc.createElementNS(CHART_NS, "c:ext");
  extension.setAttribute("uri", EXTENSION);
  extension.append(doc.createElementNS(EDITOR_NS, "ss:editableChart"));
  extensions.append(extension);
  if (!extensions.parentNode) doc.documentElement.append(extensions);
  const bytes = new TextEncoder().encode(
    new XMLSerializer().serializeToString(doc),
  );
  part.data = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
  return element("chart", {
    ...frame,
    name: draft.title.trim() || "차트",
    chart,
  });
}
