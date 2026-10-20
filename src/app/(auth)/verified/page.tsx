import Link from "next/link";
import { pageT, pageUser } from "@/server/page";

// Landing page after the email verification link (Better Auth redirects here, with ?error=... on failure).
export default async function VerifiedPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t } = await pageT();
  const user = await pageUser();
  return (
    <>
      <h1 className="mb-2 text-xl font-bold">{error ? t("auth.verified.failedTitle") : t("auth.verified.title")}</h1>
      <p className="text-sm text-muted">{error ? t("auth.verified.failedBody") : t("auth.verified.body")}</p>
      <Link href={user ? "/dashboard" : "/login"} className="btn-primary mt-6">
        {user ? t("nav.dashboard") : t("auth.login.title")}
      </Link>
    </>
  );
}
