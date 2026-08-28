import { formatPercent } from "@/lib/calc/format";
import {
  ADVISOR_CONFIDENCE,
  ADVISOR_DECISION,
  ADVISOR_RISK,
  DECISION_LABEL,
  DECISION_TONE,
  RULE_BADGE,
  RULE_REASON,
  SOURCE_LABEL,
  STRENGTH_NOTE,
  WARNING_TEXT,
  answers,
  groupingConsequence,
  people,
  separateConsequence,
  undoConsequence,
} from "@/lib/categories/language";
import type { CategoryCandidateView, CategoryDimensionView } from "@/lib/categories/load";
import type { AdvisorOutcome } from "@/lib/categories/advisor/provider";
import {
  consultCategoryAdvisor,
  recordCategoryDecision,
} from "@/app/studio/e/[studyId]/categorias/actions";

/**
 * "Revisar categorías" — the screen where a person decides whether two
 * differently written answers are one answer.
 *
 * IT IS A SERVER COMPONENT, AND THAT IS THE ACCESSIBILITY DECISION, NOT A
 * PERFORMANCE ONE. The name of the final category is typed into an uncontrolled
 * `<input defaultValue>` inside a plain form. There is no React state behind
 * it, so there is no re-render while somebody types, so there is nothing that
 * can move focus or drop the caret — the failure this repository has already
 * paid for once in the journey editor, where a row keyed by the value being
 * typed was replaced on every keystroke. Nothing is validated per keystroke
 * either: the rules are explained beside the field before the click and
 * enforced by the server after it.
 *
 * ONE FORM PER CANDIDATE. Each card submits alone. There is no shared
 * selection, no "apply to all", and no way for a decision about one pair to
 * carry an unnoticed decision about another. Batch review on this screen means
 * "the next card is already on screen", not "one click decides six things" —
 * a merge is an editorial judgement and it is made one at a time on purpose.
 *
 * NARROW SCREENS GET CARDS, WIDE ONES GET COLUMNS. The before/after counts sit
 * one above the other under about 640 px and side by side above it, and every
 * control is at least 44 px tall. Nothing is inside a horizontal scroller and
 * nothing is hidden behind a hover.
 *
 * PROGRESSIVE DISCLOSURE IS NATIVE. The examples, the affected surfaces and the
 * postpone reason are `<details>` elements: keyboard operable, announced by
 * screen readers, and functional before any JavaScript loads.
 */

const CARD = "rounded-xl border border-line bg-surface p-4 sm:p-5";
const FIELD =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] sm:w-auto";
const SECONDARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken sm:w-auto";
const QUIET =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-line bg-surface-sunken px-4 py-2.5 text-sm font-medium text-body hover:bg-surface sm:w-auto";

const TONE_BOX = {
  positive: "border-positive-line bg-positive-surface text-positive",
  caution: "border-caution-line bg-caution-surface text-caution",
  neutral: "border-line bg-surface-sunken text-body",
} as const;

function share(count: number, total: number): string {
  if (total <= 0) return "—";
  // Rounded exactly once, here, at the presentation boundary
  // (docs/CALCULATION_POLICY.md §4). Never with toFixed.
  return `${formatPercent((count / total) * 100)}%`;
}

