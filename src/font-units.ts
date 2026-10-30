// Canvas geometry and text use CSS pixels. PowerPoint's font UI uses points;
// convert only at the user-input boundary, leaving existing saved data intact.
export const pixelsToPoints = (pixels: number) => Math.round(pixels * 75) / 100;
export const pointsToPixels = (points: number) => points * (96 / 72);
export const FONT_POINT_MIN = 0.75;
export const FONT_POINT_MAX = 750;

export function nextFontPointSize(value: number, direction: 1 | -1) {
  const sizes = [
    1, 2, 4, 6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40,
    44, 48, 54, 60, 66, 72, 80, 88, 96, 108, 120, 144, 160, 180, 200, 240, 288,
    360, 480, 600, 750,
  ];
  return direction > 0
    ? (sizes.find((size) => size > value + 0.001) ?? FONT_POINT_MAX)
    : ([...sizes].reverse().find((size) => size < value - 0.001) ??
        FONT_POINT_MIN);
}
