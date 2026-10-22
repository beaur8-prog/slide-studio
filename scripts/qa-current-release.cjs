'use strict';
// Installed-app checks for the 1.6.7 fixes. Use a disposable profile only.
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const pptxgen = require('pptxgenjs');
const JSZip = require('jszip');
const sharp = require('sharp');
module.exports = async function verifyCurrentRelease(page, output, { app }) {
  await fs.mkdir(output, { recursive: true });
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-current-release-'));
  const original = path.join(work, '그림 배경.pptx'), saved = path.join(work, '저장 결과.pptx');
  const image = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#1255AA' } }).png().toBuffer();
  const pptx = new pptxgen(); pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addShape(pptx.ShapeType.rect, { x: 1, y: 1, w: 2, h: 1, fill: { color: 'D4613F' }, line: { color: '222222', width: 1 } });
  slide.addShape(pptx.ShapeType.rect, { x: 1, y: 4, w: 2, h: 1, fill: { color: 'FFFFFF', transparency: 100 }, line: { color: 'FFCC00', width: 2 } });
  slide.addNotes('그림 배경·0 크기 도형 검증');
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
  const master = 'ppt/slideMasters/slideMaster1.xml', local = 'ppt/slides/slide1.xml';
  zip.file('ppt/media/release-background.png', image);
  let xml = await zip.file(master).async('string');
  xml = xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/g, '').replace(/(<p:cSld[^>]*>)/, '$1<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdReleaseBackground"><a:alphaModFix amt="60000"/></a:blip><a:srcRect t="10000" r="20000" b="10000" l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>');
  zip.file(master, xml);
  const layout = 'ppt/slideLayouts/slideLayout1.xml';
  zip.file(layout, (await zip.file(layout).async('string')).replace(/<p:bg>[\s\S]*?<\/p:bg>/g, ''));
  const rel = 'ppt/slideMasters/_rels/slideMaster1.xml.rels';
  zip.file(rel, (await zip.file(rel).async('string')).replace('</Relationships>', '<Relationship Id="rIdReleaseBackground" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/release-background.png"/></Relationships>'));
  xml = (await zip.file(local).async('string')).replace(/<p:bg>[\s\S]*?<\/p:bg>/g, '');
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)];
  expect(shapes).toHaveLength(2);
  xml = xml.replace(shapes[1][0], shapes[1][0].replace(/(<a:ext\s+cx="\d+"\s+cy=")\d+/, '$10'));
  zip.file(local, xml);
  zip.file('[Content_Types].xml', (await zip.file('[Content_Types].xml').async('string')).replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>'));
  await fs.writeFile(original, await zip.generateAsync({ type: 'nodebuffer' }));
  const originalRealPath = await fs.realpath(original);
  await app.evaluate(({ dialog }) => { global.__releaseDialogs = { open: dialog.showOpenDialog, save: dialog.showSaveDialog }; });
  const readDeck = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('slide-studio', 1);
    request.onsuccess = () => { const db = request.result; const get = db.transaction('documents').objectStore('documents').get('current'); get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => reject(get.error); };
    request.onerror = () => reject(request.error);
  }));
  const idle = async () => { await expect(page.locator('.busy-backdrop')).toHaveCount(0); await expect(page.locator('.save-indicator')).toHaveText('저장됨'); };
  async function open(file) {
    await app.evaluate(({ dialog, Menu }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); Menu.getApplicationMenu().items.find(x => x.label === 'File').submenu.items.find(x => x.label === 'Open…').click(); }, file);
    await expect(page.locator('.editable-slide .slide-background-image img')).toBeVisible(); await idle();
  }
  try {
    await open(original); await open(original);
    let deck = await readDeck();
    expect(deck.slides[0].backgroundImage).toMatchObject({ crop: [.1, .2, .1, .1], opacity: .6 });
    expect(Buffer.from(deck.slides[0].backgroundImage.src.split(',')[1], 'base64').equals(image)).toBe(true);
    expect(deck.slides[0].elements.filter(x => x.height === 0)).toHaveLength(1);
    expect((await page.evaluate(() => window.desktop.recentFiles())).filter(x => x.path === originalRealPath)).toHaveLength(1);
    await page.getByRole('button', { name: '홈', exact: true }).click();
    await page.locator('.editable-slide [data-type="shape"]').first().click();
    await page.getByLabel('도형 채우기 색', { exact: true }).fill('#66ccff');
    await page.getByLabel('도형 선 색', { exact: true }).fill('#e5aa11');
    const width = page.getByRole('spinbutton', { name: '도형 선 두께', exact: true });
    await width.fill('6.5'); await width.press('Enter');
    await page.getByRole('button', { name: '서식', exact: true }).click();
    const panel = page.locator('.inspector');
    await expect(panel.getByLabel('채우기', { exact: true })).toHaveValue('#66ccff');
    await expect(panel.getByRole('spinbutton', { name: '선 두께', exact: true })).toHaveValue('6.5');
    expect(await panel.locator('.inspector-body').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(output, 'shape-format.png') });
    await page.getByRole('button', { name: '서식 패널 닫기', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.locator('.editable-slide [data-type="shape"].selected')).toHaveCount(1);
    await idle();
    await page.screenshot({ path: path.join(output, 'picture-background.png') });
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect.poll(() => fs.stat(saved).then(() => true, () => false)).toBe(true); await idle();
    const savedZip = await JSZip.loadAsync(await fs.readFile(saved), { checkCRC32: true });
    const savedXML = await savedZip.file(local).async('string');
    expect(savedXML).toMatch(/<p:bg>[\s\S]*?<a:blipFill>/);
    expect(savedXML).toMatch(/<a:ext[^>]*cy="0"/);
    expect(savedXML).toContain('alphaModFix amt="60000"');
    expect(savedXML).toContain('66CCFF');
    await open(saved); deck = await readDeck();
    expect(deck.slides[0].elements.filter(x => x.height === 0)).toHaveLength(1);
    expect(deck.slides[0].backgroundImage).toMatchObject({ crop: [.1, .2, .1, .1], opacity: .6 });
    await fs.rm(original);
    expect((await page.evaluate(() => window.desktop.recentFiles())).some(x => x.path === originalRealPath)).toBe(false);
    await page.getByTitle('내 프레젠테이션', { exact: true }).click();
    await expect(page.locator('.library-file')).toHaveCount(1);
    await page.screenshot({ path: path.join(output, 'recent-files.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '파일', exact: true }).click();
    await page.getByRole('button', { name: '새 프레젠테이션', exact: true }).click();
    await page.getByRole('button', { name: '제목 슬라이드', exact: true }).click();
    await page.getByRole('button', { name: '만들기', exact: true }).click();
    await idle();
    await expect(page.locator('.editable-slide [data-type="text"]')).toHaveText(['프레젠테이션 제목', '이야기의 시작을 적어보세요']);
    await page.getByRole('button', { name: '도형', exact: true }).click();
    const names = await page.locator('.shape-options button').allTextContents();
    expect(names).toHaveLength(22);
    expect(names.slice(0, 9)).toEqual(['사각형', '둥근 사각형', '타원', '삼각형', '선', '화살표', '마름모', '오각형', '육각형']);
    expect(names).toEqual(expect.arrayContaining(['위쪽 블록 화살표', '아래쪽 블록 화살표']));
    await page.screenshot({ path: path.join(output, 'shape-menu.png') });
    await page.keyboard.press('Escape');
    const shapeDefaults = [];
    for (let i = 0; i < names.length; i++) {
      await page.getByRole('button', { name: '도형', exact: true }).click();
      await page.locator('.shape-options').getByRole('button', { name: names[i], exact: true }).click();
      const selected = page.locator('.editable-slide [data-type="shape"].selected');
      await expect(selected).toHaveCount(1);
      const id = await selected.getAttribute('data-element-id');
      await expect.poll(async () => (await readDeck()).slides[0].elements.at(-1)?.id).toBe(id);
      const item = (await readDeck()).slides[0].elements.at(-1);
      const expected = i < 9 ? { fill: 'transparent', stroke: '#000000', strokeWidth: 3 } : { fill: '#4472C4', stroke: 'transparent', strokeWidth: 0 };
      expect(item).toMatchObject(expected);
      await expect(page.getByLabel('도형 채우기 없음', { exact: true })).toBeChecked({ checked: i < 9 });
      await expect(page.getByRole('spinbutton', { name: '도형 선 두께', exact: true })).toHaveValue(String(expected.strokeWidth));
      const ribbon = await page.locator('.ribbon').evaluate(el => {
        const groups = [...el.children], font = groups.findIndex(g => g.classList.contains('font-group'));
        const shape = groups.findIndex(g => g.classList.contains('shape-format-group'));
        return { betweenFontAndParagraph: shape === font + 1 && groups[shape + 1].querySelector('.group-label')?.textContent === '단락',
          sameRow: groups[font].getBoundingClientRect().top === groups[shape].getBoundingClientRect().top,
          noOverflow: el.scrollWidth <= el.clientWidth + 1 };
      });
      expect(ribbon).toEqual({ betweenFontAndParagraph: true, sameRow: true, noOverflow: true });
      if (i === 9) await page.screenshot({ path: path.join(output, 'blue-shape.png') });
      shapeDefaults.push({ name: names[i], ...expected });
      await page.getByRole('button', { name: '실행 취소', exact: true }).click();
      await expect(page.locator('.editable-slide [data-element-id]')).toHaveCount(3);
    }
    for (const name of ['위쪽 블록 화살표', '아래쪽 블록 화살표']) {
      await page.getByRole('button', { name: '도형', exact: true }).click();
      await page.locator('.shape-options').getByRole('button', { name, exact: true }).click();
    }
    await idle();
    const arrows = (await readDeck()).slides[0].elements.slice(-2);
    expect(arrows.every(item => item.paths?.length === 1 && item.paths[0].d.endsWith('Z'))).toBe(true);
    const arrowFile = path.join(work, '블록 화살표.pptx');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, arrowFile);
    await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
    await expect.poll(() => fs.stat(arrowFile).then(() => true, () => false)).toBe(true); await idle();
    await app.evaluate(({ dialog, Menu }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      Menu.getApplicationMenu().items.find(x => x.label === 'File').submenu.items.find(x => x.label === 'Open…').click();
    }, arrowFile);
    await expect(page.locator('.editable-slide [data-element-id]')).toHaveCount(5); await idle();
    const restoredArrows = (await readDeck()).slides[0].elements.slice(-2);
    // OOXML reconstruction can insert whitespace between commands and numbers.
    // Compare command/number tokens and all other path properties, not spelling.
    const geometry = paths => paths.map(({ d, ...properties }) => ({ ...properties,
      tokens: d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)
        .map(token => /^[a-zA-Z]$/.test(token) ? token : Number(token)) }));
    for (let i = 0; i < 2; i++) {
      expect(geometry(restoredArrows[i].paths)).toEqual(geometry(arrows[i].paths));
      expect(restoredArrows[i].fill.toUpperCase()).toBe('#4472C4');
    }
    const version = await app.evaluate(({ app }) => app.getVersion());
    await fs.writeFile(path.join(output, 'shape-insertion.json'), JSON.stringify({ version, all22ShapeDefaults: true,
      topThreeRowsNoFillBlack3: true, remainingShapesBlue: true, homeShapeFormattingBetweenFontAndParagraph: true,
      newDocumentTitleLayout: true, verticalBlockArrowsPptxRoundTrip: true, shapes: shapeDefaults }, null, 2) + '\n');
    const result = { version, inheritedPictureBackground: true, backgroundCropOpacity: true, nativeBackgroundPptxRoundTrip: true, zeroSizeShapeImportAndRoundTrip: true, homeShapeFormatting: true, compactInspector: true, closeInspectorKeepsSelection: true, repeatedOpenDeduplicated: true, deletedFilePruned: true, all22ShapeDefaults: true, verticalBlockArrowsPptxRoundTrip: true, homeShapeFormattingBetweenFontAndParagraph: true, newDocumentTitleLayout: true };
    await fs.writeFile(path.join(output, 'current-release.json'), JSON.stringify(result, null, 2) + '\n');
    console.log('Current release: picture background, zero-size shape, Home formatting, inspector and recent files verified.');
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = global.__releaseDialogs.open; dialog.showSaveDialog = global.__releaseDialogs.save; delete global.__releaseDialogs; });
    await fs.rm(work, { recursive: true, force: true });
  }
};
