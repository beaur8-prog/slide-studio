export type InkPoint = [number, number];
export type InkStroke = { points: InkPoint[]; color: string; width: number };

function pointDistance(p: InkPoint, a: InkPoint, b: InkPoint) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// Sweep the whole eraser movement, including crossings between sparse events.
export function touchesInk(
  stroke: InkStroke,
  from: InkPoint,
  to: InkPoint,
  radius: number,
) {
  const cross = (a: InkPoint, b: InkPoint, c: InkPoint) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return stroke.points.some((b, i) => {
    const a = stroke.points[Math.max(0, i - 1)];
    const crossing =
      cross(a, b, from) * cross(a, b, to) < 0 &&
      cross(from, to, a) * cross(from, to, b) < 0;
    return (
      crossing ||
      Math.min(
        pointDistance(from, a, b),
        pointDistance(to, a, b),
        pointDistance(a, from, to),
        pointDistance(b, from, to),
      ) <=
        radius + stroke.width / 2
    );
  });
}
