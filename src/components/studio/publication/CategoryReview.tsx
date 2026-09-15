"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  CATEGORY_REVIEW_LIMITS,
  candidateImpact,
  foldCategoryLabel,
  shareOf,
} from "@/lib/category-review";
import type {
  CategoryCandidate,
  CategoryDecisionOutcome,
  CategoryDisposition,
  CategoryFamilyPanel,
  CategoryReviewPanel,
  RecordCategoryDecision,
} from "@/lib/category-review";

/**
 * «REVISAR CATEGORÍAS», CANONICAL — where a person decides whether the same
 * answer arrived written two ways.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS WRITTEN FOR A CONSULTANT, NOT FOR AN ENGINEER.
 *
 * Every word is Spanish somebody says out loud. There is no handle printed, no
 * digest, no uuid, no enum and no database identifier — the family key never
 * appears on screen, only the family's own title. What arrives is a list of
 * category labels, counts the server made, four closed words and one short
 * opaque marker per family.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE MERGES ANYTHING, AND NO NUMBER ON IT IS AUTHORITATIVE.
 *
 * A candidate is a QUESTION. The before/after figures beside it are a PREVIEW
 * of what a grouping would do, computed from counts the server supplied; the
 * numbers a client ever sees are recomputed on the server from the evidence
 * after the decision is recorded, and this screen re-reads them. There is no
 * field anywhere in which a browser could send a count, and nothing here is
 * believed about one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE DECISION AT A TIME, AND THE NAME IS UNCONTROLLED.
 *
 * Each card decides alone. There is no shared selection, no «apply to all», and
 * no way for a decision about one pair to carry an unnoticed decision about
 * another — a merge is an editorial judgement and it is made one at a time on
 * purpose.
 *
 * The final name is an UNCONTROLLED `<input defaultValue>`: no React state is
 * behind it, so there is no re-render while somebody types and nothing that can
 * move focus or drop the caret. This repository has paid for that failure once,
 * in the journey editor, where a row keyed by the value being typed was replaced
 * on every keystroke.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THERE IS NO ASSISTANT.
 *
 * No model, no provider, no suggestion from one and no control that would
 * consult one. The legacy screen this replaces carried an optional advisor
 * behind a flag whose own acceptance criteria were never met; qualitative
 * editing here is human-controlled, and the absence is structural rather than
 * configured.
 */

const CARD =
  "rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const FIELD =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-strong";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-strong px-4 py-2.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-40";
const GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40";
const QUIET =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2.5 text-sm font-medium text-muted underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-40";

const DISPOSITION_LABEL: Record<CategoryDisposition, string> = {
  grouped: "Se cuentan como una sola",
  separate: "Se dejan separadas",
  postponed: "Queda pendiente",
  revoked: "Se deshizo",
};

const RULE_BADGE: Record<string, string> = {
  unicode: "Se leen igual en pantalla",
  case_whitespace: "Mayúsculas o espacios",
  accent: "Acentos",
  punctuation: "Puntuación",
  fuzzy: "Redacción parecida",
};

const WARNING_TEXT: Record<string, string> = {
  numeric_labels: "Alguna de estas respuestas es un número o un rango, no una frase.",
  single_answer: "Cada una la eligió una sola persona.",
  long_labels: "Alguna es muy larga para ser una categoría.",
  many_members: "Son más de tres categorías a la vez.",
  ordinal_neighbours:
    "Se diferencian en un número. En una escala, eso suele ser dos respuestas distintas.",
};

const percent = (value: number) => `${Math.round(value * 100)} %`;
const answers = (count: number) => (count === 1 ? "1 respuesta" : `${count} respuestas`);

