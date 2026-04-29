import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { adminCanAccessJob } from "@/lib/adminJobs";
import { formatYmd } from "@/lib/datetime";
import {
  isPlanSheetPublishInProgress,
  startPlanSheetPublishJob,
} from "@/lib/planSheetPublishJob";
import {
  loadTrainingCorpusVerification,
  loadPriorTrainingPrefills,
  loadPlanSetImportLlmAssists,
  saveTrainingCorpusForPlanSetReview,
} from "@/lib/trainingCorpus";
import {
  formatTrainingTagList,
  formatTrainingChangedFieldLabel,
  getTrainingVerificationStatus,
  getTrainingChangedFields,
  inferLegacyTrainingSheetKind,
  inferTrainingSheetKind,
  isTrainingCorpusEnabled,
  normalizeTrainingBlueprintMetadata,
  normalizeTrainingDiscipline,
  parseTrainingTagList,
  resolveTrainingCorrectionReason,
  suggestTrainingCorrectionReason,
  TRAINING_SHEET_KIND_OPTIONS,
  TRAINING_SHEET_TYPE_OPTIONS,
  type CorrectionReason,
  type SheetKind,
  type SheetType,
} from "@/lib/trainingCorpusShared";
import TrainingRecordStatusBadge from "./TrainingRecordStatusBadge";
import TrainingReviewAutofill from "./TrainingReviewAutofill";
import PublishPlanSetButton from "./PublishPlanSetButton";
import PublishPlanSetProgress from "./PublishPlanSetProgress";
import AdminPageHeader from "@/app/admin/AdminPageHeader";
import AdminSurface from "@/app/admin/AdminSurface";

export const dynamic = "force-dynamic";

type PlanSetImportPageProps = {
  params: Promise<{
    id: string;
    planSetId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    success?: string;
  }>;
};

type ReviewSheetRow = {
  id: string;
  sheet_number: string;
  sheet_title: string;
  discipline: string | null;
  page_number: number;
  extraction_confidence: number | null;
  sheet_type: string;
  sheet_kind: string;
  scope_tags: string[];
  area_tags: string[];
  metadata_source: string;
  metadata_confidence: number | null;
  identity_confidence_tier: string | null;
  identity_confidence_reasons: string[];
  llm_routing_status: string;
  llm_routing_reason: string | null;
  metadata_review_status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  extracted_text: string | null;
  number_source_text: string | null;
  number_source_kind: string | null;
  title_source_text: string | null;
  title_source_kind: string | null;
  preview_image_path: string | null;
  preview_storage_key: string | null;
};

type ReviewedSheetDraft = {
  id: string;
  sheet_number: string;
  sheet_title: string;
  discipline: string | null;
  page_number: number;
  sheet_type: SheetType;
  scope_tags: string[];
  area_tags: string[];
  sheet_kind: SheetKind;
  model_sheet_type_snapshot: SheetType;
  model_scope_tags_snapshot: string[];
  model_area_tags_snapshot: string[];
  model_sheet_kind_snapshot: SheetKind;
  correction_reason: CorrectionReason;
  correction_note: string | null;
};

type TrainingVerificationMap = Awaited<
  ReturnType<typeof loadTrainingCorpusVerification>
>;
type PriorTrainingPrefillMap = Awaited<
  ReturnType<typeof loadPriorTrainingPrefills>
>;
type PlanSheetImportLlmAssistMap = Awaited<
  ReturnType<typeof loadPlanSetImportLlmAssists>
>;
type TrainingVerificationEntry =
  TrainingVerificationMap extends Map<string, infer TValue> ? TValue : never;
type PriorTrainingPrefillEntryValue =
  PriorTrainingPrefillMap extends Map<string, infer TValue> ? TValue : never;
type PlanSheetImportLlmAssistEntry =
  PlanSheetImportLlmAssistMap extends Map<string, infer TValue> ? TValue : never;
type TrainingSheetMetadataContext = {
  defaultCorrectionNote: string;
  modelSheetNumber: string;
  modelSheetTitle: string;
  modelDiscipline: string | null;
  modelSheetType: SheetType;
  modelScopeTags: string[];
  modelAreaTags: string[];
  modelSheetKind: SheetKind;
  reviewedSheetNumber: string;
  reviewedSheetTitle: string;
  reviewedDiscipline: string | null;
  reviewedSheetType: SheetType;
  reviewedScopeTags: string[];
  reviewedAreaTags: string[];
  reviewedSheetKind: SheetKind;
};

const TRAINING_SHEET_TYPE_LABELS = new Map(
  TRAINING_SHEET_TYPE_OPTIONS.map((option) => [option.value, option.label])
);
const VALID_SHEET_TYPES = new Set(
  TRAINING_SHEET_TYPE_OPTIONS.map((option) => option.value)
);
const VALID_SHEET_KINDS = new Set(
  TRAINING_SHEET_KIND_OPTIONS.map((option) => option.value)
);
const METADATA_TAG_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,63}$/;

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function getTrainingSheetTypeLabel(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "Blank";
  }

  return TRAINING_SHEET_TYPE_LABELS.get(normalized as SheetType) ?? normalized;
}

function canonicalizeReviewSheetNumber(value: string | null | undefined) {
  return normalizeWhitespace(value).toUpperCase();
}

function findDuplicateReviewSheetNumber(sheets: readonly ReviewedSheetDraft[]) {
  const seen = new Set<string>();

  for (const sheet of sheets) {
    const key = canonicalizeReviewSheetNumber(sheet.sheet_number);
    if (!key) {
      continue;
    }

    if (seen.has(key)) {
      return sheet.sheet_number;
    }

    seen.add(key);
  }

  return null;
}

function findInvalidReviewedMetadata(sheets: readonly ReviewedSheetDraft[]) {
  for (const sheet of sheets) {
    if (!VALID_SHEET_TYPES.has(sheet.sheet_type)) {
      return `${sheet.sheet_number || "Sheet"} has an invalid sheet type.`;
    }

    if (!VALID_SHEET_KINDS.has(sheet.sheet_kind)) {
      return `${sheet.sheet_number || "Sheet"} has an invalid sheet kind.`;
    }

    const invalidTag = [...sheet.scope_tags, ...sheet.area_tags].find(
      (tag) => !METADATA_TAG_PATTERN.test(tag)
    );

    if (invalidTag) {
      return `${sheet.sheet_number || "Sheet"} has an invalid tag: ${invalidTag}.`;
    }
  }

  return null;
}

function formatTrainingDisplayTags(value: readonly string[] | string | null | undefined) {
  return formatTrainingTagList(value) || "None";
}

function getSheetConfidenceTier(confidence: number | null | undefined) {
  if (typeof confidence !== "number") {
    return "unknown" as const;
  }

  if (confidence >= 0.86) {
    return "trusted" as const;
  }

  if (confidence >= 0.45) {
    return "repairable" as const;
  }

  return "weak" as const;
}

