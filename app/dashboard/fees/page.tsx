"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate, messageOf, money } from "@/lib/format";
import Modal from "@/components/modal";
import { useOrg } from "../org-context";
import { useQuickAction } from "@/lib/quick-action";

type Supabase = ReturnType<typeof createClient>;
type Group = { id: string; name: string };
type Fee = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  due_date: string | null;
  charged_count: number;
  charged_total: number;
};

const FREQUENCIES = [
  { value: "one_time", label: "One time" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "termly", label: "Each term" },
  { value: "yearly", label: "Yearly" },
];
const frequencyLabel = (v: string) => FREQUENCIES.find((f) => f.value === v)?.label ?? v;

/* ------------------------------------------------------------------ */
/* Charging helpers                                                    */
/* ------------------------------------------------------------------ */

async function fetchMemberIds(
  supabase: Supabase,
  orgId: string,
  groupId: string | null
): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from("members").select("id").eq("org_id", orgId).eq("active", true);
    if (groupId) q = q.eq("group_id", groupId);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map((r) => r.id as string));
    if (!data || data.length < 1000) break;
  }
  return ids;
}

// Charges every member of the target (everyone, or one group) who doesn't
// already have this fee. The unique index on (member_id, fee_type_id) makes
// repeats harmless.
async function chargeMembers(
  supabase: Supabase,
  orgId: string,
  fee: { id: string; amount: number; due_date: string | null },
  groupId: string | null
) {
  const ids = await fetchMemberIds(supabase, orgId, groupId);
  let added = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const rows = ids.slice(i, i + 500).map((member_id) => ({
      org_id: orgId,
      member_id,
      fee_type_id: fee.id,
      amount: fee.amount,
      due_date: fee.due_date,
    }));
    const { data, error } = await supabase
      .from("charges")
      .upsert(rows, { onConflict: "member_id,fee_type_id", ignoreDuplicates: true })
      .select("id");
    if (error) throw error;
    added += data?.length ?? 0;
  }
  return { added, total: ids.length };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function TargetSelect({
  id,
  value,
  onChange,
  groups,
  allowNone,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  groups: Group[];
  allowNone: boolean;
}) {
  return (
    <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">Everyone</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          Group: {g.name}
        </option>
      ))}
      {allowNone && <option value="none">No one yet</option>}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Create fee                                                          */
/* ------------------------------------------------------------------ */

