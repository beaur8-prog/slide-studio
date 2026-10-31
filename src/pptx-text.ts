import { listNumberLabel } from "./list-numbering";
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
  hyperlinkColor?: string;
  link?: (node: Element | undefined) => TextRun["hyperlink"];
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
  // DrawingML numbering follows list levels, not the text body's paragraph
  // index. Blank paragraphs do not consume a number. An inherited startAt
  // initializes a sequence; a paragraph's own startAt explicitly restarts it.
  const numbering = new Map<number, { type: string; value: number }>();
  const paragraphs: TextParagraph[] = sourceParagraphs.map((p, index) => {
    const pPr = child(p, "pPr"),
      level = Math.min(8, Math.max(0, Math.floor(num([pPr], "lvl", 0)))) + 1;
    const props = [
      pPr,
      child(child(body, "lstStyle"), `lvl${level}pPr`),
      ...bodies.slice(1).flatMap((b) => [
        child(
          children(b, "p").find(
            (p) => num([child(p, "pPr")], "lvl", 0) === level - 1,
          ),
          "pPr",
        ),
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
      // A shape's own fontRef is its authored default text color. It must not
      // be masked by a less-specific master/presentation default (SmartArt
      // commonly uses a white fontRef on an accent-colored shape).
      const colorNodes = [
        r,
        defaults[0],
        ...(ctx.runDefaults ?? []),
        defaults[1],
        child(child(ctx.nodes[0], "style"), "fontRef"),
        ...bodies
          .slice(1)
          .flatMap((_, i) => [
            defaults[2 + i * 2],
            defaults[3 + i * 2],
            child(child(ctx.nodes[i + 1], "style"), "fontRef"),
          ]),
        ...defaults.slice(2 + (bodies.length - 1) * 2),
      ];
      const inheritedColor = colorNodes
        .map((n) => ctx.color(child(n, "solidFill")) ?? ctx.color(n))
        .find(Boolean);
      // Office applies the hyperlink theme appearance to a native hlinkClick
      // even when no explicit run formatting was authored. Generic paragraph
      // defaults must not mask it. Resolve appearance from the source node,
      // independently of whether its target passes our link policy.
      const linkNode = child(r, "hlinkClick");
      const hyperlink = ctx.link?.(linkNode);
      const color = linkNode
        ? (ctx.color(child(r, "solidFill")) ??
          ctx.color(r) ?? {
            color: ctx.hyperlinkColor ?? "#0563C1",
            opacity: 1,
          })
        : inheritedColor;
      if (textOpacity === undefined) textOpacity = color?.opacity ?? 1;
      const under = linkNode
        ? (r?.getAttribute("u") ?? "sng")
        : firstAttribute(nodes, "u", "none");
      return {
        text,
        ...(hyperlink ? { hyperlink } : {}),
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
        ...(nodes.some((n) => n?.hasAttribute("cap")) &&
        ["none", "small", "all"].includes(firstAttribute(nodes, "cap", "none"))
          ? { caps: firstAttribute(nodes, "cap", "none") as TextRun["caps"] }
          : {}),
        color: color?.color ?? ctx.defaultColor,
        opacity: color?.opacity ?? 1,
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
    // Bullet formatting is independent of the paragraph's body text. Resolve
    // the body metrics before inserting the synthetic, editable list label.
    const size = runs[0].fontSize ?? 32;
    const spacingSize = Math.max(...runs.map((run) => run.fontSize ?? size));
    const bulletNode = props
      .flatMap((n) => Array.from(n?.children ?? []))
      .find((n) => ["buNone", "buChar", "buAutoNum"].includes(n.localName));
    let bulletPrefix: string | undefined;
    let numberStyle: TextParagraph["numbering"];
    if (
      bulletNode?.localName !== "buNone" &&
      bulletNode &&
      runs.some((r) => r.text.trim())
    ) {
      let prefix = bulletNode.getAttribute("char") ?? "•";
      if (bulletNode.localName === "buAutoNum") {
        const type = bulletNode.getAttribute("type") ?? "arabicPeriod";
        const previous = numbering.get(level);
        const explicitStart = child(pPr, "buAutoNum")?.hasAttribute("startAt");
        const value =
          explicitStart || !previous || previous.type !== type
            ? num([bulletNode], "startAt", 1)
            : previous.value + 1;
        numbering.set(level, { type, value });
        for (const nested of numbering.keys())
          if (nested > level) numbering.delete(nested);
        numberStyle = { type, value };
        prefix = listNumberLabel(type, value);
      }
      bulletPrefix = prefix + " ";
      const bulletProperty = (...names: string[]) =>
        props
          .flatMap((n) => Array.from(n?.children ?? []))
          .find((n) => names.includes(n.localName));
      const bulletSize = bulletProperty("buSzPct", "buSzPts", "buSzTx");
      const bulletFont = bulletProperty("buFont", "buFontTx");
      const family =
        bulletFont?.localName === "buFont"
          ? ctx.font(
              bulletFont.getAttribute("typeface") || ctx.defaultFont,
              prefix,
            )
          : undefined;
      const bulletColor = bulletProperty("buClr", "buClrTx");
      runs.unshift({
        ...runs[0],
        text: bulletPrefix,
        fontSize:
          bulletSize?.localName === "buSzPct"
            ? Math.max(
                1,
                Math.min(
                  1000,
                  size *
                    Math.max(
                      0.25,
                      Math.min(4, num([bulletSize], "val", 100000) / 100000),
                    ),
                ),
              )
            : bulletSize?.localName === "buSzPts"
              ? Math.max(
                  1,
                  Math.min(
                    1000,
                    (num([bulletSize], "val", size * 75) / 75) *
                      Math.abs(ctx.sy) *
                      scale,
                  ),
                )
              : size,
        ...(family ? { fontFamily: family, fontFamilyEastAsian: family } : {}),
        ...(bulletColor?.localName === "buClr" && ctx.color(bulletColor)
          ? { color: ctx.color(bulletColor)!.color }
          : {}),
      });
    }
    const spacing = (name: string) => {
      const node = firstChild(props, name),
        pt = child(node, "spcPts"),
        pct = child(node, "spcPct");
      return pt
        ? (num([pt], "val", 0) / 75) * Math.abs(ctx.sy) * scale
        : pct
          ? (num([pct], "val", 0) / 100000) * spacingSize
          : 0;
    };
    const line = firstChild(props, "lnSpc"),
      linePt = child(line, "spcPts"),
      linePct = child(line, "spcPct");
    const align = firstAttribute(props, "algn", "l");
    return {
      runs,
      ...(bulletPrefix ? { bulletPrefix } : {}),
      ...(numberStyle ? { numbering: numberStyle } : {}),
      ...(level > 1 || pPr?.hasAttribute("lvl") ? { level: level - 1 } : {}),
      align: align === "ctr" ? "center" : align === "r" ? "right" : "left",
      fontSize: size,
      ...(linePt
        ? {
            lineSpacing:
              (num([linePt], "val", 0) / 75) * Math.abs(ctx.sy) * scale,
          }
        : {
            // Missing lnSpc uses the same single-line baseline as 100%.
            // CSS normal depends on the fallback font's metrics instead.
            lineHeight:
              Math.max(
                0.01,
                num([linePct], "val", 100000) / 100000 - lineReduction,
              ) * 1.2,
          }),
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
  const first =
    paragraphs[0].runs[paragraphs[0].bulletPrefix ? 1 : 0] ??
    paragraphs[0].runs[0];
  // Capitals are run-only styling; do not duplicate them on the shape model.
  const { caps: _caps, ...baseRun } = first;
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
  const vertical = firstAttribute(
    cp ? [cp, ...bodyProps] : bodyProps,
    "vert",
    "horz",
  );
  const diagramText = child(ctx.nodes[0], "txXfrm");
  const sourceTransform = child(child(ctx.nodes[0], "spPr"), "xfrm");
  const sourceOffset = child(sourceTransform, "off");
  const sourceExtent = child(sourceTransform, "ext");
  const textOffset = child(diagramText, "off");
  const textExtent = child(diagramText, "ext");
  const sourceWidth = num([sourceExtent], "cx", 0);
  const sourceHeight = num([sourceExtent], "cy", 0);
  // Diagram txXfrm coordinates share the shape's unrotated drawing space.
  // The rectangle and its relative rotation are independent of the shape's
  // outline; keep both instead of rotating the whole shape again.
  const diagramFrame: SlideElement["textFrame"] =
    diagramText && sourceWidth > 0 && sourceHeight > 0
      ? [
          (num([textOffset], "x", num([sourceOffset], "x", 0)) -
            num([sourceOffset], "x", 0)) /
            sourceWidth,
          (num([textOffset], "y", num([sourceOffset], "y", 0)) -
            num([sourceOffset], "y", 0)) /
            sourceHeight,
          num([textExtent], "cx", sourceWidth) / sourceWidth,
          num([textExtent], "cy", sourceHeight) / sourceHeight,
        ]
      : undefined;
  const degrees =
    (num(bodyProps, "rot", 0) + num([diagramText], "rot", 0)) / 60000;
  const textRotation = ((((degrees + 180) % 360) + 360) % 360) - 180;
  const g = ctx.geometry;
  return {
    id: crypto.randomUUID(),
    type: "text",
    ...g,
    ...(cp || ctx.preserveBox
      ? { textInsets: insets }
      : {
          x: g.x + insets[3],
          y: g.y + insets[0],
          width: Math.max(1, g.width - insets[1] - insets[3]),
          height: Math.max(1, g.height - insets[0] - insets[2]),
        }),
    ...baseRun,
    hyperlink: undefined,
    opacity: 1,
    text: paragraphText(paragraphs),
    paragraphs,
    ...(textRotation ? { textRotation } : {}),
    ...(diagramFrame &&
    diagramFrame.every((n) => Number.isFinite(n) && Math.abs(n) <= 10) &&
    diagramFrame[2] > 0 &&
    diagramFrame[3] > 0
      ? { textFrame: diagramFrame }
      : {}),
    ...(num(bodyProps, "numCol", 1) > 1
      ? {
          textColumns: Math.max(
            1,
            Math.min(16, Math.floor(num(bodyProps, "numCol", 1))),
          ),
          textColumnGap: Math.max(
            0,
            Math.min(
              100000,
              (num(bodyProps, "spcCol", 0) / 9525) * Math.abs(ctx.sx),
            ),
          ),
        }
      : {}),
    align: paragraphs[0].align,
    ...(fit?.localName === "spAutoFit" &&
    vertical === "horz" &&
    num(bodyProps, "numCol", 1) === 1
      ? { autoHeight: true }
      : {}),
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
