export const TRAINING_SHEET_KIND_VALUES = [
  "cover_sheet",
  "sheet_index",
  "site_plan",
  "floor_plan",
  "reflected_ceiling_plan",
  "roof_plan",
  "electrical_plan",
  "power_plan",
  "lighting_plan",
  "one_line_diagram",
  "schedule_sheet",
  "detail_sheet",
  "elevation_sheet",
  "section_sheet",
  "spec_sheet",
  "vendor_reference",
  "other",
] as const;

export type SheetKind = (typeof TRAINING_SHEET_KIND_VALUES)[number];

export const TRAINING_SHEET_TYPE_VALUES = [
  "cover",
  "index",
  "information",
  "plan",
  "elevation",
  "section",
  "detail",
  "schedule",
  "legend_notes",
  "diagram",
  "specification",
  "vendor_reference",
  "other",
] as const;

export type SheetType = (typeof TRAINING_SHEET_TYPE_VALUES)[number];

export const TRAINING_SHEET_KIND_OPTIONS: Array<{
  value: SheetKind;
  label: string;
}> = [
  { value: "cover_sheet", label: "Cover Sheet" },
  { value: "sheet_index", label: "Sheet Index" },
  { value: "site_plan", label: "Site Plan" },
  { value: "floor_plan", label: "Floor Plan" },
  { value: "reflected_ceiling_plan", label: "Reflected Ceiling Plan" },
  { value: "roof_plan", label: "Roof Plan" },
  { value: "electrical_plan", label: "Electrical Plan" },
  { value: "power_plan", label: "Power Plan" },
  { value: "lighting_plan", label: "Lighting Plan" },
  { value: "one_line_diagram", label: "One-Line Diagram" },
  { value: "schedule_sheet", label: "Schedule Sheet" },
  { value: "detail_sheet", label: "Detail Sheet" },
  { value: "elevation_sheet", label: "Elevation Sheet" },
  { value: "section_sheet", label: "Section Sheet" },
  { value: "spec_sheet", label: "Spec Sheet" },
  { value: "vendor_reference", label: "Vendor Reference" },
  { value: "other", label: "Other" },
];

export const TRAINING_SHEET_TYPE_OPTIONS: Array<{
  value: SheetType;
  label: string;
}> = [
  { value: "cover", label: "Cover" },
  { value: "index", label: "Index" },
  { value: "information", label: "Information" },
  { value: "plan", label: "Plan" },
  { value: "elevation", label: "Elevation" },
  { value: "section", label: "Section" },
  { value: "detail", label: "Detail" },
  { value: "schedule", label: "Schedule" },
  { value: "legend_notes", label: "Legend / Notes" },
  { value: "diagram", label: "Diagram" },
  { value: "specification", label: "Specification" },
  { value: "vendor_reference", label: "Vendor Reference" },
  { value: "other", label: "Other" },
];

export const TRAINING_CORRECTION_REASON_VALUES = [
  "manual_review",
  "sheet_number_fix",
  "sheet_title_fix",
  "discipline_fix",
  "sheet_kind_fix",
  "multiple_metadata_fixes",
  "model_false_positive",
] as const;

export type CorrectionReason =
  | (typeof TRAINING_CORRECTION_REASON_VALUES)[number]
  | "";

export type TrainingMetadataField =
  | "sheet_number"
  | "sheet_title"
  | "discipline"
  | "sheet_type"
  | "scope_tags"
  | "area_tags"
  | "sheet_kind";

type TrainingMetadataSnapshot = {
  sheet_number?: string | null;
  sheet_title?: string | null;
  discipline?: string | null;
  sheet_type?: string | null;
  scope_tags?: readonly string[] | string | null;
  area_tags?: readonly string[] | string | null;
  sheet_kind?: string | null;
};

type TrainingModelSnapshotLike = TrainingMetadataSnapshot & {
  extraction_confidence?: number | null;
};

export const TRAINING_CORRECTION_REASON_OPTIONS: Array<{
  value: CorrectionReason;
  label: string;
}> = [
  { value: "", label: "No correction reason" },
  { value: "manual_review", label: "Manual Review" },
  { value: "sheet_number_fix", label: "Sheet Number Fix" },
  { value: "sheet_title_fix", label: "Sheet Title Fix" },
  { value: "discipline_fix", label: "Discipline Fix" },
  { value: "sheet_kind_fix", label: "Sheet Kind Fix" },
  { value: "multiple_metadata_fixes", label: "Multiple Metadata Fixes" },
  { value: "model_false_positive", label: "Model False Positive" },
];

