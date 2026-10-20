"use client";

import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formSchemas, type FormSchemaName } from "@/lib/form-schemas";
import { fieldErrors, type FieldError } from "@/lib/validation";
import { translator, type Locale } from "@/lib/i18n";

type Errors = Record<string, string>;
const FormErrors = createContext<Errors>({});

/** Collects form controls into a JSON object. Dotted names nest; `data-array` checkboxes and multi-selects become arrays. */
function collect(form: HTMLFormElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (path: string, value: unknown) => {
    const keys = path.split(".");
    let node = out as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) node = (node[k] ??= {}) as Record<string, unknown>;
    node[keys.at(-1)!] = value;
  };
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) || !el.name || el.disabled) continue;
    if (el instanceof HTMLInputElement && el.type === "file") continue;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      if (el.dataset.array !== undefined) {
        const list = (out[el.name] as string[] | undefined) ?? [];
        if (el.checked) list.push(el.value);
        set(el.name, list);
      } else set(el.name, el.checked);
    } else if (el instanceof HTMLSelectElement && el.multiple) {
      set(el.name, Array.from(el.selectedOptions).map((o) => o.value));
    } else set(el.name, el.value);
  }
  return arraysFromIndexes(out) as Record<string, unknown>;
}

/** `{ "0": a, "1": b }` → `[a, b]` (repeatable rows such as flight segments). Gaps from removed rows are dropped. */
function arraysFromIndexes(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v)) return Array.isArray(v) ? v.map(arraysFromIndexes) : v;
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length && entries.every(([k]) => /^\d+$/.test(k)))
    return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, x]) => arraysFromIndexes(x));
  return Object.fromEntries(entries.map(([k, x]) => [k, arraysFromIndexes(x)]));
}

/** crypto.randomUUID exists only in secure contexts (https/localhost); getRandomValues works everywhere. */
function newKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Duplicate = { id: string; code?: string; displayName?: string; reference?: string };

type Props = {
  action: string;
  method?: "POST" | "PATCH";
  schema?: FormSchemaName;
  locale: Locale;
  submitLabel: string;
  successMessage?: string;
  redirectTo?: string;
  hardRedirect?: boolean;
  resetOnSuccess?: boolean;
  /** Extra fields merged into the body (e.g. a token from the URL). */
  extra?: Record<string, unknown>;
  /** Link pattern for POSSIBLE_DUPLICATE matches, e.g. "/customers/{id}"; enables "create anyway". */
  duplicateHref?: string;
  /** Redirect target after success; "{id}" is replaced with the created record's id. */
  redirectToCreated?: string;
  children: ReactNode;
  className?: string;
};

/**
 * One form component for every mutation (API-02): validates with the shared Zod schema in the browser,
 * submits JSON to /api/v1 (or Better Auth), shows server field errors, and only reports success after
 * the server confirms it (FR-07).
 */
