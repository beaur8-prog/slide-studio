import { useId } from "react";
import { GradientDefs } from "./gradient";
import type { LineEnd, SlideElement } from "./types";

const shades = {
  darken: [0.6, 0],
  darkenLess: [0.8, 0],
  lighten: [0.6, 0.4],
  lightenLess: [0.8, 0.2],
} as const;

export function CustomShape({ element: e }: { element: SlideElement }) {
  const id = "shape-" + useId().replace(/[^a-z0-9]/gi, "");
  return (
    <svg
      className="element-svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${e.width} ${e.height}`}
      preserveAspectRatio="none"
      style={{ transform: `scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})` }}
    >
      <GradientDefs gradient={e.gradient} id={id} />
      <defs>
        {Object.entries(shades)
          .filter(([name]) => e.paths?.some((p) => p.fillMode === name))
          .map(([name, [slope, intercept]]) => (
            <filter
              key={name}
              id={`${id}-${name}`}
              colorInterpolationFilters="sRGB"
            >
              <feComponentTransfer>
                <feFuncR type="linear" slope={slope} intercept={intercept} />
                <feFuncG type="linear" slope={slope} intercept={intercept} />
                <feFuncB type="linear" slope={slope} intercept={intercept} />
              </feComponentTransfer>
            </filter>
          ))}
      </defs>
      {e.paths?.map((p, i) => {
        const scale = Math.sqrt((e.width / p.width) * (e.height / p.height));
        const marker = (end: LineEnd | undefined, side: string) => {
          if (!end || end.type === "none") return null;
          const factors = { sm: 2, med: 3, lg: 5 };
          const base = Math.max(e.strokeWidth ?? 1, 8 / 3) / scale;
          const centered = end.type === "oval" || end.type === "diamond";
          return (
            <marker
              id={`${id}-${i}-${side}`}
              markerUnits="userSpaceOnUse"
              markerWidth={factors[end.length] * base}
              markerHeight={factors[end.width] * base}
              viewBox={`${centered ? -0.5 : -1} -0.5 1 1`}
              refX="0"
              refY="0"
              orient="auto-start-reverse"
              overflow="visible"
              preserveAspectRatio="none"
            >
              <g fill={e.stroke} fillOpacity={e.strokeOpacity}>
                {end.type === "oval" ? (
                  <ellipse rx="0.5" ry="0.5" />
                ) : end.type === "diamond" ? (
                  <path d="M 0.5 0 L 0 0.5 L -0.5 0 L 0 -0.5 Z" />
                ) : end.type === "arrow" ? (
                  <path
                    d="M -1 -0.5 L 0 0 L -1 0.5"
                    fill="none"
                    stroke={e.stroke}
                    strokeWidth="0.15"
                  />
                ) : (
                  <path
                    d={`M 0 0 L -1 -0.5 ${end.type === "stealth" ? "L -0.6 0" : ""} L -1 0.5 Z`}
                  />
                )}
              </g>
            </marker>
          );
        };
        const open = !/Z\s*$/i.test(p.d);
        const shaded = p.fillMode && p.fillMode !== "norm";
        const outline = {
          stroke: p.stroke ? e.stroke : "none",
          strokeOpacity: e.strokeOpacity,
          strokeWidth: (e.strokeWidth ?? 0) / Math.max(0.00001, scale),
          strokeDasharray: e.strokeDash?.map((n) => n / scale).join(" "),
          strokeLinecap: e.strokeCap,
          markerStart:
            open && e.lineStart && e.lineStart.type !== "none"
              ? `url(#${id}-${i}-start)`
              : undefined,
          markerEnd:
            open && e.lineEnd && e.lineEnd.type !== "none"
              ? `url(#${id}-${i}-end)`
              : undefined,
        };
        return (
          <g
            key={i}
            transform={`scale(${e.width / p.width},${e.height / p.height})`}
          >
            {open && (
              <defs>
                {marker(e.lineStart, "start")}
                {marker(e.lineEnd, "end")}
              </defs>
            )}
            <path
              d={p.d}
              fill={
                p.fill
                  ? e.gradient
                    ? `url(#${id})`
                    : (e.fill ?? "none")
                  : "none"
              }
              fillOpacity={e.fillOpacity}
              {...(!shaded ? outline : {})}
              filter={
                p.fillMode && p.fillMode !== "norm"
                  ? `url(#${id}-${p.fillMode})`
                  : undefined
              }
            />
            {shaded && p.stroke && <path d={p.d} fill="none" {...outline} />}
          </g>
        );
      })}
    </svg>
  );
}
