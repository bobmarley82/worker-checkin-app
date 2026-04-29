import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildPlanSheetResolverEvidencePayload,
  classifyPlanSheetLlmThrownError,
  inferPlanSheetEffectiveRegionPattern,
  isPlanSheetMetadataLlmEnabled,
  normalizePlanSheetLlmResponse,
  resolveEffectivePlanSheetMetadata,
  runPlanSheetLlmRequestAttempts,
  shouldRetryPlanSheetLlmFailure,
  __planSheetLlmTestUtils,
} from "../lib/planSheetLlm.ts";
import { buildTrainingArtifactEvidence } from "../lib/trainingCorpus.ts";

function createArtifactEvidence(overrides = {}) {
  return {
    evidence: {
      extracted_text: null,
      number_source_text: null,
      number_source_kind: null,
      title_source_text: null,
      title_source_kind: null,
      preview_image_path: null,
      ...(overrides.evidence ?? {}),
    },
    pipeline: null,
    heuristicOutput: overrides.heuristicOutput ?? null,
    ocrCandidateSnapshot: null,
    replayPageInput: null,
    replayOcrResult: null,
    regions: overrides.regions ?? [],
    candidates: overrides.candidates ?? [],
  };
}

async function withEnv(overrides, callback) {
  const previousValues = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("isPlanSheetMetadataLlmEnabled honors the temporary disable flag", async () => {
  await withEnv(
    {
      PLAN_SHEET_METADATA_LLM_URL: "http://example.test/resolve",
      PLAN_SHEET_METADATA_LLM_TOKEN: "secret",
      PLAN_SHEET_METADATA_LLM_DISABLED: "true",
    },
    async () => {
      assert.equal(isPlanSheetMetadataLlmEnabled(), false);
    }
  );

  await withEnv(
    {
      PLAN_SHEET_METADATA_LLM_URL: "http://example.test/resolve",
      PLAN_SHEET_METADATA_LLM_TOKEN: "secret",
      PLAN_SHEET_METADATA_LLM_DISABLED: null,
    },
    async () => {
      assert.equal(isPlanSheetMetadataLlmEnabled(), true);
    }
  );
});

test("normalizePlanSheetLlmResponse accepts nested snake_case resolution payloads", () => {
  assert.deepEqual(
    normalizePlanSheetLlmResponse({
      resolution: {
        sheet_number: "a2.01",
        sheet_title: "Building 2 Floor Plan",
        discipline: "architectural",
        sheet_kind: "floor_plan",
        confidence: 0.93,
      },
    }),
    {
      sheet_number: "A2.01",
      sheet_title: "BUILDING 2 FLOOR PLAN",
      discipline: "Architectural",
      sheet_type: "plan",
      scope_tags: [],
      area_tags: ["building_2", "second_floor"],
      sheet_kind: "floor_plan",
      confidence: 0.93,
    }
  );
});

test("normalizePlanSheetLlmResponse accepts camelCase payloads and infers sheet kind when absent", () => {
  assert.deepEqual(
    normalizePlanSheetLlmResponse({
      sheetNumber: "E5.01",
      sheetTitle: "Electrical Fire Alarm Riser Diagram",
      discipline: "electrical",
      confidence: 0.81,
    }),
    {
      sheet_number: "E5.01",
      sheet_title: "ELECTRICAL FIRE ALARM RISER DIAGRAM",
      discipline: "Electrical",
      sheet_type: "diagram",
      scope_tags: [],
      area_tags: [],
      sheet_kind: "one_line_diagram",
      confidence: 0.81,
    }
  );
});

test("normalizePlanSheetLlmResponse accepts use_llm_result payloads from the local API", () => {
  assert.deepEqual(
    normalizePlanSheetLlmResponse({
      task: "resolve_sheet_metadata",
      use_llm_result: {
        sheet_number: "A3.05",
        sheet_title: "BUILDING 6 - EXTERIOR ELEVATIONS",
        discipline: "architectural",
        sheet_kind: "elevation_sheet",
      },
      _meta: {
        llm_version: "sheet-metadata-v2-snapshot",
      },
    }),
    {
      sheet_number: "A3.05",
      sheet_title: "BUILDING 6 - EXTERIOR ELEVATIONS",
      discipline: "Architectural",
      sheet_type: "elevation",
      scope_tags: ["elevations", "exterior"],
      area_tags: ["building_6"],
      sheet_kind: "elevation_sheet",
      confidence: null,
    }
  );
});

test("normalizePlanSheetLlmResponse returns null for unusable payloads", () => {
  assert.equal(normalizePlanSheetLlmResponse(null), null);
  assert.equal(normalizePlanSheetLlmResponse({ message: "no metadata" }), null);
});

test("buildTrainingArtifactEvidence preserves debug-derived repair and context candidates for the resolver", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plan-sheet-artifacts-"));
  const artifactsDir = path.join(tempRoot, "debug");
  const pagePrefix = "page-001";

  await fs.mkdir(path.join(artifactsDir, "pages"), { recursive: true });
  await fs.mkdir(path.join(artifactsDir, "ocr-candidates"), { recursive: true });

  await fs.writeFile(
    path.join(artifactsDir, "pages", `${pagePrefix}-debug.json`),
    JSON.stringify(
      {
        finalSelection: {
          usedNumberSource: "ocr",
          usedTitleSource: "ocr",
        },
        ocrSelection: {
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
          sheetTitle: "BUILDING 2 - FLOOR PLAN",
          confidence: 0.91,
        },
        ocrTitleDiagnostics: {
          rawTitle: "BUILDING 2 - FLOOR PLAN",
          rawTitleSourceText: "DRAWING TITLE BUILDING 2 - FLOOR PLAN",
          repairedTitle:
            "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          explicitRepairedTitle:
            "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          effectiveTitle:
            "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          enrichedTitle:
            "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          titleEvaluation: {
            text: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
            score: 94,
          },
        },
        pdfPairCandidates: [
          {
            familyId: "bottom_right_strip",
            sheetNumber: "A2.01",
            sheetTitle:
              "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
            score: 88,
            confidence: 0.84,
            numberRegion: "sheetStamp",
            titleRegion: "titleBlock",
          },
        ],
        rawBoxCandidates: [
          {
            sourceModel: "compact_stamp",
            familyId: "bottom_right_strip",
            bbox: {
              x: 0.9,
              y: 0.9,
              width: 0.08,
              height: 0.06,
            },
            anchor: {
              value: "A2.01",
              score: 320,
              lineText: "A2.01",
            },
            lines: [
              { text: "A2.01" },
              {
                text:
                  "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
              },
            ],
            titleAttempts: [
              {
                text:
                  "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
                sourceText:
                  "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
                score: 92,
              },
            ],
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  await fs.writeFile(
    path.join(artifactsDir, "ocr-candidates", `${pagePrefix}.json`),
    JSON.stringify(
      {
        scanCandidates: [
          {
            sheetNumber: "A2.01",
            numberSourceText: "A2.01",
            numberRegion: "sheetStamp",
            sheetTitle: "BUILDING 2 - FLOOR PLAN",
            titleSourceText: "BUILDING 2 - FLOOR PLAN",
            titleRegion: "titleBlock",
            score: 91,
          },
        ],
      },
      null,
      2
    ),
    "utf8"
  );

  try {
    const evidence = await buildTrainingArtifactEvidence({
      artifactsDir,
      pageNumber: 1,
      modelSheet: {
        id: "sheet-1",
        sheet_number: "A2.01",
        sheet_title: "BUILDING 2 - FLOOR PLAN",
        discipline: "Architectural",
        page_number: 1,
        extraction_confidence: 0.91,
        extracted_text: "test",
        number_source_text: "A2.01",
        number_source_kind: "ocr",
        title_source_text: "BUILDING 2 - FLOOR PLAN",
        title_source_kind: "ocr",
        preview_image_path: null,
        preview_storage_key: null,
      },
    });

    const titleCandidates = evidence.candidates.filter(
      (candidate) => candidate.role === "title"
    );
    const titleTexts = titleCandidates.map(
      (candidate) => candidate.normalized_candidate_text
    );
    const titleKinds = titleCandidates.map((candidate) => candidate.candidate_kind);

    assert(titleTexts.includes("BUILDING 2 - FLOOR PLAN"));
    assert(
      titleTexts.includes(
        "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
      )
    );
    assert(titleKinds.includes("ocr_title_repair"));
    assert(titleKinds.includes("pdf_pair"));
    assert(titleKinds.includes("compact_stamp"));

    const numberCandidates = evidence.candidates.filter(
      (candidate) => candidate.role === "number"
    );
    assert(numberCandidates.some((candidate) => candidate.candidate_kind === "page_number_rank" || candidate.candidate_kind === "compact_stamp" || candidate.candidate_kind === "ocr"));
    assert(
      evidence.regions.some(
        (region) =>
          region.source_kind === "compact_stamp" &&
          region.role === "title" &&
          region.normalized_text?.includes("EXISTING/REMOVAL FLOOR PLAN")
      )
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("inferPlanSheetEffectiveRegionPattern keeps discovery locks on stable localized regions", () => {
  const artifactEvidence = createArtifactEvidence({
    regions: [
      {
        role: "number",
        region_type: "sheetStamp",
        source_kind: "ocr",
        x: null,
        y: null,
        width: null,
        height: null,
        crop_image_path: null,
        raw_text: "A2.01",
        normalized_text: "A2.01",
      },
      {
        role: "title",
        region_type: "titleBlock",
        source_kind: "ocr_title_repair",
        x: null,
        y: null,
        width: null,
        height: null,
        crop_image_path: null,
        raw_text: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
        normalized_text: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      },
    ],
    candidates: [
      {
        role: "number",
        region_type: "sheetStamp",
        candidate_text: "A2.01",
        normalized_candidate_text: "A2.01",
        candidate_kind: "ocr",
        candidate_score: 320,
        is_model_winner: true,
      },
      {
        role: "title",
        region_type: "titleBlock",
        candidate_text: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
        normalized_candidate_text: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
        candidate_kind: "ocr_title_repair",
        candidate_score: 290,
        is_model_winner: false,
      },
      {
        role: "title",
        region_type: "footerColumn",
        candidate_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
        normalized_candidate_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
        candidate_kind: "ocr",
        candidate_score: 999,
        is_model_winner: false,
      },
    ],
  });

  assert.deepEqual(
    inferPlanSheetEffectiveRegionPattern({
      artifactEvidence,
      effectiveMetadata: {
        sheet_number: "A2.01",
        sheet_title: "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
        discipline: "Architectural",
        sheet_kind: "floor_plan",
        confidence: 0.91,
      },
    }),
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
    }
  );
});

test("buildTrainingArtifactEvidence collapses duplicate title repair crops from the same region", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plan-sheet-artifacts-dedupe-"));
  const artifactsDir = path.join(tempRoot, "debug");
  const pagePrefix = "page-001";
  const cropDir = path.join(artifactsDir, "ocr-crops", pagePrefix);

  await fs.mkdir(path.join(artifactsDir, "pages"), { recursive: true });
  await fs.mkdir(path.join(artifactsDir, "ocr-candidates"), { recursive: true });
  await fs.mkdir(cropDir, { recursive: true });

  await fs.writeFile(
    path.join(artifactsDir, "pages", `${pagePrefix}-debug.json`),
    JSON.stringify(
      {
        finalSelection: {
          usedNumberSource: "ocr",
          usedTitleSource: "ocr",
        },
        ocrSelection: {
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
          sheetTitle: "BUILDING 4 - FLOOR PLAN",
          confidence: 0.9,
        },
        ocrTitleDiagnostics: {
          rawTitle: "BUILDING 4 - FLOOR PLAN",
          rawTitleSourceText: "BUILDING 4 - FLOOR PLAN",
          repairedTitle:
            "BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          effectiveTitle:
            "BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          enrichedTitle:
            "BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          titleEvaluation: {
            score: 91,
          },
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(artifactsDir, "ocr-candidates", `${pagePrefix}.json`),
    JSON.stringify({ scanCandidates: [] }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(cropDir, "sheetStamp-normal.png"), Buffer.from("stamp"));
  await fs.writeFile(path.join(cropDir, "titleBlock-normal.png"), Buffer.from("title"));

  try {
    const evidence = await buildTrainingArtifactEvidence({
      artifactsDir,
      pageNumber: 1,
      modelSheet: {
        id: "sheet-1",
        page_number: 1,
        sheet_number: "A2.04",
        sheet_title: "BUILDING 4 - FLOOR PLAN",
        discipline: "Architectural",
        extraction_confidence: 0.9,
        extracted_text: null,
        number_source_text: "A2.04",
        number_source_kind: "ocr",
        title_source_text: "BUILDING 4 - FLOOR PLAN",
        title_source_kind: "ocr",
        preview_image_path: null,
        preview_storage_key: null,
      },
    });

    const croppedTitleRegions = evidence.regions.filter(
      (region) => region.role === "title" && region.crop_image_path
    );
    assert.equal(croppedTitleRegions.length, 1);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildTrainingArtifactEvidence does not attach OCR crop files to pdf_text final regions", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plan-sheet-artifacts-pdf-"));
  const artifactsDir = path.join(tempRoot, "debug");
  const pagePrefix = "page-001";
  const cropDir = path.join(artifactsDir, "ocr-crops", pagePrefix);

  await fs.mkdir(path.join(artifactsDir, "pages"), { recursive: true });
  await fs.mkdir(path.join(artifactsDir, "ocr-candidates"), { recursive: true });
  await fs.mkdir(cropDir, { recursive: true });

  await fs.writeFile(
    path.join(artifactsDir, "pages", `${pagePrefix}-debug.json`),
    JSON.stringify(
      {
        finalSelection: {
          usedNumberSource: "pdf_text",
          usedTitleSource: "pdf_text",
        },
        ocrSelection: {
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
          confidence: 0.42,
        },
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.writeFile(
    path.join(artifactsDir, "ocr-candidates", `${pagePrefix}.json`),
    JSON.stringify({ scanCandidates: [] }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(cropDir, "sheetStamp-normal.png"), Buffer.from("stamp"));
  await fs.writeFile(path.join(cropDir, "titleBlock-normal.png"), Buffer.from("title"));

  try {
    const evidence = await buildTrainingArtifactEvidence({
      artifactsDir,
      pageNumber: 1,
      modelSheet: {
        id: "sheet-1",
        page_number: 1,
        sheet_number: "G-0.00",
        sheet_title: "COVER SHEET",
        discipline: "General",
        extraction_confidence: 0.82,
        extracted_text: null,
        number_source_text: "G-0.00",
        number_source_kind: "pdf_text",
        title_source_text: "COVER SHEET",
        title_source_kind: "pdf_text",
        preview_image_path: null,
        preview_storage_key: null,
      },
    });

    const pdfTextRegions = evidence.regions.filter(
      (region) => region.source_kind === "pdf_text"
    );
    assert(pdfTextRegions.length >= 2);
    assert.equal(
      pdfTextRegions.some((region) => Boolean(region.crop_image_path)),
      false
    );
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("buildPlanSheetResolverEvidencePayload drops sidewalk notes and footer noise from title evidence", () => {
  const payload = buildPlanSheetResolverEvidencePayload({
    heuristicSnapshot: {
      sheet_number: "A1.00",
      sheet_title: "SITE PLAN",
      discipline: "Architectural",
      sheet_kind: "site_plan",
      confidence: 0.88,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        extracted_text:
          "SITE PLAN CONSTRUCT CONCRETE SIDEWALK IN COMPLIANCE WITH ADA REQUIREMENTS COPYRIGHT 2016 HKIT ARCHITECTS",
        title_source_text: "SITE PLAN",
        title_source_kind: "ocr",
      },
      regions: [
        {
          role: "title",
          region_type: "titleBlock",
          source_kind: "ocr",
          raw_text: "SITE PLAN",
          normalized_text: "SITE PLAN",
        },
        {
          role: "title",
          region_type: "rawBox",
          source_kind: "raw_box_context",
          raw_text:
            "CONSTRUCT CONCRETE SIDEWALK IN COMPLIANCE WITH ADA REQUIREMENTS",
          normalized_text:
            "CONSTRUCT CONCRETE SIDEWALK IN COMPLIANCE WITH ADA REQUIREMENTS",
        },
        {
          role: "title",
          region_type: "rawBox",
          source_kind: "raw_box_context",
          raw_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
          normalized_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
        },
      ],
      candidates: [
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "SITE PLAN",
          normalized_candidate_text: "SITE PLAN",
          candidate_kind: "ocr",
          candidate_score: 95,
          is_model_winner: true,
        },
        {
          role: "title",
          region_type: "rawBox",
          candidate_text:
            "CONSTRUCT CONCRETE SIDEWALK IN COMPLIANCE WITH ADA REQUIREMENTS",
          normalized_candidate_text:
            "CONSTRUCT CONCRETE SIDEWALK IN COMPLIANCE WITH ADA REQUIREMENTS",
          candidate_kind: "raw_box_context",
          candidate_score: 92,
          is_model_winner: false,
        },
        {
          role: "title",
          region_type: "rawBox",
          candidate_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
          normalized_candidate_text: "COPYRIGHT 2016 HKIT ARCHITECTS",
          candidate_kind: "raw_box_context",
          candidate_score: 91,
          is_model_winner: false,
        },
      ],
    }),
  });

  assert.deepEqual(
    payload.high_signal_localized.top_title_candidates.map((candidate) => candidate.normalized_candidate_text),
    ["SITE PLAN"]
  );
  assert.equal(
    payload.candidates.some((candidate) =>
      candidate.normalized_candidate_text.includes("SIDEWALK")
    ),
    false
  );
  assert.equal(
    payload.candidates.some((candidate) =>
      candidate.normalized_candidate_text.includes("COPYRIGHT")
    ),
    false
  );
  assert.equal(payload.low_signal_page_context.full_page_text_excerpt, null);
  assert(payload.low_signal_page_context.dropped_title_noise.some((entry) => entry.includes("SIDEWALK")));
});

test("buildPlanSheetResolverEvidencePayload keeps cover/index page context only for cover-like pages", () => {
  const coverPayload = buildPlanSheetResolverEvidencePayload({
    heuristicSnapshot: {
      sheet_number: "G0.00",
      sheet_title: "COVER, DRAWING INDEX, ABBREVIATIONS",
      discipline: "General",
      sheet_kind: "cover_sheet",
      confidence: 0.91,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        extracted_text:
          "PROJECT DIRECTORY SUMMARY OF WORK DRAWING INDEX G0.00 COVER, DRAWING INDEX, ABBREVIATIONS",
        title_source_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
        title_source_kind: "ocr",
      },
      regions: [
        {
          role: "title",
          region_type: "titleBlock",
          source_kind: "ocr",
          raw_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          normalized_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
        },
      ],
      candidates: [
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          normalized_candidate_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          candidate_kind: "ocr",
          candidate_score: 99,
          is_model_winner: true,
        },
      ],
    }),
  });

  const nonCoverPayload = buildPlanSheetResolverEvidencePayload({
    heuristicSnapshot: {
      sheet_number: "A2.09",
      sheet_title: "PORTABLE FLOOR PLANS",
      discipline: "Architectural",
      sheet_kind: "floor_plan",
      confidence: 0.91,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        extracted_text:
          "PROJECT DIRECTORY SUMMARY OF WORK DRAWING INDEX COPYRIGHT 2016 HKIT ARCHITECTS",
        title_source_text: "PORTABLE FLOOR PLANS",
        title_source_kind: "ocr",
      },
      regions: [
        {
          role: "title",
          region_type: "titleBlock",
          source_kind: "ocr",
          raw_text: "PORTABLE FLOOR PLANS",
          normalized_text: "PORTABLE FLOOR PLANS",
        },
      ],
      candidates: [
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "PORTABLE FLOOR PLANS",
          normalized_candidate_text: "PORTABLE FLOOR PLANS",
          candidate_kind: "ocr",
          candidate_score: 99,
          is_model_winner: true,
        },
      ],
    }),
  });

  assert(coverPayload.low_signal_page_context.full_page_text_excerpt?.includes("DRAWING INDEX"));
  assert.equal(nonCoverPayload.low_signal_page_context.full_page_text_excerpt, null);
});

test("LLM eligibility honors calibrated trusted and review identity tiers", () => {
  const heuristicSnapshot = {
    sheet_number: "A1.01",
    sheet_title: "FLOOR PLAN",
    discipline: "Architectural",
    sheet_kind: "floor_plan",
    confidence: 0.99,
  };
  const baseEvidence = {
    extracted_text: "A1.01 FLOOR PLAN",
    number_source_text: "A1.01",
    number_source_kind: "pdf_text",
    title_source_text: "FLOOR PLAN",
    title_source_kind: "pdf_text",
  };

  const trustedArtifactEvidence = createArtifactEvidence({
    evidence: baseEvidence,
    heuristicOutput: {
      finalSelection: {
        confidenceTier: "trusted",
        llmRecommended: false,
        repairableEvidence: true,
      },
    },
  });
  const trustedPayload = buildPlanSheetResolverEvidencePayload({
    artifactEvidence: trustedArtifactEvidence,
    heuristicSnapshot,
  });

  assert.deepEqual(
    __planSheetLlmTestUtils.getPlanSheetLlmAssistEligibility({
      heuristicSnapshot,
      resolverEvidence: trustedPayload,
      artifactEvidence: trustedArtifactEvidence,
    }),
    {
      shouldRequest: false,
      reason: "trusted_calibrated_identity",
    }
  );

  const repairableHeuristicSnapshot = {
    ...heuristicSnapshot,
    confidence: 0.76,
  };
  const repairableArtifactEvidence = createArtifactEvidence({
    evidence: {
      ...baseEvidence,
      title_source_text: "FLOOR PLAN\nPART B",
    },
    heuristicOutput: {
      finalSelection: {
        confidenceTier: "needs_review",
        llmRecommended: true,
        repairableEvidence: true,
      },
    },
  });
  const repairablePayload = buildPlanSheetResolverEvidencePayload({
    artifactEvidence: repairableArtifactEvidence,
    heuristicSnapshot: repairableHeuristicSnapshot,
  });

  assert.deepEqual(
    __planSheetLlmTestUtils.getPlanSheetLlmAssistEligibility({
      heuristicSnapshot: repairableHeuristicSnapshot,
      resolverEvidence: repairablePayload,
      artifactEvidence: repairableArtifactEvidence,
    }),
    {
      shouldRequest: false,
      reason: "calibrated_needs_review",
    }
  );
});

test("LLM eligibility skips calibrated insufficient evidence", () => {
  const heuristicSnapshot = {
    sheet_number: "M-1.4",
    sheet_title: "ON ROOF.",
    discipline: "Mechanical",
    sheet_kind: "other",
    confidence: 0.34,
  };
  const artifactEvidence = createArtifactEvidence({
    evidence: {
      extracted_text: "M-1.4 ON ROOF",
      number_source_text: "M-1.4",
      number_source_kind: "pdf_text",
      title_source_text: "ON ROOF.",
      title_source_kind: "pdf_text",
    },
    heuristicOutput: {
      finalSelection: {
        confidenceTier: "insufficient_evidence",
        llmRecommended: false,
        repairableEvidence: false,
      },
    },
  });
  const payload = buildPlanSheetResolverEvidencePayload({
    artifactEvidence,
    heuristicSnapshot,
  });

  assert.deepEqual(
    __planSheetLlmTestUtils.getPlanSheetLlmAssistEligibility({
      heuristicSnapshot,
      resolverEvidence: payload,
      artifactEvidence,
    }),
    {
      shouldRequest: false,
      reason: "calibrated_insufficient_evidence",
    }
  );
});

test("classifyPlanSheetLlmThrownError distinguishes timeout and network failures", () => {
  assert.deepEqual(
    classifyPlanSheetLlmThrownError(new Error("This operation was aborted")),
    {
      errorKind: "timeout",
      errorMessage: "This operation was aborted",
    }
  );

  assert.deepEqual(
    classifyPlanSheetLlmThrownError(new Error("fetch failed")),
    {
      errorKind: "network",
      errorMessage: "fetch failed",
    }
  );
});

test("shouldRetryPlanSheetLlmFailure retries timeout, network, 429, and 5xx only", () => {
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "timeout",
      requestStatus: "error",
      statusCode: null,
    }),
    true
  );
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "network",
      requestStatus: "error",
      statusCode: null,
    }),
    true
  );
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "rate_limit",
      requestStatus: "error",
      statusCode: 429,
    }),
    true
  );
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "server_error",
      requestStatus: "error",
      statusCode: 503,
    }),
    true
  );
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "client_error",
      requestStatus: "error",
      statusCode: 401,
    }),
    false
  );
  assert.equal(
    shouldRetryPlanSheetLlmFailure({
      errorKind: "invalid_response",
      requestStatus: "invalid_response",
      statusCode: 200,
    }),
    false
  );
});

