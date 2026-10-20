import Link from "next/link";
import { prisma } from "@/server/db";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { LocaleSwitcher, SignOutButton, TenantSwitcher } from "@/components/actions";
import type { Permission } from "@/server/permissions";

const NAV: { href: string; key: string; permission?: Permission }[] = [
  { href: "/dashboard", key: "nav.dashboard" },
  { href: "/bookings", key: "nav.bookings", permission: "booking:read" },
  { href: "/customers", key: "nav.customers", permission: "customer:read" },
  { href: "/suppliers", key: "nav.suppliers", permission: "supplier:read" },
  { href: "/products", key: "nav.products" },
  { href: "/settings/agency", key: "nav.agency", permission: "tenant:settings" },
  { href: "/settings/branches", key: "nav.branches", permission: "branch:manage" },
  { href: "/settings/users", key: "nav.users", permission: "user:manage" },
  { href: "/settings/tax-rates", key: "nav.taxRates", permission: "tenant:settings" },
  { href: "/settings/currencies", key: "nav.currencies", permission: "tenant:settings" },
  { href: "/settings/numbering", key: "nav.numbering", permission: "tenant:settings" },
  { href: "/settings/audit-log", key: "nav.auditLog", permission: "audit:read" },
  { href: "/account", key: "nav.account" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const [tenant, memberships] = await Promise.all([
    ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { primaryColor: true, legalNameEn: true, legalNameAr: true } }),
    prisma.membership.findMany({ where: { userId: ctx.user.id, status: "ACTIVE" }, select: { tenantId: true, tenant: { select: { legalNameEn: true, legalNameAr: true } } } }),
  ]);
  const name = (n: { legalNameEn: string; legalNameAr: string | null }) => (locale === "ar" && n.legalNameAr) || n.legalNameEn;
  const links = NAV.filter((n) => !n.permission || can(ctx, n.permission));
  const nav = (
    <ul className="space-y-1">
      {links.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="block rounded-md px-3 py-2 text-sm hover:bg-bg">
            {t(l.key)}
          </Link>
        </li>
      ))}
    </ul>
  );
  return (
    <div style={{ "--brand": tenant.primaryColor } as React.CSSProperties} className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        {t("nav.skip")}
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
          <details className="md:hidden">
            <summary className="btn-ghost cursor-pointer list-none">☰ {t("nav.menu")}</summary>
            <nav aria-label={t("nav.menu")} className="absolute inset-x-0 top-full border-b border-line bg-surface p-3 shadow">
              {nav}
            </nav>
          </details>
          <span className="truncate font-bold">{name(tenant)}</span>
          <span className="badge shrink-0">{t(`role.${ctx.membership.role}`)}</span>
          <form action="/search" method="get" role="search" className="hidden md:block">
            <label>
              <span className="sr-only">{t("search.title")}</span>
              <input name="q" placeholder={t("search.placeholder")} className="input w-64 py-1" maxLength={100} />
            </label>
          </form>
          <div className="ms-auto flex items-center gap-1">
            <TenantSwitcher locale={locale} current={ctx.tenant.id} label={t("nav.switchAgency")} options={memberships.map((m) => ({ id: m.tenantId, name: name(m.tenant) }))} />
            <LocaleSwitcher locale={locale} loggedIn />
            <span className="hidden text-sm text-muted lg:inline">{ctx.user.name}</span>
            <SignOutButton label={t("nav.signOut")} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav aria-label={t("nav.main")} className="hidden w-56 shrink-0 md:block">
          {nav}
        </nav>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
