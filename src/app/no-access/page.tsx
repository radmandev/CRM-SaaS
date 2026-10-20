import { SignOutButton } from "@/components/actions";
import { pageT } from "@/server/page";

export default async function NoAccessPage() {
  const { t } = await pageT();
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">{t("noAccess.title")}</h1>
      <p className="mt-2 text-muted">{t("noAccess.body")}</p>
      <div className="mt-6">
        <SignOutButton label={t("nav.signOut")} />
      </div>
    </main>
  );
}
