export type AndroidZoomView = { zoom: number; x: number; y: number };
export const ANDROID_FIT_VIEW: AndroidZoomView = { zoom: 1, x: 0, y: 0 };
export type AndroidZoomBounds = {
  width: number;
  height: number;
  slideWidth: number;
  slideHeight: number;
};

export function constrainAndroidZoom(
  view: AndroidZoomView,
  bounds: AndroidZoomBounds,
): AndroidZoomView {
  const zoom = Math.max(
    1,
    Math.min(5, Number.isFinite(view.zoom) ? view.zoom : 1),
  );
  const fit = Math.min(
    bounds.width / bounds.slideWidth,
    bounds.height / bounds.slideHeight,
  );
  const maxX = Math.max(0, (bounds.slideWidth * fit * zoom - bounds.width) / 2);
  const maxY = Math.max(
    0,
    (bounds.slideHeight * fit * zoom - bounds.height) / 2,
  );
  return {
    zoom,
    x: Math.max(-maxX, Math.min(maxX, view.x)),
    y: Math.max(-maxY, Math.min(maxY, view.y)),
  };
}

export function zoomAndroidAt(
  view: AndroidZoomView,
  zoom: number,
  center: { x: number; y: number },
  bounds: AndroidZoomBounds,
) {
  const target = Math.max(1, Math.min(5, zoom));
  const ratio = target / view.zoom;
  return constrainAndroidZoom(
    {
      zoom: target,
      x: center.x - (center.x - view.x) * ratio,
      y: center.y - (center.y - view.y) * ratio,
    },
    bounds,
  );
}
