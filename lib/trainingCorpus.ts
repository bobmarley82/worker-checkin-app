import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  canonicalizeTrainingSheetNumber,
  canonicalizeTrainingSheetTitle,
  inferLegacyTrainingSheetKind,
  getTrainingChangedFields,
  matchesTrainingPrefillPlanIdentity,
  normalizeTrainingBlueprintMetadata,
  normalizeTrainingCorrectionReason,
  normalizeTrainingDiscipline,
  parseTrainingTagList,
  resolveTrainingCorrectionReason,
  suggestTrainingCorrectionReason,
  type CorrectionReason,
  type SheetKind,
  type SheetType,
} from "./trainingCorpusShared";

type PlanSheetRow = Database["public"]["Tables"]["plan_sheets"]["Row"];
type PlanSetRow = Database["public"]["Tables"]["plan_sets"]["Row"];
export type TrainingModelSheet = Pick<
  PlanSheetRow,
  | "id"
  | "sheet_number"
  | "sheet_title"
  | "discipline"
  | "page_number"
  | "extraction_confidence"
  | "extracted_text"
  | "number_source_text"
  | "number_source_kind"
  | "title_source_text"
  | "title_source_kind"
  | "preview_image_path"
  | "preview_storage_key"
> & {
  sheet_type?: string | null;
  scope_tags?: string[] | null;
  area_tags?: string[] | null;
  sheet_kind?: string | null;
};

type ReviewedSheetInput = {
  id: string;
  sheet_number: string;
  sheet_title: string;
  discipline: string | null;
  page_number: number;
  sheet_type: SheetType;
  scope_tags: string[];
  area_tags: string[];
  sheet_kind: SheetKind;
  model_sheet_type_snapshot?: SheetType | null;
  model_scope_tags_snapshot?: string[] | null;
  model_area_tags_snapshot?: string[] | null;
  model_sheet_kind_snapshot?: SheetKind | null;
  correction_reason: CorrectionReason;
  correction_note: string | null;
};

type ArtifactRegionDraft = {
  role: "number" | "title";
  region_type: string;
  source_kind: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  crop_image_path: string | null;
  raw_text: string | null;
  normalized_text: string | null;
};

type ArtifactCandidateDraft = {
  role: "number" | "title";
  region_type: string;
  candidate_text: string;
  normalized_candidate_text: string;
  candidate_kind: string;
  candidate_score: number | null;
  is_model_winner: boolean;
};

export type TrainingArtifactRegionDraft = ArtifactRegionDraft;
export type TrainingArtifactCandidateDraft = ArtifactCandidateDraft;

export type PlanSheetLlmMetadataSnapshot = {
  sheet_number: string | null;
  sheet_title: string | null;
  discipline: string | null;
  sheet_type: string | null;
  scope_tags: string[];
  area_tags: string[];
  sheet_kind: string | null;
  confidence: number | null;
};

export type PlanSheetImportLlmEffectiveFieldSources = {
  sheet_number: "heuristic" | "llm";
  sheet_title: "heuristic" | "llm";
  discipline: "heuristic" | "llm";
  sheet_type: "heuristic" | "llm" | "derived";
  scope_tags: "heuristic" | "llm" | "derived";
  area_tags: "heuristic" | "llm" | "derived";
  sheet_kind: "heuristic" | "llm" | "derived";
};

export type PlanSheetImportLlmEffectiveSource = "heuristic" | "llm" | "hybrid";

export type PlanSheetImportLlmErrorKind =
  | "timeout"
  | "network"
  | "rate_limit"
  | "server_error"
  | "client_error"
  | "invalid_response"
  | "unknown";

export type PlanSheetImportLlmRetryAttempt = {
  attempt: number;
  status: string;
  error_kind: PlanSheetImportLlmErrorKind | null;
  error_message: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
  retry_reason: string | null;
};

export type PlanSheetImportLlmAssistRow = {
  plan_sheet_id: string;
  page_number: number;
  page_hash: string | null;
  heuristic_snapshot: PlanSheetLlmMetadataSnapshot;
  request_status: string;
  request_payload: Record<string, unknown> | null;
  response_payload: Record<string, unknown> | null;
  resolved_metadata: PlanSheetLlmMetadataSnapshot | null;
  effective_metadata: PlanSheetLlmMetadataSnapshot | null;
  effective_field_sources: PlanSheetImportLlmEffectiveFieldSources | null;
  effective_source: PlanSheetImportLlmEffectiveSource | null;
  disagreement_fields: string[];
  agrees_with_heuristic: boolean | null;
  attempt_count: number;
  final_error_kind: PlanSheetImportLlmErrorKind | null;
  retry_history: PlanSheetImportLlmRetryAttempt[];
  error_message: string | null;
  requested_at: string;
  completed_at: string | null;
};

export type TrainingPageReviewRow = {
  id: string;
  job_id: string;
  plan_set_id: string;
  plan_sheet_id: string;
  page_number: number;
  page_hash: string;
  sheet_number: string;
  sheet_title: string;
  discipline: string | null;
  sheet_type: string;
  scope_tags: string[];
  area_tags: string[];
  sheet_kind: string;
  model_sheet_number: string | null;
  model_sheet_title: string | null;
  model_discipline: string | null;
  model_sheet_type: string | null;
  model_scope_tags: string[];
  model_area_tags: string[];
  model_sheet_kind: string | null;
  model_confidence: number | null;
  page_image_path: string | null;
  was_corrected: boolean;
  correction_reason: string | null;
  correction_note: string | null;
  reviewed_by: string;
  reviewed_at: string;
  updated_at: string;
  created_at: string;
};

export type TrainingPageEvidenceRow = {
  extracted_text: string | null;
  number_source_text: string | null;
  number_source_kind: string | null;
  title_source_text: string | null;
  title_source_kind: string | null;
  preview_image_path: string | null;
};

export type TrainingPagePipelineRow = {
  debug_session_id: string | null;
  heuristic_output: Record<string, unknown> | null;
  ocr_candidate_snapshot: Record<string, unknown> | null;
  replay_page_input: Record<string, unknown> | null;
  replay_ocr_result: Record<string, unknown> | null;
  llm_request_payload: Record<string, unknown> | null;
  llm_request_status: string | null;
  llm_request_error: string | null;
  llm_resolution: Record<string, unknown> | null;
  llm_output: Record<string, unknown> | null;
};

export type TrainingPageRegionRow = {
  id: string;
  job_id: string;
  training_page_review_id: string;
  role: "number" | "title";
  region_type: string;
  source_kind: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  crop_image_path: string | null;
  raw_text: string | null;
  normalized_text: string | null;
  created_at: string;
};

export type TrainingRegionCandidateRow = {
  id: string;
  job_id: string;
  training_page_region_id: string;
  role: "number" | "title";
  candidate_text: string;
  normalized_candidate_text: string;
  candidate_kind: string;
  candidate_score: number | null;
  is_model_winner: boolean;
  created_at: string;
};

type TrainingPageRecord = {
  review: TrainingPageReviewRow;
  evidence: TrainingPageEvidenceRow;
  pipeline: TrainingPagePipelineRow;
  regions: TrainingPageRegionRow[];
  candidates: TrainingRegionCandidateRow[];
};

export type PriorTrainingPrefillEntry = {
  review: TrainingPageReviewRow;
  source_plan_set_id: string;
  source_page_number: number;
  match_basis: "page_number";
  match_confidence: "likely";
};

type TrainingImportContext = {
  job_id: string;
  plan_set_id: string;
  set_name?: string | null;
  revision_label?: string | null;
  original_file_name?: string | null;
  debug_session_id: string | null;
  debug_artifacts_dir: string | null;
  updated_at: string;
};

export type TrainingCorpusInventoryEntry = {
  plan_set_id: string;
  job_id: string | null;
  set_name: string | null;
  revision_label: string | null;
  original_file_name: string | null;
  debug_session_id: string | null;
  updated_at: string | null;
  corpus_state: "context_only" | "reviewed";
  page_count: number;
  corrected_pages: number;
  model_sheet_kind_snapshots: number;
  has_llm_assists: boolean;
  llm_assist_pages: number;
  llm_success_pages: number;
  llm_invalid_pages: number;
  llm_error_pages: number;
  latest_reviewed_at: string | null;
};

export type TrainingCorpusInventory = {
  generated_at: string;
  total_plan_sets: number;
  reviewed_plan_sets: number;
  total_reviewed_pages: number;
  entries: TrainingCorpusInventoryEntry[];
};

const TRAINING_CORPUS_ROOT = path.join(process.cwd(), "data", "training-corpus");
const TRAINING_CORPUS_INVENTORY_PATH = path.join(TRAINING_CORPUS_ROOT, "inventory.json");

const TRAINING_REGION_BOUNDS: Record<
  string,
  { x: number; y: number; width: number; height: number }
