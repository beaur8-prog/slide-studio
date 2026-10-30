// Real file-open/edit/undo/redo/save/reopen QA with a disposable browser profile.
// Run against npm run dev. Results and generated fixtures stay outside git.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const PptxGenJS = require('pptxgenjs');
const sharp = require('sharp');
const { chromium, expect } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '.cache/qa-user-large'));
const requested = process.argv[3] || 'all';
const count = Number(process.env.QA_LARGE_SLIDES || 300);
const baseURL = process.env.QA_BASE_URL || 'http://127.0.0.1:5190';
const log = (...args) => console.log(new Date().toISOString(), ...args);
const rounded = value => Math.round(value * 10) / 10;

async function fixture() {
  const filename = path.join(output, `mixed-${count}.pptx`);
  try { await fs.access(filename); return filename; } catch {}
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Slide Studio QA';
  pptx.subject = 'Generated synthetic mixed-content performance fixture';
  pptx.title = `${count}장 한글 업무 자료`;
  for (let index = 0; index < count; index++) {
    const pixels = Buffer.alloc(512 * 288 * 3);
    let seed = (index + 1) * 67271;
    for (let i = 0; i < pixels.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i] = seed >>> 24;
    }
    const jpeg = await sharp(pixels, { raw: { width: 512, height: 288, channels: 3 } })
      .jpeg({ quality: 87 }).toBuffer();
    const slide = pptx.addSlide();
    slide.background = { color: index % 2 ? 'F5F7FA' : 'FFFFFF' };
    slide.addText(`업무 보고 ${index + 1} / ${count}`, {
      x: 0.5, y: 0.35, w: 11.8, h: 0.6, fontFace: 'Arial', fontSize: 28,
      bold: true, color: '17324D', breakLine: false, margin: 0,
    });
    slide.addText('한글 본문과 English 123 — 회귀 검증\n계획·실행·결과를 확인합니다.', {
      x: 0.5, y: 1.2, w: 6, h: 1.3, fontSize: 21, color: '334455', margin: 0,
    });
    slide.addText(`고유 데이터: 부서 ${index % 12 + 1}, 비용 ${index * 1700 + 321}`, {
      x: 0.5, y: 2.7, w: 6, h: 0.6, fontSize: 18, margin: 0,
    });
    slide.addShape(pptx.ShapeType.ellipse, { x: 0.5, y: 4.8, w: 1.3, h: 1.3,
      fill: { color: '4472C4' }, line: { color: '17324D', width: 2 } });
    slide.addShape(pptx.ShapeType.rightArrow, { x: 2.2, y: 5, w: 3, h: 0.8,
      fill: { color: 'D96842' }, line: { color: '772211', width: 1 } });
    slide.addImage({ data: `image/jpeg;base64,${jpeg.toString('base64')}`,
      x: 7.2, y: 1.2, w: 5.2, h: 2.925, altText: `QA 이미지 ${index + 1}` });
    if (index % 5 === 0) slide.addTable([
      ['항목', '목표', '실적', '차이'],
      ['매출', String(1000 + index), String(950 + index), '-50'],
      ['비용', '300', '270', '-30'],
      ['인원', '20', '21', '+1'],
    ], { x: 7.2, y: 4.6, w: 5.2, h: 1.7, rowH: 0.4, fontSize: 12,
      color: '112233', border: { color: '888888', pt: 0.5 }, fill: 'FFFFFF',
      margin: 0.04, autoPage: false });
    slide.addNotes(`슬라이드 ${index + 1} 발표자 노트 — 원본 저장 확인`);
    if ((index + 1) % 50 === 0) log(`generated ${index + 1} / ${count}`);
  }
  await pptx.writeFile({ fileName: filename, compression: true });
  return filename;
}

async function inspect(page) {
  return page.evaluate(async () => {
    const deck = await (await import('/src/storage.ts')).loadAutosave();
    const digest = async source => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(source))), value => value.toString(16).padStart(2, '0')).join('');
    const images = [];
    for (const slide of deck.slides) {
      images.push(await Promise.all(slide.elements.filter(e => e.type === 'image').map(e => digest(e.src))));
    }
    return {
      slides: deck.slides.length,
      elements: deck.slides.reduce((sum, slide) => sum + slide.elements.length, 0),
      text: deck.slides.map(slide => slide.elements.filter(e => e.text !== undefined).map(e => e.text)),
      notes: deck.slides.map(slide => slide.notes),
      images,
      tables: deck.slides.map(slide => slide.elements.filter(e => e.type === 'table').map(e => e.table?.cells)),
    };
  });
}

