"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth-shell";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  // After logging in, go back to where the person was heading (for example an invitation link).
  function destination() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) setError(error.message);
      else if (!data.session)
        setInfo("Account created. Check your email to confirm it, then log in.");
      else router.push(destination());
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      else router.push(destination());
    }
    setLoading(false);
  }

  return (
    <AuthShell
      title={isSignup ? "Create your account" : "Log in"}
      subtitle={
        isSignup
          ? "Start with your account. You'll set up your organization next."
          : "Welcome back. Enter your details to continue."
      }
      footer={
        <>
          {isSignup ? "Already have an account? " : "New to DuesDesk? "}
          <button
            type="button"
            className="link-quiet"
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(null);
              setInfo(null);
            }}
          >
            {isSignup ? "Log in" : "Create an account"}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {isSignup && (
          <div>
            <label className="label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              className="field"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="field"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="field"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {isSignup && (
            <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
              At least 6 characters.
            </p>
          )}
        </div>

        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}
        {info && (
          <p className="msg-ok" role="status">
            {info}
          </p>
        )}

        <button type="submit" disabled={loading} className="btn-primary">
          {loading
            ? isSignup
              ? "Creating account..."
              : "Logging in..."
            : isSignup
              ? "Create account"
              : "Log in"}
        </button>
      </form>
    </AuthShell>
  );
}