function getSheetConfidenceBadgeClass(confidence: number | null | undefined) {
  const tier = getSheetConfidenceTier(confidence);
  switch (tier) {
    case "trusted":
      return "bg-emerald-100 text-emerald-800";
    case "repairable":
      return "bg-amber-100 text-amber-800";
    case "weak":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getSheetConfidenceCardClass(confidence: number | null | undefined) {
  const tier = getSheetConfidenceTier(confidence);
  switch (tier) {
    case "repairable":
      return "border-amber-300 bg-amber-50/80";
    case "weak":
      return "border-rose-300 bg-rose-50/80";
    default:
      return "border-gray-200 bg-gray-50";
  }
}

type SheetLlmRoutingStatus =
  | "llm_used"
  | "llm_failed"
  | "llm_candidate"
  | "trusted_skip"
  | "manual_review"
  | "missing_identity"
  | "unknown";

type SheetIdentityCalibrationSnapshot = {
  confidenceTier: string | null;
  llmRecommended: boolean | null;
  repairableEvidence: boolean | null;
};

function hasSourcePreviewForLlmRepair(sheet: ReviewSheetRow) {
  return Boolean(
    normalizeWhitespace(sheet.number_source_text) &&
      normalizeWhitespace(sheet.title_source_text) &&
      normalizeWhitespace(sheet.number_source_kind) &&
      normalizeWhitespace(sheet.title_source_kind)
  );
}

function getSavedTrainingFinalSelection(
  savedTraining: TrainingVerificationEntry | null | undefined
) {
  const heuristicOutput =
    savedTraining?.pipeline?.heuristic_output &&
    typeof savedTraining.pipeline.heuristic_output === "object"
      ? (savedTraining.pipeline.heuristic_output as Record<string, unknown>)
      : null;
  return heuristicOutput?.finalSelection &&
    typeof heuristicOutput.finalSelection === "object"
    ? (heuristicOutput.finalSelection as Record<string, unknown>)
    : null;
}

function getSheetIdentityCalibrationSnapshot(
  finalSelection: Record<string, unknown> | null | undefined
): SheetIdentityCalibrationSnapshot | null {
  if (!finalSelection) {
    return null;
  }

  const confidenceTier =
    typeof finalSelection.confidenceTier === "string"
      ? normalizeWhitespace(finalSelection.confidenceTier)
      : "";
  return {
    confidenceTier: confidenceTier || null,
    llmRecommended:
      typeof finalSelection.llmRecommended === "boolean"
        ? finalSelection.llmRecommended
        : null,
    repairableEvidence:
      typeof finalSelection.repairableEvidence === "boolean"
        ? finalSelection.repairableEvidence
        : null,
  };
}

function getSheetLlmRouting(
  sheet: ReviewSheetRow,
  llmAssist: PlanSheetImportLlmAssistEntry | null,
  calibration: SheetIdentityCalibrationSnapshot | null = null
): {
  status: SheetLlmRoutingStatus;
  label: string;
  description: string;
} {
  if (llmAssist?.request_status === "success") {
    return {
      status: "llm_used",
      label: llmAssist.agrees_with_heuristic === false ? "LLM differs" : "LLM used",
      description:
        llmAssist.agrees_with_heuristic === false
          ? "The LLM found a supported correction. Review the disagreement before saving training data."
          : "The LLM was called for this sheet and agreed with the picked metadata.",
    };
  }

  if (
    llmAssist?.request_status === "error" ||
    llmAssist?.request_status === "invalid_response"
  ) {
    return {
      status: "llm_failed",
      label: "LLM failed",
      description:
        "The sheet was eligible for LLM repair, but the assist did not produce a usable answer.",
    };
  }

  switch (normalizeWhitespace(sheet.llm_routing_status)) {
    case "llm_used":
      return {
        status: "llm_used",
        label: "LLM used",
        description: sheet.llm_routing_reason || "Persisted routing says LLM metadata was applied.",
      };
    case "llm_failed":
      return {
        status: "llm_failed",
        label: "LLM failed",
        description: sheet.llm_routing_reason || "Persisted routing says LLM enrichment failed.",
      };
    case "candidate":
      return {
        status: "llm_candidate",
        label: "LLM candidate",
        description:
          sheet.llm_routing_reason ||
          "Persisted routing says this row is in the useful LLM repair band.",
      };
    case "skip_trusted":
      return {
        status: "trusted_skip",
        label: "Skip LLM",
        description:
          sheet.llm_routing_reason ||
          "Persisted routing says the importer result is trusted.",
      };
    case "manual_required":
      return {
        status: "manual_review",
        label: "Manual first",
        description:
          sheet.llm_routing_reason ||
          "Persisted routing says this row should be reviewed before any LLM call.",
      };
    case "no_llm":
      return {
        status: "manual_review",
        label: "No LLM",
        description:
          sheet.llm_routing_reason ||
          "Persisted routing says this row lacks useful repair evidence.",
      };
    default:
      break;
  }

  const hasIdentity = Boolean(
    normalizeWhitespace(sheet.sheet_number) && normalizeWhitespace(sheet.sheet_title)
  );
  if (!hasIdentity) {
    return {
      status: "missing_identity",
      label: "No LLM",
      description:
        "Missing sheet number or title. Improve importer evidence or review manually before spending LLM tokens.",
    };
  }

  if (calibration?.confidenceTier === "trusted") {
    return {
      status: "trusted_skip",
      label: "Skip LLM",
      description:
        "Saved importer calibration marked this identity as trusted. The LLM should stay off unless the reviewer sees a visible issue.",
    };
  }

  if (calibration?.llmRecommended === true) {
    return {
      status: "llm_candidate",
      label: "LLM candidate",
      description:
        "Saved importer calibration found localized, repairable evidence. This is the useful LLM repair band.",
    };
  }

  if (calibration?.confidenceTier === "needs_review") {
    return {
      status: "manual_review",
      label: "Manual first",
      description:
        "Saved importer calibration found repairable evidence, but not enough confidence to spend LLM tokens before review.",
    };
  }

  if (calibration?.confidenceTier === "insufficient_evidence") {
    return {
      status: "manual_review",
      label: "No LLM",
      description:
        "Saved importer calibration marked the identity evidence as insufficient. Fix the importer evidence or review manually.",
    };
  }

  const tier = getSheetConfidenceTier(sheet.extraction_confidence);
  if (tier === "trusted") {
    return {
      status: "trusted_skip",
      label: "Skip LLM",
      description:
        "High-confidence identity evidence. The LLM should stay off unless the reviewer sees a visible issue.",
    };
  }

  if (tier === "repairable" && hasSourcePreviewForLlmRepair(sheet)) {
    return {
      status: "llm_candidate",
      label: "LLM candidate",
      description:
        "Middle-confidence pick with localized number/title evidence. This is the useful LLM repair band.",
    };
  }

  if (tier === "repairable") {
    return {
      status: "manual_review",
      label: "Manual first",
      description:
        "The score is in the repair band, but localized source evidence is incomplete on this row. Treat it as manual review until evidence improves.",
    };
  }

  if (tier === "weak") {
    return {
      status: "manual_review",
      label: "No LLM",
      description:
        "Weak or noisy identity evidence. A repair model is likely to guess, so fix the importer or review manually.",
    };
  }

  return {
    status: "unknown",
    label: "Unknown",
    description:
      "Confidence was not available for this row, so the LLM gate cannot make a safe call.",
  };
}

function getSheetLlmRoutingBadgeClass(status: SheetLlmRoutingStatus) {
  switch (status) {
    case "llm_used":
      return "bg-sky-100 text-sky-800";
    case "llm_failed":
    case "missing_identity":
      return "bg-rose-100 text-rose-800";
    case "llm_candidate":
      return "bg-amber-100 text-amber-800";
    case "trusted_skip":
      return "bg-emerald-100 text-emerald-800";
    case "manual_review":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function getSheetLlmRoutingMessageClass(status: SheetLlmRoutingStatus) {
  switch (status) {
    case "llm_candidate":
      return "text-amber-900";
    case "trusted_skip":
    case "llm_used":
      return "text-emerald-900";
    case "manual_review":
      return "text-orange-900";
    case "llm_failed":
    case "missing_identity":
      return "text-rose-900";
    default:
      return "text-slate-700";
  }
}

function getLlmAssistStatusLabel(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value);
  switch (normalized) {
    case "success":
      return "LLM resolved";
    case "invalid_response":
      return "LLM unusable response";
    case "error":
      return "LLM request failed";
    default:
      return "LLM not available";
  }
}

function buildTrainingSheetMetadataContext(args: {
  sheet: ReviewSheetRow;
  savedTraining: TrainingVerificationEntry | null;
  priorPrefill: PriorTrainingPrefillEntryValue | null;
}): TrainingSheetMetadataContext {
  const { sheet, savedTraining, priorPrefill } = args;
  const savedReviewedSheetNumber = normalizeWhitespace(
    savedTraining?.review.sheet_number
  );
  const savedReviewedSheetTitle = normalizeWhitespace(
    savedTraining?.review.sheet_title
  );
  const savedReviewedDiscipline = normalizeTrainingDiscipline(
    savedTraining?.review.discipline
  );
  const savedReviewedSheetType = normalizeWhitespace(
    savedTraining?.review.sheet_type
  ) as SheetType;
  const savedReviewedScopeTags =
    savedTraining?.review.scope_tags?.length ? savedTraining.review.scope_tags : null;
  const savedReviewedAreaTags =
    savedTraining?.review.area_tags?.length ? savedTraining.review.area_tags : null;
  const savedReviewedSheetKind = normalizeWhitespace(
    savedTraining?.review.sheet_kind
  ) as SheetKind;
  const defaultCorrectionNote = savedTraining?.review.correction_note ?? "";
  const modelSheetNumber = savedTraining?.review.model_sheet_number ?? sheet.sheet_number;
  const modelSheetTitle = savedTraining?.review.model_sheet_title ?? sheet.sheet_title;
  const modelDiscipline =
    savedTraining?.review.model_discipline ?? normalizeTrainingDiscipline(sheet.discipline);
  const modelBlueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: modelSheetNumber,
    sheet_title: modelSheetTitle,
    discipline: modelDiscipline,
    sheet_type: savedTraining?.review.model_sheet_type ?? sheet.sheet_type ?? null,
    scope_tags: savedTraining?.review.model_scope_tags ?? sheet.scope_tags ?? [],
    area_tags: savedTraining?.review.model_area_tags ?? sheet.area_tags ?? [],
    sheet_kind: savedTraining?.review.model_sheet_kind ?? sheet.sheet_kind ?? null,
  });
  const modelSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: modelSheetNumber,
    sheet_title: modelSheetTitle,
    discipline: modelDiscipline,
    sheet_type: modelBlueprintMetadata.sheet_type,
    scope_tags: modelBlueprintMetadata.scope_tags,
    area_tags: modelBlueprintMetadata.area_tags,
    sheet_kind: savedTraining?.review.model_sheet_kind ?? null,
  });
  const reviewedSheetNumber =
    savedReviewedSheetNumber ||
    priorPrefill?.review.sheet_number ||
    sheet.sheet_number;
  const reviewedSheetTitle =
    savedReviewedSheetTitle ||
    priorPrefill?.review.sheet_title ||
    sheet.sheet_title;
  const reviewedDiscipline =
    savedReviewedDiscipline ??
    priorPrefill?.review.discipline ??
    normalizeTrainingDiscipline(sheet.discipline);
  const reviewedBlueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: reviewedSheetNumber,
    sheet_title: reviewedSheetTitle,
    discipline: reviewedDiscipline,
    sheet_type:
      savedReviewedSheetType ||
      priorPrefill?.review.sheet_type ||
      sheet.sheet_type ||
      null,
    scope_tags:
      savedReviewedScopeTags ??
      priorPrefill?.review.scope_tags ??
      sheet.scope_tags ??
      modelBlueprintMetadata.scope_tags,
    area_tags:
      savedReviewedAreaTags ??
      priorPrefill?.review.area_tags ??
      sheet.area_tags ??
      modelBlueprintMetadata.area_tags,
    sheet_kind:
      savedReviewedSheetKind ||
      priorPrefill?.review.sheet_kind ||
      sheet.sheet_kind ||
      null,
  });
  const reviewedSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: reviewedSheetNumber,
    sheet_title: reviewedSheetTitle,
    discipline: reviewedDiscipline,
    sheet_type: reviewedBlueprintMetadata.sheet_type,
    scope_tags: reviewedBlueprintMetadata.scope_tags,
    area_tags: reviewedBlueprintMetadata.area_tags,
    sheet_kind:
      savedReviewedSheetKind || priorPrefill?.review.sheet_kind || null,
  });

  return {
    defaultCorrectionNote,
    modelSheetNumber,
    modelSheetTitle,
    modelDiscipline,
    modelSheetType: modelBlueprintMetadata.sheet_type,
    modelScopeTags: modelBlueprintMetadata.scope_tags,
    modelAreaTags: modelBlueprintMetadata.area_tags,
    modelSheetKind,
    reviewedSheetNumber,
    reviewedSheetTitle,
    reviewedDiscipline,
    reviewedSheetType: reviewedBlueprintMetadata.sheet_type,
    reviewedScopeTags: reviewedBlueprintMetadata.scope_tags,
    reviewedAreaTags: reviewedBlueprintMetadata.area_tags,
    reviewedSheetKind,
  };
}

