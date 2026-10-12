"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  formatTimestamp,
  messageOf,
  money,
  receiptLabel,
  todayLocal,
} from "@/lib/format";
import Modal from "@/components/modal";
import { useOrg } from "../org-context";
import { useQuickAction } from "@/lib/quick-action";

type Supabase = ReturnType<typeof createClient>;

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];
const methodLabel = (v: string) => METHODS.find((m) => m.value === v)?.label ?? v;

type MemberOpt = { id: string; name: string; group: string | null; ref: string | null; balance: number };
type Payment = {
  id: string;
  member_id: string;
  charge_id: string | null;
  amount: number;
  method: string;
  reference: string | null;
  receipt_no: number;
  paid_at: string;
  voided_at: string | null;
  void_reason: string | null;
};
type ReceiptData = {
  receipt_no: number;
  member_name: string;
  fee_name: string | null;
  amount: number;
  method: string;
  reference: string | null;
  paid_at: string;
  balance: number;
  voided: boolean;
};

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/* Member picker                                                       */
/* ------------------------------------------------------------------ */

function MemberPicker({
  members,
  currency,
  selected,
  onSelect,
  onClear,
}: {
  members: MemberOpt[];
  currency: string;
  selected: MemberOpt | null;
  onSelect: (m: MemberOpt) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? members.filter((m) =>
          `${m.name} ${m.group ?? ""} ${m.ref ?? ""}`.toLowerCase().includes(s)
        )
      : members;
    return list.slice(0, 6);
  }, [q, members]);

  if (selected) {
    return (
      <div
        className="flex items-center justify-between rounded-lg border px-3 py-2"
        style={{ borderColor: "var(--line)" }}
      >
        <div>
          <p className="text-sm font-semibold">{selected.name}</p>
          <p className="num text-xs" style={{ color: "var(--muted)" }}>
            {selected.group ?? "No group"} &middot; owes {money(Math.max(selected.balance, 0), currency)}
          </p>
        </div>
        <button type="button" className="text-btn" onClick={onClear}>
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        id="p-member"
        className="field"
        placeholder="Search by name, group or ID"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <ul className="mt-2 overflow-hidden rounded-lg border" style={{ borderColor: "var(--line)" }}>
        {matches.map((m) => (
          <li key={m.id} className="border-t first:border-t-0" style={{ borderColor: "var(--line)" }}>
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--paper)]"
              onClick={() => onSelect(m)}
            >
              <span>
                <span className="font-semibold">{m.name}</span>
                {m.group && (
                  <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                    {m.group}
                  </span>
                )}
              </span>
              <span
                className="num text-xs"
                style={{ color: m.balance > 0 ? "var(--amber)" : "var(--muted)" }}
              >
                {money(m.balance, currency)}
              </span>
            </button>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-3 py-3 text-sm" style={{ color: "var(--muted)" }}>
            No matching members.
          </li>
        )}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record payment                                                      */
/* ------------------------------------------------------------------ */

function RecordPayment({
  supabase,
  orgId,
  currency,
  members,
  feeNames,
  initialMemberId,
  onRecorded,
  onClose,
}: {
  supabase: Supabase;
  orgId: string;
  currency: string;
  members: MemberOpt[];
  feeNames: Map<string, string>;
  initialMemberId?: string | null;
  onRecorded: (receipt: ReceiptData) => void;
  onClose: () => void;
}) {
  const [member, setMember] = useState<MemberOpt | null>(null);
  const [charges, setCharges] = useState<{ id: string; label: string; fee_name: string }[]>([]);
  const [chargeId, setChargeId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(todayLocal());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!member) {
      setCharges([]);
      setChargeId("");
      return;
    }
    let cancelled = false;
    async function loadCharges() {
      const { data } = await supabase
        .from("charges")
        .select("id, fee_type_id, amount")
        .eq("member_id", member!.id);
      if (cancelled) return;
      setCharges(
        (data ?? []).map((c) => {
          const fee = feeNames.get(c.fee_type_id as string) ?? "Fee";
          return {
            id: c.id as string,
            fee_name: fee,
            label: `${fee} (${money(Number(c.amount), currency)})`,
          };
        })
      );
    }
    loadCharges();
    return () => {
      cancelled = true;
    };
  }, [member, supabase, feeNames, currency]);

  function pick(m: MemberOpt) {
    setMember(m);
    setAmount(m.balance > 0 ? m.balance.toFixed(2) : "");
  }

  useEffect(() => {
    if (!initialMemberId || member) return;
    const m = members.find((x) => x.id === initialMemberId);
    if (m) pick(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMemberId, members]);

  const amt = Number(amount);
  const overpay = member && amt > 0 && amt > Math.max(member.balance, 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!member) {
      setError("Choose who is paying.");
      return;
    }
    if (!(amt > 0)) {
      setError("Enter an amount greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const paidAt = new Date(`${paidOn}T12:00:00`).toISOString();
      const { data, error: insertError } = await supabase
        .from("payments")
        .insert({
          org_id: orgId,
          member_id: member.id,
          charge_id: chargeId || null,
          amount: amt,
          method,
          reference: reference.trim() || null,
          received_by: user?.id ?? null,
          paid_at: paidAt,
        })
        .select("receipt_no, paid_at")
        .single();
      if (insertError || !data) throw insertError ?? new Error("Could not record the payment.");

      const { data: bal } = await supabase
        .from("member_balances")
        .select("balance")
        .eq("member_id", member.id)
        .single();

      onRecorded({
        receipt_no: data.receipt_no as number,
        member_name: member.name,
        fee_name: charges.find((c) => c.id === chargeId)?.fee_name ?? null,
        amount: amt,
        method,
        reference: reference.trim() || null,
        paid_at: data.paid_at as string,
        balance: bal ? Number(bal.balance) : member.balance - amt,
        voided: false,
      });
    } catch (err) {
      setError(messageOf(err));
      setSaving(false);
    }
  }

  return (
    <Modal title="Record a payment" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label" htmlFor="p-member">
            Paid by
          </label>
          <MemberPicker
            members={members}
            currency={currency}
            selected={member}
            onSelect={pick}
            onClear={() => setMember(null)}
          />
        </div>

        {member && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="p-amount">
                  Amount ({currency})
                </label>
                <input
                  id="p-amount"
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
                <label className="label" htmlFor="p-date">
                  Date paid
                </label>
                <input
                  id="p-date"
                  className="field"
                  type="date"
                  value={paidOn}
                  max={todayLocal()}
                  onChange={(e) => setPaidOn(e.target.value)}
                  required
                />
              </div>
            </div>

            {overpay && (
              <p className="msg-ok" role="status">
                This is more than {member.name} owes, so they&apos;ll be left with a credit.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="p-method">
                  Payment method
                </label>
                <select
                  id="p-method"
                  className="field"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="p-ref">
                  Reference
                </label>
                <input
                  id="p-ref"
                  className="field"
                  placeholder="Transaction ID or cheque no."
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="p-charge">
                Payment for
              </label>
              <select
                id="p-charge"
                className="field"
                value={chargeId}
                onChange={(e) => setChargeId(e.target.value)}
              >
                <option value="">Any fees (general payment)</option>
                {charges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                Shown on the receipt. The member&apos;s balance drops either way.
              </p>
            </div>
          </>
        )}

        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={saving || !member}>
            {saving ? "Recording..." : "Record payment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Receipt                                                             */
/* ------------------------------------------------------------------ */

function ReceiptModal({
  data,
  orgName,
  currency,
  onClose,
}: {
  data: ReceiptData;
  orgName: string;
  currency: string;
  onClose: () => void;
}) {
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div
      className="flex items-baseline justify-between gap-4 border-b border-dashed py-2 text-sm"
      style={{ borderColor: "var(--line)" }}
    >
      <dt style={{ color: "var(--muted)" }}>{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );

  return (
    <Modal title="Receipt" onClose={onClose}>
      <div className="print-area">
        <div className="text-center">
          <p className="text-lg font-bold">{orgName}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Payment receipt
          </p>
        </div>

        <dl className="num mt-5">
          <Row label="Receipt number" value={`No. ${receiptLabel(data.receipt_no)}`} />
          <Row label="Date" value={formatTimestamp(data.paid_at)} />
          <Row label="Received from" value={data.member_name} />
          {data.fee_name && <Row label="For" value={data.fee_name} />}
          <Row label="Method" value={methodLabel(data.method)} />
          {data.reference && <Row label="Reference" value={data.reference} />}
        </dl>

        <div className="mt-5 flex items-baseline justify-between">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            Amount received
          </span>
          <span className="num text-2xl font-bold">{money(data.amount, currency)}</span>
        </div>
        <div className="mt-2 flex items-baseline justify-between text-sm">
          <span style={{ color: "var(--muted)" }}>Balance at time of printing</span>
          <span
            className="num font-semibold"
            style={{ color: data.balance > 0 ? "var(--amber)" : "var(--ok)" }}
          >
            {money(data.balance, currency)}
          </span>
        </div>

        {data.voided && (
          <p className="msg-error mt-5">This receipt has been voided and no longer counts.</p>
        )}
      </div>

      <div className="no-print mt-6 flex justify-end gap-2">
        <button type="button" className="btn-outline" onClick={onClose}>
          Close
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          Print receipt
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PaymentsPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const canRecord = org.role === "admin" || org.role === "treasurer";
  const canVoid = org.role === "admin";

  const [payments, setPayments] = useState<Payment[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [feeNames, setFeeNames] = useState<Map<string, string>>(new Map());
  const [chargeFee, setChargeFee] = useState<Map<string, string>>(new Map());
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [preselect, setPreselect] = useState<string | null>(null);

  useQuickAction({
    record: (p) => {
      if (!canRecord) return;
      setPreselect(p.get("member"));
      setRecording(true);
    },
  });

  const load = useCallback(async () => {
    const [p, m, g, b, f] = await Promise.all([
      supabase
        .from("payments")
        .select("id, member_id, charge_id, amount, method, reference, receipt_no, paid_at, voided_at, void_reason")
        .eq("org_id", org.id)
        .order("receipt_no", { ascending: false })
        .limit(limit),
      supabase.from("members").select("id, full_name, member_ref, group_id").eq("org_id", org.id).order("full_name"),
      supabase.from("groups").select("id, name").eq("org_id", org.id),
      supabase.from("member_balances").select("member_id, balance").eq("org_id", org.id),
      supabase.from("fee_types").select("id, name").eq("org_id", org.id),
    ]);

    const failure = p.error ?? m.error ?? g.error ?? b.error ?? f.error;
    if (failure) {
      setPageError(messageOf(failure));
      setLoading(false);
      return;
    }

    const groupName = new Map<string, string>((g.data ?? []).map((x) => [x.id as string, x.name as string]));
    const balance = new Map<string, number>(
      (b.data ?? []).map((x) => [x.member_id as string, Number(x.balance)])
    );
    const fees = new Map<string, string>((f.data ?? []).map((x) => [x.id as string, x.name as string]));

    const list: Payment[] = (p.data ?? []).map((r) => ({
      id: r.id as string,
      member_id: r.member_id as string,
      charge_id: (r.charge_id as string | null) ?? null,
      amount: Number(r.amount),
      method: r.method as string,
      reference: (r.reference as string | null) ?? null,
      receipt_no: Number(r.receipt_no),
      paid_at: r.paid_at as string,
      voided_at: (r.voided_at as string | null) ?? null,
      void_reason: (r.void_reason as string | null) ?? null,
    }));

    // Which fee does each payment's charge belong to?
    const chargeIds = list.map((x) => x.charge_id).filter((x): x is string => !!x);
    const chargeMap = new Map<string, string>();
    if (chargeIds.length > 0) {
      const { data: ch } = await supabase.from("charges").select("id, fee_type_id").in("id", chargeIds);
      for (const c of ch ?? []) chargeMap.set(c.id as string, c.fee_type_id as string);
    }

    setFeeNames(fees);
    setChargeFee(chargeMap);
    setMembers(
      (m.data ?? []).map((r) => ({
        id: r.id as string,
        name: r.full_name as string,
        group: r.group_id ? (groupName.get(r.group_id as string) ?? null) : null,
        ref: (r.member_ref as string | null) ?? null,
        balance: balance.get(r.id as string) ?? 0,
      }))
    );
    setPayments(list);
    setLoading(false);
  }, [supabase, org.id, limit]);

  useEffect(() => {
    load();
  }, [load]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) => {
      const name = memberById.get(p.member_id)?.name ?? "";
      return (
        name.toLowerCase().includes(q) ||
        receiptLabel(p.receipt_no).includes(q) ||
        (p.reference ?? "").toLowerCase().includes(q)
      );
    });
  }, [payments, query, memberById]);

  function receiptFor(p: Payment): ReceiptData {
    const m = memberById.get(p.member_id);
    const feeId = p.charge_id ? chargeFee.get(p.charge_id) : undefined;
    return {
      receipt_no: p.receipt_no,
      member_name: m?.name ?? "Member",
      fee_name: feeId ? (feeNames.get(feeId) ?? null) : null,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      paid_at: p.paid_at,
      balance: m?.balance ?? 0,
      voided: !!p.voided_at,
    };
  }

  async function afterRecorded(r: ReceiptData) {
    setRecording(false);
    setPageError(null);
    setNotice(`Recorded ${money(r.amount, org.currency)} from ${r.member_name}.`);
    setReceipt(r);
    await load();
  }

  async function voidPayment(p: Payment) {
    setNotice(null);
    setPageError(null);
    const reason = window.prompt(
      `Void receipt No. ${receiptLabel(p.receipt_no)}? It will stop counting toward the balance. Enter a reason:`
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setPageError("A reason is required to void a payment.");
      return;
    }
    const { error } = await supabase
      .from("payments")
      .update({ voided_at: new Date().toISOString(), void_reason: reason.trim() })
      .eq("id", p.id);
    if (error) {
      setPageError(error.message);
      return;
    }
    setNotice(`Voided receipt No. ${receiptLabel(p.receipt_no)}.`);
    await load();
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Every payment {org.name} has received, with a numbered receipt for each.
          </p>
        </div>
        {canRecord && (
          <button type="button" className="btn" onClick={() => setRecording(true)}>
            Record payment
          </button>
        )}
      </div>

      {!canRecord && (
        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          You have view-only access. Ask an admin or treasurer to record payments.
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
      ) : payments.length === 0 ? (
        <section className="mt-8 rounded-xl border bg-white p-8" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-lg font-bold">No payments yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            When someone pays, record it here. They get a numbered receipt and their balance drops
            straight away.
          </p>
          {canRecord && (
            <button type="button" className="btn mt-5" onClick={() => setRecording(true)}>
              Record payment
            </button>
          )}
        </section>
      ) : (
        <section className="mt-6">
          <label className="sr-only" htmlFor="search">
            Search payments
          </label>
          <input
            id="search"
            className="field max-w-sm"
            placeholder="Search by member, receipt number or reference"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div
            className="mt-4 overflow-x-auto rounded-xl border bg-white"
            style={{ borderColor: "var(--line)" }}
          >
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Member</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const voided = !!p.voided_at;
                  return (
                    <tr key={p.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="num px-4 py-3 font-semibold">No. {receiptLabel(p.receipt_no)}</td>
                      <td className="px-4 py-3">{formatTimestamp(p.paid_at)}</td>
                      <td className="px-4 py-3">{memberById.get(p.member_id)?.name ?? "-"}</td>
                      <td className="px-4 py-3">
                        {methodLabel(p.method)}
                        {p.reference && (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>
                            {p.reference}
                          </p>
                        )}
                      </td>
                      <td
                        className="num px-4 py-3 text-right font-semibold"
                        style={voided ? { color: "var(--muted)", textDecoration: "line-through" } : undefined}
                      >
                        {money(p.amount, org.currency)}
                        {voided && (
                          <p
                            className="text-xs font-normal"
                            style={{ color: "var(--danger)", textDecoration: "none" }}
                          >
                            Voided
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <button type="button" className="text-btn" onClick={() => setReceipt(receiptFor(p))}>
                          Receipt
                        </button>
                        {canVoid && !voided && (
                          <button type="button" className="text-btn-danger ml-4" onClick={() => voidPayment(p)}>
                            Void
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                      No payments match &ldquo;{query}&rdquo;.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {payments.length >= limit && (
            <div className="mt-4 text-center">
              <button type="button" className="btn-outline" onClick={() => setLimit(limit + PAGE_SIZE)}>
                Show more
              </button>
            </div>
          )}
        </section>
      )}

      {recording && (
        <RecordPayment
          supabase={supabase}
          orgId={org.id}
          currency={org.currency}
          members={members}
          feeNames={feeNames}
          initialMemberId={preselect}
          onRecorded={afterRecorded}
          onClose={() => setRecording(false)}
        />
      )}
      {receipt && (
        <ReceiptModal
          data={receipt}
          orgName={org.name}
          currency={org.currency}
          onClose={() => setReceipt(null)}
        />
      )}
    </>
  );
}
