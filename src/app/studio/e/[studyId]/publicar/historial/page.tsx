import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { logout } from "@/app/dashboard/actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { studyParent } from "@/components/shell/BackLink";
import { StateBlock } from "@/components/States";
import { DiffView, formatMoment, reviewAction, reviewCard } from "@/components/studio/publication/ReviewParts";
import { RestoreRevisionForm } from "@/components/studio/publication/RestoreRevisionForm";
import { structuralDiff } from "@/lib/experience/diff";
import { shortHash } from "@/lib/experience/fingerprint";
import {
  DEFAULT_HISTORY_PAGE_SIZE,
  HISTORY_PAGE_SIZES,
  loadRevisionHistory,
  revisionIsReadable,
  type RevisionHistoryEntry,
} from "@/lib/experience/publication";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import {
  studioStudyPublicationHistory,
  studioStudyPublish,
  studioStudyRevisionPreview,
} from "@/lib/studio/routes";

import { restoreExperienceRevision } from "../actions";

export const metadata = { title: "Historial de versiones · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{
  page?: string;
  size?: string;
  compare?: string;
  with?: string;
  ok?: string;
  error?: string;
}>;

/**
 * EVERY VERSION THIS STUDY HAS EVER HAD, and what happened to each.
 *
 * NOTHING ON THIS SCREEN CAN EDIT A REVISION. There is no control that could:
 * the table refuses an UPDATE by trigger and no role holds the privilege, so
 * "historical revisions cannot be edited" is a property of the database rather
 * than of this page's markup.
 *
 * THE ONE ACT AVAILABLE HERE IS RESTORATION, and it is deliberate: a stated
 * reason, an accessible confirmation naming what changes, a concurrency token,
 * and a NEW event rather than an edit to an old one. A restored revision does
 * not erase the one it replaced — that one stays in this list, marked, and can
 * be restored back.
 *
 * PAGING IS REAL. A study that publishes weekly for two years has a hundred
 * revisions, and a screen that quietly showed the newest ten would be a screen
 * that lies about what exists. The count is exact and the pages are navigable.
 */
