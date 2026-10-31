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
  child(blip, "duotone")?.remove();
  if (image.placement?.duotone) {
    const effect = doc.createElementNS(A, "a:duotone");
    image.placement.duotone.colors.forEach((color, index) => {
      const endpoint = doc.createElementNS(A, "a:srgbClr");
      endpoint.setAttribute("val", color.slice(1));
      const opacity = image.placement!.duotone!.opacities[index];
      if (opacity !== 1) {
        const alpha = doc.createElementNS(A, "a:alpha");
        alpha.setAttribute("val", String(Math.round(opacity * 100000)));
        endpoint.append(alpha);
      }
      effect.append(endpoint);
    });
    blip.append(effect);
  }
  const alpha = doc.createElementNS(A, "a:alphaModFix");
  alpha.setAttribute("amt", String(Math.round((image.opacity ?? 1) * 100000)));
  blip.append(alpha);
  if (image.placement) {
    // Native dpi is unsignedInt; fractional image-header density stays in
    // the original raster bytes and is selected by the schema's dpi=0 value.
    backgroundFill.setAttribute(
      "dpi",
      String(Number.isInteger(image.placement.dpi) ? image.placement.dpi : 0),
    );
    child(backgroundFill, "stretch")?.remove();
    child(backgroundFill, "tile")?.remove();
    const tile = image.placement.tile;
    const placement = doc.createElementNS(A, tile ? "a:tile" : "a:stretch");
    if (tile) {
      for (const [key, value] of Object.entries({
        sx: Math.round(tile.scaleX * 100000),
        sy: Math.round(tile.scaleY * 100000),
        tx: Math.round(tile.offsetX * 9525),
        ty: Math.round(tile.offsetY * 9525),
        algn: tile.align,
        flip: tile.flip,
      }))
        placement.setAttribute(key, String(value));
    } else {
      const rectangle = doc.createElementNS(A, "a:fillRect");
      ["t", "r", "b", "l"].forEach((name, i) =>
        rectangle.setAttribute(
          name,
          String(Math.round(image.placement!.fill[i] * 100000)),
        ),
      );
      placement.append(rectangle);
    }
    backgroundFill.append(placement);
  }
  child(backgroundFill, "srcRect")?.remove();
  if (image.crop) {
    const crop = doc.createElementNS(A, "a:srcRect");
    ["t", "r", "b", "l"].forEach((name, i) =>
      crop.setAttribute(name, String(Math.round(image.crop![i] * 100000))),
    );
    backgroundFill.insertBefore(
      crop,
      child(backgroundFill, "stretch") ?? child(backgroundFill, "tile") ?? null,
    );
  }
  props.append(backgroundFill, doc.createElementNS(A, "a:effectLst"));
  bg.append(props);
  picture.remove();
}