export function CategoryReview({
  studyId,
  returnTo,
  queue,
  decided,
  dimensions,
  advisor,
  verdicts,
}: {
  studyId: string;
  returnTo: string;
  queue: CategoryCandidateView[];
  decided: CategoryCandidateView[];
  dimensions: CategoryDimensionView[];
  advisor: { enabled: boolean; detail: string; model?: string };
  /** Opinions already obtained in this server, keyed by characteristic + group. */
  verdicts: Record<string, AdvisorOutcome>;
}) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="pendientes" className="space-y-4">
        <div>
          <h2 id="pendientes" className="text-base font-semibold text-strong">
            Por decidir
          </h2>
          <p className="mt-1 max-w-prose text-sm text-body">
            {queue.length === 0
              ? "No hay nada por decidir. El producto no encontró respuestas que puedan ser la misma escritas de otra forma."
              : `${queue.length === 1 ? "Hay 1 pareja" : `Hay ${queue.length} parejas`} de respuestas que podrían ser la misma. Están ordenadas por lo que cambiarían, no por lo parecidas que son.`}
          </p>
        </div>

        {queue.map((candidate, index) => (
          <CandidateCard
            // The group key is derived from the ANSWERS, not from anything on
            // screen: it does not change while the final name is being typed,
            // so React never replaces this card mid-edit.
            key={`${candidate.group.dimensionKey}::${candidate.group.groupKey}`}
            index={index}
            studyId={studyId}
            returnTo={returnTo}
            candidate={candidate}
            dimension={dimensions.find((entry) => entry.key === candidate.group.dimensionKey) ?? null}
            advisor={advisor}
            verdict={verdicts[`${candidate.group.dimensionKey}::${candidate.group.groupKey}`] ?? null}
          />
        ))}
      </section>

      {decided.length > 0 ? (
        <section aria-labelledby="decididas" className="space-y-4">
          <h2 id="decididas" className="text-base font-semibold text-strong">
            Ya decididas
          </h2>
          <p className="max-w-prose text-sm text-body">
            Todo lo que se decide queda aquí, con quién lo decidió y cuándo. Deshacer no borra
            nada: escribe una decisión nueva encima.
          </p>
          {decided.map((candidate) => (
            <DecidedCard
              key={`${candidate.group.dimensionKey}::${candidate.group.groupKey}`}
              studyId={studyId}
              returnTo={returnTo}
              candidate={candidate}
            />
          ))}
        </section>
      ) : null}

      <ManualGrouping studyId={studyId} returnTo={returnTo} dimensions={dimensions} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One undecided candidate
// ---------------------------------------------------------------------------

