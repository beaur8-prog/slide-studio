export type AndroidPrintStatus = "submitted" | "cancelled" | "closed";
export type AndroidPrintDocument = {
  name: string;
  mime: string;
  data: Uint8Array;
  pageWidthMils: number;
  pageHeightMils: number;
  pages: number;
};
type PrintHost = { printDocument?(document: AndroidPrintDocument): Promise<AndroidPrintStatus> };

export function androidPrintHost(): PrintHost | undefined {
  return (window as Window & { slideStudioAndroid?: PrintHost }).slideStudioAndroid;
}

/** Capture only committed slide artwork, independent of reader/editor zoom.
 * The native renderer fits each immutable sheet to the selected paper. */
export async function androidPrintDocument(name: string, width: number, height: number): Promise<AndroidPrintDocument> {
  const slides = [...document.querySelectorAll<HTMLElement>(".print-deck > .print-slide")];
  if (!slides.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("인쇄할 슬라이드가 없습니다.");
  const output = document.implementation.createHTMLDocument(name);
  const base = output.createElement("base");
  base.href = document.baseURI;
  output.head.append(base);
  for (const node of document.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]')) {
    // The desktop @page size competes with Android's selected PrintAttributes.
    // The native layout adapter alone owns sheet dimensions in this document.
    if (node.closest(".print-deck")) continue;
    const copy = node.cloneNode(true) as HTMLStyleElement | HTMLLinkElement;
    if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href;
    output.head.append(copy);
  }
  const style = output.createElement("style");
  style.textContent = `@page{size:auto;margin:0}
    html,body{margin:0!important;padding:0!important;height:auto!important;overflow:visible!important;background:white!important}
    .android-print-sheet{position:relative;overflow:hidden;break-after:page;page-break-after:always;width:${width}px;height:${height}px}
    .android-print-sheet:last-child{break-after:auto;page-break-after:auto}
    .android-print-page{position:absolute;left:0;top:0;width:${width}px;height:${height}px;transform-origin:0 0;overflow:hidden}
    *{print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important;animation:none!important;transition:none!important}`;
  output.head.append(style);
  for (const slide of slides) {
    const sheet = output.createElement("section");
    sheet.className = "android-print-sheet";
    sheet.dataset.sourceWidth = String(width);
    sheet.dataset.sourceHeight = String(height);
    const page = slide.cloneNode(true) as HTMLElement;
    page.className = "android-print-page";
    // No executable document content or playback in the print renderer.
    page.querySelectorAll("script,iframe,video,audio,button,input").forEach(node => node.remove());
    sheet.append(page);
    output.body.append(sheet);
  }
  // Blob URLs belong to the editor WebView. Convert them before handing the
  // snapshot to the separate native WebView; data images already travel intact.
  const blobUrls = new Set(output.documentElement.outerHTML.match(/blob:[^\s"'<>\)]+/g) ?? []);
  let html = "<!doctype html>" + output.documentElement.outerHTML;
  for (const url of blobUrls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error("인쇄할 그림을 읽지 못했습니다.");
    const blob = await response.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("인쇄할 그림을 준비하지 못했습니다."));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(blob);
    });
    html = html.split(url).join(data);
  }
  return {
    name: name.replace(/[\\/:*?"<>|]/g, "_") + ".html",
    mime: "text/html",
    data: new TextEncoder().encode(html),
    pageWidthMils: Math.max(1000, Math.min(48000, Math.round(width / 96 * 1000))),
    pageHeightMils: Math.max(1000, Math.min(48000, Math.round(height / 96 * 1000))),
    pages: slides.length,
  };
}
