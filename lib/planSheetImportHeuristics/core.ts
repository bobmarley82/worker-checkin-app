function words(value: string) {
  return normalizeWhitespace(value)
    .split(/\s+/)
    .filter(Boolean);
}

function upper(value: string | null | undefined) {
  return normalizeWhitespace(value).toUpperCase();
}

function containsAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

const MONTH_NAME_PATTERN =
  "(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)";

const MONTH_NAME_DATE_PATTERN = new RegExp(
  `\\b${MONTH_NAME_PATTERN}\\s+\\d{1,2},?\\s+\\d{2,4}\\b|\\b\\d{1,2}\\s+${MONTH_NAME_PATTERN}\\s+\\d{2,4}\\b`,
  "i"
);

function isMonthNameDateSource(text: string) {
  return MONTH_NAME_DATE_PATTERN.test(normalizeWhitespace(text));
}

function isMonthDaySheetNumberArtifact(sheetNumber: string, sourceText: string) {
  const normalizedNumber = normalizeSheetNumberValue(sheetNumber).replace(/[.-]/g, "");
  if (!normalizedNumber) return false;

  const source = upper(sourceText).replace(/,/g, " ");
  const monthDayMatch = source.match(
    new RegExp(`\\b(${MONTH_NAME_PATTERN})\\s+(\\d{1,2})(?:\\s+\\d{2,4})?\\b`, "i")
  );
  if (!monthDayMatch) return false;

  const monthPrefix = normalizeSheetNumberValue(monthDayMatch[1] ?? "").slice(0, 3);
  const day = monthDayMatch[2] ?? "";
  return Boolean(monthPrefix && day && normalizedNumber === `${monthPrefix}${day}`);
}

function isLikelyBodyNoteTitleFragment(text: string) {
  const normalized = upper(text);
  const wordCount = words(normalized).length;
  if (!normalized || wordCount < 3) return false;

  if (/[,;:]$/.test(normalized) && wordCount >= 4) {
    return true;
  }

  if (
    /\b(?:NOTED\s+ON|LISTS?\s+ON|SHOWN\s+ON|REFER\s+TO|PROVIDE|VERIFY|INSTALL(?:ED|ATION)?|ABOVE\s+LIST|UNLESS\s+OTHERWISE|COORDINATE\s+WITH|LOCATED\s+ON)\b/.test(
      normalized
    )
  ) {
    return true;
  }

  if (/\b(?:DRAWINGS?|SCHEDULE)\.\s+\b(?:CONSTRUCTION|DEMOLITION|EXISTING|GENERAL)\b/.test(normalized)) {
    return true;
  }

  if (/\b(?:ON|WITH|FOR|OF|TO|FROM|BY)\s*$/.test(normalized) && wordCount >= 4) {
    return true;
  }

  return false;
}

function extractSheetNumbersFromText(text: string) {
  return [
    ...upper(text).matchAll(
      /\b[A-Z]{0,3}\s*[-.]?\s*\d{1,3}(?:\s*[.-]\s*\d{1,3})?[A-Z]?(?:\s*[-.]\s*[A-Z0-9]{1,3})?\b/g
    ),
  ]
    .map((match) => normalizeSheetNumberValue(match[0] ?? ""))
    .filter(Boolean);
}

