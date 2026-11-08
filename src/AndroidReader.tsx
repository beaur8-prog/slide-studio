import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Edit3,
  FolderOpen,
  Grid2X2,
  Maximize,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Share2,
  StickyNote,
  X,
} from "lucide-react";
import type { Deck } from "./types";
import { slideTitle } from "./model";
import { findDocumentText, slideSearchText } from "./document-search";
import SlidePreview from "./SlidePreview";
import AndroidSlideViewport from "./AndroidSlideViewport";

type Panel =
  | "slides"
  | "search"
  | "notes"
  | "more"
  | "page"
  | "content"
  | "warnings"
  | null;
export type AndroidReaderHandle = { back(escapeOnly?: boolean): boolean };
export default forwardRef<
  AndroidReaderHandle,
  {
    deck: Deck;
    index: number;
    home: boolean;
    hasDocument: boolean;
    version: string;
    dirty: boolean;
    warnings: string[];
    canShare: boolean;
    disabled: boolean;
    onHome: (home: boolean) => void;
    onOpen: () => void;
    onNew: () => void;
    onSelect: (index: number) => void;
    onEdit: () => void;
    onPresent: () => void;
    onShare: () => void;
    onDownload: () => void;
    onSave: () => void;
    hasRecovery: boolean;
    hasBackups: boolean;
    onRecover: () => void;
    onBackups: () => void;
  }
