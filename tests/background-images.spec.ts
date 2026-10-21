import { expect, test } from "@playwright/test";
import sharp from "sharp";

for (const owner of ["slide", "layout", "master"]) {
  test(`picture background resolves the ${owner} relationship and survives native PPTX saving`, async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:5190");
    const result = await page.evaluate(async (owner) => {
      const { blankDeck, newSlide } = await import("/src/model.ts");
      const { exportPptx, importPptx, serializeDeck, parseDeckJson } =
        await import("/src/io.ts");
      const { default: JSZip } = await import(
        "/node_modules/.vite/deps/jszip.js"
      );
      const deck = blankDeck();
      deck.slides = [newSlide(), newSlide()];
      const zip = await JSZip.loadAsync(await exportPptx(deck));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const context = canvas.getContext("2d")!;
      const image = (color: string) => {
        context.fillStyle = color;
        context.fillRect(0, 0, 16, 16);
        return canvas.toDataURL("image/png");
      };
      const correct = image("#1255AA"),
        wrong = image("#00FF00");
      zip.file("ppt/media/background.png", correct.split(",")[1], {
        base64: true,
      });
      zip.file("ppt/media/wrong.png", wrong.split(",")[1], { base64: true });
      const paths = {
        slide: "ppt/slides/slide1.xml",
        layout: "ppt/slideLayouts/slideLayout1.xml",
        master: "ppt/slideMasters/slideMaster1.xml",
      };
      const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
      const background =
        '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBackground"><a:alphaModFix amt="60000"/></a:blip><a:srcRect t="10000" r="20000" b="10000" l="10000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>';
      for (const [kind, path] of Object.entries(paths)) {
        const doc = new DOMParser().parseFromString(
          await zip.file(path)!.async("string"),
          "application/xml",
        );
        for (const bg of Array.from(doc.getElementsByTagNameNS(P, "bg")))
          bg.remove();
        let xml = new XMLSerializer().serializeToString(doc);
        if (kind === owner)
          xml = xml.replace(/(<p:cSld[^>]*>)/, "$1" + background);
        zip.file(path, xml);
        const bits = path.split("/");
        const name = bits.pop()!;
        const relPath = [...bits, "_rels", name + ".rels"].join("/");
        const rel = `<Relationship Id="rIdBackground" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${kind === owner ? "background" : "wrong"}.png"/>`;
        zip.file(
          relPath,
          (await zip.file(relPath)!.async("string")).replace(
            "</Relationships>",
            rel + "</Relationships>",
          ),
        );
      }
      // A slide-local solid background must override its inherited picture.
      const secondPath = "ppt/slides/slide2.xml";
      zip.file(
        secondPath,
        (await zip.file(secondPath)!.async("string")).replace(
          /<p:bg>[\s\S]*?<\/p:bg>/,
          '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:bgPr></p:bg>',
        ),
      );
      zip.file(
        "[Content_Types].xml",
        (await zip.file("[Content_Types].xml")!.async("string")).replace(
          "</Types>",
          '<Default Extension="png" ContentType="image/png"/></Types>',
        ),
      );
      const first = await importPptx(
        await zip.generateAsync({ type: "uint8array" }),
      );
      const stored = parseDeckJson(serializeDeck(first.deck));
      const rounds = [stored.slides[0].backgroundImage];
      let current = stored;
      let native: any;
      for (let i = 0; i < 3; i++) {
        const bytes = await exportPptx(current);
        const saved = await JSZip.loadAsync(bytes);
        const doc = new DOMParser().parseFromString(
          await saved.file(paths.slide)!.async("string"),
          "application/xml",
        );
        native = {
          pictures: doc.getElementsByTagNameNS(P, "pic").length,
          fills: doc
            .getElementsByTagNameNS(P, "bgPr")[0]
            .getElementsByTagNameNS("*", "blipFill").length,
        };
        current = (await importPptx(bytes)).deck;
        rounds.push(current.slides[0].backgroundImage);
      }
      return {
        expected: { src: correct, crop: [0.1, 0.2, 0.1, 0.1], opacity: 0.6 },
        rounds,
        second: current.slides[1],
        elements: current.slides[0].elements.length,
        native,
        warnings: first.warnings,
      };
    }, owner);
    for (const background of result.rounds)
      expect(background).toEqual(result.expected);
    expect(result.second.background).toBe("#ABCDEF");
    expect(result.second.backgroundImage).toBeUndefined();
    expect(result.elements).toBe(0);
    expect(result.native).toEqual({ pictures: 0, fills: 1 });
    expect(result.warnings).not.toContain(
      "일부 배경의 그라데이션·이미지·효과는 단색 배경으로 대체되었습니다.",
    );
  });
}

