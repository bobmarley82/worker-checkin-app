import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

import {
  canonicalizeSheetIndexTitle,
  choosePreferredSingleAcceptedAnchorNumber,
  countSheetReferenceTokens,
  countTitleVocabularyHits,
  candidateDropsImportantCurrentTitleContext,
  extractCanonicalTitleFromContext,
  enrichDocumentSheetTitlesWithCompanionContext,
  enrichDocumentSheetsWithReferenceTextContext,
  inferMissingLeadingSeriesSheets,
  smoothGenericSeriesTitlesWithNeighborContext,
  enrichPdfTitleWithEdgeLineContext,
  enrichOcrTitleWithPdfEdgeLineContext,
  enrichOcrTitleWithPdfNumberContext,
  enrichOcrTitleWithPdfTitleContext,
  enrichOcrTitleWithSheetNumberPrefix,
  finalizeOcrSheetTitle,
  getMetadataBoxFamilyFromBbox,
  getMetadataBoxRejectReason,
  getSequenceConsistencyBoost,
  getStyleProfileForRegion,
  inferSheetDiscipline,
  getTextualSheetNumberRejectPenalty,
  getTextualTitleRejectPenalty,
  hasStandaloneStructuralAnnotationVocabulary,
  hasViableCompactStampStructure,
  inferDocumentStyleProfile,
  isStrongStructuredRecoveredOcrTitle,
  isAllowedSingleWordTitle,
  isGenericAuxiliarySheetTitle,
  isCompactStampContinuationFragment,
  isMetadataBoxFooterLine,
  isMetadataLabelOnlyText,
  isMetadataBoxTitleFragment,
  isPairedWithinMetadataBox,
  isPlausibleOcrNumberTokenMatch,
  isRepeatedProjectBrandingTitle,
  matchesProjectBrandingVocabulary,
  matchesTitleLikeVocabulary,
  normalizeEmbeddedSheetPathTitleSource,
  normalizeOcrSheetNumberWithTitleContext,
  normalizeOcrTitleCandidateText,
  parseSheetNumberParts,
  preferMoreSpecificCompatibleSheetNumber,
  promoteAlternateStarSheetNumber,
  reconcileOcrSheetNumberWithAnchorNumbers,
  refineSheetNumberCandidateFromLineText,
  repairOcrTitleFromSourceText,
  isOriginalSheetReferenceSource,
  isCanonicalSheetIndexTitle,
  isLikelyLowInformationSheetTitle,
  isUsableRecoveredOcrTitle,
  stripTrailingSheetTitleMetadata,
  shouldAllowUnsupportedOcrPrefix,
  shouldPreferAlternateSameNumberOcrTitle,
  shouldPreferOcrCompactAnchorOverPdfPair,
  shouldPreferOcrTitleOverPdfScaleStub,
  sheetNumberMatchesDocumentTitleDisciplineCue,
  summarizeStyleProfileVotes,
  summarizeOcrRegionPatternVotes,
} from "../lib/planSheetImportHeuristics.ts";
import { __planSheetOcrTestUtils } from "../lib/planSheetOcr.ts";
import { __planSheetImportTestUtils } from "../lib/planSheetImport.ts";
function createCandidate(sheetNumber, styleProfile = "bottom_right_block") {
  return {
    sheetNumber,
    sheetTitle: "Cover Sheet",
    numberSourceText: sheetNumber,
    titleSourceText: "Cover Sheet",
    numberLineIndex: 0,
    titleLineIndex: 1,
    numberRegion: "bottomRight",
    titleRegion: "bottomRight",
    pairedCluster: `bottomRight:${sheetNumber}`,
    styleProfile,
    numberScore: 200,
    titleScore: 140,
    score: 260,
    confidence: 0.92,
  };
}

function createExtractedSheet(overrides = {}) {
  return {
    sheetNumber: "",
    sheetTitle: "",
    discipline: null,
    pageNumber: 1,
    confidence: null,
    referenceText: "",
    numberSourceText: null,
    titleSourceText: null,
    numberSourceKind: null,
    titleSourceKind: null,
    ...overrides,
  };
}

function createTextLine(text, normX, normY, normWidth = 0.04, normHeight = 0.012, lineId = 0) {
  return {
    text,
    items: [],
    x: normX * 1000,
    top: normY * 1000,
    width: normWidth * 1000,
    height: normHeight * 1000,
    normX,
    normY,
    normWidth,
    normHeight,
    blockId: 1,
    lineId,
    fontSize: 12,
    fontSizeMin: 12,
    fontSizeMax: 12,
    isBold: false,
  };
}

function buildConfidenceCandidate(overrides = {}) {
  const sheetNumber = overrides.sheetNumber ?? "A1.01";
  const sheetTitle = overrides.sheetTitle ?? "Floor Plan";
  return {
    ...createCandidate(sheetNumber),
    sheetTitle,
    numberSourceText: sheetNumber,
    titleSourceText: sheetTitle,
    familyId: "bottom_right_block",
    numberReasonCodes: ["structured_field_parse", "bottom_right_anchor"],
    titleReasonCodes: ["structured_field_parse", "near_selected_number"],
    ...overrides,
  };
}

function calibrateIdentityConfidence(overrides = {}) {
  const candidateOverrides = {};
  for (const key of [
    "sheetNumber",
    "sheetTitle",
    "numberSourceText",
    "titleSourceText",
  ]) {
    if (overrides[key] !== undefined) {
      candidateOverrides[key] = overrides[key];
    }
  }
  const pdfPair =
    overrides.pdfPair === undefined
      ? buildConfidenceCandidate(candidateOverrides)
      : overrides.pdfPair;
  return __planSheetImportTestUtils.calibrateSheetIdentityConfidence({
    rawConfidence: 0.99,
    sheetNumber: "A1.01",
    sheetTitle: "Floor Plan",
    numberSource: "pdf_text",
    titleSource: "pdf_text",
    numberSourceText: "A1.01",
    titleSourceText: "Floor Plan",
    pdfPair,
    ocrResult: null,
    topPdfPairCandidates: pdfPair ? [pdfPair] : [],
    repeatedWeakNumber: false,
    structuredPdfPair: false,
    ...overrides,
  });
}

test("pdf pair contextual scoring exposes named breakdown without changing total", () => {
  const candidate = {
    ...buildConfidenceCandidate({
      sheetNumber: "A1.01",
      sheetTitle: "Cover Sheet",
      score: 260,
      familyId: "bottom_right_block",
      styleProfile: "bottom_right_block",
      numberReasonCodes: ["bottom_right_anchor"],
      titleReasonCodes: ["near_selected_number"],
    }),
  };

  const breakdown =
    __planSheetImportTestUtils.scorePdfPairCandidateWithContext({
      candidate,
      styleProfile: "bottom_right_block",
      strongPrefixCounts: { A: 2 },
      provisionalSelections: [],
      pageNumber: 1,
    });

  assert.equal(breakdown.total, 324);
  assert.deepEqual(
    breakdown.contributions.map((contribution) => contribution.rule),
    ["base_pair_score", "document_style_profile_match", "document_prefix_support"]
  );
});

test("calibrated identity confidence trusts structured localized sheet fields", () => {
  const result = calibrateIdentityConfidence({
    structuredPdfPair: true,
  });

  assert.equal(result.tier, "trusted");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence >= 0.9);
  assert.ok(result.reasons.includes("structured_localized_fields"));
});

test("calibrated identity confidence caps sheet numbers truncated from more specific source tokens", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "A3.02",
    sheetTitle: "Enlarged Floor Plan",
    numberSourceText: "SHEET NUMBER A3.02.1",
    titleSourceText: "Enlarged Floor Plan",
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "A3.02",
      sheetTitle: "Enlarged Floor Plan",
      numberSourceText: "SHEET NUMBER A3.02.1",
      titleSourceText: "Enlarged Floor Plan",
    }),
  });

  assert.notEqual(result.tier, "trusted");
  assert.ok(result.reasons.includes("number_source_does_not_support_selection"));
});

test("calibrated identity confidence caps source-unsupported titles into review", () => {
  const result = calibrateIdentityConfidence({
    titleSourceText: "BUILDING ID: 01",
    pdfPair: buildConfidenceCandidate({
      titleSourceText: "BUILDING ID: 01",
      titleReasonCodes: ["near_selected_number"],
    }),
  });

  assert.equal(result.tier, "needs_review");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.68);
  assert.ok(result.reasons.includes("title_source_does_not_support_selection"));
});

test("pdf edge title enrichment repairs construction-status title fragments", () => {
  const repaired = enrichPdfTitleWithEdgeLineContext({
    currentTitle: "CONSTRUCTION NOT",
    edgeLineTexts: [
      "P-01",
      "CONSTRUCTION",
      "NOT FOR",
      "PRELIMINARY",
      "COVER SHEET WITH VICINITY AND SITE MAPS",
      "COLIMA CONSTRUCTION OFFICE BUILDING",
      "CANBY, OREGON",
      "SHEET INDEX",
      "SITE MAP",
    ],
  });

  assert.equal(repaired, "COVER SHEET WITH VICINITY AND SITE MAPS");
});

test("title cleanup canonicalizes common rotated-stamp word order and trailing body text", () => {
  assert.equal(stripTrailingSheetTitleMetadata("PLAN SITE"), "SITE PLAN");
  assert.equal(stripTrailingSheetTitleMetadata("DETAILS WALL"), "WALL DETAILS");
  assert.equal(
    stripTrailingSheetTitleMetadata("EXTERIOR ELEVATION ELEVATIONS UNLESS"),
    "EXTERIOR ELEVATIONS"
  );
  assert.equal(stripTrailingSheetTitleMetadata("SECOND FLOOR PALN AND DETAILS"), "SECOND FLOOR PLAN AND DETAILS");
  assert.equal(stripTrailingSheetTitleMetadata("SECOND FLOOR ELECTRIC PLAN"), "SECOND FLOOR ELECTRICAL PLAN");
  assert.equal(
    stripTrailingSheetTitleMetadata("DEMO PLAN EXISTING ELEVATIONS"),
    "EXISTING + DEMO PLAN + ELEVATIONS"
  );
  assert.equal(
    stripTrailingSheetTitleMetadata("PROPOSED PLAN EXISTING REFLECTED CEILING PLAN"),
    "EXISTING + PROPOSED REFLECTED CEILING PLAN"
  );
  assert.equal(
    __planSheetImportTestUtils.normalizeTitleSelectionText("STAIRS, GENERAL INFORMATION"),
    "GENERAL INFORMATION"
  );
  assert.equal(isAllowedSingleWordTitle("SPECIFICATIONS"), true);
  assert.ok(
    __planSheetImportTestUtils.scoreTitleSelectionCandidate({
      title: "SPECIFICATIONS",
      sourceKind: "pdf_text",
      sourceText: "SPECIFICATIONS",
      pageNumber: 2,
    }) > 20
  );
});

test("calibrated identity confidence blocks severe noisy titles from LLM repair", () => {
  const result = calibrateIdentityConfidence({
    sheetTitle: "DRAWN BY",
    titleSourceText: "DRAWN BY",
    pdfPair: buildConfidenceCandidate({
      sheetTitle: "DRAWN BY",
      titleSourceText: "DRAWN BY",
    }),
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.34);
  assert.ok(result.reasons.includes("severe_title_noise"));
});

test("calibrated identity confidence blocks titles contaminated by admin field labels", () => {
  const result = calibrateIdentityConfidence({
    sheetTitle: "ACCESSIBILITY BUILDING ID:",
    titleSourceText: "ACCESSIBILITY BUILDING ID:",
    pdfPair: buildConfidenceCandidate({
      sheetTitle: "ACCESSIBILITY BUILDING ID:",
      titleSourceText: "ACCESSIBILITY BUILDING ID:",
    }),
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.34);
  assert.ok(result.reasons.includes("title_contains_admin_field_label"));
});

test("structured metadata sheet number source follows rescued sheet number line", () => {
  const lines = [
    createTextLine("Sheet Number:", 0.92, 0.925, 0.052, 0.012, 4),
    createTextLine("2024110", 0.92, 0.948, 0.035, 0.012, 5),
    createTextLine("TI-A-020", 0.92, 0.972, 0.045, 0.012, 6),
  ];
  const field = {
    labelText: "Sheet Number:",
    labelKind: "sheet_number",
    labelLine: lines[0],
    valueLines: [lines[1]],
    valueText: "2024110",
    sourceText: "Sheet Number:\n2024110",
    bounds: {
      x: 0.92,
      y: 0.925,
      width: 0.052,
      height: 0.035,
    },
    score: 240,
  };
  const page = {
    pageNumber: 1,
    lines,
    searchLines: lines,
    sheetIndexLines: [],
    candidates: [],
    ocrBacked: false,
  };

  const [candidate] =
    __planSheetImportTestUtils.buildMetadataStampNumberCandidates([field], lines, page);

  assert.equal(candidate?.value, "TI-A-020");
  assert.equal(candidate?.sourceText, "TI-A-020");
});

test("structured metadata sheet number candidate merges split TI sheet number near label", () => {
  const lines = [
    createTextLine("Sheet Number:", 0.62, 0.72, 0.09, 0.012, 1),
    createTextLine("TI", 0.62, 0.755, 0.025, 0.03, 2),
    createTextLine("A-915", 0.69, 0.755, 0.09, 0.035, 3),
  ];
  lines[1].fontSize = 28;
  lines[1].fontSizeMax = 28;
  lines[2].fontSize = 34;
  lines[2].fontSizeMax = 34;
  const field = {
    labelText: "Sheet Number:",
    labelKind: "sheet_number",
    labelLine: lines[0],
    valueLines: [],
    valueText: "",
    sourceText: "Sheet Number:",
    bounds: {
      x: 0.62,
      y: 0.72,
      width: 0.16,
      height: 0.07,
    },
    score: 220,
  };
  const page = {
    pageNumber: 1,
    lines,
    searchLines: lines,
    sheetIndexLines: [],
    candidates: [],
    ocrBacked: false,
  };

  const [candidate] =
    __planSheetImportTestUtils.buildMetadataStampNumberCandidates([field], lines, page);

  assert.equal(candidate?.value, "TI-A-915");
  assert.match(candidate?.sourceText ?? "", /A-915/);
});

test("structured metadata sheet number candidate reads large nearby number value", () => {
  const lines = [
    createTextLine("Drawing Number", 0.12, 0.76, 0.08, 0.012, 1),
    createTextLine("G000", 0.38, 0.82, 0.12, 0.04, 2),
  ];
  lines[1].fontSize = 38;
  lines[1].fontSizeMax = 38;
  const field = {
    labelText: "Drawing Number",
    labelKind: "sheet_number",
    labelLine: lines[0],
    valueLines: [],
    valueText: "",
    sourceText: "Drawing Number",
    bounds: {
      x: 0.12,
      y: 0.76,
      width: 0.38,
      height: 0.1,
    },
    score: 210,
  };
  const page = {
    pageNumber: 1,
    lines,
    searchLines: lines,
    sheetIndexLines: [],
    candidates: [],
    ocrBacked: false,
  };

  const [candidate] =
    __planSheetImportTestUtils.buildMetadataStampNumberCandidates([field], lines, page);

  assert.equal(candidate?.value, "G000");
  assert.equal(candidate?.sourceText, "G000");
});

test("calibrated identity confidence blocks key-plan locator-only titles from trusted tier", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "KOT1H",
    sheetTitle: "AREA B AREAB AREAA AREA A KEY PLAN",
    numberSourceText: "KOT1H",
    titleSourceText: "AREA B\nAREAB\nAREAA\nAREA A\nKEY PLAN",
    structuredPdfPair: false,
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "KOT1H",
      sheetTitle: "AREA B AREAB AREAA AREA A KEY PLAN",
      numberSourceText: "KOT1H",
      titleSourceText: "AREA B\nAREAB\nAREAA\nAREA A\nKEY PLAN",
      numberReasonCodes: ["compact_number_over_title_anchor"],
      titleReasonCodes: ["near_selected_number"],
    }),
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.reasons.includes("severe_title_noise"));
});

test("document sheet index parses TI-prefixed sheet numbers", () => {
  const entries = __planSheetImportTestUtils.buildDocumentSheetIndexEntries([
    {
      pageNumber: 1,
      lines: [],
      sheetIndexLines: [
        "SHEET LIST - USGS",
        "ARCHITECTURAL",
        "TI-A-201 EXTERIOR ELEVATIONS",
        "TI-A-202 EXTERIOR DETAILS",
      ],
      candidates: [],
    },
  ]);

  assert.deepEqual(
    entries.slice(0, 2).map((entry) => [entry.sheetNumber, entry.sheetTitle]),
    [
      ["TI-A-201", "EXTERIOR ELEVATIONS"],
      ["TI-A-202", "EXTERIOR DETAILS"],
    ]
  );
});

test("local sheet index fallback matches visible sheet number to index title", () => {
  const page = {
    pageNumber: 20,
    lines: [],
    sheetIndexLines: [],
    candidates: [
      {
        value: "A-201",
        score: 283,
        lineIndex: 0,
        normX: 0.72,
        normY: 0.9,
        normWidth: 0.01,
        normHeight: 0.008,
        width: 28,
        height: 16,
        lineText: "TI-A-201",
        isNumericOnly: false,
        prefix: "A",
      },
    ],
  };
  const entries = [
    {
      sheetNumber: "A-201",
      sheetTitle: "EXTERIOR ELEVATIONS",
      sourcePageNumber: 2,
      sourceText: "A-201\nEXTERIOR ELEVATIONS",
      index: 0,
    },
  ];

  const match = __planSheetImportTestUtils.findPageLocalDocumentSheetIndexEntry(
    page,
    entries
  );

  assert.equal(match?.entry.sheetNumber, "A-201");
  assert.equal(match?.entry.sheetTitle, "EXTERIOR ELEVATIONS");
  assert.equal(match?.sourceText, "TI-A-201");
});

test("document sheet index sequence alignment inserts reviewed sheet-list page", () => {
  const entries = __planSheetImportTestUtils.buildDocumentSheetIndexEntries([
    {
      pageNumber: 2,
      lines: [],
      sheetIndexLines: [
        "SHEET LIST - USGS",
        "TI-G-000 TITLE SHEET",
        "TI-G-100 LIFE SAFETY PLAN - USGS",
        "TI-A-001 GENERAL INFORMATION",
        "TI-A-002 ADA/ ANSI STANDARDS",
        "TI-A-003 ADA/ ANSI STANDARDS",
        "TI-A-004 ADA/ ANSI STANDARDS",
        "TI-A-005 ADA/ ANSI STANDARDS",
        "TI-A-006 ADA/ ANSI STANDARDS",
      ],
      candidates: [],
    },
  ]);
  const sequence =
    __planSheetImportTestUtils.buildDocumentSheetIndexSequenceAlignment({
      entries,
      sheets: [
        {
          pageNumber: 2,
          sheetNumber: "G-001",
          sheetTitle: "SHEET LIST - USGS",
          identityConfidenceTier: "needs_review",
        },
        {
          pageNumber: 7,
          sheetNumber: "A-004",
          sheetTitle: "ADA/ ANSI STANDARDS",
          identityConfidenceTier: "needs_review",
        },
        {
          pageNumber: 9,
          sheetNumber: "A-006",
          sheetTitle: "ADA/ ANSI STANDARDS",
          identityConfidenceTier: "trusted",
        },
      ],
    });

  assert.ok(sequence);
  const orderedNumbers = sequence.entries.map((entry) => entry.sheetNumber);
  assert.deepEqual(orderedNumbers.slice(0, 9), [
    "TI-G-000",
    "G-001",
    "TI-G-100",
    "TI-A-001",
    "TI-A-002",
    "TI-A-003",
    "TI-A-004",
    "TI-A-005",
    "TI-A-006",
  ]);
  assert.equal(
    sequence.indexByNumber.get("TI-A-006") - sequence.indexByNumber.get("TI-A-004"),
    2
  );
});

test("document sheet index positional support requires local sheet identity evidence", () => {
  const actualEntry = {
    sheetNumber: "TI-S-001",
    sheetTitle: "TYPICAL DETAILS",
    sourcePageNumber: 2,
    sourceText: "TI-S-001\nTYPICAL DETAILS",
    index: 0,
  };
  const wrongEntry = {
    sheetNumber: "TI-S-101",
    sheetTitle: "FOUNDATION PLAN - AREA 'E'",
    sourcePageNumber: 2,
    sourceText: "TI-S-101\nFOUNDATION PLAN - AREA 'E'",
    index: 1,
  };
  const stampPage = {
    pageNumber: 32,
    lines: [
      {
        text: "TI-S-001",
        normX: 0.88,
        normY: 0.91,
        normWidth: 0.05,
        normHeight: 0.02,
        fontSize: 20,
        fontSizeMax: 20,
      },
    ],
    sheetIndexLines: [],
    candidates: [],
  };
  const bodyReferenceOnlyPage = {
    pageNumber: 33,
    lines: [
      {
        text: "SEE TI-S-101 FOR DETAILS",
        normX: 0.2,
        normY: 0.25,
        normWidth: 0.15,
        normHeight: 0.01,
        fontSize: 9,
        fontSizeMax: 9,
      },
    ],
    sheetIndexLines: [],
    candidates: [],
  };
  const candidatePage = {
    pageNumber: 34,
    lines: [],
    sheetIndexLines: [],
    candidates: [
      {
        value: "S-101",
        score: 260,
        lineIndex: 0,
        normX: 0.72,
        normY: 0.9,
        normWidth: 0.03,
        normHeight: 0.014,
        width: 56,
        height: 22,
        lineText: "TI-S-101",
        isNumericOnly: false,
        prefix: "S",
      },
    ],
  };

  assert.equal(
    __planSheetImportTestUtils.pageLocallySupportsDocumentSheetIndexEntry(
      stampPage,
      actualEntry
    ),
    true
  );
  assert.equal(
    __planSheetImportTestUtils.pageLocallySupportsDocumentSheetIndexEntry(
      stampPage,
      wrongEntry
    ),
    false
  );
  assert.equal(
    __planSheetImportTestUtils.pageLocallySupportsDocumentSheetIndexEntry(
      bodyReferenceOnlyPage,
      wrongEntry
    ),
    false
  );
  assert.equal(
    __planSheetImportTestUtils.pageLocallySupportsDocumentSheetIndexEntry(
      candidatePage,
      wrongEntry
    ),
    true
  );
});

test("document sheet index title autocomplete extends local title fragments safely", () => {
  const preferTitle = (currentTitle, indexTitle, sheetNumber = "TI-E201D") =>
    __planSheetImportTestUtils.shouldPreferDocumentSheetIndexTitle({
      currentTitle,
      indexTitle,
      sheetNumber,
    });

  assert.equal(
    preferTitle(
      "LEVEL 01 PLAN - FIRE",
      "LEVEL 01 PLAN - FIRE PROTECTION - AREA D USGS",
      "TI-F201"
    ),
    true
  );
  assert.equal(
    preferTitle(
      "LEVEL 01 DEMOLITION PLAN",
      "LEVEL 01 DEMOLITION PLAN - VENTILATION - AREA D USGS",
      "TI-MV101D"
    ),
    true
  );
  assert.equal(
    preferTitle(
      "ROOF PLAN - POWER - AREA",
      "ROOF PLAN - POWER - AREA D USGS",
      "TI-E212D"
    ),
    true
  );
  assert.equal(
    preferTitle(
      "LEVEL 01 PLAN - LIGHTING",
      "LEVEL 01 - LIGHTING - AREA 'D' USGS",
      "TI-E201D"
    ),
    true
  );
});

test("document sheet index title autocomplete preserves local leading context", () => {
  const preferredTitle =
    __planSheetImportTestUtils.getPreferredDocumentSheetIndexTitle({
      currentTitle: "LEVEL 01 DEMOLITION PLAN",
      indexTitle: "DEMOLITION PLAN - VENTILATION - AREA 'D' USGS",
      sheetNumber: "TI-MV101D",
    });

  assert.equal(
    preferredTitle,
    "LEVEL 01 DEMOLITION PLAN - VENTILATION AREA 'D' USGS"
  );
});

test("document sheet index title autocomplete rejects conflicting title endings", () => {
  const preferTitle = (currentTitle, indexTitle, sheetNumber = "TI-A201B") =>
    __planSheetImportTestUtils.shouldPreferDocumentSheetIndexTitle({
      currentTitle,
      indexTitle,
      sheetNumber,
    });

  assert.equal(
    preferTitle(
      "LEVEL 01 PLAN - LIGHTING",
      "LEVEL 01 PLAN - POWER - AREA D USGS",
      "TI-E201D"
    ),
    false
  );
  assert.equal(
    preferTitle("FLOOR PLAN - AREA A", "FLOOR PLAN - AREA B", "TI-A201B"),
    false
  );
  assert.equal(
    preferTitle(
      "LEVEL 01 DEMOLITION PLAN",
      "DEMOLITION PLAN - ELECTRICAL - AREA 'E' USGS",
      "TI-E101D"
    ),
    false
  );
  assert.equal(
    preferTitle("MECHANICAL DETAILS", "MECHANICAL DIAGRAMS", "TI-M501"),
    false
  );
});