export function CategoryReview({
  studyId,
  panel,
  decide,
}: {
  studyId: string;
  panel: CategoryReviewPanel;
  decide: RecordCategoryDecision;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<{ id: string; result: CategoryDecisionOutcome } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const submit = (
    id: string,
    input: {
      familyKey: string;
      memberLabels: string[];
      disposition: CategoryDisposition;
      canonicalLabel: string | null;
      rationale: string | null;
      expectedVersion: number;
    },
  ) => {
    startTransition(async () => {
      const result = await decide(studyId, input);
      setOutcome({ id, result });
      // THE SCREEN NEVER PREDICTS THE ANSWER. Every count, every candidate and
      // every decided group is read again from the server, which has just
      // recomputed them from the evidence.
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-5" data-testid="revisar-categorias">
      {/* 1 ─ WHAT NEVER HAPPENS HERE. --------------------------------------- */}
      <section className={CARD} aria-labelledby="categorias-garantias">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Sólo interno · no lo ve el cliente
        </p>
        <h2
          id="categorias-garantias"
          className="mt-1 font-display text-base font-semibold text-strong"
        >
          Lo que nunca pasa aquí
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-body">
          <li>
            Los datos que se importaron no se tocan. Agrupar cambia cómo se cuentan al leerlos, no
            lo que quedó guardado, así que la comparación con los archivos originales sigue siendo
            exacta.
          </li>
          <li>
            El total de respuestas no cambia nunca. Solo cambia en cuántas categorías se reparten.
          </li>
          <li>
            Nada se agrupa solo. El producto señala parecidos de escritura; agrupar es siempre una
            decisión de una persona, queda con su nombre y se puede deshacer.
          </li>
          <li>
            Si cambias una categoría, la revisión cualitativa que alguien firmó deja de estar al
            día: se firmó sobre un conjunto exacto de palabras y ese conjunto ya no es el mismo.
            Habrá que volver a registrarla en Revisión y publicación antes de publicar.
          </li>
        </ul>
        <dl
          className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr))]"
          data-testid="categorias-conteos"
        >
          {(
            [
              ["Familias", panel.counts.families],
              ["Por decidir", panel.counts.candidates],
              ["Detienen publicación", panel.counts.blocking],
              ["Decididas", panel.counts.decided],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-md border border-line bg-surface-sunken px-3 py-2">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
                {label}
              </dt>
              <dd className="mt-0.5 font-display text-xl font-bold text-strong tabular">{count}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 2 ─ WHETHER THIS ENVIRONMENT CAN RECORD ANYTHING AT ALL. ----------- */}
      {panel.canDecide ? null : (
        <section
          className="rounded-xl border border-caution-line bg-caution-surface p-5"
          data-testid="categorias-sin-historial"
        >
          <h2 className="font-display text-base font-semibold text-caution">
            Aquí todavía no se puede decidir
          </h2>
          <p className="mt-1.5 max-w-prose text-sm text-caution">
            En este entorno falta aplicar la migración que crea el historial de decisiones de
            categorías. Las categorías se ven tal como están y los conteos son los de siempre;
            guardar una decisión queda para cuando esté aplicada.
          </p>
        </section>
      )}

      {/* 3 ─ ONE SECTION PER FAMILY. ---------------------------------------- */}
      {panel.families.map((entry) => (
        <FamilySection
          key={entry.family.key}
          entry={entry}
          canDecide={panel.canDecide}
          pending={pending}
          outcome={outcome}
          submit={submit}
        />
      ))}

      {panel.families.length === 0 ? (
        <section className={CARD} data-testid="categorias-no-aplica">
          <h2 className="font-display text-base font-semibold text-strong">
            Este estudio no trae categorías cualitativas
          </h2>
          <p className="mt-1.5 max-w-prose text-sm text-muted">
            Su material de origen no incluye preguntas con una lista de categorías, así que no hay
            nada que revisar aquí.
          </p>
        </section>
      ) : null}
    </div>
  );
}

type Submit = (
  id: string,
  input: {
    familyKey: string;
    memberLabels: string[];
    disposition: CategoryDisposition;
    canonicalLabel: string | null;
    rationale: string | null;
    expectedVersion: number;
  },
) => void;

function Outcome({
  id,
  outcome,
}: {
  id: string;
  outcome: { id: string; result: CategoryDecisionOutcome } | null;
}) {
  if (!outcome || outcome.id !== id) return null;
  if (outcome.result.ok) {
    return (
      <p className="mt-2 text-sm text-positive" data-testid="categoria-guardada">
        {outcome.result.created
          ? "Guardado. Los conteos de abajo ya son los nuevos."
          : "Esa misma decisión ya estaba registrada, así que no se escribió otra vez."}
      </p>
    );
  }
  return (
    <p className="mt-2 text-sm text-danger" data-testid="categoria-rechazada">
      {outcome.result.detail}
    </p>
  );
}

function FamilySection({
  entry,
  canDecide,
  pending,
  outcome,
  submit,
}: {
  entry: CategoryFamilyPanel;
  canDecide: boolean;
  pending: boolean;
  outcome: { id: string; result: CategoryDecisionOutcome } | null;
  submit: Submit;
}) {
  const { family } = entry;
  const blocking = entry.findings.filter((finding) => finding.verdict === "blocks");

  return (
    <section className={CARD} data-testid="familia-categorias">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Sólo interno · no lo ve el cliente
      </p>
      <h2 className="mt-1 font-display text-base font-semibold text-strong">{family.label}</h2>
      <p className="mt-1.5 max-w-prose text-sm text-muted">
        {family.sourceDescription}
        {family.coding === "source_coded"
          ? " · Son las categorías tal como las codificó el propio estudio."
          : " · Son categorías que escribió el equipo de Be Community."}
      </p>
      <p className="mt-1 text-xs text-muted" data-testid="familia-version">
        Versión de esta lista: {entry.sourceVersion}
      </p>

      {/* What a client would see now. */}
      <h3 className="mt-4 text-sm font-semibold text-strong">Cómo se cuentan ahora</h3>
      <ul className="mt-2 space-y-1" data-testid="categorias-actuales">
        {family.terms.map((term) => (
          <li key={term.label} className="flex justify-between gap-3 text-sm text-body">
            <span>{term.label}</span>
            <span className="tabular text-muted">
              {term.count} · {percent(shareOf(term.count, family.total))}
            </span>
          </li>
        ))}
      </ul>
      {family.excluded.length > 0 ? (
        <ul className="mt-2 space-y-1" data-testid="categorias-excluidas">
          {family.excluded.map((excluded) => (
            <li key={excluded.label} className="flex justify-between gap-3 text-sm text-muted">
              <span>{excluded.label} · fuera de la nube</span>
              <span className="tabular">{excluded.count}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {entry.scan.boundNote ? (
        <p className="mt-3 max-w-prose text-sm text-caution">{entry.scan.boundNote}</p>
      ) : null}

      {blocking.length > 0 ? (
        <div
          className="mt-4 rounded-lg border border-danger-line bg-danger-surface p-4"
          data-testid="categorias-bloqueantes"
        >
          <h3 className="text-sm font-semibold text-danger">
            Esto impide publicar hasta que lo decidas
          </h3>
          <ul className="mt-2 space-y-2">
            {blocking.map((finding) => (
              <li key={finding.memberFolds.join("|")}>
                <p className="text-sm font-semibold text-danger">{finding.summary}</p>
                <p className="text-sm text-danger">{finding.because}</p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-danger">
            Cualquiera de las tres decisiones lo resuelve: agruparlas, dejarlas separadas, o
            posponerlo explicando por qué.
          </p>
        </div>
      ) : null}

      {/* Candidates. */}
      <h3 className="mt-5 text-sm font-semibold text-strong">Por decidir</h3>
      {entry.candidates.length === 0 ? (
        <p className="mt-1.5 max-w-prose text-sm text-muted" data-testid="categorias-sin-candidatos">
          El producto no encontró respuestas que puedan ser la misma escrita de otra forma. Si tú
          ves dos que significan lo mismo sin parecerse, agrúpalas abajo.
        </p>
      ) : (
        <ul className="mt-2 space-y-4">
          {entry.candidates.map((candidate) => (
            <li key={candidate.memberFolds.join("|")}>
              <CandidateCard
                entry={entry}
                candidate={candidate}
                canDecide={canDecide}
                pending={pending}
                outcome={outcome}
                submit={submit}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Manual grouping. */}
      <ManualGrouping
        entry={entry}
        canDecide={canDecide}
        pending={pending}
        outcome={outcome}
        submit={submit}
      />

      {/* Decided. */}
      <h3 className="mt-5 text-sm font-semibold text-strong">Ya decididas</h3>
      {entry.decided.length === 0 ? (
        <p className="mt-1.5 max-w-prose text-sm text-muted">
          Todo lo que se decide queda aquí, con la fecha. Deshacer no borra nada: escribe una
          decisión nueva encima.
        </p>
      ) : (
        <ul className="mt-2 space-y-3" data-testid="categorias-decididas">
          {entry.decided.map((decided) => {
            const id = `decidida:${family.key}:${decided.memberFolds.join("|")}`;
            return (
              <li key={id} className="rounded-lg border border-line bg-surface-sunken p-3">
                <p className="text-sm font-semibold text-strong">
                  {decided.canonicalLabel ?? decided.memberLabels.join(" · ")}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {decided.memberLabels.join(" · ")} · {DISPOSITION_LABEL[decided.disposition]} ·
                  versión {decided.version} · {decided.decidedAt.slice(0, 10)}
                </p>
                {decided.rationale ? (
                  <p className="mt-1 text-sm text-body">Motivo anotado: {decided.rationale}</p>
                ) : null}
                {decided.freshness === "context_changed" ? (
                  <p className="mt-1 text-sm text-caution">
                    Se decidió sobre una lista de categorías que desde entonces cambió. Conviene
                    repasarla antes de publicar.
                  </p>
                ) : null}
                {decided.freshness === "member_absent" ? (
                  <p className="mt-1 text-sm text-caution">
                    Alguna de esas respuestas ya no está en el estudio. La decisión se conserva
                    igual: era correcta cuando se tomó.
                  </p>
                ) : null}
                {decided.disposition !== "revoked" && canDecide ? (
                  <button
                    type="button"
                    className={`${QUIET} mt-1`}
                    disabled={pending}
                    data-testid="deshacer-categoria"
                    onClick={() =>
                      submit(id, {
                        familyKey: family.key,
                        memberLabels: decided.memberLabels,
                        disposition: "revoked",
                        canonicalLabel: null,
                        rationale: null,
                        expectedVersion: decided.version,
                      })
                    }
                  >
                    Deshacer esta decisión
                  </button>
                ) : null}
                <Outcome id={id} outcome={outcome} />
              </li>
            );
          })}
        </ul>
      )}

      {entry.memory.length > 0 ? (
        <div className="mt-4 rounded-lg border border-line bg-surface-sunken p-3" data-testid="categorias-memoria">
          <h3 className="text-sm font-semibold text-strong">En otro estudio de este cliente</h3>
          <ul className="mt-1.5 space-y-1">
            {entry.memory.map((recalled) => (
              <li key={`${recalled.memberFolds.join("|")}${recalled.decidedAt}`} className="text-sm text-muted">
                {recalled.memberFolds.join(" · ")} — {DISPOSITION_LABEL[recalled.disposition]}
                {recalled.canonicalLabel ? ` como «${recalled.canonicalLabel}»` : ""} ·{" "}
                {recalled.decidedAt.slice(0, 10)}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 max-w-prose text-sm text-muted">
            Es lo que se decidió allá, no aquí. No se aplica solo y este estudio no cambia por ello.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CandidateCard({
  entry,
  candidate,
  canDecide,
  pending,
  outcome,
  submit,
}: {
  entry: CategoryFamilyPanel;
  candidate: CategoryCandidate;
  canDecide: boolean;
  pending: boolean;
  outcome: { id: string; result: CategoryDecisionOutcome } | null;
  submit: Submit;
}) {
  const { family } = entry;
  const id = `candidata:${family.key}:${candidate.memberFolds.join("|")}`;
  const [name, setName] = useState(candidate.suggestedLabel);
  const [reason, setReason] = useState("");
  const impact = candidateImpact(family, candidate.memberFolds, name || candidate.suggestedLabel);
  const labels = candidate.values.map((value) => value.label);
  const version =
    entry.decided.find(
      (decided) => decided.memberFolds.join("|") === candidate.memberFolds.join("|"),
    )?.version ?? 0;

  return (
    <div className="rounded-lg border border-line p-4" data-testid="categoria-candidata">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
        {RULE_BADGE[candidate.rule] ?? "Parecido"}
      </p>
      <h4 className="mt-1 text-sm font-semibold text-strong">{labels.join(" · ")}</h4>
      <p className="mt-1 text-sm text-muted">
        {answers(candidate.affectedCount)} en total ·{" "}
        {percent(shareOf(candidate.affectedCount, family.total))} de esta familia
      </p>
      {candidate.warnings.length > 0 ? (
        <ul className="mt-1.5 space-y-1">
          {candidate.warnings.map((warning) => (
            <li key={warning} className="text-sm text-caution">
              {WARNING_TEXT[warning] ?? warning}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">Ahora</h5>
          <ul className="mt-1 space-y-0.5">
            {impact.before.map((value) => (
              <li key={value.label} className="flex justify-between gap-3 text-sm text-body">
                <span>{value.label}</span>
                <span className="tabular text-muted">{value.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted">Si se agrupan</h5>
          <p className="mt-1 flex justify-between gap-3 text-sm text-body">
            <span>{impact.after.label}</span>
            <span className="tabular text-muted">{impact.after.count}</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            {impact.groupsBefore} categorías pasarían a {impact.groupsAfter}. El total de respuestas
            no cambia.
          </p>
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-strong">
        Cómo se va a llamar
        <input
          className={`${FIELD} mt-1 font-normal`}
          defaultValue={candidate.suggestedLabel}
          maxLength={CATEGORY_REVIEW_LIMITS.maxLabelLength}
          onBlur={(event) => setName(event.currentTarget.value)}
          data-testid="nombre-categoria"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={!canDecide || pending}
          data-testid="agrupar-categoria"
          onClick={() =>
            submit(id, {
              familyKey: family.key,
              memberLabels: labels,
              disposition: "grouped",
              canonicalLabel: name || candidate.suggestedLabel,
              rationale: null,
              expectedVersion: version,
            })
          }
        >
          Contarlas como una sola
        </button>
        <button
          type="button"
          className={GHOST}
          disabled={!canDecide || pending}
          data-testid="separar-categoria"
          onClick={() =>
            submit(id, {
              familyKey: family.key,
              memberLabels: labels,
              disposition: "separate",
              canonicalLabel: null,
              rationale: null,
              expectedVersion: version,
            })
          }
        >
          Dejarlas separadas
        </button>
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-muted">Posponerlo</summary>
        <label className="mt-2 block text-sm font-medium text-strong">
          Por qué queda pendiente
          <textarea
            className={`${FIELD} mt-1 font-normal`}
            rows={2}
            maxLength={CATEGORY_REVIEW_LIMITS.maxRationaleLength}
            placeholder="Falta confirmar con quien redactó el cuestionario."
            onBlur={(event) => setReason(event.currentTarget.value)}
            data-testid="motivo-categoria"
          />
        </label>
        <button
          type="button"
          className={`${QUIET} mt-2`}
          disabled={!canDecide || pending}
          data-testid="posponer-categoria"
          onClick={() =>
            submit(id, {
              familyKey: family.key,
              memberLabels: labels,
              disposition: "postponed",
              canonicalLabel: null,
              rationale: reason,
              expectedVersion: version,
            })
          }
        >
          Dejarlo pendiente
        </button>
      </details>

      <Outcome id={id} outcome={outcome} />
    </div>
  );
}

/**
 * The escape hatch, and the reason it exists.
 *
 * The scan finds resemblances of WRITING. It cannot find «Seguros» and
 * «Aseguradoras», which share no words and are obviously one line of business to
 * anybody who knows the chapter. Without this, the product would be telling a
 * consultant that its own detector defines what is groupable — so the full label
 * list is offered, with counts, and a person may group any two of them.
 *
 * It is a `<select multiple>`: native, keyboard operable, announced correctly,
 * and it works at 360 px without a custom widget.
 */
function ManualGrouping({
  entry,
  canDecide,
  pending,
  outcome,
  submit,
}: {
  entry: CategoryFamilyPanel;
  canDecide: boolean;
  pending: boolean;
  outcome: { id: string; result: CategoryDecisionOutcome } | null;
  submit: Submit;
}) {
  const { family } = entry;
  const id = `manual:${family.key}`;
  const [chosen, setChosen] = useState<string[]>([]);
  const [name, setName] = useState("");

  const decidedVersion =
    entry.decided.find(
      (decided) =>
        decided.memberFolds.join("|") ===
        [...new Set(chosen.map(foldCategoryLabel))].sort().join("|"),
    )?.version ?? 0;

  return (
    <div className="mt-5 rounded-lg border border-line bg-surface-sunken p-4" data-testid="agrupar-a-mano">
      <h3 className="text-sm font-semibold text-strong">Agrupar dos respuestas por tu cuenta</h3>
      <p className="mt-1 max-w-prose text-sm text-muted">
        El producto solo detecta parecidos de escritura. Si dos respuestas significan lo mismo sin
        parecerse, agrúpalas aquí.
      </p>
      <label className="mt-3 block text-sm font-medium text-strong">
        Respuestas ({family.sourceLabels.length})
        <select
          multiple
          size={Math.min(8, Math.max(3, family.sourceLabels.length))}
          className={`${FIELD} mt-1 font-normal`}
          data-testid="seleccion-manual"
          onChange={(event) =>
            setChosen([...event.currentTarget.selectedOptions].map((option) => option.value))
          }
        >
          {family.sourceLabels.map((value) => (
            <option key={value.label} value={value.label}>
              {value.label} — {value.count}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-2 block text-sm font-medium text-strong">
        Cómo se va a llamar
        <input
          className={`${FIELD} mt-1 font-normal`}
          maxLength={CATEGORY_REVIEW_LIMITS.maxLabelLength}
          onBlur={(event) => setName(event.currentTarget.value)}
          data-testid="nombre-manual"
        />
      </label>
      <button
        type="button"
        className={`${PRIMARY} mt-3`}
        disabled={!canDecide || pending || chosen.length < 2}
        data-testid="agrupar-manual"
        onClick={() =>
          submit(id, {
            familyKey: family.key,
            memberLabels: chosen,
            disposition: "grouped",
            canonicalLabel: name || chosen[0] || null,
            rationale: null,
            expectedVersion: decidedVersion,
          })
        }
      >
        Contarlas como una sola
      </button>
      <Outcome id={id} outcome={outcome} />
    </div>
  );
}
