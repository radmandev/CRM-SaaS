import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { pageT } from "@/server/page";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const { locale, t } = await pageT();
  if (!token || error)
    return (
      <>
        <h1 className="mb-2 text-xl font-bold">{t("auth.reset.invalidTitle")}</h1>
        <p className="text-sm text-muted">{t("auth.reset.invalidBody")}</p>
        <Link href="/forgot-password" className="btn-primary mt-6">
          {t("auth.forgot.title")}
        </Link>
      </>
    );
  return (
    <>
      <h1 className="mb-4 text-xl font-bold">{t("auth.reset.title")}</h1>
      <ApiForm action="/api/auth/reset-password" schema="resetPassword" locale={locale} submitLabel={t("auth.reset.submit")} extra={{ token }} redirectTo="/login?reset=1">
        <Field name="newPassword" type="password" label={t("field.newPassword")} autoComplete="new-password" required dir="ltr" hint={t("field.passwordHint")} />
      </ApiForm>
    </>
  );
}