test("runPlanSheetLlmRequestAttempts records a successful first attempt", async () => {
  let callCount = 0;
  const result = await runPlanSheetLlmRequestAttempts({
    endpoint: "http://example.com",
    token: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    retryBackoffMs: 1,
    pageNumber: 1,
    payload: { task: "resolve_sheet_metadata" },
    postPayload: async () => {
      callCount += 1;
      return {
        ok: true,
        responsePayload: {
          sheet_number: "A1.00",
          sheet_title: "SITE PLAN",
          discipline: "architectural",
        },
        errorMessage: null,
        errorKind: null,
        statusCode: 200,
      };
    },
  });

  assert.equal(callCount, 1);
  assert.equal(result.requestStatus, "success");
  assert.equal(result.attemptCount, 1);
  assert.equal(result.finalErrorKind, null);
  assert.equal(result.retryHistory.length, 1);
  assert.equal(result.retryHistory[0].status, "success");
  assert.deepEqual(result.resolvedMetadata, {
    sheet_number: "A1.00",
    sheet_title: "SITE PLAN",
    discipline: "Architectural",
    sheet_type: "plan",
    scope_tags: ["site"],
    area_tags: [],
    sheet_kind: "site_plan",
    confidence: null,
  });
});

test("runPlanSheetLlmRequestAttempts retries timeout failures and records eventual success", async () => {
  let callCount = 0;
  const result = await runPlanSheetLlmRequestAttempts({
    endpoint: "http://example.com",
    token: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    retryBackoffMs: 1,
    pageNumber: 16,
    payload: { task: "resolve_sheet_metadata" },
    postPayload: async () => {
      callCount += 1;
      if (callCount < 3) {
        return {
          ok: false,
          responsePayload: null,
          errorMessage: "This operation was aborted",
          errorKind: "timeout",
          statusCode: null,
        };
      }

      return {
        ok: true,
        responsePayload: {
          sheet_number: "A2.08",
          sheet_title:
            "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          discipline: "architectural",
        },
        errorMessage: null,
        errorKind: null,
        statusCode: 200,
      };
    },
  });

  assert.equal(callCount, 3);
  assert.equal(result.requestStatus, "success");
  assert.equal(result.attemptCount, 3);
  assert.equal(result.finalErrorKind, null);
  assert.equal(result.retryHistory.length, 3);
  assert.equal(result.retryHistory[0].error_kind, "timeout");
  assert.equal(result.retryHistory[0].retry_reason, "timeout");
  assert.equal(result.retryHistory[2].status, "success");
});

