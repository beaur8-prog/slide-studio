import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  readOfficeArialNovaLight,
  isArialNovaLight,
  MAX_FONT_BYTES,
} = require("../electron/office-fonts.cjs");

function fixtureFont(name = "ArialNova-Light", weight = 300) {
  const text = Buffer.from(name, "utf16le").swap16();
  const bytes = Buffer.alloc(68 + text.length);
  bytes.writeUInt32BE(0x00010000, 0);
  bytes.writeUInt16BE(2, 4);
  bytes.write("OS/2", 12);
  bytes.writeUInt32BE(44, 20);
  bytes.writeUInt32BE(6, 24);
  bytes.write("name", 28);
  bytes.writeUInt32BE(50, 36);
  bytes.writeUInt32BE(18 + text.length, 40);
  bytes.writeUInt16BE(weight, 48);
  bytes.writeUInt16BE(1, 52);
  bytes.writeUInt16BE(18, 54);
  bytes.writeUInt16BE(3, 56);
  bytes.writeUInt16BE(1, 58);
  bytes.writeUInt16BE(0x409, 60);
  bytes.writeUInt16BE(6, 62);
  bytes.writeUInt16BE(text.length, 64);
  text.copy(bytes, 68);
  return bytes;
}

test("Office font loader only accepts the bounded Arial Nova Light face in its cache", async () => {
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-studio-font-test-"),
  );
  const directory = path.join(
    temporary,
    "Microsoft",
    "FontCache",
    "4",
    "CloudFonts",
    "Arial Nova",
  );
  try {
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, "font.ttf");
    const options = { platform: "win32", localAppData: temporary };
    expect(await readOfficeArialNovaLight(options)).toBeNull();
    await fs.writeFile(file, fixtureFont("OtherFont"));
    expect(await readOfficeArialNovaLight(options)).toBeNull();
    await fs.writeFile(file, fixtureFont("ArialNova-Light", 400));
    expect(await readOfficeArialNovaLight(options)).toBeNull();
    await fs.writeFile(file, Buffer.alloc(MAX_FONT_BYTES + 1));
    expect(await readOfficeArialNovaLight(options)).toBeNull();
    const valid = fixtureFont();
    await fs.writeFile(file, valid);
    expect(Buffer.from(await readOfficeArialNovaLight(options))).toEqual(valid);
    expect(
      await readOfficeArialNovaLight({ ...options, platform: "darwin" }),
    ).toBeNull();
    expect(isArialNovaLight(valid.subarray(0, 30))).toBe(false);
    const damaged = Buffer.from(valid);
    damaged.writeUInt32BE(0xffffffff, 36);
    expect(isArialNovaLight(damaged)).toBe(false);
    // A junction below the cache must not turn this into a general file reader.
    await fs.rename(directory, path.join(temporary, "outside-fonts"));
    await fs.symlink(
      path.join(temporary, "outside-fonts"),
      directory,
      "junction",
    );
    expect(await readOfficeArialNovaLight(options)).toBeNull();
  } finally {
    if (
      !path
        .resolve(temporary)
        .startsWith(path.join(os.tmpdir(), "slide-studio-font-test-"))
    )
      throw new Error("Unexpected test cleanup target");
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("missing desktop font remains optional and font mapping preserves native families", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(async () => {
    const { installDesktopFonts, registerOfficeLightFont } = await import(
      "/src/desktop-fonts.ts"
    );
    const { fontStack } = await import("/src/text-layout.ts");
    const noBridge = await installDesktopFonts();
    window.desktop = {
      platform: "win32",
      loadOfficeLightFont: async () => null,
    } as Window["desktop"];
    const missing = await installDesktopFonts();
    window.desktop.loadOfficeLightFont = async () => {
      throw new Error("Cache unavailable");
    };
    const rejected = await installDesktopFonts();
    delete window.desktop;
    return {
      noBridge,
      missing,
      rejected,
      malformed: await registerOfficeLightFont(new Uint8Array(20)),
      light: fontStack("Helvetica Light"),
      bold: fontStack("Helvetica Light", true),
      calibri: fontStack("Calibri Light"),
    };
  });
  expect(result).toMatchObject({
    noBridge: false,
    missing: false,
    rejected: false,
    malformed: false,
  });
  expect(
    result.light.startsWith(
      '"Helvetica Light", "Slide Studio Local Helvetica Light"',
    ),
  ).toBe(true);
  expect(
    result.light.indexOf('"Slide Studio Office Arial Nova Light"'),
  ).toBeLessThan(result.light.indexOf(", Helvetica"));
  expect(result.calibri).not.toContain("Office Arial");
  expect(result.bold).not.toContain("Office Arial");
});

