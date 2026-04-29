export {
  normalizeSheetNumberValue,
  refineSheetNumberCandidateFromLineText,
  preferMoreSpecificCompatibleSheetNumber,
  choosePreferredSingleAcceptedAnchorNumber,
  promoteAlternateStarSheetNumber,
  reconcileOcrSheetNumberWithAnchorNumbers,
  countSheetReferenceTokens,
  parseSheetNumberParts,
  normalizeOcrSheetNumberWithTitleContext,
  isPlausibleOcrNumberTokenMatch,
  shouldAllowUnsupportedOcrPrefix,
} from "./core";