export type TrainingVerificationStatus =
  | "Unsaved"
  | "Saved"
  | "Saved and verified"
  | "Save mismatch"
  | "Missing artifact";

export type TrainingVerificationInputs = {
  savedReview:
    | {
        sheet_number: string;
        sheet_title: string;
        discipline: string | null;
        sheet_type?: string | null;
        scope_tags?: readonly string[] | string | null;
        area_tags?: readonly string[] | string | null;
        sheet_kind?: string | null;
        correction_reason: string | null;
        correction_note: string | null;
        page_image_path: string | null;
      }
    | null
    | undefined;
  expected:
    | {
        sheet_number: string;
        sheet_title: string;
        discipline: string | null;
        sheet_type?: string | null;
        scope_tags?: readonly string[] | string | null;
        area_tags?: readonly string[] | string | null;
        sheet_kind?: string | null;
        correction_reason: string | null;
        correction_note: string | null;
      }
    | null
    | undefined;
  regionCount?: number;
  candidateCount?: number;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const DISCIPLINE_LABELS: Record<string, string> = {
  a: "Architectural",
  architectural: "Architectural",
  c: "Civil",
  civil: "Civil",
  e: "Electrical",
  electrical: "Electrical",
  foodservice: "Food Service",
  "food service": "Food Service",
  g: "General",
  general: "General",
  h: "Hazardous",
  hvac: "Mechanical",
  interiors: "Interiors",
  landscape: "Landscape",
  m: "Mechanical",
  mechanical: "Mechanical",
  p: "Plumbing",
  plumbing: "Plumbing",
  s: "Structural",
  structural: "Structural",
  t: "Telecommunications",
  telecom: "Telecommunications",
  telecommunications: "Telecommunications",
  technology: "Technology",
  title: "Title",
  f: "Fire Protection",
  fire: "Fire Protection",
  "fire protection": "Fire Protection",
  "fire alarm": "Fire Alarm",
};

const FLOOR_TAGS: Array<[RegExp, string]> = [
  [/\b1(?:ST)?\s+FLOOR\b/i, "first_floor"],
  [/\bFIRST\s+FLOOR\b/i, "first_floor"],
  [/\b2(?:ND)?\s+FLOOR\b/i, "second_floor"],
  [/\bSECOND\s+FLOOR\b/i, "second_floor"],
  [/\b3(?:RD)?\s+FLOOR\b/i, "third_floor"],
  [/\bTHIRD\s+FLOOR\b/i, "third_floor"],
  [/\b4(?:TH)?\s+FLOOR\b/i, "fourth_floor"],
  [/\bFOURTH\s+FLOOR\b/i, "fourth_floor"],
  [/\b5(?:TH)?\s+FLOOR\b/i, "fifth_floor"],
  [/\bFIFTH\s+FLOOR\b/i, "fifth_floor"],
  [/\b6(?:TH)?\s+FLOOR\b/i, "sixth_floor"],
  [/\bSIXTH\s+FLOOR\b/i, "sixth_floor"],
  [/\b7(?:TH)?\s+FLOOR\b/i, "seventh_floor"],
  [/\bSEVENTH\s+FLOOR\b/i, "seventh_floor"],
  [/\b8(?:TH)?\s+FLOOR\b/i, "eighth_floor"],
  [/\bEIGHTH\s+FLOOR\b/i, "eighth_floor"],
  [/\b9(?:TH)?\s+FLOOR\b/i, "ninth_floor"],
  [/\bNINTH\s+FLOOR\b/i, "ninth_floor"],
  [/\b10(?:TH)?\s+FLOOR\b/i, "tenth_floor"],
  [/\bTENTH\s+FLOOR\b/i, "tenth_floor"],
  [/\bUPPER\s+FLOOR\b/i, "upper_floor"],
  [/\bLOWER\s+FLOOR\b/i, "lower_floor"],
];

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function legacySheetKindToSheetType(value: string | null | undefined): SheetType | "" {
  switch (normalizeWhitespace(value ?? "")) {
    case "cover_sheet":
      return "cover";
    case "sheet_index":
      return "index";
    case "site_plan":
    case "floor_plan":
    case "reflected_ceiling_plan":
    case "roof_plan":
    case "electrical_plan":
    case "power_plan":
    case "lighting_plan":
      return "plan";
    case "one_line_diagram":
      return "diagram";
    case "schedule_sheet":
      return "schedule";
    case "detail_sheet":
      return "detail";
    case "elevation_sheet":
      return "elevation";
    case "section_sheet":
      return "section";
    case "spec_sheet":
      return "specification";
    case "vendor_reference":
      return "vendor_reference";
    default:
      return "";
  }
}

function pushIfMatch(
  tags: Set<string>,
  value: string | null | undefined,
  pattern: RegExp,
  tag: string
) {
  if (pattern.test(value ?? "")) {
    tags.add(tag);
  }
}

export function normalizeTrainingDiscipline(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) {
    return null;
  }

  const key = normalized.toLowerCase();
  return DISCIPLINE_LABELS[key] ?? toTitleCase(normalized);
}