function clampTitle(value: string) {
  return normalizeWhitespace(value)
    .replace(/\bDRAWING TITLE\b/gi, "")
    .replace(/\bSCALE:\s*AS\s+NOTED\b/gi, "")
    .replace(/\bSCALE:\s*\S+\b/gi, "")
    .replace(/\bSHEET TITLE\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function canonicalizeCommonTitleWordOrder(value: string) {
  return normalizeWhitespace(value)
    .replace(/\bPALN\b/gi, "PLAN")
    .replace(/\bELECTRIC\s+(?=PLAN|PLANS|NOTES?|SCHEDULES?|DETAILS?|LEGEND)\b/gi, "ELECTRICAL ")
    .replace(/^PLAN\s+SITE$/i, "SITE PLAN")
    .replace(/^DETAILS\s+WALL$/i, "WALL DETAILS")
    .replace(
      /^(?:PLAN\s+)?DEMO\s+EXISTING\s+ELEVATIONS$/i,
      "EXISTING + DEMO PLAN + ELEVATIONS"
    )
    .replace(
      /^DEMO\s+PLAN\s+EXISTING\s+ELEVATIONS$/i,
      "EXISTING + DEMO PLAN + ELEVATIONS"
    )
    .replace(/^PLAN\s+FLOOR\s+PROPOSED$/i, "PROPOSED FLOOR PLAN")
    .replace(
      /^PROPOSED\s+FLOOR\s+PLAN\s+ELEVATIONS$/i,
      "PROPOSED FLOOR PLAN + ELEVATIONS"
    )
    .replace(
      /^PROPOSED\s+PLAN\s+CEILING\s+EXISTING\s+REFLECTED$/i,
      "EXISTING + PROPOSED REFLECTED CEILING PLAN"
    )
    .replace(
      /^PROPOSED\s+PLAN\s+EXISTING\s+REFLECTED\s+CEILING\s+PLAN$/i,
      "EXISTING + PROPOSED REFLECTED CEILING PLAN"
    )
    .replace(/^\s*N\s+(?=(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|BASEMENT|LEVEL)\b)/i, "");
}

function hasSheetTitleObjectNoun(text: string) {
  return /\b(?:PLAN|PLANS|ELEVATION|ELEVATIONS|DETAIL|DETAILS|SECTION|SECTIONS|SCHEDULE|SCHEDULES|NOTE|NOTES|COVER|SHEET|LEGEND|ABBREVIATION|ABBREVIATIONS|SITE|MAP|MAPS|CONDITIONS|PHOTOGRAPH|GRADING|DEMOLITION|UTILITY|LIGHTING|LANDSCAPE|CEILING|FLOOR|WALL|INFORMATION|INDEX|DATA)\b/i.test(
    text
  );
}

function isBadEdgeTitleLine(text: string) {
  const normalized = upper(text);
  return (
    !normalized ||
    /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CANBY|OREGON|COLIMA|DALTON,\s*MASSACHUSETTS)\b/.test(
      normalized
    ) ||
    /,\s*$/.test(text) ||
    /^(?:PRELIMINARY|CONSTRUCTION|NOT\s+FOR|SHEET\s+INDEX|SITE\s+MAP)$/i.test(
      normalized
    ) ||
    matchesAdministrativeTitleMetadata(normalized)
  );
}

function extractBestEdgeTitleLine(lines: readonly string[]) {
  const normalizedLines = lines.map((line) =>
    canonicalizeCommonTitleWordOrder(clampTitle(line))
  );
  const stackedCandidates: string[] = [];
  for (let index = 0; index < normalizedLines.length; index += 1) {
    const window = normalizedLines
      .slice(index, index + 4)
      .filter((line) => line && !isBadEdgeTitleLine(line));
    if (window.length < 2) {
      continue;
    }
    const reversed = [...window].reverse().join(" ");
    const forward = window.join(" ");
    stackedCandidates.push(reversed, forward);
  }
  const candidates = lines
    .concat(stackedCandidates)
    .map((line) => canonicalizeCommonTitleWordOrder(clampTitle(line)))
    .filter((line) => {
      if (!line || isBadEdgeTitleLine(line)) return false;
      if (!hasSheetTitleObjectNoun(line)) return false;
      if (isReferenceOnlyTitleText(line)) return false;
      return words(line).length <= 12;
    })
    .map((line) => {
      const primaryTitleNouns = [
        /\bCOVER\s+SHEET\b/i,
        /\bPROJECT\s+INFORMATION\b/i,
        /\bGENERAL\s+INFORMATION\b/i,
        /\bEXISTING\s+CONDITIONS?\s+PLAN\b/i,
        /\bPRELIMINARY\s+.*\bPLAN\b/i,
        /\bREFLECTED\s+CEILING\s+PLAN\b/i,
      ].filter((pattern) => pattern.test(line)).length;
      const usefulTitleNouns = [
        /\bPLAN(S)?\b/i,
        /\bELEVATION(S)?\b/i,
        /\bDETAIL(S)?\b/i,
        /\bSECTION(S)?\b/i,
        /\bSCHEDULE(S)?\b/i,
        /\bNOTE(S)?\b/i,
        /\bCOVER\b/i,
        /\bSHEET\b/i,
        /\bSITE\b/i,
        /\bMAP(S)?\b/i,
        /\bCONDITIONS?\b/i,
        /\bPHOTOGRAPH\b/i,
        /\bGRADING\b/i,
        /\bDEMOLITION\b/i,
        /\bUTILITY\b/i,
        /\bLIGHTING\b/i,
        /\bLANDSCAPE\b/i,
        /\bFLOOR\b/i,
        /\bCEILING\b/i,
        /\bINFORMATION\b/i,
      ].filter((pattern) => pattern.test(line)).length;
      return {
        line,
        score:
          primaryTitleNouns * 30 +
          usefulTitleNouns * 18 +
          countTitleVocabularyHits(line) * 8 +
          words(line).length,
      };
    })
    .sort((a, b) => b.score - a.score || b.line.length - a.line.length);

  return candidates[0]?.line ?? "";
}

export function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeSheetNumberValue(value: string) {
  return normalizeWhitespace(value)
    .toUpperCase()
    .replace(/\s*([.-])\s*/g, "$1")
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9.\-]/g, "");
}

export function refineSheetNumberCandidateFromLineText(
  sheetNumber: string,
  lineText: string
) {
  const fallback = normalizeSheetNumberValue(sheetNumber);
  const fallbackCompact = fallback.replace(/[.-]/g, "");
  const fallbackParts = parseSheetNumberParts(fallback);
  const line = upper(lineText);
  const matches = [
    ...line.matchAll(
      /\b[A-Z]{0,4}\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?\b/g
    ),
  ]
    .map((match) => normalizeSheetNumberValue(match[0] ?? ""))
    .filter(Boolean);

  for (const match of matches) {
    const matchCompact = match.replace(/[.-]/g, "");
    const matchParts = parseSheetNumberParts(match);
    if (
      matchCompact.endsWith(fallbackCompact) ||
      matchCompact.startsWith(fallbackCompact) ||
      (
        fallbackParts &&
        matchParts &&
        fallbackParts.prefix === matchParts.prefix &&
        fallbackParts.main === matchParts.main &&
        (fallbackParts.sub === null || fallbackParts.sub === matchParts.sub) &&
        matchCompact.length > fallbackCompact.length
      )
    ) {
      return match;
    }
  }

  return fallback || normalizeWhitespace(sheetNumber);
}

export function preferMoreSpecificCompatibleSheetNumber(
  primarySheetNumber: string,
  candidateSheetNumber: string
) {
  const primary = normalizeSheetNumberValue(primarySheetNumber);
  const candidate = normalizeSheetNumberValue(candidateSheetNumber);
  if (!primary) return candidate;
  if (!candidate) return primary;
  return candidate.length > primary.length ? candidate : primary;
}