test("runPlanSheetLlmRequestAttempts stops after exhausted retries and records final error kind", async () => {
  let callCount = 0;
  const result = await runPlanSheetLlmRequestAttempts({
    endpoint: "http://example.com",
    token: "token",
    timeoutMs: 1000,
    maxRetries: 2,
    retryBackoffMs: 1,
    pageNumber: 70,
    payload: { task: "resolve_sheet_metadata" },
    postPayload: async () => {
      callCount += 1;
      return {
        ok: false,
        responsePayload: null,
        errorMessage: "LLM request failed with 503 Service Unavailable",
        errorKind: "server_error",
        statusCode: 503,
      };
    },
  });

  assert.equal(callCount, 3);
  assert.equal(result.requestStatus, "error");
  assert.equal(result.attemptCount, 3);
  assert.equal(result.finalErrorKind, "server_error");
  assert.equal(result.retryHistory.length, 3);
  assert.equal(result.retryHistory[0].retry_reason, "HTTP 503");
  assert.equal(result.retryHistory[2].retry_reason, null);
  assert.equal(result.resolvedMetadata, null);
});

test("resolveEffectivePlanSheetMetadata promotes a supported fuller title from local evidence", () => {
  const result = resolveEffectivePlanSheetMetadata({
    heuristic: {
      sheet_number: "A2.08",
      sheet_title: "BUILDING 1 - FLOOR PLAN",
      discipline: "Architectural",
      sheet_kind: "floor_plan",
      confidence: 0.88,
    },
    resolved: {
      sheet_number: "A2.08",
      sheet_title: "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN",
      discipline: "Architectural",
      sheet_kind: "other",
      confidence: 0.93,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        number_source_text: "A2.08",
        title_source_text:
          "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      },
      regions: [
        {
          role: "title",
          region_type: "titleBlock",
          source_kind: "ocr",
          raw_text:
            "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          normalized_text:
            "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
        },
      ],
      candidates: [
        {
          role: "number",
          region_type: "sheetStamp",
          candidate_text: "A2.08",
          normalized_candidate_text: "A2.08",
          candidate_kind: "ocr",
          candidate_score: 0.99,
          is_model_winner: true,
        },
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text:
            "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          normalized_candidate_text:
            "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
          candidate_kind: "ocr",
          candidate_score: 0.98,
          is_model_winner: false,
        },
      ],
    }),
  });

  assert.deepEqual(result.effective_metadata, {
    sheet_number: "A2.08",
    sheet_title:
      "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
    discipline: "Architectural",
    sheet_type: "plan",
    scope_tags: ["construction", "existing", "removal"],
    area_tags: ["building_1"],
    sheet_kind: "floor_plan",
    confidence: 0.93,
  });
  assert.equal(result.effective_source, "hybrid");
  assert.equal(result.effective_field_sources.sheet_title, "llm");
});

