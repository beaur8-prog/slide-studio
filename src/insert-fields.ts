import type { Deck, ElementLink, Slide, SlideElement } from "./types";
import { element, THEMES } from "./model";

export function validateElementLink(value: unknown): ElementLink {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("올바른 링크를 입력해 주세요.");
  const link = value as Record<string, unknown>;
  if ((link.url !== undefined) === (link.slideId !== undefined))
    throw new Error("웹 주소 또는 슬라이드 중 하나를 선택해 주세요.");
  if (link.slideId !== undefined) {
    if (
      typeof link.slideId !== "string" ||
      !link.slideId.trim() ||
      link.slideId.length > 160 ||
      /[\u0000-\u001f]/u.test(link.slideId)
    )
      throw new Error("슬라이드 링크가 올바르지 않습니다.");
    return { slideId: link.slideId };
  }
  if (
    typeof link.url !== "string" ||
    link.url.length > 2048 ||
    /[\u0000-\u001f]/u.test(link.url)
  )
    throw new Error("웹 주소는 2,048자 이내로 입력해 주세요.");
  let url: URL;
  try {
    url = new URL(link.url.trim());
  } catch {
    throw new Error("https://로 시작하는 웹 주소를 입력해 주세요.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "사용자 정보가 없는 http 또는 https 웹 주소를 입력해 주세요.",
    );
  return { url: url.href };
}

export function todayText(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Keep generated numbers correct after reordering/deleting slides, including exports. */
export function resolveDeckFields(deck: Deck): Deck {
  let changed = false;
  const slides = deck.slides.map((slide, index) => {
    let slideChanged = false;
    const elements = slide.elements.map((el) => {
      const text =
        el.field === "slideNumber"
          ? String(index + 1)
          : el.field === "date"
            ? todayText()
            : el.text;
      if (text === el.text) return el;
      changed = slideChanged = true;
      return { ...el, text, paragraphs: undefined };
    });
    return slideChanged ? { ...slide, elements } : slide;
  });
  return changed ? { ...deck, slides } : deck;
}

export interface FooterOptions {
  date: boolean;
  automaticDate: boolean;
  dateText: string;
  number: boolean;
  footer: boolean;
  footerText: string;
  skipTitle: boolean;
}

export function applyFooters(
  deck: Deck,
  activeId: string,
  options: FooterOptions,
  all: boolean,
): Deck {
  const theme = THEMES.find((t) => t.id === deck.theme) || THEMES[0];
  const sx = deck.width / 1280,
    sy = deck.height / 720;
  const update = (slide: Slide, index: number): Slide => {
    if (!all && slide.id !== activeId) return slide;
    const elements = slide.elements.filter((el) => !el.field);
    if (options.skipTitle && index === 0) return { ...slide, elements };
    const add = (
      field: NonNullable<SlideElement["field"]>,
      text: string,
      x: number,
      width: number,
      align: "left" | "center" | "right",
    ) => {
      const previous = slide.elements.find((el) => el.field === field);
      elements.push({
        ...element("text", {
          x: x * sx,
          y: 665 * sy,
          width: width * sx,
          height: 30 * sy,
          fontSize: 16 * Math.min(sx, sy),
          color: theme.text,
          align,
        }),
        ...previous,
        text,
        paragraphs: undefined,
        field,
      });
    };
    if (options.date)
      add(
        options.automaticDate ? "date" : "fixedDate",
        options.automaticDate ? todayText() : options.dateText,
        50,
        250,
        "left",
      );
    if (options.footer) add("footer", options.footerText, 330, 620, "center");
    if (options.number)
      add("slideNumber", String(index + 1), 1060, 170, "right");
    return { ...slide, elements };
  };
  return { ...deck, slides: deck.slides.map(update) };
}
