"use client";

import { useActionState } from "react";

type AdminFormState = {
  error?: string;
  success?: string;
} | null;

export default function AddAdminForm({
  action,
}: {
  action: (
    prevState: AdminFormState,
    formData: FormData
  ) => Promise<AdminFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="mt-5 space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="full_name"
            className="block text-sm font-medium text-slate-900"
          >
            Admin Name
          </label>
          <p className="mt-1 text-xs text-slate-600">
            This is the display name shown across reports and admin pages.
          </p>
          <input
            id="full_name"
            type="text"
            name="full_name"
            placeholder="Jane Smith"
            className="mt-2 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-900"
          >
            Login Email
          </label>
          <p className="mt-1 text-xs text-slate-600">
            This email will be used by the admin to sign in.
          </p>
          <input
            id="email"
            type="email"
            name="email"
            placeholder="name@company.com"
            className="mt-2 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-900"
          >
            Temporary Password
          </label>
          <p className="mt-1 text-xs text-slate-600">
            Give the new admin a starting password they can use on first sign-in.
          </p>
          <input
            id="password"
            type="password"
            name="password"
            placeholder="Temporary password"
            className="mt-2 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        <div>
          <label
            htmlFor="role"
            className="block text-sm font-medium text-slate-900"
          >
            Admin Role
          </label>
          <p className="mt-1 text-xs text-slate-600">
            Field Supervisors can manage assigned jobs and reports. Office/Admin
            can manage users and access everything.
          </p>
          <select
            id="role"
            name="role"
            className="mt-2 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            defaultValue="viewer_admin"
          >
            <option value="viewer_admin">Field Supervisor</option>
            <option value="super_admin">Office/Admin</option>
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="admin-action-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Creating..." : "Create Admin"}
      </button>

      {state?.error && (
        <p className="text-sm text-red-600">Warning: {state.error}</p>
      )}
      {state?.success && (
        <p className="text-sm text-green-600">{state.success}</p>
      )}
    </form>
  );
}
