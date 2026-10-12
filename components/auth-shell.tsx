import type { ReactNode } from "react";

function Mark({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg"
      style={{ background: onDark ? "#fff" : "var(--brand)" }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={onDark ? "#08403f" : "#fff"}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

function SampleReceipt() {
  const muted = { color: "var(--muted)" };
  return (
    <div
      className="mt-10 w-full max-w-xs rounded-lg bg-white p-5 shadow-xl"
      style={{ color: "var(--ink)", transform: "rotate(-1.5deg)" }}
      aria-hidden="true"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">Receipt</span>
        <span className="num text-sm" style={muted}>
          No. 0042
        </span>
      </div>
      <p className="mt-4 text-sm" style={muted}>
        Received from
      </p>
      <p className="font-semibold">Grace Mensah</p>
      <p className="mt-3 text-sm" style={muted}>
        Term 2 fees
      </p>
      <div className="my-4 border-t border-dashed" style={{ borderColor: "var(--line)" }} />
      <div className="flex items-baseline justify-between">
        <span className="text-sm" style={muted}>
          Paid by mobile money
        </span>
        <span className="num text-xl font-bold">GH₵ 350.00</span>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span style={muted}>Balance</span>
        <span className="num font-semibold" style={{ color: "var(--ok)" }}>
          GH₵ 0.00
        </span>
      </div>
    </div>
  );
}

export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <section
        className="hidden flex-col justify-between p-12 text-white lg:flex"
        style={{ background: "var(--brand-deep)" }}
      >
        <div className="flex items-center gap-2.5">
          <Mark onDark />
          <span className="text-lg font-bold">DuesDesk</span>
        </div>

        <div>
          <h2 className="max-w-md text-4xl font-bold leading-tight">
            Know who has paid, without the notebook.
          </h2>
          <p className="mt-4 max-w-sm leading-relaxed text-white/75">
            Record dues, fees and contributions, issue numbered receipts, and see every
            balance in one place.
          </p>
          <SampleReceipt />
        </div>

        <p className="text-sm text-white/60">
          Built for schools, churches, associations and clubs.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <Mark />
            <span className="text-lg font-bold">DuesDesk</span>
          </div>

          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
            {subtitle}
          </p>

          <div className="mt-8">{children}</div>

          {footer && (
            <div className="mt-6 text-sm" style={{ color: "var(--muted)" }}>
              {footer}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
