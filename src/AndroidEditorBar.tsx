import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  FolderOpen,
  Grid2X2,
  Image,
  Plus,
  Redo2,
  Save,
  Settings2,
  StickyNote,
  Type,
  Undo2,
  X,
} from "lucide-react";

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
  }
>(function AndroidEditorBar(props, ref) {
  const [panel, setPanel] = useState<
    "text" | "shape" | "insert" | "selection" | "slides" | null
  >(null);
  useImperativeHandle(ref, () => ({
    back() {
      if (!panel) return false;
      setPanel(null);
      return true;
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
          onPointerDown={(event) => event.preventDefault()}
          onClick={props.onUndo}
        >
          <Undo2 />
        </button>
        <button
          aria-label="다시 실행"
          disabled={!props.canRedo}
          onPointerDown={(event) => event.preventDefault()}
          onClick={props.onRedo}
        >
          <Redo2 />
        </button>
        <button aria-label="PPTX 저장" onClick={props.onSave}>
          <Save />
        </button>
      </header>
      <nav className="android-edit-actions" aria-label="터치 편집 도구">
        <button
          aria-expanded={panel === "insert"}
          onClick={() => setPanel(panel === "insert" ? null : "insert")}
        >
          <Plus />
          삽입
        </button>
        <button
          aria-expanded={panel === "text"}
          data-text-selection-control
          onPointerDown={(event) => event.preventDefault()}
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
          onClick={() => setPanel(panel === "selection" ? null : "selection")}
        >
          선택
        </button>
        <button onClick={props.onFormat}>서식</button>
        <button
          aria-expanded={panel === "slides"}
          onClick={() => setPanel(panel === "slides" ? null : "slides")}
        >
          <Grid2X2 />
          슬라이드
        </button>
        <button onClick={props.onNotes}>
          <StickyNote />
          노트
        </button>
      </nav>
      {panel && (
        <section className="android-edit-panel" aria-label="터치 편집 옵션">
          <button
            className="android-edit-panel-close"
            aria-label="편집 옵션 닫기"
            onClick={() => setPanel(null)}
          >
            <X />
          </button>
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
          {panel === "insert" && (
            <div className="android-insert-actions">
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
        </section>
      )}
    </div>
  );
});
