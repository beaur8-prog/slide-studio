import { separateMasterThemes } from "./pptx-master-themes";
import {
  finalizeSource, preservationRequired, validatePptxRef, validateSlideSource,
  validateSources, writePreservedPptx,
} from "./pptx-preservation";
import { openPptxPackage, xmlDocument, resolvePart, checkZip } from "./pptx-package";
import { readGradient, writeGradient, validateGradient } from "./gradient";
import { presetGeometry } from "./drawing-presets";
import {
  safeVideo,
  videoMime,
  bytesDataUrl,
  MAX_VIDEO_BYTES,
  EMPTY_POSTER,
} from "./video";
import { readVideoPlayback, writeVideoPlayback } from "./pptx-video";
import { readAudioPlayback } from "./pptx-video";
import { audioMime, audioExtension, safeAudio, MAX_AUDIO_BYTES } from "./audio";
import { AUDIO_ICON } from "./audio-icon";
import { drawingTextFrame } from "./drawing-guides";
import { normalizeObjectAlpha, hslToRgb } from "./colors";
import { applyDrawingmlColorTransforms, linearToSrgb } from "./drawingml-color";
import { resolveThemeStyleReference, inheritDrawingmlLine } from "./drawingml-style";
import { readDrawingmlImageFill, unsupportedDrawingmlImageEffects } from "./chart-image";
import {
  record,
  stringValue,
  numberValue,
  booleanValue,
  enumValue,
  colorValue,
} from "./validation";
import { validateParagraphs } from "./text-validation";
import JSZip from "jszip";
import PptxGenJS from "pptxgenjs";
import type {
  Deck,
  ImportResult,
  LineEnd,
  ShapeKind,
  Slide,
  SlideElement,
  TextParagraph,
  TextRun,
  TableCellFormat,
} from "./types";
import { paragraphText } from "./text-layout";
import { drawingPaths } from "./drawing-path";
import { readTextBody } from "./pptx-text";
import { restoreLayoutXml } from "./pptx-export-layout";
import { inheritTableCellStyle, readTableDiagonalBorders, writeTableDiagonalBorders, tableDiagonalBordersMatch, fallbackTableDiagonalElements, resolveTableStyleReferences, defaultTableGridStyle } from "./pptx-table-style";
import { resolveTableRowHeights } from "./table-layout";
import { MAX_SLIDES, MAX_SLIDE_ELEMENTS, MAX_ELEMENTS } from "./document-limits";
import { writeBackgroundImage } from "./pptx-background";
import { writeGroups } from "./object-groups";
import { rasterMime } from "./image-editing";
import { safeSvgImage } from "./svg-image";
import { decodeEmbeddedImage } from "./import-image";
import { vectorKind } from "./vector-image";
import {
  writeObjectState,
  writeObjectLabels,
  readObjectState,
  compositeBorderNodes,
} from "./pptx-object-state";
import {
  importedField,
  preserveObjectLinks,
  restoreInsertFields,
} from "./pptx-insert-fields";
import {
  createTable,
  MAX_TABLE_ROWS,
  MAX_TABLE_COLUMNS,
  tableCellStyle,
  tableSizes,
  tableTextElements,
  validateTable,
} from "./table";
import { resolveDeckFields, validateElementLink } from "./insert-fields";
import { validateChart, chartBytes, readChartModel } from "./chart";
import { readChartPackage, writeCharts, writeChartThemes } from "./pptx-chart";
import { placeholder, inheritedShape, inheritedTransform } from "./pptx-placeholder";

// The editor uses CSS pixels. OOXML uses English Metric Units and PptxGenJS
// uses inches/points; keeping these conversions in one place avoids drift.
const EMU_PER_PX = 9525;
const PX_PER_INCH = 96;
const MAX_EXPANDED = 200 * 1024 * 1024;
const MAX_IMAGE = 16 * 1024 * 1024;
const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TABLE_NS = "urn:slide-studio:table:v1";
const SHAPES = new Set<ShapeKind>([
  "rect",
  "roundRect",
  "ellipse",
  "triangle",
  "line",
  "arrow",
  "custom",
]);
const uid = () => crypto.randomUUID();
function fail(message: string): never {
  throw new Error(message);
}
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function safeImage(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_IMAGE * 4) / 3) + 100
  )
    fail(`${label}: 이미지는 16 MB 이하의 내장 이미지여야 합니다.`);
  if (/^data:image\/svg\+xml;/i.test(value as string)) return safeSvgImage(value as string);
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      value as string,
    );
  if (!match || !match[2] || match[2].length % 4 !== 0)
    fail(`${label}: PNG, JPEG, GIF, WebP, SVG 데이터 URL만 지원합니다.`);
  // The full payload alphabet/padding and quartet length were checked above.
  // Preserve noncanonical pad bits accepted by atob; only the MIME header
  // needs decoding. Exact decoded size follows from quartet count and padding.
  let raw: string;
  try {
    raw = atob(match![2].slice(0, 24));
  } catch {
    return fail(`${label}: 잘못된 이미지 데이터입니다.`);
  }
  if (
    (match![2].length / 4) * 3 -
      (match![2].endsWith("==") ? 2 : match![2].endsWith("=") ? 1 : 0) >
      MAX_IMAGE ||
    rasterMime(Uint8Array.from(raw.slice(0, 12), (c) => c.charCodeAt(0))) !==
      match![1].toLowerCase()
  )
    fail(`${label}: 이미지 형식과 데이터가 일치하지 않습니다.`);
  const prefix = `data:${match![1].toLowerCase()};base64,`;
  return (value as string).startsWith(prefix) ? value as string : prefix + match![2];
}

function validateBackgroundImage(value: unknown, label: string): NonNullable<Slide["backgroundImage"]> {
  const source = record(value, `${label} 그림 배경`);
  const result: NonNullable<Slide["backgroundImage"]> = { src: safeImage(source.src, label) };
  if (source.opacity !== undefined)
    result.opacity = numberValue(source.opacity, `${label} 배경 불투명도`, 0, 1);
  if (source.crop !== undefined) {
    if (!Array.isArray(source.crop) || source.crop.length !== 4) fail(`${label}: 잘못된 배경 자르기 범위`);
    result.crop = source.crop.map((v: unknown) => numberValue(v, `${label} 배경 자르기`, -10, 10)) as [number, number, number, number];
    if (result.crop[0] + result.crop[2] >= 0.999 || result.crop[1] + result.crop[3] >= 0.999)
      fail(`${label}: 배경 자르기 범위가 잘못되었습니다.`);
  }
  if (source.placement !== undefined) {
    const placement = record(source.placement, `${label} 그림 배치`);
    const width = numberValue(placement.width, `${label} 그림 폭`, 1, 32768);
    const height = numberValue(placement.height, `${label} 그림 높이`, 1, 32768);
    if (width * height > 16000000) fail(`${label}: 배경 이미지 해상도가 너무 큽니다.`);
    if (!Array.isArray(placement.fill) || placement.fill.length !== 4)
      fail(`${label}: 잘못된 배경 채우기 범위`);
    const fill = placement.fill.map((v: unknown) => numberValue(v, `${label} 배경 채우기`, -10, 10)) as [number,number,number,number];
    if (fill[0] + fill[2] >= 0.999 || fill[1] + fill[3] >= 0.999)
      fail(`${label}: 배경 채우기 범위가 잘못되었습니다.`);
    result.placement = { width, height, dpi: numberValue(placement.dpi, `${label} 그림 DPI`, 0.001, 10000), fill };
    if (placement.duotone !== undefined) {
      const duotone = record(placement.duotone, `${label} 그림 이중톤`);
      if (!Array.isArray(duotone.colors) || duotone.colors.length !== 2 ||
          !duotone.colors.every((color: unknown) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) ||
          !Array.isArray(duotone.opacities) || duotone.opacities.length !== 2)
        fail(`${label}: 잘못된 그림 이중톤`);
      result.placement.duotone = {
        colors: duotone.colors.map((color: string) => color.toUpperCase()) as [string, string],
        opacities: duotone.opacities.map((alpha: unknown) => numberValue(alpha, `${label} 이중톤 불투명도`, 0, 1)) as [number, number],
      };
    }
    if (placement.tile !== undefined) {
      const tile = record(placement.tile, `${label} 그림 반복`);
      result.placement.tile = {
        scaleX: numberValue(tile.scaleX, `${label} 반복 가로 배율`, 0.001, 1000),
        scaleY: numberValue(tile.scaleY, `${label} 반복 세로 배율`, 0.001, 1000),
        offsetX: numberValue(tile.offsetX, `${label} 반복 가로 위치`, -1000000, 1000000),
        offsetY: numberValue(tile.offsetY, `${label} 반복 세로 위치`, -1000000, 1000000),
        align: enumValue(tile.align, ["tl","t","tr","l","ctr","r","bl","b","br"] as const, `${label} 반복 맞춤`),
        flip: enumValue(tile.flip, ["none","x","y","xy"] as const, `${label} 반복 반전`),
      };
    }
  }
  return result;
}

export function parseDeckJson(text: string): Deck {
  if (text.length > MAX_EXPANDED)
    fail("프로젝트 파일이 너무 큽니다 (최대 200 MB).");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return fail("프로젝트 JSON을 읽을 수 없습니다. 파일 형식을 확인하세요.");
  }
  return validateDeck(input);
}

// Count the exact compact JSON length without building one huge Unicode
// string containing every embedded image. Individual fields are already
// validated; base64/path strings need no escaping and can be counted directly.
function jsonLength(value: unknown, maximum: number): number {
  if (value === null) return 4;
  if (typeof value === "string") return /[\x00-\x1f"\\\ud800-\udfff]/.test(value)
    ? JSON.stringify(value).length : value.length + 2;
  if (typeof value === "number" || typeof value === "boolean") return String(value).length;
  let total = 2;
  if (Array.isArray(value)) {
    total += Math.max(0, value.length - 1);
    for (const item of value) {
      total += item === undefined ? 4 : jsonLength(item, maximum - total);
      if (total > maximum) return total;
    }
  } else if (value && typeof value === "object") {
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      total += (count++ ? 1 : 0) + JSON.stringify(key).length + 1 + jsonLength(item, maximum - total);
      if (total > maximum) return total;
    }
  }
  return total;
}

/** Validate and copy only known fields, sharing immutable media strings. This
 * is the same boundary used by legacy JSON files and by native PPTX I/O. */
