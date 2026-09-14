"use client";

/**
 * «ACTUALIZAR VÍNCULO» — the one internal affordance that repairs a stale binding.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN MUST NOT MAKE ANYBODY BELIEVE.
 *
 * That anything is being recalculated, regenerated, rewritten or republished.
 * None of those happen. The stored document is left exactly as its author wrote
 * it — every page, block, filter, title, caption, sample policy and disclosure
 * level — and one opaque field that says WHICH registry build the document
 * answers for is recomputed on the server.
 *
 * So the copy below says «vínculo» and never «resultados», never «recalcular»,
 * never «actualizar los datos». An operator who reads this panel and concludes
 * the numbers were refreshed has been misled by it, and that would be this
 * component's fault rather than theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT SHOWS THE TWO DIGESTS.
 *
 * Because the operator is approving a change from one to the other, and a
 * change nobody can see is a change nobody can refuse. They are opaque and they
 * identify no person, tenant or study — they are SHA-256 over a registry's
 * handle-to-address map — so showing them costs nothing and turns «confía en
 * mí» into a fact somebody can write down and compare afterwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY THE COUNTS ARE HERE.
 *
 * «Se conserva todo» is a promise. «1 página, 24 bloques, política de muestra
 * "mostrar todo", divulgación "plain_language_with_base"» is a claim that can
 * be checked against the screen afterwards, which is the kind this product
 * prefers.
 */

import { useState, useTransition } from "react";

import type { SaveResult } from "@/lib/composer";

/**
 * The plan, as the server computed it.
 *
 * Declared here rather than imported from the server module for the reason the
 * composer payload types are: a `"use client"` module with a static import of
 * `@/lib/studio/presentation-workspace` would have a path into the canonical
 * read layer in the import graph, and the shadow-boundary gate refuses one.
 */
export type RebindPanelPlan = {
  storedRevision: number;
  supersededContractVersion: string;
  currentContractVersion: string;
  changes: { field: string; from: string; to: string }[];
  preserved: {
    title: string;
    pages: number;
    blocks: number;
    samplePolicyMode: string;
    methodologyDisclosure: string;
    authoredBytes: number;
    authoredDigest: string;
  };
};

const short = (digest: string) => (digest.length > 16 ? `${digest.slice(0, 16)}…` : digest);

/**
 * A retry key that is stable for as long as the panel is mounted.
 *
 * The whole point of the key is that pressing the button twice does not produce
 * two revisions. Minting a fresh one per click would defeat that precisely when
 * it matters — an impatient second press, a double-submit, a flaky connection —
 * so it is minted ONCE, when the panel appears, and reused by every attempt
 * against this stored revision.
 */
function mintKey(revision: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `rebind-r${revision}-${Date.now().toString(36)}-${random}`;
}

export function RebindPanel({
  studyId,
  plan,
  rebind,
}: {
  studyId: string;
  plan: RebindPanelPlan;
  rebind: (studyId: string, expectedRevision: number, idempotencyKey: string) => Promise<SaveResult>;
}) {
  const [key] = useState(() => mintKey(plan.storedRevision));
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const done = result?.ok === true;

  return (
    <section
      data-testid="panel-vinculo"
      className="mt-4 rounded-xl border border-evidence-line bg-evidence-surface p-5"
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Sólo interno · no lo ve el cliente
      </p>
      <h2 className="mt-1 font-display text-base font-semibold text-strong">
        Actualizar vínculo del borrador
      </h2>

      <p className="mt-1.5 max-w-prose text-sm text-body">
        El contrato de resultados pasó de <code>{plan.supersededContractVersion}</code> a{" "}
        <code>{plan.currentContractVersion}</code>. El vínculo guardado apuntaba al contrato
        anterior, y por eso esta pantalla no abre el borrador. <strong>No se recalcula ningún
        resultado y no se reescribe nada de lo que alguien compuso</strong>: se vuelve a calcular en
        el servidor el campo que dice a qué registro responde este documento, y se guarda como una
        revisión nueva.
      </p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Lo que cambia</dt>
          <dd className="mt-1 space-y-1">
            {plan.changes.map((change) => (
              <p key={change.field} className="text-body">
                <span className="font-medium text-strong">{change.field}</span>
                <br />
                <code className="text-xs text-muted">{short(change.from)}</code>
                {" → "}
                <code className="text-xs text-strong">{short(change.to)}</code>
              </p>
            ))}
            <p className="text-xs text-muted">
              Y nada más. La revisión pasa de {plan.storedRevision} a {plan.storedRevision + 1}.
            </p>
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
            Lo que se conserva
          </dt>
          <dd className="mt-1 space-y-0.5 text-body">
            <p>«{plan.preserved.title}»</p>
            <p>
              {plan.preserved.pages} página{plan.preserved.pages === 1 ? "" : "s"},{" "}
              {plan.preserved.blocks} bloques
            </p>
            <p>Política de muestra: {plan.preserved.samplePolicyMode}</p>
            <p>Divulgación: {plan.preserved.methodologyDisclosure}</p>
            <p className="text-xs text-muted">
              {plan.preserved.authoredBytes} bytes compuestos, huella{" "}
              <code>{short(plan.preserved.authoredDigest)}</code> — idéntica antes y después.
            </p>
          </dd>
        </div>
      </dl>

      {done ? (
        <p
          data-testid="resultado-vinculo"
          className="mt-3 rounded-lg border border-positive-line bg-positive-surface p-3 text-sm text-positive"
        >
          Vínculo actualizado. El borrador quedó en la revisión{" "}
          {result.ok ? result.revision : plan.storedRevision + 1}
          {result.ok && result.replayed ? " (reintento: no se creó otra revisión)" : ""}. Recarga la
          página para componer sobre él.
        </p>
      ) : null}

      {result && !result.ok ? (
        <p
          data-testid="rechazo-vinculo"
          className="mt-3 rounded-lg border border-caution-line bg-caution-surface p-3 text-sm text-caution"
        >
          {result.detail}
        </p>
      ) : null}

      <button
        data-testid="actualizar-vinculo"
        type="button"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            setResult(await rebind(studyId, plan.storedRevision, key));
          })
        }
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-on-inverse disabled:opacity-50"
      >
        {pending ? "Actualizando…" : done ? "Actualizado" : "Actualizar vínculo"}
      </button>

      <p className="mt-2 text-xs text-muted">
        Esta acción no publica nada, no aprueba nada y no registra ninguna decisión editorial. La
        revisión cualitativa y el mapeo de dolores siguen pendientes.
      </p>
    </section>
  );
}
