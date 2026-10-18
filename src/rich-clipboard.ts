/** Keep only text, paragraph boundaries and supported inline formatting. Never retain URLs, images, scripts or source attributes. */
export function richClipboardHtml(html: string): string | undefined {
  if (!html || html.length > 2_000_000) return;
  const doc = new DOMParser().parseFromString(html, "text/html"),
    out = document.createElement("div");
  let count = 0;
  const walk = (node: Node, parent: HTMLElement) => {
    if (++count > 20000) throw Error("Clipboard too large");
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (!(node instanceof Element)) return;
    if (
      [
        "SCRIPT",
        "STYLE",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "SVG",
        "MATH",
        "IMG",
        "VIDEO",
        "AUDIO",
        "LINK",
        "META",
        "INPUT",
        "BUTTON",
      ].includes(node.tagName)
    )
      return;
    if (node.tagName === "BR") {
      parent.append(document.createElement("br"));
      return;
    }
    const block = [
        "P",
        "DIV",
        "LI",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "BLOCKQUOTE",
        "TR",
      ].includes(node.tagName),
      dest = document.createElement(block ? "div" : "span");
    const style = (node as HTMLElement).style;
    for (const key of [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "textDecoration",
      "color",
      "textAlign",
    ] as const) {
      const value = style?.[key];
      if (
        !value ||
        value.length > 200 ||
        /url|var\(|expression|[<>]/i.test(value)
      )
        continue;
      if (key === "fontSize") {
        const n = parseFloat(value);
        if (!Number.isFinite(n) || n <= 0 || n > 1000) continue;
      }
      dest.style[key] = value;
    }
    if (["B", "STRONG"].includes(node.tagName)) dest.style.fontWeight = "bold";
    if (["I", "EM"].includes(node.tagName)) dest.style.fontStyle = "italic";
    if (node.tagName === "U") dest.style.textDecoration = "underline";
    if (node.tagName === "LI")
      dest.append(
        document.createTextNode(
          node.parentElement?.tagName === "OL"
            ? `${Array.from(node.parentElement.children).indexOf(node) + 1}. `
            : "• ",
        ),
      );
    for (const child of Array.from(node.childNodes)) walk(child, dest);
    if (dest.childNodes.length) parent.append(dest);
  };
  try {
    for (const child of Array.from(doc.body.childNodes)) walk(child, out);
  } catch {
    return;
  }
  return out.textContent?.length ? out.innerHTML : undefined;
}