export function validateDeck(input: unknown): Deck {
  const root = record(input, "프로젝트");
  if (root.version !== 1) fail("지원하지 않는 프로젝트 버전입니다.");
  if (
    !Array.isArray(root.slides) ||
    root.slides.length < 1 ||
    root.slides.length > MAX_SLIDES
  )
    fail(`슬라이드는 1–${MAX_SLIDES}장이어야 합니다.`);
  let elementCount = 0;
  let imageBytes = 0;
  const slideIds = new Set<string>();
  const deck: Deck = {
    version: 1,
    ...(root.pptxSources !== undefined
      ? {pptxSources: validateSources(root.pptxSources)} : {}),
    ...(root.pptxLosses !== undefined ? {pptxLosses: (() => {
      if (!Array.isArray(root.pptxLosses) || root.pptxLosses.length > 100)
        fail("잘못된 PPTX 저장 안내입니다.");
      return root.pptxLosses.map(v => stringValue(v, "PPTX 저장 안내", 2000, false));
    })()} : {}),
    id: stringValue(root.id, "프로젝트 ID", 160, false),
    name: stringValue(root.name, "프로젝트 이름", 500, false),
    width: numberValue(root.width, "슬라이드 너비", 100, 10000),
    height: numberValue(root.height, "슬라이드 높이", 100, 10000),
    theme: stringValue(root.theme, "테마", 160),
    slides: root.slides.map((item, index): Slide => {
      const label = `슬라이드 ${index + 1}`;
      const slide = record(item, label);
      const id = stringValue(slide.id, `${label} ID`, 160, false);
      if (slideIds.has(id)) fail("슬라이드 ID가 중복되어 있습니다.");
      slideIds.add(id);
      if (!Array.isArray(slide.elements) || slide.elements.length > MAX_SLIDE_ELEMENTS)
        fail(`${label}: 개체는 1,000개 이하여야 합니다.`);
      elementCount += slide.elements.length;
      if (elementCount > MAX_ELEMENTS)
        fail(
          `프로젝트 개체는 ${MAX_ELEMENTS.toLocaleString()}개 이하여야 합니다.`,
        );
      const elementIds = new Set<string>();
      const backgroundImage = slide.backgroundImage === undefined
        ? undefined : validateBackgroundImage(slide.backgroundImage, label);
      if (backgroundImage) {
        imageBytes += backgroundImage.src.length * 0.75;
        if (imageBytes > MAX_EXPANDED / 2) fail("내장 이미지·배경의 합계가 100 MB를 초과합니다.");
      }
      return {
        id,
        ...(slide.pptxSource !== undefined ? {pptxSource:validateSlideSource(slide.pptxSource)} : {}),
        ...(slide.hidden !== undefined
          ? { hidden: booleanValue(slide.hidden, `${label} 숨김`) }
          : {}),
        background: colorValue(slide.background, `${label} 배경`),
        ...(slide.backgroundGradient !== undefined
          ? { backgroundGradient: validateGradient(slide.backgroundGradient) }
          : {}),
        ...(backgroundImage ? { backgroundImage } : {}),
        notes: stringValue(slide.notes, `${label} 발표 노트`, 500000),
        transition: enumValue(
          slide.transition,
          ["none", "fade"],
          `${label} 전환`,
        ),
        elements: slide.elements.map((raw, elementIndex): SlideElement => {
          const elLabel = `${label} 개체 ${elementIndex + 1}`;
          const source = record(raw, elLabel);
          const el: SlideElement = {
            id: stringValue(source.id, `${elLabel} ID`, 160, false),
            type: enumValue(
              source.type,
              ["text", "shape", "image", "table", "video", "audio", "chart"],
              `${elLabel} 종류`,
            ),
            x: numberValue(source.x, `${elLabel} X`, -100000, 100000),
            y: numberValue(source.y, `${elLabel} Y`, -100000, 100000),
            width: numberValue(source.width, `${elLabel} 너비`, 0, 100000),
            height: numberValue(source.height, `${elLabel} 높이`, 0, 100000),
            rotation: numberValue(
              source.rotation,
              `${elLabel} 회전`,
              -360000,
              360000,
            ),
            opacity: numberValue(source.opacity, `${elLabel} 불투명도`, 0, 1),
          };
          if (source.pptxRef !== undefined) el.pptxRef = validatePptxRef(source.pptxRef);
          if (elementIds.has(el.id))
            fail(`${label}: 개체 ID가 중복되어 있습니다.`);
          elementIds.add(el.id);
          if (source.name !== undefined) el.name = stringValue(source.name, `${elLabel} 이름`, 160, false);
          if (source.hidden !== undefined) el.hidden = booleanValue(source.hidden, `${elLabel} 숨김`);
          for (const key of [
            "fillOpacity",
            "strokeOpacity",
            "textOpacity",
          ] as const)
            if (source[key] !== undefined)
              el[key] = numberValue(source[key], elLabel, 0, 1);
          if (source.gradient !== undefined)
            el.gradient = validateGradient(source.gradient);
          if (source.shadow !== undefined) {
            const v = record(source.shadow, elLabel);
            el.shadow = {
              color: colorValue(v.color, elLabel),
              opacity: numberValue(v.opacity, elLabel, 0, 1),
              blur: numberValue(v.blur, elLabel, 0, 10000),
              dx: numberValue(v.dx, elLabel, -100000, 100000),
              dy: numberValue(v.dy, elLabel, -100000, 100000),
            };
          }
          if (source.strokeDash !== undefined) {
            if (
              !Array.isArray(source.strokeDash) ||
              !source.strokeDash.length ||
              source.strokeDash.length > 32
            )
              fail("잘못된 점선 간격");
            el.strokeDash = source.strokeDash.map((v: unknown) =>
              numberValue(v, elLabel, 0.01, 100000),
            );
          }
          if (source.strokeCap !== undefined)
            el.strokeCap = enumValue(
              source.strokeCap,
              ["butt", "round", "square"] as const,
              elLabel,
            );
          if (source.groups !== undefined) {
            if (
              !Array.isArray(source.groups) ||
              source.groups.length > 30 ||
              new Set(source.groups).size !== source.groups.length
            )
              fail(`${elLabel}: 잘못된 그룹 계층`);
            el.groups = source.groups.map((id: unknown) =>
              stringValue(id, `${elLabel} 그룹`, 160, false),
            );
          }
          for (const key of ["groupNames", "groupHidden"] as const) {
            if (source[key] === undefined) continue;
            if (!Array.isArray(source[key]) || source[key].length !== (el.groups?.length ?? 0)) fail(`${elLabel}: 그룹 정보가 계층과 일치하지 않습니다.`);
            if (key === "groupNames") el.groupNames = source[key].map(value => stringValue(value, `${elLabel} 그룹 이름`, 160));
            else el.groupHidden = source[key].map(value => booleanValue(value, `${elLabel} 그룹 숨김`));
          }
          if (el.type === "table") {
            el.table = validateTable(source.table);
            elementCount += el.table.cells.length * el.table.cells[0].length;
            if (elementCount > MAX_ELEMENTS)
              fail("표 셀을 포함한 프로젝트 개체 수가 10,000개를 초과합니다.");
          }
          if (el.type === "chart") {
            el.chart = validateChart(source.chart);
            imageBytes += chartBytes(el.chart);
            if (imageBytes > MAX_EXPANDED / 2) fail("내장 차트·이미지·동영상 합계가 100 MB를 초과합니다.");
          }
          if (source.textFrame !== undefined) {
            if (
              !Array.isArray(source.textFrame) ||
              source.textFrame.length !== 4
            )
              fail("잘못된 도형 텍스트 영역");
            el.textFrame = source.textFrame.map((v: unknown) =>
              numberValue(v, elLabel, -10, 10),
            ) as SlideElement["textFrame"];
            if (el.textFrame![2] <= 0 || el.textFrame![3] <= 0)
              fail("도형 텍스트 영역의 너비와 높이는 양수여야 합니다.");
          }
          if (source.textRotation !== undefined)
            el.textRotation = numberValue(source.textRotation, `${elLabel} 텍스트 회전`, -36000, 36000);
          if (source.hyperlink !== undefined)
            el.hyperlink = validateElementLink(source.hyperlink);
          if (source.field !== undefined)
            el.field = enumValue(
              source.field,
              ["slideNumber", "date", "fixedDate", "footer"] as const,
              `${elLabel} 필드`,
            );
          if (source.locked !== undefined)
            el.locked = booleanValue(source.locked, `${elLabel} 잠금`);
          if (source.text !== undefined)
            el.text = stringValue(source.text, `${elLabel} 텍스트`);
          if (source.fontFamily !== undefined)
            el.fontFamily = stringValue(
              source.fontFamily,
              `${elLabel} 글꼴`,
              200,
              false,
            );
          if (source.fontSize !== undefined)
            el.fontSize = numberValue(
              source.fontSize,
              `${elLabel} 글자 크기`,
              1,
              1000,
            );
          if (source.fontFamilyEastAsian !== undefined)
            el.fontFamilyEastAsian = stringValue(
              source.fontFamilyEastAsian,
              elLabel,
              200,
              false,
            );
          if (source.language !== undefined)
            el.language = stringValue(source.language, elLabel, 80, false);
          if (source.letterSpacing !== undefined)
            el.letterSpacing = numberValue(
              source.letterSpacing,
              elLabel,
              -1000,
              1000,
            );
          if (source.kerning !== undefined)
            el.kerning = numberValue(source.kerning, elLabel, 0, 10000);
          if (source.bold !== undefined)
            el.bold = booleanValue(source.bold, `${elLabel} 굵게`);
          if (source.italic !== undefined)
            el.italic = booleanValue(source.italic, `${elLabel} 기울임`);
          if (source.underline !== undefined)
            el.underline = booleanValue(source.underline, `${elLabel} 밑줄`);
          if (source.color !== undefined)
            el.color = colorValue(source.color, `${elLabel} 글자색`);
          if (source.align !== undefined)
            el.align = enumValue(
              source.align,
              ["left", "center", "right"] as const,
              `${elLabel} 정렬`,
            );
          if (source.verticalAlign !== undefined)
            el.verticalAlign = enumValue(
              source.verticalAlign,
              ["top", "middle", "bottom"] as const,
              `${elLabel} 세로 정렬`,
            );
          if (source.wrap !== undefined)
            el.wrap = booleanValue(source.wrap, `${elLabel} 자동 줄바꿈`);
          if (source.autoHeight !== undefined)
            el.autoHeight = booleanValue(
              source.autoHeight,
              `${elLabel} 자동 높이`,
            );
          if (source.textColumns !== undefined) {
            el.textColumns = numberValue(
              source.textColumns,
              `${elLabel} 텍스트 단 수`,
              1,
              16,
            );
            if (!Number.isInteger(el.textColumns))
              fail(`${elLabel}: 텍스트 단 수는 정수여야 합니다.`);
          }
          if (source.textColumnGap !== undefined)
            el.textColumnGap = numberValue(
              source.textColumnGap,
              `${elLabel} 텍스트 단 간격`,
              0,
              100000,
            );
          if (source.textOverflow !== undefined)
            el.textOverflow = enumValue(
              source.textOverflow,
              ["visible", "hidden"] as const,
              `${elLabel} 텍스트 넘침`,
            );
          if (source.writingMode !== undefined)
            el.writingMode = enumValue(
              source.writingMode,
              ["horizontal", "vertical", "vertical270", "stacked"] as const,
              `${elLabel} 쓰기 방향`,
            );
          for (const key of ["flipH", "flipV"] as const)
            if (source[key] !== undefined)
              el[key] = booleanValue(source[key], `${elLabel} 뒤집기`);
          for (const key of ["lineStart", "lineEnd"] as const) {
            if (source[key] === undefined) continue;
            const marker = source[key];
            if (!marker || typeof marker !== "object" || Array.isArray(marker))
              fail(`${elLabel}: 잘못된 선 끝 모양`);
            const value = marker as Record<string, unknown>;
            el[key] = {
              type: enumValue(
                value.type,
                [
                  "none",
                  "triangle",
                  "stealth",
                  "diamond",
                  "oval",
                  "arrow",
                ] as const,
                elLabel,
              ),
              width: enumValue(
                value.width,
                ["sm", "med", "lg"] as const,
                elLabel,
              ),
              length: enumValue(
                value.length,
                ["sm", "med", "lg"] as const,
                elLabel,
              ),
            };
          }
          for (const key of ["crop", "textInsets"] as const) {
            if (source[key] === undefined) continue;
            if (!Array.isArray(source[key]) || source[key].length !== 4)
              fail(`${elLabel}: 잘못된 여백`);
            el[key] = source[key].map((v: unknown) =>
              numberValue(
                v,
                `${elLabel} 여백`,
                key === "crop" ? -10 : 0,
                key === "crop" ? 10 : 10000,
              ),
            ) as [number, number, number, number];
          }
          if (
            el.crop &&
            (el.crop[0] + el.crop[2] >= 0.999 ||
              el.crop[1] + el.crop[3] >= 0.999)
          )
            fail(`${elLabel}: 이미지 자르기 범위가 잘못되었습니다.`);
          if (source.borders !== undefined) {
            if (!Array.isArray(source.borders) || source.borders.length !== 4)
              fail(`${elLabel}: 잘못된 테두리`);
            el.borders = source.borders.map((value: unknown) => {
              const b = record(value, elLabel);
              return {
                color: colorValue(b.color, elLabel, true),
                width: numberValue(b.width, elLabel, 0, 1000),
                ...(b.opacity !== undefined
                  ? { opacity: numberValue(b.opacity, elLabel, 0, 1) }
                  : {}),
              };
            }) as NonNullable<SlideElement["borders"]>;
          }
          if (source.paragraphs !== undefined)
            el.paragraphs = validateParagraphs(
              source.paragraphs,
              el.text ?? "",
              elLabel,
            );
          if (source.paths !== undefined) {
            if (!Array.isArray(source.paths) || source.paths.length > 100)
              fail(`${elLabel}: 경로 수가 너무 많습니다.`);
            el.paths = source.paths.map((value: unknown) => {
              const p = record(value, elLabel),
                d = stringValue(p.d, elLabel, 200000, false);
              if (!/^[MLCQAZ0-9eE+.,\s-]+$/.test(d))
                fail(`${elLabel}: 지원하지 않는 도형 경로입니다.`);
              if (
                (d.match(/[MLCQAZ]/gi)?.length ?? 0) > 10000 ||
                (d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? []).some(
                  (n) =>
                    !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 1e12,
                )
              )
                fail(`${elLabel}: 경로 범위를 초과했습니다.`);
              return {
                d,
                width: numberValue(p.width, elLabel, 0.0001, 1e12),
                height: numberValue(p.height, elLabel, 0.0001, 1e12),
                fill: booleanValue(p.fill, elLabel),
                stroke: booleanValue(p.stroke, elLabel),
                ...(p.fillMode !== undefined
                  ? {
                      fillMode: enumValue(
                        p.fillMode,
                        [
                          "norm",
                          "darken",
                          "darkenLess",
                          "lighten",
                          "lightenLess",
                        ] as const,
                        elLabel,
                      ),
                    }
                  : {}),
              };
            });
          }
          if (source.fill !== undefined)
            el.fill = colorValue(source.fill, `${elLabel} 채우기`, true);
          if (source.stroke !== undefined)
            el.stroke = colorValue(source.stroke, `${elLabel} 윤곽선`, true);
          if (source.strokeWidth !== undefined)
            el.strokeWidth = numberValue(
              source.strokeWidth,
              `${elLabel} 선 두께`,
              0,
              1000,
            );
          if (source.shape !== undefined)
            el.shape = enumValue(source.shape, [...SHAPES], `${elLabel} 도형`);
          if (source.cornerRadius !== undefined)
            el.cornerRadius = numberValue(
              source.cornerRadius,
              `${elLabel} 모서리 반경`,
              0,
              100000,
            );
          if (source.alt !== undefined)
            el.alt = stringValue(source.alt, `${elLabel} 대체 텍스트`, 10000);
          if (el.type === "text" && el.text === undefined)
            fail(`${elLabel}: 텍스트가 없습니다.`);
          if (el.type === "shape" && !el.shape)
            fail(`${elLabel}: 도형 종류가 없습니다.`);
          if (el.type === "shape" && el.shape === "custom" && !el.paths?.length)
            fail(`${elLabel}: 사용자 도형 경로가 없습니다.`);
          if (el.type === "image") {
            el.src = safeImage(source.src, elLabel);
            imageBytes += el.src.length * 0.75;
            if (imageBytes > MAX_EXPANDED / 2)
              fail("내장 이미지의 합계가 100 MB를 초과합니다.");
          }
          if (el.type === "video") {
            el.src = safeVideo(source.src);
            el.poster =
              source.poster === undefined
                ? EMPTY_POSTER
                : safeImage(source.poster, elLabel);
            for (const key of ["autoPlay", "loop", "muted"] as const)
              el[key] =
                source[key] === undefined
                  ? true
                  : booleanValue(source[key], elLabel);
            imageBytes += (el.src.length + el.poster.length) * 0.75;
            if (imageBytes > MAX_EXPANDED / 2)
              fail("내장 이미지·동영상의 합계가 100 MB를 초과합니다.");
          }
          if (el.type === "audio") {
            el.src = safeAudio(source.src);
            el.poster = source.poster === undefined ? AUDIO_ICON : safeImage(source.poster, elLabel);
            el.autoPlay = source.autoPlay === undefined ? true : booleanValue(source.autoPlay, elLabel);
            for (const key of ["loop", "muted", "playAcrossSlides", "hideDuringShow"] as const)
              el[key] = source[key] === undefined ? false : booleanValue(source[key], elLabel);
            el.volume = source.volume === undefined ? 1 : numberValue(source.volume, elLabel, 0, 1);
            if (source.audioSlideCount !== undefined) {
              el.audioSlideCount = numberValue(source.audioSlideCount, elLabel, 1, 999);
              if (!Number.isInteger(el.audioSlideCount)) fail(`${elLabel}: 재생할 슬라이드 수는 정수여야 합니다.`);
            }
            imageBytes += (el.src.length + el.poster.length) * 0.75;
            if (imageBytes > MAX_EXPANDED / 2) fail("내장 그림·오디오·동영상·차트의 합계가 100 MB를 초과합니다.");
          }
          // DrawingML permits collapsed shapes (for example a stroked custom
          // path with cy=0). Keep their exact bounds instead of rejecting the
          // entire presentation or inflating invisible decoration into a box.
          if (el.type !== "shape" && (!el.width || !el.height))
            fail(`${elLabel}: 너비와 높이는 0보다 커야 합니다.`);
          return el;
        }),
      };
    }),
  };
  const usedSources = new Set<string>();
  for (const slide of deck.slides) {
    if (slide.pptxSource) usedSources.add(slide.pptxSource.source);
    for (const e of slide.elements) if (e.pptxRef) usedSources.add(e.pptxRef.source);
  }
  if (usedSources.size) {
    const available = new Set(deck.pptxSources?.map(s => s.id));
    for (const id of usedSources)
      if (!available.has(id)) fail("원본 PPTX 보존 데이터가 누락되었습니다.");
    deck.pptxSources = deck.pptxSources!.filter(s => usedSources.has(s.id));
  } else delete deck.pptxSources;
  if (jsonLength(deck, MAX_EXPANDED) > MAX_EXPANDED)
    fail("프로젝트 파일이 너무 큽니다 (최대 200 MB).");
  return deck;
}

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(
    validateDeck(resolveDeckFields(deck)),
    null,
    2,
  );
}

