import { ActionButton } from "./actions";
import type { Locale } from "@/lib/i18n";

type Doc = { id: string; filename: string; createdAt: Date; category: string };

/** Generated PDFs of a record (§14.4). Rendering is a background job, so "generate" says it is queued (FR-07). */
export function DocumentLinks({ docs, requestUrl, requestBody, locale, t, label }: { docs: Doc[]; requestUrl?: string; requestBody?: unknown; locale: Locale; t: (k: string) => string; label?: string }) {
  return (
    <div className="space-y-2 text-sm">
      {docs.length === 0 ? (
        <p className="text-muted">{t("docs.none")}</p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id}>
              <a className="underline" href={`/api/v1/documents/${d.id}/download`} dir="ltr">{d.filename}</a>{" "}
              <span className="text-xs text-muted">{d.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
            </li>
          ))}
        </ul>
      )}
      {requestUrl && <ActionButton url={requestUrl} body={requestBody} label={label ?? t("docs.generate")} locale={locale} />}
      {requestUrl && <p className="text-xs text-muted">{t("docs.queuedHint")}</p>}
    </div>
  );
}
