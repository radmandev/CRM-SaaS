"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiForm, Field } from "@/components/api-form";
import { translator, type Locale } from "@/lib/i18n";

type Lookup = { email: string; role: string; agency: { nameEn: string; nameAr: string | null }; hasAccount: boolean };

export function AcceptInvitation({ token, locale, currentEmail }: { token: string; locale: Locale; currentEmail: string | null }) {
  const t = useMemo(() => translator(locale), [locale]);
  const [info, setInfo] = useState<Lookup | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    fetch("/api/v1/invitations/lookup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setInfo(d.data))
      .catch(() => setInvalid(true));
  }, [token]);

  if (invalid)
    return (
      <>
        <h1 className="mb-2 text-xl font-bold">{t("invite.invalidTitle")}</h1>
        <p className="text-sm text-muted">{t("error.INVITATION_INVALID")}</p>
      </>
    );
  if (!info) return <p className="text-sm text-muted">{t("common.loading")}</p>;

  const agency = (locale === "ar" && info.agency.nameAr) || info.agency.nameEn;
  const heading = (
    <>
      <h1 className="mb-1 text-xl font-bold">{t("invite.title", { agency })}</h1>
      <p className="mb-4 text-sm text-muted">
        {t("invite.subtitle", { role: t(`role.${info.role}`) })} <bdi dir="ltr">{info.email}</bdi>
      </p>
    </>
  );

  if (currentEmail && currentEmail !== info.email)
    return (
      <>
        {heading}
        <p role="alert" className="text-sm text-red-700">{t("error.EMAIL_MISMATCH")}</p>
      </>
    );
  if (info.hasAccount && !currentEmail)
    return (
      <>
        {heading}
        <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="btn-primary">
          {t("invite.loginToAccept")}
        </Link>
      </>
    );
  return (
    <>
      {heading}
      <ApiForm action="/api/v1/invitations/accept" schema={info.hasAccount ? undefined : "acceptInvitation"} locale={locale} submitLabel={t("invite.accept")} extra={{ token, locale }} redirectTo="/dashboard" hardRedirect>
        {!info.hasAccount && (
          <>
            <Field name="name" label={t("field.yourName")} autoComplete="name" required />
            <Field name="password" type="password" label={t("field.password")} autoComplete="new-password" required dir="ltr" hint={t("field.passwordHint")} />
          </>
        )}
      </ApiForm>
    </>
  );
}