const hex = (color: string | undefined, fallback: string) =>
  color && color !== "transparent" ? color.replace(/^#/, "") : fallback;

function restoreTableXml(doc: Document, elements: SlideElement[]) {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  for (const element of elements) {
    if (element.type !== "table" || !element.table) continue;
    const nonVisual = all(doc, "cNvPr").find(
      (node) => node.getAttribute("name") === element.id,
    );
    const frame = nonVisual?.parentElement?.parentElement;
    const table = frame && first(frame, "tbl");
    if (!frame || !table || !nonVisual) continue;
    const data = element.table;
    const { cells, columnWidths, rowHeights, ...style } = data;
    const extensions = doc.createElementNS(A, "a:extLst");
    const extension = doc.createElementNS(A, "a:ext");
    extension.setAttribute("uri", "{F30B672B-58DD-4794-8C8B-B397C176F98D}");
    const metadata = doc.createElementNS(TABLE_NS, "ss:table");
    metadata.textContent = JSON.stringify({
      version: 1,
      style,
      opacity: element.opacity,
    });
    extension.appendChild(metadata);
    extensions.appendChild(extension);
    nonVisual.appendChild(extensions);
    const transform = child(frame, "xfrm");
    transform?.setAttribute(
      "rot",
      String(Math.round(element.rotation * 60000)),
    );
    const extent = child(transform, "ext");
    extent?.setAttribute("cx", String(Math.round(element.width * EMU_PER_PX)));
    extent?.setAttribute("cy", String(Math.round(element.height * EMU_PER_PX)));
    const widths = tableSizes(
      columnWidths,
      cells[0].length,
      element.width * EMU_PER_PX,
    );
    children(child(table, "tblGrid"), "gridCol").forEach((col, i) =>
      col.setAttribute("w", String(Math.round(widths[i]))),
    );
    const heights = tableSizes(
      rowHeights,
      cells.length,
      element.height * EMU_PER_PX,
    );
    children(table, "tr").forEach((row, i) =>
      row.setAttribute("h", String(Math.round(heights[i]))),
    );
    const props = child(table, "tblPr");
    props?.setAttribute("firstRow", data.header ? "1" : "0");
    props?.setAttribute("bandRow", data.striped ? "1" : "0");
    children(table, "tr").forEach((row, r) =>
      children(row, "tc").forEach((cell, c) => {
        const merge = data.merges?.find(
          (m) =>
            r >= m.row &&
            r < m.row + m.rowSpan &&
            c >= m.column &&
            c < m.column + m.columnSpan,
        );
        if (merge) {
          if (r === merge.row && c === merge.column) {
            if (merge.rowSpan > 1)
              cell.setAttribute("rowSpan", String(merge.rowSpan));
            if (merge.columnSpan > 1)
              cell.setAttribute("gridSpan", String(merge.columnSpan));
          } else {
            if (r === merge.row && merge.rowSpan > 1)
              cell.setAttribute("rowSpan", String(merge.rowSpan));
            if (c === merge.column && merge.columnSpan > 1)
              cell.setAttribute("gridSpan", String(merge.columnSpan));
            if (r > merge.row) cell.setAttribute("vMerge", "1");
            if (c > merge.column) cell.setAttribute("hMerge", "1");
          }
        }
        const style = tableCellStyle(data, r, c),
          body = child(cell, "txBody"),
          cp = child(cell, "tcPr");
        // PptxGenJS omits the insertion style of empty cells. Emit a native
        // empty run so typing after reopening keeps the cell's font/color.
        if (body && (style.paragraphs || !cells[r][c])) {
          const P =
            "http://schemas.openxmlformats.org/presentationml/2006/main";
          const temporary = doc.implementation.createDocument(P, "p:sp"),
            root = temporary.documentElement;
          const nv = temporary.createElementNS(P, "p:nvSpPr"),
            named = temporary.createElementNS(P, "p:cNvPr");
          const name = `cell-${r}-${c}`;
          named.setAttribute("name", name);
          nv.append(named);
          root.append(nv, temporary.importNode(body, true));
          restoreLayoutXml(temporary, [
            {
              id: name,
              type: "text",
              text: cells[r][c],
              paragraphs: style.paragraphs ?? [
                { align: style.align, runs: [{ text: "" }] },
              ],
              x: 0,
              y: 0,
              width: widths[c] / EMU_PER_PX,
              height: heights[r] / EMU_PER_PX,
              rotation: 0,
              opacity: element.opacity,
              textOpacity: style.textOpacity,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              bold: style.bold,
              italic: style.italic,
              underline: style.underline,
              color: style.color,
              align: style.align,
              writingMode: style.writingMode,
              textInsets: style.textInsets ?? [
                style.padding,
                style.padding,
                style.padding,
                style.padding,
              ],
              wrap: true,
            },
          ]);
          body.replaceWith(doc.importNode(child(root, "txBody")!, true));
        }
        if (cp) cp.setAttribute("vert", style.writingMode === "vertical" ? "vert" : style.writingMode === "vertical270" ? "vert270" : style.writingMode === "stacked" ? "eaVert" : "horz");
        if (cp && style.textInsets)
          ["marT", "marR", "marB", "marL"].forEach((key, i) =>
            cp.setAttribute(
              key,
              String(Math.round(style.textInsets![i] * EMU_PER_PX)),
            ),
          );
        if (cp && style.fill === "transparent") {
          for (const node of Array.from(cp.children))
            if (["noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"].includes(node.localName)) node.remove();
          cp.append(doc.createElementNS(A, "a:noFill"));
        }
        if (cp && style.borders)
          ["T", "R", "B", "L"].forEach((side, i) => {
            child(cp, "ln" + side)?.remove();
            const border = style.borders![i],
              line = doc.createElementNS(A, "a:ln" + side);
            line.setAttribute(
              "w",
              String(Math.round(border.width * EMU_PER_PX)),
            );
            const fill = doc.createElementNS(
              A,
              border.color === "transparent" || !border.width
                ? "a:noFill"
                : "a:solidFill",
            );
            if (fill.localName === "solidFill") {
              const color = doc.createElementNS(A, "a:srgbClr");
              color.setAttribute("val", border.color.replace("#", ""));
              fill.append(color);
            }
            line.append(fill);
            cp.append(line);
          });
        if (cp)
          writeTableDiagonalBorders(doc, cp, style.diagonalBorders, element.opacity, style.strokeOpacity);
        if (cp) {
          // CT_TableCellProperties orders borders before its single fill.
          // Appending replacement lines after the fill produces invalid OOXML.
          const order = ["lnL", "lnR", "lnT", "lnB", "lnTlToBr", "lnBlToTr", "cell3D", "noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill", "headers", "extLst"];
          const rank = (node: Element) => {
            const i = order.indexOf(node.localName);
            return i < 0 ? order.length : i;
          };
          Array.from(cp.children).sort((a, b) => rank(a) - rank(b)).forEach(node => cp.append(node));
        }
      }),
    );
    children(table, "tr").forEach((row, r) =>
      children(row, "tc").forEach((cell, c) => {
        const style = tableCellStyle(data, r, c),
          cp = child(cell, "tcPr"),
          body = child(cell, "txBody");
        const alpha = (container: Element | undefined, opacity: number) => {
          if (!container) return;
          for (const color of all(container, "srgbClr")) {
            child(color, "alpha")?.remove();
            if (opacity !== 1) {
              const a = doc.createElementNS(A, "a:alpha");
              a.setAttribute("val", String(Math.round(opacity * 100000)));
              color.append(a);
            }
          }
        };
        alpha(child(cp, "solidFill"), element.opacity * style.fillOpacity);
        ["T", "R", "B", "L"].forEach((side, i) =>
          alpha(
            child(cp, "ln" + side),
            element.opacity *
              (style.borders?.[i]?.opacity ?? style.strokeOpacity),
          ),
        );
        if (!style.paragraphs) alpha(body, element.opacity * style.textOpacity);
      }),
    );
  }
}

/** Produce actual editable DrawingML objects, not screenshots of the slide. */
export async function exportPptx(input: Deck, options: {onWarning?: (message:string) => void} = {}): Promise<Uint8Array> {
  const deck = validateDeck(resolveDeckFields(input));
  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: "SLIDE_STUDIO",
    width: deck.width / PX_PER_INCH,
    height: deck.height / PX_PER_INCH,
  });
  pptx.layout = "SLIDE_STUDIO";
  pptx.author = "Slide Studio";
  pptx.subject = "Editable presentation";
  pptx.title = deck.name;
  pptx.company = "Slide Studio";
  pptx.theme = { headFontFace: "Arial", bodyFontFace: "Arial" };
  const backgroundNames = deck.slides.map(() => uid());
  for (const [slideIndex, source] of deck.slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(source.background, "FFFFFF") };
    if (source.backgroundImage)
      slide.addImage({ data: source.backgroundImage.src, x: 0, y: 0, w: deck.width / 96, h: deck.height / 96, objectName: backgroundNames[slideIndex] });
    if (source.notes) slide.addNotes(source.notes);
    for (const el of source.elements) {
      const linkedSlide = el.hyperlink?.slideId
        ? deck.slides.findIndex((slide) => slide.id === el.hyperlink!.slideId)
        : -1;
      const hyperlink = el.hyperlink?.url
        ? { url: el.hyperlink.url }
        : linkedSlide >= 0
          ? { slide: linkedSlide + 1 }
          : undefined;
      const box = {
        x: el.x / 96,
        y: el.y / 96,
        w: el.width / 96,
        h: el.height / 96,
        rotate: ((el.rotation % 360) + 360) % 360,
        ...(hyperlink ? { hyperlink } : {}),
      };
      const transparency = (1 - el.opacity) * 100;
      const line: PptxGenJS.ShapeLineProps = {
        color: hex(el.stroke, "000000"),
        width: (el.strokeWidth ?? 0) * 0.75,
        transparency:
          el.stroke === "transparent" || !el.stroke || !el.strokeWidth
            ? 100
            : (1 - el.opacity * (el.strokeOpacity ?? 1)) * 100,
      };
      const fill: PptxGenJS.ShapeFillProps = {
        color: hex(el.fill, "FFFFFF"),
        transparency:
          !el.fill || el.fill === "transparent"
            ? 100
            : (1 - el.opacity * (el.fillOpacity ?? 1)) * 100,
      };
      if (
        el.borders?.every(
          (b) =>
            b.color === el.borders![0].color &&
            b.width === el.borders![0].width,
        )
      ) {
        const b = el.borders[0];
        line.color = hex(b.color, "000000");
        line.width = b.width * 0.75;
        line.transparency =
          b.color === "transparent" || !b.width ? 100 : transparency;
      }
      if (
        el.type === "text" ||
        (el.type === "shape" && el.text !== undefined)
      ) {
        slide.addText(el.text ?? "", {
          ...box,
          objectName: el.type === "shape" ? `${el.id}-textbody` : el.id,
          fontFace: el.fontFamily ?? "Arial",
          fontSize: (el.fontSize ?? 32) * 0.75,
          bold: el.bold ?? false,
          italic: el.italic ?? false,
          underline: { style: el.underline ? "sng" : "none" },
          lang: "ko-KR",
          color: hex(el.color, "172033"),
          align: el.align ?? "left",
          valign: el.verticalAlign ?? "top",
          margin: el.textInsets
            ? (el.textInsets.map((n) => n * 0.75) as [
                number,
                number,
                number,
                number,
              ])
            : 0,
          breakLine: false,
          paraSpaceAfter: 0,
          paraSpaceBefore: 0,
          fit: "none",
          wrap: el.wrap ?? true,
          transparency: (1 - el.opacity * (el.textOpacity ?? 1)) * 100,
          isTextBox: true,
          fill,
          line,
        });
      }
      if (el.type === "text") continue;
      if (el.type === "table" && el.table) {
        const table = el.table;
        slide.addTable(
          table.cells.map((row, r) =>
            row.map((text, c) => {
              const style = tableCellStyle(table, r, c);
              return {
                text,
                options: {
                  fill: { color: hex(style.fill, "FFFFFF"), transparency },
                  color: hex(style.color, "233D35"),
                  bold: style.bold,
                  italic: style.italic,
                  underline: {
                    style: style.underline
                      ? ("sng" as const)
                      : ("none" as const),
                  },
                  fontFace: style.fontFamily,
                  fontSize: style.fontSize * 0.75,
                  align: style.align,
                  valign: style.verticalAlign,
                  margin: style.padding * 0.75,
                  border: {
                    type: style.borderWidth
                      ? ("solid" as const)
                      : ("none" as const),
                    color: hex(style.borderColor, "AABCB3"),
                    pt: style.borderWidth * 0.75,
                  },
                  ...(hyperlink ? { hyperlink } : {}),
                },
              };
            }),
          ),
          {
            ...box,
            objectName: el.id,
            autoPage: false,
            colW: tableSizes(
              table.columnWidths,
              table.cells[0].length,
              el.width / 96,
            ),
            rowH: tableSizes(
              table.rowHeights,
              table.cells.length,
              el.height / 96,
            ),
            fontFace: table.fontFamily,
            fontSize: table.fontSize * 0.75,
            align: table.align,
            valign: table.verticalAlign,
            margin: table.padding * 0.75,
            border: {
              type: table.borderWidth ? "solid" : "none",
              color: hex(table.borderColor, "AABCB3"),
              pt: table.borderWidth * 0.75,
            },
          },
        );
      } else if (el.type === "video" || el.type === "audio") {
        slide.addMedia({
          ...box,
          type: el.type,
          data: el.src!,
          cover: el.poster ?? (el.type === "audio" ? AUDIO_ICON : EMPTY_POSTER),
          extn: el.type === "audio" ? audioExtension(el.src!) : el.src!.startsWith("data:video/webm") ? "webm" : "mp4",
          objectName: el.id,
        });
      } else if (el.type === "image") {
        slide.addImage({
          ...box,
          data: el.src!,
          altText: el.alt ?? "",
          transparency,
          objectName: el.id,
          flipH: el.flipH,
          flipV: el.flipV,
        });
      } else {
        const isLine = el.shape === "line" || el.shape === "arrow";
        const shapeMap = {
          rect: pptx.ShapeType.rect,
          roundRect: pptx.ShapeType.roundRect,
          ellipse: pptx.ShapeType.ellipse,
          triangle: pptx.ShapeType.triangle,
          line: pptx.ShapeType.line,
          arrow: pptx.ShapeType.line,
          custom: pptx.ShapeType.rect,
        };
        slide.addShape(shapeMap[el.shape ?? "rect"], {
          ...box,
          ...(isLine ? { h: 0, y: (el.y + el.height / 2) / 96 } : {}),
          objectName: el.id,
          flipH: el.flipH,
          flipV: el.flipV,
          line: isLine
            ? {
                ...line,
                width: (el.strokeWidth ?? 2) * 0.75,
                endArrowType: el.shape === "arrow" ? "triangle" : undefined,
              }
            : line,
          fill,
        });
      }
    }
  }
  const result = await pptx.write({
    outputType: "uint8array",
    compression: true,
  });
  const bytes =
    result instanceof Uint8Array
      ? result
      : new Uint8Array(result as ArrayBuffer);
  // PptxGenJS does not expose transitions. A standard OOXML transition is placed
  // after clrMapOvr, in the schema-defined slide child order.
  const zip = await JSZip.loadAsync(bytes);
  // PptxGenJS can list a master per slide while writing only one master part.
  // Clean its generated manifest before adding any retained source parts.
  const generatedTypes = xmlDocument(await zip.file("[Content_Types].xml")!.async("string"), "content types");
  for (const override of all(generatedTypes, "Override"))
    if (!zip.file((override.getAttribute("PartName") ?? "").replace(/^\//, ""))) override.remove();
  zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(generatedTypes));
  for (const [index, slide] of deck.slides.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    let xml = await zip.file(path)!.async("string");
    const doc = xmlDocument(xml, path);
    if (slide.hidden) doc.documentElement.setAttribute("show", "0");
    else doc.documentElement.removeAttribute("show");
    if (slide.backgroundImage)
      writeBackgroundImage(doc, slide.backgroundImage, backgroundNames[index]);
    else if (slide.backgroundGradient) {
      const cs = child(doc.documentElement, "cSld")!;
      let bg = child(cs, "bg");
      if (!bg) {
        bg = doc.createElementNS(
          "http://schemas.openxmlformats.org/presentationml/2006/main",
          "p:bg",
        );
        cs.insertBefore(bg, cs.firstChild);
      }
      let props = child(bg, "bgPr");
      if (!props) {
        props = doc.createElementNS(
          "http://schemas.openxmlformats.org/presentationml/2006/main",
          "p:bgPr",
        );
        bg.append(props);
      }
      writeGradient(doc, props, slide.backgroundGradient);
    }
    preserveObjectLinks(doc, slide.elements);
    restoreLayoutXml(doc, slide.elements);
    restoreInsertFields(doc, slide.elements);
    restoreTableXml(doc, slide.elements);
    const relationshipPath = `ppt/slides/_rels/slide${index + 1}.xml.rels`;
    const relationshipDoc = xmlDocument(
      await zip.file(relationshipPath)!.async("string"),
      relationshipPath,
    );
    const relationshipNs =
      "http://schemas.openxmlformats.org/package/2006/relationships";
    await writeCharts(zip, doc, relationshipDoc, slide.elements);
    let linkIndex = 0;
    const linkIds = new Map<string, string>();
    for (const props of all(doc, "rPr")) {
      const raw = props.getAttribute("data-ss-link");
      if (!raw) continue;
      props.removeAttribute("data-ss-link");
      const link = validateElementLink(JSON.parse(raw)),
        key = JSON.stringify(link);
      let id = linkIds.get(key);
      if (!id) {
        do {
          id = `rIdSS${++linkIndex}`;
        } while (
          all(relationshipDoc, "Relationship").some(
            (n) => n.getAttribute("Id") === id,
          )
        );
        const rel = relationshipDoc.createElementNS(
          relationshipNs,
          "Relationship",
        );
        rel.setAttribute("Id", id);
        if (link.url) {
          rel.setAttribute("Type", REL_NS + "/hyperlink");
          rel.setAttribute("Target", link.url);
          rel.setAttribute("TargetMode", "External");
        } else {
          const target = deck.slides.findIndex((s) => s.id === link.slideId);
          if (target < 0) continue;
          rel.setAttribute("Type", REL_NS + "/slide");
          rel.setAttribute("Target", `slide${target + 1}.xml`);
        }
        relationshipDoc.documentElement.append(rel);
        linkIds.set(key, id);
      }
      const click = doc.createElementNS(
        "http://schemas.openxmlformats.org/drawingml/2006/main",
        "a:hlinkClick",
      );
      click.setAttributeNS(REL_NS, "r:id", id);
      if (link.slideId) click.setAttribute("action", "ppaction://hlinksldjump");
      props.append(click);
    }
    zip.file(
      relationshipPath,
      new XMLSerializer().serializeToString(relationshipDoc),
    );
    writeObjectState(doc, slide.elements);
    writeGroups(doc, slide.elements);
    writeVideoPlayback(doc, slide.elements);
    writeObjectLabels(doc, slide.elements);
    if (slide.transition === "fade") {
      const transition = doc.createElementNS(
        "http://schemas.openxmlformats.org/presentationml/2006/main",
        "p:transition",
      );
      transition.setAttribute("spd", "med");
      transition.appendChild(
        doc.createElementNS(transition.namespaceURI, "p:fade"),
      );
      doc.documentElement.insertBefore(
        transition,
        child(doc.documentElement, "timing") ??
          child(doc.documentElement, "extLst") ??
          null,
      );
    }
    xml = new XMLSerializer().serializeToString(doc);
    zip.file(path, xml);
  }
  await writePreservedPptx(zip,deck,message => options.onWarning?.(message));
  await writeChartThemes(zip, deck);
  await separateMasterThemes(zip);
  const output = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  checkZip(output);
  return output;
}


function child(
  node: Element | Document | undefined | null,
  name: string,
): Element | undefined {
  return node
    ? Array.from(node.children).find((el) => el.localName === name)
    : undefined;
}
function children(
  node: Element | Document | undefined | null,
  name: string,
): Element[] {
  return node
    ? Array.from(node.children).filter((el) => el.localName === name)
    : [];
}
function first(
  node: Element | Document | undefined | null,
  name: string,
): Element | undefined {
  return node?.getElementsByTagNameNS("*", name)[0];
}
function all(
  node: Element | Document | undefined | null,
  name: string,
): Element[] {
  return node ? Array.from(node.getElementsByTagNameNS("*", name)) : [];
}
function attrNumber(
  el: Element | undefined,
  attr: string,
  fallback = 0,
): number {
  if (!el?.hasAttribute(attr)) return fallback;
  const num = Number(el.getAttribute(attr));
  return Number.isFinite(num) ? num : fallback;
}
function relId(el: Element | undefined, name = "id"): string {
  return (
    el?.getAttributeNS(REL_NS, name) ?? el?.getAttribute(`r:${name}`) ?? ""
  );
}

interface Relationship {
  id: string;
  type: string;
  path?: string;
  external: boolean;
  target?: string;
}
interface Theme {
  colors: Record<string, string>;
  map: Record<string, string>;
  majorFont: string;
  minorFont: string;
}
interface Color {
  color: string;
  opacity: number;
}
const FALLBACK_THEME: Theme = {
  colors: {
    dk1: "#000000",
    lt1: "#FFFFFF",
    dk2: "#1F497D",
    lt2: "#EEECE1",
    accent1: "#4F81BD",
    accent2: "#C0504D",
    accent3: "#9BBB59",
    accent4: "#8064A2",
    accent5: "#4BACC6",
    accent6: "#F79646",
    hlink: "#0000FF",
    folHlink: "#800080",
  },
  map: { tx1: "dk1", tx2: "dk2", bg1: "lt1", bg2: "lt2" },
  majorFont: "Arial",
  minorFont: "Arial",
};
const PRESET_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#FF0000",
  green: "#008000",
  blue: "#0000FF",
  yellow: "#FFFF00",
  gray: "#808080",
  ltGray: "#D3D3D3",
  dkGray: "#A9A9A9",
  orange: "#FFA500",
  purple: "#800080",
  cyan: "#00FFFF",
  magenta: "#FF00FF",
};

