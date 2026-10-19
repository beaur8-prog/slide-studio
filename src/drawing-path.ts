import { drawingGuides } from "./drawing-guides";
import type { ShapePath } from "./types";

const child = (n: Element, name: string) =>
  Array.from(n.children).find((c) => c.localName === name);
// Rebuild geometry from numeric DrawingML commands. Never inject source SVG/XML.
export function drawingPaths(
  geometry: Element | undefined,
  fallback?: { width: number; height: number },
): ShapePath[] | undefined {
  const paths = geometry && child(geometry, "pathLst");
  if (!paths) return undefined;
  try {
    const resolve = drawingGuides(
      geometry!,
      fallback?.width ?? 21600,
      fallback?.height ?? 21600,
    );
    return Array.from(paths.children).map((path) => {
      const width = Number(path.getAttribute("w") ?? fallback?.width),
        height = Number(path.getAttribute("h") ?? fallback?.height);
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      )
        throw Error("dimensions");
      let x = 0,
        y = 0,
        startX = 0,
        startY = 0;
      const d: string[] = [];
      const point = (p: Element) => {
        const a = resolve(p.getAttribute("x")),
          b = resolve(p.getAttribute("y"));
        if (
          !Number.isFinite(a) ||
          !Number.isFinite(b) ||
          Math.abs(a) > 1e12 ||
          Math.abs(b) > 1e12
        )
          throw Error("point");
        return [a, b];
      };
      for (const command of Array.from(path.children)) {
        const pts = Array.from(command.children)
          .filter((n) => n.localName === "pt")
          .map(point);
        if (command.localName === "close") {
          d.push("Z");
          x = startX;
          y = startY;
        } else if (
          ["moveTo", "lnTo", "cubicBezTo", "quadBezTo"].includes(
            command.localName,
          )
        ) {
          const names: Record<string, string> = {
            moveTo: "M",
            lnTo: "L",
            cubicBezTo: "C",
            quadBezTo: "Q",
          };
          const expected: Record<string, number> = {
            moveTo: 1,
            lnTo: 1,
            cubicBezTo: 3,
            quadBezTo: 2,
          };
          if (pts.length !== expected[command.localName]) throw Error("points");
          d.push(names[command.localName] + " " + pts.flat().join(" "));
          [x, y] = pts.at(-1)!;
          if (command.localName === "moveTo") [startX, startY] = [x, y];
        } else if (command.localName === "arcTo") {
          const rx = resolve(command.getAttribute("wR")),
            ry = resolve(command.getAttribute("hR"));
          const start =
              ((resolve(command.getAttribute("stAng")) / 60000) * Math.PI) /
              180,
            swing =
              ((resolve(command.getAttribute("swAng")) / 60000) * Math.PI) /
              180;
          if (
            ![rx, ry, start, swing].every(Number.isFinite) ||
            rx < 0 ||
            ry < 0
          )
            throw Error("arc");
          if (!rx || !ry) continue;
          // DrawingML angles are rays from the ellipse's center, not the
          // parametric angles used by SVG. They coincide only on circles or
          // at quadrant boundaries. Using cos/sin directly distorts pies,
          // curved arrows and ribbons when their aspect ratio changes.
          const offset = (angle: number) => {
            const parameter = Math.atan2(
              rx * Math.sin(angle),
              ry * Math.cos(angle),
            );
            return [rx * Math.cos(parameter), ry * Math.sin(parameter)];
          };
          const [dx, dy] = offset(start);
          const cx = x - dx,
            cy = y - dy;
          // Split full ellipses: SVG arcs with identical endpoints are empty.
          const pieces = Math.max(1, Math.ceil(Math.abs(swing) / Math.PI));
          if (pieces > 100) throw Error("arc");
          for (let i = 1; i <= pieces; i++) {
            const [dx, dy] = offset(start + (swing * i) / pieces);
            x = cx + dx;
            y = cy + dy;
            d.push(`A ${rx} ${ry} 0 0 ${swing >= 0 ? 1 : 0} ${x} ${y}`);
          }
        } else throw Error("command");
      }
      return {
        d: d.join(" "),
        width,
        height,
        fill: path.getAttribute("fill") !== "none",
        stroke: !["0", "false"].includes(path.getAttribute("stroke") ?? ""),
        ...(["darken", "darkenLess", "lighten", "lightenLess"].includes(
          path.getAttribute("fill") ?? "",
        )
          ? { fillMode: path.getAttribute("fill") as ShapePath["fillMode"] }
          : {}),
      };
    });
  } catch {
    return undefined;
  }
}