test("calibrated identity confidence routes generic titles to review", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "E-5.2",
    sheetTitle: "SCHEDULES",
    numberSourceText: "E-5.2",
    titleSourceText: "SCHEDULES",
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "E-5.2",
      sheetTitle: "SCHEDULES",
      numberSourceText: "E-5.2",
      titleSourceText: "SCHEDULES",
    }),
  });

  assert.equal(result.tier, "needs_review");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.76);
  assert.ok(result.reasons.includes("title_is_generic_auxiliary"));
});

test("calibrated identity confidence treats body-note title fragments as insufficient evidence", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "M-1.4",
    sheetTitle: "ON ROOF.",
    numberSourceText: "M-1.4",
    titleSourceText:
      "ON ROOF.\nMEZZANINE EXHAUST AIR DUCTWORK UP TO DOAS-2 ON ROOF.",
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "M-1.4",
      sheetTitle: "ON ROOF.",
      numberSourceText: "M-1.4",
      titleSourceText:
        "ON ROOF.\nMEZZANINE EXHAUST AIR DUCTWORK UP TO DOAS-2 ON ROOF.",
    }),
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.34);
  assert.ok(result.reasons.includes("severe_title_noise"));
});

test("calibrated identity confidence routes source-truncated titles to review", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "P-2.1",
    sheetTitle: "SECOND FLOOR PLUMBING",
    numberSourceText: "P-2.1",
    titleSourceText: "SECOND FLOOR PLUMBING\nPLAN - PART B",
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "P-2.1",
      sheetTitle: "SECOND FLOOR PLUMBING",
      numberSourceText: "P-2.1",
      titleSourceText: "SECOND FLOOR PLUMBING\nPLAN - PART B",
    }),
  });

  assert.equal(result.tier, "needs_review");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.76);
  assert.ok(result.reasons.includes("title_source_has_repairable_context"));
});

test("calibrated identity confidence blocks location marker sheet numbers", () => {
  const result = calibrateIdentityConfidence({
    sheetNumber: "WEST30",
    sheetTitle: "RENOVATION DINING CONSTRUCTION HALL",
    numberSourceText: "WEST30",
    titleSourceText: "RENOVATION DINING CONSTRUCTION HALL",
    pdfPair: buildConfidenceCandidate({
      sheetNumber: "WEST30",
      sheetTitle: "RENOVATION DINING CONSTRUCTION HALL",
      numberSourceText: "WEST30",
      titleSourceText: "RENOVATION DINING CONSTRUCTION HALL",
    }),
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.34);
  assert.ok(result.reasons.includes("sheet_number_looks_like_location_marker"));
});

test("calibrated identity confidence treats missing identity as insufficient evidence", () => {
  const result = calibrateIdentityConfidence({
    sheetTitle: "",
    titleSourceText: "",
    pdfPair: null,
  });

  assert.equal(result.tier, "insufficient_evidence");
  assert.equal(result.llmRecommended, false);
  assert.ok(result.confidence <= 0.12);
  assert.ok(result.reasons.includes("missing_sheet_identity"));
});

test("rejects suite and address sheet-number false positives", () => {
  const penalty = getTextualSheetNumberRejectPenalty(
    "A19",
    "75 W. Baseline Road, Suite A19-20"
  );

  assert.ok(penalty <= -220);
});

test("rejects contact and project metadata as sheet-number sources", () => {
  assert.ok(
    getTextualSheetNumberRejectPenalty(
      "600",
      "10000 Washington Boulevard Suite 600"
    ) <= -220
  );
  assert.ok(
    getTextualSheetNumberRejectPenalty("2292", "Project No. 2292") <= -220
  );
  assert.ok(
    getTextualSheetNumberRejectPenalty("2023", "Copyright ©2023") <= -220
  );
});

test("rejects detail-symbol example labels as sheet-number sources", () => {
  assert.ok(
    getTextualSheetNumberRejectPenalty(
      "A101",
      "SHEET NUMBER WHERE DETAIL IS DRAWN A101"
    ) <= -300
  );
  assert.ok(
    getTextualSheetNumberRejectPenalty(
      "A101",
      "LOWER NUMBER INDICATES SHEET NUMBER A101"
    ) <= -300
  );
});

test("rejects bracketed sheet-title admin lines as sheet-number sources", () => {
  const penalty = getTextualSheetNumberRejectPenalty(
    "A2.0",
    "[Sheet Title] A2.0 7/15/24 AutoShort 7/22/24 DX DT 18 True 240722_UCB_Foothill_Bldg4.vwxp"
  );

  assert.ok(penalty <= -260);
});

test("rejects cross-sheet reference number lines", () => {
  const penalty = getTextualSheetNumberRejectPenalty(
    "A6",
    '4. EXISTING SUSPENDED CEILING, REFER TO PAGE A6-7'
  );

  assert.ok(penalty <= -180);
});

test("rejects demolition-keynote number lines as sheet-number sources", () => {
  const penalty = getTextualSheetNumberRejectPenalty(
    "D29",
    "D29 REMOVE (E) NURSE CALL AND CODE BLUE DEVICE, TYP"
  );

  assert.ok(penalty <= -220);
});

test("rejects administrative title text", () => {
  const penalty = getTextualTitleRejectPenalty("Issue Date: 3/11/14");

  assert.ok(penalty <= -220);
});

test("rejects submittal branding as title text", () => {
  const penalty = getTextualTitleRejectPenalty(
    "PALACE THEATER DEVELOPMENT PLANK SUBMITTAL"
  );

  assert.ok(penalty <= -180);
});

test("rejects original-sheet and consultant metadata titles", () => {
  assert.ok(
    getTextualTitleRejectPenalty("ORIGINAL SHEET - ARCH E1 14") <= -220
  );
  assert.ok(
    getTextualTitleRejectPenalty("Building ID: Floor Lev:") <= -220
  );
  assert.ok(
    getTextualTitleRejectPenalty("D. MECHANICAL ROOMS Stantec Architecture Inc") <= -220
  );
  assert.equal(isOriginalSheetReferenceSource("ORIGINAL SHEET - ARCH E1"), true);
  assert.equal(stripTrailingSheetTitleMetadata("ORIGINAL SHEET - ARCH E1 14"), "");
  assert.equal(stripTrailingSheetTitleMetadata("Building ID: Floor Lev:"), "");
  assert.equal(
    stripTrailingSheetTitleMetadata(
      "1 ENLARGED DEMO PLAN - BASEMENT Scale As indicated KP Proj. No. 151-808"
    ),
    "1 ENLARGED DEMO PLAN - BASEMENT"
  );
  assert.equal(
    stripTrailingSheetTitleMetadata(
      "ELECTRICAL DEMOLITION SITE PLAN SCALE:"
    ),
    "ELECTRICAL DEMOLITION SITE PLAN"
  );
  assert.equal(
    stripTrailingSheetTitleMetadata("DETAILS HCAI PROJECT #: 5222371"),
    "DETAILS"
  );
  assert.equal(
    stripTrailingSheetTitleMetadata("WINDOW DETAILS Grand total: 70"),
    "WINDOW DETAILS"
  );
});

test("rejects admin sheet-stamp titles as label-only text", () => {
  assert.equal(isMetadataLabelOnlyText("N SHEET # AD2 -"), true);
  assert.equal(isMetadataLabelOnlyText("JOB # 2024002 SHEET #"), true);
  assert.equal(isMetadataLabelOnlyText("Sheet #:"), true);
  assert.equal(isMetadataLabelOnlyText("Drawing Number:"), true);
  assert.equal(isMetadataLabelOnlyText("View Title"), true);

  const sheetPenalty = getTextualTitleRejectPenalty("N SHEET # AD2 -");
  const jobPenalty = getTextualTitleRejectPenalty("JOB # 2024002 SHEET #");

  assert.ok(sheetPenalty <= -220);
  assert.ok(jobPenalty <= -220);
});

test("rejects detail-symbol example titles", () => {
  assert.ok(getTextualTitleRejectPenalty("DETAIL SECTION IDENTIFICATION") <= -220);
  assert.ok(getTextualTitleRejectPenalty("PLAN VIEW TITLE REFERENCE") <= -220);
  assert.ok(getTextualTitleRejectPenalty("SHEET NUMBER WHERE SECTION IS DRAWN") <= -220);
});

test("rejects address-like title text", () => {
  const penalty = getTextualTitleRejectPenalty("2700 Hearst Ave, Berkeley, CA 94720");

  assert.ok(penalty <= -220);
});

test("rejects contract boilerplate as title text", () => {
  const penalty = getTextualTitleRejectPenalty("approved plans shall be available on the project site at all times.");

  assert.ok(penalty <= -220);
});

test("rejects installer-arrival vendor note text as a sheet title", () => {
  const penalty = getTextualTitleRejectPenalty(
    "Ground terminal from equipment room INSTALLERS ARRIVAL"
  );

  assert.ok(penalty <= -220);
});

test("rejects patch-to-match construction note text as a sheet title", () => {
  const penalty = getTextualTitleRejectPenalty("PATCH FINISH TO MATCH ADJACENT");

  assert.ok(penalty <= -220);
});

test("does not count timestamp fragments as sheet references", () => {
  assert.equal(countSheetReferenceTokens("3/3/2025 5:46:58 PM"), 0);
});

test("rejects timestamp title text", () => {
  const penalty = getTextualTitleRejectPenalty("3/3/2025 5:46:58 PM");

  assert.ok(penalty <= -220);
});

test("rejects digit-heavy garbage title text", () => {
  const penalty = getTextualTitleRejectPenalty('i Gara025 to "2024002');

  assert.ok(penalty <= -120);
});

test("flags low-information OCR title garbage", () => {
  assert.equal(isLikelyLowInformationSheetTitle("ARNG SU 106 0EPT 15"), true);
  assert.equal(isLikelyLowInformationSheetTitle("Ci cr me am"), true);
  assert.equal(isLikelyLowInformationSheetTitle("sy out rT"), true);
  assert.equal(isLikelyLowInformationSheetTitle("LEVEL 3 RCP"), false);
  assert.equal(isLikelyLowInformationSheetTitle("1ST FLOOR PLAN"), false);
});

test("counts multiple sheet references on noisy lines", () => {
  assert.equal(
    countSheetReferenceTokens("A5 A3"),
    2
  );
});

test("counts sheet-index and symbols vocabulary for title evaluation", () => {
  assert.ok(
    countTitleVocabularyHits("GENERAL NOTES, SYMBOLS LIST AND SHEET INDEX") >= 4
  );
  assert.ok(
    countTitleVocabularyHits("Foodservice Standard Details") >= 2
  );
});

test("normalizes foodservice consultant OCR prefixes from title context", () => {
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "F600-3",
      sheetTitle: "Foodservice Standard Details",
      titleSourceText: "Sheet Title:\nFoodservice Standard\nDetails",
    }),
    "QF600-3"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "E716",
      sheetTitle: "DETAILS",
      titleSourceText: "DETAILS\n[HCAI PROJECT #: 5222371",
      pageLineTexts: ["11/28/2018 4:55:30 PM E-716"],
    }),
    "E-716"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "A4",
      sheetTitle: "INTERIOR ELEVATIONS",
      pageLineTexts: ["A4.3 INTERIOR ELEVATIONS - LEVEL 429"],
    }),
    "A4"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "AG.04",
      sheetTitle: "I ==",
      titleSourceText: "I ==",
      pageLineTexts: [
        "DRAWING TITLE",
        "BUILDING 5 -",
        "CONSTRUCTION RCP",
        "A6.04",
      ],
    }),
    "A6.04"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "C11",
      sheetTitle: "GRADING AND DRAINAGE PLAN",
      pageLineTexts: ["C1.1 GRADING AND DRAINAGE PLAN"],
    }),
    "C1.1"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "C1-1",
      sheetTitle: "GRADING AND DRAINAGE PLAN",
      titleSourceText: "GRADING AND\nDRAINAGE\nPLAN",
      pageLineTexts: ["C1.1 GRADING AND DRAINAGE PLAN"],
    }),
    "C1.1"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "E02",
      sheetTitle: "ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS",
      pageLineTexts: ["E0.02 ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS"],
    }),
    "E0.02"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "A202",
      sheetTitle: "BUILDING 3 - FLOOR PLAN",
      pageLineTexts: ["A2.02 BUILDING 3 - FLOOR PLAN"],
    }),
    "A2.02"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "G0.00",
      sheetTitle: "COVER, DRAWING, INDEX, ABBREVIATIONS",
    }),
    "G0.00"
  );
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "AB.03",
      sheetTitle: "BUILDING 4 - RCP",
      titleSourceText: "EN > BUILDING 4/5/6 - RCP\n7] nape,\n{EY PLAN",
      pageLineTexts: ["A6.03 BUILDING 4/5/6 - RCP"],
    }),
    "A6.03"
  );
});

test("prefers a single accepted anchor when malformed OCR keeps the same main sheet and truncated sub number", () => {
  assert.equal(
    choosePreferredSingleAcceptedAnchorNumber({
      singleAcceptedAnchorNumber: "A8.30",
      ocrSheetNumber: "1N8.3",
      ocrNumberScore: 128,
    }),
    "A8.30"
  );
  assert.equal(
    choosePreferredSingleAcceptedAnchorNumber({
      singleAcceptedAnchorNumber: "A9.20",
      ocrSheetNumber: "1A9.2",
      ocrNumberScore: 128,
    }),
    "A9.20"
  );
});

test("detects when repaired schedule titles drop important current context", () => {
  assert.equal(
    candidateDropsImportantCurrentTitleContext(
      "INTERIOR FINISH SCHEDULES",
      "SCHEDULES"
    ),
    true
  );
});

test("extracts fuller project data titles from repeated context", () => {
  assert.equal(
    extractCanonicalTitleFromContext(
      "PROJECT DATA NOTES & ABBREVIATIONS PROJECT DATA NOTES & ABBREVIATIONS"
    ),
    "PROJECT DATA, NOTES, & ABBREVIATIONS"
  );
});

test("normalizes malformed OCR numbers against dotted page-line matches with leading artifacts", () => {
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "1N8.3",
      sheetTitle: "WINDOW DETAILS",
      pageLineTexts: ["A8.30 WINDOW DETAILS"],
    }),
    "A8.30"
  );
});

test("extracts useful title text from takeoff export footer lines", () => {
  assert.equal(
    normalizeEmbeddedSheetPathTitleSource(
      "A4.03.pdf (45% of Scale); Takeoff in Active Area: Level 3 RCP; Baytech Palace Theater Campus (no metal); Sarai; 8/23/2024 09:41 AM"
    ),
    "Level 3 RCP"
  );
  assert.equal(
    normalizeEmbeddedSheetPathTitleSource(
      "A2.01.pdf (45% of Scale); Takeoff in Active Area: Door infill; Baytech Palace Theater Campus (no metal); Sarai; 8/23/2024 09:41 AM"
    ),
    "A2.01.pdf (45% of Scale); Takeoff in Active Area: Door infill; Baytech Palace Theater Campus (no metal); Sarai; 8/23/2024 09:41 AM"
  );
});

test("extracts canonical building titles from compact-stamp context", () => {
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE COVER DRAWING INDEX ABBREVIATIONS"
    ),
    "COVER, DRAWING, INDEX, ABBREVIATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE COVER DRAWING INDEX ABBREVIATIONS SYMBOLS"
    ),
    "COVER, DRAWING, INDEX, ABBREVIATIONS, SYMBOLS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE STRUCTURAL GENERAL NOTES"
    ),
    "STRUCTURAL GENERAL NOTES"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 1 - B EXISTING/REMOVAL FLOOR PLAN IN FLOOR PLAN"
    ),
    "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "T DRAWING TITLE BUILDING 3 & 4 - EXISTING/REMOVAL 2 RCP, CONSTRUCTION RCP"
    ),
    "BUILDING 3, 4 - EXISTING/REMOVAL RCP. CONSTRUCTION RCP"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 1 - EXTERIOR 2 ELEVATIONS"
    ),
    "BUILDING 1 - EXTERIOR ELEVATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      'BUILDING 5 - WEST ELEVATION REMOVAL 1/8" = 1\'-0" BUILDING 5 - EAST ELEVATION CONSTRUCTION 1/8" = 1\'-0" BUILDING 5 - NORTH ELEVATION CONSTRUCTION 1/8" = 1\'-0"'
    ),
    "BUILDING 5 - EXTERIOR ELEVATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "TOILET 504 REMOVAL PLAN 1/4\" = 1'-0\" TOILET 504 CONSTR. PLAN 1/4\" = 1'-0\""
    ),
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext("DRAWING TITLE HB BUILDING SECTIONS"),
    "BUILDING SECTIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "U PORTABLE, TOILET B B BUILDING EXTERIOR C C 2 ELEVATIONS & SS SS COVERED WALKWAY PLAN / ELEVATION"
    ),
    "PORTABLE, TOILET BUILDING EXTERIOR ELEVATIONS & COVERED WALKWAY PLAN/ELEVATION"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "TYPICAL PORTABLE COVERED WALKWAY EXTERIOR ELEVATIONS/PLAN"
    ),
    "TYPICAL PORTABLE AND COVERED WALKWAY EXTERIOR ELEVATIONS/PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "PLUMBING LEGENDS, NOTES, FIXTURE SPECIFICATION, AND DETAILS"
    ),
    "PLUMBING LEGENDS, NOTES, FIXTURE SPECIFICATION, AND DETAILS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "ENLARGED CUSTODIAN ROOM AND RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
    ),
    "ENLARGED CUSTODIAN ROOM AND RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE PLUMBING - BUILDING 1 - 2 EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN P - ALTERNATE #3"
    ),
    "PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN - ALTERNATE # 3"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE HVAC - BUILDING 4 B EXISTING FLOOR C 2 PLAN"
    ),
    "HVAC - BUILDING 4 - EXISTING FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE PLUMBING LEGENDS, NOTES, AND DETAILS - ALTERNATE #3"
    ),
    "PLUMBING LEGENDS, NOTES AND DETAILS - ALTERNATE # 3"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "PLUMBING ENLARGED PLANS - BUILDING 5 EXISTING/REMOVAL MEN'S ENLARGED"
    ),
    "PLUMBING ENLARGED PLANS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE HVAC CONTROL DIAGRAMS EXHAUST FAN CONTROL DIAGRAM"
    ),
    "HVAC CONTROL DIAGRAMS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "PLUMBING FIXTURE SCHEDULE PLUMBING FIXTURE ALTERNATE 33 PLUMBING FIXTURE SCHEDULE - ALTERNATE #3"
    ),
    "PLUMBING FIXTURE SCHEDULE - ALTERNATE # 3"
  );
  assert.equal(
    extractCanonicalTitleFromContext("M-7.01 HVAC TITLE 24 DOCUMENTATION SCALE"),
    "HVAC TITLE 24 DOCUMENTATION"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "COPYRIGHT 2016 HKIT ARCHITECTS E0.02 SCALE: AND DETAILS SCHEDULE, NOTES LIGHTING FIXTURE ELECTRICAL DRAWING TITLE"
    ),
    "ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BULIDINGS 1, 3 & 4 - FOUNDATION DETAILS"
    ),
    "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 2 - FRAMING DETAILS"
    ),
    "BUILDING 2 - FRAMING DETAILS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 1 - FOUNDATION AND ROOF FRAMING PLAN"
    ),
    "BUILDING 1 - FOUNDATION AND ROOF FRAMING PLANS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 2 FLOOR PLAN"
    ),
    "BUILDING 2 - FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE BUILDING 6 ROOF PLAN"
    ),
    "BUILDING 6 - ROOF PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE PORTABLES FLOOR PLAN"
    ),
    "PORTABLES - FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "HARDWARE SCHEDULES DOOR AND. SCHEDULES"
    ),
    "DOOR AND HARDWARE SCHEDULES"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE DOOR WINDOW GLAZING AND SIGNAGE SCHEDULES"
    ),
    "DOOR, WINDOW, GLAZING, AND SIGNAGE SCHEDULES"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE INTERIOR AND EXTERIOR FINISH SCHEDULES"
    ),
    "INTERIOR AND EXTERIOR FINISH SCHEDULES"
  );
  assert.equal(
    extractCanonicalTitleFromContext("WINDOW AND GLAZING SCHEDULES"),
    "WINDOW AND GLAZING SCHEDULES"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE TYPICAL CLASSROOM REMOVAL CONSTRUCTION INTERIOR ELEVATIONS"
    ),
    "TYPICAL CLASSROOM REMOVAL AND CONSTRUCTION INTERIOR ELEVATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE ELECTRICAL FIRE ALARM SCHEDULES NOTES AND DETAILS"
    ),
    "ELECTRICAL FIRE ALARM SCHEDULES, NOTES AND DETAILS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE ELECTRICAL FIRE ALARM RISER DIAGRAM VOLTAGE DROP CALCULATIONS"
    ),
    "ELECTRICAL FIRE ALARM RISER DIAGRAM AND VOLTAGE DROP CALCULATIONS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE ELECTRICAL FIRE ALARM ADDRESS LISTS"
    ),
    "ELECTRICAL FIRE ALARM ADDRESS LISTS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE HVAC - BUILDING 2 & 3 FLOOR PLANS"
    ),
    "HVAC - BUILDING 2, 3 FLOOR PLANS"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE HVAC - BUILDING 6 FLOOR PLAN"
    ),
    "HVAC - BUILDING 6 FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE ELECTRICAL BUILDING 2 FLOOR PLAN"
    ),
    "ELECTRICAL BUILDING 2 - FLOOR PLAN"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "DRAWING TITLE ENLARGED ELECTRICAL RESTROOM REMOVAL AND CONSTRUCTION AND FIRE ALARM"
    ),
    "ENLARGED ELECTRICAL RESTROOM REMOVAL AND CONSTRUCTION AND FIRE ALARM"
  );
});

test("prefers OCR project data titles over cover-style pdf pairs on compact stamps", () => {
  assert.equal(
    shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal: true,
      pdfPairUsable: true,
      ocrPairUsable: true,
      sameNumberAcrossSources: false,
      ocrMatchesRawCompactAnchor: true,
      pdfTitleText: "COVER, DRAWING INDEX, ABBREVIATIONS, SYMBOLS",
      pdfTitleScore: 96,
      ocrTitleText: "PROJECT DATA",
      ocrTitleScore: 84,
    }),
    true
  );
});

test("prefers alternate same-number OCR titles when the primary title is branding noise", () => {
  assert.equal(
    shouldPreferAlternateSameNumberOcrTitle({
      primarySheetNumber: "E-602",
      primaryTitle: "AER WALNUT CREEK MEDICAL CET Winn Cree i ERNALZATON",
      primarySourceText: "AER WALNUT CREEK MEDICAL CET\n\"Winn Cree i ERNALZATON",
      alternateSheetNumber: "E-602",
      alternateTitle: "AIR DOOR WIRING DIAGRAM",
      alternateSourceText: "DETAIL\nAIR DOOR WIRING DIAGRAM",
    }),
    true
  );
});

test("keeps usable same-number OCR titles instead of swapping in alternate detail labels", () => {
  assert.equal(
    shouldPreferAlternateSameNumberOcrTitle({
      primarySheetNumber: "E-707",
      primaryTitle: "DETAILS",
      primarySourceText: "DETAILS",
      alternateSheetNumber: "E-707",
      alternateTitle: "AIR DOOR WIRING DIAGRAM",
      alternateSourceText: "DETAIL\nAIR DOOR WIRING DIAGRAM",
    }),
    false
  );
});

test("strips leading OCR junk before strong interior detail titles", () => {
  assert.equal(
    normalizeOcrTitleCandidateText("I E— NTERIDR DETAILS"),
    "INTERIOR DETAILS"
  );
});

test("strips plain OCR letter prefixes before interior detail titles", () => {
  assert.equal(
    normalizeOcrTitleCandidateText("I E INTERIOR DETAILS"),
    "INTERIOR DETAILS"
  );
});

test("repairs plain OCR letter prefixes before interior detail titles", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "I E INTERIOR DETAILS",
      ocrTitleSourceText: "I E—\nNTERIDR DETAILS",
      sheetNumber: "A9.1",
    }),
    "INTERIOR DETAILS"
  );
});

test("enriches interior elevation pdf titles with level context from edge lines", () => {
  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "ELEVATIONS - LEVEL",
      edgeLineTexts: ["Sheet Title:", "INTERIOR", "ELEVATIONS - LEVEL", "429", "A4.3"],
    }),
    "INTERIOR ELEVATIONS - LEVEL 429"
  );
  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "INTERIOR ELEVATIONS - CUB MARKET",
      edgeLineTexts: ["Sheet Title:", "INTERIOR", "ELEVATIONS - LEVEL", "429", "A4.3"],
    }),
    "INTERIOR ELEVATIONS - LEVEL 429"
  );
  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "BUILDING 5 - B CONSTRUCTION RCP",
      edgeLineTexts: [
        "DRAWING TITLE",
        "BUILDING 5 -",
        "CONSTRUCTION RCP",
        "SCALE As indicated",
        "A6.04",
      ],
    }),
    "BUILDING 5 - CONSTRUCTION RCP"
  );
});

