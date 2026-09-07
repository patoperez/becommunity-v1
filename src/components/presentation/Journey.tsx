"use client";

/**
 * THE JOURNEY ROUTE MAP — one continuous path, one detail panel.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A PATH AND NOT A GRID OF CARDS.
 *
 * A journey is an order. Fifty-five independent cards are a list of touchpoints
 * that happens to be sorted; a line drawn through them is a claim that one
 * follows another, which is the claim the study is actually making. The approved
 * dashboard draws exactly one line — serpentine on a wide screen, a gentle
 * vertical wave on a narrow one — and puts the reading for the SELECTED point in
 * a single panel below it rather than repeating a card per point.
 *
 * The breakpoint is MEASURED, not declared: the layout asks its own container
 * how wide it is, because this map lives inside a composer canvas whose width
 * depends on which side panels are open. A media query would answer about the
 * window and be wrong by two panel widths.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE GEOMETRY IS ALLOWED TO KNOW.
 *
 * Positions, path control points and radii. It reads a value only to pick a
 * colour through the band the server already assigned, and prints only
 * `formatted`. There is no threshold here, no scale, no comparison: a point is
 * green because the canonical band said green.
 *
 * THE LINE IS DRAWN TWICE. A base stroke is always visible so the route reads as
 * continuous from the first paint, and the animated stroke is drawn over it. A
 * route that assembles itself out of nothing is a route that is briefly a lie
 * about what the study contains — and under reduced motion the animation simply
 * does not run, leaving the finished line.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";

import type { RenderBlock, RenderRoute, RenderRoutePoint } from "@/lib/presentation";
import { AbsenceNotice, absenceSentence, type PresentationAudience } from "./absence";
import { BaseLine, Figure } from "./primitives";
import { bandPalette } from "./vocabulary";

type LeafProps = { block: RenderBlock; audience: PresentationAudience };

type Node = { x: number; y: number; point: RenderRoutePoint; index: number };
type Layout = { nodes: Node[]; path: string; width: number; height: number; vertical: boolean };

const SERPENTINE_BREAKPOINT = 620;

/** A wide layout: rows that alternate direction, joined by one continuous line. */
function serpentine(points: RenderRoutePoint[], width: number): Layout {
  // The padding is set by the LABEL width, not the node width — a node is 42px
  // across and its name is far wider, so padding to the node would clip the
  // first and last names of every row.
  const padX = 88;
  const usable = Math.max(width - padX * 2, 120);
  const columns = Math.max(2, Math.min(5, Math.floor(usable / 178) || 2));
  const rowHeight = 168;
  const topPad = 52;
  const step = columns > 1 ? usable / (columns - 1) : 0;

  const nodes: Node[] = points.map((point, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    // The boustrophedon flip: even rows run left to right, odd rows right to
    // left, so the line never has to jump back across the whole width.
    const slot = row % 2 === 0 ? column : columns - 1 - column;
    return { x: padX + slot * step, y: topPad + row * rowHeight, point, index };
  });

  const rows = Math.max(1, Math.ceil(points.length / columns));
  const height = topPad + (rows - 1) * rowHeight + 118;

  let path = "";
  nodes.forEach((node, index) => {
    if (index === 0) {
      path = `M ${node.x} ${node.y}`;
      return;
    }
    const previous = nodes[index - 1];
    if (Math.abs(node.y - previous.y) < 0.5) {
      path += ` L ${node.x} ${node.y}`;
      return;
    }
    // A row turn. One cubic that bulges outward past the edge it turns at, so
    // the corner reads as a turn rather than as a break in the line.
    const outward = node.x > width / 2 ? 1 : -1;
    const bulge = 52;
    path += ` C ${previous.x + outward * bulge} ${previous.y + 48}, ${node.x + outward * bulge} ${node.y - 48}, ${node.x} ${node.y}`;
  });

  return { nodes, path, width, height, vertical: false };
}

/** A narrow layout: one continuous gentle wave down the page. */
function spine(points: RenderRoutePoint[], width: number): Layout {
  const amplitude = Math.min(14, Math.max(7, width * 0.028));
  const x0 = Math.round(30 + amplitude);
  const rowHeight = 84;
  const topPad = 38;

  const nodes: Node[] = points.map((point, index) => ({
    x: x0 + amplitude * Math.sin((index * Math.PI) / 3),
    y: topPad + index * rowHeight,
    point,
    index,
  }));

  let path = nodes.length > 0 ? `M ${nodes[0].x} ${nodes[0].y}` : "";
  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1];
    const node = nodes[index];
    const mid = (previous.y + node.y) / 2;
    path += ` C ${previous.x} ${mid}, ${node.x} ${mid}, ${node.x} ${node.y}`;
  }

  return {
    nodes,
    path,
    width,
    height: topPad + Math.max(0, nodes.length - 1) * rowHeight + 46,
    vertical: true,
  };
}

function bandMark(point: RenderRoutePoint): string {
  const band = point.satisfaction?.band ?? null;
  return band ? bandPalette(band.semanticColor).mark : "var(--color-line-strong)";
}

