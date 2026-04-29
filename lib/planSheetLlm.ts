import "server-only";

import {
  buildTrainingArtifactEvidence,
  buildTrainingPageHash,
  savePlanSetImportLlmAssists,
  type PlanSheetImportLlmErrorKind,
  type PlanSheetImportLlmRetryAttempt,
  type PlanSheetImportLlmEffectiveFieldSources,
  type PlanSheetImportLlmEffectiveSource,
  type PlanSheetImportLlmAssistRow,
  type PlanSheetLlmMetadataSnapshot,
  type TrainingModelSheet,
} from "./trainingCorpus";
import type { OcrRegionId, OcrStyleProfile } from "./planSheetOcr";
import {
  getTrainingChangedFields,
  canonicalizeTrainingSheetNumber,
  canonicalizeTrainingSheetTitle,
  inferTrainingSheetKind,
  normalizeTrainingBlueprintMetadata,
  normalizeTrainingDiscipline,
  parseTrainingTagList,
} from "./trainingCorpusShared";
import { getStyleProfileForRegion } from "./planSheetImportHeuristics";

const DEFAULT_PLAN_SHEET_LLM_TIMEOUT_MS = 45000;
const DEFAULT_PLAN_SHEET_LLM_CONCURRENCY = 2;
const DEFAULT_PLAN_SHEET_LLM_MAX_RETRIES = 2;
const DEFAULT_PLAN_SHEET_LLM_RETRY_BACKOFF_MS = 750;