test("promotes canonical OCR titles from combined pdf edge-line context", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "EXTERIOR EAST ELEVATION EXTERIOR ELEVATION LEGEND",
      ocrTitleSourceText: "I EXTERIOR\nEAST ELEVATION\nEXTERIOR ELEVATION LEGEND",
      pdfEdgeLineTexts: [
        'BUILDING 5 - WEST ELEVATION REMOVAL 1/8" = 1\'-0" BUILDING 5 - EAST ELEVATION CONSTRUCTION 1/8" = 1\'-0"',
        'BUILDING 5 - NORTH ELEVATION REMOVAL 1/8" = 1\'-0"',
      ],
      sheetNumber: "A3.05",
    }),
    "BUILDING 5 - EXTERIOR ELEVATIONS"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "LIGHTING FIXTURE SCHEDULE, NOTES SRG Frum SCHEDULE, NOTES.",
      ocrTitleSourceText: "LIGHTING FIXTURE\nSCHEDULE, NOTES\nSRG Frum\nSCHEDULE, NOTES.",
      pdfEdgeLineTexts: [
        "COPYRIGHT 2016 HKIT ARCHITECTS E0.02 SCALE: AND DETAILS SCHEDULE, NOTES LIGHTING FIXTURE ELECTRICAL DRAWING TITLE",
      ],
      sheetNumber: "E0.02",
    }),
    "ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS"
  );
});

test("rescues Berkeley sheet-title labels from edge lines", () => {
  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "ENLARVED CUB MARKET RCP",
      edgeLineTexts: [
        "Sheet Title:",
        "1 [ALTERNATE 2] ENLARGED CUB MARKET REFLECTED CEILING PLAN LEVEL 429",
        "Scale: 1/4\" = 1'-0\" ENLARVED CUB",
        "MARKET RCP",
        "Sheet No.:",
        "A2.6",
      ],
    }),
    "ENLARGED CUB MARKET REFLECTED CEILING PLAN LEVEL 429"
  );

  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "CBC TABLE",
      edgeLineTexts: [
        "40\" AFF Sheet Title:",
        "A B C SCHEDULES",
        "2 PARTITION TYPE SCHEDULE Sheet No.:",
        "A7.1",
      ],
    }),
    "SCHEDULES"
  );

  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "WOOD VENEER PANEL & TRIMS TO MATCH CEILING GRILLE",
      edgeLineTexts: [
        "Sheet Title:",
        "ELEVATIONS INTERIOR DETAILS",
        "Sheet No.:",
        "A9.1",
      ],
    }),
    "INTERIOR DETAILS"
  );

  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "WOOD VENEER PANEL & TRIMS TO MATCH CEILING GRILLE",
      edgeLineTexts: [
        "Sheet Title:",
        "WOOD VENEER PANEL & TRIMS TO",
        "MATCH CEILING GRILLE",
        "BACKLIT SIGNAGE PER INTERIOR",
        "ELEVATIONS INTERIOR DETAILS",
        "Sheet No.:",
        "A9.1",
      ],
    }),
    "INTERIOR DETAILS"
  );

  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "",
      edgeLineTexts: [
        "FLOOR TILE WALL TILE Sheet Title:",
        "Finish: Cool Shale Size: 12x24 Size: 2.75\" x 11\" Material Board",
        "Sheet No.:",
        "A10.1",
      ],
    }),
    "Material Board"
  );

  assert.equal(
    enrichPdfTitleWithEdgeLineContext({
      currentTitle: "Review By: DT",
      edgeLineTexts: [
        "FLOOR TILE WALL TILE Sheet Title:",
        "EPOXY FLOOR Product: Daltile NEOSPECK Product: Bedrosians",
        "Product: Stonhard Stonclad FIinish: Light Grey NE03 Finish: Clara Glossy Porcelain Tile in Ivory",
        "Finish: Cool Shale Size: 12x24 Size: 2.75\" x 11\" Material Board",
        "Sheet No.:",
        "A10.1",
      ],
    }),
    "Material Board"
  );
});

test("canonicalizes sheet-index titles from noisy metadata labels", () => {
  assert.equal(
    canonicalizeSheetIndexTitle("SHEET INDEX SYMBOLS LIST AND GENERAL NOTES"),
    "GENERAL NOTES, SYMBOLS LIST AND SHEET INDEX"
  );
  assert.equal(
    canonicalizeSheetIndexTitle("ABBREV., SHEET INDEX GENERAL NOTES"),
    "ABBREV., SHEET INDEX & GENERAL NOTES"
  );
  assert.equal(
    isCanonicalSheetIndexTitle("GENERAL NOTES, SYMBOLS LIST AND SHEET INDEX"),
    true
  );
});

test("repairs walnut creek OCR titles from source context", () => {
  assert.equal(isAllowedSingleWordTitle("ACCESSIBILITY"), true);

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "COVER SHEET Cover sheer",
      ocrTitleSourceText: '94536 COVER SHEET "Cover sheer',
      sheetNumber: "G-000",
    }),
    "COVER SHEET"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "KAISER WALNUT CREEK MEDICAL LNT CREEK MRI INTERNALIZATION",
      ocrTitleSourceText: "KAISER WALNUT CREEK MEDICAL LNT CREEK MRI INTERNALIZATION",
      sheetNumber: "G-002",
    }),
    "ACCESSIBILITY"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ELEVATIONS & SECTIONS - ROOF &",
      ocrTitleSourceText: "ELEVATIONS & SECTIONS - ROOF & WATERPROOFING DETAILS",
      sheetNumber: "A-311",
    }),
    "ELEVATIONS & SECTIONS - ROOF & WATERPROOFING DETAILS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "pA INTERIOR ELEVATIONS FO9 EAST",
      ocrTitleSourceText: "pA INTERIOR ELEVATIONS FO9 EAST",
      sheetNumber: "A-310",
    }),
    "INTERIOR ELEVATIONS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "OSHPD STANDARD GYPSUM BOARD",
      ocrTitleSourceText: "QOSHPD STANDARD GYPSUM BOARD CEILING DETAILS",
      sheetNumber: "A-804",
    }),
    "OSHPD STANDARD GYPSUM BOARD CEILING DETAILS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "OSHPD STANDARD GYPSUM BOARD",
      ocrTitleSourceText: "OSHPD STANDARD GYPSUM BOARD",
      sheetNumber: "A-812",
    }),
    "OSHPD STANDARD GYPSUM BOARD CEILING DETAILS - JOIST FRAMING"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText:
        "DEMOLITION FLOOR PLAN - Ho SHEL WANA AES, CARA DEMOLITION FLOOR PLAN",
      ocrTitleSourceText:
        "DEMOLITION FLOOR PLAN - Ho SHEL WANA AES, CARA DEMOLITION FLOOR PLAN",
      sheetNumber: "AD-110",
    }),
    "DEMOLITION FLOOR PLAN - BASEMENT"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DEMOLITION REFLECTED CEILING PLAN - BASE",
      ocrTitleSourceText: "",
      sheetNumber: "AD-120",
    }),
    "DEMOLITION REFLECTED CEILING PLAN - BASEMENT"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "94536 PARTITION SCHEDULE & PARTITION",
      ocrTitleSourceText: "94536\nPARTITION SCHEDULE & PARTITION",
      sheetNumber: "A-610",
    }),
    "PARTITION SCHEDULE & PARTITION"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "74536 EQUIPMENT SCHEDULE",
      ocrTitleSourceText: "74536\nEQUIPMENT SCHEDULE\nms\nEQUIPMENT SCHEDULE",
      sheetNumber: "AQ-111",
    }),
    "EQUIPMENT SCHEDULE"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "SCHEDULE",
      ocrTitleSourceText: "SCHEDULE ENLARGED EQUIPMENT PLAN AND",
      sheetNumber: "AQ-110",
    }),
    "ENLARGED EQUIPMENT PLAN AND SCHEDULE"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ENLARGED FLOOR PLANS",
      ocrTitleSourceText: "PLUMBING ENLARGED FLOOR PLANS OND FLOOR/ROOF PLAN = @",
      sheetNumber: "P-120",
    }),
    "PLUMBING ENLARGED FLOOR PLANS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DRAINAGE PLAN",
      ocrTitleSourceText:
        "COPYRIGHT 2016 HKIT ARCHITECTS C1.1 SCALE PLAN DRAINAGE GRADING AND DRAWING TITLE",
      sheetNumber: "C1.1",
    }),
    "GRADING AND DRAINAGE PLAN"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "CODE ANALYSIS",
      ocrTitleSourceText:
        "15. EXISTING BUILDING CONSTRUCTION TYPE WILL BE MAINTAINED. DRAWING TITLE OXDE DETECTION AT CLASSROOMS IR 9-2 OVERALL SITE PLAN",
      sheetNumber: "A1.00",
    }),
    "OVERALL SITE PLAN"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "RE I D ELEVATION, SECTION SITE RAMP, PARKING",
      ocrTitleSourceText:
        "ACCESSIBLE RAMP ENLARGED PLAN SITE RAMP, PARKING ELEVATION, SECTION",
      sheetNumber: "A1.11",
    }),
    "SITE, RAMP, PARKING - ENLARGED PLANS, ELEVATION, SECTION"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "EA T",
      ocrTitleSourceText: "BUILDING 2- EXISTINGIREM RCP, CONSTRUCTION AG.02",
      sheetNumber: "AG.02",
    }),
    "BUILDING 2 - EXISTING/REMOVAL RCP. CONSTRUCTION RCP"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "FLOOR PLAN, IN FLOOR PLAN",
      ocrTitleSourceText:
        "DRAWING TITLE BUILDING 1 - B EXISTING/REMOVAL FLOOR PLAN CONSTRUCTION FLOOR PLAN",
      sheetNumber: "A2.01",
    }),
    "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "EXTERIOR ELEVATIONS NOTES",
      ocrTitleSourceText:
        "DRAWING TITLE BUILDING 1 - EXTERIOR 2 ELEVATIONS",
      sheetNumber: "A3.01",
    }),
    "BUILDING 1 - EXTERIOR ELEVATIONS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ELEVATIONS & COVERED WALKWAY PLAN NOTES",
      ocrTitleSourceText:
        "PORTABLE TOILET BUILDING EXTERIOR ELEVATIONS COVERED WALKWAY PLAN / ELEVATION",
      sheetNumber: "A3.06",
    }),
    "PORTABLE, TOILET BUILDING EXTERIOR ELEVATIONS & COVERED WALKWAY PLAN/ELEVATION"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "INTERIOR ELEVATIONS LEGEND",
      ocrTitleSourceText:
        "TYPICAL CLASSROOM ENLARGED PLAN INTERIOR ELEVATIONS",
      sheetNumber: "A4.01",
    }),
    "TYPICAL CLASSROOM ENLARGED PLAN, INTERIOR ELEVATIONS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "INTERIOR ELEVATIONS TYPICAL KINDER ELEVATIONS",
      ocrTitleSourceText:
        "TYPICAL KINDER INTERIOR ELEVATIONS",
      sheetNumber: "A4.02",
    }),
    "TYPICAL KINDER INTERIOR ELEVATIONS"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "SEL EER PLANS & ELEVATIONS",
      ocrTitleSourceText:
        "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS",
      sheetNumber: "A4.05",
    }),
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
  );

  assert.equal(
    enrichOcrTitleWithPdfTitleContext({
      ocrTitleText: "PARTITION SCHEDULE & PARTITION",
      ocrTitleSourceText: "PARTITION SCHEDULE & PARTITION",
      pdfTitleText: "PARTITION SCHEDULE & PARTITION TYPES",
      sheetNumber: "A-610",
    }),
    "PARTITION SCHEDULE & PARTITION TYPES"
  );

  assert.equal(
    enrichOcrTitleWithPdfTitleContext({
      ocrTitleText: "ABBREVIATIONS, GENERAL SYMBOLS",
      ocrTitleSourceText: "5453\nABBREVIATIONS, GENERAL SYMBOLS",
      pdfTitleText: "ABBREVIATIONS, GENERAL SYMBOLS A",
      sheetNumber: "G-001",
    }),
    "ABBREVIATIONS, GENERAL SYMBOLS"
  );
});

test("canonicalizes Berkeley foodservice schedule OCR titles", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "Recessed inFloor 105m I Schedule",
      ocrTitleSourceText:
        "1 Foodservice Equipment\nRecessed inFloor 105m I Schedule",
      sheetNumber: "QF401-1B",
    }),
    "Foodservice Equipment Schedule"
  );

  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "I ew I Schedule",
      ocrTitleSourceText:
        "Foodservice Utiity\nI ew I Schedule",
      sheetNumber: "QF401-2B",
    }),
    "Foodservice Utility Schedule"
  );
});

test("dedupes repeated equipment schedule OCR titles", () => {
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "EQUIPMENT SCHEDULE ms EQUIPMENT SCHEDULE",
      ocrTitleSourceText: "EQUIPMENT SCHEDULE ms EQUIPMENT SCHEDULE",
      sheetNumber: "FAQ-1112",
    }),
    "EQUIPMENT SCHEDULE"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "74536 EQUIPMENT SCHEDULE Dwn. Dsgn. Chkd. YYYY.MM.DD",
      ocrTitleSourceText: "74536\nEQUIPMENT SCHEDULE\nDwn. Dsgn. Chkd. YYYY.MM.DD",
      sheetNumber: "AQ-111",
    }),
    "EQUIPMENT SCHEDULE"
  );
});

test("maps title-block regions to a recurring style profile", () => {
  assert.equal(
    getStyleProfileForRegion("stripTitle"),
    "bottom_right_strip"
  );
  assert.equal(
    getStyleProfileForRegion("titleBlock"),
    "bottom_right_block"
  );
  assert.equal(getStyleProfileForRegion("unknownRegion"), "mixed");
});

test("infers dominant document style profile from strong candidates", () => {
  const style = inferDocumentStyleProfile([
    [createCandidate("A1", "bottom_right_strip")],
    [createCandidate("A2", "bottom_right_strip")],
    [createCandidate("A3", "bottom_right_strip")],
    [createCandidate("A4", "bottom_right_block")],
  ]);

  assert.equal(style, "bottom_right_strip");
});

test("locks a dominant family when recurring geometry strongly agrees", () => {
  const summary = summarizeStyleProfileVotes([
    [{ styleProfile: "bottom_right_strip", score: 240 }],
    [{ styleProfile: "bottom_right_strip", score: 232 }],
    [{ styleProfile: "bottom_right_strip", score: 228 }],
    [{ styleProfile: "bottom_right_block", score: 180 }],
  ]);

  assert.equal(summary.locked, true);
  assert.equal(summary.styleProfile, "bottom_right_strip");
  assert.equal(summary.supportPages, 3);
});

test("stays mixed when style votes are too close", () => {
  const summary = summarizeStyleProfileVotes([
    [{ styleProfile: "bottom_right_strip", score: 220 }],
    [{ styleProfile: "bottom_right_strip", score: 214 }],
    [{ styleProfile: "bottom_right_block", score: 212 }],
    [{ styleProfile: "bottom_right_block", score: 210 }],
  ]);

  assert.equal(summary.locked, false);
  assert.equal(summary.styleProfile, "mixed");
});

test("locks a dominant OCR number/title region pattern after the discovery window", () => {
  const summary = summarizeOcrRegionPatternVotes([
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      score: 248,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      score: 242,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      score: 244,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "bottomRight",
      titleRegion: "titleBlock",
      score: 232,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "bottomRight",
      titleRegion: "titleBlock",
      score: 228,
    },
  ]);

  assert.equal(summary.locked, true);
  assert.equal(summary.styleProfile, "bottom_right_block");
  assert.equal(summary.numberRegion, "sheetStamp");
  assert.equal(summary.titleRegion, "titleBlock");
  assert.equal(summary.supportPages, 5);
});

test("keeps a dominant OCR region pattern locked through a one-page outlier", () => {
  const summary = summarizeOcrRegionPatternVotes([
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      score: 246,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      score: 244,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      score: 242,
    },
    {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      score: 240,
    },
    {
      styleProfile: "bottom_right_strip",
      numberRegion: "stripNumber",
      titleRegion: "stripTitle",
      score: 238,
    },
  ]);

  assert.equal(summary.locked, true);
  assert.equal(summary.styleProfile, "bottom_right_block");
  assert.equal(summary.numberRegion, "sheetStamp");
  assert.equal(summary.titleRegion, "bottomRight");
});

test("sticky OCR lock ignores repeated mismatches until real misses open rediscovery", () => {
  const baseNumberBox = { x: 0.93, y: 0.92, width: 0.05, height: 0.03 };
  const baseTitleBox = { x: 0.79, y: 0.78, width: 0.2, height: 0.16 };
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: baseNumberBox,
      titleBox: baseTitleBox,
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 9,
    },
    storedPatterns: [],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 2,
    mode: "locked",
    rediscoveryReason: null,
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 10,
      styleProfile: "bottom_right_strip",
      numberRegion: "stripNumber",
      titleRegion: "stripTitle",
      numberBox: { x: 0.95, y: 0.9, width: 0.04, height: 0.025 },
      titleBox: { x: 0.94, y: 0.84, width: 0.05, height: 0.08 },
      score: 248,
    },
  });

  assert.equal(state.activePattern.styleProfile, "bottom_right_block");
  assert.equal(state.pendingObservations.length, 1);

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 11,
      styleProfile: "bottom_right_strip",
      numberRegion: "stripNumber",
      titleRegion: "stripTitle",
      numberBox: { x: 0.95, y: 0.9, width: 0.04, height: 0.025 },
      titleBox: { x: 0.94, y: 0.84, width: 0.05, height: 0.08 },
      score: 246,
    },
  });
  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 12,
      styleProfile: "bottom_right_strip",
      numberRegion: "stripNumber",
      titleRegion: "stripTitle",
      numberBox: { x: 0.95, y: 0.9, width: 0.04, height: 0.025 },
      titleBox: { x: 0.94, y: 0.84, width: 0.05, height: 0.08 },
      score: 244,
    },
  });

  assert.equal(state.activePattern.styleProfile, "bottom_right_block");
  assert.equal(state.activePattern.numberRegion, "sheetStamp");
  assert.equal(state.activePattern.titleRegion, "titleBlock");
  assert.equal(state.missStreak, 0);
  assert.equal(state.mode, "locked");
  assert.equal(state.pendingObservations.length, 3);
});

test("a new OCR style only takes over after misses open rediscovery", () => {
  const nextObservation = {
    styleProfile: "bottom_right_strip",
    numberRegion: "stripNumber",
    titleRegion: "stripTitle",
    numberBox: { x: 0.95, y: 0.9, width: 0.04, height: 0.025 },
    titleBox: { x: 0.94, y: 0.84, width: 0.05, height: 0.08 },
    score: 248,
  };
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.93, y: 0.92, width: 0.05, height: 0.03 },
      titleBox: { x: 0.79, y: 0.78, width: 0.2, height: 0.16 },
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 9,
    },
    storedPatterns: [],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 2,
    mode: "locked",
    rediscoveryReason: null,
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  assert.equal(state.mode, "broad_rediscovery");

  for (const pageNumber of [13, 14, 15]) {
    state = __planSheetImportTestUtils.advanceOcrPatternLockState({
      state,
      observation: {
        pageNumber,
        ...nextObservation,
        score: 250 - pageNumber,
      },
    });
  }

  assert.equal(state.activePattern.styleProfile, "bottom_right_strip");
  assert.equal(state.activePattern.numberRegion, "stripNumber");
  assert.equal(state.activePattern.titleRegion, "stripTitle");
  assert.equal(state.missStreak, 0);
  assert.equal(state.mode, "locked");
});

test("discovery locks exact number and title boxes after three matching pages", () => {
  let state = {
    activePattern: null,
    storedPatterns: [],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 1,
    mode: "discovery",
    rediscoveryReason: null,
  };

  for (const pageNumber of [1, 2, 3]) {
    state = __planSheetImportTestUtils.advanceOcrPatternLockState({
      state,
      observation: {
        pageNumber,
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
        titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
        score: 242 - pageNumber,
      },
    });
  }

  assert.equal(state.activePattern?.styleProfile, "bottom_right_block");
  assert.equal(state.activePattern?.numberRegion, "sheetStamp");
  assert.equal(state.activePattern?.titleRegion, "titleBlock");
  assert.ok(state.activePattern?.numberBox);
  assert.ok(state.activePattern?.titleBox);
  assert.equal(state.mode, "locked");
});

test("batch discovery picks the repeated tight metadata boxes over a noisy early outlier", () => {
  const pattern = __planSheetImportTestUtils.buildDiscoverySeedLockedPattern([
    {
      pageNumber: 1,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
      score: 241,
    },
    {
      pageNumber: 2,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      numberBox: { x: 0.936, y: 0.922, width: 0.048, height: 0.026 },
      titleBox: { x: 0.72, y: 0.72, width: 0.27, height: 0.22 },
      score: 247,
    },
    {
      pageNumber: 3,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.935, y: 0.922, width: 0.045, height: 0.024 },
      titleBox: { x: 0.792, y: 0.779, width: 0.2, height: 0.16 },
      score: 239,
    },
    {
      pageNumber: 4,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.933, y: 0.92, width: 0.047, height: 0.025 },
      titleBox: { x: 0.791, y: 0.777, width: 0.203, height: 0.161 },
      score: 240,
    },
    {
      pageNumber: 5,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.202, height: 0.16 },
      score: 238,
    },
  ]);

  assert.ok(
    pattern?.numberRegion === "sheetStamp" || pattern?.numberRegion === "stripNumber"
  );
  assert.equal(pattern?.titleRegion, "titleBlock");
  assert.ok(pattern?.numberBox);
  assert.ok(pattern?.titleBox);
  assert.ok(pattern.numberBox.width < 0.06);
  assert.ok(pattern.titleBox.width < 0.22);
});

test("batch discovery canonicalizes broad lower-right winners into the tighter stable lock", () => {
  const pattern = __planSheetImportTestUtils.buildDiscoverySeedLockedPattern([
    {
      pageNumber: 1,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.918, y: 0.948, width: 0.059, height: 0.033 },
      titleBox: { x: 0.912, y: 0.843, width: 0.08, height: 0.116 },
      score: 506,
    },
    {
      pageNumber: 2,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "bottomRight",
      numberBox: { x: 0.918, y: 0.948, width: 0.057, height: 0.033 },
      titleBox: { x: 0.91, y: 0.853, width: 0.075, height: 0.031 },
      score: 472,
    },
    {
      pageNumber: 3,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.918, y: 0.948, width: 0.045, height: 0.033 },
      titleBox: { x: 0.912, y: 0.843, width: 0.07, height: 0.116 },
      score: 402,
    },
    {
      pageNumber: 4,
      styleProfile: "bottom_right_block",
      numberRegion: "bottomRight",
      titleRegion: "titleBlock",
      numberBox: { x: 0.916, y: 0.948, width: 0.053, height: 0.04 },
      titleBox: { x: 0.912, y: 0.843, width: 0.07, height: 0.116 },
      score: 402,
    },
    {
      pageNumber: 5,
      styleProfile: "bottom_right_block",
      numberRegion: "bottomRight",
      titleRegion: "titleBlock",
      numberBox: { x: 0.916, y: 0.948, width: 0.052, height: 0.04 },
      titleBox: { x: 0.82, y: 0.748, width: 0.18, height: 0.214 },
      score: 695,
    },
  ]);

  assert.equal(pattern?.numberRegion, "sheetStamp");
  assert.equal(pattern?.titleRegion, "bottomRight");
  assert.ok(pattern?.numberBox);
  assert.ok(pattern?.titleBox);
});

test("discovery LLM seed keeps OCR boxes when it agrees on the same pattern", () => {
  const pattern = __planSheetImportTestUtils.inferSeedLockedPatternFromDiscoveryAssists(
    [
      {
        assist: { page_number: 1 },
        effective_field_sources: { sheet_number: "llm", sheet_title: "ocr" },
        effective_region_pattern: {
          styleProfile: "bottom_right_block",
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
        },
      },
      {
        assist: { page_number: 3 },
        effective_field_sources: { sheet_number: "ocr", sheet_title: "llm" },
        effective_region_pattern: {
          styleProfile: "bottom_right_block",
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
        },
      },
      {
        assist: { page_number: 4 },
        effective_field_sources: { sheet_number: "ocr", sheet_title: "ocr" },
        effective_region_pattern: {
          styleProfile: "bottom_right_block",
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
        },
      },
    ],
    {
      fallbackObservations: [
        {
          pageNumber: 1,
          styleProfile: "bottom_right_block",
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
          numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
          titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
          score: 241,
        },
        {
          pageNumber: 3,
          styleProfile: "bottom_right_block",
          numberRegion: "sheetStamp",
          titleRegion: "titleBlock",
          numberBox: { x: 0.935, y: 0.922, width: 0.045, height: 0.024 },
          titleBox: { x: 0.792, y: 0.779, width: 0.2, height: 0.16 },
          score: 239,
        },
      ],
      fallbackPattern: {
        patternId: "style-1",
        styleId: "bottom_right_block:sheetStamp:titleBlock",
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
        titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
        supportPages: 4,
        hitCount: 4,
        lastUsedPage: 5,
      },
    }
  );

  assert.equal(pattern?.numberRegion, "sheetStamp");
  assert.equal(pattern?.titleRegion, "titleBlock");
  assert.ok(pattern?.numberBox);
  assert.ok(pattern?.titleBox);
});

