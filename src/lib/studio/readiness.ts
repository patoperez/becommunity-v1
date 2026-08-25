/**
 * How far along a study is, and what is actually stopping it (P8.2).
 *
 * Pure, so the honesty of the answer can be proved without a database.
 *
 * TWO KINDS OF FINDING, NEVER MIXED.
 *
 *   BLOQUEA  — the product will refuse the next step because of this. Empty
 *              studies cannot be published; that rule already exists on the
 *              server and this is where it is finally SAID, up front, instead
 *              of arriving as an error after the operator clicked publish.
 *   MEJORA   — the study would be better with it, and nothing prevents
 *              publishing without it. Treating these as blockers would teach a
 *              consultant to ignore blockers.
 *
 * Nothing here is an authorization decision or a publication guard. The server
 * re-checks every one of these conditions in `setStudyPublication`; this is the
 * explanation, and the explanation is allowed to be wrong only in the direction
 * of being out of date, never in the direction of letting something through.
 */

export type ReadinessLevel = "done" | "blocking" | "improvement";

export type ReadinessItem = {
  id: string;
  level: ReadinessLevel;
  label: string;
  detail: string;
};

export type StudyReadinessFacts = {
  status: string;
  clientArchived: boolean;
  quantResponses: number;
  respondents: number;
  confirmedObservations: number;
  pendingObservations: number;
  unfinishedImports: number;
  totalStages: number;
  stagesWithoutResult: number;
};

export type StudyReadiness = {
  items: ReadinessItem[];
  blocking: ReadinessItem[];
  improvements: ReadinessItem[];
  done: ReadinessItem[];
  /** Whether publication would be accepted right now. */
  canPublish: boolean;
  /** One sentence a consultant can read without expanding anything. */
  summary: string;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function studyReadiness(facts: StudyReadinessFacts): StudyReadiness {
  const items: ReadinessItem[] = [];
  const hasContent = facts.quantResponses > 0 || facts.confirmedObservations > 0;

  items.push(
    hasContent
      ? {
          id: "datos",
          level: "done",
          label: "Tiene contenido",
          detail: `${count(facts.respondents, "persona respondió", "personas respondieron")} · ${count(
            facts.quantResponses,
            "resultado numérico",
            "resultados numéricos",
          )} · ${count(facts.confirmedObservations, "comentario confirmado", "comentarios confirmados")}.`,
        }
      : {
          id: "datos",
          level: "blocking",
          label: "No tiene contenido publicable",
          detail:
            "Sin respuestas numéricas ni comentarios confirmados no hay nada que mostrar, y el producto no deja publicar un estudio vacío.",
        },
  );

  if (facts.clientArchived) {
    items.push({
      id: "cliente",
      level: "blocking",
      label: "El cliente está archivado",
      detail:
        "Un cliente archivado no recibe publicaciones nuevas. Reactívalo desde su página si vas a seguir trabajando con él.",
    });
  }

  if (facts.unfinishedImports > 0) {
    items.push({
      id: "cargas",
      level: "improvement",
      label: `${count(facts.unfinishedImports, "carga quedó", "cargas quedaron")} a medias`,
      detail:
        "Se prepararon o fallaron y nunca se guardaron. No afectan lo publicado, pero conviene revisarlas antes de dar por cerrado el estudio.",
    });
  }

  if (facts.pendingObservations > 0) {
    items.push({
      id: "cualitativo",
      level: "improvement",
      label: `${count(facts.pendingObservations, "comentario espera", "comentarios esperan")} revisión`,
      detail:
        "Si publicas ahora, esos comentarios sencillamente no aparecen. No se muestra ningún hueco al cliente.",
    });
  } else if (facts.confirmedObservations > 0) {
    items.push({
      id: "cualitativo",
      level: "done",
      label: "La revisión de comentarios está al día",
      detail: `${count(facts.confirmedObservations, "comentario confirmado", "comentarios confirmados")}, y ninguno pendiente.`,
    });
  }

  if (facts.totalStages === 0) {
    items.push({
      id: "recorrido",
      level: "improvement",
      label: "No hay recorrido",
      detail: "El cliente simplemente no verá esa sección. Puedes añadir momentos cuando quieras.",
    });
  } else if (facts.stagesWithoutResult > 0) {
    items.push({
      id: "recorrido",
      level: "improvement",
      label: `${count(facts.stagesWithoutResult, "momento aparece", "momentos aparecen")} sin número`,
      detail: `De ${count(facts.totalStages, "momento", "momentos")} en total: el resultado que miden no existe en los datos de este estudio.`,
    });
  } else {
    items.push({
      id: "recorrido",
      level: "done",
      label: "El recorrido está completo",
      detail: `Los ${facts.totalStages} momentos tienen un resultado con datos.`,
    });
  }

  const blocking = items.filter((item) => item.level === "blocking");
  const improvements = items.filter((item) => item.level === "improvement");
  const done = items.filter((item) => item.level === "done");

  return {
    items,
    blocking,
    improvements,
    done,
    canPublish: blocking.length === 0,
    summary: summarize(facts, blocking.length, improvements.length),
  };
}

function summarize(facts: StudyReadinessFacts, blocking: number, improvements: number): string {
  if (blocking > 0) {
    return blocking === 1
      ? "Hay una cosa que impide publicarlo."
      : `Hay ${blocking} cosas que impiden publicarlo.`;
  }
  if (facts.status === "published") {
    return improvements === 0
      ? "Está publicado y no queda nada pendiente."
      : `Está publicado. Quedan ${improvements} mejora${improvements === 1 ? "" : "s"} posibles.`;
  }
  if (facts.status === "archived") {
    return "Está archivado: el cliente no lo ve.";
  }
  return improvements === 0
    ? "Se puede publicar cuando quieras."
    : `Se puede publicar. Antes, considera ${improvements} mejora${improvements === 1 ? "" : "s"}.`;
}
