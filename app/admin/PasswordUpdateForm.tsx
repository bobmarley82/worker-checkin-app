"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PasswordUpdateFormProps = {
  mode: "account" | "reset";
};

export default function PasswordUpdateForm({
  mode,
}: PasswordUpdateFormProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(mode === "account");

  useEffect(() => {
    if (mode === "account") {
      return;
    }

    let isMounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (isMounted) {
        setIsReady(Boolean(data.session));
      }
    };

    void checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setIsReady(Boolean(session));
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [mode, supabase]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    if (!password.trim()) {
      setErrorMessage("Enter a new password.");
      return;
    }

    if (password.length < 8) {
      setErrorMessage("Use at least 8 characters for the new password.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const { error } = await supabase.auth.updateUser({
      password,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    if (mode === "reset") {
      await supabase.auth.signOut();
      router.push("/admin/login?password_reset=1");
      router.refresh();
      return;
    }

    setSuccessMessage("Password updated successfully.");
    setPassword("");
    setConfirmPassword("");
  }

  if (mode === "reset" && !isReady) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          Open the password reset link from your email to continue. If the link
          expired, go back to login and request a new reset email.
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label
          htmlFor="new_password"
          className="block text-sm font-medium text-slate-900"
        >
          New Password
        </label>
        <p className="mt-1 text-xs text-slate-600">
          Use at least 8 characters. A longer passphrase is even better.
        </p>
        <input
          id="new_password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          autoComplete="new-password"
          required
        />
      </div>

      <div>
        <label
          htmlFor="confirm_password"
          className="block text-sm font-medium text-slate-900"
        >
          Confirm Password
        </label>
        <p className="mt-1 text-xs text-slate-600">
          Re-enter the password so we know it was typed correctly.
        </p>
        <input
          id="confirm_password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          autoComplete="new-password"
          required
        />
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : null}

      {successMessage ? (
        <p className="text-sm text-green-700">{successMessage}</p>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="admin-action-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting
          ? "Saving..."
          : mode === "reset"
          ? "Set New Password"
          : "Update Password"}
      </button>
    </form>
  );
}
