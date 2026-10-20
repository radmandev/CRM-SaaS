import Link from "next/link";
import { ApiForm, Field } from "@/components/api-form";
import { pageT } from "@/server/page";

export default async function ForgotPasswordPage() {
  const { locale, t } = await pageT();
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">{t("auth.forgot.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("auth.forgot.subtitle")}</p>
      {/* AUTH-17: the response is the same whether or not the account exists. */}
      <ApiForm action="/api/auth/request-password-reset" schema="forgotPassword" locale={locale} submitLabel={t("auth.forgot.submit")} successMessage={t("auth.forgot.sent")} extra={{ redirectTo: "/reset-password" }} resetOnSuccess>
        <Field name="email" type="email" label={t("field.email")} autoComplete="email" required dir="ltr" />
      </ApiForm>
      <Link href="/login" className="mt-4 inline-block text-sm underline">
        {t("auth.login.title")}
      </Link>
    </>
  );
}
