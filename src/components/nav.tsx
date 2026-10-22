"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

// One hue per area so sections are recognisable at a glance (decorative; the label carries the meaning).
const TONE: Partial<Record<IconName, string>> = {
  dashboard: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
  bookings: "bg-sky-500/12 text-sky-600 dark:text-sky-300",
  quotations: "bg-violet-500/12 text-violet-600 dark:text-violet-300",
  customers: "bg-pink-500/12 text-pink-600 dark:text-pink-300",
  suppliers: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  products: "bg-teal-500/12 text-teal-600 dark:text-teal-300",
  invoices: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  payments: "bg-green-500/12 text-green-600 dark:text-green-300",
  refunds: "bg-rose-500/12 text-rose-600 dark:text-rose-300",
  bills: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  supplierPayments: "bg-orange-500/12 text-orange-600 dark:text-orange-300",
  expenses: "bg-red-500/12 text-red-600 dark:text-red-300",
  accounts: "bg-cyan-500/12 text-cyan-600 dark:text-cyan-300",
  reports: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-300",
};
const DEFAULT_TONE = "bg-slate-500/12 text-slate-600 dark:text-slate-300";

export type NavGroup = { label: string; items: { href: string; label: string; icon: IconName }[] };

/** Sidebar links, grouped, with the current section marked for sighted and screen-reader users. */
export function NavLinks({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-3 text-xs font-semibold text-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.items.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active(l.href) ? "page" : undefined}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm text-fg/80 transition hover:bg-brand/5 hover:text-fg aria-[current=page]:bg-brand/10 aria-[current=page]:font-semibold aria-[current=page]:text-fg"
                >
                  <span aria-hidden="true" className={`grid size-7 place-items-center rounded-lg ${TONE[l.icon] ?? DEFAULT_TONE}`}>
                    <Icon name={l.icon} className="size-4" />
                  </span>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