test("separate title and number locks keep weak number reads from forcing broad rediscovery", () => {
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 9,
    },
    storedPatterns: [],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 2,
    mode: "locked",
    rediscoveryReason: null,
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 10,
      styleProfile: "bottom_right_block",
      numberRegion: "bottomRight",
      titleRegion: "titleBlock",
      numberBox: { x: 0.87, y: 0.82, width: 0.11, height: 0.12 },
      titleBox: { x: 0.792, y: 0.78, width: 0.2, height: 0.16 },
      score: 226,
    },
  });

  assert.equal(state.missStreak, 0);
  assert.equal(state.mode, "locked");
});

test("locked OCR keeps the discovery-sized base boxes instead of growing them from later pages", () => {
  const baseNumberBox = { x: 0.934, y: 0.921, width: 0.046, height: 0.025 };
  const baseTitleBox = { x: 0.79, y: 0.778, width: 0.204, height: 0.162 };
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: baseNumberBox,
      titleBox: baseTitleBox,
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 9,
    },
    storedPatterns: [
      {
        patternId: "style-1",
        styleId: "bottom_right_block:sheetStamp:titleBlock",
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: baseNumberBox,
        titleBox: baseTitleBox,
        supportPages: 4,
        hitCount: 4,
        lastUsedPage: 9,
      },
    ],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 2,
    mode: "locked",
    rediscoveryReason: null,
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 10,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.87, y: 0.91, width: 0.12, height: 0.07 },
      titleBox: { x: 0.72, y: 0.74, width: 0.28, height: 0.24 },
      score: 242,
    },
  });

  assert.deepEqual(state.activePattern.numberBox, baseNumberBox);
  assert.deepEqual(state.activePattern.titleBox, baseTitleBox);
  assert.deepEqual(state.storedPatterns[0].numberBox, baseNumberBox);
  assert.deepEqual(state.storedPatterns[0].titleBox, baseTitleBox);
});

test("broad rediscovery opens only after three consecutive locked-box misses", () => {
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 9,
    },
    storedPatterns: [],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 0,
    nextPatternId: 2,
    mode: "locked",
    rediscoveryReason: null,
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  assert.equal(state.mode, "local_expansion");
  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  assert.equal(state.mode, "style_fallback");
  state = __planSheetImportTestUtils.advanceOcrPatternLockState({ state, observation: null });
  assert.equal(state.mode, "broad_rediscovery");
});

test("returning to a prior stored style reuses it instead of rediscovering from scratch", () => {
  let state = {
    activePattern: {
      patternId: "style-1",
      styleId: "bottom_right_block:sheetStamp:titleBlock",
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
      supportPages: 4,
      hitCount: 4,
      lastUsedPage: 20,
    },
    storedPatterns: [
      {
        patternId: "style-1",
        styleId: "bottom_right_block:sheetStamp:titleBlock",
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
        titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
        supportPages: 4,
        hitCount: 4,
        lastUsedPage: 20,
      },
      {
        patternId: "style-2",
        styleId: "bottom_right_strip:stripNumber:stripTitle",
        styleProfile: "bottom_right_strip",
        numberRegion: "stripNumber",
        titleRegion: "stripTitle",
        numberBox: { x: 0.949, y: 0.914, width: 0.038, height: 0.022 },
        titleBox: { x: 0.943, y: 0.84, width: 0.05, height: 0.08 },
        supportPages: 3,
        hitCount: 3,
        lastUsedPage: 8,
      },
    ],
    discoveryObservations: [],
    pendingObservations: [],
    missStreak: 3,
    nextPatternId: 3,
    mode: "broad_rediscovery",
    rediscoveryReason: "no_observation",
  };

  state = __planSheetImportTestUtils.advanceOcrPatternLockState({
    state,
    observation: {
      pageNumber: 21,
      styleProfile: "bottom_right_strip",
      numberRegion: "stripNumber",
      titleRegion: "stripTitle",
      numberBox: { x: 0.95, y: 0.915, width: 0.037, height: 0.022 },
      titleBox: { x: 0.944, y: 0.842, width: 0.05, height: 0.078 },
      score: 241,
    },
  });

  assert.equal(state.activePattern?.patternId, "style-2");
  assert.equal(state.missStreak, 0);
  assert.equal(state.mode, "locked");
});

test("locked OCR scan plans shrink to the learned zones before reopening family fallback", () => {
  const numberBox = { x: 0.934, y: 0.921, width: 0.046, height: 0.025 };
  const titleBox = { x: 0.79, y: 0.778, width: 0.204, height: 0.162 };
  const plans = __planSheetOcrTestUtils.buildOcrRecognitionScanPlans({
    preferredStyleProfile: "bottom_right_block",
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox,
      titleBox,
    },
  });

  assert.deepEqual(
    plans.primaryScanPlan.map((step) => step.regionId),
    ["sheetStamp", "titleBlock"]
  );
  assert.equal(plans.primaryScanPlan[0].customBox.x, 0.929);
  assert.equal(plans.primaryScanPlan[0].customBox.y, 0.917);
  assert.equal(plans.primaryScanPlan[0].customBox.width, 0.056);
  assert.equal(plans.primaryScanPlan[0].customBox.height, 0.033);
  assert.equal(plans.primaryScanPlan[1].customBox.x, 0.784);
  assert.equal(plans.primaryScanPlan[1].customBox.y, 0.772);
  assert.ok(Math.abs(plans.primaryScanPlan[1].customBox.width - 0.216) < 1e-9);
  assert.ok(Math.abs(plans.primaryScanPlan[1].customBox.height - 0.174) < 1e-9);
  assert.deepEqual(
    plans.lockedPatternFallbackScanPlan.map((step) => step.scanKey ?? step.regionId),
    ["locked-neighborhood"]
  );
});

test("rediscovery OCR scan plans use the stored larger neighborhood without mutating the base lock", () => {
  const numberBox = { x: 0.934, y: 0.921, width: 0.046, height: 0.025 };
  const titleBox = { x: 0.79, y: 0.778, width: 0.204, height: 0.162 };
  const rediscoveryNumberBox = { x: 0.918, y: 0.909, width: 0.07, height: 0.045 };
  const rediscoveryTitleBox = { x: 0.768, y: 0.76, width: 0.23, height: 0.186 };
  const rediscoveryNeighborhoodBox = {
    x: 0.756,
    y: 0.748,
    width: 0.242,
    height: 0.218,
  };
  const lockedRegionPattern = {
    styleProfile: "bottom_right_block",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    numberBox,
    titleBox,
    rediscoveryNumberBox,
    rediscoveryTitleBox,
    rediscoveryNeighborhoodBox,
  };

  const normalPlans = __planSheetOcrTestUtils.buildOcrRecognitionScanPlans({
    preferredStyleProfile: "bottom_right_block",
    lockedRegionPattern,
  });
  const rediscoveryPlans = __planSheetOcrTestUtils.buildOcrRecognitionScanPlans({
    preferredStyleProfile: "bottom_right_block",
    lockedRegionPattern,
    useRediscoveryBoxes: true,
  });

  assert.equal(normalPlans.primaryScanPlan[0].customBox.x, 0.929);
  assert.equal(normalPlans.primaryScanPlan[1].customBox.x, 0.784);
  assert.equal(rediscoveryPlans.primaryScanPlan[0].customBox.x, 0.913);
  assert.equal(rediscoveryPlans.primaryScanPlan[0].customBox.width, 0.08);
  assert.equal(rediscoveryPlans.primaryScanPlan[1].customBox.x, 0.762);
  assert.equal(rediscoveryPlans.primaryScanPlan[1].customBox.width, 0.238);
  assert.deepEqual(
    rediscoveryPlans.lockedPatternFallbackScanPlan[0].customBox,
    rediscoveryNeighborhoodBox
  );
});

test("title crops recenter toward left-biased text before OCR runs", () => {
  const canvas = createCanvas(1000, 1000);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  context.fillRect(854, 790, 54, 52);
  context.fillRect(862, 850, 46, 16);

  const refined = __planSheetOcrTestUtils.refineCropRegionToInkBounds(canvas, {
    id: "titleBlock",
    scanKey: "locked-title",
    role: "title",
    fallbackOnly: false,
    x: 0.84,
    y: 0.76,
    width: 0.11,
    height: 0.2,
  });

  assert.ok(refined.x < 0.849);
  assert.ok(refined.width < 0.11);
  assert.ok(refined.y > 0.76);
  assert.ok(refined.height < 0.2);
});

test("style rediscovery opens from the first of three consecutive bad locked pages", () => {
  const startPage = __planSheetImportTestUtils.findStyleRediscoveryStartPage([
    {
      pageNumber: 89,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "E0.01",
      sheetTitle: "ELECTRICAL SITE PLAN",
      badForStyleRediscovery: false,
    },
    {
      pageNumber: 90,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "E0.01A",
      sheetTitle: "ELECTRICAL DETAILS",
      badForStyleRediscovery: false,
    },
    {
      pageNumber: 91,
      selectionDecision: "no_branch_selected",
      rejectReason: "ocr_off_compact_stamp_family",
      selectionGateFailures: ["ocr_off_compact_stamp_family", "no_selection_branch"],
      sheetNumber: "",
      sheetTitle: "",
      badForStyleRediscovery: true,
    },
    {
      pageNumber: 92,
      selectionDecision: "no_branch_selected",
      rejectReason: "ocr_off_compact_stamp_family",
      selectionGateFailures: ["ocr_off_compact_stamp_family", "no_selection_branch"],
      sheetNumber: "",
      sheetTitle: "",
      badForStyleRediscovery: true,
    },
    {
      pageNumber: 93,
      selectionDecision: "no_branch_selected",
      rejectReason: "ocr_off_compact_stamp_family",
      selectionGateFailures: ["ocr_off_compact_stamp_family", "no_selection_branch"],
      sheetNumber: "",
      sheetTitle: "",
      badForStyleRediscovery: true,
    },
  ]);

  assert.equal(startPage, 91);
});

test("style rediscovery does not open for isolated one-off bad pages", () => {
  const startPage = __planSheetImportTestUtils.findStyleRediscoveryStartPage([
    {
      pageNumber: 54,
      selectionDecision: "no_branch_selected",
      rejectReason: "ocr_title_rejected",
      selectionGateFailures: ["ocr_title_rejected", "no_selection_branch"],
      sheetNumber: "",
      sheetTitle: "",
      badForStyleRediscovery: true,
    },
    {
      pageNumber: 55,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "A8.31",
      sheetTitle: "DOOR DETAILS",
      badForStyleRediscovery: false,
    },
    {
      pageNumber: 56,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "A8.32",
      sheetTitle: "INTERIOR DETAILS",
      badForStyleRediscovery: false,
    },
  ]);

  assert.equal(startPage, null);
});

test("style rediscovery opens on a streak of suspicious locked crop alignment before pages go blank", () => {
  const lockedRegionPattern = {
    patternId: "style-1",
    styleId: "bottom_right_block:sheetStamp:titleBlock",
    styleProfile: "bottom_right_block",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    numberBox: { x: 0.9175, y: 0.9483, width: 0.0538, height: 0.0353 },
    titleBox: { x: 0.912, y: 0.8446, width: 0.0739, height: 0.1033 },
    supportPages: 4,
    hitCount: 4,
    lastUsedPage: 4,
  };

  const diagnostics = [
    {
      pageNumber: 90,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "E0.01",
      sheetTitle: "LIGHTING PLAN",
      badForStyleRediscovery: false,
    },
    {
      pageNumber: 91,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "E0.02",
      sheetTitle: "FIXTURE SCHEDULE",
      badForStyleRediscovery: false,
    },
    {
      pageNumber: 92,
      selectionDecision: "selected_ocr_only_usable_pair",
      rejectReason: null,
      selectionGateFailures: [],
      sheetNumber: "E1.00",
      sheetTitle: "SITE PLAN",
      badForStyleRediscovery: false,
    },
  ];

  const pdfTextResults = new Map([
    [
      90,
      {
        sheetNumber: "E0.01",
        sheetTitle: "LIGHTING PLAN",
        numberSourceText: "E0.01",
        titleSourceText: "LIGHTING PLAN",
        confidence: 0.91,
        score: 400,
        numberBox: { x: 0.904, y: 0.944, width: 0.05, height: 0.03 },
        titleBox: { x: 0.895, y: 0.846, width: 0.06, height: 0.08 },
      },
    ],
    [
      91,
      {
        sheetNumber: "E0.02",
        sheetTitle: "FIXTURE SCHEDULE",
        numberSourceText: "E0.02",
        titleSourceText: "FIXTURE SCHEDULE",
        confidence: 0.91,
        score: 400,
        numberBox: { x: 0.903, y: 0.944, width: 0.051, height: 0.03 },
        titleBox: { x: 0.894, y: 0.846, width: 0.061, height: 0.08 },
      },
    ],
    [
      92,
      {
        sheetNumber: "E1.00",
        sheetTitle: "SITE PLAN",
        numberSourceText: "E1.00",
        titleSourceText: "SITE PLAN",
        confidence: 0.91,
        score: 400,
        numberBox: { x: 0.902, y: 0.944, width: 0.051, height: 0.03 },
        titleBox: { x: 0.893, y: 0.846, width: 0.06, height: 0.08 },
      },
    ],
  ]);

  const startPage = __planSheetImportTestUtils.findStyleRediscoveryStartPage(
    diagnostics,
    {
      pdfTextResults,
      lockedRegionPattern,
    }
  );

  assert.equal(startPage, 90);
});

test("locked OCR scan plans suppress broad fallback until rediscovery opens", () => {
  const plans = __planSheetOcrTestUtils.buildOcrRecognitionScanPlans({
    preferredStyleProfile: "bottom_right_block",
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
    },
    allowExtendedFallback: false,
    allowSecondaryFallback: false,
  });

  assert.deepEqual(plans.extendedFallbackScanPlan, []);
  assert.deepEqual(plans.secondaryScanPlan, []);
});

test("stable locked OCR candidates skip local expansion and neighborhood fallback", () => {
  const lockedOptions = {
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
    },
    debugState: {
      mode: "locked",
    },
  };

  const strongCandidate = {
    sheetNumber: "A2.04",
    sheetTitle: "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
    numberSourceText: "A2.04",
    titleSourceText: "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
    regionId: "sheetStamp",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    styleProfile: "bottom_right_block",
    numberScore: 92,
    titleScore: 116,
    score: 272,
  };

  assert.equal(
    __planSheetOcrTestUtils.shouldRunLocalExpansionStage(strongCandidate, lockedOptions),
    false
  );
  assert.equal(
    __planSheetOcrTestUtils.shouldRunLockedPatternFallbackStage(strongCandidate, lockedOptions),
    false
  );
});

test("locked OCR pages still open local rescue stages for weak primary candidates", () => {
  const lockedOptions = {
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
    },
    debugState: {
      mode: "locked",
    },
  };

  const weakCandidate = {
    sheetNumber: "A2.04",
    sheetTitle: "FLOOR PLAN",
    numberSourceText: "A2.04",
    titleSourceText: "FLOOR PLAN",
    regionId: "sheetStamp",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    styleProfile: "bottom_right_block",
    numberScore: 46,
    titleScore: 60,
    score: 178,
  };

  assert.equal(
    __planSheetOcrTestUtils.shouldRunLocalExpansionStage(weakCandidate, lockedOptions),
    true
  );
  assert.equal(
    __planSheetOcrTestUtils.shouldRunLockedPatternFallbackStage(null, lockedOptions),
    true
  );
});

test("locked OCR local expansion opens for clipped locked titles even before broad fallback", () => {
  const lockedOptions = {
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
    },
    debugState: {
      mode: "locked",
    },
  };

  const clippedCandidate = {
    sheetNumber: "S2.04",
    sheetTitle: "FOUNDATION AND",
    numberSourceText: "S2.04",
    titleSourceText: "FOUNDATION AND",
    regionId: "sheetStamp",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    styleProfile: "bottom_right_block",
    numberScore: 82,
    titleScore: 92,
    score: 246,
  };

  assert.equal(
    __planSheetOcrTestUtils.shouldRunLocalExpansionStage(clippedCandidate, lockedOptions),
    true
  );
});

test("locked OCR local expansion opens for short generic locked titles that may have dropped upper lines", () => {
  const lockedOptions = {
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
    },
    debugState: {
      mode: "locked",
    },
  };

  const shortGenericCandidate = {
    sheetNumber: "C1.2",
    sheetTitle: "DRAINAGE PLAN",
    numberSourceText: "C1.2",
    titleSourceText: "DRAINAGE\nPLAN",
    regionId: "sheetStamp",
    numberRegion: "sheetStamp",
    titleRegion: "titleBlock",
    styleProfile: "bottom_right_block",
    numberScore: 96,
    titleScore: 102,
    score: 240,
  };

  assert.equal(
    __planSheetOcrTestUtils.shouldRunLocalExpansionStage(shortGenericCandidate, lockedOptions),
    true
  );
});

test("locked OCR scan plans add adaptive local title and number variants around the learned lock", () => {
  const plans = __planSheetOcrTestUtils.buildOcrRecognitionScanPlans({
    preferredStyleProfile: "bottom_right_block",
    lockedRegionPattern: {
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberBox: { x: 0.934, y: 0.921, width: 0.046, height: 0.025 },
      titleBox: { x: 0.79, y: 0.778, width: 0.204, height: 0.162 },
    },
  });

  assert.deepEqual(
    plans.localExpansionScanPlan.map((step) => step.scanKey ?? step.regionId),
    ["locked-number-left", "locked-title-tall"]
  );
  assert.equal(plans.localExpansionScanPlan[0].customBox.x < 0.934, true);
  assert.equal(plans.localExpansionScanPlan[0].customBox.width < 0.046, true);
  assert.equal(plans.localExpansionScanPlan[1].customBox.y < 0.81, true);
  assert.equal(plans.localExpansionScanPlan[1].customBox.height > 0.18, true);
});