export default async function PublicationHistoryPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const studio = await loadStudioStudy(admin, studyId);
  if (!studio) notFound();

  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const requestedSize = Number.parseInt(query.size ?? "", 10);
  const pageSize = HISTORY_PAGE_SIZES.includes(requestedSize as (typeof HISTORY_PAGE_SIZES)[number])
    ? requestedSize
    : DEFAULT_HISTORY_PAGE_SIZE;

  const history = await loadRevisionHistory(admin, studyId, { page, pageSize });
  const actors = await actorNames(admin, history.entries);

  // The comparison. Both ids are looked up inside the page this study owns, so
  // a revision id from another client is simply not in the list and produces no
  // comparison rather than reaching across a tenant boundary.
  const byId = new Map(history.entries.map((entry) => [entry.revision.id, entry]));
  const left = query.compare ? byId.get(query.compare) : undefined;
  const right = query.with ? byId.get(query.with) : undefined;
  const comparison =
    left && right && revisionIsReadable(left.revision) && revisionIsReadable(right.revision)
      ? structuralDiff(left.revision.definition, right.revision.definition)
      : null;

  const totalPages = Math.max(1, Math.ceil(history.total / history.pageSize));
  const returnTo = studioStudyPublicationHistory(studyId);

  return (
    <StudioShell
      userEmail={user.email ?? ""}
      currentHref="/studio/estudios"
      back={studyParent(studyId, studio.study.name)}
      breadcrumb={[
        "Studio",
        "Estudios",
        studio.study.clientName,
        studio.study.name,
        "Historial de versiones",
      ]}
      title="Historial de versiones"
      lead="Cada revisión que se preparó, cuándo se publicó y qué reemplazó. Nada de esto se edita."
      utility={
        <form action={logout}>
          <button
            type="submit"
            className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
          >
            Cerrar sesión
          </button>
        </form>
      }
    >
      <div className="space-y-4">
        {query.ok ? (
          <StateBlock tone="quiet" title="Listo">
            <p>{query.ok}</p>
          </StateBlock>
        ) : null}
        {query.error ? (
          <StateBlock tone="danger" title="No se pudo completar">
            <p>{query.error}</p>
          </StateBlock>
        ) : null}
        {history.problem ? (
          <StateBlock tone="caution" title="El historial se leyó parcialmente">
            <p>{history.problem}</p>
          </StateBlock>
        ) : null}

        <div className={reviewCard}>
          <p className="text-sm text-body">
            {history.total === 0
              ? "Todavía no se ha preparado ninguna revisión de la experiencia compuesta de este estudio."
              : /*
                 * "revisiones", not "revisiónes". The accent on the last
                 * syllable of `revisión` disappears in the plural, so appending
                 * a suffix to the singular produces a misspelling — the kind a
                 * consultant reads on every visit to this screen.
                 */
                `${history.total} ${history.total === 1 ? "revisión" : "revisiones"} en total. Se muestran ${history.entries.length}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={studioStudyPublish(studyId)} className={reviewAction}>
              Volver a Publicación
            </Link>
          </div>
        </div>

        {history.entries.length >= 2 ? (
          <form method="get" className={reviewCard}>
            <h2 className="text-base font-semibold text-strong">Comparar dos revisiones</h2>
            <p className="mt-1 text-sm text-body">
              Muestra qué cambia entre una y otra, en palabras: páginas, bloques, resultados,
              gráficas, filtros, recorridos, semáforos, regla de muestra y portada.
            </p>
            <input type="hidden" name="page" value={history.page} />
            <input type="hidden" name="size" value={history.pageSize} />
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-strong">
                De
                <select
                  name="compare"
                  defaultValue={query.compare ?? history.entries[1]?.revision.id}
                  className="mt-1 block min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm font-normal text-strong"
                >
                  {history.entries.map((entry) => (
                    <option key={entry.revision.id} value={entry.revision.id}>
                      Revisión {entry.revision.revision}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-strong">
                A
                <select
                  name="with"
                  defaultValue={query.with ?? history.entries[0]?.revision.id}
                  className="mt-1 block min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm font-normal text-strong"
                >
                  {history.entries.map((entry) => (
                    <option key={entry.revision.id} value={entry.revision.id}>
                      Revisión {entry.revision.revision}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={reviewAction}>
                Comparar
              </button>
            </div>
          </form>
        ) : null}

        {left && right ? (
          comparison ? (
            <DiffView
              diff={comparison}
              title={`De la revisión ${left.revision.revision} a la ${right.revision.revision}`}
              lead="Diferencias estructurales entre las dos revisiones seleccionadas."
            />
          ) : (
            <StateBlock tone="caution" title="No se pueden comparar">
              <p>
                Alguna de las dos revisiones no se puede leer con esta versión del producto, así que
                no hay una comparación honesta que mostrar.
              </p>
            </StateBlock>
          )
        ) : null}

        <ol className="space-y-4">
          {history.entries.map((entry) => (
            <li key={entry.revision.id}>
              <RevisionRow
                entry={entry}
                studyId={studyId}
                actors={actors}
                activeRevisionId={history.activeRevisionId}
                activeRevisionNumber={
                  history.entries.find((candidate) => candidate.active)?.revision.revision ?? null
                }
                returnTo={returnTo}
              />
            </li>
          ))}
        </ol>

        {totalPages > 1 ? (
          <nav aria-label="Páginas del historial" className={reviewCard}>
            <p className="text-sm text-body">
              Página {history.page} de {totalPages}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {history.page > 1 ? (
                <Link
                  href={`${returnTo}?page=${history.page - 1}&size=${history.pageSize}`}
                  className={reviewAction}
                >
                  Anteriores
                </Link>
              ) : null}
              {history.page < totalPages ? (
                <Link
                  href={`${returnTo}?page=${history.page + 1}&size=${history.pageSize}`}
                  className={reviewAction}
                >
                  Siguientes
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </div>
    </StudioShell>
  );
}

function RevisionRow({
  entry,
  studyId,
  actors,
  activeRevisionId,
  activeRevisionNumber,
  returnTo,
}: {
  entry: RevisionHistoryEntry;
  studyId: string;
  actors: Map<string, string>;
  activeRevisionId: string | null;
  activeRevisionNumber: number | null;
  returnTo: string;
}) {
  const revision = entry.revision;
  const readable = revisionIsReadable(revision);
  const name = (id: string | null) =>
    id ? (actors.get(id) ?? `cuenta ${id.slice(0, 8)}`) : "una cuenta que ya no existe";

  return (
    <article
      className={`rounded-xl border p-5 ${
        entry.active ? "border-evidence-line bg-evidence-surface" : "border-line bg-surface"
      }`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-strong">
          Revisión {revision.revision}
        </h2>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {entry.active
            ? "Publicada ahora"
            : entry.superseded
              ? "Sustituida"
              : "Preparada, nunca publicada"}
        </p>
      </header>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Huella</dt>
          <dd className="text-sm text-body">
            <code className="font-mono text-xs">{shortHash(revision.definitionSha256)}</code>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Preparada</dt>
          <dd className="text-sm text-body">
            {formatMoment(revision.preparedAt)}
            {readable ? ` · ${name(revision.preparedBy)}` : ""}
          </dd>
        </div>
        {readable ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              Borrador de origen
            </dt>
            <dd className="text-sm text-body">versión {revision.sourceDraftRevision}</dd>
          </div>
        ) : null}
        {readable && revision.preparedNote ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              Nota interna
            </dt>
            <dd className="text-sm text-body">{revision.preparedNote}</dd>
          </div>
        ) : null}
        {readable && revision.acknowledgedWarnings.length > 0 ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              Advertencias reconocidas
            </dt>
            <dd className="text-sm text-body">
              {revision.acknowledgedWarnings.join(", ")}
              {revision.acknowledgedBy
                ? ` · ${name(revision.acknowledgedBy)}${
                    revision.acknowledgedAt ? ` · ${formatMoment(revision.acknowledgedAt)}` : ""
                  }`
                : ""}
            </dd>
          </div>
        ) : null}
      </dl>

      {!readable ? (
        <p className="mt-3 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
          {revision.reason}
        </p>
      ) : null}

      {entry.publications.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold text-strong">Publicaciones de esta revisión</h3>
          <ul className="mt-1 space-y-1">
            {entry.publications.map((event) => (
              <li key={event.id} className="text-sm text-body">
                {event.action === "restored" ? "Restaurada" : "Publicada"} el{" "}
                {formatMoment(event.occurredAt)} · {name(event.actorUserId)}
                {event.replacedRevisionId ? " · reemplazó a la anterior" : " · primera publicación"}
                {event.note ? ` · “${event.note}”` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {entry.supersededBy ? (
        <p className="mt-3 text-sm text-body">
          Dejó de estar publicada el {formatMoment(entry.supersededBy.occurredAt)}, cuando{" "}
          {name(entry.supersededBy.actorUserId)}{" "}
          {entry.supersededBy.action === "restored" ? "restauró" : "publicó"} otra revisión
          {entry.supersededBy.note ? ` (“${entry.supersededBy.note}”)` : ""}.
        </p>
      ) : null}

      {readable ? (
        <p className="mt-3 text-sm text-muted">
          {revision.definition.pages.length} páginas ·{" "}
          {revision.definition.pages.reduce((total, page) => total + page.blocks.length, 0)} bloques
          · {revision.definition.filterDefinitions.length} filtros ·{" "}
          {revision.definition.journeyReferences.length} recorridos ·{" "}
          {revision.definition.bandSchemes.length} semáforos
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={studioStudyRevisionPreview(studyId, revision.id)} className={reviewAction}>
          Ver esta revisión
        </Link>
      </div>

      {readable && !entry.active ? (
        <RestoreRevisionForm
          studyId={studyId}
          revisionId={revision.id}
          revision={revision.revision}
          activeRevision={activeRevisionNumber}
          expectedActive={activeRevisionId}
          returnTo={returnTo}
          action={restoreExperienceRevision}
        />
      ) : null}
    </article>
  );
}

/**
 * Who each identifier belongs to, in one query.
 *
 * `full_name` from `public.profiles`, never an email address: this is an
 * internal audit screen, and the smallest thing that answers "who did this" is
 * the name the team already knows each other by. An account with no recorded
 * name falls back to a short form of its identifier rather than to "alguien",
 * because an audit record that cannot name the actor is not an audit record.
 */
async function actorNames(
  admin: Parameters<typeof loadRevisionHistory>[0],
  entries: RevisionHistoryEntry[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (revisionIsReadable(entry.revision)) {
      if (entry.revision.preparedBy) ids.add(entry.revision.preparedBy);
      if (entry.revision.acknowledgedBy) ids.add(entry.revision.acknowledgedBy);
    }
    for (const event of entry.publications) {
      if (event.actorUserId) ids.add(event.actorUserId);
    }
    if (entry.supersededBy?.actorUserId) ids.add(entry.supersededBy.actorUserId);
  }
  if (ids.size === 0) return new Map();
  const { data } = await admin
    .from("profiles")
    .select("user_id, full_name")
    .in("user_id", [...ids])
    .returns<{ user_id: string; full_name: string | null }[]>();
  return new Map(
    (data ?? []).flatMap((row) =>
      row.full_name ? [[row.user_id, row.full_name] as [string, string]] : [],
    ),
  );
}
