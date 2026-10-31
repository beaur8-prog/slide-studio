import type { SlideElement } from "./types";
export function alphaColor(
  color: string | undefined,
  opacity = 1,
): string | undefined {
  if (!color || color === "transparent" || opacity === 1) return color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `rgba(${[1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(",")},${opacity})`;
}
export function rgbToHsl(rgb: number[]) {
  const [r, g, b] = rgb.map((x) => x / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min,
    l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h =
      max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
    h = (((h * 60) % 360) + 360) % 360;
  }
  return [h, s, l];
}
export function hslToRgb([h, s, l]: number[]) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = l - c / 2;
  const c3 =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return c3.map((v) => (v + m) * 255);
}
/** Fold a uniform imported alpha into the existing object opacity control. */
export function normalizeObjectAlpha(el: SlideElement) {
  if (el.opacity !== 1 || el.type === "image" || el.type === "video" || el.gradient || el.shadow)
    return;
  const entries: { value: number; set: (n: number) => void }[] = [];
  const add = (value: number | undefined, set: (n: number) => void) =>
    entries.push({ value: value ?? 1, set });
  if (el.table) {
    for (let r = 0; r < el.table.cells.length; r++)
      for (let c = 0; c < el.table.cells[0].length; c++) {
        const style = el.table.cellStyles?.[r]?.[c];
        if (!style) continue;
        if (style.fill !== "transparent")
          add(style.fillOpacity, (n) => (style.fillOpacity = n));
        if (style.paragraphs) {
          for (const p of style.paragraphs)
            for (const run of p.runs)
              // Empty cells can carry an explicit insertion alpha. Normalize
              // it with the table so subsequent saves do not multiply it twice.
              if (run.text || run.opacity !== undefined)
                add(run.opacity ?? style.textOpacity, (n) => (run.opacity = n));
        } else if (el.table.cells[r][c])
          add(style.textOpacity, (n) => (style.textOpacity = n));
        if (style.borders)
          for (const b of style.borders)
            if (b.width && b.color !== "transparent")
              add(b.opacity, (n) => (b.opacity = n));
        for (const b of Object.values(style.diagonalBorders ?? {}))
          if (b.width && b.color !== "transparent")
            add(b.opacity, (n) => (b.opacity = n));
      }
  } else {
    if (el.fill && el.fill !== "transparent")
      add(el.fillOpacity, (n) => (el.fillOpacity = n));
    if (el.stroke && el.stroke !== "transparent" && el.strokeWidth)
      add(el.strokeOpacity, (n) => (el.strokeOpacity = n));
    if (el.paragraphs) {
      for (const p of el.paragraphs)
        for (const run of p.runs)
          if (run.text)
            add(run.opacity ?? el.textOpacity, (n) => (run.opacity = n));
    } else if (el.text) add(el.textOpacity, (n) => (el.textOpacity = n));
  }
  if (
    entries.length &&
    entries.every((e) => Math.abs(e.value - entries[0].value) < 0.00001)
  ) {
    el.opacity = entries[0].value;
    for (const e of entries) e.set(1);
  }
  const clean = (v: any, root = false) => {
    if (!v || typeof v !== "object") return;
    for (const key of Object.keys(v)) {
      if (
        (key.endsWith("Opacity") || (!root && key === "opacity")) &&
        v[key] === 1
      )
        delete v[key];
      else if (typeof v[key] === "object") clean(v[key]);
    }
  };
  clean(el, true);
}
