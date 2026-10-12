"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/icons";
import {
  formatTimestamp,
  initials,
  money,
  receiptLabel,
  shortName,
  splitMoney,
} from "@/lib/format";
import { useOrg } from "./org-context";

type Supabase = ReturnType<typeof createClient>;
type Stats = { members: number; charged: number; paid: number; outstanding: number };
type Owing = { id: string; name: string; balance: number };
type Recent = { id: string; receipt_no: number; name: string; amount: number; paid_at: string };

const SERVICES: {
  label: string;
  icon: IconName;
  href?: string;
  edit?: boolean;
  admin?: boolean;
  soon?: boolean;
}[] = [
  { label: "Record payment", icon: "card", href: "/dashboard/payments?action=record", edit: true },
  { label: "Add member", icon: "userPlus", href: "/dashboard/members?action=add", edit: true },
  { label: "Create fee", icon: "tag", href: "/dashboard/fees?action=create", edit: true },
  { label: "Import CSV", icon: "upload", href: "/dashboard/members?action=import", edit: true },
  { label: "Receipts", icon: "receipt", href: "/dashboard/payments" },
  { label: "Members", icon: "users", href: "/dashboard/members" },
  { label: "Reports", icon: "chart", soon: true },
  { label: "Invite staff", icon: "plusCircle", href: "/dashboard/team?action=invite", admin: true },
];

