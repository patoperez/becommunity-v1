"use client";

import { useMemo, useState, useTransition } from "react";

import { PAIN_GAP_DETAIL, PAIN_STATE_LABEL } from "@/lib/publication";
import type {
  PainDecisionResult,
  PainDisposition,
  PainItemState,
  PainReviewItem,
  PainReviewPanel,
  RecordJourneyPainDecision,
} from "@/lib/publication";

/**
 * THE JOURNEY PAIN EDITOR — where a person decides what the client reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS WRITTEN FOR A CONSULTANT, NOT FOR AN ENGINEER.
 *
 * Every word on this screen is Spanish somebody says out loud. There is no
 * handle printed, no digest, no uuid, no code and no threshold — not because
 * each is filtered out, but because the payload has nowhere to put one. What
 * arrives is a curated phrase, the wording the source gave its stage, a count
 * the server made, four closed words and two opaque tokens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING ON THIS SCREEN PROPOSES A MATCH.
 *
 * The touchpoint list is the WHOLE list, grouped under the five visible routes,
 * in the order the client's page draws them. Nothing is preselected, nothing is
 * highlighted, nothing is sorted by how much it resembles the source's wording,
 * and no candidate is marked «probable». The source wording is shown BESIDE the
 * list as context — it is what a reviewer is deciding about — and it is never
 * used to order, rank or filter the list on its own.
 *
 * THE SEARCH BOX IS A FILTER AND NOT A SUGGESTION. It narrows a list a person
 * is already looking at, by what THEY type, and it starts empty. It never
 * pre-fills itself from the source phrase; a search box that typed the source's
 * words into itself would be a proposal wearing a filter's clothes, and the
 * first item under it would be read as the answer.
 *
 * The reason is measured rather than stylistic: of the eighteen curated stage
 * labels, zero match a canonical survey item's label, six match the workbook's
 * short label row and five match the bracketed text inside the prompt. Three
 * defensible readings, three different answers.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PHRASE MAY GO TO SEVERAL POINTS, AND THE CONTROL SAYS SO.
 *
 * Checkboxes, not a radio group and not a select. «Reunión semanal
 * presencial/en línea» is one source stage over two touchpoints, so a control
 * that could express only one choice would be unable to express next year's
 * study. The count beside the heading is the server's; this component adds
 * nothing up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DRAWS. IT DOES NOT DECIDE.
 *
 * No aggregation, no deduplication, no classification, no phrase counting, and
 * no completeness rule. `panel.counts`, `panel.gaps` and `panel.complete` all
 * arrive finished from the server, and every decision is sent there and read
 * back — the screen never predicts what the answer will be.
 */

const CARD =
  "rounded-xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-strong px-4 py-2.5 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-40";
const GHOST =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40";

const STATE_TONE: Record<PainItemState, string> = {
  unreviewed: "border-line-strong bg-surface-sunken text-muted",
  approved: "border-positive-line bg-positive-surface text-positive",
  rejected: "border-line-strong bg-surface-sunken text-body",
  unresolved: "border-caution-line bg-caution-surface text-caution",
};

