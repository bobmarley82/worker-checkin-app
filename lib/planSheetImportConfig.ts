import type {
  MetadataFamilyDefinition,
  MetadataRegionId,
  MetadataStyleProfile,
} from "./planSheetImportTypes";

export const PLAN_SHEET_IMPORT_PDF_ONLY = true;

/**
 * Phase 2 intentionally removes OCR from the runtime pipeline. The legacy names
 * below stay exported only so older helper code can compile while it is being
 * unwound; they no longer enable OCR behavior.
 */
export const OCR_IMAGE_SUPPRESSED_MAX_IMAGE_SIZE = 0;
export const OCR_IMAGE_SUPPRESSED_MIN_LINE_COUNT = 8;
export const OCR_IMAGE_SUPPRESSED_MIN_EDGE_LINE_COUNT = 6;
export const OCR_IMAGE_SUPPRESSED_MIN_CANDIDATE_SCORE = 220;
export const PLAN_SHEET_IMPORT_DISABLE_OCR = true;
export const PLAN_SHEET_IMPORT_ENABLE_DOCUMENT_STYLE_PREPASS =
  process.env.PLAN_SHEET_IMPORT_ENABLE_DOCUMENT_STYLE_PREPASS === "1";
export const PDF_PAIR_MIN_SCORE = 40;
export const LOCALIZED_PDF_TITLE_MIN_ADMIT_SCORE = 24;

export const SHEET_NUMBER_LABEL_PATTERN =
  /^(sheet\s*(?:number|no|#)|drawing\s*(?:number|no)|dwg(?:\s*(?:#|number|no))?)\b/i;
export const SHEET_NUMBER_LABEL_SEARCH_PATTERN =
  /\b(sheet\s*(?:number|no|#)|drawing\s*(?:number|no)|dwg(?:\s*(?:#|number|no))?)\b/i;
export const EXPLICIT_SHEET_NUMBER_LABEL_SEARCH_PATTERN =
  /\b(sheet\s*(?:number|no)|drawing\s*(?:number|no)|dwg(?:\s*(?:#|number|no))?)\b/i;
export const TITLE_LABEL_PATTERN =
  /^(sheet title|drawing title|project title|title|sheet)\b/i;
export const TITLE_LABEL_SEARCH_PATTERN =
  /\b(sheet title|drawing title|project title|title|sheet)\b/i;
export const TITLE_FIELD_LABEL_PATTERN =
  /^(sheet\s*title|drawing\s*title)\b/i;
export const TITLE_FIELD_LABEL_SEARCH_PATTERN =
  /\b(sheet\s*title|drawing\s*title)\b/i;
export const NON_TITLE_FIELD_LABEL_PATTERN =
  /^(date|description|drawn(?:\s*by)?|drafted\s*by|checked(?:\s*by)?|checker|review(?:ed)?\s*by|approved(?:\s*by)?|job\s*#?|job number|project number|project id|location|address|scale|revision|section number|issue note|plot date|owner|client)\b/i;
export const NEXT_FIELD_LABEL_SEARCH_PATTERN =
  /\b(sheet number|drawing number|drawing no|dwg(?:\s*#|\s*number)?|sheet no|sheet title|drawing title|project title|title|date|drawn|checked by|checked|review by|job\s*#?|job number|project number|project id|location|scale|revision|section number|issue note|plot date)\b/i;
export const PLAN_SHEET_IMPORT_FORCE_OCR_ALL_PAGES = false;

export const PDF_METADATA_REGIONS: Array<{
  id: MetadataRegionId;
  x: number;
  y: number;
  width: number;
  height: number;
  weight: number;
}> = [
  {
    id: "stripFull",
    x: 0.928,
    y: 0.868,
    width: 0.072,
    height: 0.124,
    weight: 352,
  },
  {
    id: "stripTitle",
    x: 0.924,
    y: 0.872,
    width: 0.076,
    height: 0.082,
    weight: 340,
  },
  {
    id: "stripNumber",
    x: 0.922,
    y: 0.926,
    width: 0.076,
    height: 0.05,
    weight: 360,
  },
  {
    id: "sheetStamp",
    x: 0.918,
    y: 0.908,
    width: 0.082,
    height: 0.074,
    weight: 372,
  },
  {
    id: "titleBlock",
    x: 0.83,
    y: 0.84,
    width: 0.17,
    height: 0.12,
    weight: 175,
  },
  {
    id: "titleTall",
    x: 0.83,
    y: 0.804,
    width: 0.17,
    height: 0.156,
    weight: 171,
  },
  {
    id: "numberBlock",
    x: 0.86,
    y: 0.83,
    width: 0.12,
    height: 0.14,
    weight: 165,
  },
  {
    id: "bottomRight",
    x: 0.76,
    y: 0.74,
    width: 0.24,
    height: 0.24,
    weight: 120,
  },
  {
    id: "bottomLeft",
    x: 0,
    y: 0.84,
    width: 0.18,
    height: 0.16,
    weight: 140,
  },
  {
    id: "leftTitleBlock",
    x: 0.04,
    y: 0.88,
    width: 0.1,
    height: 0.1,
    weight: 180,
  },
  {
    id: "leftNumberBlock",
    x: 0,
    y: 0.88,
    width: 0.05,
    height: 0.11,
    weight: 190,
  },
];

export const PDF_METADATA_REGION_MAP = new Map(
  PDF_METADATA_REGIONS.map((region) => [region.id, region])
);

export const PDF_METADATA_FAMILIES: MetadataFamilyDefinition[] = [
  {
    id: "bottom_right_strip",
    fullRegionId: "sheetStamp",
    titleRegionId: "stripTitle",
    numberRegionId: "stripNumber",
    prior: 126,
  },
  {
    id: "bottom_right_block",
    fullRegionId: "bottomRight",
    titleRegionId: "titleBlock",
    numberRegionId: "sheetStamp",
    prior: 104,
  },
  {
    id: "bottom_left_block",
    fullRegionId: "bottomLeft",
    titleRegionId: "leftTitleBlock",
    numberRegionId: "leftNumberBlock",
    prior: 96,
  },
];

export function isLockEligibleStyleProfile(styleProfile: MetadataStyleProfile) {
  return styleProfile !== "mixed";
}
