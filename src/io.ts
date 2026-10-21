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
import { drawingTextFrame } from "./drawing-guides";
import { normalizeObjectAlpha, rgbToHsl, hslToRgb } from "./colors";
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
} from "./types";
import { paragraphLines, paragraphText } from "./text-layout";
import { drawingPaths } from "./drawing-path";
import { readTextBody } from "./pptx-text";
import { restoreLayoutXml } from "./pptx-export-layout";
import { writeGroups } from "./object-groups";
import {
  writeObjectState,
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
  validateTable,
} from "./table";
import { resolveDeckFields, validateElementLink } from "./insert-fields";

// The editor uses CSS pixels. OOXML uses English Metric Units and PptxGenJS
// uses inches/points; keeping these conversions in one place avoids drift.
const EMU_PER_PX = 9525;
const PX_PER_INCH = 96;
const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_EXPANDED = 200 * 1024 * 1024;
const MAX_PART = 24 * 1024 * 1024;
const MAX_XML = 8 * 1024 * 1024;
const MAX_IMAGE = 16 * 1024 * 1024;
const MAX_SLIDES = 500;
const MAX_ELEMENTS = 10000;
const MAX_ZIP_FILES = 5000;
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

function rasterMime(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.subarray(0, 6)).match(/^GIF8[79]a$/)
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "image/webp";
  return undefined;
}

function safeImage(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil((MAX_IMAGE * 4) / 3) + 100
  )
    fail(`${label}: 이미지는 16 MB 이하의 내장 이미지여야 합니다.`);
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(
      value as string,
    );
  if (!match || !match[2] || match[2].length % 4 !== 0)
    fail(`${label}: PNG, JPEG, GIF, WebP 데이터 URL만 지원합니다.`);
  let raw: string;
  try {
    raw = atob(match![2]);
  } catch {
    return fail(`${label}: 잘못된 이미지 데이터입니다.`);
  }
  if (
    raw.length > MAX_IMAGE ||
    rasterMime(Uint8Array.from(raw.slice(0, 12), (c) => c.charCodeAt(0))) !==
      match![1].toLowerCase()
  )
    fail(`${label}: 이미지 형식과 데이터가 일치하지 않습니다.`);
  return `data:${match![1].toLowerCase()};base64,${match![2]}`;
}

