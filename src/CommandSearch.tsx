import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export type EditorCommand = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};

export default function CommandSearch({ commands, enabled = true }: { commands: EditorCommand[]; enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const results = commands.filter((command) =>
    `${command.label} ${command.keywords || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const activeIndex = Math.min(index, Math.max(0, results.length - 1));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const run = (command: EditorCommand) => { close(); command.run(); };

  useEffect(() => {
    if (!open || !results[activeIndex]) return;
    document.getElementById(`command-${results[activeIndex].id}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!enabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery("");
        setIndex(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);

  useEffect(() => { if (!enabled) setOpen(false); }, [enabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div className="command-search" ref={container}>
      <button ref={trigger} className="command-trigger" aria-label="명령 및 슬라이드 검색" aria-expanded={open}
        disabled={!enabled}
        title="명령 및 슬라이드 검색 (Ctrl+K)" onClick={() => { setOpen(!open); setQuery(""); setIndex(0); }}>
        <Search size={15} /><span>어떤 작업을 원하시나요?</span><kbd>Ctrl K</kbd>
      </button>
      {open && enabled && <div className="command-popover" role="dialog" aria-label="명령 검색"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setIndex((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % (results.length || 1));
          }
          if (event.key === "Enter") {
            event.stopPropagation();
            // Buttons keep their own native Enter action (including Close).
            if (event.target instanceof HTMLInputElement && results[activeIndex]) {
              event.preventDefault(); run(results[activeIndex]);
            }
          }
        }}>
        <div className="command-input-row"><Search size={17} />
          <input autoFocus aria-label="명령 검색어" placeholder="명령 또는 슬라이드 내용 검색" value={query}
            role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results"
            aria-activedescendant={results[activeIndex] ? `command-${results[activeIndex].id}` : undefined}
            onChange={(event) => { setQuery(event.target.value); setIndex(0); }} />
          <button aria-label="검색 닫기" onClick={close}><X size={16} /></button>
        </div>
        <div className="command-results" id="command-results" role="listbox" aria-label="검색 결과">
          {results.map((command, i) => <button key={command.id} id={`command-${command.id}`} role="option"
            aria-selected={i === activeIndex} className={i === activeIndex ? "highlighted" : ""}
            onFocus={() => setIndex(i)} onMouseEnter={() => setIndex(i)} onClick={() => run(command)}>
            <span>{command.label}</span><small>{command.hint}</small>
          </button>)}
          {!results.length && <p>일치하는 명령이나 슬라이드가 없습니다.</p>}
        </div>
        <div className="command-footer">{results.length}개 결과 · ↑ ↓ 선택 · Enter 실행 · Esc 닫기</div>
      </div>}
    </div>
  );
}
