import Link from "next/link";
import { generateSuggestions, reviewObservations } from "@/app/admin/qualitative/actions";
import { StateBlock } from "@/components/States";
import { Pager } from "@/components/studio/Pager";
import { QualitativeReview, type StageChoice } from "@/components/studio/QualitativeReview";
import {
  REVIEW_STATES,
  REVIEW_STATE_LABEL,
  type QualitativeWorkspace,
} from "@/lib/studio/qualitative-workspace";
import { pageHref } from "@/lib/studio/paging";

/**
 * The qualitative review, rendered identically at both of its addresses.
 *
 * `/admin/qualitative` and `/studio/e/[studyId]/cualitativo` differ only in how
 * the study is chosen and where the action returns. Everything a reviewer
 * touches — the counts, the filter, the paged list, the theme picker, the three
 * actions and their consequences — is this component, once.
 */

const FILTER_ON =
  "inline-flex min-h-11 items-center rounded-lg border border-evidence-line bg-evidence-surface px-3 py-2 text-sm font-semibold text-strong";
const FILTER_OFF =
  "inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-body hover:bg-surface-sunken";

export function QualitativeWorkspaceView({
  studyId,
  workspace,
  stages,
  basePath,
  filterParams,
  returnTo,
  selector,
}: {
  studyId: string;
  workspace: QualitativeWorkspace;
  stages: StageChoice[];
  /** The address this list pages within. */
  basePath: string;
  /** The query this list must carry across pages, minus `p`. */
  filterParams: Record<string, string | null | undefined>;
  /** Where the Server Action should return, or undefined for the legacy path. */
  returnTo?: string;
  /** The study chooser, on the address that needs one. */
  selector?: React.ReactNode;
}) {
  const { counts, total, window: view, state } = workspace;

  return (
    <div className="space-y-6">
      {selector}

      {total === 0 ? (
        <StateBlock title="Este estudio no tiene observaciones cualitativas">
          <p>
            Su archivo no traía columnas de texto abierto, o todavía no se ha cargado. Cuando
            existan comentarios, aparecerán aquí para revisarlos uno por uno.
          </p>
        </StateBlock>
      ) : (
        <>
          {/* Where the work stands, across the WHOLE study — never only the page. */}
          <section aria-label="Estado de la revisión" className="grid gap-3 sm:grid-cols-3">
            {REVIEW_STATES.map((value) => {
              const active = state === value;
              return (
                <Link
                  key={value}
                  href={pageHref(basePath, { ...filterParams, estado: active ? null : value }, 1)}
                  aria-current={active ? "true" : undefined}
                  className={`rounded-xl border p-4 transition-colors duration-[var(--motion-state)] ${
                    value === "pending"
                      ? "border-caution-line bg-caution-surface"
                      : value === "confirmed"
                        ? "border-positive-line bg-positive-surface"
                        : "border-danger-line bg-danger-surface"
                  } ${active ? "shadow-raised ring-2 ring-focus" : "hover:shadow-raised"}`}
                >
                  <span
                    className={`text-xs font-semibold uppercase tracking-wide ${
                      value === "pending"
                        ? "text-caution"
                        : value === "confirmed"
                          ? "text-positive"
                          : "text-danger"
                    }`}
                  >
                    {REVIEW_STATE_LABEL[value]}
                  </span>
                  <span className="tabular mt-1 block font-display text-2xl font-semibold text-strong">
                    {counts[value]}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {active ? "Mostrando solo estas · toca para ver todas" : "Ver solo estas"}
                  </span>
                </Link>
              );
            })}
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Mostrando:</span>
            <Link
              href={pageHref(basePath, { ...filterParams, estado: null }, 1)}
              className={state === null ? FILTER_ON : FILTER_OFF}
            >
              Todas ({total})
            </Link>
            {REVIEW_STATES.map((value) => (
              <Link
                key={value}
                href={pageHref(basePath, { ...filterParams, estado: value }, 1)}
                className={state === value ? FILTER_ON : FILTER_OFF}
              >
                {REVIEW_STATE_LABEL[value]} ({counts[value]})
              </Link>
            ))}
          </section>

          {/* The machine's first pass. It confirms nothing and publishes nothing. */}
          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-base font-semibold text-strong">Primera pasada automática</h2>
            <p className="mt-1 max-w-prose text-sm text-muted">
              Propone un tema por palabras clave, de forma determinista. No confirma nada y no
              publica nada.
            </p>
            <form action={generateSuggestions} className="mt-3">
              <input type="hidden" name="study_id" value={studyId} />
              {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
              <button className="min-h-11 rounded-lg border border-sky-line bg-sky-surface px-4 py-2 text-sm font-semibold text-strong hover:brightness-[0.98]">
                Generar sugerencias pendientes
              </button>
            </form>
          </section>

          {view.total === 0 ? (
            <StateBlock title="Ninguna observación en ese estado">
              <p>
                Cambia el filtro de arriba para ver las demás. Nada se perdió: solo estás mirando
                una parte.
              </p>
            </StateBlock>
          ) : (
            <form action={reviewObservations} className="space-y-4">
              <input type="hidden" name="study_id" value={studyId} />
              {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
              <QualitativeReview
                rows={workspace.rows}
                themes={workspace.themes}
                stages={stages}
                pager={
                  <Pager
                    window={view}
                    basePath={basePath}
                    params={filterParams}
                    noun={{ one: "observación", many: "observaciones" }}
                    label="Paginación de observaciones"
                  />
                }
              />
            </form>
          )}
        </>
      )}
    </div>
  );
}
