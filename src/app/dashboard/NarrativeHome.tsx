import type { NarrativeHomeView } from "@/lib/dashboard/narrative";
import type { BrandConfig } from "@/lib/branding/config";
import { studyAccentVars } from "@/lib/brand/contrast";
import { domainFor } from "@/components/evidence/ScaleMark";
import { Forward } from "@/components/Actions";
import { BrandMark } from "@/components/BrandMark";
import PanoramaFindings, { type PanoramaFinding } from "./PanoramaFindings";
import {
  characteristicLabel,
  movementLabel,
  resultLanguage,
  unitLabel,
  humanize,
} from "@/lib/language/results";
import { studyBaseSentence } from "@/lib/language/sample";
import type { Audience } from "@/lib/dashboard/audience";

/**
 * The study panorama — the client's first impression.
 *
 * This Server Component builds the finding DATA; `PanoramaFindings` renders one
 * dominant finding and a compact navigator for the rest. Nothing is calculated
 * here: every number arrives already computed, already rounded and already
 * suppression-checked from `buildNarrativeHome`, which reads only sanitized
 * aggregate DTOs.
 *
 * AUDIENCE. A published client study is a composed piece of work, not a
 * checklist of what the consultancy has not finished. So the client view never
 * advertises a missing reading or missing comments; where the study is
 * quantitative-only it says so once, quietly, and moves on. The internal
 * preview gets the opposite treatment: a concise readiness notice naming
 * exactly what is still missing, marked as internal so it can never be mistaken
 * for client content.
 */
