import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import {
  extractPlanSheetsFromPdf,
  type ExtractedPlanSheet,
} from "@/lib/planSheetImport";
import {
  buildPlanSheetImportSelection,
  sanitizePlanSheetPreflightPages,
  type PlanSheetImportScopeKind,
  type PlanSheetPreflightPage,
} from "@/lib/planSheetImportScope";
import {
  downloadPlanSetFile,
  getPlanSetFilePath,
  getPlanSetStorageMetadata,
} from "@/lib/planSheetStorage";
import { logAuditEvent } from "@/lib/auditLog";

const PLAN_SHEET_INSERT_BATCH_SIZE = 25;
const PLAN_SHEET_IMPORT_PROGRESS_PAGE_INTERVAL = Math.max(
  1,
  Number.parseInt(process.env.PLAN_SHEET_IMPORT_PROGRESS_PAGE_INTERVAL ?? "3", 10) || 3
);
const PLAN_SHEET_IMPORT_PROGRESS_MIN_INTERVAL_MS = Math.max(
  250,
  Number.parseInt(
    process.env.PLAN_SHEET_IMPORT_PROGRESS_MIN_INTERVAL_MS ?? "1500",
    10
  ) || 1500
);
const PLAN_SHEET_IMPORT_CAPTURE_REPLAY =
  process.env.PLAN_SHEET_IMPORT_CAPTURE_REPLAY === "1" ||
  process.env.PLAN_SHEET_IMPORT_DEBUG_ARTIFACTS === "1";

type ImportProgressMetrics = Record<string, Json>;
type PlanSheetImportDbClient = Pick<ReturnType<typeof createAdminClient>, "from">;

export type StartPlanSheetImportJobInput = {
  supabase?: PlanSheetImportDbClient;
  actorId: string;
  jobId: string;
  setName: string;
  revisionLabel: string;
  setDate: string;
  notes: string;
  uploadedPlanSetId: string;
  uploadedPlanFileName: string;
  sourcePageCount: number | null;
  pageSelectionText: string;
  selectedDisciplines: string[];
  includeUnknownDisciplines: boolean;
  preflightPages: PlanSheetPreflightPage[];
};

function createPlanSheetImportDbClient(fallback?: PlanSheetImportDbClient) {
  try {
    return createAdminClient();
  } catch (error) {
    if (fallback) {
      console.warn(
        "[plan-sheet-import] service-role client unavailable; using request client",
        error
      );
      return fallback;
    }

    throw error;
  }
}

export type StartPlanSheetImportJobResult = {
  planSetId: string;
  selectedPageCount: number | null;
  sourcePageCount: number | null;
  importScopeKind: PlanSheetImportScopeKind;
};

function chunkArray<T>(items: T[], size: number) {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function createImportProgressMetrics(args: {
  sourcePageCount: number | null;
  importScopeKind: string;
  selectedPageNumbers: number[] | null;
  selectedDisciplines: string[];
}): ImportProgressMetrics {
  const now = new Date().toISOString();

  return {
    stage: "queued",
    message: "Queued for import.",
    import_started_at: now,
    progress_updated_at: now,
    source_page_count: args.sourcePageCount,
    requested_scope_kind: args.importScopeKind,
    requested_page_count: args.selectedPageNumbers?.length ?? null,
    requested_disciplines: args.selectedDisciplines,
    selected_page_count: args.selectedPageNumbers?.length ?? null,
    selected_page_numbers: args.selectedPageNumbers ?? null,
    extracted_page_count: 0,
    saved_sheet_count: 0,
  };
}

export function getPlanSheetImportErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/fetch failed|failed to fetch|networkerror|load failed/i.test(message)) {
    return "A storage or database network request failed while importing. Check the Supabase/local storage connection and try the import again.";
  }

  return error instanceof Error ? error.message : "Plan set import failed.";
}

function getImportedSheetLlmRoutingStatus(sheet: ExtractedPlanSheet) {
  switch (sheet.identityConfidenceTier) {
    case "trusted":
      return {
        status: "skip_trusted",
        reason: "trusted_importer_identity",
      };
    case "needs_review":
      return {
        status: "manual_required",
        reason: sheet.llmRecommended
          ? "pdf_only_llm_recommendation_ignored"
          : "pdf_only_review_required",
      };
    case "insufficient_evidence":
      return {
        status: "no_llm",
        reason: "insufficient_identity_evidence",
      };
    default:
      return {
        status: "manual_required",
        reason: "unknown_identity_confidence",
      };
  }
}

function getPdfOnlyDefaultBlueprintMetadata() {
  return {
    sheet_type: "other",
    sheet_kind: "other",
    scope_tags: [] as string[],
    area_tags: [] as string[],
  };
}

