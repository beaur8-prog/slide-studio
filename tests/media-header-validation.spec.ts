import { expect, test } from "@playwright/test";
const origin = "http://127.0.0.1:5190";

test("media header checks preserve complete base64 validation, MIME policies and noncanonical padding", async ({
  page,
}) => {
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { safeVideo, videoMime } = await import("/src/video.ts");
    const { safeAudio, audioMime } = await import("/src/audio.ts");
    const { validateDeck } = await import("/src/io.ts");
    const { blankDeck } = await import("/src/model.ts");
    const { rasterMime } = await import("/src/image-format.ts");
    const image = (src: string) => {
      const d = blankDeck();
      d.slides[0].elements = [
        {
          id: "image",
          type: "image",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          src,
        },
      ];
      return validateDeck(d).slides[0].elements[0].src!;
    };
    const old = (src: string, kind: string) => {
      const m = (
        kind === "image"
          ? /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]*={0,2})$/i
          : kind === "video"
            ? /^data:(video\/(?:mp4|webm));base64,([A-Za-z0-9+/]+={0,2})$/
            : /^data:(audio\/(?:mpeg|wav|mp4));base64,([A-Za-z0-9+/]+={0,2})$/
      ).exec(src);
      if (!m || !m[2] || m[2].length % 4) throw Error("Invalid");
      const raw = atob(m[2]),
        bytes = Uint8Array.from(raw.slice(0, 16), (c) => c.charCodeAt(0));
      const type =
        kind === "image"
          ? rasterMime(bytes)
          : kind === "video"
            ? videoMime(bytes)
            : audioMime(bytes);
      if (type !== (kind === "image" ? m[1].toLowerCase() : m[1]))
        throw Error("MIME");
      return kind === "image"
        ? `data:${m[1].toLowerCase()};base64,${m[2]}`
        : src;
    };
    const attempt = (fn: () => string) => {
      try {
        return { ok: true, value: fn() };
      } catch {
        return { ok: false };
      }
    };
    const cases: [string, string, number[]][] = [
      ["image", "image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
      ["image", "image/jpeg", [255, 216, 255]],
      ["image", "image/gif", [71, 73, 70, 56, 55, 97]],
      ["image", "image/gif", [71, 73, 70, 56, 57, 97]],
      ["image", "image/webp", [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
      ["video", "video/mp4", [0, 0, 0, 24, 102, 116, 121, 112]],
      ["video", "video/webm", [26, 69, 223, 163]],
      ["audio", "audio/mpeg", [73, 68, 51]],
      ["audio", "audio/mpeg", [255, 251, 144]],
      ["audio", "audio/wav", [82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]],
      ["audio", "audio/mp4", [0, 0, 0, 24, 102, 116, 121, 112]],
    ];
    let compared = 0;
    const differences = [];
    const checks = [];
    for (const [kind, mime, header] of cases) {
      const bytes = new Uint8Array(97);
      bytes.set(header);
      const encoded = btoa(String.fromCharCode(...bytes));
      const source = `data:${mime};base64,${encoded}`;
      const variants = [
        source,
        source.replace(/^data:[^,]+,/, (header) => header.toUpperCase()),
        source.replace(encoded, btoa("\0".repeat(97))),
        source.slice(0, -1) + "!",
        source.replace(";base64,", ";base64,\n"),
        source.replace(encoded, encoded.slice(0, 24) + "=" + encoded.slice(25)),
        source.slice(0, -1),
        source + "=",
        source.replace(encoded, "AA=="),
        source.replace(encoded, ""),
        source.replace(encoded, encoded.slice(0, -5) + "éAAAA"),
        source.replace(encoded, encoded + "\t"),
        `https://example.com/test.${mime.split("/")[1]}`,
      ];
      // Existing atob accepts unused nonzero pad bits. Preserve that acceptance.
      const alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      for (const ch of alphabet.slice(0, 16))
        variants.push(source.slice(0, -3) + ch + "==");
      for (const src of variants) {
        const expected = attempt(() => old(src, kind));
        const actual = attempt(() =>
          kind === "image"
            ? image(src)
            : kind === "video"
              ? safeVideo(src)
              : safeAudio(src),
        );
        compared++;
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          differences.push({ kind, tail: src.slice(-12), expected, actual });
      }
      checks.push({
        kind,
        mime,
        accepted: attempt(() =>
          kind === "image"
            ? image(source)
            : kind === "video"
              ? safeVideo(source)
              : safeAudio(source),
        ).ok,
      });
    }
    return { compared, differences, checks };
  });
  expect(result.compared).toBeGreaterThan(250);
  expect(result.differences).toEqual([]);
  expect(result.checks.every((c) => c.accepted)).toBe(true);
});

for (const kind of ["image", "video", "audio"] as const)
  test(`${kind} decoded byte limit is exact at minus one, boundary and plus one`, async ({
    page,
  }) => {
    await page.goto(origin);
    const result = await page.evaluate(async (kind) => {
      const { safeVideo, MAX_VIDEO_BYTES, bytesDataUrl } = await import(
        "/src/video.ts"
      );
      const { safeAudio, MAX_AUDIO_BYTES } = await import("/src/audio.ts");
      const { validateDeck } = await import("/src/io.ts");
      const { blankDeck } = await import("/src/model.ts");
      const maximum =
        kind === "image"
          ? 16 * 1024 * 1024
          : kind === "video"
            ? MAX_VIDEO_BYTES
            : MAX_AUDIO_BYTES;
      const mime =
        kind === "image"
          ? "image/png"
          : kind === "video"
            ? "video/mp4"
            : "audio/wav";
      const header =
        kind === "image"
          ? [137, 80, 78, 71, 13, 10, 26, 10]
          : kind === "video"
            ? [0, 0, 0, 24, 102, 116, 121, 112]
            : [82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69];
      const outcomes = [];
      for (const delta of [-1, 0, 1]) {
        const bytes = new Uint8Array(maximum + delta);
        bytes.set(header);
        const source = bytesDataUrl(bytes, mime);
        let ok = false,
          identical = false;
        try {
          let out: string;
          if (kind === "image") {
            const d = blankDeck();
            d.slides[0].elements = [
              {
                id: "img",
                type: "image",
                x: 0,
                y: 0,
                width: 100,
                height: 100,
                rotation: 0,
                opacity: 1,
                src: source,
              },
            ];
            out = validateDeck(d).slides[0].elements[0].src!;
          } else out = kind === "video" ? safeVideo(source) : safeAudio(source);
          ok = true;
          identical = out === source;
        } catch {}
        outcomes.push({ delta, ok, identical });
      }
      return outcomes;
    }, kind);
    expect(result).toEqual([
      { delta: -1, ok: true, identical: true },
      { delta: 0, ok: true, identical: true },
      { delta: 1, ok: false, identical: false },
    ]);
  });
