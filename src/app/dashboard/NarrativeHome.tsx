import type { ReactNode } from "react";
import type { NarrativeHomeView } from "@/lib/dashboard/narrative";
import type { BrandConfig } from "@/lib/branding/config";
import { studyAccentVars } from "@/lib/brand/contrast";
import { ScaleMark, PeerMark, AbsentMark, domainFor } from "@/components/evidence/ScaleMark";
import { MethodDisclosure, SampleContext } from "@/components/SampleContext";
import { Forward } from "@/components/Actions";
import { BrandMark } from "@/components/BrandMark";
import {
  characteristicLabel,
  movementLabel,
  resultLanguage,
  unitLabel,
  humanize,
} from "@/lib/language/results";
import { studyBaseSentence } from "@/lib/language/sample";

/**
 * The study panorama — the client's first impression.
 *
 * It replaces a coloured band, a strip of tiles and a card wall in which the
 * headline result appeared seventh on the page, below a stepper and some pills.
 *
 * The unit here is a FINDING, and every finding has the same four parts:
 *   1. a human question,
 *   2. visual evidence for it,
 *   3. what that evidence rests on, in ordinary words,
 *   4. a way into the study to check it.
 *
 * Plus a fifth, structural part: the consultant's reading. The finding block
 * cannot render without that slot (P8 contract C5) — where nothing has been
 * published, the block says so rather than quietly omitting it.
 *
 * Nothing is calculated here. Every number arrives already computed, already
 * rounded and already suppression-checked from `buildNarrativeHome`, which
 * reads only sanitized aggregate DTOs.
 */

function Finding({
  question,
  headline,
  evidence,
  context,
  action,
  method,
  tone = "evidence",
}: {
  question: string;
  headline: ReactNode;
  evidence?: ReactNode;
  context?: ReactNode;
  action?: ReactNode;
  method?: ReactNode;
  tone?: "evidence" | "voice";
}) {
  const kicker = tone === "voice" ? "text-voice" : "text-evidence";
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-5">
      <h3 className={`text-sm font-semibold ${kicker}`}>{question}</h3>
      <div className="mt-2.5">{headline}</div>
      {evidence ? <div className="mt-3.5">{evidence}</div> : null}
      {context ? <div className="mt-3">{context}</div> : null}
      {method}
      <div className="mt-auto pt-4">
        {action}
        {/*
          C5: the interpretation slot is structural. P8-A adds no migration, so
          there is nowhere yet to store a published reading — and the honest
          rendering of that is a labelled empty state, not a hidden section.
        */}
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
          <span className="font-semibold text-strong">Lectura del consultor:</span>{" "}
          todavía no publicada para este estudio.
        </p>
      </div>
    </article>
  );
}