export function JourneyPainEditor({
  studyId,
  panel,
  decide,
}: {
  studyId: string;
  panel: PainReviewPanel;
  decide: RecordJourneyPainDecision;
}) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ token: string; result: PainDecisionResult } | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * The touchpoints, grouped under the routes that draw them.
   *
   * A GROUPING OF A LIST THE SERVER ORDERED, and nothing more: the routes come
   * out in the order they were first seen, which is the order the client's page
   * draws them, and the points inside each keep the order that route shows
   * them. No sort, no rank, no relevance.
   */
  const routes = useMemo(() => {
    const grouped: { title: string; points: { handle: string; label: string }[] }[] = [];
    for (const choice of panel.choices) {
      let route = grouped.find((entry) => entry.title === choice.routeTitle);
      if (!route) {
        route = { title: choice.routeTitle, points: [] };
        grouped.push(route);
      }
      route.points.push({ handle: choice.handle, label: choice.label });
    }
    return grouped;
  }, [panel.choices]);

  if (!panel.applicable) {
    return (
      <section className={CARD} data-testid="dolor-no-aplica">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Sólo interno · no lo ve el cliente
        </p>
        <h2 className="mt-1 font-display text-base font-semibold text-strong">
          Este estudio no trae frases del recorrido
        </h2>
        <p className="mt-1.5 max-w-prose text-sm text-muted">
          El material de origen de este estudio no incluye frases curadas asociadas a etapas del
          recorrido, así que no hay nada que revisar aquí.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5" data-testid="editor-dolor">
      {/* 1 ─ WHERE THE REVIEW IS. ------------------------------------------- */}
      <section className={CARD} aria-labelledby="dolor-estado">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
          Sólo interno · no lo ve el cliente
        </p>
        <h2 id="dolor-estado" className="mt-1 font-display text-base font-semibold text-strong">
          Puntos de dolor del recorrido
        </h2>
        <p className="mt-1.5 max-w-prose text-sm text-muted">
          Estas son las frases que el equipo escribió sobre el recorrido. Para cada una decides si
          se publica —y con qué palabras— o si se queda fuera, y a qué puntos del recorrido
          pertenece. La lista de puntos está completa y no viene marcada: el vocabulario del
          material de origen y el del recorrido del cliente no coinciden, así que la
          correspondencia la eliges tú.
        </p>
        <dl
          className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr))]"
          data-testid="dolor-conteos"
        >
          {(
            [
              ["Sin revisar", panel.counts.unreviewed],
              ["Aprobadas", panel.counts.approved],
              ["Excluidas", panel.counts.rejected],
              ["Sin resolver", panel.counts.unresolved],
            ] as const
          ).map(([label, count]) => (
            <div key={label} className="rounded-md border border-line bg-surface-sunken px-3 py-2">
              <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
                {label}
              </dt>
              <dd className="mt-0.5 font-display text-xl font-bold text-strong tabular">{count}</dd>
            </div>
          ))}
        </dl>
        {panel.complete ? (
          <p className="mt-3 text-sm text-positive" data-testid="dolor-completo">
            La revisión está terminada. La nube y las marcas del recorrido ya se arman con lo que
            aprobaste.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5" data-testid="dolor-faltantes">
            {panel.gaps.map((gap) => (
              <li key={gap} className="max-w-prose text-sm text-caution">
                {PAIN_GAP_DETAIL[gap]}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 ─ THE QUEUE. ----------------------------------------------------- */}
      <ul className="space-y-4" data-testid="dolor-lista">
        {panel.items.map((item) => (
          <PainItemCard
            key={item.token}
            item={item}
            routes={routes}
            open={openToken === item.token}
            onOpen={() => setOpenToken(openToken === item.token ? null : item.token)}
            pending={pending}
            outcome={outcome?.token === item.token ? outcome.result : null}
            onDecide={(disposition, phrase, touchpoints, rationale) => {
              setOutcome(null);
              startTransition(async () => {
                const result = await decide(studyId, {
                  token: item.token,
                  disposition,
                  publicPhrase: phrase,
                  touchpoints,
                  rationale,
                });
                setOutcome({ token: item.token, result });
              });
            }}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * One phrase, and the decision about it.
 *
 * THE FORM OPENS EMPTY OF SUGGESTIONS AND FULL OF WHAT WAS DECIDED. On an item
 * nobody has decided, the public phrase starts as the CURATED PHRASE — which is
 * not a proposal about a MAPPING but the obvious starting text for an edit a
 * person is being asked to make, and it is the phrase they are looking at. No
 * touchpoint is ticked, and the search box is empty.
 */
function PainItemCard({
  item,
  routes,
  open,
  onOpen,
  pending,
  outcome,
  onDecide,
}: {
  item: PainReviewItem;
  routes: { title: string; points: { handle: string; label: string }[] }[];
  open: boolean;
  onOpen: () => void;
  pending: boolean;
  outcome: PainDecisionResult | null;
  onDecide: (
    disposition: PainDisposition,
    phrase: string | null,
    touchpoints: string[],
    rationale: string | null,
  ) => void;
}) {
  const [phrase, setPhrase] = useState(item.publicPhrase ?? item.curatedPhrase);
  const [chosen, setChosen] = useState<string[]>([...item.touchpoints]);
  const [rationale, setRationale] = useState(item.rationale ?? "");
  const [search, setSearch] = useState("");

  /**
   * The list, narrowed by what the reviewer typed. Nothing else narrows it.
   *
   * A plain case-insensitive substring over the touchpoint's own label and its
   * route's title. It is not scored, not ranked and not reordered — a filtered
   * list is still the document's order — and it is empty of effect until
   * somebody types, because `search` starts empty and nothing writes to it.
   */
  const shown = routes
    .map((route) => ({
      title: route.title,
      points:
        search.trim().length === 0
          ? route.points
          : route.points.filter(
              (point) =>
                point.label.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")) ||
                route.title.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es")),
            ),
    }))
    .filter((route) => route.points.length > 0);

  const toggle = (handle: string) =>
    setChosen((current) =>
      current.includes(handle) ? current.filter((entry) => entry !== handle) : [...current, handle],
    );

  return (
    <li className={CARD} data-testid="dolor-item" data-token={item.token}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold text-strong [overflow-wrap:anywhere]">
            {item.curatedPhrase}
          </p>
          <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
            Etapa que indicó el material de origen: {item.sourceContext}
            {item.occurrences > 1
              ? ` · esta frase aparece ${item.occurrences} veces en el material`
              : ""}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${STATE_TONE[item.state]}`}
          data-testid="dolor-estado-item"
        >
          {PAIN_STATE_LABEL[item.state]}
        </span>
      </div>

      {item.stale ? (
        <p className="mt-2 rounded-md border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution" data-testid="dolor-caducado">
          El material de origen de esta frase cambió después de que se decidió, así que la decisión
          anterior ya no vale. Vuelve a leerla y decide otra vez.
        </p>
      ) : null}

      {item.state === "approved" && item.publicPhrase ? (
        <p className="mt-2 text-sm text-body [overflow-wrap:anywhere]">
          Texto público aprobado: «{item.publicPhrase}» · {item.touchpoints.length}{" "}
          {item.touchpoints.length === 1 ? "punto de contacto" : "puntos de contacto"}
        </p>
      ) : null}
      {item.state !== "approved" && item.rationale ? (
        <p className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">Motivo: {item.rationale}</p>
      ) : null}

      <button type="button" className={`${GHOST} mt-3`} onClick={onOpen} data-testid="dolor-abrir">
        {open ? "Cerrar" : item.state === "unreviewed" ? "Decidir" : "Cambiar la decisión"}
      </button>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <div>
            <label
              className="block text-sm font-semibold text-strong"
              htmlFor={`frase-${item.token}`}
            >
              Texto público
            </label>
            <p className="mt-0.5 max-w-prose text-xs text-muted">
              Esto es lo que leería el cliente. Puedes reescribirlo; el material de origen no
              cambia.
            </p>
            <input
              id={`frase-${item.token}`}
              type="text"
              maxLength={300}
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-body"
              data-testid="dolor-frase"
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-strong">Puntos de contacto</p>
            <p className="mt-0.5 max-w-prose text-xs text-muted">
              Marca todos los que correspondan. Una misma frase puede pertenecer a más de uno.
              Ninguno viene marcado: la correspondencia la eliges tú.
            </p>
            <input
              type="search"
              value={search}
              placeholder="Buscar en la lista"
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar entre los puntos de contacto"
              className="mt-1.5 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-body"
              data-testid="dolor-buscar"
            />
            <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-line p-3">
              {shown.map((route) => (
                <fieldset key={route.title}>
                  <legend className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
                    {route.title}
                  </legend>
                  <ul className="mt-1 space-y-1">
                    {route.points.map((point) => (
                      <li key={point.handle}>
                        <label className="flex min-h-11 cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={chosen.includes(point.handle)}
                            onChange={() => toggle(point.handle)}
                            data-testid="dolor-punto"
                            data-handle={point.handle}
                          />
                          <span className="text-sm text-body [overflow-wrap:anywhere]">
                            {point.label}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              ))}
              {shown.length === 0 ? (
                <p className="text-sm text-muted">
                  Ningún punto de contacto coincide con lo que escribiste. Borra la búsqueda para
                  ver la lista completa.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-semibold text-strong"
              htmlFor={`motivo-${item.token}`}
            >
              Motivo (opcional)
            </label>
            <p className="mt-0.5 max-w-prose text-xs text-muted">
              Por qué se excluye, o por qué no se puede resolver todavía. Queda en el registro
              interno.
            </p>
            <input
              id={`motivo-${item.token}`}
              type="text"
              maxLength={300}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-body"
              data-testid="dolor-motivo"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={pending}
              onClick={() => onDecide("approved", phrase, chosen, rationale)}
              data-testid="dolor-aprobar"
            >
              Aprobar y asignar
            </button>
            <button
              type="button"
              className={GHOST}
              disabled={pending}
              onClick={() => onDecide("rejected", null, [], rationale)}
              data-testid="dolor-excluir"
            >
              Excluir
            </button>
            <button
              type="button"
              className={GHOST}
              disabled={pending}
              onClick={() => onDecide("unresolved", null, [], rationale)}
              data-testid="dolor-sin-resolver"
            >
              Dejar sin resolver
            </button>
          </div>

          {outcome ? (
            <p
              className={`text-sm ${outcome.ok ? "text-positive" : "text-danger"}`}
              role="status"
              data-testid="dolor-resultado"
            >
              {outcome.ok
                ? outcome.replayed
                  ? "Esa misma decisión ya estaba registrada. Recarga la pantalla para verla."
                  : "Decisión registrada. Recarga la pantalla para verla como el estado actual."
                : outcome.detail}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
