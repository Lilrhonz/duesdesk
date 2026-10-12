"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csv";
import { messageOf, money } from "@/lib/format";
import Modal from "@/components/modal";
import { useOrg } from "../org-context";
import { useQuickAction } from "@/lib/quick-action";

type Supabase = ReturnType<typeof createClient>;
type Group = { id: string; name: string };
type Member = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  member_ref: string | null;
  group_id: string | null;
  group_name: string | null;
  balance: number;
};
type FormState = { mode: "add" } | { mode: "edit"; member: Member } | null;

/* ------------------------------------------------------------------ */
/* Add / edit form                                                     */
/* ------------------------------------------------------------------ */

function MemberForm({
  supabase,
  orgId,
  groups,
  member,
  onSaved,
  onClose,
}: {
  supabase: Supabase;
  orgId: string;
  groups: Group[];
  member?: Member;
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [fullName, setFullName] = useState(member?.full_name ?? "");
  const [group, setGroup] = useState(member?.group_name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [ref, setRef] = useState(member?.member_ref ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function resolveGroupId(name: string): Promise<string | null> {
    const n = name.trim();
    if (!n) return null;
    const existing = groups.find((g) => g.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase
      .from("groups")
      .insert({ org_id: orgId, name: n })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const group_id = await resolveGroupId(group);
      const values = {
        full_name: fullName.trim(),
        group_id,
        phone: phone.trim() || null,
        email: email.trim() || null,
        member_ref: ref.trim() || null,
      };
      if (member) {
        const { error } = await supabase.from("members").update(values).eq("id", member.id);
        if (error) throw error;
        onSaved(`Saved changes to ${values.full_name}.`);
      } else {
        const { error } = await supabase.from("members").insert({ org_id: orgId, ...values });
        if (error) throw error;
        onSaved(`Added ${values.full_name}.`);
      }
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={member ? "Edit member" : "Add a member"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="m-name">
            Full name
          </label>
          <input
            id="m-name"
            className="field"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="m-group">
            Group
          </label>
          <input
            id="m-group"
            className="field"
            list="group-options"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="For example Class 3A or Choir"
          />
          <datalist id="group-options">
            {groups.map((g) => (
              <option key={g.id} value={g.name} />
            ))}
          </datalist>
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
            Pick an existing group or type a new one. Optional.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="m-phone">
              Phone
            </label>
            <input
              id="m-phone"
              className="field"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="m-ref">
              Member ID
            </label>
            <input
              id="m-ref"
              className="field"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="m-email">
            Email
          </label>
          <input
            id="m-email"
            className="field"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
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
            {saving ? "Saving..." : member ? "Save changes" : "Add member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

type ParsedRow = {
  full_name: string;
  group: string;
  phone: string;
  email: string;
  member_ref: string;
};

const HEADER_MAP: Record<string, keyof ParsedRow> = {
  name: "full_name",
  "full name": "full_name",
  full_name: "full_name",
  fullname: "full_name",
  member: "full_name",
  "member name": "full_name",
  "student name": "full_name",
  group: "group",
  class: "group",
  department: "group",
  branch: "group",
  phone: "phone",
  "phone number": "phone",
  telephone: "phone",
  mobile: "phone",
  contact: "phone",
  email: "email",
  "e-mail": "email",
  id: "member_ref",
  "member id": "member_ref",
  member_id: "member_ref",
  member_ref: "member_ref",
  ref: "member_ref",
  "student id": "member_ref",
  "index number": "member_ref",
};

const TEMPLATE =
  "name,group,phone,email,member_id\nGrace Mensah,Class 3A,0241234567,,S001\nKwame Boateng,Class 3B,0207654321,kwame@example.com,S002\n";

function ImportModal({
  supabase,
  orgId,
  groups,
  onDone,
  onClose,
}: {
  supabase: Supabase;
  orgId: string;
  groups: Group[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const newGroups = useMemo(() => {
    const known = new Set(groups.map((g) => g.name.toLowerCase()));
    const fresh = new Set<string>();
    for (const r of rows) {
      const key = r.group.toLowerCase();
      if (r.group && !known.has(key)) fresh.add(key);
    }
    return fresh.size;
  }, [rows, groups]);

  async function handleFile(file: File | undefined) {
    setError(null);
    setRows([]);
    setSkipped(0);
    if (!file) return;
    setFileName(file.name);

    const table = parseCsv(await file.text());
    if (table.length < 2) {
      setError("The file needs a heading row and at least one member.");
      return;
    }

    const headers = table[0].map((h) => h.trim().toLowerCase());
    const col: Partial<Record<keyof ParsedRow, number>> = {};
    headers.forEach((h, i) => {
      const key = HEADER_MAP[h];
      if (key && col[key] === undefined) col[key] = i;
    });
    if (col.full_name === undefined) {
      setError(
        "Couldn't find a name column. The first row should have headings such as name, group, phone, email."
      );
      return;
    }

    const get = (r: string[], key: keyof ParsedRow) =>
      col[key] === undefined ? "" : (r[col[key] as number] ?? "").trim();

    const parsed: ParsedRow[] = [];
    let skippedCount = 0;
    for (const r of table.slice(1)) {
      const full_name = get(r, "full_name");
      if (!full_name) {
        skippedCount++;
        continue;
      }
      parsed.push({
        full_name,
        group: get(r, "group"),
        phone: get(r, "phone"),
        email: get(r, "email"),
        member_ref: get(r, "member_ref"),
      });
    }
    setRows(parsed);
    setSkipped(skippedCount);
    if (parsed.length === 0) setError("No rows with a name were found in this file.");
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const known = new Map<string, string>(groups.map((g) => [g.name.toLowerCase(), g.id]));

      const needed = new Map<string, string>();
      for (const r of rows) {
        const key = r.group.toLowerCase();
        if (r.group && !known.has(key) && !needed.has(key)) needed.set(key, r.group);
      }
      if (needed.size > 0) {
        const { data, error } = await supabase
          .from("groups")
          .insert(Array.from(needed.values()).map((name) => ({ org_id: orgId, name })))
          .select("id, name");
        if (error) throw error;
        for (const g of data ?? []) known.set(String(g.name).toLowerCase(), g.id as string);
      }

      const payload = rows.map((r) => ({
        org_id: orgId,
        full_name: r.full_name,
        group_id: r.group ? (known.get(r.group.toLowerCase()) ?? null) : null,
        phone: r.phone || null,
        email: r.email || null,
        member_ref: r.member_ref || null,
      }));

      for (let i = 0; i < payload.length; i += 500) {
        const { error } = await supabase.from("members").insert(payload.slice(i, i + 500));
        if (error) throw error;
      }
      onDone(`Imported ${payload.length} member${payload.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Import members from CSV" onClose={onClose} wide>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Use a spreadsheet saved as CSV. The first row must have headings: <b>name</b> is required,
        and <b>group</b>, <b>phone</b>, <b>email</b> and <b>member_id</b> are optional. If you edit
        it in Excel, format the phone column as text so leading zeros are kept.
      </p>
      <a
        className="text-btn mt-2 inline-block"
        href={"data:text/csv;charset=utf-8," + encodeURIComponent(TEMPLATE)}
        download="members-template.csv"
      >
        Download a template
      </a>

      <div className="mt-5">
        <label className="label" htmlFor="csv-file">
          CSV file
        </label>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          className="field"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {error && (
        <p className="msg-error mt-4" role="alert">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold">
            {rows.length} member{rows.length === 1 ? "" : "s"} ready to import from {fileName}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {newGroups > 0
              ? `${newGroups} new group${newGroups === 1 ? "" : "s"} will be created. `
              : ""}
            {skipped > 0 ? `${skipped} row${skipped === 1 ? "" : "s"} without a name will be skipped.` : ""}
          </p>

          <div
            className="mt-3 overflow-x-auto rounded-lg border"
            style={{ borderColor: "var(--line)" }}
          >
            <table className="w-full text-left text-sm">
              <thead style={{ background: "var(--paper)", color: "var(--muted)" }}>
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Group</th>
                  <th className="px-3 py-2 font-semibold">Phone</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-2">{r.full_name}</td>
                    <td className="px-3 py-2">{r.group || "-"}</td>
                    <td className="px-3 py-2">{r.phone || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 5 && (
            <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
              Showing the first 5 of {rows.length}.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy || rows.length === 0} onClick={runImport}>
          {busy ? "Importing..." : `Import ${rows.length || ""} member${rows.length === 1 ? "" : "s"}`.trim()}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function MembersPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const canEdit = org.role === "admin" || org.role === "treasurer";

  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [importing, setImporting] = useState(false);

  useQuickAction({
    add: () => canEdit && setForm({ mode: "add" }),
    import: () => canEdit && setImporting(true),
  });

  const load = useCallback(async () => {
    const [m, g, b] = await Promise.all([
      supabase
        .from("members")
        .select("id, full_name, phone, email, member_ref, group_id")
        .eq("org_id", org.id)
        .order("full_name"),
      supabase.from("groups").select("id, name").eq("org_id", org.id).order("name"),
      supabase.from("member_balances").select("member_id, balance").eq("org_id", org.id),
    ]);

    if (m.error || g.error) {
      setPageError(messageOf(m.error ?? g.error));
      setLoading(false);
      return;
    }

    const groupList: Group[] = (g.data ?? []).map((x) => ({
      id: x.id as string,
      name: x.name as string,
    }));
    const groupName = new Map<string, string>(groupList.map((x) => [x.id, x.name]));
    const balance = new Map<string, number>(
      (b.data ?? []).map((x) => [x.member_id as string, Number(x.balance)])
    );

    setGroups(groupList);
    setMembers(
      (m.data ?? []).map((r) => ({
        id: r.id as string,
        full_name: r.full_name as string,
        phone: (r.phone as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        member_ref: (r.member_ref as string | null) ?? null,
        group_id: (r.group_id as string | null) ?? null,
        group_name: r.group_id ? (groupName.get(r.group_id as string) ?? null) : null,
        balance: balance.get(r.id as string) ?? 0,
      }))
    );
    setLoading(false);
  }, [supabase, org.id]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      [m.full_name, m.group_name, m.phone, m.member_ref, m.email].some((v) =>
        (v ?? "").toLowerCase().includes(q)
      )
    );
  }, [members, query]);

  async function afterSave(message: string) {
    setForm(null);
    setImporting(false);
    setPageError(null);
    setNotice(message);
    await load();
  }

  async function remove(m: Member) {
    setNotice(null);
    setPageError(null);

    const { count, error: countError } = await supabase
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("member_id", m.id);
    if (countError) {
      setPageError(countError.message);
      return;
    }
    if ((count ?? 0) > 0) {
      setPageError(`${m.full_name} has recorded payments, so they can't be deleted.`);
      return;
    }
    if (!window.confirm(`Delete ${m.full_name}? This can't be undone.`)) return;

    const { error } = await supabase.from("members").delete().eq("id", m.id);
    if (error) {
      setPageError(error.message);
      return;
    }
    setNotice(`Deleted ${m.full_name}.`);
    await load();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Members</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            {loading
              ? "Loading..."
              : `${members.length} ${members.length === 1 ? "person pays" : "people pay"} dues or fees to ${org.name}.`}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button type="button" className="btn-outline" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button type="button" className="btn" onClick={() => setForm({ mode: "add" })}>
              Add member
            </button>
          </div>
        )}
      </div>

      {!canEdit && (
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          You have view-only access. Ask an admin or treasurer to make changes.
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

      {!loading && members.length === 0 ? (
        <section className="mt-8 rounded-xl border bg-white p-8" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-lg font-bold">No members yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Add your first member, or import everyone at once from a CSV file exported from Excel or
            Google Sheets.
          </p>
          {canEdit && (
            <div className="mt-5 flex gap-2">
              <button type="button" className="btn" onClick={() => setForm({ mode: "add" })}>
                Add member
              </button>
              <button type="button" className="btn-outline" onClick={() => setImporting(true)}>
                Import CSV
              </button>
            </div>
          )}
        </section>
      ) : (
        !loading && (
          <section className="mt-6">
            <label className="sr-only" htmlFor="search">
              Search members
            </label>
            <input
              id="search"
              className="field max-w-sm"
              placeholder="Search by name, group or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div
              className="mt-4 overflow-x-auto rounded-xl border bg-white"
              style={{ borderColor: "var(--line)" }}
            >
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Group</th>
                    <th className="px-4 py-3 font-semibold">Phone</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    {canEdit && <th className="px-4 py-3" />}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr key={m.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{m.full_name}</p>
                        {m.member_ref && (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            ID {m.member_ref}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">{m.group_name ?? "-"}</td>
                      <td className="num px-4 py-3">{m.phone ?? "-"}</td>
                      <td
                        className="num px-4 py-3 text-right font-semibold"
                        style={{ color: m.balance > 0 ? "var(--amber)" : "var(--ink)" }}
                      >
                        {money(m.balance, org.currency)}
                      </td>
                      {canEdit && (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            className="text-btn"
                            onClick={() => setForm({ mode: "edit", member: m })}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="text-btn-danger ml-4"
                            onClick={() => remove(m)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={canEdit ? 5 : 4}
                        className="px-4 py-8 text-center"
                        style={{ color: "var(--muted)" }}
                      >
                        No members match &ldquo;{query}&rdquo;.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      {form && (
        <MemberForm
          supabase={supabase}
          orgId={org.id}
          groups={groups}
          member={form.mode === "edit" ? form.member : undefined}
          onSaved={afterSave}
          onClose={() => setForm(null)}
        />
      )}
      {importing && (
        <ImportModal
          supabase={supabase}
          orgId={org.id}
          groups={groups}
          onDone={afterSave}
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
}
