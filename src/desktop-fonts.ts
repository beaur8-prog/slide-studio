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
    if (
      window.desktop?.platform !== "win32" ||
      !window.desktop.loadOfficeLightFont
    )
      return false;
    return registerOfficeLightFont(await window.desktop.loadOfficeLightFont());
  } catch {
    return false;
  }
}
