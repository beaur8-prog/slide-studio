import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./object-context-menu.css";
import { restoreTextSelection, type TextMenuSelection } from "./text-selection";

export type ObjectMenuAction = {
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  separator?: boolean;
};

export default function ObjectContextMenu({
  x,
  y,
  actions,
  onClose,
  label = "개체 편집",
  textSelection,
}: {
  x: number;
  y: number;
  actions: ObjectMenuAction[];
  onClose: (restoreFocus?: boolean) => void;
  label?: string;
  textSelection?: TextMenuSelection;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = menu.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (
      textSelection &&
      "highlights" in CSS &&
      typeof Highlight !== "undefined"
    )
      CSS.highlights.set(
        "context-text-selection",
        new Highlight(textSelection.range),
      );
    const viewport = window.visualViewport;
    const editor = host.closest<HTMLElement>(".android-editor");
    const footer = editor?.querySelector<HTMLElement>(":scope > .statusbar");
    const position = () => {
      let left = viewport?.offsetLeft ?? 0;
      let top = viewport?.offsetTop ?? 0;
      let right = left + (viewport?.width ?? innerWidth);
      let bottom = top + (viewport?.height ?? innerHeight);
      if (editor) {
        // The APK draws under system bars. Its shell padding contains the
        // resolved native/camera insets, which a fixed popup does not inherit.
        const rect = editor.getBoundingClientRect(), style = getComputedStyle(editor);
        left = Math.max(left, rect.left + parseFloat(style.paddingLeft));
        top = Math.max(top, rect.top + parseFloat(style.paddingTop));
        right = Math.min(right, rect.right - parseFloat(style.paddingRight));
        bottom = Math.min(bottom, rect.bottom - parseFloat(style.paddingBottom));
        const icons = footer?.getBoundingClientRect();
        if (icons && icons.height > 0 && icons.top > top)
          bottom = Math.min(bottom, icons.top);
      }
      left += 8; top += 8; right -= 8; bottom -= 8;
      host.style.setProperty("--context-menu-available-width", `${Math.max(0, right - left)}px`);
      host.style.setProperty("--context-menu-available-height", `${Math.max(0, bottom - top)}px`);
      const bounds = host.getBoundingClientRect();
      host.style.left = `${Math.max(left, Math.min(x, right - bounds.width))}px`;
      host.style.top = `${Math.max(top, Math.min(y, bottom - bounds.height))}px`;
    };
    position();
    host
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!host.contains(event.target as Node)) {
        const transfer =
          textSelection &&
          event.target instanceof Element &&
          event.target.closest(
            "[data-text-format-trigger], [data-text-selection-control]",
          );
        onClose(!!transfer);
      }
    };
    const close = () => onClose(false);
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (["Escape", "Tab"].includes(event.key)) {
        event.preventDefault();
        onClose(true);
        if (textSelection) restoreTextSelection(textSelection);
        else previous?.focus({ preventScroll: true });
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(
          host.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      } else if (event.key !== "Enter" && event.key !== " ") {
        event.preventDefault();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    const resize = new ResizeObserver(position);
    if (editor) resize.observe(editor);
    if (footer) resize.observe(footer);
    // Capture prevents editor shortcuts from changing objects behind the menu.
    host.addEventListener("keydown", key);
    return () => {
      if (textSelection && "highlights" in CSS)
        CSS.highlights.delete("context-text-selection");
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      resize.disconnect();
      host.removeEventListener("keydown", key);
    };
  }, [x, y, onClose, textSelection]);
  return (
    <div
      ref={menu}
      className="object-context-menu"
      role="menu"
      aria-label={label}
      style={{ left: x, top: y }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (textSelection) event.preventDefault();
      }}
    >
      {actions.map((action) => (
        <div key={action.label}>
          {action.separator && <div role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled}
            onClick={() => {
              onClose();
              action.run();
            }}
          >
            {action.icon}
            <span>{action.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
