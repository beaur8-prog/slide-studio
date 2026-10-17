import type { SlideElement, TextParagraph, TextRun } from "./types";
import { paragraphBullet } from "./text-layout";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const child = (n: Element | undefined, name: string) =>
  Array.from(n?.children ?? []).find((c) => c.localName === name);
const first = (n: Element | Document, name: string) =>
  n.getElementsByTagNameNS("*", name)[0] as Element | undefined;

export function restoreLayoutXml(
  doc: Document,
  elements: SlideElement[],
): void {
  const make = (
    name: string,
    attrs: Record<string, string | number> = {},
    parent?: Element,
  ) => {
    const n = doc.createElementNS(A, "a:" + name);
    for (const [key, value] of Object.entries(attrs))
      n.setAttribute(key, String(value));
    parent?.appendChild(n);
    return n;
  };
  const names = new Map(
    Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).map((n) => [
      n.getAttribute("name"),
      n.parentElement?.parentElement,
    ]),
  );
  let nextId =
    Math.max(
      1,
      ...Array.from(doc.getElementsByTagNameNS("*", "cNvPr")).map(
        (n) => Number(n.getAttribute("id")) || 0,
      ),
    ) + 1;
  for (const el of elements) {
    const node = names.get(el.id);
    if (!node) continue;
    if (
      (el.shape === "line" || el.shape === "arrow") &&
      (el.lineStart || el.lineEnd)
    ) {
      const line = child(child(node, "spPr"), "ln");
      if (line) {
        for (const [name, marker] of [
          ["headEnd", el.lineStart],
          ["tailEnd", el.lineEnd],
        ] as const) {
          if (!marker) continue;
          child(line, name)?.remove();
          make(
            name,
            { type: marker.type, w: marker.width, len: marker.length },
            line,
          );
        }
      }
    }
    if (el.shape === "roundRect" && el.cornerRadius !== undefined) {
      const geometry = child(child(node, "spPr"), "prstGeom");
      if (geometry) {
        const adjustments =
          child(geometry, "avLst") ?? make("avLst", {}, geometry);
        for (const guide of Array.from(adjustments.children))
          if (guide.getAttribute("name") === "adj") guide.remove();
        const shortestSide = Math.min(el.width, el.height);
        const radius = Math.max(0, Math.min(el.cornerRadius, shortestSide / 2));
        // PptxGenJS omits a zero rectRadius; write the explicit adjustment so
        // square corners survive a round trip instead of regaining the preset.
        make(
          "gd",
          {
            name: "adj",
            fmla: `val ${shortestSide > 0 ? Math.round((radius / shortestSide) * 100000) : 0}`,
          },
          adjustments,
        );
      }
    }
    if (
      el.borders &&
      !el.borders.every(
        (b) =>
          b.color === el.borders![0].color && b.width === el.borders![0].width,
      )
    ) {
      const corners = [
          [0, 0],
          [el.width, 0],
          [el.width, el.height],
          [0, el.height],
        ],
        angle = (el.rotation * Math.PI) / 180;
      const rotate = ([x, y]: number[]) => [
        el.x +
          el.width / 2 +
          (x - el.width / 2) * Math.cos(angle) -
          (y - el.height / 2) * Math.sin(angle),
        el.y +
          el.height / 2 +
          (x - el.width / 2) * Math.sin(angle) +
          (y - el.height / 2) * Math.cos(angle),
      ];
      const pNode = (name: string, parent?: Element) => {
        const n = doc.createElementNS(P, "p:" + name);
        parent?.appendChild(n);
        return n;
      };
      el.borders.forEach((b, i) => {
        if (!b.width || b.color === "transparent") return;
        const [x1, y1] = rotate(corners[i]),
          [x2, y2] = rotate(corners[(i + 1) % 4]);
        const shape = pNode("cxnSp"),
          nv = pNode("nvCxnSpPr", shape),
          pr = pNode("cNvPr", nv);
        pr.setAttribute("id", String(nextId++));
        pr.setAttribute("name", `${el.id}-edge-${i}`);
        pNode("cNvCxnSpPr", nv);
        pNode("nvPr", nv);
        const sp = pNode("spPr", shape),
          xf = make("xfrm", {}, sp);
        if ((x2 - x1) * (y2 - y1) < 0) xf.setAttribute("flipV", "1");
        make(
          "off",
          {
            x: Math.round(Math.min(x1, x2) * 9525),
            y: Math.round(Math.min(y1, y2) * 9525),
          },
          xf,
        );
        make(
          "ext",
          {
            cx: Math.round(Math.abs(x2 - x1) * 9525),
            cy: Math.round(Math.abs(y2 - y1) * 9525),
          },
          xf,
        );
        make("prstGeom", { prst: "line" }, sp);
        const line = make("ln", { w: Math.round(b.width * 9525) }, sp),
          color = make(
            "srgbClr",
            { val: b.color.slice(1) },
            make("solidFill", {}, line),
          );
        if (el.opacity !== 1)
          make("alpha", { val: Math.round(el.opacity * 100000) }, color);
        node.parentElement?.insertBefore(shape, node.nextSibling);
      });
    }
    if (el.type === "text") {
      const body = child(node, "txBody");
      if (!body) continue;
      const bp = child(body, "bodyPr");
      if (bp) {
        // The model stores effective spacing after source edge suppression.
        bp.setAttribute("spcFirstLastPara", "1");
        if (el.textInsets)
          ["tIns", "rIns", "bIns", "lIns"].forEach((name, i) =>
            bp.setAttribute(name, String(Math.round(el.textInsets![i] * 9525))),
          );
        bp.setAttribute(
          "vertOverflow",
          el.textOverflow === "hidden" ? "clip" : "overflow",
        );
        bp.setAttribute("horzOverflow", "overflow");
        bp.setAttribute(
          "vert",
          el.writingMode === "stacked"
            ? "eaVert"
            : el.writingMode === "vertical"
              ? "vert"
              : el.writingMode === "vertical270"
                ? "vert270"
                : "horz",
        );
      }
      if (!el.paragraphs) continue;
      for (const p of Array.from(body.children).filter(
        (n) => n.localName === "p",
      ))
        p.remove();
      const runProps = (parent: Element, run: TextRun, name = "rPr") => {
        const n = make(
          name,
          {
            sz: Math.round((run.fontSize ?? el.fontSize ?? 32) * 75),
            b: (run.bold ?? el.bold) ? "1" : "0",
            i: (run.italic ?? el.italic) ? "1" : "0",
            u: (run.underline ?? el.underline) ? "sng" : "none",
            lang: run.language ?? el.language ?? "ko-KR",
          },
          parent,
        );
        if (run.baseline) n.setAttribute("baseline", String(run.baseline));
        if (run.letterSpacing !== undefined)
          n.setAttribute("spc", String(Math.round(run.letterSpacing * 75)));
        if (run.kerning !== undefined)
          n.setAttribute("kern", String(Math.round(run.kerning * 75)));
        const color = make(
          "srgbClr",
          { val: (run.color ?? el.color ?? "#172033").slice(1) },
          make("solidFill", {}, n),
        );
        if (el.opacity !== 1)
          make("alpha", { val: Math.round(el.opacity * 100000) }, color);
        for (const family of ["latin", "ea", "cs"])
          make(
            family,
            {
              typeface:
                (family === "ea"
                  ? (run.fontFamilyEastAsian ??
                    run.fontFamily ??
                    el.fontFamilyEastAsian)
                  : undefined) ??
                run.fontFamily ??
                el.fontFamily ??
                "Arial",
            },
            n,
          );
      };
      for (const paragraph of el.paragraphs) {
        const p = make("p", {}, body),
          pr = make(
            "pPr",
            {
              algn:
                paragraph.align === "center"
                  ? "ctr"
                  : paragraph.align === "right"
                    ? "r"
                    : "l",
            },
            p,
          );
        const paragraphAttrs = {
          marL: paragraph.marginLeft,
          marR: paragraph.marginRight,
          indent: paragraph.indent,
          defTabSz: paragraph.tabSize,
        };
        for (const [key, value] of Object.entries(paragraphAttrs))
          if (value !== undefined)
            pr.setAttribute(key, String(Math.round(value * 9525)));
        for (const [key, value] of [
          ["latinLnBrk", paragraph.latinLineBreak],
          ["eaLnBrk", paragraph.eastAsianLineBreak],
          ["hangingPunct", paragraph.hangingPunctuation],
        ] as const)
          if (value !== undefined) pr.setAttribute(key, value ? "1" : "0");
        if (paragraph.lineSpacing !== undefined)
          make(
            "spcPts",
            { val: Math.round(paragraph.lineSpacing * 75) },
            make("lnSpc", {}, pr),
          );
        else if (paragraph.lineHeight !== undefined)
          make(
            "spcPct",
            { val: Math.round((paragraph.lineHeight / 1.2) * 100000) },
            make("lnSpc", {}, pr),
          );
        for (const [key, value] of [
          ["spcBef", paragraph.spaceBefore],
          ["spcAft", paragraph.spaceAfter],
        ] as const)
          if (value !== undefined)
            make("spcPts", { val: Math.round(value * 75) }, make(key, {}, pr));
        const bullet = paragraphBullet(paragraph);
        // Labels are already resolved in the editable model. Export a literal
        // bullet so PowerPoint preserves its hanging indent without a fake space.
        if (bullet) {
          const marker = paragraph.runs[0];
          // The marker run stores its resolved size/face/color separately from
          // the body. A defRPr alone would resize the body on reimport.
          make(
            "srgbClr",
            { val: (marker.color ?? el.color ?? "#172033").slice(1) },
            make("buClr", {}, pr),
          );
          make(
            "buSzPts",
            {
              val: Math.round(
                (marker.fontSize ?? paragraph.fontSize ?? el.fontSize ?? 32) *
                  75,
              ),
            },
            pr,
          );
          make(
            "buFont",
            { typeface: marker.fontFamily ?? el.fontFamily ?? "Arial" },
            pr,
          );
          make("buChar", { char: bullet.label }, pr);
          runProps(
            pr,
            {
              ...(bullet.runs[0] ?? marker),
              fontSize: paragraph.fontSize ?? bullet.runs[0]?.fontSize,
              text: "",
            },
            "defRPr",
          );
        } else make("buNone", {}, pr);
        for (const run of bullet?.runs ?? paragraph.runs) {
          const lines = run.text.split("\n");
          lines.forEach((text, index) => {
            if (index) runProps(make("br", {}, p), run);
            if (!text) return;
            const r = make("r", {}, p);
            runProps(r, run);
            const t = make("t", {}, r);
            t.textContent = text;
          });
        }
        runProps(
          p,
          {
            ...paragraph.runs.at(-1),
            fontSize: paragraph.fontSize ?? paragraph.runs.at(-1)?.fontSize,
            text: "",
          },
          "endParaRPr",
        );
      }
    }
    if (el.type === "image" && el.crop) {
      const fill = child(node, "blipFill");
      if (!fill) continue;
      const crop = child(fill, "srcRect") ?? make("srcRect");
      ["t", "r", "b", "l"].forEach((name, i) =>
        crop.setAttribute(name, String(Math.round(el.crop![i] * 100000))),
      );
      fill.insertBefore(crop, child(fill, "stretch") ?? null);
    }
    if (el.shape === "custom" && el.paths) {
      const props = child(node, "spPr");
      if (!props) continue;
      const geom = make("custGeom");
      make("avLst", {}, geom);
      make("gdLst", {}, geom);
      make("ahLst", {}, geom);
      make("cxnLst", {}, geom);
      make("rect", { l: "l", t: "t", r: "r", b: "b" }, geom);
      const list = make("pathLst", {}, geom);
      for (const source of el.paths) {
        const path = make(
          "path",
          {
            w: Math.round(source.width),
            h: Math.round(source.height),
            fill: source.fill ? "norm" : "none",
            stroke: source.stroke ? "1" : "0",
          },
          list,
        );
        const tokens =
          source.d.match(/[MLCQAZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
        let i = 0,
          x = 0,
          y = 0;
        const number = () => {
          const n = Number(tokens[i++]);
          if (!Number.isFinite(n)) throw Error("Invalid drawing path");
          return n;
        };
        const point = (parent: Element, px: number, py: number) =>
          make("pt", { x: Math.round(px), y: Math.round(py) }, parent);
        while (i < tokens.length) {
          const command = tokens[i++];
          if (command === "Z") {
            make("close", {}, path);
            continue;
          }
          if (command === "M" || command === "L") {
            x = number();
            y = number();
            point(make(command === "M" ? "moveTo" : "lnTo", {}, path), x, y);
          } else if (command === "C" || command === "Q") {
            const n = make(
              command === "C" ? "cubicBezTo" : "quadBezTo",
              {},
              path,
            );
            for (let j = 0; j < (command === "C" ? 3 : 2); j++) {
              x = number();
              y = number();
              point(n, x, y);
            }
          } else if (command === "A") {
            let rx = number(),
              ry = number();
            const rotation = number(),
              large = number(),
              sweep = number(),
              nx = number(),
              ny = number();
            if (rotation !== 0 || rx <= 0 || ry <= 0)
              throw Error("Unsupported ellipse rotation");
            const dx = (x - nx) / 2,
              dy = (y - ny) / 2,
              lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
            if (lambda > 1) {
              rx *= Math.sqrt(lambda);
              ry *= Math.sqrt(lambda);
            }
            const denom = rx * rx * dy * dy + ry * ry * dx * dx;
            const factor =
              (large === sweep ? -1 : 1) *
              Math.sqrt(
                Math.max(
                  0,
                  (rx * rx * ry * ry - denom) / Math.max(1e-20, denom),
                ),
              );
            const cx = (x + nx) / 2 + (factor * rx * dy) / ry,
              cy = (y + ny) / 2 - (factor * ry * dx) / rx;
            const start = Math.atan2((y - cy) / ry, (x - cx) / rx),
              end = Math.atan2((ny - cy) / ry, (nx - cx) / rx);
            let swing = end - start;
            if (sweep && swing < 0) swing += 2 * Math.PI;
            if (!sweep && swing > 0) swing -= 2 * Math.PI;
            make(
              "arcTo",
              {
                wR: Math.round(rx),
                hR: Math.round(ry),
                stAng: Math.round(((start * 180) / Math.PI) * 60000),
                swAng: Math.round(((swing * 180) / Math.PI) * 60000),
              },
              path,
            );
            x = nx;
            y = ny;
          } else throw Error("Unsupported drawing path");
        }
      }
      const existing = child(props, "prstGeom") ?? child(props, "custGeom");
      if (existing) existing.replaceWith(geom);
      else props.insertBefore(geom, child(props, "solidFill") ?? null);
    }
  }
}
