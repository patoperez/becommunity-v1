// =============================================================================
// Publication, version history and rollback — driven live, with screenshots
// =============================================================================
// Credential-bearing. Every claim here is about the RUNNING PRODUCT against the
// REAL DATABASE, so none of it can be settled by reading source. Its companion
// `test:experience-publication` settles what the model does; this settles what
// the screen and the database do.
//
// WHAT IT WRITES, AND WHERE. One disposable study, created here and deleted in
// `finally`. It lives inside the CLIENT FIXTURE'S OWN TENANT, deliberately:
// the whole point of this milestone is the boundary between a composed
// experience and a client's screen, and that boundary cannot be driven from a
// tenant no client account belongs to. The tenant itself is not created and not
// deleted; only the study this gate makes.
//
// THE REAL STUDY IS READ ONLY. It is opened, looked at and photographed, and
// the gate asserts its stored draft revision and the sha256 of its stored
// definition are identical before and after the run. It is never prepared,
// never published, never restored and never saved.
//
// WHERE THE COMPOSITION COMES FROM, STATED PLAINLY. The gate opens the builder
// and SAVES through it, so the draft this run publishes was written by the
// product's real editor. It then enriches that exact document — a heat map,
// bubbles, a treemap, a second recorrido, a complete semáforo, a hidden page —
// and stores it through `save_study_experience_draft`, which is the only write
// path a draft has and which re-checks the internal role and derives the tenant
// from the study row. That is the application's own boundary, not an inserted
// acceptance row. Composing those blocks through the editor is what
// `test:milestone-live` already drives; what THIS gate measures is everything
// that happens after a draft exists.
//
// IT NEEDS A PRODUCTION SERVER, not `next dev`: React's development build calls
// eval(), this application's CSP correctly forbids it, and under `next dev`
// nothing hydrates.
//
//     npm run build && npm start
//
// It never prints a credential, a respondent, an answer or a quote.
// =============================================================================

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

import {
  ACK_STATE,
  BODY,
  PAGE_HEALTH,
  SMALL_TARGETS,
  anonymousProxy,
  canonicalSha256,
  clickButton,
  clickButtonStarting,
  clickLink,
  clickUntil,
  connect,
  createRest,
  createShooter,
  findChrome,
  launchChrome,
  q,
  signedInProxy,
  tickAllAcknowledgements,
  until,
} from "./lib/publication-live-harness.mjs";

const APP_ORIGIN = (process.env.HARNESS_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const DEBUG_PORT = Number(process.env.PUBLICATION_DEBUG_PORT ?? 9900 + Math.floor(Math.random() * 90));
const PROFILE = mkdtempSync(join(tmpdir(), "becommunity-publication-"));
const SHOTS = resolvePath(process.env.PUBLICATION_ARTIFACTS ?? "artifacts/publication");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TEST_INTERNAL_EMAIL",
  "TEST_INTERNAL_PASSWORD",
  "TEST_USER_A_EMAIL",
  "TEST_USER_A_PASSWORD",
]) {
  if (!process.env[name]) throw new Error(`${name} is required for the live publication gate`);
}

const { rest, rpc, allRows } = createRest({ url: SUPABASE_URL, secret: SECRET });
const CHROME = findChrome();

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};
const captions = [];
const shoot = createShooter({ directory: SHOTS, captions });

const STAMP = `PUBGATE-${Date.now()}`;
let disposableStudy = null;
let chrome = null;
let session = null;
let internal = null;
let client = null;
let anonymous = null;

// ---------------------------------------------------------------------------

async function draftFingerprint(studyId) {
  const rows = await rest(
    `study_experience_draft?study_id=eq.${studyId}&select=revision,schema_version,definition,updated_at`,
  );
  const row = rows.body?.[0];
  if (!row) return { present: false, revision: null, sha256: null, definition: null };
  return {
    present: true,
    revision: row.revision,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at,
    definition: row.definition,
    sha256: canonicalSha256(row.definition),
  };
}

/** A synthetic opaque identifier of one kind, in the composer's own shape. */
let idCounter = 0;
function fakeId(prefix) {
  idCounter += 1;
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let token = "";
  let seed = idCounter * 2654435761;
  for (let index = 0; index < 21; index += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    token += alphabet[seed % alphabet.length];
  }
  return `${prefix}_${token}`;
}

async function saveDraft(definition, expectedRevision, note) {
  const response = await rpc("save_study_experience_draft", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_definition: definition,
    p_schema_version: definition.schemaVersion,
    p_expected_revision: expectedRevision,
    p_note: note ?? null,
  });
  assert.ok(response.ok, `saving the draft failed: ${response.text}`);
  return response.body;
}

/**
 * Press one of the publication surface's submit buttons, and read the answer.
 *
 * EVERY ONE OF THESE ACTIONS ENDS IN A REDIRECT carrying `ok=` or `error=` —
 * that is the pattern this surface uses instead of re-rendering the route
 * inside the mutation response. So the honest wait is for the address to
 * change, and the honest report is whichever of the two it changed to. A gate
 * that waited for a success phrase would time out on a refusal and describe it
 * as "the button did nothing", which is the least useful thing it could say.
 */
