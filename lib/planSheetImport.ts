import "server-only";

type DisabledPdfCanvasRenderingContext = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: DisabledPdfCanvas, x: number, y: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number
  ): { data: ArrayLike<number> };
};

type DisabledPdfCanvas = {
  width: number;
  height: number;
  getContext(contextId: "2d"): DisabledPdfCanvasRenderingContext;
};

function createCanvas(_width: number, _height: number): DisabledPdfCanvas {
  throw new Error("PDF rendering is disabled in the Phase 2 PDF-only plan sheet importer.");
}

function createPdfJsDocumentInit(_data: Uint8Array): never {
  throw new Error("PDF.js document rendering is disabled in the Phase 2 PDF-only plan sheet importer.");
}
import {
  OCR_IMAGE_SUPPRESSED_MAX_IMAGE_SIZE,
  OCR_IMAGE_SUPPRESSED_MIN_LINE_COUNT,
  OCR_IMAGE_SUPPRESSED_MIN_EDGE_LINE_COUNT,
  OCR_IMAGE_SUPPRESSED_MIN_CANDIDATE_SCORE,
  PLAN_SHEET_IMPORT_DISABLE_OCR,
  PLAN_SHEET_IMPORT_ENABLE_DOCUMENT_STYLE_PREPASS,
  PDF_PAIR_MIN_SCORE,
  LOCALIZED_PDF_TITLE_MIN_ADMIT_SCORE,
  PLAN_SHEET_IMPORT_FORCE_OCR_ALL_PAGES,
  SHEET_NUMBER_LABEL_PATTERN,
  SHEET_NUMBER_LABEL_SEARCH_PATTERN,
  EXPLICIT_SHEET_NUMBER_LABEL_SEARCH_PATTERN,
  TITLE_LABEL_PATTERN,
  TITLE_LABEL_SEARCH_PATTERN,
  TITLE_FIELD_LABEL_PATTERN,
  TITLE_FIELD_LABEL_SEARCH_PATTERN,
  NON_TITLE_FIELD_LABEL_PATTERN,
  NEXT_FIELD_LABEL_SEARCH_PATTERN,
  PDF_METADATA_REGIONS,
  PDF_METADATA_FAMILIES,
  isLockEligibleStyleProfile,
} from "./planSheetImportConfig";
import { clamp, countWords, normalizeKey, normalizeWhitespace } from "./planSheetImportTextUtils";
import {
  getMetadataRegionById,
  getLineRight,
  getLineLeft,
  getLineBottom,
  getLineCenterX,
  getLineCenterY,
  getItemFontSizeSignal,
  getLineFontSizeSignal,
  median,
  getBoxRight,
  getBoxBottom,
  getNormalizedBoxFromLine,
  getNormalizedBoxFromCandidate,
  getNormalizedUnionBox,
  getLineHorizontalOverlap,
  getNormalizedTextLineBox,
  getStyleProfileForRegion,
  isLineInsideRegion,
  expandNormalizedBox,
} from "./planSheetImportGeometry";
import type {
  ExtractedPlanSheet,
  PlanSheetImportProgress,
  PlanSheetSelectionDiagnostic,
  BuiltInitialPlanSheets,
  PlanSheetImportReplayInput,
  PositionedTextItem,
  PageDrawingSegment,
  TextLine,
  SheetNumberCandidate,
  MetadataRegionId,
  MetadataStyleProfile,
  MetadataFamilyDefinition,
  LabeledFieldMatch,
  MetadataFieldKind,
  MetadataStampField,
  MetadataStampValueCandidate,
  MetadataStampParse,
  PageExtractionModel,
  DetectedSheetTitle,
  TitleCandidate,
  MetadataBoxTitleAttempt,
  CandidateTypeGuess,
  PairedSheetCandidate,
  SheetIdentityConfidenceTier,
  SheetIdentityConfidenceCalibration,
  MetadataBoxCandidate,
  PagePairDetection,
  PreparedPlanSheetSelectionContext,
  DocumentTitleStyleProfile,
  FamilyLockDecision,
  PdfTextExtractionResult,
  OcrNormalizedBox,
  OcrRegionId,
  OcrStyleProfile,
  OcrRegionPatternObservation,
  OcrRegionPatternDecision,
  LockedOcrRegionPattern,
  RediscoveryAttemptOutcome,
  OcrPatternLockState,
  PdfPageLike,
  PdfDocumentLike,
} from "./planSheetImportTypes";
export type {
  ExtractedPlanSheet,
  PlanSheetImportProgress,
  PlanSheetImportReplayInput,
  SheetIdentityConfidenceTier,
} from "./planSheetImportTypes";

function extractSheetNumberFromText(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text ?? "").toUpperCase();
  const labeled = normalized.match(
    /\b(?:SHEET|DRAWING|DWG)\s*(?:NO\.?|NUMBER|#)?\s*[:#-]?\s*([A-Z]{0,4}\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?)\b/i
  );
  const token = (labeled?.[1] ?? normalized.match(
    /\b[A-Z]{0,4}\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?\b/i
  )?.[0] ?? "");
  return normalizeSheetNumberValue(token) || null;
}
import { extractPdfWordsWithPyMuPdf } from "./planSheetPyMuPdf";
import {
  createPlanSheetImportDebugSession,
  type PlanSheetImportDebugSession,
} from "./planSheetImportDebug";
import { ScoreTrace, type ScoreBreakdown } from "./planSheetImportScoring";
type PlanSheetImportResolverResult = {
  pageNumber: number;
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  numberRegion?: string | null;
  titleRegion?: string | null;
  styleProfile?: string | null;
};

function serializeScoreBreakdown(breakdown: ScoreBreakdown | null | undefined) {
  if (!breakdown) {
    return null;
  }

  return {
    total: Number(breakdown.total.toFixed(3)),
    contributions: breakdown.contributions.map((contribution) => ({
      rule: contribution.rule,
      value: Number(contribution.value.toFixed(3)),
      ...(contribution.note ? { note: contribution.note } : {}),
    })),
  };
}

function withScoreOverrideBreakdown(
  candidate: PairedSheetCandidate,
  score: number,
  rule: string
) {
  if (Math.abs(score - candidate.score) <= 0.0001) {
    return {
      ...candidate,
      score,
    } satisfies PairedSheetCandidate;
  }

  const trace = new ScoreTrace()
    .add("previous_candidate_score", candidate.score)
    .add(rule, score - candidate.score);
  return {
    ...candidate,
    score,
    contextScoreBreakdown: trace.snapshot(),
  } satisfies PairedSheetCandidate;
}
import {
  canonicalizeSheetIndexTitle,
  countSheetReferenceTokens as countSheetReferenceTokensBase,
  countTitleVocabularyHits as countTitleVocabularyHitsBase,
  extractCanonicalTitleFromContext,
  getSequenceConsistencyBoost as getSequenceConsistencyBoostBase,
  hasViableCompactStampStructure,
  inferSheetDiscipline,
  isAllowedSingleWordTitle as isAllowedSingleWordTitleBase,
  isCanonicalSheetIndexTitle,
  isCompactStampContinuationFragment as isCompactStampContinuationFragmentBase,
  isMetadataBoxFooterLine as isMetadataBoxFooterLineBase,
  isMetadataLabelOnlyText as isMetadataLabelOnlyTextBase,
  isMetadataBoxTitleFragment as isMetadataBoxTitleFragmentBase,
  isPairedWithinMetadataBox as isPairedWithinMetadataBoxBase,
  shouldPreferOcrCompactAnchorOverPdfPair,
  matchesProjectBrandingVocabulary as matchesProjectBrandingVocabularyBase,
  matchesTitleLikeVocabulary as matchesTitleLikeVocabularyBase,
  getTextualSheetNumberRejectPenalty,
  getTextualTitleRejectPenalty,
  summarizeStyleProfileVotes,
  normalizeEmbeddedSheetPathTitleSource,
  normalizeSheetNumberValue as normalizeSheetNumberValueBase,
  normalizeOcrTitleCandidateText as normalizeOcrTitleCandidateTextBase,
  normalizeOcrSheetNumberWithTitleContext,
  parseSheetNumberParts as parseSheetNumberPartsBase,
  enrichOcrTitleWithPdfNumberContext,
  enrichOcrTitleWithPdfTitleContext,
  enrichOcrTitleWithPdfEdgeLineContext,
  enrichPdfTitleWithEdgeLineContext,
  finalizeOcrSheetTitle,
  repairOcrTitleFromSourceText,
  enrichOcrTitleWithSheetNumberPrefix,
  choosePreferredSingleAcceptedAnchorNumber,
  refineSheetNumberCandidateFromLineText,
  preferMoreSpecificCompatibleSheetNumber,
  promoteAlternateStarSheetNumber,
  reconcileOcrSheetNumberWithAnchorNumbers,
  stripTrailingSheetTitleMetadata,
  stripTrailingDocumentReferenceMetadata,
  shouldAllowUnsupportedOcrPrefix,
  candidateDropsImportantCurrentTitleContext,
  hasStandaloneStructuralAnnotationVocabulary,
  isStrongStructuredRecoveredOcrTitle,
  isUsableRecoveredOcrTitle,
  isReferenceOnlyTitleText,
  matchesAdministrativeTitleMetadata,
  isGenericAuxiliarySheetTitle,
  matchesJobNumberMetadata,
  matchesReviewReferenceMetadata,
  matchesVendorReferencePageMetadata,
  normalizeComparableSheetTitleText,
  sheetNumberMatchesDocumentTitleDisciplineCue,
  summarizeOcrRegionPatternVotes,
} from "./planSheetImportHeuristics";
type TrainingModelSheet = Record<string, unknown>;


function createEmptySheetNumberDetection(): ReturnType<typeof detectSheetNumber> {
  return {
    sheetNumber: "",
    confidence: 0,
    winner: null,
  };
}

function createEmptyDetectedSheetTitle(): DetectedSheetTitle {
  return {
    title: "",
    sourceText: "",
    lineIndex: null,
    lineIndexes: [],
  };
}

function isPageCountFooterSourceText(text: string) {
  const normalized = normalizeWhitespace(text);
  return (
    /\bPAGE\b.*\bOF\b/i.test(normalized) ||
    /\b\d+\b.*\bOF\b.*\b\d+\b/i.test(normalized)
  );
}

function isPageCountFooterSheetNumberCandidate(value: string, sourceText: string) {
  if (!isPageCountFooterSourceText(sourceText)) {
    return false;
  }
  const normalized = normalizeWhitespace(value).toUpperCase().replace(/\s+/g, "");
  return /^OF\d+$/i.test(normalized) || /^\d+$/.test(normalized);
}

function guessSheetNumberCandidateType(text: string, sourceText = ""): CandidateTypeGuess {
  const normalized = normalizeWhitespace(text);
  const normalizedSource = normalizeWhitespace(sourceText || text);
  if (isPageCountFooterSheetNumberCandidate(normalized, normalizedSource)) {
    return "sheet_reference";
  }
  const strongSheetNumber =
    /^(?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?(?:R)?$/i.test(
      normalized
    );
  if (strongSheetNumber) return "sheet_number";
  if (/^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/.test(normalized)) return "date";
  if (/^\d+\s*\/\s*[A-Z]{1,4}\d/i.test(normalized)) return "sheet_reference";
  if (/\b(REV|REVISION|ISSUE|ADDENDUM|DELTA)\b/i.test(normalizedSource)) return "revision";
  if (/\bSCALE\b|\bAS NOTED\b/i.test(normalizedSource)) return "scale";
  if (countSheetReferenceTokens(normalizedSource) > 0 && !strongSheetNumber) {
    return "sheet_reference";
  }
  return "unknown";
}

function isPureMarkerTitleText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  return /^[^A-Za-z0-9]+$/.test(normalized);
}

function isGeometricSymbolLabel(text: string) {
  return /^GEOMETRIC\s+SYMBOL(?:\s+[A-Z0-9]+)?$/i.test(normalizeWhitespace(text));
}

function isDisciplineHeadingFragment(text: string) {
  return /^(?:architectural|civil|structural|mechanical|electrical|plumbing|hvac)$/i.test(
    normalizeWhitespace(text)
  );
}

function hasExplicitTitleFamily(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  return /\b(?:plans?|details?|elevations?|sections?|schedules?|notes?|legend|legends|diagram|diagrams|documentation|forms?|list|lists|riser|risers|rcp|ceiling|compliance|types?|signage|analysis|calculations?|cover|isometric)\b/i.test(
    normalized
  );
}

function hasCompactTechnicalTitleSignal(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  if (isCompactTitle24SheetTitleSignal(normalized)) {
    return true;
  }

  if (/\bENLARGED\b.*\bDWGS?\b/i.test(normalized)) {
    return true;
  }

  if (
    /\b(?:cover(?:\s+sheet)?|analysis|calculations?|types?)\b/i.test(normalized) &&
    /\b(?:architectural|civil|structural|mechanical|electrical|plumbing|hvac|fire\s+alarm|fire\s+protection|life\s+safety|exit|opening|wall|finish)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  return /\b(?:exit\s+analysis|fire\s+alarm\s+calculations?|fire\s+protection\s+cover(?:\s+sheet)?|electrical\s+cover(?:\s+sheet)?|plumbing\s+cover(?:\s+sheet)?|mechanical\s+cover(?:\s+sheet)?|fire\s+protection\s+isometric|wall\s+types?|opening\s+schedules?\s+types?)\b/i.test(
    normalized
  );
}

function isRegulatoryOrScopeNoteText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  return /\b(?:under\s+this\s+application|existing\s+construction\s+to\s+remain|prepared\s+by\s+me|appropriate\s+requirements?\s+of\s+title\s+24|part\s*1[, ]*\(?title\s*24|section\s*4[- ]?317|scope\s+of\s+work)\b/i.test(
    normalized
  );
}

function isTitle24TitleFragment(text: string) {
  return /^TITLE\s*24$/i.test(normalizeWhitespace(text));
}

function isCompactTitle24SheetTitleSignal(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  return /^(?:title\s*24(?:\s*-\s*lt[io])?)(?:\s+(?:forms?|compliance|documentation))?$/i.test(
    normalized
  );
}

function isObviousTechnicalNoteSentence(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  const wordCount = countWords(normalized);
  if (wordCount < 4) {
    return false;
  }

  const titleHits = countTitleVocabularyHits(normalized);
  return (
    titleHits <= 1 &&
    (
      /\b(?:section|provide|mount|pipe|verify|field|instructions?|support|location|shown|unless|otherwise|per|code)\b/i.test(
        normalized
      ) ||
      /\b(?:unless otherwise noted|verify in field|work point|wall joint|wide flange|welded headed stud|typical|vertical)\b/i.test(
        normalized
      ) ||
      /\b\d{3,}\b/.test(normalized)
    )
  );
}

function isGlossaryDefinitionLine(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  return /^(?:TYP\.?|TYPICAL|U\.?O\.?N\.?|UNLESS OTHERWISE NOTED|V\.?I\.?F\.?|VERIFY IN FIELD|W\.?J\.?|WALL JOINT|W\.?P\.?|WORK POINT|WF|WIDE FLANGE|W\.?H\.?S\.?|WELDED HEADED STUD|W\/O|WITHOUT|W\/|WITH|VERT\.?|VERTICAL|WEST|AS SHOWN|HOHBACH-LEWIN)$/i.test(
    normalized
  );
}

function guessTitleCandidateType(text: string, sourceText = ""): CandidateTypeGuess {
  const normalized = normalizeWhitespace(text);
  const normalizedSource = normalizeWhitespace(sourceText || text);
  const sourceLineCount = (sourceText.match(/\r?\n/g) ?? []).length + (sourceText ? 1 : 0);
  const canTrustSourceContext = sourceLineCount <= 4;
  if (!normalized) return "unknown";
  if (isMetadataLabelOnlyTextBase(normalized)) return "title_label";
  if (isMetadataBoxFooterLineBase(normalized)) return "scale";
  if (
    /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/.test(normalized) ||
    (canTrustSourceContext &&
      /\b(REV|REVISION|ISSUE|ADDENDUM|DELTA|SUBMITTAL|REVIEWED)\b/i.test(
        normalizedSource
      )) ||
    /\b(REV|REVISION|ISSUE|ADDENDUM|DELTA)\b/i.test(
      normalized
    )
  ) {
    return "revision";
  }
  if (
    canTrustSourceContext &&
    /\b(COPYRIGHT|ARCHITECTS?|ENGINEERS?|CONSULTING|CONSULTANTS?|INC\b|LLC\b|BELLECCI|HKIT)\b/i.test(
      normalizedSource
    )
  ) {
    return "company_name";
  }
  if (
    canTrustSourceContext &&
    /\b(ROAD|STREET|AVENUE|BOULEVARD|DRIVE|WAY|PHONE|EMAIL|WWW\.|\.COM\b)\b/i.test(
      normalizedSource
    )
  ) {
    return "address_or_contact";
  }
  if (
    /\b(SCHOOL|MODERNIZATION|PROJECT)\b/i.test(normalized) &&
    countTitleVocabularyHits(normalized) === 0
  ) {
    return "project_name";
  }
  if (countSheetReferenceTokens(normalized) >= 2) return "sheet_reference";
  if (
    isRegulatoryOrScopeNoteText(normalized) ||
    (canTrustSourceContext && isRegulatoryOrScopeNoteText(normalizedSource))
  ) {
    return "drawing_body_noise";
  }
  if (isLikelyBodySentenceTitleRepairCandidate(normalized)) {
    return "drawing_body_noise";
  }
  if (isLikelyContaminatedDrawingBodyTitleSource(normalized, normalizedSource)) {
    return "drawing_body_noise";
  }
  if (isObviousTechnicalNoteSentence(normalized) && countTitleVocabularyHits(normalized) === 0) {
    return "drawing_body_noise";
  }
  if (
    matchesTitleLikeVocabulary(normalized) ||
    countTitleVocabularyHits(normalized) > 0 ||
    isAllowedSingleWordTitle(normalized) ||
    isStrongStructuredRecoveredOcrTitle(normalized) ||
    hasExplicitTitleFamily(normalized) ||
    hasCompactTechnicalTitleSignal(normalized)
  ) {
    return "drawing_title";
  }
  const wordCount = countWords(normalized);
  const uppercaseLetters = (normalized.match(/[A-Z]/g) ?? []).length;
  const alphaLetters = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const uppercaseRatio = alphaLetters > 0 ? uppercaseLetters / alphaLetters : 0;
  const structurallyTitleLike =
    canTrustSourceContext &&
    wordCount >= 2 &&
    wordCount <= 8 &&
    normalized.length >= 8 &&
    normalized.length <= 84 &&
    !/\b(?:copyright|architects?|engineers?|consulting|consultants?|inc\b|llc\b|issue|revision|delta|addendum|reviewed|scale|as indicated|north|true north|phone|email|www\.|\.com\b)\b/i.test(
      normalizedSource
    ) &&
    !isGeometricSymbolLabel(normalized) &&
    !isObviousTechnicalNoteSentence(normalized) &&
    !/^\d/.test(normalized) &&
    !/[,:;]$/.test(normalized) &&
    uppercaseRatio >= 0.55 &&
    (
      /plans?$/i.test(normalized) ||
      /plan$/i.test(normalized) ||
      /details?$/i.test(normalized) ||
      /elevations?$/i.test(normalized) ||
      /sections?$/i.test(normalized) ||
      /schedules?$/i.test(normalized) ||
      /notes?$/i.test(normalized) ||
      /legend$/i.test(normalized) ||
      /documentation$/i.test(normalized) ||
      /diagram$/i.test(normalized) ||
      /cover(?:\s+sheet)?$/i.test(normalized) ||
      /analysis$/i.test(normalized) ||
      /calculations?$/i.test(normalized) ||
      /(?:address\s+list|title\s+24|general\s+notes|door\s+types|restroom\s+signage|interior\s+elevations?|fire\s+alarm\s+riser|drawing\s+index|compliance\s+forms?)$/i.test(
        normalized
      )
    );
  if (structurallyTitleLike) {
    return "drawing_title";
  }
  return "drawing_body_noise";
}

function isDateLikeTitleLineText(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  const monthNameDatePattern =
    /\b(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{1,2},?\s+\d{2,4}\b|\b\d{1,2}\s+(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s+\d{2,4}\b/i;
  if (
    monthNameDatePattern.test(normalized) &&
    normalizeWhitespace(normalized.replace(monthNameDatePattern, " ")).length === 0
  ) {
    return true;
  }

  const dateFragments =
    normalized.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) ?? [];
  const strippedRepeatedDateTail = normalizeWhitespace(
    normalized
      .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ")
      .replace(/\b\d{1,2}[:.]\d{2}(?::\d{2})?\b/gi, " ")
      .replace(/\b(?:AM|PM)\b/gi, " ")
  );
  if (dateFragments.length >= 2 && !strippedRepeatedDateTail) {
    return true;
  }

  return (
    /^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})(?:\s+\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM)?)?$/i.test(
      normalized
    ) ||
    /^\d{1,2}\s+\d{1,2}\s+\d{2,4}$/.test(normalized) ||
    /^\d{1,2}\s+\d{1,2}\s+\d{2,4}\s+\d{1,2}\s+\d{2}(?:\s+\d{2})?$/i.test(
      normalized
    ) ||
    /\b(?:issue\s+date|plot\s+date|expiration\s+date|date)\b/i.test(normalized)
  );
}

function countDateLikeFragments(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return 0;
  }
  return (normalized.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g) ?? []).length;
}

function hasRepeatedDateTail(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  const dateFragmentCount = countDateLikeFragments(normalized);
  if (dateFragmentCount >= 2) {
    return true;
  }
  return (
    dateFragmentCount >= 1 &&
    /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b(?:\s+\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:AM|PM)?)?\s*$/.test(
      normalized
    )
  );
}

function buildSheetNumberReasonCodes(candidate: SheetNumberCandidate): string[] {
  const reasonCodes: string[] = [];
  const candidateTypeGuess = guessSheetNumberCandidateType(
    candidate.value,
    candidate.lineText
  );
  if (candidateTypeGuess === "sheet_number") reasonCodes.push("regex_strong");
  if (candidate.normX >= 0.9 && candidate.normY >= 0.88) {
    reasonCodes.push("bottom_right_anchor");
  }
  const normalized = normalizeSheetNumberValue(candidate.value);
  if (normalized.length >= 3 && normalized.length <= 8) {
    reasonCodes.push("short_structured_identifier");
  }
  if (
    normalizeWhitespace(candidate.lineText) &&
    normalizeKey(candidate.lineText) !== normalizeKey(candidate.value)
  ) {
    reasonCodes.push("split_anchor_merge");
  }
  if (candidate.normHeight >= 0.006) {
    reasonCodes.push("prominent_identifier");
  }
  return reasonCodes;
}

function buildTitleReasonCodes(args: {
  titleText: string;
  titleSourceText: string;
  titleLines?: TextLine[];
  numberLine?: TextLine | null;
  titleRegion?: MetadataRegionId | null;
  numberRegion?: MetadataRegionId | null;
}): string[] {
  const reasonCodes: string[] = [];
  const candidateTypeGuess = guessTitleCandidateType(
    args.titleText,
    args.titleSourceText
  );
  if (candidateTypeGuess === "drawing_title") {
    reasonCodes.push("drawing_title_pattern");
  }
  if (/\bDRAWING TITLE\b/i.test(args.titleSourceText)) {
    reasonCodes.push("title_label_anchor");
  }
  if ((args.titleLines?.length ?? 0) >= 2 || /\r?\n/.test(args.titleSourceText)) {
    reasonCodes.push("multiline_title");
  }
  if (
    args.numberRegion &&
    args.titleRegion &&
    args.numberRegion === args.titleRegion
  ) {
    reasonCodes.push("same_title_block");
  }
  if (args.numberLine && args.titleLines && args.titleLines.length > 0) {
    const nearest = args.titleLines[0]!;
    const verticalDistance = Math.abs(
      getLineCenterY(args.numberLine) - getLineCenterY(nearest)
    );
    const horizontalDistance = Math.abs(
      getLineCenterX(args.numberLine) - getLineCenterX(nearest)
    );
    if (verticalDistance <= 0.22 && horizontalDistance <= 0.18) {
      reasonCodes.push("near_selected_number");
    }
  }
  return reasonCodes;
}

function isOcrSheetNumberFieldLabelLike(value: string) {
  const normalized = normalizeKey(value).replace(/[^A-Z0-9\s]/g, " ");
  if (!normalized) {
    return false;
  }

  if (TITLE_FIELD_LABEL_PATTERN.test(normalizeWhitespace(value)) || /\bTITLE\b/i.test(normalized)) {
    return false;
  }

  if (
    /^(?:SHEET\s+(?:NO|N0|NG|N6|HEN|HO|NUM|NUMBER|NUM8ER|#)|DRAWING\s+(?:NO|NUMBER)|DWG(?:\s+(?:NO|NUMBER|#))?)/i.test(
      normalized
    )
  ) {
    return true;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) {
    return false;
  }

  const first = tokens[0] ?? "";
  const second = tokens[1] ?? "";
  const compact = normalized.replace(/\s+/g, "");
  const startsLikeSheet = /^(?:SHEET|5HEET|BHEET|SHEE[T7])/.test(first);
  if (!startsLikeSheet) {
    return false;
  }

  if (/^(?:NO|N0|NG|N6|HEN|HO|NUM|NUMBER|NUM8ER)$/i.test(second)) {
    return true;
  }

  return (
    compact.startsWith("SHEETN") ||
    compact.includes("NUMBER") ||
    compact.includes("SHEETNO") ||
    compact.includes("SHEETNUM")
  );
}

function findOcrSheetNumberLabelLine(lines: TextLine[]) {
  return (
    lines.find((line) =>
      SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalizeWhitespace(line.text))
    ) ??
    lines.find((line) => isOcrSheetNumberFieldLabelLike(line.text)) ??
    null
  );
}



function hasAnyReasonCode(
  candidate: Pick<PairedSheetCandidate, "numberReasonCodes" | "titleReasonCodes"> | null,
  role: "number" | "title",
  reasonCodes: string[]
) {
  const candidateCodes =
    role === "number"
      ? candidate?.numberReasonCodes ?? []
      : candidate?.titleReasonCodes ?? [];
  return reasonCodes.some((reasonCode) => candidateCodes.includes(reasonCode));
}

function isStableIdentityRegion(regionId: string | null | undefined, role: "number" | "title") {
  const normalized = normalizeWhitespace(regionId ?? "").toLowerCase();
  if (!normalized) {
    return false;
  }

  if (role === "number") {
    return [
      "sheetstamp",
      "stripnumber",
      "numberblock",
      "bottomright",
      "footerbubble",
      "footerbubbletight",
      "footercolumn",
    ].includes(normalized);
  }

  return [
    "sheetstamp",
    "striptitle",
    "titleblock",
    "titletall",
    "bottomright",
    "footerbubble",
    "footerbubbletight",
    "footercolumn",
  ].includes(normalized);
}

function hasStrongLocalizedNumberEvidence(args: {
  source: "ocr" | "pdf_text" | null;
  pdfPair: PairedSheetCandidate | null;
  ocrResult: NonNullable<PdfTextExtractionResult> | null;
}) {
  if (args.source === "ocr" && args.ocrResult) {
    return (
      Boolean(args.ocrResult.numberBox) ||
      isStableIdentityRegion(args.ocrResult.numberRegion, "number") ||
      args.ocrResult.styleProfile === "bottom_right_strip"
    );
  }

  if (!args.pdfPair) {
    return false;
  }

  return (
    isStableIdentityRegion(args.pdfPair.numberRegion, "number") ||
    hasAnyReasonCode(args.pdfPair, "number", [
      "structured_field_parse",
      "bottom_right_anchor",
      "compact_number_over_title_anchor",
      "direct_corner",
    ])
  );
}

function hasStrongLocalizedTitleEvidence(args: {
  source: "ocr" | "pdf_text" | null;
  pdfPair: PairedSheetCandidate | null;
  ocrResult: NonNullable<PdfTextExtractionResult> | null;
}) {
  if (args.source === "ocr" && args.ocrResult) {
    return (
      Boolean(args.ocrResult.titleBox) ||
      isStableIdentityRegion(args.ocrResult.titleRegion, "title") ||
      args.ocrResult.styleProfile === "bottom_right_strip"
    );
  }

  if (!args.pdfPair) {
    return false;
  }

  return (
    isStableIdentityRegion(args.pdfPair.titleRegion, "title") ||
    hasAnyReasonCode(args.pdfPair, "title", [
      "structured_field_parse",
      "near_selected_number",
      "directly_below_sheet_number",
      "drawing_title_pattern",
    ])
  );
}

function isSevereSheetIdentityTitleNoise(text: string, sourceText: string | null | undefined) {
  const normalized = normalizeWhitespace(text);
  const source = normalizeWhitespace(sourceText ?? normalized);
  if (!normalized) {
    return true;
  }

  return (
    isDateLikeTitleLineText(normalized) ||
    NON_TITLE_FIELD_LABEL_PATTERN.test(normalized) ||
    matchesAdministrativeTitleMetadata(normalized) ||
    isRegulatoryOrScopeNoteText(source) ||
    isLikelyBodySentenceTitleRepairCandidate(normalized) ||
    isKeyPlanLocatorOnlySheetIdentityTitle(normalized) ||
    hasSevereSheetIdentityTitleFragmentNoise(normalized) ||
    /\b(?:NOT\s+FOR\s+CONSTRUCTION|JOB\s*(?:NO|NUMBER)|DRAWN|CHECKED|PLOT\s+DATE|ISSUE\s+DATE|PLAN\s+REVIEWER|REVIEWER|PHONE|FAX|EMAIL|ARCHITECT|ENGINEER|CONSULTANT|APPROVED|REVISIONS?)\b/i.test(
      normalized
    ) ||
    /^(?:MAY|JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER),?\s+\d{4}$/i.test(
      normalized
    )
  );
}

function isKeyPlanLocatorOnlySheetIdentityTitle(text: string) {
  const normalized = normalizeWhitespace(text).toUpperCase();
  if (!/\bKEY\s+PLAN\b/.test(normalized)) {
    return false;
  }

  const withoutLocatorWords = normalized
    .replace(/\bKEY\s+PLAN\b/g, " ")
    .replace(/\bAREA\s*[A-Z0-9]+\b/g, " ")
    .replace(/\bAREA[A-Z0-9]+\b/g, " ")
    .replace(/[^\w]+/g, " ")
    .trim();

  return withoutLocatorWords.length === 0;
}

function hasSevereSheetIdentityTitleFragmentNoise(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  const titleVocabularyHits = countTitleVocabularyHits(normalized);
  const wordCount = countWords(normalized);
  return (
    /\bNO\s+DESCRIPTION\b/i.test(normalized) ||
    /\bKEEP\s+ON\s+JOB\s+SITE\b/i.test(normalized) ||
    /^ON\s+ROOF\.?$/i.test(normalized) ||
    /^(?:ACT|CPT|GWB|LVT|PT|VCT)\s*[-:]?\s*\d+\b/i.test(normalized) ||
    (titleVocabularyHits === 0 &&
      /^(?:BACK\s+TO|ON|PER|PENDING)\b/i.test(normalized)) ||
    (wordCount <= 5 &&
      titleVocabularyHits <= 1 &&
      /\b(?:SELF\s*-\s*LEVELING\s+COMPOUND|ACCESSIBLE\s+CEILING\s+SPACE)\b/i.test(
        normalized
      ))
  );
}

function isMildSheetIdentityTitleConcern(text: string, sourceText?: string | null) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  const wordCount = countWords(normalized);
  return (
    /\s+-\s*$/.test(normalized) ||
    /[,;:]\s*$/.test(normalized) ||
    isSuspiciousDetectedTitle(normalized) ||
    isGenericAuxiliarySheetTitle(normalized) ||
    hasRepairableTitleSourceContextConcern(normalized, sourceText) ||
    (wordCount === 1 && !isAllowedSingleWordTitle(normalized)) ||
    (wordCount <= 2 &&
      countTitleVocabularyHits(normalized) === 0 &&
      !/\b(?:LEGEND|SCHEDULES?|DETAILS?|ELEVATIONS?|SECTIONS?|DIAGRAMS?)\b/i.test(normalized))
  );
}

function hasRepairableTitleSourceContextConcern(
  selectedTitle: string,
  sourceText: string | null | undefined
) {
  const selected = normalizeComparableSheetTitleText(selectedTitle);
  const source = normalizeComparableSheetTitleText(sourceText ?? "");
  if (!selected || !source || selected === source || !source.includes(selected)) {
    return false;
  }

  const sourceLineCount = (sourceText?.match(/\r?\n/g) ?? []).length + (sourceText ? 1 : 0);
  const extraSourceLength = source.length - selected.length;
  const selectedWordCount = countWords(selected);
  const sourceWordCount = countWords(source);
  const sourceHasUsefulSuffix =
    /\b(?:PLAN|PLANS|PART|LEVEL|FLOOR|INDEX|NOTES|ABBREVIATIONS|DETAILS|SCHEDULES|ELEVATIONS|SECTIONS|TEAM|RISERS|TYPES|LEGEND)\b/i.test(
      source.replace(selected, " ")
    );

  return (
    (sourceLineCount >= 2 && extraSourceLength >= 8 && sourceHasUsefulSuffix) ||
    (selectedWordCount >= 8 && sourceLineCount >= 3) ||
    sourceWordCount >= selectedWordCount + 3
  );
}

function isSuspiciousSheetIdentityNumberValue(value: string) {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, "").toUpperCase();
  if (!normalized) {
    return false;
  }

  return /^(?:NORTH|SOUTH|EAST|WEST)\d{1,4}[A-Z]?$/.test(normalized);
}

function hasCloseCompetingPairCandidate(args: {
  selectedNumber: string;
  selectedTitle: string;
  selectedScore: number;
  candidates: PairedSheetCandidate[];
}) {
  const selectedNumberKey = normalizeKey(args.selectedNumber);
  const selectedTitleKey = normalizeComparableSheetTitleText(args.selectedTitle);

  return args.candidates.slice(0, 4).some((candidate) => {
    const candidateNumberKey = normalizeKey(candidate.sheetNumber);
    const candidateTitleKey = normalizeComparableSheetTitleText(candidate.sheetTitle);
    if (!candidateNumberKey || !candidateTitleKey) {
      return false;
    }
    if (
      candidateNumberKey === selectedNumberKey &&
      candidateTitleKey === selectedTitleKey
    ) {
      return false;
    }
    return args.selectedScore - candidate.score <= 55;
  });
}

function scoreComparableTitleOverlap(left: string, right: string) {
  const leftTokens = normalizeComparableSheetTitleText(left)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2);
  const rightTokens = normalizeComparableSheetTitleText(right)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const rightSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter((token) => rightSet.has(token)).length;
  return sharedCount / Math.max(leftTokens.length, rightTokens.length);
}

function hasRepairablePairAlternative(args: {
  selectedNumber: string;
  selectedTitle: string;
  selectedHasMildConcern: boolean;
  candidates: PairedSheetCandidate[];
}) {
  const selectedNumberKey = normalizeKey(args.selectedNumber);
  const selectedTitleKey = normalizeComparableSheetTitleText(args.selectedTitle);
  const selectedTitle = normalizeWhitespace(args.selectedTitle);
  return args.candidates.slice(0, 6).some((candidate) => {
    const candidateNumberKey = normalizeKey(candidate.sheetNumber);
    const title = normalizeWhitespace(candidate.sheetTitle);
    if (!title || normalizeComparableSheetTitleText(title) === selectedTitleKey) {
      return false;
    }
    if (candidateNumberKey && selectedNumberKey && candidateNumberKey !== selectedNumberKey) {
      return false;
    }
    if (isSevereSheetIdentityTitleNoise(title, candidate.titleSourceText)) {
      return false;
    }
    const titleOverlap = scoreComparableTitleOverlap(title, args.selectedTitle);
    const longerCandidate = title.length > selectedTitle.length + 4;
    const plausibleContinuation =
      args.selectedHasMildConcern &&
      titleOverlap >= 0.45 &&
      countTitleVocabularyHits(title) >= 1;
    return titleOverlap >= 0.6 && (longerCandidate || plausibleContinuation);
  });
}

function selectedSheetNumberAppearsInSource(
  selectedNumber: string,
  sourceText: string | null | undefined
) {
  const normalizedSelected = normalizeSheetNumberValue(selectedNumber);
  const selected = normalizedSelected.replace(/[.-]/g, "");
  const normalizedSourceText = normalizeWhitespace(sourceText ?? "");
  const source = normalizeKey(normalizedSourceText).replace(/[^A-Z0-9]/g, "");
  if (!normalizedSelected || !selected || !source) {
    return false;
  }

  const sourceTokens = extractSheetNumberTokensFromText(normalizedSourceText)
    .map((token) => normalizeSheetNumberValue(token))
    .filter(Boolean);
  if (sourceTokens.some((token) => token === normalizedSelected)) {
    return true;
  }
  if (
    sourceTokens.some((token) => {
      const compactToken = token.replace(/[.-]/g, "");
      return compactToken.startsWith(selected) && compactToken.length > selected.length;
    })
  ) {
    return false;
  }

  return source.includes(selected);
}

function selectedSheetTitleAppearsInSource(
  selectedTitle: string,
  sourceText: string | null | undefined
) {
  const selected = normalizeComparableSheetTitleText(selectedTitle);
  const source = normalizeComparableSheetTitleText(sourceText ?? "");
  if (!selected || !source) {
    return false;
  }
  if (source.includes(selected)) {
    return true;
  }
  if (
    selected.includes(source) &&
    source.length >= 8 &&
    source.length / selected.length >= 0.65
  ) {
    return true;
  }

  const stopWords = new Set(["A", "AN", "AND", "FOR", "OF", "THE", "TO"]);
  const selectedTokens = selected
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Z0-9]/g, ""))
    .filter((token) => token.length > 1 && !stopWords.has(token));
  if (selectedTokens.length <= 1) {
    return false;
  }

  const sourceTokens = new Set(
    source
      .split(/\s+/)
      .map((token) => token.replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean)
  );
  const matchingTokens = selectedTokens.filter((token) =>
    sourceTokens.has(token)
  ).length;

  return matchingTokens / selectedTokens.length >= 0.75;
}

function hasSheetIdentityAdminFieldLabelNoise(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }

  return /\b(?:BUILDING\s+ID|PROJECT\s*(?:NO|NUMBER|#)|KP\s+PROJ|STANTEC\s+NO|DRAWN\s+BY|CHECKED\s+BY|PLOT\s+DATE|ISSUE\s+DATE|REV(?:ISION)?\s*(?:NO|#)?)\b\s*:?/i.test(
    normalized
  );
}

function calibrateSheetIdentityConfidence(args: {
  rawConfidence: number;
  sheetNumber: string;
  sheetTitle: string;
  numberSource: "ocr" | "pdf_text" | null;
  titleSource: "ocr" | "pdf_text" | null;
  numberSourceText: string | null;
  titleSourceText: string | null;
  pdfPair: PairedSheetCandidate | null;
  ocrResult: NonNullable<PdfTextExtractionResult> | null;
  topPdfPairCandidates: PairedSheetCandidate[];
  repeatedWeakNumber: boolean;
  structuredPdfPair: boolean;
}) : SheetIdentityConfidenceCalibration {
  const rawConfidence = clamp(args.rawConfidence, 0, 1);
  const reasons: string[] = [];
  const sheetNumber = normalizeWhitespace(args.sheetNumber);
  const sheetTitle = normalizeWhitespace(args.sheetTitle);
  const selectedScore =
    args.numberSource === "ocr"
      ? args.ocrResult?.score ?? -Infinity
      : args.pdfPair?.score ?? -Infinity;

  if (!sheetNumber || !sheetTitle) {
    reasons.push("missing_sheet_identity");
    return {
      confidence: Number(Math.min(rawConfidence, 0.12).toFixed(2)),
      rawConfidence: Number(rawConfidence.toFixed(2)),
      tier: "insufficient_evidence",
      llmRecommended: false,
      repairableEvidence: false,
      reasons,
    };
  }

  const localizedNumber = hasStrongLocalizedNumberEvidence({
    source: args.numberSource,
    pdfPair: args.pdfPair,
    ocrResult: args.ocrResult,
  });
  const localizedTitle = hasStrongLocalizedTitleEvidence({
    source: args.titleSource,
    pdfPair: args.pdfPair,
    ocrResult: args.ocrResult,
  });
  const sameSource = Boolean(args.numberSource && args.numberSource === args.titleSource);
  const severeTitleNoise = isSevereSheetIdentityTitleNoise(
    sheetTitle,
    args.titleSourceText
  );
  const adminFieldTitleNoise = hasSheetIdentityAdminFieldLabelNoise(sheetTitle);
  const genericAuxiliaryTitle = isGenericAuxiliarySheetTitle(sheetTitle);
  const repairableTitleSourceConcern = hasRepairableTitleSourceContextConcern(
    sheetTitle,
    args.titleSourceText
  );
  const mildTitleConcern = isMildSheetIdentityTitleConcern(
    sheetTitle,
    args.titleSourceText
  );
  const suspiciousNumberValue = isSuspiciousSheetIdentityNumberValue(sheetNumber);
  const numberSourceSupportsSelection = selectedSheetNumberAppearsInSource(
    sheetNumber,
    args.numberSourceText
  );
  const titleSourceSupportsSelection = selectedSheetTitleAppearsInSource(
    sheetTitle,
    args.titleSourceText
  );
  const closeCompetition = hasCloseCompetingPairCandidate({
    selectedNumber: sheetNumber,
    selectedTitle: sheetTitle,
    selectedScore,
    candidates: args.topPdfPairCandidates,
  });
  const repairAlternative = hasRepairablePairAlternative({
    selectedNumber: sheetNumber,
    selectedTitle: sheetTitle,
    selectedHasMildConcern: mildTitleConcern,
    candidates: args.topPdfPairCandidates,
  });

  let calibrated = rawConfidence;
  if (args.structuredPdfPair && localizedNumber && localizedTitle && !severeTitleNoise) {
    calibrated = Math.max(calibrated, 0.9);
    reasons.push("structured_localized_fields");
  }
  if (localizedNumber && localizedTitle && sameSource && !severeTitleNoise) {
    calibrated = Math.max(calibrated, 0.78);
    reasons.push("localized_number_title_pair");
  }
  if (!localizedNumber) {
    calibrated = Math.min(calibrated, 0.72);
    reasons.push("number_not_strongly_localized");
  }
  if (!localizedTitle) {
    calibrated = Math.min(calibrated, 0.72);
    reasons.push("title_not_strongly_localized");
  }
  if (!sameSource) {
    calibrated = Math.min(calibrated, 0.78);
    reasons.push("mixed_number_title_sources");
  }
  if (args.numberSourceText && !numberSourceSupportsSelection) {
    calibrated = Math.min(calibrated, 0.64);
    reasons.push("number_source_does_not_support_selection");
  }
  if (args.titleSourceText && !titleSourceSupportsSelection) {
    calibrated = Math.min(calibrated, 0.68);
    reasons.push("title_source_does_not_support_selection");
  }
  if ((!args.numberSourceText || !args.titleSourceText) && !args.structuredPdfPair) {
    calibrated = Math.min(calibrated, 0.78);
    reasons.push("missing_source_text_for_confidence");
  }
  if (closeCompetition) {
    calibrated = Math.min(calibrated, 0.74);
    reasons.push("close_competing_candidate");
  }
  if (repairAlternative) {
    calibrated = Math.min(calibrated, 0.82);
    reasons.push("alternative_repair_candidate_available");
  }
  if (mildTitleConcern) {
    calibrated = Math.min(calibrated, 0.76);
    reasons.push("title_has_repairable_concern");
  }
  if (genericAuxiliaryTitle) {
    calibrated = Math.min(calibrated, 0.76);
    reasons.push("title_is_generic_auxiliary");
  }
  if (repairableTitleSourceConcern) {
    calibrated = Math.min(calibrated, 0.76);
    reasons.push("title_source_has_repairable_context");
  }
  if (adminFieldTitleNoise) {
    calibrated = Math.min(calibrated, 0.34);
    reasons.push("title_contains_admin_field_label");
  }
  if (severeTitleNoise) {
    calibrated = Math.min(calibrated, 0.34);
    reasons.push("severe_title_noise");
  }
  if (suspiciousNumberValue) {
    calibrated = Math.min(calibrated, 0.34);
    reasons.push("sheet_number_looks_like_location_marker");
  }
  if (args.repeatedWeakNumber) {
    calibrated = Math.min(calibrated, 0.2);
    reasons.push("repeated_weak_number");
  }

  calibrated = clamp(calibrated, 0, 1);
  const repairableEvidence = Boolean(
    !severeTitleNoise &&
      !adminFieldTitleNoise &&
      !suspiciousNumberValue &&
      localizedNumber &&
      (localizedTitle || repairAlternative || mildTitleConcern) &&
      calibrated >= 0.35
  );
  const tier: SheetIdentityConfidenceTier =
    calibrated >= 0.86 &&
    localizedNumber &&
    localizedTitle &&
    !mildTitleConcern &&
    !severeTitleNoise &&
    !adminFieldTitleNoise &&
    !suspiciousNumberValue
      ? "trusted"
      : repairableEvidence
        ? "needs_review"
        : "insufficient_evidence";

  return {
    confidence: Number(calibrated.toFixed(2)),
    rawConfidence: Number(rawConfidence.toFixed(2)),
    tier,
    llmRecommended: false,
    repairableEvidence,
    reasons,
  };
}

function getCandidatePrefix(value: string) {
  const match = value.match(/^((?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2}))[-.]?\d/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function isLikelySheetTitle(line: string) {
  const normalized = normalizeWhitespace(line);

  if (!normalized) return false;
  if (normalized.length < 6 || normalized.length > 120) return false;
  if (!/[A-Za-z]/.test(normalized)) return false;
  if (countWords(normalized) === 1 && !isAllowedSingleWordTitle(normalized)) {
    return false;
  }
  if (
    /^(sheet|sheet title|sheet number|page|drawn by|drafted by|review by|checked by|project id|plot date|issue note|scale|date|dwg|drawing)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  return true;
}

function getWordStats(line: string) {
  const words = normalizeWhitespace(line)
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9.-]/g, ""))
    .filter(Boolean);
  const uniqueWords = new Set(words.map((word) => word.toUpperCase()));

  return {
    wordCount: words.length,
    uniqueRatio: words.length ? uniqueWords.size / words.length : 0,
    isUppercaseLike: /[A-Z]/.test(line) && line === line.toUpperCase(),
  };
}

function getRegionTrustScore(normX: number, normY: number) {
  const inBottomBand = normY >= 0.74;
  const inBottomRight = normY >= 0.68 && normX >= 0.62;
  const inRightBand = normX >= 0.78;
  const inTopRight = normX >= 0.66 && normY <= 0.22;
  const inBottomLeft = normX <= 0.28 && normY >= 0.72;
  const inLeftEdge = normX <= 0.2;
  const inCenterInterior =
    normX > 0.24 && normX < 0.72 && normY > 0.18 && normY < 0.74;

  if (inBottomRight) return 48;
  if (inBottomBand && normX >= 0.45) return 40;
  if (inRightBand) return 34;
  if (inTopRight) return 32;
  if (inBottomLeft) return 20;
  if (inLeftEdge) return 14;
  if (inCenterInterior) return -26;

  return 0;
}

function matchesSuspiciousLockedNumberSourceText(text: string | null | undefined) {
  const normalized = normalizeWhitespace(text ?? "");
  if (!normalized) {
    return false;
  }

  return (
    /\bscale\b/i.test(normalized) ||
    /\bas indicated\b/i.test(normalized) ||
    /revit files?/i.test(normalized) ||
    /copyright/i.test(normalized)
  );
}

function getLocalizedPdfNumberFromBox(args: {
  page: PageExtractionModel;
  box: OcrNormalizedBox;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
}) {
  const expandedBox = expandNormalizedBox(args.box, 0.012, 0.01);
  const localLines = args.page.lines.filter((line) =>
    isLineInsideRegion(line, expandedBox)
  );
  if (localLines.length === 0) {
    return null;
  }

  const pattern = createExtendedSheetNumberTokenPattern();
  const extractedCandidates: SheetNumberCandidate[] = [];
  localLines.forEach((line, lineIndex) => {
    for (const match of line.text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (!value) {
        continue;
      }

      const geometry = getSheetNumberCandidateGeometry(
        line,
        value,
        match.index ?? 0
      );
      extractedCandidates.push({
        value,
        score: scoreSheetNumberCandidate(value, line, lineIndex, localLines) + 16,
        lineIndex,
        normX: geometry.normX,
        normY: geometry.normY,
        normWidth: geometry.normWidth,
        normHeight: geometry.normHeight,
        width: geometry.width,
        height: geometry.height,
        lineText: line.text,
        isNumericOnly: /^\d+(?:\.\d+)?$/.test(value.trim()),
        prefix: getCandidatePrefix(value),
      });
    }
  });
  const focusedCandidates = extractedCandidates.filter((candidate) => {
    const candidateLine = localLines[candidate.lineIndex] ?? null;
    const candidateBox = getNormalizedBoxFromCandidate(candidate, candidateLine);
    const centerX = candidateBox.x + candidateBox.width / 2;
    const centerY = candidateBox.y + candidateBox.height / 2;

    return (
      centerX >= expandedBox.x &&
      centerX <= expandedBox.x + expandedBox.width &&
      centerY >= expandedBox.y &&
      centerY <= expandedBox.y + expandedBox.height
    );
  });

  const localPage: PageExtractionModel = {
    pageNumber: args.page.pageNumber,
    lines: localLines,
    candidates: focusedCandidates.length > 0 ? focusedCandidates : extractedCandidates,
    drawingSegments: args.page.drawingSegments ?? [],
  };
  const result = detectSheetNumber(localPage, args.exactCounts, args.prefixCounts);
  const fallbackWinner = localPage.candidates
    .map((candidate) => ({
      ...candidate,
      score: rescoreCandidate(candidate, args.exactCounts, args.prefixCounts),
    }))
    .sort((left, right) => right.score - left.score)[0];
  const effectiveWinner =
    result.winner && result.sheetNumber
      ? {
          sheetNumber: result.sheetNumber,
          lineText: result.winner.lineText ?? result.sheetNumber,
        }
      : fallbackWinner
        ? {
            sheetNumber: fallbackWinner.value,
            lineText: fallbackWinner.lineText,
          }
        : null;
  if (!effectiveWinner?.sheetNumber) {
    return null;
  }

  const sheetNumber = normalizeSheetNumberValue(effectiveWinner.sheetNumber);
  if (!sheetNumber) {
    return null;
  }

  return {
    sheetNumber,
    sourceText: effectiveWinner.lineText ?? sheetNumber,
    confidence: result.confidence,
  };
}

function shouldPreferLocalizedPdfNumberOverOcr(args: {
  ocrSheetNumber: string;
  ocrNumberSourceText?: string | null;
  ocrNumberScore?: number | null;
  localizedPdfSheetNumber: string;
}) {
  const normalizedOcr = normalizeSheetNumberValue(args.ocrSheetNumber);
  const normalizedPdf = normalizeSheetNumberValue(args.localizedPdfSheetNumber);
  if (!normalizedOcr || !normalizedPdf) {
    return false;
  }

  if (normalizedPdf === normalizedOcr) {
    return false;
  }

  const suspiciousOcrSource = matchesSuspiciousLockedNumberSourceText(
    args.ocrNumberSourceText
  );
  const ocrScore = Number.isFinite(args.ocrNumberScore ?? NaN)
    ? Number(args.ocrNumberScore)
    : null;

  if (normalizeKey(normalizedPdf) === normalizeKey(normalizedOcr)) {
    return true;
  }

  if (
    suspiciousOcrSource &&
    /[.-]/.test(normalizedPdf) &&
    parseSheetNumberParts(normalizedPdf)
  ) {
    return true;
  }

  if ((ocrScore ?? 0) < 32 && parseSheetNumberParts(normalizedPdf)) {
    return true;
  }

  return false;
}

function applyLocalizedPdfNumberToOcrResult(args: {
  page: PageExtractionModel;
  ocrResult: PdfTextExtractionResult;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
}) {
  if (!args.ocrResult?.sheetNumber || !args.ocrResult.numberBox) {
    return args.ocrResult;
  }

  const localizedPdfNumber = getLocalizedPdfNumberFromBox({
    page: args.page,
    box: args.ocrResult.numberBox,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
  });
  if (!localizedPdfNumber) {
    return args.ocrResult;
  }

  if (
    !shouldPreferLocalizedPdfNumberOverOcr({
      ocrSheetNumber: args.ocrResult.sheetNumber,
      ocrNumberSourceText: args.ocrResult.numberSourceText,
      ocrNumberScore: args.ocrResult.numberScore ?? null,
      localizedPdfSheetNumber: localizedPdfNumber.sheetNumber,
    })
  ) {
    return args.ocrResult;
  }

  return {
    ...args.ocrResult,
    sheetNumber: localizedPdfNumber.sheetNumber,
    numberSourceText: localizedPdfNumber.sourceText,
  };
}

function isAllowedEdgeMetadataZone(normX: number, normY: number) {
  const inBottomRight = normY >= 0.68 && normX >= 0.58;
  const inBottomBand = normY >= 0.8;
  const inRightBand = normX >= 0.8 && normY >= 0.08 && normY <= 0.88;
  const inTopRight = normX >= 0.64 && normY <= 0.24;
  const inBottomLeft = normX <= 0.3 && normY >= 0.74;
  const inLeftEdge = normX <= 0.18 && normY >= 0.08 && normY <= 0.9;

  return (
    inBottomRight ||
    inBottomBand ||
    inRightBand ||
    inTopRight ||
    inBottomLeft ||
    inLeftEdge
  );
}

function isAllowedEdgeMetadataLine(line: TextLine) {
  return isAllowedEdgeMetadataZone(line.normX, line.normY);
}

function isLowTrustInterior(line: TextLine) {
  return (
    line.normX > 0.24 &&
    line.normX < 0.72 &&
    line.normY > 0.18 &&
    line.normY < 0.74
  );
}

function getNearbyLines(lines: TextLine[], lineIndex: number, before = 2, after = 2) {
  return lines.slice(Math.max(0, lineIndex - before), lineIndex + after + 1);
}

function hasNearbyLabel(
  lines: TextLine[],
  lineIndex: number,
  pattern: RegExp,
  options?: { before?: number; after?: number }
) {
  const nearby = getNearbyLines(
    lines,
    lineIndex,
    options?.before ?? 2,
    options?.after ?? 2
  );

  return nearby.some((line) => pattern.test(normalizeWhitespace(line.text)));
}

function findLabelRelationship(
  lines: TextLine[],
  lineIndex: number,
  pattern: RegExp
) {
  for (let offset = 1; offset <= 3; offset += 1) {
    const previous = lines[lineIndex - offset];
    if (previous && pattern.test(normalizeWhitespace(previous.text))) {
      return {
        position: "above" as const,
        offset,
        line: previous,
      };
    }

    const next = lines[lineIndex + offset];
    if (next && pattern.test(normalizeWhitespace(next.text))) {
      return {
        position: "below" as const,
        offset,
        line: next,
      };
    }
  }

  return null;
}

function extractInlineFieldValue(
  line: string,
  pattern: RegExp,
  options?: {
    allowEmbedded?: boolean;
  }
) {
  const normalized = normalizeWhitespace(line);
  const match = normalized.match(pattern);

  if (!match || (!options?.allowEmbedded && match.index !== 0)) {
    return "";
  }

  const matchIndex = match.index ?? 0;
  let remainder = normalizeWhitespace(
    normalized
      .slice(matchIndex + match[0].length)
      .replace(/^[:#.\-\s\]]+/, "")
  );
  const nextFieldIndex = remainder.search(NEXT_FIELD_LABEL_SEARCH_PATTERN);
  if (nextFieldIndex > 0) {
    remainder = normalizeWhitespace(remainder.slice(0, nextFieldIndex));
  }

  return remainder;
}

function isMetadataLabelOnlyTitleText(line: string) {
  if (
    /^title\s+sheet$/i.test(normalizeWhitespace(line)) ||
    isCompactTitle24SheetTitleSignal(line)
  ) {
    return false;
  }
  return isMetadataLabelOnlyTextBase(line);
}

const LETTER_ONLY_SHEET_NUMBER_PATTERN = /^(?:CS|TS)$/i;
const EXTENDED_SHEET_NUMBER_VALUE_PATTERN =
  /^(?:(?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS)$/i;

function isRecognizedLetterOnlySheetNumber(value: string) {
  return LETTER_ONLY_SHEET_NUMBER_PATTERN.test(
    normalizeSheetNumberValue(value)
  );
}

function createExtendedSheetNumberTokenPattern() {
  return /\b((?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}|CS|TS)\b/gi;
}

function isSheetNumberValue(value: string) {
  const normalized = value.trim().toUpperCase();
  return (
    EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(normalized) ||
    (
      /^TI[-.]?(?=[A-Z])/.test(normalized) &&
      EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(
        stripDocumentSheetIndexWrapperPrefix(normalized)
      )
    )
  );
}

function extractSheetNumberTokensFromText(text: string) {
  return Array.from(
    normalizeWhitespace(text).matchAll(createExtendedSheetNumberTokenPattern())
  ).map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value));
}

function scoreInlineSheetNumberValue(value: string, sourceText: string) {
  const normalizedValue = normalizeSheetNumberValue(value);
  const normalizedSource = normalizeWhitespace(sourceText);
  let score = 0;

  if (/^[A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?$/.test(normalizedValue)) {
    score += 90;
  } else if (isRecognizedLetterOnlySheetNumber(normalizedValue)) {
    score += 132;
  }

  if (/[.-]/.test(normalizedValue)) {
    score += 20;
  }

  if (/^[A-Z]/.test(normalizedValue) && /\d/.test(normalizedValue)) {
    score += 18;
  }

  if (/^\d/.test(normalizedValue) && !/^[A-Z]/.test(normalizedValue)) {
    score -= 28;
  }

  if (
    isRecognizedLetterOnlySheetNumber(normalizedValue) &&
    /\b(?:cover|title)\s+sheet\b/i.test(normalizedSource)
  ) {
    score += 92;
  }

  if (
    /^(?:ANSI|ICC|CBC|IBC|NFPA)[-.]?\d/i.test(normalizedValue) ||
    (
      /\b(?:ANSI|ICC|CBC|IBC|NFPA)\b/i.test(normalizedSource) &&
      /\b(?:REFERENCE|CODE|STANDARD|COMPLIANT|REQUIREMENTS?)\b/i.test(normalizedSource)
    )
  ) {
    score -= 260;
  }

  if (countSheetReferenceTokens(normalizedSource) >= 2) {
    score -= 32;
  }

  if (/\bscale\b/i.test(normalizedSource)) {
    score += 10;
  }

  return score;
}

function normalizeLabeledTitleValue(value: string) {
  const cleaned = normalizeOcrTitleCandidateText(value)
    .replace(/\(\s*(FOR\s+REFERENCE)\s*\)/gi, "$1")
    .replace(/^\d+\s+(?=[A-Za-z])/, "")
    .replace(/^[NI]\s+(?=LEVEL\b)/i, "")
    .replace(
      /^(?:SHEET\s*T(?:IT(?:LE|1E|IE|I[E1])|ILE)|DRAWING\s*T(?:IT(?:LE|1E|IE|I[E1])|ILE))\b[:\s-]*/i,
      ""
    )
    .replace(/^SHEET INDEX\b\s+SYMBOLS LIST\b\s+AND\b\s+GENERAL NOTES\b/i, "GENERAL NOTES, SYMBOLS LIST AND SHEET INDEX")
    .replace(/^GENERAL NOTES\b\s+SYMBOLS LIST\b\s+AND\b\s+SHEET INDEX\b/i, "GENERAL NOTES, SYMBOLS LIST AND SHEET INDEX");

  return canonicalizeSheetIndexTitle(cleaned);
}

function looksLikeStructuredTitlePrefix(normalized: string) {
  if (!normalized) {
    return false;
  }

  return /^(?:LEVEL|AREA|ZONE|PHASE|BUILDING|BLDG|PARTIAL|ENLARGED|TYPICAL|OVERALL)\b/i.test(
    normalized
  );
}

function hasStructuredTitleValueSignal(
  value: string,
  options?: { allowPrefixOnly?: boolean }
) {
  const normalized = normalizeLabeledTitleValue(value);
  if (!normalized || NON_TITLE_FIELD_LABEL_PATTERN.test(normalizeWhitespace(value))) {
    return false;
  }

  return (
    isLikelySheetTitle(normalized) ||
    hasCompactTechnicalTitleSignal(normalized) ||
    countTitleVocabularyHits(normalized) > 0 ||
    Boolean(options?.allowPrefixOnly && looksLikeStructuredTitlePrefix(normalized))
  );
}

function findBestLabeledSheetNumber(lines: TextLine[]): LabeledFieldMatch | null {
  let best: LabeledFieldMatch | null = null;

  lines.forEach((line, lineIndex) => {
    if (!isAllowedEdgeMetadataLine(line)) {
      return;
    }

    const labelLine = normalizeWhitespace(line.text);
    const hasAnchoredLabel =
      SHEET_NUMBER_LABEL_PATTERN.test(labelLine) ||
      isOcrSheetNumberFieldLabelLike(labelLine);
    const usesEmbeddedLabel =
      !SHEET_NUMBER_LABEL_PATTERN.test(labelLine) &&
      EXPLICIT_SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(labelLine);
    if (!hasAnchoredLabel && !usesEmbeddedLabel) {
      return;
    }

    const inlineValue = extractInlineFieldValue(
      labelLine,
      usesEmbeddedLabel
        ? EXPLICIT_SHEET_NUMBER_LABEL_SEARCH_PATTERN
        : SHEET_NUMBER_LABEL_PATTERN,
      {
        allowEmbedded: usesEmbeddedLabel,
      }
    );
    const candidates: Array<{ value: string; line: TextLine; targetIndex: number; score: number }> = [];

    const inlineTokens = extractSheetNumberTokensFromText(inlineValue)
      .filter((candidate) => isSheetNumberValue(candidate))
      .sort(
        (left, right) =>
          scoreInlineSheetNumberValue(right, inlineValue) -
          scoreInlineSheetNumberValue(left, inlineValue)
      );

    const inlineNumber = inlineTokens[0] ?? "";
    if (inlineNumber) {
      candidates.push({
        value: inlineNumber,
        line,
        targetIndex: lineIndex,
        score: 148 + scoreInlineSheetNumberValue(inlineNumber, inlineValue),
      });
    }

    for (let offset = 1; offset <= 4; offset += 1) {
      const nextLine = lines[lineIndex + offset];
      if (!nextLine) continue;
      if (!isAllowedEdgeMetadataLine(nextLine)) continue;

      const nextTokens = extractSheetNumberTokensFromText(nextLine.text)
        .filter((candidate) => isSheetNumberValue(candidate))
        .sort(
          (left, right) =>
            scoreInlineSheetNumberValue(right, nextLine.text) -
            scoreInlineSheetNumberValue(left, nextLine.text)
        );
      const candidateText = nextTokens[0] ?? "";
      if (!candidateText) continue;

      candidates.push({
        value: candidateText,
        line: nextLine,
        targetIndex: lineIndex + offset,
        score:
          165 -
          offset * 12 +
          scoreInlineSheetNumberValue(candidateText, nextLine.text),
      });
    }

    for (const candidate of candidates) {
      const totalScore =
        candidate.score +
        (candidate.line.normY > 0.55 ? 18 : 0) +
        (candidate.line.normX > 0.45 ? 10 : 0) +
        getTextualSheetNumberRejectPenalty(candidate.value, candidate.line.text);

      if (!best || totalScore > best.score) {
        best = {
          value: candidate.value,
          lineIndex: candidate.targetIndex,
          score: totalScore,
          normX: candidate.line.normX,
          normY: candidate.line.normY,
          normWidth: candidate.line.normWidth,
          normHeight: candidate.line.normHeight,
          width: candidate.line.width,
          height: candidate.line.height,
        };
      }
    }
  });

  return best;
}

function findBestLabeledTitle(
  lines: TextLine[],
  winner: SheetNumberCandidate | null
): LabeledFieldMatch | null {
  let best: LabeledFieldMatch | null = null;

  lines.forEach((line, lineIndex) => {
    if (!isAllowedEdgeMetadataLine(line)) {
      return;
    }

    const labelLine = normalizeWhitespace(line.text);
    const hasAnchoredTitleLabel = TITLE_LABEL_PATTERN.test(labelLine);
    const hasEmbeddedTitleLabel =
      !hasAnchoredTitleLabel && TITLE_LABEL_SEARCH_PATTERN.test(labelLine);
    const hasNumberLabel = SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(labelLine);
    if (!hasAnchoredTitleLabel && !hasEmbeddedTitleLabel && !hasNumberLabel) {
      return;
    }

    const candidates: Array<{ value: string; line: TextLine; targetIndex: number; score: number }> = [];
    const inlineCandidates = new Map<string, number>();

    if (hasAnchoredTitleLabel || hasEmbeddedTitleLabel) {
      const titleInlineValue = normalizeLabeledTitleValue(
        extractInlineFieldValue(
          labelLine,
          hasAnchoredTitleLabel ? TITLE_LABEL_PATTERN : TITLE_LABEL_SEARCH_PATTERN,
          {
            allowEmbedded: !hasAnchoredTitleLabel,
          }
        )
      );
      if (titleInlineValue) {
        inlineCandidates.set(titleInlineValue, 125);
      }
    }

    if (hasNumberLabel) {
      const numberInlineValue = normalizeLabeledTitleValue(
        extractInlineFieldValue(labelLine, SHEET_NUMBER_LABEL_SEARCH_PATTERN, {
          allowEmbedded: true,
        })
      );
      if (numberInlineValue) {
        inlineCandidates.set(
          numberInlineValue,
          Math.max(inlineCandidates.get(numberInlineValue) ?? -Infinity, 118)
        );
      }
    }

    for (const [candidateValue, score] of inlineCandidates) {
      if (!isLikelySheetTitle(candidateValue)) {
        continue;
      }

      candidates.push({
        value: candidateValue,
        line,
        targetIndex: lineIndex,
        score,
      });
    }

    for (let offset = 1; offset <= 4; offset += 1) {
      const nextLine = lines[lineIndex + offset];
      if (!nextLine) continue;
      if (!isAllowedEdgeMetadataLine(nextLine)) continue;
      if (SHEET_NUMBER_LABEL_PATTERN.test(normalizeWhitespace(nextLine.text))) break;

      const normalizedNextLine = normalizeLabeledTitleValue(nextLine.text);
      if (!normalizedNextLine || !isLikelySheetTitle(normalizedNextLine)) continue;

      let score = 150 - offset * 10;
      if (winner) {
        const horizontalDistance = Math.abs(nextLine.normX - winner.normX);
        if (horizontalDistance <= 0.2) {
          score += 10;
        }
      }

      candidates.push({
        value: normalizedNextLine,
        line: nextLine,
        targetIndex: lineIndex + offset,
        score,
      });

      const followingLine = lines[lineIndex + offset + 1];
      if (
        followingLine &&
        isAllowedEdgeMetadataLine(followingLine) &&
        !SHEET_NUMBER_LABEL_PATTERN.test(normalizeWhitespace(followingLine.text))
      ) {
        const combined = normalizeLabeledTitleValue(
          `${normalizedNextLine} ${followingLine.text}`
        );
        if (combined && isLikelySheetTitle(combined)) {
          candidates.push({
            value: combined,
            line: nextLine,
            targetIndex: lineIndex + offset,
            score: score + 12,
          });
        }
      }
    }

    for (const candidate of candidates) {
      const stats = getWordStats(candidate.value);
      const totalScore =
        candidate.score +
        getRegionTrustScore(candidate.line.normX, candidate.line.normY) +
        (stats.isUppercaseLike ? 12 : 0) +
        (stats.uniqueRatio >= 0.75 ? 10 : -20) +
        getTitleRejectPenalty(candidate.value, candidate.line);

      if (!best || totalScore > best.score) {
        best = {
          value: candidate.value,
          lineIndex: candidate.targetIndex,
          score: totalScore,
          normX: candidate.line.normX,
          normY: candidate.line.normY,
          normWidth: candidate.line.normWidth,
          normHeight: candidate.line.normHeight,
          width: candidate.line.width,
          height: candidate.line.height,
        };
      }
    }
  });

  return best;
}

function isOcrTitleFieldLabelLike(value: string) {
  const normalized = normalizeKey(normalizeWhitespace(value));
  if (!normalized) {
    return false;
  }

  const repaired = normalized
    .replace(/[1!|]/g, "L")
    .replace(/0/g, "O")
    .replace(/5/g, "S")
    .replace(/8/g, "B");
  return (
    /^(?:TITLE|TIFLE|TITIE|TIITLE|TILE)$/i.test(normalized) ||
    /^(?:TITLE|DRAWINGTITLE|PROJECTTITLE|SHEETTITLE|SHEETTILE|DRAWINGTILE)$/i.test(repaired) ||
    (/(?:T(?:I|L)T(?:L|I)E|TILE)$/i.test(repaired) &&
      /^(?:SHEET|SHNET|SHET|SHEXT|DRAWING|PROJECT)/i.test(repaired))
  );
}

function classifyMetadataFieldKind(value: string): MetadataFieldKind | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  if (
    TITLE_FIELD_LABEL_PATTERN.test(normalized) ||
    /^(?:title|project title)\b/i.test(normalized) ||
    isOcrTitleFieldLabelLike(normalized)
  ) {
    return "title";
  }

  if (
    SHEET_NUMBER_LABEL_PATTERN.test(normalized) ||
    /^sheet$/i.test(normalized) ||
    isOcrSheetNumberFieldLabelLike(normalized)
  ) {
    return "sheet_number";
  }

  if (/^project\b/i.test(normalized)) return "project";
  if (/^facility\b/i.test(normalized)) return "facility";
  if (/^building\s*id\b/i.test(normalized)) return "building_id";
  if (/^(?:floor\s*lev|floor\s*level|level)\b/i.test(normalized)) return "floor_level";
  if (/^scale\b/i.test(normalized)) return "scale";
  if (/^(?:kp\s*proj\.?\s*no|project\s*number|project\s*no|proj\.?\s*no)\b/i.test(normalized)) {
    return "project_number";
  }
  if (/^(?:job\s*#?|job\s*number)\b/i.test(normalized)) return "job_number";
  if (/^(?:drwn\s*by|drawn\s*by|drafted\s*by)\b/i.test(normalized)) return "drafter";
  if (/^(?:chckd\s*by|checked\s*by|checker)\b/i.test(normalized)) return "checker";
  if (/^(?:issue\s*date|plot\s*date)\b/i.test(normalized)) return "issue_date";
  if (/^revision\b/i.test(normalized)) return "revision";
  if (/^date\b/i.test(normalized)) return "date";
  if (/^[A-Z][A-Z\s.#/-]{1,24}:$/i.test(normalized) && countWords(normalized) <= 4) {
    return "unknown";
  }

  return null;
}

function isTrustedMetadataFieldKind(kind: MetadataFieldKind | null | undefined) {
  return kind === "title" || kind === "sheet_number";
}

function isAdministrativeMetadataFieldKind(kind: MetadataFieldKind | null | undefined) {
  return Boolean(kind && kind !== "title" && kind !== "sheet_number" && kind !== "unknown");
}

function isStructuredMetadataTitleContinuation(
  text: string,
  previousText: string | null | undefined
) {
  const normalized = normalizeLabeledTitleValue(text);
  const previous = normalizeLabeledTitleValue(previousText ?? "");
  if (!normalized) {
    return false;
  }

  return (
    /^\(/.test(normalized) ||
    /^-\s*/.test(normalized) ||
    isStructuredBuildingSuffixText(normalized) ||
    /^(?:SCHEDULE|SCHEDULES|FOR REFERENCE|BASEMENT|ROOF|LEVEL\b|AREA\b|USGS\b|ZONE\b|PHASE\b)/i.test(normalized) ||
    looksLikeOcrTitleContinuation(normalized, previous)
  );
}

function getMetadataFieldInlineValue(line: string, fieldKind: MetadataFieldKind) {
  const normalized = normalizeWhitespace(line);

  switch (fieldKind) {
    case "title": {
      const inlineValue = normalizeLabeledTitleValue(
        extractInlineFieldValue(
          normalized,
          TITLE_LABEL_SEARCH_PATTERN,
          { allowEmbedded: true }
        )
      );
      if (!inlineValue) {
        return "";
      }
      const inlineKind = classifyMetadataFieldKind(inlineValue);
      if ((inlineKind && inlineKind !== "title") || /^[A-Z]{2,20}$/.test(inlineValue)) {
        return "";
      }
      return inlineValue;
    }
    case "sheet_number": {
      const inlineValue = normalizeSheetNumberValue(
        extractInlineFieldValue(
          normalized,
          SHEET_NUMBER_LABEL_SEARCH_PATTERN,
          { allowEmbedded: true }
        )
      );
      const token = extractSheetNumberFromText(inlineValue);
      return token && isSheetNumberValue(token) ? normalizeSheetNumberValue(token) : "";
    }
    case "project":
      return extractInlineFieldValue(normalized, /^project\b/i, {
        allowEmbedded: true,
      });
    case "facility":
      return extractInlineFieldValue(normalized, /^facility\b/i, {
        allowEmbedded: true,
      });
    case "building_id":
      return extractInlineFieldValue(normalized, /^building\s*id\b/i, {
        allowEmbedded: true,
      });
    case "floor_level":
      return extractInlineFieldValue(
        normalized,
        /^(?:floor\s*lev|floor\s*level|level)\b/i,
        { allowEmbedded: true }
      );
    case "scale":
      return extractInlineFieldValue(normalized, /^scale\b/i, {
        allowEmbedded: true,
      });
    case "project_number":
      return extractInlineFieldValue(
        normalized,
        /^(?:kp\s*proj\.?\s*no|project\s*number|project\s*no|proj\.?\s*no)\b/i,
        { allowEmbedded: true }
      );
    case "job_number":
      return extractInlineFieldValue(normalized, /^(?:job\s*#?|job\s*number)\b/i, {
        allowEmbedded: true,
      });
    case "checker":
      return extractInlineFieldValue(normalized, /^(?:chckd\s*by|checked\s*by|checker)\b/i, {
        allowEmbedded: true,
      });
    case "drafter":
      return extractInlineFieldValue(normalized, /^(?:drwn\s*by|drawn\s*by|drafted\s*by)\b/i, {
        allowEmbedded: true,
      });
    case "issue_date":
      return extractInlineFieldValue(normalized, /^(?:issue\s*date|plot\s*date)\b/i, {
        allowEmbedded: true,
      });
    case "revision":
      return extractInlineFieldValue(normalized, /^revision\b/i, {
        allowEmbedded: true,
      });
    case "date":
      return extractInlineFieldValue(normalized, /^date\b/i, {
        allowEmbedded: true,
      });
    default:
      return extractInlineFieldValue(normalized, /^[A-Za-z][A-Za-z\s.#/-]{1,24}:?/, {
        allowEmbedded: true,
      });
  }
}

function getMetadataFieldColumnTolerance(
  fieldKind: MetadataFieldKind,
  options?: { boundary?: boolean }
) {
  switch (fieldKind) {
    case "title":
      return options?.boundary ? 0.07 : 0.09;
    case "sheet_number":
      return options?.boundary ? 0.045 : 0.06;
    default:
      return options?.boundary ? 0.05 : 0.07;
  }
}

function isMetadataFieldColumnAligned(
  line: TextLine,
  labelLine: TextLine,
  fieldKind: MetadataFieldKind,
  options?: { boundary?: boolean }
) {
  const tolerance = getMetadataFieldColumnTolerance(fieldKind, options);
  const centerDiff = Math.abs(getLineCenterX(line) - getLineCenterX(labelLine));
  if (centerDiff <= tolerance) {
    return true;
  }

  const labelLeft = getLineLeft(labelLine);
  const labelRight = getLineRight(labelLine);
  const lineLeft = getLineLeft(line);
  const lineRight = getLineRight(line);
  if (fieldKind === "sheet_number") {
    return lineLeft >= labelLeft - 0.01 && lineLeft <= labelRight + 0.03;
  }
  const leftSlack = fieldKind === "title" ? 0.08 : 0.03;
  const rightSlack = fieldKind === "title" ? 0.12 : 0.05;

  return (
    lineRight >= labelLeft - leftSlack &&
    lineLeft <= labelRight + rightSlack
  );
}

function getMetadataFieldValueLineLimit(fieldKind: MetadataFieldKind) {
  switch (fieldKind) {
    case "title":
      return 4;
    case "sheet_number":
      return 2;
    case "project":
    case "facility":
      return 3;
    default:
      return 2;
  }
}

function dedupeMetadataStampLines(lines: TextLine[]) {
  const seen = new Map<string, TextLine>();

  for (const line of [...lines].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  })) {
    const normalized = normalizeWhitespace(line.text);
    if (!normalized) {
      continue;
    }

    const key = [
      normalizeKey(normalized),
      Math.round(getLineCenterX(line) * 150),
      Math.round(getLineCenterY(line) * 220),
    ].join(":");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, line);
      continue;
    }

    const existingSignal =
      getLineFontSizeSignal(existing) * 10 + existing.normWidth * 100 + existing.normHeight * 100;
    const nextSignal =
      getLineFontSizeSignal(line) * 10 + line.normWidth * 100 + line.normHeight * 100;
    if (nextSignal > existingSignal) {
      seen.set(key, line);
    }
  }

  return [...seen.values()].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  });
}

const SHIFTED_METADATA_GLYPH_MAP: Record<string, string> = {
  "\\": "B",
  "%": "E",
  "&": "F",
  "'": "G",
  "(": "H",
  ")": "I",
  "*": "J",
  "+": "K",
  ",": "L",
  "-": "M",
  ".": "N",
  "/": "O",
  "0": "O",
  "1": "Q",
  "2": "R",
  "3": "S",
  "4": "T",
  "5": "U",
  "6": "V",
  "7": "W",
  "8": "X",
  "9": "Y",
  ":": "Z",
};

function repairShiftedMetadataGlyphs(value: string) {
  return value
    .split("")
    .map((character) => SHIFTED_METADATA_GLYPH_MAP[character] ?? character)
    .join("");
}

function decodeShiftedMetadataCaesarText(value: string) {
  return value.replace(/[A-Z]/g, (character) => {
    const code = character.charCodeAt(0) - 65;
    const decoded = (code - 3 + 26) % 26;
    return String.fromCharCode(decoded + 65);
  });
}

function scoreDecodedMetadataStampText(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return 0;
  }

  let score = 0;
  const fieldKind = classifyMetadataFieldKind(normalized);
  if (fieldKind === "title" || fieldKind === "sheet_number") {
    score += 5;
  } else if (fieldKind) {
    score += 3;
  }

  if (NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)) {
    score += 2;
  }

  if (
    /\b(?:PROJECT|DRAWN BY|REVIEW BY|PLOT DATE|SHEET TITLE|SHEET NO|DRAWING TITLE|DRAWING NO)\b/i.test(
      normalized
    )
  ) {
    score += 3;
  }

  if (countTitleVocabularyHits(normalized) >= 1 || matchesTitleLikeVocabulary(normalized)) {
    score += 2;
  }

  if (countWords(normalized) >= 2 && /[AEIOU]/i.test(normalized)) {
    score += 1;
  }

  return score;
}

function decodePotentialShiftedMetadataStampText(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  const upper = normalized.toUpperCase();
  const repaired = repairShiftedMetadataGlyphs(upper);
  const hasEncodedGlyphSignal = /[\\%&'()*+,./:]/.test(normalized);
  const hasEncodedWordSignal =
    /(KHHW|LWOH|URMHFW|HYLHZ|UDZQ|DWH|ODQ|NHB|TXL|RRGVHUYLFH|VKHHW|WLWOH|SURMHFW|UHYLHZ|GUDZQ|SORW|SODQ|IRRGVHUYLFH)/i.test(
      `${upper} ${repaired}`
    );
  if (!hasEncodedGlyphSignal && !hasEncodedWordSignal) {
    return null;
  }

  if (!/[A-Z]{2,}/.test(repaired)) {
    return null;
  }

  const decoded = normalizeWhitespace(decodeShiftedMetadataCaesarText(repaired));
  if (!decoded || decoded === normalizeWhitespace(upper)) {
    return null;
  }

  return decoded;
}

function decodeShiftedMetadataStampLines(lines: TextLine[]) {
  const decodedEntries = lines.map((line) => {
    const decodedText = decodePotentialShiftedMetadataStampText(line.text);
    return {
      line,
      decodedText,
      score: decodedText ? scoreDecodedMetadataStampText(decodedText) : 0,
    };
  });

  const trustedHits = decodedEntries.filter(
    (entry) => entry.decodedText && entry.score >= 5
  ).length;
  const signalHits = decodedEntries.filter(
    (entry) => entry.decodedText && entry.score >= 3
  ).length;
  if (trustedHits < 1 || signalHits < 3) {
    return lines;
  }

  return decodedEntries.map(({ line, decodedText }) =>
    decodedText
      ? ({
          ...line,
          text: decodedText,
        } satisfies TextLine)
      : line
  );
}

function buildCombinedMetadataStampSeedLines(
  page: PageExtractionModel,
  regionIds: MetadataRegionId[]
) {
  const combined = regionIds.flatMap((regionId) => {
    const region = getMetadataRegionById(regionId);
    const regionPage = region ? buildPageRegionModel(page, region) : null;
    return regionPage?.lines ?? [];
  });

  return dedupeMetadataStampLines(combined);
}

function inferMetadataStampBoundsFromLines(
  page: PageExtractionModel,
  lines: TextLine[]
) {
  if (lines.length === 0) {
    return null;
  }

  const unionBox = getNormalizedTextLineBox(lines);
  if (!unionBox) {
    return null;
  }

  const signalLines = lines.filter((line) => {
    const normalized = normalizeWhitespace(line.text);
    return (
      Boolean(classifyMetadataFieldKind(normalized)) ||
      isMetadataColumnSignalLine(normalized) ||
      Boolean(extractSheetNumberFromText(normalized))
    );
  });
  const activeLines = signalLines.length > 0 ? signalLines : lines;
  const labelLines = activeLines.filter((line) =>
    Boolean(classifyMetadataFieldKind(line.text))
  );
  const side =
    activeLines.filter((line) => getLineCenterX(line) >= 0.55).length >=
    activeLines.filter((line) => getLineCenterX(line) <= 0.45).length
      ? "right"
      : "left";
  const hasSheetLabel = labelLines.some(
    (line) => classifyMetadataFieldKind(line.text) === "sheet_number"
  );
  const hasTitleLabel = labelLines.some(
    (line) => classifyMetadataFieldKind(line.text) === "title"
  );
  const hasTitleishValue = activeLines.some((line) => {
    const fieldKind = classifyMetadataFieldKind(line.text);
    if (fieldKind === "title") {
      return false;
    }
    return hasStructuredTitleValueSignal(line.text, { allowPrefixOnly: true });
  });
  const hasNumberishValue = activeLines.some((line) =>
    Boolean(extractSheetNumberFromText(line.text))
  );
  const left = Math.max(
    side === "right" ? 0.58 : 0.01,
    Math.min(...activeLines.map((line) => getLineLeft(line))) - 0.02
  );
  let nextLeft = left;
  let right = Math.min(
    side === "right" ? 0.998 : 0.42,
    Math.max(...activeLines.map((line) => getLineRight(line))) +
      (page.ocrBacked ? 0.05 : 0.035)
  );
  const top = Math.max(
    side === "right" ? 0.54 : 0.6,
    Math.min(...activeLines.map((line) => line.normY)) - 0.02
  );
  const baseBottom = Math.max(...activeLines.map((line) => getLineBottom(line)));
  let bottom = baseBottom + (page.ocrBacked ? 0.06 : 0.035);
  if (hasSheetLabel && !hasNumberishValue) {
    nextLeft = Math.max(
      side === "right" ? 0.52 : 0.01,
      nextLeft - (page.ocrBacked ? 0.05 : 0.08)
    );
    right = Math.min(
      side === "right" ? 0.998 : 0.42,
      right + (page.ocrBacked ? 0.02 : 0.03)
    );
    bottom += 0.12;
  } else if (hasSheetLabel) {
    bottom += 0.065;
  } else if (hasTitleLabel) {
    bottom += 0.04;
  }
  if (hasTitleLabel && !hasTitleishValue) {
    nextLeft = Math.max(
      side === "right" ? 0.5 : 0.01,
      nextLeft - (page.ocrBacked ? 0.04 : 0.07)
    );
    right = Math.min(
      side === "right" ? 0.998 : 0.48,
      right + (page.ocrBacked ? 0.02 : 0.04)
    );
    bottom += page.ocrBacked ? 0.08 : 0.1;
  }
  bottom = Math.min(0.998, bottom);

  if (right - left < 0.12 || bottom - top < 0.12) {
    return null;
  }

  return {
    x: nextLeft,
    y: top,
    width: right - nextLeft,
    height: bottom - top,
  };
}

function scoreMetadataStampSignalCluster(lines: TextLine[]) {
  if (lines.length === 0) {
    return -Infinity;
  }

  const trustedLabelCount = lines.filter((line) =>
    isTrustedMetadataFieldKind(classifyMetadataFieldKind(normalizeWhitespace(line.text)))
  ).length;
  if (trustedLabelCount === 0) {
    return -Infinity;
  }

  const sheetLabelCount = lines.filter(
    (line) => classifyMetadataFieldKind(normalizeWhitespace(line.text)) === "sheet_number"
  ).length;
  const titleLabelCount = lines.filter(
    (line) => classifyMetadataFieldKind(normalizeWhitespace(line.text)) === "title"
  ).length;
  const numberSignalCount = lines.filter((line) =>
    Boolean(extractSheetNumberFromText(normalizeWhitespace(line.text)))
  ).length;
  const titleSignalCount = lines.filter((line) => {
    return hasStructuredTitleValueSignal(line.text, { allowPrefixOnly: true });
  }).length;
  const minLeft = Math.min(...lines.map((line) => getLineLeft(line)));
  const maxRight = Math.max(...lines.map((line) => getLineRight(line)));
  const spanPenalty = Math.max(0, maxRight - minLeft - 0.24) * 240;

  return (
    trustedLabelCount * 42 +
    sheetLabelCount * 34 +
    titleLabelCount * 34 +
    numberSignalCount * 18 +
    titleSignalCount * 14 +
    Math.min(lines.length, 10) * 4 -
    spanPenalty
  );
}

function scoreMetadataRegionItems(items: PositionedTextItem[]) {
  if (items.length === 0) {
    return -Infinity;
  }

  const lines = buildTextLinesFromPositionedItems(items);
  if (lines.length === 0) {
    return -Infinity;
  }

  return scoreMetadataStampSignalCluster(lines) + lines.length;
}

function detectMetadataStampSignalBounds(page: PageExtractionModel) {
  const searchLines = dedupeMetadataStampLines(page.searchLines ?? page.lines);
  if (searchLines.length === 0) {
    return null;
  }

  const rightColumn = detectRightMetadataColumn(page);
  if (rightColumn) {
    const adaptiveBounds = getAdaptiveMetadataBoundsForRegion(page, "bottomRight");
    if (adaptiveBounds) {
      return adaptiveBounds;
    }
  }

  const signalLines = searchLines.filter((line) => {
    const normalized = normalizeWhitespace(line.text);
    if (!isAllowedEdgeMetadataLine(line) && getLineCenterY(line) < 0.54) {
      return false;
    }
    return (
      Boolean(classifyMetadataFieldKind(normalized)) ||
      isMetadataColumnSignalLine(normalized) ||
      Boolean(extractSheetNumberFromText(normalized)) ||
      (countTitleVocabularyHits(normalized) >= 1 && countWords(normalized) >= 2)
    );
  });
  if (signalLines.length < 3) {
    return null;
  }

  const rightSignals = signalLines.filter((line) => getLineCenterX(line) >= 0.55);
  const leftSignals = signalLines.filter((line) => getLineCenterX(line) <= 0.45);
  const candidateGroups = [rightSignals, leftSignals, signalLines]
    .filter((group, index, groups) => {
      if (group.length < 3) {
        return false;
      }
      return groups.findIndex(
        (candidate) =>
          candidate.length === group.length &&
          candidate.every((line, lineIndex) => candidate[lineIndex] === group[lineIndex])
      ) === index;
    })
    .map((group) => ({
      lines: group,
      bounds: inferMetadataStampBoundsFromLines(page, group),
      score: scoreMetadataStampSignalCluster(group),
    }))
    .filter(
      (candidate): candidate is {
        lines: TextLine[];
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
        score: number;
      } => Boolean(candidate.bounds) && Number.isFinite(candidate.score)
    )
    .sort((left, right) => {
      if (Math.abs(right.score - left.score) > 1) {
        return right.score - left.score;
      }
      return left.bounds.width - right.bounds.width;
    });

  return candidateGroups[0]?.bounds ?? null;
}

function buildMetadataStampSearchPage(page: PageExtractionModel) {
  const seedLines = buildCombinedMetadataStampSeedLines(page, [
    "stripFull",
    "stripTitle",
    "stripNumber",
    "bottomRight",
    "titleTall",
    "titleBlock",
    "numberBlock",
    "sheetStamp",
  ]);
  const ocrUnionBounds = page.ocrBacked
    ? unionNormalizedOcrPatternBoxes([page.ocrTitleBox, page.ocrNumberBox])
    : null;
  const expandedOcrBounds = ocrUnionBounds
    ? adjustNormalizedOcrPatternBox(ocrUnionBounds, {
        left: 0.02,
        right: 0.06,
        top: 0.02,
        bottom: 0.08,
      })
    : null;
  const inferredSeedBounds =
    seedLines.length > 0 ? inferMetadataStampBoundsFromLines(page, seedLines) : null;
  const fallbackBounds = detectMetadataStampSignalBounds(page);
  const bounds = expandedOcrBounds ?? inferredSeedBounds ?? fallbackBounds;

  if (bounds) {
    const boundedPage = buildPageModelFromNormalizedBounds(page, bounds);
    if (boundedPage) {
      const parserLines = dedupeMetadataStampLines(
        decodeShiftedMetadataStampLines(dedupeMetadataStampLines(boundedPage.lines))
      );
      return {
        page: buildPageModelFromLines(
          page.pageNumber,
          parserLines,
          page.ocrBacked,
          {
            drawingSegments: page.drawingSegments,
            ocrNumberBox: page.ocrNumberBox,
            ocrTitleBox: page.ocrTitleBox,
          }
        ),
        bounds,
      };
    }
  }

  if (seedLines.length > 0) {
    const parserLines = dedupeMetadataStampLines(
      decodeShiftedMetadataStampLines(seedLines)
    );
    return {
      page: buildPageModelFromLines(
        page.pageNumber,
        parserLines,
        page.ocrBacked,
        {
          drawingSegments: page.drawingSegments,
          ocrNumberBox: page.ocrNumberBox,
          ocrTitleBox: page.ocrTitleBox,
        }
      ),
      bounds: getNormalizedTextLineBox(parserLines),
    };
  }

  return null;
}

function isMetadataFieldBoundaryLine(
  line: TextLine,
  currentKind: MetadataFieldKind,
  labelLine: TextLine
) {
  const nextKind = classifyMetadataFieldKind(line.text);
  if (!nextKind) {
    return false;
  }

  if (!isMetadataFieldColumnAligned(line, labelLine, currentKind, { boundary: true })) {
    return false;
  }

  if (currentKind === "title") {
    if (nextKind === "floor_level" && isLikelySheetTitle(line.text)) {
      return false;
    }
    return true;
  }

  return nextKind !== currentKind || nextKind === "sheet_number";
}

function isMeasurementOnlyMetadataTitleLine(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }

  return /^(?:[-–—]\s*)?\d+(?:\s+\d+\/\d+|\s*\/\s*\d+)?\s*(?:"|'|IN\.?|FT\.?)$/i.test(
    normalized
  );
}

function shouldKeepMetadataFieldValueLine(
  line: TextLine,
  fieldKind: MetadataFieldKind,
  labelLine: TextLine
) {
  const normalized = normalizeWhitespace(line.text);
  if (!normalized) {
    return false;
  }

  const inlineKind = classifyMetadataFieldKind(normalized);
  if (
    inlineKind &&
    inlineKind !== fieldKind &&
    !(
      fieldKind === "title" &&
      inlineKind === "floor_level" &&
      isLikelySheetTitle(normalized)
    )
  ) {
    return false;
  }

  if (countSheetReferenceTokens(normalized) >= 2 && fieldKind !== "sheet_number") {
    return false;
  }

  switch (fieldKind) {
    case "title":
      return (
        normalizeLabeledTitleValue(normalized).length > 0 &&
        !isMeasurementOnlyMetadataTitleLine(normalized) &&
        !SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalized) &&
        !NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)
      );
    case "sheet_number":
      return (
        Boolean(extractSheetNumberFromText(normalized)) ||
        /^[A-Z0-9.\-]{2,}$/.test(normalized) ||
        Math.abs(getLineCenterX(line) - getLineCenterX(labelLine)) <= 0.12
      );
    case "project":
    case "facility":
      return countWords(normalized) >= 1;
    default:
      return normalized.length > 0;
  }
}

function buildMetadataStampField(
  page: PageExtractionModel,
  lines: TextLine[],
  labelIndex: number,
  fieldKind: MetadataFieldKind
) {
  const labelLine = lines[labelIndex];
  if (!labelLine) {
    return null;
  }

  const inlineValue = getMetadataFieldInlineValue(labelLine.text, fieldKind);
  const valueLines: TextLine[] = [];
  let previousLine = labelLine;
  for (
    let cursor = labelIndex + 1;
    cursor < lines.length && valueLines.length < getMetadataFieldValueLineLimit(fieldKind);
    cursor += 1
  ) {
    const nextLine = lines[cursor];
    if (!nextLine) {
      break;
    }
    const nextKind = classifyMetadataFieldKind(nextLine.text);
    const sameColumn = isMetadataFieldColumnAligned(nextLine, labelLine, fieldKind);
    const alignedWithPrevious =
      Math.abs(getLineCenterX(nextLine) - getLineCenterX(previousLine)) <=
        (fieldKind === "title" ? 0.07 : 0.045) ||
      getLineHorizontalOverlap(nextLine, previousLine) >=
        Math.min(nextLine.normWidth, previousLine.normWidth) * 0.25;
    const continuationLike =
      fieldKind === "title" &&
      isStructuredMetadataTitleContinuation(nextLine.text, previousLine.text);
    if (isMetadataFieldBoundaryLine(nextLine, fieldKind, labelLine)) {
      break;
    }
    if (hasStrongHorizontalSeparatorBetweenLines(page, previousLine, nextLine)) {
      break;
    }
    const verticalGap = Math.max(nextLine.normY - getLineBottom(previousLine), 0);
    const gapFromLabel = Math.max(nextLine.normY - getLineBottom(labelLine), 0);
    const maxVerticalGap =
      fieldKind === "title"
        ? valueLines.length === 0
          ? 0.04
          : continuationLike
            ? 0.032
            : 0.024
        : 0.028;
    const maxGapFromLabel = fieldKind === "title" ? 0.09 : 0.065;
    if (verticalGap > maxVerticalGap || gapFromLabel > maxGapFromLabel) {
      break;
    }
    if (!shouldKeepMetadataFieldValueLine(nextLine, fieldKind, labelLine)) {
      if (nextKind && !sameColumn) {
        continue;
      }
      if (fieldKind !== "title") {
        break;
      }
      continue;
    }
    if (fieldKind === "title") {
      if (!(sameColumn || alignedWithPrevious || continuationLike)) {
        break;
      }
    } else if (!sameColumn) {
      break;
    }
    valueLines.push(nextLine);
    previousLine = nextLine;
  }

  if (fieldKind === "title" && valueLines.length === 0) {
    let rescuePreviousLine = labelLine;
    for (
      let cursor = labelIndex + 1;
      cursor < lines.length && valueLines.length < getMetadataFieldValueLineLimit(fieldKind);
      cursor += 1
    ) {
      const nextLine = lines[cursor];
      if (!nextLine) {
        break;
      }
      const nextKind = classifyMetadataFieldKind(nextLine.text);
      if (nextKind === "sheet_number") {
        break;
      }
      if (nextKind && nextKind !== "title" && nextKind !== "floor_level" && valueLines.length > 0) {
        break;
      }
      if (hasStrongHorizontalSeparatorBetweenLines(page, rescuePreviousLine, nextLine)) {
        break;
      }
      const gapFromLabel = Math.max(nextLine.normY - getLineBottom(labelLine), 0);
      const verticalGap = Math.max(nextLine.normY - getLineBottom(rescuePreviousLine), 0);
      if (gapFromLabel > 0.14 || verticalGap > (valueLines.length === 0 ? 0.055 : 0.04)) {
        break;
      }
      const normalizedTitle = normalizeLabeledTitleValue(nextLine.text);
      const titleSignal =
        Boolean(normalizedTitle) &&
        (
          isLikelySheetTitle(normalizedTitle) ||
          hasCompactTechnicalTitleSignal(normalizedTitle) ||
          countTitleVocabularyHits(normalizedTitle) > 0
        );
      const structuralPrefix =
        Boolean(normalizedTitle) &&
        (
          nextKind === "floor_level" ||
          looksLikeStructuredTitlePrefix(normalizedTitle) ||
          isStructuredMetadataTitleContinuation(nextLine.text, rescuePreviousLine.text)
        );
      if (
        !normalizedTitle ||
        NON_TITLE_FIELD_LABEL_PATTERN.test(normalizeWhitespace(nextLine.text)) ||
        (!titleSignal && !structuralPrefix)
      ) {
        continue;
      }
      const sameColumn = isMetadataFieldColumnAligned(nextLine, labelLine, fieldKind);
      const overlapsPrevious =
        Math.abs(getLineCenterX(nextLine) - getLineCenterX(rescuePreviousLine)) <= 0.09 ||
        getLineHorizontalOverlap(nextLine, rescuePreviousLine) >=
          Math.min(nextLine.normWidth, rescuePreviousLine.normWidth) * 0.2;
      const continuationLike = isStructuredMetadataTitleContinuation(
        nextLine.text,
        rescuePreviousLine.text
      );
      if (!(sameColumn || overlapsPrevious || continuationLike || structuralPrefix)) {
        break;
      }
      valueLines.push(nextLine);
      rescuePreviousLine = nextLine;
    }
  }

  const valueParts = [
    ...(inlineValue ? [inlineValue] : []),
    ...valueLines.map((line) =>
      fieldKind === "title"
        ? normalizeLabeledTitleValue(line.text)
        : normalizeWhitespace(line.text)
    ),
  ].filter(Boolean);
  const valueText =
    fieldKind === "title"
      ? mergeOcrTitleSelectionParts(valueParts)
      : normalizeWhitespace(valueParts.join(" "));
  const sourceText = [
    labelLine.text,
    ...valueLines.map((line) => line.text),
  ]
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean)
    .join("\n");
  const bounds = getNormalizedTextLineBox([labelLine, ...valueLines]);
  const localityPenalty = valueLines.reduce((total, line, index) => {
    const anchorLine = index > 0 ? valueLines[index - 1]! : labelLine;
    const verticalGap = Math.max(line.normY - getLineBottom(anchorLine), 0);
    const centerDiff = Math.abs(getLineCenterX(line) - getLineCenterX(labelLine));
    let penalty = 0;
    if (verticalGap > (fieldKind === "title" ? 0.018 : 0.014)) {
      penalty += fieldKind === "title" ? 20 : 28;
    }
    if (centerDiff > (fieldKind === "title" ? 0.06 : 0.045)) {
      penalty += fieldKind === "title" ? 24 : 32;
    }
    if (!isMetadataFieldColumnAligned(line, labelLine, fieldKind)) {
      penalty += fieldKind === "title" ? 24 : 36;
    }
    return total + penalty;
  }, 0);

  let score = getRegionTrustScore(labelLine.normX, labelLine.normY);
  if (fieldKind === "title") {
    score += 120;
    score += countTitleVocabularyHits(valueText) * 16;
    score += Math.max(valueLines.length - 1, 0) * 10;
    if (isLikelySheetTitle(valueText)) {
      score += 42;
    }
  } else if (fieldKind === "sheet_number") {
    score += 132;
    const token = extractSheetNumberFromText(valueText);
    if (token && isSheetNumberValue(token)) {
      score += 56 + scoreInlineSheetNumberValue(token, valueText);
    }
  } else {
    score += valueText ? 36 : 0;
  }

  if (!valueText) {
    score -= 80;
  }
  score -= localityPenalty;

  return {
    labelText: normalizeWhitespace(labelLine.text),
    labelKind: fieldKind,
    labelLine,
    valueLines,
    valueText,
    sourceText,
    bounds,
    score,
  } satisfies MetadataStampField;
}

function buildMetadataStampFields(page: PageExtractionModel) {
  const lines = dedupeMetadataStampLines(page.lines);
  const fields = lines
    .map((line, index) => {
      const fieldKind = classifyMetadataFieldKind(line.text);
      if (!fieldKind) {
        return null;
      }
      return buildMetadataStampField(page, lines, index, fieldKind);
    })
    .filter((field): field is MetadataStampField => Boolean(field))
    .sort((left, right) => {
      if (Math.abs(right.score - left.score) > 1) {
        return right.score - left.score;
      }
      return left.labelLine.normY - right.labelLine.normY;
    });

  const deduped: MetadataStampField[] = [];
  for (const field of fields) {
    const existing = deduped.find(
      (candidate) =>
        candidate.labelKind === field.labelKind &&
        Math.abs(candidate.labelLine.normY - field.labelLine.normY) <= 0.012
    );
    if (!existing) {
      deduped.push(field);
      continue;
    }
    if (field.score > existing.score) {
      deduped.splice(deduped.indexOf(existing), 1, field);
    }
  }

  return deduped.sort((left, right) => left.labelLine.normY - right.labelLine.normY);
}

function mergeMetadataStampFieldSets(...fieldSets: MetadataStampField[][]) {
  const fields = fieldSets
    .flat()
    .sort((left, right) => {
      if (Math.abs(right.score - left.score) > 1) {
        return right.score - left.score;
      }
      return left.labelLine.normY - right.labelLine.normY;
    });

  const deduped: MetadataStampField[] = [];
  for (const field of fields) {
    const existing = deduped.find(
      (candidate) =>
        candidate.labelKind === field.labelKind &&
        Math.abs(candidate.labelLine.normY - field.labelLine.normY) <= 0.012
    );
    if (!existing) {
      deduped.push(field);
      continue;
    }

    const fieldHasValue = normalizeWhitespace(field.valueText).length > 0;
    const existingHasValue = normalizeWhitespace(existing.valueText).length > 0;
    if (
      (fieldHasValue && !existingHasValue) ||
      (fieldHasValue === existingHasValue && field.score > existing.score)
    ) {
      deduped.splice(deduped.indexOf(existing), 1, field);
    }
  }

  return deduped.sort((left, right) => left.labelLine.normY - right.labelLine.normY);
}

function buildSupplementalMetadataStampFields(page: PageExtractionModel) {
  const regionIds: MetadataRegionId[] = [
    "titleBlock",
    "titleTall",
    "numberBlock",
    "sheetStamp",
    "stripTitle",
    "stripNumber",
  ];
  const fields: MetadataStampField[] = [];

  for (const regionId of regionIds) {
    const region = getMetadataRegionById(regionId);
    const regionPage = region ? buildPageRegionModel(page, region) : null;
    if (!regionPage || regionPage.lines.length === 0) {
      continue;
    }
    fields.push(...buildMetadataStampFields(regionPage));
  }

  return mergeMetadataStampFieldSets(fields);
}

function buildMetadataStampOcrNumberBoxCandidates(page: PageExtractionModel) {
  if (!page.ocrBacked) {
    return [] as MetadataStampValueCandidate[];
  }

  const boxedLines = filterOcrNumberLinesToDetectedBox(page, page.lines);
  const compartmentLines = filterOcrNumberLinesToLocalCompartment(page, boxedLines);
  const activeLines = compartmentLines.length > 0 ? compartmentLines : boxedLines;
  if (activeLines.length === 0) {
    return [] as MetadataStampValueCandidate[];
  }

  const boxPage = buildPageModelFromLines(page.pageNumber, activeLines, true, {
    drawingSegments: page.drawingSegments,
    ocrNumberBox: page.ocrNumberBox,
    ocrTitleBox: page.ocrTitleBox,
  });
  const sourceText = activeLines.map((line) => normalizeWhitespace(line.text)).filter(Boolean).join("\n");

  return boxPage.candidates
    .map((candidate) => ({
      candidate,
      score: rescoreCandidate(candidate, {}, {}),
    }))
    .filter(({ candidate }) => {
      const normalized = normalizeSheetNumberValue(candidate.value);
      return (
        isSheetNumberValue(normalized) &&
        /^[A-Z]{1,4}(?:[-.]?\d|\d)/.test(normalized) &&
        !candidate.isNumericOnly
      );
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(({ candidate, score }) => ({
      value: normalizeSheetNumberValue(candidate.value),
      sourceText: sourceText || candidate.lineText,
      lineIndexes: [candidate.lineIndex],
      bounds: getNormalizedBoxFromCandidate(candidate, activeLines[candidate.lineIndex] ?? null),
      score: 220 + score,
    }));
}

function buildMetadataStampGlobalNumberRescueCandidates(
  page: PageExtractionModel,
  numberField: MetadataStampField | null
) {
  const sourceLines = page.searchLines ?? page.lines;
  if (sourceLines.length === 0) {
    return [] as MetadataStampValueCandidate[];
  }

  return sourceLines
    .flatMap((line) => {
      const centerX = getLineCenterX(line);
      const centerY = getLineCenterY(line);

      if (numberField) {
        if (centerY <= numberField.labelLine.normY - 0.01 || centerY >= 0.998) {
          return [];
        }
        if (Math.abs(centerX - getLineCenterX(numberField.labelLine)) > 0.22) {
          return [];
        }
      } else if (centerX < 0.72 || centerY < 0.72) {
        return [];
      }

      return extractSheetNumberTokensFromText(line.text)
        .filter((token) => isSheetNumberValue(token))
        .map((token) => {
          const normalized = normalizeSheetNumberValue(token);
          const inlineScore = scoreInlineSheetNumberValue(normalized, line.text);
          const fontSignal = getLineFontSizeSignal(line);
          return {
            value: normalized,
            sourceText: normalizeWhitespace(line.text),
            lineIndexes: [line.lineId ?? -1],
            bounds: getNormalizedTextLineBox([line]),
            score:
              (numberField?.score ?? 120) +
              48 +
              inlineScore +
              getRegionTrustScore(line.normX, line.normY) +
              (fontSignal >= 20 ? 56 : fontSignal >= 12 ? 28 : 0),
          } satisfies MetadataStampValueCandidate;
        });
    })
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, array) => {
      return (
        array.findIndex(
          (entry) =>
            normalizeSheetNumberValue(entry.value) === normalizeSheetNumberValue(candidate.value)
        ) === index
      );
    })
    .slice(0, 5);
}

function isStructuredCompactSheetNumberValue(value: string, labelText?: string | null) {
  const normalized = normalizeSheetNumberValue(value);
  if (!normalized) {
    return false;
  }

  if (isSheetNumberValue(normalized)) {
    return true;
  }

  const normalizedLabel = normalizeWhitespace(labelText ?? "");
  if (
    !SHEET_NUMBER_LABEL_PATTERN.test(normalizedLabel) &&
    !isOcrSheetNumberFieldLabelLike(normalizedLabel)
  ) {
    return false;
  }

  return (
    /^[A-Z]{2,4}$/.test(normalized) ||
    /^[A-Z]{1,3}\d[A-Z0-9]?$/.test(normalized) ||
    /^[A-Z]\d[A-Z]$/.test(normalized)
  );
}

function extractStructuredSheetNumberValue(field: MetadataStampField | null | undefined) {
  const source = normalizeSheetNumberValue(field?.valueText ?? "");
  if (!source) {
    return null;
  }

  const token = extractSheetNumberFromText(source);
  if (token && isSheetNumberValue(token)) {
    return normalizeSheetNumberValue(token);
  }

  return isStructuredCompactSheetNumberValue(source, field?.labelText ?? null) ? source : null;
}

function normalizeStampSheetNumberCandidateText(value: string) {
  return normalizeWhitespace(value)
    .replace(/\bT\s*[I1L]\b\s*[-.]?\s*/gi, "TI-")
    .replace(/\bT[I1L]\s+([A-Z]{1,4}[-.]?\d)/gi, "TI-$1")
    .replace(/\b([A-Z]{1,4})\s+(\d{1,4}(?:\.\d{1,3})?[A-Z]?)\b/g, "$1-$2")
    .replace(/\s*[-.]\s*/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extractStampSheetNumberTokensFromText(text: string) {
  const variants = new Set<string>([
    normalizeWhitespace(text),
    normalizeStampSheetNumberCandidateText(text),
    normalizeWhitespace(text).replace(/\s+/g, ""),
  ]);
  const tokens: string[] = [];
  for (const variant of variants) {
    const wrapperMatches = variant.matchAll(
      /\bT[I1L][-. ]*([A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?)\b/gi
    );
    for (const match of wrapperMatches) {
      const core = normalizeSheetNumberValue(match[1] ?? "");
      const wrapped = normalizeTiWrappedSheetNumberValue(`TI-${core}`);
      if (core && wrapped && isSheetNumberValue(wrapped)) {
        tokens.push(wrapped);
      }
    }
  }
  for (const variant of variants) {
    for (const token of extractSheetNumberTokensFromText(variant)) {
      const normalized = normalizeSheetNumberValue(token);
      if (normalized && isSheetNumberValue(normalized)) {
        tokens.push(normalized);
      }
    }
  }

  return tokens.filter((token, index, array) => array.indexOf(token) === index);
}

function isLikelyStampSheetNumberLine(line: TextLine, value: string) {
  const normalizedLine = normalizeWhitespace(line.text);
  const normalizedValue = normalizeSheetNumberValue(value);
  if (!normalizedLine || !normalizedValue) {
    return false;
  }
  if (
    NON_TITLE_FIELD_LABEL_PATTERN.test(normalizedLine) ||
    /\b(?:project|job|date|scale|drawn|checked|review|approved|copyright|phone|www\.|\.com)\b/i.test(
      normalizedLine
    )
  ) {
    return false;
  }
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(normalizedLine)) {
    return false;
  }
  if (/^\d+(?:\.\d+)?\s*(?:%|SF|SQ\.?\s*FT\.?)?$/i.test(normalizedLine)) {
    return false;
  }
  if (
    countSheetReferenceTokens(normalizedLine) >= 3 &&
    normalizeSheetNumberValue(normalizedLine) !== normalizedValue
  ) {
    return false;
  }

  return true;
}

function buildLabelNeighborhoodSheetNumberCandidates(
  lines: readonly TextLine[],
  field: MetadataStampField
) {
  const labelLine = field.labelLine;
  const labelCenterX = getLineCenterX(labelLine);
  const labelBottom = getLineBottom(labelLine);
  const neighborhoodLines = lines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    const belowOrSame = centerY >= labelLine.normY - 0.012;
    const nearVertical = centerY <= labelBottom + 0.18;
    const nearHorizontal =
      Math.abs(centerX - labelCenterX) <= 0.34 ||
      (line.normX >= labelLine.normX - 0.02 && line.normX <= getLineRight(labelLine) + 0.34);
    if (!belowOrSame || !nearVertical || !nearHorizontal) {
      return false;
    }
    if (
      line.lineId != null &&
      line.lineId === labelLine.lineId &&
      normalizeWhitespace(line.text) === normalizeWhitespace(labelLine.text)
    ) {
      return false;
    }
    return true;
  });

  const candidates: MetadataStampValueCandidate[] = [];
  const candidateWindows: TextLine[][] = neighborhoodLines.map((line) => [line]);
  for (let index = 0; index < neighborhoodLines.length - 1; index += 1) {
    const first = neighborhoodLines[index]!;
    const second = neighborhoodLines[index + 1]!;
    const sameCluster =
      Math.abs(getLineCenterY(first) - getLineCenterY(second)) <=
        Math.max(first.normHeight, second.normHeight) * 1.8 ||
      Math.abs(getLineCenterX(first) - getLineCenterX(second)) <= 0.12;
    if (sameCluster) {
      candidateWindows.push([first, second]);
    }
  }

  for (const windowLines of candidateWindows) {
    const sourceText = windowLines
      .map((line) => normalizeWhitespace(line.text))
      .filter(Boolean)
      .join(" ");
    for (const token of extractStampSheetNumberTokensFromText(sourceText)) {
      const representativeLine =
        windowLines.find((line) => normalizeKey(line.text).includes(normalizeKey(token))) ??
        windowLines[0]!;
      if (!isLikelyStampSheetNumberLine(representativeLine, token)) {
        continue;
      }
      const fontSignal = Math.max(...windowLines.map((line) => getLineFontSizeSignal(line)));
      const verticalDelta = Math.max(getLineCenterY(representativeLine) - getLineCenterY(labelLine), 0);
      const horizontalDelta = Math.abs(getLineCenterX(representativeLine) - labelCenterX);
      candidates.push({
        value: token,
        sourceText,
        lineIndexes: windowLines.map((line) => line.lineId ?? -1),
        bounds: getNormalizedTextLineBox(windowLines),
        score:
          field.score +
          150 +
          scoreInlineSheetNumberValue(token, sourceText) +
          getRegionTrustScore(representativeLine.normX, representativeLine.normY) +
          (fontSignal >= 24 ? 96 : fontSignal >= 16 ? 58 : fontSignal >= 10 ? 24 : 0) -
          Math.round(verticalDelta * 180) -
          Math.round(horizontalDelta * 120),
      });
    }
  }

  return candidates;
}

function buildLargeTextStampNumberCandidates(page: PageExtractionModel) {
  const sourceLines = page.searchLines ?? page.lines;
  const fontSignals = sourceLines
    .map((line) => getLineFontSizeSignal(line))
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianFont = Math.max(median(fontSignals), 1);
  const candidates: MetadataStampValueCandidate[] = [];

  for (const line of sourceLines) {
    const fontSignal = getLineFontSizeSignal(line);
    const inLikelyStampArea =
      line.normY >= 0.62 ||
      line.normX >= 0.62 ||
      line.normWidth >= 0.24 ||
      line.normHeight >= 0.018;
    const visuallyProminent = fontSignal >= Math.max(14, medianFont * 1.55) || line.normHeight >= 0.016;
    if (!inLikelyStampArea || !visuallyProminent) {
      continue;
    }
    for (const token of extractStampSheetNumberTokensFromText(line.text)) {
      if (!isLikelyStampSheetNumberLine(line, token)) {
        continue;
      }
      candidates.push({
        value: token,
        sourceText: normalizeWhitespace(line.text),
        lineIndexes: [line.lineId ?? -1],
        bounds: getNormalizedTextLineBox([line]),
        score:
          180 +
          scoreInlineSheetNumberValue(token, line.text) +
          getRegionTrustScore(line.normX, line.normY) +
          Math.min(Math.round((fontSignal / medianFont) * 28), 110),
      });
    }
  }

  return candidates;
}

function buildMetadataStampNumberCandidates(
  fields: MetadataStampField[],
  lines: TextLine[],
  page: PageExtractionModel
) {
  const candidates: MetadataStampValueCandidate[] = [];

  for (const field of fields.filter((field) => field.labelKind === "sheet_number")) {
    const candidateValues = new Map<
      string,
      {
        score: number;
        sourceText: string;
        lineIndexes: number[];
        bounds: MetadataStampValueCandidate["bounds"];
      }
    >();
    const applyCandidateValue = (
      value: string,
      score: number,
      sourceText: string,
      lineIndexes: number[],
      bounds: MetadataStampValueCandidate["bounds"]
    ) => {
      const normalized = preserveSheetNumberWrapperFromSource(value, sourceText);
      if (!normalized) {
        return;
      }
      const existing = candidateValues.get(normalized);
      if (!existing || score > existing.score) {
        candidateValues.set(normalized, {
          score,
          sourceText: normalizeWhitespace(sourceText) || normalized,
          lineIndexes,
          bounds,
        });
      }
    };
    const directToken = extractStructuredSheetNumberValue(field);
    if (directToken) {
      applyCandidateValue(
        directToken,
        field.score + 80 + scoreInlineSheetNumberValue(directToken, field.valueText),
        field.valueText || field.sourceText,
        [
          field.labelLine.lineId ?? -1,
          ...field.valueLines.map((line) => line.lineId ?? -1),
        ],
        field.bounds
      );
    }

    for (const candidate of buildLabelNeighborhoodSheetNumberCandidates(lines, field)) {
      applyCandidateValue(
        candidate.value,
        candidate.score,
        candidate.sourceText,
        candidate.lineIndexes,
        candidate.bounds
      );
    }

    for (const line of field.valueLines) {
      const lineTokens = extractSheetNumberTokensFromText(line.text);
      const directLineValue = normalizeSheetNumberValue(line.text);
      const fallbackTokens =
        lineTokens.length > 0
          ? lineTokens
          : isStructuredCompactSheetNumberValue(directLineValue, field.labelText)
            ? [directLineValue]
            : [];
      for (const token of fallbackTokens) {
        if (!isStructuredCompactSheetNumberValue(token, field.labelText)) {
          continue;
        }
        const normalized = normalizeSheetNumberValue(token);
        const nextScore =
          field.score +
          72 +
          scoreInlineSheetNumberValue(normalized, line.text) +
          getRegionTrustScore(line.normX, line.normY);
        applyCandidateValue(
          normalized,
          nextScore,
          line.text,
          [line.lineId ?? -1],
          getNormalizedTextLineBox([line])
        );
      }
    }

    const rescueLines = lines.filter((line) => {
      if (
        line.lineId != null &&
        [field.labelLine, ...field.valueLines].some(
          (candidate) => candidate.lineId != null && candidate.lineId === line.lineId
        )
      ) {
        return false;
      }
      if (line.normY <= getLineBottom(field.labelLine)) {
        return false;
      }
      if (line.normY - field.labelLine.normY > 0.1) {
        return false;
      }
      if (!isMetadataFieldColumnAligned(line, field.labelLine, "sheet_number")) {
        return false;
      }
      if (classifyMetadataFieldKind(line.text) && !extractSheetNumberFromText(line.text)) {
        return false;
      }
      return true;
    });

    for (const line of rescueLines) {
      for (const token of extractSheetNumberTokensFromText(line.text)) {
        if (!isSheetNumberValue(token)) {
          continue;
        }
        const normalized = normalizeSheetNumberValue(token);
        const nextScore =
          field.score +
          64 +
          scoreInlineSheetNumberValue(normalized, line.text) +
          getRegionTrustScore(line.normX, line.normY);
        applyCandidateValue(
          normalized,
          nextScore,
          line.text,
          [line.lineId ?? -1],
          getNormalizedTextLineBox([line])
        );
      }
    }

    if (candidateValues.size === 0) {
      for (const otherField of fields) {
        if (otherField === field) {
          continue;
        }

        const otherLines = otherField.valueLines.length > 0
          ? otherField.valueLines
          : otherField.valueText
            ? [
                {
                  ...otherField.labelLine,
                  text: otherField.valueText,
                } satisfies TextLine,
              ]
            : [];

        for (const line of otherLines) {
          const verticalDelta = line.normY - field.labelLine.normY;
          if (verticalDelta < -0.01 || verticalDelta > 0.14) {
            continue;
          }

          const horizontalDelta = Math.abs(
            getLineCenterX(line) - getLineCenterX(field.labelLine)
          );
          if (horizontalDelta > 0.22) {
            continue;
          }

          for (const token of extractSheetNumberTokensFromText(line.text)) {
            if (!isSheetNumberValue(token)) {
              continue;
            }

            const normalized = normalizeSheetNumberValue(token);
            const nextScore =
              field.score +
              52 +
              scoreInlineSheetNumberValue(normalized, line.text) +
              getRegionTrustScore(line.normX, line.normY) -
              Math.round(horizontalDelta * 220) -
              Math.round(Math.max(verticalDelta, 0) * 320);

            applyCandidateValue(
              normalized,
              nextScore,
              line.text,
              [line.lineId ?? -1],
              getNormalizedTextLineBox([line])
            );
          }
        }
      }
    }

    for (const [value, candidate] of candidateValues) {
      candidates.push({
        value,
        sourceText: candidate.sourceText,
        lineIndexes: candidate.lineIndexes,
        bounds: candidate.bounds,
        score: candidate.score,
      });
    }
  }

  if (candidates.length === 0) {
    const rescueField =
      fields
        .filter((field) => field.labelKind === "sheet_number")
        .sort((left, right) => right.score - left.score)[0] ?? null;
    candidates.push(...buildMetadataStampGlobalNumberRescueCandidates(page, rescueField));
  }

  if (candidates.length === 0) {
    candidates.push(...buildMetadataStampOcrNumberBoxCandidates(page));
  }

  candidates.push(...buildLargeTextStampNumberCandidates(page));

  return candidates
    .sort((left, right) => right.score - left.score)
    .filter((candidate, index, array) => {
      return (
        array.findIndex(
          (entry) =>
            normalizeSheetNumberValue(entry.value) === normalizeSheetNumberValue(candidate.value)
        ) === index
      );
    });
}

function isEligibleStructuredTitleField(field: MetadataStampField) {
  return field.labelKind === "title" && isUsableStructuredTitleValue(field.valueText);
}

function isUsableStructuredTitleValue(title: string) {
  const normalized = normalizeLabeledTitleValue(title);
  if (!normalized) {
    return false;
  }
  if (normalized.length < 3 || normalized.length > 160) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized)) {
    return false;
  }
  if (
    matchesAdministrativeTitleMetadata(normalized) ||
    matchesReviewReferenceMetadata(normalized) ||
    matchesProjectBrandingVocabulary(normalized)
  ) {
    return false;
  }

  const fieldKind = classifyMetadataFieldKind(normalized);
  if (
    fieldKind &&
    fieldKind !== "title" &&
    !(
      fieldKind === "floor_level" &&
      (
        isLikelySheetTitle(normalized) ||
        hasCompactTechnicalTitleSignal(normalized) ||
        countTitleVocabularyHits(normalized) > 0
      )
    )
  ) {
    return false;
  }

  const extractedNumber = extractSheetNumberFromText(normalized);
  if (extractedNumber && isSheetNumberValue(extractedNumber)) {
    return false;
  }

  return true;
}

function shouldTrustStructuredTitleField(field: MetadataStampField, title: string) {
  return field.labelKind === "title" && isUsableStructuredTitleValue(title);
}

function detectRepeatedVendorBrand(page: PageExtractionModel) {
  const sourceLines = page.searchLines ?? page.lines;
  const companySignal = sourceLines.some((line) => /^\s*company\b/i.test(normalizeWhitespace(line.text)));
  const counts = new Map<string, number>();

  for (const line of sourceLines) {
    const normalized = normalizeWhitespace(line.text);
    if (!normalized) {
      continue;
    }

    const matches = normalized.match(/\b[A-Z][A-Za-z]+(?:-[A-Z][A-Za-z]+)+\b/g) ?? [];
    for (const match of matches) {
      const token = match.toUpperCase();
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((left, right) => right[1] - left[1]);
  const brand = ranked[0]?.[0] ?? null;

  if (!brand) {
    return null;
  }

  if (!companySignal && ranked[0]![1] < 4) {
    return null;
  }

  return brand;
}

function buildStructuredVendorTitleFallback(
  page: PageExtractionModel,
  parse: MetadataStampParse
) {
  const hasDrawingNumberLabel = parse.fields.some(
    (field) =>
      field.labelKind === "sheet_number" &&
      /drawing\s*no/i.test(normalizeWhitespace(field.labelText))
  );
  if (!hasDrawingNumberLabel) {
    return null;
  }

  const brand = detectRepeatedVendorBrand(page);
  if (!brand) {
    return null;
  }

  return {
    value: `${brand} VENDOR DRAWINGS`,
    sourceText: brand,
    lineIndexes: [],
    bounds: parse.bounds,
    score: 260,
  } satisfies MetadataStampValueCandidate;
}

function buildMetadataStampTitleCandidates(
  fields: MetadataStampField[],
  pageNumber: number,
  sourceKind: "pdf_text" | "ocr",
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null
) {
  const candidates: MetadataStampValueCandidate[] = [];

  for (const field of fields.filter(isEligibleStructuredTitleField)) {
    const normalizedParts: string[] = [];
    for (const line of field.valueLines) {
      const rawLine = normalizeWhitespace(line.text);
      let normalizedPart = normalizeLabeledTitleValue(rawLine);
      if (
        !normalizedPart &&
        /^[A-Z]$/i.test(rawLine) &&
        /\bPART\s*$/i.test(normalizedParts[normalizedParts.length - 1] ?? "")
      ) {
        normalizedPart = rawLine.toUpperCase();
      }
      if (normalizedPart) {
        normalizedParts.push(normalizedPart);
      }
    }
    if (normalizedParts.length === 0 && field.valueText) {
      normalizedParts.push(field.valueText);
    }

    const maxParts =
      field.labelKind === "title" ? Math.min(normalizedParts.length, 4) : 1;
    for (let end = 1; end <= maxParts; end += 1) {
      const parts = normalizedParts.slice(0, end);
      const title = mergeOcrTitleSelectionParts(parts);
      const trustStructuredTitle = shouldTrustStructuredTitleField(field, title);
      if (!title || !trustStructuredTitle) {
        continue;
      }
      const sourceText = field.valueLines
        .slice(0, end)
        .map((line) => normalizeWhitespace(line.text))
        .filter(Boolean)
        .join("\n");
      const evaluation = evaluateTitleSelection({
        title,
        sourceKind,
        sourceText,
        pageNumber,
        documentTitleStyleProfile,
      });
      const evaluatedTitle =
        evaluation?.text && shouldPreserveLongerStructuredTitleValue(title, evaluation.text)
          ? title
          : (evaluation?.text ?? title);
      const evaluatedScore = evaluation?.score ?? 0;
      if (
        !evaluatedTitle ||
        (!trustStructuredTitle && isSuspiciousDetectedTitle(evaluatedTitle))
      ) {
        continue;
      }

      candidates.push({
        value: evaluatedTitle,
        sourceText,
        lineIndexes: field.valueLines.slice(0, end).map((line) => line.lineId ?? -1),
        bounds: getNormalizedTextLineBox(field.valueLines.slice(0, end)),
        score:
          field.score +
          Math.max(evaluatedScore, 0) +
          (field.labelKind === "title" ? 88 : 26) +
          Math.max(end - 1, 0) * 18 +
          (end > 1 &&
          isStructuredMetadataTitleContinuation(parts[parts.length - 1] ?? "", parts[0] ?? "")
            ? 14
            : 0) +
          countTitleVocabularyHits(evaluatedTitle) * 12 +
          getCanonicalTitleBoost(evaluatedTitle),
      });
    }
  }

  if (candidates.length === 0) {
    for (const field of fields.filter(isEligibleStructuredTitleField)) {
      const rawTitle = normalizeLabeledTitleValue(field.valueText);
      if (!rawTitle || !shouldTrustStructuredTitleField(field, rawTitle)) {
        continue;
      }

      candidates.push({
        value: rawTitle,
        sourceText: field.sourceText,
        lineIndexes: [
          field.labelLine.lineId ?? -1,
          ...field.valueLines.map((line) => line.lineId ?? -1),
        ],
        bounds: field.bounds,
        score:
          field.score +
          (field.labelKind === "title" ? 96 : 34) +
          countTitleVocabularyHits(rawTitle) * 12 +
          getCanonicalTitleBoost(rawTitle),
      });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function titleCandidateContainsPrefix(
  candidate: MetadataStampValueCandidate,
  prefixCandidate: MetadataStampValueCandidate
) {
  const candidateKey = normalizeComparableSheetTitleText(candidate.value);
  const prefixKey = normalizeComparableSheetTitleText(prefixCandidate.value);
  return Boolean(
    candidateKey &&
      prefixKey &&
      candidateKey !== prefixKey &&
      candidateKey.startsWith(prefixKey)
  );
}

function shouldPreserveLongerStructuredTitleValue(rawTitle: string, evaluatedTitle: string) {
  const rawComparable = normalizeComparableSheetTitleText(rawTitle);
  const evaluatedComparable = normalizeComparableSheetTitleText(evaluatedTitle);
  if (
    !rawComparable ||
    !evaluatedComparable ||
    rawComparable === evaluatedComparable ||
    !rawComparable.startsWith(evaluatedComparable)
  ) {
    return false;
  }

  if (getTextualTitleRejectPenalty(rawTitle) <= -120) {
    return false;
  }

  return (
    /\bPART\s+[A-Z]$/i.test(rawTitle) ||
    /\bSHEET\s+\d{1,3}\s+OF\s+\d{1,3}$/i.test(rawTitle) ||
    /\bFOR\s+REFERENCE\b/i.test(rawTitle) ||
    (
      countTitleVocabularyHits(rawTitle) > countTitleVocabularyHits(evaluatedTitle) &&
      rawTitle.length >= evaluatedTitle.length + 6
    )
  );
}

function looksLikeIncompleteStructuredTitleCandidate(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return true;
  }

  return (
    /(?:,|[-/:]|\b(?:AND|OR|WITH|FOR|OF|TO|LEVEL|FLOOR|FIRST|SECOND|THIRD|FOURTH|PART|SHEET|PLAN|PLANS|DETAIL|DETAILS|GENERAL|MECHANICAL|ELECTRICAL|PLUMBING|FIRE|BUILDING))\s*$/i.test(
      normalized
    ) ||
    countWords(normalized) <= 2
  );
}

function chooseStructuredMetadataTitleCandidate(
  candidates: MetadataStampValueCandidate[]
) {
  const best = candidates[0] ?? null;
  if (!best) {
    return null;
  }

  return (
    candidates.find((candidate) => {
      if (candidate === best || candidate.score < best.score - 120) {
        return false;
      }
      if (!titleCandidateContainsPrefix(candidate, best)) {
        return false;
      }
      const candidateContinuationHits = (
        candidate.value.match(
          /\b(?:ABBREVIATIONS?|DETAILS?|DIAGRAMS?|ELEVATIONS?|PLANS?|NOTES?|SCHEDULES?|SYMBOLS?|PART|LEVEL|FLOOR|BUILDING|BLDG)\b/gi
        ) ?? []
      ).length;
      const bestContinuationHits = (
        best.value.match(
          /\b(?:ABBREVIATIONS?|DETAILS?|DIAGRAMS?|ELEVATIONS?|PLANS?|NOTES?|SCHEDULES?|SYMBOLS?|PART|LEVEL|FLOOR|BUILDING|BLDG)\b/gi
        ) ?? []
      ).length;
      return (
        looksLikeIncompleteStructuredTitleCandidate(best.value) ||
        candidateContinuationHits > bestContinuationHits ||
        countTitleVocabularyHits(candidate.value) > countTitleVocabularyHits(best.value)
      );
    }) ?? best
  );
}

function isStructuredFieldPairCandidate(candidate: PairedSheetCandidate) {
  return Boolean(
    candidate.numberReasonCodes?.includes("structured_field_parse") &&
      candidate.titleReasonCodes?.includes("structured_field_parse")
  );
}

function isFullerSameNumberTitleCandidate(
  candidate: PairedSheetCandidate,
  shorterCandidate: PairedSheetCandidate
) {
  if (
    normalizeSheetNumberValue(candidate.sheetNumber) !==
    normalizeSheetNumberValue(shorterCandidate.sheetNumber)
  ) {
    return false;
  }

  const candidateTitle = normalizeComparableSheetTitleText(candidate.sheetTitle);
  const shorterTitle = normalizeComparableSheetTitleText(shorterCandidate.sheetTitle);
  if (
    !candidateTitle ||
    !shorterTitle ||
    candidateTitle === shorterTitle ||
    !candidateTitle.startsWith(shorterTitle)
  ) {
    return false;
  }

  const candidateWordCount = countWords(candidate.sheetTitle);
  const shorterWordCount = countWords(shorterCandidate.sheetTitle);
  if (
    candidate.sheetTitle.length < shorterCandidate.sheetTitle.length + 8 ||
    candidateWordCount < shorterWordCount + 2
  ) {
    return false;
  }

  if (getTextualTitleRejectPenalty(candidate.sheetTitle) <= -120) {
    return false;
  }

  const candidateLooksLocal =
    candidate.titleCandidateTypeGuess === "drawing_title" &&
    (
      candidate.titleReasonCodes?.includes("multiline_title") ||
      candidate.titleReasonCodes?.includes("near_selected_number") ||
      candidate.titleSourceText.includes("\n")
    );
  if (!candidateLooksLocal) {
    return false;
  }

  const candidateContinuationHits = (
    candidate.sheetTitle.match(
      /\b(?:ABBREVIATIONS?|DETAILS?|DIAGRAMS?|ELEVATIONS?|PLANS?|NOTES?|SCHEDULES?|SYMBOLS?|PART|LEVEL|FLOOR|BUILDING|BLDG)\b/gi
    ) ?? []
  ).length;
  const shorterContinuationHits = (
    shorterCandidate.sheetTitle.match(
      /\b(?:ABBREVIATIONS?|DETAILS?|DIAGRAMS?|ELEVATIONS?|PLANS?|NOTES?|SCHEDULES?|SYMBOLS?|PART|LEVEL|FLOOR|BUILDING|BLDG)\b/gi
    ) ?? []
  ).length;

  return (
    looksLikeIncompleteStructuredTitleCandidate(shorterCandidate.sheetTitle) ||
    candidateContinuationHits >= shorterContinuationHits + 1 ||
    countTitleVocabularyHits(candidate.sheetTitle) > countTitleVocabularyHits(shorterCandidate.sheetTitle)
  );
}

function hasNoisySelectedTitlePrefix(prefix: string) {
  const normalized = normalizeWhitespace(prefix);
  if (!normalized) {
    return false;
  }

  return (
    /\b\d{1,2}\s*[-/−]\s*\d{1,2}\s*[-/−]\s*\d{2,4}\b/.test(normalized) ||
    /\b(?:B\.?\s*O\.?|T\.?\s*O\.?|BOTTOM\s+OF|TOP\s+OF|DEPRESS(?:ION|ED)?|ELEV(?:ATION)?|AFF|ABOVE|BELOW)\b[\s\S]*\d+(?:\s+\d+\/\d+)?\s*(?:"|'|IN\.?|FT\.?)/i.test(normalized) ||
    /\b(?:BID\s+PACKAGE|FINAL\s+DEVELOPMENT|F\.?\s*F\.?\s*E\.?|PRE\s*-\s*ENGINEERED|PROTECT(?:ED)?|REMAIN|SAW\s+CUT|CONTRACTOR|UTILITY\s+COMPANY|BLACK\s+AND\s+WHITE\s+PRINTING|TO\s+FLOOR)\b/i.test(
      normalized
    ) ||
    /^PLAN\s*-\s*NORTH(?:\s+TRUE)?\b/i.test(normalized)
  );
}

function isStrongCleanTitleSuffix(value: string) {
  const normalized = normalizeWhitespace(value);
  const wordCount = countWords(normalized);
  if (!normalized || wordCount < 2 || wordCount > 9) {
    return false;
  }
  if (/^(?:#\s*)?\d+\b/i.test(normalized) || /^NOTES?\b/i.test(normalized)) {
    return false;
  }
  if (getTextualTitleRejectPenalty(normalized) <= -120) {
    return false;
  }
  if (hasNoisySelectedTitlePrefix(normalized)) {
    return false;
  }
  return (
    countTitleVocabularyHits(normalized) >= 1 ||
    /\b(?:CASEWORK|FURNITURE|GROUNDING|LIGHTING|DIMENSION|DEMOLITION|SITE|SURVEY)\b/i.test(
      normalized
    )
  );
}

function scoreCleanTitleSuffix(value: string) {
  const normalized = normalizeWhitespace(value);
  const vocabularyHits = countTitleVocabularyHits(normalized);
  const domainHits = (
    normalized.match(
      /\b(?:ARCH(?:ITECTURAL)?|BUILDING|CASEWORK|CEILING|DEMOLITION|DEMO|ELECTRICAL|EXTERIOR|FIRE|FURNITURE|GROUNDING|INTERIOR|LIGHTING|MECHANICAL|PLUMBING|SITE|STRUCTURAL|SURVEY)\b/gi
    ) ?? []
  ).length;
  return vocabularyHits * 20 + domainHits * 8 - Math.max(countWords(normalized) - 5, 0) * 2;
}

function stripNoisySelectedTitlePrefix(title: string) {
  const normalized = normalizeWhitespace(title);
  if (!normalized || countWords(normalized) < 3) {
    return null;
  }

  const matches = [...normalized.matchAll(/\S+/g)];
  const suffixes = matches
    .slice(1)
    .map((match) => {
      const prefix = normalizeWhitespace(normalized.slice(0, match.index));
      const suffix = normalizeWhitespace(normalized.slice(match.index));
      return { prefix, suffix };
    })
    .filter(({ prefix, suffix }) => {
      if (!hasNoisySelectedTitlePrefix(prefix)) {
        return false;
      }
      return isStrongCleanTitleSuffix(suffix);
    })
    .sort((left, right) => {
      const leftScore = scoreCleanTitleSuffix(left.suffix);
      const rightScore = scoreCleanTitleSuffix(right.suffix);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return countWords(left.suffix) - countWords(right.suffix);
    });

  const best = suffixes[0]?.suffix ?? null;
  if (!best || best === normalized) {
    return null;
  }
  return best;
}

function hasContaminatedStructuredTitleSignal(title: string) {
  const normalized = normalizeWhitespace(title);
  if (!normalized) {
    return false;
  }

  if (stripNoisySelectedTitlePrefix(normalized)) {
    return true;
  }

  const comparable = normalizeComparableSheetTitleText(normalized);
  if (
    /\bSHEET\s+\d+\b.*\bSHEET\s+\d+\b/i.test(normalized) ||
    /\b([A-Z]{4,}|MECHANICAL|ELECTRICAL|PLUMBING|CEILING)\s+(?:PLAN|DETAILS?|GENERAL)\s+\1\b/i.test(
      comparable
    )
  ) {
    return true;
  }

  return (
    countWords(normalized) >= 5 &&
    countTitleVocabularyHits(normalized) >= 2 &&
    /^(?:[A-Z]+(?:\s+[A-Z]+)?\s+)?(?:DETAILS?|PLANS?)\s+[A-Z]+/i.test(normalized)
  );
}

function isCleanerSameNumberTitleCandidate(
  candidate: PairedSheetCandidate,
  contaminatedCandidate: PairedSheetCandidate
) {
  if (
    normalizeSheetNumberValue(candidate.sheetNumber) !==
    normalizeSheetNumberValue(contaminatedCandidate.sheetNumber)
  ) {
    return false;
  }
  if (isStructuredFieldPairCandidate(candidate)) {
    return false;
  }

  const title = normalizeWhitespace(candidate.sheetTitle);
  if (!isStrongCleanTitleSuffix(title)) {
    return false;
  }
  if (hasContaminatedStructuredTitleSignal(title)) {
    return false;
  }

  const looksLocal =
    candidate.titleCandidateTypeGuess === "drawing_title" &&
    (
      candidate.titleReasonCodes?.includes("near_selected_number") ||
      candidate.titleReasonCodes?.includes("multiline_title") ||
      candidate.familyId === "bottom_right_strip"
    );
  if (!looksLocal) {
    return false;
  }

  const contaminatedWords = countWords(contaminatedCandidate.sheetTitle);
  const candidateWords = countWords(candidate.sheetTitle);
  return (
    candidateWords <= Math.max(9, contaminatedWords) &&
    (
      normalizeComparableSheetTitleText(contaminatedCandidate.sheetTitle).includes(
        normalizeComparableSheetTitleText(candidate.sheetTitle)
      ) ||
      countTitleVocabularyHits(candidate.sheetTitle) >=
        Math.max(1, countTitleVocabularyHits(contaminatedCandidate.sheetTitle) - 1) ||
      candidate.titleReasonCodes?.includes("multiline_title")
    )
  );
}

function isCleanAlternativeToProjectLabelTitle(candidate: PairedSheetCandidate) {
  const title = normalizeWhitespace(candidate.sheetTitle);
  if (!title || looksLikeGenericProjectOrPackageSheetLabel(title)) {
    return false;
  }
  if (getTextualTitleRejectPenalty(title) <= -120) {
    return false;
  }
  return (
    isStrongCleanTitleSuffix(title) ||
    isAllowedSingleWordTitle(title) ||
    countTitleVocabularyHits(title) >= 1 ||
    hasCompactTechnicalTitleSignal(title)
  );
}

function buildMetadataStampParse(
  page: PageExtractionModel,
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null
) {
  const searchPage = buildMetadataStampSearchPage(page);
  if (!searchPage?.page || !searchPage.bounds) {
    return null;
  }

  const fields = mergeMetadataStampFieldSets(
    buildMetadataStampFields(searchPage.page),
    buildSupplementalMetadataStampFields(page)
  );
  if (fields.length === 0) {
    return null;
  }

  const titleCandidates = buildMetadataStampTitleCandidates(
    fields,
    page.pageNumber,
    page.ocrBacked ? "ocr" : "pdf_text",
    documentTitleStyleProfile
  );
  const numberCandidates = buildMetadataStampNumberCandidates(
    fields,
    searchPage.page.lines,
    searchPage.page
  );
  const titleField =
    fields
      .filter((field) => field.labelKind === "title")
      .sort((left, right) => right.score - left.score)[0] ?? null;
  const numberField =
    fields
      .filter((field) => field.labelKind === "sheet_number")
      .sort((left, right) => right.score - left.score)[0] ?? null;

  if (!titleField && !numberField) {
    return null;
  }

  return {
    bounds: searchPage.bounds,
    sourceKind: page.ocrBacked ? "ocr" : "pdf_text",
    searchPage: searchPage.page,
    fields,
    titleField,
    numberField,
    titleCandidates,
    numberCandidates,
    confidence:
      (titleField ? 0.45 : 0) +
      (numberField ? 0.45 : 0) +
      (titleCandidates.length > 0 ? 0.05 : 0) +
      (numberCandidates.length > 0 ? 0.05 : 0),
  } satisfies MetadataStampParse;
}

function getMetadataStampPairRegions(parse: MetadataStampParse) {
  const horizontalCenter = parse.bounds.x + parse.bounds.width / 2;
  const verticalCenter = parse.bounds.y + parse.bounds.height / 2;
  const styleProfile =
    horizontalCenter <= 0.45 ? "bottom_left_block" : "bottom_right_block";
  const titleRegion: MetadataRegionId =
    verticalCenter <= 0.86 ? "titleTall" : "titleBlock";
  const numberRegion: MetadataRegionId =
    (parse.numberField?.labelLine.normY ?? parse.bounds.y + parse.bounds.height) >= 0.89
      ? "sheetStamp"
      : "numberBlock";

  return {
    styleProfile,
    titleRegion,
    numberRegion,
  } satisfies {
    styleProfile: Exclude<MetadataStyleProfile, "mixed">;
    titleRegion: MetadataRegionId;
    numberRegion: MetadataRegionId;
  };
}

function buildStructuredMetadataStampPairCandidate(args: {
  page: PageExtractionModel;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const parse = buildMetadataStampParse(args.page, args.documentTitleStyleProfile);
  if (!parse) {
    return null;
  }

  const fallbackTitle =
    parse.titleField?.valueText &&
    shouldTrustStructuredTitleField(parse.titleField, parse.titleField.valueText)
      ? ({
          value: normalizeLabeledTitleValue(parse.titleField.valueText),
          sourceText: parse.titleField.sourceText,
          lineIndexes: [
            parse.titleField.labelLine.lineId ?? -1,
            ...parse.titleField.valueLines.map((line) => line.lineId ?? -1),
          ],
          bounds: parse.titleField.bounds,
          score:
            parse.titleField.score +
            96 +
            countTitleVocabularyHits(parse.titleField.valueText) * 12 +
            getCanonicalTitleBoost(parse.titleField.valueText),
        } satisfies MetadataStampValueCandidate)
      : null;
  const vendorFallbackTitle =
    !fallbackTitle && parse.titleCandidates.length === 0
      ? buildStructuredVendorTitleFallback(args.page, parse)
      : null;
  const fallbackNumber =
    parse.numberField?.valueText &&
    (() => {
      const token = extractStructuredSheetNumberValue(parse.numberField);
      if (!token) {
        return null;
      }
      return {
        value: normalizeSheetNumberValue(token),
        sourceText: parse.numberField.sourceText,
        lineIndexes: [
          parse.numberField.labelLine.lineId ?? -1,
          ...parse.numberField.valueLines.map((line) => line.lineId ?? -1),
        ],
        bounds: parse.numberField.bounds,
        score:
          parse.numberField.score +
          80 +
          scoreInlineSheetNumberValue(token, parse.numberField.valueText),
      } satisfies MetadataStampValueCandidate;
    })();

  const bestTitle =
    chooseStructuredMetadataTitleCandidate(parse.titleCandidates) ??
    fallbackTitle ??
    vendorFallbackTitle ??
    null;
  const bestNumber = parse.numberCandidates[0] ?? fallbackNumber ?? null;
  if (
    !bestTitle ||
    !bestNumber ||
    !isStructuredCompactSheetNumberValue(bestNumber.value, parse.numberField?.labelText ?? null)
  ) {
    return null;
  }
  const trustStructuredTitle =
    parse.titleField != null &&
    shouldTrustStructuredTitleField(parse.titleField, bestTitle.value);

  if (
    isRepeatedProjectLikeTitle(
      bestTitle.value,
      args.repeatedLineCounts,
      args.totalPages
    ) ||
    (!trustStructuredTitle &&
      bestTitle !== vendorFallbackTitle &&
      isSuspiciousDetectedTitle(bestTitle.value))
  ) {
    return null;
  }

  const regions = getMetadataStampPairRegions(parse);
  const numberLineText = bestNumber.sourceText || bestNumber.value;
  const titleLineText =
    parse.titleField?.valueLines.map((line) => normalizeWhitespace(line.text)).filter(Boolean).join("\n") ??
    parse.titleField?.valueText ??
    bestTitle.sourceText;
  const scoreTrace = new ScoreTrace()
    .add("structured_stamp_base", 420)
    .add("sheet_number_candidate_score", bestNumber.score)
    .add("sheet_title_candidate_score", bestTitle.score)
    .add("structured_title_field_present", parse.titleField ? 180 : 0)
    .add("structured_number_field_present", parse.numberField ? 180 : 0)
    .add("structured_parse_confidence", Math.round(parse.confidence * 100));
  const pairScore = scoreTrace.total();

  return {
    sheetNumber: bestNumber.value,
    sheetTitle: bestTitle.value,
    numberSourceText: numberLineText,
    titleSourceText: titleLineText,
    numberLineIndex: null,
    titleLineIndex: null,
    numberRegion: regions.numberRegion,
    titleRegion: regions.titleRegion,
    pairedCluster: buildPairedClusterId(regions.titleRegion, null, null),
    styleProfile: regions.styleProfile,
    familyId: regions.styleProfile,
    localClusterBbox: parse.bounds,
    sourceAgreement: true,
    rejectReason: null,
    numberCandidateTypeGuess: "sheet_number",
    titleCandidateTypeGuess: "drawing_title",
    numberReasonCodes: ["structured_field_parse", "labeled_field"],
    titleReasonCodes: ["structured_field_parse", "labeled_field"],
    numberScore: bestNumber.score,
    titleScore: bestTitle.score,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(clamp(parse.confidence, 0, 1).toFixed(2)),
  } satisfies PairedSheetCandidate;
}

function buildStructuredMetadataStampParseDebug(
  page: PageExtractionModel,
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null
) {
  const parse = buildMetadataStampParse(page, documentTitleStyleProfile);
  if (!parse) {
    return null;
  }

  return {
    sourceKind: parse.sourceKind,
    bounds: parse.bounds,
    confidence: Number(parse.confidence.toFixed(2)),
    titleField:
      parse.titleField
        ? {
            labelText: parse.titleField.labelText,
            valueText: parse.titleField.valueText,
            score: Number(parse.titleField.score.toFixed(1)),
          }
        : null,
    numberField:
      parse.numberField
        ? {
            labelText: parse.numberField.labelText,
            valueText: parse.numberField.valueText,
            score: Number(parse.numberField.score.toFixed(1)),
          }
        : null,
    fields: parse.fields.map((field) => ({
      labelKind: field.labelKind,
      labelText: field.labelText,
      valueText: field.valueText,
      score: Number(field.score.toFixed(1)),
    })),
    titleCandidates: parse.titleCandidates.slice(0, 4).map((candidate) => ({
      value: candidate.value,
      score: Number(candidate.score.toFixed(1)),
      sourceText: candidate.sourceText,
    })),
    numberCandidates: parse.numberCandidates.slice(0, 4).map((candidate) => ({
      value: candidate.value,
      score: Number(candidate.score.toFixed(1)),
      sourceText: candidate.sourceText,
    })),
  };
}

function buildTextLinesFromPositionedItems(sourceItems: PositionedTextItem[]) {
  const items = sourceItems
    .filter((item) => Boolean(item.text))
    .sort((a, b) => {
      if (Math.abs(a.top - b.top) > 4) {
        return a.top - b.top;
      }

      return a.x - b.x;
    });

  const lines: TextLine[] = [];

  for (const item of items) {
    const lastLine = lines[lines.length - 1];
    const tolerance = Math.max(item.height * 0.7, 8);
    const lastLineRight = lastLine ? lastLine.x + lastLine.width : 0;
    const horizontalGap = lastLine ? item.x - lastLineRight : 0;
    const itemFontSize = getItemFontSizeSignal(item);
    const lastLineFontSize = lastLine ? getLineFontSizeSignal(lastLine) : itemFontSize;
    const fontSizeRatio =
      lastLine && itemFontSize > 0 && lastLineFontSize > 0
        ? Math.max(itemFontSize, lastLineFontSize) /
          Math.max(Math.min(itemFontSize, lastLineFontSize), 0.0001)
        : 1;
    const sameRowCluster =
      !lastLine ||
      (
        horizontalGap <= Math.max(Math.min(item.height * 2.4, 42), 18) &&
        fontSizeRatio <= 1.42
      );

    if (
      !lastLine ||
      Math.abs(item.top - lastLine.top) > tolerance ||
      !sameRowCluster
    ) {
      lines.push({
        text: item.text,
        items: [item],
        x: item.x,
        top: item.top,
        width: item.width,
        height: item.height,
        normX: item.normX,
        normY: item.normY,
        normWidth: item.normWidth,
        normHeight: item.normHeight,
        blockId: item.blockId ?? null,
        lineId: item.lineId ?? null,
        fontSize: item.fontSize ?? item.height,
        fontSizeMin: item.fontSize ?? item.height,
        fontSizeMax: item.fontSize ?? item.height,
        isBold: Boolean(item.isBold),
      });
      continue;
    }

    lastLine.items.push(item);
    lastLine.x = Math.min(lastLine.x, item.x);
    lastLine.top = Math.min(lastLine.top, item.top);
    lastLine.width = Math.max(lastLine.width, item.x + item.width - lastLine.x);
    lastLine.height = Math.max(lastLine.height, item.height);
    lastLine.normX = Math.min(lastLine.normX, item.normX);
    lastLine.normY = Math.min(lastLine.normY, item.normY);
    lastLine.normWidth = Math.max(lastLine.normWidth, item.normX + item.normWidth - lastLine.normX);
    lastLine.normHeight = Math.max(lastLine.normHeight, item.normHeight);
    lastLine.fontSizeMin = Math.min(
      lastLine.fontSizeMin ?? getLineFontSizeSignal(lastLine),
      item.fontSize ?? item.height
    );
    lastLine.fontSizeMax = Math.max(
      lastLine.fontSizeMax ?? getLineFontSizeSignal(lastLine),
      item.fontSize ?? item.height
    );
    lastLine.fontSize =
      ((lastLine.fontSize ?? getLineFontSizeSignal(lastLine)) * (lastLine.items.length - 1) +
        (item.fontSize ?? item.height)) /
      Math.max(lastLine.items.length, 1);
    lastLine.isBold = Boolean(lastLine.isBold || item.isBold);
  }

    return lines
    .map((line) => {
      const sortedItems = [...line.items].sort((a, b) => a.x - b.x);
      const blockCounts = new Map<number, number>();
      for (const item of sortedItems) {
        if (!Number.isFinite(item.blockId ?? NaN)) continue;
        const key = item.blockId as number;
        blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
      }
      const dominantBlockId =
        [...blockCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      const text = normalizeWhitespace(sortedItems.map((item) => item.text).join(" "));
      const left = Math.min(...sortedItems.map((item) => item.normX));
      const top = Math.min(...sortedItems.map((item) => item.normY));
      const right = Math.max(
        ...sortedItems.map((item) => item.normX + item.normWidth)
      );
      const bottom = Math.max(
        ...sortedItems.map((item) => item.normY + item.normHeight)
      );
      const fontSizes = sortedItems
        .map((item) => getItemFontSizeSignal(item))
        .filter((value) => Number.isFinite(value) && value > 0);
      const medianFontSize = median(fontSizes);

      return {
        ...line,
        text,
        items: sortedItems,
        normX: left,
        normY: top,
        normWidth: Math.max(right - left, 0),
        normHeight: Math.max(bottom - top, 0),
        blockId: dominantBlockId,
        lineId: sortedItems[0]?.lineId ?? null,
        fontSize: medianFontSize || line.fontSize || line.height,
        fontSizeMin: fontSizes.length ? Math.min(...fontSizes) : line.fontSizeMin ?? line.height,
        fontSizeMax: fontSizes.length ? Math.max(...fontSizes) : line.fontSizeMax ?? line.height,
        isBold: sortedItems.filter((item) => item.isBold).length >= Math.ceil(sortedItems.length / 2),
      };
    })
    .filter((line) => Boolean(line.text));
}

function buildTextLineFromOrderedPositionedItems(
  orderedItems: PositionedTextItem[],
  geometryItems = orderedItems
) {
  const text = normalizeWhitespace(orderedItems.map((item) => item.text).join(" "));
  if (!text || geometryItems.length === 0) {
    return null;
  }

  const left = Math.min(...geometryItems.map((item) => item.normX));
  const top = Math.min(...geometryItems.map((item) => item.normY));
  const right = Math.max(
    ...geometryItems.map((item) => item.normX + item.normWidth)
  );
  const bottom = Math.max(
    ...geometryItems.map((item) => item.normY + item.normHeight)
  );
  const x = Math.min(...geometryItems.map((item) => item.x));
  const y = Math.min(...geometryItems.map((item) => item.top));
  const rawRight = Math.max(...geometryItems.map((item) => item.x + item.width));
  const rawBottom = Math.max(...geometryItems.map((item) => item.top + item.height));
  const fontSizes = geometryItems
    .map((item) => getItemFontSizeSignal(item))
    .filter((value) => Number.isFinite(value) && value > 0);
  const medianFontSize = median(fontSizes);
  const blockCounts = new Map<number, number>();
  for (const item of geometryItems) {
    if (!Number.isFinite(item.blockId ?? NaN)) continue;
    const key = item.blockId as number;
    blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
  }
  const dominantBlockId =
    [...blockCounts.entries()].sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])[0]?.[0] ??
    null;

  return {
    text,
    items: [...geometryItems],
    x,
    top: y,
    width: Math.max(rawRight - x, 0),
    height: Math.max(rawBottom - y, 0),
    normX: left,
    normY: top,
    normWidth: Math.max(right - left, 0),
    normHeight: Math.max(bottom - top, 0),
    blockId: dominantBlockId,
    lineId: geometryItems[0]?.lineId ?? null,
    fontSize: medianFontSize || geometryItems[0]?.fontSize || geometryItems[0]?.height,
    fontSizeMin: fontSizes.length ? Math.min(...fontSizes) : geometryItems[0]?.fontSize ?? geometryItems[0]?.height,
    fontSizeMax: fontSizes.length ? Math.max(...fontSizes) : geometryItems[0]?.fontSize ?? geometryItems[0]?.height,
    isBold: geometryItems.filter((item) => item.isBold).length >= Math.ceil(geometryItems.length / 2),
  } satisfies TextLine;
}

function buildRotatedMetadataBlockOrderTextLines(sourceItems: PositionedTextItem[]) {
  const grouped = new Map<string, PositionedTextItem[]>();
  for (const item of sourceItems) {
    if (!Number.isFinite(item.blockId ?? NaN) || !Number.isFinite(item.lineId ?? NaN)) {
      continue;
    }
    const key = `${item.blockId}:${item.lineId}`;
    const group = grouped.get(key) ?? [];
    group.push(item);
    grouped.set(key, group);
  }

  const lines: TextLine[] = [];
  for (const items of grouped.values()) {
    if (items.length < 2) {
      continue;
    }

    const left = Math.min(...items.map((item) => item.normX));
    const right = Math.max(...items.map((item) => item.normX + item.normWidth));
    const top = Math.min(...items.map((item) => item.normY));
    const bottom = Math.max(...items.map((item) => item.normY + item.normHeight));
    const width = right - left;
    const height = bottom - top;
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const maxItemHeight = Math.max(...items.map((item) => item.normHeight));
    const maxItemWidth = Math.max(...items.map((item) => item.normWidth));
    const compactRightEdgeVerticalWordStack =
      items.length >= 3 &&
      width <= Math.max(maxItemWidth * 1.35, 0.024) &&
      height >= 0.12;
    const verticalRun =
      height >= Math.max(maxItemHeight * 2.2, 0.055) &&
      height >= Math.max(width * 1.4, maxItemWidth * 2);
    const rightEdgeMetadata =
      centerX >= 0.86 && right >= 0.91 && centerY >= 0.25 && centerY <= 0.98;
    if ((!verticalRun && !compactRightEdgeVerticalWordStack) || !rightEdgeMetadata) {
      continue;
    }

    const orderedItems = [...items].sort((leftItem, rightItem) => {
      const leftWord = leftItem.wordId;
      const rightWord = rightItem.wordId;
      if (Number.isFinite(leftWord ?? NaN) && Number.isFinite(rightWord ?? NaN)) {
        return (leftWord as number) - (rightWord as number);
      }
      return leftItem.top - rightItem.top;
    });
    const line = buildTextLineFromOrderedPositionedItems(orderedItems, items);
    if (line) {
      lines.push(line);
    }
  }

  return lines;
}

function buildTextLines(rawItems: unknown[], pageWidth: number, pageHeight: number) {
  const items = rawItems
    .map((item) => {
      const text = normalizeWhitespace(String((item as { str?: string }).str ?? ""));
      if (!text) return null;

      const transform = Array.isArray((item as { transform?: number[] }).transform)
        ? ((item as { transform: number[] }).transform ?? [])
        : [];
      const x = Number(transform[4] ?? 0);
      const y = Number(transform[5] ?? 0);
      const rawHeight = Math.abs(
        Number((item as { height?: number }).height ?? transform[3] ?? 0)
      );
      const rawWidth = Math.abs(Number((item as { width?: number }).width ?? 0));
      const height = Math.max(rawHeight || 0, 6);
      const width = Math.max(rawWidth || 0, text.length * Math.max(height * 0.34, 4));
      const top = pageHeight - y;

      return {
        text,
        x,
        top,
        width,
        height,
        normX: pageWidth > 0 ? x / pageWidth : 0,
        normY: pageHeight > 0 ? top / pageHeight : 0,
        normWidth: pageWidth > 0 ? width / pageWidth : 0,
        normHeight: pageHeight > 0 ? height / pageHeight : 0,
      } satisfies PositionedTextItem;
    })
    .filter((item): item is PositionedTextItem => Boolean(item));

  return buildTextLinesFromPositionedItems(items);
}

function renderPdfPageToCanvas(
  pdfPage: PdfPageLike,
  targetLongEdge: number
) {
  const baseViewport = pdfPage.getViewport({ scale: 1 });
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  const scale = longEdge > 0 ? targetLongEdge / longEdge : 1;
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height))
  );
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  return pdfPage
    .render({
      canvasContext: context as never,
      viewport,
    })
    .promise.then(() => canvas);
}

function detectRasterMetadataDrawingSegments(args: {
  canvas: ReturnType<typeof createCanvas>;
  pageWidth: number;
  pageHeight: number;
  ocrLines: TextLine[];
}) {
  const context = args.canvas.getContext("2d");
  const width = args.canvas.width;
  const height = args.canvas.height;
  if (width < 32 || height < 32) {
    return [] as PageDrawingSegment[];
  }

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const isDark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }

    const index = (y * width + x) * 4;
    const alpha = data[index + 3] ?? 0;
    if (alpha < 32) {
      return false;
    }

    const r = data[index] ?? 255;
    const g = data[index + 1] ?? 255;
    const b = data[index + 2] ?? 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance <= 170;
  };
  const hasVerticalStroke = (x: number, y: number) => {
    let darkHits = 0;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (isDark(x + offsetX, y)) {
        darkHits += 1;
      }
    }
    return darkHits >= 2;
  };

  const segments: PageDrawingSegment[] = [];
  const metadataLines = args.ocrLines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return centerX >= 0.72 && centerY >= 0.56 && centerY <= 0.995;
  });
  if (metadataLines.length < 4) {
    return segments;
  }

  const sortedLefts = metadataLines
    .map((line) => getLineLeft(line))
    .sort((left, right) => left - right);
  const anchorLeft =
    sortedLefts[Math.min(Math.floor(sortedLefts.length * 0.2), sortedLefts.length - 1)] ??
    sortedLefts[0];
  const topY = Math.max(
    0.54,
    Math.min(...metadataLines.map((line) => line.normY)) - 0.05
  );
  const bottomY = Math.min(
    0.995,
    Math.max(...metadataLines.map((line) => line.normY + line.normHeight)) + 0.05
  );
  const startX = Math.floor(width * Math.max(0.64, anchorLeft - 0.12));
  const endX = Math.floor(width * Math.min(Math.max(anchorLeft - 0.008, 0.66), 0.92));
  const startY = Math.floor(height * topY);
  const endY = Math.floor(height * bottomY);
  const span = Math.max(endY - startY + 1, 1);
  if (endX <= startX + 2 || endY <= startY + 20) {
    return segments;
  }

  const runs: Array<{ x: number; top: number; bottom: number; darkCount: number; longestRun: number }> = [];
  for (let x = startX; x <= endX; x += 1) {
    let darkCount = 0;
    let top = -1;
    let bottom = -1;
    let currentRun = 0;
    let longestRun = 0;

    for (let y = startY; y <= endY; y += 1) {
      if (!hasVerticalStroke(x, y)) {
        currentRun = 0;
        continue;
      }

      darkCount += 1;
      currentRun += 1;
      longestRun = Math.max(longestRun, currentRun);
      if (top < 0) {
        top = y;
      }
      bottom = y;
    }

    const coverage = darkCount / span;
    const runCoverage = longestRun / span;
    if (
      top >= 0 &&
      bottom > top &&
      coverage >= 0.34 &&
      runCoverage >= 0.22 &&
      bottom - top >= Math.max(Math.floor(span * 0.55), 70)
    ) {
      runs.push({ x, top, bottom, darkCount, longestRun });
    }
  }

  if (runs.length === 0) {
    return segments;
  }

  let groupStart = 0;
  let bestSegment: PageDrawingSegment | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  while (groupStart < runs.length) {
    let groupEnd = groupStart;
    while (
      groupEnd + 1 < runs.length &&
      runs[groupEnd + 1]!.x - runs[groupEnd]!.x <= 2
    ) {
      groupEnd += 1;
    }

    const group = runs.slice(groupStart, groupEnd + 1);
    const groupWidth = (group[group.length - 1]?.x ?? 0) - (group[0]?.x ?? 0) + 1;
    const top = Math.min(...group.map((entry) => entry.top));
    const bottom = Math.max(...group.map((entry) => entry.bottom));
    const centerX = ((group[0]?.x ?? 0) + (group[group.length - 1]?.x ?? 0)) / 2;
    const normCenterX = centerX / width;
    const distanceToAnchor = Math.abs(normCenterX - Math.max(anchorLeft - 0.018, 0));
    const score =
      (bottom - top) * 1.8 -
      groupWidth * 10 -
      distanceToAnchor * width * 0.7 +
      group.reduce((sum, entry) => sum + entry.longestRun, 0) * 0.05;

    if (
      groupWidth <= Math.max(Math.floor(width * 0.012), 10) &&
      score > bestScore
    ) {
      bestScore = score;
      bestSegment = {
        x0: normCenterX * args.pageWidth,
        y0: (top / height) * args.pageHeight,
        x1: normCenterX * args.pageWidth,
        y1: (bottom / height) * args.pageHeight,
        normX0: normCenterX,
        normY0: top / height,
        normX1: normCenterX,
        normY1: bottom / height,
        width: groupWidth,
      };
    }

    groupStart = groupEnd + 1;
  }

  return bestSegment ? [bestSegment] : segments;
}

function detectRasterSheetNumberBox(args: {
  canvas: ReturnType<typeof createCanvas>;
  ocrLines: TextLine[];
}) {
  const width = args.canvas.width;
  const height = args.canvas.height;
  if (width < 32 || height < 32) {
    return null;
  }

  const metadataLines = args.ocrLines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return centerX >= 0.72 && centerX <= 0.995 && centerY >= 0.78 && centerY <= 0.995;
  });
  if (metadataLines.length < 2) {
    return null;
  }

  const labelLine = findOcrSheetNumberLabelLine(metadataLines);
  if (!labelLine) {
    return null;
  }

  const numberLine =
    metadataLines
      .filter((line) => line !== labelLine)
      .filter((line) => {
        const centerY = getLineCenterY(line);
        return centerY > getLineCenterY(labelLine) && centerY - getLineCenterY(labelLine) <= 0.12;
      })
      .sort((left, right) => {
        const fontDelta = (right.fontSize ?? 0) - (left.fontSize ?? 0);
        if (Math.abs(fontDelta) > 0.5) {
          return fontDelta;
        }
        return right.normWidth - left.normWidth;
      })[0] ?? null;
  if (!numberLine) {
    return null;
  }

  const context = args.canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const isDark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }
    const index = (y * width + x) * 4;
    const alpha = data[index + 3] ?? 0;
    if (alpha < 32) {
      return false;
    }
    const r = data[index] ?? 255;
    const g = data[index + 1] ?? 255;
    const b = data[index + 2] ?? 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance <= 165;
  };
  const hasVerticalStroke = (x: number, y: number) => {
    let darkHits = 0;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (isDark(x + offsetX, y)) {
        darkHits += 1;
      }
    }
    return darkHits >= 2;
  };
  const hasHorizontalStroke = (x: number, y: number) => {
    let darkHits = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      if (isDark(x, y + offsetY)) {
        darkHits += 1;
      }
    }
    return darkHits >= 2;
  };

  const expectedLeft = Math.max(0.68, Math.min(getLineLeft(labelLine), getLineLeft(numberLine)) - 0.03);
  const expectedRight = Math.min(
    0.995,
    Math.max(getLineRight(labelLine), getLineRight(numberLine)) + 0.03
  );
  const expectedTop = Math.max(0.74, labelLine.normY - 0.018);
  const expectedBottom = Math.min(
    0.995,
    numberLine.normY + numberLine.normHeight + 0.025
  );
  if (expectedRight - expectedLeft < 0.07 || expectedBottom - expectedTop < 0.05) {
    return null;
  }

  const scanVerticalEdge = (expectedX: number) => {
    const startX = Math.max(0, Math.floor(width * Math.max(expectedX - 0.04, 0)));
    const endX = Math.min(width - 1, Math.ceil(width * Math.min(expectedX + 0.04, 1)));
    const startY = Math.max(0, Math.floor(height * expectedTop));
    const endY = Math.min(height - 1, Math.ceil(height * expectedBottom));
    const span = Math.max(endY - startY + 1, 1);
    let best: { x: number; score: number; coverage: number; runCoverage: number } | null = null;

    for (let x = startX; x <= endX; x += 1) {
      let darkCount = 0;
      let longestRun = 0;
      let currentRun = 0;
      for (let y = startY; y <= endY; y += 1) {
        if (hasVerticalStroke(x, y)) {
          darkCount += 1;
          currentRun += 1;
          longestRun = Math.max(longestRun, currentRun);
        } else {
          currentRun = 0;
        }
      }

      const coverage = darkCount / span;
      const runCoverage = longestRun / span;
      if (coverage < 0.12 || runCoverage < 0.07) {
        continue;
      }

      const normX = x / width;
      const score =
        coverage * 120 +
        runCoverage * 160 -
        Math.abs(normX - expectedX) * 400;
      if (!best || score > best.score) {
        best = { x, score, coverage, runCoverage };
      }
    }

    return best
      ? {
          x: best.x / width,
          score: best.score,
          coverage: best.coverage,
          runCoverage: best.runCoverage,
        }
      : null;
  };

  const scanHorizontalEdge = (expectedY: number) => {
    const startX = Math.max(0, Math.floor(width * expectedLeft));
    const endX = Math.min(width - 1, Math.ceil(width * expectedRight));
    const startY = Math.max(0, Math.floor(height * Math.max(expectedY - 0.03, 0)));
    const endY = Math.min(height - 1, Math.ceil(height * Math.min(expectedY + 0.03, 1)));
    const span = Math.max(endX - startX + 1, 1);
    let best: { y: number; score: number; coverage: number; runCoverage: number } | null = null;

    for (let y = startY; y <= endY; y += 1) {
      let darkCount = 0;
      let longestRun = 0;
      let currentRun = 0;
      for (let x = startX; x <= endX; x += 1) {
        if (hasHorizontalStroke(x, y)) {
          darkCount += 1;
          currentRun += 1;
          longestRun = Math.max(longestRun, currentRun);
        } else {
          currentRun = 0;
        }
      }

      const coverage = darkCount / span;
      const runCoverage = longestRun / span;
      if (coverage < 0.16 || runCoverage < 0.08) {
        continue;
      }

      const normY = y / height;
      const score =
        coverage * 120 +
        runCoverage * 160 -
        Math.abs(normY - expectedY) * 450;
      if (!best || score > best.score) {
        best = { y, score, coverage, runCoverage };
      }
    }

    return best
      ? {
          y: best.y / height,
          score: best.score,
          coverage: best.coverage,
          runCoverage: best.runCoverage,
        }
      : null;
  };

  const left = scanVerticalEdge(expectedLeft);
  const right = scanVerticalEdge(expectedRight);
  const top = scanHorizontalEdge(expectedTop);
  const bottom = scanHorizontalEdge(expectedBottom);

  const confirmedLeft = Boolean(left && (left.coverage >= 0.16 || left.runCoverage >= 0.12));
  const confirmedRight = Boolean(right && (right.coverage >= 0.16 || right.runCoverage >= 0.12));
  const confirmedTop = Boolean(top && (top.coverage >= 0.18 || top.runCoverage >= 0.12));
  const confirmedBottom = Boolean(bottom && (bottom.coverage >= 0.18 || bottom.runCoverage >= 0.12));

  const edgeCount =
    Number(confirmedLeft) +
    Number(confirmedRight) +
    Number(confirmedTop) +
    Number(confirmedBottom);
  const hasVerticalEvidence = confirmedLeft || confirmedRight;
  const hasHorizontalEvidence = confirmedTop || confirmedBottom;

  if (edgeCount < 2 || !hasVerticalEvidence || !hasHorizontalEvidence) {
    return null;
  }

  const resolvedLeft = left?.x ?? expectedLeft;
  const resolvedRight = right?.x ?? expectedRight;
  const resolvedTop = top?.y ?? expectedTop;
  const resolvedBottom = bottom?.y ?? expectedBottom;
  const box = {
    x: resolvedLeft,
    y: resolvedTop,
    width: resolvedRight - resolvedLeft,
    height: resolvedBottom - resolvedTop,
  };
  if (box.width < 0.06 || box.height < 0.045) {
    return null;
  }

  const numberCenterX = getLineCenterX(numberLine);
  const numberCenterY = getLineCenterY(numberLine);
  if (
    numberCenterX < box.x ||
    numberCenterX > box.x + box.width ||
    numberCenterY < box.y ||
    numberCenterY > box.y + box.height
  ) {
    return null;
  }

  return box;
}

function inferOcrLabelAnchoredNumberFieldBounds(lines: TextLine[]) {
  const metadataLines = lines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return centerX >= 0.72 && centerX <= 0.995 && centerY >= 0.78 && centerY <= 0.995;
  });
  if (metadataLines.length < 2) {
    return null;
  }

  const labelLine = findOcrSheetNumberLabelLine(metadataLines);
  if (!labelLine) {
    return null;
  }

  const numberLine =
    metadataLines
      .filter((line) => line !== labelLine)
      .filter((line) => {
        const centerY = getLineCenterY(line);
        return centerY > getLineCenterY(labelLine) && centerY - getLineCenterY(labelLine) <= 0.12;
      })
      .map((line) => {
        const tokens = extractSheetNumberTokensFromText(line.text);
        const bestToken = tokens[0] ?? "";
        const tokenScore = bestToken ? scoreInlineSheetNumberValue(bestToken, line.text) : -40;
        const wordCount = countWords(line.text);
        const metadataPenalty = /\b(?:job|checked|drawn|scale|project|date)\b/i.test(line.text) ? 40 : 0;
        return {
          line,
          score:
            tokenScore +
            (line.fontSize ?? line.height) * 2 -
            wordCount * 6 -
            metadataPenalty,
        };
      })
      .sort((left, right) => right.score - left.score)[0]?.line ?? null;
  if (!numberLine) {
    return null;
  }

  const left = Math.max(0.7, Math.min(getLineLeft(labelLine), getLineLeft(numberLine)) - 0.018);
  const right = Math.min(0.995, Math.max(getLineRight(labelLine), getLineRight(numberLine)) + 0.028);
  const top = Math.max(0.76, labelLine.normY - 0.012);
  const bottom = Math.min(0.995, numberLine.normY + numberLine.normHeight + 0.018);

  if (right - left < 0.08 || bottom - top < 0.05) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function detectRasterTitleFieldBox(args: {
  canvas: ReturnType<typeof createCanvas>;
  ocrLines: TextLine[];
}) {
  const width = args.canvas.width;
  const height = args.canvas.height;
  if (width < 32 || height < 32) {
    return null;
  }

  const metadataLines = args.ocrLines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return centerX >= 0.68 && centerX <= 0.995 && centerY >= 0.64 && centerY <= 0.97;
  });
  if (metadataLines.length < 2) {
    return null;
  }

  const labelLine =
    metadataLines.find((line) =>
      TITLE_FIELD_LABEL_SEARCH_PATTERN.test(normalizeWhitespace(line.text))
    ) ?? null;
  if (!labelLine) {
    return null;
  }

  const titleLines = metadataLines
    .filter((line) => line !== labelLine)
    .filter((line) => {
      const centerY = getLineCenterY(line);
      return centerY > getLineCenterY(labelLine) && centerY - getLineCenterY(labelLine) <= 0.18;
    })
    .filter((line) => {
      const normalized = normalizeWhitespace(line.text);
      return (
        normalized.length > 0 &&
        !SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalized) &&
        !NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)
      );
    })
    .sort((left, right) => {
      const topDelta = left.normY - right.normY;
      if (Math.abs(topDelta) > 0.003) {
        return topDelta;
      }
      return left.normX - right.normX;
    });
  if (titleLines.length === 0) {
    return null;
  }

  const bottomLine = [...titleLines].sort(
    (left, right) => getLineBottom(right) - getLineBottom(left)
  )[0] ?? null;
  if (!bottomLine) {
    return null;
  }

  const context = args.canvas.getContext("2d");
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const isDark = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false;
    }
    const index = (y * width + x) * 4;
    const alpha = data[index + 3] ?? 0;
    if (alpha < 32) {
      return false;
    }
    const r = data[index] ?? 255;
    const g = data[index + 1] ?? 255;
    const b = data[index + 2] ?? 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luminance <= 165;
  };
  const hasVerticalStroke = (x: number, y: number) => {
    let darkHits = 0;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (isDark(x + offsetX, y)) {
        darkHits += 1;
      }
    }
    return darkHits >= 2;
  };
  const hasHorizontalStroke = (x: number, y: number) => {
    let darkHits = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      if (isDark(x, y + offsetY)) {
        darkHits += 1;
      }
    }
    return darkHits >= 2;
  };

  const expectedLeft = Math.max(
    0.66,
    Math.min(
      getLineLeft(labelLine),
      ...titleLines.map((line) => getLineLeft(line))
    ) - 0.022
  );
  const expectedRight = Math.min(
    0.995,
    Math.max(
      getLineRight(labelLine),
      ...titleLines.map((line) => getLineRight(line))
    ) + 0.03
  );
  const expectedTop = Math.max(0.62, labelLine.normY - 0.014);
  const expectedBottom = Math.min(0.985, getLineBottom(bottomLine) + 0.02);
  if (expectedRight - expectedLeft < 0.1 || expectedBottom - expectedTop < 0.05) {
    return null;
  }

  const scanVerticalEdge = (expectedX: number) => {
    const startX = Math.max(0, Math.floor(width * Math.max(expectedX - 0.02, 0)));
    const endX = Math.min(width - 1, Math.ceil(width * Math.min(expectedX + 0.02, 1)));
    const startY = Math.max(0, Math.floor(height * expectedTop));
    const endY = Math.min(height - 1, Math.ceil(height * expectedBottom));
    const span = Math.max(endY - startY + 1, 1);
    let best: { x: number; score: number; coverage: number; runCoverage: number } | null = null;

    for (let x = startX; x <= endX; x += 1) {
      let darkCount = 0;
      let longestRun = 0;
      let currentRun = 0;
      for (let y = startY; y <= endY; y += 1) {
        if (hasVerticalStroke(x, y)) {
          darkCount += 1;
          currentRun += 1;
          longestRun = Math.max(longestRun, currentRun);
        } else {
          currentRun = 0;
        }
      }

      const coverage = darkCount / span;
      const runCoverage = longestRun / span;
      if (coverage < 0.16 || runCoverage < 0.08) {
        continue;
      }

      const normX = x / width;
      const score =
        coverage * 120 +
        runCoverage * 160 -
        Math.abs(normX - expectedX) * 400;
      if (!best || score > best.score) {
        best = { x, score, coverage, runCoverage };
      }
    }

    return best
      ? {
          x: best.x / width,
          score: best.score,
          coverage: best.coverage,
          runCoverage: best.runCoverage,
        }
      : null;
  };

  const scanHorizontalEdge = (expectedY: number) => {
    const startX = Math.max(0, Math.floor(width * expectedLeft));
    const endX = Math.min(width - 1, Math.ceil(width * expectedRight));
    const startY = Math.max(0, Math.floor(height * Math.max(expectedY - 0.02, 0)));
    const endY = Math.min(height - 1, Math.ceil(height * Math.min(expectedY + 0.02, 1)));
    const span = Math.max(endX - startX + 1, 1);
    let best: { y: number; score: number; coverage: number; runCoverage: number } | null = null;

    for (let y = startY; y <= endY; y += 1) {
      let darkCount = 0;
      let longestRun = 0;
      let currentRun = 0;
      for (let x = startX; x <= endX; x += 1) {
        if (hasHorizontalStroke(x, y)) {
          darkCount += 1;
          currentRun += 1;
          longestRun = Math.max(longestRun, currentRun);
        } else {
          currentRun = 0;
        }
      }

      const coverage = darkCount / span;
      const runCoverage = longestRun / span;
      if (coverage < 0.2 || runCoverage < 0.1) {
        continue;
      }

      const normY = y / height;
      const score =
        coverage * 120 +
        runCoverage * 160 -
        Math.abs(normY - expectedY) * 450;
      if (!best || score > best.score) {
        best = { y, score, coverage, runCoverage };
      }
    }

    return best
      ? {
          y: best.y / height,
          score: best.score,
          coverage: best.coverage,
          runCoverage: best.runCoverage,
        }
      : null;
  };

  const left = scanVerticalEdge(expectedLeft);
  const right = scanVerticalEdge(expectedRight);
  const top = scanHorizontalEdge(expectedTop);
  const bottom = scanHorizontalEdge(expectedBottom);

  const confirmedLeft = Boolean(left && (left.coverage >= 0.22 || left.runCoverage >= 0.16));
  const confirmedRight = Boolean(right && (right.coverage >= 0.22 || right.runCoverage >= 0.16));
  const confirmedTop = Boolean(top && (top.coverage >= 0.24 || top.runCoverage >= 0.16));
  const confirmedBottom = Boolean(bottom && (bottom.coverage >= 0.24 || bottom.runCoverage >= 0.16));

  const edgeCount =
    Number(confirmedLeft) +
    Number(confirmedRight) +
    Number(confirmedTop) +
    Number(confirmedBottom);
  const hasVerticalEvidence = confirmedLeft || confirmedRight;
  const hasHorizontalEvidence = confirmedTop || confirmedBottom;
  if (edgeCount < 2 || !hasVerticalEvidence || !hasHorizontalEvidence) {
    return null;
  }

  const resolvedLeft = left?.x ?? expectedLeft;
  const resolvedRight = right?.x ?? expectedRight;
  const resolvedTop = top?.y ?? expectedTop;
  const resolvedBottom = bottom?.y ?? expectedBottom;
  const box = {
    x: resolvedLeft,
    y: resolvedTop,
    width: resolvedRight - resolvedLeft,
    height: resolvedBottom - resolvedTop,
  };
  if (box.width < 0.08 || box.height < 0.05) {
    return null;
  }

  const primaryTitleLine = titleLines[0]!;
  const titleCenterX = getLineCenterX(primaryTitleLine);
  const titleCenterY = getLineCenterY(primaryTitleLine);
  if (
    titleCenterX < box.x ||
    titleCenterX > box.x + box.width ||
    titleCenterY < box.y ||
    titleCenterY > box.y + box.height
  ) {
    return null;
  }

  return box;
}

function inferOcrLabelAnchoredTitleFieldBounds(lines: TextLine[]) {
  const metadataLines = lines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return centerX >= 0.68 && centerX <= 0.995 && centerY >= 0.64 && centerY <= 0.97;
  });
  if (metadataLines.length < 2) {
    return null;
  }

  const labelLine =
    metadataLines.find((line) =>
      TITLE_FIELD_LABEL_SEARCH_PATTERN.test(normalizeWhitespace(line.text))
    ) ?? null;
  if (!labelLine) {
    return null;
  }

  const titleLines: TextLine[] = [];
  for (const line of metadataLines
    .filter((line) => line !== labelLine)
    .sort((left, right) => {
      const topDelta = left.normY - right.normY;
      if (Math.abs(topDelta) > 0.003) {
        return topDelta;
      }
      return left.normX - right.normX;
    })) {
    const centerY = getLineCenterY(line);
    if (centerY <= getLineCenterY(labelLine) || centerY - getLineCenterY(labelLine) > 0.18) {
      continue;
    }

    const normalized = normalizeWhitespace(line.text);
    if (
      !normalized ||
      SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalized) ||
      NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)
    ) {
      break;
    }

    titleLines.push(line);
    if (titleLines.length >= 4) {
      break;
    }
  }

  if (titleLines.length === 0) {
    return null;
  }

  const bottom = Math.max(...titleLines.map((line) => getLineBottom(line)));
  const left = Math.max(
    0.66,
    Math.min(getLineLeft(labelLine), ...titleLines.map((line) => getLineLeft(line))) - 0.018
  );
  const right = Math.min(
    0.995,
    Math.max(getLineRight(labelLine), ...titleLines.map((line) => getLineRight(line))) + 0.028
  );
  const top = Math.max(0.62, labelLine.normY - 0.012);
  const resolvedBottom = Math.min(0.985, bottom + 0.018);

  if (right - left < 0.1 || resolvedBottom - top < 0.05) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: resolvedBottom - top,
  };
}

function hasOcrTitleFieldLabel(lines: TextLine[]) {
  return lines.some((line) =>
    TITLE_FIELD_LABEL_SEARCH_PATTERN.test(normalizeWhitespace(line.text))
  );
}

function hasStrongOcrTitleEvidence(lines: TextLine[]) {
  return lines.some((line) => {
    const normalized = normalizeWhitespace(line.text);
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    return (
      centerX >= 0.68 &&
      centerY >= 0.6 &&
      centerY <= 0.94 &&
      countTitleVocabularyHits(normalized) >= 2 &&
      countWords(normalized) >= 3 &&
      !SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalized) &&
      !NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)
    );
  });
}

function normalizeProbeBox(box: OcrNormalizedBox): OcrNormalizedBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(Math.max(0.0001, box.width), 1 - x);
  const height = Math.min(Math.max(0.0001, box.height), 1 - y);
  return { x, y, width, height };
}

function buildOcrTitleProbeBoxes(args: {
  searchLines: TextLine[];
  focusedLines: TextLine[];
  ocrNumberBox: OcrNormalizedBox | null;
}) {
  const boxes: OcrNormalizedBox[] = [];
  const addBox = (box: OcrNormalizedBox | null) => {
    if (!box) return;
    const normalized = normalizeProbeBox(box);
    if (normalized.width < 0.08 || normalized.height < 0.04) return;
    const dedupeKey = [
      Math.round(normalized.x * 1000),
      Math.round(normalized.y * 1000),
      Math.round(normalized.width * 1000),
      Math.round(normalized.height * 1000),
    ].join(":");
    if (boxes.some((candidate) => {
      const candidateKey = [
        Math.round(candidate.x * 1000),
        Math.round(candidate.y * 1000),
        Math.round(candidate.width * 1000),
        Math.round(candidate.height * 1000),
      ].join(":");
      return candidateKey === dedupeKey;
    })) {
      return;
    }
    boxes.push(normalized);
  };

  const titleLikeLines = args.searchLines
    .filter((line) => {
      const centerX = getLineCenterX(line);
      const centerY = getLineCenterY(line);
      const normalized = normalizeWhitespace(line.text);
      return (
        centerX >= 0.68 &&
        centerX <= 0.995 &&
        centerY >= 0.6 &&
        centerY <= 0.94 &&
        countTitleVocabularyHits(normalized) >= 1 &&
        !SHEET_NUMBER_LABEL_SEARCH_PATTERN.test(normalized) &&
        !NON_TITLE_FIELD_LABEL_PATTERN.test(normalized)
      );
    })
    .sort((left, right) => left.normY - right.normY);

  if (titleLikeLines.length > 0) {
    const seedTop = titleLikeLines[0]!.normY;
    const clusterLines = titleLikeLines.filter((line) => line.normY <= seedTop + 0.12).slice(0, 4);
    const clusterBox = getNormalizedUnionBox(clusterLines.map(getNormalizedBoxFromLine));
    if (clusterBox) {
      addBox({
        x: clusterBox.x - 0.025,
        y: clusterBox.y - 0.05,
        width: clusterBox.width + 0.05,
        height: clusterBox.height + 0.07,
      });
    }
  }

  if (args.ocrNumberBox) {
    const x = Math.max(0.68, args.ocrNumberBox.x - 0.03);
    const top = Math.max(0.6, args.ocrNumberBox.y - 0.18);
    const bottom = Math.max(top + 0.06, args.ocrNumberBox.y - 0.006);
    addBox({
      x,
      y: top,
      width: Math.min(0.24, 0.995 - x),
      height: Math.min(0.22, bottom - top),
    });
  }

  if (boxes.length === 0) {
    addBox({
      x: 0.76,
      y: 0.68,
      width: 0.22,
      height: 0.18,
    });
  }

  return boxes.slice(0, 3);
}

function mergeUniqueTextLines(...groups: TextLine[][]) {
  const merged = new Map<string, TextLine>();
  for (const group of groups) {
    for (const line of group) {
      const key = [
        normalizeWhitespace(line.text).toUpperCase(),
        Math.round(line.normX * 1000),
        Math.round(line.normY * 1000),
        Math.round(line.normWidth * 1000),
        Math.round(line.normHeight * 1000),
      ].join(":");
      const existing = merged.get(key);
      if (!existing || (line.fontSize ?? line.height) > (existing.fontSize ?? existing.height)) {
        merged.set(key, line);
      }
    }
  }

  return [...merged.values()].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  });
}

function buildTextLinesFromOcrStructuredLines(
  lines: Array<{
    text: string;
    normX: number;
    normY: number;
    normWidth: number;
    normHeight: number;
    confidence?: number;
  }>,
  pageWidth: number,
  pageHeight: number
) {
  const structuredLines: TextLine[] = [];
  for (const [index, line] of lines.entries()) {
    const text = normalizeWhitespace(line.text);
    if (!text) {
      continue;
    }

    const x = Math.max(line.normX * pageWidth, 0);
    const top = Math.max(line.normY * pageHeight, 0);
    const width = Math.max(line.normWidth * pageWidth, 1);
    const height = Math.max(line.normHeight * pageHeight, 1);
    const estimatedFontSize = Math.max(height * 0.92, 6);

    const item: PositionedTextItem = {
      text,
      x,
      top,
      width,
      height,
      normX: Math.max(line.normX, 0),
      normY: Math.max(line.normY, 0),
      normWidth: Math.max(line.normWidth, 0.0001),
      normHeight: Math.max(line.normHeight, 0.0001),
      blockId: index,
      lineId: index,
      fontSize: estimatedFontSize,
      fontName: null,
      fontFlags: null,
      isBold: false,
    };

    structuredLines.push({
      text,
      items: [item],
      x,
      top,
      width,
      height,
      normX: item.normX,
      normY: item.normY,
      normWidth: item.normWidth,
      normHeight: item.normHeight,
      blockId: index,
      lineId: index,
      fontSize: estimatedFontSize,
      fontSizeMin: estimatedFontSize,
      fontSizeMax: estimatedFontSize,
      isBold: false,
    });
  }

  return structuredLines.sort((left, right) => {
    const verticalDelta = left.normY - right.normY;
    if (Math.abs(verticalDelta) > 0.002) {
      return verticalDelta;
    }

    return left.normX - right.normX;
  });
}

async function extractSparsePdfPagesWithOcr(
  _fileBytes: Uint8Array,
  sparsePages: Array<{
    pageNumber: number;
    width: number;
    height: number;
  }>,
  debugSession?: PlanSheetImportDebugSession
) {
  debugSession?.log("pdf.sparse_pages.ocr_removed", {
    pageCount: sparsePages.length,
    pageNumbers: sparsePages.map((page) => page.pageNumber),
    mode: "pdf_only",
  });

  return new Map<
    number,
    {
      lines: TextLine[];
      searchLines: TextLine[];
      drawingSegments: PageDrawingSegment[];
      ocrNumberBox: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
      ocrTitleBox: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null;
    }
  >();
}

function shouldTryImageSuppressedOcrRender(args: {
  lineCount: number;
  edgeLineCount: number;
}) {
  return (
    args.lineCount >= OCR_IMAGE_SUPPRESSED_MIN_LINE_COUNT ||
    args.edgeLineCount >= OCR_IMAGE_SUPPRESSED_MIN_EDGE_LINE_COUNT
  );
}

function shouldAcceptImageSuppressedOcrResult(result: PdfTextExtractionResult) {
  return Boolean(result && result.score >= OCR_IMAGE_SUPPRESSED_MIN_CANDIDATE_SCORE);
}

function serializeMetadataBoxCandidate(box: MetadataBoxCandidate) {
  return {
    sourceModel: box.sourceModel,
    familyId: box.familyId,
    regionId: box.regionId,
    bbox: box.bbox,
    score: Number(box.score.toFixed(1)),
    rejectReason: box.rejectReason ?? null,
    pairRejectReason: box.pairRejectReason ?? null,
    pairGeometryRejectReason: box.pairGeometryRejectReason ?? null,
    pairSubclusterBbox: box.pairSubclusterBbox ?? null,
    selectedTitleLineIndexes: box.selectedTitleLineIndexes ?? [],
    anchor: {
      value: box.anchorCandidate.value,
      score: Number(box.anchorCandidate.score.toFixed(1)),
      candidateTypeGuess: guessSheetNumberCandidateType(
        box.anchorCandidate.value,
        box.anchorCandidate.lineText
      ),
      reasonCodes: buildSheetNumberReasonCodes(box.anchorCandidate),
      lineIndex: box.anchorCandidate.lineIndex,
      lineText: box.anchorCandidate.lineText,
      normX: Number(box.anchorCandidate.normX.toFixed(4)),
      normY: Number(box.anchorCandidate.normY.toFixed(4)),
      normWidth: Number(box.anchorCandidate.normWidth.toFixed(4)),
      normHeight: Number(box.anchorCandidate.normHeight.toFixed(4)),
    },
    distinctNumberCount: box.distinctNumberCount,
    titleLikeCount: box.titleLikeCount,
    titleVocabularyHits: box.titleVocabularyHits,
    lines: box.lines.map((line) => ({
      text: line.text,
      normX: Number(line.normX.toFixed(4)),
      normY: Number(line.normY.toFixed(4)),
      normWidth: Number(line.normWidth.toFixed(4)),
      normHeight: Number(line.normHeight.toFixed(4)),
    })),
    titleAttempts: (box.titleAttempts ?? []).map((attempt) => ({
      text: attempt.text,
      sourceText: attempt.sourceText,
      candidateTypeGuess: attempt.candidateTypeGuess ?? null,
      reasonCodes: attempt.reasonCodes ?? [],
      score:
        typeof attempt.score === "number"
          ? Number(attempt.score.toFixed(1))
          : null,
      lineIndex: attempt.lineIndex,
      rejectReason: attempt.rejectReason ?? null,
    })),
  };
}

function serializeSheetNumberCandidate(candidate: SheetNumberCandidate) {
  return {
    value: candidate.value,
    score: Number(candidate.score.toFixed(1)),
    lineIndex: candidate.lineIndex,
    lineText: candidate.lineText,
    normX: Number(candidate.normX.toFixed(4)),
    normY: Number(candidate.normY.toFixed(4)),
    normWidth: Number(candidate.normWidth.toFixed(4)),
    normHeight: Number(candidate.normHeight.toFixed(4)),
    isNumericOnly: candidate.isNumericOnly,
    prefix: candidate.prefix,
  };
}

function buildAnnotatedMetadataDebugCanvas(args: {
  pageCanvas: ReturnType<typeof createCanvas>;
  boxes: MetadataBoxCandidate[];
}) {
  const annotatedCanvas = createCanvas(args.pageCanvas.width, args.pageCanvas.height);
  const context = annotatedCanvas.getContext("2d");
  context.drawImage(args.pageCanvas, 0, 0);

  const palette = ["#d62828", "#1d4ed8", "#2a9d8f", "#f59e0b", "#7c3aed"];
  context.lineWidth = 4;
  context.font = "24px sans-serif";
  context.textBaseline = "top";

  args.boxes.slice(0, 5).forEach((box, index) => {
    const color = palette[index % palette.length];
    const x = Math.round(box.bbox.x * annotatedCanvas.width);
    const y = Math.round(box.bbox.y * annotatedCanvas.height);
    const width = Math.max(1, Math.round(box.bbox.width * annotatedCanvas.width));
    const height = Math.max(1, Math.round(box.bbox.height * annotatedCanvas.height));
    const label = `${index + 1}:${box.familyId}:${box.anchorCandidate.value}${
      box.rejectReason ? `:${box.rejectReason}` : ""
    }`;

    context.strokeStyle = color;
    context.strokeRect(x, y, width, height);

    const textWidth = Math.min(
      annotatedCanvas.width - x - 8,
      Math.max(context.measureText(label).width + 16, 140)
    );
    context.fillStyle = color;
    context.fillRect(x, Math.max(0, y - 28), textWidth, 28);
    context.fillStyle = "#ffffff";
    context.fillText(label, x + 8, Math.max(0, y - 26));
  });

  return annotatedCanvas;
}

function countSheetReferenceTokens(text: string) {
  return countSheetReferenceTokensBase(text);
}

function getSheetNumberRejectPenalty(value: string, line: TextLine) {
  let penalty = 0;
  const normalizedValue = normalizeSheetNumberValue(value);
  const normalizedLine = normalizeWhitespace(line.text);
  penalty += getTextualSheetNumberRejectPenalty(normalizedValue, normalizedLine);

  if (isLowTrustInterior(line)) {
    penalty -= 30;
  }

  return penalty;
}

function scoreSheetNumberCandidate(
  value: string,
  line: TextLine,
  lineIndex: number,
  lines: TextLine[]
) {
  if (!isAllowedEdgeMetadataLine(line)) {
    return -Infinity;
  }

  if (
    /^\[\s*sheet\s*title\s*\]/i.test(normalizeWhitespace(line.text)) ||
    /\bAutoShort\b/i.test(line.text) ||
    /\.(?:vwxp|vwx|dwg)\b/i.test(line.text)
  ) {
    return -Infinity;
  }

  let score = getRegionTrustScore(line.normX, line.normY);
  const normalizedValue = value.trim().toUpperCase();
  const normalizedLine = line.text.trim().toUpperCase();
  const numericOnly = /^\d+(?:\.\d+)?$/.test(normalizedValue);
  const letterOnlySheetNumber = isRecognizedLetterOnlySheetNumber(normalizedValue);

  if (/^[A-Z]{1,4}\d{1,4}(?:\.\d{1,3})?[A-Z]?$/.test(normalizedValue)) {
    score += 130;
  }

  if (/^[A-Z]{1,4}-\d{1,4}(?:\.\d{1,3})?[A-Z]?$/.test(normalizedValue)) {
    score += 125;
  }

  if (/^[A-Z]{1,4}\.\d{1,4}(?:\.\d{1,3})?[A-Z]?$/.test(normalizedValue)) {
    score += 120;
  }

  if (letterOnlySheetNumber) {
    score += 148;
  } else if (/^[A-Z]{1,3}$/.test(normalizedValue)) {
    score -= 90;
  }

  if (numericOnly) {
    score -= 110;
  }

  if (/^\d+\.\d$/.test(normalizedValue)) {
    score -= 40;
  }

  if (normalizedLine === normalizedValue) {
    score += 24;
  }

  if (lineIndex < 10) {
    score += 8;
  }

  if (line.normY > 0.68) {
    score += 28;
  }

  if (line.normX > 0.55) {
    score += 18;
  }

  if (line.normY > 0.68 && line.normX > 0.55) {
    score += 34;
  }

  if (isLowTrustInterior(line)) {
    score -= 24;
  }

  const nearbyLines = lines.slice(Math.max(0, lineIndex - 2), lineIndex + 3);
  for (const nearbyLine of nearbyLines) {
    if (/^(sheet|sheet no|sheet number|dwg|drawing)\b/i.test(nearbyLine.text)) {
      score += 20;
    }

    if (isLikelySheetTitle(nearbyLine.text)) {
      score += 6;
    }

    if (
      letterOnlySheetNumber &&
      /\b(?:cover|title)\s+sheet\b/i.test(nearbyLine.text)
    ) {
      score += 96;
    }
  }

  const numberLabelMatch = findLabelRelationship(
    lines,
    lineIndex,
    SHEET_NUMBER_LABEL_PATTERN
  );
  if (numberLabelMatch) {
    score += numberLabelMatch.position === "above" ? 72 : 28;
  }

  if (/[A-Z]/.test(normalizedValue) && /\d/.test(normalizedValue)) {
    score += 18;
  }

  if (countSheetReferenceTokens(normalizedLine) >= 3 && normalizedLine !== normalizedValue) {
    score -= 42;
  }

  score += getSheetNumberRejectPenalty(normalizedValue, line);

  return score;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSheetNumberCandidateGeometry(
  line: TextLine,
  value: string,
  matchIndex = 0
) {
  const normalizedValue = normalizeSheetNumberValue(value);

    for (const item of line.items) {
      const matches = Array.from(
        item.text.matchAll(createExtendedSheetNumberTokenPattern())
    );

    for (const tokenMatch of matches) {
      const tokenValue = tokenMatch[1]?.trim();
      if (!tokenValue) continue;
      if (normalizeSheetNumberValue(tokenValue) !== normalizedValue) continue;

      const rawText = item.text;
      const start = tokenMatch.index ?? rawText.indexOf(tokenValue);
      const length = tokenMatch[1]?.length ?? tokenValue.length;
      const charCount = Math.max(rawText.length, 1);
      const startRatio = clamp(start / charCount, 0, 1);
      const widthRatio = clamp(length / charCount, 1 / charCount, 1);
      const normX = item.normX + item.normWidth * startRatio;
      const normWidth = Math.max(item.normWidth * widthRatio, item.normWidth / charCount);
      const widthPx = Math.max(item.width * widthRatio, item.width / charCount);

      return {
        normX,
        normY: item.normY,
        normWidth,
        normHeight: item.normHeight,
        width: widthPx,
        height: item.height,
      };
    }
  }

  const safeText = line.text || value;
  const fallbackMatch = safeText
    .slice(matchIndex)
    .match(new RegExp(`\\b${escapeRegex(value)}\\b`, "i"));
  const absoluteStart =
    fallbackMatch && typeof fallbackMatch.index === "number"
      ? matchIndex + fallbackMatch.index
      : matchIndex;
  const charCount = Math.max(safeText.length, 1);
  const startRatio = clamp(absoluteStart / charCount, 0, 1);
  const widthRatio = clamp(value.length / charCount, 1 / charCount, 1);

  return {
    normX: line.normX + line.normWidth * startRatio,
    normY: line.normY,
    normWidth: Math.max(line.normWidth * widthRatio, line.normWidth / charCount),
    normHeight: line.normHeight,
    width: Math.max(line.width * widthRatio, line.width / charCount),
    height: line.height,
  };
}

function extractSheetNumberCandidates(lines: TextLine[]) {
  const pattern = createExtendedSheetNumberTokenPattern();

  const candidates: SheetNumberCandidate[] = [];

  lines.forEach((line, lineIndex) => {
    if (!isAllowedEdgeMetadataLine(line)) {
      return;
    }

    for (const match of line.text.matchAll(pattern)) {
      const value = match[1]?.trim();

      if (!value) continue;

      const geometry = getSheetNumberCandidateGeometry(
        line,
        value,
        match.index ?? 0
      );

      candidates.push({
        value,
        score: scoreSheetNumberCandidate(value, line, lineIndex, lines),
        lineIndex,
        normX: geometry.normX,
        normY: geometry.normY,
        normWidth: geometry.normWidth,
        normHeight: geometry.normHeight,
        width: geometry.width,
        height: geometry.height,
        lineText: line.text,
        isNumericOnly: /^\d+(?:\.\d+)?$/.test(value.trim()),
        prefix: getCandidatePrefix(value),
      });
    }

    for (let itemIndex = 0; itemIndex < line.items.length - 1; itemIndex += 1) {
      const firstItem = line.items[itemIndex];
      const secondItem = line.items[itemIndex + 1];
      if (!firstItem || !secondItem) {
        continue;
      }

      const firstText = normalizeWhitespace(firstItem.text).toUpperCase();
      const secondText = normalizeWhitespace(secondItem.text).toUpperCase();
      const firstPrefix = firstText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const secondPrefix = secondText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const firstNumeric = normalizeSheetNumberValue(firstText);
      const secondNumeric = normalizeSheetNumberValue(secondText);

      const pair =
        firstPrefix &&
        /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(secondNumeric)
          ? {
              prefix: firstPrefix,
              suffix: secondNumeric,
              prefixItem: firstItem,
              suffixItem: secondItem,
            }
          : secondPrefix &&
              /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(firstNumeric)
            ? {
                prefix: secondPrefix,
                suffix: firstNumeric,
                prefixItem: secondItem,
                suffixItem: firstItem,
              }
            : null;

      if (!pair) {
        continue;
      }

      const gap = pair.suffixItem.normX - (pair.prefixItem.normX + pair.prefixItem.normWidth);
      if (gap < -0.005 || gap > 0.03) {
        continue;
      }

      const value = normalizeSheetNumberValue(`${pair.prefix}${pair.suffix}`);
      if (!/^[A-Z]{1,3}\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(value)) {
        continue;
      }

      candidates.push({
        value,
        score:
          scoreSheetNumberCandidate(value, line, lineIndex, lines) +
          140 +
          Math.max(0, 18 - Math.round(gap * 1200)),
        lineIndex,
        normX: Math.min(pair.prefixItem.normX, pair.suffixItem.normX),
        normY: Math.min(pair.prefixItem.normY, pair.suffixItem.normY),
        normWidth:
          Math.max(
            pair.prefixItem.normX + pair.prefixItem.normWidth,
            pair.suffixItem.normX + pair.suffixItem.normWidth
          ) - Math.min(pair.prefixItem.normX, pair.suffixItem.normX),
        normHeight:
          Math.max(
            pair.prefixItem.normY + pair.prefixItem.normHeight,
            pair.suffixItem.normY + pair.suffixItem.normHeight
          ) - Math.min(pair.prefixItem.normY, pair.suffixItem.normY),
        width: Math.max(pair.prefixItem.width, pair.suffixItem.width),
        height: Math.max(pair.prefixItem.height, pair.suffixItem.height),
        lineText: line.text,
        isNumericOnly: false,
        prefix: getCandidatePrefix(value),
      });
    }
  });

  return candidates;
}

function rescoreCandidate(
  candidate: SheetNumberCandidate,
  exactCounts: Record<string, number>,
  prefixCounts: Record<string, number>
) {
  let score = candidate.score;
  const candidateTypeGuess = guessSheetNumberCandidateType(
    candidate.value,
    candidate.lineText
  );
  const normalized = normalizeKey(candidate.value);
  const exactCount = exactCounts[normalized] ?? 0;
  const prefixCount = candidate.prefix ? prefixCounts[candidate.prefix] ?? 0 : 0;

  if (candidate.prefix && prefixCount > 1) {
    score += Math.min(prefixCount * 6, 24);
  }

  if (exactCount > 1) {
    score -= candidate.isNumericOnly ? 140 : Math.min(exactCount * 20, 55);
  } else {
    score += 8;
  }

  if (candidate.isNumericOnly && candidate.normY < 0.55) {
    score -= 40;
  }

  if (candidateTypeGuess === "sheet_number") {
    score += 18;
  } else if (candidateTypeGuess === "date") {
    score -= 260;
  } else if (candidateTypeGuess === "scale") {
    score -= 240;
  } else if (candidateTypeGuess === "revision") {
    score -= 220;
  } else if (candidateTypeGuess === "sheet_reference") {
    score -= 180;
  }

  if (isPageCountFooterSheetNumberCandidate(candidate.value, candidate.lineText)) {
    score -= 420;
  }

  score += getTextualSheetNumberRejectPenalty(candidate.value, candidate.lineText);

  return score;
}

function detectSheetNumber(
  page: PageExtractionModel,
  exactCounts: Record<string, number>,
  prefixCounts: Record<string, number>
) {
  const labeledMatch = findBestLabeledSheetNumber(page.lines);
  const directStampMatch = findDirectCornerStampSheetNumber(page.lines);
  const stackedMatch = findBestStackedSheetNumber(page.lines);
  const inlineSplitMatch: SheetNumberCandidate | null =
    findBestInlineSplitSheetNumber(page.lines);
  const noisyInlineMatch: SheetNumberCandidate | null =
    findBestNoisyInlinePrefixedSheetNumber(page.lines);
  const rescored = page.candidates
    .map((candidate) => ({
      ...candidate,
      score: rescoreCandidate(candidate, exactCounts, prefixCounts),
    }))
    .sort((a, b) => b.score - a.score);

  const winner = rescored[0];
  const runnerUp = rescored[1];

  let effectiveWinner: SheetNumberCandidate | undefined = winner;

  if (
    directStampMatch &&
    (!effectiveWinner || directStampMatch.score >= effectiveWinner.score - 8)
  ) {
    effectiveWinner = {
      ...directStampMatch,
      score: Math.max(directStampMatch.score, effectiveWinner?.score ?? 0),
    };
  }

  if (labeledMatch && (!winner || labeledMatch.score >= winner.score - 18)) {
    effectiveWinner = {
      value: labeledMatch.value,
      score: Math.max(labeledMatch.score, winner?.score ?? 0),
      lineIndex: labeledMatch.lineIndex,
      normX: labeledMatch.normX,
      normY: labeledMatch.normY,
      normWidth: labeledMatch.normWidth,
      normHeight: labeledMatch.normHeight,
      width: labeledMatch.width,
      height: labeledMatch.height,
      lineText: page.lines[labeledMatch.lineIndex]?.text ?? labeledMatch.value,
      isNumericOnly: /^\d+(?:\.\d+)?$/.test(labeledMatch.value.trim()),
      prefix: getCandidatePrefix(labeledMatch.value),
    };
  }

  if (
    stackedMatch &&
    (!effectiveWinner || stackedMatch.score >= effectiveWinner.score - 12)
  ) {
    effectiveWinner = {
      value: stackedMatch.value,
      score: Math.max(stackedMatch.score, effectiveWinner?.score ?? 0),
      lineIndex: stackedMatch.lineIndex,
      normX: stackedMatch.normX,
      normY: stackedMatch.normY,
      normWidth: stackedMatch.normWidth,
      normHeight: stackedMatch.normHeight,
      width: stackedMatch.width,
      height: stackedMatch.height,
      lineText: stackedMatch.lineText,
      isNumericOnly: false,
      prefix: getCandidatePrefix(stackedMatch.value),
    };
  }

  if (
    inlineSplitMatch &&
    (!effectiveWinner || inlineSplitMatch.score >= effectiveWinner.score - 8)
  ) {
    effectiveWinner = {
      value: inlineSplitMatch.value,
      score: Math.max(inlineSplitMatch.score, effectiveWinner?.score ?? 0),
      lineIndex: inlineSplitMatch.lineIndex,
      normX: inlineSplitMatch.normX,
      normY: inlineSplitMatch.normY,
      normWidth: inlineSplitMatch.normWidth,
      normHeight: inlineSplitMatch.normHeight,
      width: inlineSplitMatch.width,
      height: inlineSplitMatch.height,
      lineText: inlineSplitMatch.lineText,
      isNumericOnly: false,
      prefix: getCandidatePrefix(inlineSplitMatch.value),
    };
  }

  if (
    noisyInlineMatch &&
    (!effectiveWinner || noisyInlineMatch.score >= effectiveWinner.score - 10)
  ) {
    effectiveWinner = {
      value: noisyInlineMatch.value,
      score: Math.max(noisyInlineMatch.score, effectiveWinner?.score ?? 0),
      lineIndex: noisyInlineMatch.lineIndex,
      normX: noisyInlineMatch.normX,
      normY: noisyInlineMatch.normY,
      normWidth: noisyInlineMatch.normWidth,
      normHeight: noisyInlineMatch.normHeight,
      width: noisyInlineMatch.width,
      height: noisyInlineMatch.height,
      lineText: noisyInlineMatch.lineText,
      isNumericOnly: false,
      prefix: getCandidatePrefix(noisyInlineMatch.value),
    };
  }

  if (effectiveWinner) {
    const compactStampValue = normalizeCompactStampSheetNumberCandidate(
      effectiveWinner.lineText
    );
    if (
      compactStampValue &&
      normalizeKey(compactStampValue) !== normalizeKey(effectiveWinner.value)
    ) {
      effectiveWinner = {
        ...effectiveWinner,
        value: compactStampValue,
        isNumericOnly: /^\d+(?:\.\d+)?$/.test(compactStampValue.trim()),
        prefix: getCandidatePrefix(compactStampValue),
      };
    }
    const refinedWinnerValue = refineSheetNumberCandidateFromLineText(
      effectiveWinner.value,
      effectiveWinner.lineText
    );
    if (
      refinedWinnerValue &&
      normalizeKey(refinedWinnerValue) !== normalizeKey(effectiveWinner.value)
    ) {
      effectiveWinner = {
        ...effectiveWinner,
        value: refinedWinnerValue,
        isNumericOnly: /^\d+(?:\.\d+)?$/.test(refinedWinnerValue.trim()),
        prefix: getCandidatePrefix(refinedWinnerValue),
      };
    }
    const compactStampValueAfterRefine = normalizeCompactStampSheetNumberCandidate(
      effectiveWinner.lineText
    );
    if (
      compactStampValueAfterRefine &&
      normalizeKey(compactStampValueAfterRefine) !== normalizeKey(effectiveWinner.value)
    ) {
      effectiveWinner = {
        ...effectiveWinner,
        value: compactStampValueAfterRefine,
        isNumericOnly: /^\d+(?:\.\d+)?$/.test(compactStampValueAfterRefine.trim()),
        prefix: getCandidatePrefix(compactStampValueAfterRefine),
      };
    }
  }

  if (!effectiveWinner || effectiveWinner.score < 60) {
    return {
      sheetNumber: "",
      confidence: 0.15,
      winner: null as (typeof effectiveWinner) | null,
    };
  }

  const absoluteConfidence = clamp((effectiveWinner.score - 45) / 120, 0, 1);
  const marginConfidence = clamp(
    ((effectiveWinner.score - (runnerUp?.score ?? 0)) + 10) / 60,
    0,
    1
  );
  const labeledBoost = labeledMatch && effectiveWinner.value === labeledMatch.value ? 0.08 : 0;
  const confidence = Number(
    clamp(absoluteConfidence * 0.65 + marginConfidence * 0.35 + labeledBoost, 0, 1).toFixed(2)
  );

  return {
    sheetNumber: effectiveWinner.value,
    confidence,
    winner: effectiveWinner,
  };
}

function findBestStackedSheetNumber(lines: TextLine[]) {
  let best: SheetNumberCandidate | null = null;

  for (let firstIndex = 0; firstIndex < lines.length - 1; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < lines.length; secondIndex += 1) {
      const first = lines[firstIndex];
      const second = lines[secondIndex];
      if (!first || !second) {
        continue;
      }

      const firstText = normalizeWhitespace(first.text);
      const secondText = normalizeWhitespace(second.text);
      const firstPrefix = firstText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const secondPrefix = secondText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const secondNumeric = normalizeSheetNumberValue(secondText);
      const firstNumeric = normalizeSheetNumberValue(firstText);

      const pair =
        firstPrefix &&
        /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(secondNumeric)
          ? {
              prefix: firstPrefix,
              suffix: secondNumeric,
              prefixLine: first,
              suffixLine: second,
            }
          : secondPrefix &&
              /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(firstNumeric)
            ? {
                prefix: secondPrefix,
                suffix: firstNumeric,
                prefixLine: second,
                suffixLine: first,
              }
            : null;

      if (!pair) {
        continue;
      }

      const centerDelta = Math.abs(
        getLineCenterX(pair.prefixLine) - getLineCenterX(pair.suffixLine)
      );
      const verticalDelta = Math.abs(
        getLineCenterY(pair.prefixLine) - getLineCenterY(pair.suffixLine)
      );
      if (centerDelta > 0.05 || verticalDelta > 0.08) {
        continue;
      }

      const value = normalizeSheetNumberValue(`${pair.prefix}${pair.suffix}`);
      if (!/^[A-Z]{1,3}\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(value)) {
        continue;
      }

      const score =
        184 +
        getRegionTrustScore(pair.prefixLine.normX, pair.prefixLine.normY) +
        Math.max(0, 24 - Math.round(centerDelta * 200)) +
        Math.max(0, 20 - Math.round(verticalDelta * 180));
      const lineText = `${pair.prefixLine.text} ${pair.suffixLine.text}`;

      if (!best || score > best.score) {
        best = {
          value,
          score,
          lineIndex: lines.indexOf(pair.suffixLine),
          normX: Math.min(pair.prefixLine.normX, pair.suffixLine.normX),
          normY: Math.min(pair.prefixLine.normY, pair.suffixLine.normY),
          normWidth:
            Math.max(
              pair.prefixLine.normX + pair.prefixLine.normWidth,
              pair.suffixLine.normX + pair.suffixLine.normWidth
            ) - Math.min(pair.prefixLine.normX, pair.suffixLine.normX),
          normHeight:
            Math.max(
              pair.prefixLine.normY + pair.prefixLine.normHeight,
              pair.suffixLine.normY + pair.suffixLine.normHeight
            ) - Math.min(pair.prefixLine.normY, pair.suffixLine.normY),
          width: Math.max(pair.prefixLine.width, pair.suffixLine.width),
          height: pair.prefixLine.height + pair.suffixLine.height,
          lineText,
          isNumericOnly: false,
          prefix: getCandidatePrefix(value),
        };
      }
    }
  }

  return best;
}

function findBestInlineSplitSheetNumber(
  lines: TextLine[]
): SheetNumberCandidate | null {
  let best: SheetNumberCandidate | null = null;

  lines.forEach((line, lineIndex) => {
    if (isPageCountFooterSourceText(line.text)) {
      return;
    }
    for (let itemIndex = 0; itemIndex < line.items.length - 1; itemIndex += 1) {
      const firstItem = line.items[itemIndex];
      const secondItem = line.items[itemIndex + 1];
      if (!firstItem || !secondItem) {
        continue;
      }

      const firstText = normalizeWhitespace(firstItem.text).toUpperCase();
      const secondText = normalizeWhitespace(secondItem.text).toUpperCase();
      const firstPrefix = firstText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const secondPrefix = secondText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      const firstNumeric = normalizeSheetNumberValue(firstText);
      const secondNumeric = normalizeSheetNumberValue(secondText);

      const pair =
        firstPrefix &&
        /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(secondNumeric)
          ? {
              prefix: firstPrefix,
              suffix: secondNumeric,
              prefixItem: firstItem,
              suffixItem: secondItem,
            }
          : secondPrefix &&
              /^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(firstNumeric)
            ? {
                prefix: secondPrefix,
                suffix: firstNumeric,
                prefixItem: secondItem,
                suffixItem: firstItem,
              }
            : null;

      if (!pair) {
        continue;
      }

      const gap =
        pair.suffixItem.normX - (pair.prefixItem.normX + pair.prefixItem.normWidth);
      if (gap < -0.005 || gap > 0.03) {
        continue;
      }

      const value = normalizeSheetNumberValue(`${pair.prefix}${pair.suffix}`);
      if (!/^[A-Z]{1,3}\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(value)) {
        continue;
      }

      const score =
        226 +
        getRegionTrustScore(
          Math.min(pair.prefixItem.normX, pair.suffixItem.normX),
          Math.min(pair.prefixItem.normY, pair.suffixItem.normY)
        ) +
        Math.max(0, 18 - Math.round(gap * 1200));

      if (!best || score > best.score) {
        best = {
          value,
          score,
          lineIndex,
          normX: Math.min(pair.prefixItem.normX, pair.suffixItem.normX),
          normY: Math.min(pair.prefixItem.normY, pair.suffixItem.normY),
          normWidth:
            Math.max(
              pair.prefixItem.normX + pair.prefixItem.normWidth,
              pair.suffixItem.normX + pair.suffixItem.normWidth
            ) - Math.min(pair.prefixItem.normX, pair.suffixItem.normX),
          normHeight:
            Math.max(
              pair.prefixItem.normY + pair.prefixItem.normHeight,
              pair.suffixItem.normY + pair.suffixItem.normHeight
            ) - Math.min(pair.prefixItem.normY, pair.suffixItem.normY),
          width: Math.max(pair.prefixItem.width, pair.suffixItem.width),
          height: Math.max(pair.prefixItem.height, pair.suffixItem.height),
          lineText: line.text,
          isNumericOnly: false,
          prefix: getCandidatePrefix(value),
        };
      }
    }
  });

  return best;
}

function findBestNoisyInlinePrefixedSheetNumber(
  lines: TextLine[]
): SheetNumberCandidate | null {
  let best: SheetNumberCandidate | null = null;
  const allowedIntermediateTokens = new Set([
    "SCALE",
    "AS",
    "INDICATED",
    "NOTED",
    "NTS",
    "SHEET",
    "NUMBER",
    "#",
    ":",
    "-",
  ]);

  lines.forEach((line, lineIndex) => {
    if (isPageCountFooterSourceText(line.text)) {
      return;
    }
    for (let prefixIndex = 0; prefixIndex < line.items.length; prefixIndex += 1) {
      const prefixItem = line.items[prefixIndex];
      if (!prefixItem) continue;
      const prefixText = normalizeWhitespace(prefixItem.text).toUpperCase();
      const prefix = prefixText.match(/^[A-Z]{1,3}$/)?.[0] ?? "";
      if (!prefix) {
        continue;
      }

      for (
        let suffixIndex = prefixIndex + 1;
        suffixIndex < Math.min(line.items.length, prefixIndex + 6);
        suffixIndex += 1
      ) {
        const suffixItem = line.items[suffixIndex];
        if (!suffixItem) continue;
        const suffixText = normalizeWhitespace(suffixItem.text).toUpperCase();
        const suffix = normalizeSheetNumberValue(suffixText);
        if (!/^\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(suffix)) {
          continue;
        }

        const intermediate = line.items
          .slice(prefixIndex + 1, suffixIndex)
          .map((item) => normalizeWhitespace(item.text).toUpperCase())
          .filter(Boolean);
        if (
          intermediate.some(
            (token) =>
              !allowedIntermediateTokens.has(token) &&
              !/^[:#.\-]$/.test(token)
          )
        ) {
          continue;
        }

        const value = normalizeSheetNumberValue(`${prefix}${suffix}`);
        if (!/^[A-Z]{1,3}\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(value)) {
          continue;
        }

        const gap =
          suffixItem.normX - (prefixItem.normX + prefixItem.normWidth);
        if (gap < -0.005 || gap > 0.12) {
          continue;
        }

        const score =
          238 +
          getRegionTrustScore(
            Math.min(prefixItem.normX, suffixItem.normX),
            Math.min(prefixItem.normY, suffixItem.normY)
          ) +
          Math.max(0, 16 - intermediate.length * 4) +
          Math.max(0, 20 - Math.round(gap * 600));

        if (!best || score > best.score) {
          best = {
            value,
            score,
            lineIndex,
            normX: Math.min(prefixItem.normX, suffixItem.normX),
            normY: Math.min(prefixItem.normY, suffixItem.normY),
            normWidth:
              Math.max(
                prefixItem.normX + prefixItem.normWidth,
                suffixItem.normX + suffixItem.normWidth
              ) - Math.min(prefixItem.normX, suffixItem.normX),
            normHeight:
              Math.max(
                prefixItem.normY + prefixItem.normHeight,
                suffixItem.normY + suffixItem.normHeight
              ) - Math.min(prefixItem.normY, suffixItem.normY),
            width: Math.max(prefixItem.width, suffixItem.width),
            height: Math.max(prefixItem.height, suffixItem.height),
            lineText: line.text,
            isNumericOnly: false,
            prefix: getCandidatePrefix(value),
          };
        }
      }
    }
  });

  return best;
}

function findDirectCornerStampSheetNumber(
  lines: TextLine[]
): SheetNumberCandidate | null {
  let best: SheetNumberCandidate | null = null;

  lines.forEach((line, lineIndex) => {
    if (line.normX < 0.72 || line.normY < 0.64) {
      return;
    }
    const rawText = normalizeWhitespace(line.text);
    const normalized = rawText.toUpperCase();
    const compactValue = normalizeCompactStampSheetNumberCandidate(rawText);
    if (compactValue) {
      const score =
        268 +
        getRegionTrustScore(line.normX, line.normY) +
        (rawText !== compactValue ? 10 : 0);
      if (!best || score > best.score) {
        best = {
          value: compactValue,
          score,
          lineIndex,
          normX: line.normX,
          normY: line.normY,
          normWidth: line.normWidth,
          normHeight: line.normHeight,
          width: line.width,
          height: line.height,
          lineText: line.text,
          isNumericOnly: false,
          prefix: getCandidatePrefix(compactValue),
        };
      }
      return;
    }

    const match = normalized.match(
      /^([A-Z]{1,3})\s+(\d{1,3}(?:\.\d{1,3})?[A-Z]?)$/
    );
    if (!match) {
      return;
    }

    const value = normalizeSheetNumberValue(`${match[1]}${match[2]}`);
    if (!/^[A-Z]{1,3}\d{1,3}(?:\.\d{1,3})?[A-Z]?$/.test(value)) {
      return;
    }

    const score = 260 + getRegionTrustScore(line.normX, line.normY);
    if (!best || score > best.score) {
      best = {
        value,
        score,
        lineIndex,
        normX: line.normX,
        normY: line.normY,
        normWidth: line.normWidth,
        normHeight: line.normHeight,
        width: line.width,
        height: line.height,
        lineText: line.text,
        isNumericOnly: false,
        prefix: getCandidatePrefix(value),
      };
    }
  });

  return best ?? findBestNoisyInlinePrefixedSheetNumber(lines);
}

function buildDirectCompactStampSheetNumberCandidates(lines: TextLine[]) {
  return lines
    .map((line, lineIndex): SheetNumberCandidate | null => {
      if (line.normX < 0.72 || line.normY < 0.64) {
        return null;
      }
      const value = normalizeCompactStampSheetNumberCandidate(line.text);
      if (!value) {
        return null;
      }
      return {
        value,
        score:
          268 +
          getRegionTrustScore(line.normX, line.normY) +
          (normalizeWhitespace(line.text) !== value ? 10 : 0),
        lineIndex,
        normX: line.normX,
        normY: line.normY,
        normWidth: line.normWidth,
        normHeight: line.normHeight,
        width: line.width,
        height: line.height,
        lineText: line.text,
        isNumericOnly: false,
        prefix: getCandidatePrefix(value),
      };
    })
    .filter((candidate): candidate is SheetNumberCandidate => Boolean(candidate));
}

function normalizeCompactStampSheetNumberCandidate(text: string) {
  const raw = normalizeWhitespace(text);
  // Some vector PDFs expose a tiny mark before the real compact sheet code
  // as a lowercase "i" (for example "iM001" or "iPD201B"). Treat only that
  // exact lowercase artifact as noise so true uppercase I-series sheets remain valid.
  const artifactPrefixed = raw.match(
    /^i([A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?)$/
  );
  if (artifactPrefixed?.[1]) {
    const value = normalizeSheetNumberValue(artifactPrefixed[1]);
    if (isSheetNumberValue(value)) {
      return value;
    }
  }

  const direct = normalizeSheetNumberValue(raw);
  if (
    isSheetNumberValue(direct) &&
    /^[A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?$/.test(direct)
  ) {
    return direct;
  }

  return null;
}

function matchesTitleLikeVocabulary(text: string) {
  return matchesTitleLikeVocabularyBase(text);
}

function countTitleVocabularyHits(text: string) {
  return countTitleVocabularyHitsBase(text);
}

function matchesProjectBrandingVocabulary(text: string) {
  return matchesProjectBrandingVocabularyBase(text);
}

function normalizeOcrTitleCandidateText(text: string) {
  return normalizeOcrTitleCandidateTextBase(text);
}

function isAllowedSingleWordTitle(text: string) {
  return (
    isAllowedSingleWordTitleBase(text) ||
    /^(?:RCP|RISER|DOCUMENTATION|COMPLIANCE|SPECIFICATIONS?)$/i.test(
      normalizeWhitespace(text)
    )
  );
}

function isMetadataBoxTitleFragment(text: string) {
  return isMetadataBoxTitleFragmentBase(text);
}

function isCompactStampContinuationFragment(text: string) {
  return isCompactStampContinuationFragmentBase(text);
}

function isMetadataBoxFooterLine(text: string) {
  return isMetadataBoxFooterLineBase(text);
}

function getTitleRejectPenalty(text: string, line: TextLine) {
  let penalty = 0;
  const normalized = normalizeWhitespace(text);
  const titleVocabularyHits = countTitleVocabularyHits(normalized);
  const canonicalSheetIndexTitle = isCanonicalSheetIndexTitle(normalized);

  if (
    /\b(open source|license|contact person|all rights reserved|copyright)\b/i.test(
      normalized
    )
  ) {
    penalty -= 120;
  }

  if (
    matchesProjectBrandingVocabulary(normalized) ||
    /\b20\d{2}[./-]\d{2}[./-]\d{2}\b/.test(normalized)
  ) {
    penalty -= 180;
  }

  if (
    /^\[\s*sheet\s*title\s*\]/i.test(normalized) ||
    /\b(sheet no\.?|sheet number|drawing no\.?|drawing number)\b/i.test(normalized)
  ) {
    penalty -= 180;
  }

  if (
    /\b(?:suite|road|rd\.?|avenue|ave\.?|street|st\.?|berkeley|california)\b/i.test(
      normalized
    ) &&
    /\b[A-Z][a-z]+,\s*[A-Z]{2}(?:\s+\d{5})?\b/.test(normalized)
  ) {
    penalty -= 180;
  }

  if (/\b(kg|xps|extruded|polyiso|polyo|psi|r-\d+)\b/i.test(normalized)) {
    penalty -= 110;
  }

  if (
    /(\d+'\s*-\s*\d+")|(\d+\s*\/\s*[A-Z]?\d+)|(\bsee\s+\S+)/i.test(normalized) ||
    (/@\s*[A-Za-z]/i.test(normalized) && titleVocabularyHits === 0)
  ) {
    penalty -= 90;
  }

  if (
    hasStandaloneStructuralAnnotationVocabulary(normalized) &&
    !hasExplicitTitleFamily(normalized) &&
    !hasCompactTechnicalTitleSignal(normalized)
  ) {
    penalty -= 48;
  }

  if (
    /[,:;]/.test(normalized) &&
    countWords(normalized) >= 6 &&
    !canonicalSheetIndexTitle
  ) {
    penalty -= 55;
  }

  if (
    /\b(and|the|based on|depicted|temporary|fictional|person|slab)\b/i.test(
      normalized
    ) &&
    !canonicalSheetIndexTitle
  ) {
    penalty -= 32;
  }

  penalty += getTextualTitleRejectPenalty(normalized);

  if (/^[A-Z]\s/.test(normalized) && countWords(normalized) <= 3) {
    penalty -= 90;
  }

  if (
    titleVocabularyHits === 0 &&
    !hasExplicitTitleFamily(normalized) &&
    !hasCompactTechnicalTitleSignal(normalized) &&
    /\b(thickness|structural|brick|insulation|concrete|wall|stem|grade|painted|molding|metal|galvalume|sconce|manufacturer|model|plate|rail|joist|panels?|footing|slab|crown)\b/i.test(
      normalized
    )
  ) {
    penalty -= 96;
  }

  if (countWords(normalized) === 1 && !isAllowedSingleWordTitle(normalized)) {
    penalty -= 72;
  }

  if (isLowTrustInterior(line) && !matchesTitleLikeVocabulary(normalized)) {
    penalty -= 38;
  }

  return penalty;
}

function isWithinLocalTitleBlockRegion(line: TextLine, winner: SheetNumberCandidate) {
  if (!isAllowedEdgeMetadataLine(line)) {
    return false;
  }

  const horizontalDistance = Math.abs(line.normX - winner.normX);
  const verticalDistance = winner.normY - line.normY;
  const winnerOnRight = winner.normX >= 0.62;
  const winnerOnBottom = winner.normY >= 0.68;
  const winnerOnLeft = winner.normX <= 0.28;
  const winnerTopRight = winner.normX >= 0.62 && winner.normY <= 0.24;

  if (winnerTopRight) {
    return (
      line.normX >= 0.5 &&
      line.normY <= 0.34 &&
      horizontalDistance <= 0.2 &&
      verticalDistance >= -0.02 &&
      verticalDistance <= 0.3
    );
  }

  if (winnerOnRight) {
    return (
      line.normX >= 0.48 &&
      horizontalDistance <= 0.22 &&
      verticalDistance >= -0.03 &&
      verticalDistance <= 0.42
    );
  }

  if (winnerOnBottom) {
    return (
      line.normY >= 0.52 &&
      horizontalDistance <= 0.34 &&
      verticalDistance >= -0.03 &&
      verticalDistance <= 0.34
    );
  }

  if (winnerOnLeft) {
    return (
      line.normX <= 0.38 &&
      horizontalDistance <= 0.22 &&
      verticalDistance >= -0.03 &&
      verticalDistance <= 0.42
    );
  }

  return (
    horizontalDistance <= 0.18 &&
    verticalDistance >= -0.03 &&
    verticalDistance <= 0.28
  );
}

function scoreTitleCandidate(
  line: TextLine,
  page: PageExtractionModel,
  winner: SheetNumberCandidate | null,
  repeatedLineCounts: Record<string, number>,
  totalPages: number
) {
  if (!isLikelySheetTitle(line.text)) {
    return -Infinity;
  }

  if (!isAllowedEdgeMetadataLine(line)) {
    return -Infinity;
  }

  const normalizedText = normalizeWhitespace(line.text);
  if (
    NON_TITLE_FIELD_LABEL_PATTERN.test(normalizedText) ||
    matchesAdministrativeTitleMetadata(normalizedText)
  ) {
    return -Infinity;
  }

  const normalized = normalizeKey(line.text);
  let score = getRegionTrustScore(line.normX, line.normY);
  const stats = getWordStats(line.text);
  const titleVocabularyHits = countTitleVocabularyHits(line.text);
  const lineIndex = page.lines.indexOf(line);
  const titleLabelMatch = findLabelRelationship(page.lines, lineIndex, TITLE_LABEL_PATTERN);
  const numberLabelNearby = hasNearbyLabel(page.lines, lineIndex, SHEET_NUMBER_LABEL_PATTERN, {
    before: 2,
    after: 1,
  });
  const nonTitleFieldNearby = hasNearbyLabel(
    page.lines,
    lineIndex,
    NON_TITLE_FIELD_LABEL_PATTERN,
    {
      before: 1,
      after: 1,
    }
  );

  if (winner && normalized === normalizeKey(winner.value)) {
    return -Infinity;
  }

  if (line.normY > 0.58) {
    score += 16;
  }

  if (line.normX > 0.42) {
    score += 12;
  }

  if (winner) {
    const lineDistance = Math.abs(lineIndex - winner.lineIndex);
    if (lineDistance <= 2) {
      score += 32;
    } else if (lineDistance <= 4) {
      score += 16;
    } else if (lineDistance >= 7) {
      score -= 24;
    }

    const verticalDistance = Math.abs(line.normY - winner.normY);
    if (verticalDistance <= 0.08) {
      score += 18;
    } else if (verticalDistance > 0.16) {
      score -= 22;
    }

    const horizontalDistance = Math.abs(line.normX - winner.normX);
    if (horizontalDistance <= 0.06) {
      score += 34;
    } else if (horizontalDistance <= 0.14) {
      score += 14;
    } else if (horizontalDistance > 0.22) {
      score -= 26;
    }

    if (line.normY < winner.normY && verticalDistance <= 0.12) {
      score += 28;
    }

    if (line.normY > winner.normY && verticalDistance <= 0.08) {
      score -= 6;
    }

    const widthRatio = winner.width > 0 ? line.width / winner.width : 1;
    if (widthRatio >= 0.45 && widthRatio <= 1.9) {
      score += 12;
    } else if (widthRatio > 3.4) {
      score -= 26;
    }

    const heightRatio = winner.height > 0 ? line.height / winner.height : 1;
    if (heightRatio >= 0.18 && heightRatio <= 0.8) {
      score += 20;
    } else if (heightRatio > 1.1) {
      score -= 18;
    }

    if (titleLabelMatch && titleLabelMatch.position === "above") {
      score += 36;
      if (verticalDistance > 0.16 && verticalDistance <= 0.34) {
        score += 20;
      }
      if (Math.abs(line.normX - winner.normX) <= 0.1) {
        score += 16;
      }
    }

    if (isWithinLocalTitleBlockRegion(line, winner)) {
      score += 42;
    } else {
      score -= 28;
    }
  }

  const repeatedCount = repeatedLineCounts[normalized] ?? 0;
  if (repeatedCount > 1) {
    const repeatedRatio = repeatedCount / Math.max(totalPages, 1);
    score -= repeatedRatio > 0.45 ? 60 : 20;
  }

  if (stats.wordCount >= 1 && stats.wordCount <= 4) {
    score += 24;
  } else if (stats.wordCount <= 7) {
    score += 10;
  } else if (stats.wordCount >= 10) {
    score -= 26;
  }

  if (line.text.length >= 12 && line.text.length <= 70) {
    score += 12;
  } else if (line.text.length > 90) {
    score -= 18;
  }

  if (/(plan|roof|site|elevation|detail|section|legend|overview)/i.test(line.text)) {
    score += 10;
  }

  if (matchesTitleLikeVocabulary(line.text)) {
    score += 18;
  }

  score += Math.min(titleVocabularyHits * 14, 42);

  if (stats.isUppercaseLike) {
    score += 22;
  }

  if (titleLabelMatch) {
    score += titleLabelMatch.position === "above" ? 72 : 24;
  }

  if (numberLabelNearby) {
    score -= 24;
  }

  if (nonTitleFieldNearby) {
    score -= 40;
  }

  if (stats.uniqueRatio < 0.75) {
    score -= 34;
  }

  if (/[,:;]/.test(line.text)) {
    score -= 18;
  }

  if (/\b(temporary|operations|bedroom|bath|typ|typical)\b/i.test(line.text)) {
    score -= 10;
  }

  score += getTitleRejectPenalty(line.text, line);

  return score;
}

function buildStackedTitleCandidates(
  page: PageExtractionModel,
  winner: SheetNumberCandidate | null,
  repeatedLineCounts: Record<string, number>,
  totalPages: number
) {
  const candidates: TitleCandidate[] = [];

  if (!winner) {
    return candidates;
  }

  for (let index = 0; index < page.lines.length - 1; index += 1) {
    const first = page.lines[index];
    const second = page.lines[index + 1];

    if (!isAllowedEdgeMetadataLine(first) || !isAllowedEdgeMetadataLine(second)) {
      continue;
    }

    if (!isWithinLocalTitleBlockRegion(first, winner) || !isWithinLocalTitleBlockRegion(second, winner)) {
      continue;
    }

    if (Math.abs(first.normX - second.normX) > 0.08) {
      continue;
    }

    if (Math.abs(first.top - second.top) > Math.max(first.height, second.height) * 3.6) {
      continue;
    }

    if (second.normY > winner.normY + 0.02) {
      continue;
    }

    const combinedText = normalizeWhitespace(`${first.text} ${second.text}`);
    if (!isLikelySheetTitle(combinedText)) {
      continue;
    }

    const baseScore =
      (scoreTitleCandidate(first, page, winner, repeatedLineCounts, totalPages) +
        scoreTitleCandidate(second, page, winner, repeatedLineCounts, totalPages)) /
      2;

    let score = baseScore + 26;

    if (countWords(combinedText) > 8) {
      score -= 18;
    }

    if (matchesTitleLikeVocabulary(combinedText)) {
      score += 12;
    }

    score += getTitleRejectPenalty(combinedText, first);

    candidates.push({
      text: combinedText,
      sourceText: `${first.text}\n${second.text}`,
      score,
      lineIndex: index,
    });
  }

  return candidates;
}

function buildInlineWinnerTitleCandidates(
  page: PageExtractionModel,
  winner: SheetNumberCandidate | null,
  repeatedLineCounts: Record<string, number>,
  totalPages: number
) {
  if (!winner) {
    return [] satisfies TitleCandidate[];
  }

  const winnerText = winner.value.toUpperCase();
  const candidates: TitleCandidate[] = [];

  page.lines.forEach((line, lineIndex) => {
    if (!isAllowedEdgeMetadataLine(line)) {
      return;
    }

    const upperText = line.text.toUpperCase();
    const winnerIndex = upperText.lastIndexOf(winnerText);
    if (winnerIndex < 0) {
      return;
    }

    const tail = normalizeWhitespace(
      line.text.slice(winnerIndex + winner.value.length).replace(/^[:#.\-\s]+/, "")
    );
    if (!tail) {
      return;
    }

    if (
      !isLikelySheetTitle(tail) ||
      isSuspiciousDetectedTitle(tail) ||
      countSheetReferenceTokens(tail) >= 1
    ) {
      return;
    }

    const stats = getWordStats(tail);
    const repeatedCount = repeatedLineCounts[normalizeKey(tail)] ?? 0;
    let score =
      getRegionTrustScore(line.normX, line.normY) +
      92 +
      countTitleVocabularyHits(tail) * 18 +
      getTitleRejectPenalty(tail, line);

    if (matchesTitleLikeVocabulary(tail)) {
      score += 24;
    }

    if (stats.isUppercaseLike) {
      score += 18;
    }

    if (stats.wordCount >= 2 && stats.wordCount <= 8) {
      score += 14;
    } else if (stats.wordCount > 10) {
      score -= 18;
    }

    if (repeatedCount > 1) {
      const repeatedRatio = repeatedCount / Math.max(totalPages, 1);
      score -= repeatedRatio > 0.45 ? 60 : 20;
    }

    candidates.push({
      text: tail,
      sourceText: line.text,
      score,
      lineIndex,
    });
  });

  return candidates.sort((a, b) => b.score - a.score);
}

function titleCandidateHasCompetingSheetReference(
  candidate: TitleCandidate | null,
  winner: SheetNumberCandidate | null
) {
  if (!candidate || !winner) {
    return false;
  }

  const winnerValue = normalizeSheetNumberValue(winner.value);
  const matches =
    candidate.sourceText.match(
      /\b((?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS)\b/g
    ) ?? [];

  return matches
    .map((match) => normalizeSheetNumberValue(match))
    .filter(Boolean)
    .some((value) => value !== winnerValue);
}

function detectSheetTitle(
  page: PageExtractionModel,
  winner: SheetNumberCandidate | null,
  repeatedLineCounts: Record<string, number>,
  totalPages: number
): DetectedSheetTitle {
  const labeledMatch = findBestLabeledTitle(page.lines, winner);
  if (labeledMatch && labeledMatch.score >= 120) {
    return {
      title: labeledMatch.value,
      sourceText: page.lines[labeledMatch.lineIndex]?.text ?? labeledMatch.value,
      lineIndex: labeledMatch.lineIndex,
    };
  }

  const localRanked = page.lines
    .filter(
      (line) =>
        isAllowedEdgeMetadataLine(line) &&
        (!winner || isWithinLocalTitleBlockRegion(line, winner))
    )
    .map((line) => ({
      line,
      score: scoreTitleCandidate(line, page, winner, repeatedLineCounts, totalPages),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score);

  const stackedCandidates = buildStackedTitleCandidates(
    page,
    winner,
    repeatedLineCounts,
    totalPages
  );

  const localBestLine = localRanked[0]
    ? {
        text: localRanked[0].line.text,
        sourceText: localRanked[0].line.text,
        score: localRanked[0].score + 18,
        lineIndex: page.lines.indexOf(localRanked[0].line),
      }
    : null;
  const localBestStacked = [...stackedCandidates].sort((a, b) => b.score - a.score)[0] ?? null;
  const inlineWinnerTitle = buildInlineWinnerTitleCandidates(
    page,
    winner,
    repeatedLineCounts,
    totalPages
  )[0] ?? null;
  const bestLocalCandidate = [localBestLine, localBestStacked]
    .filter((candidate): candidate is TitleCandidate => Boolean(candidate))
    .sort((a, b) => b.score - a.score)[0];
  const bestLocal =
    inlineWinnerTitle &&
    (titleCandidateHasCompetingSheetReference(bestLocalCandidate, winner) ||
      !bestLocalCandidate ||
      inlineWinnerTitle.score >= bestLocalCandidate.score - 16)
      ? inlineWinnerTitle
      : bestLocalCandidate;

  if (bestLocal && bestLocal.score >= 28) {
    return {
      title: bestLocal.text,
      sourceText: bestLocal.sourceText,
      lineIndex: bestLocal.lineIndex ?? null,
    };
  }

  const ranked = page.lines
    .filter((line) => isAllowedEdgeMetadataLine(line))
    .map((line) => ({
      line,
      score: scoreTitleCandidate(line, page, winner, repeatedLineCounts, totalPages),
    }))
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  if (!best || best.score < 20) {
    return {
      title: "",
      sourceText: "",
      lineIndex: null,
    };
  }

  return {
    title: best.line.text,
    sourceText: best.line.text,
    lineIndex: page.lines.indexOf(best.line),
  };
}

function buildPairedClusterId(
  regionId: MetadataRegionId,
  numberLineIndex: number | null,
  titleLineIndex: number | null
) {
  return `${regionId}:${numberLineIndex ?? "n"}:${titleLineIndex ?? "t"}`;
}

function shouldApplyRightMetadataSeparator(bounds: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const right = bounds.x + bounds.width;
  return right >= 0.94 && bounds.y >= 0.74 && bounds.height <= 0.28;
}

type DetectedRightMetadataColumn = {
  leftX: number;
  rightX: number;
  separatorX: number;
  signalCount: number;
};

const detectedRightMetadataColumnCache = new WeakMap<
  PageExtractionModel,
  DetectedRightMetadataColumn | null
>();

function shouldTryAdaptiveMetadataColumn(regionId?: MetadataRegionId) {
  return (
    regionId === "sheetStamp" ||
    regionId === "titleBlock" ||
    regionId === "titleTall" ||
    regionId === "numberBlock" ||
    regionId === "bottomRight"
  );
}

function isMetadataColumnSignalLine(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }

  return (
    TITLE_LABEL_PATTERN.test(normalized) ||
    SHEET_NUMBER_LABEL_PATTERN.test(normalized) ||
    NON_TITLE_FIELD_LABEL_PATTERN.test(normalized) ||
    /\b(?:job\s*#?|project number|sheet\s*#|drawn|checked|scale|revision|architect|consultants?)\b/i.test(
      normalized
    ) ||
    isCoverSheetTitleSignal(normalized) ||
    isTitle24FamilyTitleSignal(normalized) ||
    hasExplicitTitleFamily(normalized) ||
    /^[A-Z]{1,4}\d[\w.\-]*$/i.test(normalized)
  );
}

function findRightMetadataSeparatorX(
  page: PageExtractionModel,
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  items: PositionedTextItem[]
) {
  if (!shouldApplyRightMetadataSeparator(bounds) || !page.drawingSegments?.length) {
    return null;
  }

  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const candidateLeft = Math.max(0.52, bounds.x - 0.35);
  const candidateRight = right - 0.02;
  if (candidateRight <= candidateLeft) {
    return null;
  }

  const verticalItems = items.filter((item) => {
    const centerY = item.normY + item.normHeight / 2;
    return centerY >= bounds.y && centerY <= bottom;
  });

  const verticalSegments = page.drawingSegments
    .map((segment) => {
      const dx = Math.abs(segment.normX1 - segment.normX0);
      const dy = Math.abs(segment.normY1 - segment.normY0);
      const x = (segment.normX0 + segment.normX1) / 2;
      const top = Math.min(segment.normY0, segment.normY1);
      const segmentBottom = Math.max(segment.normY0, segment.normY1);
      const overlap =
        Math.min(segmentBottom, bottom) - Math.max(top, bounds.y);

      return {
        segment,
        dx,
        dy,
        x,
        overlap: Math.max(overlap, 0),
      };
    })
    .filter(({ dx, dy, x, overlap }) => {
      if (x < candidateLeft || x > candidateRight) {
        return false;
      }
      if (dy < Math.max(bounds.height * 0.55, 0.12)) {
        return false;
      }
      if (dx > Math.min(0.012, dy / 5)) {
        return false;
      }
      return overlap >= Math.max(bounds.height * 0.55, 0.1);
    })
    .map((entry) => {
      const leftCount = verticalItems.filter((item) => {
        const centerX = item.normX + item.normWidth / 2;
        return centerX < entry.x && centerX >= entry.x - 0.28;
      }).length;
      const rightCount = verticalItems.filter((item) => {
        const centerX = item.normX + item.normWidth / 2;
        return centerX > entry.x && centerX <= right;
      }).length;

      return {
        ...entry,
        leftCount,
        rightCount,
      };
    })
    .filter(({ leftCount, rightCount }) => leftCount >= 3 && rightCount >= 3)
    .sort((left, rightEntry) => {
      const xDelta = left.x - rightEntry.x;
      if (Math.abs(xDelta) > 0.002) {
        return xDelta;
      }

      const overlapDelta = rightEntry.overlap - left.overlap;
      if (Math.abs(overlapDelta) > 0.002) {
        return overlapDelta;
      }

      const widthDelta =
        (rightEntry.segment.width ?? 0) - (left.segment.width ?? 0);
      if (Math.abs(widthDelta) > 0.05) {
        return widthDelta;
      }

      return rightEntry.dy - left.dy;
    });

  return verticalSegments[0]?.x ?? null;
}

function getPageSearchItems(page: PageExtractionModel) {
  return (page.searchLines ?? page.lines).flatMap((line) => line.items);
}

function detectRightMetadataColumn(page: PageExtractionModel) {
  if (detectedRightMetadataColumnCache.has(page)) {
    return detectedRightMetadataColumnCache.get(page) ?? null;
  }

  const searchBounds = {
    x: 0.64,
    y: 0,
    width: 0.36,
    height: 1,
  };
  const searchItems = getPageSearchItems(page).filter((item) => {
    const centerX = item.normX + item.normWidth / 2;
    const centerY = item.normY + item.normHeight / 2;
    return (
      centerX >= searchBounds.x &&
      centerX <= searchBounds.x + searchBounds.width &&
      centerY >= searchBounds.y &&
      centerY <= searchBounds.y + searchBounds.height
    );
  });

  if (searchItems.length === 0) {
    detectedRightMetadataColumnCache.set(page, null);
    return null;
  }

  const separatorX = findRightMetadataSeparatorX(page, searchBounds, searchItems);
  if (separatorX === null) {
    detectedRightMetadataColumnCache.set(page, null);
    return null;
  }

  const searchLines = page.searchLines ?? page.lines;
  const linesToRight = searchLines.filter((line) => {
    const centerX = getLineCenterX(line);
    return centerX >= separatorX + 0.006 && centerX <= 0.995;
  });

  const signalLines = linesToRight.filter((line) => isMetadataColumnSignalLine(line.text));
  const bottomSignalLines = signalLines.filter((line) => line.normY >= 0.72);
  const prominentBottomLines = linesToRight.filter((line) => {
    const normalized = normalizeWhitespace(line.text);
    return (
      line.normY >= 0.72 &&
      (
        isMetadataColumnSignalLine(normalized) ||
        guessSheetNumberCandidateType(normalized, normalized) === "sheet_number"
      )
    );
  });

  if (signalLines.length < 2 || bottomSignalLines.length < 1 || prominentBottomLines.length < 2) {
    detectedRightMetadataColumnCache.set(page, null);
    return null;
  }

  const rightAlignedItems = searchItems.filter((item) => {
    const centerX = item.normX + item.normWidth / 2;
    return centerX >= separatorX + 0.006;
  });
  const rightX = Math.min(
    Math.max(
      ...rightAlignedItems.map((item) => item.normX + item.normWidth),
      ...linesToRight.map((line) => getLineRight(line)),
      separatorX + 0.12
    ) + 0.01,
    0.995
  );
  const column = {
    leftX: Math.max(separatorX + 0.004, 0.6),
    rightX: Math.max(rightX, separatorX + 0.14),
    separatorX,
    signalCount: signalLines.length,
  } satisfies DetectedRightMetadataColumn;

  detectedRightMetadataColumnCache.set(page, column);
  return column;
}

function getAdaptiveMetadataBoundsForRegion(
  page: PageExtractionModel,
  regionId: MetadataRegionId
) {
  const column = detectRightMetadataColumn(page);
  if (!column) {
    return null;
  }

  const columnWidth = Math.max(column.rightX - column.leftX, 0.12);
  const fullRight = Math.min(column.rightX + 0.006, 0.998);

  switch (regionId) {
    case "titleBlock":
      return {
        x: column.leftX,
        y: 0.84,
        width: Math.max(fullRight - column.leftX, 0.12),
        height: 0.12,
      };
    case "titleTall":
      return {
        x: column.leftX,
        y: 0.804,
        width: Math.max(fullRight - column.leftX, 0.12),
        height: 0.156,
      };
    case "sheetStamp":
      return {
        x: Math.max(column.leftX + columnWidth * 0.48, column.leftX),
        y: 0.908,
        width: Math.max(columnWidth * 0.52, 0.075),
        height: 0.074,
      };
    case "numberBlock":
      return {
        x: Math.max(column.leftX + columnWidth * 0.16, column.leftX),
        y: 0.83,
        width: Math.max(columnWidth * 0.72, 0.11),
        height: 0.14,
      };
    case "bottomRight":
      return {
        x: Math.max(column.leftX - 0.06, 0.6),
        y: 0.74,
        width: Math.min(1 - Math.max(column.leftX - 0.06, 0.6), columnWidth + 0.08),
        height: 0.24,
      };
    default:
      return null;
  }
}

function hasUsablePdfMetadataText(page: {
  width: number;
  height: number;
  words: Array<{
    text: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }>;
  searchWords?: Array<{
    text: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }> | null;
}) {
  const regions = [
    getMetadataRegionById("stripFull"),
    getMetadataRegionById("stripTitle"),
    getMetadataRegionById("stripNumber"),
    getMetadataRegionById("sheetStamp"),
    getMetadataRegionById("numberBlock"),
    getMetadataRegionById("titleBlock"),
    getMetadataRegionById("titleTall"),
    getMetadataRegionById("bottomRight"),
  ].filter(Boolean);

  if (regions.length === 0) {
    return (page.searchWords?.length ?? page.words.length) > 0;
  }

  const sourceWords = page.searchWords?.length ? page.searchWords : page.words;
  const metadataWords = sourceWords.filter((word) => {
    const centerX = ((word.x0 + word.x1) / 2) / Math.max(page.width, 1);
    const centerY = ((word.y0 + word.y1) / 2) / Math.max(page.height, 1);
    return regions.some(
      (region) =>
        centerX >= region!.x &&
        centerX <= region!.x + region!.width &&
        centerY >= region!.y &&
        centerY <= region!.y + region!.height
    );
  });

  if (metadataWords.length === 0) {
    return false;
  }

  const positionedItems = metadataWords.map((word) => ({
    text: word.text,
    x: word.x0,
    top: word.y0,
    width: Math.max(word.x1 - word.x0, 0.0001),
    height: Math.max(word.y1 - word.y0, 0.0001),
    normX: word.x0 / Math.max(page.width, 1),
    normY: word.y0 / Math.max(page.height, 1),
    normWidth: Math.max(word.x1 - word.x0, 0.0001) / Math.max(page.width, 1),
    normHeight: Math.max(word.y1 - word.y0, 0.0001) / Math.max(page.height, 1),
  }));
  const metadataLines = buildTextLinesFromPositionedItems(positionedItems);
  const hasTrustedTitleLabel = metadataLines.some(
    (line) => classifyMetadataFieldKind(line.text) === "title"
  );
  const hasTrustedNumberLabel = metadataLines.some(
    (line) => classifyMetadataFieldKind(line.text) === "sheet_number"
  );
  const hasTrustedFieldValue = (
    fieldKind: "title" | "sheet_number"
  ) => {
    for (let index = 0; index < metadataLines.length; index += 1) {
      const line = metadataLines[index];
      if (!line || classifyMetadataFieldKind(line.text) !== fieldKind) {
        continue;
      }

      const inlineValue = getMetadataFieldInlineValue(line.text, fieldKind);
      if (fieldKind === "title") {
        if (normalizeLabeledTitleValue(inlineValue)) {
          return true;
        }
      } else if (isStructuredCompactSheetNumberValue(inlineValue, line.text)) {
        return true;
      }

      const labelBottom = getLineBottom(line);
      for (let cursor = index + 1; cursor < Math.min(metadataLines.length, index + 5); cursor += 1) {
        const nextLine = metadataLines[cursor];
        if (!nextLine) {
          break;
        }
        const nextKind = classifyMetadataFieldKind(nextLine.text);
        if (nextKind && nextKind !== fieldKind) {
          break;
        }
        if (Math.max(nextLine.normY - labelBottom, 0) > 0.11) {
          break;
        }

        if (fieldKind === "title") {
          const normalizedTitle = normalizeLabeledTitleValue(nextLine.text);
          if (
            normalizedTitle &&
            !NON_TITLE_FIELD_LABEL_PATTERN.test(normalizeWhitespace(nextLine.text)) &&
            (isLikelySheetTitle(normalizedTitle) ||
              hasCompactTechnicalTitleSignal(normalizedTitle) ||
              countTitleVocabularyHits(normalizedTitle) > 0)
          ) {
            return true;
          }
        } else if (
          isStructuredCompactSheetNumberValue(nextLine.text, line.text) ||
          isStructuredCompactSheetNumberValue(
            normalizeSheetNumberValue(extractSheetNumberFromText(nextLine.text) ?? ""),
            line.text
          )
        ) {
          return true;
        }
      }
    }

    return false;
  };
  const hasNearbyTitleSignal = metadataLines.some((line, index) => {
    if (classifyMetadataFieldKind(line.text) !== "title") {
      return false;
    }

    for (let cursor = index + 1; cursor < Math.min(metadataLines.length, index + 6); cursor += 1) {
      const nextLine = metadataLines[cursor];
      if (!nextLine) {
        break;
      }
      const nextKind = classifyMetadataFieldKind(nextLine.text);
      if (nextKind && nextKind !== "title" && nextKind !== "floor_level") {
        break;
      }
      if (Math.max(nextLine.normY - getLineBottom(line), 0) > 0.14) {
        break;
      }
      if (hasStructuredTitleValueSignal(nextLine.text, { allowPrefixOnly: true })) {
        return true;
      }
    }

    return false;
  });
  const hasNearbyNumberSignal = metadataLines.some((line, index) => {
    if (classifyMetadataFieldKind(line.text) !== "sheet_number") {
      return false;
    }

    for (let cursor = index + 1; cursor < Math.min(metadataLines.length, index + 5); cursor += 1) {
      const nextLine = metadataLines[cursor];
      if (!nextLine) {
        break;
      }
      const nextKind = classifyMetadataFieldKind(nextLine.text);
      if (nextKind && nextKind !== "sheet_number") {
        break;
      }
      if (Math.max(nextLine.normY - getLineBottom(line), 0) > 0.12) {
        break;
      }
      const extracted = extractSheetNumberFromText(nextLine.text);
      if (
        (extracted && isSheetNumberValue(extracted)) ||
        /^[A-Z]{1,3}\d[\w.\-]{0,6}$/i.test(normalizeWhitespace(nextLine.text))
      ) {
        return true;
      }
    }

    return false;
  });
  if (
    hasTrustedTitleLabel &&
    hasTrustedNumberLabel &&
    (!(
      hasTrustedFieldValue("title") ||
      hasNearbyTitleSignal
    ) || !(
      hasTrustedFieldValue("sheet_number") ||
      hasNearbyNumberSignal
    ))
  ) {
    return false;
  }
  const meaningfulWordCount = metadataWords.filter((word) => /[A-Za-z0-9]/.test(word.text)).length;
  const hasSheetNumber = metadataLines.some((line) => {
    const candidate = extractSheetNumberFromText(line.text);
    return Boolean(candidate && isSheetNumberValue(candidate));
  });
  const hasTitleSignal = metadataLines.some(
    (line) =>
      countTitleVocabularyHits(line.text) > 0 ||
      hasCompactTechnicalTitleSignal(line.text) ||
      isLikelySheetTitle(line.text)
  );

  return hasSheetNumber || hasTitleSignal || meaningfulWordCount >= 8;
}

function filterItemsToRegionBounds(
  page: PageExtractionModel,
  items: PositionedTextItem[],
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  regionId?: MetadataRegionId,
  options?: { ignoreSeparator?: boolean }
) {
  const separatorX = options?.ignoreSeparator
    ? null
    : findRightMetadataSeparatorX(page, bounds, items);

  return items.filter((item) => {
    const centerX = item.normX + item.normWidth / 2;
    const centerY = item.normY + item.normHeight / 2;
    const withinRect =
      centerX >= bounds.x &&
      centerX <= bounds.x + bounds.width &&
      centerY >= bounds.y &&
      centerY <= bounds.y + bounds.height;

    if (!withinRect) {
      return false;
    }

    if (separatorX !== null && centerX < separatorX + 0.004) {
      return false;
    }

    if (regionId === "bottomRight") {
      const splitX = bounds.x + bounds.width / 2;
      const splitY = bounds.y + bounds.height / 2;
      return centerX >= splitX || centerY >= splitY;
    }

    return true;
  });
}

function filterLinesToRegionBounds(
  page: PageExtractionModel,
  lines: TextLine[],
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  regionId?: MetadataRegionId,
  options?: { ignoreSeparator?: boolean }
) {
  const separatorX = options?.ignoreSeparator
    ? null
    : findRightMetadataSeparatorX(
        page,
        bounds,
        lines.flatMap((line) => line.items)
      );

  return lines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);
    const withinRect =
      centerX >= bounds.x &&
      centerX <= bounds.x + bounds.width &&
      centerY >= bounds.y &&
      centerY <= bounds.y + bounds.height;

    if (!withinRect) {
      return false;
    }

    if (separatorX !== null && centerX < separatorX + 0.004) {
      return false;
    }

    if (regionId === "bottomRight") {
      const splitX = bounds.x + bounds.width / 2;
      const splitY = bounds.y + bounds.height / 2;
      return centerX >= splitX || centerY >= splitY;
    }

    return true;
  });
}

function buildPageRegionModel(
  page: PageExtractionModel,
  region: (typeof PDF_METADATA_REGIONS)[number]
): PageExtractionModel | null {
  if (page.ocrBacked) {
    const activeOcrTitleBounds =
      region.id === "titleBlock" || region.id === "titleTall"
        ? page.ocrTitleBox ?? inferOcrLabelAnchoredTitleFieldBounds(page.searchLines ?? page.lines)
        : null;
    if (activeOcrTitleBounds) {
      const titleFieldPage = buildPageModelFromNormalizedBounds(page, activeOcrTitleBounds);
      if (titleFieldPage) {
        return titleFieldPage;
      }
    }

    let lines = filterLinesToRegionBounds(page, page.lines, region, region.id);
    if (lines.length === 0 && shouldTryAdaptiveMetadataColumn(region.id)) {
      const adaptiveBounds = getAdaptiveMetadataBoundsForRegion(page, region.id);
      if (adaptiveBounds) {
        lines = filterLinesToRegionBounds(
          page,
          page.searchLines ?? page.lines,
          adaptiveBounds,
          region.id
        );
      }
    }
    if (lines.length === 0) {
      return null;
    }

    return buildPageModelFromLines(page.pageNumber, lines, page.ocrBacked, {
      drawingSegments: page.drawingSegments,
      ocrNumberBox: page.ocrNumberBox,
      ocrTitleBox: page.ocrTitleBox,
    });
  }

  const pageItems = getPageItems(page);
  const pageSearchItems = getPageSearchItems(page);
  let items = filterItemsToRegionBounds(page, pageItems, region, region.id);
  const searchRegionItems = filterItemsToRegionBounds(
    page,
    pageSearchItems,
    region,
    region.id
  );
  const relaxedSearchRegionItems = filterItemsToRegionBounds(
    page,
    pageSearchItems,
    region,
    region.id,
    {
      ignoreSeparator: true,
    }
  );
  if (
    (searchRegionItems.length > 0 || relaxedSearchRegionItems.length > 0) &&
    (
      items.length === 0 ||
      Math.max(
        scoreMetadataRegionItems(searchRegionItems),
        scoreMetadataRegionItems(relaxedSearchRegionItems)
      ) >
        scoreMetadataRegionItems(items) + 6
    )
  ) {
    items =
      scoreMetadataRegionItems(relaxedSearchRegionItems) >
      scoreMetadataRegionItems(searchRegionItems) + 4
        ? relaxedSearchRegionItems
        : searchRegionItems.length > 0
          ? searchRegionItems
          : relaxedSearchRegionItems;
  }
  if (items.length === 0 && shouldTryAdaptiveMetadataColumn(region.id)) {
    const adaptiveBounds = getAdaptiveMetadataBoundsForRegion(page, region.id);
    if (adaptiveBounds) {
      items = filterItemsToRegionBounds(
        page,
        pageSearchItems,
        adaptiveBounds,
        region.id
      );
      if (items.length === 0) {
        items = filterItemsToRegionBounds(
          page,
          pageSearchItems,
          adaptiveBounds,
          region.id,
          {
            ignoreSeparator: true,
          }
        );
      }
    }
  }
  if (items.length === 0) {
    return null;
  }

  return buildPageModelFromItems(page.pageNumber, items);
}

function buildPageModelFromNormalizedBounds(
  page: PageExtractionModel,
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
): PageExtractionModel | null {
  if (page.ocrBacked) {
    const lines = filterLinesToRegionBounds(
      page,
      page.searchLines ?? page.lines,
      bounds
    );
    if (lines.length === 0) {
      return null;
    }

    return buildPageModelFromLines(page.pageNumber, lines, page.ocrBacked, {
      drawingSegments: page.drawingSegments,
      ocrNumberBox: page.ocrNumberBox,
      ocrTitleBox: page.ocrTitleBox,
    });
  }

  const pageItems = getPageSearchItems(page);
  const itemsWithSeparator = filterItemsToRegionBounds(page, pageItems, bounds);
  const itemsWithoutSeparator = filterItemsToRegionBounds(page, pageItems, bounds, undefined, {
    ignoreSeparator: true,
  });
  const items =
    scoreMetadataRegionItems(itemsWithoutSeparator) >
    scoreMetadataRegionItems(itemsWithSeparator) + 4
      ? itemsWithoutSeparator
      : itemsWithSeparator;

  if (items.length === 0) {
    return null;
  }

  return buildPageModelFromItems(page.pageNumber, items);
}

function buildPageModelFromLines(
  pageNumber: number,
  lines: TextLine[],
  ocrBacked = false,
  options?: {
    drawingSegments?: PageDrawingSegment[];
    ocrNumberBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    ocrTitleBox?: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
  }
) : PageExtractionModel {
  return {
    pageNumber,
    lines,
    candidates: extractSheetNumberCandidates(lines),
    drawingSegments: options?.drawingSegments,
    ocrNumberBox: options?.ocrNumberBox ?? null,
    ocrTitleBox: options?.ocrTitleBox ?? null,
    ocrBacked,
  } satisfies PageExtractionModel;
}

function buildPageModelFromItems(
  pageNumber: number,
  items: PositionedTextItem[]
): PageExtractionModel {
  return buildPageModelFromLines(pageNumber, buildTextLinesFromPositionedItems(items));
}

function getPageItems(page: PageExtractionModel) {
  return page.lines.flatMap((line) => line.items);
}

function buildPyMuPdfTitleSearchPages(args: {
  page: PageExtractionModel;
  styleProfile: Exclude<MetadataStyleProfile, "mixed">;
  numberLine: TextLine;
  fallbackTitleRegionId: MetadataRegionId;
}) {
  const numberCenterX = getLineCenterX(args.numberLine);
  const numberCenterY = getLineCenterY(args.numberLine);

  if (args.styleProfile === "bottom_right_block") {
    const bandTop = clamp(numberCenterY - 0.12, 0.78, 0.94);
    const bandBottom = clamp(numberCenterY - 0.006, bandTop + 0.045, 0.985);
    const titleTallRegion = getMetadataRegionById("titleTall");
    const fallbackRegion = getMetadataRegionById(args.fallbackTitleRegionId);
    return [
      buildPageModelFromNormalizedBounds(args.page, {
        x: 0.918,
        y: bandTop,
        width: 0.082,
        height: Math.min(bandBottom - bandTop + 0.006, 0.2),
      }),
      buildPageModelFromNormalizedBounds(args.page, {
        x: clamp(numberCenterX - 0.18, 0.76, 0.94),
        y: bandTop,
        width: 1 - clamp(numberCenterX - 0.18, 0.76, 0.94),
        height: bandBottom - bandTop,
      }),
      titleTallRegion ? buildPageRegionModel(args.page, titleTallRegion) : null,
      fallbackRegion ? buildPageRegionModel(args.page, fallbackRegion) : null,
    ].filter((candidate): candidate is PageExtractionModel => Boolean(candidate));
  }

  if (args.styleProfile === "bottom_left_block") {
    const bandTop = clamp(numberCenterY - 0.05, 0.86, 0.97);
    const bandBottom = clamp(numberCenterY + 0.03, bandTop + 0.04, 0.995);
    return [
      buildPageModelFromNormalizedBounds(args.page, {
        x: 0,
        y: bandTop,
        width: 0.12,
        height: bandBottom - bandTop,
      }),
      buildPageModelFromNormalizedBounds(args.page, {
        x: 0,
        y: bandTop,
        width: 0.18,
        height: bandBottom - bandTop,
      }),
      buildPageRegionModel(args.page, getMetadataRegionById(args.fallbackTitleRegionId)!),
    ].filter((candidate): candidate is PageExtractionModel => Boolean(candidate));
  }

  const fallbackRegion = getMetadataRegionById(args.fallbackTitleRegionId);
  return fallbackRegion
    ? [buildPageRegionModel(args.page, fallbackRegion)].filter(
        (candidate): candidate is PageExtractionModel => Boolean(candidate)
      )
    : [];
}

function buildCompactStampPageModel(page: PageExtractionModel) {
  const compactItems = getPageItems(page).filter((item) => {
    const centerX = item.normX + item.normWidth / 2;
    const centerY = item.normY + item.normHeight / 2;

    return centerX >= 0.88 && centerY >= 0.78;
  });

  if (compactItems.length === 0) {
    return null;
  }

  const compactPage = buildPageModelFromItems(page.pageNumber, compactItems);
  if (compactPage.lines.length === 0) {
    return null;
  }

  const localizedLines = compactPage.lines.filter(
    (line) => getLineRight(line) >= 0.9 || line.normX >= 0.88
  );

  if (localizedLines.length === 0) {
    return null;
  }

  return buildPageModelFromLines(page.pageNumber, localizedLines);
}

function getMetadataBoxRegionId(
  familyId: MetadataStyleProfile
): MetadataRegionId {
  switch (familyId) {
    case "bottom_right_strip":
      return "sheetStamp";
    case "bottom_right_block":
      return "bottomRight";
    case "bottom_left_block":
      return "bottomLeft";
    default:
      return "bottomRight";
  }
}

function getMetadataBoxFamilyFromBbox(
  bbox: MetadataBoxCandidate["bbox"]
): MetadataStyleProfile {
  if (
    bbox.x >= 0.88 &&
    bbox.y >= 0.78 &&
    bbox.width <= 0.14 &&
    bbox.height <= 0.16
  ) {
    return "bottom_right_strip";
  }

  if (bbox.x >= 0.74 && bbox.y >= 0.72) {
    return "bottom_right_block";
  }

  if (bbox.x <= 0.2 && bbox.y >= 0.72) {
    return "bottom_left_block";
  }

  return "mixed";
}

function getMetadataBoxFamilyForAnchor(
  page: PageExtractionModel,
  anchor: SheetNumberCandidate
) {
  const anchorLine = page.lines[anchor.lineIndex];
  if (!anchorLine) {
    return "mixed" as MetadataStyleProfile;
  }

  const anchorBbox = {
    x: anchorLine.normX,
    y: anchorLine.normY,
    width: anchorLine.normWidth,
    height: anchorLine.normHeight,
  };
  const inferredFamily = getMetadataBoxFamilyFromBbox(anchorBbox);

  if (inferredFamily !== "mixed") {
    return inferredFamily;
  }

  if (anchorLine.normX >= 0.68 && anchorLine.normY >= 0.64) {
    return "bottom_right_block";
  }

  if (anchorLine.normX <= 0.2 && anchorLine.normY >= 0.68) {
    return "bottom_left_block";
  }

  return "mixed";
}

function buildMetadataBoxLines(
  page: PageExtractionModel,
  anchor: SheetNumberCandidate,
  familyId: MetadataStyleProfile
) {
  const anchorLine = page.lines[anchor.lineIndex];
  if (!anchorLine) {
    return [] as TextLine[];
  }

  const anchorCenterX = getLineCenterX(anchorLine);
  const anchorCenterY = getLineCenterY(anchorLine);

  return page.lines.filter((line) => {
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);

    switch (familyId) {
      case "bottom_right_strip":
        return (
          getLineRight(line) >= 0.9 &&
          centerX >= anchorCenterX - 0.08 &&
          centerX <= 1.01 &&
          centerY >= anchorCenterY - 0.03 &&
          centerY <= anchorCenterY + 0.11
        );
      case "bottom_right_block":
        return (
          line.normX >= Math.max(0.68, anchorLine.normX - 0.18) &&
          centerX >= anchorCenterX - 0.16 &&
          centerX <= 1.01 &&
          centerY >= anchorCenterY - 0.18 &&
          centerY <= anchorCenterY + 0.09
        );
      case "bottom_left_block":
        return (
          getLineRight(line) <= 0.46 &&
          centerX >= -0.01 &&
          centerX <= Math.max(0.38, anchorCenterX + 0.18) &&
          centerY >= anchorCenterY - 0.18 &&
          centerY <= anchorCenterY + 0.12
        );
      default:
        return false;
    }
  });
}

function getMetadataBoxRejectReason(args: {
  lines: TextLine[];
  familyId: MetadataStyleProfile;
  distinctNumberCount: number;
  titleLikeCount: number;
}) {
  const joined = args.lines.map((line) => line.text).join("\n");
  const rowCount = args.lines.length;

  if (args.distinctNumberCount >= 3) {
    return "table_like_box";
  }

  if (
    /\b(sheet index|parking table|keynotes?|door schedule|window schedule|symbol legend|legend)\b/i.test(
      joined
    )
  ) {
    return "table_like_box";
  }

  if (countSheetReferenceTokens(joined) >= 4) {
    return "table_like_box";
  }

  if (
    args.familyId !== "bottom_right_strip" &&
    rowCount >= 8 &&
    args.titleLikeCount >= 3
  ) {
    return "table_like_box";
  }

  return null;
}

function getCompactStampBodyMetrics(lines: TextLine[], anchorValue: string) {
  const normalizedAnchor = normalizeSheetNumberValue(anchorValue);
  const bodyLines = lines.filter((line) => {
    const normalizedText = normalizeWhitespace(line.text);
    if (!normalizedText || isMetadataBoxFooterLine(normalizedText)) {
      return false;
    }

    if (normalizeSheetNumberValue(normalizedText) === normalizedAnchor) {
      return false;
    }

    if (SHEET_NUMBER_LABEL_PATTERN.test(normalizedText)) {
      return false;
    }

    return true;
  });
  const titleLines = bodyLines.filter((line) => {
    const normalizedText = normalizeWhitespace(line.text);
    return (
      isLikelySheetTitle(normalizedText) ||
      isMetadataBoxTitleFragment(normalizedText) ||
      countTitleVocabularyHits(normalizedText) > 0
    );
  });

  return {
    bodyLineCount: bodyLines.length,
    titleLikeCount: titleLines.length,
    titleVocabularyHits: titleLines.reduce(
      (total, line) => total + countTitleVocabularyHits(line.text),
      0
    ),
  };
}

function hasViableCompactStampBoxCandidate(box: {
  familyId: MetadataStyleProfile;
  rejectReason?: string | null;
  lines: TextLine[];
  anchorCandidate: SheetNumberCandidate;
  distinctNumberCount: number;
}) {
  if (box.familyId !== "bottom_right_strip" || box.rejectReason) {
    return false;
  }

  const metrics = getCompactStampBodyMetrics(
    box.lines,
    box.anchorCandidate.value
  );

  return hasViableCompactStampStructure({
    distinctNumberCount: box.distinctNumberCount,
    bodyLineCount: metrics.bodyLineCount,
    titleLikeCount: metrics.titleLikeCount,
    titleVocabularyHits: metrics.titleVocabularyHits,
  });
}

function createMetadataBoxCandidate(args: {
  sourceModel: "page" | "compact_stamp";
  familyId: MetadataStyleProfile;
  anchor: SheetNumberCandidate;
  lines: TextLine[];
}) {
  const bbox = getNormalizedTextLineBox(args.lines);
  if (!bbox) {
    return null;
  }

  const distinctNumbers = new Set(
    extractSheetNumberCandidates(args.lines)
      .filter((candidate) => !candidate.isNumericOnly && candidate.score >= 60)
      .map((candidate) => normalizeSheetNumberValue(candidate.value))
      .filter(Boolean)
  );
  const titleLikeCount = args.lines.filter(
    (line) =>
      (isLikelySheetTitle(line.text) || isMetadataBoxTitleFragment(line.text)) &&
      countWords(line.text) <= 8
  ).length;
  const titleVocabularyHits = args.lines.reduce(
    (total, line) => total + countTitleVocabularyHits(line.text),
    0
  );
  const rejectReason = getMetadataBoxRejectReason({
    lines: args.lines,
    familyId: args.familyId,
    distinctNumberCount: distinctNumbers.size,
    titleLikeCount,
  });
  const compactStampMetrics =
    args.familyId === "bottom_right_strip"
      ? getCompactStampBodyMetrics(args.lines, args.anchor.value)
      : null;
  const hasViableCompactStructure = compactStampMetrics
    ? hasViableCompactStampStructure({
        distinctNumberCount: distinctNumbers.size,
        bodyLineCount: compactStampMetrics.bodyLineCount,
        titleLikeCount: compactStampMetrics.titleLikeCount,
        titleVocabularyHits: compactStampMetrics.titleVocabularyHits,
      })
    : false;

  let score =
    args.anchor.score + titleVocabularyHits * 10 + titleLikeCount * 14;

  if (bbox.x >= 0.9) score += 28;
  if (bbox.y >= 0.82) score += 26;
  if (bbox.width <= 0.12) score += 24;
  if (bbox.height <= 0.12) score += 20;
  if (distinctNumbers.size === 1) score += 34;
  if (distinctNumbers.size === 2) score += 8;
  if (args.lines.length >= 2 && args.lines.length <= 4) score += 18;
  if (args.lines.length === 1) score -= 12;
  if (args.lines.length >= 6) score -= 30;

  if (args.familyId === "bottom_right_strip") {
    score += 72;
    if (!hasViableCompactStructure) {
      score -= 220;
    }
  } else if (args.familyId === "bottom_right_block") {
    score += 28;
  }

  if (args.sourceModel === "compact_stamp") {
    score += 32;
    if (args.familyId === "bottom_right_strip" && !hasViableCompactStructure) {
      score -= 48;
    }
  }

  if (rejectReason) {
    score -= 180;
  }

  return {
    source: "pdf",
    sourceModel: args.sourceModel,
    familyId: args.familyId,
    regionId: getMetadataBoxRegionId(args.familyId),
    bbox,
    lines: args.lines,
    anchorCandidate: args.anchor,
    distinctNumberCount: distinctNumbers.size,
    titleLikeCount,
    titleVocabularyHits,
    rejectReason,
    pairRejectReason: null,
    titleAttempts: [],
    score,
  } satisfies MetadataBoxCandidate;
}

function buildCompactStampBoxCandidatesForPage(page: PageExtractionModel) {
  const compactPage = buildCompactStampPageModel(page);
  if (!compactPage) {
    return [] as MetadataBoxCandidate[];
  }

  const candidates: MetadataBoxCandidate[] = [];
  const seen = new Set<string>();

  for (const anchor of [...compactPage.candidates].sort((a, b) => b.score - a.score)) {
    if (!Number.isFinite(anchor.score) || anchor.score < 60) {
      continue;
    }

    const lines = buildMetadataBoxLines(compactPage, anchor, "bottom_right_strip");
    if (lines.length === 0) {
      continue;
    }

    const candidate = createMetadataBoxCandidate({
      sourceModel: "compact_stamp",
      familyId: "bottom_right_strip",
      anchor,
      lines,
    });
    if (!candidate) {
      continue;
    }

    const dedupeKey = [
      candidate.familyId,
      Math.round(candidate.bbox.x * 1000),
      Math.round(candidate.bbox.y * 1000),
      Math.round(candidate.bbox.width * 1000),
      Math.round(candidate.bbox.height * 1000),
      normalizeSheetNumberValue(candidate.anchorCandidate.value),
    ].join(":");
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    candidates.push(candidate);
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function hasStrongCompactStampSignal(boxes: MetadataBoxCandidate[]) {
  return boxes.some(
    (box) =>
      hasViableCompactStampBoxCandidate(box) &&
      box.anchorCandidate.score >= 120 &&
      box.anchorCandidate.normX >= 0.9
  );
}

function hasViableCompactStampBox(boxes: MetadataBoxCandidate[]) {
  return boxes.some((box) => hasViableCompactStampBoxCandidate(box));
}

function buildMetadataBoxCandidatesForPage(page: PageExtractionModel) {
  const candidates: MetadataBoxCandidate[] = [
    ...buildCompactStampBoxCandidatesForPage(page),
  ];
  const seen = new Set<string>();
  const strongCompactStampSignal = hasStrongCompactStampSignal(candidates);

  for (const candidate of candidates) {
    const dedupeKey = [
      candidate.familyId,
      Math.round(candidate.bbox.x * 1000),
      Math.round(candidate.bbox.y * 1000),
      Math.round(candidate.bbox.width * 1000),
      Math.round(candidate.bbox.height * 1000),
      normalizeSheetNumberValue(candidate.anchorCandidate.value),
    ].join(":");
    seen.add(dedupeKey);
  }

  for (const anchor of [...page.candidates].sort((a, b) => b.score - a.score)) {
    if (!Number.isFinite(anchor.score) || anchor.score < 36) {
      continue;
    }

    const familyId = getMetadataBoxFamilyForAnchor(page, anchor);
    if (familyId === "mixed") {
      continue;
    }

    const lines = buildMetadataBoxLines(page, anchor, familyId);
    if (lines.length < 2) {
      continue;
    }

    const candidate = createMetadataBoxCandidate({
      sourceModel: "page",
      familyId,
      anchor,
      lines,
    });
    if (!candidate) {
      continue;
    }

    if (strongCompactStampSignal && candidate.familyId === "bottom_right_block") {
      candidate.score -= 80;
      if (candidate.rejectReason === "table_like_box") {
        candidate.score -= 40;
      }
    }

    const dedupeKey = [
      candidate.familyId,
      Math.round(candidate.bbox.x * 1000),
      Math.round(candidate.bbox.y * 1000),
      Math.round(candidate.bbox.width * 1000),
      Math.round(candidate.bbox.height * 1000),
      normalizeSheetNumberValue(candidate.anchorCandidate.value),
    ].join(":");
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    candidates.push(candidate);
  }

  return candidates.sort((a, b) => b.score - a.score);
}

function isPairedWithinMetadataBox(
  familyId: MetadataStyleProfile,
  numberBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  titleBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  },
  bbox: MetadataBoxCandidate["bbox"]
) {
  return isPairedWithinMetadataBoxBase(familyId, numberBox, titleBox, bbox);
}

function buildMetadataBoxPairCandidate(args: {
  page: PageExtractionModel;
  box: MetadataBoxCandidate;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}): PairedSheetCandidate | null {
  args.box.pairRejectReason = null;
  args.box.pairGeometryRejectReason = null;
  args.box.pairSubclusterBbox = null;
  args.box.selectedTitleLineIndexes = [];

  if (args.box.rejectReason) {
    args.box.pairRejectReason = args.box.rejectReason;
    return null;
  }

  const localizedPage = buildPageModelFromLines(args.page.pageNumber, args.box.lines);
  const numberResult = detectSheetNumber(
    localizedPage,
    args.exactCounts,
    args.prefixCounts
  );
  if (!numberResult.sheetNumber || !numberResult.winner) {
    args.box.pairRejectReason = "unpaired_box_fields";
    return null;
  }

  const titleResult = detectMetadataBoxTitle({
    page: localizedPage,
    familyId: args.box.familyId,
    winner: numberResult.winner,
    repeatedLineCounts: args.repeatedLineCounts,
    totalPages: args.totalPages,
  });
  args.box.titleAttempts = titleResult.attempts;
  const titleEvaluation = titleResult.title
    ? evaluateTitleSelection({
        title: titleResult.title,
        sourceKind: "pdf_text",
        sourceText: titleResult.sourceText,
        pageNumber: args.page.pageNumber,
      })
    : null;
  const titleText = titleEvaluation?.text ?? titleResult.title;
  const titleScore = titleEvaluation?.score ?? -Infinity;

  if (!titleText) {
    args.box.pairRejectReason = "unpaired_box_fields";
    return null;
  }

  if (isRepeatedProjectLikeTitle(titleText, args.repeatedLineCounts, args.totalPages)) {
    args.box.pairRejectReason = "project_title_not_sheet_title";
    return null;
  }

  if (
    !Number.isFinite(titleScore) ||
    titleScore < 24 ||
    isSuspiciousDetectedTitle(titleText)
  ) {
    args.box.pairRejectReason = isSuspiciousDetectedTitle(titleText)
      ? "admin_text"
      : "unpaired_box_fields";
    return null;
  }

  const numberLine = localizedPage.lines[numberResult.winner.lineIndex] ?? null;
  const titleLineIndexes =
    titleResult.lineIndexes?.length
      ? titleResult.lineIndexes
      : typeof titleResult.lineIndex === "number"
        ? [titleResult.lineIndex]
        : [];
  const titleLines = titleLineIndexes
    .map((lineIndex) => localizedPage.lines[lineIndex] ?? null)
    .filter((line): line is TextLine => Boolean(line));
  const titleLine = titleLines[0] ?? null;
  if (!numberLine || !titleLine || titleLines.length === 0) {
    args.box.pairRejectReason = "unpaired_box_fields";
    return null;
  }
  args.box.selectedTitleLineIndexes = titleLineIndexes;

  if (
    countSheetReferenceTokens(numberLine.text) >= 2 ||
    titleLines.some((line) => countSheetReferenceTokens(line.text) >= 2)
  ) {
    args.box.pairRejectReason = "cross_sheet_reference";
    return null;
  }

  const numberBox = getNormalizedBoxFromCandidate(numberResult.winner, numberLine);
  const titleBox = getNormalizedUnionBox(titleLines.map(getNormalizedBoxFromLine));
  const pairSubclusterBbox = getNormalizedUnionBox([
    numberBox,
    ...(titleBox ? [titleBox] : []),
  ]);
  if (!titleBox || !pairSubclusterBbox) {
    args.box.pairRejectReason = "unpaired_box_fields";
    return null;
  }
  args.box.pairSubclusterBbox = pairSubclusterBbox;

  if (
    !isPairedWithinMetadataBox(
      args.box.familyId,
      numberBox,
      titleBox,
      pairSubclusterBbox
    )
  ) {
    args.box.pairRejectReason = "unpaired_box_fields";
    args.box.pairGeometryRejectReason = "off_family_box";
    return null;
  }

  const normalizedSheetNumber = normalizeSheetNumberValue(numberResult.sheetNumber);
  if (!isSheetNumberValue(normalizedSheetNumber)) {
    args.box.pairRejectReason = "unpaired_box_fields";
    return null;
  }

  const scoreTrace = new ScoreTrace()
    .add("metadata_box_score", args.box.score)
    .add("sheet_number_candidate_score", numberResult.winner.score)
    .add("sheet_title_candidate_score", titleScore)
    .add("title_vocabulary_hits", args.box.titleVocabularyHits * 8);

  if (args.box.distinctNumberCount === 1) scoreTrace.add("single_distinct_number", 24);
  if (args.box.titleLikeCount >= 1 && args.box.titleLikeCount <= 3) {
    scoreTrace.add("compact_title_like_count", 18);
  }
  if (args.box.familyId === "bottom_right_strip") {
    scoreTrace.add("bottom_right_strip_family", 34);
  }
  const pairScore = scoreTrace.total();
  args.box.pairRejectReason = null;
  const numberReasonCodes = buildSheetNumberReasonCodes(numberResult.winner);
  const titleReasonCodes = buildTitleReasonCodes({
    titleText,
    titleSourceText: titleResult.sourceText,
    titleLines,
    numberLine,
    titleRegion: args.box.regionId,
    numberRegion: args.box.regionId,
  });

  return {
    sheetNumber: numberResult.sheetNumber,
    sheetTitle: titleText,
    numberSourceText: numberLine.text,
    titleSourceText: titleResult.sourceText,
    numberLineIndex: numberResult.winner.lineIndex,
    titleLineIndex: titleResult.lineIndex,
    numberRegion: args.box.regionId,
    titleRegion: args.box.regionId,
    pairedCluster: buildPairedClusterId(
      args.box.regionId,
      numberResult.winner.lineIndex,
      titleResult.lineIndex
    ),
    styleProfile: args.box.familyId,
    familyId: args.box.familyId,
    localClusterBbox: pairSubclusterBbox,
    sourceAgreement: false,
    rejectReason: null,
    numberCandidateTypeGuess: guessSheetNumberCandidateType(
      numberResult.sheetNumber,
      numberLine.text
    ),
    titleCandidateTypeGuess: guessTitleCandidateType(
      titleText,
      titleResult.sourceText
    ),
    numberReasonCodes,
    titleReasonCodes,
    numberScore: numberResult.winner.score,
    titleScore,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(
      clamp(
        ((numberResult.confidence ?? 0.15) * 0.45 +
          (titleScore - 24) / 180 +
          (pairScore - 190) / 230),
        0,
        1
      ).toFixed(2)
    ),
  } satisfies PairedSheetCandidate;
}

function buildMetadataBoxPairCandidatesForPage(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
  rawBoxes?: MetadataBoxCandidate[];
}) {
  return (args.rawBoxes ?? buildMetadataBoxCandidatesForPage(args.page))
    .map((box) =>
      buildMetadataBoxPairCandidate({
        ...args,
        box,
      })
    )
    .filter((candidate): candidate is PairedSheetCandidate => Boolean(candidate))
    .sort((left, right) => right.score - left.score);
}

function scoreMetadataBoxTitleLine(args: {
  familyId: MetadataStyleProfile;
  line: TextLine;
  numberLine: TextLine;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}) {
  const sanitizedTitleText =
    stripTrailingSheetTitleMetadata(args.line.text) ||
    normalizeComparableSheetTitleText(args.line.text) ||
    normalizeWhitespace(args.line.text);
  const isFragment =
    args.familyId === "bottom_right_strip" &&
    isMetadataBoxTitleFragment(args.line.text);

  if (isMetadataBoxFooterLine(args.line.text)) {
    return -Infinity;
  }

  if (isMetadataLabelOnlyTitleText(args.line.text)) {
    return -Infinity;
  }

  if (!isLikelySheetTitle(sanitizedTitleText) && !isFragment) {
    return -Infinity;
  }

  if (
    isRepeatedProjectLikeTitle(
      sanitizedTitleText,
      args.repeatedLineCounts,
      args.totalPages
    ) ||
    isSuspiciousDetectedTitle(sanitizedTitleText)
  ) {
    return -Infinity;
  }

  const centerDelta = Math.abs(
    getLineCenterX(args.line) - getLineCenterX(args.numberLine)
  );
  const titleBelowDelta =
    getLineCenterY(args.line) - getLineCenterY(args.numberLine);
  const wordCount = countWords(sanitizedTitleText);
  let score =
    getCanonicalTitleBoost(sanitizedTitleText) +
    countTitleVocabularyHits(sanitizedTitleText) * 16 +
    getTitleRejectPenalty(sanitizedTitleText, args.line);

  if (isFragment) {
    score += 82;
  }

  if (wordCount >= 1 && wordCount <= 6) {
    score += 24;
  } else if (wordCount <= 9) {
    score += 8;
  } else {
    score -= 24;
  }

  if (args.familyId === "bottom_right_strip") {
    const verticalOffset = Math.abs(titleBelowDelta);
    if (verticalOffset < 0.004 || verticalOffset > 0.085) {
      return -Infinity;
    }
    if (centerDelta <= 0.05) {
      score += 48;
    } else if (centerDelta <= 0.08) {
      score += 18;
    } else {
      return -Infinity;
    }
    if (args.line.normX >= 0.9) {
      score += 18;
    }

    if (isFragment && wordCount === 1) {
      score -= 18;
    }
  } else {
    if (!isWithinLocalTitleBlockRegion(args.line, {
      value: "",
      score: 0,
      lineIndex: 0,
      normX: args.numberLine.normX,
      normY: args.numberLine.normY,
      normWidth: args.numberLine.normWidth,
      normHeight: args.numberLine.normHeight,
      width: args.numberLine.width,
      height: args.numberLine.height,
      lineText: args.numberLine.text,
      isNumericOnly: false,
      prefix: "",
    })) {
      score -= 24;
    }
  }

  return score;
}

function getMetadataBoxTitleAttemptRejectReason(args: {
  familyId: MetadataStyleProfile;
  line: TextLine;
  numberLine: TextLine;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}) {
  const isFragment =
    args.familyId === "bottom_right_strip" &&
    (isMetadataBoxTitleFragment(args.line.text) ||
      isCompactStampContinuationFragment(args.line.text));

  if (isMetadataBoxFooterLine(args.line.text)) {
    return "footer_admin";
  }

  if (isMetadataLabelOnlyTitleText(args.line.text)) {
    return "label_only_field";
  }

  if (
    isRepeatedProjectLikeTitle(
      args.line.text,
      args.repeatedLineCounts,
      args.totalPages
    )
  ) {
    return "project_title_not_sheet_title";
  }

  if (!isFragment && isSuspiciousDetectedTitle(args.line.text)) {
    return "admin_text";
  }

  if (
    !isLikelySheetTitle(args.line.text) &&
    !isFragment
  ) {
    return "not_title_like";
  }

  if (
    args.familyId === "bottom_right_strip" &&
    !isPairedWithinMetadataBox(
      args.familyId,
      getNormalizedBoxFromLine(args.numberLine),
      getNormalizedBoxFromLine(args.line),
      getNormalizedUnionBox([
        getNormalizedBoxFromLine(args.numberLine),
        getNormalizedBoxFromLine(args.line),
      ]) ?? {
        x: args.numberLine.normX,
        y: args.numberLine.normY,
        width: args.numberLine.normWidth,
        height: args.numberLine.normHeight,
      }
    )
  ) {
    return "off_family_box";
  }

  return "unpaired_box_fields";
}

function detectMetadataBoxTitle(args: {
  page: PageExtractionModel;
  familyId: MetadataStyleProfile;
  winner: SheetNumberCandidate;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}): DetectedSheetTitle & { attempts: MetadataBoxTitleAttempt[] } {
  const winnerLine = args.page.lines[args.winner.lineIndex] ?? null;
  if (!winnerLine) {
    return {
      title: "",
      sourceText: "",
      lineIndex: null,
      lineIndexes: [],
      attempts: [],
    };
  }

  const candidates: TitleCandidate[] = [];
  const attempts: MetadataBoxTitleAttempt[] = [];

  args.page.lines.forEach((line, lineIndex) => {
    if (lineIndex === args.winner.lineIndex) {
      return;
    }

    const score = scoreMetadataBoxTitleLine({
      familyId: args.familyId,
      line,
      numberLine: winnerLine,
      repeatedLineCounts: args.repeatedLineCounts,
      totalPages: args.totalPages,
    });
    if (!Number.isFinite(score)) {
      attempts.push({
        text: line.text,
        sourceText: line.text,
        candidateTypeGuess: guessTitleCandidateType(line.text, line.text),
        reasonCodes: buildTitleReasonCodes({
          titleText: line.text,
          titleSourceText: line.text,
          titleLines: [line],
          numberLine: winnerLine,
          titleRegion: args.familyId === "bottom_right_strip" ? "sheetStamp" : "titleBlock",
          numberRegion: args.familyId === "bottom_right_strip" ? "stripNumber" : "sheetStamp",
        }),
        score: null,
        lineIndex,
        rejectReason: getMetadataBoxTitleAttemptRejectReason({
          familyId: args.familyId,
          line,
          numberLine: winnerLine,
          repeatedLineCounts: args.repeatedLineCounts,
          totalPages: args.totalPages,
        }),
      });
      return;
    }

    candidates.push({
      text: line.text,
      sourceText: line.text,
      score,
      lineIndex,
      lineIndexes: [lineIndex],
    });
    attempts.push({
      text: line.text,
      sourceText: line.text,
      candidateTypeGuess: guessTitleCandidateType(line.text, line.text),
      reasonCodes: buildTitleReasonCodes({
        titleText: line.text,
        titleSourceText: line.text,
        titleLines: [line],
        numberLine: winnerLine,
        titleRegion: args.familyId === "bottom_right_strip" ? "sheetStamp" : "titleBlock",
        numberRegion: args.familyId === "bottom_right_strip" ? "stripNumber" : "sheetStamp",
      }),
      score: Number(score.toFixed(1)),
      lineIndex,
      rejectReason: null,
    });
  });

  if (args.familyId === "bottom_right_strip") {
    const addCombinationCandidates = (start: number, endExclusive: number) => {
      const first = args.page.lines[start];
      if (!first) {
        return true;
      }
      if (isMetadataBoxFooterLine(first.text)) {
        return false;
      }

      const firstScore = scoreMetadataBoxTitleLine({
        familyId: args.familyId,
        line: first,
        numberLine: winnerLine,
        repeatedLineCounts: args.repeatedLineCounts,
        totalPages: args.totalPages,
      });
      const firstCanSeedCombination =
        Number.isFinite(firstScore) || isCompactStampContinuationFragment(first.text);
      if (!firstCanSeedCombination) {
        return true;
      }

      let combinedText = first.text;
      let combinedSource = first.text;
      let combinedScore = firstScore;
      let combinedScores = Number.isFinite(firstScore) ? [firstScore] : [];
      let lineIndexes = [start];
      if (Number.isFinite(firstScore)) {
        candidates.push({
          text: combinedText,
          sourceText: combinedSource,
          score: combinedScore,
          lineIndex: start,
          lineIndexes: [...lineIndexes],
        });
        attempts.push({
          text: combinedText,
          sourceText: combinedSource,
          candidateTypeGuess: guessTitleCandidateType(combinedText, combinedSource),
          reasonCodes: buildTitleReasonCodes({
            titleText: combinedText,
            titleSourceText: combinedSource,
            titleLines: lineIndexes.map((index) => args.page.lines[index]!).filter(Boolean),
            numberLine: winnerLine,
            titleRegion: "sheetStamp",
            numberRegion: "stripNumber",
          }),
          score: Number(combinedScore.toFixed(1)),
          lineIndex: start,
          rejectReason: null,
        });
      }

      for (let end = start + 1; end < Math.min(endExclusive, start + 3); end += 1) {
        const next = args.page.lines[end];
        if (!next) continue;
        if (isMetadataBoxFooterLine(next.text)) {
          break;
        }
        if (
          Math.abs(getLineCenterX(next) - getLineCenterX(first)) > 0.08 ||
          getLineCenterY(next) - getLineCenterY(first) > 0.06
        ) {
          break;
        }

        const nextScore = scoreMetadataBoxTitleLine({
          familyId: args.familyId,
          line: next,
          numberLine: winnerLine,
          repeatedLineCounts: args.repeatedLineCounts,
          totalPages: args.totalPages,
        });
        if (
          !Number.isFinite(nextScore) &&
          !isMetadataBoxTitleFragment(next.text) &&
          !isCompactStampContinuationFragment(next.text)
        ) {
          break;
        }

        combinedText = normalizeWhitespace(`${combinedText} ${next.text}`);
        combinedSource = `${combinedSource}\n${next.text}`;
        lineIndexes = [...lineIndexes, end];

        if (
          !isLikelySheetTitle(combinedText) ||
          isRepeatedProjectLikeTitle(
            combinedText,
            args.repeatedLineCounts,
            args.totalPages
          ) ||
          isSuspiciousDetectedTitle(combinedText)
        ) {
          continue;
        }

        if (Number.isFinite(nextScore)) {
          combinedScores = [...combinedScores, nextScore];
        }

        combinedScore =
          combinedScores.reduce((total, score) => total + score, 0) /
            Math.max(combinedScores.length, 1) +
          getCanonicalTitleBoost(combinedText) +
          countTitleVocabularyHits(combinedText) * 18 +
          28 -
          Math.max(countWords(combinedText) - 6, 0) * 8;

        candidates.push({
          text: combinedText,
          sourceText: combinedSource,
          score: combinedScore,
          lineIndex: start,
          lineIndexes: [...lineIndexes],
        });
        attempts.push({
          text: combinedText,
          sourceText: combinedSource,
          candidateTypeGuess: guessTitleCandidateType(combinedText, combinedSource),
          reasonCodes: buildTitleReasonCodes({
            titleText: combinedText,
            titleSourceText: combinedSource,
            titleLines: lineIndexes.map((index) => args.page.lines[index]!).filter(Boolean),
            numberLine: winnerLine,
            titleRegion: "sheetStamp",
            numberRegion: "stripNumber",
          }),
          score: Number(combinedScore.toFixed(1)),
          lineIndex: start,
          rejectReason: null,
        });
      }
      return true;
    };

    for (
      let start = Math.max(0, args.winner.lineIndex - 3);
      start < args.winner.lineIndex;
      start += 1
    ) {
      addCombinationCandidates(start, args.winner.lineIndex);
    }

    for (let start = args.winner.lineIndex + 1; start < args.page.lines.length; start += 1) {
      const shouldContinue = addCombinationCandidates(start, args.page.lines.length);
      if (!shouldContinue) {
        break;
      }
    }
  }

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best || best.score < 24) {
    return {
      title: "",
      sourceText: "",
      lineIndex: null,
      lineIndexes: [],
      attempts,
    };
  }

  return {
    title: best.text,
    sourceText: best.sourceText,
    lineIndex: best.lineIndex ?? null,
    lineIndexes:
      best.lineIndexes ??
      (typeof best.lineIndex === "number" ? [best.lineIndex] : []),
    attempts,
  };
}

function getLocalizedFamilyRejectReason(
  page: PageExtractionModel,
  family: MetadataFamilyDefinition
) {
  const normalizedNumbers = new Set(
    page.candidates
      .map((candidate) => normalizeSheetNumberValue(candidate.value))
      .filter(Boolean)
  );
  const joined = page.lines.map((line) => line.text).join("\n");
  const titleLikeRows = page.lines.filter(
    (line) => isLikelySheetTitle(line.text) && countWords(line.text) <= 8
  ).length;

  if (normalizedNumbers.size >= 3) {
    return "table_like_region";
  }

  if (
    /\b(sheet index|parking table|keynotes?|door schedule|window schedule|symbol legend|legend)\b/i.test(
      joined
    )
  ) {
    return "table_like_region";
  }

  if (
    family.id !== "bottom_right_strip" &&
    normalizedNumbers.size >= 2 &&
    titleLikeRows >= 3
  ) {
    return "table_like_region";
  }

  return null;
}

function isRepeatedProjectLikeTitle(
  title: string,
  repeatedLineCounts: Record<string, number>,
  totalPages: number
) {
  const normalized = normalizeKey(title);
  const repeatedCount = repeatedLineCounts[normalized] ?? 0;
  const canonicalBoost = getCanonicalTitleBoost(title);
  const titleHits = countTitleVocabularyHits(title);

  return (
    (
      repeatedCount >= Math.max(3, Math.ceil(totalPages * 0.25)) &&
      canonicalBoost < 60 &&
      titleHits < 2
    ) ||
    looksLikeGenericProjectOrPackageSheetLabel(title)
  );
}

function looksLikeGenericProjectOrPackageSheetLabel(title: string) {
  const normalized = normalizeComparableSheetTitleText(title);
  if (!normalized) {
    return false;
  }

  if (/\bBID\s+PACKAGE\b/i.test(normalized)) {
    return true;
  }

  const genericDevelopmentPlan =
    /\b(?:FINAL\s+)?DEVELOPMENT\s+PLAN\b/i.test(normalized) &&
    !/\b(?:SITE|GRADING|DRAINAGE|UTILITY|UTILITIES|EROSION|CONTROL|LANDSCAPE|LAYOUT|DEMOLITION|DIMENSION)\b/i.test(
      normalized
    );
  return genericDevelopmentPlan && countTitleVocabularyHits(normalized) <= 1;
}

function buildLocalizedPdfPairCandidate(args: {
  page: PageExtractionModel;
  family: MetadataFamilyDefinition;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}): PairedSheetCandidate | null {
  const fullRegion = getMetadataRegionById(args.family.fullRegionId);
  const titleRegion = getMetadataRegionById(args.family.titleRegionId);
  const numberRegion = getMetadataRegionById(args.family.numberRegionId);

  if (!fullRegion || !titleRegion || !numberRegion) {
    return null;
  }

  const localizedPage = buildPageRegionModel(args.page, fullRegion);
  if (!localizedPage) {
    return null;
  }
  const localizedTitlePage = buildPageRegionModel(args.page, titleRegion);
  const localizedNumberPage = buildPageRegionModel(args.page, numberRegion);

  const rejectReason = getLocalizedFamilyRejectReason(localizedPage, args.family);
  if (rejectReason) {
    return null;
  }

  const dedicatedStripFamily = args.family.id === "bottom_right_strip";
  const numberSourcePage =
    dedicatedStripFamily ? localizedNumberPage : localizedNumberPage ?? localizedPage;
  const titleSourcePage =
    dedicatedStripFamily ? localizedTitlePage : localizedTitlePage ?? localizedPage;

  if (!numberSourcePage || !titleSourcePage) {
    return null;
  }

  const numberResult = detectSheetNumber(numberSourcePage, args.exactCounts, args.prefixCounts);

  if (!numberResult.sheetNumber || !numberResult.winner) {
    return null;
  }

  const shareSourcePage = numberSourcePage === titleSourcePage;
  const titleResult = detectSheetTitle(
    titleSourcePage,
    dedicatedStripFamily || !shareSourcePage ? null : numberResult.winner,
    args.repeatedLineCounts,
    args.totalPages
  );

  const titleEvaluation = titleResult.title
    ? evaluateTitleSelection({
        title: titleResult.title,
        sourceKind: "pdf_text",
        sourceText: titleResult.sourceText,
        pageNumber: args.page.pageNumber,
      })
    : null;
  const titleText = titleEvaluation?.text ?? titleResult.title;
  const titleScore = titleEvaluation?.score ?? -Infinity;

  if (!titleText || !Number.isFinite(titleScore) || titleScore < 24) {
    return null;
  }

  if (isSuspiciousDetectedTitle(titleText)) {
    return null;
  }

  if (
    isRepeatedProjectLikeTitle(
      titleText,
      args.repeatedLineCounts,
      args.totalPages
    )
  ) {
    return null;
  }

  const numberLine = numberSourcePage.lines[numberResult.winner.lineIndex] ?? null;
  const titleLine =
    typeof titleResult.lineIndex === "number"
      ? titleSourcePage.lines[titleResult.lineIndex] ?? null
      : null;

  if (!numberLine || !titleLine) {
    return null;
  }

  const numberInDedicatedRegion = isLineInsideRegion(numberLine, numberRegion);
  const titleInDedicatedRegion = isLineInsideRegion(titleLine, titleRegion);
  const horizontalOverlap = getLineHorizontalOverlap(numberLine, titleLine);
  const centerDelta = Math.abs(getLineCenterX(numberLine) - getLineCenterX(titleLine));
  const titleBelowDelta = getLineCenterY(titleLine) - getLineCenterY(numberLine);
  const verticalGap = getLineCenterY(numberLine) - getLineCenterY(titleLine);
  const sameCluster = dedicatedStripFamily
    ? numberInDedicatedRegion &&
      titleInDedicatedRegion &&
      centerDelta <= 0.08 &&
      verticalGap >= 0.02 &&
      verticalGap <= 0.12
    : titleLine.normY <= numberLine.normY + 0.02 &&
      verticalGap >= -0.03 &&
      verticalGap <= 0.24 &&
      (horizontalOverlap >= 0.02 || centerDelta <= 0.12);

  if (!sameCluster) {
    return null;
  }

  if (!numberInDedicatedRegion && !args.family.fallbackOnly) {
    return null;
  }

  if (!titleInDedicatedRegion && !args.family.fallbackOnly) {
    return null;
  }

  if (countSheetReferenceTokens(numberLine.text) >= 2) {
    return null;
  }

  if (countSheetReferenceTokens(titleLine.text) >= 2) {
    return null;
  }

  const normalizedSheetNumber = normalizeSheetNumberValue(numberResult.sheetNumber);
  if (!EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(normalizedSheetNumber)) {
    return null;
  }

  const scoreTrace = new ScoreTrace()
    .add("metadata_family_prior", args.family.prior)
    .add(
      dedicatedStripFamily
        ? "dedicated_number_title_region_weight"
        : "full_region_weight",
      dedicatedStripFamily ? titleRegion.weight + numberRegion.weight : fullRegion.weight
    )
    .add("sheet_number_candidate_score", numberResult.winner.score)
    .add("sheet_title_candidate_score", titleScore);

  if (numberInDedicatedRegion) scoreTrace.add("number_in_dedicated_region", 42);
  if (titleInDedicatedRegion) scoreTrace.add("title_in_dedicated_region", 34);
  if (sameCluster) scoreTrace.add("same_local_cluster", 34);
  if (!dedicatedStripFamily && horizontalOverlap >= 0.04) {
    scoreTrace.add("horizontal_overlap", 16);
  }
  if (centerDelta <= 0.06) scoreTrace.add("center_aligned", 14);
  if (dedicatedStripFamily) {
    if (titleBelowDelta >= 0.03 && titleBelowDelta <= 0.1) {
      scoreTrace.add("strip_title_below_number_gap", 22);
    }
    scoreTrace.add("dedicated_strip_family", 34);
  } else if (verticalGap >= 0.02 && verticalGap <= 0.16) {
    scoreTrace.add("vertical_gap_in_range", 18);
  }
  if (args.family.fallbackOnly) scoreTrace.add("fallback_only_family_penalty", -28);
  const pairScore = scoreTrace.total();

  const localClusterBbox = getNormalizedTextLineBox([numberLine, titleLine]);
  const numberReasonCodes = buildSheetNumberReasonCodes(numberResult.winner);
  const titleReasonCodes = buildTitleReasonCodes({
    titleText,
    titleSourceText: titleResult.sourceText,
    titleLines: [titleLine],
    numberLine,
    titleRegion: args.family.titleRegionId,
    numberRegion: args.family.numberRegionId,
  });

  return {
    sheetNumber: numberResult.sheetNumber,
    sheetTitle: titleText,
    numberSourceText: numberLine.text,
    titleSourceText: titleResult.sourceText,
    numberLineIndex: numberResult.winner.lineIndex,
    titleLineIndex: titleResult.lineIndex,
    numberRegion: args.family.numberRegionId,
    titleRegion: args.family.titleRegionId,
    pairedCluster: buildPairedClusterId(
      args.family.fullRegionId,
      numberResult.winner.lineIndex,
      titleResult.lineIndex
    ),
    styleProfile: args.family.id,
    familyId: args.family.id,
    localClusterBbox: localClusterBbox ?? undefined,
    sourceAgreement: false,
    rejectReason: null,
    numberCandidateTypeGuess: guessSheetNumberCandidateType(
      numberResult.sheetNumber,
      numberLine.text
    ),
    titleCandidateTypeGuess: guessTitleCandidateType(
      titleText,
      titleResult.sourceText
    ),
    numberReasonCodes,
    titleReasonCodes,
    numberScore: numberResult.winner.score,
    titleScore,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(
      clamp(
        ((numberResult.confidence ?? 0.15) * 0.45 +
          (titleScore - 24) / 180 +
          (pairScore - 190) / 230),
        0,
        1
      ).toFixed(2)
    ),
  } satisfies PairedSheetCandidate;
}

function normalizeRightColumnTitleLine(text: string, hasPriorTitleLine: boolean) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  // Some right-side stamps share the title row with a one-letter grid marker.
  if (hasPriorTitleLine && /^[A-Z]\s+[A-Za-z][A-Za-z0-9/&()' -]{3,}$/i.test(normalized)) {
    return normalizeWhitespace(normalized.replace(/^[A-Z]\s+/, ""));
  }

  return normalized;
}

function isRightColumnLargeTitleLine(line: TextLine, numberLine: TextLine) {
  const normalized = normalizeWhitespace(line.text);
  if (!normalized || normalized.length > 90) {
    return false;
  }
  if (getLineCenterY(line) >= getLineCenterY(numberLine) - 0.012) {
    return false;
  }
  if (line.normY < 0.855 || line.normY > 0.94) {
    return false;
  }
  if (getLineRight(line) < 0.78 || getLineLeft(line) > 0.985) {
    return false;
  }
  if (Math.abs(getLineCenterX(line) - getLineCenterX(numberLine)) > 0.22) {
    return false;
  }
  if (
    isPureMarkerTitleText(normalized) ||
    isGeometricSymbolLabel(normalized) ||
    isMetadataLabelOnlyTitleText(normalized) ||
    isMetadataBoxFooterLine(normalized) ||
    matchesAdministrativeTitleMetadata(normalized) ||
    matchesProjectBrandingVocabulary(normalized) ||
    /^(?:date|scale|drawn\s+by|checked\s+by|project|issue|revision|rev)\b:?$/i.test(normalized) ||
    /^(?:as\s+indicated|author\b.*|drawn\b.*|checked\b.*|rl|jam|jips)$/i.test(normalized) ||
    /\b(?:street|avenue|road|drive|boulevard|city|county|university)\b/i.test(normalized) ||
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(normalized) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b\s+\d{1,2},?\s+\d{4}/i.test(normalized) ||
    /\d+\s*(?:\/\s*\d+)?\s*"\s*=\s*\d+'\s*-?\s*\d*/.test(normalized)
  ) {
    return false;
  }

  const fontSignal = getLineFontSizeSignal(line);
  const numberFontSignal = getLineFontSizeSignal(numberLine);
  const hasTitleVocabulary =
    isLikelySheetTitle(normalized) ||
    countTitleVocabularyHits(normalized) > 0 ||
    hasCompactTechnicalTitleSignal(normalized) ||
    /\b(?:SPECIFICATIONS?|COVER\s+SHEET|SCOPE|IMAGES?|ACOUSTIC|BOUNDARY|ASSEMBLIES|CONDUIT|BACKBOX|ACCOMMODATION)\b/i.test(
      normalized
    );

  return (
    fontSignal >= 12 ||
    fontSignal >= numberFontSignal * 0.52 ||
    hasTitleVocabulary
  );
}

function isTrustedRightColumnTitleText(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length < 3 || normalized.length > 120) {
    return false;
  }
  const hasRightColumnTitleVocabulary =
    /\b(?:SPECIFICATIONS?|COVER\s+SHEET|SCOPE|IMAGES?|ACOUSTIC|BOUNDARY|ASSEMBLIES|CONDUIT|BACKBOX|ACCOMMODATION|SECTIONS?|DEMOLITION)\b/i.test(
      normalized
    );
  if (getTextualTitleRejectPenalty(normalized) <= -120 && !hasRightColumnTitleVocabulary) {
    return false;
  }
  if (
    matchesAdministrativeTitleMetadata(normalized) ||
    matchesProjectBrandingVocabulary(normalized) ||
    isDateLikeTitleLineText(normalized) ||
    /\b(?:street|avenue|road|drive|boulevard|city|county|university)\b/i.test(normalized) ||
    /^(?:as\s+indicated|author\b.*|drawn\b.*|checked\b.*)$/i.test(normalized)
  ) {
    return false;
  }
  return (
    isLikelySheetTitle(normalized) ||
    isAllowedSingleWordTitle(normalized) ||
    countTitleVocabularyHits(normalized) >= 1 ||
    hasCompactTechnicalTitleSignal(normalized) ||
    hasRightColumnTitleVocabulary
  );
}

function buildRightColumnLargeTitlePairCandidate(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
}): PairedSheetCandidate | null {
  const rankedNumbers = args.page.candidates
    .filter((candidate) => {
      const normalized = normalizeSheetNumberValue(candidate.value);
      return (
        normalized &&
        EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(normalized) &&
        !candidate.isNumericOnly &&
        candidate.normX >= 0.88 &&
        candidate.normY >= 0.9 &&
        candidate.normY <= 0.99
      );
    })
    .sort((left, right) => {
      const leftLine = args.page.lines[left.lineIndex] ?? null;
      const rightLine = args.page.lines[right.lineIndex] ?? null;
      const leftFont = leftLine ? getLineFontSizeSignal(leftLine) : 0;
      const rightFont = rightLine ? getLineFontSizeSignal(rightLine) : 0;
      return (
        right.score - left.score ||
        rightFont - leftFont ||
        right.normY - left.normY
      );
    });
  const numberCandidate = rankedNumbers[0] ?? null;
  if (!numberCandidate) {
    return null;
  }

  const numberLine = args.page.lines[numberCandidate.lineIndex] ?? null;
  if (!numberLine) {
    return null;
  }
  const numberLineIndex = numberCandidate.lineIndex;
  const normalizedSheetNumber = normalizeSheetNumberValue(numberCandidate.value);
  if (!EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(normalizedSheetNumber)) {
    return null;
  }

  const titleLines = args.page.lines
    .filter((line) => isRightColumnLargeTitleLine(line, numberLine))
    .sort((left, right) => left.normY - right.normY)
    .filter((line, index, lines) => {
      if (index === 0) {
        return true;
      }
      const previous = lines[index - 1]!;
      const verticalGap = line.normY - getLineBottom(previous);
      const centerDelta = Math.abs(getLineCenterX(line) - getLineCenterX(previous));
      return verticalGap <= 0.028 && centerDelta <= 0.12;
    });
  if (titleLines.length === 0) {
    return null;
  }

  const nearestCluster = titleLines
    .reduce<TextLine[][]>((clusters, line) => {
      const current = clusters[clusters.length - 1];
      const previous = current?.[current.length - 1] ?? null;
      if (
        !previous ||
        line.normY - getLineBottom(previous) > 0.032 ||
        Math.abs(getLineCenterX(line) - getLineCenterX(previous)) > 0.14
      ) {
        clusters.push([line]);
      } else {
        current!.push(line);
      }
      return clusters;
    }, [])
    .sort((left, right) => {
      const leftBottom = Math.max(...left.map(getLineBottom));
      const rightBottom = Math.max(...right.map(getLineBottom));
      return rightBottom - leftBottom;
    })[0] ?? [];
  const titleParts: string[] = [];
  for (const line of nearestCluster.slice(0, 4)) {
    const part = normalizeRightColumnTitleLine(line.text, titleParts.length > 0);
    if (part) {
      titleParts.push(part);
    }
  }
  const rawTitle = mergeOcrTitleSelectionParts(titleParts);
  if (!rawTitle) {
    return null;
  }

  const titleEvaluation = evaluateTitleSelection({
    title: rawTitle,
    sourceKind: "pdf_text",
    sourceText: nearestCluster.map((line) => normalizeWhitespace(line.text)).join("\n"),
    pageNumber: args.page.pageNumber,
  });
  const evaluatedTitleTrusted = titleEvaluation?.text
    ? isTrustedRightColumnTitleText(titleEvaluation.text)
    : false;
  const rawTitleTrusted = isTrustedRightColumnTitleText(rawTitle);
  const titleText = evaluatedTitleTrusted
    ? titleEvaluation!.text
    : rawTitleTrusted
      ? rawTitle
      : titleEvaluation?.text ?? rawTitle;
  const titleScore = evaluatedTitleTrusted
    ? titleEvaluation!.score
    : rawTitleTrusted
      ? Math.max(titleEvaluation?.score ?? 0, 72 + countTitleVocabularyHits(rawTitle) * 14)
      : titleEvaluation?.score ?? -Infinity;
  if (
    !titleText ||
    !Number.isFinite(titleScore) ||
    titleScore < 18 ||
    (!rawTitleTrusted && isSuspiciousDetectedTitle(titleText)) ||
    isRepeatedProjectLikeTitle(titleText, args.repeatedLineCounts, args.totalPages)
  ) {
    return null;
  }

  const titleLineIndexes = nearestCluster
    .map((line) => args.page.lines.indexOf(line))
    .filter((index) => index >= 0);
  if (titleLineIndexes.length === 0) {
    return null;
  }

  const numberBox = getNormalizedBoxFromLine(numberLine);
  const titleBox = getNormalizedUnionBox(nearestCluster.map(getNormalizedBoxFromLine));
  const localClusterBbox = getNormalizedUnionBox([numberBox, ...(titleBox ? [titleBox] : [])]);
  const titleSourceText = nearestCluster.map((line) => normalizeWhitespace(line.text)).join("\n");
  const numberReasonCodes = buildSheetNumberReasonCodes(numberCandidate);
  const titleReasonCodes = buildTitleReasonCodes({
    titleText,
    titleSourceText,
    titleLines: nearestCluster,
    numberLine,
    titleRegion: "titleBlock",
    numberRegion: "sheetStamp",
  });
  titleReasonCodes.push("right_column_large_title");

  const centerDelta = Math.abs(getLineCenterX(numberLine) - getLineCenterX(nearestCluster[0]!));
  const verticalGap = getLineCenterY(numberLine) - Math.max(...nearestCluster.map(getLineCenterY));
  const scoreTrace = new ScoreTrace()
    .add("right_column_large_title_base", 520)
    .add("sheet_number_candidate_score", numberCandidate.score)
    .add("sheet_title_candidate_score", titleScore)
    .add("title_vocabulary_hits", countTitleVocabularyHits(titleText) * 16)
    .add("multi_line_title_cluster", nearestCluster.length > 1 ? 34 : 0)
    .add("vertical_gap_in_range", verticalGap >= 0.03 && verticalGap <= 0.12 ? 46 : 0)
    .add("center_aligned", centerDelta <= 0.09 ? 28 : 0);
  const pairScore = scoreTrace.total();

  return {
    sheetNumber: normalizedSheetNumber,
    sheetTitle: titleText,
    numberSourceText: numberLine.text,
    titleSourceText,
    numberLineIndex,
    titleLineIndex: titleLineIndexes[0],
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    pairedCluster: buildPairedClusterId("bottomRight", numberLineIndex, titleLineIndexes[0]),
    styleProfile: "bottom_right_block",
    familyId: "bottom_right_block",
    localClusterBbox: localClusterBbox ?? undefined,
    sourceAgreement: false,
    rejectReason: null,
    numberCandidateTypeGuess: guessSheetNumberCandidateType(normalizedSheetNumber, numberLine.text),
    titleCandidateTypeGuess: guessTitleCandidateType(titleText, titleSourceText),
    numberReasonCodes,
    titleReasonCodes,
    numberScore: numberCandidate.score,
    titleScore,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(
      clamp(
        (0.45 +
          (titleScore - 18) / 190 +
          (pairScore - 360) / 520),
        0,
        1
      ).toFixed(2)
    ),
  } satisfies PairedSheetCandidate;
}

function isPyMuPdfTitleNoiseLine(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  const titleSheetLine = /^title\s+sheet$/i.test(normalized);
  const compactTitle24Line = isCompactTitle24SheetTitleSignal(normalized);

  return (
    isPureMarkerTitleText(normalized) ||
    isGeometricSymbolLabel(normalized) ||
    isGlossaryDefinitionLine(normalized) ||
    isDateLikeTitleLineText(normalized) ||
    (!titleSheetLine && !compactTitle24Line && TITLE_LABEL_PATTERN.test(normalized)) ||
    NON_TITLE_FIELD_LABEL_PATTERN.test(normalized) ||
    isMetadataLabelOnlyTitleText(normalized) ||
    isMetadataBoxFooterLine(normalized) ||
    matchesAdministrativeTitleMetadata(normalized) ||
    /^\d{1,3}(?:\/\d{1,3})?\s*(?:"|in\.?|inch(?:es)?)?\s*=\s*\d{1,3}(?:['’]|\s*ft\.?|\s*feet|\s*foot)(?:\s*[-–]?\s*\d{1,3}\s*(?:"|in\.?|inch(?:es)?))?$/i.test(
      normalized
    ) ||
    /^\d{3,6}\s+[A-Z0-9][A-Z0-9\s.'#-]*\b(?:ST(?:REET)?|AVE(?:NUE)?|RD|ROAD|BLVD|DR(?:IVE)?|LN|LANE|WAY|CT|COURT)\b/i.test(
      normalized
    ) ||
    /^[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/i.test(normalized) ||
    /^[A-Z][A-Za-z0-9 &'#.-]+\s+UNIVERSITY$/i.test(normalized) ||
    /(?:copyright|revit|drawn|checked|job\s*(?:no|number)|issue|date|scale|as indicated)/i.test(
      normalized
    ) ||
    matchesProjectBrandingVocabulary(normalized)
  );
}

function scoreLocalizedPyMuPdfTitleLine(args: {
  page: PageExtractionModel;
  line: TextLine;
  lineIndex: number;
  numberLine: TextLine;
}) {
  const normalized = normalizeWhitespace(args.line.text);
  const compactTitle24Signal = isCompactTitle24SheetTitleSignal(normalized);
  if (!normalized) {
    return -Infinity;
  }
  if (normalized === normalizeWhitespace(args.numberLine.text)) {
    return -Infinity;
  }
  if (isPyMuPdfTitleNoiseLine(normalized)) {
    return -Infinity;
  }
  if (
    countSheetReferenceTokens(normalized) >= 2 &&
    !isTitle24TitleFragment(normalized) &&
    !compactTitle24Signal
  ) {
    return -Infinity;
  }

  const numberCenterY = getLineCenterY(args.numberLine);
  const lineCenterY = getLineCenterY(args.line);
  const verticalDelta = numberCenterY - lineCenterY;
  if (
    verticalDelta < -0.02 ||
    (verticalDelta > 0.32 && !compactTitle24Signal) ||
    (compactTitle24Signal && verticalDelta > 0.62)
  ) {
    return -Infinity;
  }

  let score = 0;

  if (verticalDelta >= 0.01) {
    score += 28;
  } else {
    score += 6;
  }

  if (verticalDelta >= 0.02 && verticalDelta <= 0.18) {
    score += 16;
  } else if (verticalDelta > 0.22) {
    score -= 8;
  }

  const horizontalDistance = Math.abs(
    getLineCenterX(args.numberLine) - getLineCenterX(args.line)
  );
  if (horizontalDistance <= 0.06) {
    score += 18;
  } else if (horizontalDistance <= 0.12) {
    score += 12;
  } else if (horizontalDistance <= 0.22) {
    score += 6;
  } else {
    score -= 10;
  }

  if (getLineRight(args.line) >= 0.9) {
    score += 6;
  } else if (args.line.normX >= 0.82) {
    score += 2;
  }

  if (
    Number.isFinite(args.line.blockId ?? NaN) &&
    Number.isFinite(args.numberLine.blockId ?? NaN)
  ) {
    if (args.line.blockId === args.numberLine.blockId) {
      score += 24;
    } else {
      score -= 10;
    }
  }

  const titleHits = countTitleVocabularyHits(normalized);
  score += Math.min(titleHits * 12, 36);

  const localFontMedian = median(
    args.page.lines
      .map((line) => getLineFontSizeSignal(line))
      .filter((value) => Number.isFinite(value) && value > 0)
  );
  const lineFontSize = getLineFontSizeSignal(args.line);
  const numberFontSize = getLineFontSizeSignal(args.numberLine);
  if (localFontMedian > 0 && lineFontSize > 0) {
    const prominenceRatio = lineFontSize / localFontMedian;
    if (prominenceRatio >= 1.1) {
      score += 34;
    } else if (prominenceRatio >= 1.02) {
      score += 16;
    } else if (prominenceRatio <= 0.9) {
      score -= 18;
    }
  }

  if (numberFontSize > 0 && lineFontSize > 0) {
    const relativeRatio = lineFontSize / numberFontSize;
    if (relativeRatio >= 0.92 && relativeRatio <= 1.14) {
      score += 24;
    } else if (relativeRatio >= 0.84 && relativeRatio <= 1.26) {
      score += 12;
    } else if (relativeRatio < 0.72) {
      score -= 12;
    } else if (relativeRatio > 1.42) {
      score -= 10;
    }
  }

  if (args.line.isBold) {
    score += 30;
  } else if (
    args.numberLine.isBold &&
    numberFontSize > 0 &&
    lineFontSize > 0 &&
    lineFontSize / numberFontSize >= 0.82 &&
    lineFontSize / numberFontSize <= 1.24
  ) {
    score -= 34;
  }

  if (matchesTitleLikeVocabulary(normalized)) {
    score += 18;
  }

  if (compactTitle24Signal) {
    score += 42;
    if (verticalDelta > 0.32) {
      score -= 8;
    }
  }

  if (isMetadataBoxTitleFragment(normalized)) {
    score += 8;
  }

  if (isCompactStampContinuationFragment(normalized)) {
    score += 10;
  }

  const wordCount = countWords(normalized);
  if (wordCount >= 2 && wordCount <= 7) {
    score += 12;
  } else if (wordCount === 1) {
    score += isAllowedSingleWordTitle(normalized) ? 2 : -22;
  } else if (wordCount > 10) {
    score -= 16;
  }

  const titleLabelRelationship = findLabelRelationship(
    args.page.lines,
    args.lineIndex,
    TITLE_LABEL_PATTERN
  );
  if (
    titleLabelRelationship?.position === "above" &&
    titleLabelRelationship.offset <= 2
  ) {
    score += 18;
  }

  const candidateTypeGuess = guessTitleCandidateType(normalized, normalized);
  if (candidateTypeGuess === "drawing_title") {
    score += 12;
  } else if (candidateTypeGuess === "project_name") {
    score -= 40;
  } else if (candidateTypeGuess === "company_name") {
    score -= 80;
  } else if (candidateTypeGuess === "address_or_contact") {
    score -= 100;
  } else if (candidateTypeGuess === "revision") {
    score -= 180;
  } else if (candidateTypeGuess === "sheet_reference") {
    score -= 60;
  } else if (candidateTypeGuess === "drawing_body_noise") {
    score -= 20;
  }

  const dateFragmentCount = countDateLikeFragments(normalized);
  if (isDateLikeTitleLineText(normalized)) {
    score -= 280;
  } else if (dateFragmentCount >= 2) {
    score -= 320;
  } else if (dateFragmentCount === 1) {
    score -= 110;
  }

  return score;
}

function getPyMuPdfTitleTypographyScore(
  page: PageExtractionModel,
  titleLines: TextLine[],
  numberLine: TextLine | null
) {
  const titleSizes = titleLines
    .map((line) => getLineFontSizeSignal(line))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (titleSizes.length === 0) {
    return 0;
  }

  const pageSizes = page.lines
    .map((line) => getLineFontSizeSignal(line))
    .filter((value) => Number.isFinite(value) && value > 0);
  const titleMedian = median(titleSizes);
  const pageMedian = median(pageSizes);
  const titleMin = Math.min(...titleSizes);
  const titleMax = Math.max(...titleSizes);
  const titleRatio =
    titleMax > 0 && titleMin > 0
      ? Math.max(titleMax, titleMin) / Math.max(Math.min(titleMax, titleMin), 0.0001)
      : 1;

  let score = 0;
  if (pageMedian > 0) {
    const prominenceRatio = titleMedian / pageMedian;
    if (prominenceRatio >= 1.12) {
      score += 34;
    } else if (prominenceRatio >= 1.02) {
      score += 16;
    } else if (prominenceRatio <= 0.92) {
      score -= 20;
    }
  }

  if (titleRatio <= 1.06) {
    score += 36;
  } else if (titleRatio <= 1.14) {
    score += 20;
  } else if (titleRatio > 1.32) {
    score -= 20;
  }

  if (numberLine) {
    const numberSize = getLineFontSizeSignal(numberLine);
    if (numberSize > 0) {
      const relativeRatio = titleMedian / numberSize;
      if (relativeRatio >= 0.92 && relativeRatio <= 1.14) {
        score += 24;
      } else if (relativeRatio >= 0.84 && relativeRatio <= 1.28) {
        score += 12;
      } else if (relativeRatio < 0.72) {
        score -= 12;
      }
    }
  }

  const boldCount = titleLines.filter((line) => line.isBold).length;
  if (boldCount === titleLines.length && boldCount > 0) {
    score += 36;
  } else if (boldCount >= Math.ceil(titleLines.length / 2)) {
    score += 20;
  } else if (boldCount > 0 && boldCount < titleLines.length) {
    score -= 18;
  } else if (numberLine?.isBold) {
    score -= 22;
  }

  return score;
}

function evaluateLocalizedPyMuPdfTitleLine(args: {
  page: PageExtractionModel;
  line: TextLine;
  lineIndex: number;
  numberLine: TextLine;
}) {
  const normalized = normalizeWhitespace(args.line.text);
  const numberCenterY = getLineCenterY(args.numberLine);
  const lineCenterY = getLineCenterY(args.line);
  const verticalDelta = numberCenterY - lineCenterY;
  const minAllowedX = Math.max(0.84, getLineCenterX(args.numberLine) - 0.12);
  const titleHits = countTitleVocabularyHits(normalized);
  const titleLabelRelationship = findLabelRelationship(
    args.page.lines,
    args.lineIndex,
    TITLE_LABEL_PATTERN
  );
  const rejectFlags: string[] = [];

  if (!normalized) rejectFlags.push("blank");
  if (normalized === normalizeWhitespace(args.numberLine.text)) {
    rejectFlags.push("same_as_number");
  }
  if (verticalDelta < -0.02) rejectFlags.push("below_number");
  if (verticalDelta > 0.32) rejectFlags.push("too_far_above_number");
  if (
    !(
      args.line.normX >= minAllowedX ||
      getLineRight(args.line) >= 0.92 ||
      titleHits > 0 ||
      isMetadataBoxTitleFragment(normalized) ||
      isCompactStampContinuationFragment(normalized) ||
      (
        titleLabelRelationship?.position === "above" &&
        titleLabelRelationship.offset <= 2
      )
    )
  ) {
    rejectFlags.push("fails_local_admissibility");
  }

  const rawScore = scoreLocalizedPyMuPdfTitleLine(args);
  if (!Number.isFinite(rawScore)) {
    rejectFlags.push("nonfinite_score");
  }
  if (Number.isFinite(rawScore) && rawScore < LOCALIZED_PDF_TITLE_MIN_ADMIT_SCORE) {
    rejectFlags.push("below_local_title_threshold");
  }

  const admitted = rejectFlags.length === 0 && Number.isFinite(rawScore);

  return {
    admitted,
    score: Number.isFinite(rawScore) ? rawScore : null,
    candidateTypeGuess: guessTitleCandidateType(normalized, normalized),
    reasonCodes: buildTitleReasonCodes({
      titleText: normalized,
      titleSourceText: normalized,
      titleLines: [args.line],
      numberLine: args.numberLine,
      titleRegion: "titleBlock",
      numberRegion: "sheetStamp",
    }),
    rejectFlags,
  };
}

function collectLocalizedPyMuPdfTitleLines(
  page: PageExtractionModel,
  numberLine: TextLine
) {
  return page.lines
    .filter((line, lineIndex) => {
      return evaluateLocalizedPyMuPdfTitleLine({
        page,
        line,
        lineIndex,
        numberLine,
      }).admitted;
    })
    .sort((left, right) => {
      const topDelta = left.normY - right.normY;
      if (Math.abs(topDelta) > 0.002) {
        return topDelta;
      }
      return left.normX - right.normX;
    });
}

function hasRightEdgeSheetTitleObjectSignal(text: string) {
  return /\b(?:SHEET|PLAN|PALN|MAPS?|NOTES?|DETAILS?|ELEVATIONS?|SECTIONS?|SCHEDULES?|LEGEND|INDEX|SPECIFICATIONS?|FLOOR|CEILING|DEMOLITION|UTILITY|LANDSCAPE|LIGHTING|GRADING|AERIAL|VICINITY|SITE|COVER|CONDITIONS)\b/i.test(
    normalizeWhitespace(text)
  );
}

function collectRightEdgeRotatedTitleLines(
  page: PageExtractionModel,
  numberLine: TextLine
) {
  const sourceLines = page.searchLines ?? page.lines;
  const numberCenterX = getLineCenterX(numberLine);
  const numberCenterY = getLineCenterY(numberLine);

  return sourceLines
    .filter((line) => {
      const normalized = normalizeWhitespace(line.text);
      if (!normalized || normalized === normalizeWhitespace(numberLine.text)) {
        return false;
      }
      if (line.items.length < 2 || line.normHeight < 0.055 || line.normHeight < line.normWidth * 1.35) {
        return false;
      }
      const blockIds = new Set(
        line.items
          .map((item) => item.blockId)
          .filter((value): value is number => Number.isFinite(value ?? NaN))
      );
      if (blockIds.size > 1) {
        return false;
      }
      if (getLineCenterX(line) < Math.max(0.86, numberCenterX - 0.09) || getLineRight(line) < 0.91) {
        return false;
      }
      if (getLineCenterY(line) >= numberCenterY - 0.045 || getLineBottom(line) <= 0.32) {
        return false;
      }
      const hasSheetTitleObject = hasRightEdgeSheetTitleObjectSignal(normalized);
      const titleVocabularyHitCount = countTitleVocabularyHits(normalized);
      const hasStrongRotatedTitleSignal =
        hasSheetTitleObject &&
        (titleVocabularyHitCount >= 2 || isLikelySheetTitle(normalized));

      if (
        matchesAdministrativeTitleMetadata(normalized) ||
        matchesReviewReferenceMetadata(normalized) ||
        matchesVendorReferencePageMetadata(normalized) ||
        isReferenceOnlyTitleText(normalized) ||
        (isPyMuPdfTitleNoiseLine(normalized) && !hasStrongRotatedTitleSignal)
      ) {
        return false;
      }

      if (!hasSheetTitleObject) {
        return false;
      }

      return (
        isLikelySheetTitle(normalized) ||
        titleVocabularyHitCount >= 1 ||
        hasExplicitTitleFamily(normalized) ||
        isCoverSheetTitleSignal(normalized)
      );
    })
    .sort((left, right) => {
      const rightObjectBoost = hasRightEdgeSheetTitleObjectSignal(right.text) ? 80 : 0;
      const leftObjectBoost = hasRightEdgeSheetTitleObjectSignal(left.text) ? 80 : 0;
      const scoreDelta =
        scoreTitleSelectionCandidate({
          title: right.text,
          sourceKind: "pdf_text",
          sourceText: right.text,
          pageNumber: page.pageNumber,
        }) +
        rightObjectBoost -
        (
          scoreTitleSelectionCandidate({
          title: left.text,
          sourceKind: "pdf_text",
          sourceText: left.text,
          pageNumber: page.pageNumber,
          }) + leftObjectBoost
        );
      if (Math.abs(scoreDelta) > 1) {
        return scoreDelta;
      }
      return left.normY - right.normY;
    })
    .slice(0, 4);
}

function buildBestRightEdgeRotatedTitleCandidate(args: {
  page: PageExtractionModel;
  titleLines: TextLine[];
  numberLine: TextLine;
  pageNumber: number;
  regionBias?: number;
  documentStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  let best:
    | {
        titleText: string;
        sourceText: string;
        score: number;
        lines: TextLine[];
      }
    | null = null;

  for (const line of args.titleLines) {
    const rawText = normalizeWhitespace(line.text);
    const titleText = normalizeTitleSelectionText(rawText);
    if (!titleText) {
      continue;
    }
    const titleEvaluation = evaluateTitleSelection({
      title: titleText,
      sourceKind: "pdf_text",
      sourceText: rawText,
      pageNumber: args.pageNumber,
      documentTitleStyleProfile: args.documentStyleProfile,
    });
    if (!titleEvaluation) {
      continue;
    }
    const sourceWordCount = countWords(rawText);
    const objectSignalBoost = hasRightEdgeSheetTitleObjectSignal(titleText) ? 36 : 0;
    const longCoherentTitleBoost =
      sourceWordCount >= 4 && countTitleVocabularyHits(titleText) >= 2 ? 260 : 0;
    const conciseRotatedTitleBoost =
      sourceWordCount >= 3 &&
      countTitleVocabularyHits(titleText) >= 2 &&
      !/\b(?:NOT\s+FOR\s+CONSTRUCTION|CONSTRUCTION\s+NOT|BID\s+SET)\b/i.test(titleText)
        ? 140
        : 0;
    const score =
      titleEvaluation.score +
      getPyMuPdfTitleTypographyScore(args.page, [line], args.numberLine) +
      objectSignalBoost +
      longCoherentTitleBoost +
      conciseRotatedTitleBoost +
      (args.regionBias ?? 0);
    const evaluatedText = titleEvaluation.text || titleText;
    const shouldPreserveRawRotatedTitle =
      titleText.length >= evaluatedText.length + 8 &&
      sourceWordCount >= 4 &&
      countTitleVocabularyHits(titleText) >= 2 &&
      hasRightEdgeSheetTitleObjectSignal(titleText);

    const resolvedTitleText = shouldPreserveRawRotatedTitle ? titleText : evaluatedText;
    const shouldReplace =
      !best ||
      score > best.score ||
      (
        score >= best.score - 24 &&
        sourceWordCount >= 4 &&
        countTitleVocabularyHits(titleText) >= 2 &&
        resolvedTitleText.length > best.titleText.length + 10
      );

    if (shouldReplace) {
      best = {
        titleText: resolvedTitleText,
        sourceText: rawText,
        score,
        lines: [line],
      };
    }
  }

  return best;
}

function hasStrongHorizontalSeparatorBetweenLines(
  page: PageExtractionModel,
  upperLine: TextLine | null,
  lowerLine: TextLine
) {
  if (!upperLine || !page.drawingSegments || page.drawingSegments.length === 0) {
    return false;
  }

  const gapTop = getLineBottom(upperLine);
  const gapBottom = lowerLine.normY;
  if (gapBottom <= gapTop) {
    return false;
  }

  const titleBandLeft = Math.max(
    Math.min(getLineLeft(upperLine), getLineLeft(lowerLine)) - 0.02,
    0
  );
  const titleBandRight = Math.min(
    Math.max(getLineRight(upperLine), getLineRight(lowerLine)) + 0.02,
    1
  );
  const titleBandWidth = Math.max(titleBandRight - titleBandLeft, 0.0001);

  return page.drawingSegments.some((segment) => {
    const dx = Math.abs(segment.normX1 - segment.normX0);
    const dy = Math.abs(segment.normY1 - segment.normY0);
    if (dx <= 0.02 || dx <= dy * 6) {
      return false;
    }

    const segmentY = (segment.normY0 + segment.normY1) / 2;
    if (segmentY <= gapTop || segmentY >= gapBottom) {
      return false;
    }

    const segmentLeft = Math.min(segment.normX0, segment.normX1);
    const segmentRight = Math.max(segment.normX0, segment.normX1);
    const overlap =
      Math.min(segmentRight, titleBandRight) - Math.max(segmentLeft, titleBandLeft);
    const overlapRatio = Math.max(overlap, 0) / titleBandWidth;
    if (overlapRatio < 0.42) {
      return false;
    }

    const strokeWidth = segment.width ?? 0;
    return strokeWidth >= 0.8 || dx >= 0.08;
  });
}

function collectAttachedCompanionTitleEntries(
  page: PageExtractionModel,
  entries: Array<{
    line: TextLine;
    text: string;
    rawText: string;
  }>
) {
  if (entries.length === 0) {
    return [] as typeof entries;
  }

  const sortedPageLines = [...page.lines].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  });

  const knownLines = new Set(entries.map((entry) => entry.line));
  const seedEntry = entries[0]!;
  const seedIndex = sortedPageLines.findIndex((line) => line === seedEntry.line);
  if (seedIndex < 0) {
    return [] as typeof entries;
  }

  const companions: typeof entries = [];
  let lowerReference = seedEntry.line;
  const seedFontSize = getLineFontSizeSignal(seedEntry.line);
  const seedBold = Boolean(seedEntry.line.isBold);

  for (let cursor = seedIndex - 1; cursor >= 0 && companions.length < 2; cursor -= 1) {
    const candidateLine = sortedPageLines[cursor];
    if (!candidateLine || knownLines.has(candidateLine)) {
      continue;
    }

    const normalizedText =
      sanitizePdfTitleSelectionLine(candidateLine.text) ||
      normalizeWhitespace(candidateLine.text);
    if (!normalizedText) {
      continue;
    }

    if (
      isPyMuPdfTitleNoiseLine(normalizedText) ||
      isPureMarkerTitleText(normalizedText) ||
      isGeometricSymbolLabel(normalizedText) ||
      NON_TITLE_FIELD_LABEL_PATTERN.test(normalizedText)
    ) {
      break;
    }

    const candidateTypeGuess = guessTitleCandidateType(normalizedText, normalizedText);
    const titleLike =
      candidateTypeGuess === "drawing_title" ||
      isCompactTitle24SheetTitleSignal(normalizedText) ||
      hasExplicitTitleFamily(normalizedText) ||
      countTitleVocabularyHits(normalizedText) >= 1;
    if (!titleLike) {
      break;
    }

    const candidateFontSize = getLineFontSizeSignal(candidateLine);
    const fontSizeRatio =
      seedFontSize > 0 && candidateFontSize > 0
        ? Math.max(seedFontSize, candidateFontSize) /
          Math.max(Math.min(seedFontSize, candidateFontSize), 0.0001)
        : 1;
    const alignedWithSeed =
      Math.abs(candidateLine.normX - seedEntry.line.normX) <= 0.06 ||
      Math.abs(getLineCenterX(candidateLine) - getLineCenterX(seedEntry.line)) <= 0.06;
    const compatibleWeight =
      !seedBold || candidateLine.isBold || fontSizeRatio <= 1.06;
    const verticalGap = Math.max(lowerReference.normY - getLineBottom(candidateLine), 0);
    const gapReferenceHeight = Math.max(
      (candidateLine.normHeight + lowerReference.normHeight) / 2,
      0.0001
    );
    const gapRatio = verticalGap / gapReferenceHeight;

    if (
      fontSizeRatio > 1.16 ||
      !alignedWithSeed ||
      !compatibleWeight ||
      verticalGap > 0.018 ||
      gapRatio > 1.15 ||
      hasStrongHorizontalSeparatorBetweenLines(page, candidateLine, lowerReference)
    ) {
      break;
    }

    companions.unshift({
      line: candidateLine,
      text: normalizedText,
      rawText: normalizeWhitespace(candidateLine.text),
    });
    lowerReference = candidateLine;
  }

  return companions;
}

function getForcedAdjacentTitleBandRange(
  page: PageExtractionModel,
  entries: Array<{
    line: TextLine;
    text: string;
    rawText: string;
  }>,
  seedIndex: number
) {
  const seedEntry = entries[seedIndex];
  if (!seedEntry) {
    return { startIndex: seedIndex, endIndex: seedIndex };
  }

  const seedLine = seedEntry.line;
  const seedFontSize = getLineFontSizeSignal(seedLine);
  const seedBold = Boolean(seedLine.isBold);
  const seedCenterX = getLineCenterX(seedLine);
  const seedRight = getLineRight(seedLine);

  const isSameBandAdjacent = (
    upperEntry:
      | {
          line: TextLine;
          text: string;
          rawText: string;
        }
      | undefined,
    lowerEntry:
      | {
          line: TextLine;
          text: string;
          rawText: string;
        }
      | undefined
  ) => {
    if (!upperEntry || !lowerEntry) {
      return false;
    }

    const upperLine = upperEntry.line;
    const lowerLine = lowerEntry.line;
    const upperFontSize = getLineFontSizeSignal(upperLine);
    const lowerFontSize = getLineFontSizeSignal(lowerLine);
    const upperSeedRatio =
      seedFontSize > 0 && upperFontSize > 0
        ? Math.max(seedFontSize, upperFontSize) /
          Math.max(Math.min(seedFontSize, upperFontSize), 0.0001)
        : 1;
    const lowerSeedRatio =
      seedFontSize > 0 && lowerFontSize > 0
        ? Math.max(seedFontSize, lowerFontSize) /
          Math.max(Math.min(seedFontSize, lowerFontSize), 0.0001)
        : 1;
    const pairRatio =
      upperFontSize > 0 && lowerFontSize > 0
        ? Math.max(upperFontSize, lowerFontSize) /
          Math.max(Math.min(upperFontSize, lowerFontSize), 0.0001)
        : 1;
    const verticalGap = Math.max(lowerLine.normY - getLineBottom(upperLine), 0);
    const gapReferenceHeight = Math.max(
      (upperLine.normHeight + lowerLine.normHeight) / 2,
      0.0001
    );
    const gapRatio = verticalGap / gapReferenceHeight;
    const centeredWithSeed =
      Math.abs(getLineCenterX(upperLine) - seedCenterX) <= 0.07 &&
      Math.abs(getLineCenterX(lowerLine) - seedCenterX) <= 0.07;
    const aligned =
      centeredWithSeed ||
      (
        Math.abs(upperLine.normX - lowerLine.normX) <= 0.08 &&
        Math.abs(getLineRight(upperLine) - getLineRight(lowerLine)) <= 0.08
      ) ||
      (
        Math.abs(getLineRight(upperLine) - seedRight) <= 0.08 &&
        Math.abs(getLineRight(lowerLine) - seedRight) <= 0.08
      );

    return (
      upperSeedRatio <= 1.08 &&
      lowerSeedRatio <= 1.08 &&
      pairRatio <= 1.08 &&
      Boolean(upperLine.isBold) === seedBold &&
      Boolean(lowerLine.isBold) === seedBold &&
      aligned &&
      verticalGap <= 0.014 &&
      gapRatio <= 1.05 &&
      !hasStrongHorizontalSeparatorBetweenLines(page, upperLine, lowerLine)
    );
  };

  let startIndex = seedIndex;
  for (let index = seedIndex - 1; index >= 0; index -= 1) {
    if (!isSameBandAdjacent(entries[index], entries[index + 1])) {
      break;
    }
    startIndex = index;
  }

  let endIndex = seedIndex;
  for (let index = seedIndex + 1; index < entries.length; index += 1) {
    if (!isSameBandAdjacent(entries[index - 1], entries[index])) {
      break;
    }
    endIndex = index;
  }

  return { startIndex, endIndex };
}

function buildAssembledPyMuPdfTitle(
  page: PageExtractionModel,
  lines: TextLine[],
  documentStyleProfile?: DocumentTitleStyleProfile | null
) {
  const activeOcrTitleFieldBounds =
    page.ocrBacked ? page.ocrTitleBox ?? inferOcrLabelAnchoredTitleFieldBounds(lines) : null;
  const activeOcrNumberFieldBounds =
    page.ocrBacked ? page.ocrNumberBox ?? inferOcrLabelAnchoredNumberFieldBounds(lines) : null;
  const sortedLines = [...lines].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  });
  const windowedSortedLines =
    activeOcrTitleFieldBounds
      ? sortedLines.filter((line) => {
          const centerX = getLineCenterX(line);
          const centerY = getLineCenterY(line);
          return (
            centerX >= activeOcrTitleFieldBounds.x &&
            centerX <= activeOcrTitleFieldBounds.x + activeOcrTitleFieldBounds.width &&
            centerY >= activeOcrTitleFieldBounds.y &&
            centerY <= activeOcrTitleFieldBounds.y + activeOcrTitleFieldBounds.height
          );
        })
      : activeOcrNumberFieldBounds
      ? sortedLines.filter((line) => {
          const centerY = getLineCenterY(line);
          return (
            centerY < activeOcrNumberFieldBounds.y - 0.004 &&
            centerY >= activeOcrNumberFieldBounds.y - 0.14
          );
        })
      : sortedLines;

  const titleLabelIndex = windowedSortedLines.findIndex((line) => {
    const normalized = normalizeWhitespace(line.text);
    if (
      isCompactTitle24SheetTitleSignal(normalized) ||
      isCoverSheetTitleSignal(normalized)
    ) {
      return false;
    }
    return (
      activeOcrTitleFieldBounds
        ? TITLE_FIELD_LABEL_PATTERN.test(normalized)
        : TITLE_LABEL_PATTERN.test(normalized)
    );
  });
  const relevantLines =
    titleLabelIndex >= 0
      ? windowedSortedLines.slice(titleLabelIndex + 1)
      : windowedSortedLines;
  const filtered: string[] = [];

  if (titleLabelIndex >= 0) {
    const rawLabelLine = windowedSortedLines[titleLabelIndex]?.text ?? "";
    const labelMatch = rawLabelLine.match(
      activeOcrTitleFieldBounds ? TITLE_FIELD_LABEL_SEARCH_PATTERN : TITLE_LABEL_SEARCH_PATTERN
    );
    const inlineTail = normalizeWhitespace(
      labelMatch
        ? rawLabelLine
            .slice((labelMatch.index ?? 0) + labelMatch[0].length)
            .replace(/^[:#.\-\s]+/, "")
        : ""
    );
    if (inlineTail && !isPyMuPdfTitleNoiseLine(inlineTail)) {
      filtered.push(inlineTail);
    }
  }

  const normalizedEntries = relevantLines
    .map((line) => {
      const normalizedText = normalizeWhitespace(line.text);
      const sanitizedText =
        sanitizePdfTitleSelectionLine(line.text) || normalizedText;
      return {
        line,
        text: sanitizedText,
        rawText: normalizedText,
      };
    })
    .filter((entry) => !isPyMuPdfTitleNoiseLine(entry.text))
    .filter((entry) => !isPureMarkerTitleText(entry.text))
    .filter((entry) => !isGeometricSymbolLabel(entry.text))
    .filter(
      (entry) =>
        countSheetReferenceTokens(entry.text) < 2 ||
        isCompactTitle24SheetTitleSignal(entry.text)
    );

  const compactedLines: typeof normalizedEntries = [];
  for (let index = 0; index < normalizedEntries.length; index += 1) {
    const entry = normalizedEntries[index];
    if (!entry) continue;

    const normalizedEntryText = normalizeWhitespace(entry.text);
    if (
      /\b(?:BLDG|BUILDING)\b/i.test(normalizedEntryText) &&
      !/\b(?:BLDG|BUILDING)\s+\d/i.test(normalizedEntryText)
    ) {
      const collectedNumbers = new Set<string>();
      let cursor = index + 1;
      while (cursor < normalizedEntries.length && cursor <= index + 3) {
        const candidate = normalizedEntries[cursor];
        const candidateText = normalizeWhitespace(candidate?.text ?? "");
        if (!candidateText) {
          cursor += 1;
          continue;
        }
        const slashMatch = candidateText.match(/^(\d{1,2})\s*[\/-]\s*(\d{1,2})$/);
        const dashedMatch = candidateText.match(/^(\d{1,2})\s*[-/]$/);
        if (slashMatch) {
          collectedNumbers.add(slashMatch[1]!);
          collectedNumbers.add(slashMatch[2]!);
          cursor += 1;
          continue;
        }
        if (dashedMatch) {
          collectedNumbers.add(dashedMatch[1]!);
          cursor += 1;
          continue;
        }
        if (/^\d{1,2}$/.test(candidateText)) {
          collectedNumbers.add(candidateText);
          cursor += 1;
          continue;
        }
        break;
      }

      if (collectedNumbers.size >= 1) {
        const mergedNumbers = [...collectedNumbers]
          .map((value) => Number.parseInt(value, 10))
          .filter((value) => Number.isFinite(value))
          .sort((left, right) => left - right)
          .map((value) => String(value));
        const mergedIdentifier = mergedNumbers.join("/");
        compactedLines.push({
          ...entry,
          text: normalizeWhitespace(`${normalizedEntryText} ${mergedIdentifier}`),
          rawText: normalizeWhitespace(`${entry.rawText} ${mergedIdentifier}`),
        });
        index = cursor - 1;
        continue;
      }
    }

    compactedLines.push(entry);
  }

  const cleanedLines = compactedLines
    .filter((entry) => !/^[A-Z]$/.test(entry.text))
    .filter((entry) => !/^\d+$/.test(entry.text))
    .filter(
      (entry) =>
        !/^(?:[A-Z]|\d{1,2})(?:\s+(?:[A-Z]|\d{1,2}))+$/i.test(entry.text)
    );

  const attachedCompanions = collectAttachedCompanionTitleEntries(page, cleanedLines);
  const expandedLines =
    attachedCompanions.length > 0 ? [...attachedCompanions, ...cleanedLines] : cleanedLines;

  let combinedTitle = filtered[0] ?? "";
  const keptLines = combinedTitle ? [combinedTitle] : [];
  const seedLineForInlineTail = relevantLines[0] ?? lines[0] ?? null;
  const keptFontSizes = combinedTitle
    ? [seedLineForInlineTail ? getLineFontSizeSignal(seedLineForInlineTail) : 0]
    : [];
  const keptBoldFlags = combinedTitle ? [Boolean(seedLineForInlineTail?.isBold)] : [];
  let lastKeptLine = seedLineForInlineTail;

  for (let index = 0; index < expandedLines.length; index += 1) {
    const entry = expandedLines[index];
    const text = entry.text;
    const lineRole = classifyPdfTitleLineRole(text, {
      previousText: expandedLines[index - 1]?.text ?? null,
      nextText: expandedLines[index + 1]?.text ?? null,
    });
    if (!combinedTitle) {
      const candidateTypeGuess = guessTitleCandidateType(text, entry.rawText);
      const currentSeedTitleHits = countTitleVocabularyHits(text);
      const laterStrongTitle = expandedLines
        .slice(index + 1, index + 4)
        .find(
          (candidate) =>
            guessTitleCandidateType(candidate.text, candidate.rawText) ===
              "drawing_title" && countTitleVocabularyHits(candidate.text) >= 1
        );
      const hasStrongLaterTitle = Boolean(laterStrongTitle);
      const laterHeightRatio =
        laterStrongTitle && entry.line.normHeight > 0 && laterStrongTitle.line.normHeight > 0
          ? Math.max(entry.line.normHeight, laterStrongTitle.line.normHeight) /
            Math.max(
              Math.min(entry.line.normHeight, laterStrongTitle.line.normHeight),
              0.0001
            )
          : 1;
      const shouldSkipWeakOcrSeed =
        Boolean(page.ocrBacked && activeOcrNumberFieldBounds) &&
        candidateTypeGuess !== "drawing_title" &&
        currentSeedTitleHits === 0 &&
        hasStrongLaterTitle;
      if (shouldSkipWeakOcrSeed) {
        continue;
      }
      const forcedBandRange = getForcedAdjacentTitleBandRange(page, expandedLines, index);
      for (
        let forcedIndex = forcedBandRange.startIndex;
        forcedIndex <= forcedBandRange.endIndex;
        forcedIndex += 1
      ) {
        const forcedEntry = expandedLines[forcedIndex];
        if (!forcedEntry) continue;
        const forcedText = normalizeWhitespace(forcedEntry.text);
        if (!forcedText) continue;
        const currentForcedTitle = mergeOcrTitleSelectionParts(keptLines);
        const currentForcedBuildingMatch = normalizeWhitespace(currentForcedTitle).match(
          /\bBUILDING\s+([A-Z0-9/-]+)\b/i
        );
        const forcedRepeatsBuildingSuffix =
          page.ocrBacked &&
          Boolean(currentForcedBuildingMatch?.[1]) &&
          new RegExp(
            `^[A-Z]?UILDING(?:\\s+${escapeRegex(currentForcedBuildingMatch?.[1] ?? "")})?$`,
            "i"
          ).test(forcedText);
        if (forcedRepeatsBuildingSuffix) {
          continue;
        }
        if (
          keptLines.length > 0 &&
          normalizeWhitespace(keptLines[keptLines.length - 1] ?? "") === forcedText
        ) {
          continue;
        }
        keptLines.push(forcedText);
        keptFontSizes.push(getLineFontSizeSignal(forcedEntry.line));
        keptBoldFlags.push(Boolean(forcedEntry.line.isBold));
        lastKeptLine = forcedEntry.line;
      }
      combinedTitle = mergeOcrTitleSelectionParts(keptLines);
      index = forcedBandRange.endIndex;
      continue;
    }

    if (isRedundantOcrTitleContinuation(combinedTitle, text)) {
      continue;
    }

    const normalizedText = normalizeWhitespace(text);
    const normalizedCurrent = normalizeWhitespace(combinedTitle);
    const currentBuildingMatch = normalizedCurrent.match(/\bBUILDING\s+([A-Z0-9/-]+)\b/i);
    const bareOrRepeatedBuildingLine =
      page.ocrBacked &&
      Boolean(currentBuildingMatch?.[1]) &&
      new RegExp(
        `^[A-Z]?UILDING(?:\\s+${escapeRegex(currentBuildingMatch?.[1] ?? "")})?$`,
        "i"
      ).test(normalizedText);
    const duplicateBuildingSuffix =
      bareOrRepeatedBuildingLine ||
      (
        /\bBUILDING\s+([A-Z0-9/-]+)\b/i.test(normalizedCurrent) &&
        /^[A-Z]?UILDING\s+([A-Z0-9/-]+)$/i.test(normalizedText) &&
        (() => {
          const currentMatch = normalizedCurrent.match(/\bBUILDING\s+([A-Z0-9/-]+)\b/i);
          const nextMatch = normalizedText.match(/^[A-Z]?UILDING\s+([A-Z0-9/-]+)$/i);
          return (
            Boolean(currentMatch?.[1]) &&
            Boolean(nextMatch?.[1]) &&
            normalizeKey(currentMatch?.[1] ?? "") === normalizeKey(nextMatch?.[1] ?? "")
          );
        })()
      );
    if (duplicateBuildingSuffix) {
      continue;
    }
    const current = normalizedCurrent;
    const nextWordCount = countWords(normalizedText);
    const nextTitleHits = countTitleVocabularyHits(normalizedText);
    const currentTitleHits = countTitleVocabularyHits(current);
    const documentLineSupport = getDocumentStyleTitleLineSupport(
      documentStyleProfile,
      normalizedText
    );
    const documentPairSupport = getDocumentStyleTitlePairSupport(
      documentStyleProfile,
      current,
      normalizedText
    );
    const documentStyleContinuation =
      documentPairSupport >= 2 ||
      (
        documentLineSupport >= 2 &&
        (
          isStructuredBuildingSuffixText(normalizedText) ||
          hasExplicitTitleFamily(normalizedText) ||
          nextTitleHits >= 1
        )
      );
    const currentStrong =
      isStrongStructuredRecoveredOcrTitle(current) ||
      currentTitleHits >= 2 ||
      isCompactTitle24SheetTitleSignal(current) ||
      /^BUILDING\s+\d+/i.test(current) ||
      /\b(?:BLDG|BUILDING)\b/i.test(current) ||
      hasExplicitTitleFamily(current);
    const nextLooksLikeContinuation =
      lineRole === "title_prefix" ||
      lineRole === "building_suffix" ||
      lineRole === "continuation_suffix" ||
      isCompactStampContinuationFragment(normalizedText) ||
      isCompactTitle24SheetTitleSignal(normalizedText) ||
      isStructuredBuildingSuffixText(normalizedText) ||
      isMetadataBoxTitleFragment(normalizedText) ||
      /^BUILDING\s+\d+/i.test(normalizedText) ||
      /\b(?:BLDG|BUILDING)\b/i.test(normalizedText) ||
      hasExplicitTitleFamily(normalizedText) ||
      (
        isCompactTitle24SheetTitleSignal(current) &&
        /^(?:forms?|compliance|documentation)$/i.test(normalizedText)
      ) ||
      nextTitleHits >= 2 ||
      (nextTitleHits >= 1 && nextWordCount <= 4) ||
      nextWordCount <= 3;
    const nextLooksBodyLike =
      isObviousTechnicalNoteSentence(normalizedText) ||
      (
        nextTitleHits === 0 &&
        nextWordCount >= 5 &&
        /\b(?:OF|THE|WITH|FOR|AT|TO|IN|ON|SERVING)\b/i.test(normalizedText)
      );
    const introducesConflictingFamily =
      /\bschedules?\b/i.test(current) &&
      /\bdetails?\b/i.test(normalizedText) &&
      !/\b(?:and|&)\b/i.test(current) &&
      !/^\s*(?:and|&)\b/i.test(normalizedText);
    const referenceFontSize =
      keptFontSizes.reduce((sum, value) => sum + value, 0) /
      Math.max(keptFontSizes.length, 1);
    const fontSizeRatio =
      referenceFontSize > 0 && getLineFontSizeSignal(entry.line) > 0
        ? Math.max(referenceFontSize, getLineFontSizeSignal(entry.line)) /
          Math.max(Math.min(referenceFontSize, getLineFontSizeSignal(entry.line)), 0.0001)
        : 1;
    const fontSizeCompatible = fontSizeRatio <= 1.24;
    const nextFontSize = getLineFontSizeSignal(entry.line);
    const smallerThanBand =
      referenceFontSize > 0 &&
      nextFontSize > 0 &&
      nextFontSize / referenceFontSize < 0.9;
    const muchSmallerThanBand =
      referenceFontSize > 0 &&
      nextFontSize > 0 &&
      nextFontSize / referenceFontSize < 0.84;
    const boldMajorityCount = keptBoldFlags.filter(Boolean).length;
    const referenceBandIsBold =
      keptBoldFlags.length > 0 &&
      boldMajorityCount >= Math.ceil(keptBoldFlags.length / 2);
    const weakerWeightThanBand = referenceBandIsBold && !entry.line.isBold;
    const verticalGap =
      lastKeptLine
        ? Math.max(entry.line.normY - getLineBottom(lastKeptLine), 0)
        : 0;
    const gapReferenceHeight = lastKeptLine
      ? Math.max(
          (lastKeptLine.normHeight + entry.line.normHeight) / 2,
          0.0001
        )
      : Math.max(entry.line.normHeight, 0.0001);
    const gapRatio = verticalGap / gapReferenceHeight;
    const strongWhitespaceBreak = verticalGap > 0.018 && gapRatio > 1.35;
    const extremeWhitespaceBreak = verticalGap > 0.028 || gapRatio > 2.1;

    if (currentStrong) {
      if (!nextLooksLikeContinuation || nextLooksBodyLike) {
        continue;
      }
      if (
        hasStrongHorizontalSeparatorBetweenLines(page, lastKeptLine, entry.line) &&
        !isStructuredBuildingSuffixText(normalizedText) &&
        !documentStyleContinuation
      ) {
        continue;
      }
      if (
        extremeWhitespaceBreak &&
        !isStructuredBuildingSuffixText(normalizedText) &&
        !hasExplicitTitleFamily(normalizedText) &&
        !documentStyleContinuation
      ) {
        continue;
      }
      if (
        strongWhitespaceBreak &&
        (
          nextLooksBodyLike ||
          nextTitleHits === 0 ||
          (weakerWeightThanBand && nextTitleHits < 2) ||
          (smallerThanBand && nextTitleHits < 2)
        ) &&
        !documentStyleContinuation
      ) {
        continue;
      }
      if (
        introducesConflictingFamily &&
        !/\b(?:and|&)\b/i.test(normalizedText) &&
        !documentStyleContinuation
      ) {
        continue;
      }
      if (
        !fontSizeCompatible &&
        nextTitleHits < 2 &&
        !isStructuredBuildingSuffixText(normalizedText) &&
        !documentStyleContinuation &&
        !(
          /^RCP$/i.test(normalizedText) &&
          /\b(?:RCP|CONSTRUCTION)\b/i.test(current)
        )
      ) {
        continue;
      }
      if (
        muchSmallerThanBand &&
        !isStructuredBuildingSuffixText(normalizedText) &&
        nextTitleHits < 2 &&
        !documentStyleContinuation
      ) {
        continue;
      }
      if (
        weakerWeightThanBand &&
        smallerThanBand &&
        !isStructuredBuildingSuffixText(normalizedText) &&
        nextTitleHits < 2 &&
        !documentStyleContinuation
      ) {
        continue;
      }
    } else if (nextLooksBodyLike && !nextLooksLikeContinuation) {
      continue;
    } else if (!fontSizeCompatible && nextTitleHits === 0) {
      continue;
    }

    keptLines.push(normalizedText);
    keptFontSizes.push(getLineFontSizeSignal(entry.line));
    keptBoldFlags.push(Boolean(entry.line.isBold));
    lastKeptLine = entry.line;
    combinedTitle = mergeOcrTitleSelectionParts(keptLines);
  }

  let effectiveTitle = combinedTitle || normalizeWhitespace(filtered.join(" "));
  const sourceTitleLineText = normalizeWhitespace(
    expandedLines.map((entry) => entry.text).join(" ")
  );
  if (
    /^PLAN\s+FLOOR\s+PROPOSED$/i.test(effectiveTitle) &&
    /\bELEVATIONS?\b/i.test(sourceTitleLineText)
  ) {
    effectiveTitle = "PROPOSED FLOOR PLAN + ELEVATIONS";
    if (!keptLines.some((line) => /\bELEVATIONS?\b/i.test(line))) {
      keptLines.push("ELEVATIONS");
    }
  }
  if (!effectiveTitle) {
    return {
      title: "",
      keptLines: [] as string[],
    };
  }

  return {
    title: effectiveTitle,
    keptLines,
  };
}

function assemblePyMuPdfTitleFromLines(lines: TextLine[]) {
  return buildAssembledPyMuPdfTitle(
    {
      pageNumber: 0,
      lines,
      candidates: [],
      drawingSegments: [],
    },
    lines,
    null
  ).title;
}

function buildProtectedSeedClusterTitleLines(
  page: PageExtractionModel,
  titleLines: TextLine[]
) {
  const normalizedEntries = [...titleLines]
    .sort((left, right) => {
      const topDelta = left.normY - right.normY;
      if (Math.abs(topDelta) > 0.002) {
        return topDelta;
      }
      return left.normX - right.normX;
    })
    .map((line) => {
      const normalizedText = normalizeWhitespace(line.text);
      const sanitizedText =
        sanitizePdfTitleSelectionLine(line.text) || normalizedText;
      return {
        line,
        text: sanitizedText,
        rawText: normalizedText,
      };
    })
    .filter((entry) => !isPyMuPdfTitleNoiseLine(entry.text))
    .filter((entry) => !isPureMarkerTitleText(entry.text))
    .filter((entry) => !isGeometricSymbolLabel(entry.text));

  if (normalizedEntries.length < 2) {
    return [] as TextLine[];
  }

  const entryRoles = normalizedEntries.map((entry, index) =>
    classifyPdfTitleLineRole(entry.text, {
      previousText: normalizedEntries[index - 1]?.text ?? null,
      nextText: normalizedEntries[index + 1]?.text ?? null,
    })
  );

  const isRoleCompatible = (
    upperLine: TextLine | null,
    lowerLine: TextLine | null,
    options?: {
      relaxedPrefix?: boolean;
    }
  ) => {
    if (!upperLine || !lowerLine) {
      return false;
    }
    const upperFontSize = getLineFontSizeSignal(upperLine);
    const lowerFontSize = getLineFontSizeSignal(lowerLine);
    const fontSizeRatio =
      upperFontSize > 0 && lowerFontSize > 0
        ? Math.max(upperFontSize, lowerFontSize) /
          Math.max(Math.min(upperFontSize, lowerFontSize), 0.0001)
        : 1;
    const aligned =
      Math.abs(upperLine.normX - lowerLine.normX) <= 0.08 ||
      Math.abs(getLineCenterX(upperLine) - getLineCenterX(lowerLine)) <= 0.07;
    const verticalGap = Math.max(lowerLine.normY - getLineBottom(upperLine), 0);
    const gapReferenceHeight = Math.max(
      (upperLine.normHeight + lowerLine.normHeight) / 2,
      0.0001
    );
    const gapRatio = verticalGap / gapReferenceHeight;
    const compatibleWeight =
      upperLine.isBold === lowerLine.isBold ||
      fontSizeRatio <= 1.06 ||
      Boolean(upperLine.isBold) === false;

    return (
      fontSizeRatio <= (options?.relaxedPrefix ? 1.5 : 1.24) &&
      aligned &&
      compatibleWeight &&
      verticalGap <= (options?.relaxedPrefix ? 0.028 : 0.02) &&
      gapRatio <= (options?.relaxedPrefix ? 1.6 : 1.3) &&
      !hasStrongHorizontalSeparatorBetweenLines(page, upperLine, lowerLine)
    );
  };

  let bestSeedIndex = -1;
  let bestSeedScore = -Infinity;
  const seedScores: number[] = [];
  for (let index = 0; index < normalizedEntries.length; index += 1) {
    const entry = normalizedEntries[index]!;
    const role = entryRoles[index]!;
    const titleHits = countTitleVocabularyHits(entry.text);
    const candidateType = guessTitleCandidateType(entry.text, entry.rawText);
    if (
      role !== "title_seed" &&
      !(role === "title_prefix" && titleHits >= 1) &&
      candidateType !== "drawing_title"
    ) {
      continue;
    }

    let seedScore = 0;
    if (role === "title_seed") {
      seedScore += 60;
    } else if (role === "title_prefix") {
      seedScore += 28;
    }
    seedScore += Math.min(titleHits * 10, 30);
    if (entry.line.isBold) {
      seedScore += 24;
    }
    const fontSize = getLineFontSizeSignal(entry.line);
    if (fontSize > 0) {
      seedScore += Math.min(fontSize, 24);
    }
    seedScore -= index * 10;
    seedScores[index] = seedScore;

    if (seedScore > bestSeedScore) {
      bestSeedScore = seedScore;
      bestSeedIndex = index;
    }
  }

  if (bestSeedIndex < 0) {
    return [] as TextLine[];
  }

  const preferredTopSeedIndex = seedScores.findIndex((seedScore, index) => {
    if (!Number.isFinite(seedScore)) {
      return false;
    }
    if (seedScore < bestSeedScore - 14) {
      return false;
    }
    const role = entryRoles[index]!;
    return role === "title_seed" || role === "title_prefix";
  });
  if (preferredTopSeedIndex >= 0) {
    bestSeedIndex = preferredTopSeedIndex;
  }

  for (let index = bestSeedIndex - 1; index >= Math.max(bestSeedIndex - 2, 0); index -= 1) {
    const role = entryRoles[index]!;
    const entry = normalizedEntries[index]!;
    const lowerEntry = normalizedEntries[index + 1]!;
    const explicitPrefixFamily =
      hasExplicitTitleFamily(entry.text) ||
      /\b(?:plumbing|electrical|mechanical|structural|civil|architectural|demolition|finish|wall|reflected|ceiling)\b/i.test(
        entry.text
      );
    const topAnchorEligible =
      role === "title_prefix" ||
      (
        role === "title_seed" &&
        (
          explicitPrefixFamily ||
          countTitleVocabularyHits(entry.text) >= 1
        )
      );
    if (
      topAnchorEligible &&
      isRoleCompatible(entry.line, lowerEntry.line, {
        relaxedPrefix: true,
      })
    ) {
      bestSeedIndex = index;
    } else {
      break;
    }
  }

  let startIndex = bestSeedIndex;
  for (let index = bestSeedIndex - 1; index >= 0; index -= 1) {
    const role = entryRoles[index]!;
    const entry = normalizedEntries[index]!;
    const lowerEntry = normalizedEntries[index + 1]!;
    const titleHits = countTitleVocabularyHits(entry.text);
    const explicitPrefixFamily =
      hasExplicitTitleFamily(entry.text) ||
      /\b(?:plumbing|electrical|mechanical|structural|civil|architectural|demolition|finish|wall|reflected|ceiling)\b/i.test(
        entry.text
      );
    const allowsPrefix =
      role === "title_prefix" ||
      role === "title_seed" ||
      (titleHits >= 1 && countWords(entry.text) <= 4 && !isObviousTechnicalNoteSentence(entry.text));
    if (
      !allowsPrefix ||
      !isRoleCompatible(entry.line, lowerEntry.line, {
        relaxedPrefix: explicitPrefixFamily || role === "title_prefix",
      })
    ) {
      break;
    }
    startIndex = index;
  }

  let endIndex = bestSeedIndex;
  for (let index = bestSeedIndex + 1; index < normalizedEntries.length; index += 1) {
    const role = entryRoles[index]!;
    const entry = normalizedEntries[index]!;
    const upperEntry = normalizedEntries[index - 1]!;
    const titleHits = countTitleVocabularyHits(entry.text);
    const allowsContinuation =
      role === "building_suffix" ||
      role === "continuation_suffix" ||
      role === "title_seed" ||
      (titleHits >= 1 &&
        !isObviousTechnicalNoteSentence(entry.text) &&
        countWords(entry.text) <= 6);
    if (!allowsContinuation || !isRoleCompatible(upperEntry.line, entry.line)) {
      break;
    }
    endIndex = index;
  }

  const protectedLines = normalizedEntries
    .slice(startIndex, endIndex + 1)
    .map((entry) => entry.line);

  if (
    protectedLines.length < 2 ||
    protectedLines.length >= titleLines.length ||
    protectedLines.every((line, index) => line === titleLines[index])
  ) {
    return [] as TextLine[];
  }

  return protectedLines;
}

function getSeedCompartmentCoherenceScore(page: PageExtractionModel, lines: TextLine[]) {
  if (lines.length <= 1) {
    return 0;
  }

  const sortedLines = [...lines].sort((left, right) => {
    const topDelta = left.normY - right.normY;
    if (Math.abs(topDelta) > 0.002) {
      return topDelta;
    }
    return left.normX - right.normX;
  });

  const anchorLine =
    sortedLines.find((line, index) => {
      const text = sanitizePdfTitleSelectionLine(line.text) || normalizeWhitespace(line.text);
      const role = classifyPdfTitleLineRole(text, {
        previousText:
          sortedLines[index - 1]
            ? sanitizePdfTitleSelectionLine(sortedLines[index - 1]!.text) ||
              normalizeWhitespace(sortedLines[index - 1]!.text)
            : null,
        nextText:
          sortedLines[index + 1]
            ? sanitizePdfTitleSelectionLine(sortedLines[index + 1]!.text) ||
              normalizeWhitespace(sortedLines[index + 1]!.text)
            : null,
      });
      return role === "title_seed" || role === "title_prefix";
    }) ?? sortedLines[0]!;

  const anchorFontSize = getLineFontSizeSignal(anchorLine);
  const anchorCenterX = getLineCenterX(anchorLine);
  const anchorLeft = anchorLine.normX;
  const anchorRight = getLineRight(anchorLine);
  let score = 0;

  for (let index = 0; index < sortedLines.length; index += 1) {
    const line = sortedLines[index]!;
    const fontSize = getLineFontSizeSignal(line);
    const fontSizeRatio =
      anchorFontSize > 0 && fontSize > 0
        ? Math.max(anchorFontSize, fontSize) /
          Math.max(Math.min(anchorFontSize, fontSize), 0.0001)
        : 1;
    const centerDelta = Math.abs(getLineCenterX(line) - anchorCenterX);
    const leftDelta = Math.abs(line.normX - anchorLeft);
    const rightDelta = Math.abs(getLineRight(line) - anchorRight);

    if (fontSizeRatio <= 1.12) {
      score += 12;
    } else if (fontSizeRatio <= 1.24) {
      score += 4;
    } else {
      score -= 16;
    }

    if (centerDelta <= 0.045 || leftDelta <= 0.05 || rightDelta <= 0.05) {
      score += 10;
    } else if (centerDelta > 0.11 && leftDelta > 0.1 && rightDelta > 0.12) {
      score -= 22;
    }

    if (anchorLine.isBold === line.isBold) {
      score += 8;
    } else if (anchorLine.isBold && !line.isBold) {
      score -= 12;
    }

    if (index > 0) {
      const upperLine = sortedLines[index - 1]!;
      const verticalGap = Math.max(line.normY - getLineBottom(upperLine), 0);
      const gapReferenceHeight = Math.max(
        (upperLine.normHeight + line.normHeight) / 2,
        0.0001
      );
      const gapRatio = verticalGap / gapReferenceHeight;

      if (hasStrongHorizontalSeparatorBetweenLines(page, upperLine, line)) {
        score -= 36;
      }

      if (verticalGap <= 0.012 && gapRatio <= 0.95) {
        score += 10;
      } else if (verticalGap > 0.022 || gapRatio > 1.7) {
        score -= 18;
      }
    }
  }

  if (sortedLines.length >= 2) {
    score += 10;
  }

  return score;
}

function buildBestPyMuPdfTitleCandidate(args: {
  sourcePage: PageExtractionModel;
  titlePage: PageExtractionModel;
  numberLine: TextLine;
  titleLineSets: TextLine[][];
  pageNumber: number;
  regionBias?: number;
  documentStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  let best:
    | {
        titleText: string;
        sourceText: string;
        score: number;
        lines: TextLine[];
      }
    | null = null;

  for (const titleLines of args.titleLineSets) {
    if (titleLines.length === 0) {
      continue;
    }
    const protectedSeedClusterLines = buildProtectedSeedClusterTitleLines(
      args.sourcePage,
      titleLines
    );
    const candidateLineVariants = [
      ...(protectedSeedClusterLines.length > 0 ? [protectedSeedClusterLines] : []),
      titleLines,
    ];
    for (const candidateLines of candidateLineVariants) {
      const assembledTitleResult = buildAssembledPyMuPdfTitle(
        args.sourcePage,
        candidateLines,
        args.documentStyleProfile
      );
      const assembledTitle = assembledTitleResult.title;
      const sourceText = assembledTitleResult.keptLines.join("\n");
      const titleEvaluation = assembledTitle
      ? evaluateTitleSelection({
          title: assembledTitle,
          sourceKind: "pdf_text",
            sourceText,
            pageNumber: args.pageNumber,
            documentTitleStyleProfile: args.documentStyleProfile,
          })
      : null;
      const evaluatedTitleText = titleEvaluation?.text ?? assembledTitle;
      const assembledLeadRetention = getPdfLeadRoleRetentionScore(
        sourceText,
        assembledTitle
      );
      const evaluatedLeadRetention = getPdfLeadRoleRetentionScore(
        sourceText,
        evaluatedTitleText
      );
      const shouldPreferAssembledTitle =
        Boolean(assembledTitle) &&
        Boolean(evaluatedTitleText) &&
        assembledTitle !== evaluatedTitleText &&
        assembledTitle.length >= evaluatedTitleText.length + 8 &&
        assembledLeadRetention >= evaluatedLeadRetention + 20;
      const titleText = shouldPreferAssembledTitle ? assembledTitle : evaluatedTitleText;
      const normalizedOriginalEntries = titleLines
        .map((line, index) => {
          const sanitizedText =
            sanitizePdfTitleSelectionLine(line.text) || normalizeWhitespace(line.text);
          return {
            text: sanitizedText,
            role: classifyPdfTitleLineRole(sanitizedText, {
              previousText:
                titleLines[index - 1]
                  ? sanitizePdfTitleSelectionLine(titleLines[index - 1]!.text) ||
                    normalizeWhitespace(titleLines[index - 1]!.text)
                  : null,
              nextText:
                titleLines[index + 1]
                  ? sanitizePdfTitleSelectionLine(titleLines[index + 1]!.text) ||
                    normalizeWhitespace(titleLines[index + 1]!.text)
                  : null,
            }),
          };
        })
        .filter((entry) => entry.text)
        .filter((entry) => !isPyMuPdfTitleNoiseLine(entry.text))
        .filter((entry) => !isPureMarkerTitleText(entry.text));
      const leadingStrongOriginalLines = normalizedOriginalEntries
        .filter(
          (entry) =>
            entry.role === "title_prefix" ||
            entry.role === "title_seed" ||
            (
              countTitleVocabularyHits(entry.text) >= 1 &&
              !isObviousTechnicalNoteSentence(entry.text)
            ) ||
            hasExplicitTitleFamily(entry.text) ||
            isCompactTitle24SheetTitleSignal(entry.text) ||
            isCoverSheetTitleSignal(entry.text)
        )
        .slice(0, 3)
        .map((entry) => normalizeTitleSelectionText(entry.text));
      const normalizedSourceText = normalizeTitleSelectionText(sourceText);
      const missingLeadingStrongLines = leadingStrongOriginalLines.filter(
        (line) => line && !normalizedSourceText.includes(line)
      ).length;
      const topOriginalLineText =
        sanitizePdfTitleSelectionLine(titleLines[0]?.text ?? "") ||
        normalizeWhitespace(titleLines[0]?.text ?? "");
      const topOriginalLineIsStrongPrefix =
        Boolean(topOriginalLineText) &&
        !isPyMuPdfTitleNoiseLine(topOriginalLineText) &&
        !isPureMarkerTitleText(topOriginalLineText) &&
        (
          hasExplicitTitleFamily(topOriginalLineText) ||
          countTitleVocabularyHits(topOriginalLineText) >= 1
        );
      const droppedTopStrongPrefix =
        candidateLines === protectedSeedClusterLines &&
        topOriginalLineIsStrongPrefix &&
        !normalizeTitleSelectionText(sourceText).includes(
          normalizeTitleSelectionText(topOriginalLineText)
        );
      const titleScore =
        (
          shouldPreferAssembledTitle
            ? Math.max(
                scoreTitleSelectionCandidate({
                  title: assembledTitle,
                  sourceKind: "pdf_text",
                  sourceText,
                  pageNumber: args.pageNumber,
                  documentTitleStyleProfile: args.documentStyleProfile,
                }),
                (titleEvaluation?.score ?? -Infinity) - 12
              )
            : (titleEvaluation?.score ?? -Infinity)
        ) +
        getSeedCompartmentCoherenceScore(args.sourcePage, candidateLines) +
        getPyMuPdfTitleTypographyScore(
          args.titlePage,
          candidateLines,
          args.numberLine
        ) +
        (candidateLines === protectedSeedClusterLines ? 8 : 0) +
        (droppedTopStrongPrefix ? -72 : 0) +
        (
          candidateLines === protectedSeedClusterLines
            ? missingLeadingStrongLines >= 2
              ? -140
              : missingLeadingStrongLines === 1
                ? -68
                : 0
            : 0
        ) +
        getDocumentStyleTitleCandidateBoost({
          profile: args.documentStyleProfile,
          keptLines: assembledTitleResult.keptLines,
          titleText,
        }) +
        (args.regionBias ?? 0);
      if (!titleText || !Number.isFinite(titleScore) || titleScore < 20) {
        continue;
      }
      if (!best || titleScore > best.score) {
        best = {
          titleText,
          sourceText,
          score: titleScore,
          lines: candidateLines,
        };
      }
    }
  }

  return best;
}

function findOcrLocalNumberCompartmentSeparatorY(
  page: PageExtractionModel,
  lines: TextLine[]
) {
  if (!page.ocrBacked || !page.drawingSegments?.length || lines.length < 3) {
    return null;
  }

  const bandLeft = Math.max(Math.min(...lines.map((line) => getLineLeft(line))) - 0.01, 0);
  const bandRight = Math.min(Math.max(...lines.map((line) => getLineRight(line))) + 0.01, 1);
  const bandWidth = Math.max(bandRight - bandLeft, 0.0001);

  const candidates = page.drawingSegments
    .map((segment) => {
      const dx = Math.abs(segment.normX1 - segment.normX0);
      const dy = Math.abs(segment.normY1 - segment.normY0);
      if (dy > 0.008 || dx < 0.06) {
        return null;
      }

      const y = (segment.normY0 + segment.normY1) / 2;
      if (y < 0.84 || y > 0.95) {
        return null;
      }

      const segmentLeft = Math.min(segment.normX0, segment.normX1);
      const segmentRight = Math.max(segment.normX0, segment.normX1);
      const overlap =
        Math.min(segmentRight, bandRight) - Math.max(segmentLeft, bandLeft);
      const overlapRatio = Math.max(overlap, 0) / bandWidth;
      if (overlapRatio < 0.4) {
        return null;
      }

      const linesAbove = lines.filter((line) => getLineCenterY(line) < y - 0.004).length;
      const linesBelow = lines.filter((line) => getLineCenterY(line) > y + 0.004).length;
      if (linesAbove < 1 || linesBelow < 2) {
        return null;
      }

      return {
        y,
        score:
          overlapRatio * 100 +
          linesBelow * 12 +
          Math.min(linesAbove, 3) * 6 -
          y * 20,
      };
    })
    .filter((entry): entry is { y: number; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.y ?? null;
}

function filterOcrNumberLinesToLocalCompartment(
  page: PageExtractionModel,
  lines: TextLine[]
) {
  const separatorY = findOcrLocalNumberCompartmentSeparatorY(page, lines);
  if (separatorY === null) {
    return lines;
  }

  const filtered = lines.filter((line) => getLineCenterY(line) >= separatorY - 0.002);
  return filtered.length >= 2 ? filtered : lines;
}

function filterOcrNumberLinesToDetectedBox(
  page: PageExtractionModel,
  lines: TextLine[]
) {
  const box = page.ocrNumberBox ?? inferOcrLabelAnchoredNumberFieldBounds(lines);
  if (!page.ocrBacked || !box) {
    return lines;
  }

  const boxLeft = box.x;
  const boxRight = box.x + box.width;
  const boxTop = box.y;
  const boxBottom = box.y + box.height;

  const filtered = lines.filter((line) => {
    const left = getLineLeft(line);
    const right = getLineRight(line);
    const top = line.normY;
    const bottom = line.normY + line.normHeight;
    const centerX = getLineCenterX(line);
    const centerY = getLineCenterY(line);

    const centerInside =
      centerX >= boxLeft &&
      centerX <= boxRight &&
      centerY >= boxTop &&
      centerY <= boxBottom;
    if (!centerInside) {
      return false;
    }

    const horizontalInside = left >= boxLeft - 0.004 && right <= boxRight + 0.004;
    const verticalInside = top >= boxTop - 0.012 && bottom <= boxBottom + 0.012;
    return horizontalInside && verticalInside;
  });

  const hasLabel = filtered.some((line) =>
    isOcrSheetNumberFieldLabelLike(line.text)
  );
  const hasNumberish = filtered.some((line) =>
    extractSheetNumberTokensFromText(line.text).some((candidate) =>
      /^[A-Z]{1,4}(?:[-.]?\d|\d)/.test(candidate)
    )
  );

  return filtered.length >= 2 && (hasLabel || hasNumberish) ? filtered : lines;
}

function buildOcrNumberBoxRegionDebug(page: PageExtractionModel, regionId: MetadataRegionId) {
  const region = getMetadataRegionById(regionId);
  if (!region) {
    return null;
  }

  const regionPage = buildPageRegionModel(page, region);
  if (!regionPage) {
    return {
      lines: [],
      activeBounds: null,
      activeBoundsSource: null,
      keptByBox: [],
      droppedByBox: [],
      keptByCompartment: [],
    };
  }

  const inferredBounds =
    regionPage.ocrNumberBox ?? inferOcrLabelAnchoredNumberFieldBounds(regionPage.lines);
  const boxedLines = filterOcrNumberLinesToDetectedBox(regionPage, regionPage.lines);
  const compartmentLines = filterOcrNumberLinesToLocalCompartment(regionPage, boxedLines);
  const boxedSet = new Set(boxedLines);
  const compartmentSet = new Set(compartmentLines);

  return {
    lines: regionPage.lines.map((line) => line.text),
    activeBounds: inferredBounds ?? null,
    activeBoundsSource: regionPage.ocrNumberBox ? "raster_box" : inferredBounds ? "label_anchor" : null,
    keptByBox: boxedLines.map((line) => line.text),
    droppedByBox: regionPage.lines
      .filter((line) => !boxedSet.has(line))
      .map((line) => line.text),
    keptByCompartment: compartmentLines
      .filter((line) => compartmentSet.has(line))
      .map((line) => line.text),
  };
}

function findBestOcrBackedTitleColumnNumber(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
}) {
  if (!args.page.ocrBacked) {
    return null;
  }

  let best:
    | {
        regionId: MetadataRegionId;
        page: PageExtractionModel;
        result: ReturnType<typeof detectSheetNumber>;
      }
    | null = null;

  for (const regionId of ["titleBlock", "titleTall"] as const) {
    const region = getMetadataRegionById(regionId);
    const regionPage = region ? buildPageRegionModel(args.page, region) : null;
    if (!regionPage) {
      continue;
    }

    const boxedLines = filterOcrNumberLinesToDetectedBox(regionPage, regionPage.lines);
    const compartmentLines = filterOcrNumberLinesToLocalCompartment(
      regionPage,
      boxedLines
    );
    const hasBoundedNumberField = Boolean(
      regionPage.ocrNumberBox ?? inferOcrLabelAnchoredNumberFieldBounds(regionPage.lines)
    );
    const compartmentPage =
      compartmentLines !== regionPage.lines
        ? buildPageModelFromLines(regionPage.pageNumber, compartmentLines, true, {
            drawingSegments: regionPage.drawingSegments,
            ocrNumberBox: regionPage.ocrNumberBox,
          })
        : regionPage;

    const labeledMatch = findBestLabeledSheetNumber(compartmentPage.lines);
    const explicitCandidates = compartmentPage.candidates
      .map((candidate) => ({
        ...candidate,
        score: rescoreCandidate(candidate, args.exactCounts, args.prefixCounts),
      }))
      .filter((candidate) => {
        const normalizedValue = normalizeSheetNumberValue(candidate.value);
        const normalizedLine = normalizeWhitespace(candidate.lineText);
        const normalizedComparableLine = normalizeKey(
          normalizedLine.replace(/[^A-Za-z0-9.\-\s]/g, " ")
        );
        const compactLineLength = Math.max(
          normalizedComparableLine.replace(/\s+/g, "").length,
          1
        );
        const coverageRatio = normalizedValue.length / compactLineLength;
        const lineWordCount = countWords(normalizedLine);
        const lineLooksLikeTitle =
          hasExplicitTitleFamily(normalizedLine) || countTitleVocabularyHits(normalizedLine) >= 1;
        return (
          !candidate.isNumericOnly &&
          /^[A-Z]{1,4}(?:[-.]?\d|\d)/.test(normalizedValue) &&
          isSheetNumberValue(normalizedValue) &&
          (
            lineWordCount <= 3 ||
            coverageRatio >= 0.45 ||
            /^\s*(?:sheet(?:\s*no\.?)?\b|drawing(?:\s*no\.?)?\b)/i.test(normalizedLine)
          ) &&
          !(lineLooksLikeTitle && coverageRatio < 0.5)
        );
      })
      .sort((left, right) => right.score - left.score);
    const recoveredInlineCandidates = compartmentPage.lines
      .map((line, lineIndex) => {
        const recoveredValue = extractSheetNumberFromText(line.text);
        if (!recoveredValue || !isSheetNumberValue(recoveredValue)) {
          return null;
        }

        const normalizedValue = normalizeSheetNumberValue(recoveredValue);
        const strongStructuredRecovery =
          /[.-]/.test(normalizedValue) || normalizedValue.length >= 5;
        if (!strongStructuredRecovery) {
          return null;
        }

        const normalizedLine = normalizeWhitespace(line.text);
        const normalizedComparableLine = normalizeKey(
          normalizedLine.replace(/[^A-Za-z0-9.\-\s]/g, " ")
        );
        const compactLineLength = Math.max(
          normalizedComparableLine.replace(/\s+/g, "").length,
          1
        );
        const coverageRatio = normalizedValue.length / compactLineLength;
        const lowerBandBias = line.normY >= 0.55 ? 18 : line.normY >= 0.42 ? 8 : 0;

        return {
          value: normalizedValue,
          score:
            132 +
            scoreInlineSheetNumberValue(normalizedValue, normalizedLine) +
            lowerBandBias +
            Math.round(coverageRatio * 20),
          lineIndex,
          normX: line.normX,
          normY: line.normY,
          normWidth: line.normWidth,
          normHeight: line.normHeight,
          width: line.width,
          height: line.height,
          lineText: line.text,
          isNumericOnly: false,
          prefix: getCandidatePrefix(normalizedValue),
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort((left, right) => right.score - left.score);

    const explicitWinner =
      (explicitCandidates[0] &&
      recoveredInlineCandidates[0] &&
      recoveredInlineCandidates[0].score > explicitCandidates[0].score
        ? recoveredInlineCandidates[0]
        : explicitCandidates[0]) ??
      recoveredInlineCandidates[0] ??
      null;
    const shouldForceLabeledWinner =
      hasBoundedNumberField &&
      labeledMatch &&
      explicitWinner &&
      labeledMatch.value.length >= explicitWinner.value.length + 2 &&
      /[.-]/.test(labeledMatch.value) &&
      !/[.-]/.test(explicitWinner.value);
    const result =
      (shouldForceLabeledWinner || (labeledMatch && (!explicitWinner || labeledMatch.score >= explicitWinner.score - 18)))
        ? {
            sheetNumber: labeledMatch.value,
            confidence: 1,
              winner: {
              value: labeledMatch.value,
              score: labeledMatch.score,
              lineIndex: labeledMatch.lineIndex,
              normX: labeledMatch.normX,
              normY: labeledMatch.normY,
              normWidth: labeledMatch.normWidth,
              normHeight: labeledMatch.normHeight,
              width: labeledMatch.width,
              height: labeledMatch.height,
              lineText: compartmentPage.lines[labeledMatch.lineIndex]?.text ?? labeledMatch.value,
              isNumericOnly: false,
              prefix: getCandidatePrefix(labeledMatch.value),
            },
          }
        : explicitWinner
          ? {
              sheetNumber: explicitWinner.value,
              confidence: 1,
              winner: explicitWinner,
            }
          : createEmptySheetNumberDetection();

    if (!result.sheetNumber || !result.winner) {
      continue;
    }

    if (!best || result.winner.score > (best.result.winner?.score ?? -Infinity)) {
      best = {
        regionId,
        page: compartmentPage,
        result,
      };
    }
  }

  return best;
}

function buildPyMuPdfRegionPairCandidate(args: {
  page: PageExtractionModel;
  styleProfile: Exclude<MetadataStyleProfile, "mixed">;
  numberRegionId: MetadataRegionId;
  titleRegionId: MetadataRegionId;
  fullRegionId: MetadataRegionId;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const numberRegion = getMetadataRegionById(args.numberRegionId);
  const titleRegion = getMetadataRegionById(args.titleRegionId);
  const fullRegion = getMetadataRegionById(args.fullRegionId);
  const numberFallbackRegion =
    args.numberRegionId === "sheetStamp"
      ? getMetadataRegionById("numberBlock")
      : null;
  if (!numberRegion || !titleRegion || !fullRegion) {
    return null;
  }

  const numberPage = buildPageRegionModel(args.page, numberRegion);
  const numberFallbackPage = numberFallbackRegion
    ? buildPageRegionModel(args.page, numberFallbackRegion)
    : null;
  const titlePage = buildPageRegionModel(args.page, titleRegion);
  if (!numberPage || !titlePage) {
    return null;
  }

  let numberResult = detectSheetNumber(numberPage, args.exactCounts, args.prefixCounts);
  let numberRegionId = args.numberRegionId;
  let activeNumberPage = numberPage;
  const directInlineNumber = findBestInlineSplitSheetNumber(numberPage.lines);
  if (
    directInlineNumber &&
    (!numberResult.sheetNumber ||
      !numberResult.winner ||
      directInlineNumber.score >= numberResult.winner.score - 8)
  ) {
    numberResult = {
      sheetNumber: directInlineNumber.value,
      confidence: 1,
      winner: directInlineNumber,
    };
  }

  if (
    (!numberResult.sheetNumber || !numberResult.winner) &&
    numberFallbackPage
  ) {
    const fallbackNumberResult = detectSheetNumber(
      numberFallbackPage,
      args.exactCounts,
      args.prefixCounts
    );
    if (fallbackNumberResult.sheetNumber && fallbackNumberResult.winner) {
      numberResult = fallbackNumberResult;
      numberRegionId = "numberBlock";
      activeNumberPage = numberFallbackPage;
    }
  }

  if (!numberResult.sheetNumber || !numberResult.winner) {
    const ocrTitleColumnNumber = findBestOcrBackedTitleColumnNumber({
      page: args.page,
      exactCounts: args.exactCounts,
      prefixCounts: args.prefixCounts,
    });
    if (ocrTitleColumnNumber) {
      numberResult = ocrTitleColumnNumber.result;
      numberRegionId = ocrTitleColumnNumber.regionId;
      activeNumberPage = ocrTitleColumnNumber.page;
    }
  }

  if (!numberResult.sheetNumber || !numberResult.winner) {
    return null;
  }

  const numberLine = activeNumberPage.lines[numberResult.winner.lineIndex] ?? null;
  if (!numberLine) {
    return null;
  }

  const titleSearchPages = buildPyMuPdfTitleSearchPages({
    page: args.page,
    styleProfile: args.styleProfile,
    numberLine,
    fallbackTitleRegionId: args.titleRegionId,
  });

  let bestTitleCandidate:
    | {
        titleText: string;
        sourceText: string;
        score: number;
        lines: TextLine[];
      }
    | null = null;

  for (const titleSearchPage of titleSearchPages) {
    const candidateTitleLines = collectLocalizedPyMuPdfTitleLines(
      titleSearchPage,
      numberLine
    );
    if (candidateTitleLines.length === 0) {
      continue;
    }
    const sameBlockTitleLines =
      Number.isFinite(numberLine.blockId ?? NaN)
        ? candidateTitleLines.filter((line) => line.blockId === numberLine.blockId)
        : [];
    const bestTitleForPage = buildBestPyMuPdfTitleCandidate({
      sourcePage: args.page,
      titlePage: titleSearchPage,
      numberLine,
      titleLineSets: [
        ...(sameBlockTitleLines.length > 0 &&
        sameBlockTitleLines.length < candidateTitleLines.length
          ? [sameBlockTitleLines]
          : []),
        candidateTitleLines,
      ],
      pageNumber: args.page.pageNumber,
      regionBias:
        titleSearchPages.indexOf(titleSearchPage) === 0
          ? 18
          : titleSearchPages.indexOf(titleSearchPage) === 1
            ? 6
            : 0,
      documentStyleProfile: args.documentTitleStyleProfile,
    });
    if (!bestTitleForPage) {
      continue;
    }

    if (!bestTitleCandidate || bestTitleForPage.score > bestTitleCandidate.score) {
      bestTitleCandidate = {
        titleText: bestTitleForPage.titleText,
        sourceText: bestTitleForPage.sourceText,
        score: bestTitleForPage.score,
        lines: bestTitleForPage.lines,
      };
    }
  }

  if (!bestTitleCandidate) {
    const directTitleLines = collectLocalizedPyMuPdfTitleLines(
      titlePage,
      numberLine
    );
    const sameBlockDirectTitleLines =
      Number.isFinite(numberLine.blockId ?? NaN)
        ? directTitleLines.filter((line) => line.blockId === numberLine.blockId)
        : [];
    const directTitleCandidate = buildBestPyMuPdfTitleCandidate({
      sourcePage: args.page,
      titlePage,
      numberLine,
      titleLineSets: [
        ...(sameBlockDirectTitleLines.length > 0 &&
        sameBlockDirectTitleLines.length < directTitleLines.length
          ? [sameBlockDirectTitleLines]
          : []),
        directTitleLines,
      ],
      pageNumber: args.page.pageNumber,
      documentStyleProfile: args.documentTitleStyleProfile,
    });

    if (
      directTitleCandidate &&
      Number.isFinite(directTitleCandidate.score) &&
      directTitleCandidate.score >= 20
    ) {
      bestTitleCandidate = {
        titleText: directTitleCandidate.titleText,
        sourceText: directTitleCandidate.sourceText,
        score: directTitleCandidate.score,
        lines: directTitleCandidate.lines,
      };
    }
  }

  if (!bestTitleCandidate) {
    return null;
  }

  const titleText = bestTitleCandidate.titleText;
  const titleScore = bestTitleCandidate.score;
  const titleLine = bestTitleCandidate.lines[0] ?? titlePage.lines[0] ?? null;
  if (!titleLine) {
    return null;
  }

  const styleBase =
    args.styleProfile === "bottom_right_block"
      ? 220
      : args.styleProfile === "bottom_left_block"
        ? 210
        : 180;
  const scoreTrace = new ScoreTrace()
    .add("region_pair_style_base", styleBase, args.styleProfile)
    .add("sheet_number_candidate_score", numberResult.winner.score)
    .add("sheet_title_candidate_score", titleScore);
  const pairScore = scoreTrace.total();
  const numberReasonCodes = buildSheetNumberReasonCodes(numberResult.winner);
  const titleReasonCodes = buildTitleReasonCodes({
    titleText,
    titleSourceText: bestTitleCandidate.sourceText,
    titleLines: bestTitleCandidate.lines,
    numberLine,
    titleRegion: args.titleRegionId,
    numberRegion: numberRegionId,
  });

  return {
    sheetNumber: numberResult.sheetNumber,
    sheetTitle: titleText,
    numberSourceText: numberLine.text,
    titleSourceText: bestTitleCandidate.sourceText,
    numberLineIndex: numberResult.winner.lineIndex,
    titleLineIndex: 0,
    numberRegion: numberRegionId,
    titleRegion: args.titleRegionId,
    pairedCluster: buildPairedClusterId(args.fullRegionId, numberResult.winner.lineIndex, 0),
    styleProfile: args.styleProfile,
    familyId: args.styleProfile,
    localClusterBbox: getNormalizedTextLineBox([numberLine, ...bestTitleCandidate.lines]) ?? undefined,
    sourceAgreement: true,
    rejectReason: null,
    numberCandidateTypeGuess: guessSheetNumberCandidateType(
      numberResult.sheetNumber,
      numberLine.text
    ),
    titleCandidateTypeGuess: guessTitleCandidateType(
      titleText,
      bestTitleCandidate.sourceText
    ),
    numberReasonCodes,
    titleReasonCodes,
    numberScore: numberResult.winner.score,
    titleScore,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(
      clamp(
        ((numberResult.confidence ?? 0.15) * 0.45 + (titleScore - 20) / 180 + (pairScore - 180) / 220),
        0,
        1
      ).toFixed(2)
    ),
  } satisfies PairedSheetCandidate;
}

function buildPyMuPdfDirectCornerPairCandidate(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const numberRegion = getMetadataRegionById("sheetStamp");
  const titleRegionIds: MetadataRegionId[] = ["titleBlock", "titleTall"];
  if (!numberRegion) {
    return null;
  }

  const numberPage = buildPageRegionModel(args.page, numberRegion);
  if (!numberPage) {
    return null;
  }

  const directInlineNumber = findBestInlineSplitSheetNumber(numberPage.lines);
  let numberResult = directInlineNumber
    ? {
        sheetNumber: directInlineNumber.value,
        confidence: 1,
        winner: directInlineNumber,
      }
    : detectSheetNumber(numberPage, args.exactCounts, args.prefixCounts);
  let numberRegionId: MetadataRegionId = "sheetStamp";
  let activeNumberPage = numberPage;

  if (!numberResult.sheetNumber || !numberResult.winner) {
    const ocrTitleColumnNumber = findBestOcrBackedTitleColumnNumber({
      page: args.page,
      exactCounts: args.exactCounts,
      prefixCounts: args.prefixCounts,
    });
    if (ocrTitleColumnNumber) {
      numberResult = ocrTitleColumnNumber.result;
      numberRegionId = ocrTitleColumnNumber.regionId;
      activeNumberPage = ocrTitleColumnNumber.page;
    }
  }

  if (!numberResult.sheetNumber || !numberResult.winner) {
    return null;
  }

  const numberLine = activeNumberPage.lines[numberResult.winner.lineIndex] ?? null;
  if (!numberLine) {
    return null;
  }
  let bestTitleCandidate:
    | {
        titleRegionId: MetadataRegionId;
        titlePage: PageExtractionModel;
        titleLines: TextLine[];
        titleText: string;
        titleSourceText: string;
        titleScore: number;
      }
    | null = null;

  for (const [index, titleRegionId] of titleRegionIds.entries()) {
    const titleRegion = getMetadataRegionById(titleRegionId);
    const titlePage = titleRegion ? buildPageRegionModel(args.page, titleRegion) : null;
    if (!titlePage) {
      continue;
    }

    const titleLines = collectLocalizedPyMuPdfTitleLines(titlePage, numberLine);
    const sameBlockTitleLines =
      Number.isFinite(numberLine.blockId ?? NaN)
        ? titleLines.filter((line) => line.blockId === numberLine.blockId)
        : [];
    const bestTitleForRegion = buildBestPyMuPdfTitleCandidate({
      sourcePage: args.page,
      titlePage,
      numberLine,
      titleLineSets: [
        ...(sameBlockTitleLines.length > 0 && sameBlockTitleLines.length < titleLines.length
          ? [sameBlockTitleLines]
          : []),
        titleLines,
      ],
      pageNumber: args.page.pageNumber,
      regionBias: index === 0 ? 12 : 0,
      documentStyleProfile: args.documentTitleStyleProfile,
    });
    if (!bestTitleForRegion) {
      continue;
    }

    if (!bestTitleCandidate || bestTitleForRegion.score > bestTitleCandidate.titleScore) {
      bestTitleCandidate = {
        titleRegionId,
        titlePage,
        titleLines: bestTitleForRegion.lines,
        titleText: bestTitleForRegion.titleText,
        titleSourceText: bestTitleForRegion.sourceText,
        titleScore: bestTitleForRegion.score,
      };
    }
  }

  const rightEdgeRotatedTitleLines = collectRightEdgeRotatedTitleLines(
    args.page,
    numberLine
  );
  if (rightEdgeRotatedTitleLines.length > 0) {
    const rightEdgeTitlePage = buildPageModelFromLines(
      args.page.pageNumber,
      rightEdgeRotatedTitleLines
    );
    const bestRightEdgeTitle = buildBestRightEdgeRotatedTitleCandidate({
      page: rightEdgeTitlePage,
      titleLines: rightEdgeRotatedTitleLines,
      numberLine,
      pageNumber: args.page.pageNumber,
      regionBias: 34,
      documentStyleProfile: args.documentTitleStyleProfile,
    });
    const currentBestLooksLikeStampStatus = Boolean(
      bestTitleCandidate &&
        /\b(?:NOT\s+FOR\s+CONSTRUCTION|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION|BID\s+SET)\b/i.test(
          [bestTitleCandidate.titleText, bestTitleCandidate.titleSourceText].join(" ")
        )
    );
    if (
      bestRightEdgeTitle &&
      (
        !bestTitleCandidate ||
        bestRightEdgeTitle.score > bestTitleCandidate.titleScore ||
        (
          currentBestLooksLikeStampStatus &&
          bestRightEdgeTitle.score >= Math.min(bestTitleCandidate.titleScore - 180, 220) &&
          !/\b(?:NOT\s+FOR\s+CONSTRUCTION|CONSTRUCTION\s+NOT|BID\s+SET)\b/i.test(
            bestRightEdgeTitle.titleText
          ) &&
          countTitleVocabularyHits(bestRightEdgeTitle.titleText) >= 2
        )
      )
    ) {
      bestTitleCandidate = {
        titleRegionId: "bottomRight",
        titlePage: rightEdgeTitlePage,
        titleLines: bestRightEdgeTitle.lines,
        titleText: bestRightEdgeTitle.titleText,
        titleSourceText: bestRightEdgeTitle.sourceText,
        titleScore: bestRightEdgeTitle.score,
      };
    }
  }

  if (!bestTitleCandidate) {
    return null;
  }

  const numberReasonCodes = buildSheetNumberReasonCodes(numberResult.winner);
  const titleReasonCodes = buildTitleReasonCodes({
    titleText: bestTitleCandidate.titleText,
    titleSourceText: bestTitleCandidate.titleSourceText,
      titleLines: bestTitleCandidate.titleLines,
      numberLine,
      titleRegion: bestTitleCandidate.titleRegionId,
      numberRegion: numberRegionId,
    });
  const scoreTrace = new ScoreTrace()
    .add("direct_corner_base", 260)
    .add("sheet_number_candidate_score", numberResult.winner.score)
    .add("sheet_title_candidate_score", bestTitleCandidate.titleScore);
  const pairScore = scoreTrace.total();

  return {
    sheetNumber: numberResult.sheetNumber,
    sheetTitle: bestTitleCandidate.titleText,
      numberSourceText: numberLine.text,
      titleSourceText: bestTitleCandidate.titleSourceText,
      numberLineIndex: numberResult.winner.lineIndex,
      titleLineIndex: 0,
      numberRegion: numberRegionId,
    titleRegion: bestTitleCandidate.titleRegionId,
    pairedCluster: buildPairedClusterId("bottomRight", numberResult.winner.lineIndex, 0),
    styleProfile: "bottom_right_block",
    familyId: "bottom_right_block",
    localClusterBbox:
      getNormalizedTextLineBox([numberLine, ...bestTitleCandidate.titleLines]) ?? undefined,
    sourceAgreement: true,
    rejectReason: null,
    numberCandidateTypeGuess: guessSheetNumberCandidateType(
      numberResult.sheetNumber,
      numberLine.text
    ),
    titleCandidateTypeGuess: guessTitleCandidateType(
      bestTitleCandidate.titleText,
      bestTitleCandidate.titleSourceText
    ),
    numberReasonCodes,
    titleReasonCodes,
    numberScore: numberResult.winner.score,
    titleScore: bestTitleCandidate.titleScore,
    score: pairScore,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Number(
      clamp(
        (
          (numberResult.confidence ?? 0.15) * 0.5 +
          (bestTitleCandidate.titleScore - 20) / 180 +
          0.25
        ),
        0,
        1
      ).toFixed(2)
    ),
  } satisfies PairedSheetCandidate;
}

function isCompactNumberOverTitleFooterLine(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return true;
  }

  const candidateTypeGuess = guessTitleCandidateType(normalized, normalized);
  return (
    isMetadataBoxFooterLine(normalized) ||
    isDateLikeTitleLineText(normalized) ||
    candidateTypeGuess === "scale" ||
    candidateTypeGuess === "date" ||
    candidateTypeGuess === "revision" ||
    candidateTypeGuess === "sheet_reference" ||
    /(?:\b(?:stantec|kp|proj(?:ect)?|job)\b|treanor)/i.test(normalized) ||
    /^SCALE\b|^DATE\b|^DRAWN\b|^CHECKED\b|^REVIEW(?:ED)?\b|^PROJECT\s+(?:NO|NUMBER|ID|#)\b|^JOB\b|^CLIENT\b|^OWNER\b|^ARCHITECT\b|^PAGE\s+\d+\s+OF\s+\d+/i.test(
      normalized
    )
  );
}

function hasCompactNumberOverTitleStructuralText(
  text: string,
  options?: { seed?: boolean }
) {
  const normalized = normalizeWhitespace(text);
  if (!normalized || normalized.length < 4 || normalized.length > 72) {
    return false;
  }
  if (!/[A-Za-z]/.test(normalized) || /^\d/.test(normalized)) {
    return false;
  }
  if (/[,:;]$/.test(normalized)) {
    return false;
  }
  if (
    /\b(?:phone|email|www\.|\.com|copyright|architects?|engineers?|consultants?|inc\b|llc\b)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  const wordCount = countWords(normalized);
  const uppercaseLetters = (normalized.match(/[A-Z]/g) ?? []).length;
  const alphaLetters = (normalized.match(/[A-Za-z]/g) ?? []).length;
  const uppercaseRatio = alphaLetters > 0 ? uppercaseLetters / alphaLetters : 0;
  if (uppercaseRatio < 0.55 || wordCount > 8) {
    return false;
  }

  return options?.seed ? wordCount >= 2 || /[&/-]/.test(normalized) : wordCount >= 1;
}

function isTrustworthyCompactNumberOverTitleText(text: string) {
  const normalized = normalizeTitleSelectionText(text);
  if (!normalized) {
    return false;
  }
  if (
    isReferenceOnlyTitleText(normalized) ||
    matchesAdministrativeTitleMetadata(normalized) ||
    matchesReviewReferenceMetadata(normalized) ||
    matchesVendorReferencePageMetadata(normalized) ||
    isRegulatoryOrScopeNoteText(normalized) ||
    isCompactNumberOverTitleFooterLine(normalized)
  ) {
    return false;
  }

  return (
    isLikelySheetTitle(normalized) ||
    countTitleVocabularyHits(normalized) >= 1 ||
    hasCompactTechnicalTitleSignal(normalized) ||
    hasCompactNumberOverTitleStructuralText(normalized, { seed: true })
  );
}

function isCompactNumberOverTitleLine(text: string, options?: { seed?: boolean }) {
  const normalized = normalizeWhitespace(text);
  const sanitized = sanitizePdfTitleSelectionLine(normalized) || normalized;
  if (!sanitized) {
    return false;
  }
  if (isCompactNumberOverTitleFooterLine(sanitized)) {
    return false;
  }
  if (
    isPureMarkerTitleText(sanitized) ||
    isGeometricSymbolLabel(sanitized) ||
    isMetadataLabelOnlyTitleText(sanitized)
  ) {
    return false;
  }

  const compactStructuralText = hasCompactNumberOverTitleStructuralText(sanitized, {
    seed: options?.seed,
  });
  if (isPyMuPdfTitleNoiseLine(sanitized) && !compactStructuralText) {
    return false;
  }

  const candidateTypeGuess = guessTitleCandidateType(sanitized, sanitized);
  if (
    candidateTypeGuess === "title_label" ||
    candidateTypeGuess === "scale" ||
    candidateTypeGuess === "date" ||
    candidateTypeGuess === "revision" ||
    candidateTypeGuess === "sheet_reference" ||
    candidateTypeGuess === "address_or_contact" ||
    candidateTypeGuess === "company_name"
  ) {
    return false;
  }

  if (options?.seed) {
    return (
      candidateTypeGuess === "drawing_title" ||
      isLikelySheetTitle(sanitized) ||
      countTitleVocabularyHits(sanitized) >= 1 ||
      isCoverSheetTitleSignal(sanitized) ||
      compactStructuralText
    );
  }

  return (
    isLikelySheetTitle(sanitized) ||
    candidateTypeGuess === "drawing_title" ||
    isMetadataBoxTitleFragment(sanitized) ||
    isCompactStampContinuationFragment(sanitized) ||
    countTitleVocabularyHits(sanitized) >= 1 ||
    compactStructuralText
  );
}

function collectCompactNumberOverTitleLines(
  page: PageExtractionModel,
  numberLine: TextLine
) {
  const numberCenterX = getLineCenterX(numberLine);
  const numberCenterY = getLineCenterY(numberLine);
  const numberLeft = getLineLeft(numberLine);
  const numberRight = getLineRight(numberLine);
  const sortedBelow = page.lines
    .filter((line) => line !== numberLine)
    .filter((line) => {
      const centerY = getLineCenterY(line);
      if (centerY <= numberCenterY + 0.006 || centerY > numberCenterY + 0.105) {
        return false;
      }
      if (line.normX < Math.max(0.72, numberLeft - 0.08)) {
        return false;
      }
      if (getLineRight(line) < Math.min(0.88, numberRight + 0.015)) {
        return false;
      }

      const centerDelta = Math.abs(getLineCenterX(line) - numberCenterX);
      const leftDelta = Math.abs(getLineLeft(line) - numberLeft);
      return centerDelta <= 0.048 || leftDelta <= 0.04;
    })
    .sort((left, right) => {
      const topDelta = left.normY - right.normY;
      if (Math.abs(topDelta) > 0.002) {
        return topDelta;
      }
      return left.normX - right.normX;
    });

  const titleLines: TextLine[] = [];
  for (const line of sortedBelow) {
    const normalized = normalizeWhitespace(line.text);
    if (!normalized) {
      continue;
    }
    if (isCompactNumberOverTitleFooterLine(normalized)) {
      if (titleLines.length > 0) {
        break;
      }
      continue;
    }

    const seed = titleLines.length === 0;
    if (!isCompactNumberOverTitleLine(normalized, { seed })) {
      if (titleLines.length > 0) {
        break;
      }
      continue;
    }

    const previousLine = titleLines[titleLines.length - 1] ?? numberLine;
    const verticalGap = Math.max(line.normY - getLineBottom(previousLine), 0);
    const centerGap = getLineCenterY(line) - getLineCenterY(previousLine);
    if (
      titleLines.length > 0 &&
      (verticalGap > 0.024 || centerGap > 0.052) &&
      !isCompactStampContinuationFragment(normalized)
    ) {
      break;
    }

    titleLines.push(line);
    if (titleLines.length >= 4) {
      break;
    }
  }

  return titleLines;
}

function buildPyMuPdfNumberOverTitleCompactPairCandidate(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const rankedNumbers = [
    ...args.page.candidates,
    ...buildDirectCompactStampSheetNumberCandidates(args.page.lines),
  ]
    .map((candidate) => ({
      ...candidate,
      score: rescoreCandidate(candidate, args.exactCounts, args.prefixCounts),
    }))
    .filter((candidate) => {
      const normalizedValue = normalizeSheetNumberValue(candidate.value);
      const numberLine = args.page.lines[candidate.lineIndex] ?? null;
      if (!numberLine) {
        return false;
      }
      if (!isSheetNumberValue(normalizedValue) || candidate.isNumericOnly) {
        return false;
      }
      if (guessSheetNumberCandidateType(candidate.value, candidate.lineText) !== "sheet_number") {
        return false;
      }
      if (candidate.normX < 0.78 || candidate.normY < 0.72 || candidate.normY > 0.91) {
        return false;
      }
      if (/^PAGE\s+\d+\s+OF\s+\d+$/i.test(normalizeWhitespace(candidate.lineText))) {
        return false;
      }

      const fontSize = getLineFontSizeSignal(numberLine);
      return (
        candidate.score >= 95 &&
        (fontSize >= 14 || candidate.normHeight >= 0.01 || Boolean(numberLine.isBold))
      );
    })
    .sort((left, right) => right.score - left.score);

  let best: PairedSheetCandidate | null = null;
  const seenNumbers = new Set<string>();
  for (const numberCandidate of rankedNumbers) {
    const normalizedNumber = normalizeSheetNumberValue(numberCandidate.value);
    if (seenNumbers.has(normalizedNumber)) {
      continue;
    }
    seenNumbers.add(normalizedNumber);

    const numberLine = args.page.lines[numberCandidate.lineIndex] ?? null;
    if (!numberLine) {
      continue;
    }

    const titleLines = collectCompactNumberOverTitleLines(args.page, numberLine);
    if (titleLines.length === 0) {
      continue;
    }

    const titleCandidate = buildBestPyMuPdfTitleCandidate({
      sourcePage: args.page,
      titlePage: args.page,
      numberLine,
      titleLineSets: [titleLines],
      pageNumber: args.page.pageNumber,
      regionBias: 28,
      documentStyleProfile: args.documentTitleStyleProfile,
    });
    const compactTitleSourceText = titleLines
      .map((line) => sanitizePdfTitleSelectionLine(line.text) || normalizeWhitespace(line.text))
      .filter(Boolean)
      .join("\n");
    const compactTitleText = normalizeTitleSelectionText(
      compactTitleSourceText.replace(/\r?\n/g, " ")
    );
    const titleCandidateText = normalizeTitleSelectionText(titleCandidate?.titleText ?? "");
    const compactFallbackKeepsMoreTitle =
      Boolean(compactTitleText && titleCandidateText) &&
      (
        compactTitleText.length >= titleCandidateText.length + 5 ||
        /\b(?:AND|OR)\s*$/i.test(titleCandidateText) ||
        /[/-]\s*$/i.test(titleCandidateText)
      );
    const useCompactFallbackTitle = Boolean(
      compactTitleText &&
        isTrustworthyCompactNumberOverTitleText(compactTitleText) &&
        (
          !titleCandidate ||
          titleCandidate.score < 24 ||
          compactFallbackKeepsMoreTitle
        )
    );
    if ((!titleCandidate || titleCandidate.score < 24) && !useCompactFallbackTitle) {
      continue;
    }

    const effectiveTitleText = useCompactFallbackTitle
      ? compactTitleText
      : titleCandidate?.titleText ?? compactTitleText;
    const effectiveTitleSourceText = useCompactFallbackTitle
      ? compactTitleSourceText
      : titleCandidate?.sourceText || compactTitleSourceText;
    const effectiveTitleLines = useCompactFallbackTitle
      ? titleLines
      : titleCandidate?.lines ?? titleLines;
    const effectiveBaseTitleScore = useCompactFallbackTitle
      ? Math.max(
          titleCandidate?.score ?? -Infinity,
          62 +
            Math.min(countTitleVocabularyHits(effectiveTitleText) * 12, 36) +
            (titleLines.length >= 2 ? 18 : 0) +
            (hasCompactTechnicalTitleSignal(effectiveTitleText) ? 14 : 0)
        )
      : titleCandidate?.score ?? 24;

    const titleLine = effectiveTitleLines[0] ?? titleLines[0] ?? null;
    if (!titleLine) {
      continue;
    }
    const titleLineIndex = args.page.lines.indexOf(titleLine);
    const titleScore = effectiveBaseTitleScore + 36;
    const scoreTrace = new ScoreTrace()
      .add("compact_number_over_title_base", 300)
      .add("sheet_number_candidate_score", numberCandidate.score)
      .add("sheet_title_candidate_score", titleScore);
    const pairScore = scoreTrace.total();
    const numberReasonCodes = [
      ...buildSheetNumberReasonCodes(numberCandidate),
      "compact_number_over_title_anchor",
    ];
    const titleReasonCodes = [
      ...buildTitleReasonCodes({
        titleText: effectiveTitleText,
        titleSourceText: effectiveTitleSourceText,
        titleLines: effectiveTitleLines,
        numberLine,
        titleRegion: "titleBlock",
        numberRegion: "numberBlock",
      }),
      "directly_below_sheet_number",
    ];

    const candidate = {
      sheetNumber: normalizedNumber,
      sheetTitle: effectiveTitleText,
      numberSourceText: numberLine.text,
      titleSourceText: effectiveTitleSourceText,
      numberLineIndex: numberCandidate.lineIndex,
      titleLineIndex: titleLineIndex >= 0 ? titleLineIndex : null,
      numberRegion: "numberBlock",
      titleRegion: "titleBlock",
      pairedCluster: buildPairedClusterId(
        "bottomRight",
        numberCandidate.lineIndex,
        titleLineIndex >= 0 ? titleLineIndex : 0
      ),
      styleProfile: "bottom_right_block",
      familyId: "bottom_right_block",
      localClusterBbox:
        getNormalizedTextLineBox([numberLine, ...effectiveTitleLines]) ?? undefined,
      sourceAgreement: true,
      rejectReason: null,
      numberCandidateTypeGuess: guessSheetNumberCandidateType(
        normalizedNumber,
        numberLine.text
      ),
      titleCandidateTypeGuess: guessTitleCandidateType(
        effectiveTitleText,
        effectiveTitleSourceText
      ),
      numberReasonCodes,
      titleReasonCodes,
      numberScore: numberCandidate.score,
      titleScore,
      score: pairScore,
      scoreBreakdown: scoreTrace.snapshot(),
      confidence: Number(
        clamp(
          0.45 + (numberCandidate.score - 90) / 320 + (titleScore - 24) / 220,
          0,
          1
        ).toFixed(2)
      ),
    } satisfies PairedSheetCandidate;

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

function isDirectStampTitleValue(text: string) {
  const normalized = normalizeTitleSelectionText(text);
  if (!normalized) {
    return false;
  }
  if (
    isPyMuPdfTitleNoiseLine(normalized) ||
    isMetadataBoxFooterLine(normalized) ||
    countSheetReferenceTokens(normalized) > 0
  ) {
    return false;
  }
  if (
    matchesTitleLikeVocabulary(normalized) ||
    countTitleVocabularyHits(normalized) > 0 ||
    isAllowedSingleWordTitle(normalized)
  ) {
    return true;
  }

  if (
    countWords(normalized) <= 4 &&
    /^[A-Z&/().,\-\s]+$/.test(normalized) &&
    /\b[A-Z]{3,}\b/.test(normalized) &&
    !/\d/.test(normalized)
  ) {
    return true;
  }

  return (
    countWords(normalized) === 1 &&
    /^[A-Z][A-Z0-9/&-]{3,}$/.test(normalized) &&
    !/\d/.test(normalized)
  );
}

function findDirectStampTitleAboveNumber(args: {
  stampPage: PageExtractionModel | null;
  winner: SheetNumberCandidate;
  sheetNumber: string;
}) {
  if (!args.stampPage || !args.sheetNumber) {
    return null;
  }

  const normalizedWinnerText = normalizeWhitespace(args.winner.lineText);
  const normalizedSheetNumber = normalizeSheetNumberValue(args.sheetNumber);
  const directNumberLine = args.stampPage.lines[args.winner.lineIndex] ?? null;
  const foundNumberLineIndex =
    directNumberLine &&
    normalizeWhitespace(directNumberLine.text) === normalizedWinnerText
      ? args.winner.lineIndex
      : args.stampPage.lines.findIndex((line) => {
          const lineText = normalizeWhitespace(line.text);
          return (
            lineText === normalizedWinnerText ||
            normalizeSheetNumberValue(lineText) === normalizedSheetNumber
          );
        });
  const numberLine =
    foundNumberLineIndex >= 0
      ? args.stampPage.lines[foundNumberLineIndex] ?? null
      : null;

  if (!numberLine) {
    return null;
  }

  const numberCenterX = getLineCenterX(numberLine);
  const titleLines: TextLine[] = [];
  let lowerLine = numberLine;

  for (let cursor = foundNumberLineIndex - 1; cursor >= 0; cursor -= 1) {
    const line = args.stampPage.lines[cursor];
    if (!line) {
      break;
    }
    const titleText = normalizeTitleSelectionText(line.text);
    if (!isDirectStampTitleValue(titleText)) {
      break;
    }
    const verticalGap = Math.max(lowerLine.normY - getLineBottom(line), 0);
    if (verticalGap > 0.05) {
      break;
    }
    if (Math.abs(getLineCenterX(line) - numberCenterX) > 0.24) {
      break;
    }

    titleLines.unshift(line);
    lowerLine = line;
  }

  if (titleLines.length === 0) {
    return null;
  }

  const sourceLines = titleLines.map((line) => normalizeWhitespace(line.text)).filter(Boolean);
  const titleText = normalizeTitleSelectionText(
    mergeOcrTitleSelectionParts(sourceLines)
  );
  if (!titleText) {
    return null;
  }

  return {
    titleText,
    sourceText: sourceLines.join("\n"),
    score:
      64 +
      Math.min(countTitleVocabularyHits(titleText) * 12, 36) +
      (matchesTitleLikeVocabulary(titleText) ? 32 : 0) +
      (countWords(titleText) === 1 ? 10 : 22) +
      Math.min(Math.max(titleLines.length - 1, 0) * 18, 54),
  };
}

function findDirectStampTitleBelowNumber(args: {
  stampPage: PageExtractionModel | null;
  winner: SheetNumberCandidate;
  sheetNumber: string;
}) {
  if (!args.stampPage || !args.sheetNumber) {
    return null;
  }

  const normalizedWinnerText = normalizeWhitespace(args.winner.lineText);
  const normalizedSheetNumber = normalizeSheetNumberValue(args.sheetNumber);
  const directNumberLine = args.stampPage.lines[args.winner.lineIndex] ?? null;
  const foundNumberLineIndex =
    directNumberLine &&
    normalizeWhitespace(directNumberLine.text) === normalizedWinnerText
      ? args.winner.lineIndex
      : args.stampPage.lines.findIndex((line) => {
          const lineText = normalizeWhitespace(line.text);
          return (
            lineText === normalizedWinnerText ||
            normalizeSheetNumberValue(lineText) === normalizedSheetNumber ||
            normalizeCompactStampSheetNumberCandidate(lineText) === normalizedSheetNumber
          );
        });
  const numberLine =
    foundNumberLineIndex >= 0
      ? args.stampPage.lines[foundNumberLineIndex] ?? null
      : null;

  if (!numberLine) {
    return null;
  }

  const numberCenterX = getLineCenterX(numberLine);
  const titleLines: TextLine[] = [];
  let upperLine = numberLine;

  for (let cursor = foundNumberLineIndex + 1; cursor < args.stampPage.lines.length; cursor += 1) {
    const line = args.stampPage.lines[cursor];
    if (!line) {
      break;
    }
    const normalized = normalizeWhitespace(line.text);
    const titleText = normalizeTitleSelectionText(line.text);
    if (!normalized || normalizeSheetNumberValue(normalized) === normalizedSheetNumber) {
      continue;
    }
    if (
      isMetadataBoxFooterLine(normalized) ||
      matchesProjectBrandingVocabulary(normalized) ||
      /(?:\b(?:stantec|kp|proj(?:ect)?|job)\b|treanor)/i.test(normalized) ||
      /(?:\b(?:proj(?:ect)?|job|stantec|kp)\b|treanor).*\b(?:no\.?|number|#)\b/i.test(normalized) ||
      /\b[A-Z]{1,4}\d{3,}(?:\.\d+){1,}\b/.test(normalized)
    ) {
      break;
    }
    if (!isDirectStampTitleValue(titleText)) {
      if (titleLines.length > 0) {
        break;
      }
      continue;
    }

    const verticalGap = Math.max(line.normY - getLineBottom(upperLine), 0);
    if (
      titleLines.length > 0 &&
      verticalGap > 0.052 &&
      !isCompactStampContinuationFragment(normalized)
    ) {
      break;
    }
    if (Math.abs(getLineCenterX(line) - numberCenterX) > 0.24) {
      break;
    }

    titleLines.push(line);
    upperLine = line;
    if (titleLines.length >= 4) {
      break;
    }
  }

  if (titleLines.length === 0) {
    return null;
  }

  const sourceLines = titleLines.map((line) => normalizeWhitespace(line.text)).filter(Boolean);
  const titleText = normalizeTitleSelectionText(
    mergeOcrTitleSelectionParts(sourceLines)
  );
  if (!titleText) {
    return null;
  }

  return {
    titleText,
    sourceText: sourceLines.join("\n"),
    score:
      128 +
      Math.min(countTitleVocabularyHits(titleText) * 14, 44) +
      (matchesTitleLikeVocabulary(titleText) ? 36 : 0) +
      (hasCompactTechnicalTitleSignal(titleText) ? 18 : 0) +
      (countWords(titleText) === 1 ? 6 : 28) +
      Math.min(Math.max(titleLines.length - 1, 0) * 20, 60),
  };
}

function buildLocalizedBottomRightFallback(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const stampRegion = getMetadataRegionById("sheetStamp");
  const numberRegion = getMetadataRegionById("numberBlock");
  const titleRegionIds: MetadataRegionId[] = ["titleBlock", "titleTall"];
  if (!stampRegion || !numberRegion) {
    return null;
  }

  const stampPage = buildPageRegionModel(args.page, stampRegion);
  const numberPage = buildPageRegionModel(args.page, numberRegion);
  if (!stampPage && !numberPage) {
    return null;
  }

  const directStampWinner = stampPage
    ? findDirectCornerStampSheetNumber(stampPage.lines) ??
      findBestInlineSplitSheetNumber(stampPage.lines)
    : null;
  const stampNumberResult = stampPage
    ? detectSheetNumber(stampPage, args.exactCounts, args.prefixCounts)
    : { sheetNumber: "", confidence: 0.15, winner: null };
  const numberBlockResult = numberPage
    ? detectSheetNumber(numberPage, args.exactCounts, args.prefixCounts)
    : { sheetNumber: "", confidence: 0.15, winner: null };

  let winner =
    directStampWinner ||
    stampNumberResult.winner ||
    numberBlockResult.winner ||
    null;
  let sheetNumber =
    directStampWinner?.value ||
    stampNumberResult.sheetNumber ||
    numberBlockResult.sheetNumber ||
    "";
  let confidence = directStampWinner
    ? 1
    : stampNumberResult.winner
      ? stampNumberResult.confidence
      : numberBlockResult.confidence;
  let winnerLine =
    directStampWinner || stampNumberResult.winner
      ? (stampPage?.lines[(directStampWinner ?? stampNumberResult.winner)?.lineIndex ?? -1] ??
        null)
      : numberBlockResult.winner
          ? (numberPage?.lines[numberBlockResult.winner.lineIndex] ?? null)
          : null;

  if ((!winner || !sheetNumber) && args.page.ocrBacked) {
    const ocrTitleColumnNumber = findBestOcrBackedTitleColumnNumber({
      page: args.page,
      exactCounts: args.exactCounts,
      prefixCounts: args.prefixCounts,
    });
    if (ocrTitleColumnNumber?.result.winner) {
      winner = ocrTitleColumnNumber.result.winner;
      sheetNumber = ocrTitleColumnNumber.result.sheetNumber;
      confidence = ocrTitleColumnNumber.result.confidence;
      winnerLine =
        ocrTitleColumnNumber.page.lines[ocrTitleColumnNumber.result.winner.lineIndex] ?? null;
    }
  }

  if (!winner || !sheetNumber) {
    return null;
  }

  let bestTitleCandidate:
    | {
        titleText: string;
        sourceText: string;
        score: number;
      }
    | null = null;

  const directStampTitle = findDirectStampTitleAboveNumber({
    stampPage,
    winner,
    sheetNumber,
  });
  if (directStampTitle) {
    bestTitleCandidate = directStampTitle;
  }

  const directStampTitleBelowNumber = findDirectStampTitleBelowNumber({
    stampPage,
    winner,
    sheetNumber,
  });
  if (
    directStampTitleBelowNumber &&
    (!bestTitleCandidate || directStampTitleBelowNumber.score > bestTitleCandidate.score)
  ) {
    bestTitleCandidate = directStampTitleBelowNumber;
  }

  for (const [index, titleRegionId] of titleRegionIds.entries()) {
    const titleRegion = getMetadataRegionById(titleRegionId);
    const titlePage = titleRegion ? buildPageRegionModel(args.page, titleRegion) : null;
    if (!titlePage) {
      continue;
    }

    const titleLines = titlePage.lines.filter((line) => {
      const normalized = normalizeWhitespace(line.text);
      if (!normalized) {
        return false;
      }
      if (normalized === normalizeWhitespace(winner.lineText)) {
        return false;
      }
      const winnerCenterY = winner.normY + winner.normHeight / 2;
      return getLineCenterY(line) <= winnerCenterY - 0.01;
    });
    const assembledTitleResult = buildAssembledPyMuPdfTitle(
      args.page,
      titleLines,
      args.documentTitleStyleProfile
    );
    const title = assembledTitleResult.title;
    const sourceText = assembledTitleResult.keptLines.join("\n");
    const titleEvaluation = title
      ? evaluateTitleSelection({
          title,
          sourceKind: "pdf_text",
          sourceText,
          pageNumber: args.page.pageNumber,
          documentTitleStyleProfile: args.documentTitleStyleProfile,
        })
      : null;
    const titleText = titleEvaluation?.text ?? title;
    const titleScore =
      (titleEvaluation?.score ?? -Infinity) +
      getPyMuPdfTitleTypographyScore(titlePage, titleLines, winnerLine) +
      getDocumentStyleTitleCandidateBoost({
        profile: args.documentTitleStyleProfile,
        keptLines: assembledTitleResult.keptLines,
        titleText,
      }) +
      (index === 0 ? 8 : 0);
    if (!titleText || !Number.isFinite(titleScore) || titleScore < 20) {
      continue;
    }
    if (!bestTitleCandidate || titleScore > bestTitleCandidate.score) {
      bestTitleCandidate = {
        titleText,
        sourceText,
        score: titleScore,
      };
    }
  }

  if (!bestTitleCandidate && winnerLine) {
    for (const titleRegionId of titleRegionIds) {
      const titleRegion = getMetadataRegionById(titleRegionId);
      const titlePage = titleRegion ? buildPageRegionModel(args.page, titleRegion) : null;
      if (!titlePage) {
        continue;
      }

      const sourceLines = collectLocalizedPyMuPdfTitleLines(titlePage, winnerLine)
        .map((line) => normalizeWhitespace(line.text))
        .filter((lineText) => {
          if (!lineText) {
            return false;
          }
          if (normalizeKey(lineText) === normalizeKey(winner.lineText)) {
            return false;
          }
          if (/^[NI]$/i.test(lineText)) {
            return false;
          }
          if (
            /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+\d{1,2},?\s+\d{4}\b/i.test(lineText) ||
            isMetadataBoxFooterLine(lineText)
          ) {
            return false;
          }
          if (isMetadataLabelOnlyTitleText(lineText)) {
            return false;
          }
          return true;
        });
      if (sourceLines.length === 0) {
        continue;
      }

      const assembledTitleResult = buildAssembledPyMuPdfTitle(
        args.page,
        sourceLines.map((text, lineIndex) => ({
          text,
          lineIndex,
          items: [],
          x: 0,
          top: 0,
          width: Math.max(text.length * 8, 1),
          height: 10,
          normX: 0,
          normY: 0,
          normWidth: 0,
          normHeight: 0,
        })),
        args.documentTitleStyleProfile
      );
      const title = assembledTitleResult.title || mergeOcrTitleSelectionParts(sourceLines);
      const titleEvaluation = title
        ? evaluateTitleSelection({
            title,
            sourceKind: "pdf_text",
            sourceText: sourceLines.join("\n"),
            pageNumber: args.page.pageNumber,
            documentTitleStyleProfile: args.documentTitleStyleProfile,
          })
        : null;
      const titleText = titleEvaluation?.text ?? title;
      if (!titleText) {
        continue;
      }

      const hasTitleSignal =
        countTitleVocabularyHits(titleText) > 0 ||
        matchesTitleLikeVocabulary(titleText) ||
        hasCompactTechnicalTitleSignal(titleText) ||
        (
          countWords(titleText) >= 2 &&
          countWords(titleText) <= 9 &&
          getTextualTitleRejectPenalty(titleText) > -120
        );
      if (
        !hasTitleSignal ||
        isSuspiciousDetectedTitle(titleText) ||
        matchesAdministrativeTitleMetadata(titleText) ||
        isRegulatoryOrScopeNoteText(sourceLines.join(" "))
      ) {
        continue;
      }

      bestTitleCandidate = {
        titleText,
        sourceText: sourceLines.join("\n"),
        score:
          72 +
          Math.min(countTitleVocabularyHits(titleText) * 12, 48) +
          (matchesTitleLikeVocabulary(titleText) ? 24 : 0) +
          (hasCompactTechnicalTitleSignal(titleText) ? 18 : 0),
      };
      break;
    }
  }

  if (!sheetNumber || !bestTitleCandidate) {
    return null;
  }

  return {
    fallbackNumberResult: {
      sheetNumber,
      confidence,
      winner,
    },
    fallbackTitleResult: {
      title: bestTitleCandidate.titleText,
      sourceText: bestTitleCandidate.sourceText,
      lineIndex: 0,
      lineIndexes: [],
    } satisfies DetectedSheetTitle,
  };
}

function buildRankedSheetNumberCandidates(
  page: PageExtractionModel,
  exactCounts: Record<string, number>,
  prefixCounts: Record<string, number>,
  limit = 5
) {
  const ranked = page.candidates
    .map((candidate) => {
      const rescored = rescoreCandidate(candidate, exactCounts, prefixCounts);
      return {
        value: candidate.value,
        lineText: candidate.lineText,
        score: Number(rescored.toFixed(1)),
        candidateTypeGuess: guessSheetNumberCandidateType(
          candidate.value,
          candidate.lineText
        ),
        reasonCodes: buildSheetNumberReasonCodes(candidate),
        lineIndex: candidate.lineIndex,
      };
    })
    .sort((left, right) => right.score - left.score);
  return ranked.slice(0, limit);
}

function buildPyMuPdfLocalTrace(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const sheetStampRegion = getMetadataRegionById("sheetStamp");
  const titleBlockRegion = getMetadataRegionById("titleBlock");
  const titleTallRegion = getMetadataRegionById("titleTall");
  const numberBlockRegion = getMetadataRegionById("numberBlock");
  const bottomRightRegion = getMetadataRegionById("bottomRight");
  const sheetStampPage = sheetStampRegion
    ? buildPageRegionModel(args.page, sheetStampRegion)
    : null;
  const titleBlockPage = titleBlockRegion
    ? buildPageRegionModel(args.page, titleBlockRegion)
    : null;
  const titleTallPage = titleTallRegion
    ? buildPageRegionModel(args.page, titleTallRegion)
    : null;
  const numberBlockPage = numberBlockRegion
    ? buildPageRegionModel(args.page, numberBlockRegion)
    : null;
  const bottomRightPage = bottomRightRegion
    ? buildPageRegionModel(args.page, bottomRightRegion)
    : null;
  const stampNumberResult = sheetStampPage
    ? detectSheetNumber(sheetStampPage, args.exactCounts, args.prefixCounts)
    : createEmptySheetNumberDetection();
  const numberBlockResult = numberBlockPage
    ? detectSheetNumber(numberBlockPage, args.exactCounts, args.prefixCounts)
    : createEmptySheetNumberDetection();
  const ocrTitleColumnNumber =
    !stampNumberResult.winner && !numberBlockResult.winner
      ? findBestOcrBackedTitleColumnNumber({
          page: args.page,
          exactCounts: args.exactCounts,
          prefixCounts: args.prefixCounts,
        })
      : null;
  const activeNumberPage =
    stampNumberResult.winner && sheetStampPage
      ? sheetStampPage
      : numberBlockResult.winner && numberBlockPage
          ? numberBlockPage
          : ocrTitleColumnNumber?.page
            ? ocrTitleColumnNumber.page
          : null;
  const activeNumberWinner =
    (stampNumberResult.winner && sheetStampPage
      ? stampNumberResult.winner
      : numberBlockResult.winner && numberBlockPage
          ? numberBlockResult.winner
          : ocrTitleColumnNumber?.result.winner) ?? null;
  const activeNumberLine =
    activeNumberPage && activeNumberWinner
      ? activeNumberPage.lines[activeNumberWinner.lineIndex] ?? null
      : null;
  const titleLineCandidates =
    titleBlockPage && activeNumberLine
      ? titleBlockPage.lines.map((line, lineIndex) => ({
          text: line.text,
          ...evaluateLocalizedPyMuPdfTitleLine({
            page: titleBlockPage,
            line,
            lineIndex,
            numberLine: activeNumberLine,
          }),
        }))
      : [];
  const admittedTitleLines =
    titleBlockPage && activeNumberLine
      ? collectLocalizedPyMuPdfTitleLines(titleBlockPage, activeNumberLine)
      : [];
  const tallTitleLineCandidates =
    titleTallPage && activeNumberLine
      ? titleTallPage.lines.map((line, lineIndex) => ({
          text: line.text,
          ...evaluateLocalizedPyMuPdfTitleLine({
            page: titleTallPage,
            line,
            lineIndex,
            numberLine: activeNumberLine,
          }),
        }))
      : [];
  const admittedTallTitleLines =
    titleTallPage && activeNumberLine
      ? collectLocalizedPyMuPdfTitleLines(titleTallPage, activeNumberLine)
      : [];
  const assembledTitleResult = admittedTitleLines.length
    ? buildAssembledPyMuPdfTitle(
        args.page,
        admittedTitleLines,
        args.documentTitleStyleProfile
      )
    : { title: "", keptLines: [] as string[] };
  const assembledTallTitleResult = admittedTallTitleLines.length
    ? buildAssembledPyMuPdfTitle(
        args.page,
        admittedTallTitleLines,
        args.documentTitleStyleProfile
      )
    : { title: "", keptLines: [] as string[] };
  const assembledTitle = assembledTitleResult.title;
  const assembledTallTitle = assembledTallTitleResult.title;
  const assembledTitleEvaluation = assembledTitle
    ? evaluateTitleSelection({
        title: assembledTitle,
        sourceKind: "pdf_text",
        sourceText: assembledTitleResult.keptLines.join("\n"),
        pageNumber: args.page.pageNumber,
        documentTitleStyleProfile: args.documentTitleStyleProfile,
      })
    : null;
  const assembledTallTitleEvaluation = assembledTallTitle
    ? evaluateTitleSelection({
        title: assembledTallTitle,
        sourceKind: "pdf_text",
        sourceText: assembledTallTitleResult.keptLines.join("\n"),
        pageNumber: args.page.pageNumber,
        documentTitleStyleProfile: args.documentTitleStyleProfile,
      })
    : null;
  const localizedFallback = buildLocalizedBottomRightFallback({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const directCornerCandidate = buildPyMuPdfDirectCornerPairCandidate({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });

  return {
    sheetStamp: {
      lines: sheetStampPage?.lines.map((line) => line.text) ?? [],
      rankedNumberCandidates: sheetStampPage
        ? buildRankedSheetNumberCandidates(
            sheetStampPage,
            args.exactCounts,
            args.prefixCounts
          )
        : [],
      selectedNumber: stampNumberResult.sheetNumber || null,
    },
    numberBlock: {
      lines: numberBlockPage?.lines.map((line) => line.text) ?? [],
      rankedNumberCandidates: numberBlockPage
        ? buildRankedSheetNumberCandidates(
            numberBlockPage,
            args.exactCounts,
            args.prefixCounts
          )
        : [],
      selectedNumber: numberBlockResult.sheetNumber || null,
    },
    titleBlock: {
      lines: titleBlockPage?.lines.map((line) => line.text) ?? [],
      titleLineCandidates,
      admittedTitleLines: admittedTitleLines.map((line) => line.text),
      keptTitleLines: assembledTitleResult.keptLines,
      assembledTitle: assembledTitle || null,
      assembledTitleScore: assembledTitleEvaluation
        ? Number(assembledTitleEvaluation.score.toFixed(1))
        : null,
      assembledTitleText:
        (assembledTitleEvaluation?.text ?? assembledTitle) || null,
    },
    titleTall: {
      lines: titleTallPage?.lines.map((line) => line.text) ?? [],
      titleLineCandidates: tallTitleLineCandidates,
      admittedTitleLines: admittedTallTitleLines.map((line) => line.text),
      keptTitleLines: assembledTallTitleResult.keptLines,
      assembledTitle: assembledTallTitle || null,
      assembledTitleScore: assembledTallTitleEvaluation
        ? Number(assembledTallTitleEvaluation.score.toFixed(1))
        : null,
      assembledTitleText:
        (assembledTallTitleEvaluation?.text ?? assembledTallTitle) || null,
    },
    bottomRight: {
      lines: bottomRightPage?.lines.map((line) => line.text) ?? [],
    },
    localizedFallback: localizedFallback
      ? {
          sheetNumber: localizedFallback.fallbackNumberResult.sheetNumber || null,
          sheetTitle: localizedFallback.fallbackTitleResult.title || null,
          numberSourceText:
            localizedFallback.fallbackNumberResult.winner?.lineText ?? null,
          titleSourceText: localizedFallback.fallbackTitleResult.sourceText || null,
        }
      : null,
    directCornerCandidate: directCornerCandidate
      ? {
          sheetNumber: directCornerCandidate.sheetNumber,
          sheetTitle: directCornerCandidate.sheetTitle,
          score: Number(directCornerCandidate.score.toFixed(1)),
          confidence: Number(directCornerCandidate.confidence.toFixed(2)),
          numberReasonCodes: directCornerCandidate.numberReasonCodes ?? [],
          titleReasonCodes: directCornerCandidate.titleReasonCodes ?? [],
        }
      : null,
  };
}

function buildPyMuPdfLocalizedStampStackPairCandidate(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}): PairedSheetCandidate | null {
  const localizedFallback = buildLocalizedBottomRightFallback({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const numberResult = localizedFallback?.fallbackNumberResult ?? null;
  const titleResult = localizedFallback?.fallbackTitleResult ?? null;
  if (!numberResult?.sheetNumber || !numberResult.winner || !titleResult?.title) {
    return null;
  }

  const titleEvaluation = evaluateTitleSelection({
    title: titleResult.title,
    sourceKind: "pdf_text",
    sourceText: titleResult.sourceText,
    pageNumber: args.page.pageNumber,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const titleText = titleEvaluation?.text || titleResult.title;
  if (
    !titleText ||
    isSuspiciousDetectedTitle(titleText) ||
    !isTrustworthyCompactNumberOverTitleText(titleText)
  ) {
    return null;
  }

  const numberLine =
    numberResult.winner.lineIndex >= 0
      ? args.page.lines[numberResult.winner.lineIndex] ?? null
      : null;
  const sourceLineCount = titleResult.sourceText.split(/\r?\n/).filter(Boolean).length;
  const numberScore = numberResult.winner.score;
  const titleScore =
    Math.max(titleEvaluation?.score ?? 0, 38) + (sourceLineCount > 1 ? 22 : 8);
  const scoreTrace = new ScoreTrace()
    .add("localized_stamp_stack_base", 420)
    .add("sheet_number_candidate_score", numberScore)
    .add("sheet_title_candidate_score", titleScore);
  const score = scoreTrace.total();

  return {
    sheetNumber: numberResult.sheetNumber,
    sheetTitle: titleText,
    numberSourceText: numberResult.winner.lineText ?? numberResult.sheetNumber,
    titleSourceText: titleResult.sourceText,
    numberLineIndex: numberResult.winner.lineIndex,
    titleLineIndex: titleResult.lineIndex ?? null,
    numberRegion: "sheetStamp",
    titleRegion: "sheetStamp",
    pairedCluster: "localized_stamp_stack",
    styleProfile: "bottom_right_block",
    familyId: "bottom_right_block",
    numberCandidateTypeGuess: guessSheetNumberCandidateType(
      numberResult.sheetNumber,
      numberResult.winner.lineText
    ),
    titleCandidateTypeGuess: guessTitleCandidateType(titleText, titleResult.sourceText),
    numberReasonCodes: [
      ...buildSheetNumberReasonCodes(numberResult.winner),
      "compact_number_over_title_anchor",
    ],
    titleReasonCodes: [
      ...buildTitleReasonCodes({
        titleText,
        titleSourceText: titleResult.sourceText,
        titleLines: numberLine ? [numberLine] : [],
        numberLine,
        titleRegion: "sheetStamp",
        numberRegion: "sheetStamp",
      }),
      "directly_below_sheet_number",
    ],
    numberScore,
    titleScore,
    score,
    scoreBreakdown: scoreTrace.snapshot(),
    confidence: Math.max(numberResult.confidence, 0.86),
  };
}

function buildPyMuPdfPairCandidatesForPage(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const stripCandidate = buildPyMuPdfRegionPairCandidate({
    page: args.page,
    styleProfile: "bottom_right_strip",
    numberRegionId: "stripNumber",
    titleRegionId: "stripTitle",
    fullRegionId: "stripFull",
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const primaryCandidate = buildPyMuPdfRegionPairCandidate({
    page: args.page,
    styleProfile: "bottom_right_block",
    numberRegionId: "sheetStamp",
    titleRegionId: "titleBlock",
    fullRegionId: "bottomRight",
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const directCornerCandidate = buildPyMuPdfDirectCornerPairCandidate({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const numberOverTitleCandidate = buildPyMuPdfNumberOverTitleCompactPairCandidate({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const localizedStampStackCandidate = buildPyMuPdfLocalizedStampStackPairCandidate({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const seen = new Set<string>();
  const mergedCandidates: PairedSheetCandidate[] = [];

  for (const candidate of [
    localizedStampStackCandidate,
    numberOverTitleCandidate,
    stripCandidate,
    primaryCandidate,
    directCornerCandidate,
  ]) {
    if (!candidate) {
      continue;
    }
    const key = [
      normalizeSheetNumberValue(candidate.sheetNumber),
      normalizeTitleSelectionText(candidate.sheetTitle),
      candidate.numberRegion,
      candidate.titleRegion,
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    mergedCandidates.push(candidate);
  }

  return mergedCandidates.sort((left, right) => right.score - left.score);
}

function buildPdfPairCandidatesForPage(args: {
  page: PageExtractionModel;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  totalPages: number;
  rawBoxes?: MetadataBoxCandidate[];
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}): PairedSheetCandidate[] {
  const structuredCandidate = buildStructuredMetadataStampPairCandidate({
    page: args.page,
    repeatedLineCounts: args.repeatedLineCounts,
    totalPages: args.totalPages,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const pyMuPdfCandidates = buildPyMuPdfPairCandidatesForPage({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    documentTitleStyleProfile: args.documentTitleStyleProfile,
  });
  const rightColumnLargeTitleCandidate = buildRightColumnLargeTitlePairCandidate({
    page: args.page,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
    repeatedLineCounts: args.repeatedLineCounts,
    totalPages: args.totalPages,
  });
  const rawBoxes = args.rawBoxes ?? buildMetadataBoxCandidatesForPage(args.page);
  const boxCandidates = buildMetadataBoxPairCandidatesForPage({
    ...args,
    rawBoxes,
  });
  const localizedCandidates = PDF_METADATA_FAMILIES.map((family) =>
    buildLocalizedPdfPairCandidate({
      ...args,
      family,
    })
  ).filter((candidate): candidate is PairedSheetCandidate => Boolean(candidate));

  const seen = new Set<string>();
  return [
    structuredCandidate,
    ...pyMuPdfCandidates,
    rightColumnLargeTitleCandidate,
    ...boxCandidates,
    ...localizedCandidates,
  ]
    .filter((candidate): candidate is PairedSheetCandidate => Boolean(candidate))
    .filter((candidate) => {
      const key = [
        normalizeSheetNumberValue(candidate.sheetNumber),
        normalizeComparableSheetTitleText(candidate.sheetTitle),
        candidate.numberRegion,
        candidate.titleRegion,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.score - left.score);
}

function inferDocumentStyleProfile(candidateGroups: PairedSheetCandidate[][]): MetadataStyleProfile {
  const filteredGroups = candidateGroups.map((candidates) =>
    candidates.filter((candidate) => isLockEligibleStyleProfile(candidate.styleProfile))
  );
  const summary = summarizeStyleProfileVotes(filteredGroups);
  if (summary.styleProfile === "bottom_left_block") {
    return "bottom_left_block";
  }
  if (
    summary.styleProfile === "bottom_right_strip" &&
    summary.supportPages >= 3 &&
    summary.supportPages > (summary.runnerUpPages ?? 0)
  ) {
    return "bottom_right_strip";
  }
  return "bottom_right_block";
}

function inferDocumentFamilyLock(
  candidateGroups: PairedSheetCandidate[][]
): FamilyLockDecision {
  const summary = summarizeStyleProfileVotes(
    candidateGroups.map((candidates) =>
      candidates
        .filter((candidate) => isLockEligibleStyleProfile(candidate.styleProfile))
        .map((candidate) => ({
          styleProfile: candidate.styleProfile,
          score: candidate.score,
        }))
    )
  );

  return {
    styleProfile: summary.styleProfile as MetadataStyleProfile,
    locked: summary.locked,
    supportPages: summary.supportPages,
    supportScore: summary.supportScore,
    runnerUpStyleProfile: summary.runnerUpStyleProfile as MetadataStyleProfile | null,
    runnerUpPages: summary.runnerUpPages,
    runnerUpScore: summary.runnerUpScore,
  };
}

const OCR_REGION_PATTERN_DISCOVERY_WINDOW = 5;
const OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES = 3;
const OCR_REGION_PATTERN_REDISCOVERY_TRIGGER = 3;
const OCR_REGION_PATTERN_SWITCH_WINDOW = 3;
const OCR_REGION_PATTERN_MIN_SWITCH_PAGES = 3;
const LOCK_BAD_PAGE_REDISCOVERY_STREAK = 3;
const OCR_REGION_PATTERN_SEEDED_RETRY_MIN_REMAINING_PAGES = 10;
const OCR_REGION_PATTERN_SEEDED_RETRY_MAX_ACCEPTED_RESULTS = 1;
const DISCOVERY_CHECK_FAST_PROBE_PAGE_COUNT = 20;

function isStableLockRegion(regionId: OcrRegionId, role: "number" | "title") {
  if (role === "number") {
    return ["stripNumber", "sheetStamp", "numberBlock"].includes(regionId);
  }

  return ["stripTitle", "sheetStamp", "titleBlock"].includes(regionId);
}

function isLockEligibleOcrPatternResult(
  result: PdfTextExtractionResult
): result is NonNullable<PdfTextExtractionResult> & {
  styleProfile: OcrStyleProfile;
  numberRegion: OcrRegionId;
  titleRegion: OcrRegionId;
} {
  return Boolean(
    result &&
      result.styleProfile &&
      result.numberRegion &&
      result.titleRegion &&
      isStableLockRegion(result.numberRegion, "number") &&
      isStableLockRegion(result.titleRegion, "title") &&
      result.score >= 180
  );
}

function normalizeOcrPatternBox(box: OcrNormalizedBox | null | undefined) {
  if (!box) {
    return null;
  }

  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const width = Math.min(1 - x, Math.max(0.001, box.width));
  const height = Math.min(1 - y, Math.max(0.001, box.height));

  return { x, y, width, height } satisfies OcrNormalizedBox;
}

function expandNormalizedOcrPatternBox(
  box: OcrNormalizedBox | null | undefined,
  paddingX: number,
  paddingY: number
) {
  const normalizedBox = normalizeOcrPatternBox(box);
  if (!normalizedBox) {
    return null;
  }

  const x = clamp(normalizedBox.x - paddingX, 0, 1);
  const y = clamp(normalizedBox.y - paddingY, 0, 1);
  const right = clamp(normalizedBox.x + normalizedBox.width + paddingX, 0, 1);
  const bottom = clamp(normalizedBox.y + normalizedBox.height + paddingY, 0, 1);

  return normalizeOcrPatternBox({
    x,
    y,
    width: right - x,
    height: bottom - y,
  });
}

function adjustNormalizedOcrPatternBox(
  box: OcrNormalizedBox | null | undefined,
  adjustments: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  }
) {
  const normalizedBox = normalizeOcrPatternBox(box);
  if (!normalizedBox) {
    return null;
  }

  const left = adjustments.left ?? 0;
  const right = adjustments.right ?? 0;
  const top = adjustments.top ?? 0;
  const bottom = adjustments.bottom ?? 0;
  const nextLeft = clamp(normalizedBox.x - left, 0, 1);
  const nextTop = clamp(normalizedBox.y - top, 0, 1);
  const nextRight = clamp(
    normalizedBox.x + normalizedBox.width + right,
    0,
    1
  );
  const nextBottom = clamp(
    normalizedBox.y + normalizedBox.height + bottom,
    0,
    1
  );

  return normalizeOcrPatternBox({
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  });
}

function unionNormalizedOcrPatternBoxes(
  boxes: Array<OcrNormalizedBox | null | undefined>
) {
  const usable = boxes
    .map((box) => normalizeOcrPatternBox(box))
    .filter((box): box is OcrNormalizedBox => Boolean(box));
  if (usable.length === 0) {
    return null;
  }

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = 0;
  let bottom = 0;

  for (const box of usable) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }

  return normalizeOcrPatternBox({
    x: left,
    y: top,
    width: Math.max(right - left, 0.001),
    height: Math.max(bottom - top, 0.001),
  });
}

function deriveRediscoveryPatternBoxes(args: {
  styleProfile: OcrStyleProfile;
  numberBox: OcrNormalizedBox | null | undefined;
  titleBox: OcrNormalizedBox | null | undefined;
}) {
  const rediscoveryNumberBox =
    args.styleProfile === "bottom_right_strip"
      ? adjustNormalizedOcrPatternBox(args.numberBox, {
          left: 0.01,
          right: 0.004,
          top: 0.008,
          bottom: 0.006,
        })
      : adjustNormalizedOcrPatternBox(args.numberBox, {
          left: 0.016,
          right: 0.008,
          top: 0.012,
          bottom: 0.01,
        });
  const rediscoveryTitleBox =
    args.styleProfile === "bottom_right_strip"
      ? adjustNormalizedOcrPatternBox(args.titleBox, {
          left: 0.012,
          right: 0.006,
          top: 0.01,
          bottom: 0.008,
        })
      : adjustNormalizedOcrPatternBox(args.titleBox, {
          left: 0.022,
          right: 0.01,
          top: 0.018,
          bottom: 0.012,
        });
  const rediscoveryNeighborhoodBase = unionNormalizedOcrPatternBoxes([
    rediscoveryNumberBox,
    rediscoveryTitleBox,
  ]);
  const rediscoveryNeighborhoodBox =
    args.styleProfile === "bottom_right_strip"
      ? adjustNormalizedOcrPatternBox(rediscoveryNeighborhoodBase, {
          left: 0.008,
          right: 0.004,
          top: 0.008,
          bottom: 0.006,
        })
      : adjustNormalizedOcrPatternBox(rediscoveryNeighborhoodBase, {
          left: 0.012,
          right: 0.008,
          top: 0.012,
          bottom: 0.008,
        });

  return {
    rediscoveryNumberBox,
    rediscoveryTitleBox,
    rediscoveryNeighborhoodBox,
  };
}

function withDerivedRediscoveryPatternBoxes(
  pattern: Omit<
    LockedOcrRegionPattern,
    "rediscoveryNumberBox" | "rediscoveryTitleBox" | "rediscoveryNeighborhoodBox"
  > &
    Partial<
      Pick<
        LockedOcrRegionPattern,
        | "rediscoveryNumberBox"
        | "rediscoveryTitleBox"
        | "rediscoveryNeighborhoodBox"
      >
    >
) {
  const derived = deriveRediscoveryPatternBoxes({
    styleProfile: pattern.styleProfile,
    numberBox: pattern.numberBox,
    titleBox: pattern.titleBox,
  });

  return {
    ...pattern,
    rediscoveryNumberBox:
      normalizeOcrPatternBox(pattern.rediscoveryNumberBox) ??
      derived.rediscoveryNumberBox,
    rediscoveryTitleBox:
      normalizeOcrPatternBox(pattern.rediscoveryTitleBox) ??
      derived.rediscoveryTitleBox,
    rediscoveryNeighborhoodBox:
      normalizeOcrPatternBox(pattern.rediscoveryNeighborhoodBox) ??
      derived.rediscoveryNeighborhoodBox,
  } satisfies LockedOcrRegionPattern;
}

function buildExpandedRediscoverySeedPattern(
  pattern: LockedOcrRegionPattern | null | undefined,
  options?: {
    patternId?: string;
  }
) {
  if (!pattern) {
    return null;
  }

  const normalizedPattern = withDerivedRediscoveryPatternBoxes(pattern);

  return {
    ...normalizedPattern,
    patternId: options?.patternId ?? `${pattern.patternId}-rediscovery`,
    numberBox: normalizedPattern.numberBox,
    titleBox: normalizedPattern.titleBox,
  } satisfies LockedOcrRegionPattern;
}

function getOcrPatternBoxArea(box: OcrNormalizedBox | null | undefined) {
  if (!box) {
    return 0;
  }

  return Math.max(box.width, 0) * Math.max(box.height, 0);
}

function getOcrPatternBoxOverlapRatio(
  left: OcrNormalizedBox | null | undefined,
  right: OcrNormalizedBox | null | undefined
) {
  if (!left || !right) {
    return 0;
  }

  const leftRight = left.x + left.width;
  const leftBottom = left.y + left.height;
  const rightRight = right.x + right.width;
  const rightBottom = right.y + right.height;
  const intersectionWidth = Math.max(0, Math.min(leftRight, rightRight) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(
    0,
    Math.min(leftBottom, rightBottom) - Math.max(left.y, right.y)
  );
  const intersection = intersectionWidth * intersectionHeight;
  const union = getOcrPatternBoxArea(left) + getOcrPatternBoxArea(right) - intersection;

  if (union <= 0) {
    return 0;
  }

  return intersection / union;
}

function getOcrPatternBoxCoverageRatio(
  box: OcrNormalizedBox | null | undefined,
  regionBox: OcrNormalizedBox | null | undefined
) {
  if (!box || !regionBox) {
    return 0;
  }

  const boxRight = box.x + box.width;
  const boxBottom = box.y + box.height;
  const regionRight = regionBox.x + regionBox.width;
  const regionBottom = regionBox.y + regionBox.height;
  const intersectionWidth = Math.max(
    0,
    Math.min(boxRight, regionRight) - Math.max(box.x, regionBox.x)
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(boxBottom, regionBottom) - Math.max(box.y, regionBox.y)
  );
  const intersection = intersectionWidth * intersectionHeight;
  const boxArea = getOcrPatternBoxArea(box);

  if (boxArea <= 0) {
    return 0;
  }

  return intersection / boxArea;
}

function isOcrPatternBoxCenterInsideRegion(
  box: OcrNormalizedBox | null | undefined,
  regionBox: OcrNormalizedBox | null | undefined
) {
  if (!box || !regionBox) {
    return false;
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  return (
    centerX >= regionBox.x &&
    centerX <= regionBox.x + regionBox.width &&
    centerY >= regionBox.y &&
    centerY <= regionBox.y + regionBox.height
  );
}

function boxesApproximatelyMatch(
  left: OcrNormalizedBox | null | undefined,
  right: OcrNormalizedBox | null | undefined,
  tolerance = 0.05
) {
  if (!left || !right) {
    return false;
  }

  const overlap = getOcrPatternBoxOverlapRatio(left, right);
  if (overlap >= 0.3) {
    return true;
  }

  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;

  return (
    Math.abs(leftCenterX - rightCenterX) <= tolerance &&
    Math.abs(leftCenterY - rightCenterY) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance * 1.6 &&
    Math.abs(left.height - right.height) <= tolerance * 1.6
  );
}

function mergeOcrPatternBoxes(
  current: OcrNormalizedBox | null | undefined,
  observed: OcrNormalizedBox | null | undefined
) {
  const normalizedCurrent = normalizeOcrPatternBox(current);
  const normalizedObserved = normalizeOcrPatternBox(observed);

  if (!normalizedCurrent) {
    return normalizedObserved;
  }

  if (!normalizedObserved) {
    return normalizedCurrent;
  }

  return normalizeOcrPatternBox({
    x: normalizedCurrent.x * 0.7 + normalizedObserved.x * 0.3,
    y: normalizedCurrent.y * 0.7 + normalizedObserved.y * 0.3,
    width: normalizedCurrent.width * 0.7 + normalizedObserved.width * 0.3,
    height: normalizedCurrent.height * 0.7 + normalizedObserved.height * 0.3,
  });
}

function collectObservationClusterBoxes(observations: OcrRegionPatternObservation[]) {
  let numberBox: OcrNormalizedBox | null = null;
  let titleBox: OcrNormalizedBox | null = null;

  for (const observation of observations) {
    numberBox = mergeOcrPatternBoxes(numberBox, observation.numberBox);
    titleBox = mergeOcrPatternBoxes(titleBox, observation.titleBox);
  }

  return { numberBox, titleBox };
}

function getDiscoveryCanonicalRegionIds(role: "number" | "title") {
  return role === "number"
    ? (["stripNumber", "sheetStamp", "numberBlock", "bottomRight"] as const)
    : (["stripTitle", "sheetStamp", "titleBlock", "bottomRight"] as const);
}

function getDiscoveryCanonicalRegionBox(regionId: OcrRegionId) {
  const region = getMetadataRegionById(regionId as MetadataRegionId);
  if (!region) {
    return null;
  }

  return {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  } satisfies OcrNormalizedBox;
}

function chooseCanonicalDiscoveryObservationRegion(
  role: "number" | "title",
  currentRegionId: OcrRegionId,
  box: OcrNormalizedBox | null | undefined
) {
  const normalizedBox = normalizeOcrPatternBox(box);
  if (!normalizedBox) {
    return currentRegionId;
  }

  if (role === "title" && currentRegionId === "bottomRight") {
    const titleBlockBox = getDiscoveryCanonicalRegionBox("titleBlock");
    if (titleBlockBox) {
      const titleCoverage = getOcrPatternBoxCoverageRatio(normalizedBox, titleBlockBox);
      const titleOverlap = getOcrPatternBoxOverlapRatio(normalizedBox, titleBlockBox);
      const titleCenterInside = isOcrPatternBoxCenterInsideRegion(
        normalizedBox,
        titleBlockBox
      );
      if (
        titleCoverage >= 0.45 ||
        (titleCenterInside && titleOverlap >= 0.08)
      ) {
        return "titleBlock";
      }
    }
  }

  if (role === "number" && currentRegionId === "bottomRight") {
    const numberBlockBox = getDiscoveryCanonicalRegionBox("numberBlock");
    const sheetStampBox = getDiscoveryCanonicalRegionBox("sheetStamp");
    if (sheetStampBox) {
      const stampCoverage = getOcrPatternBoxCoverageRatio(normalizedBox, sheetStampBox);
      const stampOverlap = getOcrPatternBoxOverlapRatio(normalizedBox, sheetStampBox);
      const stampCenterInside = isOcrPatternBoxCenterInsideRegion(
        normalizedBox,
        sheetStampBox
      );
      if (
        stampCoverage >= 0.35 ||
        (stampCenterInside && stampOverlap >= 0.05)
      ) {
        return "sheetStamp";
      }
    }
    if (numberBlockBox) {
      const numberCoverage = getOcrPatternBoxCoverageRatio(normalizedBox, numberBlockBox);
      const numberOverlap = getOcrPatternBoxOverlapRatio(normalizedBox, numberBlockBox);
      const numberCenterInside = isOcrPatternBoxCenterInsideRegion(
        normalizedBox,
        numberBlockBox
      );
      if (
        numberCoverage >= 0.4 ||
        (numberCenterInside && numberOverlap >= 0.08)
      ) {
        return "numberBlock";
      }
    }
  }

  let bestRegionId: OcrRegionId | null = null;
  let bestRegionArea = Number.POSITIVE_INFINITY;

  for (const candidateRegionId of getDiscoveryCanonicalRegionIds(role)) {
    const candidateBox = getDiscoveryCanonicalRegionBox(candidateRegionId);
    if (!candidateBox) {
      continue;
    }

    const coverage = getOcrPatternBoxCoverageRatio(normalizedBox, candidateBox);
    const overlap = getOcrPatternBoxOverlapRatio(normalizedBox, candidateBox);
    const centerInside = isOcrPatternBoxCenterInsideRegion(normalizedBox, candidateBox);
    if (coverage < 0.8 && !(centerInside && overlap >= 0.2)) {
      continue;
    }

    const candidateArea = getOcrPatternBoxArea(candidateBox);
    if (candidateArea < bestRegionArea) {
      bestRegionId = candidateRegionId;
      bestRegionArea = candidateArea;
    }
  }

  return bestRegionId ?? currentRegionId;
}

function canonicalizeDiscoveryObservation(
  observation: OcrRegionPatternObservation
): OcrRegionPatternObservation {
  const normalizedNumberBox = normalizeOcrPatternBox(observation.numberBox);
  const normalizedTitleBox = normalizeOcrPatternBox(observation.titleBox);
  const numberRegion = chooseCanonicalDiscoveryObservationRegion(
    "number",
    observation.numberRegion,
    normalizedNumberBox
  );
  const titleRegion = chooseCanonicalDiscoveryObservationRegion(
    "title",
    observation.titleRegion,
    normalizedTitleBox
  );

  if (
    numberRegion === observation.numberRegion &&
    titleRegion === observation.titleRegion &&
    normalizedNumberBox === observation.numberBox &&
    normalizedTitleBox === observation.titleBox
  ) {
    return observation;
  }

  return {
    ...observation,
    numberRegion,
    titleRegion,
    numberBox: normalizedNumberBox,
    titleBox: normalizedTitleBox,
  };
}

function getDiscoveryObservationClusterScore(observations: OcrRegionPatternObservation[]) {
  if (observations.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const totalScore = observations.reduce((sum, observation) => sum + observation.score, 0);
  const boxSupport = observations.reduce(
    (sum, observation) =>
      sum + (observation.numberBox ? 1 : 0) + (observation.titleBox ? 1 : 0),
    0
  );
  const averageArea =
    observations.reduce(
      (sum, observation) =>
        sum +
        getOcrPatternBoxArea(observation.numberBox) +
        getOcrPatternBoxArea(observation.titleBox),
      0
    ) / observations.length;
  const [first] = observations;
  const regionPreference =
    (first.numberRegion === "sheetStamp"
      ? 60
      : first.numberRegion === "numberBlock"
        ? 45
        : first.numberRegion === "stripNumber"
          ? 20
          : 0) +
    (first.titleRegion === "titleBlock"
      ? 70
      : first.titleRegion === "sheetStamp"
        ? 40
        : first.titleRegion === "stripTitle"
          ? 25
          : 0);

  return observations.length * 1000 + totalScore + boxSupport * 40 + regionPreference - averageArea * 900;
}

function getObservationStyleId(observation: Pick<
  OcrRegionPatternObservation,
  "styleProfile" | "numberRegion" | "titleRegion"
>) {
  return `${observation.styleProfile}:${observation.numberRegion}:${observation.titleRegion}`;
}

function observationsShareStylePattern(
  left: OcrRegionPatternObservation,
  right: OcrRegionPatternObservation
) {
  if (getObservationStyleId(left) !== getObservationStyleId(right)) {
    return false;
  }

  const titleCompatible =
    !left.titleBox ||
    !right.titleBox ||
    boxesApproximatelyMatch(left.titleBox, right.titleBox, 0.06);
  const numberCompatible =
    !left.numberBox ||
    !right.numberBox ||
    boxesApproximatelyMatch(left.numberBox, right.numberBox, 0.06);

  return titleCompatible && numberCompatible;
}

function buildPatternFromObservationCluster(
  observations: OcrRegionPatternObservation[],
  patternId: string
): LockedOcrRegionPattern | null {
  if (observations.length === 0) {
    return null;
  }

  const [first] = observations;
  const { numberBox, titleBox } = collectObservationClusterBoxes(observations);

  return withDerivedRediscoveryPatternBoxes({
    patternId,
    styleId: getObservationStyleId(first),
    styleProfile: first.styleProfile,
    numberRegion: first.numberRegion,
    titleRegion: first.titleRegion,
    numberBox,
    titleBox,
    supportPages: observations.length,
    hitCount: observations.length,
    lastUsedPage: observations[observations.length - 1]?.pageNumber ?? null,
  });
}

function inferLockedOcrRegionPattern(
  observations: OcrRegionPatternObservation[]
): OcrRegionPatternDecision {
  const summary = summarizeOcrRegionPatternVotes(
    observations.map((observation) => ({
      styleProfile: observation.styleProfile,
      numberRegion: observation.numberRegion,
      titleRegion: observation.titleRegion,
      score: observation.score,
    }))
  );

  return {
    locked: summary.locked,
    styleProfile: summary.styleProfile as OcrStyleProfile | null,
    supportPages: summary.supportPages,
    numberRegion: summary.numberRegion as OcrRegionId | null,
    numberSupportPages: summary.numberSupportPages,
    titleRegion: summary.titleRegion as OcrRegionId | null,
    titleSupportPages: summary.titleSupportPages,
    runnerUpStyleProfile: summary.runnerUpStyleProfile as OcrStyleProfile | null,
    runnerUpPages: summary.runnerUpPages,
  };
}

function toLockedOcrRegionPattern(
  decision: OcrRegionPatternDecision,
  options?: {
    patternId?: string;
    numberBox?: OcrNormalizedBox | null;
    titleBox?: OcrNormalizedBox | null;
    lastUsedPage?: number | null;
  }
): LockedOcrRegionPattern | null {
  if (!decision.locked || !decision.styleProfile || !decision.numberRegion || !decision.titleRegion) {
    return null;
  }

  return withDerivedRediscoveryPatternBoxes({
    patternId: options?.patternId ?? "seed-1",
    styleId: getObservationStyleId({
      styleProfile: decision.styleProfile,
      numberRegion: decision.numberRegion,
      titleRegion: decision.titleRegion,
    }),
    styleProfile: decision.styleProfile,
    numberRegion: decision.numberRegion,
    titleRegion: decision.titleRegion,
    numberBox: normalizeOcrPatternBox(options?.numberBox),
    titleBox: normalizeOcrPatternBox(options?.titleBox),
    supportPages: decision.supportPages,
    hitCount: decision.supportPages,
    lastUsedPage: options?.lastUsedPage ?? null,
  });
}

function matchesLockedOcrRegionPattern(
  pattern: LockedOcrRegionPattern,
  observation: Pick<
    OcrRegionPatternObservation,
    "styleProfile" | "numberRegion" | "titleRegion" | "numberBox" | "titleBox"
  >
) {
  if (
    pattern.styleProfile !== observation.styleProfile ||
    pattern.numberRegion !== observation.numberRegion ||
    pattern.titleRegion !== observation.titleRegion
  ) {
    return false;
  }

  const titleMatch =
    !pattern.titleBox ||
    !observation.titleBox ||
    boxesApproximatelyMatch(pattern.titleBox, observation.titleBox, 0.06);
  const numberMatch =
    !pattern.numberBox ||
    !observation.numberBox ||
    boxesApproximatelyMatch(pattern.numberBox, observation.numberBox, 0.06);

  return titleMatch && numberMatch;
}

function supportsLockedOcrRegionPattern(
  pattern: LockedOcrRegionPattern,
  observation: Pick<
    OcrRegionPatternObservation,
    "styleProfile" | "numberRegion" | "titleRegion" | "numberBox" | "titleBox"
  >
) {
  if (pattern.styleProfile !== observation.styleProfile) {
    return false;
  }

  const titleAligned =
    pattern.titleRegion === observation.titleRegion &&
    (
      !pattern.titleBox ||
      !observation.titleBox ||
      boxesApproximatelyMatch(pattern.titleBox, observation.titleBox, 0.08)
    );
  const numberAligned =
    pattern.numberRegion === observation.numberRegion &&
    (
      !pattern.numberBox ||
      !observation.numberBox ||
      boxesApproximatelyMatch(pattern.numberBox, observation.numberBox, 0.08)
    );

  return titleAligned || numberAligned;
}

function upsertStoredOcrPattern(
  patterns: LockedOcrRegionPattern[],
  pattern: LockedOcrRegionPattern
) {
  const existingIndex = patterns.findIndex(
    (candidate) =>
      candidate.patternId === pattern.patternId || candidate.styleId === pattern.styleId
  );

  if (existingIndex === -1) {
    return [...patterns, pattern];
  }

  const next = [...patterns];
  next[existingIndex] = {
    ...next[existingIndex],
    ...withDerivedRediscoveryPatternBoxes(pattern),
    numberBox: pattern.numberBox ?? next[existingIndex].numberBox,
    titleBox: pattern.titleBox ?? next[existingIndex].titleBox,
    rediscoveryNumberBox:
      pattern.rediscoveryNumberBox ?? next[existingIndex].rediscoveryNumberBox,
    rediscoveryTitleBox:
      pattern.rediscoveryTitleBox ?? next[existingIndex].rediscoveryTitleBox,
    rediscoveryNeighborhoodBox:
      pattern.rediscoveryNeighborhoodBox ??
      next[existingIndex].rediscoveryNeighborhoodBox,
    supportPages: Math.max(next[existingIndex].supportPages, pattern.supportPages),
    hitCount: Math.max(next[existingIndex].hitCount, pattern.hitCount),
    lastUsedPage: pattern.lastUsedPage ?? next[existingIndex].lastUsedPage,
  };
  return next;
}

function updateLockedPatternFromObservation(
  pattern: LockedOcrRegionPattern,
  observation: OcrRegionPatternObservation
) {
  return {
    ...pattern,
    supportPages: pattern.supportPages + 1,
    hitCount: pattern.hitCount + 1,
    lastUsedPage: observation.pageNumber,
  };
}

function findBestObservationCluster(
  observations: OcrRegionPatternObservation[],
  minimumSize: number
) {
  let bestCluster: OcrRegionPatternObservation[] = [];

  for (const anchor of observations) {
    const cluster = observations.filter((candidate) =>
      observationsShareStylePattern(anchor, candidate)
    );
    if (cluster.length > bestCluster.length) {
      bestCluster = cluster;
      continue;
    }
    if (cluster.length === bestCluster.length) {
      const clusterScore = cluster.reduce((sum, candidate) => sum + candidate.score, 0);
      const bestScore = bestCluster.reduce((sum, candidate) => sum + candidate.score, 0);
      if (clusterScore > bestScore) {
        bestCluster = cluster;
      }
    }
  }

  return bestCluster.length >= minimumSize ? bestCluster : [];
}

function findBestDiscoveryObservationCluster(
  observations: OcrRegionPatternObservation[],
  minimumSize: number
) {
  let bestCluster: OcrRegionPatternObservation[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const anchor of observations) {
    const cluster = observations.filter((candidate) =>
      observationsShareStylePattern(anchor, candidate)
    );
    if (cluster.length < minimumSize) {
      continue;
    }

    const clusterScore = getDiscoveryObservationClusterScore(cluster);
    if (clusterScore > bestScore) {
      bestCluster = cluster;
      bestScore = clusterScore;
    }
  }

  return bestCluster;
}

function buildDiscoverySeedLockedPattern(
  observations: OcrRegionPatternObservation[],
  patternId = "seed-1"
) {
  const canonicalObservations = observations.map(canonicalizeDiscoveryObservation);
  const cluster = findBestDiscoveryObservationCluster(
    canonicalObservations,
    OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES
  );

  if (cluster.length < OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES) {
    return null;
  }

  return buildPatternFromObservationCluster(cluster, patternId);
}

function collectLockEligiblePatternObservations(
  pdfTextResults: Map<number, PdfTextExtractionResult>
) {
  return [...pdfTextResults.entries()]
    .map(([pageNumber, result]) =>
      isLockEligibleOcrPatternResult(result)
        ? {
            pageNumber,
            styleProfile: result.styleProfile,
            numberRegion: result.numberRegion,
            titleRegion: result.titleRegion,
            numberBox: normalizeOcrPatternBox(result.numberBox),
            titleBox: normalizeOcrPatternBox(result.titleBox),
            score: result.score,
          }
        : null
    )
    .filter((entry): entry is OcrRegionPatternObservation => Boolean(entry));
}

function refineSeedLockedPatternFromRerun(
  seedPattern: LockedOcrRegionPattern | null,
  pdfTextResults: Map<number, PdfTextExtractionResult>
) {
  if (!seedPattern) {
    return null;
  }

  const matchingObservations = collectLockEligiblePatternObservations(pdfTextResults)
    .map(canonicalizeDiscoveryObservation)
    .filter(
      (observation) =>
        observation.styleProfile === seedPattern.styleProfile &&
        (matchesLockedOcrRegionPattern(seedPattern, observation) ||
          supportsLockedOcrRegionPattern(seedPattern, observation))
    );

  if (matchingObservations.length < OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES) {
    return null;
  }

  const orderedObservations = [...matchingObservations].sort(
    (left, right) => left.pageNumber - right.pageNumber
  );

  let bestCluster: OcrRegionPatternObservation[] = orderedObservations;
  let bestClusterScore = Number.NEGATIVE_INFINITY;

  for (
    let startIndex = Math.max(
      0,
      orderedObservations.length - OCR_REGION_PATTERN_DISCOVERY_WINDOW
    );
    startIndex <= orderedObservations.length - OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES;
    startIndex += 1
  ) {
    const cluster = orderedObservations.slice(startIndex);
    if (cluster.length < OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES) {
      continue;
    }

    const clusterScore =
      getDiscoveryObservationClusterScore(cluster) +
      startIndex * 250 +
      cluster[cluster.length - 1]!.pageNumber * 5;
    if (clusterScore > bestClusterScore) {
      bestCluster = cluster;
      bestClusterScore = clusterScore;
    }
  }

  const { numberBox, titleBox } = collectObservationClusterBoxes(bestCluster);
  return withDerivedRediscoveryPatternBoxes({
    ...seedPattern,
    patternId: seedPattern.patternId,
    styleId: seedPattern.styleId,
    styleProfile: seedPattern.styleProfile,
    numberRegion: seedPattern.numberRegion,
    titleRegion: seedPattern.titleRegion,
    numberBox,
    titleBox,
    supportPages: bestCluster.length,
    hitCount: bestCluster.length,
    lastUsedPage: bestCluster[bestCluster.length - 1]?.pageNumber ?? null,
  });
}

function findMatchingStoredOcrPattern(
  patterns: LockedOcrRegionPattern[],
  observation: OcrRegionPatternObservation,
  excludePatternId?: string | null
) {
  return (
    patterns.find(
      (pattern) =>
        pattern.patternId !== excludePatternId &&
        matchesLockedOcrRegionPattern(pattern, observation)
    ) ??
    null
  );
}

function advanceOcrPatternLockState(args: {
  state: OcrPatternLockState;
  observation: OcrRegionPatternObservation | null;
}) {
  const nextState: OcrPatternLockState = {
    activePattern: args.state.activePattern,
    storedPatterns: [...args.state.storedPatterns],
    discoveryObservations: [...args.state.discoveryObservations],
    pendingObservations: [...args.state.pendingObservations],
    missStreak: args.state.missStreak,
    nextPatternId: args.state.nextPatternId,
    mode: args.state.mode,
    rediscoveryReason: args.state.rediscoveryReason,
  };

  if (!nextState.activePattern) {
    if (!args.observation) {
      nextState.mode = "discovery";
      return nextState;
    }

    nextState.discoveryObservations.push(args.observation);
    if (nextState.discoveryObservations.length > OCR_REGION_PATTERN_DISCOVERY_WINDOW) {
      nextState.discoveryObservations.splice(
        0,
        nextState.discoveryObservations.length - OCR_REGION_PATTERN_DISCOVERY_WINDOW
      );
    }

    if (nextState.discoveryObservations.length >= OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES) {
      const cluster = findBestObservationCluster(
        nextState.discoveryObservations,
        OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES
      );
      if (cluster.length >= OCR_REGION_PATTERN_MIN_DISCOVERY_PAGES) {
        const pattern = buildPatternFromObservationCluster(
          cluster,
          `style-${nextState.nextPatternId}`
        );
        if (pattern) {
          nextState.nextPatternId += 1;
          nextState.activePattern = pattern;
          nextState.storedPatterns = upsertStoredOcrPattern(nextState.storedPatterns, pattern);
          nextState.mode = "locked";
          nextState.rediscoveryReason = null;
        }
      }
    } else {
      nextState.mode = "discovery";
    }

    if (!nextState.activePattern) {
      nextState.mode = "discovery";
    }

    return nextState;
  }

  if (!args.observation) {
    nextState.missStreak += 1;
    nextState.mode =
      nextState.missStreak >= OCR_REGION_PATTERN_REDISCOVERY_TRIGGER
        ? "broad_rediscovery"
        : nextState.missStreak === 2
          ? "style_fallback"
          : nextState.missStreak === 1
            ? "local_expansion"
            : "locked";
    nextState.rediscoveryReason = "no_observation";
    if (nextState.missStreak < OCR_REGION_PATTERN_REDISCOVERY_TRIGGER) {
      nextState.pendingObservations = [];
    }
    return nextState;
  }

  if (matchesLockedOcrRegionPattern(nextState.activePattern, args.observation)) {
    nextState.activePattern = updateLockedPatternFromObservation(
      nextState.activePattern,
      args.observation
    );
    nextState.storedPatterns = upsertStoredOcrPattern(
      nextState.storedPatterns,
      nextState.activePattern
    );
    nextState.missStreak = 0;
    nextState.pendingObservations = [];
    nextState.mode = "locked";
    nextState.rediscoveryReason = null;
    return nextState;
  }

  if (supportsLockedOcrRegionPattern(nextState.activePattern, args.observation)) {
    nextState.activePattern = updateLockedPatternFromObservation(
      nextState.activePattern,
      args.observation
    );
    nextState.storedPatterns = upsertStoredOcrPattern(
      nextState.storedPatterns,
      nextState.activePattern
    );
    nextState.missStreak = 0;
    nextState.pendingObservations = [];
    nextState.mode = "locked";
    nextState.rediscoveryReason = null;
    return nextState;
  }

  nextState.pendingObservations.push(args.observation);
  if (nextState.pendingObservations.length > OCR_REGION_PATTERN_SWITCH_WINDOW) {
    nextState.pendingObservations.splice(
      0,
      nextState.pendingObservations.length - OCR_REGION_PATTERN_SWITCH_WINDOW
    );
  }

  if (nextState.missStreak < OCR_REGION_PATTERN_REDISCOVERY_TRIGGER) {
    nextState.mode =
      nextState.missStreak === 2
        ? "style_fallback"
        : nextState.missStreak === 1
          ? "local_expansion"
          : "locked";
    nextState.rediscoveryReason =
      nextState.missStreak > 0 ? nextState.rediscoveryReason ?? "no_observation" : null;
    return nextState;
  }

  nextState.mode = "broad_rediscovery";
  nextState.rediscoveryReason = nextState.rediscoveryReason ?? "no_observation";

  const storedMatch = findMatchingStoredOcrPattern(
    nextState.storedPatterns,
    args.observation,
    nextState.activePattern.patternId
  );
  if (storedMatch) {
    nextState.activePattern = updateLockedPatternFromObservation(
      storedMatch,
      args.observation
    );
    nextState.storedPatterns = upsertStoredOcrPattern(
      nextState.storedPatterns,
      nextState.activePattern
    );
    nextState.discoveryObservations = [];
    nextState.pendingObservations = [];
    nextState.missStreak = 0;
    nextState.mode = "locked";
    nextState.rediscoveryReason = null;
    return nextState;
  }

  if (nextState.pendingObservations.length < OCR_REGION_PATTERN_MIN_SWITCH_PAGES) {
    return nextState;
  }

  const cluster = findBestObservationCluster(
    nextState.pendingObservations,
    OCR_REGION_PATTERN_MIN_SWITCH_PAGES
  );
  if (cluster.length < OCR_REGION_PATTERN_MIN_SWITCH_PAGES) {
    return nextState;
  }

  const nextPattern = buildPatternFromObservationCluster(
    cluster,
    `style-${nextState.nextPatternId}`
  );
  if (!nextPattern || matchesLockedOcrRegionPattern(nextState.activePattern, nextPattern)) {
    return nextState;
  }

  nextState.nextPatternId += 1;
  nextState.activePattern = nextPattern;
  nextState.storedPatterns = upsertStoredOcrPattern(nextState.storedPatterns, nextPattern);
  nextState.discoveryObservations = cluster.slice(-OCR_REGION_PATTERN_DISCOVERY_WINDOW);
  nextState.pendingObservations = [];
  nextState.missStreak = 0;
  nextState.mode = "locked";
  nextState.rediscoveryReason = null;
  return nextState;
}

function parseSheetNumberParts(value: string) {
  return parseSheetNumberPartsBase(stripDocumentSheetIndexWrapperPrefix(value));
}

function matchesCompactAnchorNumber(anchorValue: string, candidateValue: string) {
  const normalizedAnchor = normalizeSheetNumberValue(anchorValue);
  const normalizedCandidate = normalizeSheetNumberValue(candidateValue);
  if (!normalizedAnchor || !normalizedCandidate) {
    return false;
  }

  if (normalizeKey(normalizedAnchor) === normalizeKey(normalizedCandidate)) {
    return true;
  }

  const anchorParts = parseSheetNumberParts(anchorValue);
  const candidateParts = parseSheetNumberParts(candidateValue);
  if (!anchorParts || !candidateParts) {
    return false;
  }

  if (
    anchorParts.prefix !== candidateParts.prefix ||
    anchorParts.main !== candidateParts.main
  ) {
    return false;
  }

  return (
    (anchorParts.sub === null || anchorParts.sub === candidateParts.sub) &&
    anchorParts.suffix === candidateParts.suffix &&
    anchorParts.detail === candidateParts.detail
  );
}

function inferStrongPrefixCounts(candidates: Array<PairedSheetCandidate | null>) {
  const counts: Record<string, number> = {};

  for (const candidate of candidates) {
    if (!candidate || candidate.score < 180) {
      continue;
    }

    const parts = parseSheetNumberParts(candidate.sheetNumber);
    if (!parts) {
      continue;
    }

    counts[parts.prefix] = (counts[parts.prefix] ?? 0) + 1;
  }

  return counts;
}

function mergeStrongPrefixCounts(
  ...countsBySource: Array<Record<string, number> | null | undefined>
) {
  const merged: Record<string, number> = {};

  for (const counts of countsBySource) {
    if (!counts) {
      continue;
    }

    for (const [prefix, count] of Object.entries(counts)) {
      if (count <= 0) {
        continue;
      }

      merged[prefix] = Math.max(merged[prefix] ?? 0, count);
    }
  }

  return merged;
}

function inferStrongPrefixCountsFromPdfTextResults(results: Iterable<PdfTextExtractionResult>) {
  const counts: Record<string, number> = {};

  for (const result of results) {
    if (
      !result?.sheetNumber ||
      result.confidence < 0.86 ||
      (result.numberScore ?? -Infinity) < 100
    ) {
      continue;
    }

    const contextualNumber = normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: result.sheetNumber,
      sheetTitle: result.sheetTitle,
      titleSourceText: result.titleSourceText,
    });
    const parts = parseSheetNumberParts(contextualNumber);
    if (!parts) {
      continue;
    }

    const normalizedTitle = normalizeOcrTitleCandidateText(
      `${result.sheetTitle ?? ""} ${result.titleSourceText ?? ""}`
    );
    if (
      (result.titleScore ?? -Infinity) < 72 &&
      countTitleVocabularyHits(normalizedTitle) < 2
    ) {
      continue;
    }

    counts[parts.prefix] = (counts[parts.prefix] ?? 0) + 1;
  }

  return counts;
}

function getPreferredRawBoxAnchorCandidate(
  rawBoxCandidates: MetadataBoxCandidate[],
  fallbackWinner: SheetNumberCandidate | null
) {
  const preferredBox = rawBoxCandidates
    .filter(
      (box) =>
        !box.rejectReason &&
        box.familyId === "bottom_right_strip" &&
        !box.anchorCandidate.isNumericOnly &&
        box.anchorCandidate.score >= 220
    )
    .sort((left, right) => right.anchorCandidate.score - left.anchorCandidate.score)[0];

  if (!preferredBox) {
    return null;
  }

  if (!fallbackWinner) {
    return preferredBox.anchorCandidate;
  }

  const sameNumber =
    normalizeKey(preferredBox.anchorCandidate.value) ===
    normalizeKey(fallbackWinner.value);
  if (sameNumber) {
    return preferredBox.anchorCandidate;
  }

  const fallbackLooksInterior =
    fallbackWinner.normY < 0.55 || fallbackWinner.normX < 0.55;
  const scoreMargin = preferredBox.anchorCandidate.score - fallbackWinner.score;
  if (fallbackLooksInterior && scoreMargin >= 40) {
    return preferredBox.anchorCandidate;
  }

  if (scoreMargin >= 90) {
    return preferredBox.anchorCandidate;
  }

  return null;
}

function buildRawBoxContextText(
  rawBoxCandidates: MetadataBoxCandidate[],
  sheetNumber: string
) {
  const sortedBoxes = rawBoxCandidates
    .filter((box) => {
      if (box.lines.length === 0) {
        return false;
      }

      return (
        box.sourceModel === "compact_stamp" ||
        box.regionId === "sheetStamp" ||
        box.bbox.y >= 0.84 ||
        box.titleLikeCount > 0 ||
        box.titleVocabularyHits > 0 ||
        matchesCompactAnchorNumber(box.anchorCandidate.value, sheetNumber)
      );
    })
    .sort((left, right) => {
      const leftMatchesAnchor = matchesCompactAnchorNumber(
        left.anchorCandidate.value,
        sheetNumber
      )
        ? 1
        : 0;
      const rightMatchesAnchor = matchesCompactAnchorNumber(
        right.anchorCandidate.value,
        sheetNumber
      )
        ? 1
        : 0;
      if (leftMatchesAnchor !== rightMatchesAnchor) {
        return rightMatchesAnchor - leftMatchesAnchor;
      }

      if (left.sourceModel !== right.sourceModel) {
        return left.sourceModel === "compact_stamp" ? -1 : 1;
      }

      if (left.titleVocabularyHits !== right.titleVocabularyHits) {
        return right.titleVocabularyHits - left.titleVocabularyHits;
      }

      if (left.titleLikeCount !== right.titleLikeCount) {
        return right.titleLikeCount - left.titleLikeCount;
      }

      return right.score - left.score;
    });
  const titleBearingBoxes = sortedBoxes.filter(
    (box) => box.titleVocabularyHits > 0 || box.titleLikeCount > 1
  );
  const matchingAnchorBoxes = titleBearingBoxes.filter((box) =>
    matchesCompactAnchorNumber(box.anchorCandidate.value, sheetNumber)
  );
  const filteredBoxes =
    matchingAnchorBoxes.length > 0
      ? matchingAnchorBoxes.slice(0, 2)
      : titleBearingBoxes.slice(0, 1);

  return filteredBoxes
    .flatMap((box) => box.lines.map((line) => normalizeWhitespace(line.text)))
    .filter(Boolean)
    .join(" ");
}

function shouldUseRawBoxContextualOcrTitle(args: {
  candidateTitle: string;
  currentTitle: string;
  currentSourceText?: string | null;
  sheetNumber: string;
}) {
  const candidateTitle = normalizeWhitespace(args.candidateTitle);
  if (!candidateTitle) {
    return false;
  }

  const currentContext = normalizeWhitespace(
    `${args.currentTitle} ${args.currentSourceText ?? ""}`
  );
  if (
    /^A3\.0[1-4]$/i.test(args.sheetNumber) &&
    /\bBUILDING\s+\d+\s*-\s*EXTERIOR\s+ELEVATIONS\b/i.test(candidateTitle) &&
    !/\bBUILDING\s+\d+\b/i.test(currentContext)
  ) {
    return false;
  }

  const currentLooksGenericPlan =
    /\bPLAN\b/i.test(currentContext) &&
    !/\bELEVATIONS?\b/i.test(currentContext) &&
    !/\bRESTROOM\b/i.test(currentContext);
  const candidateLooksElevation =
    /\bELEVATIONS?\b/i.test(candidateTitle) ||
    /\bPLANS?\s*&\s*ELEVATIONS?\b/i.test(candidateTitle);
  if (currentLooksGenericPlan && candidateLooksElevation) {
    return false;
  }

  return true;
}

function shouldPreferStrongOcrPairOverGenericPdfPair(args: {
  pdfTitleText?: string | null;
  pdfSheetNumber?: string | null;
  ocrSheetNumber?: string | null;
  ocrTitleText: string;
  ocrTitleScore: number;
  ocrTitleThreshold: number;
}) {
  const pdfTitleText = normalizeWhitespace(args.pdfTitleText ?? "");
  if (!pdfTitleText || !args.ocrTitleText) {
    return false;
  }

  const genericPdfTitle =
    /^PLANS?\s+AND\s+ELEVATIONS?(?:\s+\d+)?$/i.test(pdfTitleText) ||
    /^DRAWING\s+TITLE\b/i.test(pdfTitleText) ||
    getTextualTitleRejectPenalty(pdfTitleText) <= -120;
  if (!genericPdfTitle) {
    return false;
  }

  const normalizedPdfNumber = normalizeKey(args.pdfSheetNumber ?? "");
  const normalizedOcrNumber = normalizeKey(args.ocrSheetNumber ?? "");
  if (
    !normalizedPdfNumber ||
    !normalizedOcrNumber ||
    normalizedPdfNumber === normalizedOcrNumber
  ) {
    return false;
  }

  return (
    Number.isFinite(args.ocrTitleScore) &&
    args.ocrTitleScore >= args.ocrTitleThreshold + 24 &&
    countTitleVocabularyHits(args.ocrTitleText) >=
      Math.max(3, countTitleVocabularyHits(pdfTitleText) + 2)
  );
}

function shouldEnforceStrongPrefixSupport(strongPrefixCounts: Record<string, number>) {
  return false;
}

function getSequenceConsistencyBoost(
  candidate: PairedSheetCandidate,
  pageNumber: number,
  provisionalSelections: Array<PairedSheetCandidate | null>
) {
  return getSequenceConsistencyBoostBase(
    candidate,
    pageNumber,
    provisionalSelections
  );
}

function extractTitleConsensusTokens(title: string) {
  const words = normalizeWhitespace(title)
    .toUpperCase()
    .match(/[A-Z0-9]+/g) ?? [];
  const filteredWords = words.filter(
    (word) =>
      word.length >= 4 &&
      !/^(BUILDING|SHEET|DRAWING|TITLE|PLAN|LEVEL|AREA)$/.test(word)
  );
  const bigrams: string[] = [];
  for (let index = 0; index < words.length - 1; index += 1) {
    const left = words[index];
    const right = words[index + 1];
    if (!left || !right) continue;
    if (left.length < 3 || right.length < 3) continue;
    bigrams.push(`${left} ${right}`);
  }
  return {
    words: filteredWords,
    bigrams,
  };
}

function getNearbyTitleConsensusBoost(
  candidate: PairedSheetCandidate,
  pageNumber: number,
  provisionalSelections: Array<PairedSheetCandidate | null>
) {
  const nearby = provisionalSelections
    .map((entry, index) => ({ entry, pageNumber: index + 1 }))
    .filter(
      ({ entry, pageNumber: candidatePageNumber }) =>
        Boolean(entry) &&
        Math.abs(candidatePageNumber - pageNumber) <= 4 &&
        candidatePageNumber !== pageNumber &&
        entry?.styleProfile === candidate.styleProfile
    )
    .map(({ entry }) => entry!)
    .slice(0, 8);

  if (nearby.length < 2) {
    return 0;
  }

  const wordCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  for (const neighbor of nearby) {
    const tokens = extractTitleConsensusTokens(neighbor.sheetTitle);
    for (const word of new Set(tokens.words)) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
    for (const bigram of new Set(tokens.bigrams)) {
      bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
    }
  }

  const candidateTokens = extractTitleConsensusTokens(candidate.sheetTitle);
  let boost = 0;

  for (const bigram of new Set(candidateTokens.bigrams)) {
    const count = bigramCounts.get(bigram) ?? 0;
    if (count >= 2) {
      boost += Math.min(count * 6, 18);
    }
  }

  for (const word of new Set(candidateTokens.words)) {
    const count = wordCounts.get(word) ?? 0;
    if (count >= 2) {
      boost += Math.min(count * 3, 9);
    }
  }

  return Math.min(boost, 42);
}

function getGlobalRepeatedTitlePenalty(
  candidate: PairedSheetCandidate,
  provisionalSelections: Array<PairedSheetCandidate | null>,
  pageNumber: number
) {
  const normalizedCandidateTitle = normalizeTitleSelectionText(candidate.sheetTitle);
  if (!normalizedCandidateTitle) {
    return 0;
  }

  const repeatedMatches = provisionalSelections
    .map((entry, index) => ({ entry, pageNumber: index + 1 }))
    .filter(
      ({ entry, pageNumber: candidatePageNumber }) =>
        Boolean(entry) &&
        candidatePageNumber !== pageNumber &&
        entry?.styleProfile === candidate.styleProfile &&
        normalizeTitleSelectionText(entry?.sheetTitle ?? "") === normalizedCandidateTitle
    ).length;

  if (repeatedMatches < 3) {
    return 0;
  }

  const hasDifferentiatingContext =
    /\b(?:building|buildings|north|south|east|west|level|levels|wing|tower|phase|area|zone|block)\b/i.test(
      normalizedCandidateTitle
    ) ||
    /\b\d+[A-Z]?\b/.test(normalizedCandidateTitle);

  const titleVocabularyHits = countTitleVocabularyHits(normalizedCandidateTitle);
  if (hasDifferentiatingContext && titleVocabularyHits >= 2) {
    return 0;
  }

  return -Math.min(18 * repeatedMatches, 72);
}

function getRepeatedLocalMetadataPenalty(
  candidate: PairedSheetCandidate,
  provisionalSelections: Array<PairedSheetCandidate | null>,
  pageNumber: number
) {
  const normalizedSource = normalizeTitleSelectionText(candidate.titleSourceText ?? "");
  if (!normalizedSource) {
    return 0;
  }

  const repeatedSourceMatches = provisionalSelections
    .map((entry, index) => ({ entry, pageNumber: index + 1 }))
    .filter(
      ({ entry, pageNumber: candidatePageNumber }) =>
        Boolean(entry) &&
        candidatePageNumber !== pageNumber &&
        entry?.styleProfile === candidate.styleProfile &&
        entry?.titleRegion === candidate.titleRegion &&
        normalizeTitleSelectionText(entry?.titleSourceText ?? "") === normalizedSource
    ).length;

  if (repeatedSourceMatches < 2) {
    return 0;
  }

  const normalizedTitle = normalizeTitleSelectionText(candidate.sheetTitle);
  const metadataLike =
    isRegulatoryOrScopeNoteText(normalizedSource) ||
    matchesProjectBrandingVocabulary(normalizedSource) ||
    hasRepeatedDateTail(normalizedSource) ||
    countDateLikeFragments(normalizedSource) >= 1 ||
    countTitleVocabularyHits(normalizedTitle) < 2 ||
    candidate.titleCandidateTypeGuess === "drawing_body_noise" ||
    candidate.titleCandidateTypeGuess === "project_name" ||
    candidate.titleCandidateTypeGuess === "company_name";

  if (!metadataLike) {
    return 0;
  }

  return -Math.min(22 * repeatedSourceMatches, 88);
}

function scorePdfPairCandidateWithContext(args: {
  candidate: PairedSheetCandidate;
  styleProfile: MetadataStyleProfile;
  strongPrefixCounts: Record<string, number>;
  provisionalSelections: Array<PairedSheetCandidate | null>;
  pageNumber: number;
}) {
  const scoreTrace = new ScoreTrace().add("base_pair_score", args.candidate.score);
  const parts = parseSheetNumberParts(args.candidate.sheetNumber);
  const structuredPair =
    args.candidate.numberReasonCodes?.includes("structured_field_parse") &&
    args.candidate.titleReasonCodes?.includes("structured_field_parse");

  if (args.styleProfile !== "mixed") {
    const styleScore =
      args.candidate.styleProfile === args.styleProfile
        ? 48
        : args.candidate.styleProfile === "bottom_right_strip"
          ? 10
          : -24;
    scoreTrace.add("document_style_profile_match", styleScore);
  }

  if (args.candidate.familyId === "bottom_right_strip") {
    scoreTrace.add("bottom_right_strip_family", 18);
  }
  if (structuredPair) {
    scoreTrace.add("structured_field_pair", 160);
  }

  if (
    args.candidate.titleCandidateTypeGuess === "drawing_body_noise" ||
    isLikelyBodySentenceTitleRepairCandidate(args.candidate.sheetTitle) ||
    isLikelyContaminatedDrawingBodyTitleSource(
      args.candidate.sheetTitle,
      args.candidate.titleSourceText ?? args.candidate.sheetTitle
    )
  ) {
    scoreTrace.add(
      "drawing_body_noise_title_penalty",
      structuredPair ? -360 : -220
    );
  }

  if (
    args.candidate.titleReasonCodes?.includes("directly_below_sheet_number") &&
    args.candidate.titleCandidateTypeGuess !== "drawing_title" &&
    countTitleVocabularyHits(args.candidate.sheetTitle) === 0
  ) {
    scoreTrace.add("weak_directly_below_title_penalty", -120);
  }

  if (parts) {
    const prefixCount = args.strongPrefixCounts[parts.prefix] ?? 0;
    if (prefixCount >= 2) {
      scoreTrace.add("document_prefix_support", 16);
    } else if (prefixCount === 0) {
      scoreTrace.add("missing_document_prefix_support", -10);
    }
  }

  scoreTrace.add(
    "sequence_consistency",
    getSequenceConsistencyBoost(
      args.candidate,
      args.pageNumber,
      args.provisionalSelections
    )
  );

  scoreTrace.add(
    "nearby_title_consensus",
    getNearbyTitleConsensusBoost(
      args.candidate,
      args.pageNumber,
      args.provisionalSelections
    )
  );

  scoreTrace.add(
    "global_repeated_title_penalty",
    getGlobalRepeatedTitlePenalty(
      args.candidate,
      args.provisionalSelections,
      args.pageNumber
    )
  );

  scoreTrace.add(
    "repeated_local_metadata_penalty",
    getRepeatedLocalMetadataPenalty(
      args.candidate,
      args.provisionalSelections,
      args.pageNumber
    )
  );

  return scoreTrace.snapshot();
}

function getPdfPairDeterministicTieBreakScore(candidate: PairedSheetCandidate) {
  let score = 0;
  const structuredPair =
    candidate.numberReasonCodes?.includes("structured_field_parse") &&
    candidate.titleReasonCodes?.includes("structured_field_parse");

  if (candidate.numberRegion === "sheetStamp") {
    score += 28;
  } else if (candidate.numberRegion === "numberBlock") {
    score += 10;
  }

  if (candidate.titleRegion === "titleTall") {
    score += 20;
  } else if (candidate.titleRegion === "titleBlock") {
    score += 12;
  }

  if (candidate.numberCandidateTypeGuess === "sheet_number") {
    score += 18;
  }
  if (candidate.titleCandidateTypeGuess === "drawing_title") {
    score += 18;
  }
  if (structuredPair) {
    score += 72;
  }

  score += Math.min(Math.max(candidate.titleScore ?? 0, 0), 220) * 0.08;
  score += Math.min(Math.max(candidate.numberScore ?? 0, 0), 220) * 0.05;

  return score;
}

function findImmediateTitleAboveSheetNumber(
  page: PageExtractionModel,
  sheetNumber: string
) {
  const normalizedNumber = normalizeSheetNumberValue(sheetNumber);
  if (!normalizedNumber) {
    return null;
  }

  const numberLineEntry =
    page.lines
      .map((line, lineIndex) => ({ line, lineIndex }))
      .filter(({ line }) => {
        const lineNumber = normalizeSheetNumberValue(line.text);
        return (
          lineNumber === normalizedNumber ||
          extractSheetNumberTokensFromText(line.text).some(
            (token) => normalizeSheetNumberValue(token) === normalizedNumber
          )
        );
      })
      .sort((left, right) => {
        const rightBias = getLineCenterX(right.line) - getLineCenterX(left.line);
        if (Math.abs(rightBias) > 0.02) {
          return rightBias;
        }
        return getLineCenterY(right.line) - getLineCenterY(left.line);
      })[0] ?? null;

  if (!numberLineEntry) {
    return null;
  }

  const numberLine = numberLineEntry.line;
  const numberCenterX = getLineCenterX(numberLine);
  const numberCenterY = getLineCenterY(numberLine);
  const candidates = page.lines
    .map((line, lineIndex) => {
      const titleText = normalizeTitleSelectionText(line.text);
      if (!titleText || line === numberLine) {
        return null;
      }

      const verticalDelta = numberCenterY - getLineCenterY(line);
      const horizontalDelta = Math.abs(numberCenterX - getLineCenterX(line));
      if (verticalDelta <= 0 || verticalDelta > 0.11) {
        return null;
      }
      if (horizontalDelta > 0.14 && line.normX < 0.82 && getLineRight(line) < 0.92) {
        return null;
      }
      if (
        isDateLikeTitleLineText(titleText) ||
        isPyMuPdfTitleNoiseLine(titleText) ||
        NON_TITLE_FIELD_LABEL_PATTERN.test(titleText) ||
        matchesAdministrativeTitleMetadata(titleText) ||
        normalizeSheetNumberValue(titleText) === normalizedNumber ||
        getTextualTitleRejectPenalty(titleText) <= -120
      ) {
        return null;
      }

      const wordCount = countWords(titleText);
      if (wordCount < 1 || wordCount > 8) {
        return null;
      }
      if (/^DETAIL\s+\d+\s*\/?$/i.test(titleText)) {
        return null;
      }
      const hasImmediateTitleSignal =
        countTitleVocabularyHits(titleText) > 0 ||
        matchesTitleLikeVocabulary(titleText) ||
        hasCompactTechnicalTitleSignal(titleText) ||
        isCoverSheetTitleSignal(titleText) ||
        isAllowedSingleWordTitle(titleText);
      if (!hasImmediateTitleSignal) {
        return null;
      }

      const score =
        160 -
        Math.round(verticalDelta * 900) -
        Math.round(horizontalDelta * 160) +
        Math.min(countTitleVocabularyHits(titleText) * 12, 36) +
        (wordCount >= 2 ? 18 : 0) +
        (line.isBold ? 12 : 0);

      return {
        titleText,
        sourceText: normalizeWhitespace(line.text),
        lineIndex,
        score,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => right.score - left.score);

  return candidates[0] ?? null;
}

function cleanDanglingSelectedPairTitle(candidate: PairedSheetCandidate) {
  let cleanedTitle = normalizeWhitespace(
    candidate.sheetTitle.replace(/\s+[-:]\s*$/, "")
  );
  const removedReasonCodes: string[] = [];
  if (cleanedTitle && cleanedTitle !== candidate.sheetTitle) {
    removedReasonCodes.push("removed_dangling_title_separator");
  }

  const prefixCleanedTitle = stripNoisySelectedTitlePrefix(cleanedTitle);
  if (prefixCleanedTitle) {
    cleanedTitle = prefixCleanedTitle;
    removedReasonCodes.push("removed_noisy_title_prefix");
  }

  const areaQuoteCleanedTitle = normalizeWhitespace(
    cleanedTitle.replace(/\bAREA\s+"([A-Z0-9]+)"/gi, "AREA $1")
  );
  if (areaQuoteCleanedTitle && areaQuoteCleanedTitle !== cleanedTitle) {
    cleanedTitle = areaQuoteCleanedTitle;
    removedReasonCodes.push("normalized_area_letter_quotes");
  }

  if (
    !cleanedTitle ||
    cleanedTitle === candidate.sheetTitle ||
    countWords(cleanedTitle) < 1 ||
    removedReasonCodes.length === 0
  ) {
    return candidate;
  }

  return {
    ...candidate,
    sheetTitle: cleanedTitle,
    titleReasonCodes: [
      ...(candidate.titleReasonCodes ?? []),
      ...removedReasonCodes,
    ],
  } satisfies PairedSheetCandidate;
}

function findImmediateLevelPrefixForSelectedTitle(
  page: PageExtractionModel,
  candidate: PairedSheetCandidate
) {
  const title = normalizeWhitespace(candidate.sheetTitle);
  if (
    !title ||
    /\b(?:LEVEL|FLOOR)\s+\d+\b/i.test(title) ||
    !/\b(?:FOUNDATION|FRAMING|FLOOR|CEILING|ROOF|SLAB)\b.*\bPLAN\b/i.test(title)
  ) {
    return null;
  }

  const sourceLead =
    (candidate.titleSourceText ?? title)
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .find(Boolean) ?? title;
  const sourceLeadKey = normalizeComparableSheetTitleText(sourceLead);
  if (!sourceLeadKey) {
    return null;
  }

  const lines = page.searchLines ?? page.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineKey = normalizeComparableSheetTitleText(line.text);
    if (!lineKey || lineKey !== sourceLeadKey) {
      continue;
    }

    for (let prefixIndex = index - 1; prefixIndex >= Math.max(0, index - 3); prefixIndex -= 1) {
      const prefixLine = lines[prefixIndex];
      const prefixText = normalizeWhitespace(prefixLine.text);
      const levelMatch = prefixText.match(
        /^(?:LEVEL\s+\d+|(?:FIRST|SECOND|THIRD|FOURTH)\s+FLOOR)$/i
      );
      if (!levelMatch) {
        continue;
      }

      const verticalGap = Math.max(0, line.normY - prefixLine.normY);
      const horizontalDelta = Math.abs(
        line.normX + line.normWidth / 2 - (prefixLine.normX + prefixLine.normWidth / 2)
      );
      if (verticalGap <= 0.08 && horizontalDelta <= 0.16) {
        return normalizeWhitespace(levelMatch[0].replace(/^LEVEL\b/i, "LEVEL"));
      }
    }
  }

  return null;
}

function cleanSelectedPairTitleWithPageContext(
  page: PageExtractionModel,
  candidate: PairedSheetCandidate
) {
  const cleanedCandidate = cleanDanglingSelectedPairTitle(candidate);
  const levelPrefix = findImmediateLevelPrefixForSelectedTitle(page, cleanedCandidate);
  if (!levelPrefix) {
    return cleanedCandidate;
  }

  const cleanedTitle = normalizeWhitespace(`${levelPrefix} ${cleanedCandidate.sheetTitle}`);
  if (!cleanedTitle || cleanedTitle === cleanedCandidate.sheetTitle) {
    return cleanedCandidate;
  }

  return {
    ...cleanedCandidate,
    sheetTitle: cleanedTitle,
    titleReasonCodes: [
      ...(cleanedCandidate.titleReasonCodes ?? []),
      "prepended_immediate_level_title_prefix",
    ],
  } satisfies PairedSheetCandidate;
}

function rescuePdfPairWithImmediateTitle(
  page: PageExtractionModel,
  candidate: PairedSheetCandidate
) {
  const cleanedCandidate = cleanSelectedPairTitleWithPageContext(page, candidate);
  if (getTextualTitleRejectPenalty(cleanedCandidate.sheetTitle) > -180) {
    return cleanedCandidate;
  }

  const immediateTitle = findImmediateTitleAboveSheetNumber(
    page,
    cleanedCandidate.sheetNumber
  );
  if (!immediateTitle) {
    return cleanedCandidate;
  }

  return cleanSelectedPairTitleWithPageContext(
    page,
    withScoreOverrideBreakdown(
      {
        ...cleanedCandidate,
        sheetTitle: immediateTitle.titleText,
        titleSourceText: immediateTitle.sourceText,
        titleLineIndex: immediateTitle.lineIndex,
        titleScore: Math.max(cleanedCandidate.titleScore ?? 0, immediateTitle.score),
        titleCandidateTypeGuess: "drawing_title",
        titleReasonCodes: [
          ...(cleanedCandidate.titleReasonCodes ?? []),
          "immediate_above_sheet_number_title",
        ],
      },
      Math.max(cleanedCandidate.score, 640),
      "selection_immediate_above_sheet_number_title"
    )
  );
}

function selectBestPdfPairCandidate(args: {
  page: PageExtractionModel;
  candidates: PairedSheetCandidate[];
  styleProfile: MetadataStyleProfile;
  strongPrefixCounts: Record<string, number>;
  provisionalSelections: Array<PairedSheetCandidate | null>;
  pageNumber: number;
}) {
  const candidates =
    args.styleProfile !== "mixed"
      ? args.candidates.filter((candidate) => candidate.styleProfile === args.styleProfile)
      : args.candidates;
  const rescore = (candidate: PairedSheetCandidate) => {
    const contextScoreBreakdown = scorePdfPairCandidateWithContext({
      candidate,
      styleProfile: args.styleProfile,
      strongPrefixCounts: args.strongPrefixCounts,
      provisionalSelections: args.provisionalSelections,
      pageNumber: args.pageNumber,
    });
    return {
      ...candidate,
      score: contextScoreBreakdown.total,
      contextScoreBreakdown,
      tieBreakScore: getPdfPairDeterministicTieBreakScore(candidate),
    };
  };
  const sortByScore = <T extends { score: number; tieBreakScore: number }>(items: T[]) =>
    items.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.01) {
        return b.score - a.score;
      }
      return b.tieBreakScore - a.tieBreakScore;
    });
  const rescored = sortByScore(candidates.map(rescore));
  const allRescored =
    args.styleProfile === "mixed" ? rescored : sortByScore(args.candidates.map(rescore));

  const best = rescored[0] ?? null;
  if (!best) {
    return null;
  }

  const bestTitleRejectPenalty = getTextualTitleRejectPenalty(best.sheetTitle);
  if (
    best.titleCandidateTypeGuess === "drawing_body_noise" ||
    isLikelyBodySentenceTitleRepairCandidate(best.sheetTitle) ||
    isLikelyBodySentenceTitleRepairCandidate(best.titleSourceText ?? best.sheetTitle) ||
    isLikelyContaminatedDrawingBodyTitleSource(
      best.sheetTitle,
      best.titleSourceText ?? best.sheetTitle
    )
  ) {
    const cleanSameNumberTitle = allRescored.find((candidate) => {
      if (candidate === best || candidate.score < best.score - 900) {
        return false;
      }
      if (
        normalizeSheetNumberValue(candidate.sheetNumber) !==
        normalizeSheetNumberValue(best.sheetNumber)
      ) {
        return false;
      }
      if (candidate.titleCandidateTypeGuess !== "drawing_title") {
        return false;
      }
      if (isLikelyBodySentenceTitleRepairCandidate(candidate.sheetTitle)) {
        return false;
      }
      if (getTextualTitleRejectPenalty(candidate.sheetTitle) <= -120) {
        return false;
      }
      return (
        candidate.titleRegion === "titleTall" ||
        candidate.titleRegion === "titleBlock" ||
        candidate.titleReasonCodes?.includes("drawing_title_pattern")
      );
    });

    if (cleanSameNumberTitle) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...cleanSameNumberTitle,
            titleScore: Math.max(cleanSameNumberTitle.titleScore ?? 0, best.titleScore ?? 0),
            titleCandidateTypeGuess: "drawing_title",
            titleReasonCodes: [
              ...(cleanSameNumberTitle.titleReasonCodes ?? []),
              "preferred_same_number_clean_title_over_body_text",
            ],
          },
          Math.max(cleanSameNumberTitle.score, best.score - 12),
          "selection_preferred_same_number_clean_title_over_body_text"
        )
      );
    }
  }

  if (looksLikeGenericProjectOrPackageSheetLabel(best.sheetTitle)) {
    const sameNumberSheetTitle = allRescored.find((candidate) => {
      if (candidate === best || candidate.score < best.score - 650) {
        return false;
      }
      if (
        normalizeSheetNumberValue(candidate.sheetNumber) !==
        normalizeSheetNumberValue(best.sheetNumber)
      ) {
        return false;
      }
      return isCleanAlternativeToProjectLabelTitle(candidate);
    });

    if (sameNumberSheetTitle) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...sameNumberSheetTitle,
            titleScore: Math.max(sameNumberSheetTitle.titleScore ?? 0, best.titleScore ?? 0),
            titleCandidateTypeGuess: "drawing_title",
            titleReasonCodes: [
              ...(sameNumberSheetTitle.titleReasonCodes ?? []),
              "preferred_same_number_over_project_label_title",
            ],
          },
          Math.max(sameNumberSheetTitle.score, best.score - 16),
          "selection_preferred_same_number_over_project_label_title"
        )
      );
    }
  }

  if (isStructuredFieldPairCandidate(best)) {
    const fullerSameNumberTitle = allRescored.find((candidate) => {
      if (candidate === best || isStructuredFieldPairCandidate(candidate)) {
        return false;
      }
      if (candidate.score < best.score - 1100) {
        return false;
      }
      return isFullerSameNumberTitleCandidate(candidate, best);
    });

    if (fullerSameNumberTitle) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...fullerSameNumberTitle,
            titleScore: Math.max(fullerSameNumberTitle.titleScore ?? 0, best.titleScore ?? 0),
            titleCandidateTypeGuess: "drawing_title",
            titleReasonCodes: [
              ...(fullerSameNumberTitle.titleReasonCodes ?? []),
              "preferred_fuller_same_number_title",
            ],
          },
          Math.max(fullerSameNumberTitle.score, best.score - 12),
          "selection_preferred_fuller_same_number_title"
        )
      );
    }

    if (hasContaminatedStructuredTitleSignal(best.sheetTitle)) {
      const cleanerSameNumberTitle = allRescored.find((candidate) => {
        if (candidate === best || candidate.score < best.score - 1250) {
          return false;
        }
        return isCleanerSameNumberTitleCandidate(candidate, best);
      });

      if (cleanerSameNumberTitle) {
        return rescuePdfPairWithImmediateTitle(
          args.page,
          withScoreOverrideBreakdown(
            {
              ...cleanerSameNumberTitle,
              titleScore: Math.max(cleanerSameNumberTitle.titleScore ?? 0, best.titleScore ?? 0),
              titleCandidateTypeGuess: "drawing_title",
              titleReasonCodes: [
                ...(cleanerSameNumberTitle.titleReasonCodes ?? []),
                "preferred_cleaner_same_number_title",
              ],
            },
            Math.max(cleanerSameNumberTitle.score, best.score - 18),
            "selection_preferred_cleaner_same_number_title"
          )
        );
      }
    }
  }

  if (
    best.numberReasonCodes?.includes("compact_number_over_title_anchor") &&
    !best.numberReasonCodes?.includes("bottom_right_anchor")
  ) {
    const anchoredAlternative = allRescored.find((candidate) => {
      if (candidate === best) {
        return false;
      }
      if (candidate.numberRegion !== "sheetStamp" && candidate.numberRegion !== "stripNumber") {
        return false;
      }
      if (getTextualTitleRejectPenalty(candidate.sheetTitle) <= -180) {
        return false;
      }

      const bestTitle = normalizeComparableSheetTitleText(best.sheetTitle);
      const candidateTitle = normalizeComparableSheetTitleText(candidate.sheetTitle);
      const titlesCompatible =
        Boolean(bestTitle && candidateTitle) &&
        (
          bestTitle === candidateTitle ||
          bestTitle.includes(candidateTitle) ||
          candidateTitle.includes(bestTitle)
        );

      return (
        (titlesCompatible ||
          candidate.titleCandidateTypeGuess === "drawing_title" ||
          candidate.numberRegion === "sheetStamp" ||
          candidate.numberRegion === "stripNumber") &&
        candidate.score >= best.score - 650
      );
    });

    if (anchoredAlternative) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...anchoredAlternative,
            titleScore: Math.max(anchoredAlternative.titleScore ?? 0, 72),
            titleReasonCodes: [
              ...(anchoredAlternative.titleReasonCodes ?? []),
              "preferred_bottom_right_sheet_stamp_number",
            ],
          },
          Math.max(anchoredAlternative.score, 640),
          "selection_preferred_bottom_right_sheet_stamp_number"
        )
      );
    }
  }

  if (best.familyId !== "bottom_right_strip" && bestTitleRejectPenalty <= -500) {
    const sameNumberStrip = allRescored.find(
      (candidate) =>
        candidate.familyId === "bottom_right_strip" &&
        normalizeSheetNumberValue(candidate.sheetNumber) ===
          normalizeSheetNumberValue(best.sheetNumber) &&
        getTextualTitleRejectPenalty(candidate.sheetTitle) > -120 &&
        countWords(candidate.sheetTitle) >= 2 &&
        candidate.score >= best.score - 220
    );
    if (sameNumberStrip) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...sameNumberStrip,
            titleScore: Math.max(sameNumberStrip.titleScore ?? 0, 72),
            titleCandidateTypeGuess:
              sameNumberStrip.titleCandidateTypeGuess === "drawing_body_noise"
                ? "drawing_title"
                : sameNumberStrip.titleCandidateTypeGuess,
            titleReasonCodes: [
              ...(sameNumberStrip.titleReasonCodes ?? []),
              "preferred_same_number_strip_title",
            ],
          },
          Math.max(sameNumberStrip.score, 640),
          "selection_preferred_same_number_strip_title"
        )
      );
    }
  }

  if (
    best.familyId !== "bottom_right_strip" &&
    rescored.some(
      (candidate) =>
        candidate.familyId === "bottom_right_strip" && candidate.score >= best.score - 16
    )
  ) {
    return rescuePdfPairWithImmediateTitle(
      args.page,
      rescored.find(
        (candidate) =>
          candidate.familyId === "bottom_right_strip" && candidate.score >= best.score - 16
      ) ?? best
    );
  }

  if (
    best.titleCandidateTypeGuess === "revision" ||
    /\b(?:ADDENDUM|REVISION|REVISIONS?|NO\s+DESCRIPTION)\b/i.test(best.sheetTitle) ||
    /(?:\b(?:stantec|kp|proj(?:ect)?|job)\b|treanor)/i.test(best.numberSourceText) ||
    hasContaminatedStructuredTitleSignal(best.sheetTitle)
  ) {
    const compactStampAlternative = allRescored.find((candidate) => {
      if (candidate === best || candidate.score < best.score - 260) {
        return false;
      }
      return Boolean(
        candidate.numberReasonCodes?.includes("compact_number_over_title_anchor") &&
          candidate.titleReasonCodes?.includes("directly_below_sheet_number") &&
          (
            /\bNO\s+DESCRIPTION\b/i.test(best.sheetTitle) ||
            isTrustworthyCompactNumberOverTitleText(candidate.sheetTitle) ||
            (
              countWords(candidate.sheetTitle) >= 2 &&
              countWords(candidate.sheetTitle) <= 10 &&
              getTextualTitleRejectPenalty(candidate.sheetTitle) > -140
            )
          ) &&
          candidate.titleCandidateTypeGuess !== "revision"
      );
    });

    if (compactStampAlternative) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...compactStampAlternative,
            titleScore: Math.max(compactStampAlternative.titleScore ?? 0, 72),
            titleCandidateTypeGuess:
              compactStampAlternative.titleCandidateTypeGuess === "drawing_body_noise"
                ? "drawing_title"
                : compactStampAlternative.titleCandidateTypeGuess,
            titleReasonCodes: [
              ...(compactStampAlternative.titleReasonCodes ?? []),
              "preferred_compact_stamp_over_revision_title",
            ],
          },
          Math.max(compactStampAlternative.score, best.score - 12),
          "selection_preferred_compact_stamp_over_revision_title"
        )
      );
    }
  }

  if (
    countWords(best.sheetTitle) > 8 ||
    getTextualTitleRejectPenalty(best.sheetTitle) <= -120 ||
    isRegulatoryOrScopeNoteText(best.titleSourceText ?? best.sheetTitle)
  ) {
    const compactSameNumberTitle = allRescored.find((candidate) => {
      if (candidate === best || candidate.score < best.score - 220) {
        return false;
      }
      if (
        normalizeSheetNumberValue(candidate.sheetNumber) !==
        normalizeSheetNumberValue(best.sheetNumber)
      ) {
        return false;
      }
      return Boolean(
        candidate.numberReasonCodes?.includes("compact_number_over_title_anchor") &&
          candidate.titleReasonCodes?.includes("directly_below_sheet_number") &&
          countWords(candidate.sheetTitle) <= 5 &&
          (
            isAllowedSingleWordTitle(candidate.sheetTitle) ||
            countTitleVocabularyHits(candidate.sheetTitle) > 0 ||
            hasCompactTechnicalTitleSignal(candidate.sheetTitle)
          ) &&
          getTextualTitleRejectPenalty(candidate.sheetTitle) > -120
      );
    });

    if (compactSameNumberTitle) {
      return rescuePdfPairWithImmediateTitle(
        args.page,
        withScoreOverrideBreakdown(
          {
            ...compactSameNumberTitle,
            titleScore: Math.max(compactSameNumberTitle.titleScore ?? 0, 72),
            titleCandidateTypeGuess:
              compactSameNumberTitle.titleCandidateTypeGuess === "drawing_body_noise"
                ? "drawing_title"
                : compactSameNumberTitle.titleCandidateTypeGuess,
            titleReasonCodes: [
              ...(compactSameNumberTitle.titleReasonCodes ?? []),
              "preferred_compact_same_number_over_long_title",
            ],
          },
          Math.max(compactSameNumberTitle.score, best.score - 12),
          "selection_preferred_compact_same_number_over_long_title"
        )
      );
    }
  }

  return rescuePdfPairWithImmediateTitle(args.page, best);
}

async function buildPageExtractionModels(
  fileBytes: Uint8Array,
  debugSession?: PlanSheetImportDebugSession,
  options?: {
    pageNumbers?: number[] | null;
    disableSparseOcrFallback?: boolean;
    onProgress?: (progress: PlanSheetImportProgress) => void | Promise<void>;
  }
) {
  const overallTimer = debugSession?.startTimer("pdf.extract_models");
  try {
    const extractTimer = debugSession?.startTimer("pdf.pymupdf.extract_words");
    const extracted = await extractPdfWordsWithPyMuPdf(fileBytes, {
      pageNumbers: options?.pageNumbers ?? null,
      onPageExtracted: (progress) =>
        options?.onProgress?.({
          stage: "pdf_page_extracted",
          pageNumber: progress.pageNumber,
          processedPageCount: progress.processedPageCount,
          selectedPageCount: progress.selectedPageCount,
          sourcePageCount: progress.sourcePageCount,
        }),
    });
    extractTimer?.end({
      pageCount: extracted.pages.length,
      totalPageCount: extracted.totalPageCount,
      extractedPageNumbers: extracted.pages.map((page) => page.pageNumber),
    });
    const sparsePdfPages = extracted.pages
      .filter((page) => !hasUsablePdfMetadataText(page))
      .map((page) => ({
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
      }));
    const sparsePageFallbackLines = await extractSparsePdfPagesWithOcr(
      fileBytes,
      sparsePdfPages,
      debugSession
    );

    const pages = extracted.pages.map((page) => {
      const pageTimer = debugSession?.startTimer("pdf.page.extract", {
        pageNumber: page.pageNumber,
      });
      const buildLinesTimer = debugSession?.startTimer("pdf.page.build_lines", {
        pageNumber: page.pageNumber,
      });
      let effectiveWidth = page.width;
      for (const word of page.words) {
        effectiveWidth = Math.max(effectiveWidth, word.x0, word.x1);
      }
      for (const segment of page.drawingSegments ?? []) {
        effectiveWidth = Math.max(effectiveWidth, segment.x0, segment.x1);
      }
      let effectiveHeight = page.height;
      for (const word of page.words) {
        effectiveHeight = Math.max(effectiveHeight, word.y0, word.y1);
      }
      for (const segment of page.drawingSegments ?? []) {
        effectiveHeight = Math.max(effectiveHeight, segment.y0, segment.y1);
      }
      const normalizationWidth = Math.max(page.width, 1);
      const normalizationHeight = Math.max(page.height, 1);
      const sparseFallback = sparsePageFallbackLines.get(page.pageNumber) ?? null;
      const items = page.words.map((word) => ({
        text: word.text,
        x: word.x0,
        top: word.y0,
        width: Math.max(word.x1 - word.x0, 0.0001),
        height: Math.max(word.y1 - word.y0, 0.0001),
        normX: word.x0 / normalizationWidth,
        normY: word.y0 / normalizationHeight,
        normWidth: Math.max(word.x1 - word.x0, 0.0001) / normalizationWidth,
        normHeight: Math.max(word.y1 - word.y0, 0.0001) / normalizationHeight,
        blockId: Number.isFinite(word.block ?? NaN) ? word.block : null,
        lineId: Number.isFinite(word.line ?? NaN) ? word.line : null,
        wordId: Number.isFinite(word.word ?? NaN) ? word.word : null,
        fontSize: Number.isFinite(word.fontSize ?? NaN) ? (word.fontSize ?? null) : null,
        fontName: word.fontName ?? null,
        fontFlags: Number.isFinite(word.fontFlags ?? NaN) ? (word.fontFlags ?? null) : null,
        isBold: Boolean(word.isBold),
      }));
      const searchItems = (page.searchWords ?? page.words).map((word) => ({
        text: word.text,
        x: word.x0,
        top: word.y0,
        width: Math.max(word.x1 - word.x0, 0.0001),
        height: Math.max(word.y1 - word.y0, 0.0001),
        normX: word.x0 / normalizationWidth,
        normY: word.y0 / normalizationHeight,
        normWidth: Math.max(word.x1 - word.x0, 0.0001) / normalizationWidth,
        normHeight: Math.max(word.y1 - word.y0, 0.0001) / normalizationHeight,
        blockId: Number.isFinite(word.block ?? NaN) ? word.block : null,
        lineId: Number.isFinite(word.line ?? NaN) ? word.line : null,
        wordId: Number.isFinite(word.word ?? NaN) ? word.word : null,
        fontSize: Number.isFinite(word.fontSize ?? NaN) ? (word.fontSize ?? null) : null,
        fontName: word.fontName ?? null,
        fontFlags: Number.isFinite(word.fontFlags ?? NaN) ? (word.fontFlags ?? null) : null,
        isBold: Boolean(word.isBold),
      }));
      const lines =
        sparseFallback?.lines.length
          ? sparseFallback.lines
          : buildTextLinesFromPositionedItems(items);
      const searchLines =
        sparseFallback?.searchLines.length
          ? sparseFallback.searchLines
          : mergeUniqueTextLines(
              buildTextLinesFromPositionedItems(searchItems),
              buildRotatedMetadataBlockOrderTextLines(searchItems)
            );
      buildLinesTimer?.end({
        pageNumber: page.pageNumber,
        lineCount: lines.length,
        searchLineCount: searchLines.length,
        usedSparseOcrFallback: Boolean(sparseFallback?.searchLines.length),
      });
      const candidates = extractSheetNumberCandidates(lines);
      const drawingSegments = [
        ...(page.drawingSegments ?? []).map((segment) => ({
          x0: segment.x0,
          y0: segment.y0,
          x1: segment.x1,
          y1: segment.y1,
          normX0: segment.x0 / normalizationWidth,
          normY0: segment.y0 / normalizationHeight,
          normX1: segment.x1 / normalizationWidth,
          normY1: segment.y1 / normalizationHeight,
          width: Number.isFinite(segment.width ?? NaN) ? (segment.width ?? null) : null,
        })),
        ...(sparseFallback?.drawingSegments ?? []),
      ];
      const ocrNumberBox = sparseFallback?.ocrNumberBox ?? null;
      const ocrTitleBox = sparseFallback?.ocrTitleBox ?? null;
      pageTimer?.end({
        pageNumber: page.pageNumber,
        lineCount: lines.length,
        candidateCount: candidates.length,
      });

        return {
          pageNumber: page.pageNumber,
          lines,
          searchLines,
          sheetIndexLines: page.sheetIndexLines,
          candidates,
          drawingSegments,
          ocrNumberBox,
          ocrTitleBox,
          ocrBacked: Boolean(sparseFallback?.searchLines.length),
        } satisfies PageExtractionModel;
      });

    return {
      pageCount: extracted.totalPageCount,
      pages,
    };
  } finally {
    overallTimer?.end();
  }
}

function isSuspiciousDetectedTitle(title: string) {
  const normalized = normalizeComparableSheetTitleText(title);
  if (!normalized) return true;
  if (isReferenceOnlyTitleText(normalized)) {
    return true;
  }
  if (
    matchesAdministrativeTitleMetadata(normalized) ||
    matchesReviewReferenceMetadata(normalized) ||
    matchesVendorReferencePageMetadata(normalized) ||
    /(?:^|\b)(?:sheet\s*#|drawing\s*#)(?:\s|$)/i.test(normalized)
  ) {
    return true;
  }
  if (isStrongStructuredRecoveredOcrTitle(title)) {
    return false;
  }
  const titleVocabularyHits = countTitleVocabularyHits(normalized);
  const digitCount = normalized.match(/\d/g)?.length ?? 0;
  const letterCount = normalized.match(/[A-Za-z]/g)?.length ?? 0;
  if (countWords(normalized) > 8 && titleVocabularyHits < 2) return true;
  if (countWords(normalized) > 14) return true;
  if (
    titleVocabularyHits === 0 &&
    /\d{3,}/.test(normalized) &&
    /["'\[\]{}]/.test(normalized)
  ) {
    return true;
  }
  if (
    titleVocabularyHits === 0 &&
    digitCount >= Math.max(letterCount, 6) &&
    !isAllowedSingleWordTitle(normalized)
  ) {
    return true;
  }
  if (matchesProjectBrandingVocabulary(normalized)) return true;
  if (getTitleRejectPenalty(normalized, {
    text: normalized,
    items: [],
    x: 0,
    top: 0,
    width: Math.max(normalized.length * 8, 1),
    height: 10,
    normX: 0,
    normY: 0,
    normWidth: 0,
    normHeight: 0,
  }) <= -40) {
    return true;
  }

  return false;
}

function normalizeSheetNumberValue(value: string) {
  return normalizeSheetNumberValueBase(value);
}

function normalizeTiWrappedSheetNumberValue(value: string) {
  const core = normalizeSheetNumberValue(stripDocumentSheetIndexWrapperPrefix(value));
  return core ? `TI-${core}` : "";
}

function isPlausibleOcrSheetNumberResult(result: PdfTextExtractionResult) {
  if (!result?.sheetNumber) {
    return false;
  }

  const normalizedNumber = normalizeSheetNumberValue(result.sheetNumber);
  const normalizedSource = normalizeWhitespace(result.numberSourceText ?? "");

  if (!EXTENDED_SHEET_NUMBER_VALUE_PATTERN.test(normalizedNumber)) {
    return false;
  }

  if (!normalizedSource) {
    return false;
  }

  const sourceTokenLine = normalizeWhitespace(
    normalizedSource.toUpperCase().replace(/[^A-Z0-9.\-\s]/g, " ")
  );
  const sourceTokens = sourceTokenLine.split(/\s+/).filter(Boolean);
  const isolatedCandidate =
    normalizeKey(normalizedSource) === normalizeKey(normalizedNumber) ||
    sourceTokens.includes(normalizeKey(normalizedNumber));

  if (!isolatedCandidate && countWords(normalizedSource) >= 3) {
    return false;
  }

  if (!isolatedCandidate && normalizedSource.length > 24) {
    return false;
  }

  if (
    matchesProjectBrandingVocabulary(normalizedSource) ||
    /\b(with|because|this|that|are|is|you|designed|kitchen|bedroom|bath|farmhouses?|options?|required|width|code)\b/i.test(
      normalizedSource
    )
  ) {
    return false;
  }

  return true;
}

function createTitleScoreLine(text: string): TextLine {
  return {
    text,
    items: [],
    x: 0,
    top: 0,
    width: Math.max(text.length * 8, 1),
    height: 10,
    normX: 0,
    normY: 0,
    normWidth: 0,
    normHeight: 0,
  };
}

function isPlausibleOcrSheetTitleResult(
  result: PdfTextExtractionResult,
  repeatedTitleCount: number
) {
  if (!result?.sheetTitle) {
    return false;
  }

  const normalizedTitle = normalizeWhitespace(result.sheetTitle);
  if (!normalizedTitle) {
    return false;
  }

  if (
    repeatedTitleCount >= 4 &&
    !/\bfoodservice\b/i.test(normalizedTitle)
  ) {
    return false;
  }

  if (
    repeatedTitleCount >= 3 &&
    countTitleVocabularyHits(normalizedTitle) < 2 &&
    !/\bfoodservice\b/i.test(normalizedTitle)
  ) {
    return false;
  }

  if (matchesProjectBrandingVocabulary(normalizedTitle)) {
    return false;
  }

  if (
    result.titleSourceText &&
    matchesProjectBrandingVocabulary(result.titleSourceText)
  ) {
    const recoveredTitleLooksUsable =
      !isSuspiciousDetectedTitle(normalizedTitle) &&
      isUsableRecoveredOcrTitle(normalizedTitle);
    if (!recoveredTitleLooksUsable) {
      return false;
    }
  }

  return !isSuspiciousDetectedTitle(normalizedTitle);
}

type TitleSelectionArgs = {
  title: string;
  sourceKind: "pdf_text" | "ocr";
  sourceText?: string | null;
  repeatedTitleCount?: number;
  pageNumber?: number;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
};

function stripLeadingTitleAdministrativeMetadata(text: string) {
  let result = normalizeWhitespace(text);
  if (!result) {
    return "";
  }

  for (let index = 0; index < 6; index += 1) {
    const next = normalizeWhitespace(
      result
        .replace(
          /^(?:PROJ(?:ECT)?\.?\s*(?:#|NO\.?|NUMBER)|PROJECT\s+ID)\s*:?\s*[A-Z0-9._/-]+\s*/i,
          ""
        )
        .replace(/^(?:JOB\s*(?:#|NO\.?|NUMBER))\s*:?\s*[A-Z0-9._/-]+\s*/i, "")
        .replace(
          /^(?:P\.?M\.?|PROJECT\s+MANAGER)\s*:?\s*[A-Z]{1,6}(?:\s*\/\s*[A-Z]{1,6}){0,4}\s*/i,
          ""
        )
        .replace(
          /^(?:DRAWN\s+BY|DRWN\s+BY|DRAFTED\s+BY|CHECK(?:ED)?\s+BY|CHECKER)\s*:?\s*[A-Z]{1,6}(?:\s*\/\s*[A-Z]{1,6}){0,4}\s*/i,
          ""
        )
        .replace(
          /^(?:BID\s+REVIEW|PERMIT\s+REVIEW|CONSTRUCTION\s+DOCUMENTS?|ISSUED\s+FOR\s+(?:BID|PERMIT|CONSTRUCTION|REVIEW)|NOT\s+FOR\s+CONSTRUCTION)\s+(?=\S)/i,
          ""
        )
        .replace(/^[\s:;.,\-–—~_=+*|\\/]+/, "")
    );

    if (next === result) {
      return result;
    }
    result = next;
    if (!result) {
      return "";
    }
  }

  return result;
}

function normalizeTitleSelectionText(text: string) {
  const baseNormalized = stripLeadingTitleAdministrativeMetadata(
    normalizeWhitespace(
    normalizeEmbeddedSheetPathTitleSource(text)
      .toUpperCase()
      .replace(/\bPALN\b/g, "PLAN")
      .replace(/\bELECTRIC\s+(?=PLAN|PLANS|NOTES?|SCHEDULES?|DETAILS?|LEGEND)\b/g, "ELECTRICAL ")
      .replace(/[â€“â€”]/g, "-")
      .replace(/\s*&\s*/g, " AND ")
      .replace(/\(\s*(NORTH|SOUTH|EAST|WEST)\s*\)/g, "$1")
      .replace(/\s*-\s*/g, " - ")
      .replace(/\s*,\s*/g, ", ")
    )
  );
  const preservesBuildingSuffix =
    /\b(?:BLDG|BUILDING)\s+[A-Z](?:\d{1,2})?(?:\s+(?:NORTH|SOUTH|EAST|WEST))?$/i.test(
      baseNormalized
    ) ||
    /\b(?:BLDG|BUILDING)\s+\d{1,2}[A-Z]?(?:\s+(?:NORTH|SOUTH|EAST|WEST))?$/i.test(
      baseNormalized
    );
  const preservesSemanticTitleSuffix =
    /\b(?:LEVEL|FLOOR|SHEET|PART|PHASE|AREA|ZONE|DETAIL|DETAILS|DIAGRAM|DIAGRAMS|PLAN|PLANS)\s+(?:\d{1,3}[A-Z]?|[A-Z])(?:\s+OF\s+\d{1,3})?$/i.test(
      baseNormalized
    ) ||
    /\b(?:LEVEL|FLOOR)\s*0?\d{1,2}\s*-\s*PART\s+[A-Z]$/i.test(baseNormalized);
  const normalized = baseNormalized
    .replace(
      /^(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?),?\s+\d{4}\s+(?=\S)/i,
      ""
    )
    .replace(/^\d+\s+(?=[A-Za-z])/, "")
    .replace(/^[\s:;.,\-–—~_=+*|\\\/]+/, "")
    .replace(
      preservesBuildingSuffix || preservesSemanticTitleSuffix
        ? /$^/
        : /\s+(?:(?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS)\s*$/i,
      ""
    )
    .replace(/\b[A-Z][a-z]+,\s*[A-Z]{2}\s+\d{5}\b.*$/i, "")
    .replace(/^(?:EXIT\s+)?STAIRS,\s+(GENERAL\s+INFORMATION)$/i, "$1")
    .replace(/\s+CASE\s*#\s*[A-Z0-9-]+\b.*$/i, "")
    .replace(/\s+SHEET:\s*$/i, "")
    .replace(/\s+\d+\s+\d+\s+\d+\s+\d+\s*$/i, "")
    .replace(
      /\s+(?:[A-Z]\s+)?ADDENDUM\s+\d+\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b.*$/i,
      ""
    )
    .replace(/\s+APPL\s*#\s*[A-Z0-9-]+\b.*$/i, "")
    .replace(/\s+\d{6,}\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return canonicalizeSheetIndexTitle(normalizeBuildingSuffixConnectors(normalized));
}

function normalizeBuildingSuffixConnectors(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }

  return normalizeWhitespace(
    normalized.replace(
      /\b(BUILDINGS?)\s+((?:[A-Z]|\d{1,2})(?:\s+(?:[A-Z]|\d{1,2}))+)(?=(?:\s+(?:NORTH|SOUTH|EAST|WEST))?\b|$)/gi,
      (_match, label: string, group: string) => {
        const parts = normalizeWhitespace(group).split(/\s+/).filter(Boolean);
        if (parts.length <= 1) {
          return `${label} ${group}`;
        }
        return `${label} ${parts.join(" AND ")}`;
      }
    )
  );
}

function normalizeDocumentStyleTitleFragment(text: string) {
  const normalized =
    sanitizePdfTitleSelectionLine(text) || normalizeTitleSelectionText(text);
  return normalizeWhitespace(normalized);
}

function createEmptyDocumentTitleStyleProfile(): DocumentTitleStyleProfile {
  return {
    frequentLineCounts: {},
    frequentPairCounts: {},
    frequentStructuredSuffixCounts: {},
    structureCounts: {},
  };
}

function extractStructuralTitleTagsFromLines(lines: string[]) {
  const normalizedLines = lines
    .map((line) => normalizeDocumentStyleTitleFragment(line))
    .filter(Boolean);
  const tags = new Set<string>();

  if (normalizedLines.length >= 2) {
    tags.add("multiline");
  }
  if (normalizedLines.length >= 3) {
    tags.add("three_plus_lines");
  }
  if (normalizedLines.some((line) => /-\s*$/.test(line))) {
    tags.add("hyphen_break");
  }
  if (normalizedLines.some((line) => isStructuredBuildingSuffixText(line))) {
    tags.add("building_suffix");
  }
  if (
    normalizedLines.some((line) =>
      /^(?:AND\s+)?[A-Z](?:\s+AND\s+[A-Z]|\s*&\s*[A-Z])*$/i.test(line)
    )
  ) {
    tags.add("short_letter_suffix");
  }
  if (
    normalizedLines.some((line) =>
      /\b(?:NORTH|SOUTH|EAST|WEST)\b/i.test(line)
    )
  ) {
    tags.add("direction_suffix");
  }
  if (
    normalizedLines.some((line) =>
      /\b(?:PLAN|PLANS|RCP|ELEVATIONS?|DETAILS?|SECTIONS?|SCHEDULES?|NOTES?|LEGEND|FORMS|COMPLIANCE)\b/i.test(
        line
      )
    )
  ) {
    tags.add("explicit_title_family");
  }
  if (
    normalizedLines.length >= 2 &&
    normalizedLines.some((line) => isStructuredBuildingSuffixText(line))
  ) {
    tags.add("multiline_with_building_suffix");
  }
  if (
    normalizedLines.length >= 2 &&
    normalizedLines.some((line) => /-\s*$/.test(line)) &&
    normalizedLines.some((line) => isStructuredBuildingSuffixText(line))
  ) {
    tags.add("hyphen_then_building_suffix");
  }

  return tags;
}

function extractStructuralTitleTags(text: string) {
  return extractStructuralTitleTagsFromLines(
    (text ?? "")
      .split(/\r?\n/)
      .map((line) => normalizeDocumentStyleTitleFragment(line))
      .filter(Boolean)
  );
}

function getDocumentStructureSupport(
  profile: DocumentTitleStyleProfile | null | undefined,
  tag: string
) {
  if (!profile) {
    return 0;
  }

  return profile.structureCounts[tag] ?? 0;
}

function getDocumentStructuralTitleScore(args: {
  profile: DocumentTitleStyleProfile | null | undefined;
  candidateTitle: string;
  sourceText?: string | null;
}) {
  if (!args.profile || !args.sourceText) {
    return 0;
  }

  const sourceTags = extractStructuralTitleTags(args.sourceText);
  const candidateTags = extractStructuralTitleTags(args.candidateTitle);
  if (sourceTags.size === 0) {
    return 0;
  }

  let score = 0;

  const sourceHasBuildingSuffix = sourceTags.has("building_suffix");
  const sourceHasShortLetterSuffix = sourceTags.has("short_letter_suffix");
  const sourceHasDirectionSuffix = sourceTags.has("direction_suffix");
  const sourceHasHyphenThenSuffix = sourceTags.has("hyphen_then_building_suffix");

  if (
    sourceHasBuildingSuffix &&
    getDocumentStructureSupport(args.profile, "multiline_with_building_suffix") >= 3
  ) {
    score += candidateTags.has("building_suffix") ? 42 : -84;
  }

  if (
    sourceHasShortLetterSuffix &&
    getDocumentStructureSupport(args.profile, "short_letter_suffix") >= 2
  ) {
    const keepsShortLetterSuffix =
      candidateTags.has("short_letter_suffix") ||
      /\bBUILDINGS?\s+[A-Z0-9]+\s+AND\s+[A-Z0-9]+\b/i.test(args.candidateTitle);
    score += keepsShortLetterSuffix ? 34 : -72;
  }

  if (
    sourceHasDirectionSuffix &&
    getDocumentStructureSupport(args.profile, "direction_suffix") >= 2
  ) {
    score += candidateTags.has("direction_suffix") ? 24 : -44;
  }

  if (
    sourceHasHyphenThenSuffix &&
    getDocumentStructureSupport(args.profile, "hyphen_then_building_suffix") >= 2
  ) {
    const keepsHyphenatedSuffix =
      /\b-\s+BUILDINGS?\b/i.test(args.candidateTitle) ||
      /\b-\s+BUILDING\b/i.test(args.candidateTitle);
    score += keepsHyphenatedSuffix ? 24 : -38;
  }

  return score;
}

function buildDocumentTitleStyleProfile(
  pages: readonly PageExtractionModel[]
): DocumentTitleStyleProfile {
  if (!PLAN_SHEET_IMPORT_ENABLE_DOCUMENT_STYLE_PREPASS) {
    return createEmptyDocumentTitleStyleProfile();
  }

  const titleBlockRegion = getMetadataRegionById("titleBlock");
  const titleTallRegion = getMetadataRegionById("titleTall");
  if (!titleBlockRegion || !titleTallRegion) {
    return createEmptyDocumentTitleStyleProfile();
  }

  const frequentLineCounts: Record<string, number> = {};
  const frequentPairCounts: Record<string, number> = {};
  const frequentStructuredSuffixCounts: Record<string, number> = {};
  const structureCounts: Record<string, number> = {};

  for (const page of pages) {
    const seenLineKeys = new Set<string>();
    const seenPairKeys = new Set<string>();
    const seenSuffixKeys = new Set<string>();

    for (const region of [titleBlockRegion, titleTallRegion]) {
      const regionPage = buildPageRegionModel(page, region);
      if (!regionPage || regionPage.lines.length === 0) {
        continue;
      }

      const localTitleLines = regionPage.lines
        .map((line) => ({
          line,
          text: normalizeDocumentStyleTitleFragment(line.text),
        }))
        .filter((entry) => Boolean(entry.text))
        .filter((entry) => !isPyMuPdfTitleNoiseLine(entry.text))
        .filter((entry) => !isPureMarkerTitleText(entry.text))
        .filter((entry) => !isGeometricSymbolLabel(entry.text))
        .filter((entry) => !/^\d+$/.test(entry.text))
        .filter(
          (entry) =>
            isCompactTitle24SheetTitleSignal(entry.text) ||
            isStructuredBuildingSuffixText(entry.text) ||
            hasExplicitTitleFamily(entry.text) ||
            countTitleVocabularyHits(entry.text) >= 1
        );

      const structureTags = extractStructuralTitleTagsFromLines(
        localTitleLines.map((entry) => entry.text)
      );
      for (const tag of structureTags) {
        structureCounts[tag] = (structureCounts[tag] ?? 0) + 1;
      }

      for (const entry of localTitleLines) {
        const key = normalizeKey(entry.text);
        if (!key || seenLineKeys.has(key)) {
          continue;
        }
        seenLineKeys.add(key);
        frequentLineCounts[key] = (frequentLineCounts[key] ?? 0) + 1;

        if (isStructuredBuildingSuffixText(entry.text) && !seenSuffixKeys.has(key)) {
          seenSuffixKeys.add(key);
          frequentStructuredSuffixCounts[key] =
            (frequentStructuredSuffixCounts[key] ?? 0) + 1;
        }
      }

      for (let index = 0; index < localTitleLines.length - 1; index += 1) {
        const current = localTitleLines[index];
        const next = localTitleLines[index + 1];
        if (!current || !next) {
          continue;
        }

        const pairKey = `${normalizeKey(current.text)}>>${normalizeKey(next.text)}`;
        if (!pairKey || seenPairKeys.has(pairKey)) {
          continue;
        }
        seenPairKeys.add(pairKey);
        frequentPairCounts[pairKey] = (frequentPairCounts[pairKey] ?? 0) + 1;
      }
    }
  }

  return {
    frequentLineCounts,
    frequentPairCounts,
    frequentStructuredSuffixCounts,
    structureCounts,
  };
}

function getDocumentStyleTitleLineSupport(
  profile: DocumentTitleStyleProfile | null | undefined,
  text: string
) {
  if (!profile) {
    return 0;
  }

  const key = normalizeKey(normalizeDocumentStyleTitleFragment(text));
  if (!key) {
    return 0;
  }

  return profile.frequentLineCounts[key] ?? 0;
}

function getDocumentStyleTitlePairSupport(
  profile: DocumentTitleStyleProfile | null | undefined,
  currentText: string,
  nextText: string
) {
  if (!profile) {
    return 0;
  }

  const currentKey = normalizeKey(normalizeDocumentStyleTitleFragment(currentText));
  const nextKey = normalizeKey(normalizeDocumentStyleTitleFragment(nextText));
  if (!currentKey || !nextKey) {
    return 0;
  }

  return profile.frequentPairCounts[`${currentKey}>>${nextKey}`] ?? 0;
}

function getDocumentStyleTitleCandidateBoost(args: {
  profile: DocumentTitleStyleProfile | null | undefined;
  keptLines: string[];
  titleText: string;
}) {
  if (!args.profile || args.keptLines.length === 0) {
    return 0;
  }

  let boost = 0;
  let matchedLineCount = 0;

  for (const line of args.keptLines) {
    const lineSupport = getDocumentStyleTitleLineSupport(args.profile, line);
    if (lineSupport >= 2) {
      matchedLineCount += 1;
      boost += Math.min(24, 6 + lineSupport * 2);
    }

    if (
      isStructuredBuildingSuffixText(line) &&
      lineSupport >= 2
    ) {
      boost += Math.min(18, lineSupport * 4);
    }
  }

  for (let index = 0; index < args.keptLines.length - 1; index += 1) {
    const pairSupport = getDocumentStyleTitlePairSupport(
      args.profile,
      args.keptLines[index] ?? "",
      args.keptLines[index + 1] ?? ""
    );
    if (pairSupport >= 2) {
      boost += Math.min(28, 8 + pairSupport * 4);
    }
  }

  if (
    matchedLineCount >= 2 &&
    /\bBUILDINGS?\b/i.test(args.titleText)
  ) {
    boost += 10;
  }

  return boost;
}

function isStructuredBuildingSuffixText(text: string) {
  const normalized = normalizeWhitespace(text)
    .replace(/\s*&\s*/g, " AND ")
    .replace(/\(\s*(NORTH|SOUTH|EAST|WEST)\s*\)/gi, "$1");

  return (
    /\bBUILDINGS?\s+(?:[A-Z]|\d{1,2})(?:\s+(?:AND\s+)?(?:[A-Z]|\d{1,2}))*(?:\s+(?:NORTH|SOUTH|EAST|WEST))?$/i.test(
      normalized
    ) ||
    /^(?:NORTH|SOUTH|EAST|WEST)$/i.test(normalized)
  );
}

function isCoverSheetTitleSignal(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  const wordCount = countWords(normalized);
  if (wordCount > 7) {
    return false;
  }
  if (isRegulatoryOrScopeNoteText(normalized) || isObviousTechnicalNoteSentence(normalized)) {
    return false;
  }
  return (
    /\bcover(?:\s+sheet)?\b/i.test(normalized) ||
    /\btitle\s+sheet\b/i.test(normalized) ||
    /\bdrawing\s+index\b/i.test(normalized) ||
    /\bindex\b/i.test(normalized) ||
    /\bsymbols?\b/i.test(normalized) ||
    /\babbreviations?\b/i.test(normalized)
  );
}

function isTitle24FamilyTitleSignal(text: string) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return false;
  }
  const wordCount = countWords(normalized);
  if (wordCount > 8) {
    return false;
  }
  if (isRegulatoryOrScopeNoteText(normalized) || isObviousTechnicalNoteSentence(normalized)) {
    return false;
  }

  return (
    isCompactTitle24SheetTitleSignal(normalized) ||
    /^(?:title\s*24(?:\s*-\s*lt[io])?\s+(?:forms?|compliance|documentation))$/i.test(
      normalized
    ) ||
    /^(?:forms?|compliance|documentation)$/i.test(normalized)
  );
}

function normalizeOcrTitleSelectionLine(text: string) {
  return normalizeTitleSelectionText(normalizeOcrTitleCandidateText(text));
}

function isGenericAuxiliaryOcrTitle(text: string) {
  return /^(?:building\s+)?key plan$/i.test(normalizeWhitespace(text));
}

function isGenericShortOcrTitleHeading(text: string) {
  return /^(?:GENERAL NOTES|NOTES|SCHEDULES?|DETAILS?|LEGENDS?|PLAN|FLOOR PLAN|ROOF PLAN|SECTIONS?|ELEVATIONS?)$/i.test(
    normalizeWhitespace(text)
  );
}

function looksLikeOcrTitleContinuation(text: string, currentText: string) {
  const normalized = normalizeWhitespace(text);
  const current = normalizeWhitespace(currentText);
  if (!normalized) {
    return false;
  }

  if (/-\s*$/.test(current)) {
    return true;
  }

  return (
    /^&\s*[A-Z]{1,2}$/i.test(normalized) ||
    /\b(building|buildings|north|south|east|west|level|levels|wing|tower|pod|block|area|phase|package|classroom|library|science|admin|lobby)\b/i.test(
      normalized
    ) ||
    /^(?:plan|plans|floor plan|roof plan|ceiling plan|reflected ceiling plan|cover sheet|sheet index|renovation plan|exit analysis|details?|elevations?|sections?)\b/i.test(
      normalized
    ) ||
    (countTitleVocabularyHits(current) === 0 &&
      matchesTitleLikeVocabulary(normalized))
  );
}

function isRedundantOcrTitleContinuation(currentText: string, nextText: string) {
  const current = normalizeWhitespace(currentText.replace(/\s*-\s*$/, ""));
  const next = normalizeWhitespace(nextText.replace(/\s*-\s*$/, ""));
  const currentKey = normalizeKey(current);
  const nextKey = normalizeKey(next);

  if (!currentKey || !nextKey) {
    return false;
  }

  if (
    /^floor plan$/i.test(next) &&
    /\b(?:construction|demolition)\s*$/i.test(current)
  ) {
    return false;
  }

  if (
    /^rcp$/i.test(next) &&
    /\b(?:rcp|construction)\b/i.test(current)
  ) {
    return false;
  }

  if (currentKey.includes(nextKey) || nextKey.includes(currentKey)) {
    return true;
  }

  if (
    /\bsheet$/i.test(next) &&
    /\bsheet\b/i.test(current) &&
    countTitleVocabularyHits(next) <= 1
  ) {
    return true;
  }

  return false;
}

type PdfTitleLineRole =
  | "metadata"
  | "title_prefix"
  | "title_seed"
  | "building_suffix"
  | "continuation_suffix"
  | "noise";

function classifyPdfTitleLineRole(
  text: string,
  options?: {
    previousText?: string | null;
    nextText?: string | null;
  }
): PdfTitleLineRole {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "noise";
  }

  if (isPyMuPdfTitleNoiseLine(normalized) || isPureMarkerTitleText(normalized)) {
    return "metadata";
  }

  if (
    isStructuredBuildingSuffixText(normalized) ||
    /^(?:AND|&)\s+[A-Z0-9]+(?:\s+(?:AND|&)\s+[A-Z0-9]+)*$/i.test(normalized) ||
    (
      /^[A-Z]$/i.test(normalized) &&
      /\bBUILDINGS?\s*$/i.test(normalizeWhitespace(options?.previousText ?? "")) 
    )
  ) {
    return "building_suffix";
  }

  if (
    /^(?:AND|&)\b/i.test(normalized) ||
    /^\(?\s*(?:NORTH|SOUTH|EAST|WEST)\s*\)?$/i.test(normalized)
  ) {
    return "continuation_suffix";
  }

  if (
    isCompactTitle24SheetTitleSignal(normalized) ||
    isCoverSheetTitleSignal(normalized) ||
    hasExplicitTitleFamily(normalized) ||
    countTitleVocabularyHits(normalized) >= 2
  ) {
    return "title_seed";
  }

  const nextNormalized = normalizeWhitespace(options?.nextText ?? "");
  const nextLooksLikeSeed =
    Boolean(nextNormalized) &&
    (
      hasExplicitTitleFamily(nextNormalized) ||
      countTitleVocabularyHits(nextNormalized) >= 2 ||
      /-\s*$/.test(nextNormalized)
    );
  const wordCount = countWords(normalized);

  if (
    !isObviousTechnicalNoteSentence(normalized) &&
    wordCount >= 1 &&
    wordCount <= 5 &&
    !/\b(?:MIN|MAX|TYP|CLR|SIM)\b/i.test(normalized) &&
    !/\d/.test(normalized) &&
    (
      countTitleVocabularyHits(normalized) >= 1 ||
      (
        /^[A-Z&/().,\-\s]+$/.test(normalized) &&
        /\b[A-Z]{4,}\b/.test(normalized)
      )
    ) &&
    nextLooksLikeSeed
  ) {
    return "title_prefix";
  }

  return "noise";
}

function extractMeaningfulRoleWords(text: string, role: PdfTitleLineRole) {
  const normalized = normalizeTitleSelectionText(text);
  if (!normalized) {
    return [] as string[];
  }

  const words =
    normalized.match(/[A-Z0-9]+/g)?.filter(Boolean) ?? [];

  if (role === "building_suffix" || role === "continuation_suffix") {
    return words.filter(
      (word) =>
        word === "BUILDING" ||
        word === "BUILDINGS" ||
        word === "AND" ||
        /^(?:NORTH|SOUTH|EAST|WEST)$/.test(word) ||
        /^[A-Z]$/.test(word) ||
        /^\d{1,2}$/.test(word)
    );
  }

  return words.filter(
    (word) =>
      word.length > 1 &&
      !/^(?:AND|THE|OF|AT|TO|IN|ON|FOR|A|AN)$/.test(word)
  );
}

function getPdfSourceRoleCoverageScore(
  sourceText: string | null | undefined,
  candidateTitle: string
) {
  const sourceLines = (sourceText ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  if (sourceLines.length === 0) {
    return 0;
  }

  const normalizedCandidate = normalizeTitleSelectionText(candidateTitle);
  if (!normalizedCandidate) {
    return 0;
  }

  let score = 0;

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index] ?? "";
    const role = classifyPdfTitleLineRole(line, {
      previousText: sourceLines[index - 1] ?? null,
      nextText: sourceLines[index + 1] ?? null,
    });

    if (role === "metadata" || role === "noise") {
      continue;
    }

    const roleWords = extractMeaningfulRoleWords(line, role);
    if (roleWords.length === 0) {
      continue;
    }

    const coveredCount = roleWords.filter((word) =>
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        normalizedCandidate
      )
    ).length;
    const coverageRatio = coveredCount / roleWords.length;

    if (role === "building_suffix" || role === "continuation_suffix") {
      if (coverageRatio >= 1) {
        score += 26;
      } else if (coverageRatio >= 0.5) {
        score -= 18;
      } else {
        score -= 72;
      }
      continue;
    }

    if (role === "title_prefix") {
      if (coverageRatio >= 1) {
        score += 22;
      } else if (coverageRatio >= 0.5) {
        score -= 18;
      } else {
        score -= 82;
      }
      continue;
    }

    if (role === "title_seed") {
      if (coverageRatio >= 0.75) {
        score += 12;
      } else if (coverageRatio < 0.4) {
        score -= 24;
      }
    }
  }

  return score;
}

function getPdfLeadRoleRetentionScore(
  sourceText: string | null | undefined,
  candidateTitle: string
) {
  const sourceLines = (sourceText ?? "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  if (sourceLines.length === 0) {
    return 0;
  }

  const normalizedCandidate = normalizeTitleSelectionText(candidateTitle);
  if (!normalizedCandidate) {
    return 0;
  }

  let score = 0;
  let retainedLeadCount = 0;

  for (let index = 0; index < sourceLines.length && retainedLeadCount < 3; index += 1) {
    const line = sourceLines[index] ?? "";
    const role = classifyPdfTitleLineRole(line, {
      previousText: sourceLines[index - 1] ?? null,
      nextText: sourceLines[index + 1] ?? null,
    });

    if (role === "metadata" || role === "noise") {
      continue;
    }

    const roleWords = extractMeaningfulRoleWords(line, role);
    if (roleWords.length === 0) {
      continue;
    }

    retainedLeadCount += 1;
    const coveredCount = roleWords.filter((word) =>
      new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        normalizedCandidate
      )
    ).length;
    const coverageRatio = coveredCount / roleWords.length;
    const strongLead =
      hasExplicitTitleFamily(line) ||
      countTitleVocabularyHits(line) >= 1 ||
      isCompactTitle24SheetTitleSignal(line) ||
      isCoverSheetTitleSignal(line);
    const weight =
      retainedLeadCount === 1 ? 36 : retainedLeadCount === 2 ? 24 : 16;

    if (coverageRatio >= 1) {
      score += weight;
    } else if (coverageRatio >= 0.5) {
      score += Math.round(weight * 0.35);
    } else if (strongLead) {
      score -= weight + 12;
    } else {
      score -= Math.round(weight * 0.5);
    }
  }

  return score;
}

function extractImportantOcrTitleModifiers(text: string) {
  return (
    normalizeWhitespace(text).match(
      /\b(interior|exterior|fire|alarm|hvac|mechanical|electrical|plumbing|structural|demolition|demo|existing|removal|construction|legend|legends|note|notes|detail|details|schedule|schedules|door|hardware|window|glazing|restroom|accessibility|foundation|framing|enlarged|site|ramp|parking|exit|analysis|reflected|renovation|building|buildings|north|south|east|west|level|levels|grading|drainage|project|data|abbreviations|floor|plan)\b/gi
    ) ?? []
  ).map((value) => value.toLowerCase());
}

function getOcrTitleModifierCoverageScore(
  candidateText: string,
  sourceText?: string | null
) {
  const candidateModifiers = new Set(
    extractImportantOcrTitleModifiers(candidateText)
  );
  if (candidateModifiers.size === 0) {
    return 0;
  }

  const sourceModifiers = [
    ...new Set(extractImportantOcrTitleModifiers(sourceText ?? "")),
  ];
  if (sourceModifiers.length === 0) {
    return 0;
  }

  let score = 0;
  for (const modifier of sourceModifiers) {
    if (candidateModifiers.has(modifier)) {
      score +=
        modifier === "north" ||
        modifier === "south" ||
        modifier === "east" ||
        modifier === "west"
          ? 10
          : 8;
    }
  }

  return Math.min(score, 40);
}

function countRetainedOcrTitleModifiers(
  candidateText: string,
  sourceText?: string | null
) {
  const candidateModifiers = new Set(
    extractImportantOcrTitleModifiers(candidateText)
  );
  if (candidateModifiers.size === 0) {
    return 0;
  }

  const sourceModifiers = new Set(
    extractImportantOcrTitleModifiers(sourceText ?? "")
  );
  if (sourceModifiers.size === 0) {
    return 0;
  }

  let retained = 0;
  for (const modifier of sourceModifiers) {
    if (candidateModifiers.has(modifier)) {
      retained += 1;
    }
  }

  return retained;
}

function mergeOcrTitleSelectionParts(parts: string[]) {
  let combined = "";

  for (const part of parts) {
    const normalizedPart = normalizeWhitespace(part);
    if (!normalizedPart) continue;

    if (!combined) {
      combined = normalizedPart;
      continue;
    }

    if (
      isRedundantOcrTitleContinuation(combined, normalizedPart) &&
      !(/^[A-Z]$/i.test(normalizedPart) && /\bPART\s*$/i.test(combined))
    ) {
      continue;
    }

    const currentHasTrailingHyphen = /-\s*$/.test(combined);
    const currentBase = normalizeWhitespace(combined.replace(/\s*-\s*$/, ""));
    const currentWords = currentBase.split(/\s+/).filter(Boolean);
    const nextWords = normalizedPart.split(/\s+/).filter(Boolean);
    const maxOverlap = Math.min(3, currentWords.length, nextWords.length);
    let overlap = 0;

    for (let size = maxOverlap; size >= 1; size -= 1) {
      if (
        normalizeKey(currentWords.slice(-size).join(" ")) ===
        normalizeKey(nextWords.slice(0, size).join(" "))
      ) {
        overlap = size;
        break;
      }
    }

    const continuation = normalizeWhitespace(nextWords.slice(overlap).join(" "));
    if (!continuation) {
      continue;
    }

    const continuationLooksLikeLocation =
      /^(?:building|buildings|north|south|east|west|level|levels|wing|tower|pod|block|area|phase)\b/i.test(
        normalizedPart
      );
    const continuationIsDirectionOnly =
      /^(?:north|south|east|west)$/i.test(normalizedPart);
    const currentHasBuildingLocation =
      /\bbuilding\b/i.test(currentBase) ||
      /\b(?:north|south|east|west|level|levels|wing|tower|pod|block|area|phase)\b/i.test(
        currentBase
      );
    const separator =
      continuationIsDirectionOnly && currentHasBuildingLocation
        ? " "
        : currentHasTrailingHyphen ||
      (continuationLooksLikeLocation && countTitleVocabularyHits(currentBase) > 0)
        ? " - "
        : " ";
    combined = normalizeWhitespace(`${currentBase}${separator}${continuation}`);
  }

  return combined;
}

function getCanonicalTitleBoost(text: string) {
  const normalized = normalizeWhitespace(text);

  if (/^cover page$/i.test(normalized)) return 110;
  if (/^project info$/i.test(normalized)) return 96;
  if (/^general notes$/i.test(normalized)) return 96;
  if (/^schedules?$/i.test(normalized)) return 104;
  if (/^typical details$/i.test(normalized)) return 104;
  if (/^exterior details\s*&\s*options$/i.test(normalized)) return 110;
  if (/^(front|rear) elevations?$/i.test(normalized)) return 80;
  if (/^section views?$/i.test(normalized)) return 80;
  if (/^(downstairs|upstairs) plans?$/i.test(normalized)) return 64;
  if (
    /^title 24 - lt[io] forms(?:\s+building\s+[A-Z](?:\s*&\s*[A-Z])*)?$/i.test(
      normalized
    )
  ) {
    return 96;
  }

  return 0;
}

function sanitizePdfTitleSelectionLine(text: string) {
  return normalizeTitleSelectionText(text);
}

function collectTitleSelectionCandidates(args: TitleSelectionArgs) {
  const candidates = new Set<string>();
  const addCandidate = (value: string) => {
    const normalized = normalizeTitleSelectionText(value);
    if (normalized) {
      candidates.add(normalized);
    }
  };

  addCandidate(args.title);

  const lines =
    args.sourceKind === "ocr"
      ? (args.sourceText ?? "")
          .split(/\r?\n/)
          .map(normalizeOcrTitleSelectionLine)
          .filter((line) => Boolean(line) && !isGenericAuxiliaryOcrTitle(line))
      : (args.sourceText ?? "")
          .split(/\r?\n/)
          .map(normalizeTitleSelectionText)
          .filter(Boolean);

  for (const line of lines) {
    addCandidate(line);
  }

  if (args.sourceKind === "ocr") {
    const maxStart = Math.min(lines.length, 8);
    for (let start = 0; start < maxStart; start += 1) {
      const parts: string[] = [];

      for (let end = start; end < Math.min(lines.length, start + 4); end += 1) {
        const line = lines[end];
        if (!line) continue;

        const currentText = mergeOcrTitleSelectionParts(parts);
        if (
          parts.length > 0 &&
          !looksLikeOcrTitleContinuation(line, currentText)
        ) {
          break;
        }

        parts.push(line);
        addCandidate(mergeOcrTitleSelectionParts(parts));
      }
    }

    if (candidates.size === 0) {
      addCandidate(normalizeOcrTitleSelectionLine(args.title));
    }
  } else {
  }

  return [...candidates];
}

function scorePreliminaryTitleSelectionCandidate(candidate: string) {
  const normalized = normalizeWhitespace(candidate);
  if (!normalized) {
    return -Infinity;
  }

  let score = 0;
  const wordCount = countWords(normalized);
  score += Math.min(countTitleVocabularyHits(normalized) * 10, 40);
  if (matchesTitleLikeVocabulary(normalized)) {
    score += 22;
  }
  if (wordCount >= 2 && wordCount <= 8) {
    score += 18;
  } else if (wordCount === 1 && isAllowedSingleWordTitle(normalized)) {
    score += 4;
  } else if (wordCount > 12) {
    score -= 24;
  }
  if (hasRepeatedDateTail(normalized)) {
    score -= 200;
  } else if (countDateLikeFragments(normalized) >= 1) {
    score -= 80;
  }
  if (guessTitleCandidateType(normalized, normalized) === "drawing_title") {
    score += 18;
  }
  if (guessTitleCandidateType(normalized, normalized) === "drawing_body_noise") {
    score -= 18;
  }
  if (isSuspiciousDetectedTitle(normalized)) {
    score -= 40;
  }

  return score;
}

function scoreTitleSelectionCandidate(args: TitleSelectionArgs) {
  const normalizedTitle = normalizeWhitespace(args.title);
  if (!normalizedTitle) {
    return -Infinity;
  }

  const wordCount = countWords(normalizedTitle);
  const strongStructuredTitle = isStrongStructuredRecoveredOcrTitle(normalizedTitle);
  const candidateTypeGuess = guessTitleCandidateType(
    normalizedTitle,
    args.sourceText ?? normalizedTitle
  );
  const dateFragmentCount = countDateLikeFragments(normalizedTitle);
  let score = 0;

  score += getTitleRejectPenalty(
    normalizedTitle,
    createTitleScoreLine(normalizedTitle)
  );

  if (matchesTitleLikeVocabulary(normalizedTitle)) {
    score += 36;
  }

  score += Math.min(countTitleVocabularyHits(normalizedTitle) * 8, 24);

  score += getCanonicalTitleBoost(normalizedTitle);

  if (wordCount >= 1 && wordCount <= 5) {
    score += 24;
  } else if (wordCount <= 8) {
    score += 10;
  } else if (strongStructuredTitle) {
    score += 8;
  } else {
    score -= 40;
  }

  if (normalizedTitle.length >= 6 && normalizedTitle.length <= 70) {
    score += 16;
  } else if (normalizedTitle.length > 90) {
    score -= 24;
  }

  if (countWords(normalizedTitle) === 1 && !isAllowedSingleWordTitle(normalizedTitle)) {
    score -= 80;
  }

  if (/^\d+\s+/.test(normalizedTitle)) {
    score -= 52;
  }

  if (/-\s*$/.test(normalizedTitle)) {
    score -= 86;
  }

  if (/\b(?:AND|OR|WITH|FOR|OF|TO)\s*$/.test(normalizedTitle)) {
    score -= 64;
  }

  if (
    /\bschedules?\b/i.test(normalizedTitle) &&
    /\bdetails?\b/i.test(normalizedTitle) &&
    !/\b(?:and|&)\b/i.test(normalizedTitle)
  ) {
    score -= 72;
  }

  if (
    /\b(using these drawings|fictional conditions|attribution|project history|credits|designed with|all rights reserved)\b/i.test(
      normalizedTitle
    )
  ) {
    score -= 150;
  }

  if (/\b(notes?\s*&\s*additional resources|city\s*\/\s*state\s*\/\s*zip)\b/i.test(normalizedTitle)) {
    score -= 36;
  }

  if (
    /\bproject site at all times\b/i.test(normalizedTitle) ||
    /\bapproved plans shall be available\b/i.test(normalizedTitle) ||
    /\bsubject to field inspection\b/i.test(normalizedTitle) ||
    /\bapproval of this plan does not authorize\b/i.test(normalizedTitle)
  ) {
    score -= 260;
  }

  if (isRegulatoryOrScopeNoteText(normalizedTitle)) {
    score -= 220;
  }

  if (hasRepeatedDateTail(normalizedTitle)) {
    score -= 380;
  } else if (dateFragmentCount >= 1) {
    score -= 140;
  }

  if (args.sourceText) {
    const normalizedSource = normalizeWhitespace(args.sourceText);
    const sourceDateFragmentCount = countDateLikeFragments(normalizedSource);
    if (
      /\b(using these drawings|fictional conditions|attribution|project history|credits|designed with|all rights reserved)\b/i.test(
        normalizedSource
      )
    ) {
      score -= 120;
    }
    if (isRegulatoryOrScopeNoteText(normalizedSource)) {
      score -= 180;
    }
    if (hasRepeatedDateTail(normalizedSource)) {
      if (hasRepeatedDateTail(normalizedTitle)) {
        score -= 160;
      } else {
        score += 28;
      }
    } else if (sourceDateFragmentCount >= 1 && dateFragmentCount === 0) {
      score += 10;
    }
  }

  score += getDocumentStructuralTitleScore({
    profile: args.documentTitleStyleProfile,
    candidateTitle: normalizedTitle,
    sourceText: args.sourceText,
  });
  score += getPdfSourceRoleCoverageScore(args.sourceText, normalizedTitle);
  score += getPdfLeadRoleRetentionScore(args.sourceText, normalizedTitle);

  if (args.sourceKind === "ocr") {
    const repeatCount = args.repeatedTitleCount ?? 0;
    const repeatedConsultantTitle = Boolean(
      /\bfoodservice\b/i.test(normalizedTitle) ||
        /\b(?:standard details?|utility schedule|equipment (?:plan|schedule|views?)|foodservice elevations?|electrical plan|plumbing plan|exhaust hood detail)\b/i.test(
          normalizedTitle
        )
    );
    const hasExplicitSheetTitleLabel = Boolean(
      args.sourceText && /\bsheet\s+titl?e\b/i.test(args.sourceText)
    );
    if (repeatCount >= 4) {
      score -= repeatedConsultantTitle ? (hasExplicitSheetTitleLabel ? 8 : 28) : 220;
    } else if (repeatCount === 3) {
      score -= repeatedConsultantTitle ? (hasExplicitSheetTitleLabel ? 4 : 16) : 220;
    } else if (repeatCount === 2) {
      score -= repeatedConsultantTitle ? (hasExplicitSheetTitleLabel ? 2 : 8) : 60;
    }
  }

  if (
    /\b(building|buildings|north|south|east|west|level|levels|wing|tower|block|area|phase|renovation|analysis|grading|drainage|project|data|abbreviations)\b/i.test(
      normalizedTitle
    )
  ) {
    score += args.sourceKind === "ocr" ? 18 : 14;
  }

  if (hasCompactTechnicalTitleSignal(normalizedTitle)) {
    score += args.sourceKind === "ocr" ? 20 : 28;
  }

  if (
    args.sourceKind === "pdf_text" &&
    (
      isTitle24FamilyTitleSignal(normalizedTitle) ||
      isTitle24FamilyTitleSignal(args.sourceText ?? "") ||
      (
        isCompactTitle24SheetTitleSignal(args.sourceText ?? "") &&
        /^(?:forms?|compliance|documentation)$/i.test(normalizedTitle)
      )
    )
  ) {
    score += 52;
  }

  if (
    args.sourceKind === "pdf_text" &&
    args.pageNumber === 1 &&
    (
      isCoverSheetTitleSignal(normalizedTitle) ||
      isCoverSheetTitleSignal(args.sourceText ?? "")
    )
  ) {
    score += 54;
  }

  if (strongStructuredTitle) {
    score += args.sourceKind === "ocr" ? 36 : 16;
  }

  const modifierCoverage = getOcrTitleModifierCoverageScore(
    normalizedTitle,
    args.sourceText
  );
  score += args.sourceKind === "ocr" ? modifierCoverage : Math.round(modifierCoverage * 0.75);
  const sourceModifiers = [
    ...new Set(extractImportantOcrTitleModifiers(args.sourceText ?? "")),
  ];
  const repeatedStructuralPhrases = [
    "floor plan",
    "site plan",
    "elevations",
    "details",
    "schedules",
  ]
    .map((phrase) => ({
      phrase,
      sourceCount: (normalizeWhitespace(args.sourceText ?? "").match(
        new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi")
      ) ?? []).length,
      candidateCount: (normalizedTitle.match(
        new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "gi")
      ) ?? []).length,
    }))
    .filter((entry) => entry.sourceCount >= 2);
  const retainedModifiers = countRetainedOcrTitleModifiers(
    normalizedTitle,
    args.sourceText
  );
  const missingModifierCount = Math.max(
    sourceModifiers.length - retainedModifiers,
    0
  );
  if (sourceModifiers.length >= 2 && missingModifierCount > 0) {
    score -= Math.min(
      missingModifierCount * (args.sourceKind === "ocr" ? 18 : 24),
      args.sourceKind === "ocr" ? 54 : 96
    );
    if (isGenericShortOcrTitleHeading(normalizedTitle)) {
      score -= Math.min(
        missingModifierCount * (args.sourceKind === "ocr" ? 24 : 28),
        args.sourceKind === "ocr" ? 72 : 112
      );
    }
  }

  if (args.sourceKind === "pdf_text" && sourceModifiers.length >= 3) {
    if (retainedModifiers === sourceModifiers.length) {
      score += 28;
    } else if (retainedModifiers >= sourceModifiers.length - 1) {
      score += 10;
    } else if (missingModifierCount >= 2) {
      score -= Math.min(missingModifierCount * 26, 130);
    }
  }

  if (args.sourceKind === "pdf_text" && repeatedStructuralPhrases.length > 0) {
    for (const phrase of repeatedStructuralPhrases) {
      if (phrase.candidateCount >= phrase.sourceCount) {
        score += Math.min(phrase.sourceCount * 14, 28);
      } else {
        score -= Math.min((phrase.sourceCount - phrase.candidateCount) * 22, 44);
      }
    }
  }

  if (isSuspiciousDetectedTitle(normalizedTitle)) {
    score -= 80;
  }

  if (candidateTypeGuess === "drawing_title") {
    score += 20;
  } else if (candidateTypeGuess === "project_name") {
    score -= 90;
  } else if (candidateTypeGuess === "company_name") {
    score -= 180;
  } else if (candidateTypeGuess === "address_or_contact") {
    score -= 220;
  } else if (candidateTypeGuess === "revision") {
    score -= 180;
  } else if (candidateTypeGuess === "scale") {
    score -= 220;
  } else if (candidateTypeGuess === "title_label") {
    score -= 240;
  } else if (candidateTypeGuess === "sheet_reference") {
    score -= 160;
  } else if (candidateTypeGuess === "drawing_body_noise") {
    score -= 60;
  }

  if (
    args.sourceKind === "pdf_text" &&
    candidateTypeGuess === "drawing_title" &&
    countTitleVocabularyHits(normalizedTitle) === 0
  ) {
    const sourceLines = (args.sourceText ?? "")
      .split(/\r?\n/)
      .map(normalizeTitleSelectionText)
      .filter(Boolean);
    if (
      sourceLines.length >= 1 &&
      sourceLines.length <= 3 &&
      sourceLines.every((line) => guessTitleCandidateType(line, line) === "drawing_title")
    ) {
      score += 22;
    }
  }

  if (args.sourceKind === "pdf_text" && args.sourceText) {
    const sourceLines = args.sourceText
      .split(/\r?\n/)
      .map(normalizeTitleSelectionText)
      .filter(Boolean);
    const compactSourceStack =
      sourceLines.length >= 2 &&
      sourceLines.length <= 4 &&
      sourceLines.every(
        (line) =>
          guessTitleCandidateType(line, line) === "drawing_title" ||
          isDisciplineHeadingFragment(line) ||
          isCompactStampContinuationFragment(line) ||
          hasExplicitTitleFamily(line) ||
          /\b(?:bldg|building)\b/i.test(line)
      );
    if (compactSourceStack) {
      const retainedLineCount = sourceLines.filter((line) =>
        normalizeKey(normalizedTitle).includes(normalizeKey(line))
      ).length;
      if (retainedLineCount === sourceLines.length) {
        score += 72;
      } else if (retainedLineCount >= sourceLines.length - 1) {
        score += 28;
      } else if (sourceLines.length >= 3) {
        score -= (sourceLines.length - retainedLineCount) * 18;
      }
    }
  }

  return score;
}

function evaluateTitleSelection(args: TitleSelectionArgs) {
  const candidates = collectTitleSelectionCandidates(args);
  const shortlistedCandidates =
    args.sourceKind === "pdf_text" && candidates.length > 8
      ? [...candidates]
          .sort(
            (left, right) =>
              scorePreliminaryTitleSelectionCandidate(right) -
              scorePreliminaryTitleSelectionCandidate(left)
          )
          .slice(0, 8)
      : candidates;
  let best: {
    text: string;
    score: number;
    modifierCoverage: number;
    retainedModifiers: number;
  } | null = null;

  for (const candidate of shortlistedCandidates) {
    const score = scoreTitleSelectionCandidate({
      ...args,
      title: candidate,
    });
    const modifierCoverage = getOcrTitleModifierCoverageScore(
      candidate,
      args.sourceText
    );
    const retainedModifiers = countRetainedOcrTitleModifiers(
      candidate,
      args.sourceText
    );

    const shouldReplace =
      !best ||
      score > best.score ||
      (
        score >= best.score - (args.sourceKind === "pdf_text" ? 36 : 18) &&
        (
          retainedModifiers >= best.retainedModifiers + 1 ||
          modifierCoverage >= best.modifierCoverage + 8 ||
          (
            retainedModifiers === best.retainedModifiers &&
            modifierCoverage === best.modifierCoverage &&
            candidate.length > best.text.length + 6
          )
        )
      );

    if (shouldReplace) {
      best = {
        text: candidate,
        score,
        modifierCoverage,
        retainedModifiers,
      };
    }
  }

  return best ? { text: best.text, score: best.score } : null;
}

function extractReferencedSheetTitlesFromLine(lineText: string) {
  const normalizedLine = normalizeWhitespace(lineText);
  if (!normalizedLine) {
    return [];
  }

  if (
    /\.pdf\s*\(\d+% of scale\)/i.test(normalizedLine) ||
    /\btakeoff in active area\b/i.test(normalizedLine) ||
    /\bgeorge pm database\b/i.test(normalizedLine)
  ) {
    return [];
  }

  const numberMatches = [
    ...normalizedLine.matchAll(
      /\b(((?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS))\b/g
    ),
  ];
  if (numberMatches.length === 0) {
    return [];
  }

  const results: Array<{ sheetNumber: string; sheetTitle: string }> = [];

  for (let index = 0; index < numberMatches.length; index += 1) {
    const match = numberMatches[index];
    const leadingText = normalizeWhitespace(
      normalizedLine
        .slice(0, match.index ?? 0)
        .replace(/[:;,\-–—|]+$/g, "")
    );
    if (
      leadingText &&
      !/^(?:\d+|sheet\s+index|sheet\s+list|index|no\.?|description|sheet|drawing\s+list)$/i.test(
        leadingText
      )
    ) {
      continue;
    }

    const sheetNumber = normalizeSheetNumberValue(match[1] ?? "");
    if (!sheetNumber) {
      continue;
    }

    const titleStart = (match.index ?? 0) + match[0].length;
    const titleEnd =
      numberMatches[index + 1]?.index ??
      normalizedLine.length;
    const rawTitle = normalizeWhitespace(
      stripTrailingDocumentReferenceMetadata(
        normalizedLine.slice(titleStart, titleEnd)
      )
    );
    const canonicalTitle =
      extractCanonicalTitleFromContext(rawTitle) ||
      extractCanonicalTitleFromContext(normalizedLine);
    const normalizedTitle = normalizeTitleSelectionText(
      canonicalTitle || rawTitle
    ).replace(/[.]+$/, "");
    if (!normalizedTitle) {
      continue;
    }
    if (
      !sheetNumberMatchesDocumentTitleDisciplineCue(
        sheetNumber,
        normalizedTitle
      )
    ) {
      continue;
    }
    if (
      isGenericShortOcrTitleHeading(normalizedTitle) &&
      !canonicalTitle &&
      !/\b(?:sheet\s+t(?:i|l)?te?|sheet\s*title|drawing title|project title|title)\b/i.test(
        normalizedLine
      )
    ) {
      continue;
    }

    const titleScore = scoreTitleSelectionCandidate({
      title: normalizedTitle,
      sourceKind: "pdf_text",
      sourceText: normalizedTitle,
    });
    if (!Number.isFinite(titleScore) || titleScore < 36) {
      continue;
    }

    results.push({
      sheetNumber,
      sheetTitle: normalizedTitle,
    });
  }

  return results;
}

function normalizeDocumentReferenceComparisonNumber(sheetNumber: string) {
  return normalizeSheetNumberValue(sheetNumber)
    .replace(/^Q(?=[A-Z]\d)/, "")
    .replace(/^TI[-.]?(?=[A-Z])/, "");
}

function stripDocumentSheetIndexWrapperPrefix(sheetNumber: string) {
  return normalizeWhitespace(sheetNumber).replace(/^TI[-.]?(?=[A-Z])/i, "");
}

function preserveSheetNumberWrapperFromSource(
  sheetNumber: string,
  ...sourceTexts: Array<string | null | undefined>
) {
  const normalized = normalizeSheetNumberValue(sheetNumber);
  if (!normalized) {
    return normalized;
  }
  if (/^TI[-.]?(?=[A-Z])/i.test(normalized)) {
    return normalizeTiWrappedSheetNumberValue(normalized);
  }

  const compactNumber = normalizeKey(normalized).replace(/[^A-Z0-9]/g, "");
  const flexibleNumberPattern = escapeRegex(normalized).replace(/[.-]/g, "[-.\\s]*");
  const wrappedPattern = new RegExp(
    `\\bT[I1L][-.\\s]*${flexibleNumberPattern}\\b`,
    "i"
  );

  for (const sourceText of sourceTexts) {
    const source = normalizeWhitespace(sourceText ?? "");
    if (!source) {
      continue;
    }

    if (wrappedPattern.test(source)) {
      return normalizeTiWrappedSheetNumberValue(`TI-${normalized}`);
    }

    const compactSource = normalizeKey(source).replace(/[^A-Z0-9]/g, "");
    if (compactNumber && compactSource.includes(`TI${compactNumber}`)) {
      return normalizeTiWrappedSheetNumberValue(`TI-${normalized}`);
    }
  }

  return normalized;
}

function lookupDocumentReferencedSheet(
  sheetNumber: string,
  references: ReadonlyMap<string, string>
) {
  const normalizedSheetNumber = normalizeSheetNumberValue(sheetNumber);
  if (!normalizedSheetNumber) {
    return null;
  }

  const exactTitle = references.get(normalizedSheetNumber) ?? "";
  if (exactTitle) {
    return {
      sheetNumber: normalizedSheetNumber,
      sheetTitle: exactTitle,
    };
  }

  const comparable = normalizeDocumentReferenceComparisonNumber(normalizedSheetNumber);
  for (const [referenceNumber, referenceTitle] of references) {
    if (
      normalizeDocumentReferenceComparisonNumber(referenceNumber) === comparable
    ) {
      return {
        sheetNumber: referenceNumber,
        sheetTitle: referenceTitle,
      };
    }
  }

  return null;
}

function buildDocumentReferencedSheetTitleMap(pages: readonly PageExtractionModel[]) {
  const references = new Map<string, string>();

  for (const page of pages) {
    for (const line of page.lines) {
      for (const reference of extractReferencedSheetTitlesFromLine(line.text)) {
        const existing = references.get(reference.sheetNumber) ?? "";
        const existingScore = existing
          ? scoreTitleSelectionCandidate({
              title: existing,
              sourceKind: "pdf_text",
              sourceText: existing,
            })
          : -Infinity;
        const candidateScore = scoreTitleSelectionCandidate({
          title: reference.sheetTitle,
          sourceKind: "pdf_text",
          sourceText: reference.sheetTitle,
        });
        if (
          !existing ||
          candidateScore >= existingScore + 8 ||
          (
            candidateScore >= existingScore - 4 &&
            reference.sheetTitle.length > existing.length + 6
          )
        ) {
          references.set(reference.sheetNumber, reference.sheetTitle);
        }
      }
    }
  }

  return references;
}

type DocumentSheetIndexEntry = {
  sheetNumber: string;
  sheetTitle: string;
  sourcePageNumber: number;
  sourceText: string;
  index: number;
};

type DocumentSheetIndexSequenceAlignment = {
  entries: DocumentSheetIndexEntry[];
  indexByNumber: Map<string, number>;
};

const DOCUMENT_SHEET_INDEX_DISCIPLINE_HEADING_PATTERN =
  /^(?:ARCHITECTURAL|CIVIL|STRUCTURAL|MECHANICAL|ELECTRICAL|PLUMBING|FIRE\s+PROTECTION|FIRE\s+ALARM|TECHNOLOGY|TELECOM|LOW\s+VOLTAGE)$/i;

function isDocumentSheetIndexNoiseLine(value: string) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return true;
  }

  return (
    DOCUMENT_SHEET_INDEX_DISCIPLINE_HEADING_PATTERN.test(normalized) ||
    /^(?:SHEET|SHEET\s+NO\.?|NO\.?|NUMBER|TITLE|DESCRIPTION|INDEX|DRAWING\s+INDEX|SHEET\s+INDEX|INDEX\s+OF\s+DRAWINGS)$/i.test(
      normalized
    ) ||
    /^[#]+$/.test(normalized)
  );
}

function normalizeDocumentSheetIndexTitle(value: string) {
  return canonicalizeSheetIndexTitle(
    normalizeTitleSelectionText(value)
      .replace(/\s*&\s*/g, " AND ")
      .replace(/\b(PLANS?|DETAILS?|SCHEDULES?|NOTES?|SYMBOLS?|LEGENDS?|ABBREVIATIONS?|ELEVATIONS?|SECTIONS?)\s+(AND\s+)?(?=PLANS?|DETAILS?|SCHEDULES?|NOTES?|SYMBOLS?|LEGENDS?|ABBREVIATIONS?|ELEVATIONS?|SECTIONS?\b)/gi, "$1 AND ")
      .replace(/\b(FINISH)\s+(AND\s+)?(?=WALL\s+TYPE\b)/gi, "$1 AND ")
      .replace(/\b(RESTROOM(?:S)?|TOILET(?:S)?)\s+(AND\s+)?(?=DF\b)/gi, "$1 AND ")
      .replace(/\b(BUILDINGS?)\s+([A-Z])\s+(?:&\s*)?([A-Z])\b/gi, "$1 $2 AND $3")
      .replace(/\b(BUILDING)\s+([A-Z])\s+(?:&\s*)?([A-Z])\b/gi, "$1 $2 AND $3")
      .replace(/\b([A-Z])\s*&\s*([A-Z])\b/g, "$1 AND $2")
      .replace(/\s{2,}/g, " ")
      .replace(/[.]+$/, "")
  );
}

function isUsableDocumentSheetIndexTitle(title: string, sheetNumber: string) {
  if (!title || isDocumentSheetIndexNoiseLine(title)) {
    return false;
  }

  return (
    /\bSHEET\s+LIST\b/i.test(title) ||
    isLikelySheetTitle(title) ||
    isCanonicalSheetIndexTitle(title) ||
    countTitleVocabularyHits(title) > 0 ||
    hasCompactTechnicalTitleSignal(title)
  );
}

function extractDocumentSheetIndexEntriesFromLines(
  lines: readonly string[],
  sourcePageNumber: number
) {
  const entries: DocumentSheetIndexEntry[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeWhitespace(lines[index] ?? "");
    if (!line || isDocumentSheetIndexNoiseLine(line)) {
      continue;
    }

    const inlineMatch = line.match(
      /^((?:TI[-.]?)?(?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS)\b\s+(.+)$/i
    );
    const rawSheetNumber = inlineMatch?.[1] ?? line;
    const sheetNumber = normalizeSheetNumberValue(rawSheetNumber);
    if (!sheetNumber || !isSheetNumberValue(sheetNumber)) {
      continue;
    }

    const titleLines: string[] = [];
    if (inlineMatch?.[2]) {
      titleLines.push(inlineMatch[2]);
    }

    for (
      let cursor = index + 1;
      cursor < lines.length && cursor <= index + 5;
      cursor += 1
    ) {
      const nextLine = normalizeWhitespace(lines[cursor] ?? "");
      if (!nextLine) {
        continue;
      }
      const nextInlineNumber = nextLine.match(
        /^((?:TI[-.]?)?(?:[A-Z]{1,4}|\d{1,2}[A-Z]{1,2})[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?|CS|TS)\b/i
      )?.[1];
      if (
        nextInlineNumber &&
        isSheetNumberValue(
          normalizeSheetNumberValue(nextInlineNumber)
        )
      ) {
        break;
      }
      if (DOCUMENT_SHEET_INDEX_DISCIPLINE_HEADING_PATTERN.test(nextLine)) {
        break;
      }
      if (isDocumentSheetIndexNoiseLine(nextLine)) {
        continue;
      }
      if (extractSheetNumberTokensFromText(nextLine).length >= 2) {
        break;
      }

      titleLines.push(nextLine);
      const assembled = normalizeDocumentSheetIndexTitle(titleLines.join(" "));
      if (
        titleLines.length >= 3 ||
        (
          titleLines.length >= 1 &&
          isUsableDocumentSheetIndexTitle(assembled, sheetNumber) &&
          !/[,;&-]$/.test(nextLine)
        )
      ) {
        break;
      }
    }

    const sheetTitle = normalizeDocumentSheetIndexTitle(titleLines.join(" "));
    if (!isUsableDocumentSheetIndexTitle(sheetTitle, sheetNumber)) {
      continue;
    }

    const key = normalizeSheetNumberValue(sheetNumber);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      sheetNumber,
      sheetTitle,
      sourcePageNumber,
      sourceText: [sheetNumber, ...titleLines].join("\n"),
      index: entries.length,
    });
  }

  return entries;
}

function buildDocumentSheetIndexEntries(pages: readonly PageExtractionModel[]) {
  const entries: DocumentSheetIndexEntry[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const hasSheetIndexHeading = (page.sheetIndexLines ?? []).some((line) =>
      /\bSHEET\s+(?:LIST|INDEX)\b/i.test(normalizeWhitespace(line))
    );
    if (!hasSheetIndexHeading) {
      continue;
    }

    const pageEntries = extractDocumentSheetIndexEntriesFromLines(
      page.sheetIndexLines ?? [],
      page.pageNumber
    );
    for (const entry of pageEntries) {
      const key = normalizeSheetNumberValue(entry.sheetNumber);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({
        ...entry,
        index: entries.length,
      });
    }
  }

  return entries;
}

function getPrimaryDocumentSheetIndexPageNumber(
  entries: readonly DocumentSheetIndexEntry[]
) {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    counts.set(entry.sourcePageNumber, (counts.get(entry.sourcePageNumber) ?? 0) + 1);
  }

  let bestPageNumber: number | null = null;
  let bestCount = 0;
  for (const [pageNumber, count] of counts) {
    if (count > bestCount) {
      bestPageNumber = pageNumber;
      bestCount = count;
    }
  }

  return bestPageNumber && bestCount >= 6 ? bestPageNumber : null;
}

function getDocumentSheetIndexDisciplineSortGroup(prefix: string) {
  const discipline = prefix[0] ?? "";
  switch (discipline) {
    case "G":
      return 0;
    case "A":
      return 1;
    case "S":
      return 2;
    case "M":
      return 3;
    case "P":
      return 4;
    case "F":
      return 5;
    case "E":
      return 6;
    case "T":
      return 7;
    case "C":
      return 8;
    default:
      return 20;
  }
}

function getDocumentSheetIndexSubSortGroup(sheetNumber: string) {
  const parts = parseSheetNumberParts(sheetNumber);
  if (!parts) {
    return 0;
  }

  if (parts.prefix === "M") {
    const main = Number.parseInt(parts.main, 10);
    if (main === 0) {
      return 0;
    }
    return 20;
  }
  if (parts.prefix === "A") {
    const main = Number.parseInt(parts.main, 10);
    if (main >= 900) {
      return 40;
    }
    if (main >= 100) {
      return 30;
    }
    return 10;
  }
  if (parts.prefix === "AD") {
    return 20;
  }
  if (parts.prefix.startsWith("MV")) {
    return 10;
  }

  return 0;
}

function getDocumentSheetIndexSortKey(entry: DocumentSheetIndexEntry) {
  const parts = parseSheetNumberParts(entry.sheetNumber);
  if (!parts) {
    return {
      discipline: 99,
      subGroup: 99,
      prefix: normalizeSheetNumberValue(entry.sheetNumber),
      main: Number.MAX_SAFE_INTEGER,
      sub: Number.MAX_SAFE_INTEGER,
      suffix: "",
      detail: "",
    };
  }

  return {
    discipline: getDocumentSheetIndexDisciplineSortGroup(parts.prefix),
    subGroup: getDocumentSheetIndexSubSortGroup(entry.sheetNumber),
    prefix: parts.prefix,
    main: Number.parseInt(parts.main, 10),
    sub: parts.sub ? Number.parseInt(parts.sub, 10) : -1,
    suffix: parts.suffix,
    detail: parts.detail,
  };
}

function compareDocumentSheetIndexEntries(
  left: DocumentSheetIndexEntry,
  right: DocumentSheetIndexEntry
) {
  const leftKey = getDocumentSheetIndexSortKey(left);
  const rightKey = getDocumentSheetIndexSortKey(right);
  const numericComparisons = [
    leftKey.discipline - rightKey.discipline,
    leftKey.subGroup - rightKey.subGroup,
    leftKey.main - rightKey.main,
    leftKey.sub - rightKey.sub,
  ];
  for (const comparison of numericComparisons) {
    if (comparison !== 0) {
      return comparison;
    }
  }

  return (
    leftKey.prefix.localeCompare(rightKey.prefix, undefined, { numeric: true }) ||
    leftKey.suffix.localeCompare(rightKey.suffix, undefined, { numeric: true }) ||
    leftKey.detail.localeCompare(rightKey.detail, undefined, { numeric: true }) ||
    left.sheetNumber.localeCompare(right.sheetNumber, undefined, { numeric: true })
  );
}

function buildDocumentSheetIndexSequenceAlignment(args: {
  entries: readonly DocumentSheetIndexEntry[];
  sheets: readonly ExtractedPlanSheet[];
}) {
  const primaryPageNumber = getPrimaryDocumentSheetIndexPageNumber(args.entries);
  if (!primaryPageNumber) {
    return null;
  }

  const seen = new Set<string>();
  const sequenceEntries: DocumentSheetIndexEntry[] = [];
  const addEntry = (entry: DocumentSheetIndexEntry) => {
    const key = normalizeSheetNumberValue(entry.sheetNumber);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    sequenceEntries.push(entry);
  };

  for (const entry of args.entries) {
    if (entry.sourcePageNumber === primaryPageNumber) {
      addEntry(entry);
    }
  }

  for (const sheet of args.sheets) {
    const sheetNumber = normalizeSheetNumberValue(sheet.sheetNumber);
    if (
      !sheetNumber ||
      sheet.identityConfidenceTier === "insufficient_evidence" ||
      seen.has(sheetNumber)
    ) {
      continue;
    }
    if (!/\bSHEET\s+(?:LIST|INDEX)\b/i.test(sheet.sheetTitle)) {
      continue;
    }

    addEntry({
      sheetNumber,
      sheetTitle: normalizeWhitespace(sheet.sheetTitle),
      sourcePageNumber: sheet.pageNumber,
      sourceText: [sheetNumber, sheet.sheetTitle].filter(Boolean).join("\n"),
      index: -1,
    });
  }

  if (sequenceEntries.length < 6) {
    return null;
  }

  sequenceEntries.sort(compareDocumentSheetIndexEntries);
  const indexByNumber = new Map<string, number>();
  sequenceEntries.forEach((entry, index) => {
    entry.index = index;
    indexByNumber.set(normalizeSheetNumberValue(entry.sheetNumber), index);
  });

  return {
    entries: sequenceEntries,
    indexByNumber,
  } satisfies DocumentSheetIndexSequenceAlignment;
}

function findDocumentSheetIndexAlignment(
  entries: readonly DocumentSheetIndexEntry[],
  sheets: readonly ExtractedPlanSheet[]
) {
  if (entries.length < 4 || sheets.length === 0) {
    return null;
  }

  let best: { offset: number; matches: number; score: number } | null = null;
  for (let offset = -5; offset <= 5; offset += 1) {
    let matches = 0;
    let mismatches = 0;

    for (const sheet of sheets) {
      const normalizedSheetNumber = normalizeSheetNumberValue(sheet.sheetNumber);
      if (!normalizedSheetNumber) {
        continue;
      }

      const entry = entries[sheet.pageNumber - 1 + offset];
      if (!entry) {
        continue;
      }

      if (normalizeSheetNumberValue(entry.sheetNumber) === normalizedSheetNumber) {
        matches += 1;
      } else {
        mismatches += 1;
      }
    }

    const score =
      matches * 100 -
      mismatches * 24 -
      Math.abs(offset) * 8 +
      (offset === 0 && entries.length >= sheets.length * 0.8 ? 28 : 0);
    if (!best || score > best.score) {
      best = { offset, matches, score };
    }
  }

  if (!best || best.matches < 2 || best.score < 160) {
    return null;
  }

  return best;
}

function findPageLocalSheetStampNumber(page: PageExtractionModel | undefined) {
  if (!page) {
    return "";
  }

  const lines = page.lines;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const value = normalizeSheetNumberValue(line.text);
    if (!value || !isSheetNumberValue(value)) {
      continue;
    }

    const fontSize = line.fontSizeMax ?? line.fontSize ?? 0;
    const isProminentStamp =
      line.normX >= 0.84 &&
      line.normY >= 0.88 &&
      (fontSize >= 18 || line.normHeight >= 0.014);
    if (!isProminentStamp) {
      continue;
    }

    const hasSheetLabel = lines.some((candidate) => {
      if (!/\bSHEET\b/i.test(candidate.text)) {
        return false;
      }

      return (
        candidate.normX >= 0.74 &&
        candidate.normY >= 0.84 &&
        candidate.normX <= line.normX + 0.02 &&
        line.normX - candidate.normX <= 0.2 &&
        candidate.normY <= line.normY + 0.03
      );
    });
    if (hasSheetLabel) {
      return value;
    }
  }

  return "";
}

function findDocumentSheetIndexEntryByNumber(
  entries: readonly DocumentSheetIndexEntry[],
  sheetNumber: string
) {
  const comparable = normalizeDocumentReferenceComparisonNumber(sheetNumber);
  if (!comparable) {
    return null;
  }

  return (
    entries.find(
      (entry) => normalizeDocumentReferenceComparisonNumber(entry.sheetNumber) === comparable
    ) ?? null
  );
}

function addDocumentSheetIndexSupportTokensFromText(
  tokens: Set<string>,
  text: string | null | undefined
) {
  const normalized = normalizeWhitespace(text ?? "");
  if (!normalized) {
    return;
  }

  const addToken = (value: string) => {
    const token = normalizeSheetNumberValue(value);
    if (token && isSheetNumberValue(token)) {
      tokens.add(token);
    }
  };

  for (const token of extractStampSheetNumberTokensFromText(normalized)) {
    addToken(token);
  }
  for (const token of extractSheetNumberTokensFromText(normalized)) {
    addToken(token);
  }

  const reversedWrapperMatches = normalized.matchAll(
    /\b([A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]{0,2}(?:[.-](?:\d{1,3}[A-Z]?|[A-Z]{1,2}\d{0,2}))?)\s*[-. ]+\s*T[I1L]\b/gi
  );
  for (const match of reversedWrapperMatches) {
    const wrapped = normalizeTiWrappedSheetNumberValue(`TI-${match[1] ?? ""}`);
    addToken(wrapped);
  }
}

function lineLooksLikeLocalSheetIdentitySupport(line: TextLine) {
  const text = normalizeWhitespace(line.text);
  if (!text) {
    return false;
  }

  const lowerMetadataZone = line.normY >= 0.82 && line.normX >= 0.48;
  const rightTitleBlockZone = line.normX >= 0.74 && line.normY >= 0.58;
  const prominentBottomNumber =
    line.normY >= 0.86 &&
    (line.fontSizeMax ?? line.fontSize ?? 0) >= 14 &&
    line.normWidth <= 0.18;

  return lowerMetadataZone || rightTitleBlockZone || prominentBottomNumber;
}

function candidateLooksLikeLocalSheetIdentitySupport(candidate: SheetNumberCandidate) {
  if (candidate.isNumericOnly || candidate.score < 140) {
    return false;
  }

  const explicitIndexedSheetNumber = /^TI[-.]?[A-Z]/i.test(
    normalizeWhitespace(candidate.lineText)
  );
  const inLowerMetadataArea = candidate.normY >= 0.82 && candidate.normX >= 0.48;
  const inRightIndexedSheetArea =
    explicitIndexedSheetNumber && candidate.normY >= 0.58 && candidate.normX >= 0.62;

  return inLowerMetadataArea || inRightIndexedSheetArea;
}

function collectPageLocalSheetIdentitySupportTokens(
  page: PageExtractionModel | undefined
) {
  const tokens = new Set<string>();
  if (!page) {
    return tokens;
  }

  const stampNumber = findPageLocalSheetStampNumber(page);
  addDocumentSheetIndexSupportTokensFromText(tokens, stampNumber);

  for (const line of page.lines) {
    if (lineLooksLikeLocalSheetIdentitySupport(line)) {
      addDocumentSheetIndexSupportTokensFromText(tokens, line.text);
    }
  }

  for (const line of page.searchLines ?? []) {
    if (lineLooksLikeLocalSheetIdentitySupport(line)) {
      addDocumentSheetIndexSupportTokensFromText(tokens, line.text);
    }
  }

  for (const candidate of page.candidates) {
    if (!candidateLooksLikeLocalSheetIdentitySupport(candidate)) {
      continue;
    }

    addDocumentSheetIndexSupportTokensFromText(tokens, candidate.value);
    addDocumentSheetIndexSupportTokensFromText(tokens, candidate.lineText);
  }

  return tokens;
}

function pageLocallySupportsDocumentSheetIndexEntry(
  page: PageExtractionModel | undefined,
  entry: DocumentSheetIndexEntry
) {
  const entryNumber = normalizeSheetNumberValue(entry.sheetNumber);
  const comparableEntryNumber = normalizeDocumentReferenceComparisonNumber(entryNumber);
  if (!page || !entryNumber || !comparableEntryNumber) {
    return false;
  }

  const localTokens = collectPageLocalSheetIdentitySupportTokens(page);
  for (const token of localTokens) {
    if (token === entryNumber) {
      return true;
    }
    if (
      normalizeDocumentReferenceComparisonNumber(token) === comparableEntryNumber &&
      (token.startsWith("TI-") || entryNumber.startsWith("TI-"))
    ) {
      return true;
    }
  }

  return false;
}

function findPageLocalDocumentSheetIndexEntry(
  page: PageExtractionModel | undefined,
  entries: readonly DocumentSheetIndexEntry[]
) {
  if (!page || entries.length === 0) {
    return null;
  }

  const candidates = page.candidates
    .filter((candidate) => {
      if (candidate.isNumericOnly || candidate.score < 150) {
        return false;
      }
      const explicitIndexedSheetNumber = /^TI[-.]?[A-Z]/i.test(
        normalizeWhitespace(candidate.lineText)
      );
      const inLowerMetadataArea =
        candidate.normY >= 0.86 && candidate.normX >= 0.54;
      const inRightIndexedSheetArea =
        explicitIndexedSheetNumber && candidate.normY >= 0.7 && candidate.normX >= 0.65;
      if (!inLowerMetadataArea && !inRightIndexedSheetArea) {
        return false;
      }
      if (/\//.test(candidate.lineText)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => right.score - left.score);

  for (const candidate of candidates) {
    const entry =
      findDocumentSheetIndexEntryByNumber(entries, candidate.lineText) ??
      findDocumentSheetIndexEntryByNumber(entries, candidate.value);
    if (entry) {
      return {
        entry,
        sourceText: normalizeWhitespace(candidate.lineText) || entry.sheetNumber,
      };
    }
  }

  return null;
}

function findPageEmbeddedDocumentSheetIndexEntry(
  page: PageExtractionModel | undefined,
  entries: readonly DocumentSheetIndexEntry[]
) {
  if (!page) {
    return null;
  }

  const lines = (page.sheetIndexLines ?? []).map((line) => normalizeWhitespace(line));
  const hasSheetIndexHeading = lines.some((line) =>
    /\bSHEET\s+(?:LIST|INDEX)\b/i.test(line)
  );
  const metadataHeaderLines = lines.slice(0, 45);
  const hasMetadataHeader =
    metadataHeaderLines.some((line) =>
      /\b(?:PROJECT\s+NUMBER|ISSUE\s+DATE)\b/i.test(line)
    ) &&
    metadataHeaderLines.some((line) => /\bSHEET\s+(?:NUMBER|TITLE)\b/i.test(line));
  for (let index = 0; index < Math.min(lines.length, 80); index += 1) {
    const line = lines[index] ?? "";
    if (!line) {
      continue;
    }

    const previousTitle = normalizeDocumentSheetIndexTitle(lines[index - 1] ?? "");
    const nextTitle = normalizeDocumentSheetIndexTitle(lines[index + 1] ?? "");
    const indexedEntry = findDocumentSheetIndexEntryByNumber(entries, line);
    if (indexedEntry) {
      if (
        previousTitle &&
        normalizeKey(previousTitle) === normalizeKey(indexedEntry.sheetTitle)
      ) {
        return {
          entry: indexedEntry,
          sourceText: line,
        };
      }
      if (
        nextTitle &&
        normalizeKey(nextTitle) === normalizeKey(indexedEntry.sheetTitle)
      ) {
        return {
          entry: indexedEntry,
          sourceText: line,
        };
      }
      continue;
    }

    const sheetNumber = normalizeSheetNumberValue(line);
    const allowDirectEmbeddedIdentity = hasSheetIndexHeading || hasMetadataHeader;
    if (
      allowDirectEmbeddedIdentity &&
      sheetNumber &&
      isSheetNumberValue(sheetNumber) &&
      previousTitle &&
      isUsableDocumentSheetIndexTitle(previousTitle, sheetNumber)
    ) {
      return {
        entry: {
          sheetNumber,
          sheetTitle: previousTitle,
          sourcePageNumber: page.pageNumber,
          sourceText: [sheetNumber, previousTitle].join("\n"),
          index: -1,
        },
        sourceText: line,
      };
    }
    if (
      allowDirectEmbeddedIdentity &&
      sheetNumber &&
      isSheetNumberValue(sheetNumber) &&
      nextTitle &&
      isUsableDocumentSheetIndexTitle(nextTitle, sheetNumber)
    ) {
      return {
        entry: {
          sheetNumber,
          sheetTitle: nextTitle,
          sourcePageNumber: page.pageNumber,
          sourceText: [sheetNumber, nextTitle].join("\n"),
          index: -1,
        },
        sourceText: line,
      };
    }
  }

  return null;
}

function applyDocumentSheetIndexEntryToSheet(args: {
  sheet: ExtractedPlanSheet;
  entry: DocumentSheetIndexEntry;
  numberSourceText: string;
  decision: string;
  reasonCode?: string;
  diagnostic?: PlanSheetSelectionDiagnostic;
}) {
  args.sheet.sheetNumber = args.entry.sheetNumber;
  args.sheet.sheetTitle = args.entry.sheetTitle;
  args.sheet.discipline = inferSheetDiscipline(
    args.sheet.sheetNumber,
    args.sheet.sheetTitle
  );
  args.sheet.confidence = Math.max(args.sheet.confidence ?? 0, 0.82);
  args.sheet.rawConfidence = Math.max(args.sheet.rawConfidence ?? 0, 0.82);
  args.sheet.identityConfidenceTier = "needs_review";
  args.sheet.identityConfidenceReasons = [
    args.reasonCode ?? "document_sheet_index_local_number_fallback",
  ];
  args.sheet.llmRecommended = false;
  args.sheet.repairableEvidence = true;
  args.sheet.referenceText = args.sheet.referenceText || args.entry.sourceText;
  args.sheet.numberSourceText = args.numberSourceText || args.entry.sheetNumber;
  args.sheet.titleSourceText = args.entry.sheetTitle;
  args.sheet.numberSourceKind = "pdf_text";
  args.sheet.titleSourceKind = "pdf_text";

  if (args.diagnostic) {
    args.diagnostic.selectionDecision = args.decision;
    args.diagnostic.rejectReason = null;
    args.diagnostic.selectionGateFailures = [];
    args.diagnostic.sheetNumber = args.sheet.sheetNumber;
    args.diagnostic.sheetTitle = args.sheet.sheetTitle;
    args.diagnostic.badForStyleRediscovery = false;
  }
}

function shouldAllowDocumentSheetIndexSequenceFill(sheet: ExtractedPlanSheet) {
  if (!sheet.sheetNumber && !sheet.sheetTitle) {
    return true;
  }

  return (
    sheet.identityConfidenceTier === "insufficient_evidence" &&
    (sheet.identityConfidenceReasons ?? []).some((reason) =>
      reason === "missing_sheet_identity" || reason === "severe_title_noise"
    )
  );
}

function getUsedDocumentSheetNumbers(sheets: readonly ExtractedPlanSheet[]) {
  const used = new Set<string>();
  for (const sheet of sheets) {
    const sheetNumber = normalizeSheetNumberValue(sheet.sheetNumber);
    if (!sheetNumber || sheet.identityConfidenceTier === "insufficient_evidence") {
      continue;
    }
    used.add(sheetNumber);
  }
  return used;
}

function applyDocumentSheetIndexDirectCrossCheck(args: {
  sheets: ExtractedPlanSheet[];
  diagnostics: readonly PlanSheetSelectionDiagnostic[];
  pages: readonly PageExtractionModel[];
  entries: readonly DocumentSheetIndexEntry[];
}) {
  if (args.entries.length === 0) {
    return;
  }

  const diagnosticByPage = new Map(
    args.diagnostics.map((diagnostic) => [diagnostic.pageNumber, diagnostic])
  );
  const pageByNumber = new Map(args.pages.map((page) => [page.pageNumber, page]));
  for (const sheet of args.sheets) {
    const currentNumber = normalizeSheetNumberValue(sheet.sheetNumber);
    if (!currentNumber) {
      continue;
    }
    const entry = findDocumentSheetIndexEntryByNumber(args.entries, currentNumber);
    if (!entry) {
      continue;
    }

    const entryLocallySupported = pageLocallySupportsDocumentSheetIndexEntry(
      pageByNumber.get(sheet.pageNumber),
      entry
    );
    const canonicalNumber = normalizeSheetNumberValue(entry.sheetNumber);
    const currentTitleLooksBad =
      !sheet.sheetTitle ||
      sheet.identityConfidenceTier === "insufficient_evidence" ||
      isSuspiciousDetectedTitle(sheet.sheetTitle) ||
      isSevereSheetIdentityTitleNoise(sheet.sheetTitle, sheet.titleSourceText);
    const preferredIndexTitle = entryLocallySupported
      ? getPreferredDocumentSheetIndexTitle({
          currentTitle: sheet.sheetTitle,
          indexTitle: entry.sheetTitle,
          sheetNumber: entry.sheetNumber,
        })
      : null;
    const shouldReplaceTitle =
      entryLocallySupported &&
      (currentTitleLooksBad || Boolean(preferredIndexTitle));
    const shouldCanonicalizeNumber =
      canonicalNumber &&
      canonicalNumber !== currentNumber &&
      normalizeKey(canonicalNumber) === normalizeKey(currentNumber);

    if (!shouldReplaceTitle && !shouldCanonicalizeNumber) {
      continue;
    }

    if (shouldCanonicalizeNumber) {
      sheet.sheetNumber = entry.sheetNumber;
      sheet.numberSourceText = sheet.numberSourceText || entry.sourceText;
      sheet.numberSourceKind = sheet.numberSourceKind || "pdf_text";
    }
    if (shouldReplaceTitle) {
      sheet.sheetTitle = preferredIndexTitle ?? entry.sheetTitle;
      sheet.titleSourceText = entry.sourceText;
      sheet.titleSourceKind = "pdf_text";
    }

    sheet.discipline = inferSheetDiscipline(sheet.sheetNumber, sheet.sheetTitle);
    sheet.referenceText = sheet.referenceText || entry.sourceText;
    sheet.identityConfidenceReasons = [
      ...new Set([
        ...(sheet.identityConfidenceReasons ?? []),
        "document_sheet_index_cross_check",
      ]),
    ];
    if (sheet.identityConfidenceTier === "insufficient_evidence") {
      sheet.identityConfidenceTier = "needs_review";
      sheet.confidence = Math.max(sheet.confidence ?? 0, 0.72);
      sheet.rawConfidence = Math.max(sheet.rawConfidence ?? 0, 0.72);
      sheet.llmRecommended = false;
      sheet.repairableEvidence = true;
    }

    const diagnostic = diagnosticByPage.get(sheet.pageNumber);
    if (diagnostic) {
      diagnostic.selectionDecision = "selected_document_sheet_index_cross_check";
      diagnostic.rejectReason = null;
      diagnostic.selectionGateFailures = [];
      diagnostic.sheetNumber = sheet.sheetNumber;
      diagnostic.sheetTitle = sheet.sheetTitle;
      diagnostic.badForStyleRediscovery = false;
    }
  }
}

function applyDocumentSheetIndexSequenceGapFallback(args: {
  sheets: ExtractedPlanSheet[];
  diagnostics: readonly PlanSheetSelectionDiagnostic[];
  pages: readonly PageExtractionModel[];
  sequence: DocumentSheetIndexSequenceAlignment | null;
}) {
  if (!args.sequence) {
    return;
  }

  const diagnosticByPage = new Map(
    args.diagnostics.map((diagnostic) => [diagnostic.pageNumber, diagnostic])
  );
  const pageByNumber = new Map(args.pages.map((page) => [page.pageNumber, page]));
  const anchors = args.sheets
    .map((sheet) => {
      const index = args.sequence?.indexByNumber.get(
        normalizeSheetNumberValue(sheet.sheetNumber)
      );
      if (
        index === undefined ||
        sheet.identityConfidenceTier === "insufficient_evidence"
      ) {
        return null;
      }
      return {
        sheet,
        index,
      };
    })
    .filter((anchor): anchor is { sheet: ExtractedPlanSheet; index: number } =>
      Boolean(anchor)
    )
    .sort((left, right) => left.sheet.pageNumber - right.sheet.pageNumber);

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex]!;
    const right = anchors[anchorIndex + 1]!;
    const pageGap = right.sheet.pageNumber - left.sheet.pageNumber - 1;
    const indexGap = right.index - left.index - 1;
    if (pageGap <= 0 || pageGap !== indexGap || pageGap > 12) {
      continue;
    }

    for (let offset = 1; offset <= pageGap; offset += 1) {
      const sheet = args.sheets.find(
        (candidate) => candidate.pageNumber === left.sheet.pageNumber + offset
      );
      const entry = args.sequence.entries[left.index + offset];
      if (!sheet || !entry || !shouldAllowDocumentSheetIndexSequenceFill(sheet)) {
        continue;
      }
      if (
        !pageLocallySupportsDocumentSheetIndexEntry(
          pageByNumber.get(sheet.pageNumber),
          entry
        )
      ) {
        continue;
      }

      applyDocumentSheetIndexEntryToSheet({
        sheet,
        entry,
        numberSourceText: entry.sourceText,
        decision: "selected_document_sheet_index_sequence_gap",
        reasonCode: "document_sheet_index_sequence_gap_fallback",
        diagnostic: diagnosticByPage.get(sheet.pageNumber),
      });
    }
  }
}

function countDocumentSheetIndexSequenceAnchors(args: {
  sheets: readonly ExtractedPlanSheet[];
  sequence: DocumentSheetIndexSequenceAlignment;
}) {
  let count = 0;
  for (const sheet of args.sheets) {
    const sheetNumber = normalizeSheetNumberValue(sheet.sheetNumber);
    if (
      sheetNumber &&
      sheet.identityConfidenceTier !== "insufficient_evidence" &&
      args.sequence.indexByNumber.has(sheetNumber)
    ) {
      count += 1;
    }
  }
  return count;
}

function findPositionalDocumentSheetIndexEntry(args: {
  sheet: ExtractedPlanSheet;
  page: PageExtractionModel | undefined;
  sequence: DocumentSheetIndexSequenceAlignment;
  usedNumbers: Set<string>;
}) {
  const startIndex = Math.max(0, args.sheet.pageNumber - 1);
  const endIndex = Math.min(args.sequence.entries.length - 1, startIndex + 4);
  for (let index = startIndex; index <= endIndex; index += 1) {
    const entry = args.sequence.entries[index];
    if (!entry) {
      continue;
    }
    const entryNumber = normalizeSheetNumberValue(entry.sheetNumber);
    if (!entryNumber || args.usedNumbers.has(entryNumber)) {
      continue;
    }
    if (!pageLocallySupportsDocumentSheetIndexEntry(args.page, entry)) {
      continue;
    }
    return entry;
  }

  return null;
}

function applyDocumentSheetIndexPositionalFallback(args: {
  sheets: ExtractedPlanSheet[];
  diagnostics: readonly PlanSheetSelectionDiagnostic[];
  pages: readonly PageExtractionModel[];
  sequence: DocumentSheetIndexSequenceAlignment | null;
}) {
  if (!args.sequence) {
    return;
  }

  const anchorCount = countDocumentSheetIndexSequenceAnchors({
    sheets: args.sheets,
    sequence: args.sequence,
  });
  if (anchorCount < 10) {
    return;
  }

  const diagnosticByPage = new Map(
    args.diagnostics.map((diagnostic) => [diagnostic.pageNumber, diagnostic])
  );
  const pageByNumber = new Map(args.pages.map((page) => [page.pageNumber, page]));
  const usedNumbers = getUsedDocumentSheetNumbers(args.sheets);
  for (const sheet of args.sheets) {
    if (!shouldAllowDocumentSheetIndexSequenceFill(sheet)) {
      continue;
    }

    const entry = findPositionalDocumentSheetIndexEntry({
      sheet,
      page: pageByNumber.get(sheet.pageNumber),
      sequence: args.sequence,
      usedNumbers,
    });
    if (!entry) {
      continue;
    }

    applyDocumentSheetIndexEntryToSheet({
      sheet,
      entry,
      numberSourceText: entry.sourceText,
      decision: "selected_document_sheet_index_positional",
      reasonCode: "document_sheet_index_positional_fallback",
      diagnostic: diagnosticByPage.get(sheet.pageNumber),
    });
    usedNumbers.add(normalizeSheetNumberValue(entry.sheetNumber));
  }
}

function shouldPreferDocumentSheetIndexTitle(args: {
  currentTitle: string;
  indexTitle: string;
  sheetNumber: string;
}) {
  return Boolean(getPreferredDocumentSheetIndexTitle(args));
}

function getPreferredDocumentSheetIndexTitle(args: {
  currentTitle: string;
  indexTitle: string;
  sheetNumber: string;
}) {
  const current = normalizeWhitespace(args.currentTitle);
  const indexTitle = normalizeWhitespace(args.indexTitle);
  if (!indexTitle) {
    return null;
  }
  if (!current) {
    return indexTitle;
  }
  if (
    /\bPHASE:\s*CONSTRUCTION(?:\s+DOCUMENTS?)?\b/i.test(current) &&
    !/\bPHASE:\s*CONSTRUCTION(?:\s+DOCUMENTS?)?\b/i.test(indexTitle)
  ) {
    return indexTitle;
  }
  if (
    normalizeKey(current).includes(normalizeKey(args.sheetNumber)) &&
    !normalizeKey(indexTitle).includes(normalizeKey(args.sheetNumber))
  ) {
    return indexTitle;
  }
  const autocompleteTitle = getDocumentSheetIndexAutocompleteTitle(args);
  if (autocompleteTitle) {
    return autocompleteTitle;
  }
  if (shouldPreferDocumentReferencedTitle(current, indexTitle, args.sheetNumber)) {
    return indexTitle;
  }

  const currentPenalty = getTextualTitleRejectPenalty(current);
  const indexPenalty = getTextualTitleRejectPenalty(indexTitle);
  if (currentPenalty <= -120 && indexPenalty > currentPenalty + 40) {
    return indexTitle;
  }

  return null;
}

function getDocumentSheetIndexAutocompleteTokens(title: string, sheetNumber: string) {
  const normalizedSheetNumber = normalizeSheetNumberValue(sheetNumber);
  const sheetNumberTokens = new Set(
    [
      normalizedSheetNumber,
      normalizeDocumentReferenceComparisonNumber(normalizedSheetNumber),
      ...normalizedSheetNumber.split(/[-.]/),
    ]
      .map((token) => token.replace(/[^A-Z0-9]/g, ""))
      .filter((token) => token.length >= 2)
  );

  return normalizeComparableSheetTitleText(title)
    .split(/[^A-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => {
      if (token.length === 0 || token === "TI") {
        return false;
      }
      if (sheetNumberTokens.has(token)) {
        return false;
      }
      return true;
    });
}

function tokensAppearInOrder(
  needles: readonly string[],
  haystack: readonly string[]
) {
  if (needles.length === 0 || haystack.length === 0) {
    return false;
  }

  let haystackIndex = 0;
  for (const needle of needles) {
    while (haystackIndex < haystack.length && haystack[haystackIndex] !== needle) {
      haystackIndex += 1;
    }
    if (haystackIndex >= haystack.length) {
      return false;
    }
    haystackIndex += 1;
  }
  return true;
}

function extractDocumentSheetIndexTitleAreaMarker(title: string) {
  const normalized = normalizeComparableSheetTitleText(title);
  const areaMatch = normalized.match(/\bAREA\s+([A-Z0-9]{1,3})\b/);
  if (areaMatch?.[1]) {
    return areaMatch[1];
  }
  return null;
}

function extractDocumentSheetNumberTrailingAreaMarker(sheetNumber: string) {
  const normalized = normalizeSheetNumberValue(sheetNumber).replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/\d([A-F])$/);
  return match?.[1] ?? null;
}

function getDocumentSheetIndexAutocompleteTitle(args: {
  currentTitle: string;
  indexTitle: string;
  sheetNumber: string;
}) {
  const current = normalizeWhitespace(args.currentTitle);
  const indexTitle = normalizeWhitespace(args.indexTitle);
  if (!current || !indexTitle) {
    return null;
  }

  const normalizedCurrent = normalizeComparableSheetTitleText(current);
  const normalizedIndex = normalizeComparableSheetTitleText(indexTitle);
  if (
    !normalizedCurrent ||
    !normalizedIndex ||
    normalizedCurrent === normalizedIndex ||
    normalizedIndex.length <= normalizedCurrent.length + 3
  ) {
    return null;
  }
  if (
    isSuspiciousDetectedTitle(normalizedIndex) ||
    matchesAdministrativeTitleMetadata(normalizedIndex) ||
    getTextualTitleRejectPenalty(normalizedIndex) <= -120
  ) {
    return null;
  }

  const currentTokens = getDocumentSheetIndexAutocompleteTokens(
    current,
    args.sheetNumber
  );
  const indexTokens = getDocumentSheetIndexAutocompleteTokens(
    indexTitle,
    args.sheetNumber
  );
  if (currentTokens.length === 0 || indexTokens.length <= currentTokens.length) {
    return null;
  }

  const currentArea = extractDocumentSheetIndexTitleAreaMarker(current);
  const indexArea = extractDocumentSheetIndexTitleAreaMarker(indexTitle);
  if (currentArea && indexArea && currentArea !== indexArea) {
    return null;
  }
  const sheetNumberArea = extractDocumentSheetNumberTrailingAreaMarker(
    args.sheetNumber
  );
  if (
    sheetNumberArea &&
    (
      (currentArea && currentArea !== sheetNumberArea) ||
      (indexArea && indexArea !== sheetNumberArea)
    )
  ) {
    return null;
  }
  const mutuallyExclusiveScopeTokens = new Set([
    "LIGHTING",
    "POWER",
    "SYSTEMS",
    "VENTILATION",
    "TECHNOLOGY",
    "ELECTRICAL",
    "MECHANICAL",
    "STRUCTURAL",
    "PLUMBING",
    "FIRE",
    "PROTECTION",
  ]);
  const currentScopeTokens = currentTokens.filter((token) =>
    mutuallyExclusiveScopeTokens.has(token)
  );
  const indexScopeTokenSet = new Set(
    indexTokens.filter((token) => mutuallyExclusiveScopeTokens.has(token))
  );
  if (
    currentScopeTokens.some((token) => !indexScopeTokenSet.has(token)) &&
    indexScopeTokenSet.size > 0
  ) {
    return null;
  }

  const orderedPrefixMatch = tokensAppearInOrder(currentTokens, indexTokens);
  const overlap = scoreComparableTitleOverlap(current, indexTitle);
  const currentTokenSet = new Set(currentTokens);
  const indexTokenSet = new Set(indexTokens);
  const sharedTokenCount = currentTokens.filter((token) =>
    indexTokenSet.has(token)
  ).length;
  if (!orderedPrefixMatch && overlap < 0.32 && sharedTokenCount < 2) {
    return null;
  }

  const currentImportant = new Set(extractImportantOcrTitleModifiers(current));
  const indexImportant = new Set(extractImportantOcrTitleModifiers(indexTitle));
  const droppedImportant = [...currentImportant].some(
    (modifier) =>
      !indexImportant.has(modifier) &&
      !/^(?:level|levels|plan)$/.test(modifier)
  );
  if (droppedImportant) {
    return null;
  }

  const addedTokens = indexTokens.filter((token) => !currentTokenSet.has(token));
  const addsUsefulContext = addedTokens.some((token) =>
    /^(?:AREA|BUILDING|BUILDINGS|LEVEL|PHASE|PACKAGE|NORTH|SOUTH|EAST|WEST|FIRE|PROTECTION|VENTILATION|LIGHTING|POWER|SYSTEMS|TECHNOLOGY|ELECTRICAL|MECHANICAL|STRUCTURAL|DEMOLITION|USGS|D|E|A|B|C|F)$/.test(
      token
    )
  );

  if (!addsUsefulContext && indexTokens.length < currentTokens.length + 2) {
    return null;
  }

  if (orderedPrefixMatch) {
    return indexTitle;
  }

  const suffix = formatDocumentSheetIndexAutocompleteSuffix(addedTokens);
  if (!suffix) {
    return null;
  }

  return `${current.replace(/[-:;,\s]+$/, "")} - ${suffix}`;
}

function formatDocumentSheetIndexAutocompleteSuffix(tokens: readonly string[]) {
  const suffix = tokens.join(" ").replace(/\s+/g, " ").trim();
  if (!suffix) {
    return "";
  }
  return suffix.replace(/\bAREA\s+([A-Z])\b/g, "AREA '$1'");
}

function applyDocumentSheetIndexFallback(args: {
  sheets: ExtractedPlanSheet[];
  diagnostics: PlanSheetSelectionDiagnostic[];
  pages: readonly PageExtractionModel[];
}) {
  const entries = buildDocumentSheetIndexEntries(args.pages);
  if (entries.length === 0) {
    return;
  }

  const diagnosticByPage = new Map(
    args.diagnostics.map((diagnostic) => [diagnostic.pageNumber, diagnostic])
  );
  const pageByNumber = new Map(args.pages.map((page) => [page.pageNumber, page]));
  const entryByNumber = new Map(
    entries.map((entry) => [normalizeSheetNumberValue(entry.sheetNumber), entry])
  );

  applyDocumentSheetIndexDirectCrossCheck({
    sheets: args.sheets,
    diagnostics: args.diagnostics,
    pages: args.pages,
    entries,
  });

  for (const sheet of args.sheets) {
    const blankIdentity = !sheet.sheetNumber && !sheet.sheetTitle;
    if (!blankIdentity) {
      continue;
    }

    const page = pageByNumber.get(sheet.pageNumber);
    const localIndexEntry =
      findPageEmbeddedDocumentSheetIndexEntry(page, entries) ??
      findPageLocalDocumentSheetIndexEntry(page, entries);
    if (!localIndexEntry) {
      continue;
    }

    applyDocumentSheetIndexEntryToSheet({
      sheet,
      entry: localIndexEntry.entry,
      numberSourceText: localIndexEntry.sourceText,
      decision: "selected_document_sheet_index_local_number",
      diagnostic: diagnosticByPage.get(sheet.pageNumber),
    });
  }

  const sequenceAlignment = buildDocumentSheetIndexSequenceAlignment({
    entries,
    sheets: args.sheets,
  });
  applyDocumentSheetIndexSequenceGapFallback({
    sheets: args.sheets,
    diagnostics: args.diagnostics,
    pages: args.pages,
    sequence: sequenceAlignment,
  });
  applyDocumentSheetIndexPositionalFallback({
    sheets: args.sheets,
    diagnostics: args.diagnostics,
    pages: args.pages,
    sequence: sequenceAlignment,
  });

  const alignment = findDocumentSheetIndexAlignment(entries, args.sheets);
  if (!alignment) {
    return;
  }

  for (const sheet of args.sheets) {
    let entry = entries[sheet.pageNumber - 1 + alignment.offset];
    if (!entry) {
      continue;
    }

    const currentNumber = normalizeSheetNumberValue(sheet.sheetNumber);
    let entryNumber = normalizeSheetNumberValue(entry.sheetNumber);
    const blankIdentity = !sheet.sheetNumber && !sheet.sheetTitle;
    const localSheetNumber = findPageLocalSheetStampNumber(pageByNumber.get(sheet.pageNumber));
    const localEntry =
      localSheetNumber
        ? entryByNumber.get(localSheetNumber) ??
          findDocumentSheetIndexEntryByNumber(entries, localSheetNumber)
        : null;
    if (currentNumber && localSheetNumber && currentNumber !== localSheetNumber) {
      const currentEntry = entryByNumber.get(currentNumber);
      const currentTitleLooksIndexDerived =
        Boolean(currentEntry?.sheetTitle) &&
        normalizeKey(currentEntry?.sheetTitle ?? "") === normalizeKey(sheet.sheetTitle);
      const preferredLocalTitle = localEntry?.sheetTitle
        ? getPreferredDocumentSheetIndexTitle({
            currentTitle: sheet.sheetTitle,
            indexTitle: localEntry.sheetTitle,
            sheetNumber: localEntry.sheetNumber,
          })
        : null;

      sheet.sheetNumber = localSheetNumber;
      if (
        localEntry?.sheetTitle &&
        (
          !sheet.sheetTitle ||
          currentTitleLooksIndexDerived ||
          Boolean(preferredLocalTitle)
        )
      ) {
        sheet.sheetTitle = preferredLocalTitle ?? localEntry.sheetTitle;
        sheet.titleSourceText = localEntry.sourceText;
        sheet.titleSourceKind = "pdf_text";
      }
      sheet.discipline = inferSheetDiscipline(sheet.sheetNumber, sheet.sheetTitle);
      sheet.confidence = Math.max(sheet.confidence ?? 0, 0.82);
      sheet.referenceText = sheet.referenceText || localEntry?.sourceText || localSheetNumber;
      sheet.numberSourceText = localSheetNumber;
      sheet.numberSourceKind = "pdf_text";

      const diagnostic = diagnosticByPage.get(sheet.pageNumber);
      if (diagnostic) {
        diagnostic.selectionDecision = "selected_local_sheet_stamp_number";
        diagnostic.rejectReason = null;
        diagnostic.selectionGateFailures = [];
        diagnostic.sheetNumber = sheet.sheetNumber;
        diagnostic.sheetTitle = sheet.sheetTitle;
        diagnostic.badForStyleRediscovery = false;
      }

      continue;
    }

    if (blankIdentity && localSheetNumber && localSheetNumber !== entryNumber) {
      if (localEntry) {
        entry = localEntry;
        entryNumber = normalizeSheetNumberValue(entry.sheetNumber);
      } else {
        sheet.sheetNumber = localSheetNumber;
        sheet.discipline = inferSheetDiscipline(sheet.sheetNumber, sheet.sheetTitle);
        sheet.confidence = Math.max(sheet.confidence ?? 0, 0.72);
        sheet.numberSourceText = localSheetNumber;
        sheet.numberSourceKind = "pdf_text";

        const diagnostic = diagnosticByPage.get(sheet.pageNumber);
        if (diagnostic) {
          diagnostic.selectionDecision = "selected_local_sheet_stamp_number";
          diagnostic.rejectReason = null;
          diagnostic.selectionGateFailures = [];
          diagnostic.sheetNumber = sheet.sheetNumber;
          diagnostic.sheetTitle = sheet.sheetTitle;
          diagnostic.badForStyleRediscovery = false;
        }

        continue;
      }
    }

    const numberMatches = Boolean(currentNumber && currentNumber === entryNumber);
    if (!blankIdentity && !numberMatches) {
      continue;
    }

    const preferredIndexTitle = getPreferredDocumentSheetIndexTitle({
      currentTitle: sheet.sheetTitle,
      indexTitle: entry.sheetTitle,
      sheetNumber: entry.sheetNumber,
    });
    const shouldReplaceTitle =
      blankIdentity ||
      Boolean(preferredIndexTitle);
    if (!blankIdentity && !shouldReplaceTitle) {
      continue;
    }

    sheet.sheetNumber = blankIdentity ? entry.sheetNumber : sheet.sheetNumber;
    sheet.sheetTitle = shouldReplaceTitle
      ? preferredIndexTitle ?? entry.sheetTitle
      : sheet.sheetTitle;
    sheet.discipline = inferSheetDiscipline(sheet.sheetNumber, sheet.sheetTitle);
    sheet.confidence = Math.max(sheet.confidence ?? 0, blankIdentity ? 0.82 : 0.86);
    sheet.referenceText = sheet.referenceText || entry.sourceText;
    sheet.numberSourceText = blankIdentity ? entry.sourceText : sheet.numberSourceText;
    sheet.titleSourceText = entry.sourceText;
    sheet.numberSourceKind = blankIdentity ? "pdf_text" : sheet.numberSourceKind;
    sheet.titleSourceKind = "pdf_text";

    const diagnostic = diagnosticByPage.get(sheet.pageNumber);
    if (diagnostic) {
      diagnostic.selectionDecision = blankIdentity
        ? "selected_document_sheet_index_fallback"
        : "selected_document_sheet_index_title";
      diagnostic.rejectReason = null;
      diagnostic.selectionGateFailures = [];
      diagnostic.sheetNumber = sheet.sheetNumber;
      diagnostic.sheetTitle = sheet.sheetTitle;
      diagnostic.badForStyleRediscovery = false;
    }
  }
}

function shouldPreferDocumentReferencedTitle(
  currentTitle: string,
  referencedTitle: string,
  sheetNumber = ""
) {
  const normalizedCurrentTitle = normalizeComparableSheetTitleText(currentTitle);
  const normalizedReferencedTitle = normalizeComparableSheetTitleText(referencedTitle);
  const currentIsGenericAuxiliaryTitle =
    isGenericAuxiliarySheetTitle(normalizedCurrentTitle);
  const referencedIsGenericAuxiliaryTitle =
    isGenericAuxiliarySheetTitle(normalizedReferencedTitle);
  if (!normalizedReferencedTitle) {
    return false;
  }

  if (!normalizedCurrentTitle) {
    return true;
  }

  if (getTextualTitleRejectPenalty(normalizedCurrentTitle) <= -180) {
    return false;
  }

  if (
    isSuspiciousDetectedTitle(normalizedReferencedTitle) &&
    !isSuspiciousDetectedTitle(normalizedCurrentTitle)
  ) {
    return false;
  }
  if (
    isGenericShortOcrTitleHeading(normalizedReferencedTitle) &&
    !isGenericShortOcrTitleHeading(normalizedCurrentTitle)
  ) {
    return false;
  }

  const inferExplicitTitleDisciplineCue = (title: string) => {
    if (/\bELECTRICAL\b/i.test(title)) {
      return "Electrical";
    }
    if (/\bPLUMBING\b/i.test(title)) {
      return "Plumbing";
    }
    if (/\b(?:HVAC|MECHANICAL)\b/i.test(title)) {
      return "Mechanical";
    }
    if (
      /\bSTRUCTURAL\b/i.test(title) ||
      /\bFOUNDATION\b/i.test(title) ||
      /\bFRAMING\b/i.test(title)
    ) {
      return "Structural";
    }
    if (
      /\bCIVIL\b/i.test(title) ||
      /\bGRADING\b/i.test(title) ||
      /\bDRAINAGE\b/i.test(title)
    ) {
      return "Civil";
    }
    return null;
  };

  const normalizedCurrentUpper = normalizeWhitespace(normalizedCurrentTitle).toUpperCase();
  const normalizedReferencedUpper = normalizeWhitespace(normalizedReferencedTitle).toUpperCase();
  const currentIsCoverOrTitleSheet =
    /\b(?:cover|title)\s+sheet$/i.test(normalizedCurrentUpper);
  const referencedIsCoverOrTitleSheet =
    /\b(?:cover|title)\s+sheet$/i.test(normalizedReferencedUpper);
  const referencedSuffix = normalizedReferencedUpper.startsWith(normalizedCurrentUpper)
    ? normalizeWhitespace(
        normalizedReferencedTitle.slice(normalizedCurrentUpper.length)
      ).replace(/^[-:;,\s]+/, "")
    : "";
  if (currentIsCoverOrTitleSheet && !referencedIsCoverOrTitleSheet) {
    return false;
  }
  if (
    /\bLEVEL\s+\d{3}\b/i.test(normalizedCurrentUpper) &&
    !/\bLEVEL\s+\d{3}\b/i.test(normalizedReferencedUpper)
  ) {
    return false;
  }
  if (
    /\bRCP PLAN\b/.test(normalizedCurrentUpper) &&
    /\bREFLECTED CEILING PLAN\b/.test(normalizedReferencedUpper)
  ) {
    const expandedCurrent = normalizedCurrentUpper.replace(
      /\bRCP PLAN\b/g,
      "REFLECTED CEILING PLAN"
    );
    if (
      expandedCurrent === normalizedReferencedUpper ||
      normalizedReferencedUpper.includes(expandedCurrent) ||
      expandedCurrent.includes(normalizedReferencedUpper)
    ) {
      return false;
    }
  }

  const currentScore = scoreTitleSelectionCandidate({
    title: normalizedCurrentTitle,
    sourceKind: "pdf_text",
    sourceText: normalizedCurrentTitle,
  });
  const referencedScore = scoreTitleSelectionCandidate({
    title: normalizedReferencedTitle,
    sourceKind: "pdf_text",
    sourceText: normalizedReferencedTitle,
  });
  const currentVocabularyHits = countTitleVocabularyHits(normalizedCurrentTitle);
  const referencedVocabularyHits = countTitleVocabularyHits(normalizedReferencedTitle);
  const currentHasStrongQualifier =
    /\b(plan|elevations?|details?|sections?|views?|schedule|notes|index|analysis|diagram|plumbing|ceiling|exhaust|hood|guidelines?|measures?|cover|sheet)\b/i.test(
      normalizedCurrentTitle
    );
  const referencedHasStrongQualifier =
    /\b(plan|elevations?|details?|sections?|views?|schedule|notes|index|analysis|diagram|plumbing|ceiling|exhaust|hood|guidelines?|measures?|cover|sheet)\b/i.test(
      normalizedReferencedTitle
    );
  const sharedStrongKeywordCount = (
    normalizeWhitespace(normalizedCurrentTitle).match(
      /\b(plan|elevation|elevations|detail|details|section|sections|view|views|schedule|notes|index|analysis|diagram|plumbing|ceiling|exhaust|hood|guidelines?|measures?|cover|sheet|site|interior|exterior|ada|calgreen)\b/gi
    ) ?? []
  ).filter((keyword, keywordIndex, keywords) => {
    if (keywords.indexOf(keyword) !== keywordIndex) {
      return false;
    }

    return new RegExp(`\\b${keyword}\\b`, "i").test(normalizedReferencedTitle);
  }).length;
  const suffixAddsContext = Boolean(
    referencedSuffix &&
      (
        /\b(building|buildings|north|south|east|west|level|levels|wing|tower|pod|block|area|phase|package)\b/i.test(
          referencedSuffix
        ) ||
        (
          /\bbuildings?\s*$/i.test(normalizedCurrentTitle) &&
          /^[A-Z](?:\s*(?:&|AND|,)\s*[A-Z])+$/.test(referencedSuffix)
        ) ||
        (
          /\bbuilding\s+[A-Z]\s*&\s*$/i.test(normalizedCurrentTitle) &&
          /^[A-Z]$/.test(referencedSuffix)
        )
      )
  );
  const suffixAddsQualifier = Boolean(
    referencedSuffix &&
      /\b(plan|elevations?|details?|sections?|views?|schedule|notes|index|analysis|diagram|plumbing|ceiling|exhaust|hood)\b/i.test(
        referencedSuffix
      )
  );
  const suffixLooksMetadata = Boolean(
    referencedSuffix &&
      (
        /\b(addendum|appl\b|application|review by|drawn by|plot date|issue date|job\b|project number|sheet number|state)\b/i.test(
          referencedSuffix
        ) ||
        matchesAdministrativeTitleMetadata(referencedSuffix) ||
        matchesJobNumberMetadata(referencedSuffix) ||
        matchesVendorReferencePageMetadata(referencedSuffix) ||
        /\bsheet:?\s*$/i.test(referencedSuffix) ||
        /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(referencedSuffix)
      )
  );
  const referencedAddsLocationContext =
    /\b(building|buildings|north|south|east|west|level|levels|wing|tower|pod|block|area|phase|package)\b/i.test(
      normalizedReferencedTitle
    );
  const currentHasAlternate = /\bALTERNATE\s*#?\s*\d+\b/i.test(
    normalizedCurrentTitle
  );
  const referencedHasAlternate = /\bALTERNATE\s*#?\s*\d+\b/i.test(
    normalizedReferencedTitle
  );
  const currentModifiers = new Set(
    extractImportantOcrTitleModifiers(normalizedCurrentTitle)
  );
  const referencedModifiers = new Set(
    extractImportantOcrTitleModifiers(normalizedReferencedTitle)
  );
  const currentExclusiveImportantModifierCount = [...currentModifiers].filter(
    (modifier) =>
      !referencedModifiers.has(modifier) &&
      /^(?:electrical|plumbing|structural|mechanical|hvac|door|hardware|window|glazing|restroom|accessibility|foundation|framing|enlarged|site|ramp|parking|existing|removal|construction|building|buildings|north|south|east|west|interior|exterior)$/.test(
        modifier
      )
  ).length;
  const currentExplicitDisciplineCue =
    inferExplicitTitleDisciplineCue(normalizedCurrentTitle);
  const referencedExplicitDisciplineCue =
    inferExplicitTitleDisciplineCue(normalizedReferencedTitle);
  const sheetDiscipline = sheetNumber
    ? inferSheetDiscipline(sheetNumber, normalizedCurrentTitle)
    : null;

  if (
    referencedSuffix &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    suffixLooksMetadata
  ) {
    return false;
  }

  if (
    referencedSuffix &&
    currentHasStrongQualifier &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    suffixLooksMetadata
  ) {
    return false;
  }

  if (
    currentHasStrongQualifier &&
    referencedHasStrongQualifier &&
    currentScore >= 72 &&
    sharedStrongKeywordCount === 0 &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    !currentIsGenericAuxiliaryTitle
  ) {
    return false;
  }
  if (
    referencedExplicitDisciplineCue &&
    currentScore >= 64 &&
    currentHasStrongQualifier &&
    (
      (
        currentExplicitDisciplineCue &&
        referencedExplicitDisciplineCue !== currentExplicitDisciplineCue
      ) ||
      (
        sheetDiscipline &&
        referencedExplicitDisciplineCue !== sheetDiscipline &&
        !currentExplicitDisciplineCue
      )
    ) &&
    sharedStrongKeywordCount <= 2 &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    !currentIsGenericAuxiliaryTitle
  ) {
    return false;
  }
  if (currentHasAlternate && !referencedHasAlternate) {
    return false;
  }
  if (
    currentExclusiveImportantModifierCount > 0 &&
    currentScore >= referencedScore - 8 &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    !currentIsGenericAuxiliaryTitle
  ) {
    return false;
  }
  if (
    candidateDropsImportantCurrentTitleContext(
      normalizedCurrentTitle,
      normalizedReferencedTitle
    ) &&
    currentScore >= referencedScore - 24 &&
    sharedStrongKeywordCount <= 2 &&
    !suffixAddsContext &&
    !suffixAddsQualifier &&
    !currentIsGenericAuxiliaryTitle
  ) {
    return false;
  }

  if (
    currentIsGenericAuxiliaryTitle &&
    !referencedIsGenericAuxiliaryTitle &&
    referencedHasStrongQualifier &&
    !suffixLooksMetadata &&
    (
      suffixAddsContext ||
      suffixAddsQualifier ||
      referencedAddsLocationContext ||
      referencedVocabularyHits >= currentVocabularyHits + 1 ||
      normalizedReferencedTitle.length > normalizedCurrentTitle.length + 8
    ) &&
    referencedScore >= currentScore - 28
  ) {
    return true;
  }

  return (
    referencedScore >= currentScore + 12 ||
    (
      referencedScore >= currentScore - 4 &&
      normalizedReferencedTitle.length > normalizedCurrentTitle.length + 6
    ) ||
    (
      referencedHasStrongQualifier &&
      !currentHasStrongQualifier &&
      referencedVocabularyHits >= currentVocabularyHits
    ) ||
    (
      referencedVocabularyHits >= currentVocabularyHits + 1 &&
      normalizedReferencedTitle.length >= normalizedCurrentTitle.length - 4
    )
  );
}

function repairSheetTitleConnectors(title: string) {
  const normalized = normalizeWhitespace(title);
  if (!normalized) {
    return "";
  }

  return normalizeDocumentSheetIndexTitle(
    normalized
      .replace(/\s+\b(?:BUILDING\s+ID|PROJECT\s+NO\.?|PROJ\.?\s+NO\.?|STANTEC\s+NO\.?|KP\s+PROJ\.?\s+NO\.?)\s*:?\s*$/gi, "")
      .replace(/\bHEAD\s*-\s*OF\s*-\s*WALL\b/gi, "HEAD-OF-WALL")
      .replace(/\b([A-Z]{2,})\s+-\s+([A-Z]{2,})(?=\s+VENDOR\s+DRAWINGS?\b)/g, "$1-$2")
      .replace(/\s{2,}/g, " ")
      .trim()
  )
    .replace(/\bHEAD\s+-\s+OF\s+-\s+WALL\b/gi, "HEAD-OF-WALL")
    .replace(/\b([A-Z]{2,})\s+-\s+([A-Z]{2,})(?=\s+VENDOR\s+DRAWINGS?\b)/g, "$1-$2");
}

function repairSheetTitleWithSheetNumberContext(title: string, sheetNumber: string) {
  const normalizedNumber = normalizeSheetNumberValue(sheetNumber);
  const normalizedTitle = repairSheetTitleConnectors(title)
    .replace(/\bONE\s*-\s*LINE\b/gi, "ONE LINE")
    .replace(/\s+-\s+[A-Z]\s+(?=BUILDINGS?\b)/gi, " - ")
    .replace(/\s+\b[A-Z]\s+[A-Z]\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!normalizedTitle || !normalizedNumber) {
    return normalizedTitle;
  }

  const titleUpper = normalizedTitle.toUpperCase();
  const prefix = parseSheetNumberParts(normalizedNumber)?.prefix ?? "";
  const hasGenericSheetTitle =
    /\b(?:COVER|PLAN|PLANS|SITE|LIGHTING|POWER|SIGNAL|DIAGRAM|DETAILS?|SCHEDULES?|LEGEND|NOTES?|RISER|ISOMETRIC|CALCULATIONS?)\b/i.test(
      normalizedTitle
    );
  if (!hasGenericSheetTitle) {
    return normalizedTitle;
  }

  const prependFamily = (family: string) => {
    if (titleUpper.includes(family)) {
      return normalizedTitle;
    }
    return `${family} ${normalizedTitle}`.replace(/\s{2,}/g, " ").trim();
  };

  if (/^E(?:L)?\d/i.test(normalizedNumber) && !/^EP/i.test(normalizedNumber)) {
    if (/^FORMS?(?:\s|$)/i.test(normalizedTitle)) {
      return normalizedTitle;
    }
    if (/^EL/i.test(prefix)) {
      return prependFamily("ELECTRICAL");
    }
    if (
      /\b(?:COVER|SINGLE\s+LINE\s+DIAGRAM|NEW\s+SITE\s+PLAN|DEMOLITION\s+SITE\s+PLAN)\b/i.test(
        normalizedTitle
      )
    ) {
      return prependFamily("ELECTRICAL").replace(
        /\bELECTRICAL COVER$/i,
        "ELECTRICAL COVER SHEET"
      );
    }
    return normalizedTitle;
  }

  if (/^FA/i.test(prefix)) {
    return prependFamily("FIRE ALARM").replace(
      /\bFIRE ALARM COVER$/i,
      "FIRE ALARM COVER SHEET"
    );
  }

  if (/^FP/i.test(prefix)) {
    return prependFamily("FIRE PROTECTION").replace(
      /\bFIRE PROTECTION COVER$/i,
      "FIRE PROTECTION COVER SHEET"
    );
  }

  if (/^P/i.test(prefix) && !/^PM/i.test(prefix)) {
    return prependFamily("PLUMBING");
  }

  if (/^T/i.test(prefix)) {
    if (/\b(?:COVER|ONE\s+LINE\s+DIAGRAM)\b/i.test(normalizedTitle)) {
      return prependFamily("TECHNOLOGY").replace(
        /\bTECHNOLOGY COVER$/i,
        "TECHNOLOGY COVER SHEET"
      );
    }
    return normalizedTitle;
  }

  return normalizedTitle;
}

function isLikelyBodySentenceTitleRepairCandidate(title: string) {
  const normalized = normalizeWhitespace(title);
  if (!normalized) {
    return true;
  }

  const titleVocabularyHits = countTitleVocabularyHits(normalized);
  const hasStrongTitleSignal =
    matchesTitleLikeVocabulary(normalized) ||
    hasCompactTechnicalTitleSignal(normalized) ||
    isCanonicalSheetIndexTitle(normalized);

  if (
    titleVocabularyHits === 0 &&
    /\b(?:IS|ARE|WAS|WERE|BE|BEEN|SHALL|WILL|MUST|PROVIDE|INSTALL|VERIFY|INDICATED|ACCEPTABLE|INCORPORATION|ACCESSIBLE|ACCESS|COMPLY|REQUIRED|REFER|SEE|NOTED|LOCATED|MOUNTED|CENTERED|CONTRACTOR|OWNER)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    !hasStrongTitleSignal &&
    /\b(?:ON\s+PLAN|PER\s+PLAN|PER\s+DETAIL|DSA\s*#|T\.?\s*O\.?|N\.?\s*T\.?\s*S\.?|DIA\.?|GA\.?|THW|THWN|CONDUCTORS?|STUDS?|RECTANGLE|SQUARE|CIRCLE|BARRIER\s+FREE)\b/i.test(
      normalized
    )
  ) {
    return true;
  }

  if (
    !hasStrongTitleSignal &&
    (/\d+\s*['"]\s*-\s*\d+/.test(normalized) ||
      /\d+\s*\/\s*\d+/.test(normalized) ||
      /#\s*\d/.test(normalized))
  ) {
    return true;
  }

  return false;
}

function isLikelyContaminatedDrawingBodyTitleSource(title: string, sourceText: string) {
  const normalizedTitle = normalizeWhitespace(title);
  const normalizedSource = normalizeWhitespace(sourceText || title);
  if (!normalizedTitle || !normalizedSource) {
    return false;
  }

  const sourceLineCount = (sourceText.match(/\r?\n/g) ?? []).length + (sourceText ? 1 : 0);
  const compactCleanTitle =
    countWords(normalizedTitle) <= 5 &&
    (
      /\b(?:DETAILS?|SECTIONS?|SCHEDULES?|LEGEND|NOTES?|PLAN|PLANS|DIAGRAM|COVER\s+SHEET|TITLE\s+SHEET)\b/i.test(
        normalizedTitle
      ) ||
      hasCompactTechnicalTitleSignal(normalizedTitle) ||
      isCanonicalSheetIndexTitle(normalizedTitle)
    );
  if (
    compactCleanTitle &&
    normalizeComparableSheetTitleText(normalizedSource).startsWith(
      normalizeComparableSheetTitleText(normalizedTitle)
    ) &&
    sourceLineCount <= 2
  ) {
    return false;
  }

  if (
    /\b(?:INDICATED\s+ON\s+PLAN|BARRIER\s+FREE\s+ACCESS|ACCEPTABLE\s+FOR\s+INCORPORATION|PAINTED\s+TO\s+MATCH\s+ROOF\s+SURFACE|INCH\s+RECTANGLE|CONDUCTOR\s+TYPE\s+THW|STROKE\s*-?\s*WIDTH|BRAILLE\s+TEXT)\b/i.test(
      `${normalizedTitle} ${normalizedSource}`
    )
  ) {
    return true;
  }

  const titleVocabularyHits = countTitleVocabularyHits(normalizedTitle);
  const contaminationMarkers =
    /\b(?:TYP\.?|SEE\s+DETAIL|O\.C\.|DIA\.?|KWIK|ANCHOR|EMBED|CONDUIT|CONDUCTORS?|STUDS?|BRAILLE|COMPLIES|REPAINT|STRIPING|PAINT|PARKING|MIN\.?\s+HEIGHT|ROOF\s+SURFACE|SHEET\s+METAL|WALL\s+FINISH|FINISH\s+SCHEDULE|ARCH\s+SHEETS)\b/i.test(
      normalizedSource
    );
  const hasMeasurements =
    /\d+\s*['"]|\d+\s*\/\s*\d+|#\s*\d|\b\d{2,}\s*(?:O\.C\.|GA\.?|DIA\.?)\b/i.test(
      normalizedSource
    );
  const sourceMuchLonger = normalizedSource.length >= normalizedTitle.length + 45;

  return Boolean(
    contaminationMarkers &&
      (hasMeasurements || sourceLineCount >= 3 || sourceMuchLonger) &&
      (
        titleVocabularyHits <= 1 ||
        !/\b(?:SITE\s+DETAILS|WALL\s+SECTIONS|HVAC\s+DETAILS|OPENING\s+SCHEDULE|EXTERIOR\s+AND\s+INTERIOR\s+DETAILS)\b/i.test(
          normalizedTitle
        )
      )
  );
}

function titleLooksLikeSafeSourceRepair(currentTitle: string, repairedTitle: string) {
  const current = normalizeWhitespace(currentTitle);
  const repaired = normalizeWhitespace(repairedTitle);
  if (!current || !repaired || normalizeKey(current) === normalizeKey(repaired)) {
    return false;
  }
  if (repaired.length <= current.length + 3 || repaired.length > current.length + 80) {
    return false;
  }
  if (isSevereSheetIdentityTitleNoise(repaired, repaired) || isSuspiciousDetectedTitle(repaired)) {
    return false;
  }
  if (isLikelyBodySentenceTitleRepairCandidate(repaired)) {
    return false;
  }

  const currentTokens = normalizeComparableSheetTitleText(current)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2);
  const repairedTokens = new Set(
    normalizeComparableSheetTitleText(repaired)
      .split(/[^A-Z0-9]+/)
      .filter((token) => token.length >= 2)
  );
  if (currentTokens.length === 0) {
    return false;
  }
  const coveredTokens = currentTokens.filter((token) => repairedTokens.has(token)).length;
  const coverage = coveredTokens / currentTokens.length;
  if (coverage < 0.75) {
    return false;
  }

  const currentComparable = normalizeComparableSheetTitleText(current);
  const repairedComparable = normalizeComparableSheetTitleText(repaired);
  const currentVocabularyHits = countTitleVocabularyHits(current);
  const repairedVocabularyHits = countTitleVocabularyHits(repaired);
  const currentIsCoverOrTitleSheet = /\b(?:COVER|TITLE)\s+SHEET\b/.test(currentComparable);
  const repairedIsCoverOrTitleSheet = /\b(?:COVER|TITLE)\s+SHEET\b/.test(repairedComparable);
  if (currentIsCoverOrTitleSheet && !repairedIsCoverOrTitleSheet) {
    return false;
  }

  const hasStrongRepairSignal =
    repairedVocabularyHits >= Math.max(1, currentVocabularyHits) ||
    hasCompactTechnicalTitleSignal(repaired) ||
    isCanonicalSheetIndexTitle(repaired);
  if (!hasStrongRepairSignal) {
    return false;
  }

  const addsUsefulQualifier =
    /\b(?:BUILDINGS?|LEVEL|FLOOR|AREA|PHASE|NORTH|SOUTH|EAST|WEST|ROOF|BASEMENT|MEZZANINE|ENLARGED|PARTIAL|OVERALL|FIRST|SECOND|THIRD)\b/i.test(
      repaired
    ) &&
    !/\b(?:BUILDINGS?|LEVEL|FLOOR|AREA|PHASE|NORTH|SOUTH|EAST|WEST|ROOF|BASEMENT|MEZZANINE|ENLARGED|PARTIAL|OVERALL|FIRST|SECOND|THIRD)\b/i.test(
      current
    );
  const currentLooksTruncated =
    countWords(current) <= 3 ||
    /\b(?:PLAN|PLANS|DETAIL|DETAILS|SCHEDULE|SCHEDULES|ELEVATION|ELEVATIONS|SECTION|SECTIONS|ANALYSIS|NOTES?|LEGENDS?)\b/i.test(
      current
    );
  if (!addsUsefulQualifier && !currentLooksTruncated) {
    return false;
  }

  return (
    repairedVocabularyHits >= currentVocabularyHits ||
    hasCompactTechnicalTitleSignal(repaired) ||
    isCanonicalSheetIndexTitle(repaired)
  );
}

function repairSheetTitleFromSourceText(args: {
  currentTitle: string;
  sourceText: string | null | undefined;
  sheetNumber: string;
}) {
  const currentTitle = normalizeWhitespace(args.currentTitle);
  const sourceLines = normalizeWhitespace(args.sourceText ?? "")
    .split(/\r?\n| {2,}/)
    .map((line) => normalizeTitleSelectionText(line))
    .filter((line) => {
      if (!line) {
        return false;
      }
      if (normalizeSheetNumberValue(line) === normalizeSheetNumberValue(args.sheetNumber)) {
        return false;
      }
      if (isDocumentSheetIndexNoiseLine(line) || isMetadataLabelOnlyTitleText(line)) {
        return false;
      }
      if (isDateLikeTitleLineText(line) || matchesAdministrativeTitleMetadata(line)) {
        return false;
      }
      return true;
    });
  if (sourceLines.length === 0) {
    return "";
  }

  const candidates = new Set<string>();
  for (let start = 0; start < sourceLines.length; start += 1) {
    for (let end = start; end < Math.min(sourceLines.length, start + 5); end += 1) {
      const candidate = repairSheetTitleConnectors(sourceLines.slice(start, end + 1).join(" "));
      if (candidate) {
        candidates.add(candidate);
      }
    }
  }

  let best = "";
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    if (!titleLooksLikeSafeSourceRepair(currentTitle, candidate)) {
      continue;
    }
    const score =
      scoreTitleSelectionCandidate({
        title: candidate,
        sourceKind: "pdf_text",
        sourceText: args.sourceText ?? candidate,
      }) +
      scoreComparableTitleOverlap(candidate, currentTitle) * 80 +
      Math.min(candidate.length - currentTitle.length, 60);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function shouldRunOcrForPage(args: {
  sheetNumber: string;
  sheetTitle: string;
  confidence: number | null;
}) {
  if (PLAN_SHEET_IMPORT_FORCE_OCR_ALL_PAGES) {
    return true;
  }

  const sheetNumber = normalizeSheetNumberValue(args.sheetNumber);
  const sheetTitle = normalizeWhitespace(args.sheetTitle);
  const confidence = args.confidence ?? 0;

  if (!sheetNumber || !sheetTitle) {
    return true;
  }

  if (confidence < 0.86) {
    return true;
  }

  if (isSuspiciousDetectedTitle(sheetTitle)) {
    return true;
  }

  if (
    countTitleVocabularyHits(sheetTitle) === 0 &&
    !hasCompactTechnicalTitleSignal(sheetTitle) &&
    !isLikelySheetTitle(sheetTitle) &&
    !isAllowedSingleWordTitle(sheetTitle)
  ) {
    return true;
  }

  return false;
}

function countSuccessfulPdfTextResults(results: ReadonlyMap<number, PdfTextExtractionResult>) {
  let count = 0;
  for (const result of results.values()) {
    if (result) {
      count += 1;
    }
  }
  return count;
}

function shouldRetryRemainingOcrWithoutSeed(args: {
  seededLockedRegionPattern: LockedOcrRegionPattern | null;
  remainingPageCount: number;
  successfulResultCount: number;
}) {
  return Boolean(
    args.seededLockedRegionPattern &&
      args.remainingPageCount >= OCR_REGION_PATTERN_SEEDED_RETRY_MIN_REMAINING_PAGES &&
      args.successfulResultCount <= OCR_REGION_PATTERN_SEEDED_RETRY_MAX_ACCEPTED_RESULTS
  );
}

function buildDiscoveryModelSheet(args: {
  page: PageExtractionModel;
  ocrResult: PdfTextExtractionResult;
  pdfPair: PairedSheetCandidate | null;
  fallbackNumberResult: ReturnType<typeof detectSheetNumber>;
  fallbackTitleResult: DetectedSheetTitle;
}): TrainingModelSheet {
  const ocrResult = args.ocrResult;
  const preferredNumber =
    ocrResult?.sheetNumber ||
    args.pdfPair?.sheetNumber ||
    args.fallbackNumberResult.sheetNumber ||
    "";
  const preferredTitle =
    ocrResult?.sheetTitle ||
    args.pdfPair?.sheetTitle ||
    args.fallbackTitleResult.title ||
    "";
  const confidence =
    ocrResult?.confidence ??
    args.pdfPair?.confidence ??
    args.fallbackNumberResult.confidence ??
    null;
  const numberSourceKind = ocrResult?.sheetNumber
    ? "ocr"
    : args.pdfPair?.sheetNumber
      ? "pdf_text"
      : args.fallbackNumberResult.sheetNumber
        ? "pdf_text"
        : null;
  const titleSourceKind = ocrResult?.sheetTitle
    ? "ocr"
    : args.pdfPair?.sheetTitle
      ? "pdf_text"
      : args.fallbackTitleResult.title
        ? "pdf_text"
        : null;

  return {
    id: `discovery-page-${args.page.pageNumber}`,
    sheet_number: preferredNumber,
    sheet_title: preferredTitle,
    discipline: inferSheetDiscipline(preferredNumber, preferredTitle),
    page_number: args.page.pageNumber,
    extraction_confidence: confidence,
    extracted_text: args.page.lines.map((line) => line.text).join("\n"),
    number_source_text:
      ocrResult?.numberSourceText ??
      args.pdfPair?.numberSourceText ??
      args.fallbackNumberResult.winner?.lineText ??
      preferredNumber,
    number_source_kind: numberSourceKind,
    title_source_text:
      ocrResult?.titleSourceText ??
      args.pdfPair?.titleSourceText ??
      args.fallbackTitleResult.sourceText ??
      preferredTitle,
    title_source_kind: titleSourceKind,
    preview_image_path: null,
    preview_storage_key: null,
  };
}

function inferSeedLockedPatternFromDiscoveryAssists(
  _assists: PlanSheetImportResolverResult[],
  options?: {
    fallbackObservations?: OcrRegionPatternObservation[];
    fallbackPattern?: LockedOcrRegionPattern | null;
    patternId?: string;
  }
) {
  return options?.fallbackPattern ?? null;
}

function looksLikeGenericPdfPlanFamilyTitle(title: string) {
  const normalized = normalizeComparableSheetTitleText(title);
  if (!normalized) {
    return false;
  }

  return /^(?:BUILDING\s+[A-Z0-9/&,\s.-]+\s*-\s*)?(?:FLOOR PLAN|ROOF PLAN|RCP|REFLECTED CEILING PLAN|EXTERIOR ELEVATIONS)$/.test(
    normalized
  );
}

function looksLikePdfSupportSheetTitle(title: string) {
  const normalized = normalizeComparableSheetTitleText(title);
  if (!normalized) {
    return false;
  }

  return /\b(?:DETAILS?|SCHEDULES?|LEGENDS?|NOTES?|INDEX|COVER|ABBREVIATIONS?|SYMBOLS?|FIXTURE SPECIFICATION|PROJECT DATA)\b/.test(
    normalized
  );
}

function shouldSuppressDirectPdfPairSelection(args: {
  pdfTitleText: string;
  ocrPairUsable: boolean;
  ocrTitleText: string;
}) {
  const normalizedPdfTitle = normalizeComparableSheetTitleText(args.pdfTitleText);
  if (!normalizedPdfTitle) {
    return false;
  }

  if (looksLikePdfSupportSheetTitle(normalizedPdfTitle)) {
    return false;
  }

  if (looksLikeGenericPdfPlanFamilyTitle(normalizedPdfTitle)) {
    return true;
  }

  return (
    args.ocrPairUsable &&
    looksLikeGenericPdfPlanFamilyTitle(args.ocrTitleText || normalizedPdfTitle)
  );
}

function chooseMoreCompleteSameNumberPdfPairCandidate(args: {
  currentSheetNumber?: string | null;
  currentTitle?: string | null;
  currentPairScore?: number | null;
  candidates: readonly PairedSheetCandidate[];
}) {
  const currentNumber = normalizeSheetNumberValue(args.currentSheetNumber ?? "");
  const currentTitle = normalizeTitleSelectionText(args.currentTitle ?? "");
  if (!currentNumber || !currentTitle || args.candidates.length === 0) {
    return null;
  }

  const currentTokens = getDocumentSheetIndexAutocompleteTokens(
    currentTitle,
    currentNumber
  );
  const currentTokenSet = new Set(currentTokens);
  const currentIsWeakGenericTitle =
    countWords(currentTitle) <= 2 ||
    isGenericShortOcrTitleHeading(currentTitle) ||
    looksLikePdfSupportSheetTitle(currentTitle);

  let best: { candidate: PairedSheetCandidate; score: number } | null = null;
  for (const candidate of args.candidates) {
    if (
      normalizeDocumentReferenceComparisonNumber(candidate.sheetNumber) !==
      normalizeDocumentReferenceComparisonNumber(currentNumber)
    ) {
      continue;
    }

    const candidateTitle = normalizeTitleSelectionText(candidate.sheetTitle);
    if (
      !candidateTitle ||
      normalizeKey(candidateTitle) === normalizeKey(currentTitle) ||
      isSuspiciousDetectedTitle(candidateTitle) ||
      isRegulatoryOrScopeNoteText(candidate.titleSourceText || candidateTitle)
    ) {
      continue;
    }

    if (
      Number.isFinite(args.currentPairScore ?? NaN) &&
      candidate.score < (args.currentPairScore ?? 0) - 220
    ) {
      continue;
    }

    const candidateTokens = getDocumentSheetIndexAutocompleteTokens(
      candidateTitle,
      candidate.sheetNumber
    );
    if (candidateTokens.length <= currentTokens.length) {
      continue;
    }

    const candidateTokenSet = new Set(candidateTokens);
    const sharedTokenCount = currentTokens.filter((token) =>
      candidateTokenSet.has(token)
    ).length;
    const candidateContainsCurrent =
      currentTokens.length > 0 && sharedTokenCount === currentTokens.length;
    const candidateAddsUsefulTitleContext = candidateTokens
      .filter((token) => !currentTokenSet.has(token))
      .some((token) =>
        /^(?:ADA|MAAB|LIFE|SAFETY|PLAN|PLANS|DETAILS|NOTES|ELEVATIONS|SECTIONS|SCHEDULE|SCHEDULES|FLOOR|CEILING|REFLECTED|DEMOLITION|CONSTRUCTION|OVERALL|PARTIAL|GENERAL|PROJECT|INFORMATION|SITE|AERIAL|PHOTOGRAPH|LIGHTING|UTILITY|GRADING|LANDSCAPE|AREA|BUILDING|FIRST|SECOND|THIRD)$/.test(
          token
        )
      );
    if (
      !candidateContainsCurrent ||
      !candidateAddsUsefulTitleContext ||
      (!currentIsWeakGenericTitle &&
        scoreComparableTitleOverlap(currentTitle, candidateTitle) < 0.55)
    ) {
      continue;
    }

    const titleEvaluation = evaluateTitleSelection({
      title: candidateTitle,
      sourceKind: "pdf_text",
      sourceText: candidate.titleSourceText || candidateTitle,
    });
    if (!titleEvaluation || titleEvaluation.score < 24) {
      continue;
    }

    const completenessScore =
      titleEvaluation.score +
      candidate.score * 0.1 +
      Math.min(candidateTokens.length - currentTokens.length, 6) * 18 +
      (candidate.titleReasonCodes?.includes("multiline_title") ? 28 : 0) +
      (candidate.titleCandidateTypeGuess === "drawing_title" ? 20 : 0);
    if (!best || completenessScore > best.score) {
      best = { candidate, score: completenessScore };
    }
  }

  return best?.candidate ?? null;
}

function buildBestRightEdgeRotatedTitleForSheetNumber(args: {
  page: PageExtractionModel;
  sheetNumber?: string | null;
  pageNumber: number;
  documentTitleStyleProfile?: DocumentTitleStyleProfile | null;
}) {
  const normalizedSheetNumber = normalizeSheetNumberValue(args.sheetNumber ?? "");
  if (!normalizedSheetNumber) {
    return null;
  }

  const sourceLines = [...(args.page.searchLines ?? []), ...args.page.lines];
  const numberLine = sourceLines
    .filter(
      (line) =>
        normalizeSheetNumberValue(line.text) === normalizedSheetNumber &&
        getLineCenterX(line) >= 0.84 &&
        getLineCenterY(line) >= 0.72
    )
    .sort((left, right) => getLineCenterY(right) - getLineCenterY(left))[0];
  if (!numberLine) {
    return null;
  }

  const titleLines = collectRightEdgeRotatedTitleLines(args.page, numberLine);
  if (titleLines.length === 0) {
    return null;
  }

  const titlePage = buildPageModelFromLines(args.page.pageNumber, titleLines);
  return buildBestRightEdgeRotatedTitleCandidate({
    page: titlePage,
    titleLines,
    numberLine,
    pageNumber: args.pageNumber,
    regionBias: 34,
    documentStyleProfile: args.documentTitleStyleProfile,
  });
}

function chooseMoreCompleteDirectStampFallbackTitle(args: {
  currentTitle?: string | null;
  fallbackTitle?: string | null;
  fallbackSourceText?: string | null;
}) {
  const currentTitle = normalizeTitleSelectionText(args.currentTitle ?? "");
  const fallbackTitle = normalizeTitleSelectionText(args.fallbackTitle ?? "");
  if (!currentTitle || !fallbackTitle) {
    return currentTitle || fallbackTitle;
  }

  const currentLooksLikeDrawingTitle =
    countTitleVocabularyHits(currentTitle) >= 2 || hasExplicitTitleFamily(currentTitle);
  const currentLooksLikeRevisionAdmin =
    /\b(?:NO DESCRIPTION|REVISIONS?|ADDENDUM|CONSTRUCTION)\b/i.test(currentTitle) &&
    !currentLooksLikeDrawingTitle;
  if (
    currentLooksLikeRevisionAdmin &&
    (
      isTrustworthyCompactNumberOverTitleText(fallbackTitle) ||
      (
        countWords(fallbackTitle) >= 2 &&
        countWords(fallbackTitle) <= 8 &&
        getTextualTitleRejectPenalty(fallbackTitle) > -120
      )
    ) &&
    !isSuspiciousDetectedTitle(fallbackTitle)
  ) {
    return fallbackTitle;
  }

  if (fallbackTitle.length <= currentTitle.length + 3) {
    return currentTitle || fallbackTitle;
  }

  const currentKey = normalizeKey(currentTitle);
  const fallbackKey = normalizeKey(fallbackTitle);
  if (!currentKey || !fallbackKey.startsWith(currentKey)) {
    return currentTitle;
  }

  const sourceLines = (args.fallbackSourceText ?? "")
    .split(/\r?\n/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  const currentLooksTruncated = /(?:-|(?:\b(?:AND|OR|WITH|FOR|OF|TO)))\s*$/i.test(
    currentTitle
  );
  const directStampStackLooksBounded =
    sourceLines.length >= 2 &&
    sourceLines.length <= 5 &&
    sourceLines.every((line) => isDirectStampTitleValue(line));

  if (
    directStampStackLooksBounded &&
    (
      currentLooksTruncated ||
      countWords(fallbackTitle) <= countWords(currentTitle) + 3
    ) &&
    !isSuspiciousDetectedTitle(fallbackTitle)
  ) {
    return fallbackTitle;
  }

  return currentTitle;
}

async function runOcrExtractionsForPages(
  _fileBytes: Uint8Array,
  pages: Array<{ pageNumber: number; lines: TextLine[] }>,
  _preferredStyleProfile: MetadataStyleProfile,
  _pageDebugBoxesByPage: ReadonlyMap<number, MetadataBoxCandidate[]>,
  debugSession: PlanSheetImportDebugSession,
  _options?: Record<string, unknown>
) {
  debugSession.log("ocr.runtime_removed", {
    requestedPageCount: pages.length,
    requestedPageNumbers: pages.map((page) => page.pageNumber),
    mode: "pdf_only",
  });
  return new Map<number, PdfTextExtractionResult>();
}

function buildPlanSheetImportReplayInput(args: {
  pageCount: number;
  pages: readonly PageExtractionModel[];
}): PlanSheetImportReplayInput {
  return {
    version: 1,
    pageCount: args.pageCount,
    pages: [...args.pages],
  };
}

function preparePlanSheetSelectionContext(args: {
  pages: readonly PageExtractionModel[];
  pageCount: number;
  debugSession: PlanSheetImportDebugSession;
}): PreparedPlanSheetSelectionContext {
  const exactCounts: Record<string, number> = {};
  const prefixCounts: Record<string, number> = {};
  const repeatedLineCounts: Record<string, number> = {};

  args.pages.forEach((page) => {
    const seenLineKeys = new Set<string>();

    page.candidates.forEach((candidate) => {
      const key = normalizeKey(candidate.value);
      if (key) {
        exactCounts[key] = (exactCounts[key] ?? 0) + 1;
      }

      if (candidate.prefix) {
        prefixCounts[candidate.prefix] = (prefixCounts[candidate.prefix] ?? 0) + 1;
      }
    });

    page.lines.forEach((line) => {
      const lineKey = normalizeKey(line.text);
      if (!lineKey || seenLineKeys.has(lineKey)) return;
      seenLineKeys.add(lineKey);
      repeatedLineCounts[lineKey] = (repeatedLineCounts[lineKey] ?? 0) + 1;
    });
  });

  const documentReferencedSheetTitles = buildDocumentReferencedSheetTitleMap(args.pages);
  const documentTitleStyleProfile = buildDocumentTitleStyleProfile(args.pages);
  const pdfRawBoxCandidateGroups = args.pages.map((page) =>
    buildMetadataBoxCandidatesForPage(page)
  );
  const pdfPairCandidateGroups = args.pages.map((page, index) =>
    buildPdfPairCandidatesForPage({
      page,
      exactCounts,
      prefixCounts,
      repeatedLineCounts,
      totalPages: args.pageCount,
      rawBoxes: pdfRawBoxCandidateGroups[index] ?? [],
      documentTitleStyleProfile,
    })
  );
  const familyLock = inferDocumentFamilyLock(pdfPairCandidateGroups);
  args.debugSession.log("family.summary", {
    selectedFamily: familyLock.styleProfile,
    locked: familyLock.locked,
    supportPages: familyLock.supportPages,
    supportScore: Number(familyLock.supportScore.toFixed(1)),
    runnerUpFamily: familyLock.runnerUpStyleProfile,
    runnerUpPages: familyLock.runnerUpPages,
    runnerUpScore: Number(familyLock.runnerUpScore.toFixed(1)),
  });
  const candidateStyleProfile = inferDocumentStyleProfile(pdfPairCandidateGroups);
  const documentStyleProfile = familyLock.locked
    ? familyLock.styleProfile
    : candidateStyleProfile;
  const provisionalPdfPairs = pdfPairCandidateGroups.map(
    (candidates) => candidates[0] ?? null
  );
  const strongPrefixCounts = inferStrongPrefixCounts(provisionalPdfPairs);

  const pdfDetections: PagePairDetection[] = args.pages.map((page, index) => {
    const localizedBottomRightFallback = buildLocalizedBottomRightFallback({
      page,
      exactCounts,
      prefixCounts,
      documentTitleStyleProfile,
    });
    const fallbackNumberResult =
      localizedBottomRightFallback?.fallbackNumberResult ??
      createEmptySheetNumberDetection();
    const fallbackTitleResult =
      localizedBottomRightFallback?.fallbackTitleResult ??
      createEmptyDetectedSheetTitle();
    const pdfPair = selectBestPdfPairCandidate({
      page,
      candidates: pdfPairCandidateGroups[index] ?? [],
      styleProfile: documentStyleProfile,
      strongPrefixCounts,
      provisionalSelections: provisionalPdfPairs,
      pageNumber: page.pageNumber,
    });

    return {
      page,
      pdfPair: pdfPair && pdfPair.score >= PDF_PAIR_MIN_SCORE ? pdfPair : null,
      fallbackNumberResult,
      fallbackTitleResult,
    };
  });

  return {
    exactCounts,
    prefixCounts,
    repeatedLineCounts,
    documentTitleStyleProfile,
    documentReferencedSheetTitles,
    pdfRawBoxCandidateGroups,
    pdfPairCandidateGroups,
    familyLock,
    documentStyleProfile,
    strongPrefixCounts,
    pdfDetections,
  };
}

export async function extractPlanSheetsFromPdf(
  fileBytes: Uint8Array,
  options?: {
    forceDebugArtifacts?: boolean;
    targetPageNumbers?: number[] | null;
    onProgress?: (progress: PlanSheetImportProgress) => void | Promise<void>;
  }
) {
  const debugSession = createPlanSheetImportDebugSession({
    fileByteLength: fileBytes.length,
    forceArtifacts: options?.forceDebugArtifacts,
  });
  const totalTimer = debugSession.startTimer("extract_plan_sheets");
  const pdfBytesForTextExtraction = Uint8Array.from(fileBytes);

  try {
    const targetPageNumbers =
      options?.targetPageNumbers?.length
        ? Array.from(
            new Set(
              options.targetPageNumbers
                .map((pageNumber) => Math.trunc(Number(pageNumber)))
                .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0)
            )
          ).sort((left, right) => left - right)
        : null;

    const extracted = await buildPageExtractionModels(
      pdfBytesForTextExtraction,
      debugSession,
      {
        pageNumbers: targetPageNumbers,
        disableSparseOcrFallback: true,
        onProgress: options?.onProgress,
      }
    );

    const preparedContext = preparePlanSheetSelectionContext({
      pages: extracted.pages,
      pageCount: extracted.pageCount,
      debugSession,
    });

    const builtInitialSheets = buildInitialPlanSheetsFromPreparedContext({
      pageCount: extracted.pageCount,
      preparedContext,
      pdfTextResults: new Map<number, PdfTextExtractionResult>(),
      debugSession,
    });

    if (debugSession.artifactsEnabled) {
      debugSession.writeJsonArtifact(
        "replay-input.json",
        buildPlanSheetImportReplayInput({
          pageCount: extracted.pageCount,
          pages: extracted.pages,
        })
      );
    }

    const sheets = finalizeSelectedPlanSheets(builtInitialSheets.initialSheets);

    totalTimer.end({
      pageCount: extracted.pageCount,
      ocrPageCount: 0,
      mode: "pdf_only",
    });
    debugSession.end({
      pageCount: extracted.pageCount,
      ocrPageCount: 0,
      mode: "pdf_only",
    });

    return {
      pageCount: extracted.pageCount,
      sheets,
      debugSessionId: debugSession.sessionId,
      debugArtifactsDir: debugSession.artifactsDir,
    };
  } catch (error) {
    totalTimer.end({
      result: "error",
      error:
        error instanceof Error ? error.message : "Unknown extractPlanSheets error",
    });
    debugSession.end({
      result: "error",
    });
    throw error;
  }
}

function summarizeDiscoveryCheckOcrResult(result: PdfTextExtractionResult) {
  if (!result) {
    return null;
  }

  return {
    sheetNumber: result.sheetNumber || null,
    sheetTitle: result.sheetTitle || null,
    numberSourceText: result.numberSourceText ?? null,
    titleSourceText: result.titleSourceText ?? null,
    confidence: Number(result.confidence.toFixed(2)),
    score: result.score,
    styleProfile: result.styleProfile ?? null,
    numberRegion: result.numberRegion ?? null,
    titleRegion: result.titleRegion ?? null,
    numberBox: result.numberBox ?? null,
    titleBox: result.titleBox ?? null,
    rejectReason: result.rejectReason ?? null,
  };
}

function applyDiscoveryCheckPostprocessToOcrResult(args: {
  page: PageExtractionModel;
  result: PdfTextExtractionResult;
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
}) {
  if (!args.result) {
    return null;
  }

  const localizedPdfResult = applyLocalizedPdfNumberToOcrResult({
    page: args.page,
    ocrResult: args.result,
    exactCounts: args.exactCounts,
    prefixCounts: args.prefixCounts,
  });
  const contextualNumber = localizedPdfResult?.sheetNumber
    ? normalizeOcrSheetNumberWithTitleContext({
        sheetNumber: localizedPdfResult.sheetNumber,
        sheetTitle: localizedPdfResult.sheetTitle,
        titleSourceText: localizedPdfResult.titleSourceText,
        pageLineTexts: args.page.lines.map((line) => line.text),
      })
    : "";

  if (
    localizedPdfResult &&
    contextualNumber &&
    contextualNumber !== localizedPdfResult.sheetNumber
  ) {
    return {
      ...localizedPdfResult,
      sheetNumber: contextualNumber,
      numberSourceText:
        localizedPdfResult.numberSourceText ?? contextualNumber,
    } satisfies PdfTextExtractionResult;
  }

  return localizedPdfResult;
}

function formatLockedRegionPatternSummary(pattern: LockedOcrRegionPattern | null) {
  if (!pattern) {
    return null;
  }

  return {
    patternId: pattern.patternId,
    styleId: pattern.styleId,
    styleProfile: pattern.styleProfile,
    numberRegion: pattern.numberRegion,
    titleRegion: pattern.titleRegion,
    numberBox: pattern.numberBox ?? null,
    titleBox: pattern.titleBox ?? null,
    supportPages: pattern.supportPages,
    hitCount: pattern.hitCount,
    lastUsedPage: pattern.lastUsedPage,
  };
}

export async function runPlanSheetDiscoveryCheckFromPdf(
  fileBytes: Uint8Array,
  options?: {
    forceDebugArtifacts?: boolean;
    targetPageNumbers?: number[] | null;
    fastRelevantPageExtraction?: boolean;
  }
) {
  const debugSession = createPlanSheetImportDebugSession({
    fileByteLength: fileBytes.length,
    forceArtifacts: options?.forceDebugArtifacts,
  });
  const totalTimer = debugSession.startTimer("run_plan_sheet_discovery_check");
  const pdfBytesForTextExtraction = Uint8Array.from(fileBytes);

  try {
    const requestedTargetPageNumbers = [
      ...new Set(
        (options?.targetPageNumbers ?? [])
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 1)
      ),
    ].sort((left, right) => left - right);
    const extractionPageNumbers =
      options?.fastRelevantPageExtraction && requestedTargetPageNumbers.length > 0
        ? [
            ...new Set([
              ...Array.from(
                { length: DISCOVERY_CHECK_FAST_PROBE_PAGE_COUNT },
                (_, index) => index + 1
              ),
              ...requestedTargetPageNumbers,
            ]),
          ].sort((left, right) => left - right)
        : null;

    const extracted = await buildPageExtractionModels(pdfBytesForTextExtraction, debugSession, {
      pageNumbers: extractionPageNumbers,
      disableSparseOcrFallback: true,
    });
    const preparedContext = preparePlanSheetSelectionContext({
      pages: extracted.pages,
      pageCount: extracted.pageCount,
      debugSession,
    });
    const builtSheets = buildInitialPlanSheetsFromPreparedContext({
      pageCount: extracted.pageCount,
      preparedContext,
      pdfTextResults: new Map<number, PdfTextExtractionResult>(),
      debugSession,
    });
    const finalSheets = finalizeSelectedPlanSheets(builtSheets.initialSheets);
    const finalSheetByPage = new Map(
      finalSheets.map((sheet) => [sheet.pageNumber, sheet] as const)
    );
    const diagnosticByPage = new Map(
      builtSheets.pageSelectionDiagnostics.map((diagnostic) => [
        diagnostic.pageNumber,
        diagnostic,
      ] as const)
    );
    const targetPageNumbers = requestedTargetPageNumbers.length > 0
      ? requestedTargetPageNumbers.filter((value) => value <= extracted.pageCount)
      : extracted.pages.map((page) => page.pageNumber);
    const targetSet = new Set(targetPageNumbers);

    const pageSummaries = preparedContext.pdfDetections
      .filter((detection) => targetSet.has(detection.page.pageNumber))
      .map((detection) => {
        const detectionIndex = preparedContext.pdfDetections.findIndex(
          (candidate) => candidate.page.pageNumber === detection.page.pageNumber
        );
        const sheet = finalSheetByPage.get(detection.page.pageNumber) ?? null;
        const diagnostic = diagnosticByPage.get(detection.page.pageNumber) ?? null;
        const topPairCandidates =
          (preparedContext.pdfPairCandidateGroups[detectionIndex] ?? [])
            .slice(0, 5)
            .map((candidate) => ({
              sheetNumber: candidate.sheetNumber,
              sheetTitle: candidate.sheetTitle,
              score: candidate.score,
              scoreBreakdown: serializeScoreBreakdown(candidate.scoreBreakdown),
              contextScoreBreakdown: serializeScoreBreakdown(candidate.contextScoreBreakdown),
              confidence: candidate.confidence,
              styleProfile: candidate.styleProfile,
              numberRegion: candidate.numberRegion,
              titleRegion: candidate.titleRegion,
              numberReasonCodes: candidate.numberReasonCodes ?? [],
              titleReasonCodes: candidate.titleReasonCodes ?? [],
              rejectReason: candidate.rejectReason ?? null,
            }));

        return {
          pageNumber: detection.page.pageNumber,
          pdfPair: detection.pdfPair
            ? {
                sheetNumber: detection.pdfPair.sheetNumber,
                sheetTitle: detection.pdfPair.sheetTitle,
                confidence: detection.pdfPair.confidence,
                score: detection.pdfPair.score,
                scoreBreakdown: serializeScoreBreakdown(detection.pdfPair.scoreBreakdown),
                contextScoreBreakdown: serializeScoreBreakdown(
                  detection.pdfPair.contextScoreBreakdown
                ),
                styleProfile: detection.pdfPair.styleProfile,
              }
            : null,
          fallback: {
            sheetNumber: detection.fallbackNumberResult.sheetNumber || null,
            sheetTitle: detection.fallbackTitleResult.title || null,
          },
          topPairCandidates,
          finalSelection: sheet
            ? {
                sheetNumber: sheet.sheetNumber || null,
                sheetTitle: sheet.sheetTitle || null,
                confidence: sheet.confidence ?? null,
                confidenceTier: sheet.identityConfidenceTier,
                confidenceReasons: sheet.identityConfidenceReasons,
              }
            : null,
          selectionDecision: diagnostic?.selectionDecision ?? null,
          rejectReason: diagnostic?.rejectReason ?? null,
        };
      });

    const summary = {
      totalPageCount: extracted.pageCount,
      extractionMode: extractionPageNumbers?.length ? ("subset" as const) : ("full_document" as const),
      runtimeMode: "pdf_only" as const,
      extractedPageCount: extracted.pages.length,
      extractedPageNumbers: extracted.pages.map((page) => page.pageNumber),
      targetPageNumbers,
      familyLock: preparedContext.familyLock,
      documentStyleProfile: preparedContext.documentStyleProfile,
      pageSummaries,
      debugSessionId: debugSession.sessionId,
      debugArtifactsDir: debugSession.artifactsDir,
    };

    if (debugSession.artifactsEnabled) {
      debugSession.writeJsonArtifact("discovery-check-summary.json", summary);
    }

    totalTimer.end({
      pageCount: targetPageNumbers.length,
      mode: "pdf_only",
    });
    debugSession.end({
      pageCount: targetPageNumbers.length,
      replayMode: "pdf_only_discovery_check",
    });

    return summary;
  } catch (error) {
    totalTimer.end({
      result: "error",
      error:
        error instanceof Error ? error.message : "Unknown runPlanSheetDiscoveryCheckFromPdf error",
    });
    debugSession.end({
      result: "error",
      replayMode: "pdf_only_discovery_check",
    });
    throw error;
  }
}

function buildInitialPlanSheetsFromPreparedContext(args: {
  pageCount: number;
  preparedContext: PreparedPlanSheetSelectionContext;
  pdfTextResults: ReadonlyMap<number, PdfTextExtractionResult>;
  debugSession: PlanSheetImportDebugSession;
}): BuiltInitialPlanSheets {
  const {
    exactCounts,
    prefixCounts,
    repeatedLineCounts,
    documentTitleStyleProfile,
    documentReferencedSheetTitles,
    pdfRawBoxCandidateGroups,
    pdfPairCandidateGroups,
    familyLock,
    documentStyleProfile,
    strongPrefixCounts,
    pdfDetections,
  } = args.preparedContext;
  const ocrTitleCounts: Record<string, number> = {};

  for (const result of args.pdfTextResults.values()) {
    if (!result?.sheetTitle) {
      continue;
    }

    const key = normalizeKey(result.sheetTitle);
    if (!key) {
      continue;
    }

    ocrTitleCounts[key] = (ocrTitleCounts[key] ?? 0) + 1;
  }

  const pdfTextStrongPrefixCounts = inferStrongPrefixCountsFromPdfTextResults(
    args.pdfTextResults.values()
  );
  const combinedStrongPrefixCounts = mergeStrongPrefixCounts(
    strongPrefixCounts,
    pdfTextStrongPrefixCounts
  );

  const pageSelectionDiagnostics: PlanSheetSelectionDiagnostic[] = [];
  const initialSheets = pdfDetections.map(({ page, pdfPair, fallbackNumberResult, fallbackTitleResult }, index) => {
    const pdfOnlyMode = PLAN_SHEET_IMPORT_DISABLE_OCR;
    const rawBoxCandidates = pdfRawBoxCandidateGroups[index] ?? [];
    const preferredRawBoxAnchor = pdfOnlyMode
      ? null
      : getPreferredRawBoxAnchorCandidate(
          rawBoxCandidates,
          fallbackNumberResult.winner
        );
    const effectiveFallbackNumberResult =
      preferredRawBoxAnchor &&
      normalizeKey(preferredRawBoxAnchor.value) !==
        normalizeKey(fallbackNumberResult.sheetNumber)
        ? {
            sheetNumber: preferredRawBoxAnchor.value,
            confidence: 1,
            winner: preferredRawBoxAnchor,
          }
        : preferredRawBoxAnchor
          ? {
              ...fallbackNumberResult,
              winner: preferredRawBoxAnchor,
            }
          : fallbackNumberResult;
    const preferredFallbackTitleResult = preferredRawBoxAnchor
      ? detectSheetTitle(
          page,
          preferredRawBoxAnchor,
          repeatedLineCounts,
          args.pageCount
        )
      : fallbackTitleResult;
    const baseFallbackTitleEvaluation = fallbackTitleResult.title
      ? evaluateTitleSelection({
          title: fallbackTitleResult.title,
          sourceKind: "pdf_text",
          sourceText: fallbackTitleResult.sourceText,
          pageNumber: page.pageNumber,
        })
      : null;
    const preferredFallbackTitleEvaluation = preferredFallbackTitleResult.title
      ? evaluateTitleSelection({
          title: preferredFallbackTitleResult.title,
          sourceKind: "pdf_text",
          sourceText: preferredFallbackTitleResult.sourceText,
          pageNumber: page.pageNumber,
        })
      : null;
    const effectiveFallbackTitleResult =
      preferredFallbackTitleEvaluation &&
      (
        !baseFallbackTitleEvaluation ||
        preferredFallbackTitleEvaluation.score >= baseFallbackTitleEvaluation.score + 8 ||
        isSuspiciousDetectedTitle(baseFallbackTitleEvaluation.text)
      )
        ? preferredFallbackTitleResult
        : fallbackTitleResult;
    const ocrResult = args.pdfTextResults.get(page.pageNumber) ?? null;
    const acceptedRawAnchorNumbers = rawBoxCandidates
      .filter((box) => !box.rejectReason)
      .map((box) => box.anchorCandidate.value);
    const singleAcceptedRawAnchorNumber =
      acceptedRawAnchorNumbers.length === 1 ? acceptedRawAnchorNumbers[0] : "";
    const reconciledOcrSheetNumber = ocrResult
      ? reconcileOcrSheetNumberWithAnchorNumbers(
          ocrResult.sheetNumber,
          acceptedRawAnchorNumbers
        )
      : "";
    const preferredSingleAcceptedAnchorNumber =
      ocrResult &&
      singleAcceptedRawAnchorNumber &&
        choosePreferredSingleAcceptedAnchorNumber({
          singleAcceptedAnchorNumber: singleAcceptedRawAnchorNumber,
          ocrSheetNumber: reconciledOcrSheetNumber || ocrResult.sheetNumber,
          ocrNumberScore: ocrResult.numberScore,
        });
    const anchoredOcrSheetNumber =
      preferredSingleAcceptedAnchorNumber || reconciledOcrSheetNumber;
    const anchoredOcrResult =
      ocrResult &&
      anchoredOcrSheetNumber &&
      anchoredOcrSheetNumber !== ocrResult.sheetNumber
        ? {
            ...ocrResult,
            sheetNumber: anchoredOcrSheetNumber,
            numberSourceText:
              preferredSingleAcceptedAnchorNumber ||
              ocrResult.numberSourceText ||
              anchoredOcrSheetNumber,
          }
        : ocrResult;
    const localizedPdfOcrResult =
      anchoredOcrResult &&
      applyLocalizedPdfNumberToOcrResult({
        page,
        ocrResult: anchoredOcrResult,
        exactCounts,
        prefixCounts,
      });
    const contextualOcrSheetNumber = localizedPdfOcrResult?.sheetNumber
      ? normalizeOcrSheetNumberWithTitleContext({
          sheetNumber: localizedPdfOcrResult.sheetNumber,
          sheetTitle: localizedPdfOcrResult.sheetTitle,
          titleSourceText: localizedPdfOcrResult.titleSourceText,
          pageLineTexts: page.lines.map((line) => line.text),
        })
      : "";
    const contextualOcrResult =
      localizedPdfOcrResult &&
      contextualOcrSheetNumber &&
      contextualOcrSheetNumber !== localizedPdfOcrResult.sheetNumber
        ? {
            ...localizedPdfOcrResult,
            sheetNumber: contextualOcrSheetNumber,
            numberSourceText:
              localizedPdfOcrResult.numberSourceText || contextualOcrSheetNumber,
          }
        : localizedPdfOcrResult;
    const referencedOcrSheet = contextualOcrResult?.sheetNumber
      ? lookupDocumentReferencedSheet(
          contextualOcrResult.sheetNumber,
          documentReferencedSheetTitles
        )
      : null;
    const normalizedOcrResult =
      contextualOcrResult &&
      referencedOcrSheet &&
      referencedOcrSheet.sheetNumber !== contextualOcrResult.sheetNumber
        ? {
            ...contextualOcrResult,
            sheetNumber: referencedOcrSheet.sheetNumber,
            numberSourceText:
              contextualOcrResult.numberSourceText || referencedOcrSheet.sheetNumber,
          }
        : contextualOcrResult;
    const lockedFamily =
      familyLock.locked && documentStyleProfile !== "mixed"
        ? documentStyleProfile
        : null;
    const offFamilyPdfCandidate = lockedFamily
      ? (pdfPairCandidateGroups[index] ?? []).find(
          (candidate) => candidate.styleProfile !== lockedFamily
        ) ?? null
      : null;
    const ocrTitleRepeatCount = normalizedOcrResult?.sheetTitle
      ? ocrTitleCounts[normalizeKey(normalizedOcrResult.sheetTitle)] ?? 0
      : 0;
    const compactStampSignal = hasStrongCompactStampSignal(rawBoxCandidates);

    const pdfSheetNumber =
      pdfPair?.sheetNumber ?? effectiveFallbackNumberResult.sheetNumber;
    const referencedPdfSheet = pdfSheetNumber
      ? lookupDocumentReferencedSheet(pdfSheetNumber, documentReferencedSheetTitles)
      : null;
    const referencedPdfTitle = referencedPdfSheet?.sheetTitle ?? "";
    const pdfNumberSourceText =
      pdfPair?.numberSourceText ?? effectiveFallbackNumberResult.winner?.lineText ?? null;
    const pdfPairStructured = Boolean(
      pdfPair?.numberReasonCodes?.includes("structured_field_parse") &&
        pdfPair?.titleReasonCodes?.includes("structured_field_parse")
    );
    const pdfEdgeLineTexts = page.lines
      .filter((line) => isAllowedEdgeMetadataLine(line))
      .map((line) => line.text);
    const preferredPdfTitleBase = chooseMoreCompleteDirectStampFallbackTitle({
      currentTitle: pdfPair?.sheetTitle ?? "",
      fallbackTitle: effectiveFallbackTitleResult.title,
      fallbackSourceText: effectiveFallbackTitleResult.sourceText,
    });
    const directCornerCandidate = pdfOnlyMode
      ? buildPyMuPdfDirectCornerPairCandidate({
          page,
          exactCounts,
          prefixCounts,
          documentTitleStyleProfile,
        })
      : null;
    const moreCompleteSameNumberPdfPair = chooseMoreCompleteSameNumberPdfPairCandidate({
      currentSheetNumber: pdfSheetNumber,
      currentTitle: pdfPair?.sheetTitle ?? effectiveFallbackTitleResult.title,
      currentPairScore: pdfPair?.score ?? null,
      candidates: pdfPairCandidateGroups[index] ?? [],
    });
    const rightEdgeRotatedTitleForNumber = buildBestRightEdgeRotatedTitleForSheetNumber({
      page,
      sheetNumber: pdfSheetNumber,
      pageNumber: page.pageNumber,
      documentTitleStyleProfile,
    });
    const selectedPairTitleLooksLikeStampStatus =
      /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION)\b/i.test(
        pdfPair?.sheetTitle ?? ""
      );
    const directCornerTitleLooksLikeStampStatus =
      /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION)\b/i.test(
        directCornerCandidate?.sheetTitle ?? ""
      );
    const currentPdfTitleLooksReplaceableByRightEdge = Boolean(
      rightEdgeRotatedTitleForNumber &&
        rightEdgeRotatedTitleForNumber.score >= 220 &&
        !/\b(?:NOT\s+FOR\s+CONSTRUCTION|CONSTRUCTION\s+NOT|BID\s+SET)\b/i.test(
          rightEdgeRotatedTitleForNumber.titleText
        ) &&
        countTitleVocabularyHits(rightEdgeRotatedTitleForNumber.titleText) >= 1 &&
        (
          selectedPairTitleLooksLikeStampStatus ||
          directCornerTitleLooksLikeStampStatus ||
          getTextualTitleRejectPenalty(pdfPair?.sheetTitle ?? "") <= -80 ||
          matchesProjectBrandingVocabulary(pdfPair?.sheetTitle ?? "")
        )
    );
    const directCornerTitleSheetOverride = Boolean(
      directCornerCandidate?.sheetTitle &&
        directCornerCandidate.score >= 760 &&
        (
          isCoverSheetTitleSignal(directCornerCandidate.sheetTitle) ||
          /\bTITLE\s+SHEET\b/i.test(directCornerCandidate.sheetTitle) ||
          /\bKEY\s+PLAN\b/i.test(directCornerCandidate.sheetTitle)
        ) &&
        !(
          isCoverSheetTitleSignal(pdfPair?.sheetTitle ?? "") ||
          /\bTITLE\s+SHEET\b/i.test(pdfPair?.sheetTitle ?? "") ||
          /\bKEY\s+PLAN\b/i.test(pdfPair?.sheetTitle ?? "")
        ) &&
        countTitleVocabularyHits(pdfPair?.sheetTitle ?? "") <= 1
    );
    const preferDirectCornerPdfTitle = Boolean(
      directCornerCandidate?.sheetTitle &&
        !isSuspiciousDetectedTitle(directCornerCandidate.sheetTitle) &&
        !currentPdfTitleLooksReplaceableByRightEdge &&
        (
          directCornerTitleSheetOverride ||
          directCornerCandidate.score >= (pdfPair?.score ?? -Infinity) - 24 ||
          (
            selectedPairTitleLooksLikeStampStatus &&
            directCornerCandidate.score >= (pdfPair?.score ?? -Infinity) - 140
          )
        )
    );
    const usingPreferredDirectStampFallbackTitle = Boolean(
      preferredPdfTitleBase &&
        !preferDirectCornerPdfTitle &&
        normalizeTitleSelectionText(preferredPdfTitleBase) !==
          normalizeTitleSelectionText(pdfPair?.sheetTitle ?? "")
    );
    const selectedPdfTitleBase =
      currentPdfTitleLooksReplaceableByRightEdge
          ? rightEdgeRotatedTitleForNumber?.titleText ?? ""
      : preferDirectCornerPdfTitle
        ? directCornerCandidate?.sheetTitle ?? ""
        : moreCompleteSameNumberPdfPair?.sheetTitle
          ? moreCompleteSameNumberPdfPair.sheetTitle
        : preferredPdfTitleBase || pdfPair?.sheetTitle || effectiveFallbackTitleResult.title || "";
    const selectedPdfTitleLooksLikeStampStatus =
      /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION)\b/i.test(
        selectedPdfTitleBase
      );
    const shouldEdgeEnrichPdfTitle =
      !usingPreferredDirectStampFallbackTitle &&
      (!pdfPair?.numberReasonCodes?.includes("compact_number_over_title_anchor") ||
        selectedPdfTitleLooksLikeStampStatus ||
        getTextualTitleRejectPenalty(selectedPdfTitleBase) <= -120) &&
      (!pdfOnlyMode ||
        selectedPdfTitleLooksLikeStampStatus ||
        getTextualTitleRejectPenalty(selectedPdfTitleBase) <= -120);
    const pdfTitleBase = shouldEdgeEnrichPdfTitle
      ? enrichPdfTitleWithEdgeLineContext({
          currentTitle: selectedPdfTitleBase,
          edgeLineTexts: pdfEdgeLineTexts,
        })
      : selectedPdfTitleBase;
    const pdfTitleSourceText =
      preferDirectCornerPdfTitle
        ? directCornerCandidate?.titleSourceText ?? directCornerCandidate?.sheetTitle ?? null
        : currentPdfTitleLooksReplaceableByRightEdge &&
            rightEdgeRotatedTitleForNumber
          ? rightEdgeRotatedTitleForNumber.sourceText
        : moreCompleteSameNumberPdfPair
          ? moreCompleteSameNumberPdfPair?.titleSourceText ?? moreCompleteSameNumberPdfPair?.sheetTitle ?? null
        : pdfPair?.titleSourceText ?? effectiveFallbackTitleResult.sourceText ?? null;
    const pdfTitleEvaluation = pdfTitleBase
      ? evaluateTitleSelection({
          title: pdfTitleBase,
          sourceKind: "pdf_text",
          sourceText: pdfTitleSourceText,
          pageNumber: page.pageNumber,
        })
      : null;
    const trustStructuredPdfPairTitle = Boolean(
      pdfPairStructured &&
        pdfPair?.sheetTitle &&
        isUsableStructuredTitleValue(pdfPair.sheetTitle)
    );
    const trustLocalizedPdfPairTitle = Boolean(
      pdfOnlyMode &&
        pdfPair &&
        pdfPair.titleCandidateTypeGuess === "drawing_title" &&
        pdfPair.confidence >= 0.74 &&
        Number.isFinite(pdfPair.score) &&
        pdfPair.score >= 620 &&
        pdfPair.numberReasonCodes?.includes("bottom_right_anchor") &&
        pdfPair.titleReasonCodes?.includes("near_selected_number") &&
        !isRegulatoryOrScopeNoteText(pdfPair.titleSourceText ?? pdfPair.sheetTitle)
    );
    const trustNearbyPdfPairTitle = Boolean(
      pdfPair &&
        pdfPair.sheetTitle &&
        pdfPair.confidence >= 0.84 &&
        Number.isFinite(pdfPair.score) &&
        pdfPair.score >= 600 &&
        pdfPair.numberReasonCodes?.includes("bottom_right_anchor") &&
        pdfPair.titleReasonCodes?.includes("near_selected_number") &&
        countWords(pdfPair.sheetTitle) >= 2 &&
        countWords(pdfPair.sheetTitle) <= 6 &&
        getTextualTitleRejectPenalty(pdfPair.sheetTitle) > -120 &&
        !isDateLikeTitleLineText(pdfPair.sheetTitle) &&
        !NON_TITLE_FIELD_LABEL_PATTERN.test(pdfPair.sheetTitle) &&
        !matchesAdministrativeTitleMetadata(pdfPair.sheetTitle) &&
        !isRegulatoryOrScopeNoteText(pdfPair.titleSourceText ?? pdfPair.sheetTitle)
    );
    const trustCompactNumberOverTitlePdfPair = Boolean(
      pdfPair &&
        pdfPair.numberReasonCodes?.includes("compact_number_over_title_anchor") &&
        pdfPair.titleReasonCodes?.includes("directly_below_sheet_number") &&
        isTrustworthyCompactNumberOverTitleText(pdfPair.sheetTitle)
    );
    const trustAnchoredCompactPdfPairTitle = Boolean(
      pdfPair &&
        pdfPair.sheetTitle &&
        pdfPair.confidence >= 0.88 &&
        Number.isFinite(pdfPair.score) &&
        pdfPair.score >= 760 &&
        (
          pdfPair.numberReasonCodes?.includes("bottom_right_anchor") ||
          pdfPair.numberReasonCodes?.includes("compact_number_over_title_anchor")
        ) &&
        pdfPair.titleReasonCodes?.includes("near_selected_number") &&
        (
          !isSuspiciousDetectedTitle(pdfPair.sheetTitle) ||
          trustCompactNumberOverTitlePdfPair
        ) &&
        !isRegulatoryOrScopeNoteText(pdfPair.titleSourceText ?? pdfPair.sheetTitle) &&
        (
          pdfPair.titleCandidateTypeGuess === "drawing_title" ||
          isLikelySheetTitle(pdfPair.sheetTitle) ||
          hasCompactTechnicalTitleSignal(pdfPair.sheetTitle) ||
          countTitleVocabularyHits(pdfPair.sheetTitle) >= 1 ||
          trustCompactNumberOverTitlePdfPair
        )
    );
    const trustDirectStampSingleWordPdfPairTitle = Boolean(
      pdfPair &&
        pdfPair.sheetTitle &&
        pdfPair.confidence >= 0.84 &&
        Number.isFinite(pdfPair.score) &&
        pdfPair.score >= 520 &&
        (
          pdfPair.numberReasonCodes?.includes("bottom_right_anchor") ||
          (
            pdfPair.numberReasonCodes?.includes("compact_number_over_title_anchor") &&
            pdfPair.titleReasonCodes?.includes("directly_below_sheet_number")
          )
        ) &&
        pdfPair.titleReasonCodes?.includes("near_selected_number") &&
        countWords(pdfPair.sheetTitle) === 1 &&
        isAllowedSingleWordTitle(pdfPair.sheetTitle) &&
        !isSuspiciousDetectedTitle(pdfPair.sheetTitle) &&
        !isRegulatoryOrScopeNoteText(pdfPair.titleSourceText ?? pdfPair.sheetTitle)
    );
    const fallbackSingleWordTitle = effectiveFallbackTitleResult.title;
    const trustDirectStampSingleWordFallbackTitle = Boolean(
      fallbackSingleWordTitle &&
        effectiveFallbackNumberResult.sheetNumber &&
        effectiveFallbackNumberResult.winner &&
        effectiveFallbackNumberResult.winner.score >= 280 &&
        countWords(fallbackSingleWordTitle) === 1 &&
        isAllowedSingleWordTitle(fallbackSingleWordTitle) &&
        !isSuspiciousDetectedTitle(fallbackSingleWordTitle) &&
        !isRegulatoryOrScopeNoteText(
          effectiveFallbackTitleResult.sourceText || fallbackSingleWordTitle
        )
    );
    const pdfTitleEvaluationIsRepeatedProjectLike = Boolean(
      pdfTitleEvaluation?.text &&
        isRepeatedProjectLikeTitle(
          pdfTitleEvaluation.text,
          repeatedLineCounts,
          args.pageCount
        )
    );
    const preferLocalizedPdfPairOverRepeatedEvaluation = Boolean(
      pdfPair?.sheetTitle &&
        pdfTitleEvaluationIsRepeatedProjectLike &&
        !isRepeatedProjectLikeTitle(pdfPair.sheetTitle, repeatedLineCounts, args.pageCount) &&
        (
          trustStructuredPdfPairTitle ||
          trustLocalizedPdfPairTitle ||
          trustAnchoredCompactPdfPairTitle ||
          trustDirectStampSingleWordPdfPairTitle ||
          trustNearbyPdfPairTitle ||
          pdfPair.titleReasonCodes?.includes("near_selected_number")
        ) &&
        getTextualTitleRejectPenalty(pdfPair.sheetTitle) > -120
    );
    const pdfTitleText =
      directCornerTitleSheetOverride && directCornerCandidate?.sheetTitle
        ? directCornerCandidate.sheetTitle
        : trustStructuredPdfPairTitle && pdfPair?.sheetTitle
        ? pdfPair.sheetTitle
        : preferLocalizedPdfPairOverRepeatedEvaluation && pdfPair?.sheetTitle
          ? pdfPair.sheetTitle
          : pdfTitleEvaluation && !isSuspiciousDetectedTitle(pdfTitleEvaluation.text)
          ? pdfTitleEvaluation.text
          : (trustLocalizedPdfPairTitle ||
              trustAnchoredCompactPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustNearbyPdfPairTitle) && pdfPair?.sheetTitle
            ? pdfPair.sheetTitle
            : pdfOnlyMode && pdfPair?.sheetTitle && !isSuspiciousDetectedTitle(pdfPair.sheetTitle)
              ? pdfPair.sheetTitle
              : "";
    const pdfTitleScore = Math.max(
      pdfPair?.titleScore ?? -Infinity,
      pdfTitleEvaluation?.score ?? -Infinity
    );
    const pdfNumberScore =
      pdfPair?.numberScore ?? effectiveFallbackNumberResult.winner?.score ?? -Infinity;
    const pdfPairScore = pdfPair?.score ?? -Infinity;
    const pdfPairConfidence =
      pdfPair?.confidence ?? effectiveFallbackNumberResult.confidence ?? 0.15;
    const pdfPairUsable = pdfOnlyMode
      ? Boolean(
          pdfSheetNumber &&
            pdfTitleText &&
            (
              trustStructuredPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              (pdfTitleEvaluation?.score ?? -Infinity) >= 24 ||
              ((trustLocalizedPdfPairTitle || trustAnchoredCompactPdfPairTitle) && pdfTitleScore >= 10)
            ) &&
            (
              trustStructuredPdfPairTitle ||
              trustLocalizedPdfPairTitle ||
              trustAnchoredCompactPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              !isSuspiciousDetectedTitle(pdfTitleText)
            )
        )
      : Boolean(
          pdfPair &&
            pdfSheetNumber &&
            pdfTitleText &&
            pdfPairConfidence >= (pdfPairStructured ? 0.4 : 0.48) &&
            Number.isFinite(pdfPairScore) &&
            (
              trustStructuredPdfPairTitle ||
              trustAnchoredCompactPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              (pdfPairStructured
                ? (pdfTitleEvaluation?.score ?? 28) >= 18
                : (pdfTitleEvaluation?.score ?? -Infinity) >= 56)
            )
        );
    const pdfFallbackPairUsable = pdfOnlyMode
      ? Boolean(
          !pdfPairUsable &&
            pdfSheetNumber &&
            pdfTitleText &&
            (
              trustStructuredPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              (pdfTitleEvaluation?.score ?? -Infinity) >= 18
            ) &&
            (
              trustStructuredPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              !isSuspiciousDetectedTitle(pdfTitleText)
            )
        )
      : Boolean(
          !pdfPairUsable &&
            pdfSheetNumber &&
            pdfTitleText &&
            Number.isFinite(pdfNumberScore) &&
            pdfNumberScore >= (pdfPairStructured ? 120 : 160) &&
            (
              trustStructuredPdfPairTitle ||
              trustAnchoredCompactPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              (pdfPairStructured
                ? (pdfTitleEvaluation?.score ?? 28) >= 18
                : (pdfTitleEvaluation?.score ?? -Infinity) >= 48)
            ) &&
            (
              trustStructuredPdfPairTitle ||
              trustAnchoredCompactPdfPairTitle ||
              trustDirectStampSingleWordPdfPairTitle ||
              trustDirectStampSingleWordFallbackTitle ||
              trustNearbyPdfPairTitle ||
              pdfPairStructured ||
              countTitleVocabularyHits(pdfTitleText) >= 2 ||
              isAllowedSingleWordTitle(pdfTitleText) ||
              /\bmaterials?\s+board\b/i.test(pdfTitleText)
            )
        );

    const rawBoxContextText = normalizedOcrResult?.sheetNumber
      ? buildRawBoxContextText(rawBoxCandidates, normalizedOcrResult.sheetNumber)
      : "";
    const referencedOcrTitle = referencedOcrSheet?.sheetTitle ?? "";
    const referencedOcrTitleEvaluation = referencedOcrTitle
      ? evaluateTitleSelection({
          title: referencedOcrTitle,
          sourceKind: "pdf_text",
          sourceText: referencedOcrTitle,
          pageNumber: page.pageNumber,
        })
      : null;
    const ocrTitleThreshold =
      normalizedOcrResult?.styleProfile === "bottom_right_strip" ? 70 : 20;
    const ocrTitleEvaluation =
      normalizedOcrResult &&
      isPlausibleOcrSheetTitleResult(
        {
          ...normalizedOcrResult,
          sheetTitle: normalizedOcrResult.sheetTitle ?? "",
        },
        ocrTitleRepeatCount
      )
        ? evaluateTitleSelection({
            title: normalizedOcrResult.sheetTitle ?? "",
            sourceKind: "ocr",
            sourceText: normalizedOcrResult.titleSourceText,
            repeatedTitleCount: ocrTitleRepeatCount,
          })
        : null;
    const effectiveOcrTitleText =
      normalizedOcrResult?.sheetTitle || ocrTitleEvaluation?.text || "";
    const ocrNumberParts = parseSheetNumberParts(normalizedOcrResult?.sheetNumber ?? "");
    const ocrConfidenceUsable = Boolean(
      normalizedOcrResult && normalizedOcrResult.confidence >= 0.58
    );
    const ocrNumberPlausible = Boolean(
      normalizedOcrResult && isPlausibleOcrSheetNumberResult(normalizedOcrResult)
    );
    const ocrNumberScoreUsable = Boolean(
      normalizedOcrResult && (normalizedOcrResult.numberScore ?? -Infinity) >= 10
    );
    const ocrTitleUsable = Boolean(
      ocrTitleEvaluation &&
        Number.isFinite(ocrTitleEvaluation.score) &&
        ocrTitleEvaluation.score >= ocrTitleThreshold
    );
    const ocrPairLocalized = Boolean(
      normalizedOcrResult &&
        (!normalizedOcrResult.styleProfile ||
          normalizedOcrResult.styleProfile !== "bottom_right_strip" ||
          (
            (normalizedOcrResult.numberRegion === "stripNumber" &&
              normalizedOcrResult.titleRegion === "stripTitle") ||
            (normalizedOcrResult.numberRegion === "sheetStamp" &&
              normalizedOcrResult.titleRegion === "sheetStamp")
          ))
    );
    const ocrMatchesRawCompactAnchor = Boolean(
      compactStampSignal &&
        normalizedOcrResult?.sheetNumber &&
        rawBoxCandidates.some(
          (box) =>
            matchesCompactAnchorNumber(
              box.anchorCandidate.value,
              normalizedOcrResult.sheetNumber
            )
        )
    );
    const ocrMatchesCompactStampSignal = Boolean(
      !compactStampSignal ||
        !normalizedOcrResult ||
        normalizedOcrResult.styleProfile === "bottom_right_strip" ||
        ocrMatchesRawCompactAnchor
    );
    const ocrSupportedPrefixes = Object.keys(combinedStrongPrefixCounts).sort();
    const enforceOcrPrefixSupport = shouldEnforceStrongPrefixSupport(
      combinedStrongPrefixCounts
    );
    const ocrUnsupportedPrefixOverride = Boolean(
      normalizedOcrResult &&
        ocrNumberParts &&
        (
          shouldAllowUnsupportedOcrPrefix({
            sheetNumber: normalizedOcrResult.sheetNumber,
            title: effectiveOcrTitleText,
            titleScore:
              ocrTitleEvaluation?.score ?? normalizedOcrResult.titleScore ?? -Infinity,
            localized: ocrPairLocalized,
            matchesCompactStampSignal: ocrMatchesCompactStampSignal,
          }) ||
          (
            referencedOcrTitleEvaluation &&
            shouldAllowUnsupportedOcrPrefix({
              sheetNumber: normalizedOcrResult.sheetNumber,
              title: referencedOcrTitleEvaluation.text,
              titleScore: referencedOcrTitleEvaluation.score,
              localized: ocrPairLocalized,
              matchesCompactStampSignal: ocrMatchesCompactStampSignal,
            })
          )
        )
    );
    const ocrPrefixSupported =
      !ocrNumberParts ||
      !enforceOcrPrefixSupport ||
      (combinedStrongPrefixCounts[ocrNumberParts.prefix] ?? 0) > 0 ||
      ocrUnsupportedPrefixOverride;
    const ocrNumberUsable = Boolean(
      normalizedOcrResult &&
        ocrConfidenceUsable &&
        ocrPrefixSupported
    );
    const ocrPairUsable = Boolean(
      normalizedOcrResult &&
        ocrNumberUsable &&
        ocrTitleUsable &&
        ocrPairLocalized &&
        ocrMatchesCompactStampSignal
    );
    const ocrNumberScore = normalizedOcrResult?.numberScore ?? -Infinity;
    const ocrTitleScore = Math.max(
      normalizedOcrResult?.titleScore ?? -Infinity,
      ocrTitleEvaluation?.score ?? -Infinity
    );
    const ocrPairScore = normalizedOcrResult
      ? normalizedOcrResult.score + (ocrTitleScore > -Infinity ? ocrTitleScore : 0)
      : -Infinity;
    const normalizedPdfNumber = normalizeKey(pdfSheetNumber);
    const normalizedOcrNumber = normalizeKey(normalizedOcrResult?.sheetNumber ?? "");
    const pdfNumberParts = parseSheetNumberParts(pdfSheetNumber ?? "");
    const sameNumberAcrossSources = Boolean(
      normalizedPdfNumber &&
        normalizedOcrNumber &&
        normalizedPdfNumber === normalizedOcrNumber
    );
    const preferOcrCompactAnchorOverPdf = shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal,
      pdfPairUsable,
      ocrPairUsable,
      sameNumberAcrossSources,
      ocrMatchesRawCompactAnchor,
      pdfTitleText,
      pdfTitleScore,
      ocrTitleText:
        effectiveOcrTitleText || (normalizedOcrResult?.sheetTitle ?? ""),
      ocrTitleScore,
    });
    const preferStrongOcrPairOverPdf = shouldPreferStrongOcrPairOverGenericPdfPair({
      pdfTitleText,
      pdfSheetNumber,
      ocrSheetNumber: normalizedOcrResult?.sheetNumber ?? "",
      ocrTitleText: effectiveOcrTitleText || (normalizedOcrResult?.sheetTitle ?? ""),
      ocrTitleScore,
      ocrTitleThreshold,
    });
    const suppressDirectPdfPairSelection = pdfOnlyMode
      ? false
      : shouldSuppressDirectPdfPairSelection({
          pdfTitleText,
          ocrPairUsable,
          ocrTitleText: effectiveOcrTitleText || (normalizedOcrResult?.sheetTitle ?? ""),
        });
    const allowDirectPdfPairSelection = !suppressDirectPdfPairSelection;

    let usedNumberSource: "ocr" | "pdf_text" | null = null;
    let usedTitleSource: "ocr" | "pdf_text" | null = null;
    let selectionDecision = "no_branch_selected";

    if (
      ocrPairUsable &&
      (
        !pdfPairUsable ||
        preferOcrCompactAnchorOverPdf ||
        preferStrongOcrPairOverPdf ||
        ocrPairScore >= pdfPairScore
      )
    ) {
      usedNumberSource = "ocr";
      usedTitleSource = "ocr";
      selectionDecision = preferOcrCompactAnchorOverPdf
        ? "selected_ocr_compact_anchor_override"
        : preferStrongOcrPairOverPdf
          ? "selected_ocr_over_generic_pdf"
          : pdfPairUsable
            ? "selected_ocr_over_pdf"
            : "selected_ocr_only_usable_pair";
    } else if (pdfPairUsable && allowDirectPdfPairSelection) {
      usedNumberSource = "pdf_text";
      usedTitleSource = "pdf_text";
      selectionDecision = "selected_pdf_pair";
    } else if (pdfFallbackPairUsable && allowDirectPdfPairSelection) {
      usedNumberSource = "pdf_text";
      usedTitleSource = "pdf_text";
      selectionDecision = "selected_pdf_fallback_pair";
    } else if (ocrPairUsable) {
      usedNumberSource = "ocr";
      usedTitleSource = "ocr";
      selectionDecision = "selected_ocr_pair";
    }

    const selectedSheetNumber =
      usedNumberSource === "ocr"
        ? normalizedOcrResult?.sheetNumber ?? ""
        : usedNumberSource === "pdf_text"
          ? usedTitleSource === "ocr"
            ? preferMoreSpecificCompatibleSheetNumber(
                pdfSheetNumber ?? "",
                normalizedOcrResult?.sheetNumber ?? ""
              )
            : pdfSheetNumber
          : "";
    const selectedSheetTitle =
      usedTitleSource === "ocr"
        ? effectiveOcrTitleText || referencedOcrTitle
        : usedTitleSource === "pdf_text"
          ? pdfTitleText || referencedPdfTitle
          : "";
    const cleanedSelectedSheetTitle =
      usedTitleSource === "ocr"
        ? selectedSheetTitle
        : (() => {
            const selectedSheetTitleLooksLikeStampStatus =
              /\b(?:NOT\s+FOR\s+CONSTRUCTION|BID\s+SET|CONSTRUCTION\s+NOT|PRELIMINARY\s+CONSTRUCTION)\b/i.test(
                selectedSheetTitle
              );
            const contextEnrichedSelectedSheetTitle =
              usedTitleSource === "pdf_text" &&
              (!pdfOnlyMode ||
                selectedSheetTitleLooksLikeStampStatus ||
                getTextualTitleRejectPenalty(selectedSheetTitle) <= -120) &&
              !usingPreferredDirectStampFallbackTitle &&
              (!pdfPair?.numberReasonCodes?.includes("compact_number_over_title_anchor") ||
                selectedSheetTitleLooksLikeStampStatus ||
                getTextualTitleRejectPenalty(selectedSheetTitle) <= -120)
                ? enrichPdfTitleWithEdgeLineContext({
                    currentTitle: selectedSheetTitle,
                    edgeLineTexts: pdfEdgeLineTexts,
                  })
                : selectedSheetTitle;
            const enrichedSelectedSheetTitle =
              usedNumberSource === "pdf_text" &&
              shouldPreferDocumentReferencedTitle(
                contextEnrichedSelectedSheetTitle,
                referencedPdfTitle,
                selectedSheetNumber ||
                  normalizedOcrResult?.sheetNumber ||
                  pdfSheetNumber ||
                  ""
              )
                ? referencedPdfTitle
                : contextEnrichedSelectedSheetTitle;

            return (
              stripTrailingSheetTitleMetadata(enrichedSelectedSheetTitle) ||
              enrichedSelectedSheetTitle
            );
          })();
    const selectedNumberSourceText =
      usedNumberSource === "ocr"
        ? normalizedOcrResult?.numberSourceText ?? selectedSheetNumber
        : pdfNumberSourceText ?? selectedSheetNumber;
    const refinedSelectedSheetNumber = selectedSheetNumber
      ? normalizeCompactStampSheetNumberCandidate(selectedNumberSourceText) ??
        refineSheetNumberCandidateFromLineText(
          selectedSheetNumber,
          selectedNumberSourceText
        )
      : selectedSheetNumber;
    const finalizedSelectedSheetNumber = promoteAlternateStarSheetNumber({
      sheetNumber: refinedSelectedSheetNumber,
      sheetTitle: cleanedSelectedSheetTitle,
      numberSourceText:
        usedNumberSource === "ocr"
          ? normalizedOcrResult?.numberSourceText ?? null
          : pdfNumberSourceText,
      contextText: rawBoxContextText,
    });
    const wrapperPreservedSelectedSheetNumber = preserveSheetNumberWrapperFromSource(
      finalizedSelectedSheetNumber,
      selectedNumberSourceText,
      pdfNumberSourceText,
      normalizedOcrResult?.numberSourceText ?? null,
      rawBoxContextText,
      page.lines.map((line) => line.text).join("\n")
    );

    const repeatedWeakNumber =
      wrapperPreservedSelectedSheetNumber &&
      /^\d+(?:\.\d+)?$/.test(normalizeKey(wrapperPreservedSelectedSheetNumber)) &&
      (exactCounts[normalizeKey(wrapperPreservedSelectedSheetNumber)] ?? 0) > 1;
    const sheetNumber = repeatedWeakNumber ? "" : wrapperPreservedSelectedSheetNumber;
    const sheetTitle =
      repeatedWeakNumber || !sheetNumber || !cleanedSelectedSheetTitle
        ? ""
        : cleanedSelectedSheetTitle;
    const finalPairConfidence = usedNumberSource === "ocr"
      ? normalizedOcrResult?.confidence ?? 0
      : pdfPairConfidence;
    const confidenceCalibration = calibrateSheetIdentityConfidence({
      rawConfidence: repeatedWeakNumber
        ? Math.min(finalPairConfidence, 0.2)
        : finalPairConfidence,
      sheetNumber,
      sheetTitle,
      numberSource: usedNumberSource,
      titleSource: usedTitleSource,
      numberSourceText:
        usedNumberSource === "ocr"
          ? normalizedOcrResult?.numberSourceText ?? null
          : pdfNumberSourceText,
      titleSourceText:
        usedTitleSource === "ocr"
          ? normalizedOcrResult?.titleSourceText ?? null
          : pdfTitleSourceText,
      pdfPair,
      ocrResult: normalizedOcrResult,
      topPdfPairCandidates: pdfPairCandidateGroups[index] ?? [],
      repeatedWeakNumber: Boolean(repeatedWeakNumber),
      structuredPdfPair: pdfPairStructured,
    });
    const confidence = confidenceCalibration.confidence;
    const ocrGateFailures = pdfOnlyMode
      ? []
      : [
          !normalizedOcrResult ? "ocr_missing" : null,
          normalizedOcrResult && !ocrConfidenceUsable ? "ocr_low_confidence" : null,
          normalizedOcrResult && !ocrNumberPlausible ? "ocr_number_not_plausible" : null,
          normalizedOcrResult && !ocrNumberScoreUsable ? "ocr_number_low_score" : null,
          normalizedOcrResult && !ocrPrefixSupported ? "ocr_prefix_blocked" : null,
          normalizedOcrResult && !ocrTitleEvaluation ? "ocr_title_rejected" : null,
          normalizedOcrResult && !ocrTitleUsable ? "ocr_title_low_score" : null,
          normalizedOcrResult && !ocrPairLocalized ? "ocr_pair_not_localized" : null,
          normalizedOcrResult && !ocrMatchesCompactStampSignal
            ? "ocr_off_compact_stamp_family"
            : null,
        ];
    const selectionGateFailures = [
      !pdfPairUsable && pdfPair ? "pdf_pair_not_usable" : null,
      ...ocrGateFailures,
      !usedNumberSource && !usedTitleSource ? "no_selection_branch" : null,
    ].filter((value): value is string => Boolean(value));
    const chooserRejectReason =
      sheetNumber && sheetTitle
        ? null
        : !normalizedOcrResult
          ? null
          : !ocrPrefixSupported
            ? "ocr_prefix_blocked"
            : !ocrConfidenceUsable
              ? "ocr_low_confidence"
              : !ocrNumberPlausible
                ? "ocr_number_not_plausible"
                : !ocrNumberScoreUsable
                  ? "ocr_number_low_score"
                  : !ocrTitleEvaluation
                    ? "ocr_title_rejected"
                    : !ocrTitleUsable
                      ? "ocr_title_low_score"
                      : !ocrPairLocalized
                        ? "ocr_pair_not_localized"
                        : !ocrMatchesCompactStampSignal
                          ? "ocr_off_compact_stamp_family"
                          : !pdfPairUsable && pdfPair
                            ? "pdf_pair_not_usable"
                            : !usedNumberSource && !usedTitleSource
                              ? "no_selection_branch"
                              : null;
    const rejectReason =
      sheetNumber && sheetTitle
        ? null
        : chooserRejectReason ??
          normalizedOcrResult?.rejectReason ??
          pdfPair?.rejectReason ??
          rawBoxCandidates.find((box) => box.pairRejectReason)?.pairRejectReason ??
          (
            rawBoxCandidates.length === 0
              ? "no_candidate_box"
              : lockedFamily
                ? offFamilyPdfCandidate
                  ? "off_family_box"
                  : "unpaired_box_fields"
                : "no_family_lock"
          );
    const badForStyleRediscovery = !pdfOnlyMode && Boolean(
      (!sheetNumber || !sheetTitle) &&
      selectionGateFailures.some((failure) =>
        failure === "ocr_missing" ||
        failure === "ocr_title_rejected" ||
        failure === "ocr_title_low_score" ||
        failure === "ocr_pair_not_localized" ||
        failure === "ocr_off_compact_stamp_family" ||
        failure === "no_selection_branch"
      )
    );

    if (args.debugSession.artifactsEnabled) {
      args.debugSession.writeJsonArtifact(
        `pages/page-${String(page.pageNumber).padStart(3, "0")}-debug.json`,
        {
          pageNumber: page.pageNumber,
          selectionDecision,
          rejectReason,
          badForStyleRediscovery,
          ocrTitleDiagnostics: !pdfOnlyMode && normalizedOcrResult
            ? {
                threshold: ocrTitleThreshold,
                rawTitle: normalizedOcrResult.sheetTitle ?? null,
                rawTitleSourceText: normalizedOcrResult.titleSourceText ?? null,
                effectiveTitle: effectiveOcrTitleText || null,
              }
            : undefined,
          ocrNumberBoxDiagnostics: page.ocrBacked
            ? {
                detected: Boolean(page.ocrNumberBox),
                bounds: page.ocrNumberBox ?? null,
                inferredBounds: inferOcrLabelAnchoredNumberFieldBounds(page.lines),
                titleBlock: buildOcrNumberBoxRegionDebug(page, "titleBlock"),
                titleTall: buildOcrNumberBoxRegionDebug(page, "titleTall"),
              }
            : undefined,
          pdfSelection: {
            sheetNumber: pdfSheetNumber || null,
            sheetTitle: pdfTitleText || null,
            rawSheetTitle: pdfPair?.sheetTitle ?? effectiveFallbackTitleResult.title ?? null,
            confidence: Number(pdfPairConfidence.toFixed(2)),
            pairScore: Number.isFinite(pdfPairScore)
              ? Number(pdfPairScore.toFixed(1))
              : null,
            scoreBreakdown: serializeScoreBreakdown(pdfPair?.scoreBreakdown),
            contextScoreBreakdown: serializeScoreBreakdown(pdfPair?.contextScoreBreakdown),
            numberSourceText: pdfNumberSourceText,
            titleSourceText: pdfTitleSourceText,
            topPairCandidates: (pdfPairCandidateGroups[index] ?? []).slice(0, 3).map((candidate) => ({
              sheetNumber: candidate.sheetNumber,
              sheetTitle: candidate.sheetTitle,
              score: candidate.score,
              scoreBreakdown: serializeScoreBreakdown(candidate.scoreBreakdown),
              contextScoreBreakdown: serializeScoreBreakdown(candidate.contextScoreBreakdown),
              confidence: candidate.confidence,
              numberCandidateTypeGuess: candidate.numberCandidateTypeGuess ?? null,
              titleCandidateTypeGuess: candidate.titleCandidateTypeGuess ?? null,
              numberReasonCodes: candidate.numberReasonCodes ?? [],
              titleReasonCodes: candidate.titleReasonCodes ?? [],
              styleProfile: candidate.styleProfile ?? null,
              numberRegion: candidate.numberRegion ?? null,
              titleRegion: candidate.titleRegion ?? null,
              numberSourceText: candidate.numberSourceText ?? null,
              titleSourceText: candidate.titleSourceText ?? null,
            })),
            directCornerCandidate: directCornerCandidate
              ? {
                  sheetNumber: directCornerCandidate.sheetNumber,
                  sheetTitle: directCornerCandidate.sheetTitle,
                  score: directCornerCandidate.score,
                  scoreBreakdown: serializeScoreBreakdown(directCornerCandidate.scoreBreakdown),
                  confidence: directCornerCandidate.confidence,
                  numberCandidateTypeGuess:
                    directCornerCandidate.numberCandidateTypeGuess ?? null,
                  titleCandidateTypeGuess:
                    directCornerCandidate.titleCandidateTypeGuess ?? null,
                  numberReasonCodes: directCornerCandidate.numberReasonCodes ?? [],
                  titleReasonCodes: directCornerCandidate.titleReasonCodes ?? [],
                  numberSourceText: directCornerCandidate.numberSourceText ?? null,
                  titleSourceText: directCornerCandidate.titleSourceText ?? null,
                }
              : null,
            localTrace: pdfOnlyMode
              ? buildPyMuPdfLocalTrace({
                  page,
                  exactCounts,
                  prefixCounts,
                  documentTitleStyleProfile,
                })
              : null,
            structuredStampParse: buildStructuredMetadataStampParseDebug(
              page,
              documentTitleStyleProfile
            ),
          },
          ocrSelection: !pdfOnlyMode && normalizedOcrResult
            ? {
                sheetNumber: normalizedOcrResult.sheetNumber,
                sheetTitle:
                  ocrTitleEvaluation?.text ||
                  normalizedOcrResult.sheetTitle,
                confidence: Number(normalizedOcrResult.confidence.toFixed(2)),
                score: normalizedOcrResult.score,
                styleProfile: normalizedOcrResult.styleProfile ?? null,
                rejectReason: normalizedOcrResult.rejectReason ?? null,
              }
            : undefined,
          finalSelection: {
            usedNumberSource: usedNumberSource ?? null,
            usedTitleSource: usedTitleSource ?? null,
            sheetNumber: sheetNumber || null,
            sheetTitle: sheetTitle || null,
            confidence,
            rawConfidence: confidenceCalibration.rawConfidence,
            confidenceTier: confidenceCalibration.tier,
            llmRecommended: confidenceCalibration.llmRecommended,
            repairableEvidence: confidenceCalibration.repairableEvidence,
            confidenceReasons: confidenceCalibration.reasons,
          },
        }
      );
    }

    const initialSheet = {
      sheetNumber,
      sheetTitle,
      discipline: inferSheetDiscipline(sheetNumber, sheetTitle),
      pageNumber: page.pageNumber,
      confidence,
      rawConfidence: confidenceCalibration.rawConfidence,
      identityConfidenceTier: confidenceCalibration.tier,
      identityConfidenceReasons: confidenceCalibration.reasons,
      llmRecommended: confidenceCalibration.llmRecommended,
      repairableEvidence: confidenceCalibration.repairableEvidence,
      referenceText: page.lines.map((line) => line.text).join("\n"),
      numberSourceText:
        usedNumberSource === "ocr"
          ? normalizedOcrResult?.numberSourceText ?? null
          : usedNumberSource === "pdf_text"
            ? pdfNumberSourceText
            : null,
      titleSourceText:
        usedTitleSource === "ocr"
          ? normalizedOcrResult?.titleSourceText ?? null
          : usedTitleSource === "pdf_text"
            ? pdfTitleSourceText
            : null,
      numberSourceKind: usedNumberSource,
      titleSourceKind: usedTitleSource,
    };

    pageSelectionDiagnostics.push({
      pageNumber: page.pageNumber,
      selectionDecision,
      rejectReason,
      selectionGateFailures,
      sheetNumber,
      sheetTitle,
      badForStyleRediscovery,
    });

    return initialSheet;
  });

  applyDocumentSheetIndexFallback({
    sheets: initialSheets,
    diagnostics: pageSelectionDiagnostics,
    pages: pdfDetections.map((detection) => detection.page),
  });

  return {
    initialSheets,
    pageSelectionDiagnostics,
  };
}

function findStyleRediscoveryStartPage(
  diagnostics: readonly PlanSheetSelectionDiagnostic[],
  options?: {
    pdfTextResults?: ReadonlyMap<number, PdfTextExtractionResult>;
    lockedRegionPattern?: LockedOcrRegionPattern | null;
  },
  trigger = LOCK_BAD_PAGE_REDISCOVERY_STREAK
) {
  let streakStartPage: number | null = null;
  let streakLength = 0;

  for (const diagnostic of diagnostics) {
    const ocrResult = options?.pdfTextResults?.get(diagnostic.pageNumber) ?? null;
    const cropFailure =
      !diagnostic.badForStyleRediscovery &&
      hasSuspiciousLockedCropFailure(ocrResult, options?.lockedRegionPattern ?? null);

    if (diagnostic.badForStyleRediscovery || cropFailure) {
      streakStartPage ??= diagnostic.pageNumber;
      streakLength += 1;
      if (streakLength >= trigger) {
        return streakStartPage;
      }
      continue;
    }

    streakStartPage = null;
    streakLength = 0;
  }

  return null;
}

function hasSuspiciousLockedCropFailure(
  result: PdfTextExtractionResult | null,
  lockedRegionPattern: LockedOcrRegionPattern | null
) {
  if (!result || !lockedRegionPattern) {
    return false;
  }

  const titleFailure = hasSuspiciousLockedCropAlignment(
    result.titleBox ?? null,
    lockedRegionPattern.titleBox,
    0.01,
    0.01
  );
  const numberFailure = hasSuspiciousLockedCropAlignment(
    result.numberBox ?? null,
    lockedRegionPattern.numberBox,
    0.008,
    0.006
  );

  return titleFailure || numberFailure;
}

function hasSuspiciousLockedCropAlignment(
  observedBox: OcrNormalizedBox | null | undefined,
  homeBox: OcrNormalizedBox | null | undefined,
  leftThreshold: number,
  rightSlackThreshold: number
) {
  const normalizedObserved = normalizeOcrPatternBox(observedBox);
  const normalizedHome = normalizeOcrPatternBox(homeBox);
  if (!normalizedObserved || !normalizedHome) {
    return false;
  }

  const leftDrift = normalizedHome.x - normalizedObserved.x;
  const rightSlack =
    normalizedHome.x +
    normalizedHome.width -
    (normalizedObserved.x + normalizedObserved.width);

  return leftDrift >= leftThreshold && rightSlack >= rightSlackThreshold;
}

async function rerunStyleRediscoveryFromPage(args: {
  fileBytes: Uint8Array;
  rediscoveryPages: Array<{
    pageNumber: number;
    lines: TextLine[];
  }>;
  preferredStyleProfile: MetadataStyleProfile;
  pageDebugBoxesByPage?: Map<number, MetadataBoxCandidate[]>;
  debugSession: PlanSheetImportDebugSession;
  preparedContext: PreparedPlanSheetSelectionContext;
  existingPdfTextResults: Map<number, PdfTextExtractionResult>;
  priorLockedRegionPattern: LockedOcrRegionPattern | null;
  logLabel: string;
}) {
  const expandedSeedPattern = buildExpandedRediscoverySeedPattern(
    args.priorLockedRegionPattern,
    { patternId: `${args.priorLockedRegionPattern?.patternId ?? "style"}-rediscovery-local` }
  );

  args.debugSession?.log(args.logLabel, {
    stage: "local_metadata_expansion",
    pageNumbers: args.rediscoveryPages.map((page) => page.pageNumber),
    seedLockedRegionPattern: expandedSeedPattern
      ? `${expandedSeedPattern.patternId}:${expandedSeedPattern.styleProfile}:${expandedSeedPattern.numberRegion}->${expandedSeedPattern.titleRegion} (${expandedSeedPattern.supportPages})`
      : null,
  });

  let rerunResults = await runOcrExtractionsForPages(
    Uint8Array.from(args.fileBytes),
    args.rediscoveryPages,
    args.preferredStyleProfile,
    args.pageDebugBoxesByPage ?? new Map<number, MetadataBoxCandidate[]>(),
    args.debugSession,
    {
      seedLockedRegionPattern: expandedSeedPattern,
      useSeedRediscoveryBoxes: true,
      allowExtendedFallback: false,
      allowSecondaryFallback: false,
      forceDisableBroadRediscovery: true,
    }
  );

  let mergedResults = new Map(args.existingPdfTextResults);
  for (const [pageNumber, result] of rerunResults) {
    mergedResults.set(pageNumber, result);
  }

  let builtSheets = buildInitialPlanSheetsFromPreparedContext({
    pageCount: args.preparedContext.pdfDetections.length,
    preparedContext: args.preparedContext,
    pdfTextResults: mergedResults,
    debugSession: args.debugSession,
  });
  let unresolvedPageNumbers = builtSheets.pageSelectionDiagnostics
    .filter(
      (diagnostic) =>
        diagnostic.badForStyleRediscovery &&
        args.rediscoveryPages.some((page) => page.pageNumber === diagnostic.pageNumber)
    )
    .map((diagnostic) => diagnostic.pageNumber);

  if (unresolvedPageNumbers.length > 0) {
    args.debugSession?.log(args.logLabel, {
      stage: "metadata_region_discovery",
      unresolvedPageNumbers,
    });

    rerunResults = await runOcrExtractionsForPages(
      Uint8Array.from(args.fileBytes),
      args.rediscoveryPages,
      args.preferredStyleProfile,
      args.pageDebugBoxesByPage ?? new Map<number, MetadataBoxCandidate[]>(),
      args.debugSession,
      {
        seedLockedRegionPattern: null,
        allowExtendedFallback: false,
        allowSecondaryFallback: false,
      }
    );

    mergedResults = new Map(args.existingPdfTextResults);
    for (const [pageNumber, result] of rerunResults) {
      mergedResults.set(pageNumber, result);
    }

    builtSheets = buildInitialPlanSheetsFromPreparedContext({
      pageCount: args.preparedContext.pdfDetections.length,
      preparedContext: args.preparedContext,
      pdfTextResults: mergedResults,
      debugSession: args.debugSession,
    });
    unresolvedPageNumbers = builtSheets.pageSelectionDiagnostics
      .filter(
        (diagnostic) =>
          diagnostic.badForStyleRediscovery &&
          args.rediscoveryPages.some((page) => page.pageNumber === diagnostic.pageNumber)
      )
      .map((diagnostic) => diagnostic.pageNumber);
  }

  return {
    pdfTextResults: mergedResults,
    builtSheets,
    unresolvedPageNumbers,
  } satisfies RediscoveryAttemptOutcome;
}

function finalizeSelectedPlanSheets(
  initialSheets: readonly ExtractedPlanSheet[]
) {
  return initialSheets.map((sheet) => {
    const sourceRepairedTitle = repairSheetTitleFromSourceText({
      currentTitle: sheet.sheetTitle,
      sourceText: sheet.titleSourceText,
      sheetNumber: sheet.sheetNumber,
    });
    const contextRepairedTitle = repairSheetTitleWithSheetNumberContext(
      sourceRepairedTitle || sheet.sheetTitle,
      sheet.sheetNumber
    );
    const publicSheet = {
      ...sheet,
      sheetTitle: contextRepairedTitle || sheet.sheetTitle,
      titleSourceText: sourceRepairedTitle
        ? sheet.titleSourceText
        : sheet.titleSourceText,
    };
    const discipline = inferSheetDiscipline(
      publicSheet.sheetNumber,
      publicSheet.sheetTitle
    );
    return discipline === sheet.discipline
      ? publicSheet
      : {
          ...publicSheet,
          discipline,
        };
  });
}

export async function extractPlanSheetsFromReplayInput(
  input: PlanSheetImportReplayInput,
  options?: {
    forceDebugArtifacts?: boolean;
  }
) {
  const debugSession = createPlanSheetImportDebugSession({
    forceArtifacts: options?.forceDebugArtifacts,
  });
  const totalTimer = debugSession.startTimer("extract_plan_sheets_replay");

  try {
    const pdfTextResults = new Map<number, PdfTextExtractionResult>();
    if (debugSession.artifactsEnabled) {
      debugSession.writeJsonArtifact("replay-input.json", input);
    }
    const preparedContext = preparePlanSheetSelectionContext({
      pages: input.pages,
      pageCount: input.pageCount,
      debugSession,
    });
    const { initialSheets } = buildInitialPlanSheetsFromPreparedContext({
      pageCount: input.pageCount,
      preparedContext,
      pdfTextResults,
      debugSession,
    });
    const sheets = finalizeSelectedPlanSheets(initialSheets);

    totalTimer.end({
      pageCount: input.pageCount,
      ocrPageCount: 0,
      replayMode: "prepared_input",
      mode: "pdf_only",
    });
    debugSession.end({
      pageCount: input.pageCount,
      ocrPageCount: 0,
      replayMode: "prepared_input",
      mode: "pdf_only",
    });

    return {
      pageCount: input.pageCount,
      sheets,
      debugSessionId: debugSession.sessionId,
      debugArtifactsDir: debugSession.artifactsDir,
      replayMode: "prepared_input" as const,
    };
  } catch (error) {
    totalTimer.end({
      result: "error",
      error:
        error instanceof Error ? error.message : "Unknown replay extractPlanSheets error",
    });
    debugSession.end({
      result: "error",
      replayMode: "prepared_input",
    });
    throw error;
  }
}

export const __planSheetImportTestUtils = {
  buildMetadataStampNumberCandidates,
  buildDocumentSheetIndexEntries,
  buildDocumentSheetIndexSequenceAlignment,
  buildStructuredMetadataStampPairCandidate,
  buildRotatedMetadataBlockOrderTextLines,
  buildTextLinesFromPositionedItems,
  buildPageModelFromLines,
  collectRightEdgeRotatedTitleLines,
  buildBestRightEdgeRotatedTitleCandidate,
  countTitleVocabularyHits,
  evaluateTitleSelection,
  scoreTitleSelectionCandidate,
  findPageEmbeddedDocumentSheetIndexEntry,
  findPageLocalDocumentSheetIndexEntry,
  pageLocallySupportsDocumentSheetIndexEntry,
  calibrateSheetIdentityConfidence,
  finalizeSelectedPlanSheets,
  shouldSuppressDirectPdfPairSelection,
  refineSheetNumberCandidateFromLineText,
  normalizeSheetNumberValue,
  normalizeTitleSelectionText,
  getPreferredDocumentSheetIndexTitle,
  shouldPreferDocumentSheetIndexTitle,
  shouldPreferDocumentReferencedTitle,
  countSheetReferenceTokens,
  getStyleProfileForRegion,
  getSheetNumberRejectPenalty,
  getTitleRejectPenalty,
  getMetadataBoxFamilyFromBbox,
  getMetadataBoxRejectReason,
  isRepeatedProjectLikeTitle,
  parseSheetNumberParts,
  inferDocumentStyleProfile,
  getSequenceConsistencyBoost,
  scorePdfPairCandidateWithContext,
};