export function normalizeTrainingTag(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized || "";
}

export function parseTrainingTagList(
  value: readonly string[] | string | null | undefined
) {
  let source: string[] = [];

  if (Array.isArray(value)) {
    source = [...value];
  } else if (normalizeWhitespace(String(value ?? ""))) {
    source = String(value)
      .split(/[,\n]/)
      .map((entry) => entry.trim());
  }

  return [...new Set(source.map((entry) => normalizeTrainingTag(entry)).filter(Boolean))].sort();
}

export function formatTrainingTagList(value: readonly string[] | string | null | undefined) {
  return parseTrainingTagList(value).join(", ");
}

export function normalizeTrainingSheetType(value: string | null | undefined): SheetType | "" {
  const normalized = normalizeWhitespace(value ?? "").toLowerCase();
  return TRAINING_SHEET_TYPE_VALUES.includes(normalized as SheetType)
    ? (normalized as SheetType)
    : "";
}

export function matchesTrainingPrefillPlanIdentity(args: {
  currentSetName?: string | null;
  currentRevisionLabel?: string | null;
  candidateSetName?: string | null;
  candidateRevisionLabel?: string | null;
}) {
  const currentSetName = normalizeWhitespace(args.currentSetName ?? "").toLowerCase();
  const currentRevisionLabel = normalizeWhitespace(
    args.currentRevisionLabel ?? ""
  ).toLowerCase();
  const candidateSetName = normalizeWhitespace(
    args.candidateSetName ?? ""
  ).toLowerCase();
  const candidateRevisionLabel = normalizeWhitespace(
    args.candidateRevisionLabel ?? ""
  ).toLowerCase();

  if (
    !currentSetName ||
    !currentRevisionLabel ||
    !candidateSetName ||
    !candidateRevisionLabel
  ) {
    return false;
  }

  if (currentSetName !== candidateSetName) {
    return false;
  }

  if (currentRevisionLabel === candidateRevisionLabel) {
    return true;
  }

  const normalizeRevisionFamily = (value: string) =>
    value
      .replace(/\brevision\b/g, "rev")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\b\d+\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const currentRevisionFamily = normalizeRevisionFamily(currentRevisionLabel);
  const candidateRevisionFamily = normalizeRevisionFamily(candidateRevisionLabel);

  return Boolean(
    currentRevisionFamily &&
      candidateRevisionFamily &&
      currentRevisionFamily === candidateRevisionFamily
  );
}

export function canonicalizeTrainingSheetNumber(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized ? normalized.toUpperCase() : "";
}

export function canonicalizeTrainingSheetTitle(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized ? normalized.toUpperCase() : "";
}

export type TrainingBlueprintMetadata = {
  discipline: string | null;
  sheet_type: SheetType;
  scope_tags: string[];
  area_tags: string[];
};

