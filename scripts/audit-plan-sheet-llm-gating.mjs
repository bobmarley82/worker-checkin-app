import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspaceRoot = process.cwd();
const defaultCorpusRoot = path.join(workspaceRoot, "data", "training-corpus");

const BUCKET_ORDER = [
  "trusted",
  "llm_candidate",
  "manual_importer_fix",
  "missing_identity",
  "llm_used",
  "llm_failed",
  "unknown",
];

function printUsage() {
  console.log(`Usage:
  node scripts/audit-plan-sheet-llm-gating.mjs [options]

Options:
  --corpus-root <path>       Corpus root. Default: data/training-corpus
  --plan-set <id>            Limit audit to one plan set
  --with-tier-only           Only include pages with saved confidenceTier
  --limit-examples <n>       Examples per bucket/issue. Default: 8
  --json                     Print machine-readable JSON only
  --help                     Show this help
`);
}

function parseArgs(argv) {
  const options = {
    corpusRoot: defaultCorpusRoot,
    planSetId: null,
    withTierOnly: false,
    limitExamples: 8,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--corpus-root":
        options.corpusRoot = path.resolve(workspaceRoot, argv[++index] ?? "");
        break;
      case "--plan-set":
        options.planSetId = argv[++index] ?? null;
        break;
      case "--with-tier-only":
        options.withTierOnly = true;
        break;
      case "--limit-examples":
        options.limitExamples = Math.max(0, Number.parseInt(argv[++index] ?? "8", 10) || 0);
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalSheetNumber(value) {
  return normalizeWhitespace(value).replace(/\s+/g, "").toUpperCase();
}

function canonicalSheetTitle(value) {
  return normalizeWhitespace(value)
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s*,\s*/g, ", ")
    .toUpperCase();
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatIdentity(number, title) {
  const cleanNumber = normalizeWhitespace(number);
  const cleanTitle = normalizeWhitespace(title);
  if (!cleanNumber && !cleanTitle) {
    return "(blank)";
  }
  if (!cleanNumber) {
    return `(no number) / ${cleanTitle || "(blank title)"}`;
  }
  if (!cleanTitle) {
    return `${cleanNumber} / (blank title)`;
  }
  return `${cleanNumber} / ${cleanTitle}`;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getFinalSelection(pageRecord) {
  const finalSelection = pageRecord.pipeline?.heuristic_output?.finalSelection;
  return finalSelection && typeof finalSelection === "object" ? finalSelection : {};
}

function getLlmStatus(pageRecord, llmAssistBySheetId) {
  const pipelineStatus = normalizeWhitespace(pageRecord.pipeline?.llm_request_status);
  if (pipelineStatus) {
    return pipelineStatus;
  }

  const assist = llmAssistBySheetId.get(pageRecord.review?.plan_sheet_id);
  return normalizeWhitespace(assist?.request_status);
}

function getModelConfidence(pageRecord, finalSelection) {
  return (
    toNumber(pageRecord.review?.model_confidence) ??
    toNumber(finalSelection.confidence) ??
    null
  );
}

function getModelIdentity(pageRecord, finalSelection) {
  return {
    sheetNumber:
      pageRecord.review?.model_sheet_number ??
      finalSelection.sheetNumber ??
      null,
    sheetTitle:
      pageRecord.review?.model_sheet_title ??
      finalSelection.sheetTitle ??
      null,
  };
}

function getReviewedIdentity(pageRecord) {
  return {
    sheetNumber: pageRecord.review?.sheet_number ?? null,
    sheetTitle: pageRecord.review?.sheet_title ?? null,
  };
}

function compareIdentity(model, reviewed) {
  const numberCorrect =
    canonicalSheetNumber(model.sheetNumber) === canonicalSheetNumber(reviewed.sheetNumber);
  const titleCorrect =
    canonicalSheetTitle(model.sheetTitle) === canonicalSheetTitle(reviewed.sheetTitle);

  return {
    numberCorrect,
    titleCorrect,
    identityCorrect: numberCorrect && titleCorrect,
  };
}

function hasModelIdentity(model) {
  return Boolean(canonicalSheetNumber(model.sheetNumber) && canonicalSheetTitle(model.sheetTitle));
}

function routePage(pageRecord, llmAssistBySheetId) {
  const finalSelection = getFinalSelection(pageRecord);
  const model = getModelIdentity(pageRecord, finalSelection);
  const confidence = getModelConfidence(pageRecord, finalSelection);
  const tier = normalizeWhitespace(finalSelection.confidenceTier);
  const llmStatus = getLlmStatus(pageRecord, llmAssistBySheetId);

  if (llmStatus === "success") {
    return {
      bucket: "llm_used",
      reason: "llm_success",
      confidence,
      tier,
      finalSelection,
    };
  }

  if (llmStatus === "error" || llmStatus === "invalid_response") {
    return {
      bucket: "llm_failed",
      reason: llmStatus,
      confidence,
      tier,
      finalSelection,
    };
  }

  if (!hasModelIdentity(model)) {
    return {
      bucket: "missing_identity",
      reason: "missing_model_identity",
      confidence,
      tier,
      finalSelection,
    };
  }

  if (tier === "trusted") {
    return {
      bucket: "trusted",
      reason: "confidence_tier_trusted",
      confidence,
      tier,
      finalSelection,
    };
  }

  if (finalSelection.llmRecommended === true) {
    return {
      bucket: "llm_candidate",
      reason: "llm_recommended",
      confidence,
      tier,
      finalSelection,
    };
  }

  if (!tier && typeof confidence === "number") {
    if (confidence >= 0.86) {
      return {
        bucket: "trusted",
        reason: "legacy_confidence_trusted",
        confidence,
        tier,
        finalSelection,
      };
    }

    if (confidence >= 0.45) {
      return {
        bucket: "llm_candidate",
        reason: "legacy_middle_confidence",
        confidence,
        tier,
        finalSelection,
      };
    }
  }

  if (tier === "needs_review" || tier === "insufficient_evidence") {
    return {
      bucket: "manual_importer_fix",
      reason: `confidence_tier_${tier}`,
      confidence,
      tier,
      finalSelection,
    };
  }

  return {
    bucket: "unknown",
    reason: "unrouted",
    confidence,
    tier,
    finalSelection,
  };
}

function createBucketStats() {
  return {
    pages: 0,
    identityCorrect: 0,
    identityWrong: 0,
    numberWrong: 0,
    titleWrong: 0,
    correctedByReviewer: 0,
    withConfidenceTier: 0,
    averageConfidence: null,
    confidenceTotal: 0,
  };
}

function addCount(map, key, amount = 1) {
  const normalizedKey = normalizeWhitespace(key) || "none";
  map[normalizedKey] = (map[normalizedKey] ?? 0) + amount;
}

function pushExample(examples, key, value, limit) {
  if (limit <= 0) {
    return;
  }
  if (!examples[key]) {
    examples[key] = [];
  }
  if (examples[key].length < limit) {
    examples[key].push(value);
  }
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function listPageFiles(planSetDir) {
  const pagesDir = path.join(planSetDir, "pages");
  try {
    return (await fs.readdir(pagesDir))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right))
      .map((fileName) => path.join(pagesDir, fileName));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function loadInventoryEntries(corpusRoot, planSetId) {
  const inventory = await readJsonFile(path.join(corpusRoot, "inventory.json"), {
    entries: [],
  });
  const entries = Array.isArray(inventory.entries) ? inventory.entries : [];
  return entries.filter(
    (entry) =>
      entry &&
      entry.corpus_state === "reviewed" &&
      (!planSetId || entry.plan_set_id === planSetId)
  );
}

async function loadLlmAssistsBySheetId(planSetDir) {
  const assists = await readJsonFile(path.join(planSetDir, "import-llm-assists.json"), []);
  const map = new Map();
  if (!Array.isArray(assists)) {
    return map;
  }

  for (const assist of assists) {
    const planSheetId = normalizeWhitespace(assist?.plan_sheet_id);
    if (planSheetId) {
      map.set(planSheetId, assist);
    }
  }

  return map;
}

function buildExample({ entry, pageRecord, route, comparison }) {
  const finalSelection = route.finalSelection;
  const model = getModelIdentity(pageRecord, finalSelection);
  const reviewed = getReviewedIdentity(pageRecord);

  return {
    plan_set_id: entry.plan_set_id,
    file: entry.original_file_name,
    page_number: pageRecord.review?.page_number ?? null,
    bucket: route.bucket,
    route_reason: route.reason,
    confidence: route.confidence,
    confidence_tier: route.tier || null,
    confidence_reasons: Array.isArray(finalSelection.confidenceReasons)
      ? finalSelection.confidenceReasons
      : [],
    model_identity: formatIdentity(model.sheetNumber, model.sheetTitle),
    reviewed_identity: formatIdentity(reviewed.sheetNumber, reviewed.sheetTitle),
    number_correct: comparison.numberCorrect,
    title_correct: comparison.titleCorrect,
    number_source_kind: pageRecord.evidence?.number_source_kind ?? null,
    title_source_kind: pageRecord.evidence?.title_source_kind ?? null,
    number_source_text: pageRecord.evidence?.number_source_text ?? null,
    title_source_text: pageRecord.evidence?.title_source_text ?? null,
  };
}

async function auditCorpus(options) {
  const entries = await loadInventoryEntries(options.corpusRoot, options.planSetId);
  const summary = {
    corpus_root: options.corpusRoot,
    plan_sets: entries.length,
    pages: 0,
    with_confidence_tier: 0,
    buckets: Object.fromEntries(BUCKET_ORDER.map((bucket) => [bucket, createBucketStats()])),
    confidence_tiers: {},
    route_reasons: {},
    confidence_reason_counts: {},
    confidence_bands: {},
    examples: {},
  };

  for (const entry of entries) {
    const planSetDir = path.join(options.corpusRoot, entry.plan_set_id);
    const llmAssistBySheetId = await loadLlmAssistsBySheetId(planSetDir);
    const pageFiles = await listPageFiles(planSetDir);

    for (const pageFile of pageFiles) {
      const pageRecord = await readJsonFile(pageFile);
      if (!pageRecord?.review) {
        continue;
      }

      const route = routePage(pageRecord, llmAssistBySheetId);
      if (options.withTierOnly && !route.tier) {
        continue;
      }

      const finalSelection = route.finalSelection;
      const model = getModelIdentity(pageRecord, finalSelection);
      const reviewed = getReviewedIdentity(pageRecord);
      const comparison = compareIdentity(model, reviewed);
      const bucketStats = summary.buckets[route.bucket] ?? createBucketStats();
      summary.buckets[route.bucket] = bucketStats;

      summary.pages += 1;
      bucketStats.pages += 1;
      if (comparison.identityCorrect) {
        bucketStats.identityCorrect += 1;
      } else {
        bucketStats.identityWrong += 1;
      }
      if (!comparison.numberCorrect) {
        bucketStats.numberWrong += 1;
      }
      if (!comparison.titleCorrect) {
        bucketStats.titleWrong += 1;
      }
      if (pageRecord.review.was_corrected === true) {
        bucketStats.correctedByReviewer += 1;
      }
      if (route.tier) {
        summary.with_confidence_tier += 1;
        bucketStats.withConfidenceTier += 1;
        addCount(summary.confidence_tiers, route.tier);
      } else {
        addCount(summary.confidence_tiers, "none");
      }
      addCount(summary.route_reasons, route.reason);

      for (const reason of finalSelection.confidenceReasons ?? []) {
        addCount(summary.confidence_reason_counts, reason);
      }

      if (typeof route.confidence === "number") {
        bucketStats.confidenceTotal += route.confidence;
        const bandStart = Math.floor(route.confidence * 10) / 10;
        const bandKey = `${bandStart.toFixed(1)}-${Math.min(1, bandStart + 0.1).toFixed(1)}`;
        if (!summary.confidence_bands[bandKey]) {
          summary.confidence_bands[bandKey] = {
            pages: 0,
            identityCorrect: 0,
            identityWrong: 0,
          };
        }
        summary.confidence_bands[bandKey].pages += 1;
        summary.confidence_bands[bandKey][
          comparison.identityCorrect ? "identityCorrect" : "identityWrong"
        ] += 1;
      }

      const example = buildExample({ entry, pageRecord, route, comparison });
      if (!comparison.identityCorrect) {
        pushExample(summary.examples, `${route.bucket}_wrong`, example, options.limitExamples);
      } else if (route.bucket === "llm_candidate") {
        pushExample(summary.examples, "llm_candidate_correct", example, options.limitExamples);
      }
    }
  }

  for (const stats of Object.values(summary.buckets)) {
    stats.identityAccuracy = stats.pages ? stats.identityCorrect / stats.pages : null;
    stats.wrongRate = stats.pages ? stats.identityWrong / stats.pages : null;
    stats.averageConfidence = stats.pages ? stats.confidenceTotal / stats.pages : null;
    delete stats.confidenceTotal;
  }

  return summary;
}

function printSummary(summary) {
  console.log("Plan Sheet LLM Gating Audit");
  console.log(`Corpus root: ${summary.corpus_root}`);
  console.log(
    `Reviewed plan sets: ${summary.plan_sets} | pages: ${summary.pages} | pages with saved tier: ${summary.with_confidence_tier}`
  );
  console.log("");
  console.log("Buckets");
  for (const bucket of BUCKET_ORDER) {
    const stats = summary.buckets[bucket];
    if (!stats?.pages) {
      continue;
    }
    console.log(
      `  ${bucket.padEnd(20)} pages=${String(stats.pages).padStart(5)} ` +
        `accuracy=${formatPercent(stats.identityAccuracy).padStart(7)} ` +
        `wrong=${String(stats.identityWrong).padStart(4)} ` +
        `numberWrong=${String(stats.numberWrong).padStart(4)} ` +
        `titleWrong=${String(stats.titleWrong).padStart(4)} ` +
        `avgConf=${formatPercent(stats.averageConfidence).padStart(7)} ` +
        `withTier=${String(stats.withConfidenceTier).padStart(4)}`
    );
  }

  console.log("");
  console.log("Confidence Tiers");
  for (const [tier, count] of Object.entries(summary.confidence_tiers).sort(
    (left, right) => right[1] - left[1]
  )) {
    console.log(`  ${tier.padEnd(24)} ${count}`);
  }

  console.log("");
  console.log("Top Route Reasons");
  for (const [reason, count] of Object.entries(summary.route_reasons)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 16)) {
    console.log(`  ${reason.padEnd(36)} ${count}`);
  }

  console.log("");
  console.log("Top Calibration Reasons");
  for (const [reason, count] of Object.entries(summary.confidence_reason_counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 16)) {
    console.log(`  ${reason.padEnd(44)} ${count}`);
  }

  for (const [group, examples] of Object.entries(summary.examples)) {
    if (!examples.length) {
      continue;
    }
    console.log("");
    console.log(`Examples: ${group}`);
    for (const example of examples) {
      console.log(
        `  ${example.file ?? example.plan_set_id} p${example.page_number}: ` +
          `${example.model_identity} -> ${example.reviewed_identity} ` +
          `(conf=${example.confidence ?? "n/a"}, tier=${example.confidence_tier ?? "none"}, reason=${example.route_reason})`
      );
      if (example.confidence_reasons.length > 0) {
        console.log(`    calibration: ${example.confidence_reasons.join(", ")}`);
      }
      if (example.title_source_text) {
        console.log(`    title source: ${normalizeWhitespace(example.title_source_text).slice(0, 160)}`);
      }
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await auditCorpus(options);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printSummary(summary);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