function buildImportReviewUrl(
  jobId: string,
  planSetId: string,
  params: Record<string, string | null | undefined>
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const normalized = normalizeWhitespace(value);
    if (normalized) {
      searchParams.set(key, normalized);
    }
  }

  const query = searchParams.toString();
  return `/admin/jobs/${jobId}/sheets/import/${planSetId}${query ? `?${query}` : ""}`;
}

function parseReviewedSheetDrafts(
  formData: FormData,
  sheets: ReviewSheetRow[]
): ReviewedSheetDraft[] {
  return sheets.map((sheet) => {
    const sheetNumber = String(formData.get(`sheet_number_${sheet.id}`) ?? "").trim();
    const sheetTitle = String(formData.get(`sheet_title_${sheet.id}`) ?? "").trim();
    const disciplineValue = normalizeTrainingDiscipline(
      String(formData.get(`discipline_${sheet.id}`) ?? "").trim()
    );
    const pageNumberValue = Number(formData.get(`page_number_${sheet.id}`) ?? 0);
    const pageNumber = Number.isFinite(pageNumberValue) && pageNumberValue > 0
      ? Math.trunc(pageNumberValue)
      : sheet.page_number;
    const requestedSheetKind = String(
      formData.get(`sheet_kind_${sheet.id}`) ?? sheet.sheet_kind ?? ""
    ).trim();
    const requestedSheetType = String(
      formData.get(`sheet_type_${sheet.id}`) ?? sheet.sheet_type ?? ""
    ).trim();
    const requestedScopeTags = String(
      formData.get(`scope_tags_${sheet.id}`) ??
        formatTrainingTagList(sheet.scope_tags) ??
        ""
    ).trim();
    const requestedAreaTags = String(
      formData.get(`area_tags_${sheet.id}`) ??
        formatTrainingTagList(sheet.area_tags) ??
        ""
    ).trim();
    const normalizedReviewedMetadata = normalizeTrainingBlueprintMetadata({
      sheet_number: sheetNumber,
      sheet_title: sheetTitle,
      discipline: disciplineValue,
      sheet_type: requestedSheetType,
      scope_tags: parseTrainingTagList(requestedScopeTags),
      area_tags: parseTrainingTagList(requestedAreaTags),
      sheet_kind: requestedSheetKind,
    });
    const modelSheetTypeSnapshot = String(
      formData.get(`model_sheet_type_snapshot_${sheet.id}`) ??
        sheet.sheet_type ??
        ""
    ).trim();
    const modelScopeTagsSnapshot = String(
      formData.get(`model_scope_tags_snapshot_${sheet.id}`) ??
        formatTrainingTagList(sheet.scope_tags) ??
        ""
    ).trim();
    const modelAreaTagsSnapshot = String(
      formData.get(`model_area_tags_snapshot_${sheet.id}`) ??
        formatTrainingTagList(sheet.area_tags) ??
        ""
    ).trim();
    const modelSheetKindSnapshot = String(
      formData.get(`model_sheet_kind_snapshot_${sheet.id}`) ??
        sheet.sheet_kind ??
        ""
    ).trim();
    const normalizedModelMetadata = normalizeTrainingBlueprintMetadata({
      sheet_number: sheet.sheet_number,
      sheet_title: sheet.sheet_title,
      discipline: sheet.discipline,
      sheet_type: modelSheetTypeSnapshot,
      scope_tags: parseTrainingTagList(modelScopeTagsSnapshot),
      area_tags: parseTrainingTagList(modelAreaTagsSnapshot),
      sheet_kind: modelSheetKindSnapshot,
    });
    const correctionReason = String(
      formData.get(`correction_reason_${sheet.id}`) ?? ""
    ).trim() as CorrectionReason;
    const correctionNote = String(
      formData.get(`correction_note_${sheet.id}`) ?? ""
    ).trim();

    return {
      id: sheet.id,
      sheet_number: sheetNumber,
      sheet_title: sheetTitle,
      discipline: disciplineValue,
      page_number: pageNumber,
      sheet_type: normalizedReviewedMetadata.sheet_type,
      scope_tags: normalizedReviewedMetadata.scope_tags,
      area_tags: normalizedReviewedMetadata.area_tags,
      sheet_kind:
        (requestedSheetKind as SheetKind) ||
        inferTrainingSheetKind({
          sheetNumber,
          sheetTitle,
          discipline: disciplineValue,
        }),
      model_sheet_type_snapshot: normalizedModelMetadata.sheet_type,
      model_scope_tags_snapshot: normalizedModelMetadata.scope_tags,
      model_area_tags_snapshot: normalizedModelMetadata.area_tags,
      model_sheet_kind_snapshot: inferLegacyTrainingSheetKind({
        sheet_number: sheet.sheet_number,
        sheet_title: sheet.sheet_title,
        discipline: sheet.discipline,
        sheet_type: normalizedModelMetadata.sheet_type,
        scope_tags: normalizedModelMetadata.scope_tags,
        area_tags: normalizedModelMetadata.area_tags,
        sheet_kind: modelSheetKindSnapshot,
      }),
      correction_reason: correctionReason,
      correction_note: correctionNote || null,
    };
  });
}

async function updatePlanSheetDrafts(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  planSetId: string;
  setName: string;
  revisionLabel: string;
  setDate: string;
  notes: string;
  sheetUpdates: ReviewedSheetDraft[];
  reviewedBy: string;
}) {
  const { error: planSetUpdateError } = await args.supabase
    .from("plan_sets")
    .update({
      set_name: args.setName,
      revision_label: args.revisionLabel,
      set_date: args.setDate || null,
      notes: args.notes || null,
    })
    .eq("id", args.planSetId);

  if (planSetUpdateError) {
    throw new Error(planSetUpdateError.message);
  }

  const reviewedAt = new Date().toISOString();
  for (const update of args.sheetUpdates) {
    const { error: sheetUpdateError } = await args.supabase
      .from("plan_sheets")
      .update({
        sheet_number: update.sheet_number,
        sheet_title: update.sheet_title,
        discipline: update.discipline,
        page_number: update.page_number > 0 ? update.page_number : 1,
        sheet_type: update.sheet_type,
        sheet_kind: update.sheet_kind,
        scope_tags: update.scope_tags,
        area_tags: update.area_tags,
        metadata_source: "reviewer",
        metadata_review_status: "reviewed",
        reviewed_by: args.reviewedBy,
        reviewed_at: reviewedAt,
      })
      .eq("id", update.id);

    if (sheetUpdateError) {
      throw new Error(sheetUpdateError.message);
    }
  }
}

async function loadReviewActionContext(jobId: string, planSetId: string) {
  const profile = await requireSuperAdmin();
  const supabase = await createClient();

  const canAccessJob = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    jobId
  );

  if (!canAccessJob) {
    redirect("/admin/jobs");
  }

  const [{ data: planSet }, { data: sheets }] = await Promise.all([
    supabase
      .from("plan_sets")
      .select("*")
      .eq("id", planSetId)
      .eq("job_id", jobId)
      .single(),
    supabase
      .from("plan_sheets")
      .select(
        "id, sheet_number, sheet_title, discipline, page_number, extraction_confidence, sheet_type, sheet_kind, scope_tags, area_tags, metadata_source, metadata_confidence, identity_confidence_tier, identity_confidence_reasons, llm_routing_status, llm_routing_reason, metadata_review_status, reviewed_by, reviewed_at, extracted_text, number_source_text, number_source_kind, title_source_text, title_source_kind, preview_image_path, preview_storage_key"
      )
      .eq("plan_set_id", planSetId)
      .order("page_number", { ascending: true }),
  ]);

  if (!planSet) {
    redirect(`/admin/jobs/${jobId}/sheets`);
  }

  return {
    profile,
    supabase,
    planSet,
    sheets: (sheets ?? []) as ReviewSheetRow[],
  };
}

function getSuccessMessage(value: string | undefined) {
  if (value === "training_saved") {
    return "Training corpus saved and round-tripped for verification.";
  }

  if (value === "llm_enriched") {
    return "LLM metadata enrichment finished for candidate rows.";
  }

  if (value === "publish_started") {
    return "Publish started. You can leave this page open while assets generate.";
  }

  return "";
}

function getCorrectionReasonLabel(value: CorrectionReason) {
  switch (value) {
    case "":
      return "No correction reason";
    case "manual_review":
      return "Manual Review";
    case "sheet_number_fix":
      return "Sheet Number Fix";
    case "sheet_title_fix":
      return "Sheet Title Fix";
    case "discipline_fix":
      return "Discipline Fix";
    case "sheet_kind_fix":
      return "Sheet Kind Fix";
    case "multiple_metadata_fixes":
      return "Multiple Metadata Fixes";
    case "model_false_positive":
      return "Model False Positive";
    default:
      return "No correction reason";
  }
}

