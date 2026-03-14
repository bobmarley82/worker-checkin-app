
"use client";

import { useActionState } from "react";

export default function AddJobForm({
  action,
}: {
  action: (prevState: any, formData: FormData) => Promise<any>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="mt-4 space-y-2">
      <div className="flex gap-3">
        <input
          type="text"
          name="name"
          placeholder="Enter job name"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          required
        />
          <input
            type="text"
            name="job_number"
            placeholder="Job number"
            className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add Job"}
        </button>
      </div>

      {state?.error && (
        <p className="text-sm text-red-600">⚠ {state.error}</p>
      )}

      {state?.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}