function CandidateCard({
  index,
  studyId,
  returnTo,
  candidate,
  dimension,
  advisor,
  verdict,
}: {
  index: number;
  studyId: string;
  returnTo: string;
  candidate: CategoryCandidateView;
  dimension: CategoryDimensionView | null;
  advisor: { enabled: boolean; detail: string; model?: string };
  verdict: AdvisorOutcome | null;
}) {
  const { group, impact } = candidate;
  // A DOM id only has to be unique inside this document. The position is, and
  // deriving it from the category text would put arbitrary user content into an
  // attribute for no benefit.
  const headingId = `categoria-${index}`;
  const dimensionTotal = candidate.distributionBefore.reduce((total, row) => total + row.count, 0);
  const rawMembers = group.values.map((value) => value.raw);
  const source = group.rule === "fuzzy" ? "fuzzy" : "deterministic";

  return (
    <article className={CARD} aria-labelledby={headingId}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={headingId} className="text-sm font-semibold text-strong">
            <span className="text-muted">{dimension?.label || group.dimensionKey} · </span>
            {group.values.map((value) => value.raw).join("  ·  ")}
          </h3>
          <p className="mt-1 text-xs text-muted">{RULE_BADGE[group.rule]}</p>
        </div>
        <span className="shrink-0 rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-body">
          {people(impact.affectedRespondents)}
        </span>
      </header>

      <p className="mt-3 text-sm text-body">{RULE_REASON[group.rule]}</p>
      <p className="mt-1.5 text-sm text-body">{STRENGTH_NOTE[group.strength]}</p>

      {group.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {group.warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-xs text-caution"
            >
              {WARNING_TEXT[warning]}
            </li>
          ))}
        </ul>
      ) : null}

      {candidate.memory.length > 0 ? (
        <div className="mt-3 rounded-lg border border-sky-line bg-sky-surface px-3 py-2.5 text-sm">
          <p className="font-medium text-strong">{candidate.memory[0].provenance}</p>
          {candidate.memory[0].revalidation ? (
            <p className="mt-1 text-caution">{candidate.memory[0].revalidation}</p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            Es una referencia, no una decisión. Aquí hay que decidirlo otra vez.
          </p>
        </div>
      ) : null}

      <BeforeAfter candidate={candidate} total={dimensionTotal} />

      <details className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
        <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-medium text-strong">
          ¿Qué cambiaría si las agrupo?
        </summary>
        <p className="mt-1 text-sm text-body">
          {groupingConsequence({
            members: group.values.length,
            affected: impact.affectedRespondents,
            moved: impact.movedRespondents,
            label: group.suggestedLabel,
            categoriesBefore: impact.categoriesBefore,
            categoriesAfter: impact.categoriesAfter,
          })}
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {impact.surfaces.map((surface) => (
            <li key={surface.id} className="text-sm">
              <span className="font-medium text-strong">{surface.label}</span>
              {surface.clientFacing ? (
                <span className="ml-1.5 rounded-full border border-caution-line bg-caution-surface px-1.5 py-0.5 text-xs text-caution">
                  lo ve el cliente
                </span>
              ) : null}
              <span className="block text-body">{surface.detail}</span>
            </li>
          ))}
        </ul>
        {impact.narrativeMentions.length > 0 ? (
          <p className="mt-2.5 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
            Estas palabras aparecen tal cual en la lectura que el equipo ya publicó:{" "}
            {impact.narrativeMentions.join(", ")}. Revísala después de decidir.
          </p>
        ) : null}
      </details>

      <p className="mt-3 text-xs text-muted">{SOURCE_LABEL[source]}</p>

      <AdvisorPanel
        studyId={studyId}
        returnTo={returnTo}
        dimensionKey={group.dimensionKey}
        members={rawMembers}
        advisor={advisor}
        verdict={verdict}
      />

      {/*
        One form, one candidate, four buttons. The final name is an uncontrolled
        input: nothing re-renders while it is typed, so the caret cannot move.
      */}
      <form action={recordCategoryDecision} className="mt-4 border-t border-line pt-4">
        <input type="hidden" name="study_id" value={studyId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="dimension_key" value={group.dimensionKey} />
        {rawMembers.map((raw) => (
          <input key={raw} type="hidden" name="member" value={raw} />
        ))}
        <input type="hidden" name="suggestion_source" value={source} />

        <label className="block text-sm font-medium text-strong">
          Si las agrupas, ¿cómo se llamará la categoría?
          <input
            className={`${FIELD} mt-1.5 font-normal`}
            name="canonical_label"
            defaultValue={group.suggestedLabel}
            maxLength={200}
            autoComplete="off"
          />
          <span className="mt-1 block text-xs text-muted">
            Se propone la redacción que más gente usó. Puedes escribir otra.
          </span>
        </label>

        <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
          <button type="submit" name="decision" value="grouped" className={PRIMARY}>
            Agrupar
          </button>
          <button type="submit" name="decision" value="separate" className={SECONDARY}>
            Mantener separadas
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">{separateConsequence(group.values.length)}</p>

        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-medium text-evidence underline-offset-4 hover:underline">
            Posponer y explicar por qué
          </summary>
          <label className="mt-1.5 block text-sm font-medium text-strong">
            ¿Por qué queda pendiente?
            <textarea
              className={`${FIELD} mt-1.5 min-h-[5.5rem] font-normal`}
              name="reason"
              maxLength={400}
              rows={3}
              placeholder="Falta confirmar con quien redactó el cuestionario de bajas."
            />
            <span className="mt-1 block text-xs text-muted">
              Se guarda con tu nombre para que otra persona pueda retomarlo. Mínimo 10 caracteres.
            </span>
          </label>
          <button type="submit" name="decision" value="postponed" className={`${QUIET} mt-2.5`}>
            Posponer
          </button>
        </details>
      </form>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Before / after
// ---------------------------------------------------------------------------

function BeforeAfter({
  candidate,
  total,
}: {
  candidate: CategoryCandidateView;
  total: number;
}) {
  const members = new Set(candidate.group.values.map((value) => value.raw));
  return (
    <details className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-medium text-strong">
        Ver los conteos antes y después
      </summary>
      <div className="mt-1 grid gap-4 sm:grid-cols-2">
        <CountList
          title="Ahora"
          rows={candidate.distributionBefore}
          total={total}
          highlight={members}
        />
        <CountList
          title="Si se agrupan"
          rows={candidate.distributionAfter}
          total={total}
          highlight={new Set([candidate.group.suggestedLabel])}
        />
      </div>
      <p className="mt-2 text-xs text-muted">
        El total sigue siendo {people(total)}. Agrupar cambia cómo se reparten, nunca cuántas son.
      </p>
    </details>
  );
}

function CountList({
  title,
  rows,
  total,
  highlight,
}: {
  title: string;
  rows: { raw: string; count: number }[];
  total: number;
  highlight: ReadonlySet<string>;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li
            key={row.raw}
            className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded px-1.5 py-1 text-sm ${
              highlight.has(row.raw) ? "bg-evidence-surface font-medium text-strong" : "text-body"
            }`}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{row.raw}</span>
            <span className="tabular shrink-0 text-muted">
              {row.count} · {share(row.count, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The advisor
// ---------------------------------------------------------------------------

function AdvisorPanel({
  studyId,
  returnTo,
  dimensionKey,
  members,
  advisor,
  verdict,
}: {
  studyId: string;
  returnTo: string;
  dimensionKey: string;
  members: readonly string[];
  advisor: { enabled: boolean; detail: string; model?: string };
  verdict: AdvisorOutcome | null;
}) {
  if (!advisor.enabled) return null;

  if (verdict?.ok) {
    return (
      <div className="mt-3 rounded-lg border border-voice-line bg-voice-surface px-3 py-2.5">
        <p className="text-sm font-medium text-strong">
          Asistente: {ADVISOR_DECISION[verdict.verdict.decision] ?? "sin opinión"}
        </p>
        <p className="mt-1 text-sm text-body">{verdict.verdict.conciseReason}</p>
        <p className="mt-1 text-xs text-muted">
          {ADVISOR_CONFIDENCE[verdict.verdict.confidence]} ·{" "}
          {ADVISOR_RISK[verdict.verdict.semanticRisk]}
        </p>
        {verdict.verdict.warning ? (
          <p className="mt-1.5 text-sm text-caution">{verdict.verdict.warning}</p>
        ) : null}
        <p className="mt-2 text-xs text-muted">
          Es una opinión, no una decisión. Nada se agrupa hasta que tú lo elijas.
        </p>
      </div>
    );
  }

  return (
    <form action={consultCategoryAdvisor} className="mt-3">
      <input type="hidden" name="study_id" value={studyId} />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="hidden" name="dimension_key" value={dimensionKey} />
      {members.map((raw) => (
        <input key={raw} type="hidden" name="member" value={raw} />
      ))}
      <button type="submit" className={QUIET}>
        Pedir opinión al asistente
      </button>
      {verdict && !verdict.ok ? (
        <p role="status" className="mt-1.5 text-xs text-muted">
          {verdict.message}
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// A decision already taken
// ---------------------------------------------------------------------------

function DecidedCard({
  studyId,
  returnTo,
  candidate,
}: {
  studyId: string;
  returnTo: string;
  candidate: CategoryCandidateView;
}) {
  const decision = candidate.decided;
  if (!decision) return null;
  const tone = DECISION_TONE[decision.decision] ?? "neutral";
  const rawMembers = candidate.group.values.map((value) => value.raw);

  return (
    <article className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-strong">
            <span className="text-muted">{candidate.group.dimensionKey} · </span>
            {candidate.group.values.map((value) => value.raw).join("  ·  ")}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {answers(candidate.group.values.length)} · versión {decision.version} ·{" "}
            {decision.decidedAt.slice(0, 10)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_BOX[tone]}`}>
          {DECISION_LABEL[decision.decision]}
          {decision.canonicalLabel ? `: ${decision.canonicalLabel}` : ""}
        </span>
      </div>

      {decision.reason ? (
        <p className="mt-2.5 text-sm text-body">
          <span className="text-muted">Motivo anotado: </span>
          {decision.reason}
        </p>
      ) : null}

      {candidate.memoryConflict ? (
        <p className="mt-2.5 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
          {candidate.memoryConflict}
        </p>
      ) : null}

      <form action={recordCategoryDecision} className="mt-3">
        <input type="hidden" name="study_id" value={studyId} />
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="dimension_key" value={candidate.group.dimensionKey} />
        {rawMembers.map((raw) => (
          <input key={raw} type="hidden" name="member" value={raw} />
        ))}
        <input type="hidden" name="suggestion_source" value="manual" />
        <input type="hidden" name="decision" value="revoked" />
        <p className="text-sm text-body">{undoConsequence(decision.canonicalLabel)}</p>
        <button type="submit" className={`${SECONDARY} mt-2.5`}>
          Deshacer esta decisión
        </button>
      </form>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Grouping two answers the scan did not raise
// ---------------------------------------------------------------------------

/**
 * The escape hatch, and the reason it exists.
 *
 * The scan finds resemblances. It cannot find "Seguros" and "Aseguradoras",
 * which share no words and are obviously one line of business to anybody who
 * knows the chapter. Without this, the product would be telling a consultant
 * that its own detector defines what is groupable — so the full value list is
 * offered, with counts, and a person may group any two of them.
 *
 * It is a `<select multiple>`: native, keyboard operable, announced correctly,
 * and it works at 360 px without a custom widget.
 */
function ManualGrouping({
  studyId,
  returnTo,
  dimensions,
}: {
  studyId: string;
  returnTo: string;
  dimensions: CategoryDimensionView[];
}) {
  const usable = dimensions.filter((dimension) => dimension.values.length >= 2);
  if (usable.length === 0) return null;

  return (
    <section aria-labelledby="agrupar-a-mano" className="space-y-4">
      <div>
        <h2 id="agrupar-a-mano" className="text-base font-semibold text-strong">
          Agrupar dos respuestas por tu cuenta
        </h2>
        <p className="mt-1 max-w-prose text-sm text-body">
          El producto solo detecta parecidos de escritura. Si dos respuestas significan lo mismo
          sin parecerse, agrúpalas aquí.
        </p>
      </div>

      {usable.map((dimension) => (
        <details key={dimension.key} className={CARD}>
          <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-strong">
            {dimension.label || dimension.key}
            <span className="ml-2 font-normal text-muted">
              {answers(dimension.values.length)} distintas
            </span>
          </summary>

          <form action={recordCategoryDecision} className="mt-3 space-y-3">
            <input type="hidden" name="study_id" value={studyId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <input type="hidden" name="dimension_key" value={dimension.key} />
            <input type="hidden" name="suggestion_source" value="manual" />
            <input type="hidden" name="decision" value="grouped" />

            {/*
              Checkboxes, not a multi-select and not a text field. A person
              picking two of forty answers should not have to hold a modifier
              key, and should never have to retype a value the product already
              knows — retyping is how "Legal y Contable" becomes a forty-first
              answer. Each box is its own 44 px target and reads correctly to a
              screen reader without a single line of JavaScript.
            */}
            <fieldset className="border-0 p-0">
              <legend className="text-sm font-medium text-strong">
                Elige dos o más respuestas
              </legend>
              <ul className="mt-1.5 space-y-1">
                {dimension.values.map((value) => (
                  <li key={value.raw}>
                    <label className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-body has-[:checked]:bg-evidence-surface">
                      <input
                        type="checkbox"
                        name="member"
                        value={value.raw}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{value.raw}</span>
                      <span className="tabular ml-auto shrink-0 text-muted">{value.count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>

            <label className="block text-sm font-medium text-strong">
              Nombre de la categoría final
              <input className={`${FIELD} mt-1.5 font-normal`} name="canonical_label" maxLength={200} />
            </label>

            <button type="submit" className={PRIMARY}>
              Agrupar estas respuestas
            </button>
          </form>
        </details>
      ))}
    </section>
  );
}