export default function NarrativeHome({
  view,
  brand,
}: {
  view: NarrativeHomeView;
  brand: BrandConfig;
}) {
  const studyAnchor = `study-${view.currentStudy.id}`;
  const reportHref = `/api/studies/${encodeURIComponent(view.currentStudy.id)}/report`;
  const results = view.metrics.slice(0, 3);
  const findings: ReactNode[] = [];

  // 1-3 — the results that matter, in the order the view model already ranked
  // them (recommendation first, then satisfaction, then the rest).
  for (const metric of results) {
    const language = resultLanguage(metric.key, metric.title);
    // Only the two measures with a real, defined domain get an absolute track.
    // A plain average lives on the client's own instrument, whose range the
    // sanitized aggregate does not carry, so it is shown as a number with its
    // method rather than as a bar against an invented scale.
    const unit = metric.key.startsWith("csat:")
      ? ("percent" as const)
      : metric.key === "nps" || metric.key.startsWith("nps")
        ? ("nps" as const)
        : null;
    const numeric = metric.value == null ? null : Number.parseFloat(metric.value.replace("%", ""));

    findings.push(
      <Finding
        key={metric.key}
        question={language.question}
        headline={
          <>
            <p className="tabular font-display text-4xl font-semibold leading-none text-strong">
              {metric.value ?? "—"}
            </p>
            <p className="mt-1 text-sm font-medium text-strong">{language.name}</p>
          </>
        }
        evidence={
          metric.value == null ? (
            <>
              <AbsentMark />
              <p className="mt-1.5 text-xs text-muted">Sin resultado en esta medición</p>
            </>
          ) : unit && numeric != null && Number.isFinite(numeric) ? (
            <>
              <ScaleMark value={numeric} unit={unit} tone="accent" />
              <p className="mt-1.5 text-xs text-muted">
                {unitLabel(unit)} ({domainFor(unit)?.label})
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">{unitLabel("score")}</p>
          )
        }
        context={
          <p className="text-sm text-muted">
            {movementLabel(metric.movement, metric.delta)}
          </p>
        }
        method={
          <MethodDisclosure summary="Cómo se calcula">
            <p>{language.method}</p>
          </MethodDisclosure>
        }
        action={
          <a
            href={`#${studyAnchor}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
          >
            Ver el detalle en el estudio <Forward />
          </a>
        }
      />,
    );
  }

  // 4 — the weakest comparable touchpoint, when the study has a journey.
  if (view.spotlight) {
    const spot = view.spotlight;
    const spotNumeric = Number.parseFloat(spot.value.replace("%", ""));
    const spotDomain = spot.unit === "score" ? null : domainFor(spot.unit);
    findings.push(
      <Finding
        key="spotlight"
        question="¿Dónde se siente más flojo el recorrido?"
        headline={
          <>
            <p className="tabular font-display text-4xl font-semibold leading-none text-strong">
              {spot.value}
            </p>
            <p className="mt-1 text-sm font-medium text-strong">{spot.label}</p>
          </>
        }
        evidence={
          <>
            {spotDomain ? (
              <ScaleMark value={spotNumeric} unit={spot.unit as "nps" | "percent"} tone="accent" />
            ) : (
              <PeerMark
                value={spotNumeric}
                min={spot.peerMin}
                max={spot.peerMax}
                tone="accent"
              />
            )}
            <p className="mt-1.5 text-xs text-muted">
              {spotDomain
                ? `El más bajo de los ${spot.comparedWith} momentos medidos ${domainFor(spot.unit)?.label}.`
                : `El más bajo de los ${spot.comparedWith} momentos que se miden en la misma escala. ` +
                  `La barra los compara entre sí (de ${spot.peerMin} a ${spot.peerMax}), no contra un máximo.`}
            </p>
          </>
        }
        context={<SampleContext visibility={spot.visibility} count={spot.n} />}
        method={
          <MethodDisclosure summary="Qué significa “el más bajo”">
            <p>
              Es una ordenación de los números que ya se calcularon, no un juicio.
              Solo se comparan momentos medidos en la misma escala, y que sea el
              más bajo no significa por sí solo que esté mal.
            </p>
          </MethodDisclosure>
        }
        action={
          <a
            href={`#${studyAnchor}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
          >
            Recorrer los {view.stageCount} momentos <Forward />
          </a>
        }
      />,
    );
  }

  // 5 — what people said.
  if (view.themes.length > 0 || view.voice) {
    const top = view.themes[0];
    findings.push(
      <Finding
        key="voces"
        tone="voice"
        question="¿Qué están diciendo las personas?"
        headline={
          top ? (
            <>
              <p className="font-display text-2xl font-semibold leading-tight text-strong">
                {humanize(top.theme)}
              </p>
              <p className="mt-1 text-sm text-muted">
                {top.count === 1
                  ? "1 comentario lo menciona"
                  : `${top.count} comentarios lo mencionan`}
                {view.themes.length > 1
                  ? `, por delante de ${humanize(view.themes[1].theme).toLowerCase()}`
                  : ""}
                .
              </p>
            </>
          ) : (
            <p className="text-base text-muted">
              Hay citas aprobadas, y los temas siguen en revisión.
            </p>
          )
        }
        evidence={
          view.voice ? (
            <figure className="rounded-lg border-l-4 border-voice bg-voice-surface px-4 py-3">
              <blockquote className="text-base leading-snug text-strong">
                {`“${view.voice.quote}”`}
              </blockquote>
              {view.voice.theme ? (
                <figcaption className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-voice">
                  {humanize(view.voice.theme)}
                </figcaption>
              ) : null}
            </figure>
          ) : null
        }
        context={
          <p className="text-sm text-muted">
            Los comentarios no se convierten en porcentaje: se leen.
          </p>
        }
        action={
          <a
            href={`#${studyAnchor}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-voice underline-offset-4 hover:underline"
          >
            Leer todos los temas y citas <Forward />
          </a>
        }
      />,
    );
  }

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
          <h2 id="panorama-titulo" className="mt-3 max-w-3xl text-[clamp(1.7rem,4vw,2.6rem)]" style={{ color: "inherit" }}>
            {view.currentStudy.name}
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-relaxed opacity-90">
            {view.currentStudy.period ? `${view.currentStudy.period}. ` : ""}
            {studyBaseSentence(view.sample.visibility, view.sample.units)}
          </p>
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

      {findings.length > 0 ? (
        <>
          <h3 className="mt-8 text-xl">Lo que encontramos</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {findings}
          </div>
        </>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface px-5 py-6 text-sm text-muted">
          Este estudio todavía no tiene resultados publicables. En cuanto el
          equipo de Be Community termine de revisarlo, el panorama aparecerá
          aquí.
        </p>
      )}

      {view.characteristics.length > 0 ? (
        <p className="mt-5 text-sm text-muted">
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