async function saveTrainingCorpusDraft(formData: FormData) {
  "use server";

  const jobId = String(formData.get("job_id") ?? "").trim();
  const planSetId = String(formData.get("plan_set_id") ?? "").trim();
  const setName = String(formData.get("set_name") ?? "").trim();
  const revisionLabel = String(formData.get("revision_label") ?? "").trim();
  const setDate = String(formData.get("set_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!jobId || !planSetId) {
    redirect("/admin/jobs");
  }

  if (!isTrainingCorpusEnabled()) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error: "Training corpus is disabled for this environment.",
      })
    );
  }

  const { profile, supabase, planSet, sheets } = await loadReviewActionContext(
    jobId,
    planSetId
  );
  const effectiveSetName = setName || planSet.set_name || "";
  const effectiveRevisionLabel = revisionLabel || planSet.revision_label || "";

  const reviewedSheets = parseReviewedSheetDrafts(formData, sheets);

  try {
    await updatePlanSheetDrafts({
      supabase,
      planSetId,
      setName: effectiveSetName,
      revisionLabel: effectiveRevisionLabel,
      setDate,
      notes,
      sheetUpdates: reviewedSheets,
      reviewedBy: profile.id,
    });

    await saveTrainingCorpusForPlanSetReview({
      supabase,
      jobId,
      planSet,
      modelSheets: sheets,
      reviewedSheets,
      reviewedBy: profile.id,
    });
  } catch (error) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error:
          error instanceof Error ? error.message : "Unable to save training corpus.",
      })
    );
  }

  revalidatePath(`/admin/jobs/${jobId}/sheets/import/${planSetId}`);
  redirect(
    buildImportReviewUrl(jobId, planSetId, {
      success: "training_saved",
    })
  );
}

async function runMetadataEnrichment(formData: FormData) {
  "use server";

  const jobId = String(formData.get("job_id") ?? "").trim();
  const planSetId = String(formData.get("plan_set_id") ?? "").trim();

  if (!jobId || !planSetId) {
    redirect("/admin/jobs");
  }

  redirect(
    buildImportReviewUrl(jobId, planSetId, {
      error: "LLM metadata enrichment is disabled in the PDF-only importer.",
    })
  );
}

async function publishPlanSet(formData: FormData) {
  "use server";

  const jobId = String(formData.get("job_id") ?? "").trim();
  const planSetId = String(formData.get("plan_set_id") ?? "").trim();
  const setName = String(formData.get("set_name") ?? "").trim();
  const revisionLabel = String(formData.get("revision_label") ?? "").trim();
  const setDate = String(formData.get("set_date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const makeCurrent = formData.get("make_current") === "1";

  if (!jobId || !planSetId) {
    redirect("/admin/jobs");
  }

  const trainingEnabled = isTrainingCorpusEnabled();
  const { profile, sheets } = await loadReviewActionContext(
    jobId,
    planSetId
  );

  if (!setName || !revisionLabel) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error: "Set name and revision label are required.",
      })
    );
  }

  const reviewedSheets = parseReviewedSheetDrafts(formData, sheets);
  const missingRequiredSheet = reviewedSheets.find(
    (sheet) => !sheet.sheet_number || !sheet.sheet_title || sheet.page_number < 1
  );

  if (missingRequiredSheet) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error: "Every sheet needs a sheet number, title, and valid page number.",
      })
    );
  }

  const duplicateSheetNumber = findDuplicateReviewSheetNumber(reviewedSheets);
  if (duplicateSheetNumber) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error: `Sheet number ${duplicateSheetNumber} appears more than once in this set.`,
      })
    );
  }

  const invalidMetadataMessage = findInvalidReviewedMetadata(reviewedSheets);
  if (invalidMetadataMessage) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error: invalidMetadataMessage,
      })
    );
  }

  try {
    await startPlanSheetPublishJob({
      actorId: profile.id,
      jobId,
      planSetId,
      setName,
      revisionLabel,
      setDate,
      notes,
      reviewedSheets,
      modelSheets: sheets,
      trainingEnabled,
      makeCurrent,
    });
  } catch (error) {
    redirect(
      buildImportReviewUrl(jobId, planSetId, {
        error:
          error instanceof Error ? error.message : "Unable to start publishing.",
      })
    );
  }

  revalidatePath(`/admin/jobs/${jobId}/sheets/import/${planSetId}`);
  redirect(
    buildImportReviewUrl(jobId, planSetId, {
      success: "publish_started",
    })
  );
}

