import type { Slide } from "./types";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const child = (node: Element | undefined, name: string) =>
  Array.from(node?.children ?? []).find((n) => n.localName === name);

// Let PptxGenJS package the image and its relationship, then move that image's
// fill into the native slide background. It must not become an editable object.
export function writeBackgroundImage(
  doc: Document,
  image: NonNullable<Slide["backgroundImage"]>,
  objectName: string,
) {
  const picture = Array.from(doc.getElementsByTagNameNS(P, "pic")).find(
    (node) =>
      node.getElementsByTagNameNS(P, "cNvPr")[0]?.getAttribute("name") ===
      objectName,
  );
  const fill = child(picture, "blipFill");
  if (!picture || !fill) throw Error("그림 배경을 PPTX에 저장할 수 없습니다.");
  const cs = child(doc.documentElement, "cSld")!;
  let bg = child(cs, "bg");
  if (!bg) {
    bg = doc.createElementNS(P, "p:bg");
    cs.insertBefore(bg, cs.firstChild);
  }
  bg.replaceChildren();
  const props = doc.createElementNS(P, "p:bgPr");
  const backgroundFill = doc.createElementNS(A, "a:blipFill");
  for (const node of Array.from(fill.childNodes))
    backgroundFill.append(node.cloneNode(true));
  const blip = child(backgroundFill, "blip")!;
  child(blip, "alphaModFix")?.remove();
  const alpha = doc.createElementNS(A, "a:alphaModFix");
  alpha.setAttribute("amt", String(Math.round((image.opacity ?? 1) * 100000)));
  blip.append(alpha);
  child(backgroundFill, "srcRect")?.remove();
  if (image.crop) {
    const crop = doc.createElementNS(A, "a:srcRect");
    ["t", "r", "b", "l"].forEach((name, i) =>
      crop.setAttribute(name, String(Math.round(image.crop![i] * 100000))),
    );
    backgroundFill.insertBefore(crop, child(backgroundFill, "stretch") ?? null);
  }
  props.append(backgroundFill, doc.createElementNS(A, "a:effectLst"));
  bg.append(props);
  picture.remove();
}
