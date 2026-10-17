import type { SlideElement, TextParagraph, TextRun } from "./types";
import { paragraphText } from "./text-layout";

const child = (n: Element | undefined, name: string) =>
  Array.from(n?.children ?? []).find((c) => c.localName === name);
const children = (n: Element | undefined, name: string) =>
  Array.from(n?.children ?? []).filter((c) => c.localName === name);
const firstAttribute = (
  nodes: (Element | undefined)[],
  key: string,
  fallback: string,
) => nodes.find((n) => n?.hasAttribute(key))?.getAttribute(key) ?? fallback;
const num = (nodes: (Element | undefined)[], key: string, fallback: number) => {
  const n = Number(firstAttribute(nodes, key, String(fallback)));
  return Number.isFinite(n) ? n : fallback;
};
const firstChild = (nodes: (Element | undefined)[], name: string) =>
  nodes.map((n) => child(n, name)).find(Boolean);
interface Context {
  nodes: (Element | undefined)[];
  masterStyle?: Element;
  defaultStyle?: Element;
  font: (name: string, text?: string, language?: string) => string;
  defaultFont: string;
  color: (
    node: Element | undefined,
  ) => { color: string; opacity: number } | undefined;
  defaultColor: string;
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  };
  sx: number;
  sy: number;
  cellProperties?: Element;
  runDefaults?: Element[];
  preserveBox?: boolean;
}

