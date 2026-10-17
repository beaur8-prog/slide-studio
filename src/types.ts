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
export interface SlideElement {
  id: string;
  type: "text" | "shape" | "image";
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
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  src?: string;
  alt?: string;
}
export interface Slide {
  id: string;
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
