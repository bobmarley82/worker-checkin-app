import type { ScoreBreakdown } from "./planSheetImportScoring";

/**
 * PDF-only Phase 2 compatibility types.
 *
 * The importer no longer imports or executes the OCR module. These aliases keep
 * older internal replay/debug shapes compiling while the remaining legacy
 * OCR-specific helpers are unwired from the runtime pipeline.
 */
export type OcrRegionId =
  | "stripTitle"
  | "stripNumber"
  | "sheetStamp"
  | "titleBlock"
  | "titleTall"
  | "numberBlock"
  | "bottomRight"
  | "bottomLeft"
  | "leftTitleBlock"
  | "leftNumberBlock"
  | "footerBubble"
  | "footerBubbleTight"
  | "footerColumn"
  | string;

export type OcrStyleProfile =
  | "bottom_right_strip"
  | "bottom_right_block"
  | "bottom_left_block"
  | "mixed"
  | string;

export type OcrNormalizedBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextExtractionResult = {
  sheetNumber: string;
  sheetTitle: string;
  confidence: number;
  score: number;
  numberScore?: number | null;
  titleScore?: number | null;
  numberSourceText?: string | null;
  titleSourceText?: string | null;
  numberRegion?: OcrRegionId | null;
  titleRegion?: OcrRegionId | null;
  numberBox?: OcrNormalizedBox | null;
  titleBox?: OcrNormalizedBox | null;
  styleProfile?: OcrStyleProfile | null;
  rejectReason?: string | null;
};

export type ExtractedPlanSheet = {
  sheetNumber: string;
  sheetTitle: string;
  discipline: string | null;
  pageNumber: number;
  confidence: number | null;
  rawConfidence: number | null;
  identityConfidenceTier: SheetIdentityConfidenceTier;
  identityConfidenceReasons: string[];
  llmRecommended: boolean;
  repairableEvidence: boolean;
  referenceText: string;
  numberSourceText: string | null;
  titleSourceText: string | null;
  numberSourceKind: "ocr" | "pdf_text" | null;
  titleSourceKind: "ocr" | "pdf_text" | null;
};

export type PlanSheetImportProgress = {
  stage: "pdf_page_extracted";
  pageNumber: number;
  processedPageCount: number;
  selectedPageCount: number;
  sourcePageCount: number;
};

export type PlanSheetSelectionDiagnostic = {
  pageNumber: number;
  selectionDecision: string;
  rejectReason: string | null;
  selectionGateFailures: string[];
  sheetNumber: string;
  sheetTitle: string;
  badForStyleRediscovery: boolean;
};

export type BuiltInitialPlanSheets = {
  initialSheets: ExtractedPlanSheet[];
  pageSelectionDiagnostics: PlanSheetSelectionDiagnostic[];
};

export type PlanSheetImportReplayInput = {
  version: 1;
  pageCount: number;
  pages: PageExtractionModel[];
  /**
   * Deprecated in Phase 2 PDF-only mode. Existing replay JSON can still carry
   * this field, but the runtime importer ignores it.
   */
  pdfTextResults?: Array<{
    pageNumber: number;
    result: PdfTextExtractionResult;
  }>;
};

export type PositionedTextItem = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
  normX: number;
  normY: number;
  normWidth: number;
  normHeight: number;
  blockId?: number | null;
  lineId?: number | null;
  wordId?: number | null;
  fontSize?: number | null;
  fontName?: string | null;
  fontFlags?: number | null;
  isBold?: boolean;
};

export type PageDrawingSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  normX0: number;
  normY0: number;
  normX1: number;
  normY1: number;
  width?: number | null;
};

export type TextLine = {
  text: string;
  items: PositionedTextItem[];
  x: number;
  top: number;
  width: number;
  height: number;
  normX: number;
  normY: number;
  normWidth: number;
  normHeight: number;
  blockId?: number | null;
  lineId?: number | null;
  fontSize?: number | null;
  fontSizeMin?: number | null;
  fontSizeMax?: number | null;
  isBold?: boolean;
};

export type SheetNumberCandidate = {
  value: string;
  score: number;
  lineIndex: number;
  normX: number;
  normY: number;
  normWidth: number;
  normHeight: number;
  width: number;
  height: number;
  lineText: string;
  isNumericOnly: boolean;
  prefix: string;
};