test("locked OCR builds a mixed dedicated number/title pair from the locked scans", () => {
  const candidate = __planSheetOcrTestUtils.buildLockedMixedClusterFromScans(
    [
      {
        scanKey: "locked-number-expanded",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["G0.00"],
        structuredLines: [
          {
            sequence: 0,
            text: "G0.00",
            confidence: 92,
            normX: 0.918,
            normY: 0.948,
            normWidth: 0.05,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "G0.00",
        weight: 372,
        box: { x: 0.91, y: 0.94, width: 0.07, height: 0.05 },
      },
      {
        scanKey: "locked-title",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["COVER, DRAWING", "INDEX, SYMBOLS"],
        structuredLines: [
          {
            sequence: 0,
            text: "COVER, DRAWING",
            confidence: 90,
            normX: 0.912,
            normY: 0.844,
            normWidth: 0.08,
            normHeight: 0.03,
          },
          {
            sequence: 1,
            text: "INDEX, SYMBOLS",
            confidence: 90,
            normX: 0.912,
            normY: 0.878,
            normWidth: 0.08,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "COVER, DRAWING\nINDEX, SYMBOLS",
        weight: 175,
        box: { x: 0.9, y: 0.84, width: 0.09, height: 0.09 },
      },
    ],
    {
      edgeNumberCandidates: ["G0.00"],
      edgeLineTexts: ["G0.00 COVER, DRAWING INDEX, SYMBOLS"],
    },
    {
      debugState: {
        mode: "locked",
      },
    }
  );

  assert.equal(candidate?.sheetNumber, "G0.00");
  assert.equal(candidate?.sheetTitle, "COVER, DRAWING INDEX, SYMBOLS");
  assert.equal(candidate?.numberRegion, "sheetStamp");
  assert.equal(candidate?.titleRegion, "titleBlock");
});

test("locked OCR prefers a taller local title crop when the primary title is clipped", () => {
  const candidate = __planSheetOcrTestUtils.buildLockedMixedClusterFromScans(
    [
      {
        scanKey: "locked-number",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["S2.01"],
        structuredLines: [
          {
            sequence: 0,
            text: "S2.01",
            confidence: 92,
            normX: 0.918,
            normY: 0.948,
            normWidth: 0.05,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "S2.01",
        weight: 372,
        box: { x: 0.91, y: 0.94, width: 0.07, height: 0.05 },
      },
      {
        scanKey: "locked-title",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["FOUNDATION AND"],
        structuredLines: [
          {
            sequence: 0,
            text: "FOUNDATION AND",
            confidence: 88,
            normX: 0.9,
            normY: 0.89,
            normWidth: 0.1,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "FOUNDATION AND",
        weight: 175,
        box: { x: 0.82, y: 0.84, width: 0.16, height: 0.09 },
      },
      {
        scanKey: "locked-title-tall",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["BUILDING 2 -", "FOUNDATION AND", "ROOF FRAMING PLANS"],
        structuredLines: [
          {
            sequence: 0,
            text: "BUILDING 2 -",
            confidence: 90,
            normX: 0.89,
            normY: 0.82,
            normWidth: 0.1,
            normHeight: 0.02,
          },
          {
            sequence: 1,
            text: "FOUNDATION AND",
            confidence: 90,
            normX: 0.89,
            normY: 0.86,
            normWidth: 0.11,
            normHeight: 0.02,
          },
          {
            sequence: 2,
            text: "ROOF FRAMING PLANS",
            confidence: 92,
            normX: 0.89,
            normY: 0.9,
            normWidth: 0.13,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "BUILDING 2 -\nFOUNDATION AND\nROOF FRAMING PLANS",
        weight: 175,
        box: { x: 0.79, y: 0.78, width: 0.2, height: 0.16 },
      },
    ],
    {
      edgeNumberCandidates: ["S2.01"],
      edgeLineTexts: ["S2.01 BUILDING 2 - FOUNDATION AND ROOF FRAMING PLANS"],
    },
    {
      debugState: {
        mode: "local_expansion",
      },
    }
  );

  assert.equal(candidate?.sheetNumber, "S2.01");
  assert.equal(candidate?.sheetTitle, "BUILDING 2 - FOUNDATION AND ROOF FRAMING PLANS");
});

test("locked OCR prefers a tighter local title crop when broader crops pull in junk", () => {
  const candidate = __planSheetOcrTestUtils.buildLockedMixedClusterFromScans(
    [
      {
        scanKey: "locked-number",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["A8.30"],
        structuredLines: [
          {
            sequence: 0,
            text: "A8.30",
            confidence: 92,
            normX: 0.918,
            normY: 0.948,
            normWidth: 0.05,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "A8.30",
        weight: 372,
        box: { x: 0.91, y: 0.94, width: 0.07, height: 0.05 },
      },
      {
        scanKey: "locked-title-expanded",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["WINDOW DETAILS", "PIPE AT EXTERIOR WALL 37"],
        structuredLines: [
          {
            sequence: 0,
            text: "WINDOW DETAILS",
            confidence: 90,
            normX: 0.89,
            normY: 0.86,
            normWidth: 0.11,
            normHeight: 0.02,
          },
          {
            sequence: 1,
            text: "PIPE AT EXTERIOR WALL 37",
            confidence: 78,
            normX: 0.89,
            normY: 0.9,
            normWidth: 0.15,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "WINDOW DETAILS\nPIPE AT EXTERIOR WALL 37",
        weight: 175,
        box: { x: 0.79, y: 0.82, width: 0.2, height: 0.16 },
      },
      {
        scanKey: "locked-title-tight",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["WINDOW DETAILS"],
        structuredLines: [
          {
            sequence: 0,
            text: "WINDOW DETAILS",
            confidence: 92,
            normX: 0.9,
            normY: 0.88,
            normWidth: 0.1,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "WINDOW DETAILS",
        weight: 175,
        box: { x: 0.84, y: 0.85, width: 0.13, height: 0.08 },
      },
    ],
    {
      edgeNumberCandidates: ["A8.30"],
      edgeLineTexts: ["A8.30 WINDOW DETAILS"],
    },
    {
      debugState: {
        mode: "local_expansion",
      },
    }
  );

  assert.equal(candidate?.sheetNumber, "A8.30");
  assert.equal(candidate?.sheetTitle, "WINDOW DETAILS");
});

test("locked OCR prefers merged structured titles from the locked title scan over shorter fragments", () => {
  const candidate = __planSheetOcrTestUtils.buildLockedMixedClusterFromScans(
    [
      {
        scanKey: "locked-number",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["C1.2"],
        structuredLines: [
          {
            sequence: 0,
            text: "C1.2",
            confidence: 92,
            normX: 0.918,
            normY: 0.948,
            normWidth: 0.05,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "C1.2",
        weight: 372,
        box: { x: 0.91, y: 0.94, width: 0.07, height: 0.05 },
      },
      {
        scanKey: "locked-title",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["DRAWING TITLE", "GRADING AND", "DRAINAGE", "PLAN"],
        structuredLines: [
          {
            sequence: 0,
            text: "DRAWING TITLE",
            confidence: 82,
            normX: 0.92,
            normY: 0.83,
            normWidth: 0.07,
            normHeight: 0.02,
          },
          {
            sequence: 1,
            text: "GRADING AND",
            confidence: 88,
            normX: 0.92,
            normY: 0.86,
            normWidth: 0.07,
            normHeight: 0.02,
          },
          {
            sequence: 2,
            text: "DRAINAGE",
            confidence: 92,
            normX: 0.92,
            normY: 0.89,
            normWidth: 0.07,
            normHeight: 0.02,
          },
          {
            sequence: 3,
            text: "PLAN",
            confidence: 92,
            normX: 0.92,
            normY: 0.92,
            normWidth: 0.05,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "DRAWING TITLE\nGRADING AND\nDRAINAGE\nPLAN",
        weight: 175,
        box: { x: 0.89, y: 0.82, width: 0.11, height: 0.16 },
      },
    ],
    {
      edgeNumberCandidates: ["C1.2"],
      edgeLineTexts: ["C1.2 GRADING AND DRAINAGE PLAN"],
    },
    {
      debugState: {
        mode: "locked",
      },
    }
  );

  assert.equal(candidate?.sheetNumber, "C1.2");
  assert.equal(candidate?.sheetTitle, "GRADING AND DRAINAGE PLAN");
  assert.equal(candidate?.numberRegion, "sheetStamp");
  assert.equal(candidate?.titleRegion, "titleBlock");
});

test("locked OCR ignores expanded-number regressions when the primary locked scan already found a more specific compatible number", () => {
  const candidate = __planSheetOcrTestUtils.buildLockedMixedClusterFromScans(
    [
      {
        scanKey: "locked-number",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["I C 2.1"],
        structuredLines: [
          {
            sequence: 0,
            text: "I C 2.1",
            confidence: 70,
            normX: 0.918,
            normY: 0.948,
            normWidth: 0.06,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "I C 2.1",
        weight: 372,
        box: { x: 0.89, y: 0.93, width: 0.09, height: 0.06 },
      },
      {
        scanKey: "locked-number-expanded",
        regionId: "sheetStamp",
        familyId: "bottom_right_strip",
        role: "full",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["C21"],
        structuredLines: [
          {
            sequence: 0,
            text: "C21",
            confidence: 92,
            normX: 0.91,
            normY: 0.948,
            normWidth: 0.04,
            normHeight: 0.03,
          },
        ],
        pageStructuredLines: [],
        rawText: "C21",
        weight: 372,
        box: { x: 0.88, y: 0.92, width: 0.12, height: 0.08 },
      },
      {
        scanKey: "locked-title",
        regionId: "titleBlock",
        familyId: "bottom_right_block",
        role: "title",
        rotation: "normal",
        fallbackOnly: false,
        lines: ["DRAWING TITLE", "CIVIL DETAILS"],
        structuredLines: [
          {
            sequence: 0,
            text: "DRAWING TITLE",
            confidence: 80,
            normX: 0.92,
            normY: 0.84,
            normWidth: 0.07,
            normHeight: 0.02,
          },
          {
            sequence: 1,
            text: "CIVIL DETAILS",
            confidence: 92,
            normX: 0.92,
            normY: 0.89,
            normWidth: 0.08,
            normHeight: 0.02,
          },
        ],
        pageStructuredLines: [],
        rawText: "DRAWING TITLE\nCIVIL DETAILS",
        weight: 175,
        box: { x: 0.89, y: 0.82, width: 0.11, height: 0.15 },
      },
    ],
    {
      edgeNumberCandidates: ["C2.1"],
      edgeLineTexts: ["C2.1 CIVIL DETAILS"],
    },
    {
      debugState: {
        mode: "locked",
      },
    }
  );

  assert.equal(candidate?.sheetNumber, "C2.1");
  assert.equal(candidate?.sheetTitle, "CIVIL DETAILS");
});

test("localized pdf in the locked number box rescues punctuation-only sheet-number drift", () => {
  const result = __planSheetImportTestUtils.applyLocalizedPdfNumberToOcrResult({
    page: {
      pageNumber: 3,
      lines: [
        {
          text: "C1.1",
          items: [],
          x: 0,
          top: 0,
          width: 1,
          height: 1,
          normX: 0.92,
          normY: 0.948,
          normWidth: 0.04,
          normHeight: 0.02,
        },
      ],
      candidates: [],
    },
    ocrResult: {
      sheetNumber: "C1-1",
      sheetTitle: "DRAINAGE PLAN",
      numberSourceText: "C 1 - 1",
      titleSourceText: "DRAINAGE\nPLAN",
      confidence: 1,
      score: 256,
      styleProfile: "bottom_right_block",
      numberRegion: "sheetStamp",
      titleRegion: "titleBlock",
      numberScore: 18,
      titleScore: 112,
      numberBox: {
        x: 0.916,
        y: 0.948,
        width: 0.047,
        height: 0.033,
      },
      titleBox: null,
      rejectReason: null,
    },
    exactCounts: {},
    prefixCounts: {},
  });

  assert.equal(result?.sheetNumber, "C1.1");
});

test("refines spaced line-text sheet numbers into the more specific compatible form", () => {
  assert.equal(
    __planSheetImportTestUtils.refineSheetNumberCandidateFromLineText(
      "C21",
      "I C 2.1"
    ),
    "C2.1"
  );
});

test("localized pdf in the locked number box beats suspicious scale-text OCR reads", () => {
  const result = __planSheetImportTestUtils.applyLocalizedPdfNumberToOcrResult({
    page: {
      pageNumber: 1,
      lines: [
        {
          text: "C:\\Users\\test\\file.rvt G0.00",
          items: [],
          x: 0,
          top: 0,
          width: 1,
          height: 1,
          normX: 0.915,
          normY: 0.944,
          normWidth: 0.08,
          normHeight: 0.02,
        },
      ],
      candidates: [],
    },
    ocrResult: {
      sheetNumber: "1W0",
      sheetTitle: "COVER, DRAWING INDEX, SYMBOLS",
      numberSourceText: "SCALE T=1w0",
      titleSourceText: "COVER, DRAWING\nINDEX, SYMBOLS",
      confidence: 1,
      score: 495,
      styleProfile: "bottom_right_block",
      numberRegion: "titleBlock",
      titleRegion: "titleBlock",
      numberScore: 100,
      titleScore: 196,
      numberBox: {
        x: 0.916,
        y: 0.934,
        width: 0.056,
        height: 0.02,
      },
      titleBox: null,
      rejectReason: null,
    },
    exactCounts: {},
    prefixCounts: {},
  });

  assert.equal(result?.sheetNumber, "G0.00");
});

test("suppresses direct pdf pair wins for generic plan-family titles", () => {
  assert.equal(
    __planSheetImportTestUtils.shouldSuppressDirectPdfPairSelection({
      pdfTitleText: "BUILDING 6 - FLOOR PLAN",
      ocrPairUsable: true,
      ocrTitleText: "BUILDING 6 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
    }),
    true
  );

  assert.equal(
    __planSheetImportTestUtils.shouldSuppressDirectPdfPairSelection({
      pdfTitleText: "ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS",
      ocrPairUsable: false,
      ocrTitleText: "",
    }),
    false
  );
});

test("retries the remaining OCR batch without a seed only after catastrophic seeded failure", () => {
  assert.equal(
    __planSheetImportTestUtils.shouldRetryRemainingOcrWithoutSeed({
      seededLockedRegionPattern: {
        patternId: "style-1",
        styleId: "bottom_right_block:sheetStamp:titleBlock",
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: null,
        titleBox: null,
        supportPages: 4,
        hitCount: 4,
        lastUsedPage: 4,
      },
      remainingPageCount: 60,
      successfulResultCount: 0,
    }),
    true
  );

  assert.equal(
    __planSheetImportTestUtils.shouldRetryRemainingOcrWithoutSeed({
      seededLockedRegionPattern: {
        patternId: "style-1",
        styleId: "bottom_right_block:sheetStamp:titleBlock",
        styleProfile: "bottom_right_block",
        numberRegion: "sheetStamp",
        titleRegion: "titleBlock",
        numberBox: null,
        titleBox: null,
        supportPages: 4,
        hitCount: 4,
        lastUsedPage: 4,
      },
      remainingPageCount: 60,
      successfulResultCount: 8,
    }),
    false
  );

  assert.equal(
    __planSheetImportTestUtils.shouldRetryRemainingOcrWithoutSeed({
      seededLockedRegionPattern: null,
      remainingPageCount: 60,
      successfulResultCount: 0,
    }),
    false
  );
});

test("penalizes obvious sequence outliers", () => {
  const boost = getSequenceConsistencyBoost(
    createCandidate("A19"),
    1,
    [createCandidate("A2"), createCandidate("A3"), null]
  );

  assert.ok(boost < 0);
});

test("supports coherent sequence candidates", () => {
  const boost = getSequenceConsistencyBoost(
    createCandidate("A1"),
    1,
    [createCandidate("A2"), createCandidate("A3"), null]
  );

  assert.ok(boost > 0);
});

test("classifies a compact lower-right metadata box as bottom-right strip", () => {
  const family = getMetadataBoxFamilyFromBbox({
    x: 0.94,
    y: 0.93,
    width: 0.05,
    height: 0.04,
  });

  assert.equal(family, "bottom_right_strip");
});

test("keeps slightly higher compact lower-right stamps in the strip family", () => {
  const family = getMetadataBoxFamilyFromBbox({
    x: 0.9,
    y: 0.81,
    width: 0.06,
    height: 0.1,
  });

  assert.equal(family, "bottom_right_strip");
});

test("rejects table-like metadata boxes even when they contain title words", () => {
  const rejectReason = getMetadataBoxRejectReason({
    familyId: "bottom_right_block",
    distinctNumberCount: 3,
    titleLikeCount: 3,
    lines: [
      { text: "Sheet Index" },
      { text: "A1 Cover Sheet" },
      { text: "A2 Site Plan" },
      { text: "A3 First & Mezz. Floor Plans" },
    ],
  });

  assert.equal(rejectReason, "table_like_box");
});

test("suppresses repeated project branding as a sheet title", () => {
  const suppressed = isRepeatedProjectBrandingTitle({
    repeatedCount: 5,
    totalPages: 12,
    titleVocabularyHits: 0,
    canonicalBoost: 0,
  });

  assert.equal(suppressed, true);
});

test("treats common compact-stamp words as valid single-line titles", () => {
  assert.equal(isAllowedSingleWordTitle("Ceiling"), true);
  assert.equal(isAllowedSingleWordTitle("Plumbing"), true);
  assert.equal(isAllowedSingleWordTitle("Reflected"), false);
  assert.equal(isAllowedSingleWordTitle("Occupancy"), false);
});

test("recognizes compact-stamp continuation fragments but excludes footer/admin lines", () => {
  assert.equal(isCompactStampContinuationFragment("First &"), true);
  assert.equal(isCompactStampContinuationFragment("Ceiling"), true);
  assert.equal(
    isCompactStampContinuationFragment("CASE # 00632333-PCPM Sheet:"),
    false
  );
  assert.equal(
    isCompactStampContinuationFragment("Original Starter Farmhouse"),
    false
  );
});

test("recognizes metadata footer lines inside compact stamps", () => {
  assert.equal(isMetadataBoxFooterLine("CASE # 00632333-PCPM Sheet:"), true);
  assert.equal(isMetadataBoxFooterLine("Issue Date: 3/11/14"), true);
  assert.equal(isMetadataBoxFooterLine("Plot Date: 12/01/25"), true);
  assert.equal(isMetadataBoxFooterLine("Cover Sheet"), false);
});

test("keeps metadata-box fragments title-like without treating branding as title content", () => {
  assert.equal(isMetadataBoxTitleFragment("Plumbing"), true);
  assert.equal(isMetadataBoxTitleFragment("Cover Sheet"), true);
  assert.equal(isMetadataBoxTitleFragment("CASE # 00632333-PCPM"), false);
  assert.equal(matchesProjectBrandingVocabulary("Original Starter Farmhouse"), true);
  assert.equal(matchesProjectBrandingVocabulary("MHOUSE PLANS"), true);
});

test("counts title vocabulary hits for stacked compact titles", () => {
  assert.ok(countTitleVocabularyHits("First & Mezz. Floor Plans") >= 2);
  assert.ok(countTitleVocabularyHits("Plumbing Layout") >= 2);
});

test("treats analysis sheets as title-like content", () => {
  assert.equal(matchesTitleLikeVocabulary("Exit Analysis"), true);
  assert.ok(countTitleVocabularyHits("Exit Analysis Plan") >= 2);
  assert.ok(countTitleVocabularyHits("Fire Alarm Renovation Plan") >= 3);
});

test("normalizes OCR title scaffolding on commercial key-plan sheets", () => {
  assert.equal(
    normalizeOcrTitleCandidateText("KEY PLAN [EXIT ANALYSIS -"),
    "EXIT ANALYSIS -"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("EY PLAN REFLECTED"),
    "REFLECTED"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("evpuan DEMOLITION FLOOR"),
    "DEMOLITION FLOOR"
  );
});

test("enriches OCR titles with complementary building context from pdf number lines", () => {
  assert.equal(
    enrichOcrTitleWithPdfNumberContext({
      ocrTitleText: "DEMOLITION FLOOR PLAN - BUILDINGS A",
      pdfNumberSourceText: "2 DEMOLITION FLOOR PLAN - BUILDING B G A2.01",
      sheetNumber: "A2.01",
      sameNumberAcrossSources: true,
    }),
    "DEMOLITION FLOOR PLAN - BUILDINGS A & B"
  );
});

test("enriches OCR titles from inline pdf number lines when discipline words are missing", () => {
  assert.equal(
    enrichOcrTitleWithPdfNumberContext({
      ocrTitleText: "PROTECTION COVER SHEET",
      pdfNumberSourceText:
        "AFSR AUTOMATIC FIRE SPRINKLER RISER SSU STANDARD SPRAY UPRIGHT FP0.01 FIRE PROTECTION COVER SHEET",
      sheetNumber: "FP0.01",
      sameNumberAcrossSources: true,
    }),
    "FIRE PROTECTION COVER SHEET"
  );
});

test("restores fire protection discipline prefixes from sheet numbers", () => {
  assert.equal(
    enrichOcrTitleWithSheetNumberPrefix({
      ocrTitleText: "PROTECTION COVER SHEET",
      ocrTitleSourceText: "re PROTECTION\nCOVER SHEET",
      sheetNumber: "FP0.01",
    }),
    "FIRE PROTECTION COVER SHEET"
  );
});

test("rescues title sheet names from same-sheet pdf edge lines", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "CIUAS DATE TITLE SHEET",
      ocrTitleSourceText:
        "1oordinaled with he project plans and specifications.\n+ CIUAS DATE\nTITLE SHEET",
      pdfEdgeLineTexts: [
        "@ AT LAM. LAMINATE T1 TITLE SHEET EL2.03 ELECTRICAL DEMOLITION LIGHTING PLAN - BUILDING C (SOUTH)",
      ],
      sheetNumber: "T1",
    }),
    "TITLE SHEET"
  );
});

test("rescues missing fire alarm prefixes from same-sheet pdf edge lines", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "BUILDING D&G - RENOVATION PLAN",
      ocrTitleSourceText:
        "FIRE ALARM\nBUILDING D & G -\nBUILDING D&G -\nRENOVATION PLAN",
      pdfEdgeLineTexts: [
        "A12.06 INTERIOR ELEVATIONS - BUILDING G FA2.08 FIRE ALARM BUILDING D & G - RENOVATION PLAN",
      ],
      sheetNumber: "FA2.08",
    }),
    "FIRE ALARM BUILDING D & G - RENOVATION PLAN"
  );
});

test("rescues typical concrete details from same-sheet pdf edge lines", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "2w DETAILS",
      ocrTitleSourceText: "[1 PICAL CONCRETE\n2w DETAILS",
      pdfEdgeLineTexts: [
        "FIN. FINISH STD. STANDARD ... S5.01 TYPICAL CONCRETE DETAILS",
      ],
      sheetNumber: "S5.01",
    }),
    "TYPICAL CONCRETE DETAILS"
  );
});

test("rescues clipped diagram titles from enumerated Walnut detail edge lines", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "4G DIAGRAM",
      ocrTitleSourceText: "4G DIAGRAM",
      pdfEdgeLineTexts: [
        "1 WIRING DIAGRAM 2 INTERCONNECTIONS WIRING DIAGRAM",
        "3 CABLE TRAYS DETAILS 4 EVO AIR DOOR WIRING DIAGRAM Drwn By JUSTINA",
      ],
      sheetNumber: "E-602",
    }),
    "WIRING DIAGRAM"
  );
});

test("keeps compatible OCR titles when edge context injects conflicting discipline cues", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText:
        "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      ocrTitleSourceText:
        "FLOOR PLAN,\nEXISTINGIREMOVAL\nRUCTION FLOOR PLAN",
      pdfEdgeLineTexts: [
        "ELECTRICAL ENGINEER STRUCTURAL ENGINEER ALTERNATES THE ACCEPTANCE TESTING PROCEDURES MUST BE REPEATED, AND A2.02 BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, P-2.01* PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN,",
      ],
      sheetNumber: "A2.02",
    }),
    "BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "BUILDING 1 - EXTERIOR ELEVATIONS",
      ocrTitleSourceText: "I EXTERIOR\nELEVATIONS\nNOTES",
      pdfEdgeLineTexts: [
        "COPYRIGHT © 2022 HKIT ARCHITECTS A3.01 SCALE: AS INDICATED ELECTRICAL LEGEND, NOTES AND DETAILS DRAWING TITLE ISSUE JOB CAPTAIN CHECKED DRAWN JOB NO.",
      ],
      sheetNumber: "A3.01",
    }),
    "BUILDING 1 - EXTERIOR ELEVATIONS"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "HVAC LEGENDS AND NOTES",
      ocrTitleSourceText: "DRAWING TITLE\nHVAC LEGENDS AND\nNOTES",
      pdfEdgeLineTexts: [
        "P-0.01 PLUMBING LEGENDS, NOTES AND DETAILS M-0.01 HVAC LEGENDS AND NOTES M-0.02 HVAC SCHEDULES",
      ],
      sheetNumber: "M-0.01",
    }),
    "HVAC LEGENDS AND NOTES"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "STRUCTURAL GENERAL NOTES",
      ocrTitleSourceText:
        'wouon sTEmL SECTION var. vemey NED GENERAL NOTES\n" "ORION BCRT\nSener notes',
      pdfEdgeLineTexts: [
        "S1.00 STRUCTURAL GENERAL NOTES APP: 01-120578 INC:",
        "S2.02 BUILDING 2 - FOUNDATION AND ROOF FRAMING PLANS",
        "S2.03 BUILDINGS 3 & 4 - FOUNDATION AND ROOF FRAMING PLANS",
        "S5.01 BUILDINGS 1, 3 & 4 - FOUNDATION DETAILS",
        "S5.02 BUILDING 2 - FOUNDATION DETAILS",
        "S8.02 BUILDING 2 - FRAMING DETAILS",
      ],
      sheetNumber: "S1.00",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
});

test("prefers metadata DETAILS titles over wrapped OCR noise on Walnut detail sheets", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "Te DETAILS Sheet",
      ocrTitleSourceText: "Te\nDETAILS\nSheet",
      pdfEdgeLineTexts: [
        "Issue Date Chckd By Drwn By Scale Building ID: DETAILS Title Project Facility Agency Approval File Name: N/A Issued",
      ],
      sheetNumber: "E-702",
    }),
    "DETAILS"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "VE / MAINTIAN ROOFING DETAILS",
      ocrTitleSourceText: "Title\nVE / MAINTIAN ROOFING DETAILS",
      pdfEdgeLineTexts: [
        "Issue Date Chckd By Drwn By Scale Building ID: DETAILS Title Project Facility Agency Approval File Name: N/A Issued",
      ],
      sheetNumber: "E-704",
    }),
    "DETAILS"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "TION. MAXIMUM DETAILS Sheet 5 -CONDUIT SUPPORT DETAIL",
      ocrTitleSourceText: "TION. MAXIMUM DETAILS\n- Sheet\n5)-CONDUIT SUPPORT DETAIL",
      pdfEdgeLineTexts: [
        "Issue Date Chckd By Drwn By Scale Building ID: DETAILS Title Project Facility Agency Approval File Name: N/A Issued",
      ],
      sheetNumber: "E-705",
    }),
    "DETAILS"
  );
});

test("repairs title sheet OCR source noise", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "CIUAS DATE TITLE SHEET",
      ocrTitleSourceText:
        "1oordinaled with he project plans and specifications.\n+ CIUAS DATE\nTITLE SHEET",
      sheetNumber: "T1",
    }),
    "TITLE SHEET"
  );
});

test("repairs farmhouse cover page and upstairs sheet OCR source noise", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "this work at your own risk. Buildings are N COVER PAGE",
      ocrTitleSourceText:
        "+ this work at your own risk. Buildings are N\nCOVER PAGE",
      sheetNumber: "A0.0",
    }),
    "COVER PAGE"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "AL PLAN UPSTAIRS PLANS GYPSUM WALLBOARD ~~ CEILING, TYPICAL",
      ocrTitleSourceText:
        "'AL PLAN\nAL DESIGN (FINISHED PLANS) UPSTAIRS PLANS\nGYPSUM WALLBOARD ~~\nCEILING, TYPICAL",
      sheetNumber: "A1.2",
    }),
    "UPSTAIRS PLANS"
  );
});

test("repairs fire alarm OCR source prefixes", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "BUILDING D&G - RENOVATION PLAN",
      ocrTitleSourceText:
        "FIRE ALARM\nBUILDING D & G -\nBUILDING D&G -\nRENOVATION PLAN",
      sheetNumber: "FA2.08",
    }),
    "FIRE ALARM - BUILDING D&G - RENOVATION PLAN"
  );
});

test("repairs fire alarm demolition OCR source prefixes", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "BUILDING C NORTH DEMOLITION PLAN",
      ocrTitleSourceText:
        "FIRE ALARM\nBUILDING C NORTH\nBUILDING C NORTH\n- DEMOLITION PLAN",
      sheetNumber: "FA2.02",
    }),
    "FIRE ALARM - BUILDING C NORTH DEMOLITION PLAN"
  );
});

test("repairs structural and electrical title cleanup from OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "P-2.02",
      ocrTitleSourceText:
        "DRAWING TITLE\nCOVER DRAWING INDEX ABBREVIATIONS",
      sheetNumber: "G-0.00",
    }),
    "COVER, DRAWING, INDEX, ABBREVIATIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "SEPARTE COVER, DRAWING CONCURRENT INDEX, Je COVER, DRAWING",
      ocrTitleSourceText:
        "SEPARTE COVER, DRAWING\nCONCURRENT INDEX,\nJe\nCOVER, DRAWING",
      sheetNumber: "G0.00",
    }),
    "COVER, DRAWING, INDEX, ABBREVIATIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "EES, =5 EXTERIOR ELEVATIONS",
      ocrTitleSourceText: "EXTERIOR\nELEVATIONS",
      sheetNumber: "A3.01",
    }),
    "EXTERIOR ELEVATIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "STRUCTURAL GENERAL NOTES",
      ocrTitleSourceText: "DRAWING TITLE\nSTRUCTURAL\nGENERAL NOTES",
      sheetNumber: "S1.01",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "HARDWARE SCHEDULES DOOR AND. SCHEDULES",
      ocrTitleSourceText: "HARDWARE SCHEDULES\nDOOR AND.\nSCHEDULES",
      sheetNumber: "A10.10",
    }),
    "DOOR AND HARDWARE SCHEDULES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ELECTRICAL LEGEND, NOTES",
      ocrTitleSourceText: "DRAWING TITLE\nELECTRICAL LEGEND, NOTES",
      sheetNumber: "E0.01",
    }),
    "ELECTRICAL LEGEND, NOTES AND DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "LIGHTING FIXTURE SCHEDULE, NOTES SRG Frum SCHEDULE, NOTES.",
      ocrTitleSourceText: "LIGHTING FIXTURE SCHEDULE, NOTES SRG Frum SCHEDULE, NOTES.",
      sheetNumber: "E0.02",
    }),
    "ELECTRICAL LIGHTING FIXTURE SCHEDULE, NOTES AND DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ELECTRICAL SITE PLAN SIE PLAN",
      ocrTitleSourceText: "ELECTRICAL SITE PLAN SIE PLAN",
      sheetNumber: "E1.00",
    }),
    "ELECTRICAL SITE PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "GENERAL NOTES ORION BCRT Sener notes",
      ocrTitleSourceText:
        "wouon sTEmL SECTION var. vemey NED GENERAL NOTES\n\" \"ORION BCRT\nSener notes",
      sheetNumber: "S1.00",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "STRUCTURAL GENERAL rerun NOTES",
      ocrTitleSourceText: "STRUCTURAL GENERAL\n= rerun NOTES",
      sheetNumber: "S1.01",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "MGMSTDETBATS RMS ELDRED STD NOTES",
      ocrTitleSourceText: "MGMSTDETBATS RMS ELDRED STD NOTES",
      sheetNumber: "S1.00",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DRAWING TITLE",
      ocrTitleSourceText: "HVAC - BUILDING 6\nFLOOR PLAN",
      sheetNumber: "M2.04",
    }),
    "HVAC - BUILDING 6 FLOOR PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "F w PORTABLES - FLOOR FLUUK PLAN LEGEND",
      ocrTitleSourceText: "=F w PORTABLES - FLOOR\nFLUUK PLAN LEGEND",
      sheetNumber: "A2.05",
    }),
    "PORTABLES - FLOOR PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "F w BUILDING 2 ROOF Er KEY PLAN",
      ocrTitleSourceText: "=F w BUILDING 2 ROOF\nEr\nKEY PLAN",
      sheetNumber: "A2.11",
    }),
    "BUILDING 2 ROOF PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ROOF PLAN LEGEND - CONSTRUCTION",
      ocrTitleSourceText: "ROOF PLAN LEGEND - CONSTRUCTION\noc eEa ror",
      sheetNumber: "A2.13",
    }),
    "BUILDING 4 AND 5 - ROOF PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "OL DIAGRAM 2 HVAC SCHEDULES",
      ocrTitleSourceText: "OL DIAGRAM 2\nHVAC SCHEDULES",
      sheetNumber: "M0.02",
    }),
    "HVAC SCHEDULES AND DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "EE = 73 3 FLOOR PLANS",
      ocrTitleSourceText: "EE = 73 3 FLOOR PLANS",
      sheetNumber: "M2.02",
    }),
    "HVAC - BUILDING 2 AND 3 FLOOR PLANS"
  );
});

