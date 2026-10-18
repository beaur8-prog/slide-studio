const child = (n: Element | undefined, name: string) =>
  Array.from(n?.children ?? []).find((c) => c.localName === name);
const unit = (60000 * 180) / Math.PI;
/** Bounded DrawingML geometry formula evaluator. No eval, scripts or source markup execution. */
export function drawingGuides(
  geometry: Element,
  width: number,
  height: number,
) {
  const values = new Map<string, number>(
    Object.entries({
      w: width,
      h: height,
      l: 0,
      t: 0,
      r: width,
      b: height,
      hc: width / 2,
      vc: height / 2,
      ss: Math.min(width, height),
      ls: Math.max(width, height),
      cd: 21600000,
      cd2: 10800000,
      cd4: 5400000,
      cd8: 2700000,
      "3cd4": 16200000,
      "3cd8": 8100000,
      "5cd8": 13500000,
      "7cd8": 18900000,
    }),
  );
  for (let i = 1; i <= 32; i++) {
    values.set("wd" + i, width / i);
    values.set("hd" + i, height / i);
    values.set("ssd" + i, Math.min(width, height) / i);
  }
  const resolve = (token: string | null): number => {
    if (token === null) throw Error("Missing geometry value");
    const n = values.has(token)
      ? values.get(token)!
      : /^[-+]?(?:\d*\.)?\d+$/.test(token)
        ? Number(token)
        : NaN;
    if (!Number.isFinite(n) || Math.abs(n) > 1e40)
      throw Error("Invalid geometry guide: " + token);
    return n;
  };
  const guides = [
    ...Array.from(child(geometry, "avLst")?.children ?? []),
    ...Array.from(child(geometry, "gdLst")?.children ?? []),
  ];
  if (guides.length > 2000) throw Error("Too many geometry guides");
  for (const gd of guides) {
    const tokens = (gd.getAttribute("fmla") ?? "").trim().split(/\s+/),
      op = tokens.shift(),
      a = tokens.map(resolve),
      [x, y, z] = a;
    let n: number;
    switch (op) {
      case "val":
        n = x;
        break;
      case "*/":
        n = (x * y) / z;
        break;
      case "+-":
        n = x + y - z;
        break;
      case "+/":
        n = (x + y) / z;
        break;
      case "?:":
        n = x > 0 ? y : z;
        break;
      case "abs":
        n = Math.abs(x);
        break;
      case "at2":
        n = Math.atan2(y, x) * unit;
        break;
      case "cat2":
        n = x * Math.cos(Math.atan2(z, y));
        break;
      case "sat2":
        n = x * Math.sin(Math.atan2(z, y));
        break;
      case "cos":
        n = x * Math.cos(y / unit);
        break;
      case "sin":
        n = x * Math.sin(y / unit);
        break;
      case "tan":
        n = x * Math.tan(y / unit);
        break;
      case "max":
        n = Math.max(x, y);
        break;
      case "min":
        n = Math.min(x, y);
        break;
      case "mod":
        n = Math.hypot(x, y, z);
        break;
      case "pin":
        n = Math.max(x, Math.min(y, z));
        break;
      case "sqrt":
        n = Math.sqrt(x);
        break;
      default:
        throw Error("Unsupported geometry formula");
    }
    if (!Number.isFinite(n) || Math.abs(n) > 1e40)
      throw Error("Geometry formula out of bounds");
    const name = gd.getAttribute("name");
    if (!name || name.length > 160) throw Error("Invalid guide name");
    values.set(name, n);
  }
  return resolve;
}
export function drawingTextFrame(
  geometry: Element | undefined,
  width: number,
  height: number,
): [number, number, number, number] | undefined {
  if (!geometry) return;
  const rect = child(geometry, "rect");
  if (!rect) return;
  try {
    const value = drawingGuides(geometry, width, height),
      l = value(rect.getAttribute("l")),
      t = value(rect.getAttribute("t")),
      r = value(rect.getAttribute("r")),
      b = value(rect.getAttribute("b"));
    if (r <= l || b <= t) return;
    return [l / width, t / height, (r - l) / width, (b - t) / height];
  } catch {
    return;
  }
}