export function inferLegacyTrainingSheetKind(
  args: TrainingMetadataSnapshot
): SheetKind {
  const explicitSheetKind = normalizeWhitespace(args.sheet_kind ?? "");
  if (
    explicitSheetKind &&
    TRAINING_SHEET_KIND_VALUES.includes(explicitSheetKind as SheetKind)
  ) {
    return explicitSheetKind as SheetKind;
  }

  const blueprintMetadata = normalizeTrainingBlueprintMetadata(args);

  switch (blueprintMetadata.sheet_type) {
    case "cover":
      return "cover_sheet";
    case "index":
      return "sheet_index";
    case "elevation":
      return "elevation_sheet";
    case "section":
      return "section_sheet";
    case "detail":
      return "detail_sheet";
    case "schedule":
      return "schedule_sheet";
    case "diagram":
      return blueprintMetadata.scope_tags.includes("one_line")
        ? "one_line_diagram"
        : "other";
    case "specification":
      return "spec_sheet";
    case "vendor_reference":
      return "vendor_reference";
    case "plan":
      if (blueprintMetadata.scope_tags.includes("reflected_ceiling")) {
        return "reflected_ceiling_plan";
      }
      if (blueprintMetadata.scope_tags.includes("roof")) {
        return "roof_plan";
      }
      if (blueprintMetadata.scope_tags.includes("site")) {
        return "site_plan";
      }
      if (blueprintMetadata.scope_tags.includes("power")) {
        return "power_plan";
      }
      if (blueprintMetadata.scope_tags.includes("lighting")) {
        return "lighting_plan";
      }
      if (blueprintMetadata.discipline === "Electrical") {
        return "electrical_plan";
      }
      return "floor_plan";
    default:
      return "other";
  }
}

function inferTrainingSheetType(args: TrainingMetadataSnapshot): SheetType {
  const title = canonicalizeTrainingSheetTitle(args.sheet_title);
  const discipline = normalizeTrainingDiscipline(args.discipline);
  const legacyType = legacySheetKindToSheetType(args.sheet_kind);

  if (normalizeTrainingSheetType(args.sheet_type)) {
    return normalizeTrainingSheetType(args.sheet_type) as SheetType;
  }

  if (legacyType) {
    return legacyType;
  }

  if (/\bCOVER SHEET\b/i.test(title) || /\bTITLE SHEET\b/i.test(title)) {
    return "cover";
  }

  if (
    /\b(SHEET INDEX|DRAWING INDEX|SHEET LIST|INDEX OF DRAWINGS?)\b/i.test(title)
  ) {
    return "index";
  }

  if (
    /\b(PROJECT DATA|ABBREVIATIONS?|SYMBOLS|GENERAL NOTES?)\b/i.test(title) &&
    !/\bDETAILS?\b/i.test(title)
  ) {
    return "information";
  }

  if (
    /\b(ONE-?LINE|WIRING|CONTROL DIAGRAM|RISER DIAGRAM|DIAGRAM)\b/i.test(title)
  ) {
    return "diagram";
  }

  if (/\b(SPECIFICATIONS?|SPECS?)\b/i.test(title)) {
    return "specification";
  }

  if (/\b(VENDOR DRAWING|VENDOR REFERENCE)\b/i.test(title)) {
    return "vendor_reference";
  }

  if (/\bELEVATIONS?\b/i.test(title)) {
    return "elevation";
  }

  if (/\bSECTIONS?\b/i.test(title)) {
    return "section";
  }

  if (/\bSCHEDULES?\b/i.test(title) && !/\bPLANS?\b/i.test(title)) {
    return "schedule";
  }

  if (
    /\bLEGENDS?\b/i.test(title) ||
    /\bNOTES?\b/i.test(title)
  ) {
    return /\bDETAILS?\b/i.test(title) ? "detail" : "legend_notes";
  }

  if (/\bDETAILS?\b/i.test(title)) {
    return "detail";
  }

  if (
    /\b(PLAN|PLANS|RCP|ROOF PLAN|SITE PLAN)\b/i.test(title) ||
    discipline === "Civil"
  ) {
    return "plan";
  }

  return "other";
}

