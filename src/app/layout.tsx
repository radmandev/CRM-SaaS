import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { dir } from "@/lib/i18n";
import { pageT } from "@/server/page";
import "./globals.css";

// KSA-04: one self-hosted font covering Arabic and Latin.
const font = IBM_Plex_Sans_Arabic({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-app", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await pageT();
  return { title: { default: t("app.name"), template: `%s · ${t("app.name")}` } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await pageT();
  return (
    <html lang={locale} dir={dir(locale)} className={font.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
