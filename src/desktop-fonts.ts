export const OFFICE_LIGHT_FONT = "Slide Studio Office Arial Nova Light";

export async function registerOfficeLightFont(
  bytes: Uint8Array | null,
): Promise<boolean> {
  try {
    if (!bytes || bytes.byteLength < 12 || bytes.byteLength > 2 * 1024 * 1024)
      return false;
    const copy = new Uint8Array(bytes);
    const face = new FontFace(OFFICE_LIGHT_FONT, copy.buffer, {
      weight: "300",
      style: "normal",
      display: "block",
    });
    await face.load();
    document.fonts.add(face);
    return true;
  } catch {
    return false;
  }
}

// Optional desktop-only access to an existing Office cache. Browsers and PCs
// without this face continue with the regular system/font fallback stack.
export async function installDesktopFonts(): Promise<boolean> {
  try {
    let loaded = false;
    if (window.desktop?.loadOfficeCalibriFonts) {
      const fonts = await window.desktop
        .loadOfficeCalibriFonts()
        .catch(() => []);
      for (const font of fonts.slice(0, 6)) {
        try {
          if (
            !["Calibri", "Calibri Light"].includes(font.family) ||
            ![300, 400, 700].includes(font.weight) ||
            !["normal", "italic"].includes(font.style) ||
            font.bytes.byteLength > 2 * 1024 * 1024
          )
            continue;
          const bytes = new Uint8Array(font.bytes);
          const face = new FontFace(
            `Slide Studio Office ${font.family}`,
            bytes.buffer,
            {
              weight: String(font.weight),
              style: font.style,
              display: "block",
            },
          );
          await face.load();
          document.fonts.add(face);
          loaded = true;
        } catch {
          /* Keep other styles and the existing fallback usable. */
        }
      }
    }
    if (
      window.desktop?.platform !== "win32" ||
      !window.desktop.loadOfficeLightFont
    )
      return loaded;
    return (
      (await registerOfficeLightFont(
        await window.desktop.loadOfficeLightFont(),
      )) || loaded
    );
  } catch {
    return false;
  }
}
