import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Crop, X } from "lucide-react";
import type { SlideElement } from "./types";
import { ImageVisual } from "./ImageVisual";
import {
  frameImageCrop,
  imageSize,
  panImageCrop,
  validateImageCrop,
  zoomImageCrop,
  type ImageCrop,
  type ImageSize,
} from "./image-editing";
import "./image-crop.css";

export default function ImageCropDialog({
  element,
  onApply,
  onClose,
}: {
  element: SlideElement;
  onApply: (crop: ImageCrop | undefined) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const original = useRef<ImageCrop>(element.crop ?? [0, 0, 0, 0]);
  const [crop, setCrop] = useState<ImageCrop>(original.current);
  const [size, setSize] = useState<ImageSize>();
  const [error, setError] = useState("");
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    crop: ImageCrop;
    width: number;
    height: number;
  } | null>(null);
  const previewScale = Math.min(620 / element.width, 340 / element.height);
  const width = Math.max(1, element.width * previewScale),
    height = Math.max(1, element.height * previewScale);
  let fill: ImageCrop = [0, 0, 0, 0];
  try {
    if (size) fill = frameImageCrop(element, size, "fill");
  } catch {
    /* An extreme imported frame can still be adjusted manually. */
  }
  const zoom = Math.max(
    (1 - fill[3] - fill[1]) / (1 - crop[3] - crop[1]),
    (1 - fill[0] - fill[2]) / (1 - crop[0] - crop[2]),
  );
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    let live = true;
    imageSize(element.src!)
      .then((value) => {
        if (live) setSize(value);
      })
      .catch(() => {
        if (live) setError("그림을 읽지 못했습니다.");
      });
    return () => {
      live = false;
    };
  }, [element.src]);
  const update = (next: ImageCrop) => {
    try {
      validateImageCrop(next);
      setCrop(next);
      setError("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "자르기 범위를 확인해 주세요.",
      );
    }
  };
  const fit = (mode: "fit" | "fill") => {
    if (!size) return;
    try {
      update(frameImageCrop(element, size, mode));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "그림을 조절하지 못했습니다.",
      );
    }
  };
  const zoomTo = (zoom: number) => {
    if (!size) return;
    try {
      update(zoomImageCrop(element, size, zoom, crop));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "확대 비율을 확인해 주세요.",
      );
    }
  };
  return (
    <dialog
      ref={dialog}
      className="image-crop-dialog"
      aria-label="그림 자르기"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),[tabindex='0']",
            ),
          );
          const target =
            event.shiftKey && document.activeElement === items[0]
              ? items.at(-1)
              : !event.shiftKey && document.activeElement === items.at(-1)
                ? items[0]
                : undefined;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        event.stopPropagation();
      }}
    >
      <div className="image-crop-heading">
        <Crop size={19} />
        <h2>그림 자르기</h2>
        <button aria-label="자르기 닫기" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <p className="image-crop-description">
        그림을 끌어 위치를 옮기고 확대 비율을 조절하세요. 슬라이드의 위치와 틀
        크기를 유지합니다.
      </p>
      <div className="image-crop-stage">
        <div
          className="image-crop-frame"
          role="img"
          aria-label="자르기 미리보기"
          tabIndex={0}
          style={{ width, height }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !size) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              crop,
              width: rect.width,
              height: rect.height,
            };
          }}
          onPointerMove={(event) => {
            const active = drag.current;
            if (!active || event.pointerId !== active.pointer) return;
            update(
              panImageCrop(
                active.crop,
                ((event.clientX - active.x) / active.width) *
                  (element.flipH ? -1 : 1),
                ((event.clientY - active.y) / active.height) *
                  (element.flipV ? -1 : 1),
              ),
            );
          }}
          onPointerUp={(event) => {
            if (drag.current?.pointer === event.pointerId) drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (!size || !event.key.startsWith("Arrow")) return;
            event.preventDefault();
            event.stopPropagation();
            const amount = event.shiftKey ? 10 : 1;
            update(
              panImageCrop(
                crop,
                ((event.key === "ArrowRight"
                  ? amount
                  : event.key === "ArrowLeft"
                    ? -amount
                    : 0) /
                  width) *
                  (element.flipH ? -1 : 1),
                ((event.key === "ArrowDown"
                  ? amount
                  : event.key === "ArrowUp"
                    ? -amount
                    : 0) /
                  height) *
                  (element.flipV ? -1 : 1),
              ),
            );
          }}
        >
          <ImageVisual element={{ ...element, crop }} />
          <span className="image-crop-corner tl" />
          <span className="image-crop-corner tr" />
          <span className="image-crop-corner bl" />
          <span className="image-crop-corner br" />
        </div>
      </div>
      <div className="image-crop-toolbar">
        <label>
          확대
          <input
            aria-label="그림 확대 비율"
            type="range"
            min="0.1"
            max="5"
            step="0.01"
            value={Math.max(0.1, Math.min(5, zoom))}
            disabled={!size}
            onChange={(event) => zoomTo(Number(event.target.value))}
          />
          <output>{Math.round(zoom * 100)}%</output>
        </label>
        <button disabled={!size} onClick={() => fit("fit")}>
          맞춤
        </button>
        <button disabled={!size} onClick={() => fit("fill")}>
          채우기
        </button>
        <button onClick={() => update(original.current)}>처음 상태</button>
      </div>
      {error && (
        <p className="image-crop-error" role="alert">
          {error}
        </p>
      )}
      <div className="image-crop-actions">
        <button onClick={onClose}>취소</button>
        <button
          className="primary"
          disabled={!size || !!error}
          onClick={() =>
            onApply(
              !element.crop && crop.every((value) => value === 0)
                ? undefined
                : crop,
            )
          }
        >
          적용
        </button>
      </div>
    </dialog>
  );
}
