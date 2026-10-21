import type { SlideElement } from "./types";

type Point = { x: number; y: number };

// Fractions of the unflipped shape box. A PowerPoint triangle may arrive as
// either a preset or a custom path after Adjust Shape / Edit Points. Recognize
// the actual three straight edges, never infer points from a bounding box.
export function trianglePoints(element: SlideElement): Point[] | undefined {
  if (element.type !== "shape" || !element.width || !element.height) return;
  if (element.shape === "triangle")
    return [
      { x: 0.5, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
  if (element.shape !== "custom" || element.paths?.length !== 1) return;
  const path = element.paths[0];
  const tokens =
    path.d.match(/[MLCQAZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const points: Point[] = [];
  let i = 0;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === "Z") {
      if (i !== tokens.length) return;
      if (
        points.length === 4 &&
        points[0].x === points[3].x &&
        points[0].y === points[3].y
      )
        points.pop();
      return points.length === 3 ? points : undefined;
    }
    if (command !== (points.length ? "L" : "M")) return;
    const x = Number(tokens[i++]) / path.width;
    const y = Number(tokens[i++]) / path.height;
    if (!Number.isFinite(x) || !Number.isFinite(y) || points.length >= 4)
      return;
    points.push({ x, y });
  }
}

// dx/dy are in slide coordinates. Undo the object's rotation and reflections
// before moving just one vertex; the box, other vertices and text stay fixed.
export function moveTrianglePoint(
  element: SlideElement,
  index: number,
  dx: number,
  dy: number,
): SlideElement {
  const points = trianglePoints(element);
  if (element.locked || !points?.[index] || !Number.isFinite(dx + dy))
    return element;
  if (!dx && !dy) return element;
  const angle = (element.rotation * Math.PI) / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const path = element.paths?.[0] ?? {
    width: element.width * 9525,
    height: element.height * 9525,
    fill: true,
    stroke: true,
    d: "",
  };
  const point = points[index];
  const limit = (n: number) => Math.max(-1e12, Math.min(1e12, n));
  point.x =
    limit(
      (point.x + ((element.flipH ? -1 : 1) * localX) / element.width) *
        path.width,
    ) / path.width;
  point.y =
    limit(
      (point.y + ((element.flipV ? -1 : 1) * localY) / element.height) *
        path.height,
    ) / path.height;
  return {
    ...element,
    shape: "custom",
    paths: [
      {
        ...path,
        d:
          points
            .map(
              (p, i) =>
                `${i ? "L" : "M"} ${p.x * path.width} ${p.y * path.height}`,
            )
            .join(" ") + " Z",
      },
    ],
  };
}