export function JourneyRouteMap({ block, audience }: LeafProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const panelId = useId();

  useLayoutEffect(() => {
    const element = holder.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const routes: RenderRoute[] = block.payload.shape === "routes" ? block.payload.routes : [];
  const route = routes.find((candidate) => candidate.id === routeId) ?? routes[0] ?? null;

  const move = useCallback(
    (delta: number, total: number) => {
      setSelected((current) => {
        const next = current + delta;
        const clamped = next < 0 ? 0 : next >= total ? total - 1 : next;
        // Focus follows selection so arrow keys walk the route rather than
        // moving a selection the keyboard has left behind.
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`[data-journey-node="${clamped}"]`)?.focus();
        });
        return clamped;
      });
    },
    [],
  );

  if (block.payload.shape !== "routes") return null;
  if (routes.length === 0) {
    return <AbsenceNotice absence={{ state: "configuration_required" }} audience={audience} />;
  }
  if (!route) return null;

  const points = route.points;
  const layout = width > 0 && points.length > 0 ? (width < SERPENTINE_BREAKPOINT ? spine(points, width) : serpentine(points, width)) : null;
  const point = points[selected] ?? points[0] ?? null;

  return (
    <div>
      {routes.length > 1 ? (
        <div className="overflow-x-auto pb-1.5">
          <div role="tablist" aria-label="Rutas del recorrido" className="flex min-w-max gap-2">
            {routes.map((candidate) => {
              const active = candidate.id === route.id;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelId}
                  onClick={() => {
                    setRouteId(candidate.id);
                    setSelected(0);
                  }}
                  className={`min-h-11 whitespace-nowrap rounded-md border px-3 text-sm font-medium transition-colors duration-[var(--motion-state)] ease-brand motion-reduce:transition-none ${
                    active
                      ? "border-evidence bg-evidence text-on-inverse"
                      : "border-line bg-surface text-body hover:border-line-strong"
                  }`}
                >
                  {candidate.title}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div id={panelId} role="tabpanel" aria-label={route.title}>
        <p className="mt-3 text-xs text-muted">
          Dibujado a partir del grupo «{route.sourceGroupLabel}».
        </p>

        <div ref={holder} className="mt-2 w-full">
          {layout ? (
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width="100%"
              height={layout.height}
              role="img"
              aria-label={`Recorrido ${route.title}, ${points.length} puntos.`}
              className="block overflow-visible"
            >
              <path d={layout.path} fill="none" stroke="var(--color-line)" strokeWidth={3} strokeLinecap="round" />
              <path
                d={layout.path}
                fill="none"
                stroke="var(--color-evidence-line)"
                strokeWidth={3}
                strokeLinecap="round"
              />
              {layout.nodes.map((node) => {
                const active = node.index === selected;
                const mark = bandMark(node.point);
                const reading = node.point.satisfaction
                  ? `${node.point.label}: ${node.point.satisfaction.formatted}`
                  : `${node.point.label}: sin dato`;
                return (
                  <g
                    key={node.point.handle}
                    data-journey-node={node.index}
                    transform={`translate(${node.x} ${node.y})`}
                    tabIndex={0}
                    role="button"
                    aria-pressed={active}
                    aria-label={reading}
                    onClick={() => setSelected(node.index)}
                    onFocus={() => setSelected(node.index)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                        event.preventDefault();
                        move(1, points.length);
                      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                        event.preventDefault();
                        move(-1, points.length);
                      } else if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected(node.index);
                      }
                    }}
                    className="cursor-pointer outline-none [&:focus-visible>.halo]:opacity-100"
                  >
                    <circle className="halo" r={26} fill={mark} opacity={active ? 0.18 : 0} />
                    <circle r={18} fill="var(--color-surface)" stroke={mark} strokeWidth={active ? 5 : 3} />
                    <text
                      y={5}
                      textAnchor="middle"
                      className="tabular fill-[var(--color-strong)] text-[0.72rem] font-semibold"
                    >
                      {node.index + 1}
                    </text>
                    <text
                      x={layout.vertical ? 32 : 0}
                      y={layout.vertical ? 4 : 38}
                      textAnchor={layout.vertical ? "start" : "middle"}
                      className="fill-[var(--color-muted)] text-[0.66rem]"
                    >
                      {node.point.label.length > 26 ? `${node.point.label.slice(0, 25)}…` : node.point.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="h-24" />
          )}
        </div>

        {point ? (
          <div
            aria-live="polite"
            className="mt-3 rounded-lg border border-line border-l-[3px] border-l-evidence bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-base font-semibold text-strong [overflow-wrap:anywhere]">
                <span className="mr-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  Punto {selected + 1}
                </span>
                {point.label}
              </p>
            </div>
            <dl className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">Satisfacción</dt>
                <dd className="mt-0.5 font-display text-xl font-bold text-strong">
                  {point.satisfaction ? <Figure value={point.satisfaction} /> : <span className="text-sm font-normal text-muted">—</span>}
                </dd>
              </div>
              <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
                <dt className="text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
                  Desconocimiento del proceso
                </dt>
                <dd className="mt-0.5 font-display text-xl font-bold text-strong">
                  {point.processUnawareness ? (
                    <Figure value={point.processUnawareness} />
                  ) : (
                    <span className="text-sm font-normal text-muted">—</span>
                  )}
                </dd>
              </div>
            </dl>
            {point.base ? <BaseLine base={point.base} className="mt-2" /> : null}
            {point.absence ? (
              audience === "internal" ? (
                <p className="mt-2 text-xs text-muted">{absenceSentence(point.absence)}</p>
              ) : (
                <AbsenceNotice absence={point.absence} audience={audience} />
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
