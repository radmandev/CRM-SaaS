import { AcceptInvitation } from "./accept";
import { pageT, pageUser } from "@/server/page";
import { LocaleSwitcher } from "@/components/actions";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { locale, t } = await pageT();
  const user = await pageUser();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold">{t("app.name")}</span>
        <LocaleSwitcher locale={locale} loggedIn={!!user} />
      </div>
      <div className="card">
        <AcceptInvitation token={token} locale={locale} currentEmail={user?.user.email ?? null} />
      </div>
    </main>
  );
}