export type MetadataRegionId =
  | "stripFull"
  | "stripTitle"
  | "stripNumber"
  | "sheetStamp"
  | "titleBlock"
  | "titleTall"
  | "numberBlock"
  | "bottomRight"
  | "bottomLeft"
  | "leftTitleBlock"
  | "leftNumberBlock";

export type MetadataStyleProfile =
  | "bottom_right_strip"
  | "bottom_right_block"
  | "bottom_left_block"
  | "mixed";

export type MetadataFamilyDefinition = {
  id: Exclude<MetadataStyleProfile, "mixed">;
  fullRegionId: MetadataRegionId;
  titleRegionId: MetadataRegionId;
  numberRegionId: MetadataRegionId;
  prior: number;
  fallbackOnly?: boolean;
};

export type LabeledFieldMatch = {
  value: string;
  lineIndex: number;
  score: number;
  normX: number;
  normY: number;
  normWidth: number;
  normHeight: number;
  width: number;
  height: number;
};

export type MetadataFieldKind =
  | "title"
  | "sheet_number"
  | "project"
  | "facility"
  | "building_id"
  | "floor_level"
  | "scale"
  | "project_number"
  | "job_number"
  | "checker"
  | "drafter"
  | "issue_date"
  | "revision"
  | "date"
  | "unknown";

export type MetadataStampField = {
  labelText: string;
  labelKind: MetadataFieldKind;
  labelLine: TextLine;
  valueLines: TextLine[];
  valueText: string;
  sourceText: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  score: number;
};

export type MetadataStampValueCandidate = {
  value: string;
  sourceText: string;
  lineIndexes: number[];
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  score: number;
};

export type MetadataStampParse = {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceKind: "pdf_text" | "ocr";
  searchPage: PageExtractionModel;
  fields: MetadataStampField[];
  titleField: MetadataStampField | null;
  numberField: MetadataStampField | null;
  titleCandidates: MetadataStampValueCandidate[];
  numberCandidates: MetadataStampValueCandidate[];
  confidence: number;
};

export type PageExtractionModel = {
  pageNumber: number;
  lines: TextLine[];
  searchLines?: TextLine[];
  sheetIndexLines?: string[];
  candidates: SheetNumberCandidate[];
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
  ocrBacked?: boolean;
};

export type DetectedSheetTitle = {
  title: string;
  sourceText: string;
  lineIndex: number | null;
  lineIndexes?: number[];
};

export type TitleCandidate = {
  text: string;
  sourceText: string;
  score: number;
  lineIndex?: number | null;
  lineIndexes?: number[];
};

export type MetadataBoxTitleAttempt = {
  text: string;
  sourceText: string;
  score: number | null;
  lineIndex: number | null;
  candidateTypeGuess?: CandidateTypeGuess;
  reasonCodes?: string[];
  rejectReason?: string | null;
};

export type CandidateTypeGuess =
  | "sheet_number"
  | "drawing_title"
  | "title_label"
  | "scale"
  | "date"
  | "revision"
  | "project_name"
  | "company_name"
  | "address_or_contact"
  | "sheet_reference"
  | "drawing_body_noise"
  | "unknown";

export type PairedSheetCandidate = {
  sheetNumber: string;
  sheetTitle: string;
  numberSourceText: string;
  titleSourceText: string;
  numberLineIndex: number | null;
  titleLineIndex: number | null;
  numberRegion: MetadataRegionId;
  titleRegion: MetadataRegionId;
  pairedCluster: string;
  styleProfile: MetadataStyleProfile;
  familyId: MetadataStyleProfile;
  localClusterBbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  sourceAgreement?: boolean;
  rejectReason?: string | null;
  numberCandidateTypeGuess?: CandidateTypeGuess;
  titleCandidateTypeGuess?: CandidateTypeGuess;
  numberReasonCodes?: string[];
  titleReasonCodes?: string[];
  numberScore: number;
  titleScore: number;
  score: number;
  scoreBreakdown?: ScoreBreakdown;
  contextScoreBreakdown?: ScoreBreakdown;
  confidence: number;
};

export type SheetIdentityConfidenceTier =
  | "trusted"
  | "needs_review"
  | "insufficient_evidence";

export type SheetIdentityConfidenceCalibration = {
  confidence: number;
  rawConfidence: number;
  tier: SheetIdentityConfidenceTier;
  llmRecommended: boolean;
  repairableEvidence: boolean;
  reasons: string[];
};

