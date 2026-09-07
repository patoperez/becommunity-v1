/**
 * THE PRESENTATION RENDERER — it receives a render model and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT MAY BE HANDED.
 *
 * A `PresentationRenderModel` and an audience. Not a `PresentationDocument`, not
 * a `PresentationCatalog`, not a registry, not `CanonicalStudyResults`, not a
 * row. The prop types are the enforcement: there is nowhere to put any of those
 * things, and a caller holding one has to leave it behind.
 *
 * That is why the composer passes the render model it got back from the server
 * rather than resolving its own document in the browser. Resolving client-side
 * would need the registry's address map, and a browser holding an address is a
 * browser one step from owning a number.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SORT IS THE RENDERER'S JOB.
 *
 * The resolver carries pages and blocks in DOCUMENT order and leaves
 * `order` as the intended sort key. So this file sorts, and it sorts totally —
 * by `order`, then by `id` — because two blocks at the same order would
 * otherwise draw in whatever order the array happened to hold, and "whatever the
 * array happened to hold" is not a layout anybody authored.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN INVISIBLE BLOCK IS NOT A WITHHELD ONE.
 *
 * `visible: false` is a layout decision: the block still resolved and its values
 * are present in this model. It is not drawn, and it is never used to express
 * that something was suppressed — that is what `sampleDisplay` is for, and the
 * two must not be read for each other.
 */

import type { PresentationRenderModel, RenderBlock, RenderPage } from "@/lib/presentation";
import { AbsenceNotice, InternalPlaceholder, visibleNote, type PresentationAudience } from "./absence";
import { RENDERERS } from "./renderers";
import { DESKTOP_SPAN, TABLET_SPAN } from "./vocabulary";

export type { PresentationAudience };

function byOrderThenId<T extends { order: number; id: string }>(a: T, b: T): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Does this block have anything a CLIENT may be shown?
 *
 * C11: a block whose whole content is an omission renders as nothing — no card,
 * no heading, no reserved row. The question has to be asked BEFORE the card is
 * drawn, which is why it lives here and not inside each leaf: a leaf returning
 * null still leaves a bordered box with a title over an empty space, and an
 * empty box is exactly the shape of a gap C11 removes.
 */
function clientHasContent(block: RenderBlock): boolean {
  const payload = block.payload;
  // AN ABSENCE THE CONTRACT STATES IS NOT A GAP WE MADE.
  //
  // "Nobody responded" and "no authority states this relationship" are facts
  // about the STUDY, and C11's exception is explicit that a caveat about what a
  // reader is being shown survives. An earlier version filtered any block with
  // an empty payload, so those two sentences were removed along with the gaps —
  // the opposite defect, and the more damaging one, because it makes a study
  // look complete where it was honest.
  const stated =
    "absence" in payload &&
    payload.absence !== null &&
    (payload.absence.state === "unavailable" || payload.absence.state === "unresolved");
  if (stated) return true;
  switch (payload.shape) {
    case "value":
      return payload.value !== null;
    case "categories":
      return payload.categories.length > 0;
    case "series":
      return payload.points.some((point) =>
        point.measures.some(
          (measure) =>
            measure.value !== null ||
            measure.absence?.state === "unavailable" ||
            measure.absence?.state === "unresolved",
        ),
      );
    case "terms":
      return payload.terms.length > 0;
    case "cohorts":
      return payload.cohorts.length > 0;
    case "instrument_bases":
      return payload.instruments.length > 0;
    case "touchpoint":
      return payload.satisfaction !== null || payload.processUnawareness !== null || payload.unawarenessShare !== null;
    case "journey_group":
      return payload.touchpointCount > 0;
    // A route with no points is a route nobody finished configuring: the
    // block exists, and there is nothing in it for a reader.
    case "routes":
      return payload.routes.some((route) => route.points.length > 0);
    case "editorial":
      return payload.body !== null;
    // A filter panel has no viewer behaviour in this unit, so it is internal-only.
    case "filter_controls":
      return false;
    default:
      return false;
  }
}

/**
 * Would a CLIENT see anything at all for this block?
 *
 * `clientHasContent` asks about the payload. This asks the whole question,
 * including the block-level sample outcome: a block whose sample was withheld
 * by policy carries no content AND, unless somebody authored a public note, no
 * sentence either — so on a client surface it is a titled card over nothing,
 * which is the exact shape C11 removes.
 */
function clientSeesBlock(block: RenderBlock): boolean {
  if (!block.visible) return false;
  if (block.sampleDisplay.state === "withheld_by_policy") {
    return visibleNote(block.sampleDisplay) !== null;
  }
  return clientHasContent(block);
}

/**
 * And would a client see anything at all for this PAGE?
 *
 * A page heading over nothing is a heading over nothing whether the emptiness
 * came from one block or from all of them. Without this, a page whose every
 * block is withheld or configuration-required still printed its title and its
 * spacing on a client surface — an absence with a name on it.
 */
