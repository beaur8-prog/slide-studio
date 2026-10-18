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
  Download,
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
import { hasTextBullets, toggleTextBullets } from "./text-bullets";
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
import { exportPptx, importPptx, parseDeckJson, serializeDeck } from "./io";
import { listAutosaves, loadAutosave, saveAutosave } from "./storage";
import TableEditor from "./TableEditor";
import { createTableElement, tableCellStyle, validateTable } from "./table";
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
import { EXTRA_SHAPES } from "./shape-presets";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`);

type History = { past: Deck[]; present: Deck; future: Deck[] };
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
  deck,
  onOpen,
  onNew,
  notify,
}: {
  deck: Deck;
  onOpen: (deck: Deck) => void;
  onNew: () => void;
  notify: (message: string) => void;
}) {
  // Saved decks can contain large image payloads. Only the mounted library
  // owns them, so every dismissal path releases the list with its component.
  const [documents, setDocuments] = useState<Deck[] | null>(null);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        await saveAutosave(deck);
        if (disposed) return;
        const saved = await listAutosaves();
        if (!disposed) setDocuments(saved);
      } catch {
        if (!disposed) {
          setDocuments([]);
          notify("저장된 문서를 불러오지 못했습니다.");
        }
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [deck, notify]);
  return (
    <>
      <div className="dialog-eyebrow">YOUR WORKSPACE</div>
      <h2>내 프레젠테이션</h2>
      <p>이 기기에 자동 저장한 문서입니다.</p>
      {documents === null && (
        <p role="status">저장한 문서를 불러오고 있습니다.</p>
      )}
      <div className="library-grid">
        <button className="library-new" onClick={onNew}>
          <Plus size={27} />
          <strong>새 프레젠테이션</strong>
        </button>
        {documents?.map((d) => (
          <button key={d.id} onClick={() => onOpen(d)}>
            <div
              style={{
                position: "relative",
                width: 230,
                height: (230 * d.height) / d.width,
                overflow: "hidden",
              }}
            >
              <SlideVisual
                slide={d.slides[0]}
                width={d.width}
                height={d.height}
                scale={230 / d.width}
              />
            </div>
            <strong>{d.name}</strong>
            <small>{d.slides.length}개의 슬라이드</small>
          </button>
        ))}
      </div>
    </>
  );
}

export default function App() {
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: sampleDeck(),
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
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [busy, setBusy] = useState("");
  const printing = useRef(false);
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
  const fileInput = useRef<HTMLInputElement>(null);
  const transaction = useRef<Deck | null>(null);
  const clipboard = useRef<{
    elements?: SlideElement[];
    slide?: Slide;
    cells?: string[][];
    cellStyles?: TableCellFormat[][];
  }>({});
  const clipboardToken = useRef("");
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
  const finish = useCallback(() => {
    const before = transaction.current;
    transaction.current = null;
    if (before)
      setHistory((h) =>
        before === h.present
          ? h
          : {
              past: [...h.past, before].slice(-LIMIT),
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
  const selectSlide = (id: string) => {
    finish();
    setActiveId(id);
    setSelected([]);
    setEditing(null);
    setMenu(null);
  };
  const replaceDeck = (next: Deck) => {
    // A file dialog/import started in the editor can finish after a show starts.
    // Leave the old deck's presentation before its slide indexes become invalid.
    if (presentationActive.current) stopPresent();
    setHistory({ past: [], present: next, future: [] });
    setActiveId(next.slides[0].id);
    setSelected([]);
    setEditing(null);
    setModal(null);
    setMenu(null);
    setZoom(null);
    setSorter(false);
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
        if (saved) {
          try {
            const safe = parseDeckJson(JSON.stringify(saved));
            setHistory({ past: [], present: safe, future: [] });
            setActiveId(safe.slides[0].id);
          } catch {
            notify("저장된 문서를 읽지 못해 새 예제를 열었습니다.");
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
  useEffect(() => {
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
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus !== "saved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveStatus]);
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

  const addSlide = (chosen = "content") => {
    const next = newSlide(chosen, deck.theme, deck.width, deck.height);
    commit((d) => {
      const slides = [...d.slides];
      slides.splice(activeIndex + 1, 0, next);
      return { ...d, slides };
    });
    selectSlide(next.id);
    setSorter(false);
  };
  const duplicateCurrentSlide = () => {
    const next = duplicateSlide(slide);
    commit((d) => {
      const slides = [...d.slides];
      slides.splice(activeIndex + 1, 0, next);
      return { ...d, slides };
    });
    selectSlide(next.id);
    notify("슬라이드를 복제했습니다.");
  };
  const removeSlide = (id = slide.id) => {
    if (deck.slides.length === 1) {
      notify("프레젠테이션에는 슬라이드가 하나 이상 필요합니다.");
      return;
    }
    const idx = deck.slides.findIndex((s) => s.id === id);
    commit((d) => ({ ...d, slides: d.slides.filter((s) => s.id !== id) }));
    selectSlide(deck.slides[Math.max(0, idx - 1)].id);
  };
  const addElement = (type: SlideElement["type"], shape?: ShapeKind) => {
    const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
    const next = element(type, {
      x: deck.width * 0.28,
      y: deck.height * 0.35,
      ...(type === "text"
        ? { color: theme.text, wrap: true, autoHeight: true }
        : {}),
      ...(shape
        ? {
            shape,
            fill: theme.accent,
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
      if (
        slide.elements.length + checked.length > 1000 ||
        deck.slides.reduce((n, s) => n + s.elements.length, 0) +
          checked.length >
          10000
      )
        throw new Error(
          "슬라이드에는 1,000개, 문서에는 10,000개까지 개체를 넣을 수 있습니다.",
        );
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
    const copies = slide.elements
      .filter((e) => selected.includes(e.id))
      .map((e) => ({
        ...clone(e),
        id: uid(),
        x: e.x + 24,
        y: e.y + 24,
        locked: false,
      }));
    changeSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
    setSelected(copies.map((e) => e.id));
  };
  const writeInternalClipboard = (
    text: string,
    nativeClipboard?: DataTransfer | null,
  ) => {
    clipboardToken.current = uid();
    const fill = (data: DataTransfer) => {
      data.setData("text/plain", text);
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
      writeInternalClipboard(text, nativeClipboard);
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
      : { slide: clone(slide) };
    const elements =
      clipboard.current.elements ?? clipboard.current.slide?.elements ?? [];
    try {
      writeInternalClipboard(
        elements
          .map((e) => e.text ?? "")
          .filter(Boolean)
          .join("\n"),
        nativeClipboard,
      );
    } catch {
      /* Keep the internal copy if native clipboard access fails. */
    }
    notify(
      selected.length ? "개체를 복사했습니다." : "슬라이드를 복사했습니다.",
    );
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
      const copies = clipboard.current.elements.map((e) => ({
        ...clone(e),
        id: uid(),
        x: e.x + 24,
        y: e.y + 24,
        locked: false,
      }));
      changeSlide((s) => ({ ...s, elements: [...s.elements, ...copies] }));
      setSelected(copies.map((e) => e.id));
    } else if (clipboard.current.slide) {
      const next = duplicateSlide(clipboard.current.slide);
      commit((d) => {
        const slides = [...d.slides];
        slides.splice(activeIndex + 1, 0, next);
        return { ...d, slides };
      });
      selectSlide(next.id);
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
  const alignElements = (direction: "left" | "center" | "right") =>
    changeSlide((s) => ({
      ...s,
      elements: s.elements.map((e) =>
        selected.includes(e.id) && !e.locked
          ? {
              ...e,
              x:
                direction === "left"
                  ? 0
                  : direction === "center"
                    ? (deck.width - e.width) / 2
                    : deck.width - e.width,
            }
          : e,
      ),
    }));
  const addImage = async (file: File) => {
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
    extensions: string[],
  ) => {
    if (window.desktop)
      return !!(await window.desktop.saveFile({
        name,
        data,
        extensions,
      }));
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  };
  const saveProject = async () => {
    setMenu(null);
    try {
      if (
        await saveBytes(
          `${deck.name}.slide`,
          new TextEncoder().encode(serializeDeck(deck)),
          ["slide"],
        )
      )
        notify("편집 가능한 프로젝트 파일을 저장했습니다.");
    } catch (error) {
      notify(
        `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const exportDeck = async () => {
    setMenu(null);
    setBusy("PowerPoint 파일을 만들고 있습니다");
    try {
      const bytes = await exportPptx(deck);
      if (await saveBytes(`${deck.name}.pptx`, bytes, ["pptx"]))
        notify("PPTX 파일을 저장했습니다.");
    } catch (error) {
      notify(
        `PPTX 내보내기 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
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
  const readFile = async (name: string, data: ArrayBuffer | Uint8Array) => {
    setBusy("프레젠테이션을 열고 있습니다");
    try {
      await saveAutosave(deck);
      if (/\.pptx$/i.test(name)) {
        const result = await importPptx(data);
        replaceDeck(result.deck);
        if (result.warnings.length) {
          setWarnings(result.warnings);
          setModal("import");
        } else
          notify(`${result.deck.slides.length}개의 슬라이드를 불러왔습니다.`);
      } else {
        const imported = parseDeckJson(new TextDecoder().decode(data));
        replaceDeck(imported);
        notify("프로젝트를 열었습니다.");
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
      void document.exitFullscreen().catch(() => {});
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
    if (!blackout) return false;
    setBlackout(false);
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
          e.target.closest(".presentation-link") &&
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
          ["ArrowRight", "ArrowDown", " ", "PageDown"].includes(e.key)
        ) {
          e.preventDefault();
          movePresent(1);
        } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
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
          presentationNumber.current = presentationNumber.current.slice(0, -1);
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
          setBlackout((b) => !b);
        }
        return;
      }
      if (objectMenu || textMenu || colorPalette) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === "F1") {
        e.preventDefault();
        setRibbonCollapsed((value) => !value);
        return;
      }
      if (cmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveProject();
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
      } else if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(slide.elements.map((el) => el.id));
      } else if (cmd && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copySelection();
      } else if (cmd && e.key.toLowerCase() === "x") {
        e.preventDefault();
        copySelection();
        if (selected.length) removeSelected();
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
        selectedElement?.type === "text" &&
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
      copySelection(event.clipboardData);
      if (event.type === "cut" && selected.length) removeSelected();
    };
    window.addEventListener("copy", copyCells);
    window.addEventListener("cut", copyCells);
    return () => {
      window.removeEventListener("copy", copyCells);
      window.removeEventListener("cut", copyCells);
    };
  });
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      if (presentationActive.current) {
        e.preventDefault();
        return;
      }
      if (editingTarget(e.target) || modal) return;
      const file = Array.from(e.clipboardData?.items || [])
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        e.preventDefault();
        void addImage(file);
        return;
      }
      if (
        clipboardToken.current &&
        e.clipboardData?.getData("application/x-slide-studio") ===
          clipboardToken.current
      ) {
        e.preventDefault();
        pasteSelection();
        return;
      }
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        e.preventDefault();
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
      if (action === "save") void saveProject();
      if (action === "export-pptx") void exportDeck();
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
    if (selectedElement?.type !== "text" || selectedElement.locked) return;
    if (!editing) {
      updateSelected({ [format]: !selectedElement[format] });
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
    if (selectedElement?.type !== "text" || selectedElement.locked) return;
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
        selectedElement.color ??
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
          colorPalette.ids.includes(el.id) && el.type === "text" && !el.locked
            ? patchText(el, { color })
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
    if (selectedElement?.type !== "text" || selectedElement.locked) return;
    if (!editing) {
      updateSelected({ [key]: value });
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
              : selectedElement?.fontFamily || "Arial"
          }
          disabled={selectedElement?.type !== "text"}
          onChange={(e) => setTextStyle("fontFamily", e.target.value)}
        >
          {[
            ...new Set([
              selectedElement?.fontFamily || "Arial",
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
            editing ? inlineTextStyle.fontSize : selectedElement?.fontSize || 32
          }
          disabled={selectedElement?.type !== "text"}
          onChange={(fontSize) => setTextStyle("fontSize", fontSize)}
        />
      </div>
      <div className="format-row">
        <Tool
          small
          icon={<Bold size={17} />}
          title="굵게"
          preserveTextSelection
          active={editing ? inlineFormat.bold : selectedElement?.bold || false}
          disabled={selectedElement?.type !== "text" || selectedElement.locked}
          onClick={() => toggleTextFormat("bold")}
        />
        <Tool
          small
          icon={<Italic size={17} />}
          title="기울임"
          preserveTextSelection
          active={
            editing ? inlineFormat.italic : selectedElement?.italic || false
          }
          disabled={selectedElement?.type !== "text" || selectedElement.locked}
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
              : selectedElement?.underline || false
          }
          disabled={selectedElement?.type !== "text" || selectedElement.locked}
          onClick={() => toggleTextFormat("underline")}
        />
        <button
          className="toolbar-color"
          title="글자 색"
          aria-label="글자 색"
          data-text-format-trigger
          disabled={selectedElement?.type !== "text" || selectedElement.locked}
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
                : selectedElement?.color || "#233D35",
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
              const theme =
                THEMES.find((t) => t.id === deck.theme) || THEMES[0];
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
                  fill: theme.accent,
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
              <path d={preset.d} fill="currentColor" />
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
        disabled: !clipboard.current.elements && !clipboard.current.slide,
        run: pasteSelection,
      },
      { label: "복제", icon: <Copy size={16} />, run: duplicateSelected },
      {
        label: "삭제",
        icon: <Trash2 size={16} />,
        disabled: locked,
        run: removeSelected,
      },
    );
    if (selectedElement.type === "text")
      objectMenuActions.push({
        label: "글자 색",
        icon: <Type size={16} />,
        separator: true,
        disabled: locked,
        run: () => openTextColor(),
      });
    if (selected.length === 1 && selectedElement.type === "text")
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
                  ? "이 기기에 자동 저장되었습니다"
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
              title={`프로젝트 저장 ${shortcut("S")}`}
              onClick={() => void saveProject()}
            >
              <Save size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="실행 취소"
              title={`실행 취소 ${shortcut("Z")}`}
              disabled={!history.past.length}
              onClick={undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="다시 실행"
              title={`다시 실행 ${isMac ? "⇧⌘Z" : "Ctrl+Y"}`}
              disabled={!history.future.length}
              onClick={redo}
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
                label: "프로젝트 저장",
                hint: shortcut("S"),
                run: () => void saveProject(),
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
              {
                id: "export",
                label: "PPTX 내보내기",
                run: () => void exportDeck(),
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
              onClick={() => void exportDeck()}
            >
              <Download size={15} />
              PPTX 내보내기
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
                <button onClick={() => void saveProject()}>
                  <Save size={16} />
                  프로젝트 저장<span>{shortcut("S")}</span>
                </button>
                <button onClick={() => void exportDeck()}>
                  <FileDown size={16} />
                  PowerPoint (.pptx)
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
          className={`ribbon ${tab === "insert" ? "insert-ribbon" : ""}`}
          hidden={ribbonCollapsed}
        >
          {tab === "home" && (
            <>
              <div className="ribbon-group clipboard-group">
                <div className="tools-row">
                  <Tool
                    icon={<ClipboardPaste size={25} />}
                    disabled={
                      !clipboard.current.cells &&
                      !clipboard.current.elements &&
                      !clipboard.current.slide
                    }
                    onClick={pasteSelection}
                  >
                    붙여넣기
                  </Tool>
                  <div className="tools-stack">
                    <button
                      onClick={() => {
                        copySelection();
                        removeSelected();
                      }}
                      disabled={!selected.length}
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
                          : selectedElement?.align) === align
                      }
                      disabled={selectedElement?.type !== "text"}
                      onClick={() => setTextStyle("align", align)}
                    />
                  ))}
                </div>
                <button
                  className="ribbon-text-action"
                  disabled={selectedElement?.type !== "text"}
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
                        e.type === "text"
                          ? toggleTextBullets(e)
                          : e,
                      ),
                    }));
                  }}
                >
                  • 글머리 기호
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
                  className={`thumbnail-row ${s.id === slide.id ? "active" : ""} ${s.hidden ? "hidden-slide" : ""} ${dropSlide === i ? "drop-before" : ""}`}
                  draggable
                  onDragStart={(e) => {
                    setDragSlide(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", s.id);
                  }}
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
                    if (dragSlide !== null && dragSlide !== i)
                      commit((d) => ({
                        ...d,
                        slides: reorder(
                          d.slides,
                          dragSlide,
                          dragSlide < i ? i - 1 : i,
                        ),
                      }));
                    setDragSlide(null);
                    setDropSlide(null);
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
                    onClick={() => selectSlide(s.id)}
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
                    className={s.id === slide.id ? "chosen" : ""}
                    onClick={() => {
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
                    if (file) void addImage(file);
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
                        setSelected(selected.includes(id) ? selected : [id]);
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
                        preview((d) => ({
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
                        }))
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
              <div className="notes-pane">
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
              </div>
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
              {selectedElement && (
                <button
                  className="icon-button"
                  aria-label="선택 해제"
                  onClick={() => setSelected([])}
                >
                  <X size={14} />
                </button>
              )}
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
                              : "도형"}
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
                        onChange={(fill) => updateSelected({ fill })}
                      />
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={selectedElement.fill === "transparent"}
                          onChange={(e) =>
                            updateSelected({
                              fill: e.target.checked
                                ? "transparent"
                                : "#D4613F",
                            })
                          }
                        />
                        채우기 없음
                      </label>
                      <ColorField
                        label="선 색상"
                        value={selectedElement.stroke || "#233D35"}
                        onChange={(stroke) =>
                          updateSelected({
                            stroke,
                            strokeWidth: selectedElement.strokeWidth || 2,
                          })
                        }
                      />
                      <NumberField
                        label="선 두께"
                        key={selected.join(",")}
                        value={selectedElement.strokeWidth || 0}
                        min={0}
                        max={30}
                        onChange={(strokeWidth) =>
                          updateSelected({ strokeWidth })
                        }
                      />
                    </div>
                  )}
                  <div className="inspector-section">
                    <h4>슬라이드에 맞춰 정렬</h4>
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
                        changeSlide((s) => ({ ...s, background }))
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
                            changeSlide((s) => ({ ...s, background: color }))
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
                        <button key={id} onClick={() => addSlide(id)}>
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
                      선택한 레이아웃으로 새 슬라이드를 추가합니다.
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
                      ) : e.type === "image" ? (
                        <ImageIcon size={13} />
                      ) : (
                        <Square size={13} />
                      )}
                      <span>
                        {e.type === "text"
                          ? (e.text || "텍스트").split("\n")[0]
                          : e.type === "image"
                            ? e.alt || "이미지"
                            : "도형"}
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
                  el.id === tableEditId && !el.locked ? { ...el, table } : el,
                ),
              }));
              setModal(null);
            } else
              insertElements([
                createTableElement(table, deck.width, deck.height),
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
            commit((d) => applyFooters(d, slide.id, options, all));
            setModal(null);
          }}
        />
      )}
      {modal === "album" && (
        <PhotoAlbumDialog
          deck={deck}
          onCancel={() => setModal(null)}
          onInsert={(slides) => {
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
                deck={deck}
                notify={notify}
                onNew={() => setModal("new")}
                onOpen={(saved) =>
                  replaceDeck(parseDeckJson(JSON.stringify(saved)))
                }
              />
            ) : modal === "shortcuts" ? (
              <>
                <div className="dialog-eyebrow">MAKE IT FLOW</div>
                <h2>키보드 단축키</h2>
                <div className="shortcut-list">
                  {[
                    ["파일 저장", "⌘ / Ctrl + S"],
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
                <h2>슬라이드를 불러왔습니다</h2>
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
                  편집 시작하기
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {presenting && (
        <div
          className={`presentation-view ${blackout ? "blackout" : ""}`}
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
            blackout={blackout}
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
