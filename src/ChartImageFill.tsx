import { useId } from "react";
import type { ChartImageFill as ImageFill } from "./chart-image";
import { stillImageSource } from "./gif-preview";

export function ChartImageFill({
  fill,
  x = 0,
  y = 0,
  width,
  height,
  playing = false,
}: {
  fill: ImageFill;
  x?: number;
  y?: number;
  width: number;
  height: number;
  playing?: boolean;
}) {
  const id = "chart-fill-" + useId().replaceAll(":", ""),
    source = playing ? fill.src : stillImageSource(fill.src);
  // DrawingML interpolates the endpoint colors using the source pixel's
  // encoded RGB luminance. Keep alpha separate so transparent pixels remain
  // transparent and the source image (including GIF frames) stays unchanged.
  const duotone = fill.duotone;
  const coefficients = duotone?.colors.map((color) =>
    [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16) / 255),
  );
  const alphaVaries =
    !!duotone && duotone.opacities.some((alpha) => alpha !== 1);
  const matrix =
    coefficients && duotone
      ? [
          ...coefficients[0].flatMap((channel, index) => [
            ...[0.299, 0.587, 0.114].map(
              (weight) => weight * (coefficients[1][index] - channel),
            ),
            0,
            channel,
          ]),
          ...(alphaVaries
            ? [
                ...[0.299, 0.587, 0.114].map(
                  (weight) =>
                    weight * (duotone.opacities[1] - duotone.opacities[0]),
                ),
                0,
                duotone.opacities[0],
              ]
            : [0, 0, 0, 1, 0]),
        ].join(" ")
      : undefined;
  const effect = matrix && (
    <filter
      id={`${id}-duotone`}
      colorInterpolationFilters="sRGB"
      x="0"
      y="0"
      width="100%"
      height="100%"
    >
      <feColorMatrix type="matrix" values={matrix} result="duotone" />
      {alphaVaries && (
        <feComposite in="duotone" in2="SourceAlpha" operator="in" />
      )}
    </filter>
  );
  const [top, right, bottom, left] = fill.crop,
    cropWidth = fill.width * (1 - left - right),
    cropHeight = fill.height * (1 - top - bottom);
  const picture = (
    width: number,
    height: number,
    key = 0,
    transform?: string,
  ) => (
    <g key={key} transform={transform}>
      <svg
        x={0}
        y={0}
        width={width}
        height={height}
        viewBox={`${left * fill.width} ${top * fill.height} ${cropWidth} ${cropHeight}`}
        preserveAspectRatio="none"
        overflow="hidden"
      >
        <image
          href={source}
          filter={effect ? `url(#${id}-duotone)` : undefined}
          x={0}
          y={0}
          width={fill.width}
          height={fill.height}
          preserveAspectRatio="none"
        />
      </svg>
    </g>
  );
  if (fill.tile) {
    const tile = fill.tile,
      tileWidth = Math.max(
        1,
        Math.min(32768, ((cropWidth * 96) / fill.dpi) * tile.scaleX),
      ),
      tileHeight = Math.max(
        1,
        Math.min(32768, ((cropHeight * 96) / fill.dpi) * tile.scaleY),
      ),
      flipX = tile.flip === "x" || tile.flip === "xy",
      flipY = tile.flip === "y" || tile.flip === "xy";
    const alignX = ["tr", "r", "br"].includes(tile.align)
        ? width - tileWidth
        : ["t", "ctr", "b"].includes(tile.align)
          ? (width - tileWidth) / 2
          : 0,
      alignY = ["bl", "b", "br"].includes(tile.align)
        ? height - tileHeight
        : ["l", "ctr", "r"].includes(tile.align)
          ? (height - tileHeight) / 2
          : 0;
    return (
      <g data-chart-image-fill="tile" opacity={fill.opacity}>
        <defs>
          {effect}
          <pattern
            id={id}
            patternUnits="userSpaceOnUse"
            x={x + alignX + tile.offsetX}
            y={y + alignY + tile.offsetY}
            width={tileWidth * (flipX ? 2 : 1)}
            height={tileHeight * (flipY ? 2 : 1)}
          >
            {picture(tileWidth, tileHeight)}
            {flipX &&
              picture(
                tileWidth,
                tileHeight,
                1,
                `translate(${2 * tileWidth} 0) scale(-1 1)`,
              )}
            {flipY &&
              picture(
                tileWidth,
                tileHeight,
                2,
                `translate(0 ${2 * tileHeight}) scale(1 -1)`,
              )}
            {flipX &&
              flipY &&
              picture(
                tileWidth,
                tileHeight,
                3,
                `translate(${2 * tileWidth} ${2 * tileHeight}) scale(-1 -1)`,
              )}
          </pattern>
        </defs>
        <rect x={x} y={y} width={width} height={height} fill={`url(#${id})`} />
      </g>
    );
  }
  const [fillTop, fillRight, fillBottom, fillLeft] = fill.fill,
    targetX = x + fillLeft * width,
    targetY = y + fillTop * height,
    targetWidth = width * (1 - fillLeft - fillRight),
    targetHeight = height * (1 - fillTop - fillBottom);
  return (
    <g data-chart-image-fill="stretch" opacity={fill.opacity}>
      {effect && <defs>{effect}</defs>}
      <svg
        x={targetX}
        y={targetY}
        width={targetWidth}
        height={targetHeight}
        overflow="hidden"
      >
        {picture(targetWidth, targetHeight)}
      </svg>
    </g>
  );
}
