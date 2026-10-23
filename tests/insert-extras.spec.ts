import { expect, test, type Page } from "@playwright/test";

async function openDeck(page: Page) {
  await page.goto("http://127.0.0.1:5190");
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const deck = {
    version: 1,
    id: "insert-extras-deck",
    name: "Insert extras regression",
    width: 1280,
    height: 720,
    theme: "paper",
    slides: ["one", "two", "three"].map((id, index) => ({
      id,
      background: "#FFFFFF",
      notes: "",
      transition: "none",
      hidden: index === 2,
      elements: [
        {
          id: `title-${id}`,
          type: "text",
          x: 70,
          y: 60,
          width: 500,
          height: 60,
          rotation: 0,
          opacity: 1,
          text: `Original ${index + 1}`,
          fontFamily: "Arial",
          fontSize: 32,
          color: "#000000",
        },
      ],
    })),
  };
  await page.locator('input[type="file"][accept*=".pptx"]').setInputFiles({
    name: "insert-extras.slide",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(deck)),
  });
  await expect(
    page.getByRole("textbox", { name: "프레젠테이션 이름" }),
  ).toHaveValue(deck.name);
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  await page.getByRole("button", { name: "삽입", exact: true }).click();
}

async function savedDeck(page: Page) {
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  return page.evaluate(async () => {
    const { loadAutosave } = await import("/src/storage.ts");
    return (await loadAutosave())!;
  });
}

test("link dialog rejects executable and credential URLs, stores a valid URL, and removes the link", async ({
  page,
}) => {
  await openDeck(page);
  await page.getByRole("button", { name: "링크", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "링크 삽입" });
  await dialog.getByLabel("링크 표시 텍스트").fill("Reference website");
  for (const url of [
    "javascript:alert(1)",
    "file:///C:/secret.txt",
    "https://user:password@example.com/",
  ]) {
    await dialog.getByLabel("웹 주소").fill(url);
    await dialog.getByRole("button", { name: "적용", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(page.locator(".editable-slide [data-element-id]")).toHaveCount(
      1,
    );
  }
  await dialog
    .getByLabel("웹 주소")
    .fill("https://example.com/reference?q=slides");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const inserted = (await savedDeck(page)).slides[0].elements.find(
    (e) => e.text === "Reference website",
  )!;
  expect(inserted.hyperlink).toEqual({
    url: "https://example.com/reference?q=slides",
  });
  // Fulfill locally: verify the real clickable overlay without network access.
  await page
    .context()
    .route("https://example.com/reference?q=slides", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Reference fixture</title>",
      }),
    );
  await page.keyboard.press("F5");
  const presentation = page.getByTestId("presentation-view");
  const popupPromise = page.waitForEvent("popup");
  await presentation.getByRole("link", { name: "Reference website" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/reference?q=slides");
  await expect(presentation).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  await popup.close();
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
  await page
    .locator(`.editable-slide [data-element-id="${inserted.id}"]`)
    .click();
  await page.getByRole("button", { name: "링크", exact: true }).click();
  await dialog.getByRole("button", { name: "링크 제거", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await savedDeck(page)).slides[0].elements.find((e) => e.id === inserted.id)
      ?.hyperlink,
  ).toBeUndefined();
  expect((await savedDeck(page)).slides[0].elements).toHaveLength(2);
});

test("internal slide links navigate directly to a hidden target without advancing again", async ({
  page,
}) => {
  await openDeck(page);
  await page.getByRole("button", { name: "링크", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "링크 삽입" });
  await dialog.getByLabel("링크 표시 텍스트").fill("Go to hidden target");
  await dialog.getByLabel("링크 종류").selectOption("slide");
  await dialog.getByLabel("연결할 슬라이드").selectOption("three");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await savedDeck(page)).slides[0].elements.find(
      (e) => e.text === "Go to hidden target",
    )?.hyperlink,
  ).toEqual({ slideId: "three" });
  await page.keyboard.press("F5");
  const presentation = page.getByTestId("presentation-view");
  await expect(presentation).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  await presentation
    .getByRole("button", { name: "Go to hidden target" })
    .click();
  await expect(presentation).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 3 / 3",
  );
  await expect(presentation).toContainText("Original 3");
  await expect(page.getByTestId("presentation-end")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
});

