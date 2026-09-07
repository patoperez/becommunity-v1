/**
 * THE FILTER CONTROLS — drawn, and visibly not working yet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CONTROL THAT LOOKS LIVE AND DOES NOTHING IS WORSE THAN NO CONTROL.
 *
 * Unit 6B.1 AUTHORS filter panels and their explicit connections. It does not
 * execute viewer filtering — that is Unit 6B.2 — and the temptation in between
 * is to render the controls "for the layout" and let a reviewer discover by
 * clicking that nothing happens. A reviewer who clicks a live-looking control
 * and sees numbers not move has learnt something false about the product, and
 * will report it as a bug or, worse, will not.
 *
 * So every control here is genuinely `disabled`, wears the disabled styling, and
 * sits under one sentence that says when it will work. The option counts are
 * real — they come from the resolved model — because how many people are in each
 * segment is a fact the panel legitimately knows and shows.
 *
 * A CLIENT SEES NOTHING. On a client surface this whole block renders as null.
 * A public route today has no interactive filtering, and a dead control on a
 * finished deliverable is exactly the sort of unfinished edge C11 exists to keep
 * off the client's page.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { RenderBlock } from "@/lib/presentation";
import { InternalPlaceholder, type PresentationAudience } from "./absence";
import { Count } from "./primitives";

export function FilterControl({
  block,
  audience,
}: {
  block: RenderBlock;
  audience: PresentationAudience;
}) {
  if (block.payload.shape !== "filter_controls") return null;
  if (audience === "client") return null;

  const { dimensions } = block.payload;
  if (dimensions.length === 0) {
    return (
      <InternalPlaceholder
        title="Panel sin características"
        detail="Este panel no ofrece todavía ninguna característica por la que filtrar, así que no mueve nada."
        action="Elige sus características en la ficha del bloque."
      />
    );
  }

  return (
    <div>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))]">
        {dimensions.map((dimension) => (
          <div key={dimension.handle}>
            <p className="text-xs font-semibold text-muted">{dimension.label}</p>
            <select
              disabled
              aria-label={`${dimension.label} (todavía no filtra)`}
              className="mt-1 min-h-11 w-full cursor-not-allowed rounded-md border border-line bg-surface-sunken px-2 text-sm text-muted opacity-70"
              defaultValue=""
            >
              <option value="">Todas</option>
              {dimension.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value}
                </option>
              ))}
            </select>
            {/*
              Each option's own participant count, listed. NOT a total: adding
              them would be this layer producing a number the study never
              produced, and a segment total is exactly the kind of figure a
              reader would then quote.
            */}
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {dimension.options.map((option) => (
                <li key={option.value}>
                  {option.value} — <Count of={option.participants} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <InternalPlaceholder
          title="Los filtros todavía no filtran"
          detail="Esta fase autora los paneles y sus conexiones explícitas; el filtrado en vivo llega en la Unidad 6B.2. Los controles están deshabilitados a propósito para que nadie los lea como funcionales."
        />
      </div>
    </div>
  );
}