test("repairs benchmark OCR titles from clipped restroom, finish, and electrical context", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "RE I D ELEVATION, SECTION SITE RAMP, PARKING",
      ocrTitleSourceText:
        "ng RE I] [D ELEVATION, SECTION\nSITE RAMP, PARKING",
      sheetNumber: "A1.11",
    }),
    "SITE, RAMP, PARKING - ENLARGED PLANS, ELEVATION, SECTION"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText:
        "ISSUE DISPENSER COMPARTMENTS E MOUNT SEAT COVER BOBRICK PLANS & ELEVATIONS",
      ocrTitleSourceText:
        "[ISSUE DISPENSER [COMPARTMENTS\nE MOUNT SEAT COVER [BOBRICK\nPLANS & ELEVATIONS",
      sheetNumber: "A4.04",
    }),
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "REMOVED TO STUDS GEERT INTERIOR FINISH SCHEDULE LEGEND",
      ocrTitleSourceText:
        "REMOVED TO STUDS GEERT INTERIOR FINISH SCHEDULE\nLEGEND",
      sheetNumber: "A4.06",
    }),
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "AZ EXTERIOR FINISH, Fr SIGNAGE SCHEDULES",
      ocrTitleSourceText: "AZ EXTERIOR FINISH,\nFr SIGNAGE\nSCHEDULES",
      sheetNumber: "A10.20",
    }),
    "INTERIOR AND EXTERIOR FINISH, SIGNAGE SCHEDULES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ENLARGED Restrooms EXISTING / REMOVAL",
      ocrTitleSourceText: "ENERRGED Restrooms\nEXISTING / REMOVAL",
      sheetNumber: "E4.01",
    }),
    "ELECTRICAL ENLARGED RESTROOMS EXISTING / REMOVAL AND CONSTRUCTION PLANS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "Uo 1-5 ENLARGED",
      ocrTitleSourceText:
        "DRAWING TITLE\nENLARGED ELECTRICAL RESTROOM REMOVAL AND CONSTRUCTION AND FIRE ALARM",
      sheetNumber: "E4.02",
    }),
    "ENLARGED ELECTRICAL RESTROOM REMOVAL AND CONSTRUCTION AND FIRE ALARM"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "ELECTRICAL FIRE ALARM",
      ocrTitleSourceText:
        "DRAWING TITLE\nELECTRICAL FIRE ALARM ADDRESS LISTS",
      sheetNumber: "E5.02",
    }),
    "ELECTRICAL FIRE ALARM ADDRESS LISTS"
  );
});

test("treats recovered RCP titles as usable OCR titles", () => {
  assert.equal(
    isUsableRecoveredOcrTitle(
      "BUILDING 3 - EXISTING/REMOVAL RCP. CONSTRUCTION RCP"
    ),
    true
  );
  assert.ok(
    countTitleVocabularyHits(
      "BUILDING 3 - EXISTING/REMOVAL RCP. CONSTRUCTION RCP"
    ) >= 3
  );
});

test("repairs benchmark OCR detail titles from clipped source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "5). EXTERIOR THRESHOLD",
      ocrTitleSourceText: "5). EXTERIOR THRESHOLD",
      sheetNumber: "A8.00",
    }),
    "EXTERIOR DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "STOREFRONT WINDOW SYSTEM, TYP.",
      ocrTitleSourceText: "STOREFRONT WINDOW\nSYSTEM, TYP.",
      sheetNumber: "A8.60",
    }),
    "WINDOW DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "CABINET ANCHORAGE DETAIL INTERIOR DETAILS",
      ocrTitleSourceText: "CABINET ANCHORAGE DETAIL\nINTERIOR DETAILS",
      sheetNumber: "A9.10",
    }),
    "INTERIOR DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DETAILS EXTERIOR ROOF",
      ocrTitleSourceText: "DETAILS\nEXTERIOR ROOF",
      sheetNumber: "A8.00",
    }),
    "EXTERIOR ROOF DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "EANOUT. MATCH ROOF DETAILS DOWNSPOUT MATERIAL",
      ocrTitleSourceText:
        "DRAWING TITLE\nEANOUT. MATCH ROOF DETAILS\nDOWNSPOUT MATERIAL",
      sheetNumber: "A8.01",
    }),
    "ROOF DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "7b EXTERIOR DETAILS N sme",
      ocrTitleSourceText: "[7b EXTERIOR DETAILS\nN sme",
      sheetNumber: "A8.20",
    }),
    "EXTERIOR DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "FINSH COVER FLOOR DISPENSER g",
      ocrTitleSourceText: "FINSH COVER\nFLOOR DISPENSER g",
      sheetNumber: "A9.10",
    }),
    "RESTROOM AND ACCESSIBILITY DETAILS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "SCHEDULES",
      ocrTitleSourceText:
        "BUILDING 2 DOOR AND HARDWARE SCHEDULE WINDOW SCHEDULE GLAZING SCHEDULE SIGNAGE SCHEDULE",
      sheetNumber: "A10.10",
    }),
    "DOOR, WINDOW, GLAZING, AND SIGNAGE SCHEDULES"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DETAILS PLUMBING LEGENDS, NOTES, FIXTURE",
      ocrTitleSourceText:
        "DETAILS\nPLUMBING LEGENDS,\nNOTES, FIXTURE\nSPECIFICATION",
      sheetNumber: "P-0.01",
    }),
    "PLUMBING LEGENDS, NOTES, FIXTURE SPECIFICATION, AND DETAILS"
  );
});

test("repairs clipped typical concrete OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "2w DETAILS",
      ocrTitleSourceText: "[1 PICAL CONCRETE\n2w DETAILS",
      sheetNumber: "S5.01",
    }),
    "TYPICAL CONCRETE DETAILS"
  );
});

test("reorders demolition floor titles from building-first OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "NORTH DEMOLITION FLOOR",
      ocrTitleSourceText: "PLAN - BUILDING C nos (NORTH) DEMOLITION FLOOR",
      sheetNumber: "A2.02",
    }),
    "DEMOLITION FLOOR PLAN - BUILDING C (NORTH)"
  );
});

test("keeps generic exterior elevations and plain RCP titles from over-enriching", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "EXTERIOR ELEVATIONS",
      ocrTitleSourceText: "EES, =5 EXTERIOR\nEXTERIOR\nELEVATIONS",
      pdfEdgeLineTexts: [
        "A3.01 BUILDING 2 - EXTERIOR ELEVATIONS",
        "A3.02 BUILDING 3 - EXTERIOR ELEVATIONS",
      ],
      sheetNumber: "A3.01",
    }),
    "EXTERIOR ELEVATIONS"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "BUILDING 2 - RCP",
      ocrTitleSourceText: "CL ft 1) â€”\n=F w BUILDING 2 - RCP",
      pdfEdgeLineTexts: [
        "A6.01 BUILDING 2 - RCP",
        "A6.02 BUILDING 3 - RCP",
      ],
      sheetNumber: "A6.01",
    }),
    "BUILDING 2 - RCP"
  );
  assert.equal(
    extractCanonicalTitleFromContext(
      "CL F w BUILDING 2 - RCP =F w BUILDING 2 - RCP"
    ),
    "BUILDING 2 - RCP"
  );
});

test("repairs reflected ceiling OCR source noise before selection", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "I CEILING PLAN - BUILDINGS D & G",
      ocrTitleSourceText:
        "EY PLAN REFLECTED\nI CEILING PLAN -\nCEILING PLAN -\nBUILDINGS D & G",
      sheetNumber: "A4.04",
    }),
    "REFLECTED CEILING PLAN - BUILDINGS D & G"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "REFLECTED CEILING PLAN -",
      ocrTitleSourceText: "REFLECTED\nREFLECTED\nnos CEILING PLAN -",
      sheetNumber: "A2.12",
    }),
    "REFLECTED CEILING PLAN"
  );
});

test("repairs clipped demolition floor titles from resubmittal footer noise", () => {
assert.equal(
  repairOcrTitleFromSourceText({
    ocrTitleText: "1ST th DEMOLITION",
    ocrTitleSourceText:
      "BLDG DEPT 1ST RESUBMITTAL 08.1123\n1ST th DEMOLITION",
    sheetNumber: "A2.01",
  }),
  "1ST FLOOR DEMOLITION PLAN"
);

assert.equal(
  repairOcrTitleFromSourceText({
    ocrTitleText: "Project Number 1ST th DEMOLITION",
    ocrTitleSourceText: "Project Number\n1ST th DEMOLITION",
    sheetNumber: "A2.01",
  }),
  "1ST FLOOR DEMOLITION PLAN"
);
});

test("repairs leading OCR artifacts on lighting titles", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "I LIGHTING PLAN - BUILDING C NORTH",
      ocrTitleSourceText: "I LIGHTING PLAN -\nBUILDING C NORTH",
      sheetNumber: "EL2.02",
    }),
    "LIGHTING PLAN - BUILDING C NORTH"
  );
});

test("repairs noisy wall section and finish-plan OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText:
        "3 DSA SUB 100212024 3 WALL SECTIONS 2 YALL SECTION GRIDUNE DAS DF 25828 _",
      ocrTitleSourceText:
        "3 DSA SUB 100212024\n3 WALL SECTIONS\n(2)YALL SECTION GRIDUNE DAS DF 25828 _ A8.02",
      sheetNumber: "A8.02",
    }),
    "WALL SECTIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "DSA SUB 100212024 WALL SECTIONS",
      ocrTitleSourceText:
        "3 DSA SUB 100212024\n3 WALL SECTIONS\n(2)YALL SECTION GRIDUNE DAS DF 25828 _ A8.02",
      sheetNumber: "A8.02",
    }),
    "WALL SECTIONS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "BUILDINGS A&B Finish & waLL - BUILDINGS A&B.",
      ocrTitleSourceText:
        "EY PLAN FINISH & WALL\nTYPE PLAN -\nBUILDINGS A&B\nFinish & waLL\nBUILDINGS A&B.",
      sheetNumber: "A3.01A",
    }),
    "FINISH & WALL TYPE PLAN - BUILDINGS A & B"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "FLOOR PLAN - BUILDING KEY PLAN BUILDINGS A&B",
      ocrTitleSourceText:
        "EY PLAN FLOOR PLAN -\nBUILDING KEY PLAN\nBUILDINGS A&B.",
      sheetNumber: "A3.01",
    }),
    "FLOOR PLAN - BUILDINGS A & B"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "BUILDING KEY PLAN ROOF PLAN -",
      ocrTitleSourceText: "BUILDING KEY PLAN\nROOF PLAN -\nEY PLAN ROOF PLAN -",
      sheetNumber: "A5.01",
    }),
    "ROOF PLAN"
  );
});

test("rescues clipped edge-line titles when OCR text ends mid-phrase", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "REFLECTED CEILING PLAN - BUILDINGS D &",
      ocrTitleSourceText:
        "REFLECTED\nCEILING PLAN -\nCEILING PLAN\nBUILDINGS D &",
      pdfEdgeLineTexts: [
        "A2.14 REFLECTED CEILING PLAN - BUILDINGS D & G",
      ],
      sheetNumber: "A2.14",
    }),
    "REFLECTED CEILING PLAN - BUILDINGS D & G"
  );
});

test("rehydrates reflected ceiling qualifiers from a strong pdf title", () => {
  assert.equal(
    enrichOcrTitleWithPdfTitleContext({
      ocrTitleText: "CEILING PLAN - REFLECTED I",
      ocrTitleSourceText: "REFLECTED\nCEILING PLAN -\nREFLECTED I",
      pdfTitleText: "2 DEMOLITION REFLECTED CEILING PLAN - BUILDING B",
      sheetNumber: "A2.11",
    }),
    "DEMOLITION REFLECTED CEILING PLAN - BUILDING B"
  );
  assert.equal(
    enrichOcrTitleWithPdfTitleContext({
      ocrTitleText: "SECTIONS - BUILDING",
      ocrTitleSourceText: "SECTIONS -\nBUILDING\nSECTIONS -",
      pdfTitleText: "SECTIONS - BUILDING A & B",
      sheetNumber: "A7.01",
    }),
    "SECTIONS - BUILDING A & B"
  );
});

test("rehydrates generic reflected ceiling titles from companion floor plans", () => {
  const sheets = enrichDocumentSheetTitlesWithCompanionContext([
    {
      sheetNumber: "A2.02",
      sheetTitle: "DEMOLITION FLOOR PLAN - BUILDING C (NORTH)",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.03",
      sheetTitle: "DEMOLITION FLOOR PLAN - BUILDING C (SOUTH)",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.04",
      sheetTitle: "DEMOLITION FLOOR PLAN - BUILDINGS D & G",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.11",
      sheetTitle: "DEMOLITION REFLECTED CEILING PLAN - BUILDING B",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.12",
      sheetTitle: "REFLECTED CEILING PLAN",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.13",
      sheetTitle: "REFLECTED CEILING PLAN",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.14",
      sheetTitle: "REFLECTED CEILING PLAN - BUILDINGS D &",
      titleSourceKind: "ocr",
    },
  ]);

  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.11")?.sheetTitle,
    "DEMOLITION REFLECTED CEILING PLAN - BUILDING B"
  );
  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.12")?.sheetTitle,
    "DEMOLITION REFLECTED CEILING PLAN - BUILDING C (NORTH)"
  );
  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.13")?.sheetTitle,
    "DEMOLITION REFLECTED CEILING PLAN - BUILDING C (SOUTH)"
  );
  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.14")?.sheetTitle,
    "DEMOLITION REFLECTED CEILING PLAN - BUILDINGS D & G"
  );
});

test("promotes plain ceiling plans to reflected ceiling plans when the series is consistent", () => {
  const sheets = enrichDocumentSheetTitlesWithCompanionContext([
    {
      sheetNumber: "A2.02",
      sheetTitle: "DEMOLITION FLOOR PLAN - BUILDING C (NORTH)",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.03",
      sheetTitle: "DEMOLITION FLOOR PLAN - BUILDING C (SOUTH)",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A4.01",
      sheetTitle: "REFLECTED CEILING PLAN - BUILDINGS A & B",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A4.02",
      sheetTitle: "CEILING PLAN - BUILDING C",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A4.03",
      sheetTitle: "REFLECTED CEILING PLAN - BUILDING C",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A4.04",
      sheetTitle: "REFLECTED CEILING PLAN - BUILDINGS D & G",
      titleSourceKind: "ocr",
    },
  ]);

  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A4.02")?.sheetTitle,
    "REFLECTED CEILING PLAN - BUILDING C (NORTH)"
  );
  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A4.03")?.sheetTitle,
    "REFLECTED CEILING PLAN - BUILDING C (SOUTH)"
  );
});

test("smooths generic repeated plan titles from nearby richer series neighbors", () => {
  const sheets = smoothGenericSeriesTitlesWithNeighborContext([
    {
      sheetNumber: "A2.04",
      sheetTitle: "BUILDING 5 - FLOOR PLAN",
      titleSourceKind: "ocr",
      pageNumber: 12,
    },
    {
      sheetNumber: "A2.05",
      sheetTitle: "BUILDING 6 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      titleSourceKind: "ocr",
      pageNumber: 13,
    },
    {
      sheetNumber: "A2.06",
      sheetTitle: "BUILDING 7 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      titleSourceKind: "ocr",
      pageNumber: 14,
    },
    {
      sheetNumber: "A2.07",
      sheetTitle: "BUILDING 8 - FLOOR PLAN",
      titleSourceKind: "ocr",
      pageNumber: 15,
    },
    {
      sheetNumber: "A2.08",
      sheetTitle: "BUILDING 9 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      titleSourceKind: "ocr",
      pageNumber: 16,
    },
  ]);

  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.04")?.sheetTitle,
    "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    sheets.find((sheet) => sheet.sheetNumber === "A2.07")?.sheetTitle,
    "BUILDING 8 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("canonical final selected sheets preserve locked page titles without document-level smoothing", () => {
  const sheets = __planSheetImportTestUtils.finalizeSelectedPlanSheets([
    {
      sheetNumber: "A2.04",
      sheetTitle:
        "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 12,
      confidence: 1,
      referenceText: "",
      numberSourceText: "A2.04",
      titleSourceText:
        "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
    },
    {
      sheetNumber: "A2.07",
      sheetTitle:
        "BUILDING 8 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 15,
      confidence: 1,
      referenceText: "",
      numberSourceText: "A2.07",
      titleSourceText:
        "BUILDING 8 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
    },
  ]);

  assert.equal(
    sheets[0]?.sheetTitle,
    "BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    sheets[1]?.sheetTitle,
    "BUILDING 8 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("repairs fire alarm OCR numbering and calculations titles", () => {
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("FAO.5", []),
    "FA0.5"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "FIRE ALARM I CALCULATIONS",
      ocrTitleSourceText: "FIRE ALARM\nFIRE ALARM\nI CALCULATIONS",
      sheetNumber: "FA0.5",
    }),
    "FIRE ALARM CALCULATIONS"
  );
});

test("prefers OCR titles when pdf titles are scale stubs missing key modifiers", () => {
  assert.equal(
    shouldPreferOcrTitleOverPdfScaleStub({
      pdfTitleText: "FIRE ALARM SITE PLAN SCALE:",
      ocrTitleText: "FIRE ALARM EXISTING SITE PLAN",
    }),
    true
  );
  assert.equal(
    shouldPreferOcrTitleOverPdfScaleStub({
      pdfTitleText: "FIRE ALARM NAC RISER SCALE:",
      ocrTitleText: "FIRE ALARM NAC RISER DIAGRAM",
    }),
    true
  );
});

test("rescues demolition lighting titles from pdf edge scale stubs", () => {
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "LIGHTING PLAN - BUILDING A &",
      ocrTitleSourceText: "LIGHTING PLAN -\nLIGHTING PLAN -\nBUILDING A &",
      pdfEdgeLineTexts: [
        "BLDG A - DEMOLITION LIGHTING FLOOR PLAN SCALE:",
      ],
      sheetNumber: "EL2.01",
    }),
    "DEMOLITION LIGHTING PLAN - BUILDING A"
  );
  assert.equal(
    enrichOcrTitleWithPdfEdgeLineContext({
      ocrTitleText: "NE DEMOLITION",
      ocrTitleSourceText:
        "+ I ELECTRICAL\nDEMOLITION\nI LIGHTING PLAN -\nNE\nDEMOLITION",
      pdfEdgeLineTexts: [
        "BLDG C NORTH - DEMOLITION LIGHTING FLOOR PLAN SCALE:",
      ],
      sheetNumber: "EL2.02",
    }),
    "DEMOLITION LIGHTING PLAN - BUILDING C NORTH"
  );
});

test("allows strong known-discipline OCR prefixes even when document support is sparse", () => {
  assert.equal(
    shouldAllowUnsupportedOcrPrefix({
      sheetNumber: "T1",
      title: "TITLE SHEET",
      titleScore: 140,
      localized: true,
      matchesCompactStampSignal: true,
    }),
    true
  );
  assert.equal(
    shouldAllowUnsupportedOcrPrefix({
      sheetNumber: "EL2.04",
      title: "LIGHTING PLAN - BUILDING D&G",
      titleScore: 56,
      localized: true,
      matchesCompactStampSignal: true,
    }),
    true
  );
  assert.equal(
    shouldAllowUnsupportedOcrPrefix({
      sheetNumber: "QF401-1A",
      title: "FOODSERVICE EQUIPMENT PLAN",
      titleScore: 90,
      localized: true,
      matchesCompactStampSignal: true,
    }),
    true
  );
  assert.equal(
    shouldAllowUnsupportedOcrPrefix({
      sheetNumber: "AS5.01",
      title: "ROOF PLAN - BUILDING G",
      titleScore: 188,
      localized: true,
      matchesCompactStampSignal: true,
    }),
    false
  );
  assert.equal(
    shouldAllowUnsupportedOcrPrefix({
      sheetNumber: "FAO.5",
      title: "FIRE ALARM",
      titleScore: 187,
      localized: true,
      matchesCompactStampSignal: true,
    }),
    false
  );
});

test("reconciles OCR sheet numbers against accepted anchor numbers", () => {
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("AS5.01", ["A5.01", "A5.02"]),
    "A5.01"
  );
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("A2.06", ["FA2.06", "AD2"]),
    "FA2.06"
  );
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("FAO.4", ["FA0.4"]),
    "FA0.4"
  );
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("G02", ["G0.2"]),
    "G0.2"
  );
  assert.equal(
    reconcileOcrSheetNumberWithAnchorNumbers("QF4011C", ["QF401-1C"]),
    "QF401-1C"
  );
});

test("only prefers single accepted anchors when they refine the OCR number", () => {
  assert.equal(
    choosePreferredSingleAcceptedAnchorNumber({
      singleAcceptedAnchorNumber: "A4.1",
      ocrSheetNumber: "A4",
      ocrNumberScore: 100,
    }),
    "A4.1"
  );
  assert.equal(
    choosePreferredSingleAcceptedAnchorNumber({
      singleAcceptedAnchorNumber: "ACD0004",
      ocrSheetNumber: "E716",
      ocrNumberScore: 136,
    }),
    ""
  );
});

test("preserves starred alternate sheet numbers from compact-stamp context", () => {
  assert.equal(
    promoteAlternateStarSheetNumber({
      sheetNumber: "P-2.01",
      sheetTitle:
        "PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN - ALTERNATE # 3",
      numberSourceText: "P-2.01 *",
      contextText: "P - ALTERNATE #3",
    }),
    "P-2.01*"
  );
  assert.equal(
    promoteAlternateStarSheetNumber({
      sheetNumber: "P-2.01",
      sheetTitle:
        "PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      numberSourceText: "P-2.01 *",
      contextText: "",
    }),
    "P-2.01"
  );
});

test("refines truncated sheet numbers from the source line text", () => {
  assert.equal(
    refineSheetNumberCandidateFromLineText("A3", "A3.01a"),
    "A3.01A"
  );
  assert.equal(
    refineSheetNumberCandidateFromLineText("A3.02", "SHEET NUMBER A3.02.1"),
    "A3.02.1"
  );
  assert.equal(
    refineSheetNumberCandidateFromLineText("A7.01", "A7.01 9' - 6\" WP 47A CEILING PLAN -"),
    "A7.01"
  );
});

test("prefers compatible OCR sheet numbers when they refine truncated anchors", () => {
  assert.equal(
    preferMoreSpecificCompatibleSheetNumber("A3", "A3.01A"),
    "A3.01A"
  );
  assert.equal(
    preferMoreSpecificCompatibleSheetNumber("A3.01", "A3.01A"),
    "A3.01A"
  );
  assert.equal(
    preferMoreSpecificCompatibleSheetNumber("A9.10", "A3.01"),
    "A9.10"
  );
});

test("parses consultant sheet numbers with trailing detail suffixes", () => {
  assert.deepEqual(
    parseSheetNumberParts("QF401-1C"),
    {
      prefix: "QF",
      main: 401,
      sub: null,
      suffix: "",
      detail: "1C",
    }
  );
  assert.deepEqual(
    parseSheetNumberParts("A1.1-B"),
    {
      prefix: "A",
      main: 1,
      sub: 1,
      suffix: "",
      detail: "B",
    }
  );
  assert.deepEqual(
    parseSheetNumberParts("A1.3-D1"),
    {
      prefix: "A",
      main: 1,
      sub: 3,
      suffix: "",
      detail: "D1",
    }
  );
});

