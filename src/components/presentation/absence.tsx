/**
 * WHAT A READER IS TOLD WHEN THERE IS NO NUMBER — and on a client surface the
 * answer is usually nothing at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRACT C11, MADE EXECUTABLE.
 *
 * `CLAUDE.md`: "Absence is not a client-facing finding. What Be Community chose
 * not to publish — or has not finished reviewing — renders as nothing on the
 * client side: no placeholder, empty card, heading, reserved row or copy
 * explaining the gap." Unit 6A preserved the STATES and left the rendering rule
 * to this unit, which is this file.
 *
 * The rule is not "hide bad news". It has an exception that matters more than
 * the rule does, and the exception is written into `visibleNote` below: a
 * caveat about a result the client IS shown — a small base, a withheld segment
 * behind a visible number, an authored note — is analytical honesty and must
 * survive. What C11 removes is the SHAPE OF A GAP: a reserved row, an empty
 * card, a heading over nothing, a sentence saying a review is in progress. A
 * published study is a finished editorial product, and a finished product does
 * not narrate its own unfinished parts to the client who paid for it.
 *
 * INTERNAL IS THE OPPOSITE. Studio owns the omissions and must name every one
 * of them, visibly marked as internal, because the whole point of an internal
 * preview is to see what a client will not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MODE IS A PROP AND NOT A GUESS.
 *
 * There is no audience flag anywhere in `PresentationRenderModel` — the model
 * is the same bytes either way, and Unit 6A was right to keep it that way: an
 * audience is a property of the SURFACE, not of the data. So the surface says
 * which it is, once, at the top, and every leaf reads it from one place.
 */

import type { RenderAbsence, RenderSampleDisplay } from "@/lib/presentation";

/** Who is looking. A property of the surface, never of the render model. */
export type PresentationAudience = "client" | "internal";

/**
 * Does a client see anything at all for this absence?
 *
 * `unavailable` and `unresolved` are the contract SAYING SOMETHING about a
 * measurement — nobody was eligible, no authority states the relationship — and
 * those are facts about the study a reader may legitimately be shown beside the
 * thing they qualify. `withheld_by_policy` and `configuration_required` are
 * Be Community's own decisions and its own unfinished work; neither is the
 * client's business.
 */
export function clientSeesAbsence(absence: RenderAbsence): boolean {
  return absence.state === "unavailable" || absence.state === "unresolved";
}

/** Plain Spanish for a contract reason. No code, no key, no formula. */
export function absenceSentence(absence: RenderAbsence): string {
  if (absence.state === "unavailable") {
    switch (absence.reason) {
      case "no_eligible_population":
        return "Nadie formaba parte de esta medición.";
      case "no_responses":
        return "Nadie respondió a esta medición.";
      case "no_valid_answers":
        return "Hubo respuestas, pero ninguna que esta medición pueda usar.";
      case "not_collected":
        return "El estudio no recogió esta medición.";
      case "empty_filtered_population":
        return "La selección actual no incluye a nadie.";
      case "cross_not_permitted":
        return "Este cruce no se publica.";
      default:
        return "No hay un dato para mostrar aquí.";
    }
  }
  if (absence.state === "unresolved") {
    switch (absence.reason) {
      case "authority_conflict":
        return "Dos fuentes del estudio no coinciden en cómo se mide esto.";
      case "relationship_not_stated":
        return "Ninguna fuente del estudio afirma esta relación.";
      case "source_incomplete":
        return "La fuente trae una parte de lo que esto necesita y no el resto.";
      default:
        return "Esto queda como una pregunta abierta.";
    }
  }
  if (absence.state === "configuration_required") return "Falta configurar o redactar este contenido.";
  return "Alguien decidió no publicar esto.";
}

/**
 * The one sentence a reader may be shown about the sample.
 *
 * The comparison that produced the state happened on the server. What crosses
 * is a decision already made, and — where somebody authored one — the sentence
 * they wrote. Never the threshold, never the author, never the rationale.
 */
export function visibleNote(sample: RenderSampleDisplay): string | null {
  if (sample.state === "shown_with_note") return sample.note;
  if (sample.state === "withheld_by_policy") return sample.note;
  return null;
}

/**
 * The internal marker every reviewer-only placeholder wears.
 *
 * It is deliberately loud. A reviewer looking at an internal preview must never
 * have to wonder whether what they are reading will reach a client, and the
 * cheapest way to guarantee that is for every internal-only element to say so
 * in words rather than in a shade of grey.
 */
export function InternalPlaceholder({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface-sunken p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
        Sólo interno · no lo ve el cliente
      </p>
      <p className="mt-1.5 font-display text-base font-semibold text-strong">{title}</p>
      <p className="mt-1 text-sm text-body">{detail}</p>
      {action ? <p className="mt-2 text-sm font-medium text-evidence">{action}</p> : null}
    </div>
  );
}

/**
 * Render an absence for whoever is looking.
 *
 * Returning `null` on a client surface is the whole of C11: no wrapper, no
 * border, no reserved height. The caller must also not draw a heading for a
 * block whose entire payload came back null — which is why `PresentationBlock`
 * asks this question before it draws anything at all, not after.
 */
export function AbsenceNotice({
  absence,
  audience,
}: {
  absence: RenderAbsence;
  audience: PresentationAudience;
}) {
  if (audience === "client") {
    if (!clientSeesAbsence(absence)) return null;
    return <p className="text-sm text-muted">{absenceSentence(absence)}</p>;
  }
  if (absence.state === "configuration_required") {
    return (
      <InternalPlaceholder
        title="Contenido pendiente"
        detail="Este bloque está declarado y todavía no tiene contenido. El cliente no ve nada aquí."
        action="Lo aporta quien el contrato del estudio designe."
      />
    );
  }
  if (absence.state === "withheld_by_policy") {
    return (
      <InternalPlaceholder
        title="Retenido por decisión de publicación"
        detail="Una persona decidió no publicar este resultado. El cliente no ve nada aquí, salvo la nota que se haya redactado para él."
      />
    );
  }
  return (
    <InternalPlaceholder
      title={absence.state === "unavailable" ? "Sin dato" : "Sin resolver"}
      detail={absenceSentence(absence)}
    />
  );
}