export function ApiForm({ action, method = "POST", schema, locale, submitLabel, successMessage, redirectTo, hardRedirect, resetOnSuccess, extra, duplicateHref, redirectToCreated, children, className }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  // IDM-01: one key per logical submission, reused on retries, renewed after success.
  const idempotencyKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>, confirmDuplicate = false) {
    e.preventDefault();
    const form = formRef.current!;
    setSuccess(null);
    setFormError(null);
    setDuplicates(null);
    const body = { ...collect(form), ...extra, ...(confirmDuplicate ? { confirmDuplicate: true } : {}) };
    if (schema) {
      const parsed = formSchemas[schema].safeParse(body);
      if (!parsed.success) {
        setErrors(toMap(fieldErrors(parsed.error, t)));
        return;
      }
    }
    setErrors({});
    setPending(true);
    try {
      idempotencyKey.current ??= newKey();
      const headers: Record<string, string> = { "content-type": "application/json", "accept-language": locale };
      if (method === "POST") headers["idempotency-key"] = idempotencyKey.current;
      const res = await fetch(action, { method, headers, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) idempotencyKey.current = null;
      if (!res.ok && data.code === "POSSIBLE_DUPLICATE" && duplicateHref) {
        idempotencyKey.current = null;
        setDuplicates(data.duplicates ?? []);
        return;
      }
      if (!res.ok) {
        if (Array.isArray(data.errors)) setErrors(toMap(data.errors));
        const code = (data.code as string | undefined) ?? (res.status === 429 ? "RATE_LIMITED" : undefined);
        const known = code ? t(`error.${code}`) : undefined;
        setFormError(known && known !== `error.${code}` ? known : data.title || data.message || t("error.INTERNAL"));
        return;
      }
      if (resetOnSuccess) form.reset();
      if (redirectToCreated && data?.data?.id) {
        router.push(redirectToCreated.replace("{id}", data.data.id));
        return;
      }
      if (redirectTo) {
        if (hardRedirect) window.location.assign(redirectTo);
        else router.push(redirectTo);
        return;
      }
      setSuccess(successMessage ?? t("common.saved"));
      router.refresh();
    } catch {
      setFormError(t("error.NETWORK"));
    } finally {
      setPending(false);
    }
  }

  return (
    <FormErrors.Provider value={errors}>
      <form ref={formRef} onSubmit={onSubmit} noValidate className={className ?? "space-y-4"}>
        {duplicates && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 sm:col-span-full">
            <p className="font-medium">{t("form.possibleDuplicates")}</p>
            <ul className="my-2 list-disc ps-5">
              {duplicates.map((d) => (
                <li key={d.id}>
                  <a className="underline" href={duplicateHref!.replace("{id}", d.id)} target="_blank" rel="noreferrer">
                    {d.reference ?? `${d.displayName ?? ""} ${d.code ? `(${d.code})` : ""}`}
                  </a>
                </li>
              ))}
            </ul>
            <button type="button" className="btn-secondary" onClick={(ev) => onSubmit(ev as unknown as React.FormEvent<HTMLFormElement>, true)}>
              {t("form.createAnyway")}
            </button>
          </div>
        )}
        {formError && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {formError}
          </div>
        )}
        {children}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? t("common.saving") : submitLabel}
          </button>
          <span role="status" aria-live="polite" className="text-sm text-emerald-700 dark:text-emerald-400">
            {success}
          </span>
        </div>
      </form>
    </FormErrors.Provider>
  );
}

function toMap(list: FieldError[]): Errors {
  const map: Errors = {};
  for (const e of list) map[e.path || "_"] ??= e.message;
  return map;
}

type FieldProps = {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string | number | null;
  required?: boolean;
  hint?: string;
  autoComplete?: string;
  dir?: "ltr" | "rtl" | "auto";
  options?: { value: string; label: string }[];
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
};

/** Labelled input with its error wired through aria-describedby (§24.6). */
export function Field({ name, label, type = "text", defaultValue, required, hint, autoComplete, dir, options, multiline, placeholder, maxLength, disabled }: FieldProps) {
  const errors = useContext(FormErrors);
  const id = useId();
  const error = errors[name];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  const common = {
    id,
    name,
    required,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    className: "input",
    dir,
  } as const;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && <span aria-hidden="true" className="text-red-600"> *</span>}
      </label>
      {options ? (
        <select {...common} defaultValue={defaultValue ?? ""}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : multiline ? (
        <textarea {...common} defaultValue={defaultValue ?? ""} rows={3} maxLength={maxLength} placeholder={placeholder} />
      ) : (
        <input {...common} type={type} defaultValue={defaultValue ?? ""} autoComplete={autoComplete} placeholder={placeholder} maxLength={maxLength} />
      )}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked, value, array }: { name: string; label: string; defaultChecked?: boolean; value?: string; array?: boolean }) {
  const errors = useContext(FormErrors);
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} data-array={array ? "" : undefined} className="size-4 accent-[var(--brand)]" />
      <span>{label}</span>
      {!array && errors[name] && <span className="text-xs text-red-700">{errors[name]}</span>}
    </label>
  );
}

/** Error slot for a group of controls (e.g. a set of checkboxes). */
export function GroupError({ name }: { name: string }) {
  const error = useContext(FormErrors)[name];
  return error ? <p className="text-xs text-red-700 dark:text-red-400">{error}</p> : null;
}