function readColor(
  container: Element | undefined,
  theme: Theme,
): Color | undefined {
  if (!container) return undefined;
  const node = [
    "srgbClr",
    "schemeClr",
    "sysClr",
    "scrgbClr",
    "prstClr",
    "hslClr",
  ].includes(container.localName)
    ? container
    : Array.from(container.children).find((el) =>
        [
          "srgbClr",
          "schemeClr",
          "sysClr",
          "scrgbClr",
          "prstClr",
          "hslClr",
        ].includes(el.localName),
      );
  if (!node) return undefined;
  let value: string | undefined;
  const val = node.getAttribute("val") ?? "";
  if (node.localName === "srgbClr")
    value = /^[0-9a-f]{6}$/i.test(val) ? `#${val}` : undefined;
  if (node.localName === "schemeClr")
    value = theme.colors[theme.map[val] ?? val];
  if (node.localName === "sysClr") {
    const last = node.getAttribute("lastClr") ?? "";
    value = /^[0-9a-f]{6}$/i.test(last) ? `#${last}` : PRESET_COLORS[val];
  }
  if (node.localName === "prstClr") {
    value = PRESET_COLORS[val];
    const name = val
      .replace(/^lt/, "light")
      .replace(/^dk/, "dark")
      .replace(/^med/, "medium");
    if (!value && /^[a-z]{1,40}$/i.test(name) && CSS.supports("color", name)) {
      const context = document.createElement("canvas").getContext("2d")!;
      context.fillStyle = name;
      value = context.fillStyle;
    }
  }
  if (node.localName === "hslClr")
    value =
      "#" +
      hslToRgb([
        attrNumber(node, "hue") / 60000,
        attrNumber(node, "sat") / 100000,
        attrNumber(node, "lum") / 100000,
      ])
        .map((c) => Math.round(c).toString(16).padStart(2, "0"))
        .join("");
  if (node.localName === "scrgbClr")
    value =
      "#" +
      ["r", "g", "b"]
        .map((k) =>
          Math.round(linearToSrgb(attrNumber(node, k) / 100000))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
  if (!value) return undefined;
  return applyDrawingmlColorTransforms(value, node.children);
}

interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}
interface Transform {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number;
}
const IDENTITY: Transform = { x: 0, y: 0, sx: 1, sy: 1, rotation: 0 };
function transformGeometry(
  node: Element | undefined,
  parent: Transform,
): Geometry | undefined {
  const off = child(node, "off");
  const ext = child(node, "ext");
  if (!off || !ext) return undefined;
  return {
    x: parent.x + (attrNumber(off, "x") / EMU_PER_PX) * parent.sx,
    y: parent.y + (attrNumber(off, "y") / EMU_PER_PX) * parent.sy,
    width: Math.abs((attrNumber(ext, "cx") / EMU_PER_PX) * parent.sx),
    height: Math.abs((attrNumber(ext, "cy") / EMU_PER_PX) * parent.sy),
    rotation: attrNumber(node, "rot") / 60000 + parent.rotation,
  };
}
function transformGroupedElement(
  element: SlideElement,
  cx: number,
  cy: number,
  rotation: number,
  flipH: boolean,
  flipV: boolean,
): SlideElement {
  const angle = (rotation * Math.PI) / 180;
  const dx = (element.x + element.width / 2 - cx) * (flipH ? -1 : 1);
  const dy = (element.y + element.height / 2 - cy) * (flipV ? -1 : 1);
  const mirrored = flipH !== flipV;
  let orientation =
    rotation + (mirrored ? -element.rotation : element.rotation);
  const line =
    element.type === "shape" &&
    (element.shape === "line" || element.shape === "arrow");
  // A connector's rotation encodes its directed endpoints, including markers.
  // Images/custom paths instead keep reflection in their local flip flags.
  if (line && flipH) orientation += 180;
  return {
    ...element,
    x: cx + dx * Math.cos(angle) - dy * Math.sin(angle) - element.width / 2,
    y: cy + dx * Math.sin(angle) + dy * Math.cos(angle) - element.height / 2,
    rotation: orientation,
    ...(["image", "video", "audio", "chart"].includes(element.type) ||
    (element.type === "shape" && !line)
      ? {
          flipH: Boolean(element.flipH) !== flipH,
          flipV: Boolean(element.flipV) !== flipV,
        }
      : {}),
  };
}
function bodyText(body: Element | undefined): string {
  return children(body, "p")
    .map((p) => {
      const pPr = child(p, "pPr");
      const bullet = child(pPr, "buChar")?.getAttribute("char");
      const auto = child(pPr, "buAutoNum");
      const prefix = bullet ? `${bullet} ` : auto ? "• " : "";
      const content = Array.from(p.children)
        .map((n) =>
          n.localName === "br"
            ? "\n"
            : n.localName === "r" || n.localName === "fld"
              ? (first(n, "t")?.textContent ?? "")
              : "",
        )
        .join("");
      return prefix + content;
    })
    .join("\n");
}

/**
 * Import the editable subset of PresentationML. Unsupported objects produce
 * explicit warnings; no remote relationship, macro, OLE object, or SVG script executes.
 */
