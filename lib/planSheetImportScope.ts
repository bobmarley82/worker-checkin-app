export type PlanSheetPreflightPage = {
  pageNumber: number;
  textSample: string;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  discipline: string | null;
};

export type PlanSheetImportScopeKind =
  | "all"
  | "pages"
  | "discipline"
  | "mixed";

export type PlanSheetPageSelectionParseResult = {
  pageNumbers: number[];
  normalized: string;
  errors: string[];
};

export type PlanSheetImportSelectionResult = {
  pageNumbers: number[];
  scopeKind: PlanSheetImportScopeKind;
  normalizedPageSelection: string | null;
  selectedDisciplines: string[];
  includeUnknownDisciplines: boolean;
  errors: string[];
};

export const PLAN_SHEET_UNKNOWN_DISCIPLINE = "Unknown";

export const PLAN_SHEET_DISCIPLINE_OPTIONS = [
  "Architectural",
  "Structural",
  "Mechanical",
  "Electrical",
  "Plumbing",
  "Civil",
  "Fire Protection",
  "Interiors",
  "Telecommunications",
  "Landscape",
  "General",
  PLAN_SHEET_UNKNOWN_DISCIPLINE,
] as const;

const DISCIPLINE_LABELS = new Map<string, string>([
  ["a", "Architectural"],
  ["architectural", "Architectural"],
  ["s", "Structural"],
  ["structural", "Structural"],
  ["m", "Mechanical"],
  ["mechanical", "Mechanical"],
  ["hvac", "Mechanical"],
  ["e", "Electrical"],
  ["electrical", "Electrical"],
  ["p", "Plumbing"],
  ["plumbing", "Plumbing"],
  ["c", "Civil"],
  ["civil", "Civil"],
  ["f", "Fire Protection"],
  ["fp", "Fire Protection"],
  ["fa", "Fire Protection"],
  ["fire", "Fire Protection"],
  ["fire protection", "Fire Protection"],
  ["i", "Interiors"],
  ["interiors", "Interiors"],
  ["id", "Interiors"],
  ["t", "Telecommunications"],
  ["telecom", "Telecommunications"],
  ["telecommunications", "Telecommunications"],
  ["technology", "Telecommunications"],
  ["l", "Landscape"],
  ["landscape", "Landscape"],
  ["g", "General"],
  ["general", "General"],
  ["title", "General"],
]);

const DISCIPLINE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bARCHITECTURAL\b/i, "Architectural"],
  [/\bSTRUCTURAL\b/i, "Structural"],
  [/\bMECHANICAL\b|\bHVAC\b/i, "Mechanical"],
  [/\bELECTRICAL\b|\bPOWER\b|\bLIGHTING\b/i, "Electrical"],
  [/\bPLUMBING\b/i, "Plumbing"],
  [/\bCIVIL\b/i, "Civil"],
  [/\bFIRE\s+(?:PROTECTION|ALARM|SPRINKLER)\b/i, "Fire Protection"],
  [/\bINTERIORS?\b|\bINTERIOR\s+DESIGN\b/i, "Interiors"],
  [/\bTELECOM(?:MUNICATIONS)?\b|\bTECHNOLOGY\b/i, "Telecommunications"],
  [/\bLANDSCAPE\b/i, "Landscape"],
  [/\bGENERAL\b|\bCOVER\s+SHEET\b|\bSHEET\s+INDEX\b/i, "General"],
];

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeDisciplineKey(value: string | null | undefined) {
  return normalizeWhitespace(value).toLowerCase();
}

export function normalizePlanSheetDiscipline(value: string | null | undefined) {
  const normalized = normalizeDisciplineKey(value);
  if (!normalized) {
    return null;
  }

  if (normalized === "unknown") {
    return PLAN_SHEET_UNKNOWN_DISCIPLINE;
  }

  return DISCIPLINE_LABELS.get(normalized) ?? normalizeWhitespace(value);
}

function addPageNumber(
  pages: Set<number>,
  pageNumber: number,
  totalPageCount: number | null,
  errors: string[]
) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    errors.push(`Page ${pageNumber} is not a valid 1-based page number.`);
    return;
  }

  if (totalPageCount !== null && pageNumber > totalPageCount) {
    errors.push(`Page ${pageNumber} is outside this ${totalPageCount}-page PDF.`);
    return;
  }

  pages.add(pageNumber);
}