test("resolveEffectivePlanSheetMetadata rejects unsupported cross-page title rewrites", () => {
  const result = resolveEffectivePlanSheetMetadata({
    heuristic: {
      sheet_number: "G0.00",
      sheet_title: "COVER, DRAWING INDEX, ABBREVIATIONS",
      discipline: "General",
      sheet_kind: "cover_sheet",
      confidence: 0.95,
    },
    resolved: {
      sheet_number: "A4.01",
      sheet_title:
        "BUILDING 1 - EXISTING/REMOVAL AND CONSTRUCTION PLANS & INTERIOR DETAILS",
      discipline: "Architectural",
      sheet_kind: "floor_plan",
      confidence: 0.64,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        number_source_text: "G0.00",
        title_source_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
      },
      regions: [
        {
          role: "title",
          region_type: "titleBlock",
          source_kind: "ocr",
          raw_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          normalized_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
        },
      ],
      candidates: [
        {
          role: "number",
          region_type: "sheetStamp",
          candidate_text: "G0.00",
          normalized_candidate_text: "G0.00",
          candidate_kind: "ocr",
          candidate_score: 0.99,
          is_model_winner: true,
        },
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          normalized_candidate_text: "COVER, DRAWING INDEX, ABBREVIATIONS",
          candidate_kind: "ocr",
          candidate_score: 0.95,
          is_model_winner: true,
        },
      ],
    }),
  });

  assert.deepEqual(result.effective_metadata, {
    sheet_number: "G0.00",
    sheet_title: "COVER, DRAWING INDEX, ABBREVIATIONS",
    discipline: "General",
    sheet_type: "cover",
    scope_tags: [],
    area_tags: [],
    sheet_kind: "cover_sheet",
    confidence: 0.95,
  });
  assert.equal(result.effective_source, "heuristic");
});