async function submit(session, label, what, attempts = 40) {
  const startedAt = await session.evaluate("location.href");
  let status = "never attempted";
  // A recorder for whatever the page's own POST gets back, installed before the
  // first attempt so a silent refusal has somewhere to be seen.
  await session.evaluate(`(() => {
    if (window.__submitProbe) return "already";
    window.__submitProbe = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      try {
        const request = args[0];
        const init = args[1] || {};
        const method = (init.method || (request && request.method) || "GET").toUpperCase();
        if (method === "POST") {
          window.__submitProbe.push({
            url: String(typeof request === "string" ? request : request.url).slice(0, 120),
            status: response.status,
            redirected: response.redirected,
            contentType: response.headers.get("content-type"),
            actionRedirect: response.headers.get("x-action-redirect"),
            location: response.headers.get("location"),
          });
        }
      } catch {}
      return response;
    };
    return "installed";
  })()`);
  /*
   * SUBMITTED THROUGH THE FORM, not by clicking and hoping.
   *
   * `button.click()` on a submit control runs HTML validation first, and this
   * surface's acknowledgement checkboxes are `required` on purpose — so a
   * click with one unticked silently does nothing at all, and a gate that only
   * clicks reports "the button did nothing" about a product that is behaving
   * exactly as designed. `requestSubmit` runs the same validation and SAYS so,
   * and `checkValidity` names the field that is holding it up.
   */
  const attempt = `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((el) => el.textContent.trim().startsWith(${q(label)}));
    if (!button) return "no such control";
    const form = button.form || button.closest('form');
    if (!form) { button.click(); return "clicked, no form"; }
    if (!form.checkValidity()) {
      const blocking = [...form.elements]
        .filter((el) => typeof el.checkValidity === "function" && !el.checkValidity())
        .map((el) => (el.name || el.id || el.type) + (el.type === "checkbox" ? ":" + el.value : ""));
      return "the form refuses to submit: " + blocking.join(", ");
    }
    if (typeof form.requestSubmit === "function") form.requestSubmit(button);
    else button.click();
    return "submitted";
  })()`;
  /*
   * SUBMIT ONCE, THEN WAIT PROPERLY.
   *
   * The first version pressed again every 500 ms until the address changed,
   * which is the right shape for a control that may not have hydrated yet and
   * the wrong shape for this one. These actions re-read a study's rows, re-run
   * the preflight and then redirect to a page that does the same again — well
   * over a second — so a re-press every half second preempted its own
   * navigation and the gate reported "the address never changed" about an
   * action that had already succeeded three times. Press, wait a long time,
   * and only press again if genuinely nothing happened.
   */
  const answer = `(() => {
    const params = new URLSearchParams(location.search);
    return params.get("ok") ? { kind: "ok", message: params.get("ok") }
      : params.get("error") ? { kind: "error", message: params.get("error") }
      : null;
  })()`;
  for (let press = 0; press < 3; press += 1) {
    const already = await session.evaluate(answer);
    if (already && (await session.evaluate("location.href")) !== startedAt) return already;
    status = await session.evaluate(attempt);
    for (let waited = 0; waited < attempts; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const moved = await session.evaluate(answer);
      if (moved && (await session.evaluate("location.href")) !== startedAt) return moved;
    }
  }
  const shape = await session.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((el) => el.textContent.trim().startsWith(${q(label)}));
    const form = button && (button.form || button.closest('form'));
    return {
      foundButton: !!button,
      buttonType: button ? button.type : null,
      foundForm: !!form,
      formAction: form ? form.getAttribute('action') : null,
      formMethod: form ? form.getAttribute('method') : null,
      fields: form ? [...form.elements].map((el) => (el.name || el.type)).slice(0, 20) : [],
      nestedForms: document.querySelectorAll('form form').length,
      href: location.href,
    };
  })()`);
  // What the server actually says to this exact form, asked directly from the
  // page so the answer is not a guess about what the browser did with it.
  const probe = await session.evaluate(`(async () => {
    const button = [...document.querySelectorAll('button')]
      .find((el) => el.textContent.trim().startsWith(${q(label)}));
    const form = button && (button.form || button.closest('form'));
    if (!form) return "no form to probe";
    const response = await fetch(location.href, {
      method: "POST",
      body: new FormData(form),
      redirect: "manual",
      credentials: "include",
    });
    const text = await response.text();
    return {
      status: response.status,
      type: response.type,
      location: response.headers.get("location"),
      actionRedirect: response.headers.get("x-action-redirect"),
      contentType: response.headers.get("content-type"),
      body: text.slice(0, 400),
    };
  })()`);
  const body = await session.evaluate(BODY);
  throw new Error(
    `pressed “${label}” for ${what} and the address never changed (last attempt: ${status}). `
      + `form=${JSON.stringify(shape)} probe=${JSON.stringify(probe)} `
      + `posts=${JSON.stringify(await session.evaluate("window.__submitProbe || []"))} `
      + `console=${JSON.stringify(session.problems.slice(0, 4))} `
      + `page=${JSON.stringify(body.slice(0, 400))}`,
  );
}

/** Open one page of the published experience, the way a reader does. */
async function openClientPage(session, title) {
  await clickUntil(
    session,
    `(() => {
      const nav = [...document.querySelectorAll('nav[aria-label="Secciones del estudio"] button')]
        .find((b) => b.textContent.trim() === ${JSON.stringify(title)});
      if (nav) { nav.click(); return true; }
      return false;
    })()`,
    `[...document.querySelectorAll('nav[aria-label="Secciones del estudio"] button')].some((b) => b.textContent.trim() === ${JSON.stringify(title)} && b.getAttribute("aria-current") === "page")`,
    `the page “${title}” to open`,
  );
  await settle(session);
}

/**
 * Wait until nothing is recomputing.
 *
 * The live region says "Actualizando los resultados…" while a filter choice is
 * in flight, and a shutter fired during that window photographs a page
 * mid-thought and captions it as a finished one.
 */
async function settle(session) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const busy = await session.evaluate(
      `/Actualizando los resultados/.test(document.body.innerText)`,
    );
    if (!busy) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

async function sweepPreviousRuns() {
  const rows = await rest("study?select=id,name&name=like.PUBGATE-*");
  let removed = 0;
  for (const row of rows.body ?? []) {
    await rest(`study?id=eq.${row.id}`, { method: "DELETE" });
    removed += 1;
  }
  if (removed > 0) console.log(`  SWEPT  ${removed} study left by an interrupted earlier run`);
}

async function cleanup() {
  session?.close();
  if (chrome) {
    chrome.kill();
    if (chrome.exitCode == null) {
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }
  internal?.close();
  client?.close();
  anonymous?.close();
  /*
   * KEPT ONLY WHEN SOMEBODY ASKS, and never in an ordinary run.
   *
   * `PUBLICATION_KEEP_FIXTURE=1` leaves the disposable study in place so a
   * failure can be examined against the real rows that produced it. The next
   * run sweeps whatever an earlier one left behind, so a forgotten flag costs
   * one stale study rather than a growing pile.
   */
  if (disposableStudy && process.env.PUBLICATION_KEEP_FIXTURE !== "1") {
    await rest(`study?id=eq.${disposableStudy}`, { method: "DELETE" });
  } else if (disposableStudy) {
    console.log(`  KEPT   disposable study ${disposableStudy} (PUBLICATION_KEEP_FIXTURE=1)`);
  }
  rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

try {
  await sweepPreviousRuns();
  const health = await fetch(new URL("/api/health", APP_ORIGIN)).catch(() => null);
  assert.ok(health?.ok, `start the application at ${APP_ORIGIN} before running this gate`);

  // =========================================================================
  console.log("\n[0] The real study, fingerprinted before anything happens");
  // =========================================================================
  const studies = await rest("study?select=id,tenant_id,name,status");
  assert.ok(studies.ok && studies.body.length > 0, "this project has no study to read");
  const responses = await allRows("quant_response?select=study_id");
  const density = new Map();
  for (const row of responses) density.set(row.study_id, (density.get(row.study_id) ?? 0) + 1);
  const realStudy = studies.body
    .map((study) => ({ study, answers: density.get(study.id) ?? 0 }))
    .sort((a, b) => b.answers - a.answers)[0].study;
  const realBefore = await draftFingerprint(realStudy.id);
  console.log(`  Read-only study: ${realStudy.name}`);
  console.log(`  Draft BEFORE: revision ${realBefore.revision} · sha256 ${realBefore.sha256}`);
  ok(`the real study's stored draft is recorded at revision ${realBefore.revision} before anything is driven`);

  const revisionsBefore = await rest("study_experience_revision?select=id");
  const eventsBefore = await rest("study_experience_event?select=id");
  const publicationsBefore = await rest("study_experience_publication?select=study_id");
  assert.ok(revisionsBefore.ok, `the publication tables are not reachable: ${revisionsBefore.text}`);
  ok(
    `migration 0025 is applied: ${revisionsBefore.body.length} revision(s), `
      + `${publicationsBefore.body.length} published study/studies before this run`,
  );

  // =========================================================================
  console.log("\n[1] Sessions, and the tenant the client account actually belongs to");
  // =========================================================================
  internal = await signedInProxy({
    url: SUPABASE_URL,
    anon: ANON,
    origin: APP_ORIGIN,
    email: process.env.TEST_INTERNAL_EMAIL,
    password: process.env.TEST_INTERNAL_PASSWORD,
    label: "internal",
  });
  client = await signedInProxy({
    url: SUPABASE_URL,
    anon: ANON,
    origin: APP_ORIGIN,
    email: process.env.TEST_USER_A_EMAIL,
    password: process.env.TEST_USER_A_PASSWORD,
    label: "client",
  });
  anonymous = await anonymousProxy({ origin: APP_ORIGIN });
  assert.ok(internal.userId && client.userId, "both fixture sessions must resolve to an account");

  const clientProfile = await rest(
    `profiles?user_id=eq.${client.userId}&select=tenant_id,role,data_scope`,
  );
  const profile = clientProfile.body?.[0];
  assert.ok(profile, "the client fixture account has no profile");
  assert.equal(profile.role, "client", "the client fixture account is not a client");
  assert.ok(profile.tenant_id, "the client fixture account belongs to no tenant");
  ok("the client fixture account is a client, and the disposable study is created inside its own tenant");

  // =========================================================================
  console.log("\n[2] A disposable study with real shape");
  // =========================================================================
  const created = await rest("study", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      tenant_id: profile.tenant_id,
      name: STAMP,
      period: "2026",
      // Published at the STUDY level, which is the legacy publication state and
      // is what lets a client-role session read the study at all. It says
      // nothing about the composed experience, which is the whole point: this
      // study starts on the legacy dashboard.
      status: "published",
    },
  });
  assert.ok(created.ok, `could not create the disposable study: ${created.text}`);
  disposableStudy = created.body[0].id;

  const GENERATIONS = ["Generacion X", "Millennial", "Baby boomer"];
  const SENIORITY = ["Mas de 5 anios", "Menos de 5 anios"];
  const respondentIds = [];
  for (let index = 0; index < 36; index += 1) {
    const person = await rest("respondent", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        tenant_id: profile.tenant_id,
        study_id: disposableStudy,
        segments: {
          seg_generacion: index < 15 ? GENERATIONS[0] : index < 27 ? GENERATIONS[1] : GENERATIONS[2],
          seg_antiguedad: SENIORITY[index % 5 < 3 ? 0 : 1],
        },
      },
    });
    assert.ok(person.ok, "could not create a disposable respondent");
    respondentIds.push(person.body[0].id);
  }

  const answers = [];
  respondentIds.forEach((respondentId, index) => {
    const senior = index % 5 < 3;
    const row = (metric_key, value) => ({
      tenant_id: profile.tenant_id,
      study_id: disposableStudy,
      respondent_id: respondentId,
      metric_key,
      value,
    });
    answers.push(row("nps_recomendacion", senior ? 9 + (index % 2) : 3 + (index % 4)));
    answers.push(row("sat_atencion", senior ? 4 + (index % 2) : 1 + (index % 3)));
    answers.push(row("sat_valor", senior ? 5 : 2 + (index % 2)));
    const band = index % 3;
    answers.push(row("desempeno_general", band === 0 ? 90 : band === 1 ? 70 : 40));
  });
  const inserted = await rest("quant_response", { method: "POST", body: answers });
  assert.ok(inserted.ok, `could not create the disposable answers: ${inserted.text}`);

  const reviewedAt = new Date().toISOString();
  const observations = [];
  const observe = (respondentIndex, theme, suggested, source) =>
    observations.push({
      tenant_id: profile.tenant_id,
      study_id: disposableStudy,
      respondent_id: respondentIds[respondentIndex],
      suggested_theme: suggested,
      confirmed_theme: theme,
      review_status: "confirmed",
      reviewed_by: internal.userId,
      reviewed_at: reviewedAt,
      source,
      quote: null,
    });
  for (let index = 0; index < 15; index += 1) {
    observe(index, "Precio y valor", index % 3 === 0 ? "precio/valor" : "Precio y Valor", "encuesta");
  }
  for (let index = 15; index < 24; index += 1) {
    observe(index, "Atencion del equipo", "atencion del equipo", "encuesta");
  }
  for (let index = 24; index < 32; index += 1) {
    observe(index, "Tiempos de respuesta", "tiempos", "focus_group");
  }
  const observed = await rest("qual_observation", { method: "POST", body: observations });
  assert.ok(observed.ok, `could not create the confirmed qualitative evidence: ${observed.text}`);

  const configured = await rest(`study?id=eq.${disposableStudy}`, {
    method: "PATCH",
    body: {
      journey_definition: {
        /*
         * `metric`, not `metric_key`. `journeyDefinitionSchema` names the field
         * `metric`; a stage carrying `metric_key` fails the parse, the whole
         * definition comes back empty, and the study quietly has no recorrido —
         * which is exactly what the first version of this fixture produced, and
         * what "No hay recorrido" on the readiness panel was telling it.
         */
        stages: [
          { id: "descubrimiento", label: "Descubrimiento", metric: "sat_atencion" },
          { id: "uso", label: "Uso", metric: "sat_valor" },
          { id: "recomendacion", label: "Recomendacion", metric: "nps_recomendacion" },
        ],
      },
    },
  });
  assert.ok(configured.ok, `could not configure the disposable journey: ${configured.text}`);
  ok("a disposable study with 36 people, four results, a recorrido and confirmed themes exists");

  // =========================================================================
  console.log("\n[3] The client sees the LEGACY dashboard, because nothing is published");
  // =========================================================================
  chrome = await launchChrome({ binary: CHROME, port: DEBUG_PORT, profile: PROFILE });
  session = await connect(DEBUG_PORT);
  await session.resize(1280, 900);

  const clientStudyUrl = `${client.origin}/insights/e/${disposableStudy}`;
  await session.load(clientStudyUrl);
  const legacyBody = await session.evaluate(BODY);
  assert.ok(legacyBody.length > 0, "the client's study page rendered nothing at all");
  assert.ok(
    !/revisión|Revisión \d|huella|sha-256/i.test(legacyBody),
    "the client's page mentions a revision or a hash",
  );
  ok("with no composed revision published, the client opens on the legacy dashboard");
  await shoot(
    session,
    "23-legacy-study-fallback",
    "FIXTURE. The disposable study before anything is published: the client is served the legacy dashboard, unchanged. A study only leaves this path when somebody publishes a composed revision for it, one study at a time.",
  );

  // =========================================================================
  console.log("\n[4] The draft is written by the real editor, then enriched");
  // =========================================================================
  const builderUrl = `${internal.origin}/studio/e/${disposableStudy}/construccion`;
  await session.load(builderUrl);
  await until(session, `/Construcción|Guardar ahora/.test(${BODY})`, "the builder to open");
  await clickUntil(
    session,
    clickButton("Guardar ahora"),
    `/Guardado/.test(${BODY})`,
    "the draft to be saved by the editor",
  );
  const savedByEditor = await draftFingerprint(disposableStudy);
  assert.ok(savedByEditor.present, "the editor's save did not store a draft");
  ok(`the builder saved a draft through its own action (revision ${savedByEditor.revision})`);

  // --- Enrich that exact document, through the one write path a draft has.
  const adapted = savedByEditor.definition;
  const chartBlocks = adapted.pages.flatMap((page) =>
    page.blocks.filter((block) => block.type === "chart" || block.type === "metric"),
  );
  assert.ok(chartBlocks.length > 0, "the adapted arrangement carries no result block to build on");
  const dimensionIds = [
    ...new Set(
      adapted.filterDefinitions.map((filter) => filter.dimensionId).filter(Boolean),
    ),
  ];
  assert.ok(dimensionIds.length >= 2, "the adapted arrangement offers fewer than two characteristics");

  /*
   * A RESULT THE SEMÁFORO'S 0–100 STANDARD CAN ACTUALLY CLASSIFY.
   *
   * `top_box` and `average` land on a percentage or a score; a `net_score`
   * runs from -100, and a scheme written for 0–100 would call every honest NPS
   * "sin datos". Preferring the first two is what makes the semáforo in this
   * fixture colour something rather than correctly refuse to.
   */
  const template = structuredClone(
    chartBlocks.find((block) => ["top_box", "average"].includes(block.query?.aggregation))
      ?? chartBlocks[0],
  );
  const performanceMetric = template.query?.metricId ?? null;
  assert.ok(performanceMetric, "no block in the adapted arrangement reads a result");

  /*
   * A WELL-FORMED `chart` BLOCK, built from one the adapter already produced.
   *
   * The type is set explicitly rather than inherited: the adapted arrangement
   * of a study like this one carries result tiles, and a `metric` block
   * declares only the drawings a tile can honestly be. Asking a tile to be a
   * heat map is refused by the schema — correctly — with "Resultado cannot be
   * drawn that way", which is how this fixture learned to say `chart`.
   *
   * The AGGREGATION is chosen per geometry for the same reason. A rectangle's
   * area is its share of a whole and a bubble's radius cannot be negative, so
   * `charts.ts` restricts those two to the aggregations whose parts genuinely
   * add up. Every result the adapter builds offers `share`, which is why it is
   * the one this fixture uses for them.
   */
  function cloneBlock({ variant, title, order, span, primary, secondary, bandSchemeId, aggregation }) {
    const block = structuredClone(template);
    block.id = fakeId("bk");
    block.type = "chart";
    block.title = title;
    block.visible = true;
    block.bandSchemeId = bandSchemeId ?? null;
    block.filterRefs = [];
    block.filterPanel = null;
    block.themeCloud = null;
    block.image = null;
    block.journeyRef = null;
    block.copy = { eyebrow: null, body: null, caption: null, items: [] };
    for (const breakpoint of ["desktop", "tablet", "mobile"]) {
      block.layout[breakpoint] = { ...block.layout[breakpoint], order, span: span[breakpoint], visible: true };
    }
    block.visualization = {
      variant,
      legend: "auto",
      showValueLabels: true,
      axisLabel: null,
      palette: "auto",
    };
    assert.ok(block.query, "the template block reads no result, so nothing can be cloned from it");
    block.query = {
      ...block.query,
      aggregation: aggregation ?? block.query.aggregation,
      primaryDimensionId: primary ?? null,
      secondaryDimensionId: secondary ?? null,
      fixedFilters: [],
      topN: null,
      comparison: { kind: "none", target: null, targetMaximum: null, targetLabel: null },
    };
    return block;
  }

  const schemeId = fakeId("bs");
  const bandScheme = {
    id: schemeId,
    title: "Desempeño del capítulo",
    description: "El estándar que el equipo acordó para leer el desempeño.",
    source: "numeric",
    scale: { minimum: 0, maximum: 100 },
    bands: [
      {
        id: fakeId("bp"),
        label: "Verde",
        colorRole: "positive",
        shape: "circle",
        meaning: "Está en el nivel que el capítulo se propuso sostener.",
        lower: { value: 80, inclusive: true },
        upper: { value: 100, inclusive: true },
        values: [],
      },
      {
        id: fakeId("bp"),
        label: "Amarillo",
        colorRole: "caution",
        shape: "triangle",
        meaning: "Funciona, y hay algo que atender antes de que baje.",
        lower: { value: 60, inclusive: true },
        upper: { value: 80, inclusive: false },
        values: [],
      },
      {
        id: fakeId("bp"),
        label: "Rojo",
        colorRole: "danger",
        shape: "square",
        meaning: "Está por debajo de lo acordado y necesita una decisión.",
        lower: { value: 0, inclusive: true },
        upper: { value: 60, inclusive: false },
        values: [],
      },
    ],
    noDataLabel: "Sin respuestas suficientes",
    filterMetricId: performanceMetric,
    filterLabel: "Desempeño",
  };

  const richPage = {
    id: fakeId("pg"),
    title: "Exploración",
    description: "Los mismos números, vistos de otras maneras.",
    order: adapted.pages.length,
    visible: true,
    filterRefs: [],
    blocks: [
      cloneBlock({
        variant: "traffic_light",
        title: "Desempeño del capítulo",
        order: 0,
        span: { desktop: 4, tablet: 6, mobile: 12 },
        bandSchemeId: schemeId,
      }),
      cloneBlock({
        variant: "heatmap",
        title: "Mapa de calor por generación y antigüedad",
        order: 1,
        span: { desktop: 8, tablet: 6, mobile: 12 },
        primary: dimensionIds[0],
        secondary: dimensionIds[1],
      }),
      cloneBlock({
        variant: "bubble",
        title: "Burbujas por generación y antigüedad",
        order: 2,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        primary: dimensionIds[0],
        secondary: dimensionIds[1],
        aggregation: "share",
      }),
      cloneBlock({
        variant: "treemap",
        title: "Rectángulos proporcionales por antigüedad",
        order: 3,
        span: { desktop: 6, tablet: 6, mobile: 12 },
        primary: dimensionIds[1],
        aggregation: "share",
      }),
    ],
  };

  const rich = structuredClone(adapted);

  /*
   * A SECOND RECORRIDO, edited apart from the first.
   *
   * The composer's contract is that a study may define SEVERAL recorridos and a
   * block points at one of them: duplicating a block opens a second window onto
   * the same recorrido, while duplicating the RECORRIDO makes one that can be
   * edited independently. A fixture with one recorrido cannot tell those two
   * apart, so this one carries two and a page that shows both.
   */
  const journeyPage = { id: fakeId("pg"), title: "Recorridos", description: null, order: 0, visible: true, filterRefs: [], blocks: [] };
  const sourceJourney = adapted.journeyReferences[0] ?? null;
  let secondJourneyId = null;
  if (sourceJourney) {
    const second = structuredClone(sourceJourney);
    second.id = fakeId("jr");
    second.title = "Recorrido de permanencia";
    second.origin = "composed";
    second.moments = second.moments.map((moment) => ({ ...moment, id: fakeId("jm") }));
    secondJourneyId = second.id;
    rich.journeyReferences = [...adapted.journeyReferences, second];
    const journeyBlock = (journeyId, title, order) => {
      const block = structuredClone(template);
      block.id = fakeId("bk");
      block.type = "journey";
      block.title = title;
      block.visible = true;
      block.query = null;
      // A recorrido declares exactly one drawing and REQUIRES it; the schema
      // refuses "Recorrido needs a way of being drawn" without it.
      block.visualization = {
        variant: "journey",
        legend: "auto",
        showValueLabels: true,
        axisLabel: null,
        palette: "auto",
      };
      block.bandSchemeId = null;
      block.themeCloud = null;
      block.image = null;
      block.filterPanel = null;
      block.filterRefs = [];
      block.journeyRef = journeyId;
      block.copy = { eyebrow: null, body: null, caption: null, items: [] };
      for (const breakpoint of ["desktop", "tablet", "mobile"]) {
        block.layout[breakpoint] = { ...block.layout[breakpoint], order, span: 12, visible: true };
      }
      return block;
    };
    journeyPage.blocks = [
      journeyBlock(sourceJourney.id, "El recorrido del estudio", 0),
      journeyBlock(second.id, "Recorrido de permanencia", 1),
    ];
  }

  const hiddenPage = {
    id: fakeId("pg"),
    title: "Anexo interno",
    description: null,
    order: adapted.pages.length + 1,
    visible: false,
    filterRefs: [],
    blocks: [],
  };

  rich.bandSchemes = [bandScheme];
  /*
   * THE FOUR BLOCKS THE CLIENT RENDERER DOES NOT DRAW ARE HIDDEN, NOT LEFT.
   *
   * The compatibility adapter derives an arrangement that includes the approved
   * team reading, the complete-results inventory, the comparison explorer and
   * the report-download control. Each of those renders INTERNALLY as a
   * description of what the client will get, and publishing one is refused —
   * see `CLIENT_UNSUPPORTED_BLOCKS`. That refusal is the product working, and
   * a fixture that wants to reach the client's screen has to do what a
   * consultant would do: hide them first.
   */
  const unsupported = ["interpretation", "pivot_explorer", "all_results_disclosure", "report_download"];
  let hiddenCount = 0;
  for (const page of rich.pages) {
    for (const block of page.blocks) {
      if (unsupported.includes(block.type)) {
        block.visible = false;
        hiddenCount += 1;
      }
    }
  }
  rich.pages = [
    ...rich.pages,
    ...(journeyPage.blocks.length > 0 ? [{ ...journeyPage, order: rich.pages.length }] : []),
    { ...richPage, order: rich.pages.length + 1 },
    { ...hiddenPage, order: rich.pages.length + 2 },
  ];
  await saveDraft(rich, savedByEditor.revision, "gate: enriched arrangement");
  const enriched = await draftFingerprint(disposableStudy);
  ok(
    `the arrangement now carries a semáforo, a heat map, bubbles and a treemap, `
      + `with ${hiddenCount} block(s) the client renderer does not draw hidden `
      + `(draft revision ${enriched.revision})`,
  );

  // =========================================================================
  console.log("\n[5] A blocker cannot be acknowledged away");
  // =========================================================================
  const blocked = structuredClone(enriched.definition);
  // A cover configured to show a period it does not have. Deterministic, and
  // exactly the shape of "the page would be saying something untrue".
  blocked.identity = {
    ...blocked.identity,
    period: null,
    show: { ...blocked.identity.show, period: true },
  };
  await saveDraft(blocked, enriched.revision, "gate: a deliberate blocker");
  const withBlocker = await draftFingerprint(disposableStudy);

  const publishUrl = `${internal.origin}/studio/e/${disposableStudy}/publicar`;
  await session.load(publishUrl);
  await until(session, `/Experiencia compuesta/.test(${BODY})`, "the publication review to open");
  const blockerBody = await session.evaluate(BODY);
  assert.ok(
    /Esto impide publicar/.test(blockerBody),
    "the review did not say that something blocks publication. identity="
      + JSON.stringify(withBlocker.definition.identity)
      + " page=" + JSON.stringify(blockerBody.slice(0, 1800)),
  );
  // Case-insensitive, because the code is printed under `uppercase
  // tracking-wide` and `innerText` returns text as it is RENDERED — which is
  // the right thing for it to return and the wrong thing to match exactly.
  assert.ok(
    /identity_incomplete/i.test(blockerBody),
    `the review did not name the blocking code: ${JSON.stringify(blockerBody.slice(0, 1200))}`,
  );
  const prepareOffered = await session.evaluate(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Preparar la revisión")`,
  );
  assert.equal(prepareOffered, false, "the review offered to prepare a revision that is blocked");
  ok("a blocking finding is named, and the control that would prepare a revision is not offered at all");
  await shoot(
    session,
    "03-hard-blocker",
    "FIXTURE. A hard blocker: the cover is configured to show a period the study does not have. It is named with its code, it says why it cannot be passed over, and the control that would prepare a revision is not on the page.",
    "Esto impide publicar",
  );

  // The server refuses it too, whatever the page offers.
  const forcedPrepare = await rpc("prepare_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_definition: withBlocker.definition,
    p_schema_version: withBlocker.definition.schemaVersion,
    p_source_draft_revision: withBlocker.revision,
    p_definition_sha256: withBlocker.sha256,
    p_study_fingerprint: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    p_acknowledged_warnings: [],
    p_blocking_codes: ["identity_incomplete"],
    p_note: null,
    p_idempotency_key: `gate-forced-${Date.now()}`,
  });
  assert.equal(forcedPrepare.ok, false, "the database accepted a preparation the caller reported as blocked");
  assert.equal(forcedPrepare.body?.code, "55000", `expected 55000, got ${forcedPrepare.text}`);
  ok("the database refuses a preparation whose caller reports a blocking finding, independently of the page");

  // =========================================================================
  console.log("\n[6] Warnings are acknowledged one code at a time");
  // =========================================================================
  const publishable = structuredClone(enriched.definition);
  await saveDraft(publishable, withBlocker.revision, "gate: blocker removed");
  const ready = await draftFingerprint(disposableStudy);

  await session.load(publishUrl);
  await until(session, `/Preparar una revisión del borrador/.test(${BODY})`, "the prepare card");
  const before = await session.evaluate(ACK_STATE);
  assert.ok(before.total > 0, "the review offered no warning to acknowledge on a document that has some");
  assert.equal(before.checked, 0, "a warning arrived already acknowledged");
  assert.ok(
    before.codes.includes("hidden_page"),
    `the hidden page was not reported as a warning (${before.codes.join(",")})`,
  );
  const generic = await session.evaluate(
    `[...document.querySelectorAll('button')].some((b) => /ignorar todo|aceptar todo|omitir todo/i.test(b.textContent))`,
  );
  assert.equal(generic, false, "the review offers a control that dismisses every warning at once");
  ok(`${before.total} warning code(s) are offered one checkbox at a time, and there is no "accept everything"`);
  await shoot(
    session,
    "04-warning-acknowledgement",
    "FIXTURE. Warnings are acknowledged one code at a time, each with the finding it is about. There is deliberately no control that accepts them all: what gets stored is which exact codes a named person agreed to.",
    "Advertencias",
  );

  const ticked = await session.evaluate(tickAllAcknowledgements);
  assert.equal(ticked.changed, ticked.total, "not every acknowledgement could be ticked");
  const prepared1 = await submit(session, "Preparar la revisión", "the revision to be prepared");
  assert.equal(prepared1.kind, "ok", `preparing the revision was refused: ${prepared1.message}`);
  const preparedRows = await rest(
    `study_experience_revision?study_id=eq.${disposableStudy}&select=id,revision,definition_sha256,source_draft_revision,acknowledged_warnings,prepared_by,prepared_at,prepared_note&order=revision.desc`,
  );
  assert.ok(preparedRows.ok && preparedRows.body.length === 1, "exactly one revision should exist");
  const revision1 = preparedRows.body[0];
  assert.equal(revision1.definition_sha256, ready.sha256, "the stored hash is not the draft's canonical hash");
  assert.equal(Number(revision1.source_draft_revision), Number(ready.revision), "the snapshot names the wrong draft revision");
  assert.equal(revision1.prepared_by, internal.userId, "the revision does not record who prepared it");
  assert.deepEqual(
    [...revision1.acknowledged_warnings].sort(),
    [...before.codes].sort(),
    "the stored acknowledgement is not the set that was on screen",
  );
  ok("the prepared revision stores the exact draft revision, the canonical hash, the actor and the exact codes");
  await shoot(
    session,
    "01-publication-review-overview",
    "FIXTURE. The publication review: the draft being reviewed and when it was saved, its canonical hash, what the client is served today, the prepared revision, and everything the arrangement contains — in sentences rather than JSON.",
    "Experiencia compuesta",
  );
  // The structural diff is photographed later, on purpose: a diff needs two
  // sides, and until something is published there is only one. Taking the shot
  // here would photograph the honest absence of a comparison and caption it as
  // a comparison.

  // =========================================================================
  console.log("\n[7] The prepared revision previews exactly as it would be served");
  // =========================================================================
  const revisionUrl = `${internal.origin}/studio/e/${disposableStudy}/publicar/revision/${revision1.id}`;
  await session.load(revisionUrl);
  const previewBody = await session.evaluate(BODY);
  assert.ok(
    /así se vería si la publicas/i.test(previewBody),
    "the revision preview does not say which of the three views it is",
  );
  assert.ok(
    !/todavía no apunta a un resultado|todavía no se calcularon/i.test(previewBody),
    "an internal sentence about missing configuration reached the rendered experience",
  );
  ok("a prepared revision is previewed through the client's own component, and says which view it is");

  /*
   * THE SAME THREE DRAWINGS, ON THE INTERNAL PREVIEW.
   *
   * This preview resolves against the INTERNAL registry and index; the client
   * route resolves against one built from the reader's own rows. Asserting
   * both is what tells "the document is wrong" apart from "the client's
   * registry does not carry what the document names" — two failures that look
   * identical from the client's screen.
   */
  await clickUntil(
    session,
    `(() => {
      const nav = [...document.querySelectorAll('nav button')].find((b) => /Exploración/.test(b.textContent));
      if (nav) { nav.click(); return true; }
      return false;
    })()`,
    `[...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === "Exploración" && b.getAttribute("aria-current") === "page")`,
    "the exploration page to open on the internal preview",
  );
  const previewDrawings = await session.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      heatmap: /Mapa de calor/i.test(text),
      bubble: /Burbujas/i.test(text),
      treemap: /Rectángulos/i.test(text),
      semaforo: /Desempeño del capítulo/i.test(text),
    };
  })()`);
  assert.ok(
    previewDrawings.heatmap && previewDrawings.bubble && previewDrawings.treemap,
    `the internal revision preview does not draw all three geometries: ${JSON.stringify(previewDrawings)}`,
  );
  ok("the heat map, the bubbles and the treemap are drawn on the internal revision preview");
  await shoot(
    session,
    "05-prepared-revision-preview",
    "FIXTURE. The immutable prepared revision, drawn with the same component the client receives. The banner is the only thing on the page that is not the client's screen.",
  );

  // =========================================================================
  console.log("\n[8] A draft that moves on makes the review stale");
  // =========================================================================
  const moved = structuredClone(ready.definition);
  moved.title = `${moved.title} · editado`;
  await saveDraft(moved, ready.revision, "gate: the draft moves on");
  const movedOn = await draftFingerprint(disposableStudy);
  assert.notEqual(movedOn.sha256, ready.sha256, "the draft edit did not change the document");

  await session.load(publishUrl);
  const staleBody = await session.evaluate(BODY);
  assert.ok(
    /quedó desactualizada/i.test(staleBody),
    "the review did not mark itself stale after the draft moved on",
  );
  const publishOffered = await session.evaluate(
    `[...document.querySelectorAll('button')].some((b) => /^Publicar la revisión/.test(b.textContent.trim()))`,
  );
  assert.equal(publishOffered, false, "a stale revision was still offered for publication");
  ok("a review whose draft has moved on is marked stale and cannot be published from the screen");
  await shoot(
    session,
    "06-stale-review",
    "FIXTURE. The prepared revision after the draft changed underneath it. It can still be looked at and compared; it cannot be published, and the screen says to prepare a fresh one.",
    "quedó desactualizada",
  );

  const staleAttempt = await rpc("publish_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_revision_id: revision1.id,
    p_expected_active_revision_id: null,
    p_acknowledged_warnings: revision1.acknowledged_warnings,
    p_blocking_codes: [],
    p_note: null,
    p_idempotency_key: `gate-stale-${Date.now()}`,
  });
  assert.equal(staleAttempt.ok, false, "the database published a stale revision");
  assert.equal(staleAttempt.body?.code, "55000", `expected 55000, got ${staleAttempt.text}`);
  ok("the database refuses a stale revision too, so the screen's refusal is not the only one");

  // =========================================================================
  console.log("\n[9] Preparing again, and publishing atomically");
  // =========================================================================
  await session.load(publishUrl);
  await until(session, `/Preparar una revisión del borrador/.test(${BODY})`, "the prepare card");
  await session.evaluate(tickAllAcknowledgements);
  const prepared2 = await submit(session, "Preparar la revisión", "a fresh revision to be prepared");
  assert.equal(prepared2.kind, "ok", `preparing a fresh revision was refused: ${prepared2.message}`);
  const revisions2 = await rest(
    `study_experience_revision?study_id=eq.${disposableStudy}&select=id,revision,definition_sha256&order=revision.desc`,
  );
  assert.equal(revisions2.body.length, 2, "a second revision should exist");
  const revision2 = revisions2.body[0];
  assert.equal(revision2.definition_sha256, movedOn.sha256, "the fresh revision is not the current draft");
  ok("a fresh revision is prepared from the current draft, and the older one is untouched");

  await shoot(
    session,
    "07-publish-confirmation",
    "FIXTURE. The publication decision: which revision, what the client will see instead, what happens to the version being replaced, and the acknowledgements already on the record.",
    "Publicar esta revisión",
  );

  const published = await submit(session, "Publicar la revisión", "the revision to be published");
  assert.equal(published.kind, "ok", `publishing was refused: ${published.message}`);
  assert.ok(/Publicado/i.test(published.message), `unexpected publication message: ${published.message}`);
  const pointer = await rest(
    `study_experience_publication?study_id=eq.${disposableStudy}&select=active_revision_id,updated_by`,
  );
  assert.equal(pointer.body?.[0]?.active_revision_id, revision2.id, "the pointer does not name the published revision");
  assert.equal(pointer.body?.[0]?.updated_by, internal.userId, "the publication does not record who did it");
  const publishEvents = await rest(
    `study_experience_event?study_id=eq.${disposableStudy}&action=eq.published&select=id,revision_id,replaced_revision_id,actor_user_id,occurred_at`,
  );
  assert.equal(publishEvents.body.length, 1, "a publication wrote more or fewer than one event");
  assert.equal(publishEvents.body[0].revision_id, revision2.id, "the event names the wrong revision");
  assert.equal(publishEvents.body[0].replaced_revision_id, null, "a first publication claims it replaced something");
  ok("publishing moved the pointer and wrote exactly one immutable event naming the actor and the revision");
  await shoot(
    session,
    "08-publish-success",
    "FIXTURE. After publishing: the review now says which revision the client is being served and when, and offers the exact revision preview.",
    "Lo que el cliente ve ahora",
  );

  // =========================================================================
  console.log("\n[10] The client's screen switched, atomically");
  // =========================================================================
  await session.load(clientStudyUrl);
  const composedBody = await session.evaluate(BODY);
  assert.ok(
    /Exploración/.test(composedBody),
    "the client is not being served the composed arrangement",
  );
  const internalWords = [
    /Revisi[óo]n \d/i,
    /sha-?256/i,
    /huella del documento/i,
    /borrador/i,
    /Construcci[óo]n/i,
    /Advertencia/i,
    /reconocid/i,
    /Preparar la revisi[óo]n/i,
    /Historial de versiones/i,
  ].filter((pattern) => pattern.test(composedBody));
  assert.equal(
    internalWords.length,
    0,
    `the client's screen carries internal vocabulary: ${internalWords.map(String).join(", ")}`,
  );
  const health1 = await session.evaluate(PAGE_HEALTH);
  assert.equal(health1.errorBoundary, false, "the client's page fell into an error boundary");
  assert.ok(health1.documentWidth <= health1.width + 1, "the client's page scrolls sideways");
  ok("the client route switched to the composed renderer, with no internal word and no horizontal overflow");
  await shoot(
    session,
    "09-client-after-publication",
    "FIXTURE. The client's own screen immediately after publication: the composed experience, with no revision number, no hash, no note and no trace that a review happened.",
  );

  // =========================================================================
  console.log("\n[11] Editing the draft afterwards does not touch the client");
  // =========================================================================
  const afterPublish = await draftFingerprint(disposableStudy);
  const edited = structuredClone(afterPublish.definition);
  edited.pages[0].title = "TÍTULO EDITADO DESPUÉS DE PUBLICAR";
  await saveDraft(edited, afterPublish.revision, "gate: edit after publication");
  await session.load(clientStudyUrl);
  const afterEdit = await session.evaluate(BODY);
  assert.ok(
    !afterEdit.includes("TÍTULO EDITADO DESPUÉS DE PUBLICAR"),
    "an edit to the draft reached the client's screen",
  );
  const pointerAfterEdit = await rest(
    `study_experience_publication?study_id=eq.${disposableStudy}&select=active_revision_id`,
  );
  assert.equal(
    pointerAfterEdit.body[0].active_revision_id,
    revision2.id,
    "saving a draft moved the published revision",
  );
  ok("saving the draft after publication changes nothing the client sees, and moves no pointer");
  await shoot(
    session,
    "10-draft-changed-client-unchanged",
    "FIXTURE. The client's screen after the draft was edited. The edit is in Construcción; the client is still served the revision that was published, character for character.",
  );

  // Now there are two sides to compare: what the client has, and what the
  // draft would change if it were prepared and published.
  await session.load(publishUrl);
  await until(session, `/Qué cambiaría|Qué cambia/.test(${BODY})`, "the structural diff to be shown");
  const diffBody = await session.evaluate(BODY);
  assert.ok(
    /Páginas|Bloques|Portada|Recorridos|Filtros/.test(diffBody),
    "the structural diff named no kind of change",
  );
  assert.ok(!/\{|\}|"pages"/.test(diffBody.split("Qué cambia")[1] ?? ""), "the diff printed raw JSON");
  ok("the review states, in sentences, exactly what differs between what the client has and the draft");
  await shoot(
    session,
    "02-structural-diff",
    "FIXTURE. The structural diff, in words a consultant reads: which pages, blocks, results, drawings, filters, recorridos, semáforos and cover fields differ from what the client has. No raw JSON on this path.",
    "Qué cambia",
  );

  // =========================================================================
  console.log("\n[12] What the client can do with what was published");
  // =========================================================================
  // Back to the CLIENT's screen. The step before this one ends on the internal
  // review, and an evidence shot taken from wherever the last step left the
  // browser is a shot that photographs the wrong page and captions it
  // confidently.
  await session.load(clientStudyUrl);
  const rendered = await session.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      svg: document.querySelectorAll('svg').length,
      tables: document.querySelectorAll('table').length,
      selects: document.querySelectorAll('select').length,
      hasHeatmap: /Mapa de calor/i.test(text),
      hasBubble: /Burbujas/i.test(text),
      hasTreemap: /Rectángulos/i.test(text),
      hasSemaforo: /Desempeño del capítulo/i.test(text),
      hasJourney: /Descubrimiento/i.test(text),
    };
  })()`);
  assert.ok(rendered.svg > 0, "the published experience drew no graphic at all");
  ok(`the published experience draws ${rendered.svg} graphic(s) and ${rendered.tables} accessible table(s)`);

  const navLabels = await session.evaluate(
    `[...document.querySelectorAll('nav[aria-label="Secciones del estudio"] button')].map((b) => b.textContent.trim())`,
  );
  assert.ok(
    navLabels.includes("Exploración"),
    `the exploration page did not reach the client. pages offered: ${JSON.stringify(navLabels)}; `
      + `body: ${JSON.stringify((await session.evaluate(BODY)).slice(0, 900))}`,
  );

  // The exploration page, opened the way a reader opens it. `clickUntil`
  // rather than one click: a server-rendered page is on screen before React
  // has attached its handlers, and a click landing in that window does nothing.
  await clickUntil(
    session,
    `(() => {
      const nav = [...document.querySelectorAll('nav button')].find((b) => /Exploración/.test(b.textContent));
      if (nav) { nav.click(); return true; }
      return false;
    })()`,
    `[...document.querySelectorAll('nav[aria-label="Secciones del estudio"] button')].some((b) => b.textContent.trim() === "Exploración" && b.getAttribute("aria-current") === "page")`,
    "the exploration page to open",
  );
  const explore = await session.evaluate(BODY);
  const drawn = {
    heatmap: /Mapa de calor/i.test(explore),
    bubble: /Burbujas/i.test(explore),
    treemap: /Rectángulos/i.test(explore),
    semaforo: /Desempeño del capítulo/i.test(explore),
  };
  assert.ok(
    drawn.heatmap,
    `the published heat map is not on the client's screen: ${JSON.stringify(drawn)}; `
      + `page: ${JSON.stringify(explore.slice(0, 1200))}`,
  );
  assert.ok(drawn.bubble, `the published bubble chart is not on the client's screen: ${JSON.stringify(drawn)}`);
  assert.ok(drawn.treemap, `the published treemap is not on the client's screen: ${JSON.stringify(drawn)}`);
  ok("the heat map, the bubbles and the treemap are all drawn on the client's own screen");
  await settle(session);
  await shoot(
    session,
    "20-published-heatmap-bubbles-treemap",
    "FIXTURE. The client's screen: a heat map over two characteristics, bubbles and proportional rectangles, each drawing only what its geometry can carry honestly.",
    "Mapa de calor",
  );
  await shoot(
    session,
    "19-published-semaforo",
    "FIXTURE. The semáforo on the client's screen. The value is classified by the standard a person wrote, and the reading is carried by colour, shape and the band's own words at once.",
    "Desempeño del capítulo",
  );

  // =========================================================================
  console.log("\n[13] The history, the comparison and the rollback");
  // =========================================================================
  const historyUrl = `${internal.origin}/studio/e/${disposableStudy}/publicar/historial`;
  await session.load(historyUrl);
  const historyBody = await session.evaluate(BODY);
  assert.ok(/Publicada ahora/i.test(historyBody), "the history does not mark the active revision");
  assert.ok(
    // Case-insensitive: the state chip is rendered under `uppercase`, and
    // `innerText` returns text as it is rendered.
    /Preparada, nunca publicada/i.test(historyBody),
    "the history does not distinguish a prepared revision from a published one",
  );
  assert.ok(/2 revisiones en total/i.test(historyBody), "the history miscounts the revisions");
  ok("the history lists both revisions, marks the active one and names the one that was never served");
  await shoot(
    session,
    "11-publication-history",
    "FIXTURE. Every revision this study has: its hash, who prepared it and when, which publications it had, what replaced it, and which one the client is being served now. Nothing on this screen can edit any of it.",
    "Historial de versiones",
  );

  await session.evaluate(`(() => {
    const form = document.querySelector('form[method="get"]');
    if (!form) return false;
    form.querySelector('button[type="submit"]').click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await until(session, `/De la revisión/.test(${BODY})`, "the comparison to be shown");
  ok("any two revisions can be compared structurally, from the history itself");
  await shoot(
    session,
    "12-revision-comparison",
    "FIXTURE. Two revisions compared structurally: what a reader would notice, by identifier rather than by title, so a rename is a rename and a move is a move.",
    "De la revisión",
  );

  const revision1Url = `${internal.origin}/studio/e/${disposableStudy}/publicar/revision/${revision1.id}`;
  await session.load(revision1Url);
  const olderBody = await session.evaluate(BODY);
  assert.ok(
    /nunca publicada|sustituida|se conserva/i.test(olderBody)
      || /Revisión 1/i.test(olderBody),
    "the older revision does not say what state it is in",
  );
  ok("an older revision can be previewed exactly as it was, before deciding to restore it");
  await shoot(
    session,
    "13-rollback-preview",
    "FIXTURE. The revision being considered for restoration, previewed through the client's own component before anybody commits to it.",
  );

  await session.load(historyUrl);
  await until(session, `/¿Por qué vuelves a esta revisión\\?/.test(${BODY})`, "the restore control");
  await session.evaluate(`(() => {
    const input = [...document.querySelectorAll('input[type="text"]')].find((el) => /restore-reason/.test(el.id));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, "El cliente pidió volver a la versión anterior");
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await clickUntil(
    session,
    clickButtonStarting("Restaurar la revisión"),
    `/Restaurar una revisión anterior/.test(${BODY})`,
    "the restoration dialog to open",
  );
  ok("restoring asks for a stated reason first, and only then offers the confirmation");
  await shoot(
    session,
    "14-rollback-confirmation",
    "FIXTURE. The restoration confirmation: which revision, what the client will see instead, and the plain statement that nothing is deleted and the replaced version stays in the history.",
    "Restaurar una revisión anterior",
  );

  const restored = await submit(session, "Sí, restaurar", "the restoration to be applied");
  assert.equal(restored.kind, "ok", `the restoration was refused: ${restored.message}`);
  assert.ok(/Restaurado/i.test(restored.message), `unexpected restoration message: ${restored.message}`);
  const afterRestore = await rest(
    `study_experience_publication?study_id=eq.${disposableStudy}&select=active_revision_id`,
  );
  assert.equal(
    afterRestore.body[0].active_revision_id,
    revision1.id,
    "the restoration did not point the study at the older revision",
  );
  const restoreEvents = await rest(
    `study_experience_event?study_id=eq.${disposableStudy}&action=eq.restored&select=id,revision_id,replaced_revision_id,note,actor_user_id`,
  );
  assert.equal(restoreEvents.body.length, 1, "the restoration wrote more or fewer than one event");
  assert.equal(restoreEvents.body[0].replaced_revision_id, revision2.id, "the restoration did not record what it replaced");
  assert.ok(restoreEvents.body[0].note, "the restoration did not record a reason");
  const stillThere = await rest(
    `study_experience_revision?study_id=eq.${disposableStudy}&select=id`,
  );
  assert.equal(stillThere.body.length, 2, "a restoration deleted a revision");
  ok("restoring APPENDED an event, recorded what it replaced and why, and deleted nothing");

  await session.load(clientStudyUrl);
  const restoredClient = await session.evaluate(BODY);
  assert.ok(restoredClient.length > 0, "the client's page is empty after a restoration");
  ok("the client is served the restored revision immediately");
  await shoot(
    session,
    "15-client-after-rollback",
    "FIXTURE. The client's screen after the restoration: the earlier arrangement, with today's numbers. What came back is the disposition, never a frozen number.",
  );

  // =========================================================================
  console.log("\n[14] Idempotency, concurrency and authorization, at the database");
  // =========================================================================
  const eventsBeforeRetry = await rest(
    `study_experience_event?study_id=eq.${disposableStudy}&action=eq.restored&select=id`,
  );
  const retryKey = `gate-retry-${Date.now()}`;
  const first = await rpc("restore_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_revision_id: revision2.id,
    p_expected_active_revision_id: revision1.id,
    p_reason: "gate: retry test",
    p_idempotency_key: retryKey,
  });
  assert.ok(first.ok, `the restoration failed: ${first.text}`);
  const second = await rpc("restore_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_revision_id: revision2.id,
    p_expected_active_revision_id: revision1.id,
    p_reason: "gate: retry test",
    p_idempotency_key: retryKey,
  });
  assert.ok(second.ok, `the retry failed instead of returning the first result: ${second.text}`);
  assert.equal(second.body.created, false, "the retry created a second event");
  assert.equal(second.body.eventId, first.body.eventId, "the retry returned a different event");
  const eventsAfterRetry = await rest(
    `study_experience_event?study_id=eq.${disposableStudy}&action=eq.restored&select=id`,
  );
  assert.equal(
    eventsAfterRetry.body.length,
    eventsBeforeRetry.body.length + 1,
    "a retried request wrote a second event",
  );
  ok("a retried request with the same idempotency key returns the first event and writes no second one");

  const lostUpdate = await rpc("publish_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_revision_id: revision2.id,
    // What was published two acts ago. Somebody else has moved it since.
    p_expected_active_revision_id: revision1.id,
    p_acknowledged_warnings: null,
    p_blocking_codes: [],
    p_note: null,
    p_idempotency_key: `gate-lost-${Date.now()}`,
  });
  assert.equal(lostUpdate.ok, false, "a publication against a stale pointer succeeded");
  assert.equal(lostUpdate.body?.code, "55000", `expected 55000, got ${lostUpdate.text}`);
  ok("publishing against a pointer somebody else has moved is refused with the code the Data API delivers");

  const wrongAck = await rpc("publish_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: internal.userId,
    p_revision_id: revision2.id,
    p_expected_active_revision_id: revision2.id,
    p_acknowledged_warnings: ["hidden_page", "a_warning_nobody_saw"],
    p_blocking_codes: [],
    p_note: null,
    p_idempotency_key: `gate-ack-${Date.now()}`,
  });
  assert.equal(wrongAck.ok, false, "a publication with a fabricated acknowledgement succeeded");
  assert.equal(wrongAck.body?.code, "55000", `expected 55000, got ${wrongAck.text}`);
  ok("an acknowledgement that is not the one the revision recorded is refused at the database");

  const notInternal = await rpc("publish_study_experience_revision", {
    p_study_id: disposableStudy,
    p_actor: client.userId,
    p_revision_id: revision2.id,
    p_expected_active_revision_id: revision2.id,
    p_acknowledged_warnings: null,
    p_blocking_codes: [],
    p_note: null,
    p_idempotency_key: `gate-role-${Date.now()}`,
  });
  assert.equal(notInternal.ok, false, "a client-role account published a revision");
  assert.equal(notInternal.body?.code, "42501", `expected 42501, got ${notInternal.text}`);
  ok("a client-role account cannot publish, even through the privileged function itself");

  const foreignStudy = studies.body.find((study) => study.id !== disposableStudy && study.id !== realStudy.id);
  if (foreignStudy) {
    const crossTenant = await rpc("publish_study_experience_revision", {
      p_study_id: foreignStudy.id,
      p_actor: internal.userId,
      p_revision_id: revision2.id,
      p_expected_active_revision_id: null,
      p_acknowledged_warnings: null,
      p_blocking_codes: [],
      p_note: null,
      p_idempotency_key: `gate-cross-${Date.now()}`,
    });
    assert.equal(crossTenant.ok, false, "a revision was published against another study");
    assert.equal(crossTenant.body?.code, "42501", `expected 42501, got ${crossTenant.text}`);
    ok("a valid revision identifier from one study cannot be published against another");
  }

  const immutable = await rest(
    `study_experience_revision?id=eq.${revision1.id}`,
    { method: "PATCH", body: { prepared_note: "rewritten" } },
  );
  assert.equal(immutable.ok, false, "a published revision was rewritten in place");
  ok("a stored revision cannot be updated through the ordinary API, by anybody");

  const eventRewrite = await rest(
    `study_experience_event?id=eq.${publishEvents.body[0].id}`,
    { method: "PATCH", body: { note: "rewritten" } },
  );
  assert.equal(eventRewrite.ok, false, "a publication event was rewritten in place");
  ok("a publication event cannot be updated through the ordinary API either");

  // =========================================================================
  console.log("\n[15] What a client, and nobody, may reach");
  // =========================================================================
  for (const path of [
    `/studio/e/${disposableStudy}/publicar`,
    `/studio/e/${disposableStudy}/publicar/historial`,
    `/studio/e/${disposableStudy}/construccion`,
    `/studio/e/${disposableStudy}/vista-previa`,
  ]) {
    await session.load(`${client.origin}${path}`);
    const landed = await session.evaluate(`location.pathname`);
    const text = await session.evaluate(BODY);
    assert.ok(
      !landed.startsWith("/studio") || /no tienes acceso|acceso denegado/i.test(text),
      `a client-role session reached ${path}`,
    );
    assert.ok(
      !/Preparar la revisión|Historial de versiones|huella|sha-?256/i.test(text),
      `a client-role session read publication internals at ${path}`,
    );
  }
  ok("a client-role session reaches no internal publication surface and reads no publication internal");
  await shoot(
    session,
    "16-unauthorized-client-internal-route",
    "FIXTURE. A client account asking for the internal publication screen. It never arrives, and nothing about the review, the history or the hashes is on the page it does get.",
  );

  for (const path of [`/insights/e/${disposableStudy}`, `/studio/e/${disposableStudy}/publicar`]) {
    await session.load(`${anonymous.origin}${path}`);
    const landed = await session.evaluate(`location.pathname`);
    assert.ok(landed.startsWith("/login"), `an anonymous request reached ${path} (landed on ${landed})`);
  }
  ok("an anonymous request reaches neither the client experience nor the publication surface");

  // =========================================================================
  console.log("\n[16] Filters, recorridos and the thematic cloud, on the client's screen");
  // =========================================================================
  await session.load(clientStudyUrl);
  const filterState = await session.evaluate(`(() => {
    const selects = [...document.querySelectorAll('select')];
    return { count: selects.length, first: selects[0] ? selects[0].id : null };
  })()`);
  if (filterState.count > 0) {
    // The whole rendered text, because the numbers live in several shapes —
    // an SVG label, a table cell, a KPI — and a selector that named one of them
    // would pass on a page where only that one changed.
    const numbersBefore = await session.evaluate(BODY);
    await session.evaluate(`(() => {
      const select = document.querySelector('select');
      const option = [...select.options].find((o) => o.value && o.value !== select.value);
      if (!option) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    // Wait for the recomputation to LAND rather than guessing at a duration:
    // the action re-authorizes, re-reads the active revision and resolves every
    // aggregate the document asks for, and a fixed sleep either flakes or is
    // always too long.
    let numbersAfter = numbersBefore;
    for (let attempt = 0; attempt < 40 && numbersAfter === numbersBefore; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      numbersAfter = await session.evaluate(BODY);
    }
    assert.notEqual(
      numbersBefore,
      numbersAfter,
      "a reader's filter choice changed nothing on the page",
    );
    const urlAfter = await session.evaluate(`location.search`);
    assert.ok(urlAfter.includes("f."), "the reader's choice was not mirrored into the address");
    const draftAfterFilter = await draftFingerprint(disposableStudy);
    assert.equal(
      draftAfterFilter.revision,
      (await draftFingerprint(disposableStudy)).revision,
      "a reader's choice moved the draft",
    );
    ok("a reader's filter choice changes the numbers, is mirrored into the address and writes nothing");
    await settle(session);
    await shoot(
      session,
      "17-published-filters",
      "FIXTURE. A viewer filter on the client's own screen. The selection is transient: it narrows what is computed for this request, it is mirrored into the address so the view can be shared, and it never touches the published definition.",
    );
  } else {
    ok("this arrangement publishes no viewer filter, so none is offered — stated rather than assumed");
  }

  // --- Two recorridos, on the page that shows both.
  await session.load(clientStudyUrl);
  await openClientPage(session, "Recorridos");
  const journeyText = await session.evaluate(BODY);
  assert.ok(
    /El recorrido del estudio/.test(journeyText),
    `the first published recorrido is not on the client's screen: ${JSON.stringify(journeyText.slice(0, 600))}`,
  );
  assert.ok(
    /Recorrido de permanencia/.test(journeyText),
    "the second published recorrido is not on the client's screen",
  );
  assert.ok(/Descubrimiento/.test(journeyText), "the recorrido's moments are not drawn");
  ok("both published recorridos are drawn on the client's screen, each with its own moments");
  await shoot(
    session,
    "18-published-journeys",
    "FIXTURE. Two recorridos as the client receives them, defined once and shown where they belong. Each moment carries the result the consultant pointed it at, and the second is an independently editable definition rather than a second window onto the first.",
    "El recorrido del estudio",
  );

  // --- The qualitative evidence, on the page that carries it.
  await openClientPage(session, "Lo que dijeron");
  const cloudText = await session.evaluate(BODY);
  assert.ok(
    /Precio y valor|Atencion del equipo|Tiempos de respuesta/.test(cloudText),
    `no confirmed theme reached the client's screen: ${JSON.stringify(cloudText.slice(0, 600))}`,
  );
  assert.ok(
    !/pendiente|sugerid/i.test(cloudText),
    "a pending or suggested theme reached the client's screen",
  );
  ok("only themes a person confirmed reach the client's screen, and no pending suggestion does");
  await shoot(
    session,
    "21-published-thematic-cloud",
    "FIXTURE. The qualitative evidence the client receives, sized by a stated basis. Only themes a person confirmed in the review cross this boundary; no quote, no pending suggestion and no respondent identity is on the page.",
  );

  const leaked = await session.evaluate(`(() => {
    const text = document.body.innerText;
    return {
      metricKey: /nps_recomendacion|sat_atencion|sat_valor|desempeno_general/.test(text),
      handle: /\\br_[0-9a-z]{21}\\b|\\bc_[0-9a-z]{21}\\b/.test(text),
      respondent: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text),
    };
  })()`);
  assert.equal(leaked.metricKey, false, "a canonical metric key is printed on the client's screen");
  assert.equal(leaked.handle, false, "a registry handle is printed on the client's screen");
  assert.equal(leaked.respondent, false, "an identifier is printed on the client's screen");
  ok("no canonical metric key, registry handle or identifier reaches the client's rendered page");

  // =========================================================================
  console.log("\n[17] The client's screen on a phone");
  // =========================================================================
  for (const width of [320, 360, 390]) {
    await session.resize(width, 780);
    await session.load(clientStudyUrl);
    const mobile = await session.evaluate(PAGE_HEALTH);
    assert.equal(mobile.errorBoundary, false, `the client's page broke at ${width} px`);
    assert.ok(
      mobile.documentWidth <= mobile.width + 1,
      `the client's page scrolls sideways at ${width} px (${mobile.documentWidth} > ${mobile.width})`,
    );
    const small = await session.evaluate(SMALL_TARGETS);
    assert.equal(
      small.length,
      0,
      `controls smaller than 44 px at ${width} px: ${JSON.stringify(small)}`,
    );
    ok(`the published client experience fits ${width} px with no sideways scroll and no undersized control`);
    await shoot(
      session,
      `22-mobile-${width}`,
      `FIXTURE. The published client experience at ${width} px: every block full width, nothing clipped, no page-level horizontal scroll and no control under 44 px.`,
    );
  }
  await session.resize(1280, 900);

  // =========================================================================
  console.log("\n[18] The real study, read only");
  // =========================================================================
  await session.load(`${internal.origin}/studio/e/${realStudy.id}/vista-cliente`);
  const realBody = await session.evaluate(BODY);
  assert.ok(realBody.length > 0, "the real study's client view rendered nothing");
  const realPointer = await rest(
    `study_experience_publication?study_id=eq.${realStudy.id}&select=study_id`,
  );
  assert.equal(realPointer.body.length, 0, "the real study has a composed publication");
  ok("the real study has no composed publication and is served the legacy dashboard, untouched");
  await shoot(
    session,
    "24-real-bni-legacy-client-view",
    "REAL STUDY, READ ONLY. What the client of the real study is served: the legacy dashboard, unchanged. Nothing in this milestone published it, prepared a revision of it, or wrote to it.",
  );

  // =========================================================================
  console.log("\n[19] The canvas fits itself when both sidebars are open");
  // =========================================================================
  await session.resize(1280, 900);
  await session.load(builderUrl);
  await until(session, `document.querySelector('select[id$="-add"]') !== null`, "the builder to hydrate");
  const fit = await until(
    session,
    `(() => {
      const select = [...document.querySelectorAll('select')].find((el) => el.hasAttribute('data-canvas-scale'));
      if (!select) return null;
      const frame = document.querySelector('[aria-label="Lienzo de la página"]');
      return { value: select.value, mode: select.getAttribute('data-canvas-scale') };
    })()`,
    "the scale control to be readable",
  );
  assert.equal(fit.mode, "automatic", `the scale was not chosen automatically (${JSON.stringify(fit)})`);
  assert.equal(fit.value, "fit", `the automatic scale is not "Ajustar al espacio" (${fit.value})`);
  ok("a newly opened editor with both panels showing fits the canvas to the room automatically");

  const targets = await session.evaluate(`(() => {
    const card = document.querySelector('[data-block-id]');
    if (!card) return null;
    const handle = card.querySelector('button[aria-label^="Mover"]');
    if (!handle) return null;
    const rect = handle.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  })()`);
  assert.ok(targets, "no block chrome to measure on the canvas");
  assert.ok(
    targets.width >= 43 && targets.height >= 43,
    `the drag handle measures ${targets.width}x${targets.height} under the automatic fit`,
  );
  ok(`the drag handle still measures ${targets.width}x${targets.height} on screen under the automatic fit`);
  await shoot(
    session,
    "25-automatic-fit-both-sidebars",
    "FIXTURE. A newly opened editor at 1 280 px with both panels showing. The canvas fits itself to the room rather than opening on a horizontal scroll, the control says the scale is automatic, and the drag handle is still a 44 px target.",
  );

  await session.evaluate(`(() => {
    const select = [...document.querySelectorAll('select')].find((el) => el.hasAttribute('data-canvas-scale'));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, "1");
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const chosen = await session.evaluate(`(() => {
    const select = [...document.querySelectorAll('select')].find((el) => el.hasAttribute('data-canvas-scale'));
    return { value: select.value, mode: select.getAttribute('data-canvas-scale') };
  })()`);
  assert.equal(chosen.value, "1", "choosing 100 % did not take");
  assert.equal(chosen.mode, "chosen", "the editor still claims the scale is automatic after a person chose it");
  ok("choosing 100 % is honoured and stops the editor deciding for the rest of the session");

  // =========================================================================
  console.log("\n[20] The real study, fingerprinted again");
  // =========================================================================
  const realAfter = await draftFingerprint(realStudy.id);
  assert.equal(realAfter.revision, realBefore.revision, "the real study's draft revision moved");
  assert.equal(realAfter.sha256, realBefore.sha256, "the real study's stored definition changed");
  console.log(`  Draft AFTER : revision ${realAfter.revision} · sha256 ${realAfter.sha256}`);
  ok("the real study's stored draft is at the same revision with the same canonical hash as before the run");

  const problems = session.problems.filter(
    (message) => !/favicon|ResizeObserver loop/i.test(message ?? ""),
  );
  assert.equal(problems.length, 0, `the browser reported errors: ${problems.slice(0, 3).join(" | ")}`);
  ok("no uncaught exception and no console error was raised anywhere in this run");

  // ---------------------------------------------------------------------------
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(
    join(SHOTS, "captions.md"),
    ["# Publication milestone — screenshot evidence", "", ...captions.map(
      (entry, index) => `${index + 1}. \`${entry.file}\`\n   ${entry.caption}\n`,
    )].join("\n"),
    "utf8",
  );
  console.log(`\n  CAPTIONS  ${join(SHOTS, "captions.md")}`);
  console.log(`\nOK — ${checks} live publication checks passed, ${captions.length} screenshots written.`);
} finally {
  await cleanup();
}