function isTruthyEnvFlag(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseResponseTagList(value: unknown) {
  if (Array.isArray(value)) {
    return parseTrainingTagList(value.map((entry) => String(entry ?? "")));
  }

  return parseTrainingTagList(typeof value === "string" ? value : null);
}

function getPlanSheetLlmConfig() {
  if (isTruthyEnvFlag(process.env.PLAN_SHEET_METADATA_LLM_DISABLED)) {
    return null;
  }

  const endpoint = normalizeWhitespace(process.env.PLAN_SHEET_METADATA_LLM_URL);
  const token = normalizeWhitespace(process.env.PLAN_SHEET_METADATA_LLM_TOKEN);
  const timeoutMs = Number(process.env.PLAN_SHEET_METADATA_LLM_TIMEOUT_MS ?? "");
  const concurrency = Number(process.env.PLAN_SHEET_METADATA_LLM_CONCURRENCY ?? "");
  const maxRetries = Number(process.env.PLAN_SHEET_METADATA_LLM_MAX_RETRIES ?? "");
  const retryBackoffMs = Number(process.env.PLAN_SHEET_METADATA_LLM_RETRY_BACKOFF_MS ?? "");

  if (!endpoint || !token) {
    return null;
  }

  return {
    endpoint,
    token,
    timeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? Math.trunc(timeoutMs)
        : DEFAULT_PLAN_SHEET_LLM_TIMEOUT_MS,
    concurrency:
      Number.isFinite(concurrency) && concurrency > 0
        ? Math.max(1, Math.trunc(concurrency))
        : DEFAULT_PLAN_SHEET_LLM_CONCURRENCY,
    maxRetries:
      Number.isFinite(maxRetries) && maxRetries >= 0
        ? Math.max(0, Math.trunc(maxRetries))
        : DEFAULT_PLAN_SHEET_LLM_MAX_RETRIES,
    retryBackoffMs:
      Number.isFinite(retryBackoffMs) && retryBackoffMs > 0
        ? Math.max(50, Math.trunc(retryBackoffMs))
        : DEFAULT_PLAN_SHEET_LLM_RETRY_BACKOFF_MS,
  };
}

export function isPlanSheetMetadataLlmEnabled() {
  return Boolean(getPlanSheetLlmConfig());
}

type PlanSheetArtifactEvidence = Awaited<
  ReturnType<typeof buildTrainingArtifactEvidence>
>;

export type PlanSheetImportResolverResult = {
  assist: PlanSheetImportLlmAssistRow;
  effective_metadata: PlanSheetLlmMetadataSnapshot;
  effective_field_sources: PlanSheetImportLlmEffectiveFieldSources;
  effective_source: PlanSheetImportLlmEffectiveSource;
  effective_region_pattern: {
    styleProfile: OcrStyleProfile;
    numberRegion: OcrRegionId;
    titleRegion: OcrRegionId;
  } | null;
};

type PlanSheetLlmPostResult = {
  ok: boolean;
  responsePayload: Record<string, unknown> | null;
  errorMessage: string | null;
  errorKind: PlanSheetImportLlmErrorKind | null;
  statusCode: number | null;
};

type PlanSheetLlmRequestAttemptContext = {
  endpoint: string;
  token: string;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  payload: Record<string, unknown>;
  pageNumber: number;
};

type PlanSheetLlmAttemptRunResult = {
  finalResponse: PlanSheetLlmPostResult;
  resolvedMetadata: PlanSheetLlmMetadataSnapshot | null;
  retryHistory: PlanSheetImportLlmRetryAttempt[];
  attemptCount: number;
  finalErrorKind: PlanSheetImportLlmErrorKind | null;
  requestStatus: string;
  errorMessage: string | null;
  requestedAt: string;
  completedAt: string;
};

type PlanSheetResolverPayloadCandidate = {
  role: "number" | "title";
  region_type: string;
  candidate_text: string;
  normalized_candidate_text: string;
  candidate_kind: string;
  candidate_score: number | null;
  matches_heuristic: boolean;
  origin_stage: string;
  source_kind: string | null;
  localized_support: boolean;
  support_tier: "high_signal_localized" | "low_signal_page_context";
};

type PlanSheetResolverPayloadRegion = {
  role: "number" | "title";
  region_type: string;
  source_kind: string | null;
  normalized_text: string | null;
  raw_text: string | null;
  origin_stage: string;
  localized_support: boolean;
  support_tier: "high_signal_localized" | "low_signal_page_context";
};

type PlanSheetResolverPayloadEvidence = {
  full_page_text: string | null;
  extracted_text: string | null;
  number_source_text: string | null;
  number_source_kind: string | null;
  title_source_text: string | null;
  title_source_kind: string | null;
  regions: PlanSheetResolverPayloadRegion[];
  candidates: PlanSheetResolverPayloadCandidate[];
  high_signal_localized: {
    localized_number_source: {
      kind: string | null;
      text: string | null;
    };
    localized_title_source: {
      kind: string | null;
      text: string | null;
    };
    top_number_candidates: PlanSheetResolverPayloadCandidate[];
    top_title_candidates: PlanSheetResolverPayloadCandidate[];
    region_snippets: PlanSheetResolverPayloadRegion[];
  };
  low_signal_page_context: {
    full_page_text_excerpt: string | null;
    region_snippets: PlanSheetResolverPayloadRegion[];
    dropped_title_noise: string[];
  };
};

function normalizeCompact(value: string | null | undefined) {
  return normalizeWhitespace(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function tokenizeTitle(value: string | null | undefined) {
  return canonicalizeTrainingSheetTitle(value)
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= 2);
}

function scoreSharedTitleTokens(left: string | null | undefined, right: string | null | undefined) {
  const leftTokens = tokenizeTitle(left);
  const rightTokens = tokenizeTitle(right);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const sharedCount = leftTokens.filter((token) => rightSet.has(token)).length;
  return sharedCount / Math.max(leftTokens.length, rightTokens.length);
}

function titleLooksGeneric(value: string | null | undefined) {
  const normalized = canonicalizeTrainingSheetTitle(value);
  if (!normalized) {
    return true;
  }

  if (
    /^(PLAN|FLOOR PLAN|ROOF PLAN|RCP|SCHEDULES?|DETAILS?|ELEVATIONS?|SECTIONS?|PROJECT DATA)$/i.test(
      normalized
    )
  ) {
    return true;
  }

  const tokens = tokenizeTitle(normalized);
  return tokens.length <= 2;
}

function titleLooksWeak(value: string | null | undefined) {
  const normalized = canonicalizeTrainingSheetTitle(value);
  if (!normalized) {
    return true;
  }

  if (titleLooksGeneric(normalized)) {
    return true;
  }

  if (/[^A-Z0-9\s,&\/().-]/.test(normalized)) {
    return true;
  }

  return /\b[A-Z]{1,2}\b/.test(normalized) && tokenizeTitle(normalized).length <= 3;
}

function titleRefinesHeuristic(args: {
  heuristicTitle: string | null;
  candidateTitle: string | null;
}) {
  const heuristicTitle = canonicalizeTrainingSheetTitle(args.heuristicTitle);
  const candidateTitle = canonicalizeTrainingSheetTitle(args.candidateTitle);

  if (!candidateTitle || candidateTitle === heuristicTitle) {
    return false;
  }

  if (!heuristicTitle) {
    return true;
  }

  const heuristicTokens = tokenizeTitle(heuristicTitle);
  const candidateTokens = tokenizeTitle(candidateTitle);
  const candidateSet = new Set(candidateTokens);
  const sharedCount = heuristicTokens.filter((token) => candidateSet.has(token)).length;

  if (titleLooksGeneric(heuristicTitle) && candidateTokens.length >= heuristicTokens.length) {
    return true;
  }

  return (
    candidateTokens.length > heuristicTokens.length &&
    sharedCount >= Math.max(2, heuristicTokens.length - 1)
  );
}

function sortArtifactCandidates(
  candidates: PlanSheetArtifactEvidence["candidates"],
  role: "number" | "title"
) {
  return candidates
    .filter((candidate) => candidate.role === role)
    .slice()
    .sort((left, right) => {
      const leftScore =
        typeof left.candidate_score === "number" ? left.candidate_score : Number.NEGATIVE_INFINITY;
      const rightScore =
        typeof right.candidate_score === "number"
          ? right.candidate_score
          : Number.NEGATIVE_INFINITY;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return left.normalized_candidate_text.localeCompare(right.normalized_candidate_text);
    });
}

function classifyCandidateOriginStage(candidateKind: string) {
  if (candidateKind.startsWith("ocr_title_")) {
    return "ocr_repair";
  }
  if (candidateKind === "ocr") {
    return "ocr_scan";
  }
  if (candidateKind === "pdf_pair") {
    return "pdf_pair";
  }
  if (candidateKind === "page_number_rank") {
    return "page_number_rank";
  }
  if (candidateKind === "pdf_text") {
    return "pdf_text";
  }
  if (candidateKind === "compact_stamp") {
    return "compact_stamp";
  }
  return "raw_box_context";
}

function classifyRegionOriginStage(args: { sourceKind: string | null; regionType: string }) {
  const sourceKind = normalizeWhitespace(args.sourceKind ?? "").toLowerCase();
  if (sourceKind === "ocr_title_repair") {
    return "ocr_repair";
  }
  if (sourceKind === "ocr") {
    return "ocr_scan";
  }
  if (sourceKind === "pdf_text") {
    return "pdf_text";
  }
  if (sourceKind === "compact_stamp") {
    return "compact_stamp";
  }
  if (normalizeWhitespace(args.regionType).toLowerCase().includes("strip")) {
    return "compact_stamp";
  }
  return sourceKind || "raw_box_context";
}

function looksLocalizedRegion(args: { sourceKind: string | null; regionType: string }) {
  const sourceKind = normalizeWhitespace(args.sourceKind ?? "").toLowerCase();
  const regionType = normalizeWhitespace(args.regionType).toLowerCase();
  if (["ocr", "ocr_title_repair", "compact_stamp"].includes(sourceKind)) {
    return true;
  }
  if (
    [
      "sheetstamp",
      "titleblock",
      "striptitle",
      "stripnumber",
      "stripfull",
      "numberblock",
      "footerbubble",
      "footerbubbletight",
      "footercolumn",
      "bottomright",
      "bottomband",
    ].includes(regionType)
  ) {
    return true;
  }
  return regionType.includes("strip") || regionType.includes("stamp") || regionType.includes("title");
}

function looksLocalizedCandidate(candidate: PlanSheetArtifactEvidence["candidates"][number]) {
  const originStage = classifyCandidateOriginStage(candidate.candidate_kind);
  if (
    [
      "ocr_repair",
      "ocr_scan",
      "pdf_pair",
      "page_number_rank",
      "compact_stamp",
    ].includes(originStage)
  ) {
    return true;
  }
  if (originStage === "pdf_text") {
    return looksLocalizedRegion({
      sourceKind: "pdf_text",
      regionType: candidate.region_type,
    });
  }
  return looksLocalizedRegion({
    sourceKind: candidate.candidate_kind,
    regionType: candidate.region_type,
  });
}

function isStableLockRegion(args: {
  regionType: string;
  role: "number" | "title";
}) {
  const regionType = normalizeWhitespace(args.regionType).toLowerCase();
  if (!regionType) {
    return false;
  }

  if (args.role === "number") {
    return ["stripnumber", "sheetstamp", "numberblock", "bottomright"].includes(regionType);
  }

  return ["striptitle", "sheetstamp", "titleblock", "bottomright"].includes(regionType);
}

function findLocalizedRegionCandidateMatch(args: {
  artifactEvidence: PlanSheetArtifactEvidence;
  role: "number" | "title";
  value: string | null | undefined;
}) {
  const canonicalValue =
    args.role === "number"
      ? canonicalizeTrainingSheetNumber(args.value)
      : canonicalizeTrainingSheetTitle(args.value);
  if (!canonicalValue) {
    return null;
  }

  const matchingCandidates = sortArtifactCandidates(args.artifactEvidence.candidates, args.role)
    .filter((candidate) => looksLocalizedCandidate(candidate))
    .filter((candidate) => isStableLockRegion({
      regionType: candidate.region_type,
      role: args.role,
    }))
    .filter((candidate) => {
      const normalizedCandidate =
        args.role === "number"
          ? canonicalizeTrainingSheetNumber(
              candidate.normalized_candidate_text || candidate.candidate_text
            )
          : canonicalizeTrainingSheetTitle(
              candidate.normalized_candidate_text || candidate.candidate_text
            );
      return normalizedCandidate === canonicalValue;
    });

  if (matchingCandidates.length > 0) {
    return matchingCandidates[0];
  }

  const matchingRegions = args.artifactEvidence.regions
    .filter((region) => region.role === args.role)
    .filter((region) =>
      looksLocalizedRegion({
        sourceKind: region.source_kind,
        regionType: region.region_type,
      })
    )
    .filter((region) =>
      isStableLockRegion({
        regionType: region.region_type,
        role: args.role,
      })
    )
    .map((region) => ({
      region_type: region.region_type,
      candidate_score: Number.NEGATIVE_INFINITY,
      candidate_kind: region.source_kind ?? "region_text",
      normalized_candidate_text: region.normalized_text ?? region.raw_text ?? "",
    }))
    .filter((region) => {
      const normalizedRegionText =
        args.role === "number"
          ? canonicalizeTrainingSheetNumber(region.normalized_candidate_text)
          : canonicalizeTrainingSheetTitle(region.normalized_candidate_text);
      return normalizedRegionText === canonicalValue;
    })
    .sort((left, right) => right.candidate_score - left.candidate_score);

  return matchingRegions[0] ?? null;
}

export function inferPlanSheetEffectiveRegionPattern(args: {
  artifactEvidence: PlanSheetArtifactEvidence;
  effectiveMetadata: PlanSheetLlmMetadataSnapshot;
}) {
  const numberMatch = findLocalizedRegionCandidateMatch({
    artifactEvidence: args.artifactEvidence,
    role: "number",
    value: args.effectiveMetadata.sheet_number,
  });
  const titleMatch = findLocalizedRegionCandidateMatch({
    artifactEvidence: args.artifactEvidence,
    role: "title",
    value: args.effectiveMetadata.sheet_title,
  });

  if (!numberMatch?.region_type || !titleMatch?.region_type) {
    return null;
  }

  const numberStyle = getStyleProfileForRegion(numberMatch.region_type);
  const titleStyle = getStyleProfileForRegion(titleMatch.region_type);
  const styleProfile =
    numberStyle && numberStyle === titleStyle ? numberStyle : null;

  if (!styleProfile) {
    return null;
  }

  return {
    styleProfile: styleProfile as OcrStyleProfile,
    numberRegion: numberMatch.region_type as OcrRegionId,
    titleRegion: titleMatch.region_type as OcrRegionId,
  };
}

function pageLooksCoverOrIndex(args: {
  heuristic: PlanSheetLlmMetadataSnapshot;
  artifactEvidence: PlanSheetArtifactEvidence;
}) {
  const heuristicTitle = canonicalizeTrainingSheetTitle(args.heuristic.sheet_title);
  const heuristicNumber = canonicalizeTrainingSheetNumber(args.heuristic.sheet_number);
  if (
    /^(G[-.]?0|G[-.]?0\.0|G[-.]?0\.00)/.test(heuristicNumber) ||
    /\b(COVER|DRAWING INDEX|PROJECT DATA|ABBREVIATIONS)\b/.test(heuristicTitle)
  ) {
    return true;
  }

  const titleEvidence = [
    args.artifactEvidence.evidence.title_source_text,
    ...args.artifactEvidence.regions.map((region) => region.normalized_text),
    ...args.artifactEvidence.candidates.map((candidate) => candidate.normalized_candidate_text),
  ]
    .map((value) => canonicalizeTrainingSheetTitle(value))
    .filter(Boolean)
    .join(" ");

  return /\b(COVER|DRAWING INDEX|PROJECT DATA|ABBREVIATIONS)\b/.test(titleEvidence);
}

function detectTitleNoiseReason(args: {
  text: string | null | undefined;
  allowCoverIndex: boolean;
}) {
  const text = normalizeWhitespace(args.text ?? "");
  if (!text) {
    return null;
  }

  if (
    /(COPYRIGHT|REVIT FILES|HKIT ARCHITECTS|DRAWN|CHECKED|JOB NO\.|DATE DESCRIPTION|ISSUE)/i.test(
      text
    )
  ) {
    return "footer_metadata";
  }

  if (
    /(CONSTRUCT CONCRETE SIDEWALK|ADA REQUIREMENTS|ACCESSIBLE PARKING SPACES|PER CBC|COMPLIANCE WITH ADA)/i.test(
      text
    )
  ) {
    return "construction_note";
  }

  if (
    !args.allowCoverIndex &&
    /(PROJECT DIRECTORY|SUMMARY OF WORK|DRAWING INDEX|ACCEPTANCE TEST|DIVISION OF THE STATE ARCHITECT|STATEMENT OF GENERAL CONFORMANCE|DEFERRED APPROVAL ITEMS|VICINITY MAP)/i.test(
      text
    )
  ) {
    return "cover_index_body";
  }

  return null;
}

function buildPageContextExcerpt(args: {
  fullPageText: string | null;
  allowCoverIndex: boolean;
}) {
  const text = normalizeWhitespace(args.fullPageText ?? "");
  if (!text) {
    return null;
  }

  if (!args.allowCoverIndex) {
    return null;
  }

  return text.slice(0, 1800) || null;
}

function rankPayloadCandidate(args: {
  candidate: PlanSheetResolverPayloadCandidate;
  role: "number" | "title";
  allowCoverIndex: boolean;
}) {
  const localized = args.candidate.localized_support;
  const originStage = classifyCandidateOriginStage(args.candidate.candidate_kind);
  const score =
    typeof args.candidate.candidate_score === "number" ? args.candidate.candidate_score : 0;
  const noiseReason =
    args.role === "title"
      ? detectTitleNoiseReason({
          text:
            args.candidate.normalized_candidate_text || args.candidate.candidate_text,
          allowCoverIndex: args.allowCoverIndex,
        })
      : null;

  let rank = score;
  if (localized) {
    rank += 1000;
  }
  if (originStage === "ocr_repair") {
    rank += 200;
  }
  if (originStage === "pdf_pair") {
    rank += 160;
  }
  if (originStage === "compact_stamp") {
    rank += 140;
  }
  if (originStage === "ocr_scan") {
    rank += 120;
  }
  if (originStage === "page_number_rank") {
    rank += 110;
  }
  if (originStage === "pdf_text") {
    rank -= 25;
  }
  if (args.candidate.matches_heuristic) {
    rank += 5;
  }
  if (noiseReason) {
    rank -= localized ? 80 : 1000;
  }
  return rank;
}

export function buildPlanSheetResolverEvidencePayload(args: {
  artifactEvidence: PlanSheetArtifactEvidence;
  heuristicSnapshot: PlanSheetLlmMetadataSnapshot;
}): PlanSheetResolverPayloadEvidence {
  const allowCoverIndex = pageLooksCoverOrIndex({
    heuristic: args.heuristicSnapshot,
    artifactEvidence: args.artifactEvidence,
  });
  const droppedTitleNoise = new Set<string>();

  const candidatePayloads = args.artifactEvidence.candidates
    .map((candidate) => {
      const originStage = classifyCandidateOriginStage(candidate.candidate_kind);
      const localizedSupport = looksLocalizedCandidate(candidate);
      const supportTier = localizedSupport ? "high_signal_localized" : "low_signal_page_context";
      const noiseReason =
        candidate.role === "title"
          ? detectTitleNoiseReason({
              text: candidate.normalized_candidate_text || candidate.candidate_text,
              allowCoverIndex,
            })
          : null;

      if (noiseReason && !localizedSupport) {
        droppedTitleNoise.add(
          normalizeWhitespace(candidate.normalized_candidate_text || candidate.candidate_text)
        );
        return null;
      }

      return {
        role: candidate.role,
        region_type: candidate.region_type,
        candidate_text: candidate.candidate_text,
        normalized_candidate_text: candidate.normalized_candidate_text,
        candidate_kind: candidate.candidate_kind,
        candidate_score: candidate.candidate_score,
        matches_heuristic: candidate.is_model_winner,
        origin_stage: originStage,
        source_kind: candidate.candidate_kind,
        localized_support: localizedSupport,
        support_tier: supportTier,
      } satisfies PlanSheetResolverPayloadCandidate;
    })
    .filter(Boolean) as PlanSheetResolverPayloadCandidate[];

  const regionPayloads = args.artifactEvidence.regions
    .map((region) => {
      const localizedSupport = looksLocalizedRegion({
        sourceKind: region.source_kind,
        regionType: region.region_type,
      });
      const supportTier = localizedSupport ? "high_signal_localized" : "low_signal_page_context";
      const noiseReason =
        region.role === "title"
          ? detectTitleNoiseReason({
              text: region.normalized_text || region.raw_text,
              allowCoverIndex,
            })
          : null;

      if (noiseReason && !localizedSupport) {
        droppedTitleNoise.add(normalizeWhitespace(region.normalized_text || region.raw_text || ""));
        return null;
      }

      return {
        role: region.role,
        region_type: region.region_type,
        source_kind: region.source_kind,
        normalized_text: region.normalized_text,
        raw_text: region.raw_text,
        origin_stage: classifyRegionOriginStage({
          sourceKind: region.source_kind,
          regionType: region.region_type,
        }),
        localized_support: localizedSupport,
        support_tier: supportTier,
      } satisfies PlanSheetResolverPayloadRegion;
    })
    .filter(Boolean) as PlanSheetResolverPayloadRegion[];

  const takeTopCandidates = (role: "number" | "title") =>
    candidatePayloads
      .filter(
        (candidate) =>
          candidate.role === role && candidate.support_tier === "high_signal_localized"
      )
      .sort((left, right) => {
        const leftRank = rankPayloadCandidate({
          candidate: left,
          role,
          allowCoverIndex,
        });
        const rightRank = rankPayloadCandidate({
          candidate: right,
          role,
          allowCoverIndex,
        });
        if (leftRank !== rightRank) {
          return rightRank - leftRank;
        }
        return left.normalized_candidate_text.localeCompare(right.normalized_candidate_text);
      })
      .slice(0, 10);

  return {
    full_page_text: buildPageContextExcerpt({
      fullPageText: args.artifactEvidence.evidence.extracted_text,
      allowCoverIndex,
    }),
    extracted_text: buildPageContextExcerpt({
      fullPageText: args.artifactEvidence.evidence.extracted_text,
      allowCoverIndex,
    }),
    number_source_text: args.artifactEvidence.evidence.number_source_text,
    number_source_kind: args.artifactEvidence.evidence.number_source_kind,
    title_source_text: args.artifactEvidence.evidence.title_source_text,
    title_source_kind: args.artifactEvidence.evidence.title_source_kind,
    regions: regionPayloads,
    candidates: candidatePayloads,
    high_signal_localized: {
      localized_number_source: {
        kind: args.artifactEvidence.evidence.number_source_kind,
        text: args.artifactEvidence.evidence.number_source_text,
      },
      localized_title_source: {
        kind: args.artifactEvidence.evidence.title_source_kind,
        text: args.artifactEvidence.evidence.title_source_text,
      },
      top_number_candidates: takeTopCandidates("number"),
      top_title_candidates: takeTopCandidates("title"),
      region_snippets: regionPayloads
        .filter((region) => region.support_tier === "high_signal_localized")
        .slice(0, 14),
    },
    low_signal_page_context: {
      full_page_text_excerpt: buildPageContextExcerpt({
        fullPageText: args.artifactEvidence.evidence.extracted_text,
        allowCoverIndex,
      }),
      region_snippets: regionPayloads
        .filter((region) => region.support_tier === "low_signal_page_context")
        .slice(0, 6),
      dropped_title_noise: [...droppedTitleNoise].filter(Boolean).slice(0, 12),
    },
  };
}

function hasLocalizedResolverEvidence(
  evidence: PlanSheetResolverPayloadEvidence,
  role: "number" | "title"
) {
  const localizedSource =
    role === "number"
      ? evidence.high_signal_localized.localized_number_source.text
      : evidence.high_signal_localized.localized_title_source.text;
  const localizedCandidates =
    role === "number"
      ? evidence.high_signal_localized.top_number_candidates
      : evidence.high_signal_localized.top_title_candidates;
  const localizedRegions = evidence.high_signal_localized.region_snippets.filter(
    (region) => region.role === role && normalizeWhitespace(region.normalized_text || region.raw_text)
  );

  return Boolean(
    normalizeWhitespace(localizedSource) ||
      localizedCandidates.length > 0 ||
      localizedRegions.length > 0
  );
}

function hasUsefulAlternativeTitleCandidate(args: {
  evidence: PlanSheetResolverPayloadEvidence;
  heuristicTitle: string | null;
}) {
  const heuristicTitle = canonicalizeTrainingSheetTitle(args.heuristicTitle);
  return args.evidence.high_signal_localized.top_title_candidates.some((candidate) => {
    const title = canonicalizeTrainingSheetTitle(
      candidate.normalized_candidate_text || candidate.candidate_text
    );
    if (!title || title === heuristicTitle) {
      return false;
    }
    if (detectTitleNoiseReason({ text: title, allowCoverIndex: false })) {
      return false;
    }
    return (
      titleRefinesHeuristic({
        heuristicTitle,
        candidateTitle: title,
      }) ||
      scoreSharedTitleTokens(heuristicTitle, title) >= 0.45 ||
      title.length > heuristicTitle.length + 4
    );
  });
}

function readHeuristicConfidenceCalibration(
  artifactEvidence: PlanSheetArtifactEvidence
) {
  const heuristicOutput = artifactEvidence.heuristicOutput;
  if (!heuristicOutput || typeof heuristicOutput !== "object") {
    return null;
  }

  const finalSelection = (heuristicOutput as Record<string, unknown>).finalSelection;
  if (!finalSelection || typeof finalSelection !== "object") {
    return null;
  }

  const record = finalSelection as Record<string, unknown>;
  const tier =
    typeof record.confidenceTier === "string" ? normalizeWhitespace(record.confidenceTier) : null;
  return {
    confidenceTier: tier || null,
    llmRecommended: record.llmRecommended === true,
    repairableEvidence: record.repairableEvidence === true,
    reasons: Array.isArray(record.confidenceReasons)
      ? record.confidenceReasons
          .map((reason) => normalizeWhitespace(reason))
          .filter(Boolean)
      : [],
  };
}

function getPlanSheetLlmAssistEligibility(args: {
  heuristicSnapshot: PlanSheetLlmMetadataSnapshot;
  resolverEvidence: PlanSheetResolverPayloadEvidence;
  artifactEvidence: PlanSheetArtifactEvidence;
}) {
  const confidence = normalizeConfidence(args.heuristicSnapshot.confidence) ?? 0;
  const hasHeuristicNumber = Boolean(
    canonicalizeTrainingSheetNumber(args.heuristicSnapshot.sheet_number)
  );
  const hasHeuristicTitle = Boolean(
    canonicalizeTrainingSheetTitle(args.heuristicSnapshot.sheet_title)
  );
  const localizedNumber = hasLocalizedResolverEvidence(args.resolverEvidence, "number");
  const localizedTitle = hasLocalizedResolverEvidence(args.resolverEvidence, "title");
  const titleNoise = detectTitleNoiseReason({
    text: args.heuristicSnapshot.sheet_title,
    allowCoverIndex: /\b(COVER|DRAWING INDEX|PROJECT DATA|ABBREVIATIONS)\b/i.test(
      canonicalizeTrainingSheetTitle(args.heuristicSnapshot.sheet_title)
    ),
  });
  const weakOrRepairableTitle =
    titleLooksWeak(args.heuristicSnapshot.sheet_title) ||
    /\s+-\s*$/.test(normalizeWhitespace(args.heuristicSnapshot.sheet_title ?? "")) ||
    hasUsefulAlternativeTitleCandidate({
      evidence: args.resolverEvidence,
      heuristicTitle: args.heuristicSnapshot.sheet_title,
    });
  const hasRepairableEvidence = Boolean(
    hasHeuristicNumber &&
      hasHeuristicTitle &&
      localizedNumber &&
      localizedTitle &&
      !titleNoise
  );
  const calibration = readHeuristicConfidenceCalibration(args.artifactEvidence);

  if (!hasHeuristicNumber || !hasHeuristicTitle) {
    return {
      shouldRequest: false,
      reason: "missing_heuristic_identity",
    };
  }

  if (calibration?.confidenceTier === "trusted") {
    return {
      shouldRequest: false,
      reason: "trusted_calibrated_identity",
    };
  }

  if (calibration?.confidenceTier === "insufficient_evidence") {
    return {
      shouldRequest: false,
      reason: "calibrated_insufficient_evidence",
    };
  }

  if (calibration?.confidenceTier === "needs_review") {
    return {
      shouldRequest: false,
      reason: "calibrated_needs_review",
    };
  }

  if (!hasRepairableEvidence) {
    return {
      shouldRequest: false,
      reason: titleNoise ? `unrepairable_title_noise:${titleNoise}` : "insufficient_localized_evidence",
    };
  }

  if (confidence < 0.35) {
    return {
      shouldRequest: false,
      reason: "confidence_too_low_for_repair",
    };
  }

  if (calibration?.llmRecommended === true) {
    return {
      shouldRequest: true,
      reason: "calibrated_repair_recommended",
    };
  }

  if (confidence >= 0.86 && !weakOrRepairableTitle) {
    return {
      shouldRequest: false,
      reason: "trusted_high_confidence",
    };
  }

  if (confidence < 0.86 || weakOrRepairableTitle) {
    return {
      shouldRequest: true,
      reason: confidence < 0.86 ? "middle_confidence_repair_band" : "high_confidence_title_repair",
    };
  }

  return {
    shouldRequest: false,
    reason: "not_in_repair_band",
  };
}

function collectLocalizedEvidenceStrings(
  artifactEvidence: PlanSheetArtifactEvidence,
  role?: "number" | "title"
) {
  const values = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = normalizeWhitespace(value ?? "");
    if (normalized) {
      values.add(normalized);
    }
  };

  if (!role || role === "number") {
    push(artifactEvidence.evidence.number_source_text);
  }

  if (!role || role === "title") {
    push(artifactEvidence.evidence.title_source_text);
  }

  for (const region of artifactEvidence.regions) {
    if (!role || region.role === role) {
      push(region.normalized_text);
      push(region.raw_text);
    }
  }

  for (const candidate of artifactEvidence.candidates) {
    if (!role || candidate.role === role) {
      push(candidate.normalized_candidate_text);
      push(candidate.candidate_text);
    }
  }

  return [...values];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRetryReason(errorKind: PlanSheetImportLlmErrorKind | null, statusCode: number | null) {
  if (errorKind === "timeout") {
    return "timeout";
  }
  if (errorKind === "network") {
    return "network failure";
  }
  if (errorKind === "rate_limit") {
    return statusCode ? `HTTP ${statusCode}` : "rate limit";
  }
  if (errorKind === "server_error") {
    return statusCode ? `HTTP ${statusCode}` : "server error";
  }
  return null;
}

function buildRetryDelayMs(baseDelayMs: number, attempt: number) {
  const jitterMultiplier = 1 + Math.min(0.25, attempt * 0.05);
  return Math.round(baseDelayMs * Math.pow(2, Math.max(0, attempt - 1)) * jitterMultiplier);
}

export function classifyPlanSheetLlmThrownError(error: unknown): {
  errorKind: PlanSheetImportLlmErrorKind;
  errorMessage: string;
} {
  const errorMessage =
    error instanceof Error ? error.message : normalizeWhitespace(String(error ?? "")) || "Unknown LLM request error";
  const normalizedMessage = errorMessage.toLowerCase();
  const errorName = error instanceof Error ? error.name.toLowerCase() : "";

  if (
    errorName === "aborterror" ||
    normalizedMessage.includes("aborted") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("timeout")
  ) {
    return {
      errorKind: "timeout",
      errorMessage,
    };
  }

  if (
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("econn") ||
    normalizedMessage.includes("enotfound") ||
    normalizedMessage.includes("socket") ||
    normalizedMessage.includes("connect")
  ) {
    return {
      errorKind: "network",
      errorMessage,
    };
  }

  return {
    errorKind: "unknown",
    errorMessage,
  };
}

export function shouldRetryPlanSheetLlmFailure(args: {
  errorKind: PlanSheetImportLlmErrorKind | null;
  statusCode?: number | null;
  requestStatus: string;
}) {
  if (args.requestStatus === "invalid_response") {
    return false;
  }

  return (
    args.errorKind === "timeout" ||
    args.errorKind === "network" ||
    args.errorKind === "rate_limit" ||
    args.errorKind === "server_error"
  );
}

function pickSupportedNumberCandidate(args: {
  llmNumber: string | null;
  heuristicNumber: string | null;
  artifactEvidence: PlanSheetArtifactEvidence;
}) {
  const canonicalLlmNumber = canonicalizeTrainingSheetNumber(args.llmNumber);
  if (!canonicalLlmNumber) {
    return null;
  }

  const compactLlmNumber = normalizeCompact(canonicalLlmNumber);
  const numberCandidates = sortArtifactCandidates(args.artifactEvidence.candidates, "number");

  for (const candidate of numberCandidates) {
    const candidateText =
      canonicalizeTrainingSheetNumber(candidate.normalized_candidate_text) ||
      canonicalizeTrainingSheetNumber(candidate.candidate_text);
    if (!candidateText) {
      continue;
    }

    if (candidateText === canonicalLlmNumber) {
      return candidateText;
    }

    if (normalizeCompact(candidateText) === compactLlmNumber) {
      return candidateText;
    }
  }

  const localizedNumberStrings = collectLocalizedEvidenceStrings(args.artifactEvidence, "number");
  const heuristicCompact = normalizeCompact(args.heuristicNumber);

  for (const evidenceText of localizedNumberStrings) {
    const compactEvidenceText = normalizeCompact(evidenceText);
    if (
      compactEvidenceText === compactLlmNumber ||
      compactEvidenceText.includes(compactLlmNumber)
    ) {
      if (
        heuristicCompact &&
        heuristicCompact === compactLlmNumber &&
        canonicalizeTrainingSheetNumber(args.heuristicNumber)
      ) {
        return canonicalizeTrainingSheetNumber(args.heuristicNumber);
      }

      return canonicalLlmNumber;
    }
  }

  return null;
}

function pickSupportedTitleCandidate(args: {
  llmTitle: string | null;
  heuristicTitle: string | null;
  artifactEvidence: PlanSheetArtifactEvidence;
}) {
  const canonicalLlmTitle = canonicalizeTrainingSheetTitle(args.llmTitle);
  if (!canonicalLlmTitle) {
    return null;
  }

  const localizedTitleStrings = collectLocalizedEvidenceStrings(args.artifactEvidence, "title");
  const titleCandidates = sortArtifactCandidates(args.artifactEvidence.candidates, "title");

  for (const candidate of titleCandidates) {
    const candidateText =
      canonicalizeTrainingSheetTitle(candidate.normalized_candidate_text) ||
      canonicalizeTrainingSheetTitle(candidate.candidate_text);
    if (!candidateText) {
      continue;
    }

    if (candidateText === canonicalLlmTitle) {
      return candidateText;
    }
  }

  const refinementCandidates = titleCandidates
    .map((candidate) =>
      canonicalizeTrainingSheetTitle(candidate.normalized_candidate_text) ||
      canonicalizeTrainingSheetTitle(candidate.candidate_text)
    )
    .filter((candidateText) =>
      titleRefinesHeuristic({
        heuristicTitle: canonicalLlmTitle,
        candidateTitle: candidateText,
      })
    )
    .sort((left, right) => right.length - left.length);

  if (refinementCandidates.length > 0) {
    return refinementCandidates[0];
  }

  for (const evidenceText of localizedTitleStrings) {
    const canonicalEvidenceText = canonicalizeTrainingSheetTitle(evidenceText);
    if (!canonicalEvidenceText) {
      continue;
    }

    if (
      canonicalEvidenceText === canonicalLlmTitle ||
      canonicalEvidenceText.includes(canonicalLlmTitle) ||
      canonicalLlmTitle.includes(canonicalEvidenceText)
    ) {
      return canonicalLlmTitle;
    }

    if (scoreSharedTitleTokens(canonicalEvidenceText, canonicalLlmTitle) >= 0.6) {
      return canonicalLlmTitle;
    }
  }

  if (
    titleLooksWeak(args.heuristicTitle) &&
    scoreSharedTitleTokens(args.heuristicTitle, canonicalLlmTitle) >= 0.35
  ) {
    return canonicalLlmTitle;
  }

  return null;
}

function inferDisciplineFromSheetNumber(value: string | null | undefined) {
  const normalized = canonicalizeTrainingSheetNumber(value);
  const match = normalized.match(/^([A-Z]+)/);
  const prefix = match?.[1] ?? "";

  switch (prefix) {
    case "G":
      return "General";
    case "A":
      return "Architectural";
    case "S":
      return "Structural";
    case "C":
      return "Civil";
    case "P":
      return "Plumbing";
    case "M":
      return "Mechanical";
    case "E":
      return "Electrical";
    case "F":
      return "Fire Protection";
    case "L":
      return "Landscape";
    case "I":
      return "Interiors";
    case "T":
      return "Telecommunications";
    default:
      return null;
  }
}

export function resolveEffectivePlanSheetMetadata(args: {
  heuristic: PlanSheetLlmMetadataSnapshot;
  resolved: PlanSheetLlmMetadataSnapshot | null;
  artifactEvidence: PlanSheetArtifactEvidence;
}): Omit<PlanSheetImportResolverResult, "assist" | "effective_region_pattern"> {
  const heuristic = args.heuristic;
  const resolved = args.resolved;

  if (!resolved) {
    const heuristicBlueprintMetadata = normalizeTrainingBlueprintMetadata({
      sheet_number: heuristic.sheet_number,
      sheet_title: heuristic.sheet_title,
      discipline: heuristic.discipline,
      sheet_type: heuristic.sheet_type,
      scope_tags: heuristic.scope_tags,
      area_tags: heuristic.area_tags,
      sheet_kind: heuristic.sheet_kind,
    });
    const derivedHeuristicSheetKind =
      inferTrainingSheetKind({
        sheetNumber: heuristic.sheet_number,
        sheetTitle: heuristic.sheet_title,
        discipline: heuristic.discipline,
      }) || null;
    return {
      effective_metadata: {
        sheet_number: heuristic.sheet_number,
        sheet_title: heuristic.sheet_title,
        discipline: heuristic.discipline,
        sheet_type: heuristicBlueprintMetadata.sheet_type,
        scope_tags: heuristicBlueprintMetadata.scope_tags,
        area_tags: heuristicBlueprintMetadata.area_tags,
        sheet_kind: derivedHeuristicSheetKind || heuristic.sheet_kind || null,
        confidence: heuristic.confidence,
      },
      effective_field_sources: {
        sheet_number: "heuristic",
        sheet_title: "heuristic",
        discipline: "heuristic",
        sheet_type: heuristic.sheet_type ? "heuristic" : "derived",
        scope_tags: heuristic.scope_tags?.length ? "heuristic" : "derived",
        area_tags: heuristic.area_tags?.length ? "heuristic" : "derived",
        sheet_kind: derivedHeuristicSheetKind ? "derived" : "heuristic",
      },
      effective_source: "heuristic",
    };
  }

  const supportedNumber =
    pickSupportedNumberCandidate({
      llmNumber: resolved.sheet_number,
      heuristicNumber: heuristic.sheet_number,
      artifactEvidence: args.artifactEvidence,
    }) ?? (canonicalizeTrainingSheetNumber(heuristic.sheet_number) || null);
  const heuristicNumber = canonicalizeTrainingSheetNumber(heuristic.sheet_number);
  const resolvedNumber = canonicalizeTrainingSheetNumber(resolved.sheet_number);
  const canonicalSupportedNumber = canonicalizeTrainingSheetNumber(supportedNumber);
  const usedLlmNumber =
    Boolean(resolvedNumber) &&
    canonicalSupportedNumber !== heuristicNumber &&
    (canonicalSupportedNumber === resolvedNumber ||
      normalizeCompact(canonicalSupportedNumber) === normalizeCompact(resolvedNumber));

  const supportedTitle =
    pickSupportedTitleCandidate({
      llmTitle: resolved.sheet_title,
      heuristicTitle: heuristic.sheet_title,
      artifactEvidence: args.artifactEvidence,
    }) ?? (canonicalizeTrainingSheetTitle(heuristic.sheet_title) || null);
  const heuristicTitle = canonicalizeTrainingSheetTitle(heuristic.sheet_title);
  const resolvedTitle = canonicalizeTrainingSheetTitle(resolved.sheet_title);
  const canonicalSupportedTitle = canonicalizeTrainingSheetTitle(supportedTitle);
  const usedLlmTitle =
    Boolean(resolvedTitle) &&
    canonicalSupportedTitle !== heuristicTitle &&
    (canonicalSupportedTitle === resolvedTitle ||
      titleRefinesHeuristic({
        heuristicTitle: resolvedTitle,
        candidateTitle: canonicalSupportedTitle,
      }) ||
      scoreSharedTitleTokens(canonicalSupportedTitle, resolvedTitle) >= 0.6);

  const heuristicDiscipline = normalizeTrainingDiscipline(heuristic.discipline);
  const llmDiscipline = normalizeTrainingDiscipline(resolved.discipline);
  const inferredDisciplineFromNumber = inferDisciplineFromSheetNumber(supportedNumber);
  const supportedDiscipline =
    !heuristicDiscipline && llmDiscipline
      ? llmDiscipline
      : llmDiscipline &&
          inferredDisciplineFromNumber &&
          llmDiscipline === inferredDisciplineFromNumber &&
          heuristicDiscipline !== inferredDisciplineFromNumber
        ? llmDiscipline
        : heuristicDiscipline || llmDiscipline || inferredDisciplineFromNumber || null;
  const usedLlmDiscipline =
    Boolean(llmDiscipline) && llmDiscipline === supportedDiscipline && llmDiscipline !== heuristicDiscipline;

  const derivedSupportedSheetKind =
    inferTrainingSheetKind({
      sheetNumber: supportedNumber,
      sheetTitle: supportedTitle,
      discipline: supportedDiscipline,
    }) || null;
  const heuristicDerivedSheetKind =
    inferTrainingSheetKind({
      sheetNumber: heuristic.sheet_number,
      sheetTitle: heuristic.sheet_title,
      discipline: heuristic.discipline,
    }) || heuristic.sheet_kind || null;
  const supportedSheetKind =
    derivedSupportedSheetKind || heuristicDerivedSheetKind || heuristic.sheet_kind || null;
  const usedAnyLlmIdentityField =
    usedLlmNumber || usedLlmTitle || usedLlmDiscipline;
  const supportedBlueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: supportedNumber,
    sheet_title: supportedTitle,
    discipline: supportedDiscipline,
    sheet_type:
      usedAnyLlmIdentityField && resolved.sheet_type
        ? resolved.sheet_type
        : heuristic.sheet_type || null,
    scope_tags: usedAnyLlmIdentityField && resolved.scope_tags?.length
      ? resolved.scope_tags
      : heuristic.scope_tags ?? [],
    area_tags:
      usedAnyLlmIdentityField && resolved.area_tags?.length
        ? resolved.area_tags
        : heuristic.area_tags ?? [],
    sheet_kind: supportedSheetKind,
  });

  const fieldSources = {
    sheet_number: usedLlmNumber ? "llm" : "heuristic",
    sheet_title: usedLlmTitle ? "llm" : "heuristic",
    discipline: usedLlmDiscipline ? "llm" : "heuristic",
    sheet_type:
      usedAnyLlmIdentityField && resolved.sheet_type
        ? "llm"
        : heuristic.sheet_type
          ? "heuristic"
          : "derived",
    scope_tags: usedAnyLlmIdentityField && resolved.scope_tags?.length
      ? "llm"
      : heuristic.scope_tags?.length
        ? "heuristic"
        : "derived",
    area_tags: usedAnyLlmIdentityField && resolved.area_tags?.length
      ? "llm"
      : heuristic.area_tags?.length
        ? "heuristic"
        : "derived",
    sheet_kind: derivedSupportedSheetKind ? "derived" : "heuristic",
  } satisfies PlanSheetImportLlmEffectiveFieldSources;

  const llmFieldCount = Object.values(fieldSources).filter((value) => value === "llm").length;
  const effectiveConfidence =
    llmFieldCount > 0 ? resolved.confidence ?? heuristic.confidence : heuristic.confidence;

  return {
    effective_metadata: {
      sheet_number: supportedNumber || null,
      sheet_title: supportedTitle || null,
      discipline: supportedDiscipline,
      sheet_type: supportedBlueprintMetadata.sheet_type,
      scope_tags: supportedBlueprintMetadata.scope_tags,
      area_tags: supportedBlueprintMetadata.area_tags,
      sheet_kind: supportedSheetKind,
      confidence: effectiveConfidence,
    },
    effective_field_sources: fieldSources,
    effective_source:
      llmFieldCount === 0 ? "heuristic" : llmFieldCount === 7 ? "llm" : "hybrid",
  };
}

