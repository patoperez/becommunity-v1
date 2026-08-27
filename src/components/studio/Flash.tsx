/**
 * The one result banner Studio uses.
 *
 * Every Server Action in the backoffice returns through a redirect carrying
 * `?ok=` or `?error=`, and four pages had four copies of the same two
 * paragraphs. This is that markup, once, with a live region so a change that
 * happens after a navigation is announced rather than only drawn.
 */
export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div className="space-y-3">
      {ok ? (
        <p
          role="status"
          className="rounded-lg border border-positive-line bg-positive-surface px-4 py-3 text-sm text-positive"
        >
          {ok}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