export async function importPptx(
  data: ArrayBuffer | Uint8Array,
): Promise<ImportResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const sourcePackage = await openPptxPackage(bytes);
  const { zip, partSizes, readBytes, readXml } = sourcePackage;
  const warnings = new Set<string>();
  const warn = (text: string) => warnings.add(text);
  const imageCache = new Map<string, string | undefined>();
  const videoCache = new Map<string, string | null>();
  const audioCache = new Map<string, string | null>();
  let embeddedAssetBytes = 0;
  const relationships = async (path: string): Promise<Relationship[]> => {
    const bits = path.split("/");
    const filename = bits.pop()!;
    const rels = await readXml(
      [...bits, "_rels", filename + ".rels"].join("/"),
    );
    return all(rels, "Relationship").map((el) => {
      const external = el.getAttribute("TargetMode") === "External";
      return {
        id: el.getAttribute("Id") ?? "",
        type: el.getAttribute("Type") ?? "",
        external,
        ...(external ? { target: el.getAttribute("Target") ?? "" } : {}),
        path: external
          ? undefined
          : resolvePart(path, el.getAttribute("Target") ?? ""),
      };
    });
  };
  const rootRels = await relationships("");
  const mainPath =
    rootRels.find((r) => r.type.endsWith("/officeDocument"))?.path ??
    "ppt/presentation.xml";
  const presentation = await readXml(mainPath);
  if (
    !presentation ||
    presentation.documentElement.localName !== "presentation"
  )
    fail("PPTX 프레젠테이션 정보를 찾을 수 없습니다.");
  const presentationRels = await relationships(mainPath);
  const size = first(presentation, "sldSz");
  const width = attrNumber(size, "cx", 12192000) / EMU_PER_PX;
  const height = attrNumber(size, "cy", 6858000) / EMU_PER_PX;
  if (width < 100 || height < 100 || width > 10000 || height > 10000)
    fail("슬라이드 크기가 지원 범위 (100–10,000 px)를 벗어났습니다.");
  const slideIds = children(first(presentation, "sldIdLst"), "sldId");
  const slideNumbersStartAtOne =
    Number(
      presentation.documentElement.getAttribute("firstSlideNum") ?? "1",
    ) === 1;
  if (slideIds.length < 1 || slideIds.length > MAX_SLIDES)
    fail(`PPTX 슬라이드는 1–${MAX_SLIDES}장이어야 합니다.`);
  const importedSlideIds = slideIds.map(() => uid());
  const slidePathIds = new Map(
    slideIds.map((id, index) => [
      presentationRels.find(
        (r) => r.id === relId(id) && r.type.endsWith("/slide"),
      )?.path,
      importedSlideIds[index],
    ]),
  );
  const core = await readXml("docProps/core.xml");
  const deck: Deck = {
    version: 1,
    id: uid(),
    name:
      first(core, "title")?.textContent?.trim().slice(0, 500) ||
      "가져온 프레젠테이션",
    width,
    height,
    theme: "imported",
    slides: [],
  };
  if (
    Object.entries(zip.files).some(
      ([path, entry]) =>
        !entry.dir && /vbaProject|activeX|embeddings\/.*\.(?:bin|exe|dll)$/i.test(path),
    )
  )
    warn("매크로, ActiveX, OLE 첨부 개체는 가져오지 않습니다.");
  const preservationId = uid();
  let needsSource = preservationRequired(presentation) || ["embeddedFontLst","custShowLst","photoAlbum","kinsoku"].some(name=>!!first(presentation,name)) || presentationRels.some(r=>r.type.endsWith("/commentAuthors"));
  const readImagePart = async (path: string) => {
    if (imageCache.has(path)) return imageCache.get(path);
    let source: string | undefined;
    try {
      const raw = await readBytes(path, MAX_IMAGE);
      if (raw) {
        needsSource ||= !!vectorKind(raw);
        source = await decodeEmbeddedImage(raw);
      }
    } catch { /* Try the Office raster fallback, while retaining native bytes. */ }
    imageCache.set(path, source);
    return source;
  };
  const readPicture = async (blip: Element | undefined, imageRels: Relationship[]) => {
    const candidates = [first(blip, "svgBlip"), blip];
    let triedVector = false;
    for (const candidate of candidates) {
      const rel = imageRels.find(r => r.id === relId(candidate, "embed") && r.type.endsWith("/image"));
      if (!rel?.path || rel.external) continue;
      const source = await readImagePart(rel.path);
      if (source) {
        if (triedVector) warn("일부 벡터 그림은 변환할 수 없어 PPTX에 포함된 대체 그림으로 표시합니다.");
        return source;
      }
      if (candidate !== blip) triedVector = true;
    }
  };
  let count = 0;
  const tableStyles = await readXml(
    presentationRels.find((r) => r.type.endsWith("/tableStyles"))?.path ??
      "ppt/tableStyles.xml",
  );

  for (const [slideIndex, slideId] of slideIds.entries()) {
    const slidePath = presentationRels.find(
      (r) => r.id === relId(slideId) && r.type.endsWith("/slide"),
    )?.path;
    if (!slidePath)
      fail(`${slideIndex + 1}번 슬라이드의 관계 정보를 찾을 수 없습니다.`);
    const doc = await readXml(slidePath);
    if (!doc) fail(`${slideIndex + 1}번 슬라이드 파일이 없습니다.`);
    const rels = await relationships(slidePath);
    const layoutPath = rels.find((r) => r.type.endsWith("/slideLayout"))?.path;
    const layout = await readXml(layoutPath);
    const layoutRels = layoutPath ? await relationships(layoutPath) : [];
    const masterPath = layoutRels.find((r) =>
      r.type.endsWith("/slideMaster"),
    )?.path;
    const master = await readXml(masterPath);
    const masterRels = masterPath ? await relationships(masterPath) : [];
    const themePath = masterRels.find((r) => r.type.endsWith("/theme"))?.path ??
      presentationRels.find((r) => r.type.endsWith("/theme"))?.path;
    const themeDoc = await readXml(themePath);
    const theme: Theme = {
      ...FALLBACK_THEME,
      colors: { ...FALLBACK_THEME.colors },
      map: { ...FALLBACK_THEME.map },
    };
    for (const entry of Array.from(
      first(themeDoc, "clrScheme")?.children ?? [],
    )) {
      const color = readColor(entry, theme);
      if (color) theme.colors[entry.localName] = color.color;
    }
    const mapping =
      first(doc, "overrideClrMapping") ??
      first(layout, "overrideClrMapping") ??
      first(master, "clrMap");
    for (const attribute of Array.from(mapping?.attributes ?? []))
      theme.map[attribute.name] = attribute.value;
    const fonts = first(themeDoc, "fontScheme");
    theme.majorFont =
      child(child(fonts, "majorFont"), "latin")?.getAttribute("typeface") ||
      "Arial";
    theme.minorFont =
      child(child(fonts, "minorFont"), "latin")?.getAttribute("typeface") ||
      "Arial";
    const eastAsianFont = (name: string, text = "", language = "") => {
      const family = child(fonts, name);
      const script =
        /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ||
        /^ja/i.test(language)
          ? "Jpan"
          : /[\p{Script=Hangul}]/u.test(text) || /^ko/i.test(language)
            ? "Hang"
            : /^zh-(?:TW|HK|MO|Hant)/i.test(language)
              ? "Hant"
              : /^zh/i.test(language) || /\p{Script=Han}/u.test(text)
                ? "Hans"
                : "Hang";
      return (
        child(family, "ea")?.getAttribute("typeface") ||
        children(family, "font")
          .find((n) => n.getAttribute("script") === script)
          ?.getAttribute("typeface") ||
        "Apple SD Gothic Neo"
      );
    };
    const formatFont = (font: string, text = "", language = "") =>
      (font === "+mj-ea"
        ? eastAsianFont("majorFont", text, language)
        : font === "+mn-ea"
          ? eastAsianFont("minorFont", text, language)
          : font.startsWith("+mj")
            ? theme.majorFont
            : font.startsWith("+mn")
              ? theme.minorFont
              : font
      ).replace(/\s*\((?:Headings|Body)\)\s*$/i, "");
    const ownBackground = first(doc, "bg"), layoutBackground = first(layout, "bg");
    const backgroundNode = ownBackground ?? layoutBackground ?? first(master, "bg");
    const backgroundRels = ownBackground ? rels : layoutBackground ? layoutRels : masterRels;
    const backgroundReference = child(backgroundNode, "bgRef");
    const referencedBackground = resolveThemeStyleReference(backgroundReference, first(themeDoc, "fmtScheme"), (n) => readColor(n, theme), "fill");
    const backgroundProperties = child(backgroundNode, "bgPr");
    const backgroundPaint = (name: string) => backgroundProperties
      ? child(backgroundProperties, name)
      : referencedBackground?.localName === name ? referencedBackground : undefined;
    const bgColor =
      readColor(backgroundPaint("solidFill"), theme) ??
      (!referencedBackground ? readColor(backgroundReference, theme) : undefined);
    const bgGradient = readGradient(
      backgroundPaint("gradFill"),
      (n) => readColor(n, theme),
    );
    let backgroundImage: Slide["backgroundImage"];
    const backgroundFill = backgroundPaint("blipFill");
    if (backgroundFill) {
      const blip = child(backgroundFill, "blip");
      const fillRect = child(child(backgroundFill, "stretch"), "fillRect");
      const simplePlacement = !child(blip, "duotone") && !child(backgroundFill, "tile") && !["t", "r", "b", "l"].some((key) => attrNumber(fillRect, key) !== 0);
      const src = await readPicture(blip, referencedBackground === backgroundFill && themePath ? await relationships(themePath) : backgroundRels);
      if (src) {
        const pictureFill = simplePlacement ? undefined : readDrawingmlImageFill(backgroundFill, src, (node) => readColor(node, theme));
        if (unsupportedDrawingmlImageEffects(backgroundFill) || (child(blip, "duotone") && !pictureFill?.duotone))
          warn("일부 그림 배경 효과는 화면에 표시되지 않지만 원본 PPTX에는 보존됩니다.");
        if (simplePlacement || pictureFill) {
          const crop = ["t", "r", "b", "l"].map((key) => attrNumber(child(backgroundFill, "srcRect"), key) / 100000) as [number, number, number, number];
          backgroundImage = validateBackgroundImage({ src,
            ...(crop.some(v => v !== 0) ? { crop } : {}),
            opacity: clamp(attrNumber(child(blip, "alphaModFix"), "amt", 100000) / 100000, 0, 1),
            ...(pictureFill ? { placement: { width: pictureFill.width, height: pictureFill.height, dpi: pictureFill.dpi, fill: pictureFill.fill, ...(pictureFill.duotone ? { duotone: pictureFill.duotone } : {}), ...(pictureFill.tile ? { tile: pictureFill.tile } : {}) } } : {}),
          }, `${slideIndex + 1}번 슬라이드`);
          embeddedAssetBytes += src.length * 0.75;
          if (embeddedAssetBytes > MAX_EXPANDED / 2) fail("내장 이미지·배경의 합계가 100 MB를 초과합니다.");
        }
      }
    }
    if (backgroundNode && !bgColor && !bgGradient && !backgroundImage && !backgroundPaint("noFill"))
      warn(
        "일부 배경의 그라데이션·이미지·효과는 단색 배경으로 대체되었습니다.",
      );
    needsSource ||= preservationRequired(doc) || preservationRequired(layout) || preservationRequired(master);
    const slide: Slide = {
      id: importedSlideIds[slideIndex],
      pptxSource: {
        source: preservationId, path: slidePath, nodes: [],
        background: "0".repeat(64), transition: "0".repeat(64), notes: "0".repeat(64),
      },
      ...(["0", "false"].includes(
        doc.documentElement.getAttribute("show") ?? "",
      )
        ? { hidden: true }
        : {}),
      background: bgColor?.color ?? "#FFFFFF",
      ...(bgGradient ? { backgroundGradient: bgGradient } : {}),
      ...(backgroundImage ? { backgroundImage } : {}),
      notes: "",
      transition: "none",
      elements: [],
    };
    const transition = first(doc, "transition");
    slide.pptxSource!.nativeTransition = !!transition && (!child(transition, "fade") ||
      transition.hasAttribute("advTm") || transition.getAttribute("spd") !== "med");
    if (transition) {
      if (child(transition, "fade")) slide.transition = "fade";
      else warn("페이드 이외의 슬라이드 전환은 가져오지 않습니다.");
      if (transition.hasAttribute("advTm"))
        warn("자동 슬라이드 전환 시간은 가져오지 않습니다.");
    }
    if (
      first(doc, "timing") &&
      [
        "anim",
        "animClr",
        "animEffect",
        "animMotion",
        "animRot",
        "animScale",
        "set",
        "cmd",
      ].some((name) => first(first(doc, "timing"), name))
    )
      warn(
        "개체 애니메이션과 복잡한 미디어 타이밍은 편집·발표에서 지원하지 않습니다. 내장 오디오·동영상의 기본 재생 설정은 가져오며, 지원하지 않는 원본 요소도 PPTX로 저장할 때 보존합니다.",
      );
    if (rels.some((r) => r.external && !r.type.endsWith("/hyperlink")))
      warn("외부 링크 이미지·미디어는 불러오거나 실행하지 않습니다.");

    const addElement = (el: SlideElement) => {
      if (
        !Number.isFinite(el.x) ||
        !Number.isFinite(el.y) ||
        !Number.isFinite(el.width) ||
        !Number.isFinite(el.height) ||
        Math.abs(el.x) > 100000 ||
        Math.abs(el.y) > 100000 ||
        el.width > 100000 ||
        el.height > 100000
      ) {
        warn(
          "지원 범위를 벗어난 개체의 위치·크기 때문에 해당 개체를 제외했습니다.",
        );
        return;
      }
      if (el.type !== "shape" && (!el.width || !el.height)) {
        warn("크기가 0인 개체를 제외했습니다.");
        return;
      }
      if (++count > MAX_ELEMENTS || slide.elements.length >= 1000)
        fail("PPTX 개체 수가 지원 한도를 초과합니다.");
      normalizeObjectAlpha(el);
      if (el.type === "image" || el.type === "video" || el.type === "audio")
        embeddedAssetBytes +=
          ((el.src?.length ?? 0) + (el.poster?.length ?? 0)) * 0.75;
      slide.elements.push(el);
    };
    const readFill = (
      nodes: (Element | undefined)[],
      defaultColor = "transparent",
    ): Color & { gradient?: SlideElement["gradient"] } => {
      for (const node of nodes) {
        const properties = child(node, "spPr");
        if (child(properties, "noFill"))
          return { color: "transparent", opacity: 1 };
        const solid = readColor(child(properties, "solidFill"), theme);
        if (solid)
          return solid.opacity === 0 ? { color: "transparent", opacity: 1 } : solid;
        const gradient = readGradient(child(properties, "gradFill"), (n) =>
          readColor(n, theme),
        );
        if (gradient)
          return { color: gradient.stops[0].color, opacity: 1, gradient };
        if (child(properties, "pattFill") || child(properties, "blipFill"))
          warn("도형의 패턴·그림 채우기는 가져오지 않습니다.");
        const fillRef = child(child(node, "style"), "fillRef");
        const themedFill = resolveThemeStyleReference(
          fillRef,
          first(themeDoc, "fmtScheme"),
          (n) => readColor(n, theme),
          "fill",
        );
        if (themedFill?.localName === "noFill")
          return { color: "transparent", opacity: 1 };
        if (themedFill?.localName === "solidFill") {
          const color = readColor(themedFill, theme);
          if (color) return color;
        }
        if (themedFill?.localName === "gradFill") {
          const gradient = readGradient(themedFill, (n) => readColor(n, theme));
          if (gradient)
            return { color: gradient.stops[0].color, opacity: 1, gradient };
        }
        if (
          themedFill?.localName === "pattFill" ||
          themedFill?.localName === "blipFill"
        )
          warn("도형의 패턴·그림 채우기는 가져오지 않습니다.");
        const reference = readColor(fillRef, theme);
        if (reference && fillRef?.getAttribute("idx") !== "0") return reference;
      }
      return { color: defaultColor, opacity: 1 };
    };
    const readLine = (
      nodes: (Element | undefined)[],
    ): {
      color: string;
      width: number;
      opacity: number;
      arrow: boolean;
      start?: LineEnd;
      end?: LineEnd;
      dash?: number[];
      cap?: SlideElement["strokeCap"];
    } => {
      const line = nodes
        .map((node) =>
          inheritDrawingmlLine(
            child(child(node, "spPr"), "ln"),
            resolveThemeStyleReference(
              child(child(node, "style"), "lnRef"),
              first(themeDoc, "fmtScheme"),
              (n) => readColor(n, theme),
              "line",
            ),
          ),
        )
        .reduceRight<Element | undefined>(
          (inherited, own) => inheritDrawingmlLine(own, inherited),
          undefined,
        );
      if (line) {
        const color =
          readColor(child(line, "solidFill"), theme) ??
          nodes
            .map((node) => readColor(child(child(node, "style"), "lnRef"), theme))
            .find(Boolean);
        if (child(line, "noFill"))
          return { color: "transparent", width: 0, opacity: 1, arrow: false };
        const marker = (name: string): LineEnd => {
          const n = child(line, name);
          const type = n?.getAttribute("type") ?? "none";
          const size = (key: string) => {
            const value = n?.getAttribute(key);
            return value === "sm" || value === "lg" ? value : "med";
          };
          return {
            type: ["triangle", "stealth", "diamond", "oval", "arrow"].includes(type)
              ? (type as LineEnd["type"])
              : "none",
            width: size("w"),
            length: size("len"),
          };
        };
        const start = marker("headEnd"),
          end = marker("tailEnd");
        const presets: Record<string, number[]> = {
          dot: [1, 3],
          dash: [4, 3],
          lgDash: [8, 3],
          dashDot: [4, 3, 1, 3],
          lgDashDot: [8, 3, 1, 3],
          lgDashDotDot: [8, 3, 1, 3, 1, 3],
          sysDot: [1, 1],
          sysDash: [3, 1],
          sysDashDot: [3, 1, 1, 1],
          sysDashDotDot: [3, 1, 1, 1, 1, 1],
        };
        const width = color ? attrNumber(line, "w", 12700) / EMU_PER_PX : 0;
        const custom = children(child(line, "custDash"), "ds").flatMap((n) => [
          attrNumber(n, "d") / 100000,
          attrNumber(n, "sp") / 100000,
        ]);
        const dash = (
          custom.length
            ? custom
            : presets[child(line, "prstDash")?.getAttribute("val") ?? ""]
        )?.map((n) => Math.max(0.01, n * width));
        return {
          color:
            color?.opacity === 0 ? "transparent" : (color?.color ?? "transparent"),
          width: color ? attrNumber(line, "w", 12700) / EMU_PER_PX : 0,
          opacity: color?.opacity ?? 1,
          arrow: end.type !== "none" || start.type !== "none",
          start,
          end,
          dash,
          cap:
            line.getAttribute("cap") === "rnd"
              ? "round"
              : line.getAttribute("cap") === "sq"
                ? "square"
                : "butt",
        };
      }
      return { color: "transparent", width: 0, opacity: 1, arrow: false };
    };

    const makeText = (
      body: Element,
      chain: (Element | undefined)[],
      geometry: Geometry,
      parent: Transform,
      cellProperties?: Element,
      runDefaults?: Element[],
      preserveBox?: boolean,
    ): SlideElement => {
      const ph = chain[0] && placeholder(chain[0]);
      const styleName =
        ph?.type === "title" || ph?.type === "ctrTitle"
          ? "titleStyle"
          : ph && ["body", "subTitle", "obj"].includes(ph.type)
            ? "bodyStyle"
            : "otherStyle";
      const masterTextStyle = child(first(master, "txStyles"), styleName);
      const presentationTextStyle = first(presentation, "defaultTextStyle");
      return readTextBody(body, {
        nodes: chain,
        // Free text boxes use the presentation's default text style before the
        // master's otherStyle. Placeholder title/body inheritance is separate.
        masterStyle: ph ? masterTextStyle : presentationTextStyle,
        defaultStyle: ph ? presentationTextStyle : masterTextStyle,
        font: formatFont,
        defaultFont:
          styleName === "titleStyle" ? theme.majorFont : theme.minorFont,
        color: (n) => readColor(n, theme),
        defaultColor: theme.colors.dk1,
        hyperlinkColor: theme.colors.hlink,
        geometry,
        // Group transforms place the text box. Authored point sizes/spacing
        // already describe the text inside it; scaling these again enlarges
        // grouped labels (e.g. CMU lecture 3's 20 pt labels become 28.36 pt).
        sx: 1,
        sy: 1,
        cellProperties,
        runDefaults,
        preserveBox,
        link: (link) => {
          if (!link) return;
          const rel = rels.find((r) => r.id === relId(link));
          if (rel?.external && rel.type.endsWith("/hyperlink")) {
            try {
              return validateElementLink({ url: rel.target });
            } catch {
              return;
            }
          }
          if (rel?.path && rel.type.endsWith("/slide")) {
            const id = slidePathIds.get(rel.path);
            if (id) return { slideId: id };
          }
        },
      });
    };

    const parseShape = (node: Element, parent: Transform): void => {
      const layoutShape = inheritedShape(node, layout);
      const masterShape = inheritedShape(layoutShape ?? node, master);
      const chain = [node, layoutShape, masterShape];
      const properties = child(node, "spPr");
      const xfrm = inheritedTransform(chain);
      const geometry = transformGeometry(xfrm, parent);
      if (!geometry) {
        warn("위치 정보를 찾을 수 없는 개체를 제외했습니다.");
        return;
      }
      if (
        Array.from(first(properties, "effectLst")?.children ?? []).some(
          (n) => n.localName !== "outerShdw",
        ) ||
        first(properties, "scene3d") ||
        first(properties, "sp3d")
      )
        warn("광택·반사·내부 그림자·3D 효과는 가져오지 않습니다.");
      const geometryProperties = chain
        .map((s) => child(s, "spPr"))
        .find((p) => child(p, "prstGeom") || child(p, "custGeom"));
      const preset =
        child(geometryProperties, "prstGeom")?.getAttribute("prst") ??
        (node.localName === "cxnSp" ? "line" : "rect");
      const fill = readFill(chain);
      const line = readLine(chain);
      const effect = chain
          .map((n) => child(child(n, "spPr"), "effectLst"))
          .find(Boolean),
        shadowNode = child(effect, "outerShdw"),
        shadowColor = readColor(shadowNode, theme);
      const distance = attrNumber(shadowNode, "dist") / EMU_PER_PX,
        direction = ((attrNumber(shadowNode, "dir") / 60000) * Math.PI) / 180;
      const shadow =
        shadowNode && shadowColor
          ? {
              color: shadowColor.color,
              opacity: shadowColor.opacity,
              blur: attrNumber(shadowNode, "blurRad") / EMU_PER_PX,
              dx: distance * Math.cos(direction),
              dy: distance * Math.sin(direction),
            }
          : undefined;

      let paths = drawingPaths(child(geometryProperties, "custGeom"), {
        width: attrNumber(child(xfrm, "ext"), "cx"),
        height: attrNumber(child(xfrm, "ext"), "cy"),
      });
      if (!paths && preset === "donut") {
        const guide = children(
          child(child(geometryProperties, "prstGeom"), "avLst"),
          "gd",
        ).find((n) => n.getAttribute("name") === "adj");
        const value = guide
          ?.getAttribute("fmla")
          ?.match(/^\s*val\s+(-?\d+(?:\.\d+)?)\s*$/);
        const adjustment = clamp(value ? Number(value[1]) : 25000, 0, 50000);
        // Keep native EMU precision: custom path coordinates become integers
        // on PPTX export, which would visibly round a small pixel-space ring.
        const width = Math.max(1, attrNumber(child(xfrm, "ext"), "cx"));
        const height = Math.max(1, attrNumber(child(xfrm, "ext"), "cy"));
        const rx = width / 2,
          ry = height / 2;
        // DrawingML subtracts a fraction of the shortest side from both radii.
        const thickness = (Math.min(width, height) * adjustment) / 100000;
        const ix = rx - thickness,
          iy = ry - thickness;
        const outer = `M ${width} ${ry} A ${rx} ${ry} 0 0 1 0 ${ry} A ${rx} ${ry} 0 0 1 ${width} ${ry} Z`;
        const inner =
          ix > 0 && iy > 0
            ? ` M ${rx + ix} ${ry} A ${ix} ${iy} 0 0 0 ${rx - ix} ${ry} A ${ix} ${iy} 0 0 0 ${rx + ix} ${ry} Z`
            : "";
        paths = [{ d: outer + inner, width, height, fill: true, stroke: true }];
      }
      const extent = {
        width: attrNumber(child(xfrm, "ext"), "cx"),
        height: attrNumber(child(xfrm, "ext"), "cy"),
      };
      const sourceGeometry =
        child(geometryProperties, "custGeom") ??
        presetGeometry(
          preset,
          child(child(geometryProperties, "prstGeom"), "avLst"),
        );
      if (
        !paths &&
        (!SHAPES.has(preset as ShapeKind) ||
          (preset === "triangle" &&
            children(
              child(child(geometryProperties, "prstGeom"), "avLst"),
              "gd",
            ).length > 0)) &&
        preset !== "straightConnector1"
      )
        paths = drawingPaths(sourceGeometry, extent);
      const sourceTextFrame = drawingTextFrame(
        sourceGeometry,
        extent.width,
        extent.height,
      );
      const body = child(node, "txBody");
      const text = bodyText(body);
      const isTextBox =
        child(child(node, "nvSpPr"), "cNvSpPr")?.getAttribute("txBox") === "1";
      const pureText =
        (isTextBox && preset === "rect" && !paths) ||
        (!paths &&
          Boolean(body) &&
          preset === "rect" &&
          fill.color === "transparent" &&
          (line.color === "transparent" || line.width === 0));
      let shape: ShapeKind =
        preset === "line" || preset === "straightConnector1"
          ? line.arrow
            ? "arrow"
            : "line"
          : SHAPES.has(preset as ShapeKind)
            ? (preset as ShapeKind)
            : "rect";
      if (paths) shape = "custom";
      // The roundRect adjustment is a fraction of its shortest side, not a
      // fixed pixel radius. Office's preset pins it between 0 and 50000.
      let cornerRadius: number | undefined;
      if (shape === "roundRect") {
        const guide = children(
          child(child(geometryProperties, "prstGeom"), "avLst"),
          "gd",
        ).find((n) => n.getAttribute("name") === "adj");
        const constant = guide
          ?.getAttribute("fmla")
          ?.match(/^\s*val\s+(-?\d+(?:\.\d+)?)\s*$/);
        const adjustment = constant ? Number(constant[1]) : 16667;
        cornerRadius =
          (Math.min(geometry.width, geometry.height) *
            clamp(Number.isFinite(adjustment) ? adjustment : 16667, 0, 50000)) /
          100000;
      }
      if (
        !paths &&
        ((!SHAPES.has(preset as ShapeKind) &&
          !["straightConnector1", "rightArrow"].includes(preset)) ||
          child(properties, "custGeom"))
      )
        warn(
          "지원하지 않는 도형·자유형 경로는 사각형 또는 선으로 단순화됩니다.",
        );
      let shapeElement: SlideElement | undefined;
      if (!pureText)
        shapeElement = {
          id: uid(),
          type: "shape",
          shape,
          ...(cornerRadius !== undefined ? { cornerRadius } : {}),
          ...(shape !== "line" && shape !== "arrow"
            ? {
                paths,
                flipH: ["1", "true"].includes(
                  xfrm?.getAttribute("flipH") ?? "",
                ),
                flipV: ["1", "true"].includes(
                  xfrm?.getAttribute("flipV") ?? "",
                ),
              }
            : {}),
          ...geometry,
          ...(shape === "line" || shape === "arrow" || (paths && line.arrow)
            ? { lineStart: line.start, lineEnd: line.end }
            : {}),
          ...(shape === "line" || shape === "arrow"
            ? (() => {
                // OOXML connector extents encode two endpoints. The editor's
                // line is horizontal within its box, so retain the diagonal as
                // a rotation around the original midpoint.
                const length = Math.hypot(geometry.width, geometry.height);
                const dx =
                  geometry.width *
                  (["1", "true"].includes(xfrm?.getAttribute("flipH") ?? "")
                    ? -1
                    : 1);
                const dy =
                  geometry.height *
                  (["1", "true"].includes(xfrm?.getAttribute("flipV") ?? "")
                    ? -1
                    : 1);
                return {
                  x: geometry.x + geometry.width / 2 - length / 2,
                  y: geometry.y + geometry.height / 2 - 0.5,
                  width: length,
                  height: 1,
                  rotation:
                    geometry.rotation + (Math.atan2(dy, dx) * 180) / Math.PI,
                };
              })()
            : {}),
          opacity: 1,
          fillOpacity: fill.opacity,
          strokeOpacity: line.opacity,
          fill: fill.color,
          gradient: fill.gradient,
          shadow,
          strokeDash: line.dash,
          strokeCap: line.cap,
          stroke: line.color,
          strokeWidth: line.width,
        };
      if (!body || (!text && !pureText)) {
        if (shapeElement) addElement(shapeElement);
        return;
      }
      const inset =
        !pureText && (preset === "ellipse" || preset === "donut")
          ? (1 - Math.SQRT1_2) / 2
          : 0;
      const textElement = makeText(
        body,
        chain,
        geometry,
        parent,
        undefined,
        undefined,
        true,
      );
      if (shapeElement) {
        const {
          id,
          type,
          x,
          y,
          width,
          height,
          rotation,
          opacity,
          fill: textFill,
          stroke: textStroke,
          strokeWidth: textStrokeWidth,
          ...content
        } = textElement;
        Object.assign(shapeElement, content, {
          autoHeight: false,
          textFrame: textElement.textFrame ?? sourceTextFrame ?? [
            inset,
            inset,
            1 - 2 * inset,
            1 - 2 * inset,
          ],
        });
        addElement(shapeElement);
        return;
      }
      if (pureText)
        Object.assign(textElement, {
          fill: fill.color,
          gradient: fill.gradient,
          shadow,
          strokeDash: line.dash,
          strokeCap: line.cap,
          fillOpacity: fill.opacity,
          stroke: line.color,
          strokeOpacity: line.opacity,
          strokeWidth: line.width,
        });
      addElement(textElement);
    };

    const parseImage = async (
      node: Element,
      parent: Transform,
      pictureRelationships: Relationship[] = rels,
    ): Promise<void> => {
      const layoutShape = inheritedShape(node, layout);
      const masterShape = layoutShape && inheritedShape(layoutShape, master);
      const xfrm = inheritedTransform([node, layoutShape, masterShape]);
      const geometry = transformGeometry(xfrm, parent);
      if (!geometry) {
        warn("위치 정보를 찾을 수 없는 이미지를 제외했습니다.");
        return;
      }
      const media = first(node, "media"),
        legacyVideo = first(node, "videoFile");
      const legacyAudio = first(node, "audioFile") ?? first(node, "wavAudioFile");
      const mediaId = relId(media, "embed") || relId(legacyAudio, "link") || relId(legacyAudio, "embed") || relId(legacyVideo, "link");
      const mediaRelationship = pictureRelationships.find(r=>r.id === mediaId);
      const isAudio = !!legacyAudio || !!mediaRelationship?.type.endsWith("/audio") || /\.(?:mp3|wav|m4a)$/i.test(mediaRelationship?.path ?? "");
      if (isAudio) {
        const relationship = mediaRelationship;
        const declaredSize = relationship?.path ? partSizes.get(relationship.path) : undefined;
        if (relationship?.path && !relationship.external && declaredSize !== undefined && declaredSize <= MAX_AUDIO_BYTES &&
          embeddedAssetBytes + declaredSize + 512 < MAX_EXPANDED / 2) {
          let src = audioCache.get(relationship.path);
          if (src === undefined) {
            const raw = await readBytes(relationship.path, MAX_AUDIO_BYTES), mime = raw && audioMime(raw);
            src = raw && mime ? bytesDataUrl(raw,mime) : null;
            audioCache.set(relationship.path,src);
          }
          if (src) {
            const poster = (await readPicture(first(child(node,"blipFill"),"blip"),pictureRelationships)) ?? AUDIO_ICON;
            if (embeddedAssetBytes + (src.length + poster.length) * 0.75 <= MAX_EXPANDED / 2) {
              addElement({ id:uid(), type:"audio", ...geometry, opacity:1, src, poster,
                ...readAudioPlayback(doc,node),
                flipH:["1","true"].includes(xfrm?.getAttribute("flipH")??""),
                flipV:["1","true"].includes(xfrm?.getAttribute("flipV")??""),
                alt:first(node,"cNvPr")?.getAttribute("descr") || first(node,"cNvPr")?.getAttribute("name") || "오디오",
              });
              return;
            }
          }
        }
        warn("외부 연결·지원하지 않는 오디오 또는 크기 제한을 넘는 소리는 아이콘으로만 가져옵니다. 내장 MP3·WAV·M4A는 한 개당 20 MiB까지 지원합니다.");
      }
      if (!isAudio && (media || legacyVideo)) {
        const id = relId(media, "embed") || relId(legacyVideo, "link");
        const relationship = pictureRelationships.find((r) => r.id === id);
        const declaredSize = relationship?.path
          ? partSizes.get(relationship.path)
          : undefined;
        if (
          relationship?.path &&
          !relationship.external &&
          declaredSize !== undefined &&
          declaredSize <= MAX_VIDEO_BYTES &&
          embeddedAssetBytes + declaredSize + 512 < MAX_EXPANDED / 2
        ) {
          let src = videoCache.get(relationship.path);
          if (src === undefined) {
            const raw = await readBytes(relationship.path, MAX_VIDEO_BYTES);
            const mime = raw && videoMime(raw);
            src = raw && mime ? bytesDataUrl(raw, mime) : null;
            videoCache.set(relationship.path, src);
          }
          if (src) {
            let poster = await readPicture(first(child(node, "blipFill"), "blip"), pictureRelationships);
            poster ??= EMPTY_POSTER;
            if (
              embeddedAssetBytes + (src.length + poster.length) * 0.75 <=
              MAX_EXPANDED / 2
            ) {
              addElement({
                id: uid(),
                type: "video",
                ...geometry,
                opacity: 1,
                src,
                poster,
                ...readVideoPlayback(doc, node),
                flipH: ["1", "true"].includes(
                  xfrm?.getAttribute("flipH") ?? "",
                ),
                flipV: ["1", "true"].includes(
                  xfrm?.getAttribute("flipV") ?? "",
                ),
                alt:
                  first(node, "cNvPr")?.getAttribute("descr") ||
                  first(node, "cNvPr")?.getAttribute("name") ||
                  "동영상",
              });
              return;
            }
          }
        }
        warn(
          "외부 연결·지원하지 않는 동영상 또는 크기 제한을 넘는 영상은 정지 미리보기로 가져옵니다. 내장 MP4·WebM은 한 개당 20 MiB, 이미지·동영상 합계 100 MiB까지 지원합니다.",
        );
      }
      const blip = first(child(node, "blipFill"), "blip");
      const src = await readPicture(blip, pictureRelationships);
      if (!src) {
        warn("변환할 수 없는 그림이나 내장 데이터가 없는 연결 이미지를 제외했습니다. PNG/JPEG/GIF/WebP/TIFF 및 지원하는 SVG/EMF/WMF 그림을 표시합니다.");
        return;
      }
      const cropNode = first(node, "srcRect");
      const crop: [number, number, number, number] = ["t", "r", "b", "l"].map(
        (k) => attrNumber(cropNode, k, 0) / 100000,
      ) as [number, number, number, number];
      const opacity = clamp(
        attrNumber(child(blip, "alphaModFix"), "amt", 100000) / 100000,
        0,
        1,
      );
      addElement({
        id: uid(),
        type: "image",
        ...geometry,
        src,
        ...(crop.some((v) => v !== 0) &&
        crop[0] + crop[2] < 0.999 &&
        crop[1] + crop[3] < 0.999
          ? { crop }
          : {}),
        flipH: ["1", "true"].includes(xfrm?.getAttribute("flipH") ?? ""),
        flipV: ["1", "true"].includes(xfrm?.getAttribute("flipV") ?? ""),
        opacity,
        alt: first(node, "cNvPr")?.getAttribute("descr") ?? "",
      });
    };

    const parseTable = async (node: Element, parent: Transform) => {
      const table = first(node, "tbl"),
        geometry = transformGeometry(child(node, "xfrm"), parent);
      if (!table || !geometry) {
        warn("위치 정보를 찾을 수 없는 표는 제외했습니다.");
        return;
      }
      const columns = children(child(table, "tblGrid"), "gridCol").map((n) =>
        attrNumber(n, "w"),
      );
      const rows = children(table, "tr"),
        heights = rows.map((n) => attrNumber(n, "h"));
      if (
        !columns.length ||
        !rows.length ||
        columns.length > 100 ||
        rows.length > 1000 ||
        columns.some((n) => n <= 0) ||
        heights.some((n) => n < 0)
      ) {
        warn("표의 행·열 크기를 읽을 수 없습니다.");
        return;
      }
      let rowHeights = heights.map(
        (n) => (n / EMU_PER_PX) * Math.abs(parent.sy),
      );
      const automaticRows = heights.flatMap((height, row) =>
        height === 0 ? [row] : [],
      );
      const baseHeight = rowHeights.reduce((a, b) => a + b, 0);
      // The saved frame can be shorter than its explicit DrawingML rows.
      // Preserve those rows in every import path, including Studio metadata.
      geometry.height = Math.max(geometry.height, baseHeight);
      // Our native tables retain a small style extension, but cell text and
      // geometry always come from DrawingML. Modified/complex cell formatting
      // falls back to the existing fidelity-preserving per-cell importer.
      const marker = node.getElementsByTagNameNS(TABLE_NS, "table")[0];
      // Automatic rows need the actual per-cell width/style measurement below;
      // do not normalize zero DrawingML heights into metadata proportions.
      if (
        marker &&
        !automaticRows.length &&
        (marker.textContent?.length ?? 0) <= 256 * 1024
      ) {
        try {
          const metadata = JSON.parse(marker.textContent ?? "");
          if (metadata.version !== 1) throw new Error("Unknown table version");
          const cellElements = rows.map((row) => children(row, "tc"));
          if (
            cellElements.some(
              (cells) =>
                cells.length !== columns.length ||
                cells.some(
                  (cell) =>
                    ["gridSpan", "rowSpan"].some(
                      (key) => attrNumber(cell, key, 1) !== 1,
                    ) ||
                    ["hMerge", "vMerge"].some((key) =>
                      ["1", "true"].includes(cell.getAttribute(key) ?? ""),
                    ),
                ),
            )
          )
            throw new Error("Merged table");
          const texts = cellElements.map((cells) =>
            cells.map((cell) => {
              const body = child(cell, "txBody");
              if (!body) throw new Error("Missing table text");
              return makeText(
                body,
                [cell],
                geometry,
                parent,
                child(cell, "tcPr"),
              );
            }),
          );
          const data = validateTable({
            ...metadata.style,
            cells: texts.map((cells) => cells.map((el) => el.text ?? "")),
            columnWidths: columns.map(
              (n) => n / columns.reduce((a, b) => a + b, 0),
            ),
            rowHeights: heights.map(
              (n) => n / heights.reduce((a, b) => a + b, 0),
            ),
          });
          const opacity = numberValue(metadata.opacity, "표 불투명도", 0, 1);
          const close = (a: number | undefined, b: number) =>
            a !== undefined && Math.abs(a - b) < 0.05;
          const compatible = texts.every((cells, r) =>
            cells.every((el, c) => {
              const style = tableCellStyle(data, r, c);
              const props = child(cellElements[r][c], "tcPr");
              const fill = readColor(child(props, "solidFill"), theme);
              return (
                tableDiagonalBordersMatch(
                  props ? readTableDiagonalBorders(props, [], (n) => readColor(n, theme), parent.sx) : undefined,
                  style.diagonalBorders,
                  opacity,
                  style.strokeOpacity,
                ) &&
                fill?.color === style.fill &&
                el.verticalAlign === style.verticalAlign &&
                (el.writingMode ?? "horizontal") === style.writingMode &&
                (el.textInsets ?? []).every((n) => close(n, style.padding)) &&
                (el.paragraphs ?? []).every(
                  (p) =>
                    (p.align ?? el.align) === style.align &&
                    p.runs.every(
                      (run) =>
                        !run.text ||
                        ((run.fontFamily ?? el.fontFamily) ===
                          style.fontFamily &&
                          close(run.fontSize ?? el.fontSize, style.fontSize) &&
                          (run.color ?? el.color) === style.color &&
                          (run.bold ?? el.bold ?? false) === style.bold &&
                          !run.italic &&
                          !run.underline &&
                          !run.baseline),
                    ),
                ) &&
                ["T", "R", "B", "L"].every((side) => {
                  const line = child(props, "ln" + side);
                  return style.borderWidth === 0
                    ? !!child(line, "noFill")
                    : close(
                        attrNumber(line, "w") / EMU_PER_PX,
                        style.borderWidth,
                      ) &&
                        readColor(child(line, "solidFill"), theme)?.color ===
                          style.borderColor;
                })
              );
            }),
          );
          if (compatible) {
            const element: SlideElement = {
              id: uid(),
              type: "table",
              ...geometry,
              opacity,
              table: data,
            };
            const cells = tableTextElements(element).map((el, i) => {
              const row = Math.floor(i / columns.length),
                column = i % columns.length;
              const style = tableCellStyle(data, row, column);
              const override = data.cellStyles?.[row]?.[column];
              const borderOverride =
                override &&
                (override.borderWidth !== undefined ||
                  override.borderColor !== undefined);
              const border =
                style.borders || borderOverride ? 0 : style.borderWidth;
              const padding =
                style.padding +
                (borderOverride && !style.borders ? style.borderWidth : 0);
              const insets = style.textInsets ?? [
                padding,
                padding,
                padding,
                padding,
              ];
              return {
                row,
                span: 1,
                el: {
                  ...el,
                  width: Math.max(
                    1,
                    el.width - border * (column === 0 ? 2 : 1),
                  ),
                  textInsets: [
                    insets[0] + (row === 0 ? border : 0),
                    insets[1],
                    insets[2] + border,
                    insets[3],
                  ] as SlideElement["textInsets"],
                },
              };
            });
            const fitted = await resolveTableRowHeights(
              rowHeights,
              geometry.height,
              cells,
            );
            addElement({
              ...element,
              height: fitted.height,
              table: { ...data, rowHeights: fitted.rowHeights },
            });
            return;
          }
        } catch {
          // Untrusted/obsolete metadata cannot override the native cell data.
        }
      }
      const widths = columns.map(
        (n) => (n / columns.reduce((a, b) => a + b, 0)) * geometry.width,
      );
      const pendingCells: {
        el: SlideElement;
        row: number;
        column: number;
        columnSpan: number;
        span: number;
        x: number;
        diagonalBorders?: TableCellFormat["diagonalBorders"];
      }[] = [];
      const props = child(table, "tblPr"),
        styleId = child(props, "tableStyleId")?.textContent;
      const nativeStyle = child(props, "tableStyle") ?? all(tableStyles, "tblStyle").find(
        (s) => s.getAttribute("styleId") === styleId,
      );
      const style = nativeStyle
        ? resolveTableStyleReferences(nativeStyle, first(themeDoc, "fmtScheme"), (n) => readColor(n, theme))
        : !styleId ? defaultTableGridStyle(node.ownerDocument) : undefined;
      let y = 0;
      rows.forEach((row, r) => {
        const cells = children(row, "tc");
        let c = 0,
          x = 0;
        cells.forEach((cell) => {
          const colSpan = Math.max(
            1,
            Math.min(columns.length - c, attrNumber(cell, "gridSpan", 1)),
          );
          const rowSpan = Math.max(
            1,
            Math.min(rows.length - r, attrNumber(cell, "rowSpan", 1)),
          );
          const cp =
            child(cell, "tcPr") ??
            cell.ownerDocument.createElementNS(
              "http://schemas.openxmlformats.org/drawingml/2006/main",
              "a:tcPr",
            );
          const merged = ["hMerge", "vMerge"].some((key) =>
            ["1", "true"].includes(cell.getAttribute(key) ?? ""),
          );
          const w = widths.slice(c, c + colSpan).reduce((a, b) => a + b, 0),
            h = rowHeights.slice(r, r + rowSpan).reduce((a, b) => a + b, 0);
          const body =
            child(cell, "txBody") ??
            (() => {
              const empty = cell.ownerDocument.createElementNS(
                "http://schemas.openxmlformats.org/drawingml/2006/main",
                "a:txBody",
              );
              for (const name of ["bodyPr", "p"])
                empty.append(
                  cell.ownerDocument.createElementNS(
                    empty.namespaceURI,
                    "a:" + name,
                  ),
                );
              return empty;
            })();
          if (!merged && c < columns.length) {
            const names = ["wholeTbl"];
            if (props?.getAttribute("bandRow") === "1")
              names.push(
                (r - (props.getAttribute("firstRow") === "1" ? 1 : 0)) % 2 === 0
                  ? "band1H"
                  : "band2H",
              );
            if (props?.getAttribute("bandCol") === "1")
              names.push(
                (c - (props.getAttribute("firstCol") === "1" ? 1 : 0)) % 2 === 0
                  ? "band1V"
                  : "band2V",
              );
            if (c === 0 && props?.getAttribute("firstCol") === "1")
              names.push("firstCol");
            if (
              c === columns.length - 1 &&
              props?.getAttribute("lastCol") === "1"
            )
              names.push("lastCol");
            if (r === 0 && props?.getAttribute("firstRow") === "1")
              names.push("firstRow");
            if (r === rows.length - 1 && props?.getAttribute("lastRow") === "1")
              names.push("lastRow");
            if (
              r === 0 &&
              c === 0 &&
              props?.getAttribute("firstRow") === "1" &&
              props?.getAttribute("firstCol") === "1"
            )
              names.push("nwCell");
            if (
              r === 0 &&
              c === columns.length - 1 &&
              props?.getAttribute("firstRow") === "1" &&
              props?.getAttribute("lastCol") === "1"
            )
              names.push("neCell");
            if (
              r === rows.length - 1 &&
              c === 0 &&
              props?.getAttribute("lastRow") === "1" &&
              props?.getAttribute("firstCol") === "1"
            )
              names.push("swCell");
            if (
              r === rows.length - 1 &&
              c === columns.length - 1 &&
              props?.getAttribute("lastRow") === "1" &&
              props?.getAttribute("lastCol") === "1"
            )
              names.push("seCell");
            const styles = names
              .reverse()
              .map((n) => child(style, n))
              .filter((n): n is Element => Boolean(n));
            const fills = [
              cp,
              ...styles.map((s) => child(child(s, "tcStyle"), "fill")),
            ];
            const fillNode = fills.find(
              (n) => child(n, "noFill") || child(n, "solidFill"),
            );
            const fill = child(fillNode, "noFill")
              ? undefined
              : readColor(child(fillNode, "solidFill"), theme);
            const el = makeText(
              body,
              [cell],
              {
                ...geometry,
                x: geometry.x + x,
                y: geometry.y + y,
                width: w,
                height: h,
              },
              parent,
              cp,
              styles
                .map((s) => child(s, "tcTxStyle"))
                .filter((n): n is Element => Boolean(n)),
            );
            // PowerPoint's default table line advance is 1.2 em. Keep it
            // explicit so browser font metrics cannot make a fitted row taller
            // than the same row in PowerPoint (notably with Malgun Gothic).
            for (const paragraph of el.paragraphs ?? []) {
              if (
                paragraph.lineHeight === undefined &&
                paragraph.lineSpacing === undefined
              )
                paragraph.lineHeight = 1.2;
            }
            el.fill = fill?.color ?? "transparent";
            el.fillOpacity = fill?.opacity ?? 1;
            el.borders = ["T", "R", "B", "L"].map((suffix, i) => {
              const side = ["top", "right", "bottom", "left"][i];
              const ln =
                child(cp, "ln" + suffix) ??
                styles
                  .map((s) =>
                    child(
                      child(child(child(s, "tcStyle"), "tcBdr"), side),
                      "ln",
                    ),
                  )
                  .find(Boolean);
              const color = readColor(child(ln, "solidFill"), theme);
              return {
                opacity: color?.opacity ?? 1,
                color: child(ln, "noFill")
                  ? "transparent"
                  : (color?.color ?? "transparent"),
                width: color
                  ? (attrNumber(ln, "w", 12700) / EMU_PER_PX) *
                    Math.abs(parent.sx)
                  : 0,
              };
            }) as NonNullable<SlideElement["borders"]>;
            pendingCells.push({
              el,
              row: r,
              column: c,
              columnSpan: colSpan,
              span: rowSpan,
              x,
              diagonalBorders: readTableDiagonalBorders(cp, styles, (n) => readColor(n, theme), parent.sx),
            });
          }
          const advance = cells.length < columns.length ? colSpan : 1;
          x += widths.slice(c, c + advance).reduce((a, b) => a + b, 0);
          c += advance;
        });
        y += rowHeights[r];
      });
      const fitted = await resolveTableRowHeights(
        rowHeights,
        geometry.height,
        pendingCells,
      );
      rowHeights = fitted.rowHeights;
      geometry.height = fitted.height;
      // Standard PowerPoint tables need no private extension to stay tables.
      // The cells retain their paragraphs, asymmetric edges, padding and merges.
      if (
        rows.length <= MAX_TABLE_ROWS &&
        columns.length <= MAX_TABLE_COLUMNS
      ) {
        try {
          let data = createTable(rows.length, columns.length);
          data.autoRows = false;
          data.header = false;
          data.striped = false;
          let authoredBase = false;
          try {
            const meta = JSON.parse(
              marker && (marker.textContent?.length ?? 0) <= 256 * 1024
                ? (marker.textContent ?? "null")
                : "null",
            );
            if (meta?.version === 1) {
              // Rich cell formatting need not discard the table's editable
              // base style. Read all actual cell content below from DrawingML;
              // metadata supplies only validated defaults, never cell data.
              data = validateTable({
                ...meta.style,
                cells: data.cells,
                cellStyles: undefined,
                merges: undefined,
              });
              data.header = ["1", "true"].includes(
                props?.getAttribute("firstRow") ?? "",
              );
              data.striped = ["1", "true"].includes(
                props?.getAttribute("bandRow") ?? "",
              );
              authoredBase = true;
            }
          } catch {
            /* Optional editor behavior. */
          }
          data.cells = rows.map(() => columns.map(() => ""));
          data.cellStyles = rows.map(() => columns.map(() => null));
          data.columnWidths = widths;
          data.rowHeights = rowHeights;
          data.merges = [];
          for (const { el, row, column, columnSpan, span, diagonalBorders } of pendingCells) {
            data.cells[row][column] = el.text ?? "";
            data.cellStyles[row][column] = {
              fill: el.fill ?? "transparent",
              fillOpacity: el.fillOpacity,
              textOpacity: el.textOpacity,
              strokeOpacity: el.strokeOpacity,
              color: el.color ?? data.color,
              fontFamily: el.fontFamily ?? data.fontFamily,
              fontSize: el.fontSize ?? data.fontSize,
              bold: el.bold ?? false,
              italic: el.italic ?? false,
              underline: el.underline ?? false,
              align: el.align ?? "left",
              verticalAlign: el.verticalAlign ?? "top",
              writingMode: el.writingMode ?? "horizontal",
              padding: 0,
              textInsets: el.textInsets,
              borders: el.borders,
              diagonalBorders,
              paragraphs: el.paragraphs,
            };
            if (authoredBase)
              data.cellStyles[row][column] = inheritTableCellStyle(
                data.cellStyles[row][column]!,
                tableCellStyle({ ...data, cellStyles: undefined }, row, column),
              );
            if (span > 1 || columnSpan > 1)
              data.merges.push({ row, column, rowSpan: span, columnSpan });
          }
          addElement({
            id: uid(),
            type: "table",
            ...geometry,
            opacity: 1,
            table: validateTable(data),
          });
          return;
        } catch {
          // Keep readable cells when a damaged/oversized table is not representable.
        }
      }
      for (const { el, row, span, x, diagonalBorders } of pendingCells) {
        const y = rowHeights.slice(0, row).reduce((a, b) => a + b, 0);
        el.y = geometry.y + y;
        el.height = rowHeights
          .slice(row, row + span)
          .reduce((a, b) => a + b, 0);
        // Rotate each cell's center around the frame center.
        if (geometry.rotation) {
          const a = (geometry.rotation * Math.PI) / 180,
            cx = x + el.width / 2 - geometry.width / 2,
            cy = y + el.height / 2 - geometry.height / 2;
          el.x =
            geometry.x +
            geometry.width / 2 +
            cx * Math.cos(a) -
            cy * Math.sin(a) -
            el.width / 2;
          el.y =
            geometry.y +
            geometry.height / 2 +
            cx * Math.sin(a) +
            cy * Math.cos(a) -
            el.height / 2;
        }
        addElement(el);
        for (const line of fallbackTableDiagonalElements(el, diagonalBorders, uid))
          addElement(line);
      }
      warn("표를 셀별로 편집 가능한 텍스트·배경·테두리로 가져왔습니다.");
    };

    const generatedBorders = compositeBorderNodes(doc);
    const walk = async (
      tree: Element | undefined,
      parent: Transform,
      depth = 0,
      sourceRelationships: Relationship[] = rels,
      decorationsOnly = false,
      sourcePart: string = slidePath!,
      sourceTop?: {part:string; index:number},
    ): Promise<void> => {
      if (!tree) return;
      if (depth > 30) fail("PPTX 그룹 중첩이 너무 깊습니다.");
      for (const [sourceIndex, node] of Array.from(tree.children).entries()) {
        if (generatedBorders.has(node)) {
          if (!sourceTop) slide.pptxSource!.nodes.push({
            part: sourcePart, index: sourceIndex, count: 0,
            signature: "0".repeat(64), derived: true,
          });
          continue;
        }
        if (decorationsOnly && placeholder(node)) continue;
        const elementStart = slide.elements.length;
        const top = sourceTop ?? {part: sourcePart, index: sourceIndex};
        if (!sourceTop && ["sp","cxnSp","pic","grpSp","graphicFrame","AlternateContent","contentPart"].includes(node.localName))
          slide.pptxSource!.nodes.push({...top, count: 0, signature: "0".repeat(64)});
        if (node.localName === "sp" || node.localName === "cxnSp")
          parseShape(node, parent);
        else if (node.localName === "pic")
          await parseImage(node, parent, sourceRelationships);
        else if (node.localName === "grpSp") {
          const xf = child(child(node, "grpSpPr"), "xfrm");
          const off = child(xf, "off");
          const ext = child(xf, "ext");
          const chOff = child(xf, "chOff");
          const chExt = child(xf, "chExt");
          const sx =
            attrNumber(ext, "cx", 1) / (attrNumber(chExt, "cx", 1) || 1);
          const sy =
            attrNumber(ext, "cy", 1) / (attrNumber(chExt, "cy", 1) || 1);
          const rotation = attrNumber(xf, "rot") / 60000;
          const flipH = ["1", "true"].includes(xf?.getAttribute("flipH") ?? "");
          const flipV = ["1", "true"].includes(xf?.getAttribute("flipV") ?? "");
          if (
            rotation &&
            Math.abs(Math.abs(parent.sx) - Math.abs(parent.sy)) > 1e-6
          )
            warn(
              "비균일 배율 안의 회전 그룹은 기울임 변환 일부가 생략될 수 있습니다.",
            );
          const firstElement = slide.elements.length;
          const groupId = uid();
          await walk(
            node,
            {
              x:
                parent.x +
                ((attrNumber(off, "x") - attrNumber(chOff, "x") * sx) /
                  EMU_PER_PX) *
                  parent.sx,
              y:
                parent.y +
                ((attrNumber(off, "y") - attrNumber(chOff, "y") * sy) /
                  EMU_PER_PX) *
                  parent.sy,
              sx: parent.sx * sx,
              sy: parent.sy * sy,
              rotation: parent.rotation,
            },
            depth + 1,
            sourceRelationships,
            decorationsOnly,
            sourcePart,
            top,
          );
          const groupState = readObjectState(node);
          for (let i = firstElement; i < slide.elements.length; i++) {
            const element = slide.elements[i], previousGroups = element.groups ?? [];
            element.groups = [groupId, ...previousGroups];
            if (groupState.name || element.groupNames) element.groupNames = [groupState.name ?? "", ...(element.groupNames ?? previousGroups.map(() => ""))];
            if (groupState.hidden || element.groupHidden) element.groupHidden = [!!groupState.hidden, ...(element.groupHidden ?? previousGroups.map(() => false))];
          }
          if (rotation || flipH || flipV) {
            // Child coordinates are already translated/scaled into slide
            // space. Reflect and rotate their centers around this group's
            // center, after nested groups have applied their own transforms.
            const cx =
              parent.x +
              ((attrNumber(off, "x") + attrNumber(ext, "cx") / 2) /
                EMU_PER_PX) *
                parent.sx;
            const cy =
              parent.y +
              ((attrNumber(off, "y") + attrNumber(ext, "cy") / 2) /
                EMU_PER_PX) *
                parent.sy;
            for (let i = firstElement; i < slide.elements.length; i++)
              slide.elements[i] = transformGroupedElement(
                slide.elements[i],
                cx,
                cy,
                rotation,
                flipH,
                flipV,
              );
          }
        } else if (node.localName === "graphicFrame") {
          if (first(node, "tbl")) await parseTable(node, parent);
          else if (first(node, "chart")) {
            const reference = first(node, "chart"), frame = transformGeometry(child(node, "xfrm"), parent);
            const relationship = sourceRelationships.find(r => r.id === relId(reference) && r.type.endsWith("/chart") && !r.external);
            if (!frame || !relationship?.path) { warn("내장 데이터나 위치 정보가 없는 차트를 제외했습니다."); continue; }
            try {
              const colors = { ...theme.colors };
              for (const [key, value] of Object.entries(theme.map)) if (theme.colors[value]) colors[key] = theme.colors[value];
              const chart = await readChartPackage(relationship.path, colors, theme.minorFont ?? "Arial", readBytes, relationships);
              embeddedAssetBytes += chartBytes(chart);
              if (embeddedAssetBytes > MAX_EXPANDED / 2) fail("내장 차트·이미지·동영상 합계가 100 MB를 초과합니다.");
              let approximate = false;
              try { approximate = readChartModel(chart).approximate; }
              catch { approximate = true; }
              if (approximate) warn("일부 차트 유형·입체 효과·보조 축은 미리보기가 제한됩니다. PPTX 저장 시 원본 차트와 데이터는 유지됩니다.");
              const xfrm = child(node, "xfrm");
              addElement({ id: uid(), type: "chart", ...frame, opacity: 1, chart, alt: "PowerPoint 차트", flipH: xfrm?.getAttribute("flipH") === "1", flipV: xfrm?.getAttribute("flipV") === "1" });
            } catch (error) {
              warn(`차트를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          else if (first(node, "relIds")) {
            const dataRel = sourceRelationships.find(
              (r) =>
                r.id === relId(first(node, "relIds"), "dm") &&
                r.type.endsWith("/diagramData"),
            );
            const data = await readXml(dataRel?.path);
            const drawingId = first(data, "dataModelExt")?.getAttribute(
              "relId",
            );
            const dataRels = dataRel?.path
              ? await relationships(dataRel.path)
              : [];
            const drawingRel = [...sourceRelationships, ...dataRels].find(
              (r) => r.id === drawingId && r.type.endsWith("/diagramDrawing"),
            );
            const drawing = await readXml(drawingRel?.path);
            const frame = transformGeometry(child(node, "xfrm"), parent);
            if (drawingRel?.path && first(drawing, "spTree") && frame) {
              await walk(
                first(drawing, "spTree"),
                {
                  x: frame.x,
                  y: frame.y,
                  sx: parent.sx,
                  sy: parent.sy,
                  rotation: frame.rotation,
                },
                depth + 1,
                await relationships(drawingRel.path),
                false,
                drawingRel.path,
                top,
              );
              warn(
                "SmartArt의 저장된 도형 배치를 개별 편집 개체로 가져왔습니다. 자동 재배치는 지원하지 않습니다.",
              );
            } else
              warn("저장된 도형 배치가 없는 SmartArt는 가져오지 않습니다.");
          } else warn("지원하지 않는 그래픽·미디어 개체를 제외했습니다.");
        } else if (node.localName === "AlternateContent") {
          const fallback = child(node, "Fallback");
          if (fallback)
            await walk(
              fallback,
              parent,
              depth + 1,
              sourceRelationships,
              decorationsOnly,
              sourcePart,
              top,
            );
          else warn("대체 표시 데이터가 없는 확장 콘텐츠를 제외했습니다.");
        } else if (node.localName === "contentPart")
          warn("지원하지 않는 확장 콘텐츠를 제외했습니다.");
        if (["sp", "cxnSp", "pic", "graphicFrame"].includes(node.localName)) {
          const field = importedField(node, slideNumbersStartAtOne);
          if (!slideNumbersStartAtOne && importedField(node) === "slideNumber")
            warn(
              "1 이외의 시작 번호를 사용하는 슬라이드 번호는 표시된 텍스트로 유지했습니다.",
            );
          const properties = first(node, "cNvPr");
          const click = child(properties, "hlinkClick");
          const resolveLink = (
            link: Element | undefined,
          ): SlideElement["hyperlink"] => {
            if (!link) return undefined;
            if (
              link.getAttribute("action") === "ppaction://media" &&
              !relId(link)
            )
              return undefined;
            const relationship = sourceRelationships.find(
              (r) => r.id === relId(link),
            );
            if (
              relationship?.external &&
              relationship.type.endsWith("/hyperlink")
            ) {
              try {
                return validateElementLink({ url: relationship.target });
              } catch {
                warn("지원하지 않는 주소의 하이퍼링크를 제외했습니다.");
                return undefined;
              }
            }
            if (relationship?.path && relationship.type.endsWith("/slide")) {
              const target = slidePathIds.get(relationship.path);
              if (target) return { slideId: target };
            }
            warn(
              "지원하지 않거나 찾을 수 없는 대상의 하이퍼링크를 제외했습니다.",
            );
            return undefined;
          };
          const sameLink = (
            a: SlideElement["hyperlink"],
            b: SlideElement["hyperlink"],
          ) => !!a && !!b && a.url === b.url && a.slideId === b.slideId;
          let hyperlink = resolveLink(click);
          // Native PowerPoint text links live in rPr, often across several
          // differently formatted runs. Promote only an identical link covering
          // every text run; linking unlinked words would change their behavior.
          const runs = [...all(node, "r"), ...all(node, "fld")].filter(
            (run) => (child(run, "t")?.textContent?.length ?? 0) > 0,
          );
          const runClicks = runs.map((run) =>
            child(child(run, "rPr"), "hlinkClick"),
          );
          const textClicks = all(node, "hlinkClick").filter(
            (link) => link !== click,
          );
          if (textClicks.length) {
            const links = runClicks.map(resolveLink);
            const candidate = links[0];
            const fullyCovered =
              !!candidate &&
              links.every((link) => sameLink(link, candidate)) &&
              textClicks.every((link) => runClicks.includes(link));
            if (!click && fullyCovered) hyperlink = candidate;
          }
          for (let i = elementStart; i < slide.elements.length; i++) {
            const state = readObjectState(node);
            if (state.name) slide.elements[i].name = state.name;
            if (state.hidden) slide.elements[i].hidden = true;
            if (state.locked) slide.elements[i].locked = true;
            if (state.hideAudioIcon && slide.elements[i].type === "audio") slide.elements[i].hideDuringShow = true;
            if (state.borders && slide.elements[i].type === "text")
              slide.elements[i].borders = state.borders;
            if (hyperlink) slide.elements[i].hyperlink = hyperlink;
            if (field && slide.elements[i].type === "text")
              slide.elements[i].field = field;
          }
        }
        for (let i = elementStart; i < slide.elements.length; i++) {
          slide.elements[i].pptxRef ??= {
            source: preservationId, part: top.part, index: top.index,
            shape: first(node, "cNvPr")?.getAttribute("id") ?? "",
            instance: slide.elements[i].id,
          };
        }
      }
    };
    if (doc.documentElement.getAttribute("showMasterSp") !== "0") {
      if (layout?.documentElement.getAttribute("showMasterSp") !== "0")
        await walk(first(master, "spTree"), IDENTITY, 0, masterRels, true, masterPath!);
      await walk(first(layout, "spTree"), IDENTITY, 0, layoutRels, true, layoutPath!);
    }
    await walk(first(doc, "spTree"), IDENTITY);
    const audioShapes = new Set(slide.elements.filter(e=>e.type==="audio").map(e=>e.pptxRef?.shape));
    if (all(doc,"audio").some(audio=>!all(audio,"spTgt").some(target=>audioShapes.has(target.getAttribute("spid")??""))))
      warn("개체 효과음·녹음 타이밍 등 아이콘에 연결되지 않은 오디오는 앱에서 재생하지 않으며 원본 PPTX에 보존합니다.");
    const notesDoc = await readXml(
      rels.find((r) => r.type.endsWith("/notesSlide"))?.path,
    );
    if (notesDoc) {
      const notesShapes = all(notesDoc, "sp").filter(
        (sp) => placeholder(sp)?.type === "body",
      );
      needsSource ||= notesShapes.some(sp => all(sp,"rPr").some(r => ["b","i","u"].some(a => r.hasAttribute(a)) || all(r,"solidFill").length > 0));
      slide.notes = notesShapes
        .map((sp) => bodyText(child(sp, "txBody")))
        .join("\n");
    }
    deck.slides.push(slide);
  }
  // Reuse the project validator as a final boundary before handing data to React.
  // Raster artwork later in the presentation can consume the remaining asset
  // budget. Prefer readable slides with video posters over rejecting the deck.
  let assetBytes = deck.slides.reduce(
    (sum, s) =>
      sum +
      s.elements.reduce(
        (n, e) =>
          n +
          (["image", "video", "audio"].includes(e.type)
            ? ((e.src?.length ?? 0) + (e.poster?.length ?? 0)) * 0.75
            : 0),
        0,
      ),
    0,
  );
  for (const s of [...deck.slides].reverse()) {
    for (
      let i = s.elements.length - 1;
      i >= 0 && assetBytes > MAX_EXPANDED / 2;
      i--
    ) {
      const e = s.elements[i];
      if (e.type !== "video" && e.type !== "audio") continue;
      const { src, poster, autoPlay, loop, muted, volume, playAcrossSlides, audioSlideCount, hideDuringShow, type, ...rest } = e;
      assetBytes -= (src?.length ?? 0) * 0.75;
      s.elements[i] = { ...rest, type: "image", src: poster ?? EMPTY_POSTER };
      warn(
        "내장 미디어 합계 100 MiB 제한을 넘는 오디오·동영상은 아이콘 또는 정지 미리보기로 가져왔습니다.",
      );
    }
  }
  await finalizeSource(deck, bytes, needsSource || warnings.size > 0,
    MAX_EXPANDED - jsonLength(deck, MAX_EXPANDED) -
      deck.slides.reduce((n, s) => n + s.elements.length * 250, 1024));
  for (const loss of deck.pptxLosses ?? []) warn(loss);
  if (deck.pptxSources && jsonLength(deck, MAX_EXPANDED) > MAX_EXPANDED) {
    delete deck.pptxSources;
    for (const slide of deck.slides) {
      delete slide.pptxSource;
      for (const e of slide.elements) delete e.pptxRef;
    }
    deck.pptxLosses = ["원본 보존 데이터가 200 MiB 문서 제한을 넘어, 편집기가 지원하지 않는 원본 요소를 저장할 수 없습니다."];
    warn(deck.pptxLosses[0]);
  } else if (deck.pptxSources && needsSource && warnings.size > 0) {
    warn("편집·발표에서 지원하지 않는 요소도 원본 PPTX 데이터로 보관하며, 저장할 때 유지합니다. 매크로·ActiveX·OLE와 외부 연결에는 제한이 있습니다.");
  }
  return { deck: validateDeck(deck), warnings: [...warnings] };
}
