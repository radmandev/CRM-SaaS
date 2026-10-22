import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Horizontally scrollable table wrapper that keyboard users can focus and scroll (WCAG 2.1.1). */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className="overflow-x-auto rounded-lg border border-line bg-surface focus-visible:outline-2 focus-visible:outline-brand">
      {children}
    </div>
  );
}

export function EmptyState({ title, body, icon = "search" }: { title: string; body?: string; icon?: IconName }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-gradient-to-b from-brand/[0.04] to-transparent px-4 py-12 text-center">
      <span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-brand/15 to-amber-400/15 text-brand">
        <Icon name={icon} />
      </span>
      <p className="mt-4 font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>}
    </div>
  );
}

export function NoPermission({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="card text-center">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

/** Keyset pagination controls (API-05): "next" carries the cursor, "first" drops it. */
export function Pager({ basePath, nextCursor, hasCursor, params, labels }: { basePath: string; nextCursor: string | null; hasCursor: boolean; params?: Record<string, string | undefined>; labels: { first: string; next: string } }) {
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...params, ...extra }).filter(([, v]) => v) as [string, string][]);
    const s = p.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  if (!nextCursor && !hasCursor) return null;
  return (
    <nav className="mt-4 flex gap-3" aria-label="pagination">
      {hasCursor && (
        <Link className="btn-secondary" href={qs({ cursor: undefined })}>
          {labels.first}
        </Link>
      )}
      {nextCursor && (
        <Link className="btn-secondary" href={qs({ cursor: nextCursor })}>
          {labels.next}
        </Link>
      )}
    </nav>
  );
}

/** GET search form (FR-01). Works without JavaScript. */
export function SearchBox({ action, defaultValue, label, children }: { action: string; defaultValue?: string; label: string; children?: ReactNode }) {
  return (
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2 [&>select]:w-auto [&>select]:min-w-36">
      <label className="min-w-48 flex-1">
        <span className="sr-only">{label}</span>
        <input name="q" defaultValue={defaultValue} placeholder={label} className="input" maxLength={100} />
      </label>
      {children}
      <button className="btn-secondary" type="submit">
        {label}
      </button>
    </form>
  );
}

const AMBER = "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200";
const SKY = "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-200";
const GREEN = "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200";
const RED = "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200";
const GREY = "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200";
const TONE: Record<string, string> = {
  DRAFT: GREY, REQUESTED: GREY,
  ON_HOLD: AMBER, HELD: AMBER, ON_REQUEST: AMBER,
  CONFIRMED: SKY,
  ISSUED: GREEN, COMPLETED: GREEN,
  CANCELLED: RED, FAILED: RED,
};

/** UX-07: status shown as text with color, never color alone. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span className={`badge gap-1.5 ${TONE[status] ?? GREY}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

/** Money formatted in the record's currency with Western digits (LOC-06). Values arrive as decimal strings. */
export function Money({ value, currency, locale }: { value: string | number | null | undefined; currency: string; locale: "ar" | "en" }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const text = new Intl.NumberFormat(`${locale}-u-nu-latn`, { style: "currency", currency, currencyDisplay: "code" }).format(Number(value));
  return <bdi dir="ltr" className="tabular-nums">{text}</bdi>;
}
