export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: string) {
  return normalizeWhitespace(value).toUpperCase();
}

export function countWords(value: string) {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .filter((token) => token && !/^[-/&]+$/.test(token)).length;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