test("presentation slide links activate with Enter and Space without advancing the show", async ({
  page,
}) => {
  await openDeck(page);
  await page.getByRole("button", { name: "링크", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "링크 삽입" });
  await dialog.getByLabel("링크 표시 텍스트").fill("Keyboard hidden target");
  await dialog.getByLabel("링크 종류").selectOption("slide");
  await dialog.getByLabel("연결할 슬라이드").selectOption("three");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("F5");
  const presentation = page.getByTestId("presentation-view");
  for (const key of ["Enter", "Space"]) {
    await expect(presentation).toHaveAttribute(
      "aria-label",
      "발표 슬라이드 1 / 3",
    );
    const link = presentation.getByRole("button", {
      name: "Keyboard hidden target",
    });
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await page.keyboard.press(key);
    await expect(presentation).toHaveAttribute(
      "aria-label",
      "발표 슬라이드 3 / 3",
    );
    await expect(page.getByTestId("presentation-end")).toHaveCount(0);
    await page.keyboard.press("Home");
  }
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
});

test("presentation web links activate with Enter and keep Space from advancing", async ({
  page,
}) => {
  await openDeck(page);
  await page.getByRole("button", { name: "링크", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "링크 삽입" });
  await dialog.getByLabel("링크 표시 텍스트").fill("Keyboard website");
  await dialog.getByLabel("웹 주소").fill("https://example.com/keyboard-link");
  await dialog.getByRole("button", { name: "적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .context()
    .route("https://example.com/keyboard-link", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Keyboard link fixture</title>",
      }),
    );
  await page.keyboard.press("F5");
  const presentation = page.getByTestId("presentation-view");
  await page.keyboard.press("Tab");
  await expect(
    presentation.getByRole("link", { name: "Keyboard website" }),
  ).toBeFocused();
  await page.keyboard.press("Space");
  await expect(presentation).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://example.com/keyboard-link");
  await expect(presentation).toHaveAttribute(
    "aria-label",
    "발표 슬라이드 1 / 3",
  );
  await popup.close();
  await page.keyboard.press("Escape");
  await expect(presentation).toHaveCount(0);
});