export default async function PlanSetImportPage({
  params,
  searchParams,
}: PlanSetImportPageProps) {
  const profile = await requireSuperAdmin();
  const { id, planSetId } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const trainingEnabled = isTrainingCorpusEnabled();
  const llmEnabled = false;

  const canAccessJob = await adminCanAccessJob(
    supabase,
    profile.id,
    profile.role,
    id
  );

  if (!canAccessJob) {
    redirect("/admin/jobs");
  }

  const [{ data: job }, { data: planSet }, { data: sheets }, { data: existingCurrentSet }] =
    await Promise.all([
      supabase
        .from("jobs")
        .select("id, name, job_number")
        .eq("id", id)
        .single(),
      supabase
        .from("plan_sets")
        .select("*")
        .eq("id", planSetId)
        .eq("job_id", id)
        .single(),
      supabase
        .from("plan_sheets")
        .select(
          "id, sheet_number, sheet_title, discipline, page_number, extraction_confidence, sheet_type, sheet_kind, scope_tags, area_tags, metadata_source, metadata_confidence, identity_confidence_tier, identity_confidence_reasons, llm_routing_status, llm_routing_reason, metadata_review_status, reviewed_by, reviewed_at, extracted_text, number_source_text, number_source_kind, title_source_text, title_source_kind, preview_image_path, preview_storage_key"
        )
        .eq("plan_set_id", planSetId)
        .order("page_number", { ascending: true }),
      supabase
        .from("plan_sets")
        .select("id, set_name, revision_label")
        .eq("job_id", id)
        .eq("is_current", true)
        .neq("id", planSetId)
        .maybeSingle(),
    ]);

  if (!job || !planSet) {
    redirect(`/admin/jobs/${id}/sheets`);
  }

  const trainingVerification: TrainingVerificationMap = trainingEnabled
    ? await loadTrainingCorpusVerification({
        supabase,
        planSetId,
      })
    : new Map();
  const llmAssists: PlanSheetImportLlmAssistMap =
    trainingEnabled || llmEnabled
      ? await loadPlanSetImportLlmAssists(planSetId)
      : new Map();
  const priorTrainingPrefills: PriorTrainingPrefillMap = trainingEnabled
      ? await loadPriorTrainingPrefills({
        supabase,
        jobId: id,
        planSetId,
        currentSetName: planSet.set_name,
        currentRevisionLabel: planSet.revision_label,
        currentOriginalFileName: planSet.original_file_name,
        sheets: (sheets ?? []).map((sheet) => ({
          id: sheet.id,
          page_number: sheet.page_number,
          sheet_number: sheet.sheet_number,
          sheet_title: sheet.sheet_title,
          discipline: sheet.discipline,
        })),
      })
    : new Map();

  const jobDisplay = job.job_number ? `${job.job_number} - ${job.name}` : job.name;
  const errorMessage = query.error ?? "";
  const successMessage = getSuccessMessage(query.success);
  const publishInProgress = isPlanSheetPublishInProgress(planSet.import_metrics);
  const showPublishProgress =
    publishInProgress || query.success === "publish_started";
  const defaultMakeCurrent = true;
  const llmRoutingRows = (sheets ?? []).map((sheet) => {
    const savedFinalSelection = getSavedTrainingFinalSelection(
      trainingVerification.get(sheet.id) ?? null
    );
    return getSheetLlmRouting(
      sheet,
      llmAssists.get(sheet.id) ?? null,
      getSheetIdentityCalibrationSnapshot(savedFinalSelection)
    );
  });
  const trustedConfidenceCount = llmRoutingRows.filter(
    (entry) => entry.status === "trusted_skip"
  ).length;
  const llmCandidateConfidenceCount = llmRoutingRows.filter(
    (entry) => entry.status === "llm_candidate"
  ).length;
  const manualOnlyConfidenceCount = llmRoutingRows.filter((entry) =>
    ["manual_review", "missing_identity", "unknown", "llm_failed"].includes(
      entry.status
    )
  ).length;
  const reviewBandConfidenceCount =
    sheets?.filter(
      (sheet) =>
        typeof sheet.extraction_confidence === "number" &&
        sheet.extraction_confidence >= 0.45 &&
        sheet.extraction_confidence < 0.86
    ).length ?? 0;
  const weakConfidenceCount =
    sheets?.filter(
      (sheet) =>
        typeof sheet.extraction_confidence === "number" &&
        sheet.extraction_confidence < 0.45
    ).length ?? 0;
  const savedTrainingCount = trainingEnabled
    ? Array.from(trainingVerification.values()).length
    : 0;
  const priorPrefillCount = trainingEnabled
    ? Array.from(priorTrainingPrefills.values()).length
    : 0;
  const llmResolvedCount = Array.from(llmAssists.values()).filter(
    (entry) => entry.request_status === "success" && entry.resolved_metadata
  ).length;
  const llmDisagreementCount = Array.from(llmAssists.values()).filter(
    (entry) => entry.request_status === "success" && entry.agrees_with_heuristic === false
  ).length;
  const trainingSummary = trainingEnabled
    ? (sheets ?? []).reduce(
        (summary, sheet) => {
          const savedTraining = trainingVerification.get(sheet.id) ?? null;
          const priorPrefill =
            !savedTraining?.review ? priorTrainingPrefills.get(sheet.id) ?? null : null;
          const metadataContext = buildTrainingSheetMetadataContext({
            sheet,
            savedTraining,
            priorPrefill,
          });
          const suggestedCorrectionReason = suggestTrainingCorrectionReason({
            model: {
              sheet_number: metadataContext.modelSheetNumber,
              sheet_title: metadataContext.modelSheetTitle,
              discipline: metadataContext.modelDiscipline,
              sheet_type: metadataContext.modelSheetType,
              scope_tags: metadataContext.modelScopeTags,
              area_tags: metadataContext.modelAreaTags,
              sheet_kind: metadataContext.modelSheetKind,
            },
            reviewed: {
              sheet_number: metadataContext.reviewedSheetNumber,
              sheet_title: metadataContext.reviewedSheetTitle,
              discipline: metadataContext.reviewedDiscipline,
              sheet_type: metadataContext.reviewedSheetType,
              scope_tags: metadataContext.reviewedScopeTags,
              area_tags: metadataContext.reviewedAreaTags,
              sheet_kind: metadataContext.reviewedSheetKind,
            },
          });
          const changedFields = getTrainingChangedFields({
            model: {
              sheet_number: metadataContext.modelSheetNumber,
              sheet_title: metadataContext.modelSheetTitle,
              discipline: metadataContext.modelDiscipline,
              sheet_type: metadataContext.modelSheetType,
              scope_tags: metadataContext.modelScopeTags,
              area_tags: metadataContext.modelAreaTags,
              sheet_kind: metadataContext.modelSheetKind,
            },
            reviewed: {
              sheet_number: metadataContext.reviewedSheetNumber,
              sheet_title: metadataContext.reviewedSheetTitle,
              discipline: metadataContext.reviewedDiscipline,
              sheet_type: metadataContext.reviewedSheetType,
              scope_tags: metadataContext.reviewedScopeTags,
              area_tags: metadataContext.reviewedAreaTags,
              sheet_kind: metadataContext.reviewedSheetKind,
            },
          });
          const currentCorrectionReason = resolveTrainingCorrectionReason({
            value: savedTraining?.review.correction_reason,
            wasCorrected: changedFields.length > 0,
            suggestedReason: suggestedCorrectionReason,
          });
          const verificationStatus = getTrainingVerificationStatus({
            savedReview: savedTraining?.review
              ? {
                  sheet_number: savedTraining.review.sheet_number,
                  sheet_title: savedTraining.review.sheet_title,
                  discipline: savedTraining.review.discipline,
                  sheet_type: savedTraining.review.sheet_type,
                  scope_tags: savedTraining.review.scope_tags,
                  area_tags: savedTraining.review.area_tags,
                  sheet_kind: savedTraining.review.sheet_kind,
                  correction_reason: savedTraining.review.correction_reason,
                  correction_note: savedTraining.review.correction_note,
                  page_image_path: savedTraining.review.page_image_path,
                }
              : null,
            expected: {
              sheet_number: metadataContext.reviewedSheetNumber,
              sheet_title: metadataContext.reviewedSheetTitle,
              discipline: metadataContext.reviewedDiscipline,
              sheet_type: metadataContext.reviewedSheetType,
              scope_tags: metadataContext.reviewedScopeTags,
              area_tags: metadataContext.reviewedAreaTags,
              sheet_kind: metadataContext.reviewedSheetKind,
              correction_reason: currentCorrectionReason || null,
              correction_note: metadataContext.defaultCorrectionNote || null,
            },
            regionCount: savedTraining?.regions.length,
            candidateCount: savedTraining?.candidates.length,
          });

          if (changedFields.length > 0) {
            summary.changedPages += 1;
          }

          if (verificationStatus !== "Saved and verified") {
            summary.needsAttention += 1;
          }

          if (verificationStatus === "Missing artifact") {
            summary.missingArtifacts += 1;
          }

          return summary;
        },
        {
          changedPages: 0,
          needsAttention: 0,
          missingArtifacts: 0,
        }
      )
    : null;

  return (
    <div className="sheet-import-review-page space-y-6">
      <AdminPageHeader
        kicker="Sheet Import Review"
        title="Review And Publish"
        description={
          <>
            Confirm the extracted sheet metadata for{" "}
            <span className="font-medium">{jobDisplay}</span> and publish this revision set when ready.
          </>
        }
        meta={
          <Link href={`/admin/jobs/${job.id}/sheets`} className="admin-text-link">
            Back to Sheets
          </Link>
        }
      />

      {errorMessage ? (
        <div className="admin-status-note admin-status-note-error">
          {errorMessage}
        </div>
      ) : null}

      {successMessage ? (
        <div className="admin-status-note admin-status-note-success">
          {successMessage}
        </div>
      ) : null}

      <PublishPlanSetProgress
        jobId={job.id}
        planSetId={planSet.id}
        initialActive={showPublishProgress}
      />

      <form action={publishPlanSet} className="space-y-6">
        <input type="hidden" name="job_id" value={job.id} />
        <input type="hidden" name="plan_set_id" value={planSet.id} />

        <div className="admin-card p-6 sm:p-7">
          <h2 className="admin-title text-xl font-semibold">Set Metadata</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="admin-field-group">
              <label>
                Set Name
              </label>
              <input
                name="set_name"
                type="text"
                defaultValue={planSet.set_name}
                className="admin-field-input"
                required
              />
            </div>

            <div className="admin-field-group">
              <label>
                Revision Label
              </label>
              <input
                name="revision_label"
                type="text"
                defaultValue={planSet.revision_label}
                className="admin-field-input"
                required
              />
            </div>

            <div className="admin-field-group">
              <label>
                Set Date
              </label>
              <input
                name="set_date"
                type="date"
                defaultValue={planSet.set_date ?? ""}
                className="admin-field-input"
              />
            </div>

            <AdminSurface tone="quiet" padding="sm" className="text-sm text-slate-700">
              <div>Extraction: {planSet.extraction_status}</div>
              <div className="mt-1">Detected pages: {sheets?.length ?? 0}</div>
              <div className="mt-1">Auto-trusted pages: {trustedConfidenceCount}</div>
              <div className="mt-1">LLM candidate pages: {llmCandidateConfidenceCount}</div>
              <div className="mt-1">Manual/importer-fix pages: {manualOnlyConfidenceCount}</div>
              <div className="mt-1">Review-band pages: {reviewBandConfidenceCount}</div>
              <div className="mt-1">Weak evidence pages: {weakConfidenceCount}</div>
              {llmEnabled || llmAssists.size > 0 ? (
                <div className="mt-1">LLM resolved pages: {llmResolvedCount}</div>
              ) : null}
              {llmEnabled || llmAssists.size > 0 ? (
                <div className="mt-1">LLM disagreements: {llmDisagreementCount}</div>
              ) : null}
              {planSet.set_date ? (
                <div className="mt-1">Set date: {formatYmd(planSet.set_date)}</div>
              ) : null}
              {trainingEnabled ? (
                <div className="mt-1">Saved training records: {savedTrainingCount}</div>
              ) : null}
              {trainingEnabled ? (
                <div className="mt-1">Prior review prefills: {priorPrefillCount}</div>
              ) : null}
            </AdminSurface>

            <div className="admin-field-group md:col-span-2">
              <label>
                Notes
              </label>
              <textarea
                name="notes"
                rows={4}
                defaultValue={planSet.notes ?? ""}
                className="admin-field-input"
              />
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                name="make_current"
                value="1"
                defaultChecked={defaultMakeCurrent}
              />
              <span>
                Mark this set as the current set.
                {existingCurrentSet ? (
                  <span className="block text-xs text-slate-500">
                    The current set is {existingCurrentSet.set_name} ({existingCurrentSet.revision_label}). Leaving this checked will archive older published sets and make this revision the active set.
                  </span>
                ) : (
                  <span className="block text-xs text-slate-500">
                    No current set exists yet for this job.
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>

        {trainingEnabled ? (
          <div className="admin-card border border-[var(--admin-panel-border)] bg-[var(--admin-panel)]/75 p-6 sm:p-7">
            <h2 className="admin-title text-xl font-semibold">Temporary Training Corpus</h2>
            <p className="admin-copy mt-2">
              This sidecar saves reviewer-approved sheet truth and the extraction evidence used to get there. It is feature-flagged, admin-only, and meant to be removable once we have enough LLM training data.
            </p>
            <p className="admin-copy mt-2 text-sm">
              Saving here does not publish the set. It persists the current review state, then reloads the stored record so you can verify what actually landed.
            </p>
            {trainingSummary ? (
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-700">
                <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-blue-200">
                  Changed vs model: {trainingSummary.changedPages}
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-blue-200">
                  Needs attention: {trainingSummary.needsAttention}
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-blue-200">
                  Missing artifact: {trainingSummary.missingArtifacts}
                </span>
                <span className="rounded-full bg-white px-3 py-1.5 ring-1 ring-blue-200">
                  Prior prefills: {priorPrefillCount}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="admin-card p-6 sm:p-7">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="admin-title text-xl font-semibold">Sheet Review</h2>
              <p className="admin-copy mt-2">
                Review the detected sheet information and correct anything before publishing.
              </p>
            </div>
          </div>

          {!sheets || sheets.length === 0 ? (
            <p className="mt-5 text-red-600">
              No sheets were extracted from this plan set.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {sheets.map((sheet) => {
                const savedTraining = trainingVerification.get(sheet.id) ?? null;
                const llmAssist = llmAssists.get(sheet.id) ?? null;
                const priorPrefill =
                  !savedTraining?.review ? priorTrainingPrefills.get(sheet.id) ?? null : null;
                const metadataContext = buildTrainingSheetMetadataContext({
                  sheet,
                  savedTraining,
                  priorPrefill,
                });
                const changedFields = getTrainingChangedFields({
                  model: {
                    sheet_number: metadataContext.modelSheetNumber,
                    sheet_title: metadataContext.modelSheetTitle,
                    discipline: metadataContext.modelDiscipline,
                    sheet_type: metadataContext.modelSheetType,
                    scope_tags: metadataContext.modelScopeTags,
                    area_tags: metadataContext.modelAreaTags,
                    sheet_kind: metadataContext.modelSheetKind,
                  },
                  reviewed: {
                    sheet_number: metadataContext.reviewedSheetNumber,
                    sheet_title: metadataContext.reviewedSheetTitle,
                    discipline: metadataContext.reviewedDiscipline,
                    sheet_type: metadataContext.reviewedSheetType,
                    scope_tags: metadataContext.reviewedScopeTags,
                    area_tags: metadataContext.reviewedAreaTags,
                    sheet_kind: metadataContext.reviewedSheetKind,
                  },
                });
                const changedFieldLabels = changedFields.map(
                  formatTrainingChangedFieldLabel
                );
                const suggestedCorrectionReason = suggestTrainingCorrectionReason({
                  model: {
                    sheet_number: metadataContext.modelSheetNumber,
                    sheet_title: metadataContext.modelSheetTitle,
                    discipline: metadataContext.modelDiscipline,
                    sheet_type: metadataContext.modelSheetType,
                    scope_tags: metadataContext.modelScopeTags,
                    area_tags: metadataContext.modelAreaTags,
                    sheet_kind: metadataContext.modelSheetKind,
                  },
                  reviewed: {
                    sheet_number: metadataContext.reviewedSheetNumber,
                    sheet_title: metadataContext.reviewedSheetTitle,
                    discipline: metadataContext.reviewedDiscipline,
                    sheet_type: metadataContext.reviewedSheetType,
                    scope_tags: metadataContext.reviewedScopeTags,
                    area_tags: metadataContext.reviewedAreaTags,
                    sheet_kind: metadataContext.reviewedSheetKind,
                  },
                });
                const effectiveDefaultCorrectionReason =
                  resolveTrainingCorrectionReason({
                    value: savedTraining?.review.correction_reason,
                    wasCorrected: changedFields.length > 0,
                    suggestedReason: suggestedCorrectionReason,
                  });
                const verificationStatus = trainingEnabled
                  ? getTrainingVerificationStatus({
                      savedReview: savedTraining?.review
                        ? {
                            sheet_number: savedTraining.review.sheet_number,
                            sheet_title: savedTraining.review.sheet_title,
                            discipline: savedTraining.review.discipline,
                            sheet_type: savedTraining.review.sheet_type,
                            scope_tags: savedTraining.review.scope_tags,
                            area_tags: savedTraining.review.area_tags,
                            sheet_kind: savedTraining.review.sheet_kind,
                            correction_reason:
                              savedTraining.review.correction_reason,
                            correction_note: savedTraining.review.correction_note,
                            page_image_path: savedTraining.review.page_image_path,
                          }
                        : null,
                      expected: {
                        sheet_number: metadataContext.reviewedSheetNumber,
                        sheet_title: metadataContext.reviewedSheetTitle,
                        discipline: metadataContext.reviewedDiscipline,
                        sheet_type: metadataContext.reviewedSheetType,
                        scope_tags: metadataContext.reviewedScopeTags,
                        area_tags: metadataContext.reviewedAreaTags,
                        sheet_kind: metadataContext.reviewedSheetKind,
                        correction_reason:
                          effectiveDefaultCorrectionReason || null,
                        correction_note:
                          metadataContext.defaultCorrectionNote || null,
                      },
                      regionCount: savedTraining?.regions.length,
                      candidateCount: savedTraining?.candidates.length,
                    })
                  : null;
                const suggestedCorrectionReasonLabel = getCorrectionReasonLabel(
                  suggestedCorrectionReason
                );
                const llmResolvedMetadata = llmAssist?.resolved_metadata ?? null;
                const llmDisagreementFieldLabels = (
                  llmAssist?.disagreement_fields ?? []
                ).map((field) =>
                  formatTrainingChangedFieldLabel(
                    field as "sheet_number" | "sheet_title" | "discipline" | "sheet_kind"
                  )
                );
                const savedHeuristicOutput =
                  savedTraining?.pipeline?.heuristic_output &&
                  typeof savedTraining.pipeline.heuristic_output === "object"
                    ? (savedTraining.pipeline.heuristic_output as Record<string, unknown>)
                    : null;
                const savedFinalSelection =
                  savedHeuristicOutput?.finalSelection &&
                  typeof savedHeuristicOutput.finalSelection === "object"
                    ? (savedHeuristicOutput.finalSelection as Record<string, unknown>)
                    : null;
                const savedOcrCandidateSnapshot =
                  savedTraining?.pipeline?.ocr_candidate_snapshot &&
                  typeof savedTraining.pipeline.ocr_candidate_snapshot === "object"
                    ? (savedTraining.pipeline.ocr_candidate_snapshot as Record<
                        string,
                        unknown
                      >)
                    : null;
                const savedSelectedOcrCandidate =
                  savedOcrCandidateSnapshot?.selectedCandidate &&
                  typeof savedOcrCandidateSnapshot.selectedCandidate === "object"
                    ? (savedOcrCandidateSnapshot.selectedCandidate as Record<
                        string,
                        unknown
                      >)
                    : null;
                const savedLlmResolution =
                  savedTraining?.pipeline?.llm_resolution &&
                  typeof savedTraining.pipeline.llm_resolution === "object"
                    ? (savedTraining.pipeline.llm_resolution as Record<string, unknown>)
                    : null;
                const sortedCandidates = [...(savedTraining?.candidates ?? [])].sort(
                  (left, right) => {
                    if (left.is_model_winner !== right.is_model_winner) {
                      return left.is_model_winner ? -1 : 1;
                    }

                    return (right.candidate_score ?? Number.NEGATIVE_INFINITY) -
                      (left.candidate_score ?? Number.NEGATIVE_INFINITY);
                  }
                );
                const confidenceTier = getSheetConfidenceTier(sheet.extraction_confidence);
                const llmRouting = getSheetLlmRouting(
                  sheet,
                  llmAssist,
                  getSheetIdentityCalibrationSnapshot(savedFinalSelection)
                );
                const needsTrainingAttention =
                  Boolean(
                    confidenceTier === "repairable" ||
                      confidenceTier === "weak" ||
                      llmAssist?.request_status === "error" ||
                      llmAssist?.agrees_with_heuristic === false ||
                      changedFields.length > 0 ||
                      !savedTraining?.review ||
                      verificationStatus !== "Saved and verified"
                  );

                return (
                  <div
                    key={sheet.id}
                    className={`rounded-xl border p-4 ${getSheetConfidenceCardClass(
                      sheet.extraction_confidence
                    )}`}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium uppercase tracking-[0.14em]">
                      <span className="text-slate-600">Page {sheet.page_number}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        {priorPrefill ? (
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-800">
                            Prefilled from prior review
                          </span>
                        ) : null}
                        {llmAssist?.request_status === "success" &&
                        llmAssist.agrees_with_heuristic === true ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
                            LLM agrees
                          </span>
                        ) : null}
                        {llmAssist?.request_status === "success" &&
                        llmAssist.agrees_with_heuristic === false ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
                            LLM differs
                          </span>
                        ) : null}
                        {llmAssist?.request_status === "error" ? (
                          <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-800">
                            LLM failed
                          </span>
                        ) : null}
                        {trainingEnabled && verificationStatus ? (
                          <TrainingRecordStatusBadge
                            sheetId={sheet.id}
                            initialStatus={verificationStatus}
                            savedSnapshot={
                              savedTraining?.review
                                ? {
                                    sheet_number: savedTraining.review.sheet_number,
                                    sheet_title: savedTraining.review.sheet_title,
                                    discipline: savedTraining.review.discipline,
                                    sheet_kind: savedTraining.review.sheet_kind,
                                    correction_reason:
                                      (savedTraining.review.correction_reason as CorrectionReason | null) ??
                                      "",
                                    correction_note:
                                      savedTraining.review.correction_note,
                                  }
                                : null
                            }
                          />
                        ) : null}
                        <span
                          className={`rounded-full px-2.5 py-1 ${getSheetLlmRoutingBadgeClass(
                            llmRouting.status
                          )}`}
                        >
                          {llmRouting.label}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-1 ${getSheetConfidenceBadgeClass(
                            sheet.extraction_confidence
                          )}`}
                        >
                          Confidence{" "}
                          {typeof sheet.extraction_confidence === "number"
                            ? `${Math.round(sheet.extraction_confidence * 100)}%`
                            : "Unknown"}
                        </span>
                      </div>
                    </div>

                    <p
                      className={`mb-3 text-sm ${getSheetLlmRoutingMessageClass(
                        llmRouting.status
                      )}`}
                    >
                      {llmRouting.description}
                    </p>

                    {typeof sheet.extraction_confidence === "number" &&
                    sheet.extraction_confidence < 0.86 &&
                    (sheet.number_source_text || sheet.title_source_text) ? (
                      <div className="mb-3 grid gap-2 rounded-lg border border-amber-200 bg-white/80 p-3 text-xs text-slate-700 md:grid-cols-2">
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Number Source
                          </div>
                          <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                            {sheet.number_source_kind === "ocr" ? "OCR" : "PDF Text"}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-slate-900">
                            {sheet.number_source_text || "Unknown"}
                          </div>
                        </div>
                        <div>
                          <div className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                            Title Source
                          </div>
                          <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                            {sheet.title_source_kind === "ocr" ? "OCR" : "PDF Text"}
                          </div>
                          <div className="mt-1 whitespace-pre-wrap break-words text-slate-900">
                            {sheet.title_source_text || "Unknown"}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {llmAssist ? (
                      <div className="mb-3 rounded-lg border border-slate-200 bg-white/90 p-3 text-xs text-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                            LLM Assist
                          </div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold uppercase tracking-[0.08em] text-slate-700">
                            {getLlmAssistStatusLabel(llmAssist.request_status)}
                          </span>
                        </div>
                        <div className="mt-2 grid gap-3 md:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 p-2">
                            <div className="font-medium text-slate-900">Heuristic</div>
                            <div className="mt-1">Number: {llmAssist.heuristic_snapshot.sheet_number || "Blank"}</div>
                            <div className="mt-1">Title: {llmAssist.heuristic_snapshot.sheet_title || "Blank"}</div>
                            <div className="mt-1">Discipline: {llmAssist.heuristic_snapshot.discipline || "Blank"}</div>
                            <div className="mt-1">Kind: {llmAssist.heuristic_snapshot.sheet_kind || "Blank"}</div>
                            <div className="mt-1">Confidence: {typeof llmAssist.heuristic_snapshot.confidence === "number" ? `${Math.round(llmAssist.heuristic_snapshot.confidence * 100)}%` : "Unknown"}</div>
                          </div>
                          <div className="rounded-lg border border-slate-200 p-2">
                            <div className="font-medium text-slate-900">LLM</div>
                            <div className="mt-1">Number: {llmResolvedMetadata?.sheet_number || "Blank"}</div>
                            <div className="mt-1">Title: {llmResolvedMetadata?.sheet_title || "Blank"}</div>
                            <div className="mt-1">Discipline: {llmResolvedMetadata?.discipline || "Blank"}</div>
                            <div className="mt-1">Kind: {llmResolvedMetadata?.sheet_kind || "Blank"}</div>
                            <div className="mt-1">Confidence: {typeof llmResolvedMetadata?.confidence === "number" ? `${Math.round(llmResolvedMetadata.confidence * 100)}%` : "Unknown"}</div>
                          </div>
                        </div>
                        {llmAssist.agrees_with_heuristic === false ? (
                          <div className="mt-2 text-amber-900">
                            Differs on: {llmDisagreementFieldLabels.join(", ") || "Metadata"}
                          </div>
                        ) : null}
                        {llmAssist.agrees_with_heuristic === true ? (
                          <div className="mt-2 text-emerald-800">
                            Heuristic and LLM agree on the current metadata.
                          </div>
                        ) : null}
                        {llmAssist.error_message ? (
                          <div className="mt-2 text-rose-700">
                            {llmAssist.error_message}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_minmax(0,1fr)_120px]">
                      <div>
                        <label className="block text-sm font-medium text-slate-900">
                          Sheet Number
                        </label>
                        <input
                          name={`sheet_number_${sheet.id}`}
                          type="text"
                          defaultValue={metadataContext.reviewedSheetNumber}
                          placeholder="A1.01"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-900">
                          Sheet Title
                        </label>
                        <input
                          name={`sheet_title_${sheet.id}`}
                          type="text"
                          defaultValue={metadataContext.reviewedSheetTitle}
                          placeholder="Roof Plan"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                          required
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-900">
                          Discipline
                        </label>
                        <input
                          name={`discipline_${sheet.id}`}
                          type="text"
                          defaultValue={metadataContext.reviewedDiscipline ?? ""}
                          placeholder="Architectural"
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-900">
                          Page
                        </label>
                        <input
                          name={`page_number_${sheet.id}`}
                          type="number"
                          min="1"
                          step="1"
                          defaultValue={sheet.page_number}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                          required
                        />
                      </div>
                    </div>

                    {!trainingEnabled ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Sheet Type
                            </label>
                            <select
                              name={`sheet_type_${sheet.id}`}
                              defaultValue={metadataContext.reviewedSheetType}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            >
                              {TRAINING_SHEET_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Sheet Kind
                            </label>
                            <select
                              name={`sheet_kind_${sheet.id}`}
                              defaultValue={metadataContext.reviewedSheetKind}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            >
                              {TRAINING_SHEET_KIND_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Scope Tags
                            </label>
                            <input
                              name={`scope_tags_${sheet.id}`}
                              type="text"
                              defaultValue={formatTrainingTagList(
                                metadataContext.reviewedScopeTags
                              )}
                              placeholder="existing, removal, construction"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Area Tags
                            </label>
                            <input
                              name={`area_tags_${sheet.id}`}
                              type="text"
                              defaultValue={formatTrainingTagList(
                                metadataContext.reviewedAreaTags
                              )}
                              placeholder="building_2, first_floor, restroom"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            />
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {trainingEnabled ? (
                      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                        <input
                          type="hidden"
                          name={`model_sheet_type_snapshot_${sheet.id}`}
                          defaultValue={metadataContext.modelSheetType}
                        />
                        <input
                          type="hidden"
                          name={`model_scope_tags_snapshot_${sheet.id}`}
                          defaultValue={formatTrainingTagList(
                            metadataContext.modelScopeTags
                          )}
                        />
                        <input
                          type="hidden"
                          name={`model_area_tags_snapshot_${sheet.id}`}
                          defaultValue={formatTrainingTagList(
                            metadataContext.modelAreaTags
                          )}
                        />
                        <input
                          type="hidden"
                          name={`model_sheet_kind_snapshot_${sheet.id}`}
                          defaultValue={metadataContext.modelSheetKind}
                        />
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Sheet Type
                            </label>
                            <select
                              name={`sheet_type_${sheet.id}`}
                              defaultValue={metadataContext.reviewedSheetType}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            >
                              {TRAINING_SHEET_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Sheet Kind
                            </label>
                            <select
                              name={`sheet_kind_${sheet.id}`}
                              defaultValue={metadataContext.reviewedSheetKind}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            >
                              {TRAINING_SHEET_KIND_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Scope Tags
                            </label>
                            <input
                              name={`scope_tags_${sheet.id}`}
                              type="text"
                              defaultValue={formatTrainingTagList(
                                metadataContext.reviewedScopeTags
                              )}
                              placeholder="existing, removal, construction"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                              Comma-separated tags.
                            </p>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Area Tags
                            </label>
                            <input
                              name={`area_tags_${sheet.id}`}
                              type="text"
                              defaultValue={formatTrainingTagList(
                                metadataContext.reviewedAreaTags
                              )}
                              placeholder="building_2, first_floor, restroom"
                              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                            />
                            <p className="mt-1 text-xs text-slate-500">
                              Comma-separated tags.
                            </p>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 lg:col-span-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Suggested Metadata
                            </div>
                            <div className="mt-2 space-y-1">
                              <div>
                                <span className="font-medium text-slate-900">Sheet Type:</span>{" "}
                                {getTrainingSheetTypeLabel(metadataContext.reviewedSheetType)}
                              </div>
                              <div>
                                <span className="font-medium text-slate-900">Scope Tags:</span>{" "}
                                {formatTrainingDisplayTags(metadataContext.reviewedScopeTags)}
                              </div>
                              <div>
                                <span className="font-medium text-slate-900">Area Tags:</span>{" "}
                                {formatTrainingDisplayTags(metadataContext.reviewedAreaTags)}
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              These defaults are inferred from the current number, title, and discipline, but you can edit them directly for corpus quality.
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)]">
                          <div>
                            <label className="block text-sm font-medium text-slate-900">
                              Correction Reason
                            </label>
                            <input
                              type="hidden"
                              name={`correction_reason_${sheet.id}`}
                              defaultValue={effectiveDefaultCorrectionReason}
                            />
                            <div className="mt-1 rounded-lg border border-gray-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                              <div
                                id={`correction_reason_display_${sheet.id}`}
                                className="font-medium text-slate-900"
                              >
                                {getCorrectionReasonLabel(
                                  effectiveDefaultCorrectionReason
                                )}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                Auto-derived from the current changed fields.
                              </div>
                            </div>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Review Summary
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {changedFieldLabels.length ? (
                                changedFieldLabels.map((label) => (
                                  <span
                                    key={label}
                                    className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900"
                                  >
                                    Changed {label}
                                  </span>
                                ))
                              ) : (
                                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900">
                                  Matches model
                                </span>
                              )}
                              {suggestedCorrectionReason ? (
                                <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-900">
                                  Suggested: {suggestedCorrectionReasonLabel}
                                </span>
                              ) : null}
                              {savedTraining?.candidates.length === 0 ? (
                                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-900">
                                  Evidence needs backfill
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              Sheet kind stays suggested until you change it, and correction reason is derived automatically from the current changed fields.
                            </p>
                          </div>
                        </div>

                        <details
                          className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
                          open={needsTrainingAttention}
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                            <div>
                              <h3 className="font-semibold text-slate-900">
                                Training Record
                              </h3>
                              <p className="mt-1 text-xs text-slate-500">
                                Round-tripped corpus record for this page. This stays sidecar-only and should be removable later.
                              </p>
                            </div>
                            {verificationStatus ? (
                              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                                {verificationStatus}
                              </span>
                            ) : null}
                          </summary>

                          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Original Model
                              </div>
                              <div className="mt-2 space-y-1">
                                <div><span className="font-medium text-slate-900">Number:</span> {metadataContext.modelSheetNumber || "Blank"}</div>
                                <div><span className="font-medium text-slate-900">Title:</span> {metadataContext.modelSheetTitle || "Blank"}</div>
                                <div><span className="font-medium text-slate-900">Discipline:</span> {metadataContext.modelDiscipline || "Blank"}</div>
                                <div><span className="font-medium text-slate-900">Sheet Type:</span> {getTrainingSheetTypeLabel(metadataContext.modelSheetType)}</div>
                                <div><span className="font-medium text-slate-900">Scope Tags:</span> {formatTrainingDisplayTags(metadataContext.modelScopeTags)}</div>
                                <div><span className="font-medium text-slate-900">Area Tags:</span> {formatTrainingDisplayTags(metadataContext.modelAreaTags)}</div>
                                <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">Legacy Kind:</span> {metadataContext.modelSheetKind}</div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Prior Reviewed Match
                              </div>
                              {priorPrefill?.review ? (
                                <div className="mt-2 space-y-1">
                                  <div><span className="font-medium text-slate-900">Number:</span> {priorPrefill.review.sheet_number}</div>
                                  <div><span className="font-medium text-slate-900">Title:</span> {priorPrefill.review.sheet_title}</div>
                                  <div><span className="font-medium text-slate-900">Discipline:</span> {priorPrefill.review.discipline || "Blank"}</div>
                                  <div><span className="font-medium text-slate-900">Sheet Type:</span> {getTrainingSheetTypeLabel(priorPrefill.review.sheet_type)}</div>
                                  <div><span className="font-medium text-slate-900">Scope Tags:</span> {formatTrainingDisplayTags(priorPrefill.review.scope_tags)}</div>
                                  <div><span className="font-medium text-slate-900">Area Tags:</span> {formatTrainingDisplayTags(priorPrefill.review.area_tags)}</div>
                                  <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">Legacy Kind:</span> {priorPrefill.review.sheet_kind}</div>
                                  <div><span className="font-medium text-slate-900">Match Basis:</span> Page number in likely same reviewed set</div>
                                  <div><span className="font-medium text-slate-900">Source Set:</span> {priorPrefill.source_plan_set_id}</div>
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  No prior reviewed match was found for this page.
                                </p>
                              )}
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Saved Corpus
                              </div>
                              {savedTraining?.review ? (
                                <div className="mt-2 space-y-1">
                                  <div><span className="font-medium text-slate-900">Number:</span> {savedTraining.review.sheet_number}</div>
                                  <div><span className="font-medium text-slate-900">Title:</span> {savedTraining.review.sheet_title}</div>
                                  <div><span className="font-medium text-slate-900">Discipline:</span> {savedTraining.review.discipline || "Blank"}</div>
                                  <div><span className="font-medium text-slate-900">Sheet Type:</span> {getTrainingSheetTypeLabel(savedTraining.review.sheet_type)}</div>
                                  <div><span className="font-medium text-slate-900">Scope Tags:</span> {formatTrainingDisplayTags(savedTraining.review.scope_tags)}</div>
                                  <div><span className="font-medium text-slate-900">Area Tags:</span> {formatTrainingDisplayTags(savedTraining.review.area_tags)}</div>
                                  <div><span className="font-medium text-slate-900">Model Type Snapshot:</span> {getTrainingSheetTypeLabel(savedTraining.review.model_sheet_type)}</div>
                                  <div><span className="font-medium text-slate-900">Model Scope Tags:</span> {formatTrainingDisplayTags(savedTraining.review.model_scope_tags)}</div>
                                  <div><span className="font-medium text-slate-900">Model Area Tags:</span> {formatTrainingDisplayTags(savedTraining.review.model_area_tags)}</div>
                                  <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">Legacy Kind:</span> {savedTraining.review.sheet_kind}</div>
                                  <div className="text-xs text-slate-500"><span className="font-medium text-slate-700">Model Legacy Kind Snapshot:</span> {savedTraining.review.model_sheet_kind || "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Corrected:</span> {savedTraining.review.was_corrected ? "Yes" : "No"}</div>
                                  <div><span className="font-medium text-slate-900">Reason:</span> {savedTraining.review.correction_reason || "None"}</div>
                                  <div><span className="font-medium text-slate-900">Note:</span> {savedTraining.review.correction_note || "None"}</div>
                                  <div className="break-all"><span className="font-medium text-slate-900">Page Image Ref:</span> {savedTraining.review.page_image_path || "Missing"}</div>
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  No training record has been saved for this page yet.
                                </p>
                              )}
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                              <label className="block text-sm font-medium text-slate-900">
                                Correction Note
                              </label>
                              <textarea
                                name={`correction_note_${sheet.id}`}
                                rows={3}
                                defaultValue={metadataContext.defaultCorrectionNote}
                                placeholder="Optional note about why this page needed review."
                                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
                              />
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Saved Raw Evidence
                              </div>
                              {savedTraining?.evidence ? (
                                <div className="mt-2 space-y-2 text-xs text-slate-700">
                                  <div><span className="font-medium text-slate-900">Extracted Text:</span> {savedTraining.evidence.extracted_text || "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Number Source:</span> {savedTraining.evidence.number_source_kind || "Unknown"} · {savedTraining.evidence.number_source_text || "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Title Source:</span> {savedTraining.evidence.title_source_kind || "Unknown"} · {savedTraining.evidence.title_source_text || "Missing"}</div>
                                  <div className="break-all"><span className="font-medium text-slate-900">Preview Ref:</span> {savedTraining.evidence.preview_image_path || "Missing"}</div>
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  No raw evidence has been stored for this page yet.
                                </p>
                              )}
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Saved Heuristic Trace
                              </div>
                              {savedTraining?.pipeline ? (
                                <div className="mt-2 space-y-2 text-xs text-slate-700">
                                  <div><span className="font-medium text-slate-900">Debug Session:</span> {savedTraining.pipeline.debug_session_id || "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Selection Decision:</span> {(savedHeuristicOutput?.selectionDecision as string | undefined) || "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Reject Reason:</span> {(savedHeuristicOutput?.rejectReason as string | undefined) || "None"}</div>
                                  <div><span className="font-medium text-slate-900">Final Selection:</span> {savedFinalSelection ? `${String(savedFinalSelection.sheetNumber ?? "Blank")} · ${String(savedFinalSelection.sheetTitle ?? "Blank")}` : "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Selected OCR Candidate:</span> {savedSelectedOcrCandidate ? `${String(savedSelectedOcrCandidate.sheetNumber ?? "Blank")} · ${String(savedSelectedOcrCandidate.sheetTitle ?? "Blank")}` : "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">Replay Snapshot:</span> {savedTraining.pipeline.replay_page_input ? "Saved" : "Missing"} / OCR {savedTraining.pipeline.replay_ocr_result ? "Saved" : "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">LLM Status:</span> {getLlmAssistStatusLabel(savedTraining.pipeline.llm_request_status)}</div>
                                  <div><span className="font-medium text-slate-900">LLM Request Payload:</span> {savedTraining.pipeline.llm_request_payload ? "Saved" : "Missing"}</div>
                                  <div><span className="font-medium text-slate-900">LLM Output:</span> {savedTraining.pipeline.llm_output ? "Saved" : "Not present"}</div>
                                  <div><span className="font-medium text-slate-900">LLM Resolution:</span> {savedLlmResolution ? `${String(savedLlmResolution.sheet_number ?? "Blank")} Â· ${String(savedLlmResolution.sheet_title ?? "Blank")} Â· ${String(savedLlmResolution.sheet_kind ?? "Blank")}` : "Missing"}</div>
                                  {savedTraining.pipeline.llm_request_error ? (
                                    <div><span className="font-medium text-slate-900">LLM Error:</span> {savedTraining.pipeline.llm_request_error}</div>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">
                                  No heuristic trace has been saved for this page yet.
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Saved Regions
                              </div>
                              {savedTraining?.regions.length ? (
                                <div className="mt-2 space-y-2 text-xs">
                                  {savedTraining.regions.map((region) => (
                                    <div key={region.id} className="rounded-lg border border-slate-200 p-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="font-semibold text-slate-900">
                                          {region.role === "number" ? "Number" : "Title"} region
                                        </div>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-700">
                                          {region.region_type}
                                        </span>
                                      </div>
                                      <div className="mt-1 text-slate-600">Source: {region.source_kind || "Unknown"}</div>
                                      <div className="mt-1 text-slate-600">
                                        BBox: {region.x !== null && region.y !== null && region.width !== null && region.height !== null
                                          ? `${region.x.toFixed(3)}, ${region.y.toFixed(3)}, ${region.width.toFixed(3)}, ${region.height.toFixed(3)}`
                                          : "Missing"}
                                      </div>
                                      <div className="mt-1 break-all text-slate-600">Crop Ref: {region.crop_image_path || "Missing"}</div>
                                      <div className="mt-1 whitespace-pre-wrap break-words text-slate-900">
                                        {region.normalized_text || region.raw_text || "No saved text"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">No saved regions yet.</p>
                              )}
                            </div>

                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Saved Candidates
                              </div>
                              {sortedCandidates.length ? (
                                <div className="mt-2 space-y-2 text-xs">
                                  {sortedCandidates.map((candidate) => (
                                    <div key={candidate.id} className="rounded-lg border border-slate-200 p-2">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="font-semibold text-slate-900">
                                          {candidate.role === "number" ? "Number" : "Title"} · {candidate.candidate_kind}
                                        </div>
                                        {candidate.is_model_winner ? (
                                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-800">
                                            Model winner
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 text-slate-600">
                                        Score: {typeof candidate.candidate_score === "number" ? candidate.candidate_score : "Unknown"}
                                      </div>
                                      <div className="mt-1 whitespace-pre-wrap break-words text-slate-900">
                                        {candidate.normalized_candidate_text}
                                      </div>
                                      {normalizeWhitespace(candidate.candidate_text) !== normalizeWhitespace(candidate.normalized_candidate_text) ? (
                                        <div className="mt-1 whitespace-pre-wrap break-words text-slate-500">
                                          Raw: {candidate.candidate_text}
                                        </div>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-2 text-sm text-slate-500">No saved candidates yet.</p>
                              )}
                            </div>
                          </div>
                        </details>

                        <TrainingReviewAutofill
                          sheetId={sheet.id}
                          modelSheetNumber={metadataContext.modelSheetNumber}
                          modelSheetTitle={metadataContext.modelSheetTitle}
                          modelDiscipline={metadataContext.modelDiscipline}
                          modelSheetType={metadataContext.modelSheetType}
                          modelScopeTags={metadataContext.modelScopeTags}
                          modelAreaTags={metadataContext.modelAreaTags}
                          modelSheetKind={metadataContext.modelSheetKind}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {trainingEnabled ? (
            <button
              type="submit"
              formAction={saveTrainingCorpusDraft}
              formNoValidate
              disabled={publishInProgress}
              className="admin-action-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Training Corpus
            </button>
          ) : null}
          <button
            type="submit"
            formAction={runMetadataEnrichment}
            formNoValidate
            disabled={
              publishInProgress || !llmEnabled || llmCandidateConfidenceCount === 0
            }
            className="admin-action-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            Enrich LLM Candidates
          </button>
          <PublishPlanSetButton
            action={publishPlanSet}
            disabled={publishInProgress}
          />
          <Link
            href={`/admin/jobs/${job.id}/sheets`}
            className="admin-action-secondary"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