test("background model rejects external data and invalid image crop", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const results = await page.evaluate(async () => {
    const { blankDeck } = await import("/src/model.ts");
    const { parseDeckJson } = await import("/src/io.ts");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const src = canvas.toDataURL("image/png");
    return [
      { src: "https://example.com/tracker.png" },
      { src, crop: [0.7, 0, 0.7, 0] },
      { src, opacity: -1 },
    ].map((backgroundImage) => {
      const deck = blankDeck();
      deck.slides[0].backgroundImage = backgroundImage as any;
      try {
        parseDeckJson(JSON.stringify(deck));
        return "accepted";
      } catch (error) {
        return (error as Error).message;
      }
    });
  });
  expect(results.every((r) => r !== "accepted")).toBe(true);
});

test("picture backgrounds render behind artwork and solid background controls replace them with undo", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:5190");
  const json = await page.evaluate(async () => {
    const { blankDeck, newSlide, element } = await import("/src/model.ts");
    const { serializeDeck } = await import("/src/io.ts");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#1255AA";
    context.fillRect(0, 0, 16, 16);
    const deck = blankDeck();
    deck.slides = [newSlide(), newSlide()];
    deck.slides[0].backgroundImage = { src: canvas.toDataURL("image/png") };
    deck.slides[0].elements = [
      element("shape", {
        x: 300,
        y: 250,
        width: 200,
        height: 150,
        fill: "#000000",
        strokeWidth: 0,
      }),
    ];
    return serializeDeck(deck);
  });
  await page
    .locator('input[accept*=".pptx"]')
    .setInputFiles({
      name: "picture-background.slide",
      mimeType: "application/json",
      buffer: Buffer.from(json),
    });
  const canvas = page.locator(".editable-slide");
  await expect(canvas.locator(".slide-background-image img")).toBeVisible();
  const image = await canvas.screenshot({
    path: info.outputPath("picture-background.png"),
  });
  const { data, info: raw } = await sharp(image)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let blue = 0,
    black = 0;
  for (let i = 0; i < data.length; i += raw.channels) {
    if (
      data[i] < 40 &&
      data[i + 1] > 60 &&
      data[i + 1] < 120 &&
      data[i + 2] > 140
    )
      blue++;
    if (data[i] < 10 && data[i + 1] < 10 && data[i + 2] < 10) black++;
  }
  expect(blue).toBeGreaterThan(10000);
  expect(black).toBeGreaterThan(1000);
  await page.getByRole("button", { name: "서식", exact: true }).click();
  await page.getByRole("button", { name: "배경 #D4613F", exact: true }).click();
  await expect(canvas.locator(".slide-background-image")).toHaveCount(0);
  await page.getByRole("button", { name: "실행 취소", exact: true }).click();
  await expect(canvas.locator(".slide-background-image img")).toBeVisible();
  await page
    .getByRole("button", { name: "모든 슬라이드에 적용", exact: true })
    .click();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  const backgrounds = await page.evaluate(async () =>
    (await (await import("/src/storage.ts")).loadAutosave())!.slides.map(
      (s) => s.backgroundImage,
    ),
  );
  expect(backgrounds[1]).toEqual(backgrounds[0]);
});