>(function AndroidReader(props, ref) {
  const { deck, index, home, hasDocument, disabled } = props;
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState("");
  const [pageError, setPageError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [reset, setReset] = useState(0);
  const [requestedZoom, setRequestedZoom] = useState(1);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const slide = deck.slides[index];
  const results = useMemo(
    () =>
      panel === "search"
        ? findDocumentText(deck, query)
        : { matches: [], truncated: false },
    [deck, query, panel],
  );
  const close = () => {
    setPanel(null);
    returnFocus.current?.focus({ preventScroll: true });
  };
  const open = (value: Panel) => {
    returnFocus.current = document.activeElement as HTMLElement;
    setPanel(value);
  };
  useImperativeHandle(ref, () => ({
    back(escapeOnly = false) {
      if (panel) {
        close();
        return true;
      }
      if (escapeOnly) return true;
      if (!home) {
        props.onHome(true);
        return true;
      }
      return false;
    },
  }));
  useEffect(() => {
    setPanel(null);
    setQuery("");
  }, [deck.id, home]);
  useEffect(() => {
    if (!panel) return;
    const root = panelRef.current!;
    (
      root.querySelector<HTMLElement>("input") ??
      root.querySelector<HTMLElement>("button")
    )?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,textarea,[tabindex="0"]',
        ),
      ];
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && at <= 0) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && at === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    root.addEventListener("keydown", key);
    return () => root.removeEventListener("keydown", key);
  }, [panel]);
  const select = (at: number) => {
    props.onSelect(at);
    close();
  };
  const names = {
    slides: "슬라이드 목록",
    search: "문서 검색",
    notes: "발표자 노트",
    more: "문서 메뉴",
    page: "페이지로 이동",
    content: "슬라이드 내용 읽기",
    warnings: "표시 안내",
  };
  return (
    <div className="android-app" data-testid="android-reader">
      <div className="android-reader-body" inert={!!panel || disabled}>
        {home ? (
          <main className="android-home">
            <h1>Slide Studio</h1>
            <p>프레젠테이션을 열어 보거나 발표하세요.</p>
            <button className="android-primary" onClick={props.onOpen}>
              <FolderOpen />
              파일 열기
            </button>
            <button onClick={props.onNew}>
              <Plus />새 프레젠테이션
            </button>
            {props.hasRecovery && (
              <button onClick={props.onRecover}>
                임시 저장한 문서 이어서 편집
              </button>
            )}
            {props.hasBackups && (
              <button onClick={props.onBackups}>보관된 복구 데이터</button>
            )}
            {hasDocument && (
              <section>
                <h2>열려 있는 문서</h2>
                <button onClick={() => props.onHome(false)}>
                  {deck.name}
                  <ChevronRight />
                </button>
              </section>
            )}
            <small>v{props.version} · Android</small>
          </main>
        ) : (
          <>
            <header className="android-topbar">
              <button
                aria-label="문서 시작 화면"
                onClick={() => props.onHome(true)}
              >
                <ArrowLeft />
              </button>
              <div>
                <strong>{deck.name}</strong>
                <small>
                  {props.dirty
                    ? "저장하지 않은 변경 사항"
                    : "보기 모드 · 원본 유지"}
                </small>
              </div>
              <button
                className="android-labeled-icon"
                aria-label="편집"
                onClick={props.onEdit}
              >
                <Edit3 />
                <span>편집</span>
              </button>
              <button
                aria-label="현재 슬라이드에서 발표"
                onClick={props.onPresent}
              >
                <Play />
              </button>
              <button
                className="android-labeled-icon"
                aria-label="문서 메뉴"
                onClick={() => open("more")}
              >
                <MoreHorizontal />
                <span>메뉴</span>
              </button>
            </header>
            {props.warnings.length > 0 && (
              <button
                className="android-warning"
                onClick={() => open("warnings")}
              >
                일부 항목의 표시 제한 · 자세히 ({props.warnings.length})
              </button>
            )}
            <AndroidSlideViewport
              slide={slide}
              width={deck.width}
              height={deck.height}
              resetVersion={reset}
              requestedZoom={requestedZoom}
              onZoom={setZoom}
              onStep={(direction) =>
                props.onSelect(
                  Math.max(
                    0,
                    Math.min(deck.slides.length - 1, index + direction),
                  ),
                )
              }
            />
            <nav className="android-navigation" aria-label="슬라이드 탐색">
              <button aria-label="슬라이드 목록" onClick={() => open("slides")}>
                <Grid2X2 />
              </button>
              <button
                aria-label="이전 슬라이드"
                disabled={index === 0}
                onClick={() => props.onSelect(index - 1)}
              >
                <ChevronLeft />
              </button>
              <button
                className="android-page-number"
                aria-label={`페이지로 이동 · ${index + 1} / ${deck.slides.length}`}
                onClick={() => {
                  setPage(String(index + 1));
                  setPageError("");
                  open("page");
                }}
              >
                {index + 1} / {deck.slides.length}
              </button>
              <button
                aria-label="다음 슬라이드"
                disabled={index === deck.slides.length - 1}
                onClick={() => props.onSelect(index + 1)}
              >
                <ChevronRight />
              </button>
              <button
                className="android-labeled-icon"
                aria-label="화면에 맞춤"
                title={`현재 확대 ${Math.round(zoom * 100)}%`}
                onClick={() => {
                  setRequestedZoom(1);
                  setReset((value) => value + 1);
                }}
              >
                <Maximize />
                <span>화면 맞춤</span>
              </button>
            </nav>
            <p className="android-sr-only" role="status">
              슬라이드 {index + 1} / {deck.slides.length}: {slideTitle(slide)}
            </p>
          </>
        )}
      </div>
      {panel && (
        <div
          className="android-sheet-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section
            ref={panelRef}
            className={`android-sheet android-sheet-${panel}`}
            role="dialog"
            aria-modal="true"
            aria-label={names[panel]}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2>{names[panel]}</h2>
              <button aria-label="패널 닫기" onClick={close}>
                <X />
              </button>
            </header>
            {panel === "more" && (
              <div className="android-menu-items">
                <button onClick={() => open("search")}>
                  <Search />
                  문서 검색
                </button>
                <button onClick={() => open("notes")}>
                  <StickyNote />
                  발표자 노트
                </button>
                <button onClick={() => open("content")}>
                  슬라이드 내용 읽기
                </button>
                {props.hasBackups && (
                  <button
                    onClick={() => {
                      close();
                      props.onBackups();
                    }}
                  >
                    보관된 복구 데이터
                  </button>
                )}
                <button
                  disabled={zoom >= 5}
                  onClick={() => {
                    setRequestedZoom(Math.min(5, zoom + 1));
                    setReset((value) => value + 1);
                    close();
                  }}
                >
                  슬라이드 확대
                </button>
                <button
                  disabled={zoom <= 1}
                  onClick={() => {
                    setRequestedZoom(Math.max(1, zoom - 1));
                    setReset((value) => value + 1);
                    close();
                  }}
                >
                  슬라이드 축소
                </button>
                <button
                  onClick={() => {
                    close();
                    props.onEdit();
                  }}
                >
                  <Edit3 />
                  편집
                </button>
                <button
                  disabled={!props.canShare}
                  onClick={() => {
                    close();
                    props.onShare();
                  }}
                >
                  <Share2 />
                  원본 파일 공유
                </button>
                <button
                  disabled={!props.canShare}
                  onClick={() => {
                    close();
                    props.onDownload();
                  }}
                >
                  원본 파일 다운로드
                </button>
                {props.dirty && (
                  <button
                    onClick={() => {
                      close();
                      props.onSave();
                    }}
                  >
                    편집한 PPTX 저장
                  </button>
                )}
                <button
                  onClick={() => {
                    close();
                    props.onOpen();
                  }}
                >
                  <FolderOpen />
                  다른 파일 열기
                </button>
                <small>
                  v{props.version} · 원본 공유에는 편집 내용이 포함되지
                  않습니다.
                </small>
              </div>
            )}
            {panel === "slides" && (
              <div className="android-slide-grid slide-sorter">
                {deck.slides.map((item, at) => (
                  <button
                    key={item.id}
                    aria-label={`슬라이드 ${at + 1}: ${slideTitle(item)}`}
                    aria-current={index === at ? "page" : undefined}
                    onClick={() => select(at)}
                  >
                    <SlidePreview
                      slide={item}
                      width={deck.width}
                      height={deck.height}
                      size={144}
                      active={index === at}
                    />
                    <span>
                      {at + 1}. {slideTitle(item)}
                      {item.hidden ? " (발표에서 숨김)" : ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {panel === "search" && (
              <>
                <input
                  aria-label="문서에서 찾기"
                  type="search"
                  value={query}
                  maxLength={2000}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="슬라이드의 텍스트 검색"
                />
                <p role="status">
                  {query
                    ? `${results.matches.length}개 결과${results.truncated ? " · 결과 제한에 도달했습니다" : ""}`
                    : "검색어를 입력하세요."}
                </p>
                <div className="android-search-results">
                  {results.matches.slice(0, 200).map((match) => (
                    <button
                      key={match.id}
                      onClick={() => select(match.slideIndex)}
                    >
                      <strong>슬라이드 {match.slideIndex + 1}</strong>
                      <span>
                        {match.before}
                        <mark>{match.value}</mark>
                        {match.after}
                      </span>
                    </button>
                  ))}
                </div>
                {results.matches.length > 200 && (
                  <p>
                    앞의 200개 결과를 표시합니다. 검색어를 더 입력해 범위를
                    줄이세요.
                  </p>
                )}
              </>
            )}
            {panel === "page" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = Number(page);
                  if (
                    !/^\d+$/.test(page) ||
                    value < 1 ||
                    value > deck.slides.length
                  ) {
                    setPageError(
                      `1~${deck.slides.length} 사이의 페이지를 입력하세요.`,
                    );
                    return;
                  }
                  select(value - 1);
                }}
              >
                <label>
                  슬라이드 번호
                  <input
                    aria-label="슬라이드 번호"
                    inputMode="numeric"
                    value={page}
                    onChange={(event) => setPage(event.target.value)}
                  />
                </label>
                {pageError && <p role="alert">{pageError}</p>}
                <button className="android-primary" type="submit">
                  이동
                </button>
              </form>
            )}
            {panel === "notes" && (
              <p className="android-readable">
                {slide.notes || "이 슬라이드에 노트가 없습니다."}
              </p>
            )}
            {panel === "content" && (
              <div className="android-readable">
                <h3>{slideTitle(slide)}</h3>
                <p>
                  {slideSearchText(slide) || "읽을 수 있는 텍스트가 없습니다."}
                </p>
              </div>
            )}
            {panel === "warnings" && (
              <ul className="android-readable">
                {props.warnings.map((warning, at) => (
                  <li key={at}>{warning}</li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
});
