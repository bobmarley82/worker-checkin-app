"use client";

import { useEffect, useState } from "react";
import type {
  CorrectionReason,
  TrainingVerificationStatus,
} from "@/lib/trainingCorpusShared";
import {
  canonicalizeTrainingSheetNumber,
  canonicalizeTrainingSheetTitle,
} from "@/lib/trainingCorpusShared";

type TrainingRecordStatusBadgeProps = {
  sheetId: string;
  initialStatus: TrainingVerificationStatus;
  savedSnapshot:
    | {
        sheet_number: string;
        sheet_title: string;
        discipline: string | null;
        sheet_kind: string;
        correction_reason: CorrectionReason;
        correction_note: string | null;
      }
    | null;
};

const STATUS_STYLES: Record<TrainingVerificationStatus, string> = {
  Unsaved: "bg-slate-200 text-slate-700",
  Saved: "bg-blue-100 text-blue-800",
  "Saved and verified": "bg-emerald-100 text-emerald-800",
  "Save mismatch": "bg-amber-100 text-amber-800",
  "Missing artifact": "bg-rose-100 text-rose-800",
};

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function readNamedValue(name: string) {
  const input = document.getElementsByName(name).item(0) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;

  return input?.value ?? "";
}

export default function TrainingRecordStatusBadge({
  sheetId,
  initialStatus,
  savedSnapshot,
}: TrainingRecordStatusBadgeProps) {
  const [status, setStatus] = useState<TrainingVerificationStatus>(initialStatus);

  useEffect(() => {
    if (!savedSnapshot) {
      setStatus("Unsaved");
      return;
    }

    const fieldNames = [
      `sheet_number_${sheetId}`,
      `sheet_title_${sheetId}`,
      `discipline_${sheetId}`,
      `sheet_kind_${sheetId}`,
      `correction_reason_${sheetId}`,
      `correction_note_${sheetId}`,
    ];

    const syncStatus = () => {
      const hasUnsavedChanges =
        canonicalizeTrainingSheetNumber(readNamedValue(`sheet_number_${sheetId}`)) !==
          canonicalizeTrainingSheetNumber(savedSnapshot.sheet_number) ||
        canonicalizeTrainingSheetTitle(readNamedValue(`sheet_title_${sheetId}`)) !==
          canonicalizeTrainingSheetTitle(savedSnapshot.sheet_title) ||
        normalizeWhitespace(readNamedValue(`discipline_${sheetId}`)) !==
          normalizeWhitespace(savedSnapshot.discipline) ||
        normalizeWhitespace(readNamedValue(`sheet_kind_${sheetId}`)) !==
          normalizeWhitespace(savedSnapshot.sheet_kind) ||
        normalizeWhitespace(readNamedValue(`correction_reason_${sheetId}`)) !==
          normalizeWhitespace(savedSnapshot.correction_reason) ||
        normalizeWhitespace(readNamedValue(`correction_note_${sheetId}`)) !==
          normalizeWhitespace(savedSnapshot.correction_note);

      setStatus(hasUnsavedChanges ? "Unsaved" : initialStatus);
    };

    syncStatus();

    const targets = fieldNames
      .map((name) => document.getElementsByName(name).item(0))
      .filter(
        (
          node
        ): node is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
          Boolean(node)
      );

    for (const target of targets) {
      target.addEventListener("input", syncStatus);
      target.addEventListener("change", syncStatus);
    }

    return () => {
      for (const target of targets) {
        target.removeEventListener("input", syncStatus);
        target.removeEventListener("change", syncStatus);
      }
    };
  }, [initialStatus, savedSnapshot, sheetId]);

  return (
    <span
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold normal-case tracking-normal ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}
