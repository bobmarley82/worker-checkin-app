import fs from "node:fs/promises";
import path from "node:path";
import {
  inferLegacyTrainingSheetKind,
  normalizeTrainingDiscipline,
  normalizeTrainingCorrectionReason,
} from "../lib/trainingCorpusShared.ts";

const CORPUS_ROOT = path.join(process.cwd(), "data", "training-corpus");
const DEFAULT_OUTPUT = path.join(
  process.cwd(),
  "tmp",
  "blueprint-training-data",
  "blueprint-training.jsonl"
);

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function usage() {
  console.log(`Usage:
  node --experimental-strip-types scripts/export-blueprint-training-jsonl.mjs [--output <path>] [--plan-set <id> ...]

Options:
  --output <path>    Output JSONL path. Defaults to tmp/blueprint-training-data/blueprint-training.jsonl
  --plan-set <id>    Restrict export to one or more saved corpus plan-set ids
`);
}

function parseArgs(argv) {
  const planSetIds = [];
  let outputPath = DEFAULT_OUTPUT;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--output":
        outputPath = argv[index + 1];
        index += 1;
        break;
      case "--plan-set":
        planSetIds.push(argv[index + 1]);
        index += 1;
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return {
    outputPath: path.resolve(outputPath),
    planSetIds: planSetIds.map((value) => normalizeWhitespace(value)).filter(Boolean),
  };
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(targetPath) {
  return JSON.parse(await fs.readFile(targetPath, "utf8"));
}

function filterLeakageRegions(regions) {
  return (regions ?? []).filter(
    (region) => normalizeWhitespace(region?.source_kind).toLowerCase() !== "reviewed_truth"
  );
}

function filterLeakageCandidates(candidates) {
  return (candidates ?? []).filter(
    (candidate) =>
      normalizeWhitespace(candidate?.candidate_kind).toLowerCase() !== "reviewed_truth"
  );
}

async function loadReplaySnapshots(artifactsDir) {
  const normalizedArtifactsDir = normalizeWhitespace(artifactsDir ?? "");
  if (!normalizedArtifactsDir) {
    return {
      replayPageByNumber: new Map(),
      replayOcrResultByPageNumber: new Map(),
    };
  }

  const replayInputPath = path.join(normalizedArtifactsDir, "replay-input.json");
  if (!(await fileExists(replayInputPath))) {
    return {
      replayPageByNumber: new Map(),
      replayOcrResultByPageNumber: new Map(),
    };
  }

  const replayInput = await readJson(replayInputPath);
  return {
    replayPageByNumber: new Map(
      (replayInput?.pages ?? [])
        .filter((page) => typeof page?.pageNumber === "number")
        .map((page) => [page.pageNumber, page])
    ),
    replayOcrResultByPageNumber: new Map(
      (replayInput?.pdfTextResults ?? [])
        .filter((entry) => typeof entry?.pageNumber === "number")
        .map((entry) => [entry.pageNumber, entry?.result ?? null])
    ),
  };
}

async function loadFallbackPipeline({ importContext, pageNumber, replayPageByNumber, replayOcrResultByPageNumber }) {
  if (typeof pageNumber !== "number") {
    return {
      debug_session_id: importContext?.debug_session_id ?? null,
      heuristic_output: null,
      ocr_candidate_snapshot: null,
      replay_page_input: null,
      replay_ocr_result: null,
      llm_output: null,
    };
  }

  const normalizedArtifactsDir = normalizeWhitespace(importContext?.debug_artifacts_dir ?? "");
  const pagePrefix = `page-${String(pageNumber).padStart(3, "0")}`;

  if (!normalizedArtifactsDir) {
    return {
      debug_session_id: importContext?.debug_session_id ?? null,
      heuristic_output: null,
      ocr_candidate_snapshot: null,
      replay_page_input: replayPageByNumber.get(pageNumber) ?? null,
      replay_ocr_result: replayOcrResultByPageNumber.get(pageNumber) ?? null,
      llm_output: null,
    };
  }

  const pageDebugPath = path.join(normalizedArtifactsDir, "pages", `${pagePrefix}-debug.json`);
  const ocrCandidatesPath = path.join(normalizedArtifactsDir, "ocr-candidates", `${pagePrefix}.json`);
  const heuristicOutput = (await fileExists(pageDebugPath)) ? await readJson(pageDebugPath) : null;
  const ocrCandidateSnapshot =
    (await fileExists(ocrCandidatesPath)) ? await readJson(ocrCandidatesPath) : null;

  const llmOutput =
    heuristicOutput && typeof heuristicOutput === "object"
      ? heuristicOutput.llmOutput && typeof heuristicOutput.llmOutput === "object"
        ? heuristicOutput.llmOutput
        : heuristicOutput.llm_output && typeof heuristicOutput.llm_output === "object"
          ? heuristicOutput.llm_output
          : null
      : null;

  return {
    debug_session_id: importContext?.debug_session_id ?? null,
    heuristic_output:
      heuristicOutput && typeof heuristicOutput === "object" ? heuristicOutput : null,
    ocr_candidate_snapshot:
      ocrCandidateSnapshot && typeof ocrCandidateSnapshot === "object"
        ? ocrCandidateSnapshot
        : null,
    replay_page_input: replayPageByNumber.get(pageNumber) ?? null,
    replay_ocr_result: replayOcrResultByPageNumber.get(pageNumber) ?? null,
    llm_output: llmOutput,
  };
}

function normalizeReviewRecord(pageRecord, fallbackPipeline = null) {
  const review = pageRecord?.review ?? null;
  if (!review) {
    return null;
  }

  const reviewedDiscipline = normalizeTrainingDiscipline(review.discipline);
  const modelDiscipline = normalizeTrainingDiscipline(review.model_discipline);
  const reviewedSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: review.sheet_number,
    sheet_title: review.sheet_title,
    discipline: reviewedDiscipline,
    sheet_type: review.sheet_type,
    scope_tags: review.scope_tags,
    area_tags: review.area_tags,
    sheet_kind: review.sheet_kind,
  });
  const modelSheetKind = inferLegacyTrainingSheetKind({
    sheet_number: review.model_sheet_number,
    sheet_title: review.model_sheet_title,
    discipline: modelDiscipline,
    sheet_type: review.model_sheet_type,
    scope_tags: review.model_scope_tags,
    area_tags: review.model_area_tags,
    sheet_kind: review.model_sheet_kind,
  });
  const regions = filterLeakageRegions(pageRecord.regions);
  const candidates = filterLeakageCandidates(pageRecord.candidates);
  const evidence = pageRecord.evidence ?? {};
  const savedPipeline = pageRecord.pipeline ?? {};
  const pipeline = {
    debug_session_id:
      savedPipeline.debug_session_id ?? fallbackPipeline?.debug_session_id ?? null,
    heuristic_output:
      savedPipeline.heuristic_output ?? fallbackPipeline?.heuristic_output ?? null,
    ocr_candidate_snapshot:
      savedPipeline.ocr_candidate_snapshot ??
      fallbackPipeline?.ocr_candidate_snapshot ??
      null,
    replay_page_input:
      savedPipeline.replay_page_input ?? fallbackPipeline?.replay_page_input ?? null,
    replay_ocr_result:
      savedPipeline.replay_ocr_result ?? fallbackPipeline?.replay_ocr_result ?? null,
    llm_request_payload: savedPipeline.llm_request_payload ?? null,
    llm_request_status: savedPipeline.llm_request_status ?? null,
    llm_request_error: savedPipeline.llm_request_error ?? null,
    llm_resolution: savedPipeline.llm_resolution ?? null,
    llm_output: savedPipeline.llm_output ?? fallbackPipeline?.llm_output ?? null,
  };
  const hasEvidence =
    Boolean(normalizeWhitespace(evidence.extracted_text)) ||
    Boolean(normalizeWhitespace(evidence.number_source_text)) ||
    Boolean(normalizeWhitespace(evidence.title_source_text)) ||
    Boolean(pipeline?.heuristic_output) ||
    Boolean(pipeline?.ocr_candidate_snapshot) ||
    Boolean(pipeline?.replay_page_input) ||
    Boolean(pipeline?.replay_ocr_result) ||
    regions.length > 0 ||
    candidates.length > 0;

  if (
    !normalizeWhitespace(review.sheet_number) ||
    !normalizeWhitespace(review.sheet_title) ||
    !hasEvidence
  ) {
    return null;
  }

  return {
    review,
    reviewedDiscipline,
    reviewedSheetKind,
    modelDiscipline,
    modelSheetKind,
    correctionReason:
      normalizeTrainingCorrectionReason(
        review.correction_reason,
        Boolean(review.was_corrected)
      ) || null,
    evidence: {
      extracted_text: evidence.extracted_text ?? null,
      number_source_text: evidence.number_source_text ?? null,
      number_source_kind: evidence.number_source_kind ?? null,
      title_source_text: evidence.title_source_text ?? null,
      title_source_kind: evidence.title_source_kind ?? null,
      preview_image_path:
        evidence.preview_image_path ?? review.page_image_path ?? null,
    },
    pipeline: {
      debug_session_id: pipeline.debug_session_id ?? null,
      heuristic_output:
        pipeline.heuristic_output && typeof pipeline.heuristic_output === "object"
          ? pipeline.heuristic_output
          : null,
      ocr_candidate_snapshot:
        pipeline.ocr_candidate_snapshot &&
        typeof pipeline.ocr_candidate_snapshot === "object"
          ? pipeline.ocr_candidate_snapshot
          : null,
      replay_page_input:
        pipeline.replay_page_input && typeof pipeline.replay_page_input === "object"
          ? pipeline.replay_page_input
          : null,
      replay_ocr_result:
        pipeline.replay_ocr_result && typeof pipeline.replay_ocr_result === "object"
          ? pipeline.replay_ocr_result
          : null,
      llm_request_payload:
        pipeline.llm_request_payload &&
        typeof pipeline.llm_request_payload === "object"
          ? pipeline.llm_request_payload
          : null,
      llm_request_status:
        normalizeWhitespace(pipeline.llm_request_status ?? "") || null,
      llm_request_error:
        normalizeWhitespace(pipeline.llm_request_error ?? "") || null,
      llm_resolution:
        pipeline.llm_resolution && typeof pipeline.llm_resolution === "object"
          ? pipeline.llm_resolution
          : null,
      llm_output:
        pipeline.llm_output && typeof pipeline.llm_output === "object"
          ? pipeline.llm_output
          : null,
    },
    regions: regions.map((region) => ({
      role: region.role,
      region_type: region.region_type,
      source_kind: region.source_kind ?? null,
      raw_text: region.raw_text ?? null,
      normalized_text: region.normalized_text ?? null,
      bbox:
        region.x !== null &&
        region.y !== null &&
        region.width !== null &&
        region.height !== null
          ? {
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
            }
          : null,
      crop_image_path: region.crop_image_path ?? null,
    })),
    candidates: candidates.map((candidate) => ({
      role: candidate.role,
      candidate_kind: candidate.candidate_kind,
      candidate_text: candidate.candidate_text,
      normalized_candidate_text: candidate.normalized_candidate_text,
      candidate_score: candidate.candidate_score ?? null,
      is_model_winner: Boolean(candidate.is_model_winner),
    })),
  };
}