function buildHeuristicSnapshot(modelSheet: TrainingModelSheet): PlanSheetLlmMetadataSnapshot {
  const discipline = normalizeTrainingDiscipline(modelSheet.discipline);
  const blueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: modelSheet.sheet_number,
    sheet_title: modelSheet.sheet_title,
    discipline,
    sheet_type: modelSheet.sheet_type ?? null,
    scope_tags: modelSheet.scope_tags ?? [],
    area_tags: modelSheet.area_tags ?? [],
    sheet_kind: modelSheet.sheet_kind ?? null,
  });
  const sheetKind = inferTrainingSheetKind({
    sheetNumber: modelSheet.sheet_number,
    sheetTitle: modelSheet.sheet_title,
    discipline,
  });

  return {
    sheet_number: normalizeWhitespace(modelSheet.sheet_number).toUpperCase() || null,
    sheet_title: normalizeWhitespace(modelSheet.sheet_title).toUpperCase() || null,
    discipline,
    sheet_type: blueprintMetadata.sheet_type,
    scope_tags: blueprintMetadata.scope_tags,
    area_tags: blueprintMetadata.area_tags,
    sheet_kind: sheetKind || null,
    confidence: normalizeConfidence(modelSheet.extraction_confidence),
  };
}

function readResponseMetadataSource(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (record.resolution && typeof record.resolution === "object") {
    return record.resolution as Record<string, unknown>;
  }

  if (record.result && typeof record.result === "object") {
    return record.result as Record<string, unknown>;
  }

  if (record.use_llm_result && typeof record.use_llm_result === "object") {
    return record.use_llm_result as Record<string, unknown>;
  }

  if (
    "sheet_number" in record ||
    "sheet_title" in record ||
    "discipline" in record ||
    "sheet_type" in record ||
    "sheetType" in record ||
    "scope_tags" in record ||
    "scopeTags" in record ||
    "area_tags" in record ||
    "areaTags" in record ||
    "sheet_kind" in record ||
    "sheetNumber" in record ||
    "sheetTitle" in record ||
    "sheetKind" in record
  ) {
    return record;
  }

  return null;
}