test("footers apply to all slides, fixed dates survive reordering, and slide numbers follow the new order", async ({
  page,
}) => {
  await openDeck(page);
  await page.getByRole("button", { name: "바닥글", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "날짜 · 슬라이드 번호 · 바닥글",
  });
  await dialog.getByLabel("날짜 표시", { exact: true }).check();
  await dialog.getByLabel("오늘 날짜로 자동 업데이트").uncheck();
  await dialog.getByLabel("고정 날짜").fill("2031-04-05");
  await dialog.getByLabel("슬라이드 번호 표시", { exact: true }).check();
  await dialog.getByLabel("바닥글 내용").fill("Quarterly review");
  await dialog.getByRole("button", { name: "모두 적용", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const fields = (await savedDeck(page)).slides.map((s) =>
    s.elements
      .filter((e) => e.field)
      .map((e) => ({ field: e.field, text: e.text })),
  );
  expect(fields).toEqual(
    [1, 2, 3].map((number) => [
      { field: "fixedDate", text: "2031-04-05" },
      { field: "footer", text: "Quarterly review" },
      { field: "slideNumber", text: String(number) },
    ]),
  );
  await page
    .locator(".thumbnail-row")
    .nth(2)
    .dragTo(page.locator(".slide-insertion-gap").first());
  await expect(page.locator(".thumbnail-button").nth(0)).toHaveAttribute(
    "aria-label",
    /Original 3/,
  );
  const reordered = await savedDeck(page);
  expect(reordered.slides.map((s) => s.id)).toEqual(["three", "one", "two"]);
  expect(
    reordered.slides.map(
      (s) => s.elements.find((e) => e.field === "slideNumber")?.text,
    ),
  ).toEqual(["1", "2", "3"]);
  expect(
    reordered.slides.map(
      (s) => s.elements.find((e) => e.field === "fixedDate")?.text,
    ),
  ).toEqual(["2031-04-05", "2031-04-05", "2031-04-05"]);
  await page.getByRole("button", { name: "바닥글", exact: true }).click();
  await expect(dialog.getByLabel("고정 날짜")).toHaveValue("2031-04-05");
  await expect(
    dialog.getByLabel("오늘 날짜로 자동 업데이트"),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
});

test("two-photo albums insert in one undo step and revoke preview URLs on insert, reorder, and cancellation", async ({
  page,
}) => {
  await openDeck(page);
  const images = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    return [
      [80, 40, "#cc4433"],
      [40, 80, "#3355bb"],
    ].map(([width, height, color]) => {
      canvas.width = Number(width);
      canvas.height = Number(height);
      const context = canvas.getContext("2d")!;
      context.fillStyle = String(color);
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    });
  });
  const files = images.map((data, index) => ({
    name: `photo-${index + 1}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(data.split(",")[1], "base64"),
  }));
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    const active = new Set<string>();
    (window as any).__albumUrls = active;
    URL.createObjectURL = (object) => {
      const url = create(object);
      active.add(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      active.delete(url);
      revoke(url);
    };
  });
  await page.getByRole("button", { name: "사진 앨범", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "사진 앨범", exact: true });
  await dialog.getByLabel("사진 앨범 파일").setInputFiles(files);
  await expect(dialog.locator(".album-item")).toHaveCount(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).__albumUrls.size))
    .toBe(2);
  await dialog
    .getByRole("button", { name: "앨범 만들기", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".thumbnail-button")).toHaveCount(5);
  const album = await savedDeck(page);
  expect(album.slides[1].elements.find((e) => e.type === "image")?.alt).toBe(
    "photo-1.png",
  );
  expect(album.slides[2].elements.find((e) => e.type === "image")?.alt).toBe(
    "photo-2.png",
  );
  expect(
    album.slides
      .filter((s) => ["one", "two", "three"].includes(s.id))
      .map((s) => s.id),
  ).toEqual(["one", "two", "three"]);
  await expect
    .poll(() => page.evaluate(() => (window as any).__albumUrls.size))
    .toBe(0);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  expect((await savedDeck(page)).slides.map((s) => s.id)).toEqual([
    "one",
    "two",
    "three",
  ]);

  await page.getByRole("button", { name: "사진 앨범", exact: true }).click();
  await dialog.getByLabel("사진 앨범 파일").setInputFiles(files);
  await dialog
    .getByRole("button", { name: "사진 2 위로", exact: true })
    .click();
  await expect(dialog.locator(".album-item").first()).toContainText(
    "photo-2.png",
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).__albumUrls.size))
    .toBe(2);
  await page.evaluate(() => {
    const original = HTMLImageElement.prototype.decode;
    const pending: Array<() => void> = [];
    (window as any).__finishAlbumDecode = () => {
      HTMLImageElement.prototype.decode = original;
      for (const finish of pending.splice(0)) finish();
    };
    (window as any).__pendingAlbumDecode = () => pending.length;
    HTMLImageElement.prototype.decode = function () {
      return new Promise<void>((resolve, reject) => {
        pending.push(() => original.call(this).then(resolve, reject));
      });
    };
  });
  await dialog
    .getByRole("button", { name: "앨범 만들기", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__pendingAlbumDecode()))
    .toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).__albumUrls.size))
    .toBe(0);
  await page.evaluate(() => (window as any).__finishAlbumDecode());
  await expect(page.locator(".thumbnail-button")).toHaveCount(3);
  expect((await savedDeck(page)).slides.map((s) => s.id)).toEqual([
    "one",
    "two",
    "three",
  ]);
});
