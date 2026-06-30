// =============================================================================
// Seed a journey-demo study for Tenant A (§8). Idempotent.
//   node --env-file=.env.local scripts/seed-journey-demo.mjs
// =============================================================================
// Creates a study whose journey_definition holds stages (id/label/metric), and
// quant_response data for each stage's metric, so the data-connected journey map
// (§8.2) shows real numbers on hover.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantA = process.env.TEST_TENANT_A_ID;
if (!url || !serviceRole || !tenantA) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_TENANT_A_ID in .env.local");
  process.exit(2);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const STUDY_NAME = "Journey Demo 2026";
const JOURNEY = {
  stages: [
    { id: "informes", label: "Informes", metric: "sat_informes", description: "Calidad de la información inicial." },
    { id: "admision", label: "Admisión", metric: "nps_admision", description: "Recomendación tras el proceso de admisión." },
    { id: "inscripcion", label: "Inscripción", metric: "sat_inscripcion", description: "Facilidad del trámite de inscripción." },
    { id: "primer_dia", label: "Primer día", metric: "sat_bienvenida", description: "Experiencia de bienvenida." },
    { id: "dia_a_dia", label: "Día a día", metric: "sat_operacion", description: "Operación cotidiana del colegio." },
    { id: "reinscrip", label: "Reinscripción", metric: "nps_general", description: "Intención de reinscripción / recomendación global." },
  ],
};

// 8 respondents; each answers every stage metric. Values chosen to be realistic.
const GENERO = ["F", "M", "F", "M", "F", "M", "F", "M"];
const NIVEL = ["preescolar", "preescolar", "primaria", "primaria", "secundaria", "secundaria", "preescolar", "primaria"];
const VALUES = {
  sat_informes: [8, 7, 9, 6, 8, 7, 9, 8],
  nps_admision: [9, 8, 10, 6, 9, 7, 10, 9],
  sat_inscripcion: [7, 6, 8, 5, 7, 6, 8, 7],
  sat_bienvenida: [9, 8, 9, 7, 9, 8, 10, 9],
  sat_operacion: [7, 7, 8, 6, 7, 6, 8, 7],
  nps_general: [8, 7, 9, 5, 8, 6, 9, 8],
};

async function main() {
  const { data: existing } = await admin
    .from("study").select("id").eq("tenant_id", tenantA).eq("name", STUDY_NAME).maybeSingle();
  if (existing) {
    console.log("Journey demo already exists:", existing.id, "(skipping)");
    return;
  }

  const { data: study, error } = await admin
    .from("study")
    .insert({
      tenant_id: tenantA,
      name: STUDY_NAME,
      period: "2026",
      status: "published",
      journey_definition: JOURNEY,
    })
    .select("id").single();
  if (error) throw new Error(`study insert: ${error.message}`);

  // respondents
  const respondentRows = GENERO.map((g, i) => ({
    tenant_id: tenantA, study_id: study.id, segments: { genero: g, nivel: NIVEL[i] },
  }));
  const { data: respondents, error: rErr } = await admin
    .from("respondent").insert(respondentRows).select("id");
  if (rErr) throw new Error(`respondent insert: ${rErr.message}`);

  // quant responses: every respondent × every stage metric
  const quant = [];
  respondents.forEach((resp, i) => {
    for (const [metric, vals] of Object.entries(VALUES)) {
      quant.push({
        tenant_id: tenantA, study_id: study.id, respondent_id: resp.id,
        metric_key: metric, value: vals[i],
      });
    }
  });
  const { error: qErr } = await admin.from("quant_response").insert(quant);
  if (qErr) throw new Error(`quant insert: ${qErr.message}`);

  console.log("Journey demo seeded:", study.id);
  console.log(`  ${respondents.length} respondents · ${quant.length} quant rows · ${JOURNEY.stages.length} stages`);
}

main().catch((e) => { console.error("Seed failed:", e.message); process.exit(1); });