export function normalizePlanSheetLlmResponse(
  value: unknown
): PlanSheetLlmMetadataSnapshot | null {
  const source = readResponseMetadataSource(value);
  if (!source) {
    return null;
  }

  const sheetNumber = normalizeWhitespace(
    String(source.sheet_number ?? source.sheetNumber ?? "")
  ).toUpperCase();
  const sheetTitle = normalizeWhitespace(
    String(source.sheet_title ?? source.sheetTitle ?? "")
  ).toUpperCase();
  const discipline = normalizeTrainingDiscipline(
    String(source.discipline ?? "")
  );
  const requestedSheetKind = normalizeWhitespace(
    String(source.sheet_kind ?? source.sheetKind ?? "")
  );
  const requestedSheetType = normalizeWhitespace(
    String(source.sheet_type ?? source.sheetType ?? "")
  );
  const requestedScopeTags = parseResponseTagList(
    source.scope_tags ?? source.scopeTags ?? null
  );
  const requestedAreaTags = parseResponseTagList(
    source.area_tags ?? source.areaTags ?? null
  );
  const confidence = normalizeConfidence(source.confidence);
  const blueprintMetadata = normalizeTrainingBlueprintMetadata({
    sheet_number: sheetNumber,
    sheet_title: sheetTitle,
    discipline,
    sheet_type: requestedSheetType || null,
    scope_tags: requestedScopeTags,
    area_tags: requestedAreaTags,
    sheet_kind: requestedSheetKind || null,
  });

  if (
    !sheetNumber &&
    !sheetTitle &&
    !discipline &&
    !requestedSheetKind &&
    !requestedSheetType &&
    requestedScopeTags.length === 0 &&
    requestedAreaTags.length === 0 &&
    confidence === null
  ) {
    return null;
  }

  return {
    sheet_number: sheetNumber || null,
    sheet_title: sheetTitle || null,
    discipline,
    sheet_type: blueprintMetadata.sheet_type,
    scope_tags: blueprintMetadata.scope_tags,
    area_tags: blueprintMetadata.area_tags,
    sheet_kind:
      requestedSheetKind ||
      inferTrainingSheetKind({
        sheetNumber,
        sheetTitle,
        discipline,
      }) ||
      null,
    confidence,
  };
}

