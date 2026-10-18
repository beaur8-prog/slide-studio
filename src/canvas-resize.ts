import type { SlideElement } from "./types";
export function selectionBounds(elements: SlideElement[]) {
  const x = Math.min(...elements.map((e) => e.x)),
    y = Math.min(...elements.map((e) => e.y));
  return {
    x,
    y,
    width: Math.max(...elements.map((e) => e.x + e.width)) - x,
    height: Math.max(...elements.map((e) => e.y + e.height)) - y,
  };
}
export function rotateElements(
  elements: SlideElement[],
  ids: string[],
  delta: number,
): SlideElement[] {
  const moving = elements.filter((e) => ids.includes(e.id) && !e.locked);
  if (!moving.length) return elements;
  const box = selectionBounds(moving),
    cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  const angle = (delta * Math.PI) / 180;
  return elements.map((e) =>
    !ids.includes(e.id) || e.locked
      ? e
      : {
          ...e,
          x:
            cx +
            (e.x + e.width / 2 - cx) * Math.cos(angle) -
            (e.y + e.height / 2 - cy) * Math.sin(angle) -
            e.width / 2,
          y:
            cy +
            (e.x + e.width / 2 - cx) * Math.sin(angle) +
            (e.y + e.height / 2 - cy) * Math.cos(angle) -
            e.height / 2,
          rotation: e.rotation + delta,
        },
  );
}
export function resizeElements(
  elements: SlideElement[],
  ids: string[],
  handle: string,
  dx: number,
  dy: number,
  shift: boolean,
): SlideElement[] {
  const moving = elements.filter((e) => ids.includes(e.id) && !e.locked);
  if (!moving.length) return elements;
  const group = moving.length > 1,
    box = group ? selectionBounds(moving) : moving[0],
    angle = group ? 0 : (moving[0].rotation * Math.PI) / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle),
    localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const horizontal = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0,
    vertical = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  let sx = horizontal ? 1 + (horizontal * localX) / box.width : 1,
    sy = vertical ? 1 + (vertical * localY) / box.height : 1;
  const minX = Math.max(...moving.map((e) => 16 / e.width)),
    minY = Math.max(
      ...moving.map(
        (e) =>
          (e.type === "shape" && (e.shape === "line" || e.shape === "arrow")
            ? 0.01
            : 8) / Math.max(e.height, 0.01),
      ),
    );
  const keep =
    handle.length === 2 &&
    (shift || (moving.length === 1 && moving[0].type === "image"));
  if (keep) {
    const ratio = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    sx = sy = Math.max(minX, minY, ratio);
  } else {
    sx = horizontal ? Math.max(minX, sx) : 1;
    sy = vertical ? Math.max(minY, sy) : 1;
  }
  const width = box.width * sx,
    height = box.height * sy;
  const cx = (horizontal * (width - box.width)) / 2,
    cy = (vertical * (height - box.height)) / 2;
  const x =
    box.x +
    box.width / 2 +
    cx * Math.cos(angle) -
    cy * Math.sin(angle) -
    width / 2;
  const y =
    box.y +
    box.height / 2 +
    cx * Math.sin(angle) +
    cy * Math.cos(angle) -
    height / 2;
  return elements.map((e) =>
    !ids.includes(e.id) || e.locked
      ? e
      : {
          ...e,
          x: group ? x + (e.x - box.x) * sx : x,
          y: group ? y + (e.y - box.y) * sy : y,
          width: e.width * sx,
          height: e.height * sy,
          ...(e.type === "text" && vertical ? { autoHeight: false } : {}),
        },
  );
}