/** Validate and copy known fields; untrusted project properties never enter app state. */
export function parseDeckJson(text: string): Deck {
  if (text.length > MAX_EXPANDED)
    fail("프로젝트 파일이 너무 큽니다 (최대 200 MB).");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return fail("프로젝트 JSON을 읽을 수 없습니다. 파일 형식을 확인하세요.");
  }
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
      if (!Array.isArray(slide.elements) || slide.elements.length > 1000)
        fail(`${label}: 개체는 1,000개 이하여야 합니다.`);
      elementCount += slide.elements.length;
      if (elementCount > MAX_ELEMENTS)
        fail(
          `프로젝트 개체는 ${MAX_ELEMENTS.toLocaleString()}개 이하여야 합니다.`,
        );
      const elementIds = new Set<string>();
      return {
        id,
        ...(slide.hidden !== undefined
          ? { hidden: booleanValue(slide.hidden, `${label} 숨김`) }
          : {}),
        background: colorValue(slide.background, `${label} 배경`),
        ...(slide.backgroundGradient !== undefined
          ? { backgroundGradient: validateGradient(slide.backgroundGradient) }
          : {}),
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
              ["text", "shape", "image", "table", "video"],
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
          if (elementIds.has(el.id))
            fail(`${label}: 개체 ID가 중복되어 있습니다.`);
          elementIds.add(el.id);
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
          if (el.type === "table") {
            el.table = validateTable(source.table);
            elementCount += el.table.cells.length * el.table.cells[0].length;
            if (elementCount > MAX_ELEMENTS)
              fail("표 셀을 포함한 프로젝트 개체 수가 10,000개를 초과합니다.");
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
  return deck;
}

export function serializeDeck(deck: Deck): string {
  return JSON.stringify(
    parseDeckJson(JSON.stringify(resolveDeckFields(deck))),
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
        if (body && style.paragraphs) {
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
              paragraphs: style.paragraphs,
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
        if (cp && style.textInsets)
          ["marT", "marR", "marB", "marL"].forEach((key, i) =>
            cp.setAttribute(
              key,
              String(Math.round(style.textInsets![i] * EMU_PER_PX)),
            ),
          );
        if (cp && style.fill === "transparent") {
          child(cp, "solidFill")?.remove();
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
export async function exportPptx(input: Deck): Promise<Uint8Array> {
  const deck = parseDeckJson(JSON.stringify(resolveDeckFields(input)));
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
  for (const source of deck.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(source.background, "FFFFFF") };
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
      } else if (el.type === "video") {
        slide.addMedia({
          ...box,
          type: "video",
          data: el.src!,
          cover: el.poster ?? EMPTY_POSTER,
          extn: el.src!.startsWith("data:video/webm") ? "webm" : "mp4",
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
                transparency,
                color: hex(el.stroke, "172033"),
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
  for (const [index, slide] of deck.slides.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    let xml = await zip.file(path)!.async("string");
    const doc = xmlDocument(xml, path);
    if (slide.hidden) doc.documentElement.setAttribute("show", "0");
    else doc.documentElement.removeAttribute("show");
    if (slide.backgroundGradient) {
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
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** Reject oversized/ambiguous ZIPs before JSZip allocates decompressed data. */
function checkZip(bytes: Uint8Array): Map<string, number> {
  if (bytes.length > MAX_ARCHIVE) fail("PPTX 파일은 256 MiB 이하여야 합니다.");
  if (bytes.length < 22) fail("올바른 PPTX ZIP 파일이 아닙니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) fail("PPTX ZIP 디렉터리를 찾을 수 없습니다.");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0 ||
    view.getUint16(end + 8, true) !== count
  )
    fail("분할 ZIP은 지원하지 않습니다.");
  if (count === 65535 || start === 0xffffffff || centralSize === 0xffffffff)
    fail("ZIP64 PPTX는 지원하지 않습니다.");
  if (count > MAX_ZIP_FILES || start + centralSize > end)
    fail("PPTX 파일 수 또는 디렉터리 크기가 제한을 초과합니다.");
  const names = new Set<string>();
  const sizes = new Map<string, number>();
  const decoder = new TextDecoder();
  let at = start;
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50)
      fail("손상된 PPTX ZIP 디렉터리입니다.");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    if (flags & 1 || (method !== 0 && method !== 8))
      fail("암호화되었거나 지원하지 않는 압축 형식의 PPTX입니다.");
    if (
      at + 46 + nameLength + extraLength + commentLength >
      start + centralSize
    )
      fail("손상된 PPTX ZIP 항목입니다.");
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (
      !name ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.includes("\0") ||
      name.split("/").some((p) => p === ".." || p === ".") ||
      names.has(name)
    )
      fail("PPTX에 잘못되거나 중복된 파일 경로가 있습니다.");
    names.add(name);
    sizes.set(name, size);
    expanded += size;
    if (size > MAX_PART || expanded > MAX_EXPANDED)
      fail("PPTX 압축 해제 크기가 제한을 초과합니다.");
    if ((name.endsWith(".xml") || name.endsWith(".rels")) && size > MAX_XML)
      fail("PPTX XML 항목이 너무 큽니다.");
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at !== start + centralSize)
    fail("PPTX ZIP 디렉터리 길이가 일치하지 않습니다.");
  return sizes;
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
function xmlDocument(text: string, path: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    fail(`${path}: DTD/ENTITY XML은 지원하지 않습니다.`);
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (
    xml.getElementsByTagName("parsererror").length ||
    xml.documentElement.localName === "parsererror"
  )
    fail(`${path}: XML이 손상되었습니다.`);
  return xml;
}
function resolvePart(from: string, target: string): string | undefined {
  if (
    !target ||
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.includes("\\") ||
    target.startsWith("//")
  )
    return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(target.split("#")[0]);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const stack = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const item of decoded.split("/")) {
    if (item === "..") {
      if (!stack.length) return undefined;
      stack.pop();
    } else if (item && item !== ".") stack.push(item);
  }
  return stack.join("/");
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
          Math.round(clamp(attrNumber(node, k) / 100000, 0, 1) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
  if (!value) return undefined;
  let rgb = [1, 3, 5].map((i) => Number.parseInt(value!.slice(i, i + 2), 16));
  let opacity = 1;
  for (const transform of Array.from(node.children)) {
    const amount = attrNumber(transform, "val", 100000) / 100000;
    if (transform.localName === "tint")
      rgb = rgb.map((c) => c * amount + 255 * (1 - amount));
    if (transform.localName === "shade") rgb = rgb.map((c) => c * amount);
    if (/^(?:lum|sat|hue)(?:Mod|Off)?$/.test(transform.localName)) {
      const name = transform.localName,
        hsl = rgbToHsl(rgb),
        index = name.startsWith("hue") ? 0 : name.startsWith("sat") ? 1 : 2;
      const val =
        index === 0 ? attrNumber(transform, "val", 0) / 60000 : amount;
      hsl[index] = name.endsWith("Mod")
        ? hsl[index] * amount
        : name.endsWith("Off")
          ? hsl[index] + val
          : val;
      rgb = hslToRgb(hsl);
    }
    if (transform.localName === "alpha") opacity = amount;
    if (transform.localName === "alphaMod") opacity *= amount;
    if (transform.localName === "alphaOff") opacity += amount;
  }
  return {
    color:
      "#" +
      rgb
        .map((c) =>
          Math.round(clamp(c, 0, 255))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase(),
    opacity: clamp(opacity, 0, 1),
  };
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
    ...(["image", "video"].includes(element.type) ||
    (element.type === "shape" && !line)
      ? {
          flipH: Boolean(element.flipH) !== flipH,
          flipV: Boolean(element.flipV) !== flipV,
        }
      : {}),
  };
}
function placeholder(
  node: Element,
): { type: string; index: string | null } | undefined {
  const ph = first(
    ["nvSpPr", "nvPicPr", "nvGrpSpPr", "nvGraphicFramePr", "nvCxnSpPr"]
      .map((name) => child(node, name))
      .find(Boolean),
    "ph",
  );
  return ph
    ? {
        type: ph.getAttribute("type") ?? "obj",
        index: ph.getAttribute("idx"),
      }
    : undefined;
}
function inheritedShape(
  node: Element,
  doc: Document | undefined,
): Element | undefined {
  const ph = placeholder(node);
  if (!ph || !doc) return undefined;
  const shapes = all(doc, "sp");
  const sameType = (type: string | undefined) =>
    type === ph.type ||
    (["title", "ctrTitle"].includes(ph.type) &&
      ["title", "ctrTitle"].includes(type ?? ""));
  return (
    (ph.index !== null
      ? shapes.find((candidate) => {
          const p = placeholder(candidate);
          return p?.index === ph.index && sameType(p.type);
        })
      : undefined) ??
    (ph.index !== null
      ? shapes.find((candidate) => placeholder(candidate)?.index === ph.index)
      : undefined) ??
    shapes.find((candidate) => sameType(placeholder(candidate)?.type))
  );
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
 * explicit warnings; no remote relationship, macro, OLE object, or SVG executes.
 */
export async function importPptx(
  data: ArrayBuffer | Uint8Array,
): Promise<ImportResult> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const partSizes = checkZip(bytes);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, { createFolders: false });
  } catch {
    return fail(
      "PPTX 압축 파일을 읽을 수 없습니다. 암호화 또는 파일 손상을 확인하세요.",
    );
  }
  const warnings = new Set<string>();
  const warn = (text: string) => warnings.add(text);
  let readTotal = 0;
  const xmlCache = new Map<string, Document>();
  const imageCache = new Map<string, string>();
  const videoCache = new Map<string, string | null>();
  let embeddedAssetBytes = 0;
  const readBytes = async (
    path: string,
    limit = MAX_PART,
  ): Promise<Uint8Array | undefined> => {
    const file = zip.file(path);
    if (!file) return undefined;
    // Stream and count actual output as well as the declared ZIP sizes.
    return new Promise<Uint8Array>((resolve, reject) => {
      const pieces: Uint8Array[] = [];
      let total = 0;
      let settled = false;
      // JSZip documents this API but its v3 declarations omit it on ZipObject.
      const stream = (
        file as JSZip.JSZipObject & {
          internalStream(
            type: "uint8array",
          ): JSZip.JSZipStreamHelper<Uint8Array>;
        }
      ).internalStream("uint8array");
      stream.on("data", (chunk) => {
        if (settled) return;
        total += chunk.length;
        readTotal += chunk.length;
        if (total > limit || readTotal > MAX_EXPANDED) {
          settled = true;
          stream.pause();
          reject(new Error("PPTX 압축 해제 데이터가 허용 크기를 초과합니다."));
          return;
        }
        pieces.push(chunk);
      });
      stream.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      stream.on("end", () => {
        if (settled) return;
        settled = true;
        const result = new Uint8Array(total);
        let offset = 0;
        for (const piece of pieces) {
          result.set(piece, offset);
          offset += piece.length;
        }
        resolve(result);
      });
      stream.resume();
    });
  };
  const readXml = async (
    path: string | undefined,
  ): Promise<Document | undefined> => {
    if (!path) return undefined;
    if (xmlCache.has(path)) return xmlCache.get(path)!;
    const raw = await readBytes(path, MAX_XML);
    if (!raw) return undefined;
    const doc = xmlDocument(new TextDecoder().decode(raw), path);
    xmlCache.set(path, doc);
    return doc;
  };
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
        !entry.dir && /vbaProject|activeX|embeddings\//i.test(path),
    )
  )
    warn("매크로, ActiveX, OLE 첨부 개체는 가져오지 않습니다.");
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
    const themeDoc = await readXml(
      masterRels.find((r) => r.type.endsWith("/theme"))?.path ??
        presentationRels.find((r) => r.type.endsWith("/theme"))?.path,
    );
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
    const backgroundNode =
      first(doc, "bg") ?? first(layout, "bg") ?? first(master, "bg");
    const bgColor =
      readColor(child(child(backgroundNode, "bgPr"), "solidFill"), theme) ??
      readColor(child(backgroundNode, "bgRef"), theme);
    const bgGradient = readGradient(
      child(child(backgroundNode, "bgPr"), "gradFill"),
      (n) => readColor(n, theme),
    );
    if (backgroundNode && !bgColor && !bgGradient)
      warn(
        "일부 배경의 그라데이션·이미지·효과는 단색 배경으로 대체되었습니다.",
      );
    const slide: Slide = {
      id: importedSlideIds[slideIndex],
      ...(["0", "false"].includes(
        doc.documentElement.getAttribute("show") ?? "",
      )
        ? { hidden: true }
        : {}),
      background: bgColor?.color ?? "#FFFFFF",
      ...(bgGradient ? { backgroundGradient: bgGradient } : {}),
      notes: "",
      transition: "none",
      elements: [],
    };
    const transition = first(doc, "transition");
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
        "audio",
      ].some((name) => first(first(doc, "timing"), name))
    )
      warn(
        "개체 애니메이션·오디오와 복잡한 미디어 타이밍은 가져오지 않습니다. 동영상의 자동 시작·반복·음소거는 보존합니다.",
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
      if (el.type === "image" || el.type === "video")
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
          return solid.opacity === 0
            ? { color: "transparent", opacity: 1 }
            : solid;
        const gradient = readGradient(child(properties, "gradFill"), (n) =>
          readColor(n, theme),
        );
        if (gradient)
          return { color: gradient.stops[0].color, opacity: 1, gradient };
        if (child(properties, "pattFill") || child(properties, "blipFill"))
          warn("도형의 패턴·그림 채우기는 가져오지 않습니다.");
        const reference = readColor(
          child(child(node, "style"), "fillRef"),
          theme,
        );
        if (
          reference &&
          child(child(node, "style"), "fillRef")?.getAttribute("idx") !== "0"
        )
          return reference;
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
      for (const node of nodes) {
        const line = child(child(node, "spPr"), "ln");
        if (line) {
          const color =
            readColor(child(line, "solidFill"), theme) ??
            readColor(child(child(node, "style"), "lnRef"), theme);
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
              type: [
                "triangle",
                "stealth",
                "diamond",
                "oval",
                "arrow",
              ].includes(type)
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
          const custom = children(child(line, "custDash"), "ds").flatMap(
            (n) => [attrNumber(n, "d") / 100000, attrNumber(n, "sp") / 100000],
          );
          const dash = (
            custom.length
              ? custom
              : presets[child(line, "prstDash")?.getAttribute("val") ?? ""]
          )?.map((n) => Math.max(0.01, n * width));
          return {
            color:
              color?.opacity === 0
                ? "transparent"
                : (color?.color ?? "transparent"),
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
      const xfrm = chain
        .map((s) => child(child(s, "spPr"), "xfrm"))
        .find(Boolean);
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
          textFrame: sourceTextFrame ?? [
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
      const xfrm = child(child(node, "spPr"), "xfrm");
      const geometry = transformGeometry(xfrm, parent);
      if (!geometry) {
        warn("위치 정보를 찾을 수 없는 이미지를 제외했습니다.");
        return;
      }
      const media = first(node, "media"),
        legacyVideo = first(node, "videoFile");
      if (media || legacyVideo) {
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
            const posterRel = pictureRelationships.find(
              (r) =>
                r.id === relId(first(child(node, "blipFill"), "blip"), "embed"),
            );
            let poster = posterRel?.path
              ? imageCache.get(posterRel.path)
              : undefined;
            if (!poster && posterRel?.path && !posterRel.external) {
              const raw = await readBytes(posterRel.path, MAX_IMAGE),
                mime = raw && rasterMime(raw);
              if (raw && mime) {
                poster = bytesDataUrl(raw, mime);
                imageCache.set(posterRel.path, poster);
              }
            }
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
      const imageRel = pictureRelationships.find(
        (r) => r.id === relId(blip, "embed"),
      );
      if (!imageRel?.path || imageRel.external) {
        warn("내장 데이터가 없는 연결 이미지를 제외했습니다.");
        return;
      }
      let src = imageCache.get(imageRel.path);
      if (!src) {
        let raw = await readBytes(imageRel.path, MAX_IMAGE);
        let mime = raw && rasterMime(raw);
        if (
          raw &&
          !mime &&
          ((raw[0] === 0x49 &&
            raw[1] === 0x49 &&
            raw[2] === 42 &&
            raw[3] === 0) ||
            (raw[0] === 0x4d &&
              raw[1] === 0x4d &&
              raw[2] === 0 &&
              raw[3] === 42))
        ) {
          try {
            const { default: UTIF } = await import("utif");
            const buffer = new Uint8Array(raw).buffer;
            const pages = UTIF.decode(buffer),
              page = pages[0];
            const w = page?.t256?.[0],
              h = page?.t257?.[0];
            if (
              !Number.isInteger(w) ||
              !Number.isInteger(h) ||
              w <= 0 ||
              h <= 0 ||
              w * h > 16000000
            )
              throw Error("TIFF dimensions");
            UTIF.decodeImage(buffer, page);
            const rgba = UTIF.toRGBA8(page);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const context = canvas.getContext("2d")!;
            context.putImageData(
              new ImageData(new Uint8ClampedArray(rgba), w, h),
              0,
              0,
            );
            src = canvas.toDataURL("image/png");
            canvas.width = canvas.height = 0;
            if (src.length * 0.75 > MAX_IMAGE) throw Error("TIFF output size");
            imageCache.set(imageRel.path, src);
          } catch {
            warn(
              "TIFF 이미지의 크기 또는 압축 방식을 처리할 수 없어 해당 이미지를 제외했습니다.",
            );
            return;
          }
        }
        if (!src && (!raw || !mime)) {
          warn(
            "SVG·EMF·WMF 등 지원하지 않는 이미지 형식은 제외했습니다. PNG/JPEG/GIF/WebP/TIFF 이미지를 지원합니다.",
          );
          return;
        }
        if (!src) {
          let binary = "";
          for (let i = 0; i < raw!.length; i += 32768)
            binary += String.fromCharCode(...raw!.subarray(i, i + 32768));
          src = `data:${mime};base64,${btoa(binary)}`;
          imageCache.set(imageRel.path, src);
        }
      }
      const cropNode = first(node, "srcRect");
      const crop: [number, number, number, number] = ["t", "r", "b", "l"].map(
        (k) => attrNumber(cropNode, k, 0) / 100000,
      ) as [number, number, number, number];
      if (first(node, "audioFile"))
        warn("오디오는 재생 가능한 미디어로 가져오지 않습니다.");
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

    const parseTable = (node: Element, parent: Transform) => {
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
        columns.length > 100 ||
        rows.length > 1000 ||
        columns.some((n) => n <= 0) ||
        heights.some((n) => n <= 0)
      ) {
        warn("표의 행·열 크기를 읽을 수 없습니다.");
        return;
      }
      const rowHeights = heights.map(
        (n) => (n / EMU_PER_PX) * Math.abs(parent.sy),
      );
      const baseHeight = rowHeights.reduce((a, b) => a + b, 0);
      // The saved frame can be shorter than its explicit DrawingML rows.
      // Preserve those rows in every import path, including Studio metadata.
      geometry.height = Math.max(geometry.height, baseHeight);
      // Our native tables retain a small style extension, but cell text and
      // geometry always come from DrawingML. Modified/complex cell formatting
      // falls back to the existing fidelity-preserving per-cell importer.
      const marker = node.getElementsByTagNameNS(TABLE_NS, "table")[0];
      if (marker && (marker.textContent?.length ?? 0) <= 256 * 1024) {
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
                fill?.color === style.fill &&
                el.verticalAlign === style.verticalAlign &&
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
            addElement({
              id: uid(),
              type: "table",
              ...geometry,
              opacity,
              table: data,
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
      }[] = [];
      const props = child(table, "tblPr"),
        styleId = child(props, "tableStyleId")?.textContent;
      const style = all(tableStyles, "tblStyle").find(
        (s) => s.getAttribute("styleId") === styleId,
      );
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
              names.push(c % 2 === 0 ? "band1V" : "band2V");
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
            });
          }
          const advance = cells.length < columns.length ? colSpan : 1;
          x += widths.slice(c, c + advance).reduce((a, b) => a + b, 0);
          c += advance;
        });
        y += rowHeights[r];
      });
      // Saved row heights can be smaller than the frame: PowerPoint grows rows
      // to fit text. Give that extra height to the rows that need it first.
      let spare = Math.max(0, geometry.height - baseHeight);
      const needed = rowHeights.map(() => 0);
      for (const { el, row, span } of pendingCells) {
        if (span !== 1) continue;
        const textHeight =
          (el.paragraphs ?? []).reduce(
            (sum, p) =>
              sum +
              (p.spaceBefore ?? 0) +
              (p.spaceAfter ?? 0) +
              paragraphLines(p).reduce(
                (height, line) =>
                  height +
                  (p.lineSpacing ??
                    Math.max(
                      ...line.map((r) => r.fontSize ?? el.fontSize ?? 32),
                    ) * (p.lineHeight ?? 1.2)),
                0,
              ),
            0,
          ) +
          (el.textInsets?.[0] ?? 0) +
          (el.textInsets?.[2] ?? 0);
        needed[row] = Math.max(needed[row], textHeight - rowHeights[row]);
      }
      const totalNeeded = needed.reduce((a, b) => a + b, 0);
      const allocated = Math.min(spare, totalNeeded);
      rowHeights.forEach((_, r) => {
        rowHeights[r] += totalNeeded
          ? (allocated * needed[r]) / totalNeeded
          : 0;
      });
      spare -= allocated;
      if (spare > 0)
        rowHeights.forEach((_, r) => {
          rowHeights[r] +=
            (spare * heights[r]) / heights.reduce((a, b) => a + b, 0);
        });
      // Standard PowerPoint tables need no private extension to stay tables.
      // The cells retain their paragraphs, asymmetric edges, padding and merges.
      if (
        rows.length <= MAX_TABLE_ROWS &&
        columns.length <= MAX_TABLE_COLUMNS
      ) {
        try {
          const data = createTable(rows.length, columns.length);
          data.autoRows = false;
          try {
            const meta = JSON.parse(marker?.textContent ?? "null");
            if (
              meta?.version === 1 &&
              typeof meta.style?.autoRows === "boolean"
            )
              data.autoRows = meta.style.autoRows;
          } catch {
            /* Optional editor behavior. */
          }
          data.header = false;
          data.striped = false;
          data.cells = rows.map(() => columns.map(() => ""));
          data.cellStyles = rows.map(() => columns.map(() => null));
          data.columnWidths = widths;
          data.rowHeights = rowHeights;
          data.merges = [];
          for (const { el, row, column, columnSpan, span } of pendingCells) {
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
              padding: 0,
              textInsets: el.textInsets,
              borders: el.borders,
              paragraphs: el.paragraphs,
            };
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
      for (const { el, row, span, x } of pendingCells) {
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
    ): Promise<void> => {
      if (!tree) return;
      if (depth > 30) fail("PPTX 그룹 중첩이 너무 깊습니다.");
      for (const node of Array.from(tree.children)) {
        if (generatedBorders.has(node)) continue;
        if (decorationsOnly && placeholder(node)) continue;
        const elementStart = slide.elements.length;
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
          );
          for (let i = firstElement; i < slide.elements.length; i++)
            slide.elements[i].groups = [
              groupId,
              ...(slide.elements[i].groups ?? []),
            ];
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
          if (first(node, "tbl")) parseTable(node, parent);
          else if (first(node, "chart"))
            warn("차트는 이 버전에서 가져오지 않습니다.");
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
            if (state.locked) slide.elements[i].locked = true;
            if (state.borders && slide.elements[i].type === "text")
              slide.elements[i].borders = state.borders;
            if (hyperlink) slide.elements[i].hyperlink = hyperlink;
            if (field && slide.elements[i].type === "text")
              slide.elements[i].field = field;
          }
        }
      }
    };
    if (doc.documentElement.getAttribute("showMasterSp") !== "0") {
      if (layout?.documentElement.getAttribute("showMasterSp") !== "0")
        await walk(first(master, "spTree"), IDENTITY, 0, masterRels, true);
      await walk(first(layout, "spTree"), IDENTITY, 0, layoutRels, true);
    }
    await walk(first(doc, "spTree"), IDENTITY);
    const notesDoc = await readXml(
      rels.find((r) => r.type.endsWith("/notesSlide"))?.path,
    );
    if (notesDoc) {
      const notesShapes = all(notesDoc, "sp").filter(
        (sp) => placeholder(sp)?.type === "body",
      );
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
          (["image", "video"].includes(e.type)
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
      if (e.type !== "video") continue;
      const { src, poster, autoPlay, loop, muted, type, ...rest } = e;
      assetBytes -= (src?.length ?? 0) * 0.75;
      s.elements[i] = { ...rest, type: "image", src: poster ?? EMPTY_POSTER };
      warn(
        "이미지·동영상 합계 100 MiB 제한을 넘는 영상은 정지 미리보기로 가져왔습니다.",
      );
    }
  }
  return { deck: parseDeckJson(JSON.stringify(deck)), warnings: [...warnings] };
}