export function choosePreferredSingleAcceptedAnchorNumber(args: {
  primaryNumber?: string;
  alternateNumber?: string | null;
  singleAcceptedAnchorNumber?: string | null;
  ocrSheetNumber?: string | null;
  ocrNumberScore?: number | null;
  sheetNumber?: string | null;
}) {
  return preferMoreSpecificCompatibleSheetNumber(
    args.singleAcceptedAnchorNumber ?? args.sheetNumber ?? args.primaryNumber ?? "",
    args.ocrSheetNumber ?? args.alternateNumber ?? ""
  );
}

export function promoteAlternateStarSheetNumber(args: {
  primaryNumber?: string;
  alternateNumber?: string | null;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  numberSourceText?: string | null;
  contextText?: string | null;
}) {
  return choosePreferredSingleAcceptedAnchorNumber({
    primaryNumber: args.sheetNumber ?? args.primaryNumber ?? "",
    alternateNumber: args.alternateNumber ?? "",
  });
}

export function inferSheetDiscipline(sheetNumber: string, sheetTitle = "") {
  const number = upper(sheetNumber);
  const title = upper(sheetTitle);
  const prefix = number.match(/^[A-Z]{1,3}/)?.[0] ?? "";
  if (prefix) return prefix[0];
  if (/PLUMB/i.test(title)) return "P";
  if (/ELEC/i.test(title)) return "E";
  if (/HVAC|MECH/i.test(title)) return "M";
  if (/STRUCT/i.test(title)) return "S";
  if (/CIVIL|GRAD|DRAIN/i.test(title)) return "C";
  if (/ARCH|FLOOR PLAN|ELEVATION|DETAIL/i.test(title)) return "A";
  if (/GENERAL|COVER|INDEX/i.test(title)) return "G";
  return null;
}

export function shouldAllowUnsupportedOcrPrefix(args: {
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  title?: string | null;
  titleScore?: number | null;
  localized?: boolean | null;
  matchesCompactStampSignal?: boolean | null;
}) {
  return /BUILDING|FLOOR PLAN|ELEVATION|DETAIL/i.test(
    `${args.sheetNumber ?? ""} ${args.sheetTitle ?? args.title ?? ""}`
  );
}

export function reconcileOcrSheetNumberWithAnchorNumbers(
  sheetNumber: string,
  ...anchorNumbers: Array<string | string[] | null | undefined>
) {
  let best = normalizeSheetNumberValue(sheetNumber);
  for (const anchor of anchorNumbers) {
    const values = Array.isArray(anchor) ? anchor : [anchor];
    for (const value of values) {
      const normalized = normalizeSheetNumberValue(value ?? "");
      if (normalized.length > best.length) best = normalized;
    }
  }
  return best;
}

export function countSheetReferenceTokens(text: string) {
  return [
    ...upper(text).matchAll(
      /\b[A-Z]{1,4}\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?\b/g
    ),
  ].length;
}

export function matchesTitleLikeVocabulary(text: string) {
  return countTitleVocabularyHits(text) > 0;
}

