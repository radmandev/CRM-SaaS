import { ApiForm, Field } from "./api-form";
import type { Locale } from "@/lib/i18n";

export function invoiceTone(i: { status: string; kind: string; outstanding: { toString(): string } | null; total: { toString(): string } }) {
  if (i.status === "DRAFT") return "DRAFT";
  if (i.kind === "CREDIT_NOTE") return "CANCELLED";
  const out = Number(i.outstanding?.toString() ?? 0);
  return out <= 0 ? "ISSUED" : out < Number(i.total.toString()) ? "ON_HOLD" : "CONFIRMED";
}

/** Financial records are never deleted (FIN-02): they are reversed with a reason. */
export function ReverseForm({ url, locale, t, label }: { url: string; locale: Locale; t: (k: string) => string; label?: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer underline">{label ?? t("fin.reverse")}</summary>
      <ApiForm action={url} schema="reverse" locale={locale} submitLabel={label ?? t("fin.reverse")} className="mt-2 flex flex-wrap items-end gap-2">
        <Field name="reason" label={t("fin.reverseReason")} required />
      </ApiForm>
    </details>
  );
}

/** Method options for manually recorded money (online gateway payments only come from verified callbacks). */
export const MANUAL_METHODS = ["BANK_TRANSFER", "CASH", "CARD_POS", "CHEQUE", "OTHER"] as const;
