import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("theme backgrounds resolve gradient and raster relationships, and preserve tile placement through edited saves", async ({ page }, info) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { blankDeck, newSlide } = await import("/src/model.ts");
    const { importPptx, exportPptx, serializeDeck, parseDeckJson } = await import("/src/io.ts");
    const { default: JSZip } = await import("/node_modules/.vite/deps/jszip.js");
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: { createRoot } } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { SlideVisual } = await import("/src/SlideCanvas.tsx");
    const deck = blankDeck(); deck.slides = [newSlide(),newSlide(),newSlide(),newSlide()];
    const zip = await JSZip.loadAsync(await exportPptx(deck));
    const A = "http://schemas.openxmlformats.org/drawingml/2006/main", P = "http://schemas.openxmlformats.org/presentationml/2006/main", R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const canvas = document.createElement("canvas");canvas.width=canvas.height=8;
    const context=canvas.getContext("2d")!;context.fillStyle="#FF0000";context.fillRect(0,0,8,8);context.fillStyle="#0000FF";context.fillRect(4,0,4,8);
    const source=canvas.toDataURL("image/png");zip.file("ppt/media/theme-texture.png",source.split(",")[1],{base64:true});
    // A slide master's theme can be cloned independently of the notes theme.
    // Resolve the owning chain instead of relying on a generator's filenames.
    const relationshipPart = (part: string) => {
      const slash = part.lastIndexOf("/");
      return part.slice(0, slash + 1) + "_rels/" + part.slice(slash + 1) + ".rels";
    };
    const relatedPart = async (part: string, kind: string) => {
      const rels = new DOMParser().parseFromString(await zip.file(relationshipPart(part))!.async("string"), "application/xml");
      const relation = Array.from(rels.documentElement.children).find(node => node.getAttribute("Type")?.endsWith("/" + kind) && node.getAttribute("TargetMode") !== "External");
      if (!relation) throw new Error(`Fixture missing ${kind} relationship from ${part}`);
      const target = new URL(relation.getAttribute("Target")!, "https://fixture.invalid/" + part).pathname.slice(1);
      if (!zip.file(target)) throw new Error(`Fixture relationship target is missing: ${target}`);
      return target;
    };
    const themeNames = new Set<string>();
    for (let i = 1; i <= 4; i++) {
      const layout = await relatedPart(`ppt/slides/slide${i}.xml`, "slideLayout");
      const master = await relatedPart(layout, "slideMaster");
      themeNames.add(await relatedPart(master, "theme"));
    }
    for (const themeName of themeNames) {
      const theme=new DOMParser().parseFromString(await zip.file(themeName)!.async("string"),"application/xml");
      const format=theme.getElementsByTagNameNS(A,"fmtScheme")[0];
      let background=Array.from(format.children).find(e=>e.localName==="bgFillStyleLst");
      if(!background){background=theme.createElementNS(A,"a:bgFillStyleLst");format.append(background);}
      theme.documentElement.setAttributeNS("http://www.w3.org/2000/xmlns/", "xmlns:r", R);
      background.innerHTML=`<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill><a:blipFill dpi="96"><a:blip r:embed="rIdThemeTexture"/><a:srcRect/><a:tile sx="200000" sy="150000" tx="28575" ty="19050" algn="tl" flip="xy"/></a:blipFill><a:blipFill><a:blip r:embed="rIdThemeTexture"/><a:srcRect l="12500"/><a:stretch><a:fillRect l="10000" t="20000" r="10000" b="20000"/></a:stretch></a:blipFill>`;
      theme.documentElement.setAttribute("xmlns:r",R);
      zip.file(themeName,new XMLSerializer().serializeToString(theme));
      const from = themeName.split("/").slice(0, -1), to = ["ppt", "media", "theme-texture.png"];
      while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
      const imageTarget = "../".repeat(from.length) + to.join("/");
      zip.file(relationshipPart(themeName),`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdThemeTexture" Type="${R}/image" Target="${imageTarget}"/></Relationships>`);
    }
    for(let i=1;i<=4;i++){
      const part=`ppt/slides/slide${i}.xml`,doc=new DOMParser().parseFromString(await zip.file(part)!.async("string"),"application/xml");
      const cs=doc.getElementsByTagNameNS(P,"cSld")[0];for(const bg of Array.from(cs.children).filter(e=>e.localName==="bg"))bg.remove();
      const bg=doc.createElementNS(P,"p:bg");bg.innerHTML=i===4?'<p:bgPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:bgPr>':`<p:bgRef idx="${1000+i}"><a:srgbClr val="44AA88"/></p:bgRef>`;
      cs.insertBefore(bg,cs.firstChild);zip.file(part,new XMLSerializer().serializeToString(doc));
    }
    zip.file("[Content_Types].xml",(await zip.file("[Content_Types].xml")!.async("string")).replace("</Types>",'<Default Extension="png" ContentType="image/png"/></Types>'));
    let imported=await importPptx(await zip.generateAsync({type:"uint8array"}));
    const rounds=[];
    for(let round=0;round<4;round++){
      const slides=imported.deck.slides;
      rounds.push(structuredClone({gradient:slides[0].backgroundGradient,tile:slides[1].backgroundImage,stretch:slides[2].backgroundImage,solid:slides[3].background,warnings:imported.warnings}));
      if(round===3)break;
      slides[1].backgroundImage!.placement!.tile!.offsetX+=1;
      slides[2].backgroundImage!.placement!.fill[3]+=0.01;
      imported=await importPptx(await exportPptx(imported.deck));
    }
    const persisted=parseDeckJson(serializeDeck(imported.deck));
    const host=document.createElement("div");host.id="theme-background-test";Object.assign(host.style,{position:"fixed",left:"0",top:"0",width:"960px",height:"540px",zIndex:"999999",background:"white"});document.body.append(host);
    createRoot(host).render(React.createElement(SlideVisual,{slide:persisted.slides[1],width:persisted.width,height:persisted.height}));
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {source,themeNames:[...themeNames],rounds,persisted:persisted.slides[1].backgroundImage,patterns:host.querySelectorAll("pattern").length};
  });
  await info.attach("owning-theme-parts", { body: JSON.stringify(result.themeNames), contentType: "application/json" });
  expect(result.patterns).toBe(1);
  for (const [i,r] of result.rounds.entries()) {
    expect(r.gradient?.kind).toBe("radial");expect(r.gradient?.stops.map(s=>s.color)).toEqual(["#44AA88","#000000"]);
    expect(r.tile?.src).toBe(result.source);expect(r.tile?.placement?.tile).toEqual({scaleX:2,scaleY:1.5,offsetX:3+i,offsetY:2,align:"tl",flip:"xy"});
    expect(r.stretch?.src).toBe(result.source);expect(r.stretch?.placement?.fill[3]).toBeCloseTo(0.1+i*0.01,4);
    expect(r.solid).toBe("#ABCDEF");
    expect(r.warnings).not.toContain("일부 배경의 그라데이션·이미지·효과는 단색 배경으로 대체되었습니다.");
  }
  expect(result.persisted).toEqual(result.rounds[3].tile);
  await page.locator("#theme-background-test").screenshot({path:info.outputPath("tiled-background.png")});
});

