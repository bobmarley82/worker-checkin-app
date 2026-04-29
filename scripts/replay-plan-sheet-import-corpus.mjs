import fs from "node:fs/promises";
import path from "node:path";
import {
  extractPlanSheetsFromReplayInput,
} from "../lib/planSheetImport.ts";
import {
  canonicalizeTrainingSheetNumber,
  canonicalizeTrainingSheetTitle,
  inferTrainingSheetKind,
} from "../lib/trainingCorpusShared.ts";

const workspaceRoot = process.cwd();
const defaultCorpusRoot = path.join(workspaceRoot, "data", "training-corpus");
const defaultDebugRoot = path.join(workspaceRoot, "tmp", "plan-sheet-import-debug");

function printUsage() {
  console.log(`Usage:
  node --experimental-loader ./tmp/server-only-loader.mjs --experimental-strip-types scripts/replay-plan-sheet-import-corpus.mjs --corpus <plan-set-id-or-dir>

Options:
  --corpus <value>   Corpus plan set id or full corpus directory path
  --output <path>    Optional JSON report output path
`);
}

function normalizeWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function resolveCorpusDir(value) {
  if (!value) {
    throw new Error("--corpus is required");
  }

  if (path.isAbsolute(value)) {
    return value;
  }

  const looksLikeRelativeDir =
    value.includes("\\") || value.includes("/") || value.startsWith(".");
  if (looksLikeRelativeDir) {
    return path.resolve(workspaceRoot, value);
  }

  return path.join(defaultCorpusRoot, value);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = {
    corpusDir: null,
    outputPath: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case "--corpus":
        options.corpusDir = resolveCorpusDir(argv[++index]);
        break;
      case "--output":
        options.outputPath = path.resolve(workspaceRoot, argv[++index]);
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!options.corpusDir) {
    throw new Error("--corpus is required");
  }

  return options;
}

function formatPair(sheetNumber, sheetTitle) {
  if (!sheetNumber && !sheetTitle) {
    return "(blank)";
  }
  if (!sheetNumber) {
    return `(no number) / ${sheetTitle ?? "(blank)"}`;
  }
  if (!sheetTitle) {
    return `${sheetNumber} / (blank)`;
  }
  return `${sheetNumber} / ${sheetTitle}`;
}

async function loadCorpusPageRecords(corpusDir) {
  const pagesDir = path.join(corpusDir, "pages");
  const entries = await fs.readdir(pagesDir);
  const pageFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  const pageRecords = await Promise.all(
    pageFiles.map(async (entry) => {
      const payload = await readJson(path.join(pagesDir, entry));
      return payload;
    })
  );

  pageRecords.sort(
    (left, right) =>
      Number(left?.review?.page_number ?? 0) - Number(right?.review?.page_number ?? 0)
  );
  return pageRecords;
}

function resolveReplayInputPath(importContext) {
  const explicitDir = normalizeWhitespace(importContext.debug_artifacts_dir ?? "");
  const sessionId = normalizeWhitespace(importContext.debug_session_id ?? "");
  const sessionDir = explicitDir
    ? explicitDir
    : sessionId
      ? path.join(defaultDebugRoot, sessionId)
      : "";

  if (!sessionDir) {
    throw new Error("Corpus import-context.json does not include a debug session.");
  }

  return {
    sessionDir,
    replayInputPath: path.join(sessionDir, "replay-input.json"),
  };
}