> = {
  stripFull: { x: 0.928, y: 0.918, width: 0.072, height: 0.062 },
  stripTitle: { x: 0.934, y: 0.944, width: 0.066, height: 0.032 },
  stripNumber: { x: 0.938, y: 0.922, width: 0.06, height: 0.026 },
  sheetStamp: { x: 0.926, y: 0.916, width: 0.074, height: 0.066 },
  titleBlock: { x: 0.78, y: 0.76, width: 0.22, height: 0.22 },
  numberBlock: { x: 0.88, y: 0.82, width: 0.12, height: 0.16 },
  bottomRight: { x: 0.55, y: 0.63, width: 0.45, height: 0.37 },
  bottomBand: { x: 0, y: 0.76, width: 1, height: 0.24 },
  footerColumn: { x: 0.76, y: 0.56, width: 0.24, height: 0.44 },
  footerBubble: { x: 0.76, y: 0.56, width: 0.24, height: 0.44 },
  footerBubbleTight: { x: 0.893, y: 0.803, width: 0.09, height: 0.043 },
  rightBand: { x: 0.72, y: 0, width: 0.28, height: 1 },
  topRight: { x: 0.58, y: 0, width: 0.42, height: 0.3 },
  bottomLeft: { x: 0, y: 0.72, width: 0.42, height: 0.28 },
  leftEdge: { x: 0, y: 0, width: 0.24, height: 1 },
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toIsoTimestamp() {
  return new Date().toISOString();
}

export function buildTrainingPageHash(args: {
  planSetId: string;
  pageNumber: number;
  extractedText?: string | null;
  modelSheetNumber?: string | null;
  modelSheetTitle?: string | null;
}) {
  return crypto
    .createHash("sha256")
    .update(
      [
        args.planSetId,
        String(args.pageNumber),
        args.extractedText ?? "",
        args.modelSheetNumber ?? "",
        args.modelSheetTitle ?? "",
      ].join("::")
    )
    .digest("hex");
}

function getPlanSetCorpusDir(planSetId: string) {
  return path.join(TRAINING_CORPUS_ROOT, planSetId);
}

function getPlanSetPagesDir(planSetId: string) {
  return path.join(getPlanSetCorpusDir(planSetId), "pages");
}

function getImportContextPath(planSetId: string) {
  return path.join(getPlanSetCorpusDir(planSetId), "import-context.json");
}

function getImportLlmAssistsPath(planSetId: string) {
  return path.join(getPlanSetCorpusDir(planSetId), "import-llm-assists.json");
}

function getEventsPath(planSetId: string) {
  return path.join(getPlanSetCorpusDir(planSetId), "review-events.jsonl");
}

function getPageRecordPath(planSetId: string, pageNumber: number, planSheetId: string) {
  return path.join(
    getPlanSetPagesDir(planSetId),
    `page-${String(pageNumber).padStart(3, "0")}-${planSheetId}.json`
  );
}

function getPlanSetArtifactsDir(planSetId: string) {
  return path.join(getPlanSetCorpusDir(planSetId), "artifacts");
}

function getPageArtifactsDir(planSetId: string, pageNumber: number, planSheetId: string) {
  return path.join(
    getPlanSetArtifactsDir(planSetId),
    `page-${String(pageNumber).padStart(3, "0")}-${planSheetId}`
  );
}

function toCorpusRelativePath(planSetId: string, absolutePath: string) {
  return path.relative(getPlanSetCorpusDir(planSetId), absolutePath).replace(/\\/g, "/");
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string) {
  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listCorpusPlanSetIds() {
  try {
    const entries = await fs.readdir(TRAINING_CORPUS_ROOT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [] as string[];
  }
}

function normalizePlanSheetLlmMetadataSnapshot(
  value: Partial<PlanSheetLlmMetadataSnapshot> | null | undefined
): PlanSheetLlmMetadataSnapshot | null {
  if (!value) {
    return null;
  }

  const sheetNumber = canonicalizeTrainingSheetNumber(value.sheet_number);
  const sheetTitle = canonicalizeTrainingSheetTitle(value.sheet_title);
  const discipline = normalizeTrainingDiscipline(value.discipline);
  const requestedSheetType = normalizeOptionalText(value.sheet_type);
  const scopeTags = parseTrainingTagList(value.scope_tags ?? []);
  const areaTags = parseTrainingTagList(value.area_tags ?? []);
  const requestedSheetKind = normalizeOptionalText(value.sheet_kind);
  const blueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: sheetNumber,
    sheet_title: sheetTitle,
    discipline,
    sheet_type: requestedSheetType,
    scope_tags: scopeTags,
    area_tags: areaTags,
    sheet_kind: requestedSheetKind,
  });
  const inferredSheetKind =
    sheetNumber || sheetTitle || discipline
      ? inferLegacyTrainingSheetKind({
          sheet_number: sheetNumber,
          sheet_title: sheetTitle,
          discipline,
          sheet_type: blueprintMetadata.sheet_type,
          scope_tags: blueprintMetadata.scope_tags,
          area_tags: blueprintMetadata.area_tags,
          sheet_kind: requestedSheetKind,
        })
      : "";
  const confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? value.confidence
      : null;

  if (
    !sheetNumber &&
    !sheetTitle &&
    !discipline &&
    !requestedSheetType &&
    scopeTags.length === 0 &&
    areaTags.length === 0 &&
    !requestedSheetKind &&
    confidence === null
  ) {
    return null;
  }

  return {
    sheet_number: sheetNumber || null,
    sheet_title: sheetTitle || null,
    discipline,
    sheet_type: blueprintMetadata.sheet_type,
    scope_tags: blueprintMetadata.scope_tags,
    area_tags: blueprintMetadata.area_tags,
    sheet_kind: requestedSheetKind || inferredSheetKind || null,
    confidence,
  };
}

function normalizePlanSheetImportLlmAssistRow(
  value: Partial<PlanSheetImportLlmAssistRow> | null | undefined
): PlanSheetImportLlmAssistRow | null {
  const planSheetId = normalizeOptionalText(value?.plan_sheet_id);
  if (!planSheetId) {
    return null;
  }

  const pageNumber =
    typeof value?.page_number === "number" && Number.isFinite(value.page_number)
      ? Math.trunc(value.page_number)
      : 0;
  const disagreementFields = Array.isArray(value?.disagreement_fields)
    ? value.disagreement_fields
        .map((entry) => normalizeOptionalText(String(entry ?? "")))
        .filter((entry): entry is string => Boolean(entry))
    : [];
  const requestPayload =
    value?.request_payload && typeof value.request_payload === "object"
      ? (value.request_payload as Record<string, unknown>)
      : null;
  const responsePayload =
    value?.response_payload && typeof value.response_payload === "object"
      ? (value.response_payload as Record<string, unknown>)
      : null;
  const effectiveFieldSources =
    value?.effective_field_sources &&
    typeof value.effective_field_sources === "object" &&
    !Array.isArray(value.effective_field_sources)
      ? {
          sheet_number:
            value.effective_field_sources.sheet_number === "llm"
              ? ("llm" as const)
              : ("heuristic" as const),
          sheet_title:
            value.effective_field_sources.sheet_title === "llm"
              ? ("llm" as const)
              : ("heuristic" as const),
          discipline:
            value.effective_field_sources.discipline === "llm"
              ? ("llm" as const)
              : ("heuristic" as const),
          sheet_type:
            value.effective_field_sources.sheet_type === "llm"
              ? ("llm" as const)
              : value.effective_field_sources.sheet_type === "derived"
                ? ("derived" as const)
                : ("heuristic" as const),
          scope_tags:
            value.effective_field_sources.scope_tags === "llm"
              ? ("llm" as const)
              : value.effective_field_sources.scope_tags === "derived"
                ? ("derived" as const)
                : ("heuristic" as const),
          area_tags:
            value.effective_field_sources.area_tags === "llm"
              ? ("llm" as const)
              : value.effective_field_sources.area_tags === "derived"
                ? ("derived" as const)
                : ("heuristic" as const),
          sheet_kind:
            value.effective_field_sources.sheet_kind === "llm"
              ? ("llm" as const)
              : value.effective_field_sources.sheet_kind === "derived"
                ? ("derived" as const)
                : ("heuristic" as const),
        }
      : null;
  const effectiveSource =
    value?.effective_source === "llm" || value?.effective_source === "hybrid"
      ? value.effective_source
      : value?.effective_source === "heuristic"
        ? "heuristic"
        : null;
  const retryHistory = Array.isArray(value?.retry_history)
    ? value.retry_history
        .map((entry, index) => {
          if (!entry || typeof entry !== "object") {
            return null;
          }

          const record = entry as Partial<PlanSheetImportLlmRetryAttempt>;
          const errorKind =
            record.error_kind === "timeout" ||
            record.error_kind === "network" ||
            record.error_kind === "rate_limit" ||
            record.error_kind === "server_error" ||
            record.error_kind === "client_error" ||
            record.error_kind === "invalid_response" ||
            record.error_kind === "unknown"
              ? record.error_kind
              : null;

          return {
            attempt:
              typeof record.attempt === "number" && Number.isFinite(record.attempt)
                ? Math.max(1, Math.trunc(record.attempt))
                : index + 1,
            status: normalizeOptionalText(record.status) ?? "missing",
            error_kind: errorKind,
            error_message: normalizeOptionalText(record.error_message),
            duration_ms:
              typeof record.duration_ms === "number" && Number.isFinite(record.duration_ms)
                ? Math.max(0, Math.trunc(record.duration_ms))
                : null,
            started_at: normalizeOptionalText(record.started_at) ?? toIsoTimestamp(),
            completed_at: normalizeOptionalText(record.completed_at),
            retry_reason: normalizeOptionalText(record.retry_reason),
          } satisfies PlanSheetImportLlmRetryAttempt;
        })
        .filter((entry): entry is PlanSheetImportLlmRetryAttempt => Boolean(entry))
    : [];
  const finalErrorKind =
    value?.final_error_kind === "timeout" ||
    value?.final_error_kind === "network" ||
    value?.final_error_kind === "rate_limit" ||
    value?.final_error_kind === "server_error" ||
    value?.final_error_kind === "client_error" ||
    value?.final_error_kind === "invalid_response" ||
    value?.final_error_kind === "unknown"
      ? value.final_error_kind
      : null;

  return {
    plan_sheet_id: planSheetId,
    page_number: pageNumber,
    page_hash: normalizeOptionalText(value?.page_hash),
    heuristic_snapshot:
      normalizePlanSheetLlmMetadataSnapshot(value?.heuristic_snapshot) ?? {
        sheet_number: null,
        sheet_title: null,
        discipline: null,
        sheet_type: null,
        scope_tags: [],
        area_tags: [],
        sheet_kind: null,
        confidence: null,
      },
    request_status: normalizeOptionalText(value?.request_status) ?? "missing",
    request_payload: requestPayload,
    response_payload: responsePayload,
    resolved_metadata: normalizePlanSheetLlmMetadataSnapshot(value?.resolved_metadata),
    effective_metadata: normalizePlanSheetLlmMetadataSnapshot(value?.effective_metadata),
    effective_field_sources: effectiveFieldSources,
    effective_source: effectiveSource,
    disagreement_fields: disagreementFields,
    agrees_with_heuristic:
      typeof value?.agrees_with_heuristic === "boolean"
        ? value.agrees_with_heuristic
        : null,
    attempt_count:
      typeof value?.attempt_count === "number" && Number.isFinite(value.attempt_count)
        ? Math.max(1, Math.trunc(value.attempt_count))
        : Math.max(1, retryHistory.length),
    final_error_kind: finalErrorKind,
    retry_history: retryHistory,
    error_message: normalizeOptionalText(value?.error_message),
    requested_at: normalizeOptionalText(value?.requested_at) ?? toIsoTimestamp(),
    completed_at: normalizeOptionalText(value?.completed_at),
  };
}

function getRegionBounds(regionType: string) {
  return TRAINING_REGION_BOUNDS[regionType] ?? null;
}

function normalizeOptionalText(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  return normalized || null;
}

function buildRegionKey(role: "number" | "title", regionType: string) {
  return `${role}::${regionType}`;
}

function normalizeRegionCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildRegionIdentityKey(region: {
  role: "number" | "title";
  region_type: string;
  crop_image_path: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  raw_text: string | null;
  normalized_text: string | null;
}) {
  if (region.crop_image_path) {
    return `${region.role}::${region.region_type}::crop::${region.crop_image_path}`;
  }

  if (
    region.x !== null &&
    region.y !== null &&
    region.width !== null &&
    region.height !== null
  ) {
    return [
      region.role,
      region.region_type,
      "bbox",
      region.x,
      region.y,
      region.width,
      region.height,
    ].join("::");
  }

  return [
    region.role,
    region.region_type,
    region.raw_text ?? "",
    region.normalized_text ?? "",
  ].join("::");
}

function pushRegion(
  collection: ArtifactRegionDraft[],
  seen: Map<string, number>,
  region: ArtifactRegionDraft
) {
  const normalizedRawText = normalizeOptionalText(region.raw_text);
  const normalizedText = normalizeOptionalText(region.normalized_text) ?? normalizedRawText;
  const key = buildRegionIdentityKey({
    ...region,
    raw_text: normalizedRawText,
    normalized_text: normalizedText,
  });
  const existingIndex = seen.get(key);

  if (existingIndex !== undefined) {
    const existing = collection[existingIndex];
    collection[existingIndex] = {
      ...existing,
      source_kind: existing.source_kind ?? region.source_kind,
      crop_image_path: existing.crop_image_path ?? region.crop_image_path,
      raw_text: existing.raw_text ?? normalizedRawText,
      normalized_text: existing.normalized_text ?? normalizedText,
      x: existing.x ?? region.x,
      y: existing.y ?? region.y,
      width: existing.width ?? region.width,
      height: existing.height ?? region.height,
    };
    return;
  }

  seen.set(key, collection.length);
  collection.push({
    ...region,
    raw_text: normalizedRawText,
    normalized_text: normalizedText,
  });
}

function pushCandidate(
  collection: ArtifactCandidateDraft[],
  seen: Set<string>,
  candidate: ArtifactCandidateDraft
) {
  const normalizedText = normalizeWhitespace(candidate.candidate_text);
  if (!normalizedText) {
    return;
  }

  const key = [
    candidate.role,
    candidate.region_type,
    candidate.candidate_kind,
    normalizedText.toUpperCase(),
  ].join("::");
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  collection.push({
    ...candidate,
    candidate_text: normalizedText,
    normalized_candidate_text: normalizeWhitespace(
      candidate.normalized_candidate_text || normalizedText
    ),
  });
}

export async function saveTrainingCorpusImportContext(args: {
  jobId: string;
  planSetId: string;
  setName?: string | null;
  revisionLabel?: string | null;
  originalFileName?: string | null;
  debugSessionId?: string | null;
  debugArtifactsDir?: string | null;
}) {
  const payload: TrainingImportContext = {
    job_id: args.jobId,
    plan_set_id: args.planSetId,
    set_name: normalizeOptionalText(args.setName),
    revision_label: normalizeOptionalText(args.revisionLabel),
    original_file_name: normalizeOptionalText(args.originalFileName),
    debug_session_id: args.debugSessionId ?? null,
    debug_artifacts_dir: args.debugArtifactsDir ?? null,
    updated_at: toIsoTimestamp(),
  };

  await writeJsonFile(getImportContextPath(args.planSetId), payload);
  await refreshTrainingCorpusInventory();
}

export async function savePlanSetImportLlmAssists(args: {
  planSetId: string;
  assists: PlanSheetImportLlmAssistRow[];
}) {
  const payload = args.assists
    .map(normalizePlanSheetImportLlmAssistRow)
    .filter((entry): entry is PlanSheetImportLlmAssistRow => Boolean(entry))
    .sort((left, right) => left.page_number - right.page_number);

  await writeJsonFile(getImportLlmAssistsPath(args.planSetId), payload);
  await refreshTrainingCorpusInventory();
}

export async function loadPlanSetImportLlmAssists(planSetId: string) {
  const payload = await readJsonFile<PlanSheetImportLlmAssistRow[]>(
    getImportLlmAssistsPath(planSetId)
  );

  return new Map(
    (payload ?? [])
      .map(normalizePlanSheetImportLlmAssistRow)
      .filter((entry): entry is PlanSheetImportLlmAssistRow => Boolean(entry))
      .map((entry) => [entry.plan_sheet_id, entry] as const)
  );
}

export async function loadTrainingCorpusImportContext(planSetId: string) {
  return readJsonFile<TrainingImportContext>(getImportContextPath(planSetId));
}

export async function buildTrainingArtifactEvidence(args: {
  artifactsDir: string | null | undefined;
  pageNumber: number;
  modelSheet: TrainingModelSheet;
}) {
  const pagePrefix = `page-${String(args.pageNumber).padStart(3, "0")}`;
  const artifactsDir = args.artifactsDir?.trim() || "";
  const defaultNumberRegion = "sheetStamp";
  const defaultTitleRegion = "titleBlock";
  const baseEvidence: TrainingPageEvidenceRow = {
    extracted_text: normalizeOptionalText(args.modelSheet.extracted_text),
    number_source_text: normalizeOptionalText(args.modelSheet.number_source_text),
    number_source_kind: args.modelSheet.number_source_kind ?? null,
    title_source_text: normalizeOptionalText(args.modelSheet.title_source_text),
    title_source_kind: args.modelSheet.title_source_kind ?? null,
    preview_image_path:
      args.modelSheet.preview_storage_key ||
      args.modelSheet.preview_image_path ||
      null,
  };

  if (!artifactsDir) {
    const numberBounds = getRegionBounds(defaultNumberRegion);
    const titleBounds = getRegionBounds(defaultTitleRegion);
    const fallbackRegions: ArtifactRegionDraft[] = [
      {
        role: "number",
        region_type: defaultNumberRegion,
        source_kind: args.modelSheet.number_source_kind ?? null,
        x: numberBounds?.x ?? null,
        y: numberBounds?.y ?? null,
        width: numberBounds?.width ?? null,
        height: numberBounds?.height ?? null,
        crop_image_path: null,
        raw_text: normalizeOptionalText(args.modelSheet.number_source_text),
        normalized_text: normalizeOptionalText(args.modelSheet.number_source_text),
      },
      {
        role: "title",
        region_type: defaultTitleRegion,
        source_kind: args.modelSheet.title_source_kind ?? null,
        x: titleBounds?.x ?? null,
        y: titleBounds?.y ?? null,
        width: titleBounds?.width ?? null,
        height: titleBounds?.height ?? null,
        crop_image_path: null,
        raw_text: normalizeOptionalText(args.modelSheet.title_source_text),
        normalized_text: normalizeOptionalText(args.modelSheet.title_source_text),
      },
    ];

    return {
      pageImagePath: null,
      heuristicOutput: null,
      ocrCandidateSnapshot: null,
      evidence: baseEvidence,
      regions: fallbackRegions,
      candidates: [] as ArtifactCandidateDraft[],
    };
  }

  const pageDebugPath = path.join(artifactsDir, "pages", `${pagePrefix}-debug.json`);
  const pageImagePath = path.join(artifactsDir, "pages", `${pagePrefix}-annotated.png`);

  const pageDebug = await readJsonFile<Record<string, unknown>>(pageDebugPath);
  const finalSelection = pageDebug?.finalSelection as
    | {
        usedNumberSource?: "ocr" | "pdf_text" | null;
        usedTitleSource?: "ocr" | "pdf_text" | null;
      }
    | undefined;
  const hasLegacyOcrEvidence =
    finalSelection?.usedNumberSource === "ocr" ||
    finalSelection?.usedTitleSource === "ocr" ||
    args.modelSheet.number_source_kind === "ocr" ||
    args.modelSheet.title_source_kind === "ocr";
  const ocrCandidatesPath = path.join(artifactsDir, "ocr-candidates", `${pagePrefix}.json`);
  const ocrCandidates = hasLegacyOcrEvidence
    ? await readJsonFile<Record<string, unknown>>(ocrCandidatesPath)
    : null;

  const finalNumberRegion =
    finalSelection?.usedNumberSource === "ocr"
      ? ((pageDebug?.ocrSelection as { numberRegion?: string | null } | undefined)
          ?.numberRegion || defaultNumberRegion)
      : defaultNumberRegion;
  const finalTitleRegion =
    finalSelection?.usedTitleSource === "ocr"
      ? ((pageDebug?.ocrSelection as { titleRegion?: string | null } | undefined)
          ?.titleRegion || defaultTitleRegion)
      : defaultTitleRegion;
  const numberBounds = getRegionBounds(finalNumberRegion);
  const titleBounds = getRegionBounds(finalTitleRegion);
  const numberCropPath = path.join(
    artifactsDir,
    "ocr-crops",
    pagePrefix,
    `${finalNumberRegion}-normal.png`
  );
  const titleCropPath = path.join(
    artifactsDir,
    "ocr-crops",
    pagePrefix,
    `${finalTitleRegion}-normal.png`
  );

  const numberRegionText = normalizeOptionalText(args.modelSheet.number_source_text);
  const titleRegionText = normalizeOptionalText(args.modelSheet.title_source_text);
  const numberRegionSourceKind = args.modelSheet.number_source_kind ?? null;
  const titleRegionSourceKind = args.modelSheet.title_source_kind ?? null;

  const regions: ArtifactRegionDraft[] = [];
  const seenRegions = new Map<string, number>();
  pushRegion(regions, seenRegions, {
    role: "number",
    region_type: finalNumberRegion,
    source_kind: numberRegionSourceKind,
    x: numberBounds?.x ?? null,
    y: numberBounds?.y ?? null,
    width: numberBounds?.width ?? null,
    height: numberBounds?.height ?? null,
    crop_image_path:
      numberRegionSourceKind === "ocr" && (await fileExists(numberCropPath))
        ? numberCropPath
        : null,
    raw_text: numberRegionText,
    normalized_text: numberRegionText,
  });
  pushRegion(regions, seenRegions, {
    role: "title",
    region_type: finalTitleRegion,
    source_kind: titleRegionSourceKind,
    x: titleBounds?.x ?? null,
    y: titleBounds?.y ?? null,
    width: titleBounds?.width ?? null,
    height: titleBounds?.height ?? null,
    crop_image_path:
      titleRegionSourceKind === "ocr" && (await fileExists(titleCropPath))
        ? titleCropPath
        : null,
    raw_text: titleRegionText,
    normalized_text: titleRegionText,
  });

  const candidates: ArtifactCandidateDraft[] = [];
  const seen = new Set<string>();

  if (args.modelSheet.number_source_text) {
    pushCandidate(candidates, seen, {
      role: "number",
      region_type: finalNumberRegion,
      candidate_text: args.modelSheet.number_source_text,
      normalized_candidate_text: args.modelSheet.sheet_number,
      candidate_kind: args.modelSheet.number_source_kind ?? "unknown",
      candidate_score: args.modelSheet.extraction_confidence ?? null,
      is_model_winner: true,
    });
  }

  if (args.modelSheet.title_source_text) {
    pushCandidate(candidates, seen, {
      role: "title",
      region_type: finalTitleRegion,
      candidate_text: args.modelSheet.title_source_text,
      normalized_candidate_text: args.modelSheet.sheet_title,
      candidate_kind: args.modelSheet.title_source_kind ?? "unknown",
      candidate_score: args.modelSheet.extraction_confidence ?? null,
      is_model_winner: true,
    });
  }

  const ocrScanCandidates =
    hasLegacyOcrEvidence
      ? ((ocrCandidates?.scanCandidates as Array<Record<string, unknown>> | undefined) ?? [])
      : [];
  const selectedOcrCandidate = hasLegacyOcrEvidence
    ? ((ocrCandidates?.selectedCandidate as Record<string, unknown> | undefined) ?? null)
    : null;
  const familyOcrCandidate = hasLegacyOcrEvidence
    ? ((ocrCandidates?.familyCandidate as Record<string, unknown> | undefined) ?? null)
    : null;
  const scanCandidates = hasLegacyOcrEvidence
    ? ([
        ...ocrScanCandidates,
        ...(selectedOcrCandidate ? [selectedOcrCandidate] : []),
        ...(familyOcrCandidate ? [familyOcrCandidate] : []),
      ] as Array<Record<string, unknown>>)
    : [];

  for (const candidate of scanCandidates) {
    if (typeof candidate.sheetNumber === "string" && candidate.sheetNumber) {
      pushCandidate(candidates, seen, {
        role: "number",
        region_type:
          (typeof candidate.numberRegion === "string" && candidate.numberRegion) ||
          (typeof candidate.regionId === "string" && candidate.regionId) ||
          finalNumberRegion,
        candidate_text:
          (typeof candidate.numberSourceText === "string" && candidate.numberSourceText) ||
          candidate.sheetNumber,
        normalized_candidate_text: candidate.sheetNumber,
        candidate_kind: "ocr",
        candidate_score:
          typeof candidate.score === "number" ? candidate.score : null,
        is_model_winner:
          normalizeWhitespace(candidate.sheetNumber) ===
          normalizeWhitespace(args.modelSheet.sheet_number),
      });
    }

    if (typeof candidate.sheetTitle === "string" && candidate.sheetTitle) {
      pushCandidate(candidates, seen, {
        role: "title",
        region_type:
          (typeof candidate.titleRegion === "string" && candidate.titleRegion) ||
          (typeof candidate.regionId === "string" && candidate.regionId) ||
          finalTitleRegion,
        candidate_text:
          (typeof candidate.titleSourceText === "string" && candidate.titleSourceText) ||
          candidate.sheetTitle,
        normalized_candidate_text: candidate.sheetTitle,
        candidate_kind: "ocr",
        candidate_score:
          typeof candidate.score === "number" ? candidate.score : null,
        is_model_winner:
          normalizeWhitespace(candidate.sheetTitle) ===
          normalizeWhitespace(args.modelSheet.sheet_title),
      });
    }
  }

  const pdfSelection = pageDebug?.pdfSelection as
    | {
        sheetNumber?: string | null;
        sheetTitle?: string | null;
        confidence?: number | null;
      }
    | undefined;
  const fallbackTitle = pageDebug?.fallbackTitle as
    | {
        sourceText?: string | null;
      }
    | undefined;

  if (pdfSelection?.sheetNumber) {
    pushCandidate(candidates, seen, {
      role: "number",
      region_type: defaultNumberRegion,
      candidate_text: pdfSelection.sheetNumber,
      normalized_candidate_text: pdfSelection.sheetNumber,
      candidate_kind: "pdf_text",
      candidate_score: pdfSelection.confidence ?? null,
      is_model_winner:
        args.modelSheet.number_source_kind === "pdf_text" &&
        normalizeWhitespace(pdfSelection.sheetNumber) ===
          normalizeWhitespace(args.modelSheet.sheet_number),
    });
  }

  if (pdfSelection?.sheetTitle) {
    pushCandidate(candidates, seen, {
      role: "title",
      region_type: defaultTitleRegion,
      candidate_text: fallbackTitle?.sourceText || pdfSelection.sheetTitle,
      normalized_candidate_text: pdfSelection.sheetTitle,
      candidate_kind: "pdf_text",
      candidate_score: pdfSelection.confidence ?? null,
      is_model_winner:
        args.modelSheet.title_source_kind === "pdf_text" &&
        normalizeWhitespace(pdfSelection.sheetTitle) ===
          normalizeWhitespace(args.modelSheet.sheet_title),
    });
  }

  const ocrSelection = hasLegacyOcrEvidence
    ? ((pageDebug?.ocrSelection as
        | {
            sheetNumber?: string | null;
            sheetTitle?: string | null;
            confidence?: number | null;
            numberRegion?: string | null;
            titleRegion?: string | null;
          }
        | undefined) ?? undefined)
    : undefined;
  const ocrTitleDiagnostics = hasLegacyOcrEvidence
    ? ((pageDebug?.ocrTitleDiagnostics as
        | {
            rawTitle?: string | null;
            rawTitleSourceText?: string | null;
            repairedTitle?: string | null;
            explicitRepairedTitle?: string | null;
            anchorRescuedRepairedTitle?: string | null;
            effectiveTitle?: string | null;
            enrichedTitle?: string | null;
            titleEvaluation?: {
              text?: string | null;
              score?: number | null;
            } | null;
          }
        | undefined) ?? undefined)
    : undefined;
  const topNumberCandidates =
    (pageDebug?.topNumberCandidates as Array<Record<string, unknown>> | undefined) ?? [];
  const pdfPairCandidates =
    (pageDebug?.pdfPairCandidates as Array<Record<string, unknown>> | undefined) ?? [];
  const rawBoxCandidates =
    (pageDebug?.rawBoxCandidates as Array<Record<string, unknown>> | undefined) ?? [];

  if (pdfSelection?.sheetTitle || fallbackTitle?.sourceText) {
    pushRegion(regions, seenRegions, {
      role: "title",
      region_type: defaultTitleRegion,
      source_kind: "pdf_text",
      x: numberBounds?.x ?? titleBounds?.x ?? null,
      y: numberBounds?.y ?? titleBounds?.y ?? null,
      width: titleBounds?.width ?? null,
      height: titleBounds?.height ?? null,
      crop_image_path: null,
      raw_text: normalizeOptionalText(fallbackTitle?.sourceText),
      normalized_text:
        normalizeOptionalText(pdfSelection?.sheetTitle) ??
        normalizeOptionalText(fallbackTitle?.sourceText),
    });
  }

  const titleRepairCandidates = [
    {
      candidateKind: "ocr_title_raw",
      candidateText: ocrTitleDiagnostics?.rawTitleSourceText,
      normalizedCandidateText: ocrTitleDiagnostics?.rawTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : null,
    },
    {
      candidateKind: "ocr_title_repair",
      candidateText: ocrTitleDiagnostics?.rawTitleSourceText,
      normalizedCandidateText: ocrTitleDiagnostics?.repairedTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : null,
    },
    {
      candidateKind: "ocr_title_repair_explicit",
      candidateText: ocrTitleDiagnostics?.rawTitleSourceText,
      normalizedCandidateText: ocrTitleDiagnostics?.explicitRepairedTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : null,
    },
    {
      candidateKind: "ocr_title_anchor_rescue",
      candidateText: ocrTitleDiagnostics?.rawTitleSourceText,
      normalizedCandidateText: ocrTitleDiagnostics?.anchorRescuedRepairedTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : null,
    },
    {
      candidateKind: "ocr_title_effective",
      candidateText:
        ocrTitleDiagnostics?.rawTitleSourceText ?? ocrSelection?.sheetTitle,
      normalizedCandidateText: ocrTitleDiagnostics?.effectiveTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : ocrSelection?.confidence ?? null,
    },
    {
      candidateKind: "ocr_title_enriched",
      candidateText:
        ocrTitleDiagnostics?.rawTitleSourceText ?? ocrSelection?.sheetTitle,
      normalizedCandidateText: ocrTitleDiagnostics?.enrichedTitle,
      score:
        typeof ocrTitleDiagnostics?.titleEvaluation?.score === "number"
          ? ocrTitleDiagnostics.titleEvaluation.score
          : ocrSelection?.confidence ?? null,
    },
  ];

  for (const candidate of titleRepairCandidates) {
    if (!candidate.normalizedCandidateText) {
      continue;
    }

    pushCandidate(candidates, seen, {
      role: "title",
      region_type:
        normalizeOptionalText(ocrSelection?.titleRegion) || finalTitleRegion,
      candidate_text:
        candidate.candidateText || candidate.normalizedCandidateText,
      normalized_candidate_text: candidate.normalizedCandidateText,
      candidate_kind: candidate.candidateKind,
      candidate_score: candidate.score,
      is_model_winner:
        normalizeWhitespace(candidate.normalizedCandidateText) ===
        normalizeWhitespace(args.modelSheet.sheet_title),
    });
  }

  if (ocrTitleDiagnostics?.rawTitleSourceText || ocrTitleDiagnostics?.effectiveTitle) {
    pushRegion(regions, seenRegions, {
      role: "title",
      region_type:
        normalizeOptionalText(ocrSelection?.titleRegion) || finalTitleRegion,
      source_kind: "ocr_title_repair",
      x: titleBounds?.x ?? null,
      y: titleBounds?.y ?? null,
      width: titleBounds?.width ?? null,
      height: titleBounds?.height ?? null,
      crop_image_path: (await fileExists(titleCropPath)) ? titleCropPath : null,
      raw_text: normalizeOptionalText(ocrTitleDiagnostics?.rawTitleSourceText),
      normalized_text:
        normalizeOptionalText(ocrTitleDiagnostics?.effectiveTitle) ??
        normalizeOptionalText(ocrTitleDiagnostics?.enrichedTitle) ??
        normalizeOptionalText(ocrTitleDiagnostics?.repairedTitle),
    });
  }

  for (const candidate of topNumberCandidates) {
    if (typeof candidate.value !== "string" || !candidate.value) {
      continue;
    }

    pushCandidate(candidates, seen, {
      role: "number",
      region_type:
        (typeof candidate.regionId === "string" && candidate.regionId) ||
        finalNumberRegion,
      candidate_text:
        (typeof candidate.lineText === "string" && candidate.lineText) ||
        candidate.value,
      normalized_candidate_text: candidate.value,
      candidate_kind: "page_number_rank",
      candidate_score:
        typeof candidate.score === "number" ? candidate.score : null,
      is_model_winner:
        normalizeWhitespace(candidate.value) ===
        normalizeWhitespace(args.modelSheet.sheet_number),
    });
  }

  for (const candidate of pdfPairCandidates) {
    if (typeof candidate.sheetNumber === "string" && candidate.sheetNumber) {
      pushCandidate(candidates, seen, {
        role: "number",
        region_type:
          (typeof candidate.numberRegion === "string" && candidate.numberRegion) ||
          defaultNumberRegion,
        candidate_text: candidate.sheetNumber,
        normalized_candidate_text: candidate.sheetNumber,
        candidate_kind: "pdf_pair",
        candidate_score:
          typeof candidate.score === "number"
            ? candidate.score
            : typeof candidate.confidence === "number"
              ? candidate.confidence
              : null,
        is_model_winner:
          normalizeWhitespace(candidate.sheetNumber) ===
          normalizeWhitespace(args.modelSheet.sheet_number),
      });
    }

    if (typeof candidate.sheetTitle === "string" && candidate.sheetTitle) {
      pushCandidate(candidates, seen, {
        role: "title",
        region_type:
          (typeof candidate.titleRegion === "string" && candidate.titleRegion) ||
          defaultTitleRegion,
        candidate_text: candidate.sheetTitle,
        normalized_candidate_text: candidate.sheetTitle,
        candidate_kind: "pdf_pair",
        candidate_score:
          typeof candidate.score === "number"
            ? candidate.score
            : typeof candidate.confidence === "number"
              ? candidate.confidence
              : null,
        is_model_winner:
          normalizeWhitespace(candidate.sheetTitle) ===
          normalizeWhitespace(args.modelSheet.sheet_title),
      });
    }
  }

  for (const rawBoxCandidate of rawBoxCandidates.slice(0, 8)) {
    const familyId =
      (typeof rawBoxCandidate.familyId === "string" && rawBoxCandidate.familyId) ||
      "rawBox";
    const sourceModel =
      (typeof rawBoxCandidate.sourceModel === "string" && rawBoxCandidate.sourceModel) ||
      "raw_box_context";
    const bbox =
      rawBoxCandidate.bbox && typeof rawBoxCandidate.bbox === "object"
        ? (rawBoxCandidate.bbox as Record<string, unknown>)
        : null;
    const anchor =
      rawBoxCandidate.anchor && typeof rawBoxCandidate.anchor === "object"
        ? (rawBoxCandidate.anchor as Record<string, unknown>)
        : null;
    const titleAttempts =
      (rawBoxCandidate.titleAttempts as Array<Record<string, unknown>> | undefined) ?? [];
    const lines =
      (rawBoxCandidate.lines as Array<Record<string, unknown>> | undefined) ?? [];

    const joinedLines = normalizeOptionalText(
      lines
        .map((line) =>
          typeof line.text === "string" && line.text ? line.text.trim() : ""
        )
        .filter(Boolean)
        .join(" ")
    );

    if (anchor && typeof anchor.value === "string" && anchor.value) {
      pushCandidate(candidates, seen, {
        role: "number",
        region_type: familyId,
        candidate_text:
          (typeof anchor.lineText === "string" && anchor.lineText) || anchor.value,
        normalized_candidate_text: anchor.value,
        candidate_kind: sourceModel,
        candidate_score:
          typeof anchor.score === "number" ? anchor.score : null,
        is_model_winner:
          normalizeWhitespace(anchor.value) ===
          normalizeWhitespace(args.modelSheet.sheet_number),
      });
    }

    for (const attempt of titleAttempts) {
      if (typeof attempt.text !== "string" || !attempt.text) {
        continue;
      }

      pushCandidate(candidates, seen, {
        role: "title",
        region_type: familyId,
        candidate_text:
          (typeof attempt.sourceText === "string" && attempt.sourceText) ||
          attempt.text,
        normalized_candidate_text: attempt.text,
        candidate_kind: sourceModel,
        candidate_score:
          typeof attempt.score === "number" ? attempt.score : null,
        is_model_winner:
          normalizeWhitespace(attempt.text) ===
          normalizeWhitespace(args.modelSheet.sheet_title),
      });
    }

    if (joinedLines) {
      pushRegion(regions, seenRegions, {
        role: "title",
        region_type: familyId,
        source_kind: sourceModel,
        x: normalizeRegionCoordinate(bbox?.x),
        y: normalizeRegionCoordinate(bbox?.y),
        width: normalizeRegionCoordinate(bbox?.width),
        height: normalizeRegionCoordinate(bbox?.height),
        crop_image_path: null,
        raw_text: joinedLines,
        normalized_text: joinedLines,
      });
    }
  }

  return {
    pageImagePath: (await fileExists(pageImagePath)) ? pageImagePath : null,
    heuristicOutput: pageDebug ?? null,
    ocrCandidateSnapshot: ocrCandidates ?? null,
    evidence: {
      ...baseEvidence,
      preview_image_path: (await fileExists(pageImagePath))
        ? pageImagePath
        : baseEvidence.preview_image_path,
    },
    regions,
    candidates,
  };
}

async function appendReviewEvent(planSetId: string, value: Record<string, unknown>) {
  const eventPath = getEventsPath(planSetId);
  await ensureDir(path.dirname(eventPath));
  await fs.appendFile(eventPath, `${JSON.stringify(value)}\n`, "utf8");
}

async function copyFileIntoCorpusIfExists(args: {
  planSetId: string;
  pageNumber: number;
  planSheetId: string;
  sourcePath: string | null | undefined;
  targetFileName: string;
}) {
  const sourcePath = normalizeOptionalText(args.sourcePath);
  if (!sourcePath || !(await fileExists(sourcePath))) {
    return sourcePath;
  }

  const targetPath = path.join(
    getPageArtifactsDir(args.planSetId, args.pageNumber, args.planSheetId),
    args.targetFileName
  );
  await ensureDir(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
  return toCorpusRelativePath(args.planSetId, targetPath);
}

async function persistTrainingPageArtifactPaths(args: {
  planSetId: string;
  planSheetId: string;
  pageNumber: number;
  review: TrainingPageReviewRow;
  evidence: TrainingPageEvidenceRow;
  regions: TrainingPageRegionRow[];
}) {
  const pageImagePath = await copyFileIntoCorpusIfExists({
    planSetId: args.planSetId,
    planSheetId: args.planSheetId,
    pageNumber: args.pageNumber,
    sourcePath: args.review.page_image_path,
    targetFileName: "page-annotated.png",
  });
  const previewImagePath = await copyFileIntoCorpusIfExists({
    planSetId: args.planSetId,
    planSheetId: args.planSheetId,
    pageNumber: args.pageNumber,
    sourcePath: args.evidence.preview_image_path,
    targetFileName: "preview-image.png",
  });
  const regions = await Promise.all(
    args.regions.map(async (region, index) => ({
      ...region,
      crop_image_path: await copyFileIntoCorpusIfExists({
        planSetId: args.planSetId,
        planSheetId: args.planSheetId,
        pageNumber: args.pageNumber,
        sourcePath: region.crop_image_path,
        targetFileName: `${region.role}-crop-${index}.png`,
      }),
    }))
  );

  return {
    review: {
      ...args.review,
      page_image_path: pageImagePath,
    },
    evidence: {
      ...args.evidence,
      preview_image_path: previewImagePath,
    },
    regions,
  };
}

async function loadReplayInputPageSnapshots(importContext: TrainingImportContext | null) {
  const artifactsDir = normalizeOptionalText(importContext?.debug_artifacts_dir);
  if (!artifactsDir) {
    return {
      replayPageByNumber: new Map<number, Record<string, unknown>>(),
      replayOcrResultByPageNumber: new Map<number, Record<string, unknown>>(),
    };
  }

  const replayInputPath = path.join(artifactsDir, "replay-input.json");
  const replayInput = await readJsonFile<{
    pages?: Array<Record<string, unknown> & { pageNumber?: number | null }>;
    pdfTextResults?: Array<{
      pageNumber?: number | null;
      result?: Record<string, unknown> | null;
    }>;
  }>(replayInputPath);

  return {
    replayPageByNumber: new Map(
      (replayInput?.pages ?? [])
        .filter((page) => typeof page.pageNumber === "number")
        .map((page) => [page.pageNumber as number, page as Record<string, unknown>])
    ),
    replayOcrResultByPageNumber: new Map(
      (replayInput?.pdfTextResults ?? [])
        .filter(
          (entry): entry is {
            pageNumber: number;
            result?: Record<string, unknown> | null;
          } => typeof entry.pageNumber === "number"
        )
        .map((entry) => [entry.pageNumber, entry.result ?? null])
    ),
  };
}

function normalizeLoadedPageRecord(record: TrainingPageRecord) {
  const normalizedReviewBlueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: record.review.sheet_number,
    sheet_title: record.review.sheet_title,
    discipline: record.review.discipline,
    sheet_type: record.review.sheet_type,
    scope_tags: record.review.scope_tags,
    area_tags: record.review.area_tags,
    sheet_kind: record.review.sheet_kind,
  });
  const normalizedModelBlueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: record.review.model_sheet_number,
    sheet_title: record.review.model_sheet_title,
    discipline: record.review.model_discipline,
    sheet_type: record.review.model_sheet_type,
    scope_tags: record.review.model_scope_tags,
    area_tags: record.review.model_area_tags,
    sheet_kind: record.review.model_sheet_kind,
  });
  const normalizedReviewSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: record.review.sheet_number,
    sheet_title: record.review.sheet_title,
    discipline: record.review.discipline,
    sheet_type: record.review.sheet_type,
    scope_tags: record.review.scope_tags,
    area_tags: record.review.area_tags,
    sheet_kind: record.review.sheet_kind,
  });
  const normalizedModelSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: record.review.model_sheet_number,
    sheet_title: record.review.model_sheet_title,
    discipline: record.review.model_discipline,
    sheet_type: record.review.model_sheet_type,
    scope_tags: record.review.model_scope_tags,
    area_tags: record.review.model_area_tags,
    sheet_kind: record.review.model_sheet_kind,
  });
  const review = {
    ...record.review,
    discipline: normalizeTrainingDiscipline(record.review.discipline),
    sheet_type: record.review.sheet_type ?? normalizedReviewBlueprintMetadata.sheet_type,
    scope_tags:
      record.review.scope_tags?.length
        ? parseTrainingTagList(record.review.scope_tags)
        : normalizedReviewBlueprintMetadata.scope_tags,
    area_tags:
      record.review.area_tags?.length
        ? parseTrainingTagList(record.review.area_tags)
        : normalizedReviewBlueprintMetadata.area_tags,
    sheet_kind: record.review.sheet_kind ?? normalizedReviewSheetKind,
    correction_reason:
      normalizeTrainingCorrectionReason(
        record.review.correction_reason,
        record.review.was_corrected
      ) || null,
    model_sheet_kind: record.review.model_sheet_kind ?? normalizedModelSheetKind,
    model_sheet_type:
      record.review.model_sheet_type ?? normalizedModelBlueprintMetadata.sheet_type,
    model_scope_tags:
      record.review.model_scope_tags?.length
        ? parseTrainingTagList(record.review.model_scope_tags)
        : normalizedModelBlueprintMetadata.scope_tags,
    model_area_tags:
      record.review.model_area_tags?.length
        ? parseTrainingTagList(record.review.model_area_tags)
        : normalizedModelBlueprintMetadata.area_tags,
    model_discipline: normalizeTrainingDiscipline(record.review.model_discipline),
  };
  const evidence = {
    extracted_text: normalizeOptionalText(record.evidence?.extracted_text),
    number_source_text: normalizeOptionalText(record.evidence?.number_source_text),
    number_source_kind: record.evidence?.number_source_kind ?? null,
    title_source_text: normalizeOptionalText(record.evidence?.title_source_text),
    title_source_kind: record.evidence?.title_source_kind ?? null,
    preview_image_path: normalizeOptionalText(record.evidence?.preview_image_path),
  };
  const pipeline = {
    debug_session_id: normalizeOptionalText(record.pipeline?.debug_session_id),
    heuristic_output:
      record.pipeline?.heuristic_output &&
      typeof record.pipeline.heuristic_output === "object"
        ? record.pipeline.heuristic_output
        : null,
    ocr_candidate_snapshot:
      record.pipeline?.ocr_candidate_snapshot &&
      typeof record.pipeline.ocr_candidate_snapshot === "object"
        ? record.pipeline.ocr_candidate_snapshot
        : null,
    replay_page_input:
      record.pipeline?.replay_page_input &&
      typeof record.pipeline.replay_page_input === "object"
        ? record.pipeline.replay_page_input
        : null,
    replay_ocr_result:
      record.pipeline?.replay_ocr_result &&
      typeof record.pipeline.replay_ocr_result === "object"
        ? record.pipeline.replay_ocr_result
        : null,
    llm_request_payload:
      record.pipeline?.llm_request_payload &&
      typeof record.pipeline.llm_request_payload === "object"
        ? record.pipeline.llm_request_payload
        : null,
    llm_request_status: normalizeOptionalText(record.pipeline?.llm_request_status),
    llm_request_error: normalizeOptionalText(record.pipeline?.llm_request_error),
    llm_resolution:
      record.pipeline?.llm_resolution &&
      typeof record.pipeline.llm_resolution === "object"
        ? record.pipeline.llm_resolution
        : null,
    llm_output:
      record.pipeline?.llm_output && typeof record.pipeline.llm_output === "object"
        ? record.pipeline.llm_output
        : null,
  };
  const regions = record.regions.map((region, index) => ({
    ...region,
    role: region.role ?? (index === 0 ? "number" : "title"),
  }));
  const regionRoleById = new Map(regions.map((region) => [region.id, region.role]));
  const candidates = record.candidates.map((candidate, index) => ({
    ...candidate,
    role:
      candidate.role ??
      regionRoleById.get(candidate.training_page_region_id) ??
      (index % 2 === 0 ? "number" : "title"),
  }));

  return {
    ...record,
    review,
    evidence,
    pipeline,
    regions,
    candidates,
  };
}

