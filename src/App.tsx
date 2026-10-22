import {
  recordTextUndo,
  textUndoCheckpoints,
  type TextUndoSession,
} from "./text-undo";
import { isVideoFile, readVideo, VIDEO_ACCEPT } from "./video";
import { usePresenterView } from "./PresenterView";
import { duplicateSlides, moveSlides } from "./slide-operations";
import { documentCapacityError, type DocumentAddition } from "./document-limits";
import type { InkStroke } from "./presentation-ink";
import { fitTableRows } from "./table-layout";
import { arrangeElements } from "./object-arrange";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ArrowDownToLine,
  Bold,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  EyeOff,
  File,
  FolderOpen,
  Grid2X2,
  Image as ImageIcon,
  Italic,
  Layers,
  LayoutTemplate,
  LockKeyhole,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  Play,
  Plus,
  Redo2,
  Save,
  Settings2,
  Shapes,
  Square,
  StickyNote,
  Trash2,
  Type,
  Underline,
  Undo2,
  UnlockKeyhole,
  X,
  ZoomIn,
  Keyboard,
  Triangle,
  MoveUpRight,
  ArrowRight,
  LoaderCircle,
  AlertCircle,
  Presentation,
  FileDown,
  Printer,
  ClipboardPaste,
  Scissors,
  ChevronUp,
  Sun,
  Moon,
  PanelRight,
  Table2,
  BarChart3,
  Network,
  Smile,
  Images,
  Link as LinkIcon,
  CalendarDays,
  Hash,
  Sigma,
  Omega,
  Camera,
} from "lucide-react";
import FontManager from "./FontManager";
import CommandSearch from "./CommandSearch";
import TextColorPalette from "./TextColorPalette";
import NumberInput from "./NumberInput";
import NotesPane from "./NotesPane";
import {
  copyElements,
  expandGroups,
  groupElements,
  ungroupElements,
} from "./object-groups";
import {
  applyTextFormatRanges,
  cssColorHex,
  trackTextFormat,
  setSelectedFontSize,
  type InlineFormat,
} from "./text-formatting";
import { captureTextSelection, restoreTextSelection } from "./text-selection";
import TextContextMenu from "./TextContextMenu";
import type { TextMenuSelection } from "./text-selection";
import ObjectContextMenu, { type ObjectMenuAction } from "./ObjectContextMenu";
import CanvasScrollbar from "./CanvasScrollbar";
import type {
  Deck,
  ShapeKind,
  Slide,
  SlideElement,
  TableCellFormat,
} from "./types";
import { editText, patchText, scaleElement } from "./text-layout";
import {
  hasTextBullets,
  toggleTextBullets,
  toggleTextNumbering,
} from "./text-bullets";
import {
  blankDeck,
  duplicateSlide,
  element,
  newSlide,
  reorder,
  sampleDeck,
  slideTitle,
  THEMES,
  uid,
} from "./model";
import SlideCanvas, { SlideVisual } from "./SlideCanvas";
import { exportPptx, importPptx, parseDeckJson } from "./io";
import { loadAutosave, saveAutosave } from "./storage";
import { restoreWindowBuffer } from "./startup";
import type { RecentPresentationFile } from "./types";
import TableEditor from "./TableEditor";
import {
  createTableElement,
  tableCellStyle,
  validateTable,
  applyTableCellFormat,
} from "./table";
import { changeTableAxis, visibleTableCells, MAX_TABLE_ROWS } from "./table";
import {copyStudioTable,readStudioTable,pasteStudioTable} from './table-exchange';
import { parseTableClipboard, pasteTableClipboard } from "./table-clipboard";
import type { TableCellRange } from "./table";
import { selectionRange, type TableCellSelection } from "./table-selection";
import { InsertContentDialog } from "./InsertContentDialog";
import type { InsertContentKind } from "./insert-content";
import {
  FooterDialog,
  LinkDialog,
  PhotoAlbumDialog,
  imageElementFromData,
} from "./InsertExtras";
import { applyFooters, resolveDeckFields } from "./insert-fields";
import ScreenshotDialog from "./ScreenshotDialog";
import PresentationInk, { type PresentationInkHandle } from "./PresentationInk";
import { DEFAULT_SHAPE_FILL, EXTRA_SHAPES, shapeInsertionStyle } from "./shape-presets";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);

type History = {
  past: Deck[];
  present: Deck;
  future: Deck[];
  textUndo?: TextUndoSession;
};
type Tab = "home" | "insert" | "design" | "transitions" | "slideshow" | "view";
type Modal =
  | "fonts"
  | "new"
  | "library"
  | "shortcuts"
  | "import"
  | "table"
  | "album"
  | "link"
  | "footer"
  | "screenshot"
  | InsertContentKind
  | null;
const contentDialogs: InsertContentKind[] = [
  "chart",
  "diagram",
  "icons",
  "wordart",
  "equation",
  "symbol",
];
const LIMIT = 60;
const clone = <T,>(value: T): T => structuredClone(value);
const round = (n: number) => Math.round(n * 10) / 10;
const tableClipboardText = (cells: string[][]) =>
  cells
    .map((row) =>
      row
        .map((value) =>
          /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value,
        )
        .join("\t"),
    )
    .join("\n");
const editingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.isContentEditable);
function Tool({
  icon,
  children,
  onClick,
  active,
  disabled,
  title,
  small = false,
  preserveTextSelection = false,
}: {
  icon: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  small?: boolean;
  preserveTextSelection?: boolean;
}) {
  return (
    <button
      className={`tool ${small ? "small" : ""} ${active ? "active" : ""}`}
      onClick={onClick}
      data-text-selection-control={preserveTextSelection || undefined}
      onMouseDown={
        preserveTextSelection ? (event) => event.preventDefault() : undefined
      }
      disabled={disabled}
      title={title}
      aria-label={typeof children === "string" ? children : title}
      aria-pressed={active === undefined ? undefined : active}
    >
      {icon}
      {children && <span>{children}</span>}
    </button>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min = -10000,
  max = 10000,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <NumberInput
        aria-label={label}
        value={round(value)}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
      />
    </label>
  );
}
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <label className="color-field">
      <span>{label}</span>
      <span className="color-input">
        <input
          type="color"
          value={value === "transparent" ? "#FFFFFF" : value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
        <code>{value === "transparent" ? "없음" : value.toUpperCase()}</code>
      </span>
    </label>
  );
}

