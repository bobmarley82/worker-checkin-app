"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function LoginForm() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

    window.location.assign("/admin/jobs");
  }
  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-900"
          >
            Password
          </label>
          <Link
            href="/admin/forgot-password"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-black"
          required
        />
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <button
        type="submit"
        disabled={loading}
        className="admin-action-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Signing In..." : "Sign In"}
      </button>
    </form>
  );
}
