import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./object-context-menu.css";

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
}: {
  x: number;
  y: number;
  actions: ObjectMenuAction[];
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = menu.current!;
    const previous = document.activeElement as HTMLElement | null;
    const bounds = host.getBoundingClientRect();
    host.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
    host.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    host
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!host.contains(event.target as Node)) onClose();
    };
    const close = () => onClose();
    const key = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (["Escape", "Tab"].includes(event.key)) {
        event.preventDefault();
        onClose();
        previous?.focus({ preventScroll: true });
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
    // Capture prevents editor shortcuts from changing objects behind the menu.
    host.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      host.removeEventListener("keydown", key);
    };
  }, [x, y, onClose]);
  return (
    <div
      ref={menu}
      className="object-context-menu"
      role="menu"
      aria-label="개체 편집"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
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
