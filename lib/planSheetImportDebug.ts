import "server-only";

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

type DebugValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean | null>;

type DebugFields = Record<string, DebugValue>;

export type PlanSheetImportDebugSession = ReturnType<
  typeof createPlanSheetImportDebugSession
>;

const PLAN_SHEET_IMPORT_DEBUG_ENABLED =
  process.env.PLAN_SHEET_IMPORT_DEBUG === "1";
const PLAN_SHEET_IMPORT_DEBUG_VERBOSE =
  process.env.PLAN_SHEET_IMPORT_DEBUG_VERBOSE === "1";
const PLAN_SHEET_IMPORT_DEBUG_ARTIFACTS =
  process.env.PLAN_SHEET_IMPORT_DEBUG_ARTIFACTS === "1" ||
  PLAN_SHEET_IMPORT_DEBUG_VERBOSE;

function shouldLogEvent(event: string, fields?: DebugFields) {
  if (!PLAN_SHEET_IMPORT_DEBUG_ENABLED) {
    return false;
  }

  if (PLAN_SHEET_IMPORT_DEBUG_VERBOSE) {
    return true;
  }

  if (
    event === "session:start" ||
    event === "session:end" ||
    event === "ocr.pages.selected" ||
    event === "ocr.run_for_pages:end" ||
    event === "extract_plan_sheets:end" ||
    event === "page.selection" ||
    event === "page.summary"
  ) {
    return true;
  }

  if (
    event.includes("failed") ||
    fields?.result === "error" ||
    fields?.result === "ocr_unavailable" ||
    fields?.result === "pdf_open_failed"
  ) {
    return true;
  }

  return false;
}

function roundDuration(value: number) {
  return Number(value.toFixed(1));
}

function serializeFields(fields?: DebugFields) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(fields ?? {}).filter(([, value]) => value !== undefined)
    )
  );
}

export function createPlanSheetImportDebugSession(context?: {
  fileByteLength?: number;
  forceArtifacts?: boolean;
}) {
  const sessionId = `psi-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const sessionStart = performance.now();
  const artifactsDir =
    (PLAN_SHEET_IMPORT_DEBUG_ENABLED && PLAN_SHEET_IMPORT_DEBUG_ARTIFACTS) ||
    context?.forceArtifacts
      ? path.join(process.cwd(), "tmp", "plan-sheet-import-debug", sessionId)
      : null;

  if (artifactsDir) {
    fs.mkdirSync(artifactsDir, { recursive: true });
  }

  const log = (event: string, fields?: DebugFields) => {
    if (!shouldLogEvent(event, fields)) {
      return;
    }

    const prefix = `[plan-sheet-import][${sessionId}] ${event}`;
    const serialized = serializeFields(fields);
    console.info(serialized === "{}" ? prefix : `${prefix} ${serialized}`);
  };

  const startTimer = (event: string, fields?: DebugFields) => {
    const start = performance.now();
    log(`${event}:start`, fields);

    return {
      end(extraFields?: DebugFields) {
        const durationMs = roundDuration(performance.now() - start);
        log(`${event}:end`, {
          ...fields,
          ...extraFields,
          durationMs,
        });
        return durationMs;
      },
    };
  };

  log("session:start", {
    fileByteLength: context?.fileByteLength ?? null,
    artifactsDir,
  });

  return {
    enabled: PLAN_SHEET_IMPORT_DEBUG_ENABLED,
    verbose: PLAN_SHEET_IMPORT_DEBUG_VERBOSE,
    artifactsEnabled: Boolean(artifactsDir),
    artifactsDir,
    sessionId,
    log,
    writeJsonArtifact(relativePath: string, value: unknown) {
      if (!artifactsDir) {
        return null;
      }

      const absolutePath = path.join(artifactsDir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      return absolutePath;
    },
    writeBufferArtifact(relativePath: string, value: Buffer | Uint8Array) {
      if (!artifactsDir) {
        return null;
      }

      const absolutePath = path.join(artifactsDir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, value);
      return absolutePath;
    },
    startTimer,
    end(fields?: DebugFields) {
      log("session:end", {
        totalDurationMs: roundDuration(performance.now() - sessionStart),
        ...fields,
      });
    },
  };
}
