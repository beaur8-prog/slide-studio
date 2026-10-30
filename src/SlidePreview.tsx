import { memo, useEffect, useRef, useState } from "react";
import { SlideVisual } from "./SlideCanvas";
import type { Slide } from "./types";

type Pool = {
  observer: IntersectionObserver;
  callbacks: Map<Element, (visible: boolean) => void>;
};
const pools = new WeakMap<Element, Pool>();

// Keep buttons/row geometry and accessible names for every slide. Only the
// expensive artwork around the viewport is mounted. A shared observer avoids
// creating hundreds of observers in large documents and multi-slide view.
function observe(
  target: Element,
  root: Element,
  callback: (visible: boolean) => void,
) {
  let pool = pools.get(root);
  if (!pool) {
    const callbacks: Pool["callbacks"] = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: "400px 0px" },
    );
    pool = { observer, callbacks };
    pools.set(root, pool);
  }
  const current = pool;
  current.callbacks.set(target, callback);
  current.observer.observe(target);
  return () => {
    current.observer.unobserve(target);
    current.callbacks.delete(target);
    if (!current.callbacks.size) {
      current.observer.disconnect();
      pools.delete(root);
    }
  };
}

export default memo(function SlidePreview({
  slide,
  width,
  height,
  size,
  active = false,
}: {
  slide: Slide;
  width: number;
  height: number;
  size: number;
  active?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const target = host.current,
      root = target?.closest(".thumbnail-list,.slide-sorter");
    if (!target || !root || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    return observe(target, root, setVisible);
  }, []);
  return (
    <div
      ref={host}
      className="slide-preview"
      data-preview-slide={slide.id}
      style={{
        width: size,
        height: (size * height) / width,
        position: "relative",
        overflow: "hidden",
        background: slide.background,
      }}
    >
      {(active || visible) && (
        <SlideVisual
          slide={slide}
          width={width}
          height={height}
          scale={size / width}
        />
      )}
    </div>
  );
});
