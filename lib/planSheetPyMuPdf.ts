import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const BUNDLED_PYTHON_PATH =
  "C:\\Users\\Josh\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const PYMUPDF_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "pymupdf_extract_words.py"
);
const PYMUPDF_DETAIL_SHAPE_SCRIPT_PATH = path.join(
  process.cwd(),
  "scripts",
  "pymupdf_check_detail_shapes.py"
);
const PYMUPDF_VENDOR_PATH = path.join(process.cwd(), "tmp", "pymupdf_vendor");
const PYMUPDF_PROGRESS_PREFIX = "PLAN_SHEET_PYMUPDF_PROGRESS ";

type PyMuPdfExtractedWord = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
  block: number;
  line: number;
  word: number;
  fontSize?: number | null;
  fontName?: string | null;
  fontFlags?: number | null;
  isBold?: boolean | null;
};

type PyMuPdfExtractedDrawingSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width?: number | null;
};

type PyMuPdfExtractedDrawingShape = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  kind?: string | null;
  width?: number | null;
  operatorCount?: number | null;
  hasCurve?: boolean | null;
};

type PyMuPdfExtractedPage = {
  pageNumber: number;
  width: number;
  height: number;
  words: PyMuPdfExtractedWord[];
  searchWords?: PyMuPdfExtractedWord[];
  drawingSegments?: PyMuPdfExtractedDrawingSegment[];
  drawingShapes?: PyMuPdfExtractedDrawingShape[];
  sheetIndexLines?: string[];
};

type PyMuPdfExtractedDocument = {
  totalPageCount?: number;
  pages: PyMuPdfExtractedPage[];
};

type PyMuPdfPageProgress = {
  pageNumber: number;
  processedPageCount: number;
  selectedPageCount: number;
  sourcePageCount: number;
};

export type PyMuPdfDetailShapeCandidate = {
  id: string;
  pageNumber: number;
  detailBounds: { x: number; y: number; width: number; height: number };
  sheetBounds: { x: number; y: number; width: number; height: number };
  mode?: "detail_callout" | "sheet_marker";
};

export type PyMuPdfDetailShapeResult = {
  id: string;
  confirmed: boolean;
  reason: string;
  cropBounds?: { x: number; y: number; width: number; height: number } | null;
  shapeBounds?: { x: number; y: number; width: number; height: number } | null;
  metrics?: Record<string, number> | null;
};

async function runPyMuPdfExtractionProcess(
  args: string[],
  onPageExtracted?: (progress: PyMuPdfPageProgress) => void | Promise<void>
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(BUNDLED_PYTHON_PATH, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${PYMUPDF_VENDOR_PATH}${path.delimiter}${process.env.PYTHONPATH}`
          : PYMUPDF_VENDOR_PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutRemainder = "";
    let stderr = "";
    let progressUpdates = Promise.resolve();

    const handleStdoutLine = (line: string) => {
      if (!line.startsWith(PYMUPDF_PROGRESS_PREFIX)) {
        return;
      }

      try {
        const payload = JSON.parse(
          line.slice(PYMUPDF_PROGRESS_PREFIX.length)
        ) as Partial<PyMuPdfPageProgress> & {
          event?: string;
        };
        if (
          payload.event === "page_extracted" &&
          typeof payload.pageNumber === "number" &&
          typeof payload.processedPageCount === "number" &&
          typeof payload.selectedPageCount === "number" &&
          typeof payload.sourcePageCount === "number"
        ) {
          const pageProgress = {
            pageNumber: payload.pageNumber,
            processedPageCount: payload.processedPageCount,
            selectedPageCount: payload.selectedPageCount,
            sourcePageCount: payload.sourcePageCount,
          };
          progressUpdates = progressUpdates.then(() =>
            onPageExtracted?.(pageProgress)
          );
        }
      } catch {
        // Ignore malformed progress lines; the output file remains authoritative.
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      lines.forEach(handleStdoutLine);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (stdoutRemainder) {
        handleStdoutLine(stdoutRemainder);
      }

      void progressUpdates
        .then(() => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(
            new Error(
              stderr.trim() ||
                `PyMuPDF extraction process exited with code ${code ?? "unknown"}.`
            )
          );
        })
        .catch(reject);
    });
  });
}

async function runPyMuPdfProcess(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(BUNDLED_PYTHON_PATH, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${PYMUPDF_VENDOR_PATH}${path.delimiter}${process.env.PYTHONPATH}`
          : PYMUPDF_VENDOR_PATH,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            `PyMuPDF process exited with code ${code ?? "unknown"}.`
        )
      );
    });
  });
}

export async function extractPdfWordsWithPyMuPdf(
  fileBytes: Uint8Array,
  options?: {
    pageNumbers?: number[] | null;
    mode?: "metadata" | "broad";
    onPageExtracted?: (progress: PyMuPdfPageProgress) => void | Promise<void>;
  }
) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plan-sheet-pymupdf-"));
  const inputPdfPath = path.join(tempRoot, "input.pdf");
  const outputJsonPath = path.join(tempRoot, "output.json");

  try {
    await fs.writeFile(inputPdfPath, fileBytes);

    const normalizedPageNumbers = [...new Set(
      (options?.pageNumbers ?? [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1)
    )].sort((left, right) => left - right);
    const args = [PYMUPDF_SCRIPT_PATH, inputPdfPath, outputJsonPath];
    if (normalizedPageNumbers.length > 0) {
      args.push(normalizedPageNumbers.join(","));
    }
    if (options?.mode === "broad") {
      if (normalizedPageNumbers.length === 0) {
        args.push("");
      }
      args.push("broad");
    }

    await runPyMuPdfExtractionProcess(args, options?.onPageExtracted);

    const rawOutput = await fs.readFile(outputJsonPath, "utf8");
    const parsed = JSON.parse(rawOutput) as PyMuPdfExtractedDocument;
    return {
      totalPageCount:
        Number.isInteger(parsed.totalPageCount) && (parsed.totalPageCount ?? 0) > 0
          ? (parsed.totalPageCount as number)
          : parsed.pages.length,
      pages: parsed.pages,
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function checkDetailCalloutShapesWithPyMuPdf(
  fileBytes: Uint8Array,
  candidates: PyMuPdfDetailShapeCandidate[]
) {
  if (candidates.length === 0) {
    return [] satisfies PyMuPdfDetailShapeResult[];
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "plan-sheet-shapes-"));
  const inputPdfPath = path.join(tempRoot, "input.pdf");
  const candidatesJsonPath = path.join(tempRoot, "candidates.json");
  const outputJsonPath = path.join(tempRoot, "output.json");

  try {
    await fs.writeFile(inputPdfPath, fileBytes);
    await fs.writeFile(
      candidatesJsonPath,
      JSON.stringify(candidates.slice(0, 250)),
      "utf8"
    );
    await runPyMuPdfProcess([
      PYMUPDF_DETAIL_SHAPE_SCRIPT_PATH,
      inputPdfPath,
      candidatesJsonPath,
      outputJsonPath,
    ]);

    const rawOutput = await fs.readFile(outputJsonPath, "utf8");
    const parsed = JSON.parse(rawOutput) as {
      results?: PyMuPdfDetailShapeResult[];
    };
    return parsed.results ?? [];
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