async function postPlanSheetLlmPayload(args: {
  endpoint: string;
  token: string;
  timeoutMs: number;
  payload: Record<string, unknown>;
}): Promise<PlanSheetLlmPostResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    const response = await fetch(args.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.payload),
      cache: "no-store",
      signal: controller.signal,
    });

    const responseText = await response.text();
    let responsePayload: Record<string, unknown> | null = null;

    if (normalizeWhitespace(responseText)) {
      try {
        const parsed = JSON.parse(responseText);
        responsePayload =
          parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { value: parsed };
      } catch {
        responsePayload = { raw_text: responseText };
      }
    }

    if (!response.ok) {
      const errorKind: PlanSheetImportLlmErrorKind =
        response.status === 429
          ? "rate_limit"
          : response.status >= 500
            ? "server_error"
            : "client_error";
      return {
        ok: false,
        responsePayload,
        errorMessage: `LLM request failed with ${response.status} ${response.statusText}`.trim(),
        errorKind,
        statusCode: response.status,
      };
    }

    return {
      ok: true,
      responsePayload,
      errorMessage: null,
      errorKind: null,
      statusCode: response.status,
    };
  } catch (error) {
    const classifiedError = classifyPlanSheetLlmThrownError(error);
    return {
      ok: false,
      responsePayload: null,
      errorMessage: classifiedError.errorMessage,
      errorKind: classifiedError.errorKind,
      statusCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runPlanSheetLlmRequestAttempts(
  args: PlanSheetLlmRequestAttemptContext & {
    postPayload?: (args: {
      endpoint: string;
      token: string;
      timeoutMs: number;
      payload: Record<string, unknown>;
    }) => Promise<PlanSheetLlmPostResult>;
  }
): Promise<PlanSheetLlmAttemptRunResult> {
  const postPayload = args.postPayload ?? postPlanSheetLlmPayload;
  const maxAttempts = Math.max(1, args.maxRetries + 1);
  const retryHistory: PlanSheetImportLlmRetryAttempt[] = [];
  const requestedAt = new Date().toISOString();
  let finalResponse: PlanSheetLlmPostResult = {
    ok: false,
    responsePayload: null,
    errorMessage: "LLM request was not attempted.",
    errorKind: "unknown",
    statusCode: null,
  };
  let resolvedMetadata: PlanSheetLlmMetadataSnapshot | null = null;
  let requestStatus = "error";
  let finalErrorKind: PlanSheetImportLlmErrorKind | null = "unknown";
  let finalErrorMessage: string | null = "LLM request was not attempted.";
  let completedAt = requestedAt;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = new Date().toISOString();
    const startedAtMs = Date.now();
    const response = await postPayload({
      endpoint: args.endpoint,
      token: args.token,
      timeoutMs: args.timeoutMs,
      payload: args.payload,
    });
    const completedAtMs = Date.now();
    completedAt = new Date().toISOString();
    resolvedMetadata = response.ok
      ? normalizePlanSheetLlmResponse(response.responsePayload)
      : null;
    requestStatus =
      response.ok && resolvedMetadata
        ? "success"
        : response.ok
          ? "invalid_response"
          : "error";
    finalResponse = response;
    finalErrorKind =
      requestStatus === "invalid_response"
        ? "invalid_response"
        : requestStatus === "success"
          ? null
          : response.errorKind ?? "unknown";
    finalErrorMessage =
      response.errorMessage ??
      (requestStatus === "invalid_response"
        ? "LLM response did not include usable metadata."
        : null);

    const shouldRetry =
      attempt < maxAttempts &&
      shouldRetryPlanSheetLlmFailure({
        errorKind: finalErrorKind,
        statusCode: response.statusCode,
        requestStatus,
      });
    const retryReason = shouldRetry
      ? formatRetryReason(finalErrorKind, response.statusCode)
      : null;

    retryHistory.push({
      attempt,
      status: requestStatus,
      error_kind: finalErrorKind,
      error_message: finalErrorMessage,
      duration_ms: Math.max(0, completedAtMs - startedAtMs),
      started_at: startedAt,
      completed_at: completedAt,
      retry_reason: retryReason,
    });

    if (requestStatus === "success") {
      if (attempt > 1) {
        console.info(
          `[plan-sheet-llm] page ${args.pageNumber} succeeded after ${attempt} attempts`
        );
      }
      break;
    }

    if (!shouldRetry) {
      console.warn(
        `[plan-sheet-llm] page ${args.pageNumber} ${requestStatus} after ${attempt} attempt(s): ${finalErrorKind ?? "unknown"}${finalErrorMessage ? ` - ${finalErrorMessage}` : ""}`
      );
      break;
    }

    console.warn(
      `[plan-sheet-llm] retrying page ${args.pageNumber} attempt ${attempt + 1}/${maxAttempts} after ${retryReason ?? "retryable failure"}`
    );
    await sleep(buildRetryDelayMs(args.retryBackoffMs, attempt));
  }

  return {
    finalResponse,
    resolvedMetadata,
    retryHistory,
    attemptCount: retryHistory.length,
    finalErrorKind,
    requestStatus,
    errorMessage: finalErrorMessage,
    requestedAt,
    completedAt,
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>
) {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      runWorker()
    )
  );

  return results;
}