async function runPlanSheetImportJob(args: {
  actorId: string;
  jobId: string;
  planSetId: string;
  setName: string;
  revisionLabel: string;
  originalFileName: string;
  originalFilePath: string;
  sourcePageCount: number | null;
  selectedPageNumbers: number[] | null;
  targetPageNumbers: number[] | null;
  importScopeKind: PlanSheetImportScopeKind;
  importMetrics: ImportProgressMetrics;
  storageMetadata: ReturnType<typeof getPlanSetStorageMetadata>;
  supabase?: PlanSheetImportDbClient;
}) {
  const supabase = createPlanSheetImportDbClient(args.supabase);
  let importMetrics = args.importMetrics;

  const updateImportProgress = async (
    patch: ImportProgressMetrics,
    extractionStatus?: string
  ) => {
    importMetrics = {
      ...importMetrics,
      ...patch,
      progress_updated_at: new Date().toISOString(),
    };

    const updatePayload = {
      import_metrics: importMetrics,
    };
    if (extractionStatus) {
      Object.assign(updatePayload, { extraction_status: extractionStatus });
    }

    try {
      const { error } = await supabase
        .from("plan_sets")
        .update(updatePayload)
        .eq("id", args.planSetId)
        .eq("job_id", args.jobId);

      if (error) {
        console.warn("[plan-sheet-import] progress update failed", error.message);
      }
    } catch (error) {
      console.warn("[plan-sheet-import] progress update failed", error);
    }
  };

  try {
    await updateImportProgress(
      {
        stage: "loading_pdf",
        message: "Loading uploaded PDF.",
      },
      "processing"
    );

    const uploadedFile = await downloadPlanSetFile({
      jobId: args.jobId,
      originalFilePath: args.originalFilePath,
      ...args.storageMetadata,
    });

    if (!uploadedFile) {
      throw new Error("Uploaded plan set could not be loaded.");
    }

    const fileBytes = new Uint8Array(await uploadedFile.arrayBuffer());
    const shouldCaptureSidecarArtifacts = PLAN_SHEET_IMPORT_CAPTURE_REPLAY;
    const selectedPageCount =
      args.targetPageNumbers?.length ?? args.sourcePageCount ?? null;
    await updateImportProgress({
      stage: "extracting_pages",
      message: selectedPageCount
        ? `Extracting metadata from ${selectedPageCount} selected page${selectedPageCount === 1 ? "" : "s"}.`
        : "Extracting metadata from the selected pages.",
      selected_page_count: selectedPageCount,
      selected_page_numbers: args.targetPageNumbers,
    });

    let lastPageProgressWriteAt = 0;
    let lastPageProgressCount = 0;
    const extracted = await extractPlanSheetsFromPdf(fileBytes, {
      forceDebugArtifacts: shouldCaptureSidecarArtifacts,
      targetPageNumbers: args.targetPageNumbers,
      onProgress: async (progress) => {
        if (progress.stage !== "pdf_page_extracted") {
          return;
        }

        const now = Date.now();
        const isFirstPage = progress.processedPageCount === 1;
        const isLastPage =
          progress.processedPageCount >= progress.selectedPageCount;
        const enoughPagesPassed =
          progress.processedPageCount - lastPageProgressCount >=
          PLAN_SHEET_IMPORT_PROGRESS_PAGE_INTERVAL;
        const enoughTimePassed =
          now - lastPageProgressWriteAt >=
          PLAN_SHEET_IMPORT_PROGRESS_MIN_INTERVAL_MS;
        if (
          !isFirstPage &&
          !isLastPage &&
          !enoughPagesPassed &&
          !enoughTimePassed
        ) {
          return;
        }

        lastPageProgressWriteAt = now;
        lastPageProgressCount = progress.processedPageCount;
        await updateImportProgress({
          stage: "extracting_pages",
          message: `Read PDF page ${progress.pageNumber} (${progress.processedPageCount} of ${progress.selectedPageCount}).`,
          source_page_count: progress.sourcePageCount,
          selected_page_count: progress.selectedPageCount,
          current_page_number: progress.pageNumber,
          extracted_page_count: progress.processedPageCount,
        });
      },
    });

    console.info(
      `[plan-sheet-import][${args.planSetId}] saving ${extracted.sheets.length} draft rows`
    );

    await updateImportProgress({
      stage: "saving_draft_rows",
      message: `Saving ${extracted.sheets.length} extracted draft row${extracted.sheets.length === 1 ? "" : "s"}.`,
      source_page_count: extracted.pageCount,
      selected_page_count:
        args.targetPageNumbers?.length ?? extracted.sheets.length,
      selected_page_numbers:
        args.targetPageNumbers ?? extracted.sheets.map((sheet) => sheet.pageNumber),
      extracted_page_count: extracted.sheets.length,
      saved_sheet_count: 0,
      debug_session_id: extracted.debugSessionId ?? null,
      debug_artifacts_dir: extracted.debugArtifactsDir ?? null,
    });

    const sheetsToInsert = extracted.sheets.map((sheet) => {
      const blueprintMetadata = getPdfOnlyDefaultBlueprintMetadata();
      const routing = getImportedSheetLlmRoutingStatus(sheet);

      return {
        job_id: args.jobId,
        plan_set_id: args.planSetId,
        sheet_number: sheet.sheetNumber,
        sheet_title: sheet.sheetTitle,
        discipline: sheet.discipline,
        page_number: sheet.pageNumber,
        extraction_confidence: sheet.confidence,
        sheet_type: blueprintMetadata.sheet_type,
        sheet_kind: blueprintMetadata.sheet_kind,
        scope_tags: blueprintMetadata.scope_tags,
        area_tags: blueprintMetadata.area_tags,
        metadata_source: "importer",
        metadata_confidence: sheet.confidence,
        identity_confidence_tier: sheet.identityConfidenceTier,
        identity_confidence_reasons: sheet.identityConfidenceReasons,
        llm_routing_status: routing.status,
        llm_routing_reason: routing.reason,
        metadata_review_status:
          sheet.identityConfidenceTier === "trusted" ? "auto_trusted" : "needs_review",
        extracted_text: sheet.referenceText,
        number_source_text: sheet.numberSourceText,
        number_source_kind: sheet.numberSourceKind,
        title_source_text: sheet.titleSourceText,
        title_source_kind: sheet.titleSourceKind,
        status: "draft",
      };
    });

    let savedSheetCount = 0;
    for (const batch of chunkArray(
      sheetsToInsert,
      PLAN_SHEET_INSERT_BATCH_SIZE
    )) {
      const { error: sheetInsertError } = await supabase
        .from("plan_sheets")
        .insert(batch);

      if (sheetInsertError) {
        throw new Error(sheetInsertError.message);
      }

      savedSheetCount += batch.length;
      await updateImportProgress({
        stage: "saving_draft_rows",
        message: `Saved ${savedSheetCount} of ${sheetsToInsert.length} draft row${sheetsToInsert.length === 1 ? "" : "s"}.`,
        saved_sheet_count: savedSheetCount,
      });
    }

    importMetrics = {
      ...importMetrics,
      stage: "complete",
      message: "Import ready for review.",
      source_page_count: extracted.pageCount,
      imported_sheet_count: extracted.sheets.length,
      selected_page_count:
        args.selectedPageNumbers?.length ?? extracted.sheets.length,
      selected_page_numbers:
        args.selectedPageNumbers ?? extracted.sheets.map((sheet) => sheet.pageNumber),
      skipped_page_count: Math.max(
        0,
        extracted.pageCount - extracted.sheets.length
      ),
      extracted_page_count: extracted.sheets.length,
      saved_sheet_count: extracted.sheets.length,
      debug_session_id: extracted.debugSessionId ?? null,
      debug_artifacts_dir: extracted.debugArtifactsDir ?? null,
      progress_updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("plan_sets")
      .update({
        extraction_status: "ready",
        extraction_error: null,
        sheet_count: extracted.sheets.length,
        source_page_count: args.sourcePageCount ?? extracted.pageCount,
        import_selected_page_numbers:
          args.selectedPageNumbers ?? extracted.sheets.map((sheet) => sheet.pageNumber),
        import_metrics: importMetrics,
      })
      .eq("id", args.planSetId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    console.info(
      `[plan-sheet-import][${args.planSetId}] ready for review`
    );

    try {
      await logAuditEvent({
        actorId: args.actorId,
        action: "plan_set_uploaded",
        targetType: "plan_set",
        targetId: args.planSetId,
        jobId: args.jobId,
        metadata: {
          file_name: args.originalFileName,
          sheet_count: extracted.sheets.length,
          source_page_count: extracted.pageCount,
          import_scope_kind: args.importScopeKind,
        },
      });
    } catch (error) {
      console.warn("[plan-sheet-import] audit log failed", error);
    }
  } catch (error) {
    const importErrorMessage = getPlanSheetImportErrorMessage(error);
    console.error(
      `[plan-sheet-import][${args.planSetId}] import failed`,
      error
    );
    const failedImportMetrics = {
      ...importMetrics,
      stage: "failed",
      message: importErrorMessage,
      progress_updated_at: new Date().toISOString(),
    };

    try {
      await supabase
        .from("plan_sheets")
        .delete()
        .eq("plan_set_id", args.planSetId);
      await supabase
        .from("plan_sets")
        .update({
          extraction_status: "error",
          extraction_error: importErrorMessage,
          sheet_count: 0,
          import_metrics: failedImportMetrics,
        })
        .eq("id", args.planSetId)
        .eq("job_id", args.jobId);
    } catch (progressError) {
      console.warn(
        "[plan-sheet-import] failed to persist import error",
        progressError
      );
    }
  }
}

export async function startPlanSheetImportJob(
  input: StartPlanSheetImportJobInput
): Promise<StartPlanSheetImportJobResult> {
  const setName = input.setName.trim();
  const revisionLabel = input.revisionLabel.trim();
  const uploadedPlanSetId = input.uploadedPlanSetId.trim();
  const uploadedPlanFileName = input.uploadedPlanFileName.trim();

  if (!input.jobId) {
    throw new Error("Job not found.");
  }
  if (!setName) {
    throw new Error("Set name is required.");
  }
  if (!revisionLabel) {
    throw new Error("Revision label is required.");
  }
  if (!uploadedPlanSetId || !uploadedPlanFileName) {
    throw new Error("Upload the PDF plan set before continuing.");
  }

  const effectiveSourcePageCount = input.sourcePageCount;
  const preflightPages = sanitizePlanSheetPreflightPages(
    input.preflightPages,
    effectiveSourcePageCount
  );
  const hasScopedImportInput =
    Boolean(input.pageSelectionText.trim()) ||
    input.selectedDisciplines.length > 0 ||
    Boolean(effectiveSourcePageCount);
  const importSelection = hasScopedImportInput
    ? buildPlanSheetImportSelection({
        sourcePageCount: effectiveSourcePageCount,
        pageSelection: input.pageSelectionText || null,
        disciplineFilters: input.selectedDisciplines,
        includeUnknownDisciplines: input.includeUnknownDisciplines,
        preflightPages,
      })
    : {
        pageNumbers: [] as number[],
        scopeKind: "all" as const,
        normalizedPageSelection: null,
        selectedDisciplines: [] as string[],
        includeUnknownDisciplines: false,
        errors: [] as string[],
      };

  if (importSelection.errors.length > 0) {
    throw new Error(importSelection.errors.join(" "));
  }

  const planSetId = uploadedPlanSetId;
  const originalFilePath = getPlanSetFilePath(input.jobId, planSetId);
  const storageMetadata = getPlanSetStorageMetadata(input.jobId, planSetId);
  const selectedPageNumbers =
    importSelection.pageNumbers.length > 0 ? importSelection.pageNumbers : null;
  const targetPageNumbers = selectedPageNumbers;
  const persistedPreflight = {
    page_count: effectiveSourcePageCount,
    pages: preflightPages.map((page) => ({
      pageNumber: page.pageNumber,
      textSample: page.textSample,
      sheetNumber: page.sheetNumber ?? null,
      sheetTitle: page.sheetTitle ?? null,
      discipline: page.discipline ?? null,
    })),
    selected_disciplines: importSelection.selectedDisciplines,
    include_unknown_disciplines: importSelection.includeUnknownDisciplines,
  };
  const importMetrics = createImportProgressMetrics({
    sourcePageCount: effectiveSourcePageCount,
    importScopeKind: importSelection.scopeKind,
    selectedPageNumbers,
    selectedDisciplines: importSelection.selectedDisciplines,
  });

  const supabase = createPlanSheetImportDbClient(input.supabase);
  const { error: insertError } = await supabase.from("plan_sets").insert({
    id: planSetId,
    job_id: input.jobId,
    set_name: setName,
    revision_label: revisionLabel,
    set_date: input.setDate || null,
    notes: input.notes || null,
    original_file_name: uploadedPlanFileName || "original.pdf",
    original_file_path: originalFilePath,
    ...storageMetadata,
    uploaded_by: input.actorId,
    extraction_status: "pending",
    status: "draft",
    is_current: false,
    source_page_count: effectiveSourcePageCount,
    import_scope_kind: importSelection.scopeKind,
    import_page_selection: importSelection.normalizedPageSelection,
    import_selected_page_numbers: selectedPageNumbers,
    import_preflight: persistedPreflight,
    metadata_enrichment_status: "not_started",
    metadata_enrichment_error: null,
    import_metrics: importMetrics,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  setTimeout(() => {
    void runPlanSheetImportJob({
      actorId: input.actorId,
      jobId: input.jobId,
      planSetId,
      setName,
      revisionLabel,
      originalFileName: uploadedPlanFileName,
      originalFilePath,
      sourcePageCount: effectiveSourcePageCount,
      selectedPageNumbers,
      targetPageNumbers,
      importScopeKind: importSelection.scopeKind,
      importMetrics,
      storageMetadata,
      supabase,
    }).catch((error) => {
      console.error("[plan-sheet-import] import job crashed", error);
    });
  }, 0);

  return {
    planSetId,
    selectedPageCount:
      selectedPageNumbers?.length ?? effectiveSourcePageCount ?? null,
    sourcePageCount: effectiveSourcePageCount,
    importScopeKind: importSelection.scopeKind,
  };
}
