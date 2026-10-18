import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const bytes = fs.readFileSync(
  path.resolve("public/fonts/NanumBarunGothic.ttf"),
);
// Test-only fixture: use a bundled OFL font with a Calibri family name to prove
// that an added face really replaces Carlito; this is NOT a Calibri reference.
function namedFixture(family: string, weight = 400, italic = false) {
  const data = Buffer.from(bytes);
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const at = 12 + i * 16,
      tag = data.toString("ascii", at, at + 4),
      start = data.readUInt32BE(at + 8);
    if (tag === "OS/2") {
      data.writeUInt16BE(weight, start + 4);
      data.writeUInt16BE(italic ? 1 : 0x40, start + 62);
    }
    if (tag !== "name") continue;
    const storage = start + data.readUInt16BE(start + 4);
    for (let j = 0; j < data.readUInt16BE(start + 2); j++) {
      const record = start + 6 + j * 12;
      if (
        data.readUInt16BE(record) !== 3 ||
        ![1, 16].includes(data.readUInt16BE(record + 6))
      )
        continue;
      const text = Buffer.from(family, "utf16le").swap16();
      if (text.length > data.readUInt16BE(record + 8)) continue;
      text.copy(data, storage + data.readUInt16BE(record + 10));
      data.writeUInt16BE(text.length, record + 8);
    }
  }
  return data;
}

test("font metadata keeps Light/italic separate and rejects malformed or oversized fonts", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async ({ normal: normal64, light: light64 }) => {
      const normal = Uint8Array.from(atob(normal64), (c) => c.charCodeAt(0));
      const light = Uint8Array.from(atob(light64), (c) => c.charCodeAt(0));
      const { fontMetadata, addLocalFont, listLocalFonts } = await import(
        "/src/local-fonts.ts"
      );
      const errors = [];
      for (const data of [
        new Uint8Array(12),
        new Uint8Array(16 * 1024 * 1024 + 1),
        new Uint8Array(normal.slice(0, 100)),
      ]) {
        try {
          await addLocalFont(data);
          errors.push(false);
        } catch {
          errors.push(true);
        }
      }
      return {
        normal: fontMetadata(new Uint8Array(normal)),
        light: fontMetadata(new Uint8Array(light)),
        errors,
        fonts: listLocalFonts(),
      };
    },
    {
      normal: namedFixture("Calibri").toString("base64"),
      light: namedFixture("Calibri Light", 300, true).toString("base64"),
    },
  );
  expect(result.normal).toMatchObject({
    family: "Calibri",
    weight: 400,
    style: "normal",
  });
  expect(result.light).toMatchObject({
    family: "Calibri Light",
    weight: 300,
    style: "italic",
  });
  expect(result.normal.aliases).toEqual(
    expect.arrayContaining(["Calibri", "나눔바른고딕"]),
  );
  expect(result.errors).toEqual([true, true, true]);
  expect(result.fonts).toEqual([]);
});

test("added original face replaces Carlito, persists after restart, and removal restores fallback", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const fixture = namedFixture("Calibri");
  const render = async () =>
    page.evaluate(async () => {
      const { fontStack } = await import("/src/text-layout.ts");
      document.querySelector("#original-font-proof")?.remove();
      const host = document.createElement("div");
      host.id = "original-font-proof";
      host.style.cssText = `font-family:${fontStack("Calibri")};font-size:32px;font-kerning:none;line-height:1.2;width:350px;position:fixed;right:0;bottom:0;pointer-events:none;z-index:99999;background:white;color:black`;
      host.textContent = "until min resolution reached";
      document.body.append(host);
      await document.fonts.ready;
      const range = document.createRange();
      range.selectNodeContents(host);
      return {
        lines: range.getClientRects().length,
        width: range.getBoundingClientRect().width,
      };
    });
  const selectedFaces = async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "#original-font-proof",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    await cdp.detach();
    return fonts.map((f: { postScriptName: string }) => f.postScriptName);
  };
  const before = await render();
  expect((await selectedFaces()).join()).toMatch(/Carlito/);
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("button", { name: "원본 글꼴 추가", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "원본 글꼴 추가" });
  await dialog.getByLabel("원본 글꼴 파일").setInputFiles({
    name: "calibri-fixture.ttf",
    mimeType: "font/ttf",
    buffer: fixture,
  });
  await expect(dialog.getByRole("status")).toContainText(
    "Calibri (400, normal) 적용됨",
  );
  await dialog.getByRole("button", { name: "글꼴 관리 닫기" }).click();
  expect(
    await page.evaluate(() =>
      Array.from(document.fonts).some(
        (face) =>
          face.family === "Slide Studio Local 나눔바른고딕" &&
          face.status === "loaded",
      ),
    ),
  ).toBe(true);
  const after = await render();
  expect((await selectedFaces()).join()).toMatch(/NanumBarunGothic/);
  expect(after.width).not.toBe(before.width);
  await page.reload();
  await expect(page.locator(".save-indicator")).toHaveText("저장됨");
  expect(await render()).toEqual(after);
  expect((await selectedFaces()).join()).toMatch(/NanumBarunGothic/);
  await page.getByRole("button", { name: "파일", exact: true }).click();
  await page
    .getByRole("button", { name: "원본 글꼴 추가", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Calibri 400 normal 제거" }).click();
  await expect(dialog.getByRole("status")).toContainText("제거했습니다");
  await dialog.getByRole("button", { name: "글꼴 관리 닫기" }).click();
  expect(await render()).toEqual(before);
  expect((await selectedFaces()).join()).toMatch(/Carlito/);
  await page.reload();
  expect(
    await page.evaluate(async () =>
      (await import("/src/local-fonts.ts")).listLocalFonts(),
    ),
  ).toEqual([]);
});

test("fallback metrics cover extended Latin, Greek and Cyrillic consistently", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { fontStack } = await import("/src/text-layout.ts");
    const samples = [
      "until min resolution reached",
      "Łódź Červená",
      "Ελληνικά",
      "Презентация",
      "Tiếng Việt",
    ];
    const out = [];
    for (const text of samples) {
      const widths = [];
      for (const font of ["Calibri", "Calibri Light"]) {
        const el = document.createElement("span");
        el.textContent = text;
        el.style.cssText = `font-family:${fontStack(font)};font-size:40px;font-weight:400;white-space:pre;display:inline-block;`;
        document.body.append(el);
        await document.fonts.ready;
        widths.push(el.getBoundingClientRect().width);
        el.remove();
      }
      out.push(widths[1] / widths[0]);
    }
    return out;
  });
  for (const ratio of result) expect(ratio).toBeCloseTo(0.988, 3);
});