async function fetchBalances(supabase: Supabase, orgId: string) {
  const rows: { member_id: string; full_name: string; total_charged: number; total_paid: number; balance: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("member_balances")
      .select("member_id, full_name, total_charged, total_paid, balance")
      .eq("org_id", orgId)
      .order("member_id")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      rows.push({
        member_id: r.member_id as string,
        full_name: r.full_name as string,
        total_charged: Number(r.total_charged),
        total_paid: Number(r.total_paid),
        balance: Number(r.balance),
      });
    }
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export default function OverviewPage() {
  const org = useOrg();
  const supabase = useMemo(() => createClient(), []);
  const canEdit = org.role === "admin" || org.role === "treasurer";

  const [stats, setStats] = useState<Stats | null>(null);
  const [owing, setOwing] = useState<Owing[]>([]);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const rows = await fetchBalances(supabase, org.id);
        const charged = rows.reduce((s, r) => s + r.total_charged, 0);
        const paid = rows.reduce((s, r) => s + r.total_paid, 0);
        setStats({ members: rows.length, charged, paid, outstanding: charged - paid });
        setOwing(
          rows
            .filter((r) => r.balance > 0)
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 6)
            .map((r) => ({ id: r.member_id, name: r.full_name, balance: r.balance }))
        );

        const { data: pays } = await supabase
          .from("payments")
          .select("id, member_id, amount, paid_at, receipt_no")
          .eq("org_id", org.id)
          .is("voided_at", null)
          .order("receipt_no", { ascending: false })
          .limit(5);

        const names = new Map<string, string>(rows.map((r) => [r.member_id, r.full_name]));
        setRecent(
          (pays ?? []).map((p) => ({
            id: p.id as string,
            receipt_no: Number(p.receipt_no),
            name: names.get(p.member_id as string) ?? "Member",
            amount: Number(p.amount),
            paid_at: p.paid_at as string,
          }))
        );
      } catch {
        setStats({ members: 0, charged: 0, paid: 0, outstanding: 0 });
      }
    }
    load();
  }, [supabase, org.id]);

  const firstName = org.userName.split(/\s+/)[0];
  const outstanding = splitMoney(stats?.outstanding ?? 0);
  const isAdmin = org.role === "admin";
  const services = SERVICES.filter((s) => (canEdit || !s.edit) && (isAdmin || !s.admin));

  return (
    <>
      {/* Greeting */}
      <div className="flex items-center gap-3">
        <span className="avatar h-11 w-11 text-sm">{initials(org.userName)}</span>
        <div className="min-w-0">
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Hello,
          </p>
          <h1 className="truncate text-lg font-bold leading-tight">{firstName}</h1>
        </div>
      </div>

      {/* Hero card */}
      <section className="hero mt-6 p-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-12 h-52 w-52 rounded-full"
          style={{ background: "rgba(255,255,255,0.08)" }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-2 top-20 h-32 w-32 rounded-full"
          style={{ background: "rgba(255,255,255,0.06)" }}
        />

        <div className="relative">
          <div className="flex items-center gap-2 text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>
            <span>Outstanding balance</span>
            <button
              type="button"
              onClick={() => setHidden(!hidden)}
              aria-label={hidden ? "Show amounts" : "Hide amounts"}
              className="rounded p-1"
            >
              <Icon name={hidden ? "eyeOff" : "eye"} size={18} />
            </button>
          </div>

          <p className="num mt-2 flex items-baseline gap-1.5">
            <span className="text-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
              {org.currency}
            </span>
            {hidden || !stats ? (
              <span className="text-4xl font-bold tracking-wider">{stats ? "******" : "-"}</span>
            ) : (
              <>
                <span className="text-4xl font-bold">
                  {outstanding.sign}
                  {outstanding.whole}
                </span>
                <span className="text-xl font-semibold" style={{ color: "rgba(255,255,255,0.8)" }}>
                  .{outstanding.cents}
                </span>
              </>
            )}
          </p>

          <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
            {org.name}
          </p>

          <dl
            className="mt-6 grid grid-cols-3 gap-4 border-t pt-4 text-sm"
            style={{ borderColor: "rgba(255,255,255,0.18)" }}
          >
            <div>
              <dt style={{ color: "rgba(255,255,255,0.7)" }}>Collected</dt>
              <dd className="num mt-0.5 font-semibold">
                {hidden || !stats ? "****" : money(stats.paid, org.currency)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "rgba(255,255,255,0.7)" }}>Charged</dt>
              <dd className="num mt-0.5 font-semibold">
                {hidden || !stats ? "****" : money(stats.charged, org.currency)}
              </dd>
            </div>
            <div>
              <dt style={{ color: "rgba(255,255,255,0.7)" }}>Members</dt>
              <dd className="num mt-0.5 font-semibold">{stats ? stats.members : "-"}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Top services */}
      <section className="mt-8">
        <h2 className="text-base font-bold">Top services</h2>
        <ul className="mt-4 grid grid-cols-4 gap-x-3 gap-y-5 sm:grid-cols-8">
          {services.map((s) => {
            const inner = (
              <>
                <span className="tile-box" style={s.soon ? { color: "var(--muted)", opacity: 0.7 } : undefined}>
                  <Icon name={s.icon} size={26} />
                </span>
                <span
                  className="mt-2 block text-center text-xs font-medium leading-tight"
                  style={{ color: s.soon ? "var(--muted)" : "var(--ink)" }}
                >
                  {s.label}
                  {s.soon && (
                    <span className="mt-0.5 block text-[10px]" style={{ color: "var(--muted)" }}>
                      Soon
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={s.label}>
                {s.href ? (
                  <Link href={s.href} className="block">
                    {inner}
                  </Link>
                ) : (
                  <div aria-disabled="true">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Empty state */}
      {stats && stats.members === 0 && (
        <section className="mt-8 rounded-2xl border bg-white p-6" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-lg font-bold">Add your first members</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            Members are the people who pay dues or fees to {org.name}. Add them one by one, or import
            a whole list from a spreadsheet.
          </p>
          {canEdit && (
            <Link href="/dashboard/members?action=add" className="btn mt-5 inline-block">
              Add a member
            </Link>
          )}
        </section>
      )}

      {/* Still owing */}
      {owing.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold">
              Still owing <span className="font-normal" style={{ color: "var(--muted)" }}>- biggest balances</span>
            </h2>
          </div>
          <ul className="-mx-5 mt-4 flex gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:px-0">
            {owing.map((m) => (
              <li key={m.id} className="shrink-0">
                <Link
                  href={canEdit ? `/dashboard/payments?action=record&member=${m.id}` : "/dashboard/members"}
                  className="block w-36 rounded-2xl border bg-white p-3"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="avatar h-11 w-11 text-sm">{initials(m.name)}</span>
                  <p className="mt-3 truncate text-sm font-semibold">{shortName(m.name)}</p>
                  <p className="num mt-0.5 truncate text-xs font-semibold" style={{ color: "var(--amber)" }}>
                    {money(m.balance, org.currency)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent payments */}
      {recent.length > 0 && (
        <section className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold">Recent payments</h2>
            <Link href="/dashboard/payments" className="text-btn">
              See all
            </Link>
          </div>
          <ul
            className="mt-4 overflow-hidden rounded-2xl border bg-white"
            style={{ borderColor: "var(--line)" }}
          >
            {recent.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 border-t px-4 py-3 first:border-t-0"
                style={{ borderColor: "var(--line)" }}
              >
                <span className="avatar h-10 w-10 text-xs">{initials(p.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="num text-xs" style={{ color: "var(--muted)" }}>
                    No. {receiptLabel(p.receipt_no)} &middot; {formatTimestamp(p.paid_at)}
                  </p>
                </div>
                <p className="num text-sm font-bold" style={{ color: "var(--ok)" }}>
                  +{money(p.amount, org.currency)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