async function loadPageRecords(planSetId: string) {
  const pagesDir = getPlanSetPagesDir(planSetId);
  if (!(await fileExists(pagesDir))) {
    return [] as TrainingPageRecord[];
  }

  const entries = await fs.readdir(pagesDir);
  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJsonFile<TrainingPageRecord>(path.join(pagesDir, entry)))
  );

  return records
    .filter((record): record is TrainingPageRecord => Boolean(record))
    .map(normalizeLoadedPageRecord);
}

export async function loadTrainingCorpusInventory() {
  return readJsonFile<TrainingCorpusInventory>(TRAINING_CORPUS_INVENTORY_PATH);
}

async function buildTrainingCorpusInventoryEntry(
  planSetId: string
): Promise<TrainingCorpusInventoryEntry | null> {
  const importContext = await loadTrainingCorpusImportContext(planSetId);
  const pageRecords = await loadPageRecords(planSetId);
  const llmAssistsRaw = await readJsonFile<PlanSheetImportLlmAssistRow[]>(
    getImportLlmAssistsPath(planSetId)
  );
  const llmAssists = (llmAssistsRaw ?? [])
    .map(normalizePlanSheetImportLlmAssistRow)
    .filter((entry): entry is PlanSheetImportLlmAssistRow => Boolean(entry));

  if (!importContext && pageRecords.length === 0 && llmAssists.length === 0) {
    return null;
  }

  const latestReviewedAt = pageRecords.reduce<string | null>((latest, record) => {
    const reviewedAt = normalizeOptionalText(record.review.reviewed_at);
    if (!reviewedAt) {
      return latest;
    }
    if (!latest || reviewedAt > latest) {
      return reviewedAt;
    }
    return latest;
  }, null);

  return {
    plan_set_id: planSetId,
    job_id: importContext?.job_id ?? pageRecords[0]?.review.job_id ?? null,
    set_name: importContext?.set_name ?? null,
    revision_label: importContext?.revision_label ?? null,
    original_file_name: importContext?.original_file_name ?? null,
    debug_session_id: importContext?.debug_session_id ?? null,
    updated_at: importContext?.updated_at ?? latestReviewedAt ?? null,
    corpus_state: pageRecords.length > 0 ? "reviewed" : "context_only",
    page_count: pageRecords.length,
    corrected_pages: pageRecords.filter((record) => record.review.was_corrected).length,
    model_sheet_kind_snapshots: pageRecords.filter(
      (record) => normalizeOptionalText(record.review.model_sheet_kind) !== null
    ).length,
    has_llm_assists: llmAssists.length > 0,
    llm_assist_pages: llmAssists.length,
    llm_success_pages: llmAssists.filter((assist) => assist.request_status === "success").length,
    llm_invalid_pages: llmAssists.filter((assist) => assist.request_status === "invalid_response")
      .length,
    llm_error_pages: llmAssists.filter((assist) => assist.request_status === "error").length,
    latest_reviewed_at: latestReviewedAt,
  };
}

