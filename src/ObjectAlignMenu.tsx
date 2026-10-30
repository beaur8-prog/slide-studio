import { useLayoutEffect, useRef } from "react";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUpToLine,
  ArrowDownToLine,
  Minus,
  AlignHorizontalSpaceAround,
  AlignVerticalSpaceAround,
  Check,
} from "lucide-react";
import type { arrangeElements } from "./object-arrange";

type Action = Parameters<typeof arrangeElements>[2];
const actions: [Action, string, typeof AlignLeft][] = [
  ["left", "왼쪽 가장자리 맞춤", AlignLeft],
  ["center", "가로 가운데 맞춤", AlignCenter],
  ["right", "오른쪽 가장자리 맞춤", AlignRight],
  ["top", "위쪽 가장자리 맞춤", ArrowUpToLine],
  ["middle", "세로 가운데 맞춤", Minus],
  ["bottom", "아래쪽 가장자리 맞춤", ArrowDownToLine],
  ["horizontal", "가로 간격 동일하게", AlignHorizontalSpaceAround],
  ["vertical", "세로 간격 동일하게", AlignVerticalSpaceAround],
];

export default function ObjectAlignMenu({
  count,
  scope,
  onScope,
  onAction,
  onClose,
}: {
  count: number;
  scope: "slide" | "selection";
  onScope: (scope: "slide" | "selection") => void;
  onAction: (action: Action) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      ref={menu}
      className="popover align-popover"
      role="menu"
      aria-label="개체 맞춤"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        } else if (
          ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        ) {
          event.preventDefault();
          const items = Array.from(
            menu.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          items[
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length
          ]?.focus();
        } else if (event.key === "Tab") onClose();
        else if (event.key !== "Enter" && event.key !== " ")
          event.preventDefault();
      }}
    >
      {actions.map(([action, label, Icon], index) => (
        <button
          type="button"
          role="menuitem"
          key={action}
          className={index === 6 ? "menu-section-start" : undefined}
          disabled={count === 0 || (index >= 6 && count < 3)}
          onClick={() => {
            onAction(action);
            onClose();
          }}
        >
          <Icon size={16} />
          <span>{label}</span>
        </button>
      ))}
      <div role="separator" />
      {(["slide", "selection"] as const).map((value) => (
        <button
          type="button"
          role="menuitemradio"
          aria-checked={(count < 2 ? "slide" : scope) === value}
          key={value}
          disabled={value === "selection" && count < 2}
          onClick={() => onScope(value)}
        >
          <Check
            size={16}
            style={{
              visibility:
                (count < 2 ? "slide" : scope) === value ? "visible" : "hidden",
            }}
          />
          <span>
            {value === "slide" ? "슬라이드에 맞춤" : "선택 개체에 맞춤"}
          </span>
        </button>
      ))}
      <small>간격 맞춤은 잠기지 않은 개체 3개 이상을 선택하세요.</small>
    </div>
  );
}
