import { z } from "zod";
import type { Translate } from "./i18n";

export type FieldError = { path: string; code: string; message: string };

/**
 * Turns Zod issues into localized field errors (API-09). Custom messages in schemas are message keys
 * (e.g. "v.vatNumber"); built-in issues map to "v.<code>".
 */
export function fieldErrors(error: z.ZodError, t: Translate): FieldError[] {
  return error.issues.map((issue) => {
    const i = issue as z.core.$ZodIssue & { minimum?: number | bigint; maximum?: number | bigint; origin?: string };
    const key = issue.message?.startsWith("v.") ? issue.message : `v.${issue.code}${i.origin === "string" ? ".string" : ""}`;
    return {
      path: issue.path.join("."),
      code: issue.code,
      message: t(key, { min: Number(i.minimum ?? 0), max: Number(i.maximum ?? 0) }),
    };
  });
}
