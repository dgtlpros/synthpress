"use client";

import { useState } from "react";
import { signUpWithMagicLink } from "@/app/(auth)/actions";

export function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signUpWithMagicLink(email, fullName);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue/10">
          <svg className="h-6 w-6 text-brand-blue" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground">Check your email</h2>
        <p className="text-sm text-muted">
          We sent a magic link to <span className="font-medium text-foreground">{email}</span>.
          Click the link in the email to finish creating your account.
        </p>
        <button
          type="button"
          onClick={() => setSent(false)}
          className="cursor-pointer text-sm font-medium text-brand-blue hover:text-brand-indigo transition-colors"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="fullName" className="block text-sm font-medium text-foreground mb-1">
          Full Name
        </label>
        <input
          id="fullName"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
          className="h-10 w-full rounded-[var(--sp-radius-lg)] border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
          placeholder="John Doe"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="h-10 w-full rounded-[var(--sp-radius-lg)] border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue/30 focus:border-brand-blue"
          placeholder="you@example.com"
        />
      </div>

      {error && (
        <p className="text-sm text-error">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-[var(--sp-radius-lg)] bg-gradient-accent px-4 text-sm font-medium text-white shadow-md transition-all hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none"
      >
        {loading ? "Sending link..." : "Send Magic Link"}
      </button>
    </form>
  );
}