function buildReplayInputFromCorpusPageRecords(pageRecords) {
  const replayPages = [];
  const pdfTextResults = [];
  const missingReplayPages = [];

  for (const pageRecord of pageRecords) {
    const review = pageRecord?.review ?? null;
    const pipeline = pageRecord?.pipeline ?? null;
    const pageNumber = Number(review?.page_number ?? 0);
    const replayPageInput = pipeline?.replay_page_input;

    if (
      !pageNumber ||
      !replayPageInput ||
      typeof replayPageInput !== "object" ||
      Array.isArray(replayPageInput)
    ) {
      missingReplayPages.push(pageNumber || null);
      continue;
    }

    replayPages.push({
      ...replayPageInput,
      pageNumber,
    });

    if (
      pipeline?.replay_ocr_result &&
      typeof pipeline.replay_ocr_result === "object" &&
      !Array.isArray(pipeline.replay_ocr_result)
    ) {
      pdfTextResults.push({
        pageNumber,
        result: pipeline.replay_ocr_result,
      });
    }
  }

  if (replayPages.length === 0) {
    return {
      complete: false,
      reason: "Saved corpus pages do not include replay snapshots.",
      missingReplayPages: [],
      replayInput: null,
    };
  }

  if (missingReplayPages.length > 0) {
    return {
      complete: false,
      reason: "Saved corpus replay snapshots are incomplete.",
      missingReplayPages,
      replayInput: null,
    };
  }

  const pageCount = Math.max(
    ...pageRecords.map((pageRecord) => Number(pageRecord?.review?.page_number ?? 0)),
    0
  );

  replayPages.sort((left, right) => Number(left.pageNumber) - Number(right.pageNumber));
  pdfTextResults.sort((left, right) => Number(left.pageNumber) - Number(right.pageNumber));

  return {
    complete: true,
    reason: null,
    missingReplayPages: [],
    replayInput: {
      pageCount,
      pages: replayPages,
      pdfTextResults,
    },
  };
}