function inferTrainingScopeTags(args: TrainingMetadataSnapshot) {
  const tags = new Set<string>(parseTrainingTagList(args.scope_tags));
  const title = canonicalizeTrainingSheetTitle(args.sheet_title);
  const legacyKind = normalizeWhitespace(args.sheet_kind ?? "");

  if (legacyKind === "reflected_ceiling_plan" || /\bRCP\b/i.test(title)) {
    tags.add("reflected_ceiling");
  }

  if (legacyKind === "roof_plan" || /\bROOF\b/i.test(title)) {
    tags.add("roof");
  }

  if (legacyKind === "site_plan" || /\bSITE PLAN\b/i.test(title)) {
    tags.add("site");
  }

  if (legacyKind === "power_plan" || /\bPOWER\b/i.test(title)) {
    tags.add("power");
  }

  if (legacyKind === "lighting_plan" || /\bLIGHTING\b/i.test(title)) {
    tags.add("lighting");
  }

  if (legacyKind === "one_line_diagram" || /\bONE-?LINE\b/i.test(title)) {
    tags.add("one_line");
  }

  pushIfMatch(tags, title, /\bDEMO(?:LITION)?\b/i, "demolition");
  pushIfMatch(tags, title, /\bEXISTING\b/i, "existing");
  pushIfMatch(tags, title, /\bREMOVAL\b/i, "removal");
  pushIfMatch(tags, title, /\bCONSTRUCTION\b/i, "construction");
  pushIfMatch(tags, title, /\bALTERNATE\b/i, "alternate");
  pushIfMatch(tags, title, /\bENLARGED\b/i, "enlarged");
  pushIfMatch(tags, title, /\bINTERIOR\b/i, "interior");
  pushIfMatch(tags, title, /\bEXTERIOR\b/i, "exterior");
  pushIfMatch(tags, title, /\bFOUNDATION\b/i, "foundation");
  pushIfMatch(tags, title, /\bFRAMING\b/i, "framing");
  pushIfMatch(tags, title, /\bTITLE 24\b/i, "title_24");
  pushIfMatch(tags, title, /\bPROJECT DATA\b/i, "project_data");
  pushIfMatch(tags, title, /\bLEGENDS?\b/i, "legend");
  pushIfMatch(tags, title, /\bNOTES?\b/i, "notes");
  pushIfMatch(tags, title, /\bSCHEDULES?\b/i, "schedule");
  pushIfMatch(tags, title, /\bDETAILS?\b/i, "details");
  pushIfMatch(tags, title, /\bELEVATIONS?\b/i, "elevations");
  pushIfMatch(tags, title, /\bSECTIONS?\b/i, "sections");

  return [...tags].sort();
}

function inferTrainingAreaTags(args: TrainingMetadataSnapshot) {
  const tags = new Set<string>(parseTrainingTagList(args.area_tags));
  const title = canonicalizeTrainingSheetTitle(args.sheet_title);

  const buildingMatches = title.matchAll(/\bBUILDINGS?\s+([0-9,\s&AND]+)/gi);
  for (const match of buildingMatches) {
    const buildingNumbers = match[1]?.match(/\d+/g) ?? [];
    for (const buildingNumber of buildingNumbers) {
      tags.add(`building_${buildingNumber}`);
    }
  }

  const buildingLetterMatches = title.matchAll(
    /\bBUILDINGS?\s+([A-Z](?:\s*(?:,|\/|&|AND)\s*[A-Z])*)\b/gi
  );
  for (const match of buildingLetterMatches) {
    const buildingLetters = match[1]?.match(/[A-Z]/g) ?? [];
    for (const buildingLetter of buildingLetters) {
      tags.add(`building_${buildingLetter.toLowerCase()}`);
    }
  }

  for (const [pattern, tag] of FLOOR_TAGS) {
    if (pattern.test(title)) {
      tags.add(tag);
    }
  }

  pushIfMatch(tags, title, /\bNORTH\b/i, "north");
  pushIfMatch(tags, title, /\bSOUTH\b/i, "south");
  pushIfMatch(tags, title, /\bEAST\b/i, "east");
  pushIfMatch(tags, title, /\bWEST\b/i, "west");

  pushIfMatch(tags, title, /\bCLASSROOM\b/i, "classroom");
  pushIfMatch(tags, title, /\bRESTROOM\b/i, "restroom");
  pushIfMatch(tags, title, /\bCORRIDOR\b/i, "corridor");
  pushIfMatch(tags, title, /\bKITCHEN\b/i, "kitchen");
  pushIfMatch(tags, title, /\bCAMPUS\b/i, "campus");
  pushIfMatch(tags, title, /\bPORTABLE\b/i, "portable");
  pushIfMatch(tags, title, /\bTOILET BUILDING\b/i, "toilet_building");
  pushIfMatch(tags, title, /\bCOVERED WALKWAY\b/i, "covered_walkway");
  pushIfMatch(tags, title, /\bLOBBY\b/i, "lobby");
  pushIfMatch(tags, title, /\bSTAIR\b/i, "stair");

  return [...tags].sort();
}

