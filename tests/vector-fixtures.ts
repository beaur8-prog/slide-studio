import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

export const SVG_ART = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><defs><linearGradient id="g"><stop stop-color="#1255aa"/><stop offset="1" stop-color="#227799"/></linearGradient><clipPath id="c"><rect x="8" y="8" width="304" height="164" rx="18"/></clipPath></defs><g clip-path="url(#c)"><rect width="320" height="180" fill="url(#g)"/><circle cx="260" cy="70" r="48" fill="#ff9922"/><path d="M25 135L90 30 150 135Z" fill="#fff"/><text x="165" y="145" font-family="Arial" font-size="20" fill="#fff">벡터 그림</text></g></svg>`;
export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Independent, small standards-based streams: solid brush, rectangle, ellipse.
export function emfFixture() {
  const record = (type: number, values: number[]) => {
    const b = Buffer.alloc(8 + values.length * 4);
    b.writeUInt32LE(type);
    b.writeUInt32LE(b.length, 4);
    values.forEach((v, i) => b.writeUInt32LE(v >>> 0, 8 + i * 4));
    return b;
  };
  const records = [
    record(39, [1, 0, 0x002299ff, 0]),
    record(37, [1]),
    record(43, [20, 20, 300, 160]),
    record(42, [80, 30, 240, 150]),
    record(14, [0, 0, 20]),
  ];
  const header = Buffer.alloc(88);
  [
    1,
    88,
    0,
    0,
    320,
    180,
    0,
    0,
    8467,
    4763,
    0x464d4520,
    0x10000,
    88 + records.reduce((s, b) => s + b.length, 0),
    records.length + 1,
  ].forEach((v, i) => header.writeUInt32LE(v, i * 4));
  header.writeUInt16LE(2, 56);
  header.writeUInt32LE(320, 72);
  header.writeUInt32LE(180, 76);
  header.writeUInt32LE(85, 80);
  header.writeUInt32LE(48, 84);
  return Buffer.concat([header, ...records]);
}
export function wmfFixture(placeable = true) {
  const record = (type: number, values: number[]) => {
    const b = Buffer.alloc(6 + values.length * 2);
    b.writeUInt32LE(b.length / 2);
    b.writeUInt16LE(type, 4);
    values.forEach((v, i) => b.writeUInt16LE(v & 65535, 6 + i * 2));
    return b;
  };
  const records = [
    record(0x020b, [0, 0]),
    record(0x020c, [180, 320]),
    record(0x02fc, [0, 0xaa22, 0x0044, 0]),
    record(0x012d, [0]),
    record(0x041b, [160, 300, 20, 20]),
    record(0x0418, [150, 240, 30, 80]),
    record(0, []),
  ];
  const header = Buffer.alloc(18);
  header.writeUInt16LE(1);
  header.writeUInt16LE(9, 2);
  header.writeUInt16LE(0x300, 4);
  header.writeUInt32LE(9 + records.reduce((s, b) => s + b.length / 2, 0), 6);
  header.writeUInt16LE(2, 10);
  header.writeUInt32LE(Math.max(...records.map((b) => b.length / 2)), 12);
  const prefix = Buffer.alloc(22);
  prefix.writeUInt32LE(0x9ac6cdd7);
  prefix.writeInt16LE(320, 10);
  prefix.writeInt16LE(180, 12);
  prefix.writeUInt16LE(96, 14);
  let checksum = 0;
  for (let i = 0; i < 20; i += 2) checksum ^= prefix.readUInt16LE(i);
  prefix.writeUInt16LE(checksum, 20);
  return Buffer.concat([...(placeable ? [prefix] : []), header, ...records]);
}
export async function vectorFixture(
  options: {
    invalidSvg?: boolean;
    svg?: string;
    owner?: "slide" | "layout" | "master";
    background?: boolean;
  } = {},
) {
  const pres = new PptxGenJS();
  pres.layout = "LAYOUT_WIDE";
  const slide = pres.addSlide();
  slide.addText("벡터 호환성", {
    x: 0.5,
    y: 0.2,
    w: 8,
    h: 0.5,
    fontFace: "Arial",
    fontSize: 24,
  });
  const zip = await JSZip.loadAsync(
    (await pres.write({ outputType: "uint8array" })) as Uint8Array,
  );
  const types = ["svg", "emf", "wmf"];
  const media: Record<string, Buffer> = {
    svg: Buffer.from(
      options.svg ??
        (options.invalidSvg
          ? '<svg xmlns="http://www.w3.org/2000/svg"><broken>'
          : SVG_ART),
    ),
    emf: emfFixture(),
    wmf: wmfFixture(),
  };
  for (const [type, data] of Object.entries(media))
    zip.file(`ppt/media/vector.${type}`, data);
  zip.file("ppt/media/vector-fallback.png", PNG, { base64: true });
  const pic = (id: number, kind: string, fallback = false) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Vector ${kind}${fallback ? " fallback" : ""}" descr="${kind} 그림"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${fallback ? "rIdFallback" : "rId" + kind}">${fallback ? '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rIdsvg"/></a:ext></a:extLst>' : ""}</a:blip><a:srcRect t="5000" r="10000" b="5000" l="10000"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm rot="${id === 100 ? 900000 : 0}" flipH="${id === 100 ? 1 : 0}"><a:off x="${500000 + ((id - 100) % 2) * 5000000}" y="${1000000 + Math.floor((id - 100) / 2) * 2600000}"/><a:ext cx="4200000" cy="2300000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  const owner = options.owner ?? "slide";
  const part =
    owner === "slide"
      ? "ppt/slides/slide1.xml"
      : owner === "layout"
        ? "ppt/slideLayouts/slideLayout1.xml"
        : "ppt/slideMasters/slideMaster1.xml";
  if (options.background && owner !== "slide") {
    for (const inherited of [
      "ppt/slides/slide1.xml",
      ...(owner === "master" ? ["ppt/slideLayouts/slideLayout1.xml"] : []),
    ])
      zip.file(
        inherited,
        (await zip.file(inherited)!.async("string")).replace(
          /<p:bg>[\s\S]*?<\/p:bg>/,
          "",
        ),
      );
  }
  let xml = await zip.file(part)!.async("string");
  xml = xml.replace(
    "</p:spTree>",
    types.map((t, i) => pic(100 + i, t)).join("") +
      pic(103, "svg", true) +
      "</p:spTree>",
  );
  if (options.background)
    xml = xml
      .replace(/<p:bg>[\s\S]*?<\/p:bg>/, "")
      .replace(
        /(<p:cSld[^>]*>)/,
        '$1<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdsvg"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>',
      );
  zip.file(part, xml);
  const pieces = part.split("/");
  const name = pieces.pop()!;
  const relPath = [...pieces, "_rels", name + ".rels"].join("/");
  zip.file(
    relPath,
    (await zip.file(relPath)!.async("string")).replace(
      "</Relationships>",
      types
        .map(
          (t) =>
            `<Relationship Id="rId${t}" Type="${R}/image" Target="../media/vector.${t}"/>`,
        )
        .join("") +
        `<Relationship Id="rIdFallback" Type="${R}/image" Target="../media/vector-fallback.png"/></Relationships>`,
    ),
  );
  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  for (const [ext, mime] of [
    ["svg", "image/svg+xml"],
    ["emf", "image/x-emf"],
    ["wmf", "image/x-wmf"],
    ["png", "image/png"],
  ])
    if (!new RegExp(`Extension="${ext}"`).test(contentTypes))
      contentTypes = contentTypes.replace(
        "</Types>",
        `<Default Extension="${ext}" ContentType="${mime}"/></Types>`,
      );
  zip.file("[Content_Types].xml", contentTypes);
  return Buffer.from(
    await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }),
  );
}
