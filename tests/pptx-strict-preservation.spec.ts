import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import JSZip from 'jszip';

test('Strict Office namespaces retain audio, pictures and relationships across edited PPTX saves', async ({page}, info) => {
  const zip = await JSZip.loadAsync(await fs.readFile('tests/fixtures/media/native-audio.pptx'));
  const mapping = [
    ['http://schemas.openxmlformats.org/presentationml/2006/main','http://purl.oclc.org/ooxml/presentationml/main'],
    ['http://schemas.openxmlformats.org/drawingml/2006/main','http://purl.oclc.org/ooxml/drawingml/main'],
    ['http://schemas.openxmlformats.org/officeDocument/2006/relationships','http://purl.oclc.org/ooxml/officeDocument/relationships'],
  ];
  for(const file of Object.values(zip.files).filter(f=>!f.dir && /\.(xml|rels)$/.test(f.name))) {
    let xml=await file.async('string');
    for(const [from,to] of mapping) xml=xml.replaceAll(from,to);
    zip.file(file.name,xml);
  }
  const bytes = await zip.generateAsync({type:'uint8array'});
  await page.goto('http://127.0.0.1:5190');
  const result = await page.evaluate(async bytes=>{
    const {importPptx,exportPptx}=await import('/src/io.ts');
    const {default:JSZip}=await import('/node_modules/.vite/deps/jszip.js');
    let data=new Uint8Array(bytes),deck=(await importPptx(data)).deck;
    const fingerprint=()=>deck.slides.flatMap(s=>s.elements.filter(e=>e.type==='audio').map(e=>({src:e.src,poster:e.poster,volume:e.volume,autoPlay:e.autoPlay})));
    const before=fingerprint(),rounds=[];
    for(let i=0;i<3;i++) {
      deck.slides[0].notes='Strict 원본 보존 '+i;
      data=await exportPptx(deck);
      deck=(await importPptx(data)).deck;
      const z=await JSZip.loadAsync(data);
      rounds.push({audio:fingerprint(),media:Object.keys(z.files).filter(n=>/\.(mp3|wav|m4a)$/.test(n)).length});
    }
    return {before,rounds,bytes:[...data]};
  }, [...bytes]);
  expect(result.before).toHaveLength(3);
  for(const round of result.rounds){expect(round.audio).toEqual(result.before);expect(round.media).toBeGreaterThanOrEqual(3);}
  await fs.writeFile(info.outputPath('strict-audio-roundtrip.pptx'),Buffer.from(result.bytes));
});

test('Strict normalization changes namespaces and relationship types without rewriting text or URLs', async ({page})=>{
  await page.goto('http://127.0.0.1:5190');
  const r=await page.evaluate(async()=>{
    const {xmlDocument,REL_NS}=await import('/src/pptx-package.ts');
    const strict='http://purl.oclc.org/ooxml/officeDocument/relationships';
    const xml=xmlDocument(`<p:sld xmlns:p="http://purl.oclc.org/ooxml/presentationml/main" xmlns:r="${strict}"><p:pic r:embed="rId1"/><p:text>${strict}</p:text></p:sld>`,'strict.xml');
    const rel=xmlDocument(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${strict}/hyperlink" Target="${strict}/literal" TargetMode="External"/></Relationships>`,'strict.rels').documentElement.firstElementChild!;
    return {root:xml.documentElement.namespaceURI,embed:xml.documentElement.firstElementChild!.getAttributeNS(REL_NS,'embed'),text:xml.documentElement.lastElementChild!.textContent,type:rel.getAttribute('Type'),target:rel.getAttribute('Target')};
  });
  expect(r).toEqual({root:'http://schemas.openxmlformats.org/presentationml/2006/main',embed:'rId1',text:'http://purl.oclc.org/ooxml/officeDocument/relationships',type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',target:'http://purl.oclc.org/ooxml/officeDocument/relationships/literal'});
});
