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

function shareMessage(orgName: string, role: string, email: string, link: string) {
  return `You've been invited to join ${orgName} on DuesDesk as ${roleLabel(role)}. Open this link, then log in or sign up with ${email}: ${link}`;
}
const whatsappHref = (message: string) => `https://wa.me/?text=${encodeURIComponent(message)}`;
const mailHref = (email: string, orgName: string, message: string) =>
  `mailto:${email}?subject=${encodeURIComponent(`Invitation to join ${orgName} on DuesDesk`)}&body=${encodeURIComponent(message)}`;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_AT_ONCE = 50;

/* ------------------------------------------------------------------ */
/* Share buttons (Copy, WhatsApp, Email)                               */
/* ------------------------------------------------------------------ */

function ShareActions({
  email,
  token,
  role,
  orgName,
  onCopied,
}: {
  email: string;
  token: string;
  role: string;
  orgName: string;
  onCopied?: (ok: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = linkFor(token);
  const message = shareMessage(orgName, role, email, link);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <button
        type="button"
        className="text-btn"
        onClick={async () => {
          const ok = await copyText(link);
          setCopied(ok);
          onCopied?.(ok);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
      <a className="text-btn" href={whatsappHref(message)} target="_blank" rel="noopener noreferrer">
        WhatsApp
      </a>
      <a className="text-btn" href={mailHref(email, orgName, message)}>
        Email
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Invite modal (one or many people)                                   */
/* ------------------------------------------------------------------ */

type Created = { email: string; token: string };
type Skipped = { email: string; reason: string };

function InviteModal({
  supabase,
  orgId,
  orgName,
  existingEmails,
  pendingEmails,
  onClose,
  onCreated,
}: {
  supabase: Supabase;
  orgId: string;
  orgName: string;
  existingEmails: string[];
  pendingEmails: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [role, setRole] = useState("viewer");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<Created[] | null>(null);
  const [skipped, setSkipped] = useState<Skipped[]>([]);
  const [usedRole, setUsedRole] = useState("viewer");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const raw = Array.from(new Set(text.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
    if (raw.length === 0) {
      setError("Enter at least one email address.");
      return;
    }
    if (raw.length > MAX_AT_ONCE) {
      setError(`Please invite at most ${MAX_AT_ONCE} people at a time.`);
      return;
    }

    const toCreate: string[] = [];
    const skippedList: Skipped[] = [];
    for (const email of raw) {
      if (!EMAIL_PATTERN.test(email)) skippedList.push({ email, reason: "isn't a valid email address" });
      else if (existingEmails.includes(email)) skippedList.push({ email, reason: "is already on the team" });
      else if (pendingEmails.includes(email)) skippedList.push({ email, reason: "already has a pending invitation" });
      else toCreate.push(email);
    }

    if (toCreate.length === 0) {
      setError(skippedList.map((s) => `${s.email} ${s.reason}.`).join(" "));
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("invitations")
      .insert(toCreate.map((email) => ({ org_id: orgId, email, role, invited_by: user?.id ?? null })))
      .select("email, token");

    if (insertError || !data) {
      setError(
        insertError?.code === "23505"
          ? "One of these people already has a pending invitation. Refresh the page and try again."
          : messageOf(insertError)
      );
      setSaving(false);
      return;
    }

    setCreated(data.map((r) => ({ email: r.email as string, token: r.token as string })));
    setSkipped(skippedList);
    setUsedRole(role);
    setSaving(false);
    onCreated();
  }

  if (created) {
    return (
      <Modal title={created.length === 1 ? "Invitation ready" : `${created.length} invitations ready`} onClose={onClose} wide>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
          Send each person their own link. It only works for their email address and expires in 7 days.
        </p>

        <ul className="mt-4 overflow-hidden rounded-xl border" style={{ borderColor: "var(--line)" }}>
          {created.map((c) => (
            <li
              key={c.token}
              className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 first:border-t-0"
              style={{ borderColor: "var(--line)" }}
            >
              <span className="min-w-0 truncate text-sm font-semibold">{c.email}</span>
              <ShareActions email={c.email} token={c.token} role={usedRole} orgName={orgName} />
            </li>
          ))}
        </ul>

        {skipped.length > 0 && (
          <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Skipped: {skipped.map((s) => `${s.email} ${s.reason}`).join("; ")}.
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const hint = ROLES.find((r) => r.value === role)?.hint;

  return (
    <Modal title={`Invite people to ${orgName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="i-emails">
            Email addresses
          </label>
          <textarea
            id="i-emails"
            className="field"
            rows={4}
            placeholder={"name@example.com\nanother@example.com"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
            autoFocus
          />
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
            One per line, or separated by commas. Up to {MAX_AT_ONCE} at once, all with the same role.
          </p>
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
            {saving ? "Creating..." : "Create invitations"}
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
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {!expired && (
                          <ShareActions
                            email={inv.email}
                            token={inv.token}
                            role={inv.role}
                            orgName={org.name}
                          />
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
          pendingEmails={invites.map((i) => i.email.toLowerCase())}
          onClose={() => setInviting(false)}
          onCreated={load}
        />
      )}
    </>
  );
}