test("finalizes OCR titles by normalizing separators and discipline prefixes", () => {
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "FIRE ALARM BUILDING C NORTH DEMOLITION PLAN",
      ocrTitleSourceText:
        "FIRE ALARM\nBUILDING C NORTH\nBUILDING C NORTH\n- DEMOLITION PLAN",
      sheetNumber: "FA2.02",
    }),
    "FIRE ALARM - BUILDING C NORTH DEMOLITION PLAN"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "REFLECTED CEILING PLAN - - BUILDING C",
      ocrTitleSourceText:
        "REFLECTED\nCEILING PLAN -\nCEILING PLAN -\nBUILDING C",
      sheetNumber: "A4.03",
    }),
    "REFLECTED CEILING PLAN - BUILDING C"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "DEMOLITION REFLECTED CEILING PLAN - BASE",
      ocrTitleSourceText: "",
      sheetNumber: "AD-120",
    }),
    "DEMOLITION REFLECTED CEILING PLAN - BASEMENT"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "LIGHTING PLAN - - BUILDING A &",
      ocrTitleSourceText:
        "LIGHTING PLAN -\nLIGHTING PLAN -\nBUILDING A &",
      sheetNumber: "EL2.01",
    }),
    "LIGHTING PLAN - BUILDING A &"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "BUILDING D&G - DEMOLITION PLAN",
      ocrTitleSourceText:
        "FIRE ALARM\nBUILDING D & G -\nBUILDING D&G -\nDEMOLITION PLAN",
      sheetNumber: "FA2.04",
    }),
    "FIRE ALARM - BUILDING D & G - DEMOLITION PLAN"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "BUILDINGS A&B Finish & waLL - BUILDINGS A&B.",
      ocrTitleSourceText:
        "EY PLAN FINISH & WALL\nTYPE PLAN -\nBUILDINGS A&B\nFinish & waLL\nBUILDINGS A&B.",
      sheetNumber: "A3.01A",
    }),
    "FINISH & WALL TYPE PLAN - BUILDINGS A & B"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "DRAWING TITLE HVAC SCHEDULES",
      ocrTitleSourceText: "DRAWING TITLE\nHVAC SCHEDULES",
      sheetNumber: "M-0.02",
    }),
    "HVAC SCHEDULES"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "DRAWING TITLE INTERIOR CEILING DETAILS",
      ocrTitleSourceText: "DRAWING TITLE\nINTERIOR CEILING\nDETAILS",
      sheetNumber: "A9.40",
    }),
    "INTERIOR CEILING DETAILS"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "PLUMBING FIXTURE SCHEDULE - ALTERNATE # 33",
      ocrTitleSourceText:
        "DRAWING TITLE\nPLUMBING FIXTURE\nSCHEDULE\nALTERNATE #3",
      sheetNumber: "P-0.02",
    }),
    "PLUMBING FIXTURE SCHEDULE - ALTERNATE # 3"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText:
        "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION CONSTRUCTION FLOOR PLAN",
      ocrTitleSourceText:
        "EWOUNTED DOUBLE ROLL a PLANS & ELEVATIONS\nISSUE DISPENSER\nLEGEND",
      sheetNumber: "A4.07",
    }),
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "BUILDINGS 1,3 &4- FRAMING DETAILS",
      ocrTitleSourceText: "DRAWING TITLE\nBUILDINGS 1,3 &4-\nFRAMING DETAILS",
      sheetNumber: "S8.01",
    }),
    "BUILDINGS 1, 3 AND 4 - FRAMING DETAILS"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText:
        "ELECTRICAL BUILDING 3, 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      ocrTitleSourceText:
        "ELECTRICAL BUILDING 3 & 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      sheetNumber: "E2.03",
    }),
    "ELECTRICAL BUILDING 3 AND 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText:
        "PLUMBING ENLARGED PLANS BUILDING 5 EXISTING/REMOVAL MEN'S ENLARGED",
      ocrTitleSourceText:
        "PLUMBING\nENLARGED PLANS\n- BUILDING 5 EXISTING/REMOVAL MEN'S ENLARGED",
      sheetNumber: "P-4.01",
    }),
    "PLUMBING ENLARGED PLANS"
  );
  assert.equal(
    finalizeOcrSheetTitle({
      ocrTitleText: "STRUCTURAL GENERAL rerun NOTES",
      ocrTitleSourceText: "STRUCTURAL GENERAL\n= rerun NOTES",
      sheetNumber: "S1.01",
    }),
    "STRUCTURAL GENERAL NOTES"
  );
});

test("accepts strong recovered OCR titles up to eight words and longer structured titles", () => {
  assert.equal(
    isUsableRecoveredOcrTitle(
      "OSHPD STANDARD GYPSUM BOARD CEILING DETAILS - JOIST FRAMING"
    ),
    true
  );
  assert.equal(
    isUsableRecoveredOcrTitle(
      "OSHPD STANDARD GYPSUM BOARD CEILING DETAILS - JOIST FRAMING NORTH"
    ),
    true
  );
  assert.equal(
    isUsableRecoveredOcrTitle(
      "PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
    ),
    true
  );
  assert.equal(
    isUsableRecoveredOcrTitle(
      "ELECTRICAL BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
    ),
    true
  );
  assert.equal(
    isUsableRecoveredOcrTitle(
      "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN"
    ),
    true
  );
});

test("treats structured recovered OCR titles as safe from suspicious-title fallback logic", () => {
  assert.equal(
    isStrongStructuredRecoveredOcrTitle(
      "BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
    ),
    true
  );
  assert.equal(
    isStrongStructuredRecoveredOcrTitle("BUILDINGS 1, 3, 4 - FOUNDATION DETAILS"),
    true
  );
  assert.equal(
    isStrongStructuredRecoveredOcrTitle(
      "PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN - ALTERNATE # 3"
    ),
    true
  );
  assert.equal(
    isStrongStructuredRecoveredOcrTitle(
      "INTERIOR AND EXTERIOR FINISH, SIGNAGE SCHEDULES"
    ),
    true
  );
  assert.equal(isStrongStructuredRecoveredOcrTitle("a \\ FLOOR PLAN"), false);
  assert.equal(
    isStrongStructuredRecoveredOcrTitle("EVE EXT NONSTRUCT PONENT ATTACHMENT"),
    false
  );
});

test("does not treat structural terms inside real sheet titles as standalone annotations", () => {
  assert.equal(
    hasStandaloneStructuralAnnotationVocabulary(
      "OSHPD STANDARD GYPSUM BOARD CEILING DETAILS - JOIST FRAMING"
    ),
    false
  );
  assert.equal(hasStandaloneStructuralAnnotationVocabulary("JOIST STUD COLUMN"), true);
});

test("repairs truncated title 24 OCR titles into forms titles", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "24 -LTI",
      ocrTitleSourceText: "TITLE 24 -LTI",
      sheetNumber: "E6.07",
    }),
    "TITLE 24 - LTI FORMS"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "TITLE 24 -LTI",
      ocrTitleSourceText: "TITLE 24 -LTI FORMS BUILDING D",
      sheetNumber: "E6.07",
    }),
    "TITLE 24 - LTI FORMS BUILDING D"
  );
});

test("recognizes title 24 forms titles as legitimate sheet-title vocabulary", () => {
  assert.equal(
    matchesTitleLikeVocabulary("TITLE 24 - LTI FORMS"),
    true
  );
  assert.ok(
    countTitleVocabularyHits("TITLE 24 - LTI FORMS") >= 2
  );
  assert.equal(
    matchesTitleLikeVocabulary("TITLE 24 COMPLIANCE FORMS"),
    true
  );
  assert.equal(
    matchesTitleLikeVocabulary("CALGreen Measures"),
    true
  );
  assert.equal(
    matchesTitleLikeVocabulary("ADA Guidelines"),
    true
  );
});

test("normalizes embedded path footer titles to the sheet title", () => {
  assert.equal(
    normalizeEmbeddedSheetPathTitleSource(
      "C:\\CADD\\CADD CONSULTING\\MCKENZIE\\RHINO\\RHINO - IRVINE\\A1 COVER SHEET CASE # 00632333-PCPM Sheet:"
    ),
    "COVER SHEET CASE # 00632333-PCPM Sheet:"
  );
  assert.equal(
    normalizeEmbeddedSheetPathTitleSource(
      "C:\\CADD\\CADD CONSULTING\\MCKENZIE\\RHINO\\RHINO - IRVINE\\A8 EQUIPMENT SPECS Sheet:"
    ),
    "EQUIPMENT SPECS Sheet:"
  );
  assert.equal(
    normalizeEmbeddedSheetPathTitleSource(
      "C:\\CADD\\CADD CONSULTING\\MCKENZIE\\SHEAR MADNESS\\LAKE FOREST\\CS COVER SHEET"
    ),
    "COVER SHEET"
  );
});

test("normalizes locked OCR sheet numbers with a single leading artifact when page text has the clean dotted form", () => {
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "IE2.04",
      sheetTitle: "EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      titleSourceText:
        "EXISTING/REMOVAL\nFLOOR PLAN,\nCONSTRUCTION\nFLOOR PLAN",
      pageLineTexts: [
        "COPYRIGHT 2022 HKIT ARCHITECTS E2.04 SCALE: FLOOR PLAN CONSTRUCTION FLOOR PLAN, EXISTING/REMOVAL BUILDING 5 - ELECTRICAL DRAWING TITLE",
      ],
    }),
    "E2.04"
  );
});

test("normalizes LIGHTINC OCR title typos into LIGHTING", () => {
  assert.equal(
    normalizeOcrTitleCandidateText(
      "DRAWING TITLE ELECTRICAL INTERIOR LIGHTINC ENERGEGY COMPLIANCE FORMS"
    ),
    "ELECTRICAL INTERIOR LIGHTING ENERGY COMPLIANCE FORMS"
  );
});

test("treats title sheets as title discipline instead of telecom", () => {
  assert.equal(
    inferSheetDiscipline("T1", "TITLE SHEET"),
    "Title"
  );
  assert.equal(
    inferSheetDiscipline("FP0.01", "FIRE PROTECTION COVER SHEET"),
    "Fire Protection"
  );
  assert.equal(
    inferSheetDiscipline("CS", "COVER SHEET"),
    "Title"
  );
  assert.equal(
    inferSheetDiscipline("3A-410", "CONSTRUCTION PLAN"),
    "Architectural"
  );
});

test("parses leading-numeric consultant sheet numbers", () => {
  assert.deepEqual(parseSheetNumberParts("3A-410"), {
    prefix: "3A",
    main: 410,
    sub: null,
    suffix: "",
    detail: "",
  });
});

test("does not treat cover sheet titles as label-only metadata fields", () => {
  assert.equal(isMetadataLabelOnlyText("Cover Sheet"), false);
  assert.equal(isMetadataLabelOnlyText("Sheet:"), true);
  assert.equal(isMetadataLabelOnlyText("Sheet Title"), true);
});

test("identifies generic auxiliary titles without overmatching real sheet titles", () => {
  assert.equal(isGenericAuxiliarySheetTitle("an LEGEND & DETAILS"), true);
  assert.equal(
    isGenericAuxiliarySheetTitle("FINISH SCHEDULE, LEGEND & DETAILS"),
    true
  );
  assert.equal(
    isGenericAuxiliarySheetTitle("TYP. 34A FINISH & WALL TYPE FLOOR PLAN - BUILDING D"),
    false
  );
  assert.equal(isGenericAuxiliarySheetTitle("GENERAL NOTES"), false);
});

test("recovers weak sheet titles from full-page reference text", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A9.20",
      sheetTitle: "ELEVATION X",
      discipline: "Architectural",
      pageNumber: 34,
      confidence: 1,
      titleSourceKind: "ocr",
      referenceText:
        "26 RESTROOM DOOR SIGN - TRS\n27 RESTROOM SIGN MOUNTING\n28 RESTROOM WALL SIGN\nDRAWING TITLE\nRESTROOM AND ACCESSIBILITY DETAILS\nA9.20",
    }),
    createExtractedSheet({
      sheetNumber: "",
      sheetTitle: "",
      discipline: null,
      pageNumber: 72,
      confidence: 0.15,
      titleSourceKind: null,
      referenceText:
        "COPYRIGHT 2016 HKIT ARCHITECTS E2.03 SCALE: FLOOR PLAN CONSTRUCTION FLOOR PLAN, EXISTING/REMOVAL BUILDING 3 & 4 - ELECTRICAL DRAWING TITLE ISSUE JOB CAPTAIN",
    }),
    createExtractedSheet({
      sheetNumber: "A30",
      sheetTitle: "EVE EXT NONSTRUCT PONENT ATTACHMENT",
      discipline: "Architectural",
      pageNumber: 75,
      confidence: 1,
      titleSourceKind: "ocr",
      referenceText:
        "1\nINFILL AT (E) WINDOW OPENING REDUCTION",
    }),
  ]);

  assert.equal(sheets[0].sheetTitle, "RESTROOM AND ACCESSIBILITY DETAILS");
  assert.equal(sheets[1].sheetNumber, "E2.03");
  assert.equal(
    sheets[1].sheetTitle,
    "ELECTRICAL BUILDING 3 AND 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(sheets[2].sheetNumber, "1");
  assert.equal(
    sheets[2].sheetTitle,
    "INFILL AT (E) WINDOW OPENING REDUCTION"
  );
});

test("does not let unrelated reference context overwrite strong OCR or cover titles", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "S1.00",
      sheetTitle: "STRUCTURAL GENERAL NOTES",
      discipline: "Structural",
      pageNumber: 39,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nBUILDINGS 1, 3, 4 - FOUNDATION DETAILS\nS5.01",
    }),
    createExtractedSheet({
      sheetNumber: "E0.01",
      sheetTitle: "ELECTRICAL LEGEND, NOTES AND DETAILS",
      discipline: "Electrical",
      pageNumber: 67,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "G0.00",
      sheetTitle: "COVER, DRAWING INDEX, ABBREVIATIONS, SYMBOLS",
      discipline: "Title",
      pageNumber: 1,
      confidence: 1,
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "PROJECT DIRECTORY SUMMARY OF WORK ACCEPTANCE TESTING DRAWING INDEX\n" +
        "G0.01 PROJECT DATA S1.01 STRUCTURAL GENERAL NOTES\n" +
        "A1.10 ENLARGED SITE PLAN P-0.01 PLUMBING LEGENDS, NOTES, AND FIXTURE SCHEDULE 3\n" +
        "A1.11 SITE RAMP, PARKING - ENLARGED PLANS, ELEVATION, P-0.01* PLUMBING LEGENDS, NOTES, AND DETAILS - ALTERNATE #3\n" +
        "A2.02 BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, P-2.01* PLUMBING - BUILDING 1 - EXISTING/REMOVAL FLOOR PLAN,\n" +
        "A2.03 BUILDING 3, 4 - EXISTING/REMOVAL FLOOR PLAN, P-2.04 PLUMBING - BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, 3\n" +
        "A3.03 BUILDING 3 - EXTERIOR ELEVATIONS\n" +
        "PT. POINT COVER, DRAWING\n" +
        "INDEX,\n" +
        "ABBREVIATIONS,\n" +
        "SYMBOLS",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "S1.00");
  assert.equal(sheets[0].sheetTitle, "STRUCTURAL GENERAL NOTES");
  assert.equal(sheets[1].sheetNumber, "E0.01");
  assert.equal(sheets[1].sheetTitle, "ELECTRICAL LEGEND, NOTES AND DETAILS");
  assert.equal(sheets[2].sheetNumber, "G0.00");
  assert.equal(
    sheets[2].sheetTitle,
    "COVER, DRAWING INDEX, ABBREVIATIONS, SYMBOLS"
  );
});

test("rescues structural framing titles from explicit same-number reference context", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "S2.03",
      sheetTitle: "BUILDING 4 - FOUNDATION AND ROOF FRAMING PLANS",
      discipline: "Structural",
      pageNumber: 43,
      confidence: 1,
      numberSourceText: "S2.03",
      titleSourceText: "BUILDING 4 - ROOF FRAMING PLAN\nBUILDING 4 - FOUNDATION PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "Email: swatson@orinda.k12.ca.us Email: mregan@hkit.com 6. SELECT REPLACEMENT OF EXISTING DOOR AND HARDWARE C1.1 GRADING AND DRAINAGE PLAN S2.03 BUILDING 3 & 4 - FOUNDATION AND ROOF FRAMING PLANS",
    }),
  ]);

  assert.equal(
    sheets[0].sheetTitle,
    "BUILDING 3 AND 4 - FOUNDATION AND ROOF FRAMING PLANS"
  );
});

test("promotes explicit reference numbers when the reference title is a better fit", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "16",
      sheetTitle: "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS",
      discipline: "Structural",
      pageNumber: 2,
      confidence: 1,
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "DRAWING TITLE\nBUILDINGS 1, 3, 4 - FOUNDATION DETAILS\nS5.01",
    }),
    createExtractedSheet({
      sheetNumber: "4",
      sheetTitle: "BUILDING SECTIONS",
      discipline: "Architectural",
      pageNumber: 20,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText: "DRAWING TITLE\nBUILDING SECTIONS\nA3.10",
    }),
    createExtractedSheet({
      sheetNumber: "16",
      sheetTitle: "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS",
      discipline: "Structural",
      pageNumber: 44,
      confidence: 1,
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "DRAWING TITLE\nBUILDINGS 1, 3, 4 - FOUNDATION DETAILS\nS5.01",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "S5.01");
  assert.equal(
    sheets[0].sheetTitle,
    "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS"
  );
  assert.equal(sheets[1].sheetNumber, "A3.10");
  assert.equal(sheets[1].sheetTitle, "BUILDING SECTIONS");
  assert.equal(sheets[2].sheetNumber, "S5.01");
  assert.equal(
    sheets[2].sheetTitle,
    "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS"
  );
});

test("keeps strong same-number titles and only rescues numbers that fit title discipline", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "E0.01",
      sheetTitle: "ELECTRICAL LEGEND, NOTES AND DETAILS",
      discipline: "Electrical",
      pageNumber: 67,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN\nE0.01",
    }),
    createExtractedSheet({
      sheetNumber: "M-5.01",
      sheetTitle: "HVAC DETAILS",
      discipline: "Mechanical",
      pageNumber: 64,
      confidence: 1,
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "WIRE W/ A34 EA END EA SIDE\nDRAWING TITLE\nHVAC DETAILS\nA34",
    }),
    createExtractedSheet({
      sheetNumber: "C11",
      sheetTitle:
        "ELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Civil",
      pageNumber: 73,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "COPYRIGHT 2016 HKIT ARCHITECTS E2.04 SCALE: FLOOR PLAN CONSTRUCTION FLOOR PLAN, EXISTING/REMOVAL BUILDING 5 - ELECTRICAL DRAWING TITLE ISSUE JOB CAPTAIN CHECKED DRAWN JOB NO.",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "E0.01");
  assert.equal(sheets[0].sheetTitle, "ELECTRICAL LEGEND, NOTES AND DETAILS");
  assert.equal(sheets[1].sheetNumber, "M-5.01");
  assert.equal(sheets[1].sheetTitle, "HVAC DETAILS");
  assert.equal(sheets[2].sheetNumber, "E2.04");
  assert.equal(
    sheets[2].sheetTitle,
    "ELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("rescues cross-discipline titles without drifting anchored source numbers", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A2.02",
      sheetTitle:
        "ELECTRICAL BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 11,
      confidence: 1,
      numberSourceText: "A2.02",
      titleSourceText:
        "FLOOR PLAN,\nEXISTINGIREMOVAL\nRUCTION FLOOR PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nBUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN\nA3.02",
    }),
    createExtractedSheet({
      sheetNumber: "A3.01",
      sheetTitle: "ELECTRICAL LEGEND, NOTES AND DETAILS",
      discipline: "Architectural",
      pageNumber: 14,
      confidence: 1,
      numberSourceText: "A3.01",
      titleSourceText: "I EXTERIOR\nELEVATIONS\nNOTES",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nBUILDING 1 - EXTERIOR ELEVATIONS\nA3.01",
    }),
    createExtractedSheet({
      sheetNumber: "A4.01",
      sheetTitle: "HVAC TITLE 24 DOCUMENTATION",
      discipline: "Architectural",
      pageNumber: 21,
      confidence: 1,
      numberSourceText: "A4.01",
      titleSourceText: "INTERIOR ELEVATIONS LEGEND",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nTYPICAL CLASSROOM ENLARGED PLAN,\nINTERIOR ELEVATIONS\nA4.01",
    }),
    createExtractedSheet({
      sheetNumber: "M-0.01",
      sheetTitle: "PLUMBING LEGENDS, NOTES AND DETAILS",
      discipline: "Mechanical",
      pageNumber: 58,
      confidence: 1,
      numberSourceText: "M-0.01",
      titleSourceText: "DRAWING TITLE\nHVAC LEGENDS AND NOTES",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText: "DRAWING TITLE\nHVAC LEGENDS AND NOTES\nM-0.01",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "A2.02");
  assert.equal(
    sheets[0].sheetTitle,
    "BUILDING 2 - FLOOR PLAN"
  );
  assert.equal(sheets[1].sheetNumber, "A3.01");
  assert.equal(sheets[1].sheetTitle, "BUILDING 1 - EXTERIOR ELEVATIONS");
  assert.equal(sheets[2].sheetNumber, "A4.01");
  assert.equal(
    sheets[2].sheetTitle,
    "TYPICAL CLASSROOM ENLARGED PLAN, INTERIOR ELEVATIONS"
  );
  assert.equal(sheets[3].sheetNumber, "M-0.01");
  assert.equal(sheets[3].sheetTitle, "HVAC LEGENDS AND NOTES");
});

test("promotes more specific explicit reference numbers when they refine the OCR number", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "E2.0",
      sheetTitle:
        "ELECTRICAL BUILDING 3, 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Electrical",
      pageNumber: 72,
      confidence: 1,
      numberSourceText: "E2.0",
      titleSourceText:
        "FLOOR PLAN\nSCALE As indicated\nCONSTRUCTION PLAN 7%",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "COPYRIGHT 2016 HKIT ARCHITECTS E2.03 SCALE: FLOOR PLAN CONSTRUCTION FLOOR PLAN, EXISTING/REMOVAL BUILDING 3 & 4 - ELECTRICAL DRAWING TITLE ISSUE JOB CAPTAIN CHECKED DRAWN JOB NO.",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "E2.03");
  assert.equal(
    sheets[0].sheetTitle,
    "ELECTRICAL BUILDING 3, 4 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("preserves strong OCR titles when reference context only offers weaker generic variants", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A10.10",
      sheetTitle: "DOOR AND HARDWARE SCHEDULES",
      discipline: "Architectural",
      pageNumber: 36,
      confidence: 1,
      numberSourceText: "A10.10",
      titleSourceText: "HARDWARE SCHEDULES DOOR AND. SCHEDULES",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nA10.10 SCHEDULES\nDOOR AND HARDWARE SCHEDULES",
    }),
    createExtractedSheet({
      sheetNumber: "S1.01",
      sheetTitle: "STRUCTURAL GENERAL NOTES",
      discipline: "Structural",
      pageNumber: 40,
      confidence: 1,
      numberSourceText: "81.01",
      titleSourceText: "DRAWING TITLE STRUCTURAL GENERAL NOTES",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\n13 GENERAL NOTES\nS1.01 STRUCTURAL GENERAL NOTES",
    }),
    createExtractedSheet({
      sheetNumber: "S1.01",
      sheetTitle: "STRUCTURAL GENERAL NOTES",
      discipline: "Structural",
      pageNumber: 41,
      confidence: 1,
      numberSourceText: "81.01",
      titleSourceText: "STRUCTURAL GENERAL = rerun NOTES",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        'WF HSS STRUCTURAL STEEL COLUMN SEE SHEET S701. "X" DENOTES\n1/29/2024 3:00 PM S1.01',
    }),
    createExtractedSheet({
      sheetNumber: "P-0.01",
      sheetTitle: "PLUMBING LEGENDS, NOTES AND DETAILS - ALTERNATE # 3",
      discipline: "Plumbing",
      pageNumber: 49,
      confidence: 1,
      numberSourceText: "P-0.01",
      titleSourceText: "AVE BOX F3 BGOCATIH 1 ADS EXTENSON ADS",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nP-0.01 PLUMBING LEGENDS, NOTES AND DETAILS",
    }),
  ]);

  assert.equal(sheets[0].sheetTitle, "DOOR AND HARDWARE SCHEDULES");
  assert.equal(sheets[1].sheetNumber, "S1.01");
  assert.equal(sheets[1].sheetTitle, "STRUCTURAL GENERAL NOTES");
  assert.equal(sheets[2].sheetNumber, "S1.01");
  assert.equal(sheets[2].sheetTitle, "STRUCTURAL GENERAL NOTES");
  assert.equal(
    sheets[3].sheetTitle,
    "PLUMBING LEGENDS, NOTES AND DETAILS - ALTERNATE # 3"
  );
});

test("rescues explicit reference numbers when a garbled OCR title points to the wrong discipline", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "C11",
      sheetTitle: "I CONSTRUCTION a \\ FLOOR PLAN EY PLAN",
      discipline: "Civil",
      pageNumber: 73,
      confidence: 1,
      numberSourceText: "C11",
      titleSourceText: "I CONSTRUCTION\na \\ FLOOR PLAN\nEY PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "COPYRIGHT 2016 HKIT ARCHITECTS E2.04 SCALE: FLOOR PLAN CONSTRUCTION FLOOR PLAN, EXISTING/REMOVAL BUILDING 5 - ELECTRICAL DRAWING TITLE ISSUE JOB CAPTAIN CHECKED DRAWN JOB NO.",
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "E2.04");
  assert.equal(
    sheets[0].sheetTitle,
    "ELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
  assert.equal(sheets[0].discipline, "Electrical");
});

