"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icons";

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
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg/80 transition hover:bg-brand/5 hover:text-fg border-s-[3px] border-transparent aria-[current=page]:border-brand aria-[current=page]:bg-brand/10 aria-[current=page]:font-semibold aria-[current=page]:text-fg"
                >
                  <Icon name={l.icon} className="size-[18px]" />
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
