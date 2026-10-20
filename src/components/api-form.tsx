"use client";

import { createContext, useContext, useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formSchemas, type FormSchemaName } from "@/lib/schemas";
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
  return out;
}

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
  children: ReactNode;
  className?: string;
};

/**
 * One form component for every mutation (API-02): validates with the shared Zod schema in the browser,
 * submits JSON to /api/v1 (or Better Auth), shows server field errors, and only reports success after
 * the server confirms it (FR-07).
 */
export function ApiForm({ action, method = "POST", schema, locale, submitLabel, successMessage, redirectTo, hardRedirect, resetOnSuccess, extra, children, className }: Props) {
  const t = useMemo(() => translator(locale), [locale]);
  const router = useRouter();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setSuccess(null);
    setFormError(null);
    const body = { ...collect(form), ...extra };
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
      const res = await fetch(action, { method, headers: { "content-type": "application/json", "accept-language": locale }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (Array.isArray(data.errors)) setErrors(toMap(data.errors));
        const code = (data.code as string | undefined) ?? (res.status === 429 ? "RATE_LIMITED" : undefined);
        const known = code ? t(`error.${code}`) : undefined;
        setFormError(known && known !== `error.${code}` ? known : data.title || data.message || t("error.INTERNAL"));
        return;
      }
      if (resetOnSuccess) form.reset();
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
      <form onSubmit={onSubmit} noValidate className={className ?? "space-y-4"}>
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