export function normalizeTrainingBlueprintMetadata(
  args: TrainingMetadataSnapshot
): TrainingBlueprintMetadata {
  return {
    discipline: normalizeTrainingDiscipline(args.discipline),
    sheet_type: inferTrainingSheetType(args),
    scope_tags: inferTrainingScopeTags(args),
    area_tags: inferTrainingAreaTags(args),
  };
}

function normalizeTrainingMetadataSnapshot(args: TrainingMetadataSnapshot) {
  const blueprintMetadata = normalizeTrainingBlueprintMetadata(args);
  const normalizedSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: args.sheet_number,
    sheet_title: args.sheet_title,
    discipline: args.discipline,
    sheet_type: args.sheet_type ?? blueprintMetadata.sheet_type,
    scope_tags: args.scope_tags ?? blueprintMetadata.scope_tags,
    area_tags: args.area_tags ?? blueprintMetadata.area_tags,
    sheet_kind: args.sheet_kind,
  });

  return {
    sheet_number: canonicalizeTrainingSheetNumber(args.sheet_number),
    sheet_title: canonicalizeTrainingSheetTitle(args.sheet_title),
    discipline: blueprintMetadata.discipline ?? "",
    sheet_type: blueprintMetadata.sheet_type,
    scope_tags: blueprintMetadata.scope_tags,
    area_tags: blueprintMetadata.area_tags,
    sheet_kind: normalizedSheetKind,
  };
}

export function getTrainingChangedFields(args: {
  model: TrainingMetadataSnapshot;
  reviewed: TrainingMetadataSnapshot;
}): TrainingMetadataField[] {
  const changed: TrainingMetadataField[] = [];
  const normalizedModel = normalizeTrainingMetadataSnapshot(args.model);
  const normalizedReviewed = normalizeTrainingMetadataSnapshot(args.reviewed);

  if (
    normalizedModel.sheet_number !== normalizedReviewed.sheet_number
  ) {
    changed.push("sheet_number");
  }

  if (
    normalizedModel.sheet_title !== normalizedReviewed.sheet_title
  ) {
    changed.push("sheet_title");
  }

  if (normalizedModel.discipline !== normalizedReviewed.discipline) {
    changed.push("discipline");
  }

  if (normalizedModel.sheet_type !== normalizedReviewed.sheet_type) {
    changed.push("sheet_type");
  }

  if (
    formatTrainingTagList(normalizedModel.scope_tags) !==
    formatTrainingTagList(normalizedReviewed.scope_tags)
  ) {
    changed.push("scope_tags");
  }

  if (
    formatTrainingTagList(normalizedModel.area_tags) !==
    formatTrainingTagList(normalizedReviewed.area_tags)
  ) {
    changed.push("area_tags");
  }

  if (normalizedModel.sheet_kind !== normalizedReviewed.sheet_kind) {
    changed.push("sheet_kind");
  }

  return changed;
}

export function formatTrainingChangedFieldLabel(field: TrainingMetadataField) {
  switch (field) {
    case "sheet_number":
      return "Number";
    case "sheet_title":
      return "Title";
    case "discipline":
      return "Discipline";
    case "sheet_type":
      return "Sheet Type";
    case "scope_tags":
      return "Scope Tags";
    case "area_tags":
      return "Area Tags";
    case "sheet_kind":
      return "Sheet Kind";
    default:
      return field;
  }
}

export function isTrainingCorpusEnabled() {
  return process.env.PLAN_TRAINING_CORPUS_ENABLED === "1";
}

