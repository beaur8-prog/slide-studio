import { copyElements } from "./object-groups";
import type { Deck, Slide, SlideElement, ShapeKind } from "./types";

export const uid = () => crypto.randomUUID();
export const THEMES = [
  {
    id: "studio",
    name: "스튜디오",
    background: "#FAF8F2",
    text: "#233D35",
    accent: "#D4613F",
    secondary: "#E7EBDD",
  },
  {
    id: "paper",
    name: "페이퍼",
    background: "#FFFFFF",
    text: "#24272D",
    accent: "#CC523A",
    secondary: "#F1ECE7",
  },
  {
    id: "night",
    name: "미드나이트",
    background: "#1E2634",
    text: "#F5F5F0",
    accent: "#B6CAFF",
    secondary: "#343E52",
  },
  {
    id: "ocean",
    name: "오션",
    background: "#EFF5F8",
    text: "#214B63",
    accent: "#3E86AB",
    secondary: "#D1E4EC",
  },
  {
    id: "rose",
    name: "로즈",
    background: "#F8F0EF",
    text: "#513834",
    accent: "#B85B63",
    secondary: "#EED8D7",
  },
];
export function element(
  type: SlideElement["type"],
  props: Partial<SlideElement> = {},
): SlideElement {
  return {
    id: uid(),
    type,
    x: 100,
    y: 100,
    width: type === "text" ? 480 : 260,
    height: type === "text" ? 70 : 180,
    rotation: 0,
    opacity: 1,
    ...(type === "text"
      ? {
          text: "텍스트를 입력하세요",
          fontFamily: "Arial",
          fontSize: 32,
          color: "#233D35",
          align: "left",
          verticalAlign: "top",
        }
      : {}),
    ...(type === "shape"
      ? {
          shape: "rect" as ShapeKind,
          fill: "#D4613F",
          stroke: "transparent",
          strokeWidth: 0,
        }
      : {}),
    ...props,
  };
}
export function newSlide(
  layout: string = "blank",
  themeId = "studio",
  width = 1280,
  height = 720,
): Slide {
  const t = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const slide: Slide = {
    id: uid(),
    background: t.background,
    notes: "",
    transition: "none",
    elements: [],
  };
  if (layout === "title")
    slide.elements = [
      element("text", {
        x: 90,
        y: 205,
        width: 1070,
        height: 180,
        text: "프레젠테이션 제목",
        fontSize: 68,
        bold: true,
        color: t.text,
      }),
      element("text", {
        x: 94,
        y: 420,
        width: 1000,
        height: 80,
        text: "이야기의 시작을 적어보세요",
        fontSize: 27,
        color: t.text,
      }),
      element("shape", { x: 94, y: 151, width: 72, height: 6, fill: t.accent }),
    ];
  if (layout === "content" || layout === "two-column") {
    slide.elements = [
      element("text", {
        x: 80,
        y: 70,
        width: 1120,
        height: 80,
        text: "슬라이드 제목",
        fontSize: 48,
        bold: true,
        color: t.text,
      }),
      element("text", {
        x: 84,
        y: 210,
        width: layout === "two-column" ? 505 : 1100,
        height: 360,
        text: "핵심 내용을 입력하세요\n\n생각을 하나씩 정리해 보세요.",
        fontSize: 30,
        color: t.text,
      }),
    ];
    if (layout === "two-column")
      slide.elements.push(
        element("text", {
          x: 680,
          y: 210,
          width: 505,
          height: 360,
          text: "두 번째 내용을 입력하세요",
          fontSize: 30,
          color: t.text,
        }),
      );
  }
  if (width !== 1280 || height !== 720)
    slide.elements = slide.elements.map((e) => ({
      ...e,
      x: (e.x * width) / 1280,
      y: (e.y * height) / 720,
      width: (e.width * width) / 1280,
      height: (e.height * height) / 720,
      fontSize: ((e.fontSize || 32) * width) / 1280,
    }));
  return slide;
}
export function blankDeck(): Deck {
  return {
    id: uid(),
    version: 1,
    name: "제목 없는 프레젠테이션",
    width: 1280,
    height: 720,
    theme: "studio",
    slides: [newSlide("title")],
  };
}
export function sampleDeck(): Deck {
  const deck = blankDeck();
  deck.name = "새로운 가능성의 시작";
  const text = (
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fontSize: number,
    props: Partial<SlideElement> = {},
  ) => element("text", { text, x, y, width, height, fontSize, ...props });
  deck.slides = [
    {
      ...newSlide(),
      notes: "오늘 함께 나눌 아이디어와 이 프레젠테이션의 목적을 소개합니다.",
      elements: [
        text("2026    /    CREATIVE PROPOSAL", 84, 67, 800, 30, 17, {
          color: "#62726A",
        }),
        text("새로운 가능성의\n시작", 80, 221, 800, 205, 76, { bold: true }),
        text("생각을 펼치고, 더 나은 내일을 그립니다.", 86, 472, 800, 48, 25, {
          color: "#62726A",
        }),
        element("shape", {
          shape: "ellipse",
          x: 896,
          y: 160,
          width: 264,
          height: 264,
          fill: "#D4613F",
        }),
        element("shape", {
          shape: "rect",
          x: 896,
          y: 296,
          width: 264,
          height: 264,
          fill: "#233D35",
        }),
        element("shape", {
          shape: "ellipse",
          x: 952,
          y: 353,
          width: 152,
          height: 152,
          fill: "#FAF8F2",
        }),
        text("SLIDE STUDIO", 86, 642, 360, 24, 14, { color: "#62726A" }),
        text("01", 1132, 640, 60, 28, 17, { color: "#62726A", align: "right" }),
      ],
    },
    {
      ...newSlide(),
      notes:
        "문제에서 출발해 아이디어와 실행 방향으로 이어지는 흐름을 설명합니다.",
      elements: [
        text("OUR APPROACH", 84, 65, 800, 28, 16, { color: "#62726A" }),
        text("좋은 질문에서 시작합니다", 80, 130, 1120, 95, 54, { bold: true }),
        ...[
          "무엇을 바꿀까요?",
          "어떤 가능성이 있을까요?",
          "어떻게 시작할까요?",
        ].flatMap((s, i) => [
          text(`0${i + 1}`, 84 + 400 * i, 310, 140, 72, 56, {
            color: "#D4613F",
          }),
          text(s, 84 + 400 * i, 415, 365, 65, 28, { bold: true }),
          text(
            [
              "지금의 경험을 관찰하고\n해결할 문제를 찾습니다.",
              "익숙한 방식에서 한 걸음 벗어나\n새로운 관점을 탐색합니다.",
              "작은 시도로 가능성을 확인하고\n다음 단계로 나아갑니다.",
            ][i],
            84 + 400 * i,
            502,
            355,
            100,
            22,
            { color: "#62726A" },
          ),
        ]),
      ],
    },
    {
      ...newSlide(),
      background: "#233D35",
      notes: "핵심 아이디어 하나를 간결하게 전달합니다.",
      elements: [
        text("THE BIG IDEA", 86, 70, 900, 35, 17, { color: "#C4D2BB" }),
        text("작은 아이디어가\n큰 변화를 만듭니다", 80, 230, 1100, 205, 68, {
          color: "#FAF8F2",
          bold: true,
        }),
        element("shape", {
          x: 86,
          y: 503,
          width: 85,
          height: 6,
          fill: "#EBA783",
        }),
        text(
          "함께 만들고 싶은 변화를 이야기해 보세요.",
          86,
          560,
          1100,
          50,
          27,
          { color: "#C4D2BB" },
        ),
      ],
    },
    {
      ...newSlide(),
      notes: "질문을 받고 다음에 할 일을 정리합니다.",
      elements: [
        text("WHAT’S NEXT", 86, 70, 900, 35, 17, { color: "#62726A" }),
        text("함께, 다음 페이지로", 80, 250, 1100, 110, 68, { bold: true }),
        text("궁금한 점과 생각을 나누어 주세요.", 86, 406, 1000, 65, 28, {
          color: "#62726A",
        }),
        element("shape", {
          shape: "ellipse",
          x: 1055,
          y: 520,
          width: 110,
          height: 110,
          fill: "#D4613F",
        }),
        text("THANK YOU", 86, 623, 700, 30, 18, { color: "#62726A" }),
      ],
    },
  ];
  return deck;
}
export function duplicateSlide(slide: Slide): Slide {
  return {
    ...structuredClone(slide),
    id: uid(),
    elements: copyElements(slide.elements),
  };
}
export function reorder<T>(array: T[], from: number, to: number): T[] {
  const next = [...array];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export function slideTitle(slide: Slide): string {
  return (
    slide.elements
      .find((e) => e.type === "text" && (e.fontSize || 0) >= 32)
      ?.text?.split("\n")[0] || "빈 슬라이드"
  );
}
