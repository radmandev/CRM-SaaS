export type FieldError = { path: string; code: string; message: string };

/** Expected, client-facing failure. Mapped to RFC 9457 problem+json by the route wrapper (API-08). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: FieldError[] = [],
    readonly headers: Record<string, string> = {},
    /** Extra machine-readable members of the problem document (e.g. possible duplicates). */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const notFound = () => new AppError(404, "NOT_FOUND", "Not found");
export const forbidden = () => new AppError(403, "FORBIDDEN", "You do not have permission to do this");
export const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Please log in");
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const unprocessable = (code: string, message: string, path?: string) =>
  new AppError(422, code, message, path ? [{ path, code, message }] : []);