export function inferTrainingSheetKind(args: {
  sheetNumber?: string | null;
  sheetTitle?: string | null;
  discipline?: string | null;
}): SheetKind {
  const title = normalizeWhitespace(args.sheetTitle ?? "");
  const number = normalizeWhitespace(args.sheetNumber ?? "").toUpperCase();
  const discipline = normalizeWhitespace(args.discipline ?? "").toLowerCase();
  const context = `${title} ${number} ${discipline}`;
  const hasReflectedCeiling =
    /\breflected ceiling plan\b/i.test(context) || /\bRCP\b/i.test(title);
  const hasOneLineDiagram =
    /\bone-?line diagram\b/i.test(context) ||
    /\briser diagram\b/i.test(context) ||
    (
      /\bdiagram\b/i.test(context) &&
      /\bvoltage drop\b/i.test(context)
    );
  const hasLightingPlan = /\blighting plan\b/i.test(context);
  const hasPowerPlan = /\bpower plan\b/i.test(context);
  const hasElectricalPlan = /\belectrical plan\b/i.test(context);
  const hasRoofPlan = /\broof plan\b/i.test(context);
  const hasSitePlan =
    /\bsite plan\b/i.test(context) ||
    /\b(grading|drainage|utility|utilities|erosion(?:\s+control)?)\s+plan\b/i.test(
      context
    ) ||
    (
      discipline === "civil" &&
      /^C\b/i.test(number) &&
      /\bplan\b/i.test(context)
    );
  const hasFloorPlan =
    /\bfloor plans?\b/i.test(context) ||
    (
      /\bfloor\b/i.test(context) &&
      /\bplan\b/i.test(context) &&
      /\b(?:demo|demolition)\b/i.test(context)
    );
  const hasFoundationOrFramingPlans =
    /\b(?:foundation|roof framing|framing)\b/i.test(context) &&
    /\bplans?\b/i.test(context) &&
    !/\bdetails?\b/i.test(context);
  const hasSchedule = /\bschedules?\b/i.test(context);
  const hasElevation = /\belevations?\b/i.test(context);
  const hasSection = /\bsections?\b/i.test(context);
  const hasDetail = /\bdetails?\b/i.test(context);
  const hasLegendOrNotes = /\blegends?\b/i.test(context) || /\bnotes?\b/i.test(context);
  const hasEnlarged = /\benlarged\b/i.test(context);
  const hasGenericPlan = /\bplans?\b/i.test(context);
  const enlargedLooksLikeElevationSheet =
    hasEnlarged &&
    !hasSitePlan &&
    !hasFloorPlan &&
    !hasRoofPlan &&
    !hasReflectedCeiling &&
    !hasSchedule &&
    (
      hasGenericPlan ||
      /\bRESTROOM\b/i.test(context)
    );

  if (/\bcover sheet\b/i.test(title)) {
    return "cover_sheet";
  }

  if (
    /\bCOVER\b/i.test(title) &&
    /\bDRAWING\b/i.test(title) &&
    /\bINDEX\b/i.test(title)
  ) {
    return "cover_sheet";
  }

  if (
    /\b(sheet index|drawing index|sheet list|index of drawings?)\b/i.test(title)
  ) {
    return "sheet_index";
  }

  if (hasReflectedCeiling) {
    return "reflected_ceiling_plan";
  }

  if (hasOneLineDiagram) {
    return "one_line_diagram";
  }

  if (hasLightingPlan) {
    return "lighting_plan";
  }

  if (hasPowerPlan) {
    return "power_plan";
  }

  if (hasElectricalPlan) {
    return "electrical_plan";
  }

  if (hasRoofPlan) {
    return "roof_plan";
  }

  if (hasSitePlan) {
    return "site_plan";
  }

  if (hasSchedule && (hasDetail || hasLegendOrNotes)) {
    return "detail_sheet";
  }

  if (hasElevation || enlargedLooksLikeElevationSheet) {
    return "elevation_sheet";
  }

  if (hasSection) {
    return "section_sheet";
  }

  if (hasFloorPlan || hasFoundationOrFramingPlans) {
    return "floor_plan";
  }

  if (hasSchedule) {
    return "schedule_sheet";
  }

  if (hasDetail) {
    return "detail_sheet";
  }

  if (/\b(spec|specs|specification|specifications)\b/i.test(context)) {
    return "spec_sheet";
  }

  if (/\b(vendor drawing|vendor reference)\b/i.test(context)) {
    return "vendor_reference";
  }

  if (discipline === "electrical" && /^E\b/i.test(number)) {
    return "electrical_plan";
  }

  return "other";
}