test("existing Office light font renders with its true light face and reference width", async ({
  page,
}) => {
  const bytes = await readOfficeArialNovaLight();
  test.skip(
    !bytes,
    "Arial Nova Light is not present in the local Office cache",
  );
  await page.goto("http://127.0.0.1:5190");
  const result = await page.evaluate(
    async (data) => {
      const { registerOfficeLightFont, OFFICE_LIGHT_FONT } = await import(
        "/src/desktop-fonts.ts"
      );
      const { fontStack } = await import("/src/text-layout.ts");
      const registered = await registerOfficeLightFont(new Uint8Array(data));
      const sample = document.createElement("span");
      sample.id = "office-light-sample";
      sample.textContent = "Hough transform";
      sample.style.cssText = `font-family:${fontStack("Helvetica Light")};font-size:${80 / 0.75}px;font-weight:300;white-space:pre;position:fixed;left:0;top:0;`;
      document.body.append(sample);
      await document.fonts.ready;
      return {
        registered,
        width: sample.getBoundingClientRect().width,
        loaded: document.fonts.check(`300 16px "${OFFICE_LIGHT_FONT}"`),
      };
    },
    [...bytes],
  );
  expect(result.registered).toBe(true);
  expect(result.loaded).toBe(true);
  // PowerPoint's public/native CMU4 PDFs use Arial Nova Light at 80.064 pt.
  // Permit 0.5% for PDF placement and browser shaping/rounding differences.
  const referenceWidth = ((800.851504 - 223.51) / 0.75) * (80 / 80.064);
  expect(Math.abs(result.width - referenceWidth) / referenceWidth).toBeLessThan(
    0.005,
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#office-light-sample",
  });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  expect(
    fonts.some(
      (font: { postScriptName: string }) =>
        font.postScriptName === "ArialNova-Light",
    ),
  ).toBe(true);
});

test("Calibri cache loads exact regular/bold/Light styles on Windows and Mac and rejects escape paths", async () => {
  const { readOfficeCalibriFonts } = require("../electron/office-fonts.cjs");
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "slide-studio-font-test-"),
  );
  try {
    for (const platform of ["win32", "darwin"]) {
      const base =
        platform === "win32"
          ? path.join(temporary, "Microsoft", "FontCache")
          : path.join(
              temporary,
              "Library",
              "Group Containers",
              "UBF8T346G9.Office",
              "FontCache",
            );
      const regular = path.join(base, "4", "CloudFonts", "Calibri"),
        light = path.join(base, "4", "CloudFonts", "Calibri Light");
      await fs.mkdir(regular, { recursive: true });
      await fs.mkdir(light, { recursive: true });
      await fs.writeFile(
        path.join(regular, "calibri.ttf"),
        fixtureFont("Calibri", 400),
      );
      await fs.writeFile(
        path.join(regular, "calibrib.ttf"),
        fixtureFont("Calibri-Bold", 700),
      );
      await fs.writeFile(
        path.join(light, "calibril.ttf"),
        fixtureFont("Calibri-Light", 300),
      );
      await fs.writeFile(
        path.join(light, "calibrili.ttf"),
        fixtureFont("Calibri-LightItalic", 300),
      );
      await fs.writeFile(
        path.join(regular, "calibri-fake.ttf"),
        fixtureFont("ArialNova-Light", 300),
      );
      const options = {
        platform,
        localAppData: temporary,
        home: temporary,
        applications: path.join(temporary, "Applications"),
      };
      const fonts = await readOfficeCalibriFonts(options);
      expect(fonts.map((f: any) => [f.family, f.weight, f.style])).toEqual(
        expect.arrayContaining([
          ["Calibri", 400, "normal"],
          ["Calibri", 700, "normal"],
          ["Calibri Light", 300, "normal"],
          ["Calibri Light", 300, "italic"],
        ]),
      );
      expect(fonts).toHaveLength(4);
      const outside = path.join(temporary, `outside-${platform}`);
      await fs.rename(regular, outside);
      await fs.symlink(outside, regular, "junction");
      expect(
        (await readOfficeCalibriFonts(options)).every(
          (f: any) => f.family === "Calibri Light",
        ),
      ).toBe(true);
    }
    expect(await readOfficeCalibriFonts({ platform: "linux" })).toEqual([]);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