test("background placement validation rejects invalid and oversized geometry", async ({ page }) => {
  await page.goto("http://127.0.0.1:5190");
  const result=await page.evaluate(async()=>{
    const {blankDeck}=await import("/src/model.ts");const {parseDeckJson}=await import("/src/io.ts");
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const src=canvas.toDataURL("image/png");
    const valid={width:8,height:8,dpi:96,fill:[0,0,0,0],tile:{scaleX:1,scaleY:1,offsetX:0,offsetY:0,align:"tl",flip:"none"}};
    return [{...valid,width:0},{...valid,width:32768,height:32768},{...valid,dpi:0},{...valid,fill:[0,0.6,0,0.6]},{...valid,tile:{...valid.tile,scaleX:0}},{...valid,tile:{...valid.tile,offsetY:Infinity}},{...valid,tile:{...valid.tile,align:"url(example)"}},{...valid,tile:{...valid.tile,flip:"bad"}}].map(placement=>{
      const deck=blankDeck();deck.slides[0].backgroundImage={src,placement};try{parseDeckJson(JSON.stringify(deck));return false;}catch{return true;}
    });
  });
  expect(result.every(Boolean)).toBe(true);
});

test("POI theme gradient and texture backgrounds appear without adding slide objects", async ({page},info)=>{
  const file="qa/samples/poi-themes.pptx";test.skip(!existsSync(file),"Optional pinned Apache POI fixture; see QA source manifest.");
  expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe("3ea86e4ee84a8bca6b99fe3a9f2a9a9186c0655df28ff92a2d02da24926c64ba");
  await page.goto("http://127.0.0.1:5190");
  const result=await page.evaluate(async()=>{const {importPptx}=await import("/src/io.ts");const {deck,warnings}=await importPptx(await(await fetch("/qa/samples/poi-themes.pptx")).arrayBuffer());return {gradient:deck.slides[2].backgroundGradient,texture:deck.slides[4].backgroundImage,others:[7,8].map(i=>({image:!!deck.slides[i].backgroundImage,gradient:!!deck.slides[i].backgroundGradient})),warnings};});
  expect(result.gradient?.kind).toBe("radial");expect(result.texture?.placement?.tile).toBeDefined();expect(result.others.every(s=>s.image||s.gradient)).toBe(true);
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles(file);await expect(page.locator(".thumbnail-row")).toHaveCount(10);await expect(page.locator(".busy-backdrop")).toHaveCount(0);await page.locator(".thumbnail-row").nth(4).click();
  await page.screenshot({path:info.outputPath("poi-texture-restored.png")});
});
