import type { SlideElement } from "./types";

export function artworkBounds(e: SlideElement) {
  const a = (e.rotation * Math.PI) / 180;
  const width =
    Math.abs(e.width * Math.cos(a)) + Math.abs(e.height * Math.sin(a));
  const height =
    Math.abs(e.width * Math.sin(a)) + Math.abs(e.height * Math.cos(a));
  return {
    x: e.x + e.width / 2 - width / 2,
    y: e.y + e.height / 2 - height / 2,
    width,
    height,
  };
}
export function snapMovement(
  elements: SlideElement[],
  ids: string[],
  dx: number,
  dy: number,
  width: number,
  height: number,
  tolerance: number,
  axis?: "x" | "y",
) {
  const boxes = elements.filter((e) => ids.includes(e.id)).map(artworkBounds),
    others = elements.filter((e) => !ids.includes(e.id)).map(artworkBounds);
  if (!boxes.length)
    return { dx, dy, guides: [] as { axis: "x" | "y"; at: number }[] };
  const left = Math.min(...boxes.map((b) => b.x)),
    right = Math.max(...boxes.map((b) => b.x + b.width)),
    top = Math.min(...boxes.map((b) => b.y)),
    bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const guides: { axis: "x" | "y"; at: number }[] = [];
  function snap(
    anchors: number[],
    targets: number[],
    delta: number,
    coordinate: "x" | "y",
  ) {
    if (axis && axis !== coordinate) return delta;
    let best = tolerance,
      result = delta,
      at: number | undefined;
    for (const target of targets)
      for (const anchor of anchors) {
        const distance = target - anchor - delta;
        if (Math.abs(distance) < best) {
          best = Math.abs(distance);
          result = delta + distance;
          at = target;
        }
      }
    if (at !== undefined) guides.push({ axis: coordinate, at });
    return result;
  }
  return {
    dx: snap(
      [left, (left + right) / 2, right],
      [
        0,
        width / 2,
        width,
        ...others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width]),
      ],
      dx,
      "x",
    ),
    dy: snap(
      [top, (top + bottom) / 2, bottom],
      [
        0,
        height / 2,
        height,
        ...others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height]),
      ],
      dy,
      "y",
    ),
    guides,
  };
}
export function selectionUnits(elements: SlideElement[], ids: string[]) {
  const seen = new Set<string>();
  return elements.flatMap((e) => {
    if (!ids.includes(e.id)) return [];
    const root = e.groups?.[0],
      group = root ? elements.filter((item) => item.groups?.[0] === root) : [];
    const key =
      root && group.every((item) => ids.includes(item.id)) ? root : e.id;
    if (seen.has(key)) return [];
    seen.add(key);
    const members = key === root ? group : [e],
      boxes = members.map(artworkBounds);
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    return [
      {
        members,
        locked: members.some((e) => e.locked),
        x,
        y,
        width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
        height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
      },
    ];
  });
}
export function arrangeElements(
  elements: SlideElement[],
  ids: string[],
  action:
    | "left"
    | "center"
    | "right"
    | "top"
    | "middle"
    | "bottom"
    | "horizontal"
    | "vertical",
  width: number,
  height: number,
  scope: "slide" | "selection" = "selection",
): SlideElement[] {
  const units = selectionUnits(elements, ids).filter((u) => !u.locked);
  if (!units.length) return elements;
  const offsets = new Map<string, { x: number; y: number }>();
  const place = (unit: (typeof units)[number], x: number, y: number) =>
    unit.members.forEach((e) =>
      offsets.set(e.id, { x: x - unit.x, y: y - unit.y }),
    );
  if (action === "horizontal" || action === "vertical") {
    if (units.length < 3) return elements;
    const x = action === "horizontal" ? "x" : "y",
      size = action === "horizontal" ? "width" : "height";
    const sorted = [...units].sort((a, b) => a[x] - b[x]);
    const first = sorted[0][x],
      last = sorted.at(-1)![x] + sorted.at(-1)![size];
    const gap =
      (last - first - sorted.reduce((sum, u) => sum + u[size], 0)) /
      (units.length - 1);
    let at = first;
    for (const u of sorted) {
      place(u, x === "x" ? at : u.x, x === "y" ? at : u.y);
      at += u[size] + gap;
    }
  } else {
    const x =
      scope === "slide" || units.length === 1
        ? 0
        : Math.min(...units.map((u) => u.x));
    const y =
      scope === "slide" || units.length === 1
        ? 0
        : Math.min(...units.map((u) => u.y));
    const w =
      scope === "slide" || units.length === 1
        ? width
        : Math.max(...units.map((u) => u.x + u.width)) - x;
    const h =
      scope === "slide" || units.length === 1
        ? height
        : Math.max(...units.map((u) => u.y + u.height)) - y;
    for (const u of units)
      place(
        u,
        action === "left"
          ? x
          : action === "center"
            ? x + (w - u.width) / 2
            : action === "right"
              ? x + w - u.width
              : u.x,
        action === "top"
          ? y
          : action === "middle"
            ? y + (h - u.height) / 2
            : action === "bottom"
              ? y + h - u.height
              : u.y,
      );
  }
  return elements.map((e) =>
    offsets.has(e.id)
      ? { ...e, x: e.x + offsets.get(e.id)!.x, y: e.y + offsets.get(e.id)!.y }
      : e,
  );
}