async function loadReplayInputForCorpus({ corpusDir, importContext, pageRecords }) {
  const corpusReplay = buildReplayInputFromCorpusPageRecords(pageRecords);
  if (corpusReplay.complete && corpusReplay.replayInput) {
    return {
      replayInput: corpusReplay.replayInput,
      replayInputSource: "corpus_pipeline",
      sessionDir: null,
      replayInputPath: null,
    };
  }

  const { sessionDir, replayInputPath } = resolveReplayInputPath(importContext);
  if (await fileExists(replayInputPath)) {
    return {
      replayInput: await readJson(replayInputPath),
      replayInputSource: "debug_session",
      sessionDir,
      replayInputPath,
    };
  }

  const missingPagesText = corpusReplay.missingReplayPages
    .filter((pageNumber) => typeof pageNumber === "number")
    .join(", ");
  const missingPagesSuffix = missingPagesText
    ? ` Missing corpus pages: ${missingPagesText}.`
    : "";
  throw new Error(
    `Replay input not found at ${replayInputPath}. ${corpusReplay.reason ?? "This session predates replay capture."}${missingPagesSuffix}`
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const importContextPath = path.join(options.corpusDir, "import-context.json");
  if (!(await fileExists(importContextPath))) {
    throw new Error(`Missing import-context.json in ${options.corpusDir}`);
  }

  const importContext = await readJson(importContextPath);
  const pageRecords = await loadCorpusPageRecords(options.corpusDir);
  const corpusPages = pageRecords.map((pageRecord) => pageRecord.review);
  const {
    replayInput,
    replayInputSource,
    sessionDir,
    replayInputPath,
  } = await loadReplayInputForCorpus({
    corpusDir: options.corpusDir,
    importContext,
    pageRecords,
  });

  const replayResult = await extractPlanSheetsFromReplayInput(replayInput, {
    forceDebugArtifacts: true,
  });
  const replaySheetsByPage = new Map(
    replayResult.sheets.map((sheet) => [Number(sheet.pageNumber), sheet])
  );

  const mismatches = [];
  let exactMetadataMatches = 0;
  let numberTitleMatches = 0;
  let disciplineMatches = 0;
  let kindMatches = 0;

  for (const review of corpusPages) {
    const actual = replaySheetsByPage.get(Number(review.page_number)) ?? {
      sheetNumber: "",
      sheetTitle: "",
      discipline: null,
    };
    const actualKind = inferTrainingSheetKind({
      sheetNumber: actual.sheetNumber,
      sheetTitle: actual.sheetTitle,
      discipline: actual.discipline,
    });
    const expectedNumber = canonicalizeTrainingSheetNumber(review.sheet_number);
    const expectedTitle = canonicalizeTrainingSheetTitle(review.sheet_title);
    const actualNumber = canonicalizeTrainingSheetNumber(actual.sheetNumber);
    const actualTitle = canonicalizeTrainingSheetTitle(actual.sheetTitle);
    const expectedDiscipline = normalizeWhitespace(review.discipline ?? "");
    const actualDiscipline = normalizeWhitespace(actual.discipline ?? "");
    const expectedKind = normalizeWhitespace(review.sheet_kind ?? "");
    const normalizedActualKind = normalizeWhitespace(actualKind ?? "");

    const numberTitleMatch =
      actualNumber === expectedNumber && actualTitle === expectedTitle;
    const disciplineMatch = actualDiscipline === expectedDiscipline;
    const kindMatch = normalizedActualKind === expectedKind;

    if (numberTitleMatch) {
      numberTitleMatches += 1;
    }
    if (disciplineMatch) {
      disciplineMatches += 1;
    }
    if (kindMatch) {
      kindMatches += 1;
    }
    if (numberTitleMatch && disciplineMatch && kindMatch) {
      exactMetadataMatches += 1;
      continue;
    }

    const changedFields = [];
    if (!numberTitleMatch) {
      if (actualNumber !== expectedNumber) {
        changedFields.push("sheet_number");
      }
      if (actualTitle !== expectedTitle) {
        changedFields.push("sheet_title");
      }
    }
    if (!disciplineMatch) {
      changedFields.push("discipline");
    }
    if (!kindMatch) {
      changedFields.push("sheet_kind");
    }

    mismatches.push({
      pageNumber: Number(review.page_number),
      changedFields,
      expected: {
        sheetNumber: review.sheet_number ?? null,
        sheetTitle: review.sheet_title ?? null,
        discipline: review.discipline ?? null,
        sheetKind: review.sheet_kind ?? null,
      },
      actual: {
        sheetNumber: actual.sheetNumber || null,
        sheetTitle: actual.sheetTitle || null,
        discipline: actual.discipline ?? null,
        sheetKind: actualKind ?? null,
      },
    });
  }

  const report = {
    createdAt: new Date().toISOString(),
    corpusDir: options.corpusDir,
    replayInputSource,
    sourceSessionDir: sessionDir,
    replayInputPath,
    replaySessionId: replayResult.debugSessionId ?? null,
    replaySessionDir: replayResult.debugArtifactsDir ?? null,
    summary: {
      pageCount: corpusPages.length,
      exactMetadataMatches,
      numberTitleMatches,
      disciplineMatches,
      kindMatches,
      mismatches: mismatches.length,
    },
    mismatches,
  };

  if (options.outputPath) {
    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  console.log(`Corpus: ${options.corpusDir}`);
  console.log(`Replay input source: ${replayInputSource}`);
  console.log(`Source session: ${sessionDir ?? "(not needed)"}`);
  console.log(`Replay input path: ${replayInputPath ?? "(reconstructed from corpus)"}`);
  console.log(`Replay session: ${replayResult.debugArtifactsDir ?? "(none)"}`);
  console.log(
    `Exact metadata: ${exactMetadataMatches}/${corpusPages.length}; number/title: ${numberTitleMatches}/${corpusPages.length}; discipline: ${disciplineMatches}/${corpusPages.length}; kind: ${kindMatches}/${corpusPages.length}`
  );

  for (const mismatch of mismatches) {
    console.log(
      `  page ${mismatch.pageNumber}: ${mismatch.changedFields.join(", ")}; expected ${formatPair(
        mismatch.expected.sheetNumber,
        mismatch.expected.sheetTitle
      )} / ${mismatch.expected.discipline ?? "(none)"} / ${mismatch.expected.sheetKind ?? "(none)"}; got ${formatPair(
        mismatch.actual.sheetNumber,
        mismatch.actual.sheetTitle
      )} / ${mismatch.actual.discipline ?? "(none)"} / ${mismatch.actual.sheetKind ?? "(none)"}`
    );
  }

  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  if (
    typeof message === "string" &&
    (/^--corpus is required\b/.test(message) || /^Unknown argument: /.test(message))
  ) {
    printUsage();
  }
  process.exitCode = 1;
});
