import Link from "next/link";
import { redirect } from "next/navigation";
import { ApiForm, Field } from "@/components/api-form";
import { pageT, pageUser } from "@/server/page";

export const metadata = { title: "Log in" };

const safeNext = (n?: string) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/dashboard");

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  if (await pageUser()) redirect(safeNext(next));
  const { locale, t } = await pageT();
  return (
    <>
      <h1 className="mb-4 text-xl font-bold">{t("auth.login.title")}</h1>
      {reset && (
        <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {t("auth.reset.done")}
        </p>
      )}
      {/* callbackURL is where the re-sent verification link lands if the email is not confirmed yet. */}
      <ApiForm action="/api/auth/sign-in/email" schema="login" locale={locale} submitLabel={t("auth.login.submit")} redirectTo={safeNext(next)} hardRedirect extra={{ callbackURL: "/verified" }}>
        <Field name="email" type="email" label={t("field.email")} autoComplete="email" required dir="ltr" />
        <Field name="password" type="password" label={t("field.password")} autoComplete="current-password" required dir="ltr" />
      </ApiForm>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="underline">
          {t("auth.login.forgot")}
        </Link>
        <Link href="/signup" className="underline">
          {t("auth.login.signup")}
        </Link>
      </div>
    </>
  );
}
