import { ApiForm, Checkbox, Field, GroupError } from "@/components/api-form";
import { ActionButton } from "@/components/actions";
import { EmptyState, NoPermission, PageHeader, Pager, SearchBox } from "@/components/ui";
import { authorize, can } from "@/server/context";
import { pageCtx, pageT } from "@/server/page";
import { ALL_ROLES, canGrantRole } from "@/server/permissions";
import { listInvitations, listMembers } from "@/modules/identity/service";
import { listQuery } from "@/lib/schemas";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string; status?: string }> }) {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  if (!can(ctx, "user:manage")) return <NoPermission title={t("error.FORBIDDEN")} body={t("error.forbiddenBody")} />;
  const sp = await searchParams;
  const status = sp.status === "DEACTIVATED" ? "DEACTIVATED" : sp.status === "ACTIVE" ? "ACTIVE" : undefined;
  const q = listQuery.parse({ q: sp.q || undefined, cursor: sp.cursor || undefined });
  const scope = authorize(ctx, "user:manage");
  const [members, invitations, branches] = await Promise.all([
    listMembers(ctx, { ...q, status }),
    can(ctx, "user:invite") ? listInvitations(ctx, { limit: 50, q: undefined, cursor: undefined }) : Promise.resolve({ data: [] }),
    ctx.db.branch.findMany({ where: { archivedAt: null }, orderBy: { code: "asc" } }),
  ]);
  // Managers only assign branches within their own scope (AUTH-19).
  const assignable = scope === "BRANCH" ? branches.filter((b) => ctx.membership.branchIds.includes(b.id)) : branches;
  const grantable = ALL_ROLES.filter((r) => canGrantRole(ctx.membership.role, r));
  const branchName = new Map(branches.map((b) => [b.id, (locale === "ar" && b.nameAr) || b.nameEn]));
  const roleOptions = grantable.map((r) => ({ value: r, label: t(`role.${r}`) }));

  return (
    <>
      <PageHeader title={t("settings.users.title")} description={t("settings.users.subtitle")} />
      <SearchBox action="/settings/users" defaultValue={sp.q} label={t("common.search")}>
        <label>
          <span className="sr-only">{t("field.status")}</span>
          <select name="status" defaultValue={status ?? ""} className="input">
            <option value="">{t("common.all")}</option>
            <option value="ACTIVE">{t("status.ACTIVE")}</option>
            <option value="DEACTIVATED">{t("status.DEACTIVATED")}</option>
          </select>
        </label>
      </SearchBox>

      {members.data.length === 0 ? (
        <EmptyState title={t("common.noResults")} />
      ) : (
        <ul className="space-y-3">
          {members.data.map((m) => {
            const manageable = m.user.id !== ctx.user.id && canGrantRole(ctx.membership.role, m.role);
            return (
              <li key={m.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {m.user.name} {m.user.id === ctx.user.id && <span className="badge">{t("settings.users.you")}</span>}
                    </div>
                    <div className="text-sm text-muted">
                      <bdi dir="ltr">{m.user.email}</bdi> · {t(`role.${m.role}`)} · {m.branchIds.map((b) => branchName.get(b) ?? "—").join("، ")}
                    </div>
                  </div>
                  <span className="badge">{t(`status.${m.status}`)}</span>
                </div>
                {manageable && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm underline">{t("common.manage")}</summary>
                    <div className="mt-3 space-y-4">
                      <ApiForm action={`/api/v1/members/${m.id}`} method="PATCH" schema="memberUpdate" locale={locale} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
                        <Field name="role" label={t("field.role")} defaultValue={m.role} options={roleOptions} />
                        <Field name="primaryBranchId" label={t("field.primaryBranch")} defaultValue={m.primaryBranchId} options={assignable.map((b) => ({ value: b.id, label: branchName.get(b.id)! }))} />
                        <Field name="jobTitle" label={t("field.jobTitle")} defaultValue={m.jobTitle} />
                        <Field name="phone" type="tel" label={t("field.phone")} defaultValue={m.phone} dir="ltr" />
                        <Field name="employeeCode" label={t("field.employeeCode")} defaultValue={m.employeeCode} dir="ltr" />
                        <fieldset className="sm:col-span-2">
                          <legend className="mb-2 text-sm font-medium">{t("field.branches")}</legend>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {assignable.map((b) => (
                              <Checkbox key={b.id} name="branchIds" value={b.id} array label={branchName.get(b.id)!} defaultChecked={m.branchIds.includes(b.id)} />
                            ))}
                          </div>
                          <GroupError name="branchIds" />
                        </fieldset>
                      </ApiForm>
                      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                        {m.status === "ACTIVE" ? (
                          <ActionButton url={`/api/v1/members/${m.id}`} label={t("settings.users.deactivate")} locale={locale} variant="danger" confirm={t("settings.users.deactivateConfirm", { name: m.user.name })} body={{ status: "DEACTIVATED" }} method="PATCH" />
                        ) : (
                          <ActionButton url={`/api/v1/members/${m.id}`} label={t("settings.users.reactivate")} locale={locale} body={{ status: "ACTIVE" }} method="PATCH" />
                        )}
                        {scope === "ALL" && m.status === "ACTIVE" && (
                          <ActionButton url={`/api/v1/members/${m.id}/revoke-sessions`} label={t("settings.users.signOutEverywhere")} locale={locale} confirm={t("settings.users.signOutConfirm", { name: m.user.name })} />
                        )}
                      </div>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager basePath="/settings/users" nextCursor={members.page.nextCursor} hasCursor={!!sp.cursor} params={{ q: sp.q, status }} labels={{ first: t("common.firstPage"), next: t("common.nextPage") }} />

      {can(ctx, "user:invite") && (
        <>
          <section className="card mt-6" aria-labelledby="pending">
            <h2 id="pending" className="mb-3 font-semibold">{t("settings.users.pending")}</h2>
            {invitations.data.length === 0 ? (
              <EmptyState title={t("settings.users.noPending")} />
            ) : (
              <ul className="divide-y divide-line">
                {invitations.data.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <bdi dir="ltr">{i.email}</bdi> · {t(`role.${i.role}`)} · {i.expired ? <span className="text-red-700">{t("settings.users.expired")}</span> : t("settings.users.expires", { date: formatDate(i.expiresAt, locale) })}
                    </span>
                    {canGrantRole(ctx.membership.role, i.role) && (
                      <span className="flex gap-2">
                        <ActionButton url={`/api/v1/invitations/${i.id}/resend`} label={t("settings.users.resend")} locale={locale} />
                        <ActionButton url={`/api/v1/invitations/${i.id}/revoke`} label={t("settings.users.revoke")} locale={locale} variant="danger" confirm={t("settings.users.revokeConfirm")} />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card mt-6" aria-labelledby="invite">
            <h2 id="invite" className="mb-4 font-semibold">{t("settings.users.invite")}</h2>
            <ApiForm action="/api/v1/invitations" schema="invitation" locale={locale} submitLabel={t("settings.users.sendInvite")} successMessage={t("settings.users.inviteSent")} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
              <Field name="email" type="email" label={t("field.email")} required dir="ltr" />
              <Field name="role" label={t("field.role")} defaultValue={grantable.includes("SALES_AGENT") ? "SALES_AGENT" : grantable[0]} options={roleOptions} />
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">{t("field.branches")}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {assignable.map((b) => (
                    <Checkbox key={b.id} name="branchIds" value={b.id} array label={branchName.get(b.id)!} defaultChecked={b.id === ctx.membership.primaryBranchId} />
                  ))}
                </div>
                <GroupError name="branchIds" />
              </fieldset>
            </ApiForm>
          </section>
        </>
      )}
    </>
  );
}