export function readTextBody(body: Element, ctx: Context): SlideElement {
  let textOpacity: number | undefined;
  const bodies = [body, ...ctx.nodes.slice(1).map((n) => child(n, "txBody"))];
  const bodyProps = bodies.map((n) => child(n, "bodyPr"));
  const fit = bodyProps
    .flatMap((n) => Array.from(n?.children ?? []))
    .find((n) =>
      ["normAutofit", "noAutofit", "spAutoFit"].includes(n.localName),
    );
  const scale =
    fit?.localName === "normAutofit"
      ? Math.max(0.01, Math.min(1, num([fit], "fontScale", 100000) / 100000))
      : 1;
  const lineReduction =
    fit?.localName === "normAutofit"
      ? Math.max(0, Math.min(0.99, num([fit], "lnSpcReduction", 0) / 100000))
      : 0;
  const edgeSpacing = ["1", "true", "on"].includes(
    firstAttribute(bodyProps, "spcFirstLastPara", "0"),
  );
  const sourceParagraphs = children(body, "p");
  const paragraphs: TextParagraph[] = sourceParagraphs.map((p, index) => {
    const pPr = child(p, "pPr"),
      level = Math.min(8, Math.max(0, num([pPr], "lvl", 0))) + 1;
    const props = [
      pPr,
      child(child(body, "lstStyle"), `lvl${level}pPr`),
      ...bodies
        .slice(1)
        .flatMap((b) => [
          child(children(b, "p")[0], "pPr"),
          child(child(b, "lstStyle"), `lvl${level}pPr`),
        ]),
      child(ctx.masterStyle, `lvl${level}pPr`),
      child(ctx.defaultStyle, `lvl${level}pPr`),
    ];
    const defaults = props.map((n) => child(n, "defRPr"));
    const style = (r: Element | undefined, text: string): TextRun => {
      const nodes = [
        r,
        defaults[0],
        ...(ctx.runDefaults ?? []),
        ...defaults.slice(1),
      ];
      // Script fonts inherit independently. One Hangul character must not
      // replace the Latin face for every character in a mixed-script run.
      const face = (script: string) =>
        nodes
          .map((n) => child(n, script)?.getAttribute("typeface"))
          .find(Boolean);
      const latin = face("latin") || ctx.defaultFont;
      const eastAsian = face("ea") || latin;
      const language = firstAttribute(nodes, "lang", "");
      const color =
        nodes
          .map((n) => ctx.color(child(n, "solidFill")) ?? ctx.color(n))
          .find(Boolean) ??
        ctx.nodes
          .map((n) => ctx.color(child(child(n, "style"), "fontRef")))
          .find(Boolean);
      if (textOpacity === undefined) textOpacity = color?.opacity ?? 1;
      const under = firstAttribute(nodes, "u", "none");
      return {
        text,
        fontFamily: ctx.font(latin, text, language),
        fontFamilyEastAsian: ctx.font(eastAsian, text, language),
        ...(language ? { language } : {}),
        letterSpacing: (num(nodes, "spc", 0) / 75) * Math.abs(ctx.sx) * scale,
        ...(nodes.some((n) => n?.hasAttribute("kern"))
          ? { kerning: (num(nodes, "kern", 0) / 75) * Math.abs(ctx.sy) * scale }
          : {}),
        fontSize: Math.max(
          1,
          Math.min(
            1000,
            (num(nodes, "sz", 2400) / 75) * Math.abs(ctx.sy) * scale,
          ),
        ),
        bold: ["1", "true", "on"].includes(firstAttribute(nodes, "b", "0")),
        italic: ["1", "true", "on"].includes(firstAttribute(nodes, "i", "0")),
        underline: under !== "none",
        color: color?.color ?? ctx.defaultColor,
        ...(num(nodes, "baseline", 0)
          ? { baseline: num(nodes, "baseline", 0) }
          : {}),
      };
    };
    const runs: TextRun[] = Array.from(p.children).flatMap((n) => {
      if (n.localName === "br") return [style(child(n, "rPr"), "\n")];
      if (n.localName === "r" || n.localName === "fld")
        return [style(child(n, "rPr"), child(n, "t")?.textContent ?? "")];
      return [];
    });
    if (!runs.length) runs.push(style(child(p, "endParaRPr"), ""));
    const bulletNode = props
      .flatMap((n) => Array.from(n?.children ?? []))
      .find((n) => ["buNone", "buChar", "buAutoNum"].includes(n.localName));
    if (
      bulletNode?.localName !== "buNone" &&
      bulletNode &&
      runs.some((r) => r.text.trim())
    ) {
      const prefix =
        bulletNode.localName === "buChar"
          ? (bulletNode.getAttribute("char") ?? "•")
          : `${num([bulletNode], "startAt", 1) + index}.`;
      runs.unshift({ ...runs[0], text: prefix + " " });
    }
    const size = runs[0].fontSize ?? 32;
    const spacing = (name: string) => {
      const node = firstChild(props, name),
        pt = child(node, "spcPts"),
        pct = child(node, "spcPct");
      return pt
        ? (num([pt], "val", 0) / 75) * Math.abs(ctx.sy) * scale
        : pct
          ? (num([pct], "val", 0) / 100000) * size
          : 0;
    };
    const line = firstChild(props, "lnSpc"),
      linePt = child(line, "spcPts"),
      linePct = child(line, "spcPct");
    const align = firstAttribute(props, "algn", "l");
    return {
      runs,
      align: align === "ctr" ? "center" : align === "r" ? "right" : "left",
      fontSize: size,
      ...(linePt
        ? {
            lineSpacing:
              (num([linePt], "val", 0) / 75) * Math.abs(ctx.sy) * scale,
          }
        : linePct
          ? {
              lineHeight:
                Math.max(
                  0.01,
                  num([linePct], "val", 100000) / 100000 - lineReduction,
                ) * 1.2,
            }
          : {}),
      spaceBefore: index === 0 && !edgeSpacing ? 0 : spacing("spcBef"),
      spaceAfter:
        index === sourceParagraphs.length - 1 && !edgeSpacing
          ? 0
          : spacing("spcAft"),
      marginLeft: (num(props, "marL", 0) / 9525) * Math.abs(ctx.sx),
      marginRight: (num(props, "marR", 0) / 9525) * Math.abs(ctx.sx),
      indent: (num(props, "indent", 0) / 9525) * Math.abs(ctx.sx),
      tabSize: (num(props, "defTabSz", 914400) / 9525) * Math.abs(ctx.sx),
      latinLineBreak: ["1", "true", "on"].includes(
        firstAttribute(props, "latinLnBrk", "0"),
      ),
      eastAsianLineBreak: !["0", "false", "off"].includes(
        firstAttribute(props, "eaLnBrk", "1"),
      ),
      hangingPunctuation: ["1", "true", "on"].includes(
        firstAttribute(props, "hangingPunct", "0"),
      ),
    };
  });
  if (!paragraphs.length) paragraphs.push({ runs: [{ text: "" }] });
  const first = paragraphs[0].runs[0];
  const cp = ctx.cellProperties;
  const insets: [number, number, number, number] = cp
    ? [
        num([cp], "marT", 45720),
        num([cp], "marR", 91440),
        num([cp], "marB", 45720),
        num([cp], "marL", 91440),
      ]
    : [
        num(bodyProps, "tIns", 45720),
        num(bodyProps, "rIns", 91440),
        num(bodyProps, "bIns", 45720),
        num(bodyProps, "lIns", 91440),
      ];
  for (let i = 0; i < 4; i++)
    insets[i] = Math.max(
      0,
      (insets[i] / 9525) * Math.abs(i % 2 ? ctx.sx : ctx.sy),
    );
  const anchor = firstAttribute(
    cp ? [cp, ...bodyProps] : bodyProps,
    "anchor",
    "t",
  );
  const vertical = firstAttribute(bodyProps, "vert", "horz");
  const g = ctx.geometry;
  return {
    id: crypto.randomUUID(),
    type: "text",
    ...g,
    opacity: textOpacity ?? 1,
    ...(cp || ctx.preserveBox
      ? { textInsets: insets }
      : {
          x: g.x + insets[3],
          y: g.y + insets[0],
          width: Math.max(1, g.width - insets[1] - insets[3]),
          height: Math.max(1, g.height - insets[0] - insets[2]),
        }),
    ...first,
    text: paragraphText(paragraphs),
    paragraphs,
    align: paragraphs[0].align,
    verticalAlign:
      anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
    wrap:
      vertical !== "horz" && fit?.localName === "spAutoFit"
        ? false
        : firstAttribute(bodyProps, "wrap", "square") !== "none",
    textOverflow:
      firstAttribute(bodyProps, "vertOverflow", "overflow") === "clip"
        ? "hidden"
        : "visible",
    writingMode:
      vertical === "eaVert"
        ? "stacked"
        : vertical === "vert270"
          ? "vertical270"
          : vertical === "vert"
            ? "vertical"
            : "horizontal",
  };
}
