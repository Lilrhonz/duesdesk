export function money(amount: number, currency: string = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(amount);
}

export function messageOf(e: unknown) {
  return (e as { message?: string } | null)?.message ?? "Something went wrong. Please try again.";
}

export function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function receiptLabel(n: number) {
  return String(n).padStart(4, "0");
}

export function splitMoney(amount: number) {
  const sign = amount < 0 ? "-" : "";
  const [whole, cents] = new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(Math.abs(amount))
    .split(".");
  return { sign, whole, cents };
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export function shortName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}
