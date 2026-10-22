import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiForm, Field } from "@/components/api-form";
import { pageT, pageUser } from "@/server/page";
import { env } from "@/server/env";

export const metadata = { title: "Sign up" };

const COUNTRIES = ["SA", "AE", "KW", "QA", "BH", "OM", "EG", "JO"];

export default async function SignupPage() {
  if (await pageUser()) redirect("/dashboard");
  const { locale, t } = await pageT();
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return (
    <>
      <h1 className="mb-1 text-xl font-bold">{t("auth.signup.title")}</h1>
      <p className="mb-4 text-sm text-muted">{t("auth.signup.subtitle")}</p>
      <ApiForm action="/api/v1/signup" schema="signup" locale={locale} submitLabel={t("auth.signup.submit")} redirectTo={env().SKIP_EMAIL_VERIFICATION ? "/login" : "/signup/check-email"}>
        <Field name="agencyName" label={t("field.agencyName")} required maxLength={200} />
        <Field name="slug" label={t("field.slug")} required dir="ltr" hint={t("field.slugHint")} maxLength={40} />
        <Field name="country" label={t("field.country")} defaultValue="SA" options={COUNTRIES.map((c) => ({ value: c, label: names.of(c) ?? c }))} />
        <Field name="name" label={t("field.yourName")} autoComplete="name" required maxLength={120} />
        <Field name="email" type="email" label={t("field.email")} autoComplete="email" required dir="ltr" />
        <Field name="password" type="password" label={t("field.password")} autoComplete="new-password" required dir="ltr" hint={t("field.passwordHint")} />
        <Field name="locale" label={t("field.language")} defaultValue={locale} options={[{ value: "ar", label: "العربية" }, { value: "en", label: "English" }]} />
      </ApiForm>
      <p className="mt-4 text-sm">
        {t("auth.signup.haveAccount")}{" "}
        <Link href="/login" className="underline">
          {t("auth.login.title")}
        </Link>
      </p>
    </>
  );
}