test("resolveEffectivePlanSheetMetadata derives sheet kind from supported final metadata", () => {
  const result = resolveEffectivePlanSheetMetadata({
    heuristic: {
      sheet_number: "A1.00",
      sheet_title: null,
      discipline: "Architectural",
      sheet_kind: null,
      confidence: 0.41,
    },
    resolved: {
      sheet_number: "A1.00",
      sheet_title: "SITE PLAN",
      discipline: "Architectural",
      sheet_kind: "detail_sheet",
      confidence: 0.82,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        number_source_text: "A1.00",
        title_source_text: "SITE PLAN",
      },
      candidates: [
        {
          role: "number",
          region_type: "sheetStamp",
          candidate_text: "A1.00",
          normalized_candidate_text: "A1.00",
          candidate_kind: "ocr",
          candidate_score: 0.98,
          is_model_winner: true,
        },
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "SITE PLAN",
          normalized_candidate_text: "SITE PLAN",
          candidate_kind: "ocr",
          candidate_score: 0.94,
          is_model_winner: false,
        },
      ],
    }),
  });

  assert.deepEqual(result.effective_metadata, {
    sheet_number: "A1.00",
    sheet_title: "SITE PLAN",
    discipline: "Architectural",
    sheet_type: "plan",
    scope_tags: ["site"],
    area_tags: [],
    sheet_kind: "site_plan",
    confidence: 0.82,
  });
  assert.equal(result.effective_field_sources.sheet_kind, "derived");
});

