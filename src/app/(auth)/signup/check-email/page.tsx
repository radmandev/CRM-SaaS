import Link from "next/link";
import { pageT } from "@/server/page";

export default async function CheckEmailPage() {
  const { t } = await pageT();
  return (
    <>
      <h1 className="mb-2 text-xl font-bold">{t("auth.checkEmail.title")}</h1>
      <p className="text-sm text-muted">{t("auth.checkEmail.body")}</p>
      <Link href="/login" className="btn-secondary mt-6">
        {t("auth.login.title")}
      </Link>
    </>
  );
}
