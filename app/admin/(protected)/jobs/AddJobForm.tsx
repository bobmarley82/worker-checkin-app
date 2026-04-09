"use client";

import { useActionState } from "react";

type JobFormState = {
  error?: string;
  success?: string;
} | null;

export default function AddJobForm({
  action,
}: {
  action: (
    prevState: JobFormState,
    formData: FormData
  ) => Promise<JobFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,0.8fr)_auto] md:items-end">
        <div className="space-y-1.5">
          <label
            htmlFor="add-job-name"
            className="block text-sm font-medium text-slate-900"
          >
            Job name
          </label>
          <input
            id="add-job-name"
            type="text"
            name="name"
            placeholder="Enter job name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="add-job-number"
            className="block text-sm font-medium text-slate-900"
          >
            Job number
          </label>
          <input
            id="add-job-number"
            type="text"
            name="job_number"
            placeholder="Job number"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="admin-action-primary w-full md:w-auto disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add Job"}
        </button>
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">Warning: {state.error}</p>
      )}

      {state?.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
