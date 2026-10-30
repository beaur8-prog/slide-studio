export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "line"
  | "arrow"
  | "custom";
export interface TextRun {
  text: string;
  fontFamily?: string;
  fontFamilyEastAsian?: string;
  fontSize?: number;
  letterSpacing?: number;
  kerning?: number;
  language?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  hyperlink?: ElementLink;
  baseline?: number;
  opacity?: number;
}
export interface TextParagraph {
  level?: number;
  numbering?: { type: string; value: number };
  runs: TextRun[];
  // Imported list label, including its plain-text separator. Keep editable
  // text intact while painting the label in the paragraph's hanging indent.
  bulletPrefix?: string;
  align?: "left" | "center" | "right";
  fontSize?: number;
  lineHeight?: number;
  lineSpacing?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  marginLeft?: number;
  marginRight?: number;
  indent?: number;
  tabSize?: number;
  latinLineBreak?: boolean;
  eastAsianLineBreak?: boolean;
  hangingPunctuation?: boolean;
}
export interface ShapePath {
  d: string;
  width: number;
  height: number;
  fill: boolean;
  stroke: boolean;
  fillMode?: "norm" | "darken" | "darkenLess" | "lighten" | "lightenLess";
}
export interface TextBorder {
  opacity?: number;
  color: string;
  width: number;
}
export interface LineEnd {
  type: "none" | "triangle" | "stealth" | "diamond" | "oval" | "arrow";
  width: "sm" | "med" | "lg";
  length: "sm" | "med" | "lg";
}
export interface ElementLink {
  url?: string;
  slideId?: string;
}
export interface TableCellFormat {
  fillOpacity?: number;
  textOpacity?: number;
  strokeOpacity?: number;
  fill?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  paragraphs?: TextParagraph[];
  textInsets?: [number, number, number, number];
  borders?: [TextBorder, TextBorder, TextBorder, TextBorder];
  fontFamily?: string;
  fontSize?: number;
  padding?: number;
  borderColor?: string;
  borderWidth?: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
}
export interface TableData {
  cells: string[][];
  cellStyles?: (TableCellFormat | null)[][];
  header: boolean;
  striped: boolean;
  headerFill: string;
  headerColor: string;
  fill: string;
  stripeFill: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  fontFamily: string;
  fontSize: number;
  padding: number;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  // Relative sizes; resizing the element scales the table grid as a whole.
  columnWidths?: number[];
  rowHeights?: number[];
  merges?: {
    row: number;
    column: number;
    rowSpan: number;
    columnSpan: number;
  }[];
  autoRows?: boolean;
}
export interface GradientFill {
  kind: "linear" | "radial";
  angle: number;
  stops: { offset: number; color: string; opacity?: number }[];
}
export interface ObjectShadow {
  color: string;
  opacity: number;
  blur: number;
  dx: number;
  dy: number;
}
export interface ChartPart {
  path: string;
  contentType: string;
  data: string;
  relationships: {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[];
}
export interface ChartData {
  root: string;
  parts: ChartPart[];
  colors: Record<string, string>;
  fontFamily: string;
}
// Opaque source data is never rendered or executed. It is used only to carry
// unsupported native Office content through a subsequent PPTX save.
export interface PptxSourcePackage {
  id: string;
  deckId?: string;
  data: string;
  slides: { path: string; id: string }[];
  nodes: PptxSourceNode[];
}
export interface PptxSourceNode {
  part: string;
  index: number;
  count: number;
  signature: string;
  shapes?: string[];
  derived?: boolean;
}
export interface PptxSlideSource {
  source: string;
  path: string;
  nodes: PptxSourceNode[];
  background: string;
  transition: string;
  notes: string;
  nativeTransition?: boolean;
  transitionEdited?: boolean;
}
export interface SlideElement {
  id: string;
  pptxRef?: {
    source: string;
    part: string;
    index: number;
    shape: string;
    instance?: string;
    paint?: string;
    content?: string;
    playback?: string;
    text?: string;
    geometry?: [number, number, number, number];
  };
  name?: string;
  hidden?: boolean;
  // Outer group first. Coordinates remain in slide space for fast editing.
  groups?: string[];
  groupNames?: string[];
  groupHidden?: boolean[];
  type: "text" | "shape" | "image" | "table" | "video" | "audio" | "chart";
  table?: TableData;
  chart?: ChartData;
  hyperlink?: ElementLink;
  field?: "slideNumber" | "date" | "fixedDate" | "footer";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  fillOpacity?: number;
  strokeOpacity?: number;
  textOpacity?: number;
  locked?: boolean;
  text?: string;
  fontFamily?: string;
  fontFamilyEastAsian?: string;
  fontSize?: number;
  letterSpacing?: number;
  kerning?: number;
  language?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  autoHeight?: boolean;
  textColumns?: number;
  textColumnGap?: number;
  paragraphs?: TextParagraph[];
  textOverflow?: "visible" | "hidden";
  writingMode?: "horizontal" | "vertical" | "vertical270" | "stacked";
  textInsets?: [number, number, number, number];
  // Relative text rectangle inside the shape: left, top, width, height.
  textFrame?: [number, number, number, number];
  borders?: [TextBorder, TextBorder, TextBorder, TextBorder];
  paths?: ShapePath[];
  flipH?: boolean;
  flipV?: boolean;
  crop?: [number, number, number, number];
  shape?: ShapeKind;
  cornerRadius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDash?: number[];
  strokeCap?: "butt" | "round" | "square";
  gradient?: GradientFill;
  shadow?: ObjectShadow;
  lineStart?: LineEnd;
  lineEnd?: LineEnd;
  src?: string;
  poster?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  volume?: number;
  playAcrossSlides?: boolean;
  audioSlideCount?: number;
  hideDuringShow?: boolean;
  alt?: string;
}
export interface Slide {
  id: string;
  pptxSource?: PptxSlideSource;
  hidden?: boolean;
  background: string;
  backgroundGradient?: GradientFill;
  backgroundImage?: {
    src: string;
    crop?: [number, number, number, number];
    opacity?: number;
  };
  notes: string;
  elements: SlideElement[];
  transition: "none" | "fade";
}
export interface Deck {
  version: 1;
  pptxSources?: PptxSourcePackage[];
  pptxLosses?: string[];
  id: string;
  name: string;
  width: number;
  height: number;
  theme: string;
  slides: Slide[];
}
export interface ImportResult {
  deck: Deck;
  warnings: string[];
}
export interface RecentPresentationFile {
  id: string;
  name: string;
  path: string;
  lastUsedAt: number;
  available: boolean;
}
