import { expect, test, type Page } from "@playwright/test";

const ANDROID = "Mozilla/5.0 (Linux; Android 16; SM-X800) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
const profiles = [
  { name: "landscape tablet", width: 1280, height: 800, left: 0, right: 0, bottom: 72 },
  { name: "portrait tablet", width: 800, height: 1280, left: 24, right: 16, bottom: 80 },
  { name: "phone", width: 412, height: 844, left: 0, right: 0, bottom: 48 },
];
const menu = (page: Page) => page.getByRole("menu", { name: "개체 편집", exact: true });

async function editShape(page: Page, insets: { left: number; right: number; bottom: number }) {
  await page.addInitScript((insets) => {
    const apply = () => {
      for (const [edge, value] of Object.entries(insets))
        document.documentElement.style.setProperty(`--studio-safe-area-inset-${edge}`, `${value}px`);
      // A fixture for the system-owned icon strip. Hit testing must not reach it.
      const bar = document.createElement("button");
      bar.id = "system-icons-fixture";
      bar.textContent = "Android icons";
      bar.style.cssText = `position:fixed;inset:auto 0 0;height:${insets.bottom}px;z-index:2147483000;background:#666`;
      (window as any).bottomIconClicks = 0;
      bar.onclick = () => (window as any).bottomIconClicks++;
      document.body.appendChild(bar);
      document.addEventListener("click", event => {
        if ((event.target as Element).closest(".statusbar")) (window as any).bottomIconClicks++;
      }, true);
    };
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  }, { left: insets.left, right: insets.right, bottom: insets.bottom });
  await page.goto("http://127.0.0.1:5190");
  await page.getByRole("button", { name: "새 프레젠테이션", exact: true }).click();
  await expect(page.locator(".android-editor")).toBeVisible();
  if (await page.locator(".android-editor-tablet").count()) {
    await page.locator(".tabs").getByRole("button", { name: "삽입", exact: true }).click();
    await page.getByRole("button", { name: "도형", exact: true }).click();
    await page.locator(".shape-options").getByRole("button", { name: "사각형", exact: true }).click();
  } else {
    await page.getByRole("tab", { name: "삽입", exact: true }).click();
    await page.locator(".android-insert-actions").getByRole("button", { name: "사각형", exact: true }).click();
  }
  await page.locator('.editable-slide [data-element-id].selected').click({ button: "right" });
  await expect(menu(page)).toBeVisible();
}

async function usableArea(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".android-editor")!;
    const rect = shell.getBoundingClientRect(), style = getComputedStyle(shell);
    const footer = shell.querySelector(".statusbar")!.getBoundingClientRect();
    const visual = window.visualViewport!;
    return {
      left: Math.max(visual.offsetLeft, rect.left + parseFloat(style.paddingLeft)) + 8,
      right: Math.min(visual.offsetLeft + visual.width, rect.right - parseFloat(style.paddingRight)) - 8,
      top: Math.max(visual.offsetTop, rect.top + parseFloat(style.paddingTop)) + 8,
      bottom: Math.min(visual.offsetTop + visual.height, rect.bottom - parseFloat(style.paddingBottom), footer.height ? footer.top : Infinity) - 8,
    };
  });
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ userAgent: ANDROID, viewport: { width: profile.width, height: profile.height },
    screen: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });

  test("object menu stays above app and system icons", async ({ page }, info) => {
    await editShape(page, profile);
    const bounds = (await menu(page).boundingBox())!, area = await usableArea(page);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(area.bottom + 1);
    expect(bounds.x).toBeGreaterThanOrEqual(area.left - 1);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(area.right + 1);
    await page.screenshot({ path: info.outputPath("menu-safe-area.png") });
  });

  test("format object click reaches the menu instead of bottom icons", async ({ page }) => {
    await editShape(page, profile);
    const format = menu(page).getByRole("menuitem", { name: "개체 서식", exact: true });
    await format.scrollIntoViewIfNeeded();
    const point = (await format.boundingBox())!;
    expect(await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return target?.closest('[role="menuitem"]')?.textContent?.trim() || target?.className;
    }, { x: point.x + point.width / 2, y: point.y + point.height / 2 })).toBe("개체 서식");
    // Coordinate input deliberately retains real hit testing against the icon strip.
    await page.mouse.click(point.x + point.width / 2, point.y + point.height / 2);
    expect(await page.evaluate(() => (window as any).bottomIconClicks)).toBe(0);
    await expect(page.locator(".inspector")).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await expect(page.getByTestId("presentation-view")).toHaveCount(0);
    await expect(page.locator(".slide-sorter")).toHaveCount(0);
  });

  if (profile.name === "landscape tablet") {
    test("open menu follows changed native insets", async ({ page }) => {
      await editShape(page, profile);
      await page.evaluate(() => document.documentElement.style.setProperty("--studio-safe-area-inset-bottom", "160px"));
      await expect.poll(async () => {
        const box = (await menu(page).boundingBox())!, area = await usableArea(page);
        return box.y + box.height <= area.bottom + 1;
      }).toBe(true);
    });

    test("short visual viewport keeps the last item reachable", async ({ page }) => {
      await editShape(page, profile);
      await page.evaluate(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, { width: 720, height: 300, offsetLeft: 16, offsetTop: 48 });
        Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
        // Reopen so geometry uses the simulated keyboard/pan viewport from the start.
        document.querySelector<HTMLElement>('.editable-slide [data-element-id].selected')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 700, clientY: 320, button: 2 }));
      });
      const area = await usableArea(page), box = (await menu(page).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(area.top);
      expect(box.y + box.height).toBeLessThanOrEqual(area.bottom + 1);
      await menu(page).getByRole("menuitem", { name: "개체 서식", exact: true }).click();
      await expect(page.locator(".inspector")).toBeVisible();
    });
  }
});
