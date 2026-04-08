function collapseWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function toDisplayCase(value: string) {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function normalizeWorkerNameKey(value: string) {
  return collapseWhitespace(value).toLowerCase();
}

export function splitWorkerName(value: string) {
  const cleaned = collapseWhitespace(value);

  if (!cleaned) {
    return {
      baseName: "",
      workerLabel: "",
      displayName: "",
    };
  }

  const match = cleaned.match(/^(.*?)(?:\s*\(([^()]+)\))?$/);
  const baseName = toDisplayCase(match?.[1] ?? cleaned);
  const workerLabel = toDisplayCase(match?.[2] ?? "");

  return {
    baseName,
    workerLabel,
    displayName: formatWorkerName(baseName, workerLabel),
  };
}

export function formatWorkerName(baseName: string, workerLabel?: string) {
  const normalizedBaseName = toDisplayCase(baseName);
  const normalizedWorkerLabel = toDisplayCase(workerLabel ?? "");

  if (!normalizedBaseName) return "";

  return normalizedWorkerLabel
    ? `${normalizedBaseName} (${normalizedWorkerLabel})`
    : normalizedBaseName;
}

export function getWorkerBaseName(value: string) {
  return splitWorkerName(value).baseName;
}

export function getWorkerBaseKey(value: string) {
  return normalizeWorkerNameKey(getWorkerBaseName(value));
}

export function normalizeWorkerLabel(value: string) {
  return toDisplayCase(value);
}