function buildTrainingExample({
  normalizedRecord,
  importContext,
}) {
  const {
    review,
    reviewedDiscipline,
    reviewedSheetKind,
    modelDiscipline,
    modelSheetKind,
    correctionReason,
  } =
    normalizedRecord;

  return {
    id: `${review.plan_set_id}:${review.plan_sheet_id}`,
    messages: [
      {
        role: "system",
        content:
          "You normalize blueprint sheet metadata from OCR/PDF evidence. Use only the provided model snapshot and raw evidence. Return only the best final metadata as JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Normalize sheet metadata from the supplied blueprint evidence.",
          page_context: {
            page_number: review.page_number,
            plan_set_id: review.plan_set_id,
            set_name: importContext?.set_name ?? null,
            revision_label: importContext?.revision_label ?? null,
          },
          model_snapshot: {
            sheet_number: review.model_sheet_number ?? null,
            sheet_title: review.model_sheet_title ?? null,
            discipline: modelDiscipline,
            sheet_kind: modelSheetKind,
            extraction_confidence: review.model_confidence ?? null,
          },
          raw_evidence: {
            extracted_text: normalizedRecord.evidence.extracted_text,
            number_source: {
              kind: normalizedRecord.evidence.number_source_kind,
              text: normalizedRecord.evidence.number_source_text,
            },
            title_source: {
              kind: normalizedRecord.evidence.title_source_kind,
              text: normalizedRecord.evidence.title_source_text,
            },
            regions: normalizedRecord.regions,
            candidates: normalizedRecord.candidates,
            heuristic_output: normalizedRecord.pipeline.heuristic_output,
            ocr_candidate_snapshot:
              normalizedRecord.pipeline.ocr_candidate_snapshot,
            replay_page_input: normalizedRecord.pipeline.replay_page_input,
            replay_ocr_result: normalizedRecord.pipeline.replay_ocr_result,
            llm_request_payload: normalizedRecord.pipeline.llm_request_payload,
            llm_request_status: normalizedRecord.pipeline.llm_request_status,
            llm_request_error: normalizedRecord.pipeline.llm_request_error,
            llm_resolution: normalizedRecord.pipeline.llm_resolution,
            llm_output: normalizedRecord.pipeline.llm_output,
            artifact_paths: {
              preview_image_path: normalizedRecord.evidence.preview_image_path,
              page_image_path: review.page_image_path ?? null,
              crop_image_paths: normalizedRecord.regions
                .map((region) => region.crop_image_path)
                .filter(Boolean),
            },
          },
        }),
      },
      {
        role: "assistant",
        content: JSON.stringify({
          sheet_number: review.sheet_number,
          sheet_title: review.sheet_title,
          discipline: reviewedDiscipline,
          sheet_kind: reviewedSheetKind,
        }),
      },
    ],
    metadata: {
      job_id: review.job_id,
      plan_set_id: review.plan_set_id,
      plan_sheet_id: review.plan_sheet_id,
      page_number: review.page_number,
      review_action: review.was_corrected ? "corrected" : "accepted",
      correction_reason: correctionReason,
      correction_note: review.correction_note ?? null,
      reviewed_at: review.reviewed_at,
      debug_session_id: normalizedRecord.pipeline.debug_session_id,
    },
  };
}

