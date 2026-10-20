import Link from "next/link";
import { getDashboard } from "@/modules/dashboard/service";
import { pageCtx, pageT } from "@/server/page";
import { can } from "@/server/context";
import { PageHeader, EmptyState } from "@/components/ui";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";

export const metadata = { title: "Dashboard" };

function Meter({
  label,
  used,
  limit,
  display,
}: {
  label: string;
  used: number;
  limit: number;
  display: string;
}) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted">{display}</span>
      </div>
      <div
        className="mt-1 h-2 rounded-full bg-bg"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div
          className={`h-2 rounded-full ${pct >= 80 ? "bg-amber-500" : "bg-brand"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  const d = await getDashboard(ctx);
  const nf = new Intl.NumberFormat(`${locale}-u-nu-latn`);
  const done = d.checklist.filter((c) => c.done).length;
  const planName =
    locale === "ar" ? d.tenant.plan.nameAr : d.tenant.plan.nameEn;
  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        description={`${planName}${d.tenant.trialEndsAt && d.tenant.status === "TRIALING" ? ` · ${t("dashboard.trialEnds", { date: formatDate(d.tenant.trialEndsAt, locale) })}` : ""}`}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        {can(ctx, "tenant:settings") && (
          <section className="card lg:col-span-2" aria-labelledby="setup">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="setup" className="font-semibold">
                {t("dashboard.setup")}
              </h2>
              <span className="text-sm text-muted">
                {t("dashboard.setupProgress", {
                  done: nf.format(done),
                  total: nf.format(d.checklist.length),
                })}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {d.checklist.map((c) => (
                <li
                  key={c.key}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={c.done ? "text-emerald-600" : "text-muted"}
                    >
                      {c.done ? "✓" : "○"}
                    </span>
                    <span>{t(`dashboard.check.${c.key}`)}</span>
                    <span className="sr-only">
                      {c.done ? t("common.done") : t("common.notDone")}
                    </span>
                  </span>
                  {!c.done && (
                    <Link href={c.href} className="text-sm underline">
                      {t("common.open")}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="card space-y-4" aria-labelledby="usage">
          <h2 id="usage" className="font-semibold">
            {t("dashboard.usage")}
          </h2>
          <Meter
            label={t("dashboard.users")}
            used={d.usage.users.used}
            limit={d.usage.users.limit}
            display={`${nf.format(d.usage.users.used)} / ${nf.format(d.usage.users.limit)}`}
          />
          <Meter
            label={t("dashboard.branches")}
            used={d.usage.branches.used}
            limit={d.usage.branches.limit}
            display={`${nf.format(d.usage.branches.used)} / ${nf.format(d.usage.branches.limit)}`}
          />
          <Meter
            label={t("dashboard.storage")}
            used={d.usage.storage.usedBytes}
            limit={d.usage.storage.limitBytes}
            display={`${formatBytes(d.usage.storage.usedBytes, locale)} / ${formatBytes(d.usage.storage.limitBytes, locale)}`}
          />
        </section>
        <section className="card" aria-labelledby="team">
          <h2 id="team" className="mb-3 font-semibold">
            {t("dashboard.team")}
          </h2>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["dashboard.activeMembers", d.team.members],
              ["dashboard.pendingInvites", d.team.pendingInvites],
              ["dashboard.activeBranches", d.team.branches],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-muted">{t(k as string)}</dt>
                <dd className="text-2xl font-bold">{nf.format(v as number)}</dd>
              </div>
            ))}
          </dl>
        </section>
        {d.recentActivity.length > 0 ||
        ctx.membership.role === "OWNER" ||
        ctx.membership.role === "ADMIN" ? (
          <section className="card lg:col-span-2" aria-labelledby="activity">
            <h2 id="activity" className="mb-3 font-semibold">
              {t("dashboard.recentActivity")}
            </h2>
            {d.recentActivity.length === 0 ? (
              <EmptyState title={t("dashboard.noActivity")} />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {d.recentActivity.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap justify-between gap-2 py-2"
                  >
                    <span>
                      <span className="font-medium">
                        {a.actorName ?? t("audit.system")}
                      </span>{" "}
                      · <code className="text-xs">{a.action}</code>
                    </span>
                    <time
                      className="text-muted"
                      dateTime={a.createdAt.toISOString()}
                    >
                      {formatDateTime(a.createdAt, locale, ctx.tenant.timezone)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