export async function refreshTrainingCorpusInventory() {
  const planSetIds = await listCorpusPlanSetIds();
  const entries = (
    await Promise.all(planSetIds.map((planSetId) => buildTrainingCorpusInventoryEntry(planSetId)))
  )
    .filter((entry): entry is TrainingCorpusInventoryEntry => Boolean(entry))
    .sort((left, right) => {
      const leftUpdated = left.updated_at ?? left.latest_reviewed_at ?? "";
      const rightUpdated = right.updated_at ?? right.latest_reviewed_at ?? "";
      if (leftUpdated !== rightUpdated) {
        return rightUpdated.localeCompare(leftUpdated);
      }
      return left.plan_set_id.localeCompare(right.plan_set_id);
    });

  const inventory: TrainingCorpusInventory = {
    generated_at: toIsoTimestamp(),
    total_plan_sets: entries.length,
    reviewed_plan_sets: entries.filter((entry) => entry.corpus_state === "reviewed").length,
    total_reviewed_pages: entries.reduce((sum, entry) => sum + entry.page_count, 0),
    entries,
  };

  await writeJsonFile(TRAINING_CORPUS_INVENTORY_PATH, inventory);
  return inventory;
}

export async function saveTrainingCorpusForPlanSetReview(args: {
  supabase?: SupabaseClient<Database>;
  jobId: string;
  planSet: PlanSetRow;
  modelSheets: TrainingModelSheet[];
  reviewedSheets: ReviewedSheetInput[];
  reviewedBy: string;
}) {
  const now = toIsoTimestamp();
  const importContext = await loadTrainingCorpusImportContext(args.planSet.id);
  const { replayPageByNumber, replayOcrResultByPageNumber } =
    await loadReplayInputPageSnapshots(importContext);
  const existingRecords = await loadPageRecords(args.planSet.id);
  const importLlmAssists = await loadPlanSetImportLlmAssists(args.planSet.id);
  const existingRecordsBySheetId = new Map(
    existingRecords.map((record) => [record.review.plan_sheet_id, record])
  );

  for (const reviewedSheet of args.reviewedSheets) {
    const currentModelSheet = args.modelSheets.find((sheet) => sheet.id === reviewedSheet.id);
    if (!currentModelSheet) {
      continue;
    }

    const existingRecord = existingRecordsBySheetId.get(reviewedSheet.id) ?? null;
    const canonicalReviewedSheetNumber = canonicalizeTrainingSheetNumber(
      reviewedSheet.sheet_number
    );
    const canonicalReviewedSheetTitle = canonicalizeTrainingSheetTitle(
      reviewedSheet.sheet_title
    );
    const reviewedDiscipline = normalizeTrainingDiscipline(reviewedSheet.discipline);
    const modelSheetNumber = currentModelSheet.sheet_number;
    const modelSheetTitle = currentModelSheet.sheet_title;
    const modelDiscipline = normalizeTrainingDiscipline(currentModelSheet.discipline);
    const requestedModelSheetKind = currentModelSheet.sheet_kind ?? null;
    const rawModelBlueprintMetadata = {
      sheet_number: modelSheetNumber,
      sheet_title: modelSheetTitle,
      discipline: modelDiscipline,
      sheet_type: currentModelSheet.sheet_type ?? null,
      scope_tags: currentModelSheet.scope_tags ?? [],
      area_tags: currentModelSheet.area_tags ?? [],
      sheet_kind: requestedModelSheetKind,
    } as const;
    const modelBlueprintMetadata = normalizeTrainingBlueprintMetadata(
      rawModelBlueprintMetadata
    );
    const inferredCurrentModelSheetKind =
      requestedModelSheetKind ||
      inferLegacyTrainingSheetKind({
        ...rawModelBlueprintMetadata,
        ...modelBlueprintMetadata,
      });
    const modelSheetKind = inferredCurrentModelSheetKind;
    const modelConfidence = currentModelSheet.extraction_confidence;
    const artifactModelSheet: TrainingModelSheet = {
      ...currentModelSheet,
      sheet_number: modelSheetNumber,
      sheet_title: modelSheetTitle,
      discipline: modelDiscipline,
      sheet_type: modelBlueprintMetadata.sheet_type,
      scope_tags: modelBlueprintMetadata.scope_tags,
      area_tags: modelBlueprintMetadata.area_tags,
      sheet_kind: modelSheetKind,
      extraction_confidence: modelConfidence,
    };
    const rawReviewedBlueprintMetadata = {
      sheet_number: canonicalReviewedSheetNumber,
      sheet_title: canonicalReviewedSheetTitle,
      discipline: reviewedDiscipline,
      sheet_type: reviewedSheet.sheet_type,
      scope_tags: reviewedSheet.scope_tags,
      area_tags: reviewedSheet.area_tags,
      sheet_kind: reviewedSheet.sheet_kind,
    } as const;
    const reviewedBlueprintMetadata = normalizeTrainingBlueprintMetadata({
      ...rawReviewedBlueprintMetadata,
    });
    const effectiveSheetKind =
      reviewedSheet.sheet_kind ||
      inferLegacyTrainingSheetKind({
        ...rawReviewedBlueprintMetadata,
        ...reviewedBlueprintMetadata,
      });
    const changedFields = getTrainingChangedFields({
      model: {
        sheet_number: modelSheetNumber,
        sheet_title: modelSheetTitle,
        discipline: modelDiscipline,
        sheet_type: modelBlueprintMetadata.sheet_type,
        scope_tags: modelBlueprintMetadata.scope_tags,
        area_tags: modelBlueprintMetadata.area_tags,
        sheet_kind: modelSheetKind,
      },
      reviewed: {
        sheet_number: canonicalReviewedSheetNumber,
        sheet_title: canonicalReviewedSheetTitle,
        discipline: reviewedDiscipline,
        sheet_type: reviewedBlueprintMetadata.sheet_type,
        scope_tags: reviewedBlueprintMetadata.scope_tags,
        area_tags: reviewedBlueprintMetadata.area_tags,
        sheet_kind: effectiveSheetKind,
      },
    });
    const wasCorrected = changedFields.length > 0;
    const suggestedCorrectionReason = suggestTrainingCorrectionReason({
      model: {
        sheet_number: modelSheetNumber,
        sheet_title: modelSheetTitle,
        discipline: modelDiscipline,
        sheet_type: modelBlueprintMetadata.sheet_type,
        scope_tags: modelBlueprintMetadata.scope_tags,
        area_tags: modelBlueprintMetadata.area_tags,
        sheet_kind: modelSheetKind,
      },
      reviewed: {
        sheet_number: canonicalReviewedSheetNumber,
        sheet_title: canonicalReviewedSheetTitle,
        discipline: reviewedDiscipline,
        sheet_type: reviewedBlueprintMetadata.sheet_type,
        scope_tags: reviewedBlueprintMetadata.scope_tags,
        area_tags: reviewedBlueprintMetadata.area_tags,
        sheet_kind: effectiveSheetKind,
      },
    });
    const correctionReason = resolveTrainingCorrectionReason({
      value: reviewedSheet.correction_reason,
      wasCorrected,
      suggestedReason: suggestedCorrectionReason,
    });
    const correctionNote = normalizeWhitespace(reviewedSheet.correction_note ?? "") || null;
    const pageHash = buildTrainingPageHash({
      planSetId: args.planSet.id,
      pageNumber: reviewedSheet.page_number,
      extractedText: currentModelSheet.extracted_text,
      modelSheetNumber,
      modelSheetTitle,
    });
    const reviewId = `${args.planSet.id}:${reviewedSheet.id}`;
    const artifactEvidence = await buildTrainingArtifactEvidence({
      artifactsDir: importContext?.debug_artifacts_dir,
      pageNumber: reviewedSheet.page_number,
      modelSheet: artifactModelSheet,
    });
    const pageImagePath =
      artifactEvidence.pageImagePath ||
      currentModelSheet.preview_storage_key ||
      currentModelSheet.preview_image_path ||
      null;

    const review: TrainingPageReviewRow = {
      id: reviewId,
      job_id: args.jobId,
      plan_set_id: args.planSet.id,
      plan_sheet_id: reviewedSheet.id,
      page_number: reviewedSheet.page_number,
      page_hash: pageHash,
      sheet_number: canonicalReviewedSheetNumber,
      sheet_title: canonicalReviewedSheetTitle,
      discipline: reviewedDiscipline,
      sheet_type: reviewedBlueprintMetadata.sheet_type,
      scope_tags: reviewedBlueprintMetadata.scope_tags,
      area_tags: reviewedBlueprintMetadata.area_tags,
      sheet_kind: effectiveSheetKind,
      model_sheet_number: modelSheetNumber,
      model_sheet_title: modelSheetTitle,
      model_discipline: modelDiscipline,
      model_sheet_type: modelBlueprintMetadata.sheet_type,
      model_scope_tags: modelBlueprintMetadata.scope_tags,
      model_area_tags: modelBlueprintMetadata.area_tags,
      model_sheet_kind: modelSheetKind,
      model_confidence: modelConfidence,
      page_image_path: pageImagePath,
      was_corrected: wasCorrected,
      correction_reason: correctionReason || null,
      correction_note: correctionNote,
      reviewed_by: args.reviewedBy,
      reviewed_at: now,
      updated_at: now,
      created_at: existingRecord?.review.created_at ?? now,
    };

    const regions: TrainingPageRegionRow[] = artifactEvidence.regions.map((region, index) => ({
      id: `${reviewId}:region:${index}`,
      job_id: args.jobId,
      training_page_review_id: reviewId,
      role: region.role,
      region_type: region.region_type,
      source_kind: region.source_kind,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      crop_image_path: region.crop_image_path,
      raw_text: region.raw_text,
      normalized_text: region.normalized_text,
      created_at: existingRecord?.regions[index]?.created_at ?? now,
    }));

    const regionIdsByRole = new Map(regions.map((region) => [region.role, region.id]));
    const candidates: TrainingRegionCandidateRow[] = artifactEvidence.candidates
      .map((candidate, index) => {
        const regionId = regionIdsByRole.get(candidate.role);
        if (!regionId) {
          return null;
        }

        return {
          id: `${reviewId}:candidate:${index}`,
          job_id: args.jobId,
          training_page_region_id: regionId,
          role: candidate.role,
          candidate_text: candidate.candidate_text,
          normalized_candidate_text: candidate.normalized_candidate_text,
          candidate_kind: candidate.candidate_kind,
          candidate_score: candidate.candidate_score ?? null,
          is_model_winner: candidate.is_model_winner,
          created_at: now,
        } satisfies TrainingRegionCandidateRow;
      })
      .filter(
        (candidate): candidate is TrainingRegionCandidateRow => Boolean(candidate)
      );
    const persistedArtifacts = await persistTrainingPageArtifactPaths({
      planSetId: args.planSet.id,
      planSheetId: reviewedSheet.id,
      pageNumber: reviewedSheet.page_number,
      review,
      evidence: artifactEvidence.evidence,
      regions,
    });
    const llmAssist = importLlmAssists.get(reviewedSheet.id) ?? null;
    const heuristicOutput = artifactEvidence.heuristicOutput;
    const llmOutput =
      llmAssist?.response_payload ??
      (
        heuristicOutput &&
        typeof heuristicOutput.llmOutput === "object" &&
        heuristicOutput.llmOutput
          ? (heuristicOutput.llmOutput as Record<string, unknown>)
          : heuristicOutput &&
              typeof heuristicOutput.llm_output === "object" &&
              heuristicOutput.llm_output
            ? (heuristicOutput.llm_output as Record<string, unknown>)
            : existingRecord?.pipeline.llm_output ?? null
      );
    const llmResolution =
      llmAssist
        ? {
            sheet_number: llmAssist.resolved_metadata?.sheet_number ?? null,
            sheet_title: llmAssist.resolved_metadata?.sheet_title ?? null,
            discipline: llmAssist.resolved_metadata?.discipline ?? null,
            sheet_type: llmAssist.resolved_metadata?.sheet_type ?? null,
            scope_tags: llmAssist.resolved_metadata?.scope_tags ?? [],
            area_tags: llmAssist.resolved_metadata?.area_tags ?? [],
            sheet_kind: llmAssist.resolved_metadata?.sheet_kind ?? null,
            confidence: llmAssist.resolved_metadata?.confidence ?? null,
            agrees_with_heuristic: llmAssist.agrees_with_heuristic,
            disagreement_fields: llmAssist.disagreement_fields,
            attempt_count: llmAssist.attempt_count,
            final_error_kind: llmAssist.final_error_kind,
            retry_history: llmAssist.retry_history,
            effective_metadata: llmAssist.effective_metadata
              ? {
                  sheet_number: llmAssist.effective_metadata.sheet_number,
                  sheet_title: llmAssist.effective_metadata.sheet_title,
                  discipline: llmAssist.effective_metadata.discipline,
                  sheet_type: llmAssist.effective_metadata.sheet_type,
                  scope_tags: llmAssist.effective_metadata.scope_tags,
                  area_tags: llmAssist.effective_metadata.area_tags,
                  sheet_kind: llmAssist.effective_metadata.sheet_kind,
                  confidence: llmAssist.effective_metadata.confidence,
                }
              : null,
            effective_field_sources: llmAssist.effective_field_sources ?? null,
            effective_source: llmAssist.effective_source ?? null,
          }
        : existingRecord?.pipeline.llm_resolution ?? null;
    const pipeline: TrainingPagePipelineRow = {
      debug_session_id:
        importContext?.debug_session_id ??
        existingRecord?.pipeline.debug_session_id ??
        null,
      heuristic_output:
        artifactEvidence.heuristicOutput ?? existingRecord?.pipeline.heuristic_output ?? null,
      ocr_candidate_snapshot:
        artifactEvidence.ocrCandidateSnapshot ??
        existingRecord?.pipeline.ocr_candidate_snapshot ??
        null,
      replay_page_input:
        replayPageByNumber.get(reviewedSheet.page_number) ??
        existingRecord?.pipeline.replay_page_input ??
        null,
      replay_ocr_result:
        replayOcrResultByPageNumber.get(reviewedSheet.page_number) ??
        existingRecord?.pipeline.replay_ocr_result ??
        null,
      llm_request_payload:
        llmAssist?.request_payload ?? existingRecord?.pipeline.llm_request_payload ?? null,
      llm_request_status:
        llmAssist?.request_status ?? existingRecord?.pipeline.llm_request_status ?? null,
      llm_request_error:
        llmAssist?.error_message ?? existingRecord?.pipeline.llm_request_error ?? null,
      llm_resolution: llmResolution,
      llm_output: llmOutput,
    };

    const pageRecord: TrainingPageRecord = {
      review: persistedArtifacts.review,
      evidence: persistedArtifacts.evidence,
      pipeline,
      regions: persistedArtifacts.regions,
      candidates,
    };

    await writeJsonFile(
      getPageRecordPath(args.planSet.id, reviewedSheet.page_number, reviewedSheet.id),
      pageRecord
    );

    await appendReviewEvent(args.planSet.id, {
      id: `${reviewId}:event:${now}`,
      job_id: args.jobId,
      training_page_review_id: reviewId,
      plan_sheet_id: reviewedSheet.id,
      was_corrected: wasCorrected,
      changed_fields: changedFields,
      correction_reason: correctionReason || null,
      correction_note: correctionNote,
      reviewed_by: args.reviewedBy,
      reviewed_at: now,
    });
  }

  await refreshTrainingCorpusInventory();
}

