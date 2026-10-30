import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { X } from "lucide-react";
import { THEMES } from "./model";
import { SlideVisual } from "./SlideCanvas";
import type { Deck, SlideElement } from "./types";
import { parseChartData, type ChartKind } from "./insert-content";
import { chartBytes } from "./chart";
import {
  chartDataText,
  createEditableChart,
  readEditableChart,
  sameChartDraft,
  validateEditableChart,
} from "./chart-editing";
import "./insert-content.css";

const CHARTS = [
  { id: "column", name: "세로 막대" },
  { id: "bar", name: "가로 막대" },
  { id: "line", name: "꺾은선" },
  { id: "pie", name: "원형" },
] as const;
const EXAMPLE = "항목,값\n1분기,32\n2분기,48\n3분기,41\n4분기,65";

export default function ChartEditorDialog({
  deck,
  background,
  initial,
  assetBudget = Infinity,
  onApply,
  onCancel,
}: {
  deck: Pick<Deck, "width" | "height" | "theme">;
  background?: string;
  initial?: SlideElement;
  assetBudget?: number;
  onApply: (element: SlideElement) => void;
  onCancel: () => void;
}) {
  const original = useMemo(() => readEditableChart(initial?.chart), [initial]);
  const theme = THEMES.find((t) => t.id === deck.theme) ?? THEMES[0];
  const [kind, setKind] = useState<ChartKind>(original?.kind ?? "column");
  const [title, setTitle] = useState(original?.title ?? "분기별 실적");
  const [color, setColor] = useState(original?.color ?? theme.accent);
  const [text, setText] = useState(
    original ? chartDataText(original.data) : EXAMPLE,
  );
  const heading = useId(),
    hint = useId(),
    errorId = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    previewHost = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(480);
  const draft = useMemo(() => {
    try {
      if (initial && !original)
        throw Error("이 차트의 데이터는 PowerPoint에서 편집해 주세요.");
      const value = {
        kind,
        title,
        color,
        textColor: original?.textColor ?? theme.text,
        fontFamily: original?.fontFamily ?? "Arial",
        data: parseChartData(text),
      };
      validateEditableChart(value);
      return { value, error: "" };
    } catch (error) {
      return { value: null, error: (error as Error).message };
    }
  }, [kind, title, color, text, original, initial, theme.text]);
  const [generated, setGenerated] = useState<{
    draft: typeof draft;
    element?: SlideElement;
    error?: string;
  }>();
  useEffect(() => {
    if (!draft.value) return;
    let live = true;
    const timer = window.setTimeout(() => {
      if (original && initial && sameChartDraft(original, draft.value!)) {
        setGenerated({ draft, element: initial });
        return;
      }
      void createEditableChart(draft.value!, deck)
        .then((element) => {
          if (live)
            setGenerated({
              draft,
              element: initial ? { ...initial, chart: element.chart } : element,
            });
        })
        .catch((error) => {
          if (live) setGenerated({ draft, error: (error as Error).message });
        });
    }, 120);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [draft, deck.width, deck.height, original, initial]);
  const ready =
    initial && original && draft.value && sameChartDraft(original, draft.value)
      ? { element: initial, error: undefined }
      : generated?.draft === draft
        ? generated
        : undefined;
  const error =
    draft.error ||
    ready?.error ||
    (ready?.element?.chart && chartBytes(ready.element.chart) > assetBudget
      ? "내장 그림·동영상·차트의 합계가 100MB를 초과합니다. 기존 미디어를 줄인 뒤 삽입하거나 적용해 주세요."
      : "");
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const host = dialog.current;
    host?.showModal();
    return () => {
      host?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const host = previewHost.current;
    if (!host) return;
    const resize = () => setPreviewWidth(host.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="dialog insert-content-dialog chart-editor-dialog"
      aria-labelledby={heading}
      aria-describedby={hint}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        if (e.key === "Tab") {
          const controls = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),textarea:not(:disabled)",
            ),
          );
          const target =
            e.shiftKey && document.activeElement === controls[0]
              ? controls.at(-1)
              : !e.shiftKey && document.activeElement === controls.at(-1)
                ? controls[0]
                : undefined;
          if (target) {
            e.preventDefault();
            target.focus();
          }
        }
      }}
    >
      <header className="insert-content-heading">
        <div>
          <h2 id={heading}>{initial ? "차트 데이터 편집" : "차트 삽입"}</h2>
          <p id={hint}>
            숫자를 바꾸면 차트가 갱신됩니다. 삽입한 차트는 더블클릭하여 다시
            편집할 수 있습니다. 외부 Excel 파일과 실시간 연동되지는 않습니다.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="대화상자 닫기"
          onClick={onCancel}
        >
          <X size={20} />
        </button>
      </header>
      <div className="insert-content-body">
        <div className="insert-content-controls">
          <fieldset>
            <legend>차트 종류</legend>
            <div className="insert-content-choices">
              {CHARTS.map((c) => (
                <button
                  key={c.id}
                  aria-pressed={kind === c.id}
                  onClick={() => setKind(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            차트 제목
            <input
              aria-label="차트 제목"
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            차트 데이터
            <textarea
              aria-label="차트 데이터"
              rows={8}
              maxLength={10000}
              spellCheck={false}
              value={text}
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <p className="insert-content-help">
            항목과 값을 쉼표 또는 탭으로 구분하세요. 최대 12개 항목, 값 열 1개를
            지원합니다.
          </p>
          <button className="text-button" onClick={() => setText(EXAMPLE)}>
            예제 데이터 사용
          </button>
          <label className="insert-color-control">
            <span>색상</span>
            <input
              type="color"
              aria-label="삽입 색상"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
            <span className="insert-color-code">{color.toUpperCase()}</span>
          </label>
        </div>
        <div className="insert-content-preview-panel">
          <span className="insert-content-preview-label">미리보기</span>
          <div
            className="insert-content-preview"
            data-testid="insert-content-preview"
            ref={previewHost}
            style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
            aria-busy={!error && !ready}
          >
            <SlideVisual
              slide={{
                id: "chart-preview",
                background: background ?? theme.background,
                notes: "",
                transition: "none",
                elements: ready?.element
                  ? [
                      {
                        ...ready.element,
                        hidden: false,
                        groupHidden: undefined,
                      },
                    ]
                  : [],
              }}
              width={deck.width}
              height={deck.height}
              scale={previewWidth / deck.width}
            />
          </div>
          {error ? (
            <p className="insert-content-error" role="alert" id={errorId}>
              {error}
            </p>
          ) : (
            !ready && <p role="status">미리보기를 갱신하고 있습니다.</p>
          )}
          <p className="insert-content-preview-caption">
            {initial
              ? "적용하면 선택한 차트의 데이터가 바뀝니다. 위치와 크기는 유지됩니다."
              : "차트는 하나의 개체로 삽입됩니다. 위치와 크기를 자유롭게 조절할 수 있습니다."}
          </p>
        </div>
      </div>
      <footer className="insert-content-actions">
        <button className="button" onClick={onCancel}>
          취소
        </button>
        <button
          className="button primary"
          disabled={!!error || !ready?.element}
          onClick={() => ready?.element && onApply(ready.element)}
        >
          {initial ? "적용" : "삽입"}
        </button>
      </footer>
    </dialog>
  );
}
