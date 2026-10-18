import type { GradientFill } from "./types";
import { record, enumValue, numberValue, colorValue } from "./validation";
import { alphaColor } from "./colors";
export function validateGradient(value: unknown): GradientFill {
  const v = record(value, "그라데이션"),
    kind = enumValue(v.kind, ["linear", "radial"] as const, "그라데이션");
  if (!Array.isArray(v.stops) || v.stops.length < 2 || v.stops.length > 100)
    throw Error("그라데이션 색상은 2–100개가 필요합니다.");
  return {
    kind,
    angle: numberValue(v.angle ?? 0, "그라데이션 각도", -360000, 360000),
    stops: v.stops
      .map((raw) => {
        const s = record(raw, "그라데이션 색상");
        return {
          offset: numberValue(s.offset, "색상 위치", 0, 1),
          color: colorValue(s.color, "색상"),
          ...(s.opacity !== undefined
            ? { opacity: numberValue(s.opacity, "불투명도", 0, 1) }
            : {}),
        };
      })
      .sort((a, b) => a.offset - b.offset),
  };
}
export function gradientCss(g: GradientFill | undefined): string | undefined {
  if (!g) return;
  const colors = g.stops
    .map((s) => `${alphaColor(s.color, s.opacity)} ${s.offset * 100}%`)
    .join(",");
  return g.kind === "linear"
    ? `linear-gradient(${g.angle + 90}deg,${colors})`
    : `radial-gradient(ellipse at center,${colors})`;
}
export function GradientDefs({
  gradient: g,
  id,
}: {
  gradient: GradientFill | undefined;
  id: string;
}) {
  if (!g) return null;
  const Tag = g.kind === "linear" ? "linearGradient" : "radialGradient",
    r = (g.angle * Math.PI) / 180;
  return (
    <defs>
      <Tag
        id={id}
        {...(g.kind === "linear"
          ? {
              x1: `${50 - 50 * Math.cos(r)}%`,
              y1: `${50 - 50 * Math.sin(r)}%`,
              x2: `${50 + 50 * Math.cos(r)}%`,
              y2: `${50 + 50 * Math.sin(r)}%`,
            }
          : { cx: "50%", cy: "50%", r: "70.71%" })}
      >
        {g.stops.map((s, i) => (
          <stop
            key={i}
            offset={s.offset}
            stopColor={s.color}
            stopOpacity={s.opacity}
          />
        ))}
      </Tag>
    </defs>
  );
}
export function readGradient(
  node: Element | undefined,
  color: (
    n: Element | undefined,
  ) => { color: string; opacity: number } | undefined,
): GradientFill | undefined {
  if (!node) return;
  const child = (n: Element | undefined, name: string) =>
      Array.from(n?.children ?? []).find((c) => c.localName === name),
    stops = Array.from(child(node, "gsLst")?.children ?? [])
      .map((n) => ({
        offset: Number(n.getAttribute("pos") ?? 0) / 100000,
        ...color(n),
      }))
      .filter((s) => s.color);
  try {
    return validateGradient({
      kind: child(node, "path") ? "radial" : "linear",
      angle: Number(child(node, "lin")?.getAttribute("ang") ?? 0) / 60000,
      stops,
    });
  } catch {
    return;
  }
}
export function writeGradient(
  doc: Document,
  parent: Element,
  g: GradientFill,
  opacity = 1,
) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main",
    make = (
      name: string,
      attrs: Record<string, string | number>,
      p: Element,
    ) => {
      const n = doc.createElementNS(A, "a:" + name);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      p.append(n);
      return n;
    };
  for (const n of Array.from(parent.children))
    if (
      ["solidFill", "noFill", "gradFill", "pattFill", "blipFill"].includes(
        n.localName,
      )
    )
      n.remove();
  const fill = doc.createElementNS(A, "a:gradFill"),
    list = make("gsLst", {}, fill);
  for (const stop of g.stops) {
    const color = make(
      "srgbClr",
      { val: stop.color.slice(1) },
      make("gs", { pos: Math.round(stop.offset * 100000) }, list),
    );
    if (opacity * (stop.opacity ?? 1) !== 1)
      make(
        "alpha",
        { val: Math.round(opacity * (stop.opacity ?? 1) * 100000) },
        color,
      );
  }
  if (g.kind === "linear")
    make("lin", { ang: Math.round(g.angle * 60000), scaled: "1" }, fill);
  else
    make(
      "fillToRect",
      { l: 50000, t: 50000, r: 50000, b: 50000 },
      make("path", { path: "circle" }, fill),
    );
  const next = Array.from(parent.children).find((n) =>
    ["ln", "effectLst", "effectDag", "scene3d", "sp3d", "extLst"].includes(
      n.localName,
    ),
  );
  parent.insertBefore(fill, next ?? null);
}
