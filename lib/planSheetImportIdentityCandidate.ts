import type { ScoreBreakdown } from "./planSheetImportScoring";

export type NormalizedSheetIdentityBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SheetIdentitySourceKind = "pdf_text" | "document_index";

export type SheetIdentityEvidence = {
  numberRegex: string[];
  titleVocabularyHits: string[];
  fieldLabels: string[];
  geometry: string[];
  documentContext: string[];
  rejectSignals: string[];
};

export type SheetIdentityCandidate = {
  sheetNumber: string;
  sheetTitle: string;
  pageNumber: number;
  numberSource: SheetIdentitySourceKind;
  titleSource: SheetIdentitySourceKind;
  numberSourceText: string | null;
  titleSourceText: string | null;
  numberBox: NormalizedSheetIdentityBox | null;
  titleBox: NormalizedSheetIdentityBox | null;
  evidence: SheetIdentityEvidence;
  score: number;
  scoreBreakdown?: ScoreBreakdown;
};
