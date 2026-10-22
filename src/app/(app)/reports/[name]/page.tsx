import { notFound } from "next/navigation";
import { Money, NoPermission, PageHeader, TableScroll } from "@/components/ui";
import { can } from "@/server/context";
import { AppError } from "@/server/errors";
import { pageCtx, pageT } from "@/server/page";
import { runReport } from "@/modules/finance/reports";
import { REPORTS, reportQuery } from "@/lib/schemas-finance";

export const metadata = { title: "Report" };

type Value = string | number | null | Value[] | { [k: string]: Value };
const isMoney = (k: string, v: Value) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v) && !/rate/i.test(k);

/** One renderer for every report: scalars as a summary, arrays of rows as tables, nested objects recursively. */
function Block({ data, t, locale, currency }: { data: Record<string, Value>; t: (k: string) => string; locale: "ar" | "en"; currency: string }) {
  const scalars = Object.entries(data).filter(([, v]) => v === null || typeof v !== "object");
  const nested = Object.entries(data).filter(([k, v]) => v !== null && typeof v === "object" && k !== "buckets"); // bucket names are the column headers
  const cell = (k: string, v: Value) => (isMoney(k, v) ? <Money value={v as string} currency={currency} locale={locale} /> : Array.isArray(v) ? v.join(", ") : String(v ?? "—"));
  return (
    <div className="space-y-6">
      {scalars.length > 0 && (
        <dl className="grid gap-3 sm:grid-cols-3">
          {scalars.map(([k, v]) => <div key={k} className="card"><dt className="text-xs text-muted">{t(`repKey.${k}`)}</dt><dd className="mt-1 text-lg font-semibold">{cell(k, v)}</dd></div>)}
        </dl>
      )}
      {nested.map(([k, v]) =>
        Array.isArray(v) ? (
          v.length > 0 && typeof v[0] === "object" && v[0] !== null ? (
            <section key={k} aria-label={t(`repKey.${k}`)}>
              <h2 className="mb-2 font-semibold">{t(`repKey.${k}`)}</h2>
              <TableScroll label={t(`repKey.${k}`)}>
                <table className="table">
                  <thead><tr>{Object.keys(v[0] as object).filter((c) => !/^id$|Id$/.test(c)).map((c) => <th key={c} scope="col">{t(`repKey.${c}`)}</th>)}</tr></thead>
                  <tbody>{(v as Record<string, Value>[]).map((row, n) => <tr key={n}>{Object.entries(row).filter(([c]) => !/^id$|Id$/.test(c)).map(([c, x]) => <td key={c}>{cell(c, x)}</td>)}</tr>)}</tbody>
                </table>
              </TableScroll>
            </section>
          ) : (
            <p key={k} className="text-sm text-muted">{t(`repKey.${k}`)}: {v.length ? v.join(", ") : t("common.noResults")}</p>
          )
        ) : (
          <section key={k}><h2 className="mb-2 font-semibold">{t(`repKey.${k}`)}</h2><Block data={v as Record<string, Value>} t={t} locale={locale} currency={currency} /></section>
        ),
      )}
    </div>
  );
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { name } = await params;
  if (!(REPORTS as readonly string[]).includes(name)) notFound();
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "report:financial")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const now = new Date();
  const from = sp.from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const to = sp.to || now.toISOString().slice(0, 10);
  const q = reportQuery.safeParse({ from, to, ...(sp.branchId ? { branchId: sp.branchId } : {}) });
  const branches = await ctx.db.branch.findMany({ where: { archivedAt: null, ...(ctx.membership.role === "OWNER" || ctx.membership.role === "ADMIN" ? {} : { id: { in: ctx.membership.branchIds } }) }, orderBy: { code: "asc" } });
  const currency = (await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.tenant.id }, select: { baseCurrency: true } })).baseCurrency;
  let data: Record<string, Value> | null = null;
  let error: string | null = q.success ? null : t("v.endAfterStart");
  if (q.success) {
    try {
      data = JSON.parse(JSON.stringify(await runReport(ctx, name as (typeof REPORTS)[number], q.data)));
    } catch (e) {
      if (!(e instanceof AppError) || e.status !== 422) throw e;
      error = t(`error.${e.code}`);
    }
  }
  return (
    <>
      <PageHeader title={t(`rep.${name}.title`)} description={`${t(`rep.${name}.body`)} ${t("rep.baseNote", { currency })}`} />
      <form className="mb-6 flex flex-wrap items-end gap-3" action={`/reports/${name}`}>
        <label className="text-sm">{t("rep.from")}<input className="input mt-1 block" type="date" name="from" defaultValue={from} required /></label>
        <label className="text-sm">{t("rep.to")}<input className="input mt-1 block" type="date" name="to" defaultValue={to} required /></label>
        {branches.length > 1 && (
          <label className="text-sm">{t("booking.branch")}
            <select className="input mt-1 block" name="branchId" defaultValue={sp.branchId ?? ""}>
              <option value="">{t("common.all")}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </label>
        )}
        <button className="btn-secondary">{t("rep.run")}</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {data && <Block data={data} t={t} locale={locale} currency={currency} />}
      <p className="mt-6 text-xs text-muted">{t("rep.operationalNote")}</p>
    </>
  );
}
