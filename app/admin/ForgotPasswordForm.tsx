"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordForm() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  async function handleForgotPassword(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setResetError("");
    setResetSuccess("");

    const emailToReset = email.trim().toLowerCase();

    if (!emailToReset) {
      setResetError("Enter the admin email you want to reset.");
      return;
    }

    setIsSendingReset(true);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin;
    const { error } = await supabase.auth.resetPasswordForEmail(emailToReset, {
      redirectTo: `${appUrl}/admin/reset-password`,
    });

    setIsSendingReset(false);

    if (error) {
      setResetError(error.message);
      return;
    }

    setResetSuccess(
      "If that email exists, a password reset link has been sent."
    );
  }

  return (
    <form onSubmit={handleForgotPassword} className="space-y-5">
      <div>
        <label
          htmlFor="reset_email"
          className="block text-sm font-medium text-slate-900"
        >
          Admin Email
        </label>
        <p className="mt-1 text-xs text-slate-600">
          We&apos;ll send a password reset link to this email address.
        </p>
        <input
          id="reset_email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          placeholder="name@company.com"
          required
        />
      </div>

      {resetError ? <p className="text-sm text-red-600">{resetError}</p> : null}
      {resetSuccess ? (
        <p className="text-sm text-green-700">{resetSuccess}</p>
      ) : null}

      <button
        type="submit"
        disabled={isSendingReset}
        className="admin-action-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSendingReset ? "Sending Reset Link..." : "Send Reset Link"}
      </button>
    </form>
  );
}