async function loadPlanSetIds(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function exportPlanSet(planSetId) {
  const planSetDir = path.join(CORPUS_ROOT, planSetId);
  const pagesDir = path.join(planSetDir, "pages");
  if (!(await fileExists(pagesDir))) {
    return { examples: [], skipped: 0 };
  }

  const importContext = (await fileExists(path.join(planSetDir, "import-context.json")))
    ? await readJson(path.join(planSetDir, "import-context.json"))
    : null;
  const { replayPageByNumber, replayOcrResultByPageNumber } =
    await loadReplaySnapshots(importContext?.debug_artifacts_dir ?? null);
  const pageFiles = (await fs.readdir(pagesDir))
    .filter((entry) => entry.endsWith(".json"))
    .sort();

  const examples = [];
  let skipped = 0;

  for (const pageFile of pageFiles) {
    const pageRecord = await readJson(path.join(pagesDir, pageFile));
    const fallbackPipeline = await loadFallbackPipeline({
      importContext,
      pageNumber: pageRecord?.review?.page_number,
      replayPageByNumber,
      replayOcrResultByPageNumber,
    });
    const normalizedRecord = normalizeReviewRecord(pageRecord, fallbackPipeline);
    if (!normalizedRecord) {
      skipped += 1;
      continue;
    }

    examples.push(
      buildTrainingExample({
        normalizedRecord,
        importContext,
      })
    );
  }

  return { examples, skipped };
}

async function main() {
  const { outputPath, planSetIds } = parseArgs(process.argv.slice(2));
  const selectedPlanSetIds =
    planSetIds.length > 0 ? planSetIds : await loadPlanSetIds(CORPUS_ROOT);
  const allExamples = [];
  let skipped = 0;

  for (const planSetId of selectedPlanSetIds) {
    const { examples, skipped: skippedForPlanSet } = await exportPlanSet(planSetId);
    allExamples.push(...examples);
    skipped += skippedForPlanSet;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${allExamples.map((example) => JSON.stringify(example)).join("\n")}\n`,
    "utf8"
  );

  console.log(
    `Exported ${allExamples.length} training examples from ${selectedPlanSetIds.length} corpus set(s) to ${outputPath}.`
  );
  if (skipped > 0) {
    console.log(`Skipped ${skipped} saved page record(s) that lacked usable raw evidence.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
