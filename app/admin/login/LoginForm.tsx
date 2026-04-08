"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const supabase = createClient();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/admin/records");
    router.refresh();
  }

  async function handleForgotPassword(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setResetError("");
    setResetSuccess("");

    const emailToReset = resetEmail.trim().toLowerCase();

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
    <div className="mt-6 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-900"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-900"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
            required
          />
        </div>

        {errorMessage ? (
          <p className="text-sm text-red-600">{errorMessage}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="admin-action-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing In..." : "Sign In"}
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
        <h2 className="text-sm font-semibold text-slate-900">Forgot Password?</h2>
        <p className="mt-1 text-sm text-slate-600">
          Send a reset link to an admin email if the password has been forgotten.
        </p>

        <form onSubmit={handleForgotPassword} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="reset_email"
              className="block text-sm font-medium text-slate-900"
            >
              Admin Email
            </label>
            <input
              id="reset_email"
              type="email"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
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
            className="admin-action-secondary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSendingReset ? "Sending Reset Link..." : "Send Reset Link"}
          </button>
        </form>
      </div>
    </div>
  );
}
