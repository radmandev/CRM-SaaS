import { ApiForm, Field } from "@/components/api-form";
import { SessionsList } from "@/components/actions";
import { PageHeader } from "@/components/ui";
import { pageCtx, pageT } from "@/server/page";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const ctx = await pageCtx();
  const { locale, t } = await pageT();
  return (
    <>
      <PageHeader title={t("account.title")} />
      <div className="space-y-6">
        <section className="card" aria-labelledby="profile">
          <h2 id="profile" className="mb-4 font-semibold">{t("account.profile")}</h2>
          <ApiForm action="/api/v1/me" method="PATCH" schema="profile" locale={locale} submitLabel={t("common.save")} className="grid gap-4 sm:grid-cols-2">
            <Field name="name" label={t("field.yourName")} defaultValue={ctx.user.name} required />
            <Field name="locale" label={t("field.language")} defaultValue={ctx.user.locale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
            <p className="text-sm text-muted sm:col-span-2">
              {t("field.email")}: <bdi dir="ltr">{ctx.user.email}</bdi>
            </p>
          </ApiForm>
        </section>
        <section className="card" aria-labelledby="password">
          <h2 id="password" className="mb-1 font-semibold">{t("account.changePassword")}</h2>
          <p className="mb-4 text-sm text-muted">{t("account.changePasswordHint")}</p>
          {/* AUTH-13: other sessions are revoked on password change. */}
          <ApiForm action="/api/auth/change-password" schema="changePassword" locale={locale} submitLabel={t("account.changePassword")} successMessage={t("account.passwordChanged")} extra={{ revokeOtherSessions: true }} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
            <Field name="currentPassword" type="password" label={t("field.currentPassword")} autoComplete="current-password" required dir="ltr" />
            <Field name="newPassword" type="password" label={t("field.newPassword")} autoComplete="new-password" required dir="ltr" hint={t("field.passwordHint")} />
          </ApiForm>
        </section>
        <section className="card" aria-labelledby="sessions">
          <h2 id="sessions" className="mb-4 font-semibold">{t("account.sessions")}</h2>
          <SessionsList locale={locale} currentSessionId={ctx.session.id} />
        </section>
      </div>
    </>
  );
}
