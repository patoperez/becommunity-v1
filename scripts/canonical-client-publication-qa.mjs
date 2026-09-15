// =============================================================================
// UNIT 6B.4B2I — REAL-ROUTE BROWSER QA OF THE CLIENT'S PUBLISHED EXPERIENCE
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh        # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//   BECOMMUNITY_POSTGREST_BIN="$HOME/becommunity-postgrest/postgrest" \
//   CANONICAL_RESULTS_PARITY_CLEAN_XLSX=... CANONICAL_RESULTS_PARITY_PAIN_XLSX=... \
//     npm run qa:canonical-client-publication
//
// -----------------------------------------------------------------------------
// WHY THE TARGET IS DISPOSABLE, AND WHY IT HAS TO BE
// -----------------------------------------------------------------------------
// The thing under test is what a CLIENT receives after a publication, so the
// fixture has to contain a publication. Pointing this at the hosted project
// would publish a real client's study there, which this phase forbids outright
// and which no assertion afterwards could undo.
//
// So the whole target is disposable: a throwaway PostgreSQL on a unix socket, a
// real PostgREST in front of it, a minimal authentication substitute so the
// product's own `/login` works, the REAL canonical package committed through
// the product's own commit flow, and a production build of the app pointed at
// all of it. `resolveDisposableTarget` refuses to start if a Supabase
// environment variable is in scope, so this cannot reach a hosted project.
//
// -----------------------------------------------------------------------------
// WHY THE REAL WORKBOOKS
// -----------------------------------------------------------------------------
// The synthetic package selects the generic blueprint, whose layout is a
// skeleton. What has to be verified here is the APPROVED layout — the NPS, the
// retention and desertion pair, the journey with its pain badges, the two
// qualitative clouds and the three filter panels — and only the real package
// publishes the handles that layout names. Without the two workbooks this gate
// SKIPS and says so; a skip is never counted as a pass.
//
// -----------------------------------------------------------------------------
// WHAT IT DRIVES, RATHER THAN PHOTOGRAPHS
// -----------------------------------------------------------------------------
//   1  an anonymous visitor is sent to /login and shown no study;
//   2  an authorized client is served the CANONICAL publication, not the legacy
//      P8 dashboard that this address rendered before Unit 6B.4B2I;
//   3  every canonical page and block is drawn: NPS, retention and desertion,
//      the journey with its pain badges, both qualitative clouds, the charts;
//   4  the filter panels are OPERABLE, combine, recompute on the server, clear
//      back to the published bytes, and show a small selection rather than
//      suppressing it;
//   5  no editor control, no internal vocabulary and no identifier reaches it;
//   6  a client of ANOTHER tenant is refused;
//   7  an internal person is redirected to the internal preview instead;
//   8  desktop, tablet and phone compose inside the device width;
//   9  the client's rendering and the INTERNAL REVIEW'S preview of the same
//      publication are the same screen — which is what makes «revisé la vista
//      del cliente» a true statement;
//  10  an editor saving a new draft revision changes nothing the client sees.
//
// Evidence is written OUTSIDE every git repository.
// =============================================================================

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { launchBrowser } from "./lib/harness-browser.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";

/* -------------------------------------------------------------------------- */

let failures = 0;
let executed = 0;
let skipped = 0;
const check = (condition, message) => {
  if (typeof message !== "string") {
    failures += 1;
    console.log("  ✗ FAIL: check() got a non-string message — arguments reversed?");
    return;
  }
  executed += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.log(`  ✗ FAIL: ${message}`);
  }
};

const APP_PORT = 3130;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const EVIDENCE = process.env.BECOMMUNITY_QA_EVIDENCE ?? join(process.env.HOME ?? "/tmp", "becommunity-6b4b2i");

