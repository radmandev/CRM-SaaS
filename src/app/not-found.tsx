import Link from "next/link";
import { pageT } from "@/server/page";

export default async function NotFound() {
  const { t } = await pageT();
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">{t("error.NOT_FOUND")}</h1>
      <p className="mt-2 text-muted">{t("error.notFoundBody")}</p>
      <Link href="/dashboard" className="btn-primary mt-6">
        {t("nav.dashboard")}
      </Link>
    </main>
  );
}