function LibraryContents({
  onOpen,
  onNew,
  notify,
}: {
  onOpen: (id: string) => Promise<void>;
  onNew: () => void;
  notify: (message: string) => void;
}) {
  const [documents, setDocuments] = useState<RecentPresentationFile[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const saved = await window.desktop?.recentFiles?.() ?? [];
        if (!disposed) setDocuments(saved);
      } catch {
        if (!disposed) {
          setDocuments([]);
          notify("최근 파일 목록을 불러오지 못했습니다.");
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [notify]);
  const open = async (id: string) => {
    setOpening(id);
    try {
      await onOpen(id);
    } catch {
      notify("원본 파일을 열 수 없습니다. 파일이 이동되거나 삭제되었는지 확인하세요.");
      try { setDocuments(await window.desktop?.recentFiles?.() ?? []); } catch {}
    } finally {
      setOpening(null);
    }
  };
  return (
    <>
      <div className="dialog-eyebrow">YOUR WORKSPACE</div>
      <h2>내 프레젠테이션</h2>
      <p>최근에 열거나 저장한 실제 파일입니다. 삭제되거나 이동한 파일은 제외합니다.</p>
      {documents === null && (
        <p role="status">최근 파일을 확인하고 있습니다.</p>
      )}
      {documents?.length === 0 && <p>최근 파일이 없습니다. 파일을 열거나 PPTX로 저장하면 여기에 표시됩니다.</p>}
      <div className="library-grid">
        <button className="library-new" onClick={onNew}>
          <Plus size={27} />
          <strong>새 프레젠테이션</strong>
        </button>
        {documents?.map((file) => (
          <button key={file.id} className="library-file" title={file.path}
            aria-label={`파일 열기: ${file.name}`}
            disabled={!file.available || opening !== null}
            onClick={() => void open(file.id)}>
            <Presentation size={36} aria-hidden="true" />
            <strong>{file.name}</strong>
            <small>{file.path}</small>
            {!file.available && <small>파일에 접근할 수 없습니다.</small>}
            {opening === file.id && <small role="status">열고 있습니다.</small>}
          </button>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: blankDeck(),
    future: [],
  }));
  const deck = useMemo(
    () => resolveDeckFields(history.present),
    [history.present],
  );
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const [activeId, setActiveId] = useState(deck.slides[0].id);
  const activeIndex = Math.max(
    0,
    deck.slides.findIndex((s) => s.id === activeId),
  );
  const slide = deck.slides[activeIndex];
  const [selected, setSelected] = useState<string[]>([]);
  const [slideSelection, setSlideSelection] = useState<string[]>([]);
  const selectedSlideIds = slideSelection.includes(activeId)
    ? slideSelection.filter((id) => deck.slides.some((s) => s.id === id))
    : [activeId];
  const slideAnchor = useRef<string | null>(null);
  const [slideMenu, setSlideMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const dragSlideIds = useRef<string[]>([]);
  const [alignScope, setAlignScope] = useState<"slide" | "selection">(
    "selection",
  );
  const [editing, setEditing] = useState<string | null>(null);
  const nudgeKey = useRef<string | null>(null);
  const [inlineFormat, setInlineFormat] = useState<
    Record<InlineFormat, boolean>
  >({ bold: false, italic: false, underline: false });
  const ribbonTextSelection = useRef<TextMenuSelection | undefined>(undefined);
  const [inlineTextStyle, setInlineTextStyle] = useState({
    fontFamily: "Arial",
    fontSize: 32,
    color: "#233D35",
    align: "left",
  });
  useEffect(() => {
    if (!editing) return;
    const read = () => {
      const host = document.querySelector<HTMLElement>(".editing-text");
      if (!host || !captureTextSelection(host)) return;
      const selection = getSelection();
      let parent =
        selection?.anchorNode instanceof Element
          ? selection.anchorNode
          : selection?.anchorNode?.parentElement;
      if (parent) {
        // Imported list separators use a zero-size span for a logical space.
        // Show the surrounding marker's font rather than a meaningless 0.
        while (parent !== host && getComputedStyle(parent).fontSize === "0px")
          parent = parent.parentElement ?? host;
        const css = getComputedStyle(parent);
        setInlineTextStyle({
          fontFamily: css.fontFamily
            .split(",")[0]
            .replace(/^["']|["']$/g, "")
            .trim(),
          fontSize: parseFloat(css.fontSize),
          color: cssColorHex(css.color) ?? "#233D35",
          align: css.textAlign,
        });
      }
      setInlineFormat({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
      });
    };
    read();
    document.addEventListener("selectionchange", read);
    document.addEventListener("input", read);
    return () => {
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("input", read);
    };
  }, [editing]);
  const selectedElement = slide.elements.find((e) => e.id === selected[0]);
  const selectedShapes = slide.elements.filter(
    (element) => element.type === "shape" && selected.includes(element.id),
  );
  const shapeStyleTarget =
    selectedShapes.find((element) => !element.locked) ?? selectedShapes[0];
  const shapeStylesDisabled = !selectedShapes.some((element) => !element.locked);
  const [tableSelection, setTableSelection] =
    useState<TableCellSelection | null>(null);
  const activeTableSelection =
    selected.length === 1 &&
    selectedElement?.type === "table" &&
    !selectedElement.locked &&
    tableSelection?.elementId === selectedElement.id
      ? tableSelection
      : null;
  const tableRange = activeTableSelection
    ? selectionRange(activeTableSelection)
    : undefined;
  const textCapable =
    !!selectedElement &&
    ["text", "shape", "table"].includes(selectedElement.type);
  const selectedTextStyle = selectedElement?.table
    ? tableCellStyle(
        selectedElement.table,
        activeTableSelection?.focus.row ?? 0,
        activeTableSelection?.focus.column ?? 0,
      )
    : selectedElement;
  const patchSelectedText = (patch: Partial<SlideElement>) =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((el) => {
        if (!selected.includes(el.id) || el.locked) return el;
        if (!el.table) return patchText(el, patch);
        const range =
          el.id === activeTableSelection?.elementId && tableRange
            ? tableRange
            : {
                startRow: 0,
                endRow: el.table.cells.length - 1,
                startColumn: 0,
                endColumn: el.table.cells[0].length - 1,
              };
        return fitTableRows({
          ...el,
          table: applyTableCellFormat(
            el.table,
            range,
            patch as TableCellFormat,
          ),
        });
      }),
    }));
  useEffect(() => {
    if (!activeTableSelection || !selectedElement?.table) {
      if (tableSelection) setTableSelection(null);
      return;
    }
    const clamp = (cell: { row: number; column: number }) => ({
      row: Math.min(cell.row, selectedElement.table!.cells.length - 1),
      column: Math.min(cell.column, selectedElement.table!.cells[0].length - 1),
    });
    const anchor = clamp(activeTableSelection.anchor),
      focus = clamp(activeTableSelection.focus);
    if (
      anchor.row !== activeTableSelection.anchor.row ||
      anchor.column !== activeTableSelection.anchor.column ||
      focus.row !== activeTableSelection.focus.row ||
      focus.column !== activeTableSelection.focus.column
    )
      setTableSelection({ ...activeTableSelection, anchor, focus });
  }, [selected, selectedElement, activeId, tableSelection]);
  const [tab, setTab] = useState<Tab>("home");
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saving" | "saved" | "error">(
    "saving",
  );
  // The window's recovery buffer is not a saved PPTX. Keep the last file
  // snapshot so autosave cannot silently authorize discarding a user's work.
  const [fileSnapshot, setFileSnapshot] = useState<Deck | null>(history.present);
  const hasFileChanges = history.present !== fileSnapshot;
  const restoredFileChanges = useRef((() => {
    try { return restoreWindowBuffer && sessionStorage.getItem("slide-studio-file-dirty") === "true"; }
    catch { return false; }
  })());
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState("");
  const printing = useRef(false);
  const savingPptx = useRef(false);
  const [modal, setModal] = useState<Modal>(null);
  const modalRef = useRef<Modal>(modal);
  modalRef.current = modal;
  const modalInstance = useRef(0);
  useLayoutEffect(() => {
    modalInstance.current++;
  }, [modal]);
  const [tableEditId, setTableEditId] = useState<string | null>(null);
  const [tableEditRange, setTableEditRange] = useState<TableCellRange>();
  const [footerInitial, setFooterInitial] = useState<
    "footer" | "date" | "number"
  >("footer");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [menu, setMenu] = useState<"file" | "layout" | "shape" | null>(null);
  const [objectMenu, setObjectMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [textMenu, setTextMenu] = useState<{
    x: number;
    y: number;
    selection: TextMenuSelection;
  } | null>(null);
  const [colorPalette, setColorPalette] = useState<{
    x: number;
    y: number;
    color: string;
    selection?: TextMenuSelection;
    partial: boolean;
    ids: string[];
    slideId: string;
  } | null>(null);
  const colorSelection = useRef<TextMenuSelection | undefined>(undefined);
  const closeObjectMenu = useCallback(() => setObjectMenu(null), []);
  const [layout, setLayout] = useState("title");
  const [zoom, setZoom] = useState<number | null>(null);
  const [fitScale, setFitScale] = useState(0.6);
  const scale = zoom === null ? fitScale : zoom;
  const [notesVisible, setNotesVisible] = useState(true);
  const [grid, setGrid] = useState(false);
  const [guides, setGuides] = useState(false);
  const [sorter, setSorter] = useState(false);
  const [inspectorVisible, setInspectorVisible] = useState(false);
  const [ribbonCollapsed, setRibbonCollapsed] = useState(false);
  const [rulerVisible, setRulerVisible] = useState(false);
  const [chromeTheme, setChromeTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("slide-studio-chrome") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [presenting, setPresenting] = useState(false);
  useEffect(() => {
    setObjectMenu(null);
    setTextMenu(null);
    setColorPalette(null);
  }, [activeId, deck.id, modal, presenting, sorter]);
  const presentationActive = useRef(false);
  const presentationView = useRef<HTMLDivElement>(null);
  const presentationInk = useRef<PresentationInkHandle>(null);
  const browserPresentationFullscreen = useRef(false);
  const browserFullscreenExitPending = useRef(false);
  const [presentIndex, setPresentIndex] = useState(0);
  const [presentEnded, setPresentEnded] = useState(false);
  const presentationPosition = useRef({ index: 0, ended: false });
  const presentationOrigin = useRef(activeId);
  const presentationNumber = useRef("");
  const presentationWheel = useRef({
    delta: 0,
    lastEvent: -Infinity,
    navigated: false,
    direction: 0,
  });
  const [presentNotes, setPresentNotes] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [whiteout, setWhiteout] = useState(false);
  const [pendingInk, setPendingInk] = useState<Record<
    string,
    InkStroke[]
  > | null>(null);
  const [windowSize, setWindowSize] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  const [dragSlide, setDragSlide] = useState<number | null>(null);
  const [dropSlide, setDropSlide] = useState<number | null>(null);
  const canvasArea = useRef<HTMLDivElement>(null);
  const thumbnailList = useRef<HTMLDivElement>(null);
  const wheelGesture = useRef({
    delta: 0,
    lastEvent: -Infinity,
    navigated: false,
    direction: 0,
  });
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const transaction = useRef<Deck | null>(null);
  const clipboard = useRef<{
    elements?: SlideElement[];
    slide?: Slide;
    slides?: Slide[];
    cutDeckId?: string;
    cells?: string[][];
    cellStyles?: TableCellFormat[][];
  }>({});
  const clipboardToken = useRef("");
  const clipboardRequest = useRef(0);
  const clipboardContext = useRef(0);
  // A permission prompt/read may outlive the selection that requested paste.
  // An epoch also catches changing away and back to the original location.
  useLayoutEffect(() => {
    clipboardContext.current++;
  }, [history.present, activeId, selected, slideSelection, tableSelection,
    editing, modal, presenting, sorter, ready, busy]);
  const loadedRef = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.chrome = chromeTheme;
    try {
      localStorage.setItem("slide-studio-chrome", chromeTheme);
    } catch {
      /* Optional preference storage. */
    }
    void window.desktop?.setChromeTheme?.(chromeTheme).catch(() => {});
  }, [chromeTheme]);
  useEffect(() => {
    document.title = `${deck.name} — Slide Studio`;
  }, [deck.name]);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }, []);
  const commit = useCallback((update: (d: Deck) => Deck) => {
    setHistory((h) => {
      const next = update(h.present);
      if (next === h.present) return h;
      return {
        past: [...h.past, h.present].slice(-LIMIT),
        present: next,
        future: [],
      };
    });
  }, []);
  const begin = useCallback(() => {
    // All document updates are immutable. Reuse the snapshot, including large
    // embedded images, instead of cloning the entire deck on each edit.
    if (!transaction.current) transaction.current = deckRef.current;
  }, []);
  const preview = useCallback((update: (d: Deck) => Deck) => {
    setHistory((h) => ({ ...h, present: update(h.present) }));
  }, []);
  const previewText = useCallback(
    (
      update: (d: Deck) => Deck,
      id: string,
      inputType: string,
      row?: number,
      column?: number,
    ) => {
      // Native Save can finish a transaction without blurring the text editor.
      // Further typing must start a new transaction for document-level undo.
      if (!transaction.current) transaction.current = deckRef.current;
      setHistory((h) => {
        const next = update(h.present);
        return {
          ...h,
          present: next,
          textUndo: recordTextUndo(
            h.textUndo,
            h.present,
            next,
            id,
            inputType,
            row,
            column,
          ),
        };
      });
    },
    [],
  );
  const finish = useCallback(() => {
    const before = transaction.current;
    transaction.current = null;
    if (before)
      setHistory((h) =>
        before === h.present || (h.textUndo?.cursor === 0 && !h.textUndo.atomic)
          ? { ...h, textUndo: undefined }
          : {
              past: [
                ...h.past,
                ...(h.textUndo ? textUndoCheckpoints(h.textUndo) : [before]),
              ].slice(-LIMIT),
              present: h.present,
              future: [],
            },
      );
  }, []);
  const closeTextMenu = useCallback(
    (endEditing = false) => {
      if (endEditing) {
        finish();
        setEditing(null);
      }
      setTextMenu(null);
    },
    [finish],
  );
  const undo = useCallback(() => {
    setEditing(null);
    transaction.current = null;
    setSelected([]);
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future],
          }
        : h,
    );
  }, []);
  const redo = useCallback(() => {
    setEditing(null);
    transaction.current = null;
    setSelected([]);
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
  }, []);
  const inlineUndoAvailable = !!editing && !!history.textUndo && history.textUndo.cursor > 0;
  const inlineRedoAvailable = !!editing && !!history.textUndo &&
    history.textUndo.cursor < history.textUndo.entries.length - 1;
  const pendingPreview = !editing && !!transaction.current &&
    transaction.current !== history.present;
  const runToolbarHistory = (direction: "undo" | "redo") => {
    const host = document.querySelector<HTMLElement>(".editing-text");
    const inlineAvailable = direction === "undo" ? inlineUndoAvailable : inlineRedoAvailable;
    if (host && inlineAvailable) {
      // Keep Chromium's text edit grouping and selection, just like the keyboard
      // shortcut. Blurring first would discard the inline redo branch.
      host.focus();
      document.execCommand(direction);
      return;
    }
    finish();
    if (direction === "undo") undo();
    else redo();
  };
  const changeSlide = (update: (s: Slide) => Slide) =>
    commit((d) => ({
      ...d,
      slides: d.slides.map((s) => (s.id === slide.id ? update(s) : s)),
    }));
  const updateSelected = (patch: Partial<SlideElement>) =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        selected.includes(e.id) && !e.locked ? patchText(e, patch) : e,
      ),
    }));
  const updateSelectedShapes = (update: (element: SlideElement) => SlideElement) => {
    if (shapeStylesDisabled) return;
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((element) =>
        element.type === "shape" && selected.includes(element.id) && !element.locked
          ? update(element)
          : element,
      ),
    }));
  };
  const setShapeFill = (fill: string) =>
    updateSelectedShapes((element) => ({ ...element, fill, gradient: undefined }));
  const setShapeStroke = (stroke: string) =>
    updateSelectedShapes((element) => ({
      ...element,
      stroke,
      strokeWidth: element.strokeWidth || 2,
      strokeOpacity: element.strokeOpacity === 0 ? undefined : element.strokeOpacity,
    }));
  const setShapeStrokeWidth = (strokeWidth: number) =>
    updateSelectedShapes((element) => ({
      ...element,
      strokeWidth,
      stroke: element.stroke && element.stroke !== "transparent" ? element.stroke : "#233D35",
      strokeOpacity: element.strokeOpacity === 0 ? undefined : element.strokeOpacity,
    }));
  const selectSlide = (
    id: string,
    modifiers?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    if (modifiers?.shiftKey) {
      const anchor = deck.slides.findIndex(
          (s) => s.id === (slideAnchor.current ?? activeId),
        ),
        index = deck.slides.findIndex((s) => s.id === id);
      setSlideSelection(
        deck.slides
          .slice(Math.min(anchor, index), Math.max(anchor, index) + 1)
          .map((s) => s.id),
      );
    } else if (modifiers?.ctrlKey || modifiers?.metaKey) {
      setSlideSelection(
        selectedSlideIds.includes(id)
          ? selectedSlideIds.length > 1
            ? selectedSlideIds.filter((v) => v !== id)
            : [id]
          : [...selectedSlideIds, id],
      );
    } else {
      setSlideSelection([id]);
      slideAnchor.current = id;
    }
    setSlideMenu(null);
    finish();
    setActiveId(
      (modifiers?.ctrlKey || modifiers?.metaKey) &&
        selectedSlideIds.includes(id) &&
        selectedSlideIds.length > 1
        ? selectedSlideIds.find((v) => v !== id)!
        : id,
    );
    setSelected([]);
    setEditing(null);
    setMenu(null);
  };
  const replaceDeck = (next: Deck) => {
    // A file dialog/import started in the editor can finish after a show starts.
    // Leave the old deck's presentation before its slide indexes become invalid.
    if (presentationActive.current) stopPresent();
    setHistory({ past: [], present: next, future: [] });
    setFileSnapshot(next);
    transaction.current = null;
    setActiveId(next.slides[0].id);
    setSelected([]);
    setEditing(null);
    setModal(null);
    setMenu(null);
    setZoom(null);
    setSorter(false);
    setWarnings([]);
    setToast("");
  };

  useEffect(() => {
    const list = thumbnailList.current;
    const active = list?.querySelector<HTMLElement>(".thumbnail-row.active");
    if (!list || !active) return;
    const frame = list.getBoundingClientRect(),
      item = active.getBoundingClientRect();
    if (item.top < frame.top) list.scrollTop -= frame.top - item.top + 6;
    else if (item.bottom > frame.bottom)
      list.scrollTop += item.bottom - frame.bottom + 6;
  }, [activeId, ready]);

  // A wheel gesture over the slide changes pages. At larger zoom levels the
  // canvas scrolls normally until its edge; side panels keep their own scrolling.
  useEffect(() => {
    const area = canvasArea.current;
    if (!area || presenting || modal || busy) return;
    const workspace = area.parentElement!;
    const wheel = (event: WheelEvent) => {
      if (event.buttons || editing || editingTarget(event.target)) return;
      const dy =
        event.deltaY *
        (event.deltaMode === 1
          ? 40
          : event.deltaMode === 2
            ? area.clientHeight
            : 1);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setZoom((previous) =>
          Math.max(
            0.2,
            Math.min(1.5, (previous ?? scale) * Math.exp(-dy / 600)),
          ),
        );
        return;
      }
      if (
        event.shiftKey ||
        !dy ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
      )
        return;
      const direction = Math.sign(dy),
        now = performance.now(),
        gesture = wheelGesture.current;
      // Small mouse-wheel notches should work on their own. A quiet gap or
      // reversal starts the next gesture; continuous trackpad momentum remains
      // part of the current gesture instead of advancing again on a timer.
      if (now - gesture.lastEvent > 80 || direction !== gesture.direction) {
        gesture.delta = 0;
        gesture.navigated = false;
      }
      gesture.lastEvent = now;
      gesture.direction = direction;
      const canScroll =
        direction > 0
          ? area.scrollTop + area.clientHeight < area.scrollHeight - 2
          : area.scrollTop > 2;
      if (canScroll) {
        gesture.delta = 0;
        if (event.target instanceof Node && !area.contains(event.target)) {
          event.preventDefault();
          area.scrollTop += dy;
        }
        return;
      }
      event.preventDefault();
      if (gesture.navigated) return;
      gesture.delta += dy;
      if (Math.abs(gesture.delta) < 12) return;
      gesture.delta = 0;
      const next = activeIndex + direction;
      if (next < 0 || next >= deck.slides.length) return;
      gesture.navigated = true;
      selectSlide(deck.slides[next].id);
      area.scrollTop = direction > 0 ? 0 : area.scrollHeight;
    };
    workspace.addEventListener("wheel", wheel, { passive: false });
    return () => workspace.removeEventListener("wheel", wheel);
  });

  useEffect(() => {
    let disposed = false;
    loadAutosave()
      .then((saved) => {
        if (disposed) return;
        if (saved && restoreWindowBuffer) {
          try {
            const safe = parseDeckJson(JSON.stringify(saved));
            setHistory({ past: [], present: safe, future: [] });
            setFileSnapshot(restoredFileChanges.current ? null : safe);
            setActiveId(safe.slides[0].id);
          } catch {
            notify("저장된 문서를 읽지 못해 새 프레젠테이션을 열었습니다.");
          }
        }
        loadedRef.current = true;
        setReady(true);
      })
      .catch(() => {
        if (!disposed) {
          setReady(true);
          setSaveStatus("error");
          notify("자동 저장소를 열지 못했습니다. 파일로 저장해 주세요.");
        }
      });
    return () => {
      disposed = true;
    };
  }, [notify]);
  useLayoutEffect(() => {
    if (!ready || !loadedRef.current) return;
    setSaveStatus("saving");
    let live = true;
    const timer = setTimeout(() => {
      saveAutosave(deck)
        .then(() => {
          if (live) setSaveStatus("saved");
        })
        .catch(() => {
          if (live) {
            setSaveStatus("error");
            notify("자동 저장에 실패했습니다. 파일로 저장해 주세요.");
          }
        });
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [deck, ready, notify]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem("slide-studio-file-dirty", String(hasFileChanges)); }
    catch { /* File protection still works when session storage is unavailable. */ }
  }, [ready, hasFileChanges]);
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (hasFileChanges || saveStatus !== "saved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [hasFileChanges, saveStatus]);
  useEffect(() => {
    if (!deck.slides.some((s) => s.id === activeId)) {
      setActiveId(
        deck.slides[Math.min(activeIndex, deck.slides.length - 1)].id,
      );
      setSelected([]);
    }
  }, [deck.slides, activeId, activeIndex]);
  useLayoutEffect(() => {
    if (!canvasArea.current) return;
    const measure = () => {
      if (canvasArea.current) {
        const { clientWidth: width, clientHeight: height } = canvasArea.current;
        setFitScale(
          Math.min(
            (width - 64) / deck.width,
            (height - 60) / deck.height,
            1.25,
          ),
        );
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(canvasArea.current);
    measure();
    return () => ro.disconnect();
  }, [deck.width, deck.height, ready, sorter, notesVisible]);
  useEffect(() => {
    const resize = () =>
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  const withinCapacity = (addition: DocumentAddition = {}, current = deckRef.current) => {
    const error = documentCapacityError(current, addition);
    if (error) notify(error);
    return !error;
  };
  const canAddElements = (count: number) => {
    // A file read may complete after the document was replaced.
    if (deckRef.current.id !== deck.id || !deckRef.current.slides.some((s) => s.id === slide.id))
      return false;
    return withinCapacity({ elements: { [slide.id]: count } });
  };
  const addSlide = (chosen = "content") => {
    const next = newSlide(chosen, deck.theme, deck.width, deck.height);
    if (!withinCapacity({ slides: [next] })) return;
    commit((d) => {
      const slides = [...d.slides];
      slides.splice(activeIndex + 1, 0, next);
      return { ...d, slides };
    });
    selectSlide(next.id);
    setSorter(false);
  };
  const duplicateCurrentSlide = () => {
    const source = deck.slides.filter((s) => selectedSlideIds.includes(s.id));
    if (!withinCapacity({ slides: source })) return;
    const copies = duplicateSlides(source);
    commit((d) => ({
      ...d,
      slides: [
        ...d.slides.slice(0, activeIndex + 1),
        ...copies,
        ...d.slides.slice(activeIndex + 1),
      ],
    }));
    selectSlide(copies[0].id);
    setSlideSelection(copies.map((s) => s.id));
    notify(`${copies.length}개 슬라이드를 복제했습니다.`);
  };
  const removeSlide = (id?: string) => {
    const ids = id ? [id] : selectedSlideIds,
      remaining = deck.slides.filter((s) => !ids.includes(s.id));
    if (!remaining.length) {
      notify("프레젠테이션에는 슬라이드가 하나 이상 필요합니다.");
      return;
    }
    commit((d) => ({
      ...d,
      slides: d.slides.filter((s) => !ids.includes(s.id)),
    }));
    selectSlide(remaining[Math.min(activeIndex, remaining.length - 1)].id);
  };
  const applySlideLayout = (layout: string) => {
    const next = newSlide(layout, deck.theme, deck.width, deck.height);
    const content = slide.elements.filter((e) => e.type === "text");
    let index = 0;
    const slots = next.elements.map((e) => {
      if (e.type !== "text") return e;
      const old = content[index++];
      return old ? { ...e, text: old.text, paragraphs: old.paragraphs, field: old.field } : e;
    });
    // Preserve every source object; reflow text into the new slots and retain artwork.
    const elements = layout === "blank" ? slide.elements : [
      ...slots,
      ...slide.elements.filter((e) => !content.slice(0, index).includes(e)),
    ];
    if (!canAddElements(elements.length - slide.elements.length)) return;
    finish();
    setEditing(null);
    setSelected([]);
    changeSlide((s) => ({ ...s, elements }));
    setMenu(null);
  };
  const slideContext = (id: string, x: number, y: number) => {
    if (!selectedSlideIds.includes(id)) selectSlide(id);
    finish();
    setEditing(null);
    setSelected([]);
    setObjectMenu(null);
    setTextMenu(null);
    setSlideMenu({ x, y });
  };
  const startSlideDrag = (
    id: string,
    index: number,
    event: React.DragEvent,
  ) => {
    dragSlideIds.current = selectedSlideIds.includes(id)
      ? selectedSlideIds
      : [id];
    setDragSlide(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  };
  const dropSlides = (id: string | null) => {
    const ids = [...dragSlideIds.current];
    commit((d) => ({
      ...d,
      slides: moveSlides(d.slides, ids, id),
    }));
    setDragSlide(null);
    setDropSlide(null);
    dragSlideIds.current = [];
  };
  const addElement = (type: SlideElement["type"], shape?: ShapeKind) => {
    if (!canAddElements(1)) return;
    const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
    const next = element(type, {
      x: deck.width * 0.28,
      y: deck.height * 0.35,
      ...(type === "text"
        ? { color: theme.text, wrap: true, autoHeight: true }
        : {}),
      ...(type === "shape"
        ? {
            shape: shape ?? "rect",
            ...shapeInsertionStyle(shape ?? "rect"),
            width: shape === "line" || shape === "arrow" ? 360 : 260,
            height: shape === "line" || shape === "arrow" ? 24 : 180,
          }
        : {}),
    });
    changeSlide((s) => ({ ...s, elements: [...s.elements, next] }));
    setSelected([next.id]);
    setMenu(null);
  };
  const insertElements = (elements: SlideElement[]) => {
    if (!elements.length) return;
    try {
      // Validate new objects against the same limits as saved projects before
      // adding them to the undo history. Existing image strings remain shared.
      const checked = parseDeckJson(
        JSON.stringify({ ...deck, slides: [{ ...slide, elements }] }),
      ).slides[0].elements;
      if (!canAddElements(checked.length)) return;
      changeSlide((s) => ({ ...s, elements: [...s.elements, ...checked] }));
      setSelected(checked.map((el) => el.id));
      setEditing(null);
      setModal(null);
      setMenu(null);
      setSorter(false);
    } catch (err) {
      notify((err as Error).message);
    }
  };
  const openTable = (id: string | null = null, range?: TableCellRange) => {
    if (editing) {
      finish();
      setEditing(null);
    }
    setTableEditId(id);
    setTableEditRange(
      id
        ? (range ??
            (activeTableSelection?.elementId === id ? tableRange : undefined))
        : undefined,
    );
    setModal("table");
    setMenu(null);
  };
  const openFooter = (initial: "footer" | "date" | "number") => {
    setFooterInitial(initial);
    setModal("footer");
    setMenu(null);
  };
  const removeSelected = () => {
    if (activeTableSelection) {
      clearSelectedTableCells();
      return;
    }
    if (selected.length) {
      changeSlide((s) => ({
        ...s,
        elements: s.elements.filter(
          (e) => !selected.includes(e.id) || e.locked,
        ),
      }));
      setSelected([]);
    }
  };
  const clearSelectedTableCells = () => {
    if (!activeTableSelection || !tableRange) return;
    const { startRow, endRow, startColumn, endColumn } = tableRange;
    commit((deck) => {
      let changed = false;
      const slides = deck.slides.map((current) => {
        if (current.id !== activeId) return current;
        const elements = current.elements.map((element) => {
          if (
            element.id !== activeTableSelection.elementId ||
            !element.table ||
            element.locked
          )
            return element;
          let cleared = false;
          const cells = element.table.cells.map((row, r) =>
            row.map((text, c) => {
              if (
                text &&
                r >= startRow &&
                r <= endRow &&
                c >= startColumn &&
                c <= endColumn
              ) {
                cleared = true;
                return "";
              }
              return text;
            }),
          );
          if (!cleared) return element;
          changed = true;
          return { ...element, table: { ...element.table, cells } };
        });
        return changed ? { ...current, elements } : current;
      });
      return changed ? { ...deck, slides } : deck;
    });
  };
  const duplicateSelected = () => {
    if (!selected.length) {
      duplicateCurrentSlide();
      return;
    }
    const source = slide.elements.filter((e) => selected.includes(e.id));
    if (!canAddElements(source.length)) return;
    const copies = copyElements(source, 24, 24).map((e) => ({ ...e, locked: false }));
    changeSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
    setSelected(copies.map((e) => e.id));
  };
  const writeInternalClipboard = (
    text: string,
    nativeClipboard?: DataTransfer | null,
    html?: string,
  ) => {
    clipboardToken.current = uid();
    const fill = (data: DataTransfer) => {
      data.setData("text/plain", text);
      data.setData("text/html",`<span data-slide-studio-copy="${clipboardToken.current}"></span>`+(html||""));
      data.setData("application/x-slide-studio", clipboardToken.current);
    };
    if (nativeClipboard) {
      fill(nativeClipboard);
      return;
    }
    // A native copy carries an identity marker. A later copy in another app
    // replaces it, so stale in-memory objects never override external data.
    const copy = (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      fill(event.clipboardData);
    };
    document.addEventListener("copy", copy, true);
    try {
      document.execCommand("copy");
    } finally {
      document.removeEventListener("copy", copy, true);
    }
  };
  const copySelectedTableCells = (nativeClipboard?: DataTransfer | null) => {
    if (!activeTableSelection || !tableRange || !selectedElement?.table)
      return false;
    const table = selectedElement.table;
    const cells = table.cells
      .slice(tableRange.startRow, tableRange.endRow + 1)
      .map((row) =>
        row.slice(tableRange.startColumn, tableRange.endColumn + 1),
      );
    const cellStyles = cells.map((row, r) =>
      row.map((_, c) =>
        tableCellStyle(
          table,
          tableRange.startRow + r,
          tableRange.startColumn + c,
        ),
      ),
    );
    // Keep the app copy even when the OS clipboard is unavailable or denied.
    clipboard.current = { cells, cellStyles };
    const text = tableClipboardText(cells);
    try {
      writeInternalClipboard(text, nativeClipboard, copyStudioTable(table,tableRange,{width:selectedElement.width,height:selectedElement.height}).html);
    } catch {
      /* The explicit internal paste remains available. */
    }
    notify(`${cells.length * cells[0].length}개 셀을 복사했습니다.`);
    return true;
  };
  const copySelection = (nativeClipboard?: DataTransfer | null) => {
    if (copySelectedTableCells(nativeClipboard)) return;
    clipboard.current = selected.length
      ? {
          elements: clone(
            slide.elements.filter((e) => selected.includes(e.id)),
          ),
        }
      : {
          slides: clone(
            deck.slides.filter((s) => selectedSlideIds.includes(s.id)),
          ),
        };
    const elements =
      clipboard.current.elements ??
      clipboard.current.slides?.flatMap((s) => s.elements) ??
      clipboard.current.slide?.elements ??
      [];
    try {
      const rich=elements.length===1&&elements[0].table?copyStudioTable(elements[0].table,undefined,{width:elements[0].width,height:elements[0].height}):undefined;
      writeInternalClipboard(
        rich?.text ?? elements
          .map((e) => e.text ?? "")
          .filter(Boolean)
          .join("\n"),
        nativeClipboard,
        rich?.html,
      );
    } catch {
      /* Keep the internal copy if native clipboard access fails. */
    }
    notify(
      selected.length ? "개체를 복사했습니다." : "슬라이드를 복사했습니다.",
    );
  };
  const cutSelection = (nativeClipboard?: DataTransfer | null) => {
    if (!selected.length && selectedSlideIds.length === deck.slides.length) {
      notify("프레젠테이션에는 슬라이드가 하나 이상 필요합니다.");
      return;
    }
    copySelection(nativeClipboard);
    if (selected.length) removeSelected();
    else {
      // A cut/paste move keeps slide IDs so links from the remaining slides
      // still point to the moved slide. A later paste duplicates normally.
      clipboard.current.cutDeckId = deck.id;
      removeSlide();
    }
  };
  const pasteSelection = () => {
    if (clipboard.current.cells) {
      if (
        !activeTableSelection ||
        !tableRange ||
        !selectedElement?.table ||
        selectedElement.locked
      ) {
        notify("붙여넣을 표의 시작 셀을 선택해 주세요.");
        return;
      }
      const source = clipboard.current.cells;
      const sourceStyles = clipboard.current.cellStyles;
      const target = selectedElement;
      const table = target.table!;
      const rowStart = tableRange.startRow,
        columnStart = tableRange.startColumn;
      const rows = Math.min(source.length, table.cells.length - rowStart);
      const columns = Math.min(
        source[0].length,
        table.cells[0].length - columnStart,
      );
      if (rows < 1 || columns < 1) return;
      try {
        const next = validateTable({
          ...table,
          cells: table.cells.map((row, r) =>
            row.map((text, c) =>
              r >= rowStart &&
              r < rowStart + rows &&
              c >= columnStart &&
              c < columnStart + columns
                ? source[r - rowStart][c - columnStart]
                : text,
            ),
          ),
          ...(sourceStyles
            ? {
                cellStyles: table.cells.map((row, r) =>
                  row.map((_, c) =>
                    r >= rowStart &&
                    r < rowStart + rows &&
                    c >= columnStart &&
                    c < columnStart + columns
                      ? { ...sourceStyles[r - rowStart][c - columnStart] }
                      : (table.cellStyles?.[r]?.[c] ?? null),
                  ),
                ),
              }
            : {}),
        });
        changeSlide((slide) => ({
          ...slide,
          elements: slide.elements.map((element) =>
            element.id === target.id && !element.locked
              ? { ...element, table: next }
              : element,
          ),
        }));
        setTableSelection({
          elementId: target.id,
          anchor: { row: rowStart, column: columnStart },
          focus: {
            row: rowStart + rows - 1,
            column: columnStart + columns - 1,
          },
        });
        const omitted = source.length * source[0].length - rows * columns;
        notify(
          omitted
            ? `${rows * columns}개 셀을 붙여넣었습니다. 표 경계를 벗어난 ${omitted}개 셀은 제외했습니다.`
            : `${rows * columns}개 셀을 붙여넣었습니다.`,
        );
      } catch (error) {
        notify(
          error instanceof Error ? error.message : "셀을 붙여넣지 못했습니다.",
        );
      }
    } else if (clipboard.current.elements) {
      if (!canAddElements(clipboard.current.elements.length)) return;
      const copies = copyElements(clipboard.current.elements, 24, 24).map(
        (e) => ({ ...e, locked: false }),
      );
      changeSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
      setSelected(copies.map((e) => e.id));
    } else if (clipboard.current.slides || clipboard.current.slide) {
      const source = clipboard.current.slides ?? [clipboard.current.slide!];
      if (!withinCapacity({ slides: source })) return;
      const moving = clipboard.current.cutDeckId === deck.id &&
        source.every((slide) => !deck.slides.some((current) => current.id === slide.id));
      const copies = moving ? clone(source) : duplicateSlides(source);
      const next = copies[0];
      commit((d) => {
        const slides = [...d.slides];
        slides.splice(activeIndex + 1, 0, ...copies);
        return { ...d, slides };
      });
      selectSlide(next.id);
      setSlideSelection(copies.map((s) => s.id));
    }
  };
  const layerSelected = (where: "front" | "back" | "up" | "down") =>
    changeSlide((s) => {
      let elements = [...s.elements];
      if (where === "front" || where === "back") {
        const chosen = elements.filter((e) => selected.includes(e.id));
        const rest = elements.filter((e) => !selected.includes(e.id));
        elements =
          where === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
      } else {
        const indices = elements
          .map((e, i) => (selected.includes(e.id) ? i : -1))
          .filter((i) => i >= 0);
        if (where === "up") indices.reverse();
        indices.forEach((i) => {
          const next = i + (where === "up" ? 1 : -1);
          if (
            next >= 0 &&
            next < elements.length &&
            !selected.includes(elements[next].id)
          )
            elements = reorder(elements, i, next);
        });
      }
      return { ...s, elements };
    });
  const alignElements = (action: Parameters<typeof arrangeElements>[2]) =>
    changeSlide((s) => ({
      ...s,
      elements: arrangeElements(
        s.elements,
        selected,
        action,
        deck.width,
        deck.height,
        alignScope,
      ),
    }));

  const addVideo = async (file: File) => {
    if (!canAddElements(1)) return;
    try {
      const media = await readVideo(file);
      if (!canAddElements(1)) return;
      const ratio = Math.min(1, deck.width * 0.7 / media.width, deck.height * 0.7 / media.height);
      const width = media.width * ratio, height = media.height * ratio;
      const next = element("video", { ...media, width, height, x: (deck.width - width) / 2, y: (deck.height - height) / 2,
        alt: file.name, autoPlay: true, loop: true, muted: true });
      changeSlide(s => ({ ...s, elements: [...s.elements, next] }));
      setSelected([next.id]);
      setInspectorVisible(true);
      notify("동영상을 추가했습니다. 서식에서 자동 시작·반복·음소거를 설정하세요.");
    } catch (error) { notify(error instanceof Error ? error.message : "동영상을 열 수 없습니다."); }
  };
  const addImage = async (file: File) => {
    if (!canAddElements(1)) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      notify("PNG, JPG, GIF, WebP 이미지를 선택해 주세요.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      notify("15MB 이하의 이미지를 선택해 주세요.");
      return;
    }
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const image = new window.Image();
      image.src = src;
      await image.decode();
      if (!canAddElements(1)) return;
      const ratio = Math.min(
        1,
        (deck.width * 0.65) / image.naturalWidth,
        (deck.height * 0.7) / image.naturalHeight,
      );
      const width = image.naturalWidth * ratio,
        height = image.naturalHeight * ratio;
      const next = element("image", {
        src,
        alt: file.name,
        x: (deck.width - width) / 2,
        y: (deck.height - height) / 2,
        width,
        height,
      });
      changeSlide((s) => ({ ...s, elements: [...s.elements, next] }));
      setSelected([next.id]);
    } catch {
      notify("이 이미지를 열 수 없습니다. 다른 파일을 선택해 주세요.");
    }
  };
  const saveBytes = async (
    name: string,
    data: Uint8Array,
  ) => {
    if (window.desktop)
      return !!(await window.desktop.saveFile({
        name,
        data,
        extensions: ["pptx"],
      }));
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  };
  const savePptx = async () => {
    if (savingPptx.current || printing.current || busy) return;
    savingPptx.current = true;
    setMenu(null);
    finish();
    const snapshot = history.present;
    setBusy("PowerPoint 파일을 만들고 있습니다");
    try {
      const bytes = await exportPptx(deck);
      if (await saveBytes(`${deck.name}.pptx`, bytes)) {
        setFileSnapshot(snapshot);
        notify("PPTX 파일을 저장했습니다.");
      }
    } catch (error) {
      notify(
        `PPTX 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      savingPptx.current = false;
      setBusy("");
    }
  };
  const exportPdf = async () => {
    setMenu(null);
    try {
      if (window.desktop) {
        setBusy("PDF를 만들고 있습니다");
        const result = await window.desktop.exportPDF(deck.name);
        if (result) notify("PDF 파일을 저장했습니다.");
      } else window.print();
    } catch (error) {
      notify(
        `PDF 내보내기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  };
  const printDeck = async () => {
    if (printing.current || busy) return;
    printing.current = true;
    finish();
    setEditing(null);
    setMenu(null);
    setBusy("인쇄 창을 열고 있습니다");
    try {
      if (window.desktop) {
        const submitted = await window.desktop.print();
        notify(submitted ? "인쇄 작업을 보냈습니다." : "인쇄를 취소했습니다.");
      } else {
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        await Promise.all(
          Array.from(
            document.querySelectorAll<HTMLImageElement>(".print-deck img"),
            (image) => image.decode().catch(() => {}),
          ),
        );
        window.print();
      }
    } catch (error) {
      notify(
        `인쇄 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      printing.current = false;
      setBusy("");
    }
  };
  const canReplaceDocument = () => !hasFileChanges || window.confirm(
    "PPTX 파일에 저장하지 않은 변경 사항이 있습니다. 저장하지 않고 계속하시겠습니까?\n\n내용을 보관하려면 취소를 누른 뒤 PPTX로 저장해 주세요.",
  );
  const readFile = async (name: string, data: ArrayBuffer | Uint8Array) => {
    if (!canReplaceDocument()) return;
    setBusy("프레젠테이션을 열고 있습니다");
    try {
      await saveAutosave(deck);
      if (/\.pptx$/i.test(name)) {
        const result = await importPptx(data);
        replaceDeck(result.deck);
        setWarnings(result.warnings);
      } else {
        const imported = parseDeckJson(new TextDecoder().decode(data));
        replaceDeck(imported);
      }
    } catch (error) {
      notify(
        `파일 열기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy("");
    }
  };
  const openProject = async () => {
    setMenu(null);
    try {
      if (window.desktop) {
        const file = await window.desktop.openFile();
        if (file) await readFile(file.name, file.data);
      } else fileInput.current?.click();
    } catch (error) {
      notify(
        `파일 열기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const showLibrary = () => {
    setModal("library");
    setMenu(null);
  };
  const createDocument = async (isSample = false) => {
    if (!canReplaceDocument()) return;
    try {
      await saveAutosave(deck);
      const next = isSample ? sampleDeck() : blankDeck();
      if (!isSample) next.slides = [newSlide(layout)];
      replaceDeck(next);
      notify("새 프레젠테이션을 만들었습니다.");
    } catch {
      notify(
        "현재 문서의 자동 저장에 실패했습니다. 파일로 저장한 후 다시 시도해 주세요.",
      );
    }
  };
  const enterPresentationFullscreen = () => {
    if (window.desktop?.setPresentationMode) {
      void window.desktop
        .setPresentationMode(true)
        .catch(() => notify("전체 화면을 사용할 수 없습니다."));
    } else if (browserFullscreenExitPending.current) {
      // A previous show may still be exiting. Its fullscreenchange event will
      // enter fullscreen for the new show instead of closing that new session.
      return;
    } else if (!document.fullscreenElement) {
      browserPresentationFullscreen.current = true;
      void document.documentElement
        .requestFullscreen()
        .then(() => {
          // Esc may be pressed before an asynchronous fullscreen request finishes.
          if (!presentationActive.current && document.fullscreenElement) {
            browserPresentationFullscreen.current = false;
            void document.exitFullscreen().catch(() => {});
          }
        })
        .catch(() => {
          browserPresentationFullscreen.current = false;
          notify("전체 화면을 사용할 수 없습니다.");
        });
    }
  };
  const showPresentationSlide = (index: number, ended = false) => {
    presentationPosition.current = { index, ended };
    setPresentIndex(index);
    setPresentEnded(ended);
    setBlackout(false);
    setWhiteout(false);
    presentationNumber.current = "";
  };
  const startPresent = (fromBeginning = false) => {
    if (presentationActive.current || modal || busy) return;
    finish();
    setEditing(null);
    presentationWheel.current = {
      delta: 0,
      lastEvent: -Infinity,
      navigated: false,
      direction: 0,
    };
    presentationOrigin.current = activeId;
    // Starting from the selected slide is an explicit request, including a
    // hidden slide. A normal show starts at the first visible slide.
    const first = fromBeginning
      ? deck.slides.findIndex((s) => !s.hidden)
      : activeIndex;
    showPresentationSlide(Math.max(0, first), first < 0);
    setPresenting(true);
    setMenu(null);
    presentationActive.current = true;
    enterPresentationFullscreen();
  };
  const leavePresentation = useCallback(() => {
    if (!presentationActive.current) return;
    const ink = presentationInk.current?.snapshot();
    if (ink && Object.keys(ink).length) setPendingInk(ink);
    presentationActive.current = false;
    const position = presentationPosition.current;
    // Completing the show restores the starting selection; interrupting it
    // selects the slide being presented. Native/browser exits use this too.
    const id = position.ended
      ? presentationOrigin.current
      : deckRef.current.slides[position.index]?.id;
    if (id) setActiveId(id);
    setSelected([]);
    setEditing(null);
    setPresenting(false);
    setBlackout(false);
    setWhiteout(false);
    setPresentEnded(false);
    presentationNumber.current = "";
  }, []);
  const stopPresent = () => {
    leavePresentation();
    if (window.desktop?.setPresentationMode) {
      void window.desktop
        .setPresentationMode(false)
        .catch(() => notify("전체 화면을 종료할 수 없습니다."));
    } else if (
      browserPresentationFullscreen.current &&
      document.fullscreenElement
    ) {
      browserPresentationFullscreen.current = false;
      browserFullscreenExitPending.current = true;
      void document.exitFullscreen().catch(() => {
        browserFullscreenExitPending.current = false;
      });
    }
  };
  useEffect(() => {
    if (presenting) presentationView.current?.focus({ preventScroll: true });
  }, [presenting]);
  useEffect(() => {
    const fullscreenChanged = () => {
      // Observe exits even if the editor was fullscreen before the show began.
      // Ownership only controls whether stopping the show exits fullscreen.
      if (!document.fullscreenElement) {
        if (browserFullscreenExitPending.current) {
          browserFullscreenExitPending.current = false;
          if (presentationActive.current) enterPresentationFullscreen();
          return;
        }
        browserPresentationFullscreen.current = false;
        leavePresentation();
      }
    };
    const unsubscribe =
      window.desktop?.onPresentationEnded?.(leavePresentation);
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      unsubscribe?.();
      document.removeEventListener("fullscreenchange", fullscreenChanged);
    };
  }, [leavePresentation]);
  const restorePresentation = () => {
    presentationNumber.current = "";
    if (!blackout && !whiteout) return false;
    setBlackout(false);
    setWhiteout(false);
    return true;
  };
  const movePresent = (direction: number) => {
    if (restorePresentation()) return true;
    const position = presentationPosition.current;
    if (position.ended && direction > 0) {
      stopPresent();
      return true;
    }
    let next = position.ended
      ? deck.slides.length - 1
      : position.index + direction;
    while (next >= 0 && next < deck.slides.length && deck.slides[next].hidden)
      next += direction;
    if (next >= deck.slides.length) showPresentationSlide(position.index, true);
    else if (next >= 0) showPresentationSlide(next);
    else return false;
    return true;
  };
  useEffect(() => {
    const view = presentationView.current;
    if (!presenting || !view) return;
    const wheel = (event: WheelEvent) => {
      if (
        event.buttons ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        !event.deltaY ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        (event.target instanceof Element &&
          event.target.closest(".present-notes, .presentation-tools"))
      )
        return;
      event.preventDefault();
      const dy =
        event.deltaY *
        (event.deltaMode === 1
          ? 40
          : event.deltaMode === 2
            ? view.clientHeight
            : 1);
      const now = performance.now(),
        direction = Math.sign(dy),
        gesture = presentationWheel.current;
      // Match editor navigation: small notches respond immediately, while a
      // continuous momentum tail cannot skip slides, blackout or the end screen.
      if (now - gesture.lastEvent > 80 || direction !== gesture.direction) {
        gesture.delta = 0;
        gesture.navigated = false;
      }
      gesture.lastEvent = now;
      gesture.direction = direction;
      if (gesture.navigated) return;
      gesture.delta += dy;
      if (Math.abs(gesture.delta) < 12) return;
      gesture.delta = 0;
      if (movePresent(direction)) gesture.navigated = true;
    };
    view.addEventListener("wheel", wheel, { passive: false });
    return () => view.removeEventListener("wheel", wheel);
  });
  const jumpPresentationEdge = (last: boolean) => {
    if (restorePresentation()) return;
    let next = last ? deck.slides.length - 1 : 0;
    while (next >= 0 && next < deck.slides.length && deck.slides[next].hidden)
      next += last ? -1 : 1;
    const ended = next < 0 || next >= deck.slides.length;
    showPresentationSlide(ended ? 0 : next, ended);
  };
  const applyTheme = (id: string) => {
    const from = THEMES.find((t) => t.id === deck.theme) || THEMES[0],
      to = THEMES.find((t) => t.id === id)!;
    const map = (color: string | undefined) =>
      color === from.background
        ? to.background
        : color === from.text
          ? to.text
          : color === from.accent
            ? to.accent
            : color === from.secondary
              ? to.secondary
              : color;
    commit((d) => ({
      ...d,
      theme: id,
      slides: d.slides.map((s) => ({
        ...s,
        background: map(s.background)!,
        elements: s.elements.map((e) => ({
          ...e,
          color: map(e.color),
          fill: map(e.fill),
          stroke: map(e.stroke),
          ...(e.paragraphs
            ? {
                paragraphs: e.paragraphs.map((p) => ({
                  ...p,
                  runs: p.runs.map((r) => ({ ...r, color: map(r.color) })),
                })),
              }
            : {}),
          ...(e.borders
            ? {
                borders: e.borders.map((b) => ({
                  ...b,
                  color: map(b.color)!,
                })) as NonNullable<SlideElement["borders"]>,
              }
            : {}),
        })),
      })),
    }));
  };
  const openPresenter = usePresenterView(
    {
      slide: deck.slides[presentIndex] ?? slide,
      next: deck.slides.slice(presentIndex + 1).find((s) => !s.hidden),
      width: deck.width,
      height: deck.height,
      index: presentIndex,
      total: deck.slides.length,
      ended: !presenting || presentEnded,
      blackout,
      whiteout,
    },
    (command) => {
      if (command === "end") stopPresent();
      else if (command === "next") movePresent(1);
      else if (command === "previous") movePresent(-1);
      else if (command === "black") {
        setWhiteout(false);
        setBlackout((b) => !b);
      } else {
        setBlackout(false);
        setWhiteout((b) => !b);
      }
    },
  );
  const resizeDeck = (width: number, height: number) => {
    commit((d) => ({
      ...d,
      width,
      height,
      slides: d.slides.map((s) => ({
        ...s,
        elements: s.elements.map((e) =>
          scaleElement(e, width / d.width, height / d.height),
        ),
      })),
    }));
    setZoom(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (presenting) {
        if (e.key !== "Escape" && e.target instanceof Element && e.target.closest(".video-visual")) return;
        if (presentationInk.current?.handleKey(e)) return;
        if (
          e.target instanceof Element &&
          e.target.closest(".presentation-tools")
        )
          return;
        // Modifier shortcuts must not become slide numbers or navigation.
        if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
        if (
          e.target instanceof Element &&
          e.target.closest(".presentation-link, .presentation-run-link") &&
          (e.key === "Enter" || e.key === " ")
        ) {
          presentationNumber.current = "";
          // Let links/buttons perform their native keyboard activation.
          if (e.key === " " && e.target.closest("a")) e.preventDefault();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          stopPresent();
        } else if (
          ["ArrowRight", "ArrowDown", " ", "PageDown", "n", "N"].includes(e.key)
        ) {
          e.preventDefault();
          movePresent(1);
        } else if (
          ["ArrowLeft", "ArrowUp", "PageUp", "p", "P"].includes(e.key)
        ) {
          e.preventDefault();
          movePresent(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          jumpPresentationEdge(false);
        } else if (e.key === "End") {
          e.preventDefault();
          jumpPresentationEdge(true);
        } else if (/^[0-9]$/.test(e.key)) {
          e.preventDefault();
          // Decks contain at most 500 slides. Keep oversized input invalid.
          if (presentationNumber.current.length < 6)
            presentationNumber.current += e.key;
        } else if (e.key === "Backspace") {
          e.preventDefault();
          if (presentationNumber.current)
            presentationNumber.current = presentationNumber.current.slice(
              0,
              -1,
            );
          else movePresent(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const digits = presentationNumber.current;
          presentationNumber.current = "";
          if (!digits) movePresent(1);
          else {
            const index = Number(digits) - 1;
            // A direct number jump may intentionally show a hidden slide.
            if (index >= 0 && index < deck.slides.length)
              showPresentationSlide(index);
          }
        } else if (e.key.toLowerCase() === "b" && !presentEnded) {
          e.preventDefault();
          presentationNumber.current = "";
          setWhiteout(false);
          setBlackout((b) => !b);
        } else if (e.key.toLowerCase() === "w" && !presentEnded) {
          e.preventDefault();
          setBlackout(false);
          setWhiteout((b) => !b);
        } else if (e.key.toLowerCase() === "o" && !presentEnded) {
          e.preventDefault();
          setPresentNotes((v) => !v);
        }
        return;
      }
      if (objectMenu || textMenu || colorPalette || slideMenu || pendingInk)
        return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "F1") {
        e.preventDefault();
        setRibbonCollapsed((value) => !value);
        return;
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void savePptx();
        return;
      }
      if (cmd && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openProject();
        return;
      }
      if (e.key === "Escape") {
        if (activeTableSelection && !modal) {
          e.preventDefault();
          setTableSelection(null);
          return;
        }
        setMenu(null);
        setModal(null);
        setSelected([]);
        setEditing(null);
        return;
      }
      if (editingTarget(e.target) || modal) return;
      if (activeTableSelection && selectedElement?.table) {
        const table = selectedElement.table;
        if (e.key === "Tab" && !cmd && !e.altKey) {
          e.preventDefault();
          const cells = visibleTableCells(table),
            index = cells.findIndex(
              (c) =>
                c.row === activeTableSelection.focus.row &&
                c.column === activeTableSelection.focus.column,
            );
          let focus = cells[index + (e.shiftKey ? -1 : 1)];
          if (!focus && !e.shiftKey && table.cells.length < MAX_TABLE_ROWS) {
            focus = { row: table.cells.length, column: 0 };
            const next = changeTableAxis(table, "row", table.cells.length);
            changeSlide((s) => ({
              ...s,
              elements: s.elements.map((el) =>
                el.id === selectedElement.id
                  ? {
                      ...el,
                      table: next,
                      height: Math.min(
                        100000,
                        el.height * (next.cells.length / table.cells.length),
                      ),
                    }
                  : el,
              ),
            }));
          }
          if (focus)
            setTableSelection({
              ...activeTableSelection,
              anchor: focus,
              focus,
            });
          return;
        }
        if (cmd && ["c", "x"].includes(e.key.toLowerCase())) {
          e.preventDefault();
          copySelection();
          if (e.key.toLowerCase() === "x") removeSelected();
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          clearSelectedTableCells();
          return;
        }
        if (cmd && e.key.toLowerCase() === "a") {
          e.preventDefault();
          setTableSelection({
            elementId: selectedElement.id,
            anchor: { row: 0, column: 0 },
            focus: {
              row: table.cells.length - 1,
              column: table.cells[0].length - 1,
            },
          });
          return;
        }
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        ) {
          e.preventDefault();
          const focus = {
            row: Math.max(
              0,
              Math.min(
                table.cells.length - 1,
                activeTableSelection.focus.row +
                  (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0),
              ),
            ),
            column: Math.max(
              0,
              Math.min(
                table.cells[0].length - 1,
                activeTableSelection.focus.column +
                  (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0),
              ),
            ),
          };
          setTableSelection({
            ...activeTableSelection,
            anchor: e.shiftKey ? activeTableSelection.anchor : focus,
            focus,
          });
          return;
        }
      }
      if (
        e.key === "Enter" &&
        selectedElement?.type === "table" &&
        !selectedElement.locked
      ) {
        e.preventDefault();
        openTable(selectedElement.id);
      } else if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (cmd && e.key.toLowerCase() === "g") {
        e.preventDefault();
        changeSlide((s) => ({
          ...s,
          elements: e.shiftKey
            ? ungroupElements(s.elements, selected)
            : groupElements(s.elements, selected),
        }));
      } else if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        if (
          e.target instanceof Element &&
          e.target.closest(".thumbnail-list,.slide-sorter")
        )
          setSlideSelection(deck.slides.map((s) => s.id));
        else setSelected(slide.elements.map((el) => el.id));
      } else if (cmd && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
      } else if (cmd && e.key.toLowerCase() === "x") {
        e.preventDefault();
        cutSelection();
      } else if (cmd && e.key.toLowerCase() === "m") {
        e.preventDefault();
        addSlide();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (
          !selected.length &&
          e.target instanceof Element &&
          e.target.closest(".thumbnail-list, .slide-sorter")
        )
          removeSlide();
        else removeSelected();
      } else if (e.key === "F5") {
        e.preventDefault();
        startPresent(!e.shiftKey);
      } else if (
        e.key === "Enter" &&
        (selectedElement?.type === "text" ||
          selectedElement?.type === "shape") &&
        !selectedElement.locked
      ) {
        e.preventDefault();
        begin();
        setEditing(selectedElement.id);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        e.preventDefault();
        if (selected.length) {
          if (
            !slide.elements.some((el) => selected.includes(el.id) && !el.locked)
          )
            return;
          const amount = e.shiftKey ? 10 : 1;
          const move = (s: Slide) => ({
            ...s,
            elements: s.elements.map((el) =>
              selected.includes(el.id) && !el.locked
                ? {
                    ...el,
                    x:
                      el.x +
                      (e.key === "ArrowLeft"
                        ? -amount
                        : e.key === "ArrowRight"
                          ? amount
                          : 0),
                    y:
                      el.y +
                      (e.key === "ArrowUp"
                        ? -amount
                        : e.key === "ArrowDown"
                          ? amount
                          : 0),
                  }
                : el,
            ),
          });
          const update = (d: Deck) => ({
            ...d,
            slides: d.slides.map((s) => (s.id === slide.id ? move(s) : s)),
          });
          const key = `${slide.id}:${selected.join(",")}:${e.key}:${amount}`;
          if (e.repeat && nudgeKey.current === key) preview(update);
          else commit(update);
          nudgeKey.current = key;
        } else {
          const idx = Math.max(
            0,
            Math.min(
              deck.slides.length - 1,
              activeIndex + (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1),
            ),
          );
          selectSlide(deck.slides[idx].id);
        }
      }
    };
    const stopNudge = () => {
      nudgeKey.current = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", stopNudge);
    window.addEventListener("blur", stopNudge);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", stopNudge);
      window.removeEventListener("blur", stopNudge);
    };
  });
  useEffect(() => {
    const copyCells = (event: ClipboardEvent) => {
      if (
        modal ||
        presentationActive.current ||
        editingTarget(event.target) ||
        event.defaultPrevented
      )
        return;
      event.preventDefault();
      if (event.type === "cut") cutSelection(event.clipboardData);
      else copySelection(event.clipboardData);
    };
    window.addEventListener("copy", copyCells);
    window.addEventListener("cut", copyCells);
    return () => {
      window.removeEventListener("copy", copyCells);
      window.removeEventListener("cut", copyCells);
    };
  });
  const pasteFromClipboard = async () => {
    if (!ready || busy || modalRef.current || presentationActive.current || editing)
      return;
    const shortcut = /Mac/i.test(navigator.platform) ? "⌘V" : "Ctrl+V";
    if (window.desktop?.pasteTableClipboard) {
      try { await window.desktop.pasteTableClipboard(); }
      catch { notify(`슬라이드에서 ${shortcut}로 붙여넣으세요.`); }
      return;
    }
    const request = ++clipboardRequest.current;
    const context = clipboardContext.current;
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    const current = () => !cancelled && request === clipboardRequest.current &&
      context === clipboardContext.current && !modalRef.current &&
      !presentationActive.current;
    const changed = () => notify("삽입 위치나 편집 상태가 바뀌었습니다. 다시 붙여넣으세요.");
    document.addEventListener("focusin", cancel);
    document.addEventListener("pointerdown", cancel, true);
    document.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", cancel);
    try {
      const data = new DataTransfer();
      if (navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        // HTML and TSV must come from the same clipboard snapshot/item.
        const item = items.find(item => item.types.includes("text/html")) ??
          items.find(item => item.types.includes("text/plain"));
        for (const type of ["text/html", "text/plain"])
          if (item?.types.includes(type))
            data.setData(type, await (await item.getType(type)).text());
      } else data.setData("text/plain", await navigator.clipboard.readText());
      if (!current()) { changed(); return; }
      if (!data.types.length) { notify("클립보드에 붙여넣을 글이나 표가 없습니다."); return; }
      window.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: data,
      }));
    } catch {
      if (!current()) { changed(); return; }
      if (clipboardToken.current) {
        pasteSelection();
        notify(`앱에서 복사한 항목을 붙였습니다. 외부 내용은 ${shortcut}로 붙여넣으세요.`);
      } else notify(`슬라이드에서 ${shortcut}로 붙여넣으세요.`);
    } finally {
      document.removeEventListener("focusin", cancel);
      document.removeEventListener("pointerdown", cancel, true);
      document.removeEventListener("keydown", cancel, true);
      window.removeEventListener("blur", cancel);
    }
  };
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (presentationActive.current) {
        e.preventDefault();
        return;
      }
      if (e.defaultPrevented || editingTarget(e.target) || editing || modal)
        return;
      if (
        clipboardToken.current &&
        (e.clipboardData?.getData("application/x-slide-studio") ===
          clipboardToken.current || e.clipboardData?.getData("text/html").includes(`data-slide-studio-copy="${clipboardToken.current}"`))
      ) {
        e.preventDefault();
        pasteSelection();
        return;
      }
      const html=e.clipboardData?.getData('text/html');
      if(html){
        try{
          const source=readStudioTable(html);
          if(source){
            e.preventDefault();
            if(activeTableSelection&&selectedElement?.table){
              if(selectedElement.locked){notify('잠긴 표에는 붙여넣을 수 없습니다.');return;}
              const next=pasteStudioTable(selectedElement.table,activeTableSelection.focus.row,activeTableSelection.focus.column,source);
              changeSlide(s=>({...s,elements:s.elements.map(el=>el.id===selectedElement.id?{...el,table:next}:el)}));
            }else insertElements([createTableElement(source,deck.width,deck.height)]);
            notify('표를 붙여넣었습니다.');return;
          }
        }catch(error){e.preventDefault();notify(error instanceof Error?error.message:'표를 붙여넣지 못했습니다.');return;}
      }
      // Office/Studio may include a bitmap preview alongside editable HTML.
      // Prefer the native table, while ordinary image paste remains unchanged.
      const file = Array.from(e.clipboardData?.items || [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void addImage(file);
        return;
      }
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
        if (
          activeTableSelection &&
          selectedElement?.table &&
          !selectedElement.locked
        ) {
          try {
            const data = parseTableClipboard(text),
              next = pasteTableClipboard(
                selectedElement.table,
                activeTableSelection.focus.row,
                activeTableSelection.focus.column,
                data,
              );
            changeSlide((s) => ({
              ...s,
              elements: s.elements.map((el) =>
                el.id === selectedElement.id
                  ? {
                      ...el,
                      table: next,
                      height: Math.min(
                        100000,
                        (el.height * next.cells.length) /
                          selectedElement.table!.cells.length,
                      ),
                    }
                  : el,
              ),
            }));
          } catch (error) {
            notify(
              error instanceof Error
                ? error.message
                : "표 데이터를 붙여넣지 못했습니다.",
            );
          }
          return;
        }
        insertElements([
          element("text", {
            text,
            x: 80,
            y: 80,
            width: Math.max(160, deck.width - 160),
            height: 80,
            autoHeight: true,
            wrap: true,
          }),
        ]);
      }
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  });
  useEffect(() =>
    window.desktop?.onMenu((action) => {
      if (presentationActive.current) {
        if (action === "present") movePresent(1);
        if (action === "print") presentationInk.current?.command("pen");
        if (action.startsWith("presentation-"))
          presentationInk.current?.command(action.slice(13));
        return;
      }
      if (action === "new") setModal("new");
      if (action === "open") void openProject();
      if (action === "save") void savePptx();
      if (action === "export-pdf") void exportPdf();
      if (action === "print") void printDeck();
      if (action === "present") startPresent();
    }),
  );

  useEffect(() => {
    // Desktop shortcuts are handled by the native menu. Capture the browser
    // shortcut before a text editor stops bubbling the key event.
    if (window.desktop) return;
    const onPrintKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) {
          if (presentationActive.current)
            presentationInk.current?.command("pen");
          else void printDeck();
        }
      }
    };
    window.addEventListener("keydown", onPrintKey, true);
    return () => window.removeEventListener("keydown", onPrintKey, true);
  });

  const toggleTextFormat = (format: InlineFormat) => {
    if (!textCapable || selectedElement?.locked) return;
    if (!editing) {
      patchSelectedText({ [format]: !selectedTextStyle?.[format] });
      return;
    }
    const host = document.querySelector<HTMLElement>(".editing-text");
    const selection = host ? captureTextSelection(host) : undefined;
    // A missing DOM selection while editing must never format the whole box.
    if (!selection) return;
    restoreTextSelection(selection);
    const inputType = `format${format[0].toUpperCase()}${format.slice(1)}`;
    trackTextFormat(selection.host, inputType);
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(format);
    selection.host.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType }),
    );
  };

  const openTextColor = (
    selection?: TextMenuSelection,
    point?: { x: number; y: number },
  ) => {
    if (!textCapable || selectedElement?.locked) return;
    const host = document.querySelector<HTMLElement>(".editing-text");
    const retained =
      selection ??
      (host ? captureTextSelection(host) : undefined) ??
      (colorSelection.current?.host.isConnected
        ? colorSelection.current
        : undefined);
    colorSelection.current = undefined;
    const trigger = document
      .querySelector("[data-text-format-trigger]")
      ?.getBoundingClientRect();
    let anchor = retained?.range.startContainer;
    if (retained && !retained.range.collapsed) {
      const walker = document.createTreeWalker(
        retained.host,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent || !retained.range.intersectsNode(node)) continue;
        if (
          node === retained.range.startContainer &&
          retained.range.startOffset >= node.textContent.length
        )
          continue;
        if (
          node === retained.range.endContainer &&
          retained.range.endOffset === 0
        )
          continue;
        anchor = node;
        break;
      }
    }
    const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
    setColorPalette({
      x:
        point?.x ??
        trigger?.left ??
        retained?.range.getBoundingClientRect().left ??
        300,
      y:
        point?.y ??
        (trigger ? trigger.bottom + 7 : undefined) ??
        retained?.range.getBoundingClientRect().bottom ??
        180,
      color:
        (parent ? cssColorHex(getComputedStyle(parent).color) : undefined) ??
        selectedTextStyle?.color ??
        "#233D35",
      selection: retained,
      partial: !!host || !!selection,
      ids: [...selected],
      slideId: activeId,
    });
  };
  const closeTextColor = (restore: boolean) => {
    const selection = colorPalette?.selection;
    if (restore && selection) restoreTextSelection(selection);
    else if (!restore && colorPalette?.partial) {
      finish();
      setEditing(null);
    }
    setColorPalette(null);
  };
  const applyTextColor = (color: string) => {
    if (!colorPalette || colorPalette.slideId !== activeId) return;
    if (colorPalette.partial) {
      const selection = colorPalette.selection;
      if (!selection?.host.isConnected || selection.range.collapsed) return;
      restoreTextSelection(selection);
      trackTextFormat(selection.host, "formatFontColor");
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("foreColor", false, color);
      selection.host.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "formatFontColor",
        }),
      );
      const next = captureTextSelection(selection.host);
      setColorPalette(null);
      if (next) restoreTextSelection(next);
    } else {
      changeSlide((s) => ({
        ...s,
        elements: s.elements.map((el) =>
          colorPalette.ids.includes(el.id) && !el.locked
            ? el.table
              ? {
                  ...el,
                  table: applyTableCellFormat(
                    el.table,
                    el.id === activeTableSelection?.elementId && tableRange
                      ? tableRange
                      : {
                          startRow: 0,
                          endRow: el.table.cells.length - 1,
                          startColumn: 0,
                          endColumn: el.table.cells[0].length - 1,
                        },
                    { color },
                  ),
                }
              : patchText(el, { color })
            : el,
        ),
      }));
      setColorPalette(null);
    }
  };

  const rememberTextRange = () => {
    const host = document.querySelector<HTMLElement>(".editing-text");
    if (host) {
      const selection = captureTextSelection(host);
      if (selection) ribbonTextSelection.current = selection;
    }
  };
  const setTextStyle = (
    key: "fontFamily" | "fontSize" | "align",
    value: string | number,
  ) => {
    if (!textCapable || selectedElement?.locked) return;
    if (!editing) {
      patchSelectedText({ [key]: value });
      return;
    }
    const host = document.querySelector<HTMLElement>(".editing-text");
    const selection =
      host && (captureTextSelection(host) ?? ribbonTextSelection.current);
    if (!selection || selection.host !== host || !host.isConnected) return;
    restoreTextSelection(selection);
    const command =
      key === "align"
        ? (
            {
              left: "justifyLeft",
              center: "justifyCenter",
              right: "justifyRight",
            } as Record<string, string>
          )[String(value)]
        : key === "fontFamily"
          ? "fontName"
          : "fontSize";
    const type = `format${command[0].toUpperCase()}${command.slice(1)}`;
    trackTextFormat(host, type);
    if (key === "fontSize") setSelectedFontSize(host, Number(value));
    else {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(
        command,
        false,
        key === "fontFamily" ? String(value) : undefined,
      );
    }
    host.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: type }),
    );
    ribbonTextSelection.current = captureTextSelection(host);
  };
  const fontTools = (
    <>
      <div className="font-row">
        <select
          aria-label="글꼴"
          data-text-selection-control
          onPointerDown={rememberTextRange}
          onFocus={rememberTextRange}
          value={
            editing
              ? inlineTextStyle.fontFamily
              : selectedTextStyle?.fontFamily || "Arial"
          }
          disabled={!textCapable || selectedElement?.locked}
          onChange={(e) => setTextStyle("fontFamily", e.target.value)}
        >
          {[
            ...new Set([
              selectedTextStyle?.fontFamily || "Arial",
              ...(editing ? [inlineTextStyle.fontFamily] : []),
              "Arial",
              "Calibri",
              "Calibri Light",
              "맑은 고딕",
              "Segoe UI",
              "Aptos",
              "나눔바른고딕",
              "Apple SD Gothic Neo",
              "Helvetica Neue",
              "Georgia",
              "Times New Roman",
              "Courier New",
            ]),
          ].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <NumberInput
          key={selected.join(",")}
          aria-label="글자 크기"
          data-text-selection-control
          onPointerDown={rememberTextRange}
          onFocus={rememberTextRange}
          min={8}
          max={240}
          value={
            editing
              ? inlineTextStyle.fontSize
              : selectedTextStyle?.fontSize || 32
          }
          disabled={!textCapable || selectedElement?.locked}
          onChange={(fontSize) => setTextStyle("fontSize", fontSize)}
        />
      </div>
      <div className="format-row">
        <Tool
          small
          icon={<Bold size={17} />}
          title="굵게"
          preserveTextSelection
          active={
            editing ? inlineFormat.bold : selectedTextStyle?.bold || false
          }
          disabled={!textCapable || selectedElement?.locked}
          onClick={() => toggleTextFormat("bold")}
        />
        <Tool
          small
          icon={<Italic size={17} />}
          title="기울임"
          preserveTextSelection
          active={
            editing ? inlineFormat.italic : selectedTextStyle?.italic || false
          }
          disabled={!textCapable || selectedElement?.locked}
          onClick={() => toggleTextFormat("italic")}
        />
        <Tool
          small
          icon={<Underline size={17} />}
          title="밑줄"
          preserveTextSelection
          active={
            editing
              ? inlineFormat.underline
              : selectedTextStyle?.underline || false
          }
          disabled={!textCapable || selectedElement?.locked}
          onClick={() => toggleTextFormat("underline")}
        />
        <button
          className="toolbar-color"
          title="글자 색"
          aria-label="글자 색"
          data-text-format-trigger
          disabled={!textCapable || selectedElement?.locked}
          onPointerDown={() => {
            const host = document.querySelector<HTMLElement>(".editing-text");
            colorSelection.current = host
              ? captureTextSelection(host)
              : undefined;
          }}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => openTextColor()}
        >
          <span>A</span>
          <span
            className="color-bar"
            style={{
              background: editing
                ? inlineTextStyle.color
                : selectedTextStyle?.color || "#233D35",
            }}
          />
        </button>
      </div>
    </>
  );
  const shapeMenu = (
    <div
      className="popover shape-popover"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <h4>도형 삽입</h4>
      <div className="shape-options">
        {(
          [
            ["rect", "사각형", <Square />],
            [
              "roundRect",
              "둥근 사각형",
              <Square style={{ borderRadius: 5 }} />,
            ],
            ["ellipse", "타원", <Circle />],
            ["triangle", "삼각형", <Triangle />],
            ["line", "선", <Minus />],
            ["arrow", "화살표", <ArrowRight />],
          ] as [ShapeKind, string, ReactNode][]
        ).map(([shape, label, icon]) => (
          <button key={shape} onClick={() => addElement("shape", shape)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
        {EXTRA_SHAPES.map((preset) => (
          <button
            key={preset.id}
            onClick={() => {
              insertElements([
                element("shape", {
                  shape: "custom",
                  paths: [
                    {
                      d: preset.d,
                      width: 100,
                      height: 100,
                      fill: true,
                      stroke: true,
                    },
                  ],
                  x: deck.width * 0.35,
                  y: deck.height * 0.3,
                  width: 220,
                  height: 180,
                  ...shapeInsertionStyle(preset.id),
                }),
              ]);
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="-4 -4 108 108"
              aria-hidden="true"
            >
              <path d={preset.d}
                fill={shapeInsertionStyle(preset.id).fill === "transparent" ? "none" : "currentColor"}
                stroke={shapeInsertionStyle(preset.id).strokeWidth ? "currentColor" : "none"}
                strokeWidth={6} />
            </svg>
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
  const layoutMenu = (
    <div
      className="popover layout-popover"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <h4>새 슬라이드 레이아웃</h4>
      {[
        ["title", "제목 슬라이드"],
        ["content", "제목 및 내용"],
        ["two-column", "두 개의 내용"],
        ["blank", "빈 슬라이드"],
      ].map(([id, label]) => (
        <button key={id} onClick={() => addSlide(id)}>
          <LayoutTemplate size={17} />
          {label}
        </button>
      ))}
    </div>
  );

  const objectMenuActions: ObjectMenuAction[] = [];
  if (selectedElement) {
    const locked = slide.elements.some(
      (el) => selected.includes(el.id) && el.locked,
    );
    objectMenuActions.push(
      {
        label: "그룹화",
        icon: <Layers size={16} />,
        disabled: locked || selected.length < 2,
        run: () =>
          changeSlide((s) => ({
            ...s,
            elements: groupElements(s.elements, selected),
          })),
      },
      {
        label: "그룹 해제",
        icon: <Layers size={16} />,
        disabled:
          locked ||
          !slide.elements.some(
            (e) => selected.includes(e.id) && e.groups?.length,
          ),
        run: () =>
          changeSlide((s) => ({
            ...s,
            elements: ungroupElements(s.elements, selected),
          })),
      },
      {
        label: "잘라내기",
        icon: <Scissors size={16} />,
        disabled: locked,
        run: () => {
          copySelection();
          removeSelected();
        },
      },
      { label: "복사", icon: <Copy size={16} />, run: copySelection },
      {
        label: "붙여넣기",
        icon: <ClipboardPaste size={16} />,
        run: () => void pasteFromClipboard(),
      },
      { label: "복제", icon: <Copy size={16} />, run: duplicateSelected },
      {
        label: "삭제",
        icon: <Trash2 size={16} />,
        disabled: locked,
        run: removeSelected,
      },
    );
    if (["text", "shape"].includes(selectedElement.type))
      objectMenuActions.push({
        label: "글자 색",
        icon: <Type size={16} />,
        separator: true,
        disabled: locked,
        run: () => openTextColor(),
      });
    if (
      selected.length === 1 &&
      ["text", "shape"].includes(selectedElement.type)
    )
      objectMenuActions.push({
        label: "텍스트 편집",
        icon: <Type size={16} />,
        separator: true,
        disabled: locked,
        run: () => {
          begin();
          setEditing(selectedElement.id);
        },
      });
    if (selected.length === 1 && selectedElement.type === "table")
      objectMenuActions.push({
        label: "표 편집",
        icon: <Table2 size={16} />,
        separator: true,
        disabled: locked,
        run: () => openTable(selectedElement.id),
      });
    objectMenuActions.push(
      {
        label: "맨 앞으로 가져오기",
        icon: <ArrowUpToLine size={16} />,
        separator: true,
        disabled: locked,
        run: () => layerSelected("front"),
      },
      {
        label: "앞으로 한 단계",
        icon: <ArrowUp size={16} />,
        disabled: locked,
        run: () => layerSelected("up"),
      },
      {
        label: "뒤로 한 단계",
        icon: <ArrowDown size={16} />,
        disabled: locked,
        run: () => layerSelected("down"),
      },
      {
        label: "맨 뒤로 보내기",
        icon: <ArrowDownToLine size={16} />,
        disabled: locked,
        run: () => layerSelected("back"),
      },
      {
        label: locked ? "잠금 해제" : "잠금",
        icon: locked ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />,
        separator: true,
        run: () =>
          changeSlide((s) => ({
            ...s,
            elements: s.elements.map((el) =>
              selected.includes(el.id) ? { ...el, locked: !locked } : el,
            ),
          })),
      },
      {
        label: "개체 서식",
        icon: <Settings2 size={16} />,
        run: () => setInspectorVisible(true),
      },
    );
  }

  if (!ready)
    return (
      <div className="loading-screen">
        <Presentation size={38} />
        <h2>Slide Studio</h2>
        <p>작업 공간을 열고 있습니다</p>
        <LoaderCircle className="spin" size={20} />
      </div>
    );
  return (
    <>
      <div
        className={`app-shell office-shell ${window.desktop?.platform === "win32" ? "desktop-windows" : ""}`}
        inert={presenting}
      >
        <header className="topbar">
          <button
            className="app-brand"
            onClick={() => void showLibrary()}
            title="내 프레젠테이션"
          >
            <span className="brand-mark">
              <Presentation size={21} />
            </span>
            <span>
              Slide<span className="brand-light"> Studio</span>
            </span>
          </button>
          <div className="top-separator" />
          <div className="document-title">
            <input
              aria-label="프레젠테이션 이름"
              value={deck.name}
              maxLength={100}
              onChange={(e) => commit((d) => ({ ...d, name: e.target.value }))}
              onBlur={() => {
                if (!deck.name.trim())
                  commit((d) => ({ ...d, name: "제목 없는 프레젠테이션" }));
              }}
            />
            <span
              className={`save-indicator ${saveStatus}`}
              title={
                saveStatus === "saved"
                  ? hasFileChanges
                    ? "현재 창의 복구용 임시 저장입니다. 내용을 보관하려면 PPTX로 저장해 주세요."
                    : "현재 창의 내용이 저장되었습니다"
                  : saveStatus === "saving"
                    ? "변경 사항을 저장하고 있습니다"
                    : "자동 저장 실패. 파일로 저장해 주세요."
              }
            >
              {saveStatus === "saved" ? (
                <CheckCircle2 size={13} />
              ) : saveStatus === "saving" ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <AlertCircle size={13} />
              )}
              <span>
                {saveStatus === "saved"
                  ? "저장됨"
                  : saveStatus === "saving"
                    ? "저장 중"
                    : "저장 실패"}
              </span>
            </span>
          </div>
          <div className="header-actions">
            <button
              className="icon-button quick-save"
              aria-label="빠른 저장"
              title={`PPTX 저장 ${shortcut("S")}`}
              onClick={() => void savePptx()}
            >
              <Save size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="실행 취소"
              title={`실행 취소 ${shortcut("Z")}`}
              disabled={!history.past.length && !inlineUndoAvailable && !pendingPreview}
              data-text-selection-control
              onPointerDown={(event) => { if (editing) event.preventDefault(); }}
              onClick={() => runToolbarHistory("undo")}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="다시 실행"
              title={`다시 실행 ${isMac ? "⇧⌘Z" : "Ctrl+Y"}`}
              disabled={!inlineRedoAvailable && (!history.future.length || inlineUndoAvailable || pendingPreview)}
              data-text-selection-control
              onPointerDown={(event) => { if (editing) event.preventDefault(); }}
              onClick={() => runToolbarHistory("redo")}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <CommandSearch
            enabled={!presenting && !modal && !busy}
            commands={[
              {
                id: "new-slide",
                label: "새 슬라이드",
                hint: shortcut("M"),
                run: () => addSlide(),
              },
              {
                id: "open",
                label: "파일 열기",
                hint: shortcut("O"),
                run: () => void openProject(),
              },
              {
                id: "save",
                label: "PPTX 저장",
                hint: shortcut("S"),
                run: () => void savePptx(),
              },
              {
                id: "text",
                label: "텍스트 상자 삽입",
                run: () => addElement("text"),
              },
              {
                id: "shape",
                label: "사각형 도형 삽입",
                run: () => addElement("shape", "rect"),
              },
              {
                id: "picture",
                label: "그림 삽입",
                run: () => imageInput.current?.click(),
              },
              { id: "video", label: "동영상 삽입", run: () => videoInput.current?.click() },
              {
                id: "table",
                label: "표 삽입",
                keywords: "행 열 셀",
                run: () => openTable(),
              },
              {
                id: "chart",
                label: "차트 삽입",
                keywords: "그래프 막대 원 꺾은선",
                run: () => setModal("chart"),
              },
              {
                id: "diagram",
                label: "다이어그램 삽입",
                keywords: "조직도 순서도 SmartArt",
                run: () => setModal("diagram"),
              },
              {
                id: "icons",
                label: "아이콘 삽입",
                run: () => setModal("icons"),
              },
              {
                id: "album",
                label: "사진 앨범 만들기",
                run: () => setModal("album"),
              },
              {
                id: "screenshot",
                label: "스크린샷 삽입",
                keywords: "화면 캡처",
                run: () => setModal("screenshot"),
              },
              {
                id: "link",
                label: "링크 삽입",
                keywords: "하이퍼링크",
                run: () => setModal("link"),
              },
              {
                id: "footer",
                label: "날짜 · 번호 · 바닥글",
                run: () => openFooter("footer"),
              },
              {
                id: "wordart",
                label: "WordArt 삽입",
                keywords: "장식 글자",
                run: () => setModal("wordart"),
              },
              {
                id: "equation",
                label: "수식 삽입",
                keywords: "분수",
                run: () => setModal("equation"),
              },
              {
                id: "symbol",
                label: "기호 삽입",
                run: () => setModal("symbol"),
              },
              {
                id: "format",
                label: "서식 패널 열기",
                keywords: "배경 위치 크기 회전",
                run: () => setInspectorVisible(true),
              },
              {
                id: "show",
                label: "처음부터 슬라이드 쇼",
                hint: "F5",
                run: () => startPresent(true),
              },
              {
                id: "sorter",
                label: "여러 슬라이드 보기",
                run: () => setSorter(true),
              },
              {
                id: "fit",
                label: "화면에 맞춤",
                keywords: "확대 축소",
                run: () => setZoom(null),
              },
              { id: "pdf", label: "PDF 내보내기", run: () => void exportPdf() },
              ...deck.slides.map((item, index) => ({
                id: item.id,
                label: `${index + 1}. ${slideTitle(item)}`,
                hint: "슬라이드로 이동",
                keywords: item.elements.map((el) => el.text || "").join(" "),
                run: () => {
                  selectSlide(item.id);
                  setSorter(false);
                },
              })),
            ]}
          />
          <div className="document-actions">
            <button
              className="button secondary export-button"
              onClick={() => void savePptx()}
            >
              <Save size={15} />
              PPTX 저장
            </button>
            <button className="button primary" onClick={() => startPresent()}>
              <Play size={15} fill="currentColor" />
              발표하기
            </button>
            <button
              className="icon-button theme-toggle"
              aria-label={
                chromeTheme === "dark"
                  ? "밝은 테마로 전환"
                  : "어두운 테마로 전환"
              }
              onClick={() =>
                setChromeTheme(chromeTheme === "dark" ? "light" : "dark")
              }
            >
              {chromeTheme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>
        <nav className="tabs" aria-label="리본 메뉴">
          <div className="menu-anchor">
            <button
              className={menu === "file" ? "selected-tab file-tab" : "file-tab"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setMenu(menu === "file" ? null : "file")}
            >
              파일
              <ChevronDown size={12} />
            </button>
            {menu === "file" && (
              <div
                className="popover file-popover"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    setModal("new");
                    setMenu(null);
                  }}
                >
                  <File size={16} />새 프레젠테이션
                </button>
                <button onClick={() => void showLibrary()}>
                  <FolderOpen size={16} />내 프레젠테이션
                </button>
                <button onClick={() => void openProject()}>
                  <FolderOpen size={16} />
                  파일 열기<span>{shortcut("O")}</span>
                </button>
                <hr />
                <button
                  onClick={() => {
                    finish();
                    setEditing(null);
                    setModal("fonts");
                    setMenu(null);
                  }}
                >
                  <Type size={16} />
                  원본 글꼴 추가
                </button>
                <hr />
                <button onClick={() => void savePptx()}>
                  <Save size={16} />
                  PPTX 저장<span>{shortcut("S")}</span>
                </button>
                <button onClick={() => void exportPdf()}>
                  <FileDown size={16} />
                  PDF 내보내기
                </button>
                <button onClick={() => void printDeck()}>
                  <Printer size={16} />
                  인쇄<span>{shortcut("P")}</span>
                </button>
                <hr />
                <button
                  onClick={() => {
                    setModal("shortcuts");
                    setMenu(null);
                  }}
                >
                  <Keyboard size={16} />
                  키보드 단축키
                </button>
              </div>
            )}
          </div>
          {(
            [
              ["home", "홈"],
              ["insert", "삽입"],
              ["design", "디자인"],
              ["transitions", "전환"],
              ["slideshow", "슬라이드 쇼"],
              ["view", "보기"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              data-text-selection-control
              onMouseDown={(event) => {
                if (editing) event.preventDefault();
              }}
              className={tab === id ? "selected-tab" : ""}
              onClick={() => {
                setTab(id);
                setRibbonCollapsed(false);
                setMenu(null);
              }}
            >
              {label}
            </button>
          ))}
          <span className="tab-spacer" />
          <span className="local-badge">
            <span />내 기기에 저장
          </span>
          <button
            className="format-pane-toggle"
            aria-pressed={inspectorVisible}
            onClick={() => setInspectorVisible(!inspectorVisible)}
          >
            <PanelRight size={14} />
            서식
          </button>
          <button
            aria-label={ribbonCollapsed ? "리본 메뉴 펼치기" : "리본 메뉴 축소"}
            title="리본 메뉴 표시 (Ctrl+F1)"
            onClick={() => {
              setRibbonCollapsed(!ribbonCollapsed);
              setMenu(null);
            }}
          >
            {ribbonCollapsed ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronUp size={14} />
            )}
          </button>
        </nav>
        <div
          className={`ribbon ${tab === "insert" ? "insert-ribbon" : ""} ${tab === "home" ? "home-ribbon" : ""}`}
          hidden={ribbonCollapsed}
        >
          {tab === "home" && (
            <>
              <div className="ribbon-group clipboard-group">
                <div className="tools-row">
                  <Tool
                    icon={<ClipboardPaste size={25} />}
                    onClick={() => void pasteFromClipboard()}
                  >
                    붙여넣기
                  </Tool>
                  <div className="tools-stack">
                    <button
                      onClick={() => cutSelection()}
                      disabled={!selected.length && selectedSlideIds.length === deck.slides.length}
                    >
                      <Scissors size={14} />
                      잘라내기
                    </button>
                    <button onClick={() => copySelection()}>
                      <Copy size={14} />
                      복사
                    </button>
                  </div>
                </div>
                <span className="group-label">클립보드</span>
              </div>
              <div className="ribbon-group slide-group">
                <div className="tools-row">
                  <div className="menu-anchor">
                    <Tool icon={<Plus size={24} />} onClick={() => addSlide()}>
                      새 슬라이드
                    </Tool>
                    <button
                      className="split-arrow"
                      aria-label="슬라이드 레이아웃 선택"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() =>
                        setMenu(menu === "layout" ? null : "layout")
                      }
                    >
                      <ChevronDown size={13} />
                    </button>
                    {menu === "layout" && layoutMenu}
                  </div>
                  <div className="tools-stack">
                    <button onClick={duplicateCurrentSlide}>
                      <Copy size={14} />
                      복제
                    </button>
                    <button
                      onClick={() => removeSlide()}
                      disabled={deck.slides.length === 1}
                    >
                      <Trash2 size={14} />
                      삭제
                    </button>
                  </div>
                </div>
                <span className="group-label">슬라이드</span>
              </div>
              <div className="ribbon-group font-group">
                {fontTools}
                <span className="group-label">글꼴</span>
              </div>
              <div className="ribbon-group shape-format-group" role="group" aria-label="도형 서식">
                <div className="shape-format-controls">
                  <label>
                    채우기
                    <input type="color" aria-label="도형 채우기 색"
                      value={shapeStyleTarget?.fill && shapeStyleTarget.fill !== "transparent" ? shapeStyleTarget.fill : "#FFFFFF"}
                      disabled={shapeStylesDisabled}
                      onChange={(event) => setShapeFill(event.target.value)} />
                  </label>
                  <label>
                    <input type="checkbox" aria-label="도형 채우기 없음"
                      checked={shapeStyleTarget?.fill === "transparent"}
                      disabled={shapeStylesDisabled}
                      onChange={(event) => setShapeFill(event.target.checked ? "transparent" : DEFAULT_SHAPE_FILL)} />
                    채우기 없음
                  </label>
                  <label>
                    선 색
                    <input type="color" aria-label="도형 선 색"
                      value={shapeStyleTarget?.stroke && shapeStyleTarget.stroke !== "transparent" ? shapeStyleTarget.stroke : "#233D35"}
                      disabled={shapeStylesDisabled}
                      onChange={(event) => setShapeStroke(event.target.value)} />
                  </label>
                  <label className="shape-line-width">
                    두께
                    <NumberInput aria-label="도형 선 두께"
                      key={selected.join(",")}
                      value={shapeStyleTarget?.strokeWidth || 0}
                      min={0} max={30} step={0.5}
                      disabled={shapeStylesDisabled}
                      onChange={setShapeStrokeWidth} />
                  </label>
                </div>
                <span className="group-label">도형 서식</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row align-tools">
                  {(
                    [
                      ["left", AlignLeft, "왼쪽 정렬"],
                      ["center", AlignCenter, "가운데 정렬"],
                      ["right", AlignRight, "오른쪽 정렬"],
                    ] as const
                  ).map(([align, Icon, label]) => (
                    <Tool
                      key={align}
                      small
                      icon={<Icon size={18} />}
                      title={label}
                      preserveTextSelection
                      active={
                        (editing
                          ? inlineTextStyle.align
                          : selectedTextStyle?.align) === align
                      }
                      disabled={!textCapable}
                      onClick={() => setTextStyle("align", align)}
                    />
                  ))}
                </div>
                <button
                  className="ribbon-text-action"
                  disabled={
                    !textCapable ||
                    selectedElement?.locked ||
                    (selectedElement?.type === "table" && !editing)
                  }
                  data-text-selection-control
                  onPointerDown={(event) => {
                    if (editing) event.preventDefault();
                  }}
                  aria-pressed={
                    selectedElement?.type === "text" &&
                    hasTextBullets(selectedElement)
                  }
                  onClick={() => {
                    if (editing) {
                      document
                        .querySelector(".editing-text")
                        ?.dispatchEvent(
                          new Event("slide-studio:toggle-bullets"),
                        );
                      return;
                    }
                    finish();
                    setEditing(null);
                    changeSlide((s) => ({
                      ...s,
                      elements: s.elements.map((e) =>
                        selected.includes(e.id) &&
                        !e.locked &&
                        (e.type === "text" || e.type === "shape")
                          ? toggleTextBullets(e)
                          : e,
                      ),
                    }));
                  }}
                >
                  • 글머리 기호
                </button>
                <button
                  className="ribbon-text-action"
                  disabled={!textCapable || selectedElement?.type === "table"}
                  data-text-selection-control
                  onPointerDown={(e) => {
                    if (editing) e.preventDefault();
                  }}
                  onClick={() => {
                    if (editing) {
                      document
                        .querySelector(".editing-text")
                        ?.dispatchEvent(
                          new Event("slide-studio:toggle-numbering"),
                        );
                      return;
                    }
                    changeSlide((s) => ({
                      ...s,
                      elements: s.elements.map((e) =>
                        selected.includes(e.id) && !e.locked
                          ? toggleTextNumbering(e)
                          : e,
                      ),
                    }));
                  }}
                >
                  1. 번호 매기기
                </button>
                <span className="group-label">단락</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<Type size={24} />}
                    onClick={() => addElement("text")}
                  >
                    텍스트
                  </Tool>
                  <div className="menu-anchor">
                    <Tool
                      icon={<Shapes size={24} />}
                      onClick={() => setMenu(menu === "shape" ? null : "shape")}
                    >
                      도형
                    </Tool>
                    {menu === "shape" && shapeMenu}
                  </div>
                  <Tool
                    icon={<ImageIcon size={23} />}
                    onClick={() => imageInput.current?.click()}
                  >
                    이미지
                  </Tool>
                </div>
                <span className="group-label">삽입</span>
              </div>
              <div className="ribbon-group arrange-group">
                <div className="tools-stack">
                  <button
                    disabled={!selected.length}
                    onClick={() => layerSelected("front")}
                  >
                    <ArrowUpToLine size={15} />맨 앞으로
                  </button>
                  <button
                    disabled={!selected.length}
                    onClick={() => layerSelected("back")}
                  >
                    <ArrowDownToLine size={15} />맨 뒤로
                  </button>
                </div>
                <span className="group-label">정렬</span>
              </div>
            </>
          )}
          {tab === "insert" && (
            <>
              <div className="ribbon-group">
                <Tool icon={<Plus size={25} />} onClick={() => addSlide()}>
                  새 슬라이드
                </Tool>
                <span className="group-label">슬라이드</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool icon={<Table2 size={26} />} onClick={() => openTable()}>
                    표
                  </Tool>
                  {selectedElement?.type === "table" && (
                    <Tool
                      icon={<Settings2 size={22} />}
                      disabled={selectedElement.locked}
                      onClick={() => openTable(selectedElement.id)}
                    >
                      표 편집
                    </Tool>
                  )}
                </div>
                <span className="group-label">표</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<ImageIcon size={26} />}
                    onClick={() => imageInput.current?.click()}
                  >
                    그림 삽입
                  </Tool>
                  <Tool icon={<Play size={25} />} onClick={() => videoInput.current?.click()}>동영상</Tool>
                  <div className="tools-stack">
                    <button onClick={() => setModal("screenshot")}>
                      <Camera size={16} />
                      스크린샷
                    </button>
                    <button onClick={() => setModal("album")}>
                      <Images size={16} />
                      사진 앨범
                    </button>
                  </div>
                </div>
                <span className="group-label">이미지</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <div className="menu-anchor">
                    <Tool
                      icon={<Shapes size={26} />}
                      onClick={() => setMenu(menu === "shape" ? null : "shape")}
                    >
                      도형
                    </Tool>
                    {menu === "shape" && shapeMenu}
                  </div>
                  <Tool
                    icon={<Smile size={25} />}
                    onClick={() => setModal("icons")}
                  >
                    아이콘
                  </Tool>
                  <Tool
                    icon={<Network size={25} />}
                    onClick={() => setModal("diagram")}
                  >
                    다이어그램
                  </Tool>
                  <Tool
                    icon={<BarChart3 size={25} />}
                    onClick={() => setModal("chart")}
                  >
                    차트
                  </Tool>
                </div>
                <span className="group-label">일러스트레이션</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<LinkIcon size={25} />}
                  disabled={selectedElement?.locked}
                  onClick={() => setModal("link")}
                >
                  링크
                </Tool>
                <span className="group-label">연결</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<Type size={25} />}
                    onClick={() => addElement("text")}
                  >
                    텍스트 상자
                  </Tool>
                  <Tool
                    icon={
                      <Type
                        size={26}
                        style={{ fontStyle: "italic", color: "#ca684a" }}
                      />
                    }
                    onClick={() => setModal("wordart")}
                  >
                    WordArt
                  </Tool>
                  <div className="tools-stack">
                    <button onClick={() => openFooter("date")}>
                      <CalendarDays size={15} />
                      날짜 및 시간
                    </button>
                    <button onClick={() => openFooter("number")}>
                      <Hash size={15} />
                      슬라이드 번호
                    </button>
                    <button onClick={() => openFooter("footer")}>
                      <PanelLeft size={15} />
                      바닥글
                    </button>
                  </div>
                </div>
                <span className="group-label">텍스트</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<Sigma size={25} />}
                    onClick={() => setModal("equation")}
                  >
                    수식
                  </Tool>
                  <Tool
                    icon={<Omega size={25} />}
                    onClick={() => setModal("symbol")}
                  >
                    기호
                  </Tool>
                </div>
                <span className="group-label">기호</span>
              </div>
            </>
          )}
          {tab === "design" && (
            <>
              <div className="ribbon-group theme-ribbon">
                <div className="theme-options">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      aria-label={t.name}
                      className={`theme-choice ${deck.theme === t.id ? "chosen" : ""}`}
                      onClick={() => applyTheme(t.id)}
                    >
                      <div style={{ background: t.background, color: t.text }}>
                        <span>Aa</span>
                        <i style={{ background: t.accent }} />
                      </div>
                      <small>{t.name}</small>
                    </button>
                  ))}
                </div>
                <span className="group-label">테마</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<LayoutTemplate size={25} />}
                  onClick={() =>
                    resizeDeck(1280, deck.height === 720 ? 960 : 720)
                  }
                >
                  비율{" "}
                  {Math.abs(deck.width / deck.height - 16 / 9) < 0.02
                    ? "16:9"
                    : "4:3"}
                </Tool>
                <span className="group-label">슬라이드 크기</span>
              </div>
              <div className="ribbon-hint">
                <span>
                  테마를 선택하면 전체 슬라이드의
                  <br />
                  기본 배경과 글자 색이 바뀝니다.
                </span>
              </div>
            </>
          )}
          {tab === "transitions" && (
            <>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<Square size={25} />}
                    active={slide.transition === "none"}
                    onClick={() =>
                      changeSlide((s) => ({ ...s, transition: "none" }))
                    }
                  >
                    없음
                  </Tool>
                  <Tool
                    icon={<Layers size={25} />}
                    active={slide.transition === "fade"}
                    onClick={() =>
                      changeSlide((s) => ({ ...s, transition: "fade" }))
                    }
                  >
                    페이드
                  </Tool>
                </div>
                <span className="group-label">화면 전환</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<Check size={24} />}
                  onClick={() =>
                    commit((d) => ({
                      ...d,
                      slides: d.slides.map((s) => ({
                        ...s,
                        transition: slide.transition,
                      })),
                    }))
                  }
                >
                  모두 적용
                </Tool>
                <span className="group-label">설정</span>
              </div>
              <div className="ribbon-hint">
                <span>
                  앱의 발표 모드에 적용됩니다.
                  <br />
                  슬라이드 내용은 그대로 유지됩니다.
                </span>
              </div>
            </>
          )}
          {tab === "view" && (
            <>
              <div className="ribbon-group">
                <div className="tools-row">
                  <Tool
                    icon={<PanelLeft size={25} />}
                    active={!sorter}
                    onClick={() => setSorter(false)}
                  >
                    기본 보기
                  </Tool>
                  <Tool
                    icon={<Grid2X2 size={25} />}
                    active={sorter}
                    onClick={() => setSorter(true)}
                  >
                    여러 슬라이드
                  </Tool>
                  <Tool
                    icon={<StickyNote size={24} />}
                    active={notesVisible}
                    onClick={() => setNotesVisible((v) => !v)}
                  >
                    발표자 노트
                  </Tool>
                </div>
                <span className="group-label">작업 보기</span>
              </div>
              <div className="ribbon-group">
                <div className="tools-stack">
                  <label>
                    <input
                      type="checkbox"
                      checked={rulerVisible}
                      onChange={(e) => setRulerVisible(e.target.checked)}
                    />
                    눈금자
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={guides}
                      onChange={(e) => setGuides(e.target.checked)}
                    />
                    가운데 안내선
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={grid}
                      onChange={(e) => setGrid(e.target.checked)}
                    />
                    눈금에 맞추기
                  </label>
                </div>
                <span className="group-label">정렬 도구</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<Maximize size={24} />}
                  onClick={() => setZoom(null)}
                >
                  화면에 맞춤
                </Tool>
                <span className="group-label">확대/축소</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<Play size={24} />}
                  onClick={() => startPresent(true)}
                >
                  처음부터 발표
                </Tool>
                <span className="group-label">슬라이드 쇼</span>
              </div>
              <div className="ribbon-group">
                <Tool
                  icon={<PanelRight size={24} />}
                  active={inspectorVisible}
                  onClick={() => setInspectorVisible(!inspectorVisible)}
                >
                  서식 패널
                </Tool>
                <span className="group-label">작업 창</span>
              </div>
            </>
          )}
          {tab === "slideshow" && (
            <>
              <div className="ribbon-group slideshow-tools">
                <div className="tools-row">
                  <Tool
                    icon={<Presentation size={27} />}
                    title="처음부터 (F5)"
                    onClick={() => startPresent(true)}
                  >
                    처음부터
                  </Tool>
                  <Tool
                    icon={<Play size={27} />}
                    title="현재 슬라이드부터 (Shift+F5)"
                    onClick={() => startPresent()}
                  >
                    현재 슬라이드부터
                  </Tool>
                </div>
                <span className="group-label">슬라이드 쇼 시작</span>
              </div>
              <div className="ribbon-group slideshow-tools">
                <div className="tools-row">
                  <Tool
                    icon={<StickyNote size={25} />}
                    active={notesVisible}
                    onClick={() => setNotesVisible(!notesVisible)}
                  >
                    발표자 노트
                  </Tool>
                  <Tool
                    icon={<EyeOff size={25} />}
                    active={!!slide.hidden}
                    title={slide.hidden ? "숨김 해제" : "슬라이드 숨기기"}
                    onClick={() =>
                      changeSlide((s) => ({ ...s, hidden: !s.hidden }))
                    }
                  >
                    {slide.hidden ? "숨김 해제" : "슬라이드 숨기기"}
                  </Tool>
                </div>
                <span className="group-label">발표 준비</span>
              </div>
              <div className="ribbon-group slideshow-tools">
                <Tool
                  icon={<PanelRight size={25} />}
                  onClick={() => {
                    if (openPresenter()) startPresent(true);
                    else
                      notify(
                        "발표자 창을 열 수 없습니다. 팝업 허용을 확인하세요.",
                      );
                  }}
                >
                  발표자 보기
                </Tool>
                <span className="group-label">별도 창</span>
              </div>
              <div className="ribbon-hint">
                <Keyboard size={19} />
                <span>
                  방향키 / Space로 다음 슬라이드 · B로 검은 화면
                  <br />
                  숫자 + Enter로 이동 · Esc로 종료 · 우클릭 / F1: 레이저·펜
                </span>
              </div>
            </>
          )}
        </div>
        <main className="workspace">
          <aside className="slide-sidebar">
            <div className="sidebar-heading">
              <span>
                슬라이드 <small>{deck.slides.length}</small>
              </span>
              <button
                className="icon-button"
                aria-label="여러 슬라이드 보기"
                onClick={() => setSorter((v) => !v)}
              >
                <Grid2X2 size={15} />
              </button>
            </div>
            <div className="thumbnail-list" ref={thumbnailList}>
              {deck.slides.map((s, i) => (
                <div
                  key={s.id}
                  className={`thumbnail-row ${selectedSlideIds.includes(s.id) ? "active" : ""} ${s.hidden ? "hidden-slide" : ""} ${dropSlide === i ? "drop-before" : ""}`}
                  draggable
                  onContextMenu={(e) => {
                    e.preventDefault();
                    slideContext(s.id, e.clientX, e.clientY);
                  }}
                  onDragStart={(e) => startSlideDrag(s.id, i, e)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDropSlide(i);
                  }}
                  onDragEnd={() => {
                    setDragSlide(null);
                    setDropSlide(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropSlides(s.id);
                  }}
                >
                  <span
                    className="slide-number"
                    title={s.hidden ? "발표에서 숨김" : undefined}
                  >
                    {i + 1}
                  </span>
                  <button
                    className="thumbnail-button"
                    aria-label={`슬라이드 ${i + 1}: ${slideTitle(s)}${s.hidden ? " (숨김)" : ""}`}
                    aria-current={s.id === slide.id ? "true" : undefined}
                    aria-pressed={selectedSlideIds.includes(s.id)}
                    onClick={(e) => selectSlide(s.id, e)}
                  >
                    <div
                      className="thumbnail-preview"
                      style={{ height: (176 * deck.height) / deck.width }}
                    >
                      <SlideVisual
                        slide={s}
                        width={deck.width}
                        height={deck.height}
                        scale={176 / deck.width}
                      />
                    </div>
                  </button>
                  <span className="thumbnail-caption">{slideTitle(s)}</span>
                </div>
              ))}
            </div>
            <button className="add-slide-button" onClick={() => addSlide()}>
              <Plus size={16} />
              슬라이드 추가
            </button>
          </aside>
          <section className="editor-column">
            <div className="canvas-topline">
              <span>{sorter ? "모든 슬라이드" : slideTitle(slide)}</span>
              <span>
                {tableRange
                  ? `${(tableRange.endRow - tableRange.startRow + 1) * (tableRange.endColumn - tableRange.startColumn + 1)}개 셀 선택`
                  : selected.length
                    ? `${selected.length}개 개체 선택됨`
                    : `${activeIndex + 1} / ${deck.slides.length}`}
              </span>
            </div>
            {sorter ? (
              <div className="slide-sorter">
                {deck.slides.map((s, i) => (
                  <button
                    key={s.id}
                    className={`${selectedSlideIds.includes(s.id) ? "chosen" : ""} ${dropSlide === i ? "drop-before" : ""}`}
                    draggable
                    onDragStart={(e) => startSlideDrag(s.id, i, e)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropSlide(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropSlides(s.id);
                    }}
                    onDragEnd={() => {
                      setDragSlide(null);
                      setDropSlide(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      slideContext(s.id, e.clientX, e.clientY);
                    }}
                    aria-pressed={selectedSlideIds.includes(s.id)}
                    onClick={(e) => selectSlide(s.id, e)}
                    onDoubleClick={() => {
                      selectSlide(s.id);
                      setSorter(false);
                    }}
                  >
                    <div
                      style={{
                        width: 260,
                        height: (260 * deck.height) / deck.width,
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <SlideVisual
                        slide={s}
                        width={deck.width}
                        height={deck.height}
                        scale={260 / deck.width}
                      />
                    </div>
                    <span>
                      {i + 1}. {slideTitle(s)}
                      {s.hidden ? " (숨김)" : ""}
                    </span>
                  </button>
                ))}
                <button className="sorter-add" onClick={() => addSlide()}>
                  <Plus size={30} />
                  <span>슬라이드 추가</span>
                </button>
              </div>
            ) : (
              <div className="canvas-workspace">
                <div
                  id="slide-workspace"
                  className="canvas-area"
                  ref={canvasArea}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) setSelected([]);
                  }}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("Files"))
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) void (isVideoFile(file) ? addVideo(file) : addImage(file));
                  }}
                >
                  <div className="canvas-scaler">
                    <div
                      className="ruler horizontal-ruler"
                      hidden={!rulerVisible}
                    >
                      <span>0</span>
                      <span>{Math.round(deck.width / 4)}</span>
                      <span>{Math.round(deck.width / 2)}</span>
                      <span>{Math.round((deck.width * 3) / 4)}</span>
                      <span>{deck.width}</span>
                    </div>
                    <SlideCanvas
                      contextMenu={(id, x, y, selection) => {
                        if (modal || busy || presenting) return;
                        if (selection) {
                          setObjectMenu(null);
                          setMenu(null);
                          setTextMenu({ x, y, selection });
                          return;
                        }
                        setTextMenu(null);
                        if (editing) {
                          finish();
                          setEditing(null);
                        }
                        setSelected(
                          selected.includes(id)
                            ? selected
                            : expandGroups(slide.elements, [id]),
                        );
                        setTableSelection(null);
                        setMenu(null);
                        setObjectMenu({ x, y });
                      }}
                      deck={deck}
                      slide={slide}
                      scale={Math.max(0.1, scale)}
                      selected={selected}
                      tableSelection={activeTableSelection}
                      selectTableCells={setTableSelection}
                      editing={editing}
                      select={(ids) => {
                        if (editing) {
                          finish();
                          setEditing(null);
                        }
                        setSelected(ids);
                      }}
                      edit={setEditing}
                      editTable={(id, range) => openTable(id, range)}
                      tableResizeEnabled={!modal && !busy && !presenting}
                      resizeTable={(id, before, table) =>
                        commit((d) => {
                          if (modalRef.current) return d;
                          const target = d.slides.find(
                            (s) => s.id === slide.id,
                          );
                          const original = target?.elements.find(
                            (el) => el.id === id,
                          );
                          // A cancelled gesture or a concurrent document edit must
                          // never replace a newer table with an older snapshot.
                          if (
                            !original ||
                            original.locked ||
                            original.table !== before ||
                            table === before
                          )
                            return d;
                          return {
                            ...d,
                            slides: d.slides.map((s) =>
                              s !== target
                                ? s
                                : {
                                    ...s,
                                    elements: s.elements.map((el) =>
                                      el === original ? { ...el, table } : el,
                                    ),
                                  },
                            ),
                          };
                        })
                      }
                      appendTableRow={(id) =>
                        changeSlide((s) => ({
                          ...s,
                          elements: s.elements.map((e) =>
                            e.id === id &&
                            e.table &&
                            e.table.cells.length < MAX_TABLE_ROWS
                              ? {
                                  ...e,
                                  table: changeTableAxis(
                                    e.table,
                                    "row",
                                    e.table.cells.length,
                                  ),
                                  height: Math.min(
                                    100000,
                                    (e.height * (e.table.cells.length + 1)) /
                                      e.table.cells.length,
                                  ),
                                }
                              : e,
                          ),
                        }))
                      }
                      begin={begin}
                      finish={finish}
                      resizeText={(id, height) =>
                        preview((d) => {
                          const target = d.slides.find(
                            (s) => s.id === slide.id,
                          );
                          const el = target?.elements.find((e) => e.id === id);
                          if (
                            !el?.autoHeight ||
                            el.locked ||
                            Math.abs(el.height - height) < 1
                          )
                            return d;
                          return {
                            ...d,
                            slides: d.slides.map((s) =>
                              s !== target
                                ? s
                                : {
                                    ...s,
                                    elements: s.elements.map((e) =>
                                      e.id === id ? { ...e, height } : e,
                                    ),
                                  },
                            ),
                          };
                        })
                      }
                      preview={(elements) =>
                        preview((d) => ({
                          ...d,
                          slides: d.slides.map((s) =>
                            s.id === slide.id ? { ...s, elements } : s,
                          ),
                        }))
                      }
                      changeText={(id, text, formats, edit) =>
                        previewText(
                          (d) => ({
                            ...d,
                            slides: d.slides.map((s) =>
                              s.id === slide.id
                                ? {
                                    ...s,
                                    elements: s.elements.map((el) =>
                                      el.id === id
                                        ? {
                                            ...(formats
                                              ? applyTextFormatRanges(
                                                  editText(
                                                    el,
                                                    text,
                                                    edit?.softBreak,
                                                    edit,
                                                  ),
                                                  formats,
                                                )
                                              : editText(
                                                  el,
                                                  text,
                                                  edit?.softBreak,
                                                  edit,
                                                )),
                                            field: undefined,
                                          }
                                        : el,
                                    ),
                                  }
                                : s,
                            ),
                          }),
                          id,
                          edit?.inputType ?? "",
                        )
                      }
                      changeCell={(id, row, column, text, formats, edit) =>
                        previewText(
                          (d) => ({
                            ...d,
                            slides: d.slides.map((s) =>
                              s.id !== slide.id
                                ? s
                                : {
                                    ...s,
                                    elements: s.elements.map((el) => {
                                      if (
                                        el.id !== id ||
                                        !el.table ||
                                        el.locked
                                      )
                                        return el;
                                      const table = el.table,
                                        style = tableCellStyle(
                                          table,
                                          row,
                                          column,
                                        );
                                      const content = {
                                        ...el,
                                        ...style,
                                        type: "text" as const,
                                        table: undefined,
                                        text: table.cells[row][column],
                                        paragraphs: style.paragraphs,
                                      };
                                      const changed = editText(
                                          content,
                                          text,
                                          edit?.softBreak,
                                          edit,
                                        ),
                                        next = formats
                                          ? applyTextFormatRanges(
                                              changed,
                                              formats,
                                            )
                                          : changed;
                                      return fitTableRows(
                                        {
                                          ...el,
                                          table: {
                                            ...table,
                                            cells: table.cells.map((r, ri) =>
                                              r.map((v, ci) =>
                                                ri === row && ci === column
                                                  ? text
                                                  : v,
                                              ),
                                            ),
                                            cellStyles: table.cells.map(
                                              (r, ri) =>
                                                r.map((_, ci) =>
                                                  ri === row && ci === column
                                                    ? {
                                                        ...table.cellStyles?.[
                                                          ri
                                                        ]?.[ci],
                                                        paragraphs:
                                                          next.paragraphs,
                                                      }
                                                    : (table.cellStyles?.[ri]?.[
                                                        ci
                                                      ] ?? null),
                                                ),
                                            ),
                                          },
                                        },
                                        row,
                                      );
                                    }),
                                  },
                            ),
                          }),
                          id,
                          edit?.inputType ?? "",
                          row,
                          column,
                        )
                      }
                      showGuides={guides}
                      grid={grid}
                    />
                  </div>
                </div>
                <CanvasScrollbar
                  areaRef={canvasArea}
                  activeIndex={activeIndex}
                  slideCount={deck.slides.length}
                  onSelect={(index) => selectSlide(deck.slides[index].id)}
                />
              </div>
            )}
            {notesVisible && (
              <NotesPane>
                <div>
                  <StickyNote size={14} />
                  <span>발표자 노트</span>
                  <small>발표 화면에는 표시되지 않습니다</small>
                  <button
                    className="icon-button"
                    aria-label="노트 닫기"
                    onClick={() => setNotesVisible(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <textarea
                  id="speaker-notes-editor"
                  aria-label="발표자 노트"
                  placeholder="이 슬라이드에서 이야기할 내용을 적어두세요…"
                  value={slide.notes}
                  onFocus={begin}
                  onChange={(e) =>
                    preview((d) => ({
                      ...d,
                      slides: d.slides.map((s) =>
                        s.id === slide.id ? { ...s, notes: e.target.value } : s,
                      ),
                    }))
                  }
                  onBlur={finish}
                />
              </NotesPane>
            )}
          </section>
          <aside className="inspector" hidden={!inspectorVisible}>
            <div className="inspector-heading">
              <Settings2 size={16} />
              <span>{selectedElement ? "개체 서식" : "슬라이드 서식"}</span>
              <button
                className="icon-button"
                aria-label="서식 패널 닫기"
                onClick={() => setInspectorVisible(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="inspector-body">
              {selectedElement ? (
                <>
                  <div className="inspector-section">
                    <h4>
                      위치 및 크기{" "}
                      <span>
                        {selected.length > 1
                          ? `${selected.length}개 선택`
                          : selectedElement.type === "text"
                            ? "텍스트"
                            : selectedElement.type === "image"
                              ? "이미지"
                              : selectedElement.type === "video" ? "동영상" : "도형"}
                      </span>
                    </h4>
                    <div className="number-grid" key={selected.join(",")}>
                      <NumberField
                        label="X"
                        value={selectedElement.x}
                        onChange={(x) => updateSelected({ x })}
                      />
                      <NumberField
                        label="Y"
                        value={selectedElement.y}
                        onChange={(y) => updateSelected({ y })}
                      />
                      <NumberField
                        label="너비"
                        value={selectedElement.width}
                        min={16}
                        onChange={(width) => updateSelected({ width })}
                      />
                      <NumberField
                        label="높이"
                        value={selectedElement.height}
                        min={8}
                        onChange={(height) =>
                          updateSelected({ height, autoHeight: false })
                        }
                      />
                      <NumberField
                        label="회전"
                        value={selectedElement.rotation}
                        min={-360}
                        max={360}
                        onChange={(rotation) => updateSelected({ rotation })}
                      />
                      <NumberField
                        label="불투명도"
                        value={selectedElement.opacity * 100}
                        min={0}
                        max={100}
                        onChange={(n) => updateSelected({ opacity: n / 100 })}
                      />
                    </div>
                  </div>
                  {selectedElement.type === "video" && <div className="inspector-section">
                    <h4>동영상 재생</h4>
                    {([["autoPlay", "슬라이드 쇼에서 자동 시작"], ["loop", "반복 재생"], ["muted", "음소거"]] as const).map(([key, label]) =>
                      <label className="check-field" key={key}><input type="checkbox" checked={selectedElement[key] !== false} disabled={selectedElement.locked}
                        onChange={event => updateSelected({ [key]: event.target.checked })} />{label}</label>)}
                    <button className="text-button full" onClick={() => startPresent()}>현재 슬라이드에서 재생<Play size={14} /></button>
                    <p>MP4·WebM, 한 개당 20 MiB까지 지원합니다.</p>
                  </div>}
                  {selectedElement.type === "text" && (
                    <div className="inspector-section">
                      <h4>텍스트</h4>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={selectedElement.wrap !== false}
                          disabled={selectedElement.locked}
                          onChange={(e) =>
                            updateSelected({ wrap: e.target.checked })
                          }
                        />
                        상자 너비에 맞춰 자동 줄바꿈
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedElement.autoHeight)}
                          disabled={
                            selectedElement.locked ||
                            (selectedElement.textColumns ?? 1) > 1 ||
                            Boolean(
                              selectedElement.writingMode &&
                                selectedElement.writingMode !== "horizontal",
                            )
                          }
                          onChange={(e) =>
                            updateSelected({ autoHeight: e.target.checked })
                          }
                        />
                        내용에 맞춰 상자 높이 자동 조절
                      </label>
                      <ColorField
                        label="색상"
                        value={selectedElement.color || "#233D35"}
                        onChange={(color) => updateSelected({ color })}
                      />
                      <label className="select-field">
                        세로 정렬
                        <select
                          aria-label="세로 정렬"
                          value={selectedElement.verticalAlign || "top"}
                          onChange={(e) =>
                            updateSelected({
                              verticalAlign: e.target
                                .value as SlideElement["verticalAlign"],
                            })
                          }
                        >
                          <option value="top">위쪽</option>
                          <option value="middle">가운데</option>
                          <option value="bottom">아래쪽</option>
                        </select>
                      </label>
                      <button
                        className="text-button full"
                        onClick={() => {
                          begin();
                          setEditing(selectedElement.id);
                        }}
                        disabled={selectedElement.locked}
                      >
                        텍스트 편집
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                  {selectedElement.type === "shape" && (
                    <div className="inspector-section">
                      <h4>채우기 및 윤곽선</h4>
                      <ColorField
                        label="채우기"
                        value={selectedElement.fill || "#D4613F"}
                        onChange={setShapeFill}
                      />
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={selectedElement.fill === "transparent"}
                          onChange={(e) => setShapeFill(e.target.checked ? "transparent" : DEFAULT_SHAPE_FILL)}
                        />
                        채우기 없음
                      </label>
                      <ColorField
                        label="선 색상"
                        value={selectedElement.stroke || "#233D35"}
                        onChange={setShapeStroke}
                      />
                      <NumberField
                        label="선 두께"
                        key={selected.join(",")}
                        value={selectedElement.strokeWidth || 0}
                        min={0}
                        max={30}
                        onChange={setShapeStrokeWidth}
                      />
                    </div>
                  )}
                  <div className="inspector-section">
                    <h4>개체 정렬</h4>
                    <label>
                      정렬 기준{" "}
                      <select
                        aria-label="개체 정렬 기준"
                        value={selected.length > 1 ? alignScope : "slide"}
                        onChange={(e) =>
                          setAlignScope(e.target.value as "slide" | "selection")
                        }
                      >
                        <option value="slide">슬라이드</option>
                        <option
                          value="selection"
                          disabled={selected.length < 2}
                        >
                          선택 개체
                        </option>
                      </select>
                    </label>
                    <div className="inspector-tools">
                      <Tool
                        small
                        icon={<AlignLeft size={17} />}
                        title="왼쪽 가장자리 맞춤"
                        onClick={() => alignElements("left")}
                      />
                      <Tool
                        small
                        icon={<AlignCenter size={17} />}
                        title="가로 가운데 맞춤"
                        onClick={() => alignElements("center")}
                      />
                      <Tool
                        small
                        icon={<AlignRight size={17} />}
                        title="오른쪽 가장자리 맞춤"
                        onClick={() => alignElements("right")}
                      />
                      <Tool
                        small
                        icon={<ArrowUp size={17} />}
                        title="위쪽 가장자리 맞춤"
                        onClick={() => alignElements("top")}
                      />
                      <Tool
                        small
                        icon={<Minus size={17} />}
                        title="세로 가운데 맞춤"
                        onClick={() => alignElements("middle")}
                      />
                      <Tool
                        small
                        icon={<ArrowDown size={17} />}
                        title="아래쪽 가장자리 맞춤"
                        onClick={() => alignElements("bottom")}
                      />
                      <button
                        disabled={selected.length < 3}
                        onClick={() => alignElements("horizontal")}
                      >
                        가로 간격 동일
                      </button>
                      <button
                        disabled={selected.length < 3}
                        onClick={() => alignElements("vertical")}
                      >
                        세로 간격 동일
                      </button>

                      <Tool
                        small
                        icon={<ArrowUp size={17} />}
                        title="앞으로 한 단계"
                        onClick={() => layerSelected("up")}
                      />
                      <Tool
                        small
                        icon={<ArrowDown size={17} />}
                        title="뒤로 한 단계"
                        onClick={() => layerSelected("down")}
                      />
                    </div>
                  </div>
                  <div className="inspector-section">
                    <div className="object-actions">
                      <button onClick={duplicateSelected}>
                        <Copy size={15} />
                        복제
                      </button>
                      <button
                        onClick={() =>
                          changeSlide((s) => ({
                            ...s,
                            elements: s.elements.map((e) =>
                              selected.includes(e.id)
                                ? { ...e, locked: !selectedElement.locked }
                                : e,
                            ),
                          }))
                        }
                      >
                        {selectedElement.locked ? (
                          <UnlockKeyhole size={15} />
                        ) : (
                          <LockKeyhole size={15} />
                        )}{" "}
                        {selectedElement.locked ? "잠금 해제" : "잠금"}
                      </button>
                      <button
                        className="danger"
                        onClick={removeSelected}
                        disabled={selectedElement.locked}
                      >
                        <Trash2 size={15} />
                        삭제
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="inspector-section">
                    <h4>배경</h4>
                    <ColorField
                      label="단색 채우기"
                      value={slide.background}
                      onChange={(background) =>
                        changeSlide((s) => ({ ...s, background, backgroundGradient: undefined, backgroundImage: undefined }))
                      }
                    />
                    <div className="swatches">
                      {[
                        "#FFFFFF",
                        "#FAF8F2",
                        "#E7EBDD",
                        "#233D35",
                        "#D4613F",
                        "#1E2634",
                        "#EFF5F8",
                        "#F8F0EF",
                      ].map((color) => (
                        <button
                          key={color}
                          aria-label={`배경 ${color}`}
                          style={{ background: color }}
                          className={slide.background === color ? "chosen" : ""}
                          onClick={() =>
                            changeSlide((s) => ({
                              ...s,
                              background: color,
                              backgroundGradient: undefined,
                              backgroundImage: undefined,
                            }))
                          }
                        >
                          {slide.background === color && (
                            <Check
                              size={12}
                              color={
                                ["#233D35", "#1E2634", "#D4613F"].includes(
                                  color,
                                )
                                  ? "white"
                                  : "#233D35"
                              }
                            />
                          )}
                        </button>
                      ))}
                    </div>
                    <button
                      className="outline-button full"
                      onClick={() =>
                        commit((d) => ({
                          ...d,
                          slides: d.slides.map((s) => ({
                            ...s,
                            background: slide.background,
                            backgroundGradient: slide.backgroundGradient,
                            backgroundImage: slide.backgroundImage,
                          })),
                        }))
                      }
                    >
                      모든 슬라이드에 적용
                    </button>
                  </div>
                  <div className="inspector-section">
                    <h4>레이아웃</h4>
                    <div className="layout-preview-grid">
                      {[
                        ["title", "제목"],
                        ["content", "제목 + 내용"],
                        ["two-column", "두 단"],
                        ["blank", "빈 화면"],
                      ].map(([id, label]) => (
                        <button key={id} onClick={() => applySlideLayout(id)}>
                          <div className={`layout-mini ${id}`}>
                            <i />
                            <i />
                            {id === "two-column" && <i />}
                          </div>
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="section-note">
                      현재 슬라이드의 레이아웃을 바꿉니다. 기존 내용은
                      유지됩니다.
                    </p>
                  </div>
                  <div className="inspector-section">
                    <h4>슬라이드 크기</h4>
                    <select
                      className="wide-select"
                      aria-label="슬라이드 비율"
                      value={
                        Math.abs(deck.width / deck.height - 4 / 3) < 0.02
                          ? "standard"
                          : "wide"
                      }
                      onChange={(e) =>
                        resizeDeck(1280, e.target.value === "wide" ? 720 : 960)
                      }
                    >
                      <option value="wide">와이드스크린 (16:9)</option>
                      <option value="standard">표준 (4:3)</option>
                    </select>
                  </div>
                </>
              )}
              <div className="layers-section">
                <h4>
                  <Layers size={14} />
                  레이어<span>{slide.elements.length}</span>
                </h4>
                {slide.elements.length === 0 ? (
                  <p>텍스트나 이미지를 추가해 보세요.</p>
                ) : (
                  [...slide.elements].reverse().map((e) => (
                    <button
                      key={e.id}
                      className={selected.includes(e.id) ? "chosen" : ""}
                      onClick={() => setSelected([e.id])}
                    >
                      {e.type === "text" ? (
                        <Type size={13} />
                      ) : e.type === "video" ? (<Play size={13} />) : e.type === "image" ? (
                        <ImageIcon size={13} />
                      ) : (
                        <Square size={13} />
                      )}
                      <span>
                        {e.type === "text"
                          ? (e.text || "텍스트").split("\n")[0]
                          : e.type === "image"
                            ? e.alt || "이미지"
                            : e.type === "video" ? e.alt || "동영상" : "도형"}
                      </span>
                      {e.locked && <LockKeyhole size={11} />}
                    </button>
                  ))
                )}
              </div>
            </div>
          </aside>
        </main>
        <footer className="statusbar">
          <span>
            슬라이드 {activeIndex + 1} / {deck.slides.length}
          </span>
          <span className="status-divider" />
          <button onClick={() => setModal("shortcuts")}>
            <Keyboard size={13} />
            단축키
          </button>
          {warnings.length > 0 && (
            <button onClick={() => setModal("import")}>
              <AlertCircle size={13} />
              가져오기 안내 ({warnings.length})
            </button>
          )}
          <span className="footer-spacer" />
          <button
            className={notesVisible ? "on" : ""}
            onClick={() => setNotesVisible((v) => !v)}
          >
            <StickyNote size={13} />
            노트
          </button>
          <span className="status-divider" />
          <button aria-label="기본 편집 보기" onClick={() => setSorter(false)}>
            <PanelLeft size={14} />
          </button>
          <button
            aria-label="전체 슬라이드 보기"
            onClick={() => setSorter(true)}
          >
            <Grid2X2 size={14} />
          </button>
          <button aria-label="발표 모드" onClick={() => startPresent()}>
            <Play size={14} />
          </button>
          <span className="status-divider" />
          <button
            aria-label="축소"
            onClick={() => setZoom(Math.max(0.2, scale - 0.1))}
          >
            <Minus size={13} />
          </button>
          <input
            aria-label="확대 비율"
            type="range"
            min="20"
            max="150"
            value={Math.round(scale * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />
          <button
            aria-label="확대"
            onClick={() => setZoom(Math.min(1.5, scale + 0.1))}
          >
            <Plus size={13} />
          </button>
          <span className="zoom-value">{Math.round(scale * 100)}%</span>
          <button
            aria-label="화면에 맞춤"
            title="화면에 맞춤"
            onClick={() => setZoom(null)}
          >
            <Maximize size={14} />
          </button>
        </footer>
        {colorPalette && (
          <TextColorPalette
            {...colorPalette}
            onApply={applyTextColor}
            onClose={closeTextColor}
          />
        )}
        {textMenu && (
          <TextContextMenu
            key={`${textMenu.x}:${textMenu.y}`}
            {...textMenu}
            onClose={closeTextMenu}
            onError={notify}
            onColor={() =>
              openTextColor(textMenu.selection, {
                x: textMenu.x,
                y: textMenu.y,
              })
            }
            onObjectMenu={() => {
              finish();
              setEditing(null);
              setObjectMenu({ x: textMenu.x, y: textMenu.y });
            }}
          />
        )}
        {objectMenu && selectedElement && (
          <ObjectContextMenu
            {...objectMenu}
            actions={objectMenuActions}
            onClose={closeObjectMenu}
          />
        )}
      </div>
      <input ref={videoInput} type="file" hidden accept={VIDEO_ACCEPT}
        onChange={event => { if (event.target.files?.[0]) void addVideo(event.target.files[0]); event.target.value = ""; }} />
      <input
        ref={imageInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          if (e.target.files?.[0]) void addImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".slide,.json,.pptx"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) {
            if (file.size > 256 * 1024 * 1024)
              notify("256 MiB 이하의 파일을 선택해 주세요.");
            else {
              try {
                await readFile(file.name, await file.arrayBuffer());
              } catch {
                notify("파일 데이터를 읽지 못했습니다. 다시 선택해 주세요.");
              }
            }
          }
        }}
      />
      {modal === "fonts" && <FontManager onClose={() => setModal(null)} />}
      {modal === "table" && (
        <TableEditor
          initialRange={tableEditRange}
          slideWidth={deck.width}
          slideHeight={deck.height}
          elementSize={
            tableEditId
              ? slide.elements.find((el) => el.id === tableEditId)
              : undefined
          }
          initial={
            tableEditId
              ? slide.elements.find((el) => el.id === tableEditId)?.table
              : undefined
          }
          onCancel={() => setModal(null)}
          onApply={(table) => {
            if (tableEditId) {
              changeSlide((s) => ({
                ...s,
                elements: s.elements.map((el) =>
                  el.id === tableEditId && !el.locked
                    ? fitTableRows({ ...el, table })
                    : el,
                ),
              }));
              setModal(null);
            } else
              insertElements([
                fitTableRows(
                  createTableElement(table, deck.width, deck.height),
                ),
              ]);
          }}
        />
      )}
      {modal && contentDialogs.includes(modal as InsertContentKind) && (
        <InsertContentDialog
          kind={modal as InsertContentKind}
          deck={deck}
          background={slide.background}
          onInsert={insertElements}
          onCancel={() => setModal(null)}
        />
      )}
      {modal === "link" && (
        <LinkDialog
          deck={deck}
          selected={selectedElement}
          onCancel={() => setModal(null)}
          onApply={(hyperlink, label) => {
            if (selectedElement) {
              changeSlide((s) => ({
                ...s,
                elements: s.elements.map((el) =>
                  el.id === selectedElement.id && !el.locked
                    ? { ...el, hyperlink }
                    : el,
                ),
              }));
              setModal(null);
            } else if (hyperlink)
              insertElements([
                element("text", {
                  text: label,
                  hyperlink,
                  x: deck.width * 0.2,
                  y: deck.height * 0.4,
                  color: "#2563EB",
                  underline: true,
                }),
              ]);
          }}
        />
      )}
      {modal === "footer" && (
        <FooterDialog
          slide={slide}
          initial={footerInitial}
          onCancel={() => setModal(null)}
          onApply={(options, all) => {
            const next = applyFooters(deckRef.current, slide.id, options, all);
            if (!withinCapacity({}, next)) return;
            commit(() => next);
            setModal(null);
          }}
        />
      )}
      {modal === "album" && (
        <PhotoAlbumDialog
          deck={deck}
          onCancel={() => setModal(null)}
          onInsert={(slides) => {
            if (!withinCapacity({ slides })) return;
            const next = [...deck.slides];
            next.splice(activeIndex + 1, 0, ...slides);
            const valid = parseDeckJson(
              JSON.stringify({ ...deck, slides: next }),
            );
            commit(() => valid);
            selectSlide(slides[0].id);
            setModal(null);
            setSorter(false);
          }}
        />
      )}
      {modal === "screenshot" && (
        <ScreenshotDialog
          onCancel={() => setModal(null)}
          onInsert={(src) => {
            const deckId = deck.id;
            const instance = modalInstance.current;
            void imageElementFromData(src, deck)
              .then((el) => {
                if (
                  deckRef.current.id === deckId &&
                  modalRef.current === "screenshot" &&
                  modalInstance.current === instance
                )
                  insertElements([el]);
              })
              .catch(() => notify("스크린샷을 이미지로 읽지 못했습니다."));
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="알림 닫기">
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="modal-backdrop busy-backdrop">
          <div className="busy-dialog">
            <LoaderCircle className="spin" size={24} />
            <p>{busy}</p>
          </div>
        </div>
      )}
      {modal && ["new", "library", "shortcuts", "import"].includes(modal) && (
        <div
          className="modal-backdrop"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className={`dialog ${modal === "library" ? "library-dialog" : ""}`}
            role="dialog"
            aria-modal="true"
          >
            <button
              className="dialog-close icon-button"
              aria-label="대화상자 닫기"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "new" ? (
              <>
                <div className="dialog-eyebrow">A FRESH START</div>
                <h2>어떤 이야기를 시작할까요?</h2>
                <p>첫 슬라이드의 레이아웃을 선택하세요.</p>
                <div className="new-layouts">
                  {[
                    ["title", "제목 슬라이드"],
                    ["content", "제목 및 내용"],
                    ["two-column", "두 개의 내용"],
                    ["blank", "빈 슬라이드"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={layout === id ? "chosen" : ""}
                      onClick={() => setLayout(id)}
                    >
                      <div className={`layout-mini ${id}`}>
                        <i />
                        <i />
                        {id === "two-column" && <i />}
                      </div>
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="dialog-actions">
                  <button
                    className="text-button"
                    onClick={() => void createDocument(true)}
                  >
                    예제 프레젠테이션
                  </button>
                  <button
                    className="button primary"
                    onClick={() => void createDocument()}
                  >
                    만들기
                    <ArrowRight size={15} />
                  </button>
                </div>
              </>
            ) : modal === "library" ? (
              <LibraryContents
                notify={notify}
                onNew={() => setModal("new")}
                onOpen={async (id) => {
                  const file = await window.desktop?.openRecentFile?.(id);
                  if (file) await readFile(file.name, file.data);
                }}
              />
            ) : modal === "shortcuts" ? (
              <>
                <div className="dialog-eyebrow">MAKE IT FLOW</div>
                <h2>키보드 단축키</h2>
                <div className="shortcut-list">
                  {[
                    ["PPTX 저장", "⌘ / Ctrl + S"],
                    ["파일 열기", "⌘ / Ctrl + O"],
                    ["인쇄", "⌘ / Ctrl + P"],
                    ["새 슬라이드", "⌘ / Ctrl + M"],
                    ["복제", "⌘ / Ctrl + D"],
                    ["실행 취소", "⌘ / Ctrl + Z"],
                    ["다시 실행", "⇧ + ⌘ / Ctrl + Z"],
                    ["전체 개체 선택", "⌘ / Ctrl + A"],
                    ["복사 / 붙여넣기", "⌘ / Ctrl + C / V"],
                    ["개체 미세 이동", "방향키 (Shift: 10px)"],
                    ["텍스트 편집", "더블클릭 / Enter"],
                    ["처음부터 / 현재부터 발표", "F5 / Shift + F5"],
                    ["발표 중 이동 / 종료", "방향키 / Esc"],
                    ["발표 중 검은 화면", "B"],
                    ["발표 도구", "우클릭 / F1"],
                    ["발표 레이저 / 펜", "⌘ / Ctrl + L / P"],
                    ["발표 화살표 / 지우개", "⌘ / Ctrl + A / E"],
                    ["현재 슬라이드의 그리기 지우기", "E"],
                    ["발표 중 슬라이드 번호로 이동", "숫자 + Enter"],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="dialog-eyebrow">PRESENTATION IMPORT</div>
                <h2>가져오기 안내</h2>
                <p>이 파일에서 아래 항목은 지원 범위에 제한이 있습니다.</p>
                <ul className="warning-list">
                  {warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
                <button
                  className="button primary"
                  onClick={() => setModal(null)}
                >
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {presenting && (
        <div
          className={`presentation-view ${blackout || whiteout ? "blackout" : ""} ${whiteout ? "whiteout" : ""}`}
          ref={presentationView}
          tabIndex={-1}
          data-testid="presentation-view"
          role="region"
          aria-label={
            presentEnded
              ? "슬라이드 쇼 종료 안내"
              : `발표 슬라이드 ${presentIndex + 1} / ${deck.slides.length}`
          }
          onClick={() => {
            if (!presentationInk.current?.consumeClick()) movePresent(1);
          }}
          onContextMenu={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest(".present-notes, .presentation-tools")
            )
              return;
            event.preventDefault();
            presentationInk.current?.openMenu(event.clientX, event.clientY);
          }}
        >
          {presentEnded && (
            <p className="presentation-end" data-testid="presentation-end">
              슬라이드 쇼가 끝났습니다. 클릭하거나 Esc 키를 눌러 종료하세요.
            </p>
          )}
          <PresentationInk
            ref={presentationInk}
            slide={deck.slides[presentIndex]}
            width={deck.width}
            height={deck.height}
            scale={Math.min(
              windowSize.w / deck.width,
              (windowSize.h - (presentNotes ? 160 : 0)) / deck.height,
            )}
            ended={presentEnded}
            blackout={blackout || whiteout}
            onSlideLink={(slideId) => {
              const index = deck.slides.findIndex((s) => s.id === slideId);
              if (index >= 0) showPresentationSlide(index);
            }}
          />
          {presentNotes && !presentEnded && (
            <div className="present-notes" onClick={(e) => e.stopPropagation()}>
              <strong>발표자 노트</strong>
              <p>
                {deck.slides[presentIndex].notes ||
                  "이 슬라이드에 노트가 없습니다."}
              </p>
            </div>
          )}
        </div>
      )}
      {slideMenu && (
        <ObjectContextMenu
          x={slideMenu.x}
          y={slideMenu.y}
          onClose={() => setSlideMenu(null)}
          actions={[
            {
              icon: <Copy size={16} />,
              label: `슬라이드 복제 (${selectedSlideIds.length})`,
              run: () => {
                duplicateCurrentSlide();
                setSlideMenu(null);
              },
            },
            {
              icon: <Copy size={16} />,
              label: "슬라이드 복사",
              run: () => {
                copySelection();
                setSlideMenu(null);
              },
            },
            {
              icon: <EyeOff size={16} />,
              label: deck.slides
                .filter((s) => selectedSlideIds.includes(s.id))
                .every((s) => s.hidden)
                ? "숨김 해제"
                : "슬라이드 숨기기",
              run: () => {
                const hidden = !deck.slides
                  .filter((s) => selectedSlideIds.includes(s.id))
                  .every((s) => s.hidden);
                commit((d) => ({
                  ...d,
                  slides: d.slides.map((s) =>
                    selectedSlideIds.includes(s.id) ? { ...s, hidden } : s,
                  ),
                }));
                setSlideMenu(null);
              },
            },
            {
              icon: <Trash2 size={16} />,
              label: "슬라이드 삭제",
              run: () => {
                removeSlide();
                setSlideMenu(null);
              },
            },
          ]}
        />
      )}
      {pendingInk && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-label="발표 판서 보관"
            aria-modal="true"
          >
            <h2>발표 중 그린 내용을 보관할까요?</h2>
            <p>펜과 형광펜을 편집 가능한 도형으로 슬라이드에 추가합니다.</p>
            <div className="dialog-actions">
              <button onClick={() => setPendingInk(null)}>판서 버리기</button>
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  if (!withinCapacity({
                    elements: Object.fromEntries(Object.entries(pendingInk).map(([id, strokes]) => [id, strokes.length])),
                  })) return;
                  commit((d) => ({
                    ...d,
                    slides: d.slides.map((s) => {
                      const strokes = pendingInk[s.id];
                      if (!strokes) return s;
                      const group = uid();
                      const elements = strokes.map((stroke) => {
                        const xs = stroke.points.map((p) => p[0]),
                          ys = stroke.points.map((p) => p[1]),
                          x = Math.min(...xs),
                          y = Math.min(...ys),
                          width = Math.max(1, Math.max(...xs) - x),
                          height = Math.max(1, Math.max(...ys) - y);
                        return element("shape", {
                          shape: "custom",
                          groups: [group],
                          x,
                          y,
                          width,
                          height,
                          opacity: stroke.opacity ?? 1,
                          fill: "transparent",
                          stroke: stroke.color,
                          strokeCap: "round",
                          strokeWidth: stroke.width,
                          paths: [
                            {
                              d: stroke.points
                                .map(
                                  (p, i) =>
                                    `${i ? "L" : "M"} ${p[0] - x} ${p[1] - y}`,
                                )
                                .join(" "),
                              width,
                              height,
                              fill: false,
                              stroke: true,
                            },
                          ],
                        });
                      });
                      return { ...s, elements: [...s.elements, ...elements] };
                    }),
                  }));
                  setPendingInk(null);
                }}
              >
                슬라이드에 보관
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="print-deck">
        <style>{`@media print { @page { size: ${deck.width / 96}in ${deck.height / 96}in; margin: 0; } }`}</style>
        {deck.slides.map((s) => (
          <div
            className="print-slide"
            key={s.id}
            style={{ width: deck.width, height: deck.height }}
          >
            <SlideVisual slide={s} width={deck.width} height={deck.height} />
          </div>
        ))}
      </div>
    </>
  );
}
