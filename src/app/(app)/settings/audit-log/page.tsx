import { EmptyState, NoPermission, PageHeader, Pager, SearchBox, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { listAuditLogs } from "@/modules/audit/service";
import { listQuery } from "@/lib/schemas";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "audit:read")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const { data, page } = await listAuditLogs(ctx, listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined, limit: 50 }));
  return (
    <>
      <PageHeader title={t("settings.audit.title")} description={t("settings.audit.subtitle")} />
      <SearchBox action="/settings/audit-log" defaultValue={sp.q} label={t("settings.audit.searchAction")} />
      {data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <TableScroll label={t("settings.audit.title")}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("settings.audit.when")}</th>
                <th scope="col">{t("settings.audit.who")}</th>
                <th scope="col">{t("settings.audit.action")}</th>
                <th scope="col">{t("settings.audit.changes")}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap">{formatDateTime(a.createdAt, locale, ctx.tenant.timezone)}</td>
                  <td>{a.actorName ?? t("audit.system")}</td>
                  <td dir="ltr" className="font-mono text-xs">
                    {a.action}
                    <div className="text-muted">{a.entityType}</div>
                  </td>
                  <td>
                    {a.changes ? (
                      <ul className="space-y-0.5 text-xs" dir="ltr">
                        {Object.entries(a.changes as Record<string, [unknown, unknown]>).map(([k, [from, to]]) => (
                          <li key={k}>
                            <span className="font-medium">{k}</span>: {JSON.stringify(from)} → {JSON.stringify(to)}
                          </li>
                        ))}
                      </ul>
                    ) : a.metadata ? (
                      <code className="text-xs" dir="ltr">{JSON.stringify(a.metadata)}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <Pager basePath="/settings/audit-log" nextCursor={page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />
    </>
  );
}
