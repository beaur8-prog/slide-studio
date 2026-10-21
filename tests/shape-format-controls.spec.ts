import { expect, test, type Page } from "@playwright/test";

async function insertShape(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "도형", exact: true }).click();
  await page.getByRole("button", { name: "사각형", exact: true }).click();
  await expect(page.locator('.editable-slide [data-type="shape"].selected')).toHaveCount(1);
}

test("inspector has one close action, preserves the selected shape and fits its contents without horizontal scrolling", async ({ page }, info) => {
  await insertShape(page);
  await page.getByRole("button", { name: "서식", exact: true }).click();
  const panel = page.locator(".inspector");
  await expect(panel.locator(".inspector-heading")).toContainText("개체 서식");
  await expect(panel.locator(".inspector-heading button")).toHaveCount(1);
  for (const width of [970, 1080, 1280, 1540]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await panel.evaluate(el => ({
      width: el.getBoundingClientRect().width,
      horizontalOverflow: el.querySelector('.inspector-body')!.scrollWidth - el.querySelector('.inspector-body')!.clientWidth,
    }));
    expect(bounds.width).toBeLessThanOrEqual(280);
    expect(bounds.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(await page.locator('.ribbon').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const controls = page.getByRole('group', { name: '도형 서식', exact: true });
    await expect(controls).toBeVisible();
    const clipped = await controls.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('input')).some(input => {
        const box = input.getBoundingClientRect();
        return box.left < bounds.left || box.right > bounds.right || box.top < bounds.top || box.bottom > bounds.bottom;
      });
    });
    expect(clipped).toBe(false);
  }
  await page.screenshot({ path: info.outputPath("compact-inspector.png") });
  await page.getByRole("button", { name: "서식 패널 닫기", exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.editable-slide [data-type="shape"].selected')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "서식", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await expect(panel.locator(".inspector-heading")).toContainText("개체 서식");
});

test("Home shape colors and width stay in sync with the inspector, undo and PPTX saving", async ({ page }, info) => {
  await insertShape(page);
  const fill = page.getByLabel('도형 채우기 색', { exact: true });
  const stroke = page.getByLabel('도형 선 색', { exact: true });
  const width = page.getByRole('spinbutton', { name: '도형 선 두께', exact: true });
  await fill.fill('#1255aa');
  await stroke.fill('#e5aa11');
  await width.fill('6.5');
  await width.press('Enter');
  await page.getByRole('button', { name: '서식', exact: true }).click();
  const panel = page.locator('.inspector');
  await expect(panel.getByLabel('채우기', { exact: true })).toHaveValue('#1255aa');
  await expect(panel.getByLabel('선 색상', { exact: true })).toHaveValue('#e5aa11');
  await expect(panel.getByRole('spinbutton', { name: '선 두께', exact: true })).toHaveValue('6.5');
  await panel.getByRole('spinbutton', { name: '선 두께', exact: true }).fill('9');
  await panel.getByRole('spinbutton', { name: '선 두께', exact: true }).press('Enter');
  await expect(width).toHaveValue('9');
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.locator('.editable-slide [data-type="shape"]').click();
  await expect(width).toHaveValue('6.5');
  await page.getByLabel('도형 채우기 없음', { exact: true }).check();
  await expect(panel.getByLabel('채우기 없음', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await page.locator('.editable-slide [data-type="shape"]').click();
  await expect(fill).toHaveValue('#1255aa');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  const saved = await page.evaluate(async () => {
    const { loadAutosave } = await import('/src/storage.ts');
    const { exportPptx, importPptx } = await import('/src/io.ts');
    const result = await importPptx(await exportPptx((await loadAutosave())!));
    const shape = result.deck.slides[0].elements[0];
    return { fill: shape.fill, stroke: shape.stroke, strokeWidth: shape.strokeWidth };
  });
  expect(saved.fill?.toLowerCase()).toBe('#1255aa');
  expect(saved.stroke?.toLowerCase()).toBe('#e5aa11');
  expect(saved.strokeWidth).toBeCloseTo(6.5, 3);
  await page.getByRole('button', { name: '서식 패널 닫기', exact: true }).click();
  await page.screenshot({ path: info.outputPath('home-shape-format.png') });
});

test("shape formatting affects editable shapes only and restores a visible border from zero width", async ({ page }) => {
  await page.goto('http://127.0.0.1:5190');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  const json = await page.evaluate(async () => {
    const { blankDeck, element } = await import('/src/model.ts');
    const { serializeDeck } = await import('/src/io.ts');
    const deck = blankDeck();
    deck.slides[0].elements = [
      element('shape', { id: 'a', x: 50, y: 100, width: 170, height: 120, strokeWidth: 0,
        gradient: { kind: 'linear', angle: 0, stops: [{ offset: 0, color: '#111111' }, { offset: 1, color: '#eeeeee' }] } }),
      element('shape', { id: 'b', x: 300, y: 100, width: 170, height: 120, strokeWidth: 5 }),
      element('shape', { id: 'locked', x: 550, y: 100, width: 170, height: 120, locked: true, fill: '#222222', strokeWidth: 8 }),
      element('text', { id: 'text', x: 800, y: 100, width: 170, height: 120, text: '그대로 유지', fill: '#333333' }),
    ];
    return serializeDeck(deck);
  });
  await page.locator('input[accept*=".pptx"]').setInputFiles({ name: 'shapes.slide', mimeType: 'application/json', buffer: Buffer.from(json) });
  const element = (id: string) => page.locator(`.editable-slide [data-element-id="${id}"]`);
  await element('a').click();
  for (const id of ['b', 'locked', 'text']) await element(id).click({ modifiers: ['Shift'] });
  await expect(page.locator('.editable-slide .slide-element.selected')).toHaveCount(4);
  await page.getByLabel('도형 채우기 색', { exact: true }).fill('#66ccff');
  await page.getByLabel('도형 선 색', { exact: true }).fill('#00ff00');
  await expect(page.locator('.save-indicator')).toHaveText('저장됨');
  const shapes = await page.evaluate(async () => (await (await import('/src/storage.ts')).loadAutosave())!.slides[0].elements);
  expect(shapes[0]).toMatchObject({ fill: '#66ccff', stroke: '#00ff00', strokeWidth: 2 });
  expect(shapes[0].gradient).toBeUndefined();
  expect(shapes[1]).toMatchObject({ fill: '#66ccff', stroke: '#00ff00', strokeWidth: 5 });
  expect(shapes[2]).toMatchObject({ fill: '#222222', strokeWidth: 8 });
  expect(shapes[3]).toMatchObject({ fill: '#333333', text: '그대로 유지' });
  await page.keyboard.press('Escape');
  await element('a').click();
  const width = page.getByRole('spinbutton', { name: '도형 선 두께', exact: true });
  await width.fill('0'); await width.press('Enter');
  await expect(width).toHaveValue('0');
  await page.getByLabel('도형 선 색', { exact: true }).fill('#112233');
  await expect(width).toHaveValue('2');
  await page.keyboard.press('Escape'); await element('locked').click();
  await expect(page.getByLabel('도형 채우기 색', { exact: true })).toBeDisabled();
  await expect(width).toBeDisabled();
});