const TENANT = "00000000-0000-4000-8000-0000000011a1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000011a2";
const STUDY = "00000000-0000-4000-8000-0000000021b1";
const INTERNAL_ID = "00000000-0000-4000-8000-0000000031c1";
const CLIENT_ID = "00000000-0000-4000-8000-0000000031c2";
const FOREIGN_ID = "00000000-0000-4000-8000-0000000031c3";
const INTERNAL_EMAIL = "interno@qa-cliente.local";
const CLIENT_EMAIL = "cliente@qa-cliente.local";
const FOREIGN_EMAIL = "ajeno@qa-cliente.local";
/** Minted at runtime, so this file carries no credential and neither does a log. */
const PASSWORD = "qa-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

const run = (command, args, env, label) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (chunk) => (log += chunk));
    child.stderr.on("data", (chunk) => (log += chunk));
    child.on("exit", (code) =>
      code === 0 ? resolve(log) : reject(new Error(`${label} failed (${code}):\n${log.slice(-2500)}`)),
    );
  });

/* -------------------------------------------------------------------------- */

let target;
try {
  target = resolveDisposableTarget(process.env);
} catch (thrown) {
  if (thrown instanceof DisposableTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

const cleanPath = process.env.CANONICAL_RESULTS_PARITY_CLEAN_XLSX;
const painPath = process.env.CANONICAL_RESULTS_PARITY_PAIN_XLSX;

console.log("Be Community — Unit 6B.4B2I: the client's published experience, on a DISPOSABLE target");
console.log("=".repeat(88));

if (!cleanPath || !painPath || !existsSync(cleanPath) || !existsSync(painPath)) {
  console.log("\n— SKIPPED: this QA needs the two real workbooks, whose paths are machine-specific.");
  console.log("  Set CANONICAL_RESULTS_PARITY_CLEAN_XLSX and CANONICAL_RESULTS_PARITY_PAIN_XLSX.");
  console.log("  Only the real package selects the APPROVED layout, and this QA verifies that layout.");
  console.log("  A skip is reported as a skip and is never counted as a pass.");
  process.exit(0);
}

mkdirSync(join(EVIDENCE, "screenshots"), { recursive: true });

await withDisposableDatabase(target, "clientqa", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032, two tenants, three people");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(32);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'BNI Cuicuilco (prueba)'),
      (${q(OTHER_TENANT)}, 'Otra comunidad');
    insert into auth.users (id, email) values
      (${q(INTERNAL_ID)}, ${q(INTERNAL_EMAIL)}),
      (${q(CLIENT_ID)}, ${q(CLIENT_EMAIL)}),
      (${q(FOREIGN_ID)}, ${q(FOREIGN_EMAIL)});
    insert into public.profiles (user_id, tenant_id, role, full_name) values
      (${q(INTERNAL_ID)}, ${q(TENANT)}, 'internal', 'Persona interna'),
      (${q(CLIENT_ID)}, ${q(TENANT)}, 'client', 'Cliente autorizado'),
      (${q(FOREIGN_ID)}, ${q(OTHER_TENANT)}, 'client', 'Cliente de otra comunidad');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'La voz de las y los Nets de Cuicuilco', 'published');
  `);

  console.log("[setup] committing the REAL canonical package through the product's own commit flow");
  const bytesOf = (path) => {
    const buffer = readFileSync(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };
  const committed = await runCanonicalCommit(transport, {
    tenantId: TENANT,
    studyId: STUDY,
    files: [
      { fileName: cleanPath.replace(/^.*[\\/]/, ""), bytes: bytesOf(cleanPath) },
      { fileName: painPath.replace(/^.*[\\/]/, ""), bytes: bytesOf(painPath) },
    ],
  });
  if (!committed.ok) throw new Error(`the real package did not commit: ${committed.code}`);

  console.log("[setup] starting PostgREST and the authentication substitute");
  const stack = await startLocalStack(db, {
    binary: process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest"),
    target,
    authUsers: [
      { id: INTERNAL_ID, email: INTERNAL_EMAIL, password: PASSWORD },
      { id: CLIENT_ID, email: CLIENT_EMAIL, password: PASSWORD },
      { id: FOREIGN_ID, email: FOREIGN_EMAIL, password: PASSWORD },
    ],
  });

  // Only now — the disposable guard has already refused to run if a Supabase
  // variable was in scope, so these can point at nothing but this run's stack.
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.apiOrigin;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceKey;

  let app = null;
  let browser = null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const service = createClient(stack.apiOrigin, stack.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const scope = { tenantId: TENANT, studyId: STUDY, studyName: "La voz de las y los Nets de Cuicuilco" };

    const { loadPresentationComposerWorkspace, storeEditedPresentation } = await import(
      "../src/lib/studio/presentation-workspace.ts"
    );
    const { loadPublicationReview, publishStoredPresentation, loadJourneyPainEditor, recordStoredJourneyPainDecision } =
      await import("../src/lib/studio/publication-workspace.ts");
    const { recordQualitativeSignOff } = await import("../src/lib/studio/publication-workspace.ts");

    console.log("[setup] composing and saving the approved layout through the composer's own save");
    const fresh = await loadPresentationComposerWorkspace(service, scope, {});
    if (!fresh.ok) throw new Error(`the composer could not build a document: ${fresh.unavailable.reason}`);
    const blueprintId = fresh.payload.blueprint?.id ?? "(none)";
    if (blueprintId !== "cuicuilco-aprobado") {
      throw new Error(`the real package selected ${blueprintId}; this QA verifies the approved layout`);
    }
    const saved = await storeEditedPresentation(service, scope, INTERNAL_ID, fresh.payload.document, null, "qa-client-save-0001");
    if (!saved.ok) throw new Error(`the draft did not save: ${saved.reason}`);

    console.log("[setup] recording journey pain decisions, so the published cloud is not empty");
    const painPanel = await loadJourneyPainEditor(service, scope);
    if (!painPanel.ok) throw new Error("the journey pain editor did not open");
    const choices = painPanel.panel.choices;
    let decided = 0;
    for (const item of painPanel.panel.items) {
      // ONE TOUCHPOINT PER ITEM, chosen by POSITION rather than by meaning.
      // This is a disposable fixture: it must populate the cloud, and it must
      // not pretend to be an editorial decision about a real client's study.
      const target = choices[decided % choices.length];
      const outcome = await recordStoredJourneyPainDecision(service, scope, INTERNAL_ID, {
        token: item.token,
        disposition: "approved",
        publicPhrase: item.curatedPhrase,
        touchpoints: [target.handle],
        rationale: null,
      });
      if (outcome.ok) decided += 1;
    }
    console.log(`[setup] ${decided} journey pain items decided`);

    console.log("[setup] signing off the qualitative categories, so the review is complete");
    const preReview = await loadPublicationReview(service, scope);
    if (!preReview.ok) throw new Error(`the review could not be assembled: ${preReview.unavailable.reason}`);
    if (preReview.payload.qualitative.groups.length > 0) {
      await recordQualitativeSignOff(
        service,
        scope,
        INTERNAL_ID,
        preReview.payload.draftRevision,
        preReview.payload.qualitative.groups.map((group) => group.token),
      );
    }

    console.log("[setup] publishing, through the REAL publication path");
    const review = await loadPublicationReview(service, scope);
    if (!review.ok) throw new Error("the review could not be re-assembled");
    if (review.payload.blockers.length > 0) {
      throw new Error(`the review has blockers: ${review.payload.blockers.map((b) => b.code).join(", ")}`);
    }
    const publication = await publishStoredPresentation(
      service,
      scope,
      INTERNAL_ID,
      review.payload.draftRevision,
      null,
      [...review.payload.required],
      "qa-client-publish-001",
    );
    if (!publication.ok) throw new Error(`the publication failed: ${publication.reason} — ${publication.detail}`);
    console.log(`[setup] published version ${publication.version}`);

    const appEnv = {
      NEXT_PUBLIC_SUPABASE_URL: stack.apiOrigin,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
      PORT: String(APP_PORT),
      NODE_ENV: "production",
    };

    console.log("[setup] building the app against the disposable origin (this takes a minute)");
    await run("npm", ["run", "build"], appEnv, "next build");

    const portIsFree = await fetch(`${ORIGIN}/login`, { redirect: "manual" }).then(() => false).catch(() => true);
    if (!portIsFree) {
      throw new Error(
        `something is already listening on ${ORIGIN}. This run refuses to test it: it would be ` +
          "somebody else's server, most likely a previous run's. Stop it and try again.",
      );
    }

    console.log(`[setup] starting the app on ${ORIGIN}`);
    app = spawn("npm", ["run", "start", "--", "-p", String(APP_PORT)], {
      env: { ...process.env, ...appEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let appLog = "";
    app.stdout.on("data", (c) => (appLog += c));
    app.stderr.on("data", (c) => (appLog += c));
    for (let attempt = 0; attempt < 90; attempt += 1) {
      try {
        const answer = await fetch(`${ORIGIN}/login`, { redirect: "manual" });
        if (answer.status < 500) break;
      } catch {
        /* not up yet */
      }
      await sleep(1000);
      if (app.exitCode !== null) throw new Error(`the app exited (${app.exitCode}): ${appLog.slice(-1500)}`);
    }

    browser = await launchBrowser();

    const signIn = async (page, email) => {
      await page.navigate(`${ORIGIN}/login`);
      await page.evaluate(`(() => {
        const email = document.querySelector('input[type="email"], input[name="email"]');
        const password = document.querySelector('input[type="password"], input[name="password"]');
        const set = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        };
        set(email, ${JSON.stringify(email)});
        set(password, ${JSON.stringify(PASSWORD)});
        return true;
      })()`);
      await page.submitAndWait(`document.querySelector('form').requestSubmit()`);
      await sleep(1800);
    };

    /** What the published client surface reports about itself. */
    const clientState = (page) =>
      page.evaluate(`(() => {
        const root = document.querySelector('[data-testid="estudio-publicado"]');
        const text = (id) => {
          const el = document.querySelector('[data-testid="' + id + '"]');
          return el ? el.textContent.trim() : null;
        };
        const body = document.body.innerText;
        return JSON.stringify({
          present: !!root,
          visibleBlocks: root ? Number(root.getAttribute("data-visible-blocks")) : null,
          publishedOn: text("publicado-el"),
          filtering: !!document.querySelector('[data-testid="seleccion-activa"]'),
          panels: document.querySelectorAll('[data-testid^="panel-filtros"]').length,
          checkboxes: document.querySelectorAll('input[type="checkbox"]').length,
          headings: [...document.querySelectorAll('h2, h3')].map((el) => el.textContent.trim()),
          painBadges: [...document.querySelectorAll('[aria-label]')]
            .filter((el) => /punto(s)? de dolor/.test(el.getAttribute("aria-label") || ""))
            .length,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          body,
        });
      })()`).then(JSON.parse);

    /**
     * THE RENDERED PRESENTATION, and nothing around it.
     *
     * Both surfaces put `presentacion-canonica` around their renderer and
     * nothing else, so this reads the same subtree on the client's page and on
     * the internal review — which is what makes the two comparable as text. A
     * whole-page comparison would include the review's own chrome and could
     * never agree, and a comparison that stripped the chrome by pattern would
     * be a comparison of what the test decided to ignore.
     */
    const visibleText = (page) =>
      page.evaluate(`(() => {
        const root = document.querySelector('[data-testid="presentacion-canonica"]');
        return root ? root.innerText : "";
      })()`);

    const shot = async (page, name) => {
      const bytes = await page.screenshot({ fullPage: true });
      writeFileSync(join(EVIDENCE, "screenshots", `${name}.png`), bytes);
    };

    /* ------------------------------------------------------------------ */
    console.log("\n[1] An anonymous visitor is sent to /login, and is shown no study");
    const visitor = await browser.createContext({ label: "anonimo" });
    const landed = await visitor.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    check(landed.startsWith("/login"), `the client address answers /login without a session (${landed})`);
    const visitorBody = await visitor.evaluate("document.body.innerText");
    check(!/Nets de Cuicuilco/.test(visitorBody), "and no study name reaches a stranger");
    check(!/Puntos de dolor|Retención/.test(visitorBody), "nor any published content");

    /* ------------------------------------------------------------------ */
    console.log("\n[2] An AUTHORIZED CLIENT is served the canonical publication, not the legacy dashboard");
    const client = await browser.createContext({ label: "cliente" });
    await client.setViewport(1440, 900);
    await signIn(client, CLIENT_EMAIL);
    await client.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    await sleep(1200);
    const first = await clientState(client);
    check(first.present, "the canonical published surface is rendered");
    check(
      typeof first.publishedOn === "string" && /Publicado el/.test(first.publishedOn),
      `and it says when it was published (${first.publishedOn})`,
    );
    check(first.visibleBlocks > 0, `it draws ${first.visibleBlocks} client-visible blocks`);
    // AND THE LEGACY P8 SURFACE IS NOT THERE. Its own markers are absent.
    // THE LEGACY MARKERS ARE THE LEGACY COMPONENTS' OWN WORDS, not any word
    // that sounds legacy. «Panorama» was the first attempt and it is WRONG: the
    // approved canonical layout has a block called «Panorama del estudio», so
    // the check failed on real published content. These four strings exist only
    // in `NarrativeHome` and `LongitudinalTrends`.
    for (const legacy of [
      "Lo que estos resultados permiten decidir",
      "Ver los periodos en una tabla",
      "Cómo ha cambiado",
      "Lectura del equipo",
    ]) {
      check(!first.body.includes(legacy), `the legacy P8 surface's «${legacy}» is not drawn`);
    }
    await shot(client, "1-cliente-escritorio");

    /* ------------------------------------------------------------------ */
    console.log("\n[3] Every canonical page and block a client should see");
    for (const heading of [
      "Retención y deserción",
      "¿Qué tanto recomendarían esta experiencia?",
      "Satisfacción punto por punto",
      "Índice de riesgo de abandono",
      "Puntos de dolor del recorrido",
      "Miembros activos",
      "Desertores",
    ]) {
      check(first.headings.some((h) => norm(h) === norm(heading)), `«${heading}» is drawn`);
    }
    check(first.painBadges > 0, `the journey draws ${first.painBadges} touchpoint(s) badged with a pain phrase`);
    check(first.panels >= 1 || first.checkboxes > 0, `the filter controls are mounted (${first.checkboxes} checkbox(es))`);

    /* ------------------------------------------------------------------ */
    console.log("\n[4] The filters are operable, recompute on the server, and clear back exactly");
    const baseline = norm(await visibleText(client));
    const ticked = await client.evaluate(`(() => {
      const box = document.querySelector('input[type="checkbox"]:not(:disabled)');
      if (!box) return null;
      box.click();
      return box.getAttribute('aria-label') || box.id || 'una opción';
    })()`);
    check(typeof ticked === "string", `a reader can tick a filter option (${ticked})`);
    await sleep(2500);
    const filtered = await clientState(client);
    check(filtered.filtering, "the surface says a selection is active");
    const filteredText = norm(await visibleText(client));
    check(filteredText !== baseline, "and the figures changed, so the server recomputed them");
    check(filtered.visibleBlocks > 0, `with ${filtered.visibleBlocks} blocks still drawn — nothing collapsed`);
    await shot(client, "2-cliente-filtrado");

    // A SECOND OPTION, so a COMBINED selection is exercised rather than assumed.
    const second = await client.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"]:not(:disabled)')].filter((b) => !b.checked);
      if (boxes.length < 1) return null;
      boxes[boxes.length - 1].click();
      return true;
    })()`);
    if (second) {
      await sleep(2500);
      const combined = await clientState(client);
      check(combined.filtering, "a second option combines with the first rather than replacing it");
      check(combined.visibleBlocks > 0, `and ${combined.visibleBlocks} blocks are still drawn`);
      // SHOW-ALL: a small filtered selection is SHOWN, not suppressed. The
      // approved document's sample policy is `show_all`, so no block may come
      // back as withheld however few people the selection leaves.
      const suppressed = await client.evaluate(
        `document.body.innerText.includes("No mostramos") || document.body.innerText.includes("muy pocas personas")`,
      );
      check(suppressed === false, "and no block is withheld for having too few people — the policy is show_all");
    } else {
      check(true, "only one filter option was offered, so a combined selection could not be exercised");
    }

    const cleared = await client.evaluate(`(() => {
      const el = document.querySelector('[data-testid="ver-estudio-completo"]');
      if (!el) return false;
      el.click();
      return true;
    })()`);
    check(cleared === true, "«Ver el estudio completo» is offered while a selection is active");
    await sleep(2500);
    const restored = norm(await visibleText(client));
    check(restored === baseline, `clearing restores the published bytes exactly (${restored.length} characters)`);

    /* ------------------------------------------------------------------ */
    console.log("\n[5] Nothing internal, and no editor control, reaches the client");
    const html = await client.evaluate("document.body.innerHTML");
    for (const internal of [
      "Sólo interno",
      "no lo ve el cliente",
      "Publicar para el cliente",
      "Revisión y publicación",
      "borrador",
      // «Construcción» AS A LINK, not as a word. The first attempt banned the
      // word and failed on real published content: the approved layout's own
      // Spanish uses it. What must not be here is the internal ROUTE.
      "/construccion",
      "/studio/",
      "inventario",
      "bloqueos",
      "advertencias",
      "revision-en-revision",
      TENANT,
      INTERNAL_ID,
      INTERNAL_EMAIL,
    ]) {
      check(!html.includes(internal), `«${String(internal).slice(0, 28)}» is nowhere in the client's page`);
    }
    for (const pattern of [/sha256/i, /fingerprint/i, /idempot/i, /[0-9a-f]{64}/]) {
      check(!pattern.test(html), `nothing matching ${pattern} is in the client's page`);
    }

    /* ------------------------------------------------------------------ */
    console.log("\n[6] A client of ANOTHER tenant is refused");
    const foreign = await browser.createContext({ label: "ajeno" });
    await signIn(foreign, FOREIGN_EMAIL);
    await foreign.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    await sleep(900);
    const foreignBody = await foreign.evaluate("document.body.innerText");
    check(!/Retención y deserción|Puntos de dolor del recorrido/.test(foreignBody), "no published content is drawn");
    check(!/Nets de Cuicuilco/.test(foreignBody), "and not even the study's name");
    await shot(foreign, "3-cliente-ajeno");

    /* ------------------------------------------------------------------ */
    console.log("\n[7] An INTERNAL person is sent to the internal preview instead");
    const internal = await browser.createContext({ label: "interno" });
    await internal.setViewport(1440, 900);
    await signIn(internal, INTERNAL_EMAIL);
    // A `redirect()` FROM A SERVER COMPONENT IS NOT ALWAYS AN HTTP REDIRECT.
    //
    // The root layout has already streamed by the time this page's own function
    // runs, so Next cannot answer 307 and emits a CLIENT-SIDE redirect instead:
    // the document commits at `/insights/e/<id>`, `Page.loadEventFired` fires
    // there, and the address changes a moment later, after hydration. Reading
    // the location once, immediately, therefore measured the intermediate page
    // and reported a redirect that does happen as one that does not. The
    // anonymous case in [1] is different and needs none of this: middleware
    // redirects at the edge, before anything streams.
    await internal.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    let internalLanded = await internal.evaluate("location.pathname");
    for (let attempt = 0; attempt < 40 && !internalLanded.includes("/studio/e/"); attempt += 1) {
      await sleep(250);
      internalLanded = await internal.evaluate("location.pathname");
    }
    check(
      internalLanded.includes("/studio/e/") && internalLanded.endsWith("/vista-cliente"),
      `the client address sends an internal person to the internal preview (${internalLanded})`,
    );
    const internalSees = await internal.evaluate(
      `!!document.querySelector('[data-testid="estudio-publicado"]')`,
    );
    check(internalSees === false, "and the client's published surface is not what they end up on");

    /* ------------------------------------------------------------------ */
    console.log("\n[8] Desktop, tablet and phone");
    for (const [label, width, height] of [
      ["escritorio", 1440, 900],
      ["tableta", 834, 1112],
      ["telefono", 390, 844],
    ]) {
      await client.setViewport(width, height);
      await client.navigate(`${ORIGIN}/insights/e/${STUDY}`);
      await sleep(1500);
      const state = await clientState(client);
      check(state.present, `${label}: the published surface is drawn`);
      check(!state.overflow, `${label}: the page composes inside ${width} layout pixels`);
      check(state.visibleBlocks === first.visibleBlocks, `${label}: the same ${state.visibleBlocks} blocks are drawn`);
      await shot(client, `4-${label}`);
    }
    await client.setViewport(1440, 900);

    /* ------------------------------------------------------------------ */
    console.log("\n[9] The client's screen and the internal review's preview are the same screen");
    await internal.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    await sleep(2500);
    const internalPreview = norm(await visibleText(internal));
    await client.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    await sleep(1500);
    const clientScreen = norm(await visibleText(client));
    check(internalPreview.length > 500, `the internal preview renders (${internalPreview.length} characters)`);
    if (internalPreview === clientScreen) {
      check(true, `the two are character-for-character identical (${clientScreen.length} characters)`);
    } else {
      // A DIFFERENCE IS REPORTED, NOT EXPLAINED AWAY. It is located rather than
      // dumped, so a failure says what moved.
      let at = 0;
      while (at < internalPreview.length && at < clientScreen.length && internalPreview[at] === clientScreen[at]) at += 1;
      check(
        false,
        `the two differ at character ${at} — internal «${internalPreview.slice(at, at + 70)}» vs client «${clientScreen.slice(at, at + 70)}»`,
      );
    }
    await shot(internal, "5-vista-interna");

    /* ------------------------------------------------------------------ */
    console.log("\n[10] An editor saving a new draft revision changes nothing the client sees");
    const beforeEdit = norm(await visibleText(client));
    const editedDocument = JSON.parse(serializeDeterministic(fresh.payload.document));
    editedDocument.pages[0].blocks[0].copy = {
      ...editedDocument.pages[0].blocks[0].copy,
      title: "Un título que el editor cambió después de publicar",
    };
    const edited = await storeEditedPresentation(service, scope, INTERNAL_ID, editedDocument, 1, "qa-client-save-0002");
    check(edited.ok === true, `the editor saved a new draft revision${edited.ok ? ` (${edited.revision})` : `: ${edited.reason}`}`);
    await client.navigate(`${ORIGIN}/insights/e/${STUDY}`);
    await sleep(1500);
    const afterEdit = norm(await visibleText(client));
    check(afterEdit === beforeEdit, "and the client's screen is character-for-character what it was");
    check(
      !afterEdit.includes("Un título que el editor cambió después de publicar"),
      "the editor's new title is nowhere on it",
    );

    writeFileSync(
      join(EVIDENCE, "client-qa-result.json"),
      JSON.stringify(
        {
          unit: "6B.4B2I",
          origin: ORIGIN,
          publishedVersion: publication.version,
          painItemsDecided: decided,
          visibleBlocks: first.visibleBlocks,
          painBadges: first.painBadges,
          baselineCharacters: baseline.length,
          internalPreviewMatchesClient: internalPreview === clientScreen,
          executed,
          failures,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app && app.pid) {
      try {
        process.kill(-app.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await sleep(600);
      try {
        process.kill(-app.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    await stack.stop();
  }
});

console.log(`\n${"=".repeat(88)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED: ${skipped}`);
console.log(`Evidence: ${EVIDENCE}`);
if (failures > 0) {
  console.log("RESULT: the client's published experience does NOT behave as documented. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: an authorized client opening the real client address is served the canonical publication, drawn by " +
    "the same renderer and reading character-for-character the same as the internal review's approved preview; " +
    "its filters recompute on the server and clear back exactly; a stranger, another tenant's client and an " +
    "internal person each get what they should; and an editor's later save reaches none of it.",
);
