import { LocaleSwitcher } from "@/components/actions";
import { pageT, pageUser } from "@/server/page";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const { locale, t } = await pageT();
  const user = await pageUser();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-lg font-bold">{t("app.name")}</span>
        <LocaleSwitcher locale={locale} loggedIn={!!user} />
      </div>
      <div className="card">{children}</div>
    </main>
  );
}