test("resolveEffectivePlanSheetMetadata does not trust raw LLM sheet kind over derived final metadata", () => {
  const result = resolveEffectivePlanSheetMetadata({
    heuristic: {
      sheet_number: "E2.01",
      sheet_title: "LIGHTING PLAN",
      discipline: "Electrical",
      sheet_kind: "electrical_plan",
      confidence: 0.77,
    },
    resolved: {
      sheet_number: "E2.01",
      sheet_title: "LIGHTING PLAN",
      discipline: "Electrical",
      sheet_kind: "floor_plan",
      confidence: 0.88,
    },
    artifactEvidence: createArtifactEvidence({
      evidence: {
        number_source_text: "E2.01",
        title_source_text: "LIGHTING PLAN",
      },
      candidates: [
        {
          role: "number",
          region_type: "sheetStamp",
          candidate_text: "E2.01",
          normalized_candidate_text: "E2.01",
          candidate_kind: "ocr",
          candidate_score: 0.98,
          is_model_winner: true,
        },
        {
          role: "title",
          region_type: "titleBlock",
          candidate_text: "LIGHTING PLAN",
          normalized_candidate_text: "LIGHTING PLAN",
          candidate_kind: "ocr",
          candidate_score: 0.96,
          is_model_winner: true,
        },
      ],
    }),
  });

  assert.equal(result.effective_metadata.sheet_kind, "lighting_plan");
  assert.equal(result.effective_field_sources.sheet_kind, "derived");
});
