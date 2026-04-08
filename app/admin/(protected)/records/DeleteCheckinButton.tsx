"use client";

import { useActionState, useState } from "react";

type DeleteState = {
  error?: string;
  success?: string;
};

const initialState: DeleteState = {};

export default function DeleteCheckinButton({
  checkinId,
  action,
}: {
  checkinId: string;
  action: (
    prevState: DeleteState,
    formData: FormData
  ) => Promise<DeleteState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, initialState);
  const isOpen = open && !state?.success;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="w-64 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3"
    >
      <input type="hidden" name="checkin_id" value={checkinId} />

      <p className="text-sm text-red-900">
        This permanently deletes this check-in record. Type{" "}
        <span className="font-bold">DELETE</span> to confirm.
      </p>

      <input
        name="confirm_text"
        type="text"
        autoComplete="off"
        placeholder="Type DELETE"
        className="w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm outline-none focus:border-red-500"
      />

      {state?.error ? (
        <p className="text-sm text-red-700">{state.error}</p>
      ) : null}

      {state?.success ? (
        <p className="text-sm text-green-700">{state.success}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Deleting..." : "Confirm Delete"}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
