const polygon = (points: [number, number][]) =>
  `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")} Z`;
const regular = (sides: number, inner = 1) =>
  polygon(
    Array.from({ length: inner === 1 ? sides : sides * 2 }, (_, i) => {
      const angle =
          -Math.PI / 2 + (i * Math.PI * 2) / (inner === 1 ? sides : sides * 2),
        radius = 48 * (inner !== 1 && i % 2 ? inner : 1);
      return [50 + radius * Math.cos(angle), 50 + radius * Math.sin(angle)];
    }),
  );

export const EXTRA_SHAPES = [
  { id: "diamond", name: "마름모", d: "M50 0 L100 50 L50 100 L0 50 Z" },
  { id: "pentagon", name: "오각형", d: regular(5) },
  { id: "hexagon", name: "육각형", d: regular(6) },
  { id: "star", name: "별", d: regular(5, 0.43) },
  {
    id: "heart",
    name: "하트",
    d: "M50 94 C42 84 0 58 0 30 C0 0 35 -6 50 22 C65 -6 100 0 100 30 C100 58 58 84 50 94 Z",
  },
  {
    id: "chevron",
    name: "갈매기형",
    d: "M0 0 L65 0 L100 50 L65 100 L0 100 L35 50 Z",
  },
  {
    id: "right-arrow",
    name: "오른쪽 블록 화살표",
    d: "M0 25 L60 25 L60 0 L100 50 L60 100 L60 75 L0 75 Z",
  },
  {
    id: "left-arrow",
    name: "왼쪽 블록 화살표",
    d: "M100 25 L40 25 L40 0 L0 50 L40 100 L40 75 L100 75 Z",
  },
  {
    id: "up-arrow",
    name: "위쪽 블록 화살표",
    d: "M25 100 L25 40 L0 40 L50 0 L100 40 L75 40 L75 100 Z",
  },
  {
    id: "down-arrow",
    name: "아래쪽 블록 화살표",
    d: "M25 0 L75 0 L75 60 L100 60 L50 100 L0 60 L25 60 Z",
  },
  {
    id: "two-way",
    name: "양방향 화살표",
    d: "M0 50 L25 0 L25 30 L75 30 L75 0 L100 50 L75 100 L75 70 L25 70 L25 100 Z",
  },
  {
    id: "parallelogram",
    name: "평행사변형",
    d: "M25 0 L100 0 L75 100 L0 100 Z",
  },
  { id: "trapezoid", name: "사다리꼴", d: "M25 0 L75 0 L100 100 L0 100 Z" },
  {
    id: "cross",
    name: "십자형",
    d: "M35 0 L65 0 L65 35 L100 35 L100 65 L65 65 L65 100 L35 100 L35 65 L0 65 L0 35 L35 35 Z",
  },
  {
    id: "callout",
    name: "말풍선",
    d: "M8 0 L92 0 Q100 0 100 8 L100 68 Q100 76 92 76 L40 76 L20 100 L20 76 L8 76 Q0 76 0 68 L0 8 Q0 0 8 0 Z",
  },
  {
    id: "cloud",
    name: "구름",
    d: "M20 85 C-5 85 -5 50 12 43 C3 16 32 6 45 20 C58 -2 91 8 88 33 C108 38 106 68 88 73 C83 98 55 100 43 86 C37 98 23 97 20 85 Z",
  },
] as const;

// The first three rows in the three-column shape menu use outlined defaults.
const OUTLINED_INSERT_SHAPES = new Set([
  "rect", "roundRect", "ellipse", "triangle", "line", "arrow",
  "diamond", "pentagon", "hexagon",
]);
export function shapeInsertionStyle(shape: string) {
  return OUTLINED_INSERT_SHAPES.has(shape)
    ? { fill: "transparent", stroke: "#000000", strokeWidth: 3 }
    : { fill: "#000000", stroke: "transparent", strokeWidth: 0 };
}
