import Link from "next/link";

import { DIFF_KIND_LABEL, DIFF_KINDS, summariseDiff, type StructuralDiff } from "@/lib/experience/diff";
import { shortHash } from "@/lib/experience/fingerprint";
import { SAMPLE_POLICY_WORD, type ExperienceInventory } from "@/lib/experience/inventory";
import type { PreflightReport } from "@/lib/experience/preflight";

/**
 * The pieces the publication review is built from.
 *
 * ALL SERVER COMPONENTS. Nothing here needs a browser: a list of findings, a
 * list of changes and an inventory are read, not operated. The one place that
 * genuinely needs interaction — acknowledging warnings — is a plain HTML form
 * whose checkboxes are `required`, so the browser refuses an incomplete
 * submission without a line of JavaScript, and the server refuses it again
 * independently.
 *
 * NO RAW JSON ANYWHERE ON THIS PATH. Everything a reviewer reads here is a
 * sentence about the arrangement. The technical export exists, is internal, and
 * is one deliberate click away — never the first thing somebody meets.
 */

const CARD = "rounded-xl border border-line bg-surface p-5";
const DANGER_CARD = "rounded-xl border border-danger-line bg-danger-surface p-5";
const CAUTION_CARD = "rounded-xl border border-caution-line bg-caution-surface p-5";

