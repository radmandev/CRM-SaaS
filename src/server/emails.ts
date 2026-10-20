import { translator, type Locale, isLocale } from "@/lib/i18n";
import type { Email } from "./email";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(locale: Locale, to: string, subject: string, paragraphs: string[], link?: { url: string; label: string }): Email {
  const dirAttr = locale === "ar" ? "rtl" : "ltr";
  const html =
    `<div dir="${dirAttr}" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">` +
    paragraphs.map((p) => `<p>${esc(p)}</p>`).join("") +
    (link ? `<p><a href="${esc(link.url)}">${esc(link.label)}</a></p><p style="color:#666;font-size:13px">${esc(link.url)}</p>` : "") +
    `</div>`;
  const text = [...paragraphs, ...(link ? [link.url] : [])].join("\n\n");
  return { to, subject, text, html };
}

const loc = (l: string | null | undefined): Locale => (isLocale(l) ? l : "ar");

export const emails = {
  verifyEmail(locale: string, to: string, url: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.verify.subject"), [t("email.verify.body")], { url, label: t("email.verify.cta") });
  },
  resetPassword(locale: string, to: string, url: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.reset.subject"), [t("email.reset.body"), t("email.ignore")], { url, label: t("email.reset.cta") });
  },
  passwordChanged(locale: string, to: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.passwordChanged.subject"), [t("email.passwordChanged.body")]);
  },
  accountLocked(locale: string, to: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.locked.subject"), [t("email.locked.body")]);
  },
  signupExisting(locale: string, to: string, url: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.signupExisting.subject"), [t("email.signupExisting.body"), t("email.ignore")], { url, label: t("email.signupExisting.cta") });
  },
  invitation(locale: string, to: string, agency: string, inviter: string, url: string) {
    const t = translator(loc(locale));
    return render(loc(locale), to, t("email.invite.subject", { agency }), [t("email.invite.body", { agency, inviter }), t("email.invite.expiry")], {
      url,
      label: t("email.invite.cta"),
    });
  },
};
