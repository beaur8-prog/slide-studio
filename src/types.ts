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
  baseline?: number;
}
export interface TextParagraph {
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
}
export interface TextBorder {
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
export interface TableData {
  cells: string[][];
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
}
export interface SlideElement {
  id: string;
  type: "text" | "shape" | "image" | "table";
  table?: TableData;
  hyperlink?: ElementLink;
  field?: "slideNumber" | "date" | "fixedDate" | "footer";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
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
  paragraphs?: TextParagraph[];
  textOverflow?: "visible" | "hidden";
  writingMode?: "horizontal" | "vertical" | "vertical270" | "stacked";
  textInsets?: [number, number, number, number];
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
  lineStart?: LineEnd;
  lineEnd?: LineEnd;
  src?: string;
  alt?: string;
}
export interface Slide {
  id: string;
  hidden?: boolean;
  background: string;
  notes: string;
  elements: SlideElement[];
  transition: "none" | "fade";
}
export interface Deck {
  version: 1;
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