export type MetadataBoxCandidate = {
  source: "pdf";
  sourceModel: "page" | "compact_stamp";
  familyId: MetadataStyleProfile;
  regionId: MetadataRegionId;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lines: TextLine[];
  anchorCandidate: SheetNumberCandidate;
  distinctNumberCount: number;
  titleLikeCount: number;
  titleVocabularyHits: number;
  rejectReason?: string | null;
  pairRejectReason?: string | null;
  pairGeometryRejectReason?: string | null;
  pairSubclusterBbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  selectedTitleLineIndexes?: number[];
  titleAttempts?: MetadataBoxTitleAttempt[];
  score: number;
};

export type SheetNumberDetection = {
  sheetNumber: string;
  confidence: number;
  winner: SheetNumberCandidate | null;
};

export type PagePairDetection = {
  page: PageExtractionModel;
  pdfPair: PairedSheetCandidate | null;
  fallbackNumberResult: SheetNumberDetection;
  fallbackTitleResult: DetectedSheetTitle;
};

export type PreparedPlanSheetSelectionContext = {
  exactCounts: Record<string, number>;
  prefixCounts: Record<string, number>;
  repeatedLineCounts: Record<string, number>;
  documentTitleStyleProfile: DocumentTitleStyleProfile;
  documentReferencedSheetTitles: ReadonlyMap<string, string>;
  pdfRawBoxCandidateGroups: MetadataBoxCandidate[][];
  pdfPairCandidateGroups: PairedSheetCandidate[][];
  familyLock: FamilyLockDecision;
  documentStyleProfile: MetadataStyleProfile;
  strongPrefixCounts: Record<string, number>;
  pdfDetections: PagePairDetection[];
};

export type DocumentTitleStyleProfile = {
  frequentLineCounts: Record<string, number>;
  frequentPairCounts: Record<string, number>;
  frequentStructuredSuffixCounts: Record<string, number>;
  structureCounts: Record<string, number>;
};

export type FamilyLockDecision = {
  styleProfile: MetadataStyleProfile;
  locked: boolean;
  supportPages: number;
  supportScore: number;
  runnerUpStyleProfile: MetadataStyleProfile | null;
  runnerUpPages: number;
  runnerUpScore: number;
};

export type OcrRegionPatternObservation = {
  pageNumber: number;
  styleProfile: OcrStyleProfile;
  numberRegion: OcrRegionId;
  titleRegion: OcrRegionId;
  numberBox: OcrNormalizedBox | null;
  titleBox: OcrNormalizedBox | null;
  score: number;
};

export type OcrRegionPatternDecision = {
  locked: boolean;
  styleProfile: OcrStyleProfile | null;
  supportPages: number;
  numberRegion: OcrRegionId | null;
  numberSupportPages: number;
  titleRegion: OcrRegionId | null;
  titleSupportPages: number;
  runnerUpStyleProfile: OcrStyleProfile | null;
  runnerUpPages: number;
};

export type LockedOcrRegionPattern = {
  patternId: string;
  styleId: string;
  styleProfile: OcrStyleProfile;
  numberRegion: OcrRegionId;
  titleRegion: OcrRegionId;
  numberBox: OcrNormalizedBox | null;
  titleBox: OcrNormalizedBox | null;
  rediscoveryNumberBox: OcrNormalizedBox | null;
  rediscoveryTitleBox: OcrNormalizedBox | null;
  rediscoveryNeighborhoodBox: OcrNormalizedBox | null;
  supportPages: number;
  hitCount: number;
  lastUsedPage: number | null;
};

export type RediscoveryAttemptOutcome = {
  pdfTextResults: Map<number, PdfTextExtractionResult>;
  builtSheets: BuiltInitialPlanSheets;
  unresolvedPageNumbers: number[];
};

export type OcrPatternLockState = {
  activePattern: LockedOcrRegionPattern | null;
  storedPatterns: LockedOcrRegionPattern[];
  discoveryObservations: OcrRegionPatternObservation[];
  pendingObservations: OcrRegionPatternObservation[];
  missStreak: number;
  nextPatternId: number;
  mode: "discovery" | "locked" | "local_expansion" | "style_fallback" | "broad_rediscovery";
  rediscoveryReason: string | null;
};

export type PdfPageLike = {
  getViewport: (options: { scale: number }) => {
    width: number;
    height: number;
  };
  render: (options: {
    canvasContext: unknown;
    viewport: unknown;
  }) => {
    promise: Promise<void>;
  };
  cleanup: () => void;
};

export type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  cleanup: () => Promise<void> | void;
  destroy: () => Promise<void> | void;
};
