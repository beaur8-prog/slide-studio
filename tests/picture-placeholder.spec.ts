import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

test("Dickinson picture placeholder inherits its layout bounds, crop and image through three edited saves", async ({ page }, info) => {
  test.setTimeout(120000);
  const source = path.resolve("qa/samples/dickinson-workplace.pptx");
  test.skip(!fs.existsSync(source), "Fetch the pinned public workplace sample first");
  expect(crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex"))
    .toBe("ac7f2627645042190df3244cc25929f4b006d144fc2cac520e79ab376197bbbf");
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { importPptx, exportPptx } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const bytes = await (await fetch("/qa/samples/dickinson-workplace.pptx")).arrayBuffer();
    const source = await JSZip.loadAsync(bytes);
    const original = "data:image/jpeg;base64," + await source.file("ppt/media/image4.jpeg")!.async("base64");
    let imported = await importPptx(bytes);
    let deck = imported.deck;
    const rounds = [];
    for (let round = 0; round < 4; round++) {
      const picture = deck.slides[7].elements.find((e) => e.type === "image" && e.src === original);
      rounds.push({ picture: picture ? { x:picture.x,y:picture.y,width:picture.width,height:picture.height,crop:picture.crop } : null, warnings: imported.warnings });
      if (!picture || round === 3) break;
      picture.x += 1;
      imported = await importPptx(await exportPptx(deck));
      deck = imported.deck;
    }
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const host = document.createElement("div");host.id="picture-placeholder-preview";
    host.style.cssText=`position:fixed;left:0;top:0;width:${deck.width}px;height:${deck.height}px;z-index:999999;background:white`;
    document.body.append(host);
    createRoot(host).render(React.createElement(SlideVisual,{slide:deck.slides[7],width:deck.width,height:deck.height}));
    return { rounds };
  });
  expect(result.rounds).toHaveLength(4);
  for (const [round, resultRound] of result.rounds.entries()) {
    expect(resultRound.picture).not.toBeNull();
    expect(resultRound.picture!.x).toBeCloseTo(64 + round, 4);
    expect(resultRound.picture!.y).toBeCloseTo(176, 4);
    expect(resultRound.picture!.width).toBeCloseTo(840, 4);
    expect(resultRound.picture!.height).toBeCloseTo(472, 4);
    expect(resultRound.picture!.crop).toEqual([0.08463, 0, 0.08463, 0]);
    expect(resultRound.warnings.join("\n")).not.toContain("위치 정보를 찾을 수 없는 이미지");
  }
  await page.locator("#picture-placeholder-preview img").last().waitFor();
  await page.evaluate(() => Promise.all([...document.querySelectorAll<HTMLImageElement>("#picture-placeholder-preview img")].map(i => i.decode())));
  await page.locator("#picture-placeholder-preview").screenshot({path:info.outputPath("picture-restored.png")});
});

test("placeholder indices match layout by identity and master by content type", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { inheritedShape, placeholder } = await import("/src/pptx-placeholder.ts");
    const doc = (s: string) => new DOMParser().parseFromString(s,"application/xml");
    const ns='xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
    const shape = (id:string,type:string,index:string,tag="sp") => `<p:${tag}><p:${tag==="pic"?"nvPicPr":"nvSpPr"}><p:cNvPr id="${id}"/><p:nvPr><p:ph ${type?`type="${type}"`:""} ${index?`idx="${index}"`:""}/></p:nvPr></p:${tag==="pic"?"nvPicPr":"nvSpPr"}></p:${tag}>`;
    const layout=doc(`<p:sldLayout ${ns}><p:cSld><p:spTree>${shape("footer-first","dt","")}${shape("zero","title","")}${shape("first","pic","1")}${shape("second","pic","2")}${shape("content","obj","10")}</p:spTree></p:cSld></p:sldLayout>`);
    const master=doc(`<p:sldMaster ${ns}><p:cSld><p:spTree>${shape("master-title","title","")}${shape("master-body","body","999")}</p:spTree></p:cSld></p:sldMaster>`);
    const node=(type:string,idx:string)=>doc(`<p:sld ${ns}>${shape("slide",type,idx,"pic")}</p:sld>`).getElementsByTagNameNS("*","pic")[0];
    const id=(e:Element|undefined)=>e?.getElementsByTagNameNS("*","cNvPr")[0].getAttribute("id");
    return {
      first:id(inheritedShape(node("pic","1"),layout)), second:id(inheritedShape(node("pic","2"),layout)),
      noType:id(inheritedShape(node("","1"),layout)), defaultIndex:id(inheritedShape(node("title",""),layout)),
      numericIndex:id(inheritedShape(node("pic","01"),layout)), date:id(inheritedShape(node("dt",""),layout)),
      unmatched:id(inheritedShape(node("obj","4294967295"),layout)),
      masterBody:id(inheritedShape(node("pic","1"),master)), masterTitle:id(inheritedShape(node("ctrTitle","1"),master)),
      default:placeholder(node("title","")),
    };
  });
  expect(result).toEqual({first:"first",second:"second",noType:"first",defaultIndex:"zero",numericIndex:"first",date:"footer-first",unmatched:undefined,masterBody:"master-body",masterTitle:"master-title",default:{type:"title",index:"0"}});
});

test("partial placeholder transforms inherit missing dimensions while keeping explicit zero and reflection overrides", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { inheritedTransform } = await import("/src/pptx-placeholder.ts");
    const make=(xfrm:string,tag="sp")=>new DOMParser().parseFromString(`<p:${tag} xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${tag==="graphicFrame"?xfrm:`<p:spPr>${xfrm}</p:spPr>`}</p:${tag}>`,"application/xml").documentElement;
    const read=(e:Element|undefined)=>e?{rotation:e.getAttribute("rot"),flipH:e.getAttribute("flipH"),flipV:e.getAttribute("flipV"),x:e.querySelector("off")?.getAttribute("x"),y:e.querySelector("off")?.getAttribute("y"),cx:e.querySelector("ext")?.getAttribute("cx"),cy:e.querySelector("ext")?.getAttribute("cy")}:null;
    const slide=make('<a:xfrm rot="0" flipH="0"><a:off x="0" y="200"/></a:xfrm>');
    const layout=make('<a:xfrm rot="5400000" flipH="1"><a:ext cx="300" cy="400"/></a:xfrm>');
    const master=make('<a:xfrm flipV="1"><a:off x="100" y="100"/><a:ext cx="500" cy="600"/></a:xfrm>');
    const before=new XMLSerializer().serializeToString(slide);
    return {resolved:read(inheritedTransform([slide,layout,master])),unchanged:new XMLSerializer().serializeToString(slide)===before,none:read(inheritedTransform([make("")])),frame:read(inheritedTransform([make('<p:xfrm><a:off x="9" y="8"/><a:ext cx="7" cy="6"/></p:xfrm>',"graphicFrame")]))};
  });
  expect(result.resolved).toEqual({rotation:"0",flipH:"0",flipV:"1",x:"0",y:"200",cx:"300",cy:"400"});
  expect(result.unchanged).toBe(true);
  expect(result.none).toBeNull();
  expect(result.frame).toEqual({rotation:null,flipH:null,flipV:null,x:"9",y:"8",cx:"7",cy:"6"});
});
