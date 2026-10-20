"use client";

// UX-03: route-level error with retry. Text is bilingual because the locale is not available here.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">Something went wrong · حدث خطأ</h1>
      {error.digest && <p className="mt-2 text-xs text-muted">Ref: {error.digest}</p>}
      <button type="button" onClick={reset} className="btn-primary mt-6">
        Try again · حاول مرة أخرى
      </button>
    </main>
  );
}
