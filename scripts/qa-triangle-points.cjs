'use strict';
// Exercise the installed app with independent preset/custom DrawingML inputs.
const { expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');
const JSZip = require('jszip');

module.exports = async function verifyTrianglePoints(page, output, { app }) {
  const directory = path.join(output, 'triangle-points');
  await fs.mkdir(directory, { recursive: true });
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.addSlide();
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'uint8array' }));
  const geometries = [
    '<a:prstGeom prst="triangle"><a:avLst><a:gd name="adj" fmla="val 20000"/></a:avLst></a:prstGeom>',
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="300" b="240"/><a:pathLst><a:path w="300" h="240"><a:moveTo><a:pt x="-30" y="216"/></a:moveTo><a:lnTo><a:pt x="210" y="-24"/></a:lnTo><a:lnTo><a:pt x="270" y="192"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>',
  ];
  const xml = geometries.map((g, i) => `<p:sp><p:nvSpPr><p:cNvPr id="${i + 2}" name="triangle-${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${(250 + i * 440) * 9525}" y="${220 * 9525}"/><a:ext cx="${300 * 9525}" cy="${240 * 9525}"/></a:xfrm>${g}<a:solidFill><a:srgbClr val="4080C0"/></a:solidFill><a:ln w="28575"><a:solidFill><a:srgbClr val="15283A"/></a:solidFill></a:ln></p:spPr></p:sp>`).join('');
  const filename = 'ppt/slides/slide1.xml';
  zip.file(filename, (await zip.file(filename).async('string')).replace('</p:spTree>', xml + '</p:spTree>'));
  const source = path.join(directory, 'powerpoint-edited-vertices.pptx');
  await fs.writeFile(source, await zip.generateAsync({ type: 'nodebuffer' }));
  const input = page.locator('input[accept*=".pptx"]');
  await input.setInputFiles(source);
  const shapes = page.locator('.editable-slide [data-type="shape"]');
  await expect(shapes).toHaveCount(2);
  const points = target => target.evaluate(node => {
    const curve = node.querySelector('.element-svg path');
    const m = curve.parentElement.transform.baseVal.consolidate().matrix;
    const n = curve.getAttribute('d').match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
    return [0, 2, 4].map(i => [n[i] * m.a / parseFloat(node.style.width), n[i + 1] * m.d / parseFloat(node.style.height)]);
  });
  const closePoints = (actual, expected) => actual.flat().forEach((n, i) => expect(n).toBeCloseTo(expected.flat()[i], 4));
  closePoints(await points(shapes.nth(0)), [[0, 1], [.2, 0], [1, 1]]);
  closePoints(await points(shapes.nth(1)), [[-.1, .9], [.7, -.1], [.9, .8]]);
  const edited = [];
  for (let index = 0; index < 2; index++) {
    const shape = shapes.nth(index);
    await shape.click();
    await expect(page.locator('.shape-point-handle')).toHaveCount(3);
    const point = page.getByTestId('triangle-point-1');
    const before = await points(shape);
    const bounds = await shape.evaluate(e => [e.style.left, e.style.top, e.style.width, e.style.height, e.style.transform]);
    const scale = await page.getByTestId('slide-canvas').evaluate(e => e.getBoundingClientRect().width / e.offsetWidth);
    const b = await point.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30 * scale, y + 24 * scale, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => { const b = await point.boundingBox(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; }).toEqual([Math.round(x + 30 * scale), Math.round(y + 24 * scale)]);
    const after = await points(shape);
    closePoints(after, [before[0], [before[1][0] + .1, before[1][1] + .1], before[2]]);
    expect(await shape.evaluate(e => [e.style.left, e.style.top, e.style.width, e.style.height, e.style.transform])).toEqual(bounds);
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    closePoints(await points(shape), before);
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    closePoints(await points(shape), after);
    edited.push(after);
  }
  const saved = path.join(directory, 'edited-triangles.pptx');
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, saved);
  await page.getByRole('button', { name: 'PPTX 내보내기', exact: true }).click();
  await expect.poll(async () => { try { return (await fs.stat(saved)).size; } catch { return 0; } }).toBeGreaterThan(1000);
  const oldId = await shapes.first().getAttribute('data-element-id');
  await input.setInputFiles(saved);
  await expect(shapes.first()).not.toHaveAttribute('data-element-id', oldId);
  for (let i = 0; i < 2; i++) closePoints(await points(shapes.nth(i)), edited[i]);
  const newId = await shapes.first().getAttribute('data-element-id');
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('slide-studio', 1);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('documents').objectStore('documents').get('current');
      read.onsuccess = () => { resolve(read.result?.slides?.[0]?.elements?.[0]?.id); db.close(); };
      read.onerror = () => { db.close(); reject(Error('Autosave read failed')); };
    };
    request.onerror = () => reject(Error('Autosave open failed'));
  })), { timeout: 15000 }).toBe(newId);
  await page.reload();
  await expect(shapes).toHaveCount(2);
  for (let i = 0; i < 2; i++) closePoints(await points(shapes.nth(i)), edited[i]);
  await shapes.nth(1).click();
  await expect(page.locator('.shape-point-handle')).toHaveCount(3);
  await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 15000 });
  await page.screenshot({ path: path.join(directory, 'triangle-point-handles.png') });
  const result = { version: await app.evaluate(({ app }) => app.getVersion()), platform: process.platform, presetAndEditedSourceVertices: true, vertexDrag: true, boxUnchanged: true, singleStepUndoRedo: true, pptxRoundTrip: true, autoSaveReload: true, points: edited };
  await fs.writeFile(path.join(output, 'triangle-points.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('Native triangle source vertices, dragging, undo, PPTX and autosave verified');
  return result;
};