export function formatPlanSheetPageSelection(pageNumbers: readonly number[]) {
  const sorted = Array.from(
    new Set(
      pageNumbers
        .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
        .map((pageNumber) => Math.trunc(pageNumber))
    )
  ).sort((left, right) => left - right);

  const ranges: string[] = [];
  let rangeStart: number | null = null;
  let previous: number | null = null;

  for (const pageNumber of sorted) {
    if (rangeStart === null || previous === null) {
      rangeStart = pageNumber;
      previous = pageNumber;
      continue;
    }

    if (pageNumber === previous + 1) {
      previous = pageNumber;
      continue;
    }

    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
    rangeStart = pageNumber;
    previous = pageNumber;
  }

  if (rangeStart !== null && previous !== null) {
    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
  }

  return ranges.join(", ");
}

export function parsePlanSheetPageSelection(
  input: string | null | undefined,
  totalPageCount?: number | null
): PlanSheetPageSelectionParseResult {
  const normalizedInput = normalizeWhitespace(input);
  const errors: string[] = [];
  const pages = new Set<number>();
  const effectivePageCount =
    typeof totalPageCount === "number" && Number.isFinite(totalPageCount)
      ? Math.trunc(totalPageCount)
      : null;

  if (!normalizedInput) {
    return {
      pageNumbers: [],
      normalized: "",
      errors: ["Enter at least one page number or range."],
    };
  }

  const tokenInput = normalizedInput
    .replace(/\s*-\s*/g, "-")
    .replace(/[,+;]/g, " ")
    .replace(/\s+/g, " ");
  const tokens = tokenInput.split(" ").filter(Boolean);

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
        errors.push(`Range ${token} is not valid.`);
        continue;
      }

      if (start > end) {
        errors.push(`Range ${token} runs backward.`);
        continue;
      }

      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        addPageNumber(pages, pageNumber, effectivePageCount, errors);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      addPageNumber(pages, Number(token), effectivePageCount, errors);
      continue;
    }

    errors.push(`Could not understand page token "${token}".`);
  }

  const pageNumbers = Array.from(pages).sort((left, right) => left - right);
  if (pageNumbers.length === 0 && errors.length === 0) {
    errors.push("No pages matched that selection.");
  }

  return {
    pageNumbers,
    normalized: formatPlanSheetPageSelection(pageNumbers),
    errors: Array.from(new Set(errors)),
  };
}

function inferDisciplineFromSheetNumber(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toUpperCase();
  const match = normalized.match(/^([A-Z]{1,3})[\s.\-]?\d/);
  if (!match) {
    return null;
  }

  const prefix = match[1];
  if (prefix.startsWith("FP") || prefix === "FA" || prefix === "F") {
    return "Fire Protection";
  }

  if (prefix.startsWith("ID")) {
    return "Interiors";
  }

  const firstLetter = prefix.charAt(0).toLowerCase();
  return DISCIPLINE_LABELS.get(firstLetter) ?? null;
}

function extractLikelySheetNumber(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toUpperCase();
  const match = normalized.match(/\b([A-Z]{1,3}[\s.\-]?\d[\w.\-]*)\b/);
  return match?.[1] ?? null;
}

export function classifyPlanSheetDisciplineFromText(args: {
  text?: string | null;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
}) {
  const explicitSheetNumber = normalizeWhitespace(args.sheetNumber);
  const inferredNumber = explicitSheetNumber || extractLikelySheetNumber(args.text);
  const fromNumber = inferDisciplineFromSheetNumber(inferredNumber);
  if (fromNumber) {
    return fromNumber;
  }

  const combinedText = [args.sheetTitle, args.text]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
    .join(" ");

  for (const [pattern, discipline] of DISCIPLINE_TEXT_PATTERNS) {
    if (pattern.test(combinedText)) {
      return discipline;
    }
  }

  return PLAN_SHEET_UNKNOWN_DISCIPLINE;
}

