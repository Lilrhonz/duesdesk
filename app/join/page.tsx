"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { messageOf } from "@/lib/format";
import AuthShell from "@/components/auth-shell";

type Invitation = { org_name: string; email: string; role: string; status: string };

const roleLabel = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

export default function JoinPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<Invitation | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null); // null = not logged in
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    async function run() {
      const t = new URLSearchParams(window.location.search).get("token");
      if (!t) {
        setError("This link is missing its invitation code.");
        setLoading(false);
        return;
      }
      setToken(t);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserEmail(user?.email ?? null);

      const { data, error } = await supabase.rpc("peek_invitation", { _token: t });
      if (error) {
        setError(messageOf(error));
      } else {
        const row = (Array.isArray(data) ? data[0] : data) as Invitation | undefined;
        if (row) setInvite(row);
        else setError("This invitation link is not valid.");
      }
      setLoading(false);
    }
    run();
  }, [supabase]);

  const loginHref = `/login?next=${encodeURIComponent(`/join?token=${token ?? ""}`)}`;

  // Logged in already: just accept.
  async function accept() {
    if (!token) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("accept_invitation", { _token: token });
    if (error) {
      setError(messageOf(error));
      setBusy(false);
      return;
    }
    router.push("/dashboard");
  }

  // Not logged in: create the account and join in one step.
  async function createAndJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!invite || !token) return;
    setError(null);
    setInfo(null);
    setBusy(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: invite.email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });

    if (signUpError) {
      setError(
        /already/i.test(signUpError.message)
          ? "This email already has an account. Use the Log in link below to join."
          : signUpError.message
      );
      setBusy(false);
      return;
    }

    if (!data.session) {
      setInfo(
        "Almost there. Check your email to confirm your account, then open this link again. If you already had an account with this email, use the Log in link below instead."
      );
      setBusy(false);
      return;
    }

    const { error: acceptError } = await supabase.rpc("accept_invitation", { _token: token });
    if (acceptError) {
      // Account exists now; let the person retry with the Join button.
      setUserEmail(invite.email);
      setError(messageOf(acceptError));
      setBusy(false);
      return;
    }
    router.push("/dashboard");
  }

  async function switchAccount() {
    await supabase.auth.signOut();
    setUserEmail(null);
    setError(null);
  }

  if (loading) {
    return (
      <AuthShell title="Checking your invitation" subtitle="One moment...">
        {null}
      </AuthShell>
    );
  }

  if (!invite) {
    return (
      <AuthShell
        title="We couldn't open this invitation"
        subtitle={error ?? "This invitation link is not valid."}
        footer={
          <a href="/dashboard" className="link-quiet">
            Go to your dashboard
          </a>
        }
      >
        {null}
      </AuthShell>
    );
  }

  if (invite.status !== "valid") {
    return (
      <AuthShell
        title={invite.status === "accepted" ? "Invitation already used" : "Invitation expired"}
        subtitle={
          invite.status === "accepted"
            ? "This invitation has already been accepted."
            : "Ask an admin of this organization to send you a new one."
        }
        footer={
          <a href="/dashboard" className="link-quiet">
            Go to your dashboard
          </a>
        }
      >
        {null}
      </AuthShell>
    );
  }

  /* ---------- Not logged in: one short form ---------- */
  if (userEmail === null) {
    return (
      <AuthShell
        title={`Join ${invite.org_name}`}
        subtitle={`You've been invited as ${roleLabel(invite.role)}. Choose a password and you're in.`}
        footer={
          <>
            Already have an account?{" "}
            <a href={loginHref} className="link-quiet">
              Log in
            </a>
          </>
        }
      >
        <form onSubmit={createAndJoin} className="space-y-4">
          <div>
            <label className="label" htmlFor="j-email">
              Your email
            </label>
            <input
              id="j-email"
              className="field"
              value={invite.email}
              readOnly
              style={{ background: "var(--paper)" }}
            />
          </div>

          <div>
            <label className="label" htmlFor="j-name">
              Your name
            </label>
            <input
              id="j-name"
              className="field"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <label className="label" htmlFor="j-password">
                Choose a password
              </label>
              <button
                type="button"
                className="text-btn mb-1.5"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="j-password"
              className="field"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
              At least 6 characters.
            </p>
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

          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Setting things up..." : "Create account and join"}
          </button>
        </form>
      </AuthShell>
    );
  }

  /* ---------- Logged in ---------- */
  const wrongAccount = userEmail.toLowerCase() !== invite.email.toLowerCase();

  return (
    <AuthShell
      title={`Join ${invite.org_name}`}
      subtitle={`You've been invited as ${roleLabel(invite.role)}.`}
    >
      {wrongAccount ? (
        <>
          <p className="msg-error" role="alert">
            This invitation was sent to {invite.email}, but you&apos;re logged in as {userEmail}.
          </p>
          <button type="button" className="btn-primary mt-4" onClick={switchAccount}>
            Log out and continue as {invite.email}
          </button>
        </>
      ) : (
        <>
          {error && (
            <p className="msg-error mb-4" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn-primary" disabled={busy} onClick={accept}>
            {busy ? "Joining..." : `Join ${invite.org_name}`}
          </button>
        </>
      )}
    </AuthShell>
  );
}
