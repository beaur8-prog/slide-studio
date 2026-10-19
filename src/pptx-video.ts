import type { SlideElement } from "./types";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const child = (n: Element | undefined, name: string) =>
  Array.from(n?.children ?? []).find((c) => c.localName === name);
const all = (n: Document | Element, name: string) =>
  Array.from(n.getElementsByTagNameNS("*", name));

export function readVideoPlayback(doc: Document, picture: Element) {
  const id = all(picture, "cNvPr")[0]?.getAttribute("id");
  const media = all(doc, "video")
    .map((n) => child(n, "cMediaNode"))
    .find(
      (n) => n && all(n, "spTgt").some((t) => t.getAttribute("spid") === id),
    );
  const time = child(media, "cTn");
  const conditions = Array.from(child(time, "stCondLst")?.children ?? []);
  // PowerPoint often starts the video through a separate mediacall command.
  // Only promote an immediate/with-previous command; click/delayed animation
  // chains stay manual rather than silently playing earlier than authored.
  const immediateCommand = all(doc, "cmd").some((command) => {
    if (
      command.getAttribute("type") !== "call" ||
      !/^play(?:From)?(?:\(|$)/i.test(command.getAttribute("cmd") ?? "")
    )
      return false;
    if (
      !all(command, "spTgt").some(
        (target) => target.getAttribute("spid") === id,
      )
    )
      return false;
    let immediate = false;
    for (let node: Element | null = command; node; node = node.parentElement) {
      if (node.localName !== "cTn") continue;
      if (node.getAttribute("nodeType") === "clickEffect") return false;
      for (const condition of Array.from(
        child(node, "stCondLst")?.children ?? [],
      )) {
        if (
          condition.hasAttribute("evt") ||
          (condition.hasAttribute("delay") &&
            condition.getAttribute("delay") !== "0")
        )
          return false;
        if (condition.getAttribute("delay") === "0") immediate = true;
      }
    }
    return immediate;
  });
  return {
    autoPlay:
      conditions.some(
        (n) => !n.hasAttribute("evt") && n.getAttribute("delay") === "0",
      ) || immediateCommand,
    loop: time?.getAttribute("repeatCount") === "indefinite",
    muted:
      ["1", "true"].includes(media?.getAttribute("mute") ?? "") ||
      media?.getAttribute("vol") === "0",
  };
}

/** Standard media timing, independent of Slide Studio metadata. */
export function writeVideoPlayback(doc: Document, elements: SlideElement[]) {
  const videos = elements.filter((e) => e.type === "video");
  if (!videos.length) return;
  // PptxGenJS numbers media by relationships and shapes by array index, which
  // can collide in a mixed slide. All references below use these unique IDs.
  all(doc, "cNvPr").forEach((n, i) => n.setAttribute("id", String(i + 1)));
  const make = (
    parent: Element,
    name: string,
    attrs: Record<string, string | number> = {},
  ) => {
    const node = doc.createElementNS(P, "p:" + name);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
    parent.appendChild(node);
    return node;
  };
  const timing = make(doc.documentElement, "timing");
  const list = make(
    make(make(make(timing, "tnLst"), "par"), "cTn", {
      id: 1,
      dur: "indefinite",
      nodeType: "tmRoot",
    }),
    "childTnLst",
  );
  let nextId = 2;
  for (const e of videos) {
    const props = all(doc, "cNvPr").find(
      (n) => n.getAttribute("name") === e.id,
    );
    if (!props) continue;
    props.setAttribute("descr", e.alt ?? "동영상");
    const picture = props.parentElement?.parentElement;
    const transform = picture && child(child(picture, "spPr"), "xfrm");
    if (transform) {
      transform.setAttribute("rot", String(Math.round(e.rotation * 60000)));
      transform.setAttribute("flipH", e.flipH ? "1" : "0");
      transform.setAttribute("flipV", e.flipV ? "1" : "0");
    }
    const media = make(make(list, "video"), "cMediaNode", {
      vol: e.muted === false ? 100000 : 0,
      mute: e.muted === false ? 0 : 1,
      showWhenStopped: 1,
    });
    const time = make(media, "cTn", {
      id: nextId++,
      fill: "hold",
      display: 0,
      ...(e.loop !== false ? { repeatCount: "indefinite" } : {}),
    });
    const condition = make(make(time, "stCondLst"), "cond", {
      delay: 0,
      ...(e.autoPlay === false ? { evt: "onClick" } : {}),
    });
    if (e.autoPlay === false)
      make(make(condition, "tgtEl"), "spTgt", {
        spid: props.getAttribute("id")!,
      });
    make(make(media, "tgtEl"), "spTgt", { spid: props.getAttribute("id")! });
  }
}
