"use client";

import { useFormStatus } from "react-dom";

type PublishPlanSetButtonProps = {
  action: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
};

export default function PublishPlanSetButton({
  action,
  disabled = false,
}: PublishPlanSetButtonProps) {
  const { pending, action: pendingAction } = useFormStatus();
  const isPublishing = pending && pendingAction === action;
  const isDisabled = disabled || isPublishing;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="submit"
        formAction={action}
        disabled={isDisabled}
        aria-busy={isPublishing}
        className="admin-action-primary disabled:cursor-wait disabled:opacity-80"
      >
        <span className="inline-flex items-center gap-2">
          {isPublishing ? (
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          ) : null}
          {isPublishing ? "Publishing..." : "Publish Plan Set"}
        </span>
      </button>
      {isPublishing ? (
        <p className="text-xs font-medium text-slate-600" aria-live="polite">
          Saving review changes and starting the publish job.
        </p>
      ) : null}
      {disabled && !isPublishing ? (
        <p className="text-xs font-medium text-slate-600" aria-live="polite">
          Publish is already running in the background.
        </p>
      ) : null}
    </div>
  );
}
