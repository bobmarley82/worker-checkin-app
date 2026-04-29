"use client";

import { useEffect } from "react";
import {
  formatTrainingTagList,
  inferTrainingSheetKind,
  normalizeTrainingBlueprintMetadata,
  suggestTrainingCorrectionReason,
} from "@/lib/trainingCorpusShared";

type TrainingReviewAutofillProps = {
  sheetId: string;
  modelSheetNumber: string | null;
  modelSheetTitle: string | null;
  modelDiscipline: string | null;
  modelSheetType: string;
  modelScopeTags: string[];
  modelAreaTags: string[];
  modelSheetKind: string;
};

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function readNamedElement(name: string) {
  return document.getElementsByName(name).item(0) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
}

function readNamedValue(name: string) {
  return readNamedElement(name)?.value ?? "";
}

function writeSelectValue(select: HTMLSelectElement, nextValue: string) {
  if (normalizeWhitespace(select.value) === normalizeWhitespace(nextValue)) {
    return;
  }

  select.value = nextValue;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function writeInputValue(input: HTMLInputElement, nextValue: string) {
  if (normalizeWhitespace(input.value) === normalizeWhitespace(nextValue)) {
    return;
  }

  input.value = nextValue;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function writeTextValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  nextValue: string
) {
  if (normalizeWhitespace(input.value) === normalizeWhitespace(nextValue)) {
    return;
  }

  input.value = nextValue;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isInitiallyPinned(currentValue: string, suggestedValue: string) {
  const current = normalizeWhitespace(currentValue);
  const suggested = normalizeWhitespace(suggestedValue);

  if (!current) {
    return false;
  }

  return current !== suggested;
}

function getCorrectionReasonLabel(value: string) {
  switch (normalizeWhitespace(value)) {
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

export default function TrainingReviewAutofill({
  sheetId,
  modelSheetNumber,
  modelSheetTitle,
  modelDiscipline,
  modelSheetType,
  modelScopeTags,
  modelAreaTags,
  modelSheetKind,
}: TrainingReviewAutofillProps) {
  useEffect(() => {
    const numberInput = readNamedElement(`sheet_number_${sheetId}`);
    const titleInput = readNamedElement(`sheet_title_${sheetId}`);
    const disciplineInput = readNamedElement(`discipline_${sheetId}`);
    const sheetTypeSelect = readNamedElement(`sheet_type_${sheetId}`);
    const scopeTagsInput = readNamedElement(`scope_tags_${sheetId}`);
    const areaTagsInput = readNamedElement(`area_tags_${sheetId}`);
    const sheetKindSelect = readNamedElement(`sheet_kind_${sheetId}`);
    const correctionReasonInput = readNamedElement(`correction_reason_${sheetId}`);
    const correctionReasonDisplay = document.getElementById(
      `correction_reason_display_${sheetId}`
    );

    if (
      !numberInput ||
      !titleInput ||
      !disciplineInput ||
      !(sheetTypeSelect instanceof HTMLSelectElement) ||
      !(scopeTagsInput instanceof HTMLInputElement) ||
      !(areaTagsInput instanceof HTMLInputElement) ||
      !(sheetKindSelect instanceof HTMLSelectElement) ||
      !(correctionReasonInput instanceof HTMLInputElement)
    ) {
      return;
    }

    const getSuggestedMetadata = () =>
      normalizeTrainingBlueprintMetadata({
        sheet_number: readNamedValue(`sheet_number_${sheetId}`),
        sheet_title: readNamedValue(`sheet_title_${sheetId}`),
        discipline: readNamedValue(`discipline_${sheetId}`) || null,
        sheet_type: "",
        scope_tags: [],
        area_tags: [],
      });

    const getSuggestedKind = () =>
      inferTrainingSheetKind({
        sheetNumber: readNamedValue(`sheet_number_${sheetId}`),
        sheetTitle: readNamedValue(`sheet_title_${sheetId}`),
        discipline: readNamedValue(`discipline_${sheetId}`) || null,
      });

    const getSuggestedReason = (sheetKind: string) =>
      suggestTrainingCorrectionReason({
        model: {
          sheet_number: modelSheetNumber,
          sheet_title: modelSheetTitle,
          discipline: modelDiscipline,
          sheet_type: modelSheetType,
          scope_tags: modelScopeTags,
          area_tags: modelAreaTags,
          sheet_kind: modelSheetKind,
        },
        reviewed: {
          sheet_number: readNamedValue(`sheet_number_${sheetId}`),
          sheet_title: readNamedValue(`sheet_title_${sheetId}`),
          discipline: readNamedValue(`discipline_${sheetId}`) || null,
          sheet_type: readNamedValue(`sheet_type_${sheetId}`),
          scope_tags: readNamedValue(`scope_tags_${sheetId}`),
          area_tags: readNamedValue(`area_tags_${sheetId}`),
          sheet_kind: sheetKind,
        },
      });

    const suggestedMetadata = getSuggestedMetadata();
    let typePinned = isInitiallyPinned(
      sheetTypeSelect.value,
      suggestedMetadata.sheet_type
    );
    let scopePinned = isInitiallyPinned(
      scopeTagsInput.value,
      formatTrainingTagList(suggestedMetadata.scope_tags)
    );
    let areaPinned = isInitiallyPinned(
      areaTagsInput.value,
      formatTrainingTagList(suggestedMetadata.area_tags)
    );
    let kindPinned = isInitiallyPinned(sheetKindSelect.value, getSuggestedKind());

    const modelScopeTagText = normalizeWhitespace(
      formatTrainingTagList(modelScopeTags)
    );
    const modelAreaTagText = normalizeWhitespace(
      formatTrainingTagList(modelAreaTags)
    );

    const syncSuggestedValues = (options?: {
      preserveInitialModelPrefill?: boolean;
    }) => {
      const nextSuggestedMetadata = getSuggestedMetadata();
      if (!typePinned) {
        writeSelectValue(sheetTypeSelect, nextSuggestedMetadata.sheet_type);
      }
      if (!scopePinned) {
        const nextScopeTags = formatTrainingTagList(nextSuggestedMetadata.scope_tags);
        const preserveInitialModelScopePrefill =
          options?.preserveInitialModelPrefill &&
          modelScopeTagText.length > 0 &&
          normalizeWhitespace(scopeTagsInput.value) === modelScopeTagText;
        if (!preserveInitialModelScopePrefill) {
          writeTextValue(scopeTagsInput, nextScopeTags);
        }
      }
      if (!areaPinned) {
        const nextAreaTags = formatTrainingTagList(nextSuggestedMetadata.area_tags);
        const preserveInitialModelAreaPrefill =
          options?.preserveInitialModelPrefill &&
          modelAreaTagText.length > 0 &&
          normalizeWhitespace(areaTagsInput.value) === modelAreaTagText;
        if (!preserveInitialModelAreaPrefill) {
          writeTextValue(areaTagsInput, nextAreaTags);
        }
      }

      const suggestedKind = getSuggestedKind();
      if (!kindPinned) {
        writeSelectValue(sheetKindSelect, suggestedKind);
      }

      const effectiveKind = kindPinned ? sheetKindSelect.value : suggestedKind;
      const suggestedReason = getSuggestedReason(effectiveKind);
      writeInputValue(correctionReasonInput, suggestedReason);
      if (correctionReasonDisplay) {
        correctionReasonDisplay.textContent = getCorrectionReasonLabel(
          suggestedReason
        );
      }
    };

    const handleTextInput = () => {
      syncSuggestedValues();
    };

    const handleTypeChange = () => {
      const nextSuggestedMetadata = getSuggestedMetadata();
      typePinned =
        normalizeWhitespace(sheetTypeSelect.value) !==
        normalizeWhitespace(nextSuggestedMetadata.sheet_type);
      syncSuggestedValues();
    };

    const handleScopeChange = () => {
      const nextSuggestedMetadata = getSuggestedMetadata();
      scopePinned =
        normalizeWhitespace(scopeTagsInput.value) !==
        normalizeWhitespace(formatTrainingTagList(nextSuggestedMetadata.scope_tags));
      syncSuggestedValues();
    };

    const handleAreaChange = () => {
      const nextSuggestedMetadata = getSuggestedMetadata();
      areaPinned =
        normalizeWhitespace(areaTagsInput.value) !==
        normalizeWhitespace(formatTrainingTagList(nextSuggestedMetadata.area_tags));
      syncSuggestedValues();
    };

    const handleKindChange = () => {
      const suggestedKind = getSuggestedKind();
      kindPinned =
        normalizeWhitespace(sheetKindSelect.value) !==
        normalizeWhitespace(suggestedKind);

      syncSuggestedValues();
    };

    numberInput.addEventListener("input", handleTextInput);
    titleInput.addEventListener("input", handleTextInput);
    disciplineInput.addEventListener("input", handleTextInput);
    sheetTypeSelect.addEventListener("change", handleTypeChange);
    scopeTagsInput.addEventListener("input", handleScopeChange);
    areaTagsInput.addEventListener("input", handleAreaChange);
    sheetKindSelect.addEventListener("change", handleKindChange);

    syncSuggestedValues({ preserveInitialModelPrefill: true });

    return () => {
      numberInput.removeEventListener("input", handleTextInput);
      titleInput.removeEventListener("input", handleTextInput);
      disciplineInput.removeEventListener("input", handleTextInput);
      sheetTypeSelect.removeEventListener("change", handleTypeChange);
      scopeTagsInput.removeEventListener("input", handleScopeChange);
      areaTagsInput.removeEventListener("input", handleAreaChange);
      sheetKindSelect.removeEventListener("change", handleKindChange);
    };
  }, [
    modelDiscipline,
    modelAreaTags,
    modelSheetKind,
    modelSheetNumber,
    modelSheetType,
    modelSheetTitle,
    modelScopeTags,
    sheetId,
  ]);

  return null;
}
