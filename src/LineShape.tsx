import type { LineEnd, SlideElement } from "./types";

export function LineShape({ element: e }: { element: SlideElement }) {
  const stroke = e.stroke && e.stroke !== "transparent" ? e.stroke : e.fill;
  const thickness = e.strokeWidth ?? 1;
  // Office keeps thin-line markers legible (a medium oval is 8 CSS px).
  // Length and width remain independent, as in DrawingML headEnd/tailEnd.
  const dimensions = (end: LineEnd) => {
    const factors = { sm: 2, med: 3, lg: 5 };
    const base = Math.max(thickness, 8 / 3);
    const extra = end.type === "arrow" ? 0.5 : 0;
    return [
      (factors[end.length] + extra) * base,
      (factors[end.width] + extra) * base,
    ];
  };
  const trim = (end?: LineEnd) => {
    if (!end || !["triangle", "stealth"].includes(end.type)) return 0;
    return dimensions(end)[0] * (end.type === "stealth" ? 0.6 : 0.9);
  };
  const marker = (end: LineEnd | undefined, start: boolean) => {
    if (!end || end.type === "none") return null;
    const [length, width] = dimensions(end);
    return (
      <g
        data-line-end={start ? "start" : "end"}
        data-marker-type={end.type}
        transform={`translate(${start ? 0 : e.width},${e.height / 2}) rotate(${start ? 180 : 0})`}
        fill={stroke}
      >
        {end.type === "oval" ? (
          <ellipse rx={length / 2} ry={width / 2} />
        ) : end.type === "diamond" ? (
          <polygon
            points={`${length / 2},0 0,${width / 2} ${-length / 2},0 0,${-width / 2}`}
          />
        ) : end.type === "arrow" ? (
          <polyline
            points={`${-length},${-width / 2} 0,0 ${-length},${width / 2}`}
            fill="none"
            stroke={stroke}
            strokeWidth={thickness}
            strokeLinejoin="miter"
          />
        ) : (
          <polygon
            points={`0,0 ${-length},${-width / 2} ${end.type === "stealth" ? `${-length * 0.6},0` : ""} ${-length},${width / 2}`}
          />
        )}
      </g>
    );
  };
  return (
    <svg
      className="element-svg"
      width="100%"
      height={Math.max(1, e.height)}
      viewBox={`0 0 ${Math.max(1, e.width)} ${Math.max(1, e.height)}`}
      preserveAspectRatio="none"
      opacity={e.strokeOpacity}
    >
      <line
        x1={Math.min(e.width / 2, trim(e.lineStart))}
        y1={e.height / 2}
        x2={Math.max(e.width / 2, e.width - trim(e.lineEnd))}
        y2={e.height / 2}
        stroke={stroke}
        strokeWidth={thickness}
        strokeDasharray={e.strokeDash?.join(" ")}
        strokeLinecap={e.strokeCap}
      />
      {marker(e.lineStart, true)}
      {marker(e.lineEnd, false)}
    </svg>
  );
}
