import { prisma } from "@/server/db";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { LocaleSwitcher, SignOutButton, TenantSwitcher } from "@/components/actions";
import type { Permission } from "@/server/permissions";
import { Icon, type IconName } from "@/components/icons";
import { NavLinks } from "@/components/nav";

type Item = { href: string; key: string; icon: IconName; permission?: Permission };
const NAV: { group: string; items: Item[] }[] = [
  {
    group: "nav.group.work",
    items: [
      { href: "/dashboard", key: "nav.dashboard", icon: "dashboard" },
      { href: "/bookings", key: "nav.bookings", icon: "bookings", permission: "booking:read" },
      { href: "/quotations", key: "nav.quotations", icon: "quotations", permission: "quotation:read" },
      { href: "/customers", key: "nav.customers", icon: "customers", permission: "customer:read" },
      { href: "/suppliers", key: "nav.suppliers", icon: "suppliers", permission: "supplier:read" },
      { href: "/products", key: "nav.products", icon: "products" },
    ],
  },
  {
    group: "nav.group.finance",
    items: [
      { href: "/invoices", key: "nav.invoices", icon: "invoices", permission: "invoice:read" },
      { href: "/payments", key: "nav.payments", icon: "payments", permission: "invoice:read" },
      { href: "/refunds", key: "nav.refunds", icon: "refunds", permission: "refund:request" },
      { href: "/supplier-bills", key: "nav.supplierBills", icon: "bills", permission: "supplier:read" },
      { href: "/supplier-payments", key: "nav.supplierPayments", icon: "supplierPayments", permission: "supplierpayment:write" },
      { href: "/expenses", key: "nav.expenses", icon: "expenses", permission: "expense:write" },
      { href: "/finance/accounts", key: "nav.accounts", icon: "accounts", permission: "report:financial" },
      { href: "/reports", key: "nav.reports", icon: "reports", permission: "report:financial" },
    ],
  },
  {
    group: "nav.group.settings",
    items: [
      { href: "/settings/agency", key: "nav.agency", icon: "settings", permission: "tenant:settings" },
      { href: "/settings/branches", key: "nav.branches", icon: "branches", permission: "branch:manage" },
      { href: "/settings/users", key: "nav.users", icon: "users", permission: "user:manage" },
      { href: "/settings/tax-rates", key: "nav.taxRates", icon: "tax", permission: "tenant:settings" },
      { href: "/settings/currencies", key: "nav.currencies", icon: "currencies", permission: "tenant:settings" },
      { href: "/settings/numbering", key: "nav.numbering", icon: "numbering", permission: "tenant:settings" },
      { href: "/settings/finance", key: "nav.financeSettings", icon: "expenses", permission: "tenant:settings" },
      { href: "/settings/audit-log", key: "nav.auditLog", icon: "audit", permission: "audit:read" },
      { href: "/account", key: "nav.account", icon: "account" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const [tenant, memberships] = await Promise.all([
    ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { primaryColor: true, legalNameEn: true, legalNameAr: true } }),
    prisma.membership.findMany({ where: { userId: ctx.user.id, status: "ACTIVE" }, select: { tenantId: true, tenant: { select: { legalNameEn: true, legalNameAr: true } } } }),
  ]);
  const name = (n: { legalNameEn: string; legalNameAr: string | null }) => (locale === "ar" && n.legalNameAr) || n.legalNameEn;
  const groups = NAV.map((g) => ({
    label: t(g.group),
    items: g.items.filter((n) => !n.permission || can(ctx, n.permission)).map((n) => ({ href: n.href, label: t(n.key), icon: n.icon })),
  })).filter((g) => g.items.length);
  const nav = <NavLinks groups={groups} />;
  return (
    <div style={{ "--brand": tenant.primaryColor } as React.CSSProperties} className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        {t("nav.skip")}
      </a>
      <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2">
          <details className="md:hidden">
            <summary className="btn-ghost cursor-pointer list-none"><Icon name="menu" /> {t("nav.menu")}</summary>
            <nav aria-label={t("nav.menu")} className="absolute inset-x-0 top-full max-h-[80dvh] overflow-y-auto border-b border-line bg-surface p-3 shadow-lg">
              {nav}
            </nav>
          </details>
          <span className="flex min-w-0 items-center gap-2 font-bold">
            <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white shadow-sm shadow-brand/30"><Icon name="plane" className="size-4" /></span>
            <span className="truncate">{name(tenant)}</span>
          </span>
          <span className="badge shrink-0">{t(`role.${ctx.membership.role}`)}</span>
          <form action="/search" method="get" role="search" className="hidden md:block">
            <label>
              <span className="sr-only">{t("search.title")}</span>
              <span className="relative block"><span className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-muted"><Icon name="search" className="size-4" /></span><input name="q" placeholder={t("search.placeholder")} className="input w-72 rounded-full bg-bg py-1.5 ps-8" maxLength={100} /></span>
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
      <div className="mx-auto flex max-w-7xl gap-8 px-4 py-6">
        <nav aria-label={t("nav.main")} className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-60 shrink-0 self-start overflow-y-auto pb-6 md:block">
          {nav}
        </nav>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
