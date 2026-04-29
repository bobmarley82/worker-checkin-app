import type {
  MetadataRegionId,
  MetadataStyleProfile,
  OcrNormalizedBox,
  PositionedTextItem,
  SheetNumberCandidate,
  TextLine,
} from "./planSheetImportTypes";
import { PDF_METADATA_REGION_MAP } from "./planSheetImportConfig";
import { getStyleProfileForRegion as getStyleProfileForRegionBase } from "./planSheetImportHeuristics";

export function getMetadataRegionById(regionId: MetadataRegionId) {
  return PDF_METADATA_REGION_MAP.get(regionId) ?? null;
}

export function getLineRight(line: TextLine) {
  return line.normX + line.normWidth;
}

export function getLineLeft(line: TextLine) {
  return line.normX;
}

export function getLineBottom(line: TextLine) {
  return line.normY + line.normHeight;
}

export function getLineCenterX(line: TextLine) {
  return line.normX + line.normWidth / 2;
}

export function getLineCenterY(line: TextLine) {
  return line.normY + line.normHeight / 2;
}

export function getItemFontSizeSignal(item: PositionedTextItem) {
  return Number.isFinite(item.fontSize ?? NaN) && (item.fontSize ?? 0) > 0
    ? (item.fontSize ?? 0)
    : item.height;
}

export function getLineFontSizeSignal(line: TextLine) {
  return Number.isFinite(line.fontSize ?? NaN) && (line.fontSize ?? 0) > 0
    ? (line.fontSize ?? 0)
    : line.height;
}

export function median(numbers: number[]) {
  if (numbers.length === 0) {
    return 0;
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

export function getBoxRight(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return box.x + box.width;
}

export function getBoxBottom(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return box.y + box.height;
}

export function getNormalizedBoxFromLine(line: TextLine) {
  return {
    x: line.normX,
    y: line.normY,
    width: line.normWidth,
    height: line.normHeight,
  };
}

export function getNormalizedBoxFromCandidate(
  candidate: SheetNumberCandidate,
  fallbackLine: TextLine | null
) {
  if (candidate.normWidth > 0 && candidate.normHeight > 0) {
    return {
      x: candidate.normX,
      y: candidate.normY,
      width: candidate.normWidth,
      height: candidate.normHeight,
    };
  }

  if (fallbackLine) {
    return getNormalizedBoxFromLine(fallbackLine);
  }

  return {
    x: candidate.normX,
    y: candidate.normY,
    width: 0,
    height: 0,
  };
}

export function getNormalizedUnionBox(
  boxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>
) {
  if (boxes.length === 0) {
    return null;
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => getBoxRight(box)));
  const bottom = Math.max(...boxes.map((box) => getBoxBottom(box)));

  return {
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

export function getLineHorizontalOverlap(left: TextLine, right: TextLine) {
  const overlap =
    Math.min(getLineRight(left), getLineRight(right)) -
    Math.max(left.normX, right.normX);

  return Math.max(overlap, 0);
}

export function getNormalizedTextLineBox(lines: TextLine[]) {
  if (lines.length === 0) {
    return null;
  }

  const left = Math.min(...lines.map((line) => line.normX));
  const top = Math.min(...lines.map((line) => line.normY));
  const right = Math.max(...lines.map((line) => getLineRight(line)));
  const bottom = Math.max(...lines.map((line) => getLineBottom(line)));

  return {
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

export function getStyleProfileForRegion(regionId: MetadataRegionId): MetadataStyleProfile {
  return getStyleProfileForRegionBase(regionId) as MetadataStyleProfile;
}

export function isLineInsideRegion(
  line: TextLine,
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  }
) {
  const right = line.normX + line.normWidth;
  const bottom = line.normY + line.normHeight;

  return (
    right >= region.x &&
    line.normX <= region.x + region.width &&
    bottom >= region.y &&
    line.normY <= region.y + region.height
  );
}

export function expandNormalizedBox(
  box: OcrNormalizedBox,
  horizontalPadding: number,
  verticalPadding: number
): OcrNormalizedBox {
  const left = Math.max(0, box.x - horizontalPadding);
  const top = Math.max(0, box.y - verticalPadding);
  const right = Math.min(1, box.x + box.width + horizontalPadding);
  const bottom = Math.min(1, box.y + box.height + verticalPadding);

  return {
    x: left,
    y: top,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}