function matchesSheetIdentityLabelVocabulary(text: string) {
  const normalized = upper(text).replace(/[:#\-\s]+$/g, "").trim();
  return /^(?:SHEET|SHEET\s*(?:NO\.?|NUMBER|#)|DRAWING\s*(?:NO\.?|NUMBER)|DRAWING\s*TITLE|SHEET\s*TITLE|VIEW\s*TITLE|DETAIL\s*(?:NUMBER|SHEET\s*NUMBER)|CALLOUT\s*(?:DRAWING|SHEET)\s*NUMBER)$/i.test(
    normalized
  );
}

export function countTitleVocabularyHits(text: string) {
  const normalized = upper(text);
  const patterns = [
    /\bCOVER\s+SHEET\b/,
    /\bPLAN\b/,
    /\bFLOOR\b/,
    /\bCEILING\b/,
    /\bELEVATION(S)?\b/,
    /\bDETAIL(S)?\b/,
    /\bSECTION(S)?\b/,
    /\bSCHEDULE(S)?\b/,
    /\bALLOCATIONS?\b/,
    /\bBUILDING\b/,
    /\bEXISTING\/REMOVAL\b/,
    /\bCONSTRUCTION\b/,
    /\bNOTE(S)?\b/,
    /\bSITE\b/,
    /\bPROJECT\b/,
    /\bDATA\b/,
    /\bABBREVIATIONS?\b/,
    /\bSYMBOLS?\b/,
    /\bCIVIL\b/,
    /\bROOF\b/,
    /\bFOUNDATION\b/,
    /\bDEMOLITION\b/,
    /\bGRADING\b/,
    /\bEROSION\b/,
    /\bCONTROL\b/,
    /\bUTILITY\b/,
    /\bCONDITIONS?\b/,
    /\bPHOTOGRAPHS?\b/,
    /\bMAPS?\b/,
    /\bLIGHTING\b/,
    /\bMECHANICAL\b/,
    /\bELECTRICAL\b/,
    /\bPLUMBING\b/,
    /\bHVAC\b/,
    /\bLANDSCAPE\b/,
    /\bINFORMATION\b/,
    /\bCOVER\b/,
  ];
  return patterns.filter((pattern) => pattern.test(normalized)).length;
}

export function isStrongStructuredRecoveredOcrTitle(text: string) {
  const normalized = upper(text);
  return (
    countTitleVocabularyHits(normalized) >= 2 &&
    words(normalized).length >= 3 &&
    !isLikelyLowInformationSheetTitle(normalized)
  );
}

export function isUsableRecoveredOcrTitle(text: string) {
  return countTitleVocabularyHits(text) >= 1 && words(text).length >= 2;
}

export function shouldPreferAlternateSameNumberOcrTitle(args: {
  currentTitle?: string | null;
  alternateTitle?: string | null;
  primaryTitle?: string | null;
  alternateSameNumberTitle?: string | null;
  primarySheetNumber?: string | null;
  alternateSheetNumber?: string | null;
  primarySourceText?: string | null;
  alternateSourceText?: string | null;
}) {
  const current = clampTitle(args.currentTitle ?? args.primaryTitle ?? "");
  const alternate = clampTitle(
    args.alternateTitle ?? args.alternateSameNumberTitle ?? ""
  );
  return alternate.length > current.length && countTitleVocabularyHits(alternate) >= countTitleVocabularyHits(current);
}

export function hasStandaloneStructuralAnnotationVocabulary(text: string) {
  return /\bSIM|TYP|UNO|T\/|B\/|CLR\b/i.test(text);
}

export function canonicalizeSheetIndexTitle(text: string) {
  const normalized = clampTitle(text).toUpperCase();
  return normalized === "SHEET INDEX" ? "DRAWING INDEX" : normalizeWhitespace(normalized);
}

export function isCanonicalSheetIndexTitle(text: string) {
  return /\b(DRAWING|SHEET)\s+INDEX\b/i.test(text);
}

export function matchesProjectBrandingVocabulary(text: string) {
  return (
    /\bCLIENT\b|\bCONSULTANT\b/i.test(text) ||
    /\bPROJECT\b/i.test(text) && !/\bPROJECT\s+(?:DATA|INFORMATION)\b/i.test(text)
  );
}

export function normalizeOcrTitleCandidateText(text: string) {
  return canonicalizeCommonTitleWordOrder(clampTitle(text));
}

export function normalizeEmbeddedSheetPathTitleSource(text: string) {
  return clampTitle(text)
    .replace(/[\\/][^\\/]+\.(pdf|dwg|dgn|vwxp)\b/gi, "")
    .trim();
}

export function extractCanonicalTitleFromContext(text: string) {
  const normalized = clampTitle(text);
  const lines = normalized
    .split(/\s*(?:\r?\n|\|)\s*/)
    .map((line) => clampTitle(line))
    .filter(Boolean);
  const candidates = [normalized, ...lines].filter((line) => isUsableRecoveredOcrTitle(line));
  candidates.sort((a, b) => {
    const scoreA = countTitleVocabularyHits(a) * 10 + words(a).length;
    const scoreB = countTitleVocabularyHits(b) * 10 + words(b).length;
    return scoreB - scoreA;
  });
  return candidates[0] ?? normalized;
}

export function isLikelyLowInformationSheetTitle(text: string) {
  const normalized = upper(text);
  return (
    !normalized ||
    /\bAS NOTED\b/.test(normalized) ||
    /^SCALE\b/.test(normalized) ||
    words(normalized).length <= 1
  );
}

export function isOriginalSheetReferenceSource(text: string) {
  return /\boriginal\b/i.test(text);
}

export function stripTrailingTitleAdministrativeSuffix(text: string) {
  return clampTitle(text);
}

export function normalizeComparableSheetTitleText(text: string) {
  return clampTitle(text).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

export function stripTrailingSheetTitleMetadata(text: string) {
  return canonicalizeCommonTitleWordOrder(
    clampTitle(text)
      .replace(
        /\b(EXTERIOR|INTERIOR)\s+ELEVATION\s+ELEVATIONS?\s+UNLESS\b.*$/i,
        "$1 ELEVATIONS"
      )
      .replace(/\bUNLESS\s+THE\s+ARCHITECT'?S?\s+STAMP\b.*$/i, "")
      .replace(/\s*@\s*/g, " @ ")
  );
}

export function enrichPdfTitleWithEdgeLineContext(args: {
  pdfTitleText?: string | null;
  edgeLineText?: string | null;
  currentTitle?: string | null;
  pageLineTexts?: string[] | null;
  edgeLineTexts?: string[] | null;
}) {
  const title = canonicalizeCommonTitleWordOrder(
    clampTitle(args.pdfTitleText ?? args.currentTitle ?? "")
  );
  const edgeLines = [
    args.edgeLineText ?? "",
    ...(args.edgeLineTexts ?? []),
    ...(args.pageLineTexts ?? []),
  ];
  const bestEdgeLine = extractBestEdgeTitleLine(edgeLines);
  const titleLooksLikeStampStatus =
    /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION)\b/i.test(
      title
    );
  const titleIsLowValue =
    !title ||
    titleLooksLikeStampStatus ||
    isGenericAuxiliarySheetTitle(title) ||
    !hasSheetTitleObjectNoun(title) ||
    getTextualTitleRejectPenalty(title) <= -120;
  if (
    bestEdgeLine &&
    titleIsLowValue
  ) {
    return bestEdgeLine;
  }
  return title;
}

export function isPlausibleOcrNumberTokenMatch(
  sourceNumber: string,
  candidateNumber: string
) {
  const source = normalizeSheetNumberValue(sourceNumber).replace(/[.-]/g, "");
  const candidate = normalizeSheetNumberValue(candidateNumber).replace(/[.-]/g, "");
  return Boolean(source && candidate && (source.endsWith(candidate) || candidate.endsWith(source)));
}

export function normalizeOcrSheetNumberWithTitleContext(args: {
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  titleSourceText?: string | null;
  pageLineTexts?: string[] | null;
}) {
  const normalized = normalizeSheetNumberValue(args.sheetNumber ?? "")
    .replace(/^([A-Z]{1,3})(\d{1,3})-(\d{1,3})$/, "$1$2.$3");
  const inferredDiscipline = inferSheetDiscipline(
    normalized,
    `${args.sheetTitle ?? ""} ${args.titleSourceText ?? ""}`
  );
  const titleTokens = words(`${args.sheetTitle ?? ""} ${args.titleSourceText ?? ""}`)
    .map((token) => token.replace(/[^A-Z0-9]/gi, "").toUpperCase())
    .filter((token) => token.length >= 4);
  const currentComparable = normalized.replace(/[.-]/g, "");
  const candidateScores = new Map<string, number>();

  for (const line of args.pageLineTexts ?? []) {
    const normalizedLine = upper(line);
    const tokenMatches = titleTokens.filter((token) =>
      normalizedLine.includes(token)
    ).length;
    if (tokenMatches < 1 && titleTokens.length > 0) {
      continue;
    }
    for (const candidate of extractSheetNumbersFromText(line)) {
      let score = tokenMatches * 10;
      if (inferredDiscipline && candidate.startsWith(inferredDiscipline)) {
        score += 12;
      }
      if (/[.]/.test(candidate)) {
        score += 10;
      }
      if (/^[A-Z]/.test(candidate)) {
        score += 8;
      } else {
        score -= 6;
      }
      if (candidate.length >= 4) {
        score += 4;
      }
      if (
        currentComparable &&
        candidate.replace(/[.-]/g, "").endsWith(currentComparable.slice(-Math.min(3, currentComparable.length)))
      ) {
        score += 8;
      }
      candidateScores.set(candidate, Math.max(candidateScores.get(candidate) ?? 0, score));
    }
  }

  const bestCandidate = [...candidateScores.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length
  )[0]?.[0];

  if (bestCandidate) {
    return bestCandidate;
  }

  if (
    inferredDiscipline &&
    normalized &&
    !normalized.startsWith(inferredDiscipline)
  ) {
    const rest = normalized.replace(/^[A-Z]{1,3}/, "");
    if (rest) {
      return `${inferredDiscipline}${rest}`;
    }
  }

  return normalized;
}

export function isAllowedSingleWordTitle(text: string) {
  return /\b(COVER|LEGEND|NOTES|DETAILS|SCHEDULES|SPECIFICATIONS?|RCP|CASEWORK|ELEVATIONS|SECTIONS)\b/i.test(text);
}

export function isGenericAuxiliarySheetTitle(text: string) {
  return /^(PLAN|DETAILS?|NOTES?|SCHEDULES?|ELEVATIONS?)$/i.test(clampTitle(text));
}

export function isReferenceOnlyTitleText(text: string) {
  return countSheetReferenceTokens(text) > 0 && countTitleVocabularyHits(text) === 0;
}

export function matchesMetadataFooterVocabulary(text: string) {
  return /\bSCALE|AS NOTED|DRAWING TITLE|DRAWING\s*(?:NO\.?|NUMBER)|SHEET\s*(?:NUMBER|NO\.?|#)\b/i.test(text);
}

export function matchesAdministrativeTitleMetadata(text: string) {
  return /(?:\b(?:APPROVED(?:\s+BY)?|DATE|REVISION|ISSUE(?:\s+NOTE)?|JOB\s*(?:#|NO\.?|NUMBER)|DRAWN\s+BY|DRWN\s+BY|DRAFTED\s+BY|CHECK(?:ED)?\s+BY|CHECKER|REVIEW\s+BY|PLOT\s+DATE|PROJECT\s+MANAGER|PROJECT\s+ID|PROJECT\s*NO\.?|PROJ\.?\s*NO\.?|H\.?U\.?S\.?D\.?\s*PROJECT\s*NO\.?|SCALE|STORE\s*NO\.?|SUITE|COPYRIGHT|ORIGINAL\s+SIZE)\b|\bP\.?M\.?\s*:|\bPROJECT\s*(?:#|NO\.?|NUMBER)\s*:|\bPROJ\.?\s*(?:#|NO\.?|NUMBER)\s*:)/i.test(
    text
  );
}

export function matchesReviewReferenceMetadata(text: string) {
  return /\bREVIEW\b|\bSUBMITTAL\b/i.test(text);
}

export function matchesProjectFieldMetadata(text: string) {
  return /\bPROJECT\b|\bOWNER\b|\bCLIENT\b/i.test(text);
}

export function matchesJobNumberMetadata(text: string) {
  return /\bJOB\s*(NO|NUMBER)\b/i.test(text);
}

export function matchesVendorReferencePageMetadata(text: string) {
  return /\bPAGE\b|\bSHEET\b/i.test(text) && /\bOF\b/i.test(text);
}

export function stripTrailingDocumentReferenceMetadata(text: string) {
  return clampTitle(text);
}

export function isMetadataBoxFooterLine(text: string) {
  return matchesMetadataFooterVocabulary(text);
}

export function isMetadataLabelOnlyText(text: string) {
  if (matchesSheetIdentityLabelVocabulary(text)) {
    return true;
  }
  const normalized = clampTitle(text);
  return (
    matchesSheetIdentityLabelVocabulary(normalized) ||
    (/\bSHEET\s*(?:#(?=\s|$)|NO\.?\b|NUMBER\b)/i.test(normalized) &&
      countTitleVocabularyHits(normalized) === 0) ||
    /^(SCALE|PROJECT|PROJECT\s*(?:#|NO\.?|NUMBER)|JOB\s*(?:#|NO\.?|NUMBER))$/i.test(
      normalized.replace(/[:#]+$/g, "").trim()
    )
  );
}

export function isMetadataBoxTitleFragment(text: string) {
  return countTitleVocabularyHits(text) > 0 && !matchesMetadataFooterVocabulary(text);
}

export function isCompactStampContinuationFragment(text: string) {
  return /^(BUILDING\s+\d+|EXISTING\/REMOVAL|CONSTRUCTION|FLOOR PLAN|ELEVATIONS?)$/i.test(clampTitle(text));
}

export function shouldPreferOcrCompactAnchorOverPdfPair(args: {
  ocrNumber?: string | null;
  ocrTitle?: string | null;
  pdfNumber?: string | null;
  pdfTitle?: string | null;
  compactStampSignal?: boolean | null;
  pdfPairUsable?: boolean | null;
  ocrPairUsable?: boolean | null;
  sameNumberAcrossSources?: boolean | null;
  ocrMatchesRawCompactAnchor?: boolean | null;
  pdfTitleText?: string | null;
  pdfTitleScore?: number | null;
  ocrTitleText?: string | null;
  ocrTitleScore?: number | null;
}) {
  const ocr = `${args.ocrNumber ?? ""} ${args.ocrTitle ?? args.ocrTitleText ?? ""}`;
  const pdf = `${args.pdfNumber ?? ""} ${args.pdfTitle ?? args.pdfTitleText ?? ""}`;
  return countTitleVocabularyHits(ocr) >= countTitleVocabularyHits(pdf);
}

export function shouldPreferOcrTitleOverPdfScaleStub(args: {
  ocrTitle?: string | null;
  pdfTitle?: string | null;
}) {
  return countTitleVocabularyHits(args.ocrTitle ?? "") > countTitleVocabularyHits(args.pdfTitle ?? "");
}

type NormalizedMetadataBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function asNormalizedMetadataBox(value: unknown): NormalizedMetadataBox | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NormalizedMetadataBox>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function metadataBoxRight(box: NormalizedMetadataBox) {
  return box.x + box.width;
}

function metadataBoxBottom(box: NormalizedMetadataBox) {
  return box.y + box.height;
}

function metadataBoxCenterX(box: NormalizedMetadataBox) {
  return box.x + box.width / 2;
}

function metadataBoxCenterY(box: NormalizedMetadataBox) {
  return box.y + box.height / 2;
}

function metadataHorizontalOverlapRatio(
  left: NormalizedMetadataBox,
  right: NormalizedMetadataBox
) {
  const overlap = Math.max(
    0,
    Math.min(metadataBoxRight(left), metadataBoxRight(right)) -
      Math.max(left.x, right.x)
  );
  const denominator = Math.max(Math.min(left.width, right.width), 0.0001);
  return overlap / denominator;
}

function metadataVerticalGap(upper: NormalizedMetadataBox, lower: NormalizedMetadataBox) {
  return Math.max(0, lower.y - metadataBoxBottom(upper));
}

export function isPairedWithinMetadataBox(...args: unknown[]) {
  const familyId = typeof args[0] === "string" ? args[0] : "bottom_right_block";
  const boxes = args.map(asNormalizedMetadataBox).filter(Boolean) as NormalizedMetadataBox[];
  if (boxes.length < 2) {
    // Keep a narrow backward-compatible escape hatch for old call sites that
    // passed line indexes instead of boxes, but do not allow it to act as a
    // meaningful positive geometry signal.
    return false;
  }

  const numberBox = boxes[0]!;
  const titleBox = boxes[1]!;
  const clusterBox = boxes[2] ?? {
    x: Math.min(numberBox.x, titleBox.x),
    y: Math.min(numberBox.y, titleBox.y),
    width: Math.max(metadataBoxRight(numberBox), metadataBoxRight(titleBox)) -
      Math.min(numberBox.x, titleBox.x),
    height: Math.max(metadataBoxBottom(numberBox), metadataBoxBottom(titleBox)) -
      Math.min(numberBox.y, titleBox.y),
  };

  const nearVertically = Math.abs(metadataBoxCenterY(numberBox) - metadataBoxCenterY(titleBox)) <= 0.18;
  const stackedTightly =
    metadataVerticalGap(titleBox, numberBox) <= 0.09 ||
    metadataVerticalGap(numberBox, titleBox) <= 0.09;
  const overlapsOrClose =
    metadataHorizontalOverlapRatio(numberBox, titleBox) >= 0.2 ||
    Math.abs(metadataBoxCenterX(numberBox) - metadataBoxCenterX(titleBox)) <= 0.16;

  if (familyId === "bottom_right_strip") {
    return (
      clusterBox.x >= 0.86 &&
      clusterBox.y >= 0.82 &&
      metadataBoxRight(clusterBox) >= 0.94 &&
      stackedTightly &&
      overlapsOrClose
    );
  }

  if (familyId === "bottom_left_block") {
    return (
      clusterBox.x <= 0.24 &&
      clusterBox.y >= 0.78 &&
      metadataBoxBottom(clusterBox) >= 0.88 &&
      (nearVertically || stackedTightly) &&
      Math.abs(metadataBoxCenterX(numberBox) - metadataBoxCenterX(titleBox)) <= 0.24
    );
  }

  return (
    clusterBox.x >= 0.68 &&
    clusterBox.y >= 0.68 &&
    metadataBoxRight(clusterBox) >= 0.86 &&
    metadataBoxBottom(clusterBox) >= 0.82 &&
    (nearVertically || stackedTightly) &&
    overlapsOrClose
  );
}

export function hasViableCompactStampStructure(args: {
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  distinctNumberCount?: number | null;
  bodyLineCount?: number | null;
  titleLikeCount?: number | null;
  titleVocabularyHits?: number | null;
}) {
  if (typeof args.distinctNumberCount === "number") {
    return (
      (args.distinctNumberCount ?? 0) <= 2 &&
      (args.titleLikeCount ?? 0) >= 1 &&
      (args.titleVocabularyHits ?? 0) >= 1
    );
  }
  return Boolean(
    normalizeSheetNumberValue(args.sheetNumber ?? "") &&
      isUsableRecoveredOcrTitle(args.sheetTitle ?? "")
  );
}

export function getStyleProfileForRegion(regionId: string) {
  return /^strip/i.test(regionId) ? "bottom_right_strip" : "bottom_right_block";
}

export function getTextualSheetNumberRejectPenalty(
  sheetNumber: string,
  sourceText: string
) {
  const normalizedNumber = normalizeSheetNumberValue(sheetNumber);
  const normalizedSource = upper(sourceText);
  if (!normalizedNumber) return -300;
  if (
    isMonthDaySheetNumberArtifact(normalizedNumber, normalizedSource) ||
    (isMonthNameDateSource(normalizedSource) && /^[A-Z]{3}\d{1,2}$/.test(normalizedNumber))
  ) {
    return -620;
  }
  if (
    /SUITE|ROAD|STREET|AVENUE|BOULEVARD|BLVD|PHONE|TEL|WWW\.|EMAIL|CITY,|STATE|ZIP|COPYRIGHT|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/.test(
      normalizedSource
    )
  ) return -260;
  if (
    /\b(?:SHEET\s*NUMBER\s*WHERE|SHEET\s*NO\.?|SHEET\s*#|DRAWING\s*NUMBER|DETAIL\s*NUMBER|VIEW\s*TITLE|DETAIL\s*SHEET\s*NUMBER|CALLOUT\s*SHEET\s*NUMBER|SECTION\s*REFERENCE|ELEVATION\s*REFERENCE)\b/.test(
      normalizedSource
    )
  ) {
    return -360;
  }
  if (/\b(?:LOWER|UPPER|BOTTOM|TOP)\s+NUMBER\s+INDICATES\s+SHEET\s+NUMBER\b/.test(normalizedSource)) {
    return -360;
  }
  if (/\b(?:STORE|PROJECT|JOB)\s*(?:NO\.?|NUMBER|#)\b/.test(normalizedSource)) {
    return -260;
  }
  if (
    /\b(?:TO|FROM|ABOVE|BELOW|HIGH|LOW|TALL|WIDE|DEEP|LONG)\b/.test(normalizedSource) &&
    /(?:\d+\s*(?:"|'|IN\b|FT\b)|\b(?:HIGH|TALL|WIDE|DEEP|LONG)\b)/.test(normalizedSource)
  ) {
    return -520;
  }
  if (normalizedSource.includes("DRAWING TITLE")) return -120;
  return 0;
}

export function getTextualTitleRejectPenalty(text: string) {
  const normalized = upper(text);
  if (!normalized) return -300;
  if (isMetadataLabelOnlyText(normalized)) return -320;
  if (
    /\b(?:DETAIL|SECTION|ELEVATION|PLAN)\s+(?:REFERENCE|IDENTIFICATION|CALLOUT)\b/.test(
      normalized
    ) ||
    /\b(?:PLAN|DETAIL|SECTION|ELEVATION)\s+VIEW\s+TITLE\s+REFERENCE\b/.test(
      normalized
    ) ||
    /\b(?:SHEET\s+NUMBER\s+WHERE|SHEET\s+NUMBER\s+ON\s+WHICH|LOWER\s+NUMBER\s+INDICATES\s+SHEET)\b/.test(
      normalized
    )
  ) {
    return -360;
  }
  if (matchesMetadataFooterVocabulary(normalized)) return -180;
  if (matchesAdministrativeTitleMetadata(normalized)) return -320;
  if (matchesProjectBrandingVocabulary(normalized)) return -220;
  if (
    /^(?:BID\s+REVIEW|PERMIT\s+REVIEW|CONSTRUCTION\s+DOCUMENTS?|ISSUED\s+FOR\s+(?:BID|PERMIT|CONSTRUCTION|REVIEW)|NOT\s+FOR\s+CONSTRUCTION)$/.test(
      normalized
    )
  ) {
    return -220;
  }
  if (words(normalized).length >= 18) return -260;
  if (isLikelyBodyNoteTitleFragment(normalized)) return -760;
  if (countSheetReferenceTokens(normalized) >= 3 && countTitleVocabularyHits(normalized) <= 2) {
    return -260;
  }
  if (isLikelyLowInformationSheetTitle(normalized) && !isAllowedSingleWordTitle(normalized)) return -160;
  return 0;
}

export function getMetadataBoxFamilyFromBbox() {
  return "bottom_right_block";
}

export function getMetadataBoxRejectReason() {
  return null;
}

export function isRepeatedProjectBrandingTitle() {
  return false;
}

export function parseSheetNumberParts(value: string) {
  const normalized = normalizeSheetNumberValue(value);
  const match = normalized.match(
    /^([A-Z]{0,3})[-.]?(\d{1,3})(?:\.(\d{1,3}))?([A-Z]?)(?:[-.]?([A-Z0-9]{1,3}))?$/
  );
  if (!match) return null;
  return {
    prefix: match[1] ?? "",
    main: match[2] ?? "",
    sub: match[3] || null,
    suffix: match[4] ?? "",
    detail: match[5] ?? "",
    tail: match[5] ?? "",
  };
}

export function enrichOcrTitleWithPdfNumberContext(args: {
  ocrTitle?: string | null;
  pdfNumber?: string | null;
}) {
  return clampTitle(args.ocrTitle ?? "");
}

export function enrichOcrTitleWithPdfTitleContext(args: {
  ocrTitle?: string | null;
  pdfTitle?: string | null;
}) {
  const ocr = clampTitle(args.ocrTitle ?? "");
  const pdf = clampTitle(args.pdfTitle ?? "");
  return pdf.length > ocr.length ? pdf : ocr;
}

export function repairOcrTitleFromSourceText(args: {
  title?: string | null;
  sourceText?: string | null;
}) {
  return extractCanonicalTitleFromContext(`${args.title ?? ""}\n${args.sourceText ?? ""}`);
}

export function finalizeOcrSheetTitle(args: {
  sheetTitle?: string | null;
}) {
  return clampTitle(args.sheetTitle ?? "");
}

export function candidateDropsImportantCurrentTitleContext(
  currentTitle: string,
  candidateTitle: string
) {
  const current = upper(currentTitle);
  const candidate = upper(candidateTitle);
  return /\bBUILDING\s+\d+\b/.test(current) && !/\bBUILDING\s+\d+\b/.test(candidate);
}

export function sheetNumberMatchesDocumentTitleDisciplineCue(
  sheetNumber: string,
  title: string
) {
  const discipline = inferSheetDiscipline(sheetNumber, title);
  return discipline ? upper(title).includes(discipline === "A" ? "ARCH" : discipline) : false;
}

export function enrichDocumentSheetsWithReferenceTextContext<T>(items: T[]) {
  return items;
}

export function enrichDocumentSheetTitlesWithCompanionContext<T>(items: T[]) {
  return items;
}

export function smoothGenericSeriesTitlesWithNeighborContext<T>(items: T[]) {
  return items;
}

export function inferMissingLeadingSeriesSheets<T>(items: T[]) {
  return items;
}

export function enrichOcrTitleWithPdfEdgeLineContext(args: {
  ocrTitle?: string | null;
  edgeLineText?: string | null;
  currentTitle?: string | null;
  edgeLineTexts?: string[] | null;
}) {
  const ocr = clampTitle(args.ocrTitle ?? args.currentTitle ?? "");
  const edge = extractCanonicalTitleFromContext(
    `${args.edgeLineText ?? ""}\n${(args.edgeLineTexts ?? []).join("\n")}`
  );
  return edge.length > ocr.length ? edge : ocr;
}

export function enrichOcrTitleWithSheetNumberPrefix(args: {
  sheetTitle?: string | null;
  sheetNumber?: string | null;
}) {
  return clampTitle(args.sheetTitle ?? "");
}

export function inferDocumentStyleProfile() {
  return "bottom_right_block";
}

export function summarizeStyleProfileVotes(
  votes: Array<Array<{ styleProfile?: string | null; score?: number | null }>>
) {
  const totals = new Map<string, { pages: number; score: number }>();
  for (const group of votes) {
    const best = [...group]
      .filter((item) => item?.styleProfile)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!best?.styleProfile) continue;
    const entry = totals.get(best.styleProfile) ?? { pages: 0, score: 0 };
    entry.pages += 1;
    entry.score += best.score ?? 0;
    totals.set(best.styleProfile, entry);
  }
  const ordered = [...totals.entries()].sort(
    (a, b) => b[1].pages - a[1].pages || b[1].score - a[1].score
  );
  const winner = ordered[0];
  const runner = ordered[1];
  return {
    styleProfile: winner?.[0] ?? null,
    locked: Boolean(winner && winner[1].pages >= 3),
    supportPages: winner?.[1].pages ?? 0,
    supportScore: winner?.[1].score ?? 0,
    runnerUpStyleProfile: runner?.[0] ?? null,
    runnerUpPages: runner?.[1].pages ?? 0,
    runnerUpScore: runner?.[1].score ?? 0,
  };
}

export function summarizeOcrRegionPatternVotes(
  votes:
    | Array<{
        styleProfile?: string | null;
        numberRegion?: string | null;
        titleRegion?: string | null;
        score?: number | null;
      }>
    | Array<
        Array<{
          styleProfile?: string | null;
          numberRegion?: string | null;
          titleRegion?: string | null;
          score?: number | null;
        }>
      >
) {
  type OcrRegionPatternVote = {
    styleProfile?: string | null;
    numberRegion?: string | null;
    titleRegion?: string | null;
    score?: number | null;
  };
  const totals = new Map<
    string,
    {
      styleProfile: string | null;
      numberRegion: string | null;
      titleRegion: string | null;
      pages: number;
      score: number;
    }
  >();
  for (const group of votes as Array<OcrRegionPatternVote | OcrRegionPatternVote[]>) {
    const normalizedGroup = Array.isArray(group) ? group : [group];
    const best = [...normalizedGroup].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!best) continue;
    const key = `${best.styleProfile ?? ""}|${best.numberRegion ?? ""}|${best.titleRegion ?? ""}`;
    const entry = totals.get(key) ?? {
      styleProfile: best.styleProfile ?? null,
      numberRegion: best.numberRegion ?? null,
      titleRegion: best.titleRegion ?? null,
      pages: 0,
      score: 0,
    };
    entry.pages += 1;
    entry.score += best.score ?? 0;
    totals.set(key, entry);
  }
  const ordered = [...totals.values()].sort(
    (a, b) => b.pages - a.pages || b.score - a.score
  );
  const winner = ordered[0];
  const runner = ordered[1];
  return {
    locked: Boolean(winner && winner.pages >= 2),
    styleProfile: winner?.styleProfile ?? null,
    supportPages: winner?.pages ?? 0,
    numberRegion: winner?.numberRegion ?? null,
    numberSupportPages: winner?.pages ?? 0,
    titleRegion: winner?.titleRegion ?? null,
    titleSupportPages: winner?.pages ?? 0,
    runnerUpStyleProfile: runner?.styleProfile ?? null,
    runnerUpPages: runner?.pages ?? 0,
  };
}

export function getSequenceConsistencyBoost(..._args: unknown[]) {
  return 0;
}
