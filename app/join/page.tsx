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
  const [myEmail, setMyEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(`/join?token=${t}`)}`);
        return;
      }
      setMyEmail(user.email ?? "");

      const { data, error } = await supabase.rpc("get_invitation", { _token: t });
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
  }, [supabase, router]);

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

  async function switchAccount() {
    await supabase.auth.signOut();
    router.push(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
  }

  if (loading) {
    return <AuthShell title="Checking your invitation" subtitle="One moment...">{null}</AuthShell>;
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

  const wrongAccount = myEmail.toLowerCase() !== invite.email.toLowerCase();

  return (
    <AuthShell
      title={`Join ${invite.org_name}`}
      subtitle={`You've been invited as ${roleLabel(invite.role)}.`}
    >
      {wrongAccount ? (
        <>
          <p className="msg-error" role="alert">
            This invitation was sent to {invite.email}, but you&apos;re logged in as {myEmail}.
          </p>
          <button type="button" className="btn-primary mt-4" onClick={switchAccount}>
            Log out and use {invite.email}
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
