"use strict";
const { expect } = require("@playwright/test");

// Observe before triggering the native chooser: an immediate "not busy" check
// can see the old document while the main process is still reading the file.
// A short import may also finish between Playwright's visibility polls.
module.exports = async function waitDocumentOpen(page, trigger) {
  await expect(page.locator(".busy-backdrop")).toHaveCount(0);
  await page.evaluate(() => {
    window.__qaDocumentOpen = { seen: false };
    const observe = () => {
      if (
        document
          .querySelector(".busy-backdrop")
          ?.textContent.includes("프레젠테이션을 열고")
      )
        window.__qaDocumentOpen.seen = true;
    };
    window.__qaDocumentOpen.observer = new MutationObserver(observe);
    window.__qaDocumentOpen.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  try {
    await trigger();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__qaDocumentOpen.seen &&
            !document.querySelector(".busy-backdrop"),
        ),
      )
      .toBe(true);
  } finally {
    await page
      .evaluate(() => {
        window.__qaDocumentOpen.observer.disconnect();
        delete window.__qaDocumentOpen;
      })
      .catch(() => {});
  }
};
