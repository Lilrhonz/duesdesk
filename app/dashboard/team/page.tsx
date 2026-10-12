"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatTimestamp, initials, messageOf } from "@/lib/format";
import Modal from "@/components/modal";
import { useQuickAction } from "@/lib/quick-action";
import { useOrg } from "../org-context";

type Supabase = ReturnType<typeof createClient>;
type Person = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
};
type Invite = { id: string; email: string; role: string; token: string; expires_at: string };

const ROLES = [
  { value: "admin", label: "Admin", hint: "Everything, including voiding payments and managing the team." },
  { value: "treasurer", label: "Treasurer", hint: "Manages members, fees and payments." },
  { value: "viewer", label: "Viewer", hint: "Can look at everything but change nothing." },
];
const roleLabel = (v: string) => ROLES.find((r) => r.value === v)?.label ?? v;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const linkFor = (token: string) => `${window.location.origin}/join?token=${token}`;

/* ------------------------------------------------------------------ */
/* Invite modal                                                        */
/* ------------------------------------------------------------------ */

function InviteModal({
  supabase,
  orgId,
  orgName,
  existingEmails,
  onClose,
  onCreated,
}: {
  supabase: Supabase;
  orgId: string;
  orgName: string;
  existingEmails: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("treasurer");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = email.trim().toLowerCase();

    if (existingEmails.includes(clean)) {
      setError(`${clean} is already on the team.`);
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("invitations")
      .insert({ org_id: orgId, email: clean, role, invited_by: user?.id ?? null })
      .select("token")
      .single();

    if (insertError || !data) {
      setError(
        insertError?.code === "23505"
          ? `${clean} already has a pending invitation. Copy its link from the list, or revoke it first.`
          : messageOf(insertError)
      );
      setSaving(false);
      return;
    }

    setLink(linkFor(data.token as string));
    setSaving(false);
    onCreated();
  }

  async function copy() {
    if (!link) return;
    setCopied(await copyText(link));
  }

  if (link) {
    return (
      <Modal title="Invitation ready" onClose={onClose}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Send this link to <b style={{ color: "var(--ink)" }}>{email.trim().toLowerCase()}</b>. They log in
          or sign up with that email, then tap Join. It only works for that address and expires in 7 days.
        </p>
        <input
          className="field mt-4"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Invitation link"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Done
          </button>
          <button type="button" className="btn" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </Modal>
    );
  }

  const hint = ROLES.find((r) => r.value === role)?.hint;

  return (
    <Modal title={`Invite someone to ${orgName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="i-email">
            Their email
          </label>
          <input
            id="i-email"
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="i-role">
            Role
          </label>
          <select id="i-role" className="field" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
            {hint}
          </p>
        </div>

        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? "Creating..." : "Create invitation"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function TeamPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const isAdmin = org.role === "admin";

  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useQuickAction({ invite: () => isAdmin && setInviting(true) });

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setMyId(user?.id ?? null);

    const team = await supabase.rpc("list_team", { _org: org.id });
    if (team.error) {
      setPageError(messageOf(team.error));
      setLoading(false);
      return;
    }
    setPeople(
      (team.data ?? []).map((r: Record<string, unknown>) => ({
        user_id: r.user_id as string,
        full_name: (r.full_name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        role: r.role as string,
        created_at: r.created_at as string,
      }))
    );

    if (isAdmin) {
      const inv = await supabase
        .from("invitations")
        .select("id, email, role, token, expires_at")
        .eq("org_id", org.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });
      if (inv.error) {
        setPageError(messageOf(inv.error));
      } else {
        setInvites(
          (inv.data ?? []).map((r) => ({
            id: r.id as string,
            email: r.email as string,
            role: r.role as string,
            token: r.token as string,
            expires_at: r.expires_at as string,
          }))
        );
      }
    }
    setLoading(false);
  }, [supabase, org.id, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const displayName = (p: Person) => p.full_name || p.email || "Team member";

  async function changeRole(p: Person, role: string) {
    setNotice(null);
    setPageError(null);
    const { error } = await supabase
      .from("org_users")
      .update({ role })
      .eq("org_id", org.id)
      .eq("user_id", p.user_id);
    if (error) {
      setPageError(error.message);
    } else {
      setNotice(`${displayName(p)} is now ${roleLabel(role).toLowerCase() === "admin" ? "an admin" : `a ${roleLabel(role).toLowerCase()}`}.`);
    }
    await load();
  }

  async function removePerson(p: Person) {
    setNotice(null);
    setPageError(null);
    if (!window.confirm(`Remove ${displayName(p)} from ${org.name}? They will lose access straight away.`)) return;
    const { error } = await supabase
      .from("org_users")
      .delete()
      .eq("org_id", org.id)
      .eq("user_id", p.user_id);
    if (error) {
      setPageError(error.message);
    } else {
      setNotice(`Removed ${displayName(p)}.`);
    }
    await load();
  }

  async function revoke(inv: Invite) {
    setNotice(null);
    setPageError(null);
    const { error } = await supabase.from("invitations").delete().eq("id", inv.id);
    if (error) {
      setPageError(error.message);
    } else {
      setNotice(`Revoked the invitation for ${inv.email}.`);
    }
    await load();
  }

  async function copyInvite(inv: Invite) {
    const ok = await copyText(linkFor(inv.token));
    setPageError(null);
    setNotice(
      ok
        ? `Link for ${inv.email} copied. Send it to them.`
        : "Couldn't copy automatically. Revoke and create the invitation again to see the link."
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            The people who can sign in to {org.name}.
          </p>
        </div>
        {isAdmin && (
          <button type="button" className="btn" onClick={() => setInviting(true)}>
            Invite someone
          </button>
        )}
      </div>

      {!isAdmin && (
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Only admins can invite people or change roles.
        </p>
      )}
      {notice && (
        <p className="msg-ok mt-5" role="status">
          {notice}
        </p>
      )}
      {pageError && (
        <p className="msg-error mt-5" role="alert">
          {pageError}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
          Loading...
        </p>
      ) : (
        <>
          <ul
            className="mt-6 overflow-hidden rounded-2xl border bg-white"
            style={{ borderColor: "var(--line)" }}
          >
            {people.map((p) => {
              const me = p.user_id === myId;
              return (
                <li
                  key={p.user_id}
                  className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="avatar h-10 w-10 text-xs">{initials(displayName(p))}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {displayName(p)}
                      {me && (
                        <span
                          className="ml-2 rounded px-1.5 py-0.5 text-xs font-medium"
                          style={{ background: "var(--brand-tint)", color: "var(--brand-deep)" }}
                        >
                          You
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
                      {p.email ? `${p.email} - ` : ""}joined {formatTimestamp(p.created_at)}
                    </p>
                  </div>

                  {isAdmin && !me ? (
                    <div className="flex items-center gap-3">
                      <label className="sr-only" htmlFor={`role-${p.user_id}`}>
                        Role for {displayName(p)}
                      </label>
                      <select
                        id={`role-${p.user_id}`}
                        className="field !w-auto !py-1.5 text-sm"
                        value={p.role}
                        onChange={(e) => changeRole(p, e.target.value)}
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="text-btn-danger" onClick={() => removePerson(p)}>
                        Remove
                      </button>
                    </div>
                  ) : (
                    <span
                      className="rounded-full border px-2.5 py-1 text-xs font-semibold"
                      style={{ borderColor: "var(--line)", color: "var(--muted)" }}
                    >
                      {roleLabel(p.role)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {isAdmin && invites.length > 0 && (
            <section className="mt-8">
              <h2 className="text-base font-bold">Pending invitations</h2>
              <ul
                className="mt-4 overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: "var(--line)" }}
              >
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  return (
                    <li
                      key={inv.id}
                      className="flex flex-wrap items-center gap-3 border-t px-4 py-3 first:border-t-0"
                      style={{ borderColor: "var(--line)" }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{inv.email}</p>
                        <p
                          className="text-xs"
                          style={{ color: expired ? "var(--danger)" : "var(--muted)" }}
                        >
                          {roleLabel(inv.role)} -{" "}
                          {expired ? "expired" : `expires ${formatTimestamp(inv.expires_at)}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        {!expired && (
                          <button type="button" className="text-btn" onClick={() => copyInvite(inv)}>
                            Copy link
                          </button>
                        )}
                        <button type="button" className="text-btn-danger" onClick={() => revoke(inv)}>
                          Revoke
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {inviting && (
        <InviteModal
          supabase={supabase}
          orgId={org.id}
          orgName={org.name}
          existingEmails={people.map((p) => (p.email ?? "").toLowerCase()).filter(Boolean)}
          onClose={() => setInviting(false)}
          onCreated={load}
        />
      )}
    </>
  );
}
