"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, fileSlug } from "@/lib/csv-export";
import { formatTimestamp, messageOf, money, receiptLabel, todayLocal } from "@/lib/format";
import { useOrg } from "../org-context";

type Tab = "owes" | "payments";
type MemberRow = {
  id: string;
  name: string;
  group: string;
  phone: string;
  ref: string;
  charged: number;
  paid: number;
  balance: number;
};
type PayRow = {
  id: string;
  member_id: string;
  receipt_no: number;
  paid_at: string;
  method: string;
  reference: string;
  amount: number;
  voided: boolean;
};

const METHODS = [
  { value: "cash", label: "Cash" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
];
const methodLabel = (v: string) => METHODS.find((m) => m.value === v)?.label ?? v;

// Reads every row of a query, 1000 at a time.
async function fetchAll(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function localDate(iso: string) {
  const d = new Date(iso);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function Strip({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <dl
      className="mt-6 grid gap-px overflow-hidden rounded-xl border"
      style={{
        background: "var(--line)",
        borderColor: "var(--line)",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
      }}
    >
      {items.map((f) => (
        <div key={f.label} className="bg-white p-4">
          <dt className="text-xs sm:text-sm" style={{ color: "var(--muted)" }}>
            {f.label}
          </dt>
          <dd
            className="num mt-1 text-base font-bold sm:text-xl"
            style={{ color: f.tone ?? "var(--ink)" }}
          >
            {f.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function ReportsPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("owes");

  /* ---------- members + balances ---------- */
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState("all");

  useEffect(() => {
    async function load() {
      try {
        const [m, g, b] = await Promise.all([
          fetchAll((a, z) =>
            supabase
              .from("members")
              .select("id, full_name, phone, member_ref, group_id")
              .eq("org_id", org.id)
              .order("id")
              .range(a, z)
          ),
          fetchAll((a, z) =>
            supabase.from("groups").select("id, name").eq("org_id", org.id).order("id").range(a, z)
          ),
          fetchAll((a, z) =>
            supabase
              .from("member_balances")
              .select("member_id, total_charged, total_paid, balance")
              .eq("org_id", org.id)
              .order("member_id")
              .range(a, z)
          ),
        ]);
        const groupName = new Map<string, string>(g.map((x) => [x.id as string, x.name as string]));
        const bal = new Map<string, { charged: number; paid: number; balance: number }>(
          b.map((x) => [
            x.member_id as string,
            { charged: Number(x.total_charged), paid: Number(x.total_paid), balance: Number(x.balance) },
          ])
        );
        setMembers(
          m.map((r) => {
            const v = bal.get(r.id as string);
            return {
              id: r.id as string,
              name: r.full_name as string,
              group: r.group_id ? (groupName.get(r.group_id as string) ?? "") : "",
              phone: (r.phone as string | null) ?? "",
              ref: (r.member_ref as string | null) ?? "",
              charged: v?.charged ?? 0,
              paid: v?.paid ?? 0,
              balance: v?.balance ?? 0,
            };
          })
        );
      } catch (e) {
        setError(messageOf(e));
      }
      setLoading(false);
    }
    load();
  }, [supabase, org.id]);

  const groupNames = useMemo(
    () => Array.from(new Set(members.map((m) => m.group).filter(Boolean))).sort(),
    [members]
  );

  const owing = useMemo(
    () =>
      members
        .filter((m) => m.balance > 0 && (groupFilter === "all" || m.group === groupFilter))
        .sort((a, b) => b.balance - a.balance),
    [members, groupFilter]
  );
  const totalOwed = owing.reduce((s, m) => s + m.balance, 0);

  /* ---------- payments ---------- */
  const [from, setFrom] = useState(todayLocal().slice(0, 8) + "01");
  const [to, setTo] = useState(todayLocal());
  const [method, setMethod] = useState("all");
  const [showVoided, setShowVoided] = useState(false);
  const [payments, setPayments] = useState<PayRow[]>([]);
  const [payLoading, setPayLoading] = useState(true);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    if (from > to) {
      setPayments([]);
      setPayError("The start date must be before the end date.");
      setPayLoading(false);
      return;
    }
    let cancelled = false;
    async function load() {
      setPayLoading(true);
      setPayError(null);
      try {
        const fromIso = new Date(`${from}T00:00:00`).toISOString();
        const toIso = new Date(`${to}T23:59:59.999`).toISOString();
        const rows = await fetchAll((a, z) => {
          let q = supabase
            .from("payments")
            .select("id, member_id, amount, method, reference, receipt_no, paid_at, voided_at")
            .eq("org_id", org.id)
            .gte("paid_at", fromIso)
            .lte("paid_at", toIso);
          if (method !== "all") q = q.eq("method", method);
          if (!showVoided) q = q.is("voided_at", null);
          return q.order("paid_at", { ascending: false }).order("id").range(a, z);
        });
        if (cancelled) return;
        setPayments(
          rows.map((r) => ({
            id: r.id as string,
            member_id: r.member_id as string,
            receipt_no: Number(r.receipt_no),
            paid_at: r.paid_at as string,
            method: r.method as string,
            reference: (r.reference as string | null) ?? "",
            amount: Number(r.amount),
            voided: !!r.voided_at,
          }))
        );
      } catch (e) {
        if (!cancelled) setPayError(messageOf(e));
      }
      if (!cancelled) setPayLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, org.id, from, to, method, showVoided]);

  const nameById = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const counted = payments.filter((p) => !p.voided);
  const totalReceived = counted.reduce((s, p) => s + p.amount, 0);
  const byMethod = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of counted) map.set(p.method, (map.get(p.method) ?? 0) + p.amount);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [counted]);

  /* ---------- export ---------- */
  function exportOwes() {
    downloadCsv(`${fileSlug(org.name)}-who-owes-${todayLocal()}.csv`, [
      ["Name", "Group", "Phone", "Member ID", "Charged", "Paid", "Owes"],
      ...owing.map((m) => [
        m.name,
        m.group,
        m.phone,
        m.ref,
        m.charged.toFixed(2),
        m.paid.toFixed(2),
        m.balance.toFixed(2),
      ]),
    ]);
  }

  function exportPayments() {
    downloadCsv(`${fileSlug(org.name)}-payments-${from}-to-${to}.csv`, [
      ["Receipt", "Date", "Member", "Method", "Reference", "Amount", "Status"],
      ...payments.map((p) => [
        receiptLabel(p.receipt_no),
        localDate(p.paid_at),
        nameById.get(p.member_id) ?? "",
        methodLabel(p.method),
        p.reference,
        p.amount.toFixed(2),
        p.voided ? "Voided" : "Counted",
      ]),
    ]);
  }

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className="rounded-lg px-4 py-2 text-sm"
      style={
        tab === id
          ? { background: "var(--brand-tint)", color: "var(--brand-deep)", fontWeight: 600 }
          : { color: "var(--muted)", fontWeight: 500 }
      }
    >
      {label}
    </button>
  );

  const generated = formatTimestamp(new Date().toISOString());

  return (
    <>
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        See who still owes and what has come in. Download a spreadsheet or print a copy.
      </p>

      <div className="mt-6 flex gap-2">
        {tabBtn("owes", "Who owes")}
        {tabBtn("payments", "Payments received")}
      </div>

      {error && (
        <p className="msg-error mt-5" role="alert">
          {error}
        </p>
      )}

      {/* ------------------------------ Who owes ------------------------------ */}
      {tab === "owes" && (
        <section>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <label className="label" htmlFor="group-filter">
                Group
              </label>
              <select
                id="group-filter"
                className="field !w-auto min-w-[180px]"
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
              >
                <option value="all">All groups</option>
                {groupNames.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline" onClick={() => window.print()} disabled={loading}>
                Print or save as PDF
              </button>
              <button type="button" className="btn" onClick={exportOwes} disabled={loading || owing.length === 0}>
                Download CSV
              </button>
            </div>
          </div>

          {loading ? (
            <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
              Loading...
            </p>
          ) : (
            <div className="print-area">
              <div className="mt-6">
                <h2 className="text-lg font-bold">Who owes - {org.name}</h2>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {groupFilter === "all" ? "All groups" : groupFilter} - generated {generated}
                </p>
              </div>

              <Strip
                items={[
                  { label: "Members owing", value: String(owing.length) },
                  { label: "Total owed", value: money(totalOwed, org.currency), tone: "var(--amber)" },
                  {
                    label: "Average owed",
                    value: money(owing.length ? totalOwed / owing.length : 0, org.currency),
                  },
                ]}
              />

              {owing.length === 0 ? (
                <p
                  className="mt-6 rounded-xl border bg-white p-6 text-sm"
                  style={{ borderColor: "var(--line)", color: "var(--muted)" }}
                >
                  Nobody owes anything here right now.
                </p>
              ) : (
                <div
                  className="mt-6 overflow-x-auto rounded-xl border bg-white"
                  style={{ borderColor: "var(--line)" }}
                >
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                      <tr>
                        <th className="px-4 py-3 font-semibold">Name</th>
                        <th className="px-4 py-3 font-semibold">Group</th>
                        <th className="px-4 py-3 font-semibold">Phone</th>
                        <th className="px-4 py-3 text-right font-semibold">Charged</th>
                        <th className="px-4 py-3 text-right font-semibold">Paid</th>
                        <th className="px-4 py-3 text-right font-semibold">Owes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {owing.map((m) => (
                        <tr key={m.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                          <td className="px-4 py-3 font-semibold">{m.name}</td>
                          <td className="px-4 py-3">{m.group || "-"}</td>
                          <td className="num px-4 py-3">{m.phone || "-"}</td>
                          <td className="num px-4 py-3 text-right">{money(m.charged, org.currency)}</td>
                          <td className="num px-4 py-3 text-right">{money(m.paid, org.currency)}</td>
                          <td
                            className="num px-4 py-3 text-right font-bold"
                            style={{ color: "var(--amber)" }}
                          >
                            {money(m.balance, org.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* --------------------------- Payments received --------------------------- */}
      {tab === "payments" && (
        <section>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label" htmlFor="r-from">
                  From
                </label>
                <input
                  id="r-from"
                  className="field !w-auto"
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="r-to">
                  To
                </label>
                <input
                  id="r-to"
                  className="field !w-auto"
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="r-method">
                  Method
                </label>
                <select
                  id="r-method"
                  className="field !w-auto"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="all">All methods</option>
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn-outline" onClick={() => window.print()} disabled={payLoading}>
                Print or save as PDF
              </button>
              <button
                type="button"
                className="btn"
                onClick={exportPayments}
                disabled={payLoading || payments.length === 0}
              >
                Download CSV
              </button>
            </div>
          </div>

          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
            Also list voided payments (they are never counted in the totals)
          </label>

          {payError && (
            <p className="msg-error mt-5" role="alert">
              {payError}
            </p>
          )}

          {payLoading ? (
            <p className="mt-8 text-sm" style={{ color: "var(--muted)" }}>
              Loading...
            </p>
          ) : (
            !payError && (
              <div className="print-area">
                <div className="mt-6">
                  <h2 className="text-lg font-bold">Payments received - {org.name}</h2>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {formatTimestamp(`${from}T12:00:00`)} to {formatTimestamp(`${to}T12:00:00`)}
                    {method !== "all" ? ` - ${methodLabel(method)} only` : ""} - generated {generated}
                  </p>
                </div>

                <Strip
                  items={[
                    { label: "Total received", value: money(totalReceived, org.currency), tone: "var(--ok)" },
                    { label: "Payments", value: String(counted.length) },
                    {
                      label: "Average payment",
                      value: money(counted.length ? totalReceived / counted.length : 0, org.currency),
                    },
                  ]}
                />

                {byMethod.length > 0 && (
                  <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {byMethod.map(([m, total]) => (
                      <li key={m}>
                        <span style={{ color: "var(--muted)" }}>{methodLabel(m)}: </span>
                        <span className="num font-semibold">{money(total, org.currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {payments.length === 0 ? (
                  <p
                    className="mt-6 rounded-xl border bg-white p-6 text-sm"
                    style={{ borderColor: "var(--line)", color: "var(--muted)" }}
                  >
                    No payments were recorded in this period.
                  </p>
                ) : (
                  <div
                    className="mt-6 overflow-x-auto rounded-xl border bg-white"
                    style={{ borderColor: "var(--line)" }}
                  >
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead style={{ color: "var(--muted)", borderBottom: "1px solid var(--line)" }}>
                        <tr>
                          <th className="px-4 py-3 font-semibold">Receipt</th>
                          <th className="px-4 py-3 font-semibold">Date</th>
                          <th className="px-4 py-3 font-semibold">Member</th>
                          <th className="px-4 py-3 font-semibold">Method</th>
                          <th className="px-4 py-3 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.map((p) => (
                          <tr key={p.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                            <td className="num px-4 py-3 font-semibold">No. {receiptLabel(p.receipt_no)}</td>
                            <td className="px-4 py-3">{formatTimestamp(p.paid_at)}</td>
                            <td className="px-4 py-3">{nameById.get(p.member_id) ?? "-"}</td>
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
                              style={
                                p.voided
                                  ? { color: "var(--muted)", textDecoration: "line-through" }
                                  : undefined
                              }
                            >
                              {money(p.amount, org.currency)}
                              {p.voided && (
                                <p
                                  className="text-xs font-normal"
                                  style={{ color: "var(--danger)", textDecoration: "none" }}
                                >
                                  Voided
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          )}
        </section>
      )}
    </>
  );
}
