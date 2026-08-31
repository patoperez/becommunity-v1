"use client";

/**
 * ONE IMMUTABLE REVISION, DRAWN EXACTLY AS THE CLIENT WOULD RECEIVE IT.
 *
 * THE THREE PREVIEWS THIS PRODUCT NOW HAS, AND WHY EACH SAYS WHICH IT IS.
 *
 *   Vista previa del borrador   `/vista-previa` — the MUTABLE draft. Changes
 *                               every time somebody saves. Nobody outside the
 *                               team has ever seen it.
 *   Esta pantalla               a PREPARED REVISION, frozen. What publishing it
 *                               would put in front of the client, character for
 *                               character.
 *   Ver versión publicada       the revision the client is being served right
 *                               now, which is this same screen pointed at the
 *                               active revision.
 *
 * Three screens that look alike and mean different things is how somebody
 * approves one arrangement and publishes another, so each one names itself in a
 * banner that cannot be missed and links to the other two.
 *
 * THE BANNER IS THE ONLY THING THAT IS NOT THE CLIENT'S SCREEN. Everything
 * below it goes through `PublishedExperience`, which is the component the
 * client route itself renders — same C11 filtering, same drawings, same
 * refusals to draw. A preview that rendered through a different component would
 * be a preview of the preview.
 */

import Link from "next/link";
import { useCallback } from "react";

import { PublishedExperience } from "@/components/insights/PublishedExperience";
import type { BuilderEvidence } from "@/lib/experience/builder-workspace";
import type { ClientEvidenceSummary } from "@/lib/experience/client-visibility";
import type { BlockDataSet, ViewerSelection } from "@/lib/experience/data";
import type { ExperienceDefinitionV1 } from "@/lib/experience/definition";
import type { SemanticRegistry } from "@/lib/experience/registry";

export type RevisionPreviewAction = (
  studyId: string,
  revisionId: string,
  selection: unknown,
) => Promise<{ ok: true; data: BlockDataSet } | { ok: false; message: string }>;

export function RevisionPreview({
  studyId,
  revisionId,
  revision,
  state,
  definition,
  registry,
  data,
  evidence,
  summary,
  study,
  initialSelection,
  draftPreviewHref,
  publishHref,
  activeRevisionHref,
  refresh,
}: {
  studyId: string;
  revisionId: string;
  revision: number;
  /** Which of the lifecycle states this revision is in, right now. */
  state: "prepared" | "published" | "superseded";
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  evidence: BuilderEvidence;
  summary: ClientEvidenceSummary;
  study: { name: string; clientName: string; period: string | null };
  initialSelection: ViewerSelection;
  draftPreviewHref: string;
  publishHref: string;
  /** Null when this revision IS the published one. */
  activeRevisionHref: string | null;
  refresh: RevisionPreviewAction;
}) {
  const bound = useCallback(
    (id: string, selection: unknown) => refresh(id, revisionId, selection),
    [refresh, revisionId],
  );

  const words = {
    prepared: {
      title: `Revisión ${revision} preparada · así se vería si la publicas`,
      body:
        "Es un congelado inmutable del borrador. El cliente todavía no ve nada de esto; editar el "
        + "borrador no cambia esta pantalla.",
    },
    published: {
      title: `Revisión ${revision} · esto es lo que el cliente ve ahora`,
      body:
        "Es la revisión publicada. Editar el borrador no la cambia: solo publicar o restaurar mueve "
        + "lo que el cliente recibe.",
    },
    superseded: {
      title: `Revisión ${revision} · sustituida, se conserva en el historial`,
      body:
        "Estuvo publicada y otra la reemplazó. Se conserva completa y se puede restaurar desde el "
        + "historial; nada de esto la modifica.",
    },
  }[state];

  return (
    <div className="min-w-0 space-y-4">
      <div className="rounded-lg border border-caution-line bg-caution-surface px-3 py-3 text-sm text-caution">
        <p className="font-medium">{words.title}</p>
        <p className="mt-1">{words.body}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={publishHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Volver a Publicación
          </Link>
          <Link
            href={draftPreviewHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Vista previa del borrador
          </Link>
          {activeRevisionHref ? (
            <Link
              href={activeRevisionHref}
              className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
            >
              Ver versión actualmente publicada
            </Link>
          ) : null}
        </div>
      </div>

      <PublishedExperience
        studyId={studyId}
        definition={definition}
        registry={registry}
        data={data}
        evidence={evidence}
        summary={summary}
        study={study}
        initialSelection={initialSelection}
        /*
         * The download is not offered inside an internal preview. The client's
         * own screen offers it where it is genuinely supported; offering it here
         * would either produce a report for a revision nobody published, or a
         * dead control — and a preview that behaves differently from what it
         * previews is worse than no preview.
         */
        reportHref={null}
        refresh={bound}
      />
    </div>
  );
}