export async function loadTrainingCorpusVerification(args: {
  supabase?: SupabaseClient<Database>;
  planSetId: string;
}) {
  const records = await loadPageRecords(args.planSetId);
  records.sort((left, right) => left.review.page_number - right.review.page_number);

  return new Map(
    records.map((record) => [
      record.review.plan_sheet_id,
      {
        review: record.review,
        evidence: record.evidence,
        pipeline: record.pipeline,
        regions: record.regions,
        candidates: record.candidates,
      },
    ])
  );
}

export async function loadPriorTrainingPrefills(args: {
  jobId: string;
  planSetId: string;
  currentSetName?: string | null;
  currentRevisionLabel?: string | null;
  currentOriginalFileName?: string | null;
  supabase?: SupabaseClient<Database>;
  sheets: Array<{
    id: string;
    page_number: number;
    sheet_number: string;
    sheet_title: string;
    discipline: string | null;
  }>;
}) {
  const allPlanSetIds = await listCorpusPlanSetIds();
  const candidatePlanSetIds = allPlanSetIds.filter(
    (candidatePlanSetId) => candidatePlanSetId !== args.planSetId
  );
  const candidatePlanSetIdentityById = new Map<
    string,
    {
      set_name: string | null;
      revision_label: string | null;
      original_file_name: string | null;
    }
  >();

  if (args.supabase && candidatePlanSetIds.length > 0) {
    const { data: candidatePlanSets } = await args.supabase
      .from("plan_sets")
      .select("id, set_name, revision_label, original_file_name")
      .in("id", candidatePlanSetIds)
      .eq("job_id", args.jobId);

    for (const candidatePlanSet of candidatePlanSets ?? []) {
      candidatePlanSetIdentityById.set(candidatePlanSet.id, {
        set_name: candidatePlanSet.set_name ?? null,
        revision_label: candidatePlanSet.revision_label ?? null,
        original_file_name: candidatePlanSet.original_file_name ?? null,
      });
    }
  }

  let bestMatch:
    | {
        planSetId: string;
        score: number;
        strongMatches: number;
        pageCountDelta: number;
        recordsByPageNumber: Map<number, TrainingPageRecord>;
      }
    | null = null;

  for (const candidatePlanSetId of candidatePlanSetIds) {
    const importContext = await loadTrainingCorpusImportContext(candidatePlanSetId);
    if (!importContext || importContext.job_id !== args.jobId) {
      continue;
    }

    const candidatePlanSetIdentity = candidatePlanSetIdentityById.get(
      candidatePlanSetId
    );
    const candidateSetName =
      importContext.set_name ?? candidatePlanSetIdentity?.set_name ?? null;
    const candidateRevisionLabel =
      importContext.revision_label ??
      candidatePlanSetIdentity?.revision_label ??
      null;
    const candidateOriginalFileName =
      importContext.original_file_name ??
      candidatePlanSetIdentity?.original_file_name ??
      null;
    if (
      !matchesTrainingPrefillPlanIdentity({
        currentSetName: args.currentSetName,
        currentRevisionLabel: args.currentRevisionLabel,
        candidateSetName,
        candidateRevisionLabel,
      })
    ) {
      continue;
    }

    const records = await loadPageRecords(candidatePlanSetId);
    if (records.length === 0) {
      continue;
    }

    const recordsByPageNumber = new Map(
      records.map((record) => [record.review.page_number, record])
    );
    const pageCountDelta = Math.abs(records.length - args.sheets.length);
    let score = pageCountDelta === 0 ? 100 : Math.max(0, 40 - pageCountDelta * 4);
    let strongMatches = 0;
    const currentSetName = normalizeWhitespace(args.currentSetName ?? "").toLowerCase();
    const currentRevisionLabel = normalizeWhitespace(
      args.currentRevisionLabel ?? ""
    ).toLowerCase();
    const currentOriginalFileName = normalizeWhitespace(
      args.currentOriginalFileName ?? ""
    ).toLowerCase();
    const normalizedCandidateSetName = normalizeWhitespace(candidateSetName ?? "").toLowerCase();
    const normalizedCandidateRevisionLabel = normalizeWhitespace(
      candidateRevisionLabel ?? ""
    ).toLowerCase();
    const normalizedCandidateOriginalFileName = normalizeWhitespace(
      candidateOriginalFileName ?? ""
    ).toLowerCase();
    const exactSetRevisionMatch =
      currentSetName.length > 0 &&
      currentRevisionLabel.length > 0 &&
      currentSetName === normalizedCandidateSetName &&
      currentRevisionLabel === normalizedCandidateRevisionLabel;
    const exactOriginalFileMatch =
      currentOriginalFileName.length > 0 &&
      normalizedCandidateOriginalFileName.length > 0 &&
      currentOriginalFileName === normalizedCandidateOriginalFileName;
    const allowIdentityBasedFallback =
      pageCountDelta === 0 && (exactOriginalFileMatch || exactSetRevisionMatch);

    for (const sheet of args.sheets) {
      const priorRecord = recordsByPageNumber.get(sheet.page_number);
      if (!priorRecord) {
        continue;
      }

      score += 2;

      if (
        canonicalizeTrainingSheetNumber(sheet.sheet_number) ===
        canonicalizeTrainingSheetNumber(priorRecord.review.sheet_number)
      ) {
        score += 8;
        strongMatches += 1;
      }

      if (
        canonicalizeTrainingSheetTitle(sheet.sheet_title) ===
        canonicalizeTrainingSheetTitle(priorRecord.review.sheet_title)
      ) {
        score += 8;
        strongMatches += 1;
      }

      if (
        normalizeWhitespace(sheet.discipline ?? "").toLowerCase() ===
        normalizeWhitespace(priorRecord.review.discipline ?? "").toLowerCase()
      ) {
        score += 2;
      }
    }

    const minimumStrongMatches = Math.min(
      Math.max(2, Math.floor(args.sheets.length * 0.15)),
      args.sheets.length
    );
    if (strongMatches < minimumStrongMatches && !allowIdentityBasedFallback) {
      continue;
    }

    if (
      !bestMatch ||
      score > bestMatch.score ||
      (score === bestMatch.score && pageCountDelta < bestMatch.pageCountDelta)
    ) {
      bestMatch = {
        planSetId: candidatePlanSetId,
        score,
        strongMatches,
        pageCountDelta,
        recordsByPageNumber,
      };
    }
  }

  if (!bestMatch) {
    return new Map<string, PriorTrainingPrefillEntry>();
  }

  return new Map(
    args.sheets.flatMap((sheet) => {
      const priorRecord = bestMatch?.recordsByPageNumber.get(sheet.page_number);
      if (!priorRecord) {
        return [];
      }

      return [
        [
          sheet.id,
          {
            review: priorRecord.review,
            source_plan_set_id: bestMatch.planSetId,
            source_page_number: priorRecord.review.page_number,
            match_basis: "page_number" as const,
            match_confidence: "likely" as const,
          },
        ],
      ];
    })
  );
}