function formatPageRanges(values: number[]) {
  const pages = [...new Set(values)]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const ranges: string[] = [];
  let index = 0;

  while (index < pages.length) {
    const start = pages[index];
    let end = start;

    while (index + 1 < pages.length && pages[index + 1] === end + 1) {
      index += 1;
      end = pages[index];
    }

    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }

  return ranges.join(", ");
}

function toLlmComparisonFields(args: {
  heuristic: PlanSheetLlmMetadataSnapshot;
  resolved: PlanSheetLlmMetadataSnapshot | null;
}) {
  if (!args.resolved) {
    return {
      disagreementFields: [] as string[],
      agreesWithHeuristic: null,
    };
  }

  const disagreementFields = getTrainingChangedFields({
    model: {
      sheet_number: args.heuristic.sheet_number,
      sheet_title: args.heuristic.sheet_title,
      discipline: args.heuristic.discipline,
      sheet_type: args.heuristic.sheet_type,
      scope_tags: args.heuristic.scope_tags,
      area_tags: args.heuristic.area_tags,
      sheet_kind: args.heuristic.sheet_kind,
    },
    reviewed: {
      sheet_number: args.resolved.sheet_number,
      sheet_title: args.resolved.sheet_title,
      discipline: args.resolved.discipline,
      sheet_type: args.resolved.sheet_type,
      scope_tags: args.resolved.scope_tags,
      area_tags: args.resolved.area_tags,
      sheet_kind: args.resolved.sheet_kind,
    },
  });

  return {
    disagreementFields,
    agreesWithHeuristic: disagreementFields.length === 0,
  };
}

