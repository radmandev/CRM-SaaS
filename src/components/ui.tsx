import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
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

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
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
    <form action={action} method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
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