function FeeForm({
  supabase,
  orgId,
  currency,
  groups,
  onSaved,
  onClose,
}: {
  supabase: Supabase;
  orgId: string;
  currency: string;
  groups: Group[];
  onSaved: (message: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState("one_time");
  const [due, setDue] = useState("");
  const [target, setTarget] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amt = Number(amount);
    if (!(amt > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    const { data, error: insertError } = await supabase
      .from("fee_types")
      .insert({
        org_id: orgId,
        name: name.trim(),
        amount: amt,
        frequency,
        due_date: due || null,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError(messageOf(insertError));
      setSaving(false);
      return;
    }

    if (target === "none") {
      onSaved(`Created ${name.trim()}. No one has been charged yet.`);
      return;
    }

    try {
      const { added } = await chargeMembers(
        supabase,
        orgId,
        { id: data.id as string, amount: amt, due_date: due || null },
        target === "all" ? null : target
      );
      onSaved(
        added === 0
          ? `Created ${name.trim()}. There are no members to charge yet.`
          : `Created ${name.trim()} and charged ${plural(added, "member")}.`
      );
    } catch (err) {
      onSaved(
        `Created ${name.trim()}, but charging members failed: ${messageOf(err)} Use Assign to try again.`
      );
    }
  }

  return (
    <Modal title="Create a fee" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="f-name">
            Fee name
          </label>
          <input
            id="f-name"
            className="field"
            placeholder="For example Term 2 fees or October dues"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="f-amount">
              Amount ({currency})
            </label>
            <input
              id="f-amount"
              className="field"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="f-freq">
              How often
            </label>
            <select
              id="f-freq"
              className="field"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="f-due">
            Due date
          </label>
          <input
            id="f-due"
            className="field"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
            Optional.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="f-target">
            Charge to
          </label>
          <TargetSelect id="f-target" value={target} onChange={setTarget} groups={groups} allowNone />
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
            {saving ? "Creating..." : "Create fee"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Assign existing fee                                                 */
/* ------------------------------------------------------------------ */

function AssignModal({
  supabase,
  orgId,
  fee,
  groups,
  onDone,
  onClose,
}: {
  supabase: Supabase;
  orgId: string;
  fee: Fee;
  groups: Group[];
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const { added, total } = await chargeMembers(
        supabase,
        orgId,
        { id: fee.id, amount: fee.amount, due_date: fee.due_date },
        target === "all" ? null : target
      );
      const already = total - added;
      onDone(
        total === 0
          ? "There are no members in that selection."
          : `Charged ${plural(added, "member")} for ${fee.name}.` +
              (already > 0 ? ` ${plural(already, "member")} already had it.` : "")
      );
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Assign ${fee.name}`} onClose={onClose}>
      <p className="text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        Charge this fee to members who don&apos;t have it yet. Anyone already charged is skipped, so
        it&apos;s safe to run again after adding new members.
      </p>
      <div className="mt-5">
        <label className="label" htmlFor="a-target">
          Charge to
        </label>
        <TargetSelect
          id="a-target"
          value={target}
          onChange={setTarget}
          groups={groups}
          allowNone={false}
        />
      </div>

      {error && (
        <p className="msg-error mt-4" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={busy} onClick={run}>
          {busy ? "Charging..." : "Charge members"}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function FeesPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const canEdit = org.role === "admin" || org.role === "treasurer";

  const [fees, setFees] = useState<Fee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Fee | null>(null);

  useQuickAction({ create: () => canEdit && setCreating(true) });

  const load = useCallback(async () => {
    const [f, s, g] = await Promise.all([
      supabase
        .from("fee_types")
        .select("id, name, amount, frequency, due_date")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false }),
      supabase.from("fee_summaries").select("id, charged_count, charged_total").eq("org_id", org.id),
      supabase.from("groups").select("id, name").eq("org_id", org.id).order("name"),
    ]);

    if (f.error || s.error || g.error) {
      setPageError(messageOf(f.error ?? s.error ?? g.error));
      setLoading(false);
      return;
    }

    const summary = new Map<string, { count: number; total: number }>(
      (s.data ?? []).map((x) => [
        x.id as string,
        { count: Number(x.charged_count), total: Number(x.charged_total) },
      ])
    );

    setGroups((g.data ?? []).map((x) => ({ id: x.id as string, name: x.name as string })));
    setFees(
      (f.data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        amount: Number(r.amount),
        frequency: r.frequency as string,
        due_date: (r.due_date as string | null) ?? null,
        charged_count: summary.get(r.id as string)?.count ?? 0,
        charged_total: summary.get(r.id as string)?.total ?? 0,
      }))
    );
    setLoading(false);
  }, [supabase, org.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function afterSave(message: string) {
    setCreating(false);
    setAssigning(null);
    setPageError(null);
    setNotice(message);
    await load();
  }

  async function remove(fee: Fee) {
    setNotice(null);
    setPageError(null);
    if (fee.charged_count > 0) {
      setPageError(`${fee.name} has been charged to ${plural(fee.charged_count, "member")}, so it can't be deleted.`);
      return;
    }
    if (!window.confirm(`Delete ${fee.name}? This can't be undone.`)) return;
    const { error } = await supabase.from("fee_types").delete().eq("id", fee.id);
    if (error) {
      setPageError(error.message);
      return;
    }
    setNotice(`Deleted ${fee.name}.`);
    await load();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Fees</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            What {org.name} charges, and who has been charged.
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            Create fee
          </button>
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

      {loading ? (
        <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
          Loading...
        </p>
      ) : fees.length === 0 ? (
        <section className="mt-8 rounded-xl border bg-white p-8" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-lg font-bold">No fees yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Create a fee such as &ldquo;Term 2 fees&rdquo; or &ldquo;Monthly dues&rdquo;, then charge it
            to everyone or to one group. Each member&apos;s balance updates straight away.
          </p>
          {canEdit && (
            <button type="button" className="btn mt-5" onClick={() => setCreating(true)}>
              Create fee
            </button>
          )}
        </section>
      ) : (
        <div
          className="mt-6 overflow-x-auto rounded-xl border bg-white"
          style={{ borderColor: "var(--line)" }}
        >
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
              <tr>
                <th className="px-4 py-3 font-semibold">Fee</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 text-right font-semibold">Charged to</th>
                {canEdit && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {fees.map((fee) => (
                <tr key={fee.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{fee.name}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {frequencyLabel(fee.frequency)}
                    </p>
                  </td>
                  <td className="num px-4 py-3 text-right font-semibold">
                    {money(fee.amount, org.currency)}
                  </td>
                  <td className="px-4 py-3">{fee.due_date ? formatDate(fee.due_date) : "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <p className="num font-semibold">{plural(fee.charged_count, "member")}</p>
                    <p className="num text-xs" style={{ color: "var(--muted)" }}>
                      {money(fee.charged_total, org.currency)} in total
                    </p>
                  </td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button type="button" className="text-btn" onClick={() => setAssigning(fee)}>
                        Assign
                      </button>
                      <button type="button" className="text-btn-danger ml-4" onClick={() => remove(fee)}>
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <FeeForm
          supabase={supabase}
          orgId={org.id}
          currency={org.currency}
          groups={groups}
          onSaved={afterSave}
          onClose={() => setCreating(false)}
        />
      )}
      {assigning && (
        <AssignModal
          supabase={supabase}
          orgId={org.id}
          fee={assigning}
          groups={groups}
          onDone={afterSave}
          onClose={() => setAssigning(null)}
        />
      )}
    </>
  );
}