export function Blockers({ report }: { report: PreflightReport }) {
  if (report.blockers.length === 0) return null;
  return (
    <section className={DANGER_CARD} aria-labelledby="bloqueos">
      <h3 id="bloqueos" className="text-base font-semibold text-danger">
        Esto impide publicar
      </h3>
      <p className="mt-1 max-w-prose text-sm text-danger">
        No se puede marcar como revisado ni pasar por alto: una página publicada así diría algo
        que no es cierto. Corrígelo en Construcción y vuelve.
      </p>
      <ul className="mt-3 space-y-3">
        {report.blockers.map((finding, index) => (
          <li key={`${finding.code}-${finding.where.id}-${index}`}>
            <p className="text-sm font-semibold text-danger">{finding.label}</p>
            <p className="text-sm text-danger">{finding.detail}</p>
            <p className="mt-0.5 text-xs uppercase tracking-wide text-danger/80">{finding.code}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The warnings, each with its own checkbox.
 *
 * ONE BOX PER CODE, AND NO "ACCEPT ALL". A single control that dismissed the
 * list would make the record meaningless: what gets stored is which exact codes
 * a named person agreed to, at a recorded time, and a blanket dismissal stores
 * "they clicked something". Publication re-asserts the same set, so agreeing to
 * three warnings never authorizes publishing a fourth.
 */
export function WarningAcknowledgements({
  report,
  disabled,
}: {
  report: PreflightReport;
  disabled?: boolean;
}) {
  if (report.warningCodes.length === 0) {
    return (
      <p className="text-sm text-body">
        No hay advertencias que reconocer en esta versión.
      </p>
    );
  }
  const byCode = new Map<string, typeof report.warnings>();
  for (const warning of report.warnings) {
    const list = byCode.get(warning.code) ?? [];
    list.push(warning);
    byCode.set(warning.code, list);
  }
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-semibold text-caution">
        Advertencias: reconoce cada una para poder continuar
      </legend>
      {report.warningCodes.map((code) => {
        const findings = byCode.get(code) ?? [];
        return (
          <label
            key={code}
            className="flex gap-3 rounded-lg border border-caution-line bg-caution-surface p-3"
          >
            <input
              type="checkbox"
              name="ack"
              value={code}
              required
              className="mt-1 h-5 w-5 shrink-0 accent-[#8a5a00]"
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-caution">
                {findings[0]?.label ?? code}
                {findings.length > 1 ? ` y ${findings.length - 1} más` : ""}
              </span>
              <span className="mt-0.5 block text-sm text-caution">{findings[0]?.detail}</span>
              {findings.length > 1 ? (
                <ul className="mt-1 space-y-0.5">
                  {findings.slice(1, 5).map((finding, index) => (
                    <li key={index} className="text-sm text-caution">
                      {finding.detail}
                    </li>
                  ))}
                  {findings.length > 5 ? (
                    <li className="text-sm text-caution">
                      Y {findings.length - 5} caso{findings.length - 5 === 1 ? "" : "s"} más del
                      mismo tipo.
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <span className="mt-1 block text-xs uppercase tracking-wide text-caution/80">
                {code}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function DiffView({
  diff,
  title,
  lead,
}: {
  diff: StructuralDiff | null;
  title: string;
  lead: string;
}) {
  if (!diff) return null;
  return (
    <section className={CARD} aria-labelledby="diferencias">
      <h3 id="diferencias" className="text-base font-semibold text-strong">
        {title}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-body">{lead}</p>
      {diff.identical ? (
        <p className="mt-3 text-sm text-body">
          Nada cambia para el cliente: las dos versiones son la misma disposición.
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm font-medium text-strong">{summariseDiff(diff)}</p>
          <dl className="mt-3 space-y-4">
            {DIFF_KINDS.filter((kind) => diff.counts[kind] > 0).map((kind) => (
              <div key={kind}>
                <dt className="text-sm font-semibold text-strong">{DIFF_KIND_LABEL[kind]}</dt>
                <dd>
                  <ul className="mt-1 space-y-1">
                    {diff.changes
                      .filter((change) => change.kind === kind)
                      .map((change, index) => (
                        <li key={`${change.id}-${index}`} className="text-sm text-body">
                          {change.detail}
                        </li>
                      ))}
                  </ul>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

export function InventoryView({ inventory }: { inventory: ExperienceInventory }) {
  return (
    <section className={CARD} aria-labelledby="contenido">
      <h3 id="contenido" className="text-base font-semibold text-strong">
        Qué contiene esta versión
      </h3>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Páginas">
          {inventory.totals.visiblePages} visible
          {inventory.totals.visiblePages === 1 ? "" : "s"}
          {inventory.totals.hiddenPages > 0
            ? `, ${inventory.totals.hiddenPages} oculta${inventory.totals.hiddenPages === 1 ? "" : "s"}`
            : ""}
        </Fact>
        <Fact label="Bloques">
          {inventory.totals.visibleBlocks} visible
          {inventory.totals.visibleBlocks === 1 ? "" : "s"}
          {inventory.totals.hiddenBlocks > 0
            ? `, ${inventory.totals.hiddenBlocks} oculto${inventory.totals.hiddenBlocks === 1 ? "" : "s"}`
            : ""}
        </Fact>
        <Fact label="Regla de muestra">
          {SAMPLE_POLICY_WORD[inventory.samplePolicy.mode] ?? inventory.samplePolicy.mode}
          {inventory.samplePolicy.mode === "show_all"
            ? ""
            : ` (mínimo ${inventory.samplePolicy.threshold})`}
          {inventory.samplePolicy.overrides > 0
            ? `. ${inventory.samplePolicy.overrides} bloque${inventory.samplePolicy.overrides === 1 ? "" : "s"} con su propia regla.`
            : ""}
        </Fact>
        <Fact label="Portada">
          {inventory.identity.visible
            ? `Se muestra: ${inventory.identity.shows.join(", ") || "nada"}.`
            : "No se muestra."}
          {inventory.identity.organization ? ` Cliente: ${inventory.identity.organization}.` : ""}
          {inventory.identity.reportDownload ? " Ofrece descargar el reporte." : ""}
        </Fact>
      </dl>

      <h4 className="mt-5 text-sm font-semibold text-strong">Páginas y bloques</h4>
      <ul className="mt-2 space-y-3">
        {inventory.pages.map((page) => (
          <li key={page.id} className="rounded-lg border border-line bg-surface-sunken p-3">
            <p className="text-sm font-semibold text-strong">
              {page.title}
              {page.visible ? "" : " · oculta"}
            </p>
            <p className="text-xs text-muted">
              {page.visibleBlocks} bloque{page.visibleBlocks === 1 ? "" : "s"} visible
              {page.visibleBlocks === 1 ? "" : "s"}
              {page.hiddenBlocks > 0 ? ` · ${page.hiddenBlocks} oculto${page.hiddenBlocks === 1 ? "" : "s"}` : ""}
            </p>
            <ul className="mt-2 space-y-1">
              {page.blocks.map((block) => (
                <li key={block.id} className="text-sm text-body">
                  <span className="font-medium text-strong">{block.label}</span>
                  <span className="text-muted"> · {block.typeLabel}</span>
                  {block.visible ? "" : <span className="text-muted"> · oculto</span>}
                  {block.result ? <> · muestra {block.result}</> : null}
                  {block.drawing ? <> · como {block.drawing}</> : null}
                  {block.brokenDownBy ? <> · por {block.brokenDownBy}</> : null}
                  {block.fixedFilters.length > 0 ? (
                    <> · filtro fijo: {block.fixedFilters.join("; ")}</>
                  ) : null}
                  {block.movedBy.length > 0 ? <> · lo mueven: {block.movedBy.join(", ")}</> : null}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {inventory.filters.length > 0 ? (
        <>
          <h4 className="mt-5 text-sm font-semibold text-strong">Filtros</h4>
          <ul className="mt-2 space-y-1">
            {inventory.filters.map((filter) => (
              <li key={filter.id} className="text-sm text-body">
                <span className="font-medium text-strong">{filter.label}</span> · sobre{" "}
                {filter.characteristic} · mueve {filter.movesBlocks} bloque
                {filter.movesBlocks === 1 ? "" : "s"}
                {filter.offered ? "" : " · ningún panel lo ofrece"}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {inventory.journeys.length > 0 ? (
        <>
          <h4 className="mt-5 text-sm font-semibold text-strong">Recorridos</h4>
          <ul className="mt-2 space-y-1">
            {inventory.journeys.map((journey) => (
              <li key={journey.id} className="text-sm text-body">
                <span className="font-medium text-strong">{journey.title}</span> ·{" "}
                {journey.visibleMoments} de {journey.moments} momentos visibles ·{" "}
                {journey.momentsWithResult} con resultado
                {journey.momentsWithAwareness > 0
                  ? ` · ${journey.momentsWithAwareness} con “no lo conocía”`
                  : ""}
                {journey.semaforo ? ` · semáforo ${journey.semaforo}` : ""}
                {journey.placed ? "" : " · no está en ninguna página visible"}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {inventory.bands.length > 0 ? (
        <>
          <h4 className="mt-5 text-sm font-semibold text-strong">Semáforos</h4>
          <ul className="mt-2 space-y-1">
            {inventory.bands.map((band) => (
              <li key={band.id} className="text-sm text-body">
                <span className="font-medium text-strong">{band.title}</span> · {band.bands} bandas ·{" "}
                {band.complete ? "completo" : "incompleto"} · lo usan {band.usedBy}
                {band.filterResult ? ` · también filtra ${band.filterResult}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {inventory.qualitative.clouds > 0 ? (
        <>
          <h4 className="mt-5 text-sm font-semibold text-strong">Contenido cualitativo</h4>
          <p className="mt-1 text-sm text-body">
            {inventory.qualitative.clouds} nube
            {inventory.qualitative.clouds === 1 ? "" : "s"} de temas, leyendo{" "}
            {inventory.qualitative.sources.join(", ")}. Solo entran categorías confirmadas en la
            revisión cualitativa; nunca una cita ni una sugerencia pendiente.
          </p>
        </>
      ) : null}

      {inventory.unsupported.length > 0 ? (
        <div className="mt-5 rounded-lg border border-caution-line bg-caution-surface p-3">
          <h4 className="text-sm font-semibold text-caution">Configuración que esta versión no dibuja</h4>
          <ul className="mt-1 space-y-1">
            {inventory.unsupported.map((entry) => (
              <li key={entry.blockId} className="text-sm text-caution">
                {entry.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm text-body">{children}</dd>
    </div>
  );
}

/** One revision's identity, as a reviewer needs to quote it. */
export function RevisionFacts({
  revision,
  hash,
  preparedAt,
  sourceDraftRevision,
  note,
  acknowledged,
  extra,
}: {
  revision: number;
  hash: string;
  preparedAt: string;
  sourceDraftRevision: number;
  note: string | null;
  acknowledged: readonly string[];
  extra?: React.ReactNode;
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <Fact label="Revisión">{revision}</Fact>
      <Fact label="Preparada">{formatMoment(preparedAt)}</Fact>
      <Fact label="Borrador de origen">versión {sourceDraftRevision}</Fact>
      <Fact label="Huella del documento">
        <code className="font-mono text-xs">{shortHash(hash)}</code>
        <span className="text-muted"> · sha-256</span>
      </Fact>
      {note ? <Fact label="Nota interna">{note}</Fact> : null}
      {acknowledged.length > 0 ? (
        <Fact label="Advertencias reconocidas">{acknowledged.join(", ")}</Fact>
      ) : null}
      {extra}
    </dl>
  );
}

export function formatMoment(value: string): string {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

export const reviewAction =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken";
export const reviewPrimary =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50";
export { CARD as reviewCard, CAUTION_CARD as reviewCautionCard, DANGER_CARD as reviewDangerCard };

export function StaleNotice({ studyId }: { studyId: string }) {
  return (
    <section className={CAUTION_CARD}>
      <h3 className="text-base font-semibold text-caution">Esta revisión quedó desactualizada</h3>
      <p className="mt-1 max-w-prose text-sm text-caution">
        El borrador cambió después de que se preparó, así que esta revisión ya no describe lo que
        hay en Construcción. Puedes verla y compararla, y no se puede publicar: prepara una
        revisión nueva para publicar lo último.
      </p>
      <Link href={`/studio/e/${studyId}/construccion`} className={`${reviewAction} mt-3`}>
        Abrir Construcción
      </Link>
    </section>
  );
}
