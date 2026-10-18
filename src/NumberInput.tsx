import { useEffect, useRef, useState, type ComponentProps } from "react";

type Props = Omit<
  ComponentProps<"input">,
  | "type"
  | "value"
  | "onChange"
  | "onBlur"
  | "onKeyDown"
  | "min"
  | "max"
  | "step"
> & {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

// A typed number is a draft: clamping each keystroke turns "2" into "16"
// before the user can finish typing "200". Commit once on Enter or blur.
export default function NumberInput({
  value,
  onChange,
  min = -10000,
  max = 10000,
  step = 1,
  ...props
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    dirty.current = false;
    setDraft(null);
  }, [value]);
  useEffect(() => {
    const blurBeforeSelectionChange = (event: PointerEvent) => {
      const field = input.current;
      // Canvas selection happens on pointerdown and can unmount this field.
      // Finish the draft first, while its callback still targets the old object.
      if (field === document.activeElement && event.target !== field)
        field?.blur();
    };
    document.addEventListener("pointerdown", blurBeforeSelectionChange, true);
    return () =>
      document.removeEventListener(
        "pointerdown",
        blurBeforeSelectionChange,
        true,
      );
  }, []);

  const commit = (raw: string) => {
    if (!dirty.current) return;
    dirty.current = false;
    setDraft(null);
    const parsed = Number(raw);
    if (!raw.trim() || !Number.isFinite(parsed)) return;
    const next = Math.max(min, Math.min(max, parsed));
    if (next !== value) onChange(next);
  };

  return (
    <input
      {...props}
      ref={input}
      type="number"
      value={draft ?? value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => {
        dirty.current = true;
        setDraft(event.target.value);
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Enter") commit(event.currentTarget.value);
          else {
            dirty.current = false;
            setDraft(null);
          }
          event.currentTarget.blur();
        } else if (
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          const raw = event.currentTarget.value;
          const base =
            raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : value;
          dirty.current = true;
          commit(String(base + (event.key === "ArrowUp" ? step : -step)));
        }
      }}
    />
  );
}
