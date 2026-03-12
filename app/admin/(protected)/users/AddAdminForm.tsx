"use client";

import { useActionState } from "react";

export default function AddAdminForm({
  action,
}: {
  action: (prevState: any, formData: FormData) => Promise<any>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <input
          type="text"
          name="full_name"
          placeholder="Full name"
          className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          required
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          required
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          type="password"
          name="password"
          placeholder="Temporary password"
          className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          required
        />
        <select
          name="role"
          className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          defaultValue="viewer_admin"
        >
          <option value="viewer_admin">Viewer Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-black px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create Admin"}
      </button>

      {state?.error && <p className="text-sm text-red-600">⚠ {state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">{state.success}</p>}
    </form>
  );
}