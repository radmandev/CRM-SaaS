import type { Metadata } from "next";
import localFont from "next/font/local";
import { dir } from "@/lib/i18n";
import { pageT } from "@/server/page";
import "./globals.css";

// KSA-04: one self-hosted font covering Arabic and Latin. Bundled from assets/fonts (OFL) rather than
// next/font/google, so the build never depends on reaching Google Fonts (the fetch fails on Hostinger).
const font = localFont({
  src: [
    { path: "../../assets/fonts/IBMPlexSansArabic-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../assets/fonts/IBMPlexSansArabic-Medium.woff2", weight: "500", style: "normal" },
    { path: "../../assets/fonts/IBMPlexSansArabic-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../../assets/fonts/IBMPlexSansArabic-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-app",
  display: "swap",
});

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
