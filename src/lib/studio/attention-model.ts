/**
 * "¿Qué necesita mi atención?" — the classification, as a pure function (P8.2).
 *
 * THE RULE THIS OBEYS: state nothing the data cannot prove.
 *
 * A study with no answers genuinely has none. An import left `staged` genuinely
 * never became data. An observation with `review_status = 'pending'` genuinely
 * has not been reviewed. A draft carrying data genuinely has not been
 * published. A moment of the recorrido pointing at a result the study does not
 * produce genuinely renders with no number.
 *
 * Everything else a consultant might want on this list — who it is assigned to,
 * when it is due, whether somebody approved it — does not exist in the schema,
 * and inventing it would make the one screen whose job is trust the one screen
 * that guesses.
 *
 * COLOUR GROUPS THE KIND OF WORK. It is never a verdict on a number.
 */

export type AttentionKind =
  | "sin-datos"
  | "carga-sin-terminar"
  | "cualitativo-pendiente"
  | "recorrido-incompleto"
  | "sin-publicar";

/** What each kind means, and what to do about it. */
export const ATTENTION_KIND: Record<
  AttentionKind,
  { rank: number; accent: { fill: string; surface: string; line: string } }
> = {
  // Ordered by how much it blocks the work, not by how alarming it looks.
  "carga-sin-terminar": {
    rank: 0,
    accent: {
      fill: "var(--color-magenta)",
      surface: "var(--color-magenta-surface)",
      line: "var(--color-magenta-line)",
    },
  },
  "sin-datos": {
    rank: 1,
    accent: {
      fill: "var(--color-blue)",
      surface: "var(--color-sky-surface)",
      line: "var(--color-sky-line)",
    },
  },
  "cualitativo-pendiente": {
    rank: 2,
    accent: {
      fill: "var(--color-lavender)",
      surface: "var(--color-lavender-surface)",
      line: "var(--color-lavender-line)",
    },
  },
  "recorrido-incompleto": {
    rank: 3,
    accent: {
      fill: "var(--color-yellow)",
      surface: "var(--color-yellow-surface)",
      line: "var(--color-yellow-line)",
    },
  },
  "sin-publicar": {
    rank: 4,
    accent: {
      fill: "var(--color-green)",
      surface: "var(--color-green-surface)",
      line: "var(--color-green-line)",
    },
  },
};

/** One study, reduced to exactly the facts the classification needs. */
export type StudyFacts = {
  studyId: string;
  studyName: string;
  clientName: string;
  period: string | null;
  status: string;
  /** True when the client organisation is archived. */
  clientArchived: boolean;
  quantResponses: number;
  confirmedObservations: number;
  pendingObservations: number;
  /** Imports that were prepared or failed and never became data. */
  unfinishedImports: number;
  /** Moments of the recorrido whose result this study does not produce. */
  stagesWithoutResult: number;
  totalStages: number;
};

export type AttentionItem = {
  /** Stable within one render, so the list can be keyed without an index. */
  key: string;
  kind: AttentionKind;
  studyId: string;
  studyName: string;
  clientName: string;
  period: string | null;
  headline: string;
  detail: string;
  actionLabel: string;
  /** Filled in by the caller, which owns the route vocabulary. */
  href: string;
  accent: { fill: string; surface: string; line: string };
};

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * Every actionable item this study currently produces.
 *
 * A study can appear more than once, because two different things can genuinely
 * need attention on the same study — and collapsing them would hide one.
 */
export function attentionForStudy(
  facts: StudyFacts,
  href: (kind: AttentionKind, studyId: string) => string,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const push = (
    kind: AttentionKind,
    headline: string,
    detail: string,
    actionLabel: string,
  ) => {
    items.push({
      key: `${facts.studyId}:${kind}`,
      kind,
      studyId: facts.studyId,
      studyName: facts.studyName,
      clientName: facts.clientName,
      period: facts.period,
      headline,
      detail,
      actionLabel,
      href: href(kind, facts.studyId),
      accent: ATTENTION_KIND[kind].accent,
    });
  };

  if (facts.unfinishedImports > 0) {
    push(
      "carga-sin-terminar",
      facts.unfinishedImports === 1
        ? "Una carga quedó a medias"
        : `${facts.unfinishedImports} cargas quedaron a medias`,
      "Se preparó o falló y nunca llegó a guardarse. Nada de eso está en el estudio.",
      "Revisar las cargas",
    );
  }

  const hasData = facts.quantResponses > 0 || facts.confirmedObservations > 0;
  if (!hasData) {
    push(
      "sin-datos",
      "Todavía no tiene datos",
      "Sin respuestas ni hallazgos confirmados no hay nada que mostrar ni que publicar.",
      "Cargar datos",
    );
    // Nothing further is worth saying about a study with no data: every other
    // item would be a consequence of this one.
    return items;
  }

  if (facts.pendingObservations > 0) {
    push(
      "cualitativo-pendiente",
      `${plural(facts.pendingObservations, "comentario espera", "comentarios esperan")} tu revisión`,
      "Nada de eso llega al cliente hasta que una persona lo confirme.",
      "Revisar lo que dijeron",
    );
  }

  if (facts.stagesWithoutResult > 0) {
    push(
      "recorrido-incompleto",
      facts.stagesWithoutResult === 1
        ? "Un momento del recorrido no tiene resultado"
        : `${facts.stagesWithoutResult} momentos del recorrido no tienen resultado`,
      `De ${plural(facts.totalStages, "momento", "momentos")} en total. Aparecerán sin número.`,
      "Revisar el recorrido",
    );
  }

  if (facts.status === "draft") {
    push(
      "sin-publicar",
      "Tiene datos y sigue sin publicarse",
      facts.clientArchived
        ? "El cliente está archivado, así que no se puede publicar hasta reactivarlo."
        : "Revísalo como lo verá el cliente y decide si ya se publica.",
      "Revisarlo como el cliente",
    );
  }

  return items;
}

/**
 * The whole list, ordered by kind and capped.
 *
 * A home page that lists forty things is a backlog, not an answer to "what
 * needs me now" — so the list is bounded and the caller states how many were
 * left out rather than pretending there were none.
 */
export function rankAttention(items: AttentionItem[], limit = 8): {
  shown: AttentionItem[];
  hidden: number;
} {
  const sorted = [...items].sort(
    (a, b) =>
      ATTENTION_KIND[a.kind].rank - ATTENTION_KIND[b.kind].rank ||
      a.clientName.localeCompare(b.clientName, "es-MX") ||
      a.studyName.localeCompare(b.studyName, "es-MX"),
  );
  return { shown: sorted.slice(0, limit), hidden: Math.max(0, sorted.length - limit) };
}
