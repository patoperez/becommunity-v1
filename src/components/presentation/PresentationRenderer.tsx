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

import { chartVariantLabel, clientSeesBlock, clientSeesPage } from "@/lib/presentation";
import type { PresentationRenderModel, RenderBlock, RenderPage } from "@/lib/presentation";
import { AbsenceNotice, InternalPlaceholder, visibleNote, type PresentationAudience } from "./absence";
import { RENDERERS } from "./renderers";
import type { ViewerControls } from "./viewer";
import { DESKTOP_SPAN, TABLET_SPAN } from "./vocabulary";

export type { PresentationAudience };
export type { ViewerControls };

function byOrderThenId<T extends { order: number; id: string }>(a: T, b: T): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * THE PREDICATE IS NOT DEFINED HERE ANY MORE, AND THAT IS THE POINT.
 *
 * `clientSeesBlock` and `clientSeesPage` used to live in this file, and the
 * publication inventory and the publication preflight each had their own copy.
 * The three agreed until a filter panel became content on a live surface and an
 * unfinished edge on a dead one — and then a review screen counted three panels
 * its own preview did not draw.
 *
 * There is now one implementation, in `@/lib/presentation`, and every surface
 * that draws, counts or lists client-visible blocks reads it from there. `live`
 * is a property of the SURFACE — it is `viewer !== undefined`, the same fact
 * that makes the controls operable — and it is passed explicitly at every call
 * so no caller can forget which surface it is on.
 */

function BlockCard({
  block,
  audience,
  viewer,
}: {
  block: RenderBlock;
  audience: PresentationAudience;
  viewer?: ViewerControls;
}) {
  if (!block.visible) return null;
  if (audience === "client" && !clientSeesBlock(block, viewer !== undefined)) return null;

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
          <Leaf block={block} audience={audience} viewer={viewer} />
        ) : audience === "internal" ? (
          <InternalPlaceholder
            title="Esta versión no dibuja esta forma"
            detail={`El bloque pide «${chartVariantLabel(block.chartVariant)}» y no hay componente para ella en esta versión. No se sustituye por otra: eso cambiaría lo que el documento dice sin que nadie lo decidiera.`}
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

      {/*
        WHAT A READER'S SELECTION DID TO THIS BLOCK.

        The sentence is the server's — it names the characteristics and the
        values a person chose, in the study's own words — and it is shown to
        EVERYONE, because a figure computed over part of a population and
        presented without saying so is the most quietly misleading thing a
        dashboard can print.

        The connection COUNT beside it stays internal: which panels an author
        wired to which block is authoring information, and a reader has no use
        for it.
      */}
      {block.activeFilterSummary ? (
        <p className="mt-3 border-t border-line pt-2 text-xs text-muted">
          Filtrado por {block.activeFilterSummary}.
        </p>
      ) : null}
      {audience === "internal" && block.connectedFilterPanelIds.length > 0 ? (
        <p className="mt-1 text-xs text-muted">
          Sólo interno · Qué filtros lo mueven: {block.connectedFilterPanelIds.length}{" "}
          {block.connectedFilterPanelIds.length === 1 ? "panel conectado" : "paneles conectados"}.
        </p>
      ) : null}
    </section>
  );
}

export function PresentationPageView({
  page,
  audience,
  viewer,
}: {
  page: RenderPage;
  audience: PresentationAudience;
  viewer?: ViewerControls;
}) {
  const blocks = [...page.blocks].sort((a, b) => byOrderThenId(
    { order: a.placement.order, id: a.id },
    { order: b.placement.order, id: b.id },
  ));
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 lg:grid-cols-12">
      {blocks.map((block) => {
        if (!block.visible) return null;
        if (audience === "client" && !clientSeesBlock(block, viewer !== undefined)) return null;
        const desktop = DESKTOP_SPAN[block.placement.span.desktop] ?? DESKTOP_SPAN[12];
        const tablet = TABLET_SPAN[block.placement.span.tablet] ?? TABLET_SPAN[12];
        // Mobile is always the full width the contract fixes it at, which is
        // `grid-cols-1` above: there is no mobile span class, because there is
        // no mobile span decision.
        return (
          <div key={block.id} className={`min-w-0 ${tablet} ${desktop}`}>
            <BlockCard block={block} audience={audience} viewer={viewer} />
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
  viewer,
}: {
  model: PresentationRenderModel;
  audience: PresentationAudience;
  /** Draw one page. Omitted, every page is drawn in order. */
  pageId?: string;
  /**
   * Present only on a surface where a reader may operate a filter.
   *
   * Its absence is what makes the authoring canvas honest: the controls are
   * drawn, they are genuinely `disabled`, and they say where filtering works.
   */
  viewer?: ViewerControls;
}) {
  const pages = [...model.pages].sort(byOrderThenId);
  const selected = pageId === undefined ? pages : pages.filter((page) => page.id === pageId);
  // A page a client would see nothing on is not drawn at all — not its section,
  // not its heading, not its margin. Studio still draws every page, because a
  // reviewer's whole job is to see the ones a client will not.
  const shown =
    audience === "client"
      ? selected.filter((page) => clientSeesPage(page, viewer !== undefined))
      : selected;
  return (
    <div className="w-full min-w-0">
      {shown.map((page) => (
        <section key={page.id} className="mb-8 last:mb-0">
          {pageId === undefined && shown.length > 1 ? (
            <h2 className="mb-3 font-display text-xl font-semibold text-strong">{page.title}</h2>
          ) : null}
          <PresentationPageView page={page} audience={audience} viewer={viewer} />
        </section>
      ))}
    </div>
  );
}