test("detects when a referenced title drops important current context", () => {
  assert.equal(
    candidateDropsImportantCurrentTitleContext(
      "TYPICAL CLASSROOM ENLARGED PLAN, INTERIOR ELEVATIONS",
      "HVAC TITLE 24 DOCUMENTATION"
    ),
    true
  );
  assert.equal(
    candidateDropsImportantCurrentTitleContext(
      "PLUMBING LEGENDS, NOTES AND DETAILS - ALTERNATE # 3",
      "PLUMBING LEGENDS, NOTES AND DETAILS"
    ),
    true
  );
  assert.equal(
    candidateDropsImportantCurrentTitleContext(
      "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN",
      "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS"
    ),
    true
  );
  assert.equal(
    candidateDropsImportantCurrentTitleContext(
      "BUILDINGS 1, 3 AND 4 - FOUNDATION DETAILS",
      "BUILDINGS 1, 3, 4 - FOUNDATION DETAILS"
    ),
    false
  );
});

test("matches document title discipline cues only when explicit reference titles fit the sheet number", () => {
  assert.equal(
    sheetNumberMatchesDocumentTitleDisciplineCue(
      "A4.01",
      "HVAC TITLE 24 DOCUMENTATION"
    ),
    false
  );
  assert.equal(
    sheetNumberMatchesDocumentTitleDisciplineCue(
      "M-7.01",
      "HVAC TITLE 24 DOCUMENTATION"
    ),
    true
  );
  assert.equal(
    sheetNumberMatchesDocumentTitleDisciplineCue(
      "P-4.01",
      "PLUMBING ENLARGED PLANS"
    ),
    true
  );
  assert.equal(
    sheetNumberMatchesDocumentTitleDisciplineCue(
      "A4.01",
      "TYPICAL CLASSROOM ENLARGED PLAN, INTERIOR ELEVATIONS"
    ),
    true
  );
});

test("keeps the fuller A4.07 restroom title when reference text only offers a shorter subset", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A4.07",
      sheetTitle:
        "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 26,
      confidence: 1,
      numberSourceText: "A4.07",
      titleSourceText:
        "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "DRAWING TITLE\nA4.07 ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS",
    }),
  ]);

  assert.equal(
    sheets[0].sheetTitle,
    "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS CONSTRUCTION FLOOR PLAN"
  );
});

test("infers a missing leading .1 sheet from matching .2 and .3 companions", () => {
  const sheets = inferMissingLeadingSeriesSheets([
    createExtractedSheet({
      pageNumber: 8,
    }),
    createExtractedSheet({
      sheetNumber: "A4.2",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 9,
      confidence: 1,
    }),
    createExtractedSheet({
      sheetNumber: "A4.3",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 10,
      confidence: 1,
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "A4.1");
  assert.equal(sheets[0].sheetTitle, "INTERIOR ELEVATIONS - LEVEL 429");
});

test("does not infer a missing leading .1 sheet across a table-like rejected page", () => {
  const sheets = inferMissingLeadingSeriesSheets([
    createExtractedSheet({
      pageNumber: 8,
      postprocessInferenceBarrierReason: "table_like_box",
    }),
    createExtractedSheet({
      sheetNumber: "A4.2",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 9,
      confidence: 0.45,
    }),
    createExtractedSheet({
      sheetNumber: "A4.3",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 10,
      confidence: 0.45,
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "");
  assert.equal(sheets[0].sheetTitle, "");
});

test("infers a missing leading .1 sheet across a table-like page when companion evidence is strong", () => {
  const sheets = inferMissingLeadingSeriesSheets([
    createExtractedSheet({
      pageNumber: 8,
      postprocessInferenceBarrierReason: "table_like_box",
    }),
    createExtractedSheet({
      sheetNumber: "A4.2",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 9,
      confidence: 1,
    }),
    createExtractedSheet({
      sheetNumber: "A4.3",
      sheetTitle: "INTERIOR ELEVATIONS - LEVEL 429",
      discipline: "Architectural",
      pageNumber: 10,
      confidence: 1,
    }),
  ]);

  assert.equal(sheets[0].sheetNumber, "A4.1");
  assert.equal(sheets[0].sheetTitle, "INTERIOR ELEVATIONS - LEVEL 429");
});

test("simplifies plan-family reference text into reusable floor-plan titles", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A2.01",
      sheetTitle: "ENLARGED RESTROOM REMOVAL AND CONSTRUCTION PLANS & ELEVATIONS",
      discipline: "Architectural",
      pageNumber: 6,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "1 BUILDING 2 - EXISTING / REMOVAL FLOOR PLAN CONSTRUCTION SHEET NOTES 2 BUILDING 2 - CONSTRUCTION FLOOR PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "E2.01",
      sheetTitle:
        "ELECTRICAL BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Electrical",
      pageNumber: 60,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "SCALE: 1/8 ELECTRICAL BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN SCALE: 1/8 ELECTRICAL BUILDING 2 - CONSTRUCTION PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "E2.03",
      sheetTitle:
        "ELECTRICAL BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Electrical",
      pageNumber: 62,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "SCALE: 1/8 ELECTRICAL BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN SCALE: 1/8 ELECTRICAL BUILDING 6 - CONSTRUCTION PLAN FLOOR PLAN BUILDING 4/5/6 ELECTRICAL DRAWING TITLE",
    }),
    createExtractedSheet({
      sheetNumber: "A3.05",
      sheetTitle: "EEfh ris < ELEVATIONS/PLAN Fa = WALKWAY EXTERIOR",
      discipline: "Architectural",
      pageNumber: 19,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "TYPICAL PORTABLE - NORTH ELEVATION TYPICAL PORTABLE - WEST ELEVATION COVERED WALKWAY PLAN TYPICAL PORTABLE ELEVATIONS/PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "A8.20",
      sheetTitle: "INTERIOR AND EXTERIOR FINISH SCHEDULES",
      discipline: "Architectural",
      pageNumber: 32,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText: "DRAWING TITLE EXTERIOR DETAILS WINDOW JAMB EXTERIOR DETAILS",
    }),
    createExtractedSheet({
      sheetNumber: "A10.10",
      sheetTitle: "SCHEDULES",
      discipline: "Architectural",
      pageNumber: 36,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "BUILDING 2 DOOR AND HARDWARE SCHEDULE WINDOW SCHEDULE GLAZING SCHEDULE SIGNAGE SCHEDULE",
    }),
    createExtractedSheet({
      sheetNumber: "P-2.03",
      sheetTitle:
        "PLUMBING - BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN",
      discipline: "Plumbing",
      pageNumber: 50,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "PLUMBING - BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN PLUMBING - BUILDING 4 - CONSTRUCTION FLOOR PLAN PLUMBING - BUILDING 5 - EXISTING/REMOVAL FLOOR PLAN PLUMBING - BUILDING 6 - EXISTING/REMOVAL PLAN PLUMBING - BUILDING 6 - CONSTRUCTION PLAN GIRLS BUILDING 4/5/6",
    }),
  ]);

  assert.equal(sheets[0].sheetTitle, "BUILDING 2 - FLOOR PLAN");
  assert.equal(sheets[1].sheetTitle, "ELECTRICAL BUILDING 2 - FLOOR PLAN");
  assert.equal(sheets[2].sheetTitle, "ELECTRICAL BUILDING 4/5/6 - FLOOR PLAN");
  assert.equal(
    sheets[3].sheetTitle,
    "TYPICAL PORTABLE AND COVERED WALKWAY EXTERIOR ELEVATIONS/PLAN"
  );
  assert.equal(sheets[4].sheetTitle, "EXTERIOR DETAILS");
  assert.equal(
    sheets[5].sheetTitle,
    "DOOR, WINDOW, GLAZING, AND SIGNAGE SCHEDULES"
  );
  assert.equal(
    sheets[6].sheetTitle,
    "PLUMBING - BUILDING 4/5/6 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("promotes plumbing fixture specification and broadens plumbing building scope from reference context", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "P-0.01",
      sheetTitle: "PLUMBING LEGENDS, NOTES AND DETAILS",
      discipline: "Plumbing",
      pageNumber: 47,
      confidence: 1,
      numberSourceText: "P-0.01",
      titleSourceText: "DETAILS\nPLUMBING LEGENDS,\nNOTES, FIXTURE",
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText:
        "FLV FLOW LIMITING VALVE PLUMBING FIXTURE SPECIFICATION & CONNECTION SCHEDULE T A I\nOTHER APPROVED EQUAL MANUFACTURERS SPECIFICATION, AND\nWITH WALL FINSH Z-415BL, OR EQUAL, NICKEL BRONZE WITH ADJUSTABLE NOTES, FIXTURE",
    }),
    createExtractedSheet({
      sheetNumber: "P-2.03",
      sheetTitle: "CONSTRUCTION FLOOR PLANS",
      discipline: "Plumbing",
      pageNumber: 50,
      confidence: 1,
      numberSourceText: "P-2.03",
      titleSourceText: "LJ Bf —\n1 PLUMBING -\nFLOOR PLANS",
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "PLUMBING - BUILDING 5 -\n1 PLUMBING - BUILDING 4 - EXISTING/REMOVAL FLOOR PLAN HKI\n2 PLUMBING - BUILDING 4 - CONSTRUCTION FLOOR PLAN\n5 PLUMBING - BUILDING 6 - EXISTING/REMOVAL PLAN\nGIRLS BUILDING 4/5/6 -\n6 PLUMBING - BUILDING 6 - CONSTRUCTION PLAN",
    }),
  ]);

  assert.equal(
    sheets[0].sheetTitle,
    "PLUMBING LEGENDS, NOTES, FIXTURE SPECIFICATION, AND DETAILS"
  );
  assert.equal(
    sheets[1].sheetTitle,
    "PLUMBING - BUILDING 4/5/6 - EXISTING/REMOVAL FLOOR PLAN, CONSTRUCTION FLOOR PLAN"
  );
});

test("preserves simplified multi-building and plain-RCP titles over narrower reference variants", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "M2.02",
      sheetTitle: "HVAC - BUILDING 2 AND 3 FLOOR PLANS",
      discipline: "Mechanical",
      pageNumber: 55,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      titleSourceText: "= EE = 73 3 FLOOR PLANS",
      referenceText:
        "1 HVAC - BUILDING 2 - EXISTING FLOOR PLAN 6 HVAC - BUILDING 2 & 3 FLOOR PLANS 2 HVAC - BUILDING 3 - EXISTING FLOOR PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "A6.02",
      sheetTitle: "BUILDING 3 - CONSTRUCTION RCP",
      discipline: "Architectural",
      pageNumber: 28,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      titleSourceText: "BULONG 3 - Ree",
      referenceText:
        "1 BUILDING 3 - EXISTING / REMOVAL RCP BUILDING 3 - RCP BUILDING 3 - CONSTRUCTION RCP",
    }),
    createExtractedSheet({
      sheetNumber: "A6.03",
      sheetTitle: "BUILDING 4 - RCP",
      discipline: "Architectural",
      pageNumber: 29,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      titleSourceText: "EN > BUILDING 4/5/6 - RCP",
      referenceText:
        "BUILDING 4 - EXISTING / REMOVAL RCP BUILDING 5 - EXISTING / REMOVAL RCP BUILDING 6 - EXISTING / REMOVAL RCP BUILDING 4/5/6 - RCP BUILDING 5 - CONSTRUCTION RCP BUILDING 6 - CONSTRUCTION RCP",
    }),
    createExtractedSheet({
      sheetNumber: "E2.01",
      sheetTitle: "(TT r??erias = FLOOR PLAN fo 7",
      discipline: "Electrical",
      pageNumber: 60,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      titleSourceText: "\\ (TT r??erias = FLOOR PLAN\nfo 7",
      referenceText:
        "ELECTRICAL BUILDING 2 - EXISTING/REMOVAL FLOOR PLAN ELECTRICAL BUILDING 2 - CONSTRUCTION PLAN FLOOR PLAN BUILDING 2 ELECTRICAL",
    }),
  ]);

  assert.equal(sheets[0].sheetTitle, "HVAC - BUILDING 2 AND 3 FLOOR PLANS");
  assert.equal(sheets[1].sheetTitle, "BUILDING 3 - RCP");
  assert.equal(sheets[2].sheetTitle, "BUILDING 4/5/6 - RCP");
  assert.equal(sheets[3].sheetTitle, "ELECTRICAL BUILDING 2 - FLOOR PLAN");
});

test("reassigns floor-plan outliers back into nearby A2 companion series", () => {
  const sheets = enrichDocumentSheetsWithReferenceTextContext([
    createExtractedSheet({
      sheetNumber: "A2.02",
      sheetTitle: "BUILDING 3 - FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 7,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText: "BUILDING 3 - EXISTING / REMOVAL FLOOR PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "A2.03",
      sheetTitle: "BUILDING 4 AND 5 - FLOOR PLAN",
      discipline: "Architectural",
      pageNumber: 8,
      confidence: 1,
      numberSourceKind: "ocr",
      titleSourceKind: "ocr",
      referenceText: "BUILDING 4 AND 5 - EXISTING / REMOVAL FLOOR PLAN",
    }),
    createExtractedSheet({
      sheetNumber: "A3.04",
      sheetTitle: "CONSTRUCTION SHEET NOTES ELEMENTARY",
      discipline: "Architectural",
      pageNumber: 9,
      confidence: 0.71,
      numberSourceKind: "pdf_text",
      titleSourceKind: "pdf_text",
      referenceText:
        "1 BUILDING 6 - EXISTING / REMOVAL FLOOR PLAN CONSTRUCTION SHEET NOTES 2 BUILDING 6 - CONSTRUCTION FLOOR PLAN",
    }),
  ]);

  assert.equal(sheets[2].sheetNumber, "A2.04");
  assert.equal(sheets[2].sheetTitle, "BUILDING 6 - FLOOR PLAN");
});

test("rejects generic reference titles as sheet titles", () => {
  const penalty = getTextualTitleRejectPenalty("SECTION REFERENCE");

  assert.ok(penalty <= -220);
});

test("rejects vendor drawing reference pages as sheet titles", () => {
  const penalty = getTextualTitleRejectPenalty("HILL ROMLKO VENDOR DRAWINGS");

  assert.ok(penalty <= -220);
});

test("accepts compact strip pairing from the tight subcluster instead of the widened box", () => {
  const numberBox = {
    x: 0.947,
    y: 0.925,
    width: 0.025,
    height: 0.014,
  };
  const titleBox = {
    x: 0.938,
    y: 0.949,
    width: 0.05,
    height: 0.028,
  };

  assert.equal(
    isPairedWithinMetadataBox("bottom_right_strip", numberBox, titleBox, {
      x: 0.938,
      y: 0.925,
      width: 0.05,
      height: 0.052,
    }),
    true
  );

  assert.equal(
    isPairedWithinMetadataBox("bottom_right_strip", numberBox, titleBox, {
      x: 0.73,
      y: 0.925,
      width: 0.258,
      height: 0.052,
    }),
    false
  );
});

test("accepts compact strip titles positioned just above the number", () => {
  const numberBox = {
    x: 0.945,
    y: 0.942,
    width: 0.03,
    height: 0.016,
  };
  const titleBox = {
    x: 0.925,
    y: 0.907,
    width: 0.07,
    height: 0.028,
  };

  assert.equal(
    isPairedWithinMetadataBox("bottom_right_strip", numberBox, titleBox, {
      x: 0.925,
      y: 0.907,
      width: 0.07,
      height: 0.051,
    }),
    true
  );
});

test("rejects parking tables as metadata boxes even when they contain title vocabulary", () => {
  const rejectReason = getMetadataBoxRejectReason({
    familyId: "bottom_right_block",
    distinctNumberCount: 2,
    titleLikeCount: 2,
    lines: [
      { text: "Parking Table" },
      { text: 'STANDARD 8\'-0"x17\'-0" 25' },
      { text: "Accessible 9" },
    ],
  });

  assert.equal(rejectReason, "table_like_box");
});

test("keeps compact commercial stamps with one sheet number and admin footer out of table rejection", () => {
  const rejectReason = getMetadataBoxRejectReason({
    familyId: "bottom_right_strip",
    distinctNumberCount: 1,
    titleLikeCount: 1,
    lines: [
      { text: "N SHEET #" },
      { text: "A0.06" },
      { text: "3/3/2025 5:46:58 PM" },
    ],
  });

  assert.equal(rejectReason, null);
});

test("requires title-bearing structure before a compact stamp overrides fallback extraction", () => {
  assert.equal(
    hasViableCompactStampStructure({
      distinctNumberCount: 1,
      bodyLineCount: 2,
      titleLikeCount: 2,
      titleVocabularyHits: 2,
    }),
    true
  );

  assert.equal(
    hasViableCompactStampStructure({
      distinctNumberCount: 1,
      bodyLineCount: 0,
      titleLikeCount: 0,
      titleVocabularyHits: 0,
    }),
    false
  );

  assert.equal(
    hasViableCompactStampStructure({
      distinctNumberCount: 1,
      bodyLineCount: 1,
      titleLikeCount: 0,
      titleVocabularyHits: 0,
    }),
    false
  );
});

test("rejects OCR number matches from ordinary words inside sentence lines", () => {
  assert.equal(
    isPlausibleOcrNumberTokenMatch(
      "BUILD",
      "we must build upon the successes of the past."
    ),
    false
  );
  assert.equal(
    isPlausibleOcrNumberTokenMatch("SCALE", "SCALE: 1/8 ="),
    false
  );
  assert.equal(
    isPlausibleOcrNumberTokenMatch("A0.0", "A0.0"),
    true
  );
  assert.equal(
    isPlausibleOcrNumberTokenMatch("A1.2", "A1.2"),
    true
  );
});

test("normalizes OCR footer titles by stripping branding boilerplate", () => {
  assert.equal(
    normalizeOcrTitleCandidateText(
      "2025.08.08 ORIGINAL DESIGN (FINISHED PLANS) GENERAL NOTES"
    ),
    "GENERAL NOTES"
  );
  assert.equal(
    normalizeOcrTitleCandidateText(
      "ALDESIGN (FINISHED PLANS) FOUNDATION/ ROOF"
    ),
    "FOUNDATION/ ROOF"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("2023.01.04 STARTER FARMHOUSE SCHEMATICS"),
    ""
  );
  assert.equal(
    normalizeOcrTitleCandidateText(
      "RAL NOTES ON SHEET 3-00 a CONSTRUCTION PLAN"
    ),
    "CONSTRUCTION PLAN"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("18ST FLOOR PLAN"),
    "1ST FLOOR PLAN"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("THIRD 0 FRAMING"),
    "THIRD FLOOR FRAMING PLAN"
  );
  assert.equal(
    normalizeOcrTitleCandidateText("THIRD FLOOR FRAMING"),
    "THIRD FLOOR FRAMING PLAN"
  );
});

test("repairs Turner sidebar OCR note prelude into the plan title", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "RAL NOTES ON SHEET 3-00 a CONSTRUCTION PLAN",
      ocrTitleSourceText: "RAL NOTES ON SHEET 3-00 a\nCONSTRUCTION PLAN",
      sheetNumber: "3A-410",
    }),
    "CONSTRUCTION PLAN"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "RAL NOTES ON SHEET 3-00 a",
      ocrTitleSourceText: "RAL NOTES ON SHEET 3-00 a\nCONSTRUCTION PLAN",
      sheetNumber: "3A-410",
    }),
    "CONSTRUCTION PLAN"
  );
});

test("repairs Longwood floor plan building suffixes from OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "FLOOR PLAN - BUILDING",
      ocrTitleSourceText: "FLOOR PLAN - BUILDING D1\nFLOOR PLAN BLDG D1 Ser [1",
      sheetNumber: "A1.3-D1",
    }),
    "FLOOR PLAN - BUILDING D1"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "INTERIOR ELEVATIONS -",
      ocrTitleSourceText: "INTERIOR ELEVATIONS - E14",
      sheetNumber: "A2.5-E",
    }),
    "INTERIOR ELEVATIONS - E14"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "INTERIOR ELEVATIONS - 801",
      ocrTitleSourceText: "INTERIOR ELEVATIONS - B01\nINTERIOR ELEVATIONS - 801",
      sheetNumber: "A2.1-B",
    }),
    "INTERIOR ELEVATIONS - B01"
  );
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText:
        "INTERIOR ELEVATIONS - BLDG D - TYPICAL WING CLASSROOM OR ELEVATIONS - D-TYPICAL WING CLassRoomI",
      ocrTitleSourceText:
        "INTERIOR ELEVATIONS - BLDG\nD - TYPICAL WING CLASSROOM\nOR ELEVATIONS -\nD-TYPICAL WING CLassRoomI",
      sheetNumber: "A2.4-D",
    }),
    "INTERIOR ELEVATIONS - BLDG D - TYPICAL WING CLASSROOM"
  );
});

test("repairs OCR titles with trailing scale stubs and site-specific prefixes", () => {
  const repaired = repairOcrTitleFromSourceText({
    ocrTitleText: "SITE-SPECIFIC FULL SECTION DETAIL SCALE 172 = 1",
    ocrTitleSourceText: "(SITE-SPECIFIC)\nFULL SECTION DETAIL\nSCALE 172 = 1",
    sheetNumber: "A4.0",
  });

  assert.equal(repaired, "FULL SECTION DETAIL");
  assert.equal(isUsableRecoveredOcrTitle(repaired), true);
});

test("repairs clipped structural roof framing titles from OCR source text", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "Vi DRAWNG TITLE BUILDING 1 - ROOF FOUNDATION AND",
      ocrTitleSourceText:
        "Vi DRAWNG TITLE\n/ BUILDING 1 -\nROOF\nFOUNDATION AND",
      sheetNumber: "S2.01",
    }),
    "BUILDING 1 - FOUNDATION AND ROOF FRAMING PLANS"
  );
});

test("keeps fuller OCR schedule titles when source-context canonicalization would collapse them", () => {
  assert.equal(
    repairOcrTitleFromSourceText({
      ocrTitleText: "INTERIOR FINISH SCHEDULES",
      ocrTitleSourceText: "INTERIOR FINISH\nSCHEDULES",
      sheetNumber: "A10.30",
    }),
    "INTERIOR FINISH SCHEDULES"
  );
});

test("repairs AT-prefixed OCR numbers into the intended A10 series", () => {
  assert.equal(
    normalizeOcrSheetNumberWithTitleContext({
      sheetNumber: "AT0.10",
      sheetTitle: "DOOR SCHEDULE",
      pageLineTexts: ["A10.10 DOOR SCHEDULE AND DOOR TYPES"],
    }),
    "A10.10"
  );
});

test("distinguishes strip sheet titles from vendor labels", () => {
  assert.equal(matchesTitleLikeVocabulary("EXTERIOR DETAILS"), true);
  assert.equal(matchesTitleLikeVocabulary("VINTAGE WOODWORKS"), false);
  assert.ok(countTitleVocabularyHits("FOUNDATION PLAN") >= 2);
  assert.ok(countTitleVocabularyHits("THIRD FLOOR FRAMING PLAN") >= 3);
  assert.ok(countTitleVocabularyHits("TYPICAL LIGHT GAUGE DETAILS") >= 2);
});

test("prefers OCR compact-anchor matches over weak PDF compact-stamp pairs", () => {
  assert.equal(
    shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal: true,
      pdfPairUsable: true,
      ocrPairUsable: true,
      sameNumberAcrossSources: false,
      ocrMatchesRawCompactAnchor: true,
      pdfTitleText: "T&G WD DECKING & CAVETTO",
      pdfTitleScore: 40,
      ocrTitleText: "EXTERIOR DETAILS",
      ocrTitleScore: 120,
    }),
    true
  );
});

test("keeps PDF compact-stamp pairs when OCR title evidence is not clearly better", () => {
  assert.equal(
    shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal: true,
      pdfPairUsable: true,
      ocrPairUsable: true,
      sameNumberAcrossSources: false,
      ocrMatchesRawCompactAnchor: true,
      pdfTitleText: "EXTERIOR DETAILS",
      pdfTitleScore: 96,
      ocrTitleText: "PORCH DESIGN",
      ocrTitleScore: 98,
    }),
    false
  );
});

test("allows compact-anchor override even when OCR style metadata is broader than strip", () => {
  assert.equal(
    shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal: true,
      pdfPairUsable: true,
      ocrPairUsable: true,
      sameNumberAcrossSources: false,
      ocrMatchesRawCompactAnchor: true,
      pdfTitleText: "T&G WD DECKING & CAVETTO",
      pdfTitleScore: 40,
      ocrTitleText: "EXTERIOR DETAILS",
      ocrTitleScore: 120,
    }),
    true
  );
});

test("prefers OCR project-data titles over non-title PDF note text on compact stamps", () => {
  assert.equal(
    shouldPreferOcrCompactAnchorOverPdfPair({
      compactStampSignal: true,
      pdfPairUsable: true,
      ocrPairUsable: true,
      sameNumberAcrossSources: false,
      ocrMatchesRawCompactAnchor: true,
      pdfTitleText: "EXTENDED TO NATURAL BREAKS IN MATERIAL",
      pdfTitleScore: 84,
      ocrTitleText: "PROJECT DATA",
      ocrTitleScore: 84,
    }),
    true
  );
});
