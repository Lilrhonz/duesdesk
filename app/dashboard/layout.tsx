"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/icons";
import { OrgContext, type OrgInfo } from "./org-context";

const TA"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon, type IconName } from "@/components/icons";
import { OrgContext, type OrgInfo } from "./org-context";

const TABS: { label: string; href: string; icon: IconName }[] = [
  { label: "Home", href: "/dashboard", icon: "home" },
  { label: "Members", href: "/dashboard/members", icon: "users" },
  { label: "Fees", href: "/dashboard/fees", icon: "tag" },
  { label: "Payments", href: "/dashboard/payments", icon: "card" },
];

const REPORTS_TAB = { label: "Reports", href: "/dashboard/reports", icon: "chart" as IconName };
const TEAM_TAB = { label: "Team", href: "/dashboard/team", icon: "shield" as IconName };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [info, setInfo] = useState<OrgInfo | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data } = await supabase
        .from("org_users")
        .select("role, organizations(id, name, org_type, currency)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        router.replace("/onboarding");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = data[0] as any;
      const o = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      setInfo({
        ...o,
        role: row.role,
        email: user.email ?? "",
        userName:
          (profile?.full_name as string | undefined)?.trim() || user.email?.split("@")[0] || "there",
      });
    }
    load();
  }, [supabase, router]);

  async function logOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!info) {
    return (
      <p className="p-8 text-sm" style={{ color: "var(--muted)" }}>
        Loading your workspace...
      </p>
    );
  }

  const roleLabel = info.role.charAt(0).toUpperCase() + info.role.slice(1);
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <OrgContext.Provider value={info}>
      <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
        {/* Desktop sidebar */}
        <aside
          className="hidden flex-col border-r bg-white p-5 lg:flex"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: "var(--brand)" }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="text-lg font-bold">DuesDesk</span>
          </div>

          <div
            className="mt-8 rounded-lg p-3"
            style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
          >
            <p className="truncate text-sm font-semibold">{info.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {info.org_type} &middot; {roleLabel}
            </p>
          </div>

          <nav className="mt-6 space-y-1" aria-label="Main">
            {[...TABS, REPORTS_TAB, TEAM_TAB].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
                style={
                  isActive(item.href)
                    ? { background: "var(--brand-tint)", color: "var(--brand-deep)", fontWeight: 600 }
                    : { color: "var(--ink)" }
                }
              >
                <Icon name={item.icon} size={18} />
                {item.label === "Home" ? "Overview" : item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
              {info.email}
            </p>
            <button type="button" onClick={logOut} className="text-btn mt-1">
              Log out
            </button>
          </div>
        </aside>

        <div>
          {/* Mobile top bar */}
          <header
            className="flex items-center justify-between border-b bg-white px-5 py-3 lg:hidden"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="min-w-0 flex-1 truncate pr-3 text-sm font-semibold">{info.name}</p>
            <div className="flex shrink-0 items-center gap-4">
              <Link href="/dashboard/reports" className="text-btn">
                Reports
              </Link>
              <Link href="/dashboard/team" className="text-btn">
                Team
              </Link>
              <button type="button" onClick={logOut} className="text-btn">
                Log out
              </button>
            </div>
          </header>

          <main className="mx-auto max-w-5xl px-5 pb-28 pt-6 lg:px-10 lg:py-12">{children}</main>
        </div>

        {/* Mobile bottom tabs */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-white lg:hidden"
          style={{ borderColor: "var(--line)", paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Main"
        >
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {TABS.map((t) => {
              const active = isActive(t.href);
              return (
                <li key={t.label}>
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className="flex flex-col items-center gap-1 py-2.5 text-xs"
                    style={{
                      color: active ? "var(--brand)" : "var(--muted)",
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <Icon name={t.icon} size={22} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </OrgContext.Provider>
  );
}S: { label: string; href: string; icon: IconName }[] = [
  { label: "Home", href: "/dashboard", icon: "home" },
  { label: "Members", href: "/dashboard/members", icon: "users" },
  { label: "Fees", href: "/dashboard/fees", icon: "tag" },
  { label: "Payments", href: "/dashboard/payments", icon: "card" },
];

const REPORTS_TAB = { label: "Reports", href: "/dashboard/reports", icon: "chart" as IconName };
const TEAM_TAB = { label: "Team", href: "/dashboard/team", icon: "shield" as IconName };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [info, setInfo] = useState<OrgInfo | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }

      const { data } = await supabase
        .from("org_users")
        .select("role, organizations(id, name, org_type, currency)")
        .order("created_at", { ascending: false })
        .limit(1);

      if (!data || data.length === 0) {
        router.replace("/onboarding");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = data[0] as any;
      const o = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
      setInfo({
        ...o,
        role: row.role,
        email: user.email ?? "",
        userName:
          (profile?.full_name as string | undefined)?.trim() || user.email?.split("@")[0] || "there",
      });
    }
    load();
  }, [supabase, router]);

  async function logOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (!info) {
    return (
      <p className="p-8 text-sm" style={{ color: "var(--muted)" }}>
        Loading your workspace...
      </p>
    );
  }

  const roleLabel = info.role.charAt(0).toUpperCase() + info.role.slice(1);
  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <OrgContext.Provider value={info}>
      <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
        {/* Desktop sidebar */}
        <aside
          className="hidden flex-col border-r bg-white p-5 lg:flex"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: "var(--brand)" }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="text-lg font-bold">DuesDesk</span>
          </div>

          <div
            className="mt-8 rounded-lg p-3"
            style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
          >
            <p className="truncate text-sm font-semibold">{info.name}</p>
            <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {info.org_type} &middot; {roleLabel}
            </p>
          </div>

          <nav className="mt-6 space-y-1" aria-label="Main">
            {[...TABS, REPORTS_TAB, TEAM_TAB].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
                style={
                  isActive(item.href)
                    ? { background: "var(--brand-tint)", color: "var(--brand-deep)", fontWeight: 600 }
                    : { color: "var(--ink)" }
                }
              >
                <Icon name={item.icon} size={18} />
                {item.label === "Home" ? "Overview" : item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t pt-4" style={{ borderColor: "var(--line)" }}>
            <p className="truncate text-xs" style={{ color: "var(--muted)" }}>
              {info.email}
            </p>
            <button type="button" onClick={logOut} className="text-btn mt-1">
              Log out
            </button>
          </div>
        </aside>

        <div>
          {/* Mobile top bar */}
          <header
            className="flex items-center justify-between border-b bg-white px-5 py-3 lg:hidden"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="min-w-0 flex-1 truncate pr-3 text-sm font-semibold">{info.name}</p>
            <div className="flex shrink-0 items-center gap-4">
              <Link href="/dashboard/reports" className="text-btn">
                Reports
              </Link>
              <Link href="/dashboard/team" className="text-btn">
                Team
              </Link>
              <button type="button" onClick={logOut} className="text-btn">
                Log out
              </button>
            </div>
          </header>

          <main className="mx-auto max-w-5xl px-5 pb-28 pt-6 lg:px-10 lg:py-12">{children}</main>
        </div>

        {/* Mobile bottom tabs */}
        <nav
          className="fixed inset-x-0 bottom-0 z-40 border-t bg-white lg:hidden"
          style={{ borderColor: "var(--line)", paddingBottom: "env(safe-area-inset-bottom)" }}
          aria-label="Main"
        >
          <ul className="mx-auto grid max-w-md grid-cols-4">
            {TABS.map((t) => {
              const active = isActive(t.href);
              return (
                <li key={t.label}>
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className="flex flex-col items-center gap-1 py-2.5 text-xs"
                    style={{
                      color: active ? "var(--brand)" : "var(--muted)",
                      fontWeight: active ? 600 : 500,
                    }}
                  >
                    <Icon name={t.icon} size={22} />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </OrgContext.Provider>
  );
}
