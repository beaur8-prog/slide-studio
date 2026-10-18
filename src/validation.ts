export function fail(message: string): never {
  throw new Error(message);
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label}: 올바른 객체가 아닙니다.`);
  return value as Record<string, unknown>;
}
export function stringValue(
  value: unknown,
  label: string,
  max = 100000,
  allowEmpty = true,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim())
  )
    fail(`${label}: 문자열이 없거나 너무 깁니다.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value as string))
    fail(`${label}: 지원하지 않는 제어 문자가 있습니다.`);
  return value as string;
}
export function numberValue(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail(`${label}: ${min}–${max} 범위의 숫자가 필요합니다.`);
  return value as number;
}
export function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") fail(`${label}: 불리언 값이 필요합니다.`);
  return value as boolean;
}
export function colorValue(
  value: unknown,
  label: string,
  transparent = false,
): string {
  if (transparent && value === "transparent") return "transparent";
  if (typeof value !== "string") fail(`${label}: HEX 색상이 필요합니다.`);
  const hex = (value as string).replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex))
    return `#${[...hex]
      .map((x) => x + x)
      .join("")
      .toUpperCase()}`;
  if (!/^[0-9a-f]{6}$/i.test(hex)) fail(`${label}: HEX 색상이 필요합니다.`);
  return `#${hex.toUpperCase()}`;
}
export function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !values.includes(value as T))
    fail(`${label}: 지원하지 않는 값입니다.`);
  return value as T;
}