export function sanitizePlanSheetPreflightPages(
  pages: readonly PlanSheetPreflightPage[] | null | undefined,
  sourcePageCount?: number | null
) {
  const effectivePageCount =
    typeof sourcePageCount === "number" && Number.isFinite(sourcePageCount)
      ? Math.trunc(sourcePageCount)
      : null;
  const sanitized = new Map<number, PlanSheetPreflightPage>();

  for (const page of pages ?? []) {
    const pageNumber = Math.trunc(Number(page.pageNumber));
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      continue;
    }
    if (effectivePageCount !== null && pageNumber > effectivePageCount) {
      continue;
    }

    const textSample = normalizeWhitespace(page.textSample).slice(0, 2000);
    const sheetNumber = normalizeWhitespace(page.sheetNumber);
    const sheetTitle = normalizeWhitespace(page.sheetTitle);
    const discipline =
      normalizePlanSheetDiscipline(page.discipline) ||
      classifyPlanSheetDisciplineFromText({
        text: textSample,
        sheetNumber,
        sheetTitle,
      });

    sanitized.set(pageNumber, {
      pageNumber,
      textSample,
      sheetNumber: sheetNumber || null,
      sheetTitle: sheetTitle || null,
      discipline,
    });
  }

  return Array.from(sanitized.values()).sort(
    (left, right) => left.pageNumber - right.pageNumber
  );
}

export function buildPlanSheetImportSelection(args: {
  sourcePageCount?: number | null;
  pageSelection?: string | null;
  disciplineFilters?: readonly string[] | null;
  includeUnknownDisciplines?: boolean | null;
  preflightPages?: readonly PlanSheetPreflightPage[] | null;
}): PlanSheetImportSelectionResult {
  const sourcePageCount =
    typeof args.sourcePageCount === "number" && Number.isFinite(args.sourcePageCount)
      ? Math.trunc(args.sourcePageCount)
      : null;
  const preflightPages = sanitizePlanSheetPreflightPages(
    args.preflightPages ?? [],
    sourcePageCount
  );
  const hasPageSelection = Boolean(normalizeWhitespace(args.pageSelection));
  const selectedDisciplines = Array.from(
    new Set(
      (args.disciplineFilters ?? [])
        .map((value) => normalizePlanSheetDiscipline(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  const includeUnknownDisciplines = Boolean(args.includeUnknownDisciplines);
  const errors: string[] = [];

  const pageSelectionResult = hasPageSelection
    ? parsePlanSheetPageSelection(args.pageSelection, sourcePageCount)
    : null;
  if (pageSelectionResult?.errors.length) {
    errors.push(...pageSelectionResult.errors);
  }

  let basePageNumbers: number[] = [];
  if (pageSelectionResult?.pageNumbers.length) {
    basePageNumbers = pageSelectionResult.pageNumbers;
  } else if (sourcePageCount !== null && sourcePageCount > 0) {
    basePageNumbers = Array.from({ length: sourcePageCount }, (_, index) => index + 1);
  } else if (preflightPages.length > 0) {
    basePageNumbers = preflightPages.map((page) => page.pageNumber);
  } else {
    errors.push("The PDF page count is required before import.");
  }

  let pageNumbers = Array.from(new Set(basePageNumbers)).sort(
    (left, right) => left - right
  );

  if (selectedDisciplines.length > 0) {
    const selectedSet = new Set(selectedDisciplines);
    const preflightByPage = new Map(
      preflightPages.map((page) => [page.pageNumber, page] as const)
    );
    pageNumbers = pageNumbers.filter((pageNumber) => {
      const discipline =
        preflightByPage.get(pageNumber)?.discipline ?? PLAN_SHEET_UNKNOWN_DISCIPLINE;
      if (discipline === PLAN_SHEET_UNKNOWN_DISCIPLINE) {
        return includeUnknownDisciplines || selectedSet.has(PLAN_SHEET_UNKNOWN_DISCIPLINE);
      }

      return selectedSet.has(discipline);
    });
  }

  if (pageNumbers.length === 0 && errors.length === 0) {
    errors.push("No PDF pages matched that import scope.");
  }

  const scopeKind: PlanSheetImportScopeKind =
    hasPageSelection && selectedDisciplines.length > 0
      ? "mixed"
      : hasPageSelection
        ? "pages"
        : selectedDisciplines.length > 0
          ? "discipline"
          : "all";

  return {
    pageNumbers,
    scopeKind,
    normalizedPageSelection:
      pageSelectionResult?.normalized ||
      (scopeKind === "all" ? null : formatPlanSheetPageSelection(pageNumbers)),
    selectedDisciplines,
    includeUnknownDisciplines,
    errors: Array.from(new Set(errors)),
  };
}