function clientSeesPage(page: RenderPage): boolean {
  return page.blocks.some(clientSeesBlock);
}

function BlockCard({ block, audience }: { block: RenderBlock; audience: PresentationAudience }) {
  if (!block.visible) return null;
  if (audience === "client" && !clientSeesBlock(block)) return null;

  const Leaf = block.chartVariant ? RENDERERS[block.chartVariant] : undefined;
  const note = visibleNote(block.sampleDisplay);
  const withheld = block.sampleDisplay.state === "withheld_by_policy";

  return (
    <section
      className="min-w-0 rounded-2xl border border-line bg-surface p-[clamp(1rem,0.8rem+0.6vw,1.5rem)]"
      style={block.placement.responsive === "scroll_x" ? { overflowX: "auto" } : undefined}
      aria-label={block.copy.title ?? undefined}
    >
      {block.copy.title ? (
        <h3 className="font-display text-lg font-semibold text-strong [overflow-wrap:anywhere]">{block.copy.title}</h3>
      ) : null}
      {block.copy.description ? (
        <p className="mt-1 max-w-[62ch] text-sm text-muted [overflow-wrap:anywhere]">{block.copy.description}</p>
      ) : null}

      <div className={block.copy.title || block.copy.description ? "mt-3" : ""}>
        {withheld ? (
          <AbsenceNotice absence={{ state: "withheld_by_policy" }} audience={audience} />
        ) : Leaf ? (
          <Leaf block={block} audience={audience} />
        ) : audience === "internal" ? (
          <InternalPlaceholder
            title="Esta versión no dibuja esta forma"
            detail={`El bloque pide «${block.chartVariant ?? "ninguna forma"}» y no hay componente para ella en esta versión. No se sustituye por otra: eso cambiaría lo que el documento dice sin que nadie lo decidiera.`}
            action="Elige otra forma en la ficha del bloque."
          />
        ) : null}
      </div>

      {note ? <p className="mt-3 text-xs text-muted [overflow-wrap:anywhere]">{note}</p> : null}
      {block.copy.annotation ? (
        <p className="mt-2 text-xs text-muted [overflow-wrap:anywhere]">{block.copy.annotation}</p>
      ) : null}
      {block.methodology.explanation ? (
        <p className="mt-2 text-xs text-muted [overflow-wrap:anywhere]">{block.methodology.explanation}</p>
      ) : null}

      {audience === "internal" && block.connectedFilterPanelIds.length > 0 ? (
        <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
          Sólo interno · Qué filtros lo mueven: {block.connectedFilterPanelIds.length}{" "}
          {block.connectedFilterPanelIds.length === 1 ? "panel conectado" : "paneles conectados"}. El filtrado en
          vivo llega en la Unidad 6B.2.
        </p>
      ) : null}
    </section>
  );
}

export function PresentationPageView({
  page,
  audience,
}: {
  page: RenderPage;
  audience: PresentationAudience;
}) {
  const blocks = [...page.blocks].sort((a, b) => byOrderThenId(
    { order: a.placement.order, id: a.id },
    { order: b.placement.order, id: b.id },
  ));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 lg:grid-cols-12">
      {blocks.map((block) => {
        if (!block.visible) return null;
        if (audience === "client" && !clientSeesBlock(block)) return null;
        const desktop = DESKTOP_SPAN[block.placement.span.desktop] ?? DESKTOP_SPAN[12];
        const tablet = TABLET_SPAN[block.placement.span.tablet] ?? TABLET_SPAN[12];
        // Mobile is always the full width the contract fixes it at, which is
        // `grid-cols-1` above: there is no mobile span class, because there is
        // no mobile span decision.
        return (
          <div key={block.id} className={`min-w-0 ${tablet} ${desktop}`}>
            <BlockCard block={block} audience={audience} />
          </div>
        );
      })}
    </div>
  );
}

export function PresentationRenderer({
  model,
  audience,
  pageId,
}: {
  model: PresentationRenderModel;
  audience: PresentationAudience;
  /** Draw one page. Omitted, every page is drawn in order. */
  pageId?: string;
}) {
  const pages = [...model.pages].sort(byOrderThenId);
  const selected = pageId === undefined ? pages : pages.filter((page) => page.id === pageId);
  // A page a client would see nothing on is not drawn at all — not its section,
  // not its heading, not its margin. Studio still draws every page, because a
  // reviewer's whole job is to see the ones a client will not.
  const shown = audience === "client" ? selected.filter(clientSeesPage) : selected;
  return (
    <div className="w-full min-w-0">
      {shown.map((page) => (
        <section key={page.id} className="mb-8 last:mb-0">
          {pageId === undefined && shown.length > 1 ? (
            <h2 className="mb-3 font-display text-xl font-semibold text-strong">{page.title}</h2>
          ) : null}
          <PresentationPageView page={page} audience={audience} />
        </section>
      ))}
    </div>
  );
}
