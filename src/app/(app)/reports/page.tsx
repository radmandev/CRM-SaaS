import Link from "next/link";
import { NoPermission, PageHeader } from "@/components/ui";
import { can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { REPORTS } from "@/lib/schemas-finance";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await pageCtx();
  const { t } = await pageT();
  if (!can(ctx, "report:financial")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  return (
    <>
      <PageHeader title={t("rep.title")} description={t("rep.subtitle")} />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <li key={r}>
            <Link href={`/reports/${r}`} className="card block h-full hover:border-primary">
              <h2 className="font-semibold">{t(`rep.${r}.title`)}</h2>
              <p className="mt-1 text-sm text-muted">{t(`rep.${r}.body`)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
