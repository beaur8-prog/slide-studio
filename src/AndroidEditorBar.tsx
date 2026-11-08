import {
  forwardRef,
  useId,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  FolderOpen,
  Grid2X2,
  Image,
  Play,
  Plus,
  Redo2,
  Save,
  Settings2,
  StickyNote,
  Type,
  Undo2,
  X,
} from "lucide-react";

const tabs = [
  ["home", "홈"],
  ["insert", "삽입"],
  ["design", "디자인"],
  ["transitions", "전환"],
  ["slideshow", "슬라이드 쇼"],
  ["view", "보기"],
] as const;
type EditorTab = (typeof tabs)[number][0];
export type AndroidEditorHandle = { back(): boolean };
export default forwardRef<
  AndroidEditorHandle,
  {
    name: string;
    dirty: boolean;
    disabled: boolean;
    canUndo: boolean;
    canRedo: boolean;
    canEditText: boolean;
    onEditText(): void;
    fontTools: ReactNode;
    shapeTools: ReactNode;
    selectionTools: ReactNode;
    slideTools: ReactNode;
    insertTools: ReactNode;
    designTools: ReactNode;
    transitionTools: ReactNode;
    viewTools: ReactNode;
    onDone(): void;
    onSave(): void;
    onOpen(): void;
    onUndo(): void;
    onRedo(): void;
    onText(): void;
    onImage(): void;
    onSlide(): void;
    onNotes(): void;
    onFormat(): void;
    onPresent(fromBeginning?: boolean): void;
  }
>(function AndroidEditorBar(props, ref) {
  const id = useId();
  const [tab, setTab] = useState<EditorTab>("home");
  const [panel, setPanel] = useState<
    "text" | "shape" | "selection" | "slides" | null
  >(null);
  const selectTab = (next: EditorTab) => {
    setTab(next);
    setPanel(null);
  };
  const present = (first = false) => {
    setPanel(null);
    props.onPresent(first);
  };
  useImperativeHandle(ref, () => ({
    back() {
      if (panel) {
        setPanel(null);
        return true;
      }
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    },
  }));
  return (
    <div className="android-editor-bars" inert={props.disabled}>
      <header className="android-topbar">
        <button aria-label="보기로 돌아가기" onClick={props.onDone}>
          <ArrowLeft />
        </button>
        <div>
          <strong>{props.name}</strong>
          <small>
            {props.dirty ? "변경됨 · PPTX로 저장하세요" : "편집 모드"}
          </small>
        </div>
        <button
          aria-label="실행 취소"
          disabled={!props.canUndo}
          onPointerDown={(e) => e.preventDefault()}
          onClick={props.onUndo}
        >
          <Undo2 />
        </button>
        <button
          aria-label="다시 실행"
          disabled={!props.canRedo}
          onPointerDown={(e) => e.preventDefault()}
          onClick={props.onRedo}
        >
          <Redo2 />
        </button>
        <button aria-label="PPTX 저장" onClick={props.onSave}>
          <Save />
        </button>
        <button
          className="android-labeled-icon"
          aria-label="슬라이드 쇼 시작"
          onClick={() => present()}
        >
          <Play />
          <span>발표</span>
        </button>
      </header>
      <nav
        className="android-ribbon-tabs"
        role="tablist"
        aria-label="편집 리본"
        data-text-selection-control
        onPointerDown={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
            return;
          const buttons = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]',
            ),
          ];
          const index = buttons.indexOf(e.target as HTMLButtonElement);
          if (index < 0) return;
          e.preventDefault();
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? tabs.length - 1
                : (index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                  tabs.length;
          selectTab(tabs[next][0]);
          buttons[next].focus();
        }}
      >
        {tabs.map(([value, name]) => (
          <button
            key={value}
            id={`${id}-${value}`}
            role="tab"
            aria-selected={tab === value}
            aria-controls={`${id}-ribbon`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => selectTab(value)}
          >
            {name}
          </button>
        ))}
      </nav>
      <div
        id={`${id}-ribbon`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}`}
        className="android-ribbon-content"
      >
        {tab === "home" && (
          <nav className="android-edit-actions" aria-label="터치 편집 도구">
            <button
              aria-expanded={panel === "text"}
              data-text-selection-control
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setPanel(panel === "text" ? null : "text")}
            >
              <Type />
              글자
            </button>
            <button
              aria-expanded={panel === "shape"}
              onClick={() => setPanel(panel === "shape" ? null : "shape")}
            >
              <Settings2 />
              도형
            </button>
            <button
              aria-expanded={panel === "selection"}
              onClick={() =>
                setPanel(panel === "selection" ? null : "selection")
              }
            >
              선택
            </button>
            <button onClick={props.onFormat}>서식</button>
            <span className="android-ribbon-separator" />
            <button
              aria-expanded={panel === "slides"}
              onClick={() => setPanel(panel === "slides" ? null : "slides")}
            >
              <Grid2X2 />
              슬라이드
            </button>
            <button onClick={props.onSlide}>
              <Plus />새 슬라이드
            </button>
            <button onClick={props.onNotes}>
              <StickyNote />
              노트
            </button>
          </nav>
        )}
        {tab === "insert" && (
          <div className="android-insert-actions android-ribbon-actions">
            <button onClick={props.onText}>
              <Type />
              텍스트 상자
            </button>
            <button onClick={props.onImage}>
              <Image />
              그림
            </button>
            <button onClick={props.onSlide}>
              <Plus />새 슬라이드
            </button>
            <button onClick={props.onOpen}>
              <FolderOpen />
              파일 열기
            </button>
            {props.insertTools}
          </div>
        )}
        {tab === "design" && (
          <div className="android-ribbon-actions">{props.designTools}</div>
        )}
        {tab === "transitions" && (
          <div className="android-ribbon-actions">{props.transitionTools}</div>
        )}
        {tab === "slideshow" && (
          <div className="android-ribbon-actions">
            <button onClick={() => present(true)}>
              <Play />
              처음부터 발표
            </button>
            <button onClick={() => present()}>
              <Play />
              현재 슬라이드에서 발표
            </button>
          </div>
        )}
        {tab === "view" && (
          <div className="android-ribbon-actions">
            <button onClick={props.onNotes}>
              <StickyNote />
              발표자 노트
            </button>
            <button onClick={props.onFormat}>
              <Settings2 />
              개체 서식
            </button>
            {props.viewTools}
            <button onClick={props.onDone}>
              <ArrowLeft />
              보기 모드로 전환
            </button>
          </div>
        )}
      </div>
      {panel && (
        <section className="android-edit-panel" aria-label="터치 편집 옵션">
          <button
            className="android-edit-panel-close"
            aria-label="편집 옵션 닫기"
            onClick={() => setPanel(null)}
          >
            <X />
          </button>
          <h3>
            {
              {
                text: "글꼴·단락",
                shape: "도형 서식",
                selection: "개체 선택",
                slides: "슬라이드 관리",
              }[panel]
            }
          </h3>
          {panel === "text" && (
            <>
              <button
                disabled={!props.canEditText}
                onClick={() => {
                  setPanel(null);
                  props.onEditText();
                }}
              >
                선택한 텍스트 편집
              </button>
              {props.fontTools}
            </>
          )}
          {panel === "shape" && props.shapeTools}
          {panel === "selection" && props.selectionTools}
          {panel === "slides" && props.slideTools}
        </section>
      )}
    </div>
  );
});