export async function resolvePlanSheetMetadataAssistsForModelSheets(args: {
  jobId: string;
  planSetId: string;
  sessionId?: string | null;
  debugArtifactsDir?: string | null;
  modelSheets: TrainingModelSheet[];
  persistAssists?: boolean;
}) {
  const config = getPlanSheetLlmConfig();
  if (!config) {
    return [] as PlanSheetImportResolverResult[];
  }

  const preparedSheets = await Promise.all(
    args.modelSheets.map(async (modelSheet) => {
      const heuristicSnapshot = buildHeuristicSnapshot(modelSheet);
      const artifactEvidence = await buildTrainingArtifactEvidence({
        artifactsDir: args.debugArtifactsDir,
        pageNumber: modelSheet.page_number,
        modelSheet,
      });
      const resolverEvidence = buildPlanSheetResolverEvidencePayload({
        artifactEvidence,
        heuristicSnapshot,
      });
      const eligibility = getPlanSheetLlmAssistEligibility({
        heuristicSnapshot,
        resolverEvidence,
        artifactEvidence,
      });

      return {
        modelSheet,
        heuristicSnapshot,
        artifactEvidence,
        resolverEvidence,
        eligibility,
      };
    })
  );
  const requestSheets = preparedSheets.filter((entry) => entry.eligibility.shouldRequest);
  const skippedByReason = preparedSheets.reduce<Record<string, number>>((summary, entry) => {
    if (!entry.eligibility.shouldRequest) {
      summary[entry.eligibility.reason] = (summary[entry.eligibility.reason] ?? 0) + 1;
    }
    return summary;
  }, {});

  console.info(
    `[plan-sheet-llm] starting import assist for ${requestSheets.length}/${args.modelSheets.length} page(s) with timeout=${config.timeoutMs}ms concurrency=${config.concurrency} maxRetries=${config.maxRetries}`
  );
  if (Object.keys(skippedByReason).length > 0) {
    console.info(
      `[plan-sheet-llm] skipped ${args.modelSheets.length - requestSheets.length} page(s): ${JSON.stringify(skippedByReason)}`
    );
  }

  const assists = await mapWithConcurrency(
    requestSheets,
    config.concurrency,
    async (entry) => {
      const {
        modelSheet,
        heuristicSnapshot,
        artifactEvidence,
        resolverEvidence,
        eligibility,
      } = entry;
      const pageHash = buildTrainingPageHash({
        planSetId: args.planSetId,
        pageNumber: modelSheet.page_number,
        extractedText: modelSheet.extracted_text,
        modelSheetNumber: modelSheet.sheet_number,
        modelSheetTitle: modelSheet.sheet_title,
      });
      const payload: Record<string, unknown> = {
        task: "resolve_sheet_metadata",
        job_id: args.jobId,
        plan_set_id: args.planSetId,
        session_id: normalizeWhitespace(args.sessionId) || null,
        page_number: modelSheet.page_number,
        page_hash: pageHash,
        evidence: resolverEvidence,
        focused_evidence: resolverEvidence.high_signal_localized,
        heuristic_snapshot: {
          sheet_number: heuristicSnapshot.sheet_number,
          sheet_title: heuristicSnapshot.sheet_title,
          discipline: heuristicSnapshot.discipline,
          sheet_type: heuristicSnapshot.sheet_type,
          scope_tags: heuristicSnapshot.scope_tags,
          area_tags: heuristicSnapshot.area_tags,
          sheet_kind: heuristicSnapshot.sheet_kind,
          confidence: heuristicSnapshot.confidence,
        },
        model_snapshot: {
          sheet_number: heuristicSnapshot.sheet_number,
          sheet_title: heuristicSnapshot.sheet_title,
          discipline: heuristicSnapshot.discipline,
          sheet_type: heuristicSnapshot.sheet_type,
          scope_tags: heuristicSnapshot.scope_tags,
          area_tags: heuristicSnapshot.area_tags,
          sheet_kind: heuristicSnapshot.sheet_kind,
          confidence: heuristicSnapshot.confidence,
        },
        resolution_preferences: {
          treat_model_snapshot_as_hint: true,
          prefer_localized_evidence: true,
          allow_supported_title_refinement: true,
          require_local_support_for_number_and_title: true,
          resolve_supported_number_and_title_only: true,
          reject_unrelated_body_text_for_titles: true,
          prefer_minimal_corrections_over_page_reinterpretation: true,
          derive_sheet_kind_from_final_metadata: true,
          llm_call_reason: eligibility.reason,
        },
      };

      const attemptRun = await runPlanSheetLlmRequestAttempts({
        endpoint: config.endpoint,
        token: config.token,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        retryBackoffMs: config.retryBackoffMs,
        payload,
        pageNumber: modelSheet.page_number,
      });
      const comparison = toLlmComparisonFields({
        heuristic: heuristicSnapshot,
        resolved: attemptRun.resolvedMetadata,
      });
      const effectiveResult = resolveEffectivePlanSheetMetadata({
        heuristic: heuristicSnapshot,
        resolved: attemptRun.resolvedMetadata,
        artifactEvidence,
      });
      const effectiveRegionPattern = inferPlanSheetEffectiveRegionPattern({
        artifactEvidence,
        effectiveMetadata: effectiveResult.effective_metadata,
      });
      const assist = {
        plan_sheet_id: modelSheet.id,
        page_number: modelSheet.page_number,
        page_hash: pageHash,
        heuristic_snapshot: heuristicSnapshot,
        request_status: attemptRun.requestStatus,
        request_payload: payload,
        response_payload: attemptRun.finalResponse.responsePayload,
        resolved_metadata: attemptRun.resolvedMetadata,
        effective_metadata: effectiveResult.effective_metadata,
        effective_field_sources: effectiveResult.effective_field_sources,
        effective_source: effectiveResult.effective_source,
        disagreement_fields: comparison.disagreementFields,
        agrees_with_heuristic: comparison.agreesWithHeuristic,
        attempt_count: attemptRun.attemptCount,
        final_error_kind: attemptRun.finalErrorKind,
        retry_history: attemptRun.retryHistory,
        error_message: attemptRun.errorMessage,
        requested_at: attemptRun.requestedAt,
        completed_at: attemptRun.completedAt,
      } satisfies PlanSheetImportLlmAssistRow;

      return {
        assist,
        ...effectiveResult,
        effective_region_pattern: effectiveRegionPattern,
      } satisfies PlanSheetImportResolverResult;
    }
  );

  if (args.persistAssists !== false) {
    await savePlanSetImportLlmAssists({
      planSetId: args.planSetId,
      assists: assists.map((entry) => entry.assist),
    });
  }

  const assistRows = assists.map((entry) => entry.assist);
  const successPages = assistRows
    .filter((entry) => entry.request_status === "success")
    .map((entry) => entry.page_number);
  const invalidPages = assistRows
    .filter((entry) => entry.request_status === "invalid_response")
    .map((entry) => entry.page_number);
  const errorPages = assistRows
    .filter((entry) => entry.request_status === "error")
    .map((entry) => entry.page_number);

  console.info(
    `[plan-sheet-llm] completed import assist: success=${successPages.length} invalid=${invalidPages.length} error=${errorPages.length}`
  );
  if (invalidPages.length > 0) {
    console.warn(
      `[plan-sheet-llm] invalid response pages: ${formatPageRanges(invalidPages)}`
    );
  }
  if (errorPages.length > 0) {
    console.warn(
      `[plan-sheet-llm] failed pages: ${formatPageRanges(errorPages)}`
    );
  }

  return assists;
}

export async function resolvePlanSheetMetadataAssistsForPlanSet(args: {
  jobId: string;
  planSetId: string;
  sessionId?: string | null;
  debugArtifactsDir?: string | null;
  modelSheets: TrainingModelSheet[];
}) {
  return resolvePlanSheetMetadataAssistsForModelSheets({
    ...args,
    persistAssists: true,
  });
}

export const __planSheetLlmTestUtils = {
  getPlanSheetLlmAssistEligibility,
};
