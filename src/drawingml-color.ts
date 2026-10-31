import { hslToRgb, rgbToHsl } from "./colors";

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

/** DrawingML scRGB channels are linear light; CSS/hex sRGB channels are encoded. */
export function linearToSrgb(value: number): number {
  const channel = clamp(value);
  return (
    255 *
    (channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055)
  );
}

export function srgbToLinear(value: number): number {
  const channel = clamp(value / 255);
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Apply DrawingML transforms in authored order, preserving color-space semantics. */
export function applyDrawingmlColorTransforms(
  color: string,
  transforms: Iterable<Element>,
): { color: string; opacity: number } {
  let rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  let opacity = 1;
  for (const transform of transforms) {
    const name = transform.localName;
    const value = Number(transform.getAttribute("val") ?? "100000");
    if (!Number.isFinite(value)) continue;
    const amount = value / 100000;
    if (name === "tint" || name === "shade") {
      // Mixing encoded RGB bytes makes pale table bands too dark. A tint's
      // percentage is the fraction of the original color (0 = white).
      const original = clamp(amount);
      rgb = rgb.map((channel) =>
        linearToSrgb(
          srgbToLinear(channel) * original +
            (name === "tint" ? 1 - original : 0),
        ),
      );
    }
    if (/^(?:lum|sat|hue)(?:Mod|Off)?$/.test(name)) {
      const hsl = rgbToHsl(rgb);
      const index = name.startsWith("hue") ? 0 : name.startsWith("sat") ? 1 : 2;
      const absolute = index === 0 ? value / 60000 : amount;
      hsl[index] = name.endsWith("Mod")
        ? hsl[index] * amount
        : name.endsWith("Off")
          ? hsl[index] + absolute
          : absolute;
      rgb = hslToRgb(hsl);
    }
    if (name === "alpha") opacity = amount;
    if (name === "alphaMod") opacity *= amount;
    if (name === "alphaOff") opacity += amount;
  }
  return {
    color:
      "#" +
      rgb
        .map((channel) =>
          Math.round(clamp(channel, 0, 255))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase(),
    opacity: clamp(opacity),
  };
}
