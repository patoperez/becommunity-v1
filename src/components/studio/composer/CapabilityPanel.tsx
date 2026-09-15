"use client";

/**
 * «DECLARAR CONTENIDO OBLIGATORIO» — the affordance that brings a document
 * stored before a capability existed up to the capability, and does nothing
 * else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SCREEN MUST NOT MAKE ANYBODY BELIEVE.
 *
 * That the layout is being regenerated, that the document is being rebuilt from
 * the blueprint, that anything is being recalculated, or that this changes what
 * the client would see. None of those happen. Every page, block, title, body,
 * width, filter, visibility, sample policy and disclosure level is left exactly
 * as its author wrote it, and one optional boolean per named block is added.
 *
 * It says «capacidad» and never «plano», «regenerar» or «actualizar el diseño».
 * An operator who reads this panel and concludes the layout was rebuilt has been
 * misled by it, and that would be this component's fault rather than theirs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT NAMES THE BLOCKS AND SHOWS THE STRIPPED DIGEST.
 *
 * Because «sólo se añade metadato» is a promise, and «este bloque, por su
 * título, pasa de (ausente) a true, y la huella del documento sin ese metadato
 * es la misma antes y después» is a claim somebody can check afterwards. The
 * digest is SHA-256 over the document with every `requiredContent` removed: it
 * identifies no person, tenant or study, and it is the number that makes the
 * change refusable.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY IT SAYS WHAT BECOMES STRICTER.
 *
 * Declaring a block's content required turns a warning somebody could tick into
 * a blocker nobody can. That is the intended effect and it is the kind of thing
 * an operator should be told BEFORE pressing, not discover on the publication
 * screen afterwards.
 */

import { useState, useTransition } from "react";

import type { SaveResult } from "@/lib/composer";

/**
 * The plan, as the server computed it.
 *
 * Declared here rather than imported from the server module, for the reason the
 * composer payload types are: a `"use client"` module with a static import of
 * `@/lib/studio/presentation-workspace` would have a path into the canonical
 * read layer in the import graph, and the shadow-boundary gate refuses one.
 */
export type CapabilityPanelPlan = {
  storedRevision: number;
  blueprintId: string;
  blueprintLabel: string;
  changes: {
    path: string;
    blockId: string;
    blockTitle: string;
    field: string;
    from: string;
    to: string;
  }[];
  preserved: {
    title: string;
    pages: number;
    blocks: number;
    samplePolicyMode: string;
    methodologyDisclosure: string;
    strippedBytes: number;
    strippedDigest: string;
    binding: string;
    registryVersion: string;
  };
};

const short = (digest: string) => (digest.length > 16 ? `${digest.slice(0, 16)}…` : digest);

/**
 * A retry key that is stable for as long as the panel is mounted.
 *
 * Minted ONCE, when the panel appears, and reused by every attempt against this
 * stored revision — so an impatient second press, a double submit or a flaky
 * connection produces one revision and not two.
 */
function mintKey(revision: number): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `capability-r${revision}-${Date.now().toString(36)}-${random}`;
}

export function CapabilityPanel({
  studyId,
  plan,
  upgrade,
}: {
  studyId: string;
  plan: CapabilityPanelPlan;
  upgrade: (studyId: string, expectedRevision: number, idempotencyKey: string) => Promise<SaveResult>;
}) {
  const [key] = useState(() => mintKey(plan.storedRevision));
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, startTransition] = useTransition();

  const done = result?.ok === true;

  return (
    <section
      data-testid="panel-capacidad"
      className="mt-4 rounded-xl border border-evidence-line bg-evidence-surface p-5"
    >
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Sólo interno · no lo ve el cliente
      </p>
      <h2 className="mt-1 font-display text-base font-semibold text-strong">
        Declarar el contenido obligatorio del plano
      </h2>

      <p className="mt-1.5 max-w-prose text-sm text-body">
        Este borrador se guardó antes de que existiera la marca que dice qué bloques llevan contenido
        obligatorio, así que no la lleva. El plano vigente («{plan.blueprintLabel}») sí marca{" "}
        {plan.changes.length === 1 ? "un bloque" : `${plan.changes.length} bloques`}.{" "}
        <strong>
          No se regenera el plano, no se reescribe nada de lo que alguien compuso y no cambia nada de
          lo que vería el cliente
        </strong>
        : se añade esa marca a los bloques que el servidor nombra, y se guarda como una revisión
        nueva.
      </p>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Lo que se añade</dt>
          <dd className="mt-1 space-y-1" data-testid="capacidad-cambios">
            {plan.changes.map((change) => (
              <p key={change.path} className="text-body">
                <span className="font-medium text-strong">«{change.blockTitle}»</span>
                <br />
                <code className="text-xs text-muted">
                  {change.field}: {change.from}
                </code>
                {" → "}
                <code className="text-xs text-strong">{change.to}</code>
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
              Vínculo <code>{short(plan.preserved.binding)}</code> sin tocar.
            </p>
            <p className="text-xs text-muted">
              {plan.preserved.strippedBytes} bytes sin ese metadato, huella{" "}
              <code>{short(plan.preserved.strippedDigest)}</code> — idéntica antes y después.
            </p>
          </dd>
        </div>
      </dl>

      <p className="mt-3 rounded-lg border border-caution-line bg-caution-surface p-3 text-sm text-caution">
        Esto vuelve la revisión más estricta, a propósito: un bloque marcado obligatorio y vacío pasa
        de ser un aviso que alguien puede confirmar a ser un bloqueo que nadie puede saltarse. Las
        dos salidas honestas son escribir el contenido o quitar el bloque del documento.
      </p>

      {done ? (
        <p
          data-testid="resultado-capacidad"
          className="mt-3 rounded-lg border border-positive-line bg-positive-surface p-3 text-sm text-positive"
        >
          Capacidad declarada. El borrador quedó en la revisión{" "}
          {result.ok ? result.revision : plan.storedRevision + 1}
          {result.ok && result.replayed ? " (reintento: no se creó otra revisión)" : ""}. Recarga la
          página para verla.
        </p>
      ) : null}

      {result && !result.ok ? (
        <p
          data-testid="rechazo-capacidad"
          className="mt-3 rounded-lg border border-caution-line bg-caution-surface p-3 text-sm text-caution"
        >
          {result.detail}
        </p>
      ) : null}

      <button
        data-testid="declarar-capacidad"
        type="button"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            setResult(await upgrade(studyId, plan.storedRevision, key));
          })
        }
        className="mt-3 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-on-inverse disabled:opacity-50"
      >
        {pending ? "Declarando…" : done ? "Declarado" : "Declarar contenido obligatorio"}
      </button>

      <p className="mt-2 text-xs text-muted">
        Esta acción no publica nada, no aprueba nada y no registra ninguna decisión editorial.
      </p>
    </section>
  );
}