async function runFile(browser, filename, label, slides) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const metrics = { label, filename, bytes: (await fs.stat(filename)).size, slides, stages: {}, errors };
  await fs.mkdir(path.join(output, label), { recursive: true });
  const record = async () => fs.writeFile(path.join(output, label, 'metrics.json'), JSON.stringify(metrics, null, 2));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const data = await cdp.send('Performance.getMetrics');
    const read = key => data.metrics.find(m => m.name === key)?.value;
    const rendered = await page.evaluate(() => ({
      dom_nodes: document.getElementsByTagName('*').length,
      thumbnail_previews: document.querySelectorAll('.thumbnail-list .slide-visual').length,
      print_slides: document.querySelectorAll('.print-slide').length,
    }));
    return { js_heap_mb: rounded(read('JSHeapUsedSize') / 1024 / 1024), nodes: read('Nodes'), documents: read('Documents'), ...rendered };
  };
  const phase = async (name, action) => {
    log(label, name);
    const start = performance.now();
    const value = await action();
    metrics.stages[name] = { ms: rounded(performance.now() - start) };
    await record();
    return value;
  };
  try {
    await page.goto(baseURL);
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    metrics.baseline = await heap();
    await page.evaluate(() => {
      window.__largeLongTasks = [];
      new PerformanceObserver(list => window.__largeLongTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, ms: entry.duration })))).observe({ type: 'longtask', buffered: false });
    });
    const open = async target => {
      const previous = await page.locator('.editable-slide [data-element-id]').first().getAttribute('data-element-id');
      await page.locator('input[type=file][accept*=".pptx"]').setInputFiles(target);
      await expect(page.locator('.editable-slide [data-element-id]').first()).not.toHaveAttribute('data-element-id', previous, { timeout: 180000 });
      await expect(page.locator('.thumbnail-row')).toHaveCount(slides, { timeout: 180000 });
      await expect(page.locator('.busy-backdrop')).toHaveCount(0, { timeout: 180000 });
      await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 180000 });
      await expect(page.locator('.toast').filter({ hasText: '파일 열기 실패' })).toHaveCount(0);
    };
    await phase('open_ui_and_autosave', () => open(filename));
    metrics.after_open = await heap();
    const baseline = await inspect(page);
    metrics.elements = baseline.elements;
    metrics.images = baseline.images.flat().length;
    metrics.tables = baseline.tables.flat().length;
    await phase('navigate_first_to_last', async () => {
      await page.locator('.thumbnail-button').nth(slides - 1).click();
      await expect(page.locator('.canvas-topline')).toContainText(`${slides} / ${slides}`);
      await expect(page.locator('.editable-slide')).toBeVisible();
    });
    await phase('navigate_last_to_middle', async () => {
      const middle = Math.floor(slides / 2);
      await page.locator('.thumbnail-button').nth(middle).click();
      await expect(page.locator('.canvas-topline')).toContainText(`${middle + 1} / ${slides}`);
    });
    await page.locator('.thumbnail-button').first().click();
    const text = page.locator('.editable-slide [data-type="text"]').first();
    const original = await text.innerText();
    await text.dblclick();
    const editor = page.getByRole('textbox', { name: '슬라이드 텍스트 편집', exact: true });
    await phase('type_ten_characters', async () => {
      // Select all, then collapse to the end. This is consistent on macOS and
      // Windows without depending on whether the OS handles Cmd+End itself.
      await editor.press('ControlOrMeta+A');
      await editor.press('ArrowRight');
      await editor.pressSequentially('1234567890', { delay: 0 });
      await expect(editor).toHaveText(original + '1234567890', { useInnerText: true });
    });
    await phase('edit_blur_and_autosave', async () => {
      await page.getByRole('textbox', { name: '발표자 노트', exact: true }).click();
      await expect(page.locator('.save-indicator')).toHaveText('저장됨', { timeout: 180000 });
    });
    await phase('undo_redo', async () => {
      await page.getByRole('button', { name: '실행 취소', exact: true }).click();
      await expect(text).toHaveText(original);
      await page.getByRole('button', { name: '다시 실행', exact: true }).click();
      await expect(text).toContainText('1234567890');
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    });
    const edited = await inspect(page);
    metrics.after_edit_undo_redo = await heap();
    const saved = path.join(output, label, 'saved-roundtrip.pptx');
    await phase('save_pptx_ui', async () => {
      const downloading = page.waitForEvent('download', { timeout: 180000 });
      await page.getByRole('button', { name: 'PPTX 저장', exact: true }).click();
      const download = await downloading;
      await download.saveAs(saved);
      assert.equal(await download.failure(), null);
      await expect(page.locator('.busy-backdrop')).toHaveCount(0);
    });
    metrics.saved_bytes = (await fs.stat(saved)).size;
    await phase('reopen_saved_ui_and_autosave', () => open(saved));
    const reopened = await inspect(page);
    assert.deepEqual(reopened, edited, 'all slide counts, text, notes, image SHA-256 digests and table text must survive save/reopen');
    await expect(page.locator('.editable-slide [data-type="text"]').first()).toContainText('1234567890');
    metrics.after_reopen = await heap();
    // Repeatedly opening a file must not retain every old document in memory.
    // This intentionally records measurements without a hardware-dependent
    // pass/fail threshold; semantic checks remain exact on every iteration.
    metrics.repeated_reopen = [];
    for (let repeat = 0; repeat < Number(process.env.QA_LARGE_REOPEN || 0); repeat++) {
      await phase(`repeat_open_${repeat + 1}`, () => open(saved));
      assert.deepEqual(await inspect(page), edited);
      metrics.repeated_reopen.push(await heap());
    }
    await page.getByTestId('canvas-frame').screenshot({ path: path.join(output, label, 'reopened-first-slide.png') });
    metrics.long_tasks = await page.evaluate(() => {
      const tasks = window.__largeLongTasks;
      return { count: tasks.length, total_ms: tasks.reduce((sum, t) => sum + t.ms, 0), max_ms: Math.max(0, ...tasks.map(t => t.ms)), over_1000_ms: tasks.filter(t => t.ms >= 1000) };
    });
    assert.deepEqual(errors, []);
    metrics.status = 'passed';
  } catch (error) {
    metrics.status = 'failed';
    metrics.failure = String(error.stack || error);
    await page.screenshot({ path: path.join(output, label, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await record();
    log(label, JSON.stringify(metrics));
    await context.close();
  }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const generated = requested === 'corpus' ? null : await fixture();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    if (generated) await runFile(browser, generated, `mixed-${count}`, count);
    if (requested !== 'generated') await runFile(browser, path.join(root, 'qa/samples/cmu-lecture-1.pptx'), 'cmu-70', 70);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
