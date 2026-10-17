import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { THEMES } from "./model";
import { SlideVisual } from "./SlideCanvas";
import type { Deck, SlideElement } from "./types";
import {
  createChart,
  createDiagram,
  createEquation,
  createIcon,
  createSymbol,
  createWordArt,
  EQUATION_PRESETS,
  INSERT_ICONS,
  INSERT_SYMBOLS,
  parseChartData,
  parseDiagramLabels,
  type ChartKind,
  type DiagramKind,
  type InsertContentKind,
  type WordArtStyle,
} from "./insert-content";
import "./insert-content.css";

export interface InsertContentDialogProps {
  kind: InsertContentKind;
  deck: Pick<Deck, "width" | "height" | "theme">;
  background?: string;
  onInsert: (elements: SlideElement[]) => void;
  onCancel: () => void;
}
const NAMES: Record<InsertContentKind, string> = {
  chart: "차트",
  diagram: "다이어그램",
  icons: "아이콘",
  wordart: "WordArt",
  equation: "수식",
  symbol: "기호",
};
const CHARTS: { id: ChartKind; name: string; glyph: string }[] = [
  { id: "column", name: "세로 막대", glyph: "▥" },
  { id: "bar", name: "가로 막대", glyph: "▤" },
  { id: "line", name: "꺾은선", glyph: "⌁" },
  { id: "pie", name: "원형", glyph: "◕" },
];
const DIAGRAMS: { id: DiagramKind; name: string }[] = [
  { id: "process", name: "순서" },
  { id: "cycle", name: "주기" },
  { id: "organization", name: "조직도" },
  { id: "pyramid", name: "피라미드" },
];
const WORD_STYLES: { id: WordArtStyle; name: string }[] = [
  { id: "bold", name: "강조" },
  { id: "italic", name: "기울임" },
  { id: "underline", name: "밑줄" },
  { id: "badge", name: "컬러 박스" },
];

