// Endpoint-to-center conversion follows SVG 2 Appendix B.2:
// https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes
// Short cubic segments also represent rotated ellipses in DrawingML.
export function arcCubics(
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation: number,
  large: number,
  sweep: number,
  nx: number,
  ny: number,
): number[][] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry || (x === nx && y === ny)) return [];
  const phi = (rotation * Math.PI) / 180,
    cos = Math.cos(phi),
    sin = Math.sin(phi);
  const dx = (x - nx) / 2,
    dy = (y - ny) / 2;
  const px = cos * dx + sin * dy,
    py = -sin * dx + cos * dy;
  const scale = Math.sqrt((px * px) / (rx * rx) + (py * py) / (ry * ry));
  if (scale > 1) {
    rx *= scale;
    ry *= scale;
  }
  const denominator = rx * rx * py * py + ry * ry * px * px;
  const sign = large === sweep ? -1 : 1;
  const factor =
    sign *
    Math.sqrt(
      Math.max(
        0,
        (rx * rx * ry * ry - denominator) / Math.max(1e-20, denominator),
      ),
    );
  const cxp = (factor * rx * py) / ry,
    cyp = (-factor * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x + nx) / 2,
    cy = sin * cxp + cos * cyp + (y + ny) / 2;
  const start = Math.atan2((py - cyp) / ry, (px - cxp) / rx);
  const end = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx);
  let delta = end - start;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const count = Math.ceil(Math.abs(delta) / (Math.PI / 8)),
    step = delta / count;
  const point = (a: number) => [
    cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin,
    cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos,
  ];
  const tangent = (a: number) => [
    -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin,
    -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos,
  ];
  return Array.from({ length: count }, (_, i) => {
    const a = start + step * i,
      b = a + step,
      k = (4 / 3) * Math.tan(step / 4);
    const p = point(a),
      q = point(b),
      u = tangent(a),
      v = tangent(b);
    return [
      p[0] + k * u[0],
      p[1] + k * u[1],
      q[0] - k * v[0],
      q[1] - k * v[1],
      ...(i === count - 1 ? [nx, ny] : q),
    ];
  });
}
