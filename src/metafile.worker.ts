import { convertMetafileToSvg } from "emf-converter";

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  try {
    const svg = await convertMetafileToSvg(event.data, {
      maxWidth: 2048,
      maxHeight: 2048,
      maxCanvasDimension: 2048,
      maxRecords: 50000,
      timeoutMs: 5000,
      gdiAntialias: true,
      idPrefix: "ss-",
    });
    if (!svg || svg.length > 4 * 1024 * 1024)
      throw Error("Unsupported metafile");
    self.postMessage({ svg });
  } catch {
    self.postMessage({ error: true });
  }
};