export function InsertContentDialog({
  kind,
  deck,
  background,
  onInsert,
  onCancel,
}: InsertContentDialogProps) {
  const theme = THEMES.find((t) => t.id === deck.theme) ?? THEMES[0];
  const [color, setColor] = useState(theme.accent);
  const [chart, setChart] = useState<ChartKind>("column");
  const [chartTitle, setChartTitle] = useState("분기별 실적");
  const [data, setData] = useState(
    "항목,값\n1분기,32\n2분기,48\n3분기,41\n4분기,65",
  );
  const [diagram, setDiagram] = useState<DiagramKind>("process");
  const [labels, setLabels] = useState("기획\n설계\n개발\n검증");
  const [icon, setIcon] = useState<string>("star");
  const [word, setWord] = useState("새로운 가능성");
  const [wordStyle, setWordStyle] = useState<WordArtStyle>("bold");
  const [formula, setFormula] = useState(EQUATION_PRESETS[0]);
  const [equationStyle, setEquationStyle] = useState("text");
  const [numerator, setNumerator] = useState("a + b");
  const [denominator, setDenominator] = useState("c");
  const [symbol, setSymbol] = useState("α");
  const titleId = useId(),
    hintId = useId(),
    errorId = useId();
  const dialogRef = useRef<HTMLDivElement>(null),
    previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(480);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current
      ?.querySelector<HTMLElement>("button, input, textarea")
      ?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    const resize = () => setPreviewWidth(target.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const result = useMemo(() => {
    try {
      const canvas = {
        width: deck.width,
        height: deck.height,
        color,
        textColor: theme.text,
      };
      const elements =
        kind === "chart"
          ? createChart(chart, parseChartData(data), chartTitle, canvas)
          : kind === "diagram"
            ? createDiagram(
                diagram,
                parseDiagramLabels(labels, diagram),
                canvas,
              )
            : kind === "icons"
              ? createIcon(icon, canvas)
              : kind === "wordart"
                ? createWordArt(word, wordStyle, canvas)
                : kind === "equation"
                  ? createEquation(
                      formula,
                      canvas,
                      equationStyle === "fraction"
                        ? { numerator, denominator }
                        : undefined,
                    )
                  : createSymbol(symbol, canvas);
      return { elements, error: "" };
    } catch (error) {
      return {
        elements: [] as SlideElement[],
        error:
          error instanceof Error ? error.message : "입력한 내용을 확인하세요.",
      };
    }
  }, [
    kind,
    deck.width,
    deck.height,
    theme.text,
    color,
    chart,
    data,
    chartTitle,
    diagram,
    labels,
    icon,
    word,
    wordStyle,
    formula,
    equationStyle,
    numerator,
    denominator,
    symbol,
  ]);
  const previewSlide = useMemo(
    () => ({
      id: "insert-preview",
      background: background ?? theme.background,
      notes: "",
      transition: "none" as const,
      elements: result.elements,
    }),
    [background, theme.background, result.elements],
  );
  const hint =
    kind === "equation"
      ? "수식은 텍스트로 편집할 수 있습니다. 분수는 분자와 분모를 각각 편집할 수 있습니다."
      : kind === "icons"
        ? "삽입한 아이콘의 크기와 색상을 자유롭게 바꿀 수 있습니다."
        : "삽입 후 각 도형과 글자를 편집할 수 있습니다.";
  return (
    <div
      className="modal-backdrop insert-content-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog insert-content-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
          if (event.key === "Tab") {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]',
              ),
            );
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header className="insert-content-heading">
          <div>
            <h2 id={titleId}>{NAMES[kind]} 삽입</h2>
            <p id={hintId}>{hint}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="대화상자 닫기"
            onClick={onCancel}
          >
            <X size={20} />
          </button>
        </header>
        <div className="insert-content-body">
          <div className="insert-content-controls">
            {kind === "chart" && (
              <>
                <fieldset>
                  <legend>차트 종류</legend>
                  <div className="insert-content-choices">
                    {CHARTS.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        aria-pressed={chart === option.id}
                        onClick={() => setChart(option.id)}
                      >
                        <span aria-hidden="true">{option.glyph}</span>
                        {option.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label>
                  차트 제목
                  <input
                    aria-label="차트 제목"
                    value={chartTitle}
                    maxLength={80}
                    onChange={(event) => setChartTitle(event.target.value)}
                  />
                </label>
                <label>
                  차트 데이터
                  <textarea
                    aria-label="차트 데이터"
                    value={data}
                    rows={8}
                    spellCheck={false}
                    aria-invalid={Boolean(result.error)}
                    aria-describedby={result.error ? errorId : undefined}
                    onChange={(event) => setData(event.target.value)}
                  />
                </label>
                <p className="insert-content-help">
                  항목과 값을 쉼표 또는 탭으로 구분하세요. 숫자만 한 줄씩
                  입력해도 됩니다. 최대 12개 항목, 값 열 1개를 지원합니다.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setData("항목,값\n1분기,32\n2분기,48\n3분기,41\n4분기,65")
                  }
                >
                  예제 데이터 사용
                </button>
              </>
            )}
            {kind === "diagram" && (
              <>
                <fieldset>
                  <legend>다이어그램 종류</legend>
                  <div className="insert-content-choices">
                    {DIAGRAMS.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        aria-pressed={diagram === option.id}
                        onClick={() => setDiagram(option.id)}
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label>
                  단계 이름
                  <textarea
                    aria-label="단계 이름"
                    value={labels}
                    rows={8}
                    aria-invalid={Boolean(result.error)}
                    onChange={(event) => setLabels(event.target.value)}
                  />
                </label>
                <p className="insert-content-help">
                  한 줄에 하나씩 입력하세요.{" "}
                  {diagram === "organization"
                    ? "첫 줄은 상위 조직입니다. 총 2~7개를 입력할 수 있습니다."
                    : diagram === "cycle"
                      ? "2~8개 단계를 입력할 수 있습니다."
                      : "2~6개 단계를 입력할 수 있습니다."}
                </p>
              </>
            )}
            {kind === "icons" && (
              <fieldset>
                <legend>아이콘 선택</legend>
                <div className="insert-icon-grid">
                  {INSERT_ICONS.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      aria-pressed={icon === option.id}
                      onClick={() => setIcon(option.id)}
                    >
                      <svg viewBox="-2 -2 28 28" aria-hidden="true">
                        <path
                          d={option.path}
                          fill={option.filled ? color : "none"}
                          stroke={option.filled ? "none" : color}
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span>{option.name}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {kind === "wordart" && (
              <>
                <label>
                  WordArt 문구
                  <input
                    aria-label="WordArt 문구"
                    value={word}
                    maxLength={80}
                    onChange={(event) => setWord(event.target.value)}
                  />
                </label>
                <fieldset>
                  <legend>글자 스타일</legend>
                  <div className="insert-wordart-grid">
                    {WORD_STYLES.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={`insert-wordart-${option.id}`}
                        aria-pressed={wordStyle === option.id}
                        onClick={() => setWordStyle(option.id)}
                      >
                        <span
                          style={{
                            color: option.id === "badge" ? undefined : color,
                          }}
                        >
                          가나다
                        </span>
                        {option.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            {kind === "equation" && (
              <>
                <fieldset>
                  <legend>수식 형식</legend>
                  <div className="insert-content-choices">
                    <button
                      type="button"
                      aria-pressed={equationStyle === "text"}
                      onClick={() => setEquationStyle("text")}
                    >
                      한 줄 수식
                    </button>
                    <button
                      type="button"
                      aria-pressed={equationStyle === "fraction"}
                      onClick={() => setEquationStyle("fraction")}
                    >
                      분수
                    </button>
                  </div>
                </fieldset>
                {equationStyle === "fraction" ? (
                  <>
                    <label>
                      분자
                      <input
                        aria-label="분자"
                        value={numerator}
                        maxLength={40}
                        onChange={(event) => setNumerator(event.target.value)}
                      />
                    </label>
                    <label>
                      분모
                      <input
                        aria-label="분모"
                        value={denominator}
                        maxLength={40}
                        onChange={(event) => setDenominator(event.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      수식 입력
                      <textarea
                        aria-label="수식 입력"
                        value={formula}
                        maxLength={160}
                        rows={3}
                        onChange={(event) => setFormula(event.target.value)}
                      />
                    </label>
                    <fieldset>
                      <legend>자주 쓰는 수식</legend>
                      <div className="insert-equation-presets">
                        {EQUATION_PRESETS.map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => setFormula(value)}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                <p className="insert-content-help">
                  √, ∑, ∫, ² 같은 수학 기호를 직접 입력하거나 예제 수식을 고쳐
                  사용하세요.
                </p>
              </>
            )}
            {kind === "symbol" && (
              <>
                <label>
                  삽입할 기호
                  <input
                    aria-label="삽입할 기호"
                    value={symbol}
                    maxLength={32}
                    onChange={(event) => setSymbol(event.target.value)}
                  />
                </label>
                <fieldset>
                  <legend>기호 선택</legend>
                  <div className="insert-symbol-grid">
                    {INSERT_SYMBOLS.map((value) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={symbol === value}
                        onClick={() => setSymbol(value)}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </>
            )}
            <label className="insert-color-control">
              <span>색상</span>
              <input
                type="color"
                aria-label="삽입 색상"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
              <span className="insert-color-code">{color.toUpperCase()}</span>
            </label>
          </div>
          <div className="insert-content-preview-panel">
            <div className="insert-content-preview-label">
              슬라이드 미리보기
            </div>
            <div
              className="insert-content-preview"
              ref={previewRef}
              style={{ aspectRatio: `${deck.width} / ${deck.height}` }}
              data-testid="insert-content-preview"
            >
              <SlideVisual
                slide={previewSlide}
                width={deck.width}
                height={deck.height}
                scale={previewWidth / deck.width}
              />
            </div>
            <p className="insert-content-preview-caption">
              미리보기에 표시된 위치에 삽입됩니다. 삽입 후 이동하거나 크기를
              조절할 수 있습니다.
            </p>
            {result.error && (
              <p className="insert-content-error" role="alert" id={errorId}>
                {result.error}
              </p>
            )}
          </div>
        </div>
        <footer className="insert-content-actions">
          <button type="button" className="button" onClick={onCancel}>
            취소
          </button>
          <button
            type="button"
            className="button primary"
            disabled={Boolean(result.error) || !result.elements.length}
            onClick={() => onInsert(result.elements)}
          >
            삽입
          </button>
        </footer>
      </div>
    </div>
  );
}