export function normalizeTrainingCorrectionReason(
  value: string | null | undefined,
  wasCorrected: boolean,
  fallbackReason: CorrectionReason = "manual_review"
): CorrectionReason {
  const normalized = normalizeWhitespace(value ?? "");
  const legacyAlias =
    normalized === "sheet_type_fix" || normalized === "tag_fix"
      ? "sheet_kind_fix"
      : normalized;
  if (!normalized) {
    return wasCorrected ? fallbackReason || "manual_review" : "";
  }

  return TRAINING_CORRECTION_REASON_VALUES.includes(
    legacyAlias as (typeof TRAINING_CORRECTION_REASON_VALUES)[number]
  )
    ? (legacyAlias as CorrectionReason)
    : wasCorrected
      ? "manual_review"
      : "";
}

export function resolveTrainingCorrectionReason(args: {
  value: string | null | undefined;
  wasCorrected: boolean;
  suggestedReason: CorrectionReason;
}): CorrectionReason {
  const normalized = normalizeTrainingCorrectionReason(
    args.value,
    args.wasCorrected,
    args.suggestedReason || "manual_review"
  );

  if (!args.wasCorrected) {
    return "";
  }

  if (args.suggestedReason && normalized !== args.suggestedReason) {
    return args.suggestedReason;
  }

  return normalized || args.suggestedReason || "manual_review";
}

export function suggestTrainingCorrectionReason(args: {
  model: TrainingMetadataSnapshot;
  reviewed: TrainingMetadataSnapshot;
}): CorrectionReason {
  const changedFields = getTrainingChangedFields(args);

  if (changedFields.length === 0) {
    return "";
  }

  if (changedFields.length > 1) {
    return "multiple_metadata_fixes";
  }

  switch (changedFields[0]) {
    case "sheet_number":
      return "sheet_number_fix";
    case "sheet_title":
      return "sheet_title_fix";
    case "discipline":
      return "discipline_fix";
    case "sheet_type":
    case "scope_tags":
    case "area_tags":
    case "sheet_kind":
      return "sheet_kind_fix";
    default:
      return "manual_review";
  }
}

export function getTrainingVerificationStatus(
  inputs: TrainingVerificationInputs
): TrainingVerificationStatus {
  if (!inputs.savedReview || !inputs.expected) {
    return "Unsaved";
  }

  const normalizedSaved = normalizeTrainingMetadataSnapshot(inputs.savedReview);
  const normalizedExpected = normalizeTrainingMetadataSnapshot(inputs.expected);

  const normalizedSavedReason = normalizeWhitespace(
    inputs.savedReview.correction_reason ?? ""
  );
  const normalizedExpectedReason = normalizeWhitespace(
    inputs.expected.correction_reason ?? ""
  );
  const normalizedSavedNote = normalizeWhitespace(
    inputs.savedReview.correction_note ?? ""
  );
  const normalizedExpectedNote = normalizeWhitespace(
    inputs.expected.correction_note ?? ""
  );

  if (
    normalizedSaved.sheet_number !== normalizedExpected.sheet_number ||
    normalizedSaved.sheet_title !== normalizedExpected.sheet_title ||
    normalizedSaved.discipline !== normalizedExpected.discipline ||
    normalizedSaved.sheet_type !== normalizedExpected.sheet_type ||
    formatTrainingTagList(normalizedSaved.scope_tags) !==
      formatTrainingTagList(normalizedExpected.scope_tags) ||
    formatTrainingTagList(normalizedSaved.area_tags) !==
      formatTrainingTagList(normalizedExpected.area_tags) ||
    normalizedSaved.sheet_kind !== normalizedExpected.sheet_kind ||
    normalizedSavedReason !== normalizedExpectedReason ||
    normalizedSavedNote !== normalizedExpectedNote
  ) {
    return "Save mismatch";
  }

  const regionCount = inputs.regionCount ?? 0;
  const candidateCount = inputs.candidateCount ?? 0;

  if (!inputs.savedReview.page_image_path && regionCount === 0 && candidateCount === 0) {
    return "Saved";
  }

  if (!inputs.savedReview.page_image_path || regionCount < 2 || candidateCount < 2) {
    return "Missing artifact";
  }

  return "Saved and verified";
}