export default function NarrativeHome({
  view,
  brand,
  audience = "client",
}: {
  view: NarrativeHomeView;
  brand: BrandConfig;
  audience?: Audience;
}) {
  const studyAnchor = `study-${view.currentStudy.id}`;
  const reportHref = `/api/studies/${encodeURIComponent(view.currentStudy.id)}/report`;
  const findings: PanoramaFinding[] = [];

  // 1 — the results, in the order the view model already ranked them. The
  // FIRST is the lead; the rest become secondary findings in the same order.
  for (const metric of view.metrics.slice(0, 3)) {
    const language = resultLanguage(metric.key, metric.title);
    // Only the two measures with a real, defined domain get an absolute track.
    // A plain average lives on the client's own instrument, whose range the
    // sanitized aggregate does not carry.
    const unit = metric.key.startsWith("csat:")
      ? ("percent" as const)
      : metric.key === "nps" || metric.key.startsWith("nps")
        ? ("nps" as const)
        : null;
    const numeric = metric.value == null
      ? null
      : Number.parseFloat(metric.value.replace("%", ""));

    findings.push({
      id: metric.key,
      kind: "result",
      label: language.name,
      question: language.question,
      value: metric.value,
      caption: language.name,
      unit,
      numeric: numeric != null && Number.isFinite(numeric) ? numeric : null,
      peer: null,
      // The mark draws its own -100/0/+100 or 0 %/100 % anchors, so the caption
      // names the measure and no longer repeats the range.
      scaleNote: unit ? unitLabel(unit) : unitLabel("score"),
      context: movementLabel(metric.movement, metric.delta),
      sample: null,
      method: { summary: "Cómo se calcula", body: [language.method] },
      quote: null,
      actionLabel: "Ver el detalle en el estudio",
    });
  }

  // 2 — the weakest comparable touchpoint, when the study has a journey.
  if (view.spotlight) {
    const spot = view.spotlight;
    const numeric = Number.parseFloat(spot.value.replace("%", ""));
    const domain = spot.unit === "score" ? null : domainFor(spot.unit);
    findings.push({
      id: "spotlight",
      kind: "spotlight",
      label: `Más flojo: ${spot.label}`,
      question: "¿Dónde se siente más flojo el recorrido?",
      value: spot.value,
      caption: spot.label,
      unit: domain ? (spot.unit as "nps" | "percent") : null,
      numeric: Number.isFinite(numeric) ? numeric : null,
      peer: domain ? null : { min: spot.peerMin, max: spot.peerMax },
      scaleNote: domain
        ? `El más bajo de los ${spot.comparedWith} momentos medidos ${domain.label}.`
        : `El más bajo de los ${spot.comparedWith} momentos que se miden en la misma escala. ` +
          `La barra lo sitúa entre ellos, no contra un máximo.`,
      context: null,
      sample: { visibility: spot.visibility, count: spot.n },
      method: {
        summary: "Qué significa “el más bajo”",
        body: [
          "Es una ordenación de los números que ya se calcularon, no un juicio. " +
            "Solo se comparan momentos medidos en la misma escala, y que sea el " +
            "más bajo no significa por sí solo que esté mal.",
        ],
      },
      quote: null,
      actionLabel: `Recorrer los ${view.stageCount} momentos`,
    });
  }

  // 3 — what people said, when there is anything approved to show.
  if (view.themes.length > 0 || view.voice) {
    const top = view.themes[0];
    findings.push({
      id: "voces",
      kind: "voices",
      label: "Lo que dicen",
      question: "¿Qué están diciendo las personas?",
      value: null,
      caption: top ? humanize(top.theme) : "Comentarios aprobados",
      unit: null,
      numeric: null,
      peer: null,
      scaleNote: top
        ? `${top.count === 1 ? "1 comentario lo menciona" : `${top.count} comentarios lo mencionan`}` +
          (view.themes.length > 1
            ? `, por delante de ${humanize(view.themes[1].theme).toLowerCase()}.`
            : ".")
        : null,
      context: "Los comentarios no se convierten en porcentaje: se leen.",
      sample: null,
      method: {
        summary: "Cómo se eligen los temas",
        body: [
          "Cada tema fue confirmado por una persona del equipo, nunca por el " +
            "sistema, y cada cita se aprueba por separado. Se ordenan por cuántas " +
            "veces aparecen, no por importancia.",
        ],
      },
      quote: view.voice
        ? { quote: view.voice.quote, theme: view.voice.theme ? humanize(view.voice.theme) : null }
        : null,
      actionLabel: "Leer todos los temas y citas",
    });
  }

  // The lead finding gets the headline treatment; the rest sit in the navigator.
  const quantitativeOnly = view.themes.length === 0 && !view.voice;

  // Internal readiness — never rendered to a client. Only states the product
  // can actually prove from what it already loaded.
  const readiness = audience === "preview" ? gaps(view) : [];

  return (
    <section
      aria-labelledby="panorama-titulo"
      className="mb-10"
      // The tenant's own colour, resolved against a contrast floor before it can
      // paint anything. Set here as well as on the shell so the panorama stays
      // readable wherever it is rendered — including the internal preview.
      style={studyAccentVars(brand.primaryColor)}
    >
      {/* The opening statement: what this is and what it rests on. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div
          className="px-6 py-8 sm:px-8 sm:py-10"
          style={{
            backgroundColor: "var(--study-accent)",
            color: "var(--study-accent-on)",
          }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">
            Panorama del estudio
          </p>
          <h2
            id="panorama-titulo"
            className="mt-3 max-w-3xl text-[clamp(1.7rem,4vw,2.6rem)]"
            style={{ color: "inherit" }}
          >
            {view.currentStudy.name}
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed opacity-90">
            {view.currentStudy.period ? `${view.currentStudy.period}. ` : ""}
            {studyBaseSentence(view.sample.visibility, view.sample.units)}
          </p>
          {/* Two actions, once, at the top — not repeated on every finding. */}
          <div className="mt-6 flex flex-wrap gap-2.5">
            <a
              href={`#${studyAnchor}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{
                backgroundColor: "var(--study-accent-on)",
                color: "var(--study-accent)",
              }}
            >
              Explorar el estudio <Forward />
            </a>
            {view.currentStudy.reportAvailable ? (
              <a
                href={reportHref}
                className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2.5 text-sm font-semibold"
                style={{ borderColor: "currentColor", color: "inherit" }}
              >
                Descargar el informe
              </a>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-6 py-3.5 text-xs text-muted sm:px-8">
          <span className="flex items-center gap-1.5">
            <BrandMark size={14} color="var(--color-blue)" />
            Lo esencial primero; el detalle está más abajo.
          </span>
          {!view.hasPreviousWave ? (
            <span>
              Todavía no hay una medición anterior con la que comparar. Cuando la
              haya, los cambios aparecerán aquí.
            </span>
          ) : null}
        </div>
      </div>

      {readiness.length > 0 ? (
        <div className="mt-5 rounded-xl border border-caution-line bg-caution-surface px-5 py-4">
          <p className="text-sm font-semibold text-caution">
            Sólo para el equipo · qué falta antes de publicar
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-caution">
            {readiness.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-caution/90">
            El cliente no ve este aviso ni ningún hueco: su vista se compone sólo
            con lo que sí está listo.
          </p>
        </div>
      ) : null}

      {findings.length > 0 ? (
        <PanoramaFindings findings={findings} studyAnchor={studyAnchor} />
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface px-5 py-6 text-sm text-muted">
          Este estudio todavía no tiene resultados publicables. En cuanto el
          equipo de Be Community termine de revisarlo, el panorama aparecerá
          aquí.
        </p>
      )}

      {/* One quiet sentence, not a placeholder per card, when the study carries
          numbers only. */}
      {quantitativeOnly && findings.length > 0 ? (
        <p className="mt-4 text-sm text-muted">
          Este estudio se lee con sus resultados numéricos; no incluye
          comentarios abiertos.
        </p>
      ) : null}

      {view.characteristics.length > 0 ? (
        <p className="mt-4 text-sm text-muted">
          Más abajo puedes ver los mismos resultados{" "}
          {view.characteristics
            .slice(0, 3)
            .map((key) => `por ${characteristicLabel(key).toLowerCase()}`)
            .join(", ")}
          .
        </p>
      ) : null}
    </section>
  );
}

/**
 * The readiness gaps, for internal preview only.
 *
 * Every line is derivable from the aggregate the page already loaded. Nothing
 * is invented: no deadline, no assignee, no approval state, and no count the
 * current model cannot prove.
 */
function gaps(view: NarrativeHomeView): string[] {
  const list: string[] = [];
  if (view.metrics.length === 0) {
    list.push("No hay ningún resultado publicable todavía.");
  }
  if (view.stageCount > 0 && view.stagesWithoutResult > 0) {
    list.push(
      view.stagesWithoutResult === 1
        ? "1 momento del recorrido no tiene resultado."
        : `${view.stagesWithoutResult} momentos del recorrido no tienen resultado.`,
    );
  }
  if (view.themes.length === 0) {
    list.push("Ningún tema cualitativo está confirmado.");
  }
  if (!view.hasVoices) {
    list.push("Ninguna cita está aprobada para publicarse.");
  }
  if (view.sample.visibility === "caution") {
    list.push("La base del estudio es pequeña; el cliente verá la advertencia de cautela.");
  }
  // Structural, and true for every study until the interpretation surface
  // exists: there is nowhere yet to store a published reading.
  list.push("La lectura del consultor todavía no se puede publicar desde el producto.");
  return list;
}
