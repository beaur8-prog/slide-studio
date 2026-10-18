export function listNumberLabel(type: string, value: number): string {
  const alpha = (n: number) => {
    let s = "";
    while (n > 0) {
      n--;
      s = String.fromCharCode(97 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  };
  const roman = (n: number) => {
    let s = "";
    for (const [v, t] of [
      [1000, "M"],
      [900, "CM"],
      [500, "D"],
      [400, "CD"],
      [100, "C"],
      [90, "XC"],
      [50, "L"],
      [40, "XL"],
      [10, "X"],
      [9, "IX"],
      [5, "V"],
      [4, "IV"],
      [1, "I"],
    ] as const)
      while (n >= v) {
        s += t;
        n -= v;
      }
    return s;
  };
  let label = type.startsWith("alpha")
    ? alpha(value)
    : type.startsWith("roman") && value < 4000
      ? roman(value)
      : String(value);
  if (type.startsWith("alphaUc")) label = label.toUpperCase();
  if (type.startsWith("romanLc")) label = label.toLowerCase();
  if (type.startsWith("circleNum") && value <= 20)
    return String.fromCodePoint(
      (type.includes("Black") ? (value <= 10 ? 0x2775 : 0x24e0) : 0x245f) +
        value,
    );
  if (type.endsWith("ParenBoth")) return "(" + label + ")";
  if (type.endsWith("ParenR")) return label + ")";
  if (type.endsWith("Period")) return label + ".";
  return label;
}
