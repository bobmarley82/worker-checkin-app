"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PublishStatus = {
  publishStatus?: string | null;
  isPublishing?: boolean;
  message?: string | null;
  error?: string | null;
  totalSheetCount?: number | null;
  generatedAssetCount?: number | null;
  savedAssetCount?: number | null;
  currentPageNumber?: number | null;
  currentSheetNumber?: string | null;
  elapsedSeconds?: number | null;
  estimatedSecondsRemaining?: number | null;
  redirectHref?: string | null;
};

function formatDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "";
  }

  const roundedSeconds = Math.round(seconds);
  const minutes = Math.floor(roundedSeconds / 60);
  const remainderSeconds = roundedSeconds % 60;

  if (minutes === 0) {
    return `${remainderSeconds}s`;
  }

  return `${minutes}m ${String(remainderSeconds).padStart(2, "0")}s`;
}

function getPublishProgressPercent(status: PublishStatus | null) {
  if (!status) {
    return 5;
  }

  if (status.publishStatus === "complete") {
    return 100;
  }

  if (status.publishStatus === "failed") {
    return 100;
  }

  if (status.publishStatus === "queued") {
    return 8;
  }

  if (status.publishStatus === "loading_pdf") {
    return 12;
  }

  if (status.publishStatus === "saving_review") {
    return 10;
  }

  if (status.publishStatus === "saving_training") {
    return 13;
  }

  if (status.publishStatus === "generating_assets") {
    const total = Math.max(1, status.totalSheetCount ?? 1);
    const generated = Math.max(0, status.generatedAssetCount ?? 0);
    return Math.min(86, 15 + Math.round((generated / total) * 71));
  }

  if (status.publishStatus === "saving_asset_records") {
    const total = Math.max(1, status.totalSheetCount ?? 1);
    const saved = Math.max(0, status.savedAssetCount ?? 0);
    return Math.min(95, 87 + Math.round((saved / total) * 8));
  }

  if (status.publishStatus === "finalizing") {
    return 97;
  }

  return 5;
}

export default function PublishPlanSetProgress({
  jobId,
  planSetId,
  initialActive,
}: {
  jobId: string;
  planSetId: string;
  initialActive: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PublishStatus | null>(
    initialActive
      ? {
          publishStatus: "queued",
          isPublishing: true,
          message: "Queued for publish.",
        }
      : null
  );
  const [hasSeenPublish, setHasSeenPublish] = useState(initialActive);

  useEffect(() => {
    let isCancelled = false;
    let timeoutId: number | null = null;

    async function pollPublishStatus() {
      try {
        const response = await fetch(
          `/admin/jobs/${jobId}/sheets/publish-status/${planSetId}`,
          {
            cache: "no-store",
          }
        );

        if (!response.ok) {
          throw new Error(`Publish status request failed (${response.status}).`);
        }

        const payload = (await response.json()) as PublishStatus;
        if (isCancelled) {
          return;
        }

        if (
          payload.isPublishing ||
          payload.publishStatus === "complete" ||
          payload.publishStatus === "failed"
        ) {
          setHasSeenPublish(true);
          setStatus(payload);
        } else if (hasSeenPublish || initialActive) {
          setHasSeenPublish(true);
          setStatus({
            ...payload,
            publishStatus: "failed",
            error: "Publish is not running. Try clicking Publish Plan Set again.",
          });
          return;
        }

        if (payload.publishStatus === "complete" && payload.redirectHref) {
          timeoutId = window.setTimeout(() => {
            router.replace(payload.redirectHref ?? `/admin/jobs/${jobId}/sheets`);
          }, 800);
          return;
        }

        if (payload.publishStatus === "failed") {
          return;
        }
      } catch {
        // A missed poll should not interrupt the background publish.
      }

      if (!isCancelled) {
        timeoutId = window.setTimeout(() => {
          void pollPublishStatus();
        }, 1500);
      }
    }

    void pollPublishStatus();

    return () => {
      isCancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [hasSeenPublish, initialActive, jobId, planSetId, router]);

  if (!hasSeenPublish || !status) {
    return null;
  }

  const progressPercent = getPublishProgressPercent(status);
  const elapsed = formatDuration(status.elapsedSeconds);
  const remaining = formatDuration(status.estimatedSecondsRemaining);
  const title =
    status.publishStatus === "complete"
      ? "Publish Complete"
      : status.publishStatus === "failed"
        ? "Publish Failed"
        : "Publishing Plan Set";
  const detail = [
    status.totalSheetCount
      ? `${status.totalSheetCount} sheet${status.totalSheetCount === 1 ? "" : "s"}`
      : null,
    status.generatedAssetCount !== null && status.generatedAssetCount !== undefined
      ? `${status.generatedAssetCount} generated`
      : null,
    status.savedAssetCount !== null && status.savedAssetCount !== undefined
      ? `${status.savedAssetCount} saved`
      : null,
    status.currentSheetNumber ? `current ${status.currentSheetNumber}` : null,
    status.currentPageNumber ? `page ${status.currentPageNumber}` : null,
    elapsed ? `elapsed ${elapsed}` : null,
    remaining && status.publishStatus !== "complete"
      ? `roughly ${remaining} left`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        status.publishStatus === "failed"
          ? "border-red-200 bg-red-50"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-700">
            {status.error || status.message || "Publishing in the background."}
          </p>
          {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          {progressPercent}%
        </span>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent}
      >
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            status.publishStatus === "failed" ? "bg-red-600" : "bg-slate-950"
          }`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      {status.publishStatus === "complete" ? (
        <p className="mt-2 text-xs font-medium text-emerald-700">
          Opening the sheet library.
        </p>
      ) : null}
    </div>
  );
}
