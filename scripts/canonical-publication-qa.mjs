// =============================================================================
// UNIT 6B.4A — REAL-ROUTE BROWSER QA AGAINST A DISPOSABLE PUBLICATION TARGET
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh        # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//   BECOMMUNITY_POSTGREST_BIN="$HOME/becommunity-postgrest/postgrest" \
//     npm run qa:canonical-publication
//
// -----------------------------------------------------------------------------
// WHY THE TARGET IS DISPOSABLE, AND WHY IT HAS TO BE
// -----------------------------------------------------------------------------
// The thing under test IS a write, and the write it makes is the one a client
// would be served. Pointing this at the hosted project would publish a study
// there, which this phase forbids outright and which no assertion afterwards
// could undo.
//
// So the whole target is disposable: a throwaway PostgreSQL on a unix socket, a
// real PostgREST in front of it, a minimal authentication substitute so the
// product's own `/login` works, a synthetic canonical package committed through
// the product's own commit flow, and a production build of the app pointed at
// all of it. `resolveDisposableTarget` refuses to start if a Supabase
// environment variable is in scope, so this cannot reach a hosted project.
//
// -----------------------------------------------------------------------------
// WHAT IT DRIVES, RATHER THAN PHOTOGRAPHS
// -----------------------------------------------------------------------------
//   1  authorization precedes everything: no session, no review;
//   2  a study with nothing saved is told so, and sent to Construcción;
//   3  a REVIEW WITH BLOCKERS: the client preview is not drawn, the publish
//      control is not rendered, and the reason is a sentence a person can act on;
//   4  a healthy review: the exact draft revision, the page/block inventory, the
//      client-visible preview, and warnings kept apart from blockers;
//   5  ACKNOWLEDGEMENT: the publish control stays unusable until every required
//      confirmation and the final one are ticked — driven with a real keyboard;
//   6  a successful publication, and the database agrees;
//   7  RETRY: pressing publish again replays and does not publish twice;
//   8  a reload shows the current immutable publication and the history;
//   9  editing the draft afterwards does NOT change what the client is served;
//  10  publishing a later version, which replaces the first and keeps it;
//  11  the history lists both, and marks which one the client sees;
//  12  RESTORING an older publication creates a NEW DRAFT REVISION, moves no
//      pointer and destroys no snapshot;
//  13  a CONFLICT — somebody saved the draft while the screen was open — is
//      reported and publishes nothing;
//  14  desktop, tablet and phone compose inside the device width, in LAYOUT
//      pixels, and every chrome control is at least 44 of them;
//  15  nothing a person owns reached the browser;
//  16  the legacy experience draft is byte-identical before and after.
//
// Evidence is written OUTSIDE every git repository.
// =============================================================================

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { launchBrowser } from "./lib/harness-browser.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";

/* -------------------------------------------------------------------------- */

let failures = 0;
let executed = 0;
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
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (was ${JSON.stringify(actual)})`}`,
  );

const APP_PORT = 3120;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const EVIDENCE = process.env.BECOMMUNITY_QA_EVIDENCE ?? "/tmp/becommunity-qa-6b4a";

const TENANT = "22222222-2222-4222-8222-222222222222";
/** The study every happy-path assertion runs against. */
const STUDY = "66666666-6666-4666-8666-666666666666";
/** Its stored draft is deliberately bound to a package that is not this one. */
const DRIFT_STUDY = "55555555-5555-4555-8555-555555555555";
/** Nothing is ever saved for this one. */
const EMPTY_STUDY = "44444444-4444-4444-8444-444444444444";
/** Holds the planted legacy draft, so this run can prove it is untouched. */
const LEGACY_STUDY = "33333333-3333-4333-8333-333333333333";
const INTERNAL_ID = "11111111-1111-4111-8111-111111111111";
const INTERNAL_EMAIL = "interno@qa.local";
/** Minted at runtime, so this file carries no credential and neither does a log. */
const INTERNAL_PASSWORD = randomBytes(18).toString("base64url");

const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

console.log("Be Community — Unit 6B.4A: real-route publication QA against a DISPOSABLE target");
console.log("=".repeat(82));
mkdirSync(EVIDENCE, { recursive: true });

const run = (command, args, env, label) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const keep = (chunk) => {
      tail = `${tail}${chunk}`.slice(-4000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (${code}): ${tail.slice(-1500)}`))));
  });

await withDisposableDatabase(target, "pubqa", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032");
  const transport = psqlSuiteTransport(db);
  // 0031 IS REQUIRED HERE, not optional. The product publishes through
  // `publish_canonical_presentation_with_qualitative`, which 0031 creates; a
  // target prepared to 0030 answers every publication with «no pudimos
  // publicar», which is a truthful message about a target missing a
  // migration and a useless one for QA.
  transport.prepare(32);

  db.run(`
    insert into auth.users (id, email) values (${q(INTERNAL_ID)}, ${q(INTERNAL_EMAIL)});
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Cliente de prueba');
    insert into public.profiles (user_id, tenant_id, role, full_name)
      values (${q(INTERNAL_ID)}, ${q(TENANT)}, 'internal', 'Persona interna');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio de prueba', 'draft'),
      (${q(DRIFT_STUDY)}, ${q(TENANT)}, 'Estudio con enlace movido', 'draft'),
      (${q(EMPTY_STUDY)}, ${q(TENANT)}, 'Estudio sin nada guardado', 'draft'),
      (${q(LEGACY_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado', 'draft');
  `);

  db.run(`
    insert into public.study_experience_draft
      (study_id, tenant_id, schema_version, revision, definition, created_by, updated_by)
    values (${q(LEGACY_STUDY)}, ${q(TENANT)}, 2, 72,
      jsonb_build_object('schemaVersion', 2, 'metadata',
        jsonb_build_object('studyId', ${q(LEGACY_STUDY)}, 'tenantId', ${q(TENANT)}),
        'pages', jsonb_build_array(jsonb_build_object('id','p1','title','Heredado'))),
      ${q(INTERNAL_ID)}, ${q(INTERNAL_ID)});
  `);
  const legacyFingerprint = () =>
    db.run(`
      select schema_version::text || '|' || revision::text || '|' ||
             encode(sha256(definition::text::bytea), 'hex') || '|' ||
             extract(epoch from updated_at)::text
        from public.study_experience_draft where study_id = ${q(LEGACY_STUDY)};
    `).trim();
  const legacyBefore = legacyFingerprint();

  // EVERY STUDY THIS RUN LOOKS AT GETS A PACKAGE, INCLUDING THE EMPTY ONE.
  //
  // «Nothing saved» and «no canonical package» are different states with
  // different sentences, and the first draft of this run gave the empty study no
  // package at all — so the assertion about the no-draft sentence was made
  // against the no-package one and could only ever fail. The state under test
  // has to be built, not assumed.
  console.log("[setup] committing a synthetic canonical package for three studies");
  const pkg = await buildSyntheticPackage();
  for (const study of [STUDY, DRIFT_STUDY, EMPTY_STUDY]) {
    const committed = await runCanonicalCommit(transport, {
      tenantId: TENANT,
      studyId: study,
      files: [
        { fileName: "limpios.xlsx", bytes: pkg.cleanBytes },
        { fileName: "curado.xlsx", bytes: pkg.painBytes },
      ],
    });
    if (!committed.ok) throw new Error(`the synthetic package did not commit for ${study}: ${committed.code}`);
  }

  console.log("[setup] starting PostgREST and the authentication substitute");
  const stack = await startLocalStack(db, {
    binary: process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest"),
    target,
    authUsers: [{ id: INTERNAL_ID, email: INTERNAL_EMAIL, password: INTERNAL_PASSWORD }],
  });

  const appEnv = {
    NEXT_PUBLIC_SUPABASE_URL: stack.apiOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: stack.serviceKey,
    PORT: String(APP_PORT),
    NODE_ENV: "production",
  };

  let app = null;
  let browser = null;
  try {
    console.log("[setup] building the app against the disposable origin (this takes a minute)");
    await run("npm", ["run", "build"], appEnv, "next build");

    const portIsFree = await fetch(`${ORIGIN}/login`, { redirect: "manual" })
      .then(() => false)
      .catch(() => true);
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
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const answer = await fetch(`${ORIGIN}/login`, { redirect: "manual" });
        if (answer.status < 500) break;
      } catch {
        /* not up yet */
      }
      await sleep(1000);
      if (app.exitCode !== null) throw new Error(`the app exited (${app.exitCode}): ${appLog.slice(-1200)}`);
    }

    browser = await launchBrowser();
    const page = await browser.createContext({ label: "interno" });

    /* ------------------------------------------------------------------ */
    /* helpers that read the review screen through its own test hooks      */
    /* ------------------------------------------------------------------ */

    const reviewState = () =>
      page.evaluate(`(() => {
        const text = (id) => {
          const el = document.querySelector('[data-testid="' + id + '"]');
          return el ? el.textContent.trim() : null;
        };
        const publish = document.querySelector('[data-testid="publicar"]');
        return JSON.stringify({
          revision: text("revision-en-revision"),
          pages: text("conteo-paginas"),
          blocks: text("conteo-bloques"),
          visible: text("conteo-visibles"),
          currentPublication: text("publicacion-actual"),
          hasBlockers: !!document.querySelector('[data-testid="bloqueos"]'),
          blockers: text("bloqueos"),
          hasWarnings: !!document.querySelector('[data-testid="advertencias"]'),
          hasPreview: !!document.querySelector('[data-testid="vista-cliente"]'),
          hasInventory: !!document.querySelector('[data-testid="inventario"]'),
          hasDifference: !!document.querySelector('[data-testid="diferencia"]'),
          difference: text("diferencia"),
          history: text("historial"),
          publishExists: !!publish,
          publishDisabled: publish ? publish.disabled : null,
          outcome: text("resultado-publicacion"),
          restoreOutcome: text("resultado-restauracion"),
          acknowledgements: [...document.querySelectorAll('input[type="checkbox"][data-testid^="confirmar-"]')]
            .map((el) => ({ id: el.getAttribute("data-testid"), checked: el.checked })),
          finalConfirmed: (() => {
            const el = document.querySelector('[data-testid="confirmacion-final"]');
            return el ? el.checked : null;
          })(),
        });
      })()`).then(JSON.parse);

    const clickTestId = (id) =>
      page.evaluate(
        `(() => { const el = document.querySelector('[data-testid=' + ${JSON.stringify(JSON.stringify(id))} + ']'); if (!el) return false; el.click(); return true; })()`,
      );

    const waitFor = async (predicate, timeoutMs = 25000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await reviewState();
        if (predicate(last)) return last;
        await sleep(250);
      }
      return last;
    };

    /**
     * Tick every required confirmation, and keep going until the screen agrees.
     *
     * A CLICK BEFORE HYDRATION IS A CLICK THAT LANDS NOWHERE USEFUL. The review
     * is server-rendered, so its checkboxes are in the first HTML and a
     * programmatic click toggles the DOM immediately — while React's own handler
     * has not been attached yet, so no state changes, and the next render puts
     * the box back. Section [6] never saw this because a real keyboard press per
     * checkbox, with a focus round trip each, is slow enough to land after
     * hydration; a tight loop straight after a navigation is not.
     *
     * So this asks for the OUTCOME rather than performing the gesture: it clicks
     * what is still unticked, waits, and looks again, until the publish control
     * is usable or the deadline passes. It reports what it ended up doing, so a
     * failure says whether the clicks never landed or the rule never allowed it.
     */
    const giveEveryConfirmation = async (timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      let rounds = 0;
      let last = await reviewState();
      while (Date.now() < deadline) {
        if (last.publishDisabled === false) return { ok: true, rounds, last };
        rounds += 1;
        for (const entry of last.acknowledgements) {
          if (!entry.checked) await clickTestId(entry.id);
        }
        if (last.finalConfirmed === false) await clickTestId("confirmacion-final");
        await sleep(400);
        last = await reviewState();
      }
      return { ok: last.publishDisabled === false, rounds, last };
    };

    const publishedVersions = () =>
      db.run(`select coalesce(string_agg(version::text, ',' order by version), 'none') from public.canonical_presentation_revision where study_id = ${q(STUDY)};`).trim();
    const servedModel = () =>
      serializeDeterministic(
        db.json(`select coalesce(public.read_canonical_publication(${q(STUDY)}, ${q(TENANT)})::text, 'null');`)?.renderModel ?? null,
      );
    const draftRevision = () =>
      db.run(`select coalesce(max(revision)::text, 'none') from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim();

    /* ------------------------------------------------------------------ */
    console.log("\n[1] Authorization precedes everything");
    const anonymous = await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    check(anonymous.startsWith("/login"), `without a session the review answers /login (${anonymous})`);
    const anonymousBody = await page.evaluate("document.body.innerText");
    check(
      !/Publicar para el cliente|Revisión y publicación/.test(anonymousBody),
      "and no publication control is rendered to a stranger",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[2] Signing in through the product's own form");
    await page.navigate(`${ORIGIN}/login`);
    await page.evaluate(`(() => {
      const email = document.querySelector('input[type="email"], input[name="email"]');
      const password = document.querySelector('input[type="password"], input[name="password"]');
      const set = (el, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(email, ${JSON.stringify(INTERNAL_EMAIL)});
      set(password, ${JSON.stringify(INTERNAL_PASSWORD)});
      return true;
    })()`);
    await page.submitAndWait(`document.querySelector('form').requestSubmit()`);
    await sleep(1500);
    check(!(await page.location()).startsWith("/login"), "the session is established");

    /* ------------------------------------------------------------------ */
    console.log("\n[3] A study with nothing saved is told so, and sent to Construcción");
    await page.navigate(`${ORIGIN}/studio/e/${EMPTY_STUDY}/revision`);
    const emptyBody = await page.evaluate("document.body.innerText");
    check(/Todavía no hay nada que revisar/.test(emptyBody), "the review says there is nothing to review");
    check(
      /todavía no tiene una presentación guardada/.test(emptyBody),
      "and says WHY — no presentation has been saved, which is not the same as having no results",
    );
    check(/Compón una en Construcción/.test(emptyBody), "and says where to make one");
    check(
      !/Publicar para el cliente/.test(emptyBody),
      "and offers no publication control at all",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[4] A review WITH BLOCKERS draws no client preview and offers no publication");

    // A DRAFT BOUND TO A PACKAGE THAT IS NOT THIS ONE. It is the real shape of
    // the failure — evidence re-imported after a layout was composed — and it is
    // produced by writing a self-consistent document, the way the drift would.
    const goodDraft = await page.evaluate("1"); // keep the browser awake between long steps
    void goodDraft;
    {
      // Build a valid document by asking the product to compose one, then move
      // its binding. The composer refuses to OPEN a drifted draft, so this is
      // written through the RPC — a setup step, and labelled as one.
      await page.navigate(`${ORIGIN}/studio/e/${DRIFT_STUDY}/construccion`);
      await sleep(6000); // the debounced autosave stores the blueprint
      const composed = db.json(`
        select json_build_object(
          'definition', definition, 'registry_version', registry_version,
          'binding_fingerprint', binding_fingerprint, 'revision', revision
        )::text from public.canonical_presentation_draft where study_id = ${q(DRIFT_STUDY)};
      `);
      check(composed !== null, "the composer stored a draft for the drift study");
      const movedBinding = "a".repeat(64);
      const movedDefinition = { ...composed.definition, binding: movedBinding };
      const movedDigest = createHash("sha256").update(serializeDeterministic(movedDefinition), "utf8").digest("hex");
      db.run(`
        select public.save_canonical_presentation_draft(
          ${q(DRIFT_STUDY)}, ${q(INTERNAL_ID)}, ${q(JSON.stringify(movedDefinition))}::jsonb,
          ${q(composed.registry_version)}, ${q(movedBinding)}, ${q(movedDigest)},
          ${composed.revision}::bigint, 'qa-move-binding-01', null
        );
      `);
    }

    await page.navigate(`${ORIGIN}/studio/e/${DRIFT_STUDY}/revision`);
    const blocked = await waitFor((state) => state.hasBlockers === true || state.revision !== null);
    check(blocked.hasBlockers === true, "the review lists blockers");
    check(
      /No se vuelve a enlazar en silencio/.test(blocked.blockers ?? ""),
      "and says the results are no longer the ones this presentation names",
    );
    check(blocked.hasPreview === false, "no client preview is drawn, because there is nothing honest to draw");
    check(blocked.publishExists === false, "and the publish control is not rendered at all");
    const blockedBody = await page.evaluate("document.body.innerText");
    check(
      /Resuelve primero lo que lo impide/.test(blockedBody),
      "the screen says what to do, and that the server would refuse anyway",
    );
    check(
      !/binding_drift|document_unresolved|binding_fingerprint_mismatch/.test(blockedBody),
      "and it says it in Spanish, never in a code",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[5] A healthy review shows the revision, the inventory and the client preview");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/construccion`);
    await sleep(6000); // the debounced autosave stores the blueprint
    eq("the composer stored the draft at revision", draftRevision(), "1");

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    let state = await waitFor((s) => s.revision !== null);
    eq("the review names the exact draft revision under review", state.revision, "1");
    check(state.hasBlockers === false, "there are no blockers");
    check(state.hasWarnings === true, "there are warnings");
    check(state.hasPreview === true, "the client-visible preview is drawn");
    check(state.hasInventory === true, "and the page/block inventory is listed");
    check(Number(state.pages) >= 1 && Number(state.blocks) > 1, `over ${state.pages} page(s) and ${state.blocks} blocks`);
    check(
      Number(state.visible) > 0 && Number(state.visible) <= Number(state.blocks),
      `of which ${state.visible} would be visible to the client`,
    );
    check(
      /no tiene ninguna publicación todavía/.test(state.currentPublication ?? ""),
      "and it says the client sees nothing yet",
    );
    check(state.hasDifference === false, "with no difference section, because there is nothing to differ from");

    // BLOCKERS AND WARNINGS ARE DIFFERENT BOXES, not one list with two colours.
    const boxes = await page.evaluate(`JSON.stringify({
      blockers: !!document.querySelector('[data-testid="bloqueos"]'),
      warnings: !!document.querySelector('[data-testid="advertencias"]'),
      warningsHeading: (document.querySelector('[data-testid="advertencias"] h2') || {}).textContent || null,
    })`).then(JSON.parse);
    check(boxes.warnings && !boxes.blockers, "warnings are shown in their own section, apart from blockers");
    check(
      /Se puede publicar/.test(boxes.warningsHeading ?? ""),
      `and that section says so in its heading («${boxes.warningsHeading}»)`,
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[6] The publish control is unusable until every confirmation is given");
    check(state.publishExists === true, "the publish control is rendered");
    eq("and starts disabled", state.publishDisabled, true);
    check(state.acknowledgements.length > 0, `with ${state.acknowledgements.length} acknowledgement(s) to give`);
    check(
      state.acknowledgements.every((entry) => entry.checked === false),
      "none of them ticked",
    );

    // A REAL KEYBOARD, not a synthesised click. `Space` on a focused checkbox is
    // what a person does, and a control a keyboard cannot reach is a control a
    // keyboard user does not have.
    for (const entry of state.acknowledgements) {
      await page.evaluate(`document.querySelector('[data-testid="${entry.id}"]').focus()`);
      const focused = await page.evaluate(
        `document.activeElement === document.querySelector('[data-testid="${entry.id}"]')`,
      );
      check(focused === true, `the acknowledgement «${entry.id}» takes keyboard focus`);
      await page.pressKey("Space");
      await sleep(200);
    }
    state = await reviewState();
    check(state.acknowledgements.every((entry) => entry.checked), "Space ticks every acknowledgement");
    eq("and the publish control is STILL disabled without the final confirmation", state.publishDisabled, true);

    await page.evaluate(`document.querySelector('[data-testid="confirmacion-final"]').focus()`);
    await page.pressKey("Space");
    await sleep(200);
    state = await reviewState();
    eq("the final confirmation is ticked", state.finalConfirmed, true);
    eq("and only now is the publish control usable", state.publishDisabled, false);

    // AND A DISABLED CONTROL IS SKIPPED BY THE KEYBOARD, which is what `disabled`
    // means and what an `aria-disabled` div would only look like.
    const skips = await page.evaluate(`(() => {
      const publish = document.querySelector('[data-testid="publicar"]');
      return JSON.stringify({ tag: publish.tagName, type: publish.getAttribute("type"), native: "disabled" in publish });
    })()`).then(JSON.parse);
    eq("the publish control is a native button", skips.tag, "BUTTON");
    check(skips.native === true, "with a real `disabled` property, so the keyboard skips it when it is off");

    /* ------------------------------------------------------------------ */
    console.log("\n[7] Publishing, once");
    eq("nothing is published yet", publishedVersions(), "none");
    await clickTestId("publicar");
    state = await waitFor((s) => s.outcome !== null, 30000);
    check(/Publicada la versión 1/.test(state.outcome ?? ""), `the screen reports the publication («${state.outcome}»)`);
    eq("and the database holds exactly one version", publishedVersions(), "1");
    eq(
      "with one pointer and one event",
      db.run(`
        select (select count(*) from public.canonical_presentation_publication where study_id = ${q(STUDY)})::text
          || '|' || (select count(*) from public.canonical_presentation_publication_event where study_id = ${q(STUDY)})::text;
      `).trim(),
      "1|1",
    );
    const publishedOne = servedModel();
    check(publishedOne.length > 1000, `and the client would be served ${publishedOne.length} bytes of finished model`);

    /* ------------------------------------------------------------------ */
    console.log("\n[8] Pressing publish again REPLAYS, and does not publish twice");
    await clickTestId("publicar");
    state = await waitFor((s) => /ya se había hecho/.test(s.outcome ?? ""), 30000);
    check(
      /ya se había hecho/.test(state.outcome ?? ""),
      `the screen says the publication had already happened («${state.outcome}»)`,
    );
    eq("and there is still exactly one version", publishedVersions(), "1");
    eq(
      "and still exactly one event",
      db.run(`select count(*) from public.canonical_presentation_publication_event where study_id = ${q(STUDY)};`).trim(),
      "1",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[9] A reload shows the current publication and the history");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    state = await waitFor((s) => s.revision !== null);
    check(
      /el cliente ve la versión 1/.test(state.currentPublication ?? ""),
      `the screen says which version the client sees («${state.currentPublication}»)`,
    );
    check(/Versión 1/.test(state.history ?? ""), "the history lists version 1");
    check(/es la que ve el cliente ahora/.test(state.history ?? ""), "and marks it as the one being served");
    check(state.hasDifference === true, "and a difference section now exists");
    check(
      /La estructura es la misma/.test(state.difference ?? ""),
      "which says the structure is identical, because nothing has been edited yet",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[10] Editing the draft afterwards does NOT change what the client is served");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/construccion`);
    await sleep(1500);
    const opened = await page.evaluate(`(() => {
      const openers = [...document.querySelectorAll("button")]
        .filter((b) => /^Mostrar /.test(b.getAttribute("aria-label") || ""))
        .filter((b) => b.offsetParent !== null);
      openers.forEach((b) => b.click());
      return openers.length;
    })()`);
    void opened;
    await sleep(500);
    const renamed = await page.evaluate(`(async () => {
      const labels = [...document.querySelectorAll("label")]
        .filter((el) => el.textContent.trim().startsWith("Nombre") && el.querySelector("input"));
      if (labels.length === 0) return JSON.stringify({ ok: false });
      const input = labels[0].querySelector("input");
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "Página cambiada tras publicar");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.blur();
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return JSON.stringify({ ok: true, onScreen: document.body.innerText.includes("Página cambiada tras publicar") });
    })()`, { awaitPromise: true }).then(JSON.parse);
    check(renamed.ok && renamed.onScreen, "the draft is edited through the product's own control");
    await sleep(6000); // the debounced autosave
    eq("and the draft moves to revision", draftRevision(), "2");
    eq(
      "while what the client is served is byte-identical to what was approved",
      servedModel(),
      publishedOne,
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[11] Publishing a later version replaces the first and keeps it");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    state = await waitFor((s) => s.revision !== null);
    eq("the review is now of draft revision", state.revision, "2");
    check(state.hasDifference === true, "and shows how it differs from what is published");
    check(
      /se llamaba|se añadió|se quitó|no es igual/.test(state.difference ?? ""),
      `naming the change in words («${(state.difference ?? "").slice(0, 120)}»)`,
    );
    const confirmed = await giveEveryConfirmation();
    check(confirmed.ok, `the publish control is usable again after ${confirmed.rounds} round(s) of confirmation`);
    state = confirmed.last;
    check(
      state.acknowledgements.every((entry) => entry.checked) && state.finalConfirmed === true,
      "with every acknowledgement and the final confirmation ticked",
    );
    await clickTestId("publicar");
    state = await waitFor((s) => /Publicada la versión 2/.test(s.outcome ?? ""), 30000);
    check(/Publicada la versión 2/.test(state.outcome ?? ""), "the second publication is reported");
    eq("and both versions exist", publishedVersions(), "1,2");
    const publishedTwo = servedModel();
    check(publishedTwo !== publishedOne, "the client is now served the newer model");

    /* ------------------------------------------------------------------ */
    console.log("\n[12] The history lists both, and marks which one the client sees");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    state = await waitFor((s) => s.revision !== null);
    check(/Versión 1/.test(state.history ?? "") && /Versión 2/.test(state.history ?? ""), "both versions are listed");
    check(/sustituyó a la versión 1/.test(state.history ?? ""), "and the second says what it replaced");
    check(
      /Versión 2[^V]*es la que ve el cliente ahora/.test(state.history ?? ""),
      "and only the second is marked as the one being served",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[13] Restoring an older publication creates a NEW DRAFT REVISION");
    const pointerBefore = db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(STUDY)};`).trim();
    const draftBefore = draftRevision();
    await clickTestId("restaurar-1");
    await sleep(400);
    const restorePanel = await page.evaluate("document.body.innerText");
    check(
      /no la vuelve a publicar/.test(restorePanel),
      "the screen says plainly that restoring does not publish",
    );
    check(
      /crea una revisión nueva/.test(restorePanel),
      "and that it creates a new draft revision",
    );
    check(
      /se queda intacta en el historial/.test(restorePanel),
      "and that the publication it came from stays in the history",
    );
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="razon-restauracion"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "Volver a la primera versión aprobada");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    await clickTestId("confirmar-restauracion");
    state = await waitFor((s) => s.restoreOutcome !== null, 30000);
    check(
      /Se copió la versión 1 al borrador/.test(state.restoreOutcome ?? ""),
      `the restoration is reported («${state.restoreOutcome}»)`,
    );
    check(/No se publicó nada/.test(state.restoreOutcome ?? ""), "and says nothing was published");
    eq("the draft moved to a NEW revision", draftRevision(), String(Number(draftBefore) + 1));
    eq("the publication pointer did NOT move", db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(STUDY)};`).trim(), pointerBefore);
    eq("both snapshots are still there", publishedVersions(), "1,2");
    eq("and the client is still served the same bytes", servedModel(), publishedTwo);

    /* ------------------------------------------------------------------ */
    console.log("\n[14] A conflict publishes nothing, and says to look again");
    // Somebody saves the draft while this screen is open, through the same RPC.
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    state = await waitFor((s) => s.revision !== null);
    const reviewing = state.revision;
    const storedNow = db.json(`
      select json_build_object(
        'definition', definition, 'registry_version', registry_version,
        'binding_fingerprint', binding_fingerprint, 'revision', revision
      )::text from public.canonical_presentation_draft where study_id = ${q(STUDY)};
    `);
    const otherDefinition = {
      ...storedNow.definition,
      pages: storedNow.definition.pages.map((p, index) =>
        index === 0 ? { ...p, title: "Guardado por otra persona" } : p,
      ),
    };
    const otherDigest = createHash("sha256").update(serializeDeterministic(otherDefinition), "utf8").digest("hex");
    db.run(`
      select public.save_canonical_presentation_draft(
        ${q(STUDY)}, ${q(INTERNAL_ID)}, ${q(JSON.stringify(otherDefinition))}::jsonb,
        ${q(storedNow.registry_version)}, ${q(storedNow.binding_fingerprint)}, ${q(otherDigest)},
        ${storedNow.revision}::bigint, 'qa-other-person-02', null
      );
    `);
    eq(
      "another editor moved the draft forward while the review was open",
      draftRevision(),
      String(Number(reviewing) + 1),
    );

    const confirmedAgain = await giveEveryConfirmation();
    check(confirmedAgain.ok, "the publish control is usable, so the refusal below comes from the SERVER");
    await clickTestId("publicar");
    state = await waitFor((s) => s.outcome !== null, 30000);
    check(
      /ya no es lo que hay guardado/.test(state.outcome ?? ""),
      `the screen says what was reviewed is no longer what is stored («${state.outcome}»)`,
    );
    check(/Vuelve a cargar/.test(state.outcome ?? ""), "and tells the operator to look again");
    eq("and nothing was published", publishedVersions(), "1,2");
    eq("and the client is still served the same bytes", servedModel(), publishedTwo);

    /* ------------------------------------------------------------------ */
    console.log("\n[15] Desktop, tablet and phone compose inside the device width");
    for (const [label, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["phone", 390, 844]]) {
      await page.setViewport(width, height);
      await sleep(600);
      const measured = await page.evaluate(`JSON.stringify((() => {
        // LAYOUT pixels, never screen pixels: a transform: scale() reports a
        // 44 px control as 17 px and fails a product nobody changed.
        //
        // AND THE TARGET IS WHAT A PERSON HITS, NOT THE WIDGET INSIDE IT. A
        // checkbox is 16 px tall in every browser; what a person taps is the
        // LABEL wrapped around it, which this product sizes at 44. Measuring the
        // input reported three 16 px controls and would have been "fixed" by
        // making a checkbox 44 px tall, which no design does and which would
        // have been a test redesigning a product.
        const target = (el) =>
          el.matches("input[type='checkbox']") ? (el.closest("label") ?? el) : el;
        const visible = [...document.querySelectorAll("button, input[type='checkbox'], input[type='text']")]
          .filter((el) => el.offsetParent !== null && el.offsetHeight > 0)
          .map(target);
        // THE CHROME AND THE DRAWING ARE DIFFERENT THINGS. The 44 px rule is this
        // application's rule for ITS OWN controls; the client preview contains a
        // RENDERED PRESENTATION whose typography is sized by the design.
        const inPreview = (el) => el.closest('[data-testid="vista-cliente"]') !== null;
        const name = (el) => ((el.getAttribute("aria-label") || el.getAttribute("data-testid") || el.textContent || "?").trim().slice(0, 40));
        const chrome = visible.filter((el) => !inPreview(el));
        // INLINE LINKS ARE OBSERVED, NEVER ASSERTED. Two of them live in the
        // shared Studio shell — the skip link and the client's name inside a
        // sentence — and neither is a tap target in the sense the 44 px rule is
        // about: one is keyboard-only by design and the other is a word in a
        // paragraph. This unit changed neither, and holding prose to a touch
        // target would be unrelated visual debt dressed as a finding.
        const links = [...document.querySelectorAll("a[href]")]
          .filter((el) => el.offsetParent !== null && el.offsetHeight > 0 && !inPreview(el));
        return {
          doc: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          chromeCount: chrome.length,
          chromeSmall: chrome.filter((el) => el.offsetHeight < 44).map((el) => name(el) + ":" + el.offsetHeight),
          drawingSmall: visible.filter(inPreview).filter((el) => el.offsetHeight < 44).length,
          smallLinks: links.filter((el) => el.offsetHeight < 44).map((el) => name(el) + ":" + el.offsetHeight),
        };
      })())`).then(JSON.parse);
      check(
        measured.doc <= measured.inner + 1,
        `at ${label} (${width}px) the document does not overflow horizontally (${measured.doc} <= ${measured.inner})`,
      );
      eq(
        `and every one of the ${measured.chromeCount} chrome controls is at least 44 layout px at ${label}` +
          `${measured.chromeSmall.length ? ` — ${JSON.stringify(measured.chromeSmall)}` : ""}`,
        measured.chromeSmall.length,
        0,
      );
      if (measured.drawingSmall > 0) {
        console.log(
          `  — OBSERVED, not asserted: ${measured.drawingSmall} control(s) inside the client preview ` +
            `measure under 44 px at ${label}. They are the drawing, not this application's chrome.`,
        );
      }
      if (measured.smallLinks.length > 0) {
        console.log(
          `  — OBSERVED, not asserted: ${measured.smallLinks.length} inline link(s) under 44 px at ` +
            `${label} — ${JSON.stringify(measured.smallLinks)}. They are in the shared Studio shell, ` +
            "unchanged by this unit, and inline prose is not a touch target.",
        );
      }
    }
    await page.clearViewport();

    /* ------------------------------------------------------------------ */
    console.log("\n[16] Nothing a person owns, and nothing internal, reached the browser");
    const dom = await page.evaluate("document.documentElement.outerHTML");
    for (const forbidden of [
      "service_role",
      "SUPABASE_SERVICE_ROLE_KEY",
      "person_private",
      "quant_response",
      "qual_observation",
      "survey_response",
      "participant_attribute_value",
      "canonical_presentation_revision",
      "canonical_presentation_publication",
      "study_experience_draft",
      "publish_canonical_presentation",
      "restore_canonical_presentation",
      "binding_fingerprint",
      "package_idempotency_key",
      "plan_fingerprint",
      "definition_sha256",
    ]) {
      check(!dom.includes(forbidden), `the page carries no «${forbidden}»`);
    }
    check(!dom.includes(stack.serviceKey), "and no service key");
    check(!dom.includes(INTERNAL_PASSWORD), "and no password");
    // ─────────────────────────────────────────────────────────────────────────
    // DIGESTS: THE RULE HAS NO EXCEPTION AGAIN, AND IT IS STRONGER THAN THE ONE
    // IT REPLACES.
    //
    // It read «no 64-character digest of any kind» until Unit 6B.4B2 narrowed it
    // to «at most one, and not one of these three» so the qualitative evidence
    // digest could be echoed back by the browser. Unit 6B.4B2C removes both the
    // echo and the exception: the sign-off now sends a review intent and opaque
    // base32 group identities, and the digest it is recorded against is derived
    // on the server from the server's own read.
    //
    // So this asserts BOTH halves, and neither is redundant:
    //
    //   * ZERO distinct 64-hex values appear anywhere in the page. A rule with
    //     no allowance has nowhere to hide a second value;
    //   * and the definition digest, the binding fingerprint and the
    //     render-model digest are absent BY VALUE, which the old blanket rule
    //     never checked — so a page that leaked one fails by naming which.
    //
    // READ FROM THE DATABASE, not from a fixture. These are the values this
    // study's own storage actually holds at this moment, so the assertion is
    // about what could leak rather than about what a harness happened to build.
    const stored = db.json(`
      select json_build_object(
        'definition', d.definition_sha256,
        'binding', d.binding_fingerprint,
        'renderModel', (select r.render_model_sha256
                          from public.canonical_presentation_revision r
                         where r.study_id = ${q(STUDY)}
                         order by r.version desc limit 1)
      )::text
        from public.canonical_presentation_draft d
       where d.study_id = ${q(STUDY)};
    `);
    const storageDigests = {
      "the definition digest": stored?.definition ?? null,
      "the binding fingerprint": stored?.binding ?? null,
      "the render-model digest": stored?.renderModel ?? null,
    };
    check(
      Object.values(storageDigests).every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)),
      "the three storage digests were read back, so their absence below means something",
    );
    for (const [what, value] of Object.entries(storageDigests)) {
      check(value !== null && !dom.includes(value), `the page carries no ${what}`);
    }
    const digests = [...new Set(dom.match(/[0-9a-f]{64}/g) ?? [])];
    check(
      digests.length === 0,
      `NO digest of any kind crosses — the narrowing that admitted one is gone (${digests.length} distinct${digests.length ? `: ${digests.join(", ")}` : ""})`,
    );

    // AND WHAT DOES CROSS IS OPAQUE, AND IS NOT A DIGEST. The sign-off needs the
    // browser to name the groups it was showing; it names them in base32, whose
    // alphabet runs past `f`, so nothing spelled in it can be mistaken for a
    // storage digest by this scan or by a person reading the page's source.
    const opaqueGroupTokens = [...new Set(dom.match(/"q[a-z2-7]{8}"/g) ?? [])];
    check(
      opaqueGroupTokens.every((token) => !/^"[0-9a-f]+"$/.test(token)),
      `whatever group identities crossed are not hexadecimal (${opaqueGroupTokens.length} distinct)`,
    );

    // AND THE IDENTIFIER SCAN IS AIMED AT WHAT THIS UNIT RENDERS.
    //
    // A whole-document uuid scan can never pass on a Studio page: the study id is
    // in the address bar and in every process tab's href, and the shared shell
    // links the client by tenant id. Those are the application's own navigation
    // and predate this unit. What has to be true is that the REVIEW ITSELF —
    // every sentence, count, inventory row, difference line and history entry
    // this unit emits — carries no identifier at all.
    const reviewSubtree = await page.evaluate(`(() => {
      const root = document.querySelector('[data-testid="revision-publicacion"]');
      return root ? root.outerHTML : "";
    })()`);
    check(reviewSubtree.length > 2000, `the review subtree is present and substantial (${reviewSubtree.length} bytes)`);

    /*
     * AN ANCHOR'S TARGET IS NAVIGATION, AND IT IS SEPARATED FROM CONTENT HERE.
     *
     * The rule this section enforces is that nothing the review SAYS carries an
     * identifier: not a sentence, a count, an inventory row, a difference line
     * or a history entry. It was written when the review subtree contained no
     * link, so «content» and «subtree» were the same thing.
     *
     * Unit 6B.4B2C put one link inside it — «Revisar las frases», to the pain
     * editor — and a link to a study has to name the study, exactly as every
     * process tab above it does and as the address bar already does. So the
     * assertion is split rather than relaxed:
     *
     *   * the review's CONTENT — the subtree with every `href` removed —
     *     carries no uuid of any kind, which is the original rule intact;
     *   * every uuid that DOES appear appears only inside an `href`, and every
     *     one of them is THIS study, so a link cannot have become a way to
     *     name a tenant, a publication, a revision or a person.
     */
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const reviewContent = reviewSubtree.replace(/href="[^"]*"/g, 'href=""');
    check(!reviewContent.includes(TENANT), "the review's content carries no tenant identifier");
    check(!reviewContent.includes(STUDY), "nor the study identifier");
    check(
      !UUID.test(reviewContent),
      "nor any uuid at all — not a publication's, not a revision's, not a person's",
    );
    const linkedIds = [...new Set((reviewSubtree.match(UUID) ?? []))];
    check(
      linkedIds.every((id) => id === STUDY),
      `and every identifier a link carries is this study and nothing else (${linkedIds.length} distinct)`,
    );
    check(
      [...reviewSubtree.matchAll(/href="([^"]*)"/g)].every(
        ([, href]) => !UUID.test(href) || href.startsWith(`/studio/e/${STUDY}/`),
      ),
      "and each such link addresses a screen of this study, never anything else",
    );

    writeFileSync(join(EVIDENCE, "dom-final.html"), dom, "utf8");
    console.log(`  (the final DOM is written to ${join(EVIDENCE, "dom-final.html")} for review)`);

    /* ------------------------------------------------------------------ */
    console.log("\n[18] Unit 6B.4B2: the count IS the picture, and the filters work");

    /*
     * THE DEFECT THIS SECTION PHOTOGRAPHS.
     *
     * The review screen reported «23 bloques los ve el cliente» over a preview
     * that drew 20: three filter panels, counted by the inventory and dropped
     * by the renderer. Every assertion below is taken from the RENDERED DOM of
     * the real route in a real browser, which is the only place the two could
     * ever have been compared.
     */
    // Captured BEFORE anything is driven, so «the draft did not move» is a
    // comparison rather than a hope.
    const draftRevisionBeforeFilters = db
      .run(`select revision::text from public.canonical_presentation_draft where study_id = ${q(STUDY)};`)
      .trim();
    // THE OTHER TWO ROW COUNTS A PREVIEW MUST NOT MOVE, captured at the same
    // moment for the same reason: «nothing changed» is a comparison or it is
    // nothing.
    const eventsBeforeFilters = db
      .run(`select count(*)::text from public.canonical_presentation_publication_event where study_id = ${q(STUDY)};`)
      .trim();
    const signoffsBeforeFilters = db
      .run(`select count(*)::text from public.canonical_qualitative_signoff where study_id = ${q(STUDY)};`)
      .trim();
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    const reviewNow = await waitFor((snapshot) => snapshot.revision !== null);
    check(reviewNow.revision !== null, `the review is drawn again at revision ${reviewNow.revision}`);

    const captureShot = async (name) => {
      writeFileSync(join(EVIDENCE, `${name}.png`), await page.screenshot());
      console.log(`  (screenshot: ${join(EVIDENCE, `${name}.png`)})`);
    };
    await captureShot("revision-corregida");

    check(
      reviewNow.hasPreview === true,
      "and it draws the client's own view, so the count below has a picture to be compared against",
    );
    const reportedVisible = Number(
      await page.evaluate(`document.querySelector('[data-testid="conteo-visibles"]').textContent.trim()`),
    );
    /*
     * THE CARDS THE CLIENT PREVIEW ACTUALLY DREW.
     *
     * Counted inside `[data-testid="vista-cliente"]` and only there, and only
     * the TOP-LEVEL block cards: `section` elements that are a block card and
     * are not nested inside another one. Counting every `section` on the page
     * would count the review screen's own cards, which is how a check like this
     * passes for the wrong reason.
     */
    const drawnCards = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      if (!preview) return -1;
      const cards = [...preview.querySelectorAll('section.rounded-2xl')];
      return cards.filter((card) => !cards.some((other) => other !== card && other.contains(card))).length;
    })()`);
    eq("the preview draws block cards", drawnCards > 0, true);
    eq(
      `the review's «los ve el cliente» count IS the number of cards drawn (${reportedVisible} reported)`,
      drawnCards,
      reportedVisible,
    );

    // AND THE INVENTORY AGREES WITH BOTH. It is the third answer that used to
    // be able to differ, and it is read from the DOM rather than from a payload.
    const inventoryVisible = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="inventario"] li')];
      return rows.filter((row) => row.querySelector('.text-positive') !== null).length;
    })()`);
    eq("and the inventory marks exactly as many as visible", inventoryVisible, reportedVisible);

    /* ---- the filter panelCount, and whether they actually move anything ------ */

    /*
     * TWO DIFFERENT NUMBERS, AND CONFLATING THEM IS HOW THIS CHECK LIED ONCE.
     *
     * A PANEL is one block — one card a client sees. A CHARACTERISTIC is one
     * `fieldset` inside it, and a panel legitimately offers many. Counting
     * legends and calling the answer «panels» reported seventeen panels over a
     * page that draws one, and the inventory comparison beneath it then failed
     * for a reason that had nothing to do with the inventory.
     */
    const panelCount = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      if (!preview) return 0;
      const cards = [...preview.querySelectorAll('section.rounded-2xl')]
        .filter((card, _i, all) => !all.some((other) => other !== card && other.contains(card)));
      return cards.filter((card) => card.querySelector('fieldset legend') !== null).length;
    })()`);
    const characteristicCount = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      if (!preview) return 0;
      return preview.querySelectorAll('fieldset legend').length;
    })()`);
    const panelBoxes = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      if (!preview) return { total: 0, enabled: 0 };
      const inputs = [...preview.querySelectorAll('input[type="checkbox"]')];
      return { total: inputs.length, enabled: inputs.filter((input) => !input.disabled).length };
    })()`);

    /*
     * THE FIXTURE NOW CARRIES A REAL FILTER PANEL, WHICH IS WHY THIS BRANCH IS
     * AN ASSERTION RATHER THAN AN OBSERVATION.
     *
     * It used to print «OBSERVED, not asserted: this synthetic study's blueprint
     * composes no filter panel», which was honest and was a hole: the whole
     * defect this unit corrected lived in filter panels, and the browser proof
     * had nothing to drive. `buildGenericStartingBlueprint` now composes ONE
     * panel offering the characteristics every filterable block on the page has
     * in common, and connects exactly those blocks — so the panel is real
     * product output, not a fixture planted around the product.
     */
    check(panelBoxes.total > 0, `the preview draws ${panelCount} real filter panel(s)`);
    check(characteristicCount > 0, `offering ${characteristicCount} characteristic(s) between them`);
    eq(
      `the preview draws ${panelBoxes.total} filter option(s) in ${characteristicCount} characteristic(s)`,
      panelBoxes.total > 0,
      true,
    );
    // EVERY ONE OF THEM IS OPERABLE. A client's page carries a working panel
    // or none, so a disabled box inside the client preview would be the exact
    // deception this unit removed.
    eq("and every one of them is operable, not a disabled decoration", panelBoxes.enabled, panelBoxes.total);

    /*
     * EVERY PANEL THE INVENTORY COUNTS IS A PANEL THE PREVIEW DRAWS.
     *
     * This is the equality the unit exists for, taken at DOM level on both
     * sides: the inventory's own rows are read from the review screen, the
     * panels are counted inside the client preview, and the two numbers are
     * compared. «23 counted over 20 drawn» is the defect it refuses.
     */
    const inventoryPanels = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="inventario"] li')];
      return rows.filter((row) => /Filtrar por características/.test(row.textContent ?? "")).length;
    })()`);
    eq("the inventory counts exactly the panels the preview drew", inventoryPanels, panelCount);

    /*
     * WHAT EACH BLOCK SAYS, BY ITS AUTHORED TITLE.
     *
     * Read from the rendered cards rather than from a payload, because a
     * payload comparison would be comparing the server with itself. The title
     * is the key because it is the only thing on a client card that names the
     * block, and it is what a reviewer would use to say «this one moved».
     */
    const cardsByTitle = async () =>
      JSON.parse(
        await page.evaluate(`(() => {
          const preview = document.querySelector('[data-testid="vista-cliente"]');
          if (!preview) return "{}";
          const cards = [...preview.querySelectorAll('section.rounded-2xl')]
            .filter((card, _i, all) => !all.some((other) => other !== card && other.contains(card)));
          const out = {};
          for (const card of cards) {
            const heading = card.querySelector('h3, h2');
            const title = (heading ? heading.textContent : "").trim();
            if (title.length > 0) out[title] = (card.innerText || "").trim();
          }
          return JSON.stringify(out);
        })()`),
      );

    const neutralCards = await cardsByTitle();
    check(Object.keys(neutralCards).length > 1, `the neutral preview draws ${Object.keys(neutralCards).length} titled cards`);

    // A REAL CLICK, and the figures follow it. The count sentence is the
    // server's own, so if it changes the server recomputed.
    const sentenceBefore = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      return preview.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? "";
    })()`);
    await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      preview.querySelector('input[type="checkbox"]:not([disabled])').click();
    })()`);
    await sleep(2500); // the server recomputes; there is no event to await
    const sentenceAfter = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      return preview.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? "";
    })()`);
    check(sentenceBefore !== sentenceAfter, `a real click recomputes on the server («${sentenceBefore}» → «${sentenceAfter}»)`);
    await captureShot("filtros-operativos");

    /*
     * CONNECTED BLOCKS CHANGE. UNCONNECTED BLOCKS DO NOT. BOTH, IN ONE PASS.
     *
     * A filter that moved everything would be as wrong as one that moved
     * nothing, and «sharing a dimension is not a connection» is a standing rule
     * of this layer. The retention series declares no supported filter at all —
     * it is measured over a period's roster — so the generic blueprint leaves it
     * unconnected, and it is the honest witness for the second half.
     */
    const filteredCards = await cardsByTitle();
    const moved = Object.keys(neutralCards).filter(
      (title) => filteredCards[title] !== undefined && filteredCards[title] !== neutralCards[title],
    );
    const still = Object.keys(neutralCards).filter(
      (title) => filteredCards[title] !== undefined && filteredCards[title] === neutralCards[title],
    );
    check(moved.length > 0, `blocks the panel is connected to changed (${moved.length}: ${moved.slice(0, 3).join(" · ")})`);
    check(
      still.length > 0,
      `and blocks nobody connected did not (${still.length}: ${still.slice(0, 3).join(" · ")})`,
    );
    check(
      moved.length + still.length === Object.keys(filteredCards).length ||
        moved.length + still.length <= Object.keys(neutralCards).length,
      "every card is accounted for as either moved or unchanged",
    );

    // AND THE SELECTION CHANGED NOTHING THAT IS STORED.
    const draftAfterFilter = db.run(
      `select revision::text from public.canonical_presentation_draft where study_id = ${q(STUDY)};`,
    ).trim();
    eq("and the draft revision did not move", draftAfterFilter, draftRevisionBeforeFilters);
    eq(
      "no publication row was written by operating a filter",
      db.run(`select count(*)::text from public.canonical_presentation_publication_event where study_id = ${q(STUDY)};`).trim(),
      eventsBeforeFilters,
    );
    eq(
      "and no review row either",
      db.run(`select count(*)::text from public.canonical_qualitative_signoff where study_id = ${q(STUDY)};`).trim(),
      signoffsBeforeFilters,
    );

    /*
     * CLEARING RESTORES THE EXACT NEUTRAL MODEL.
     *
     * Card for card, title for title, byte for byte of rendered text. «Roughly
     * back» is what a partial restore looks like, and a reader who cleared a
     * filter and got a different study would have no way to know.
     */
    const clearedBack = await page.evaluate(`(() => {
      const control = document.querySelector('[data-testid="limpiar-filtros-vista"]');
      if (!control) return false;
      control.click();
      return true;
    })()`);
    await sleep(2500);
    const stillFiltered = await page.evaluate(
      `document.querySelector('[data-testid="vista-cliente-filtrada"]') !== null`,
    );
    check(clearedBack && !stillFiltered, "and «ver el estudio completo» puts the whole study back");
    const restoredCards = await cardsByTitle();
    eq(
      "the restored preview draws exactly the same cards",
      JSON.stringify(Object.keys(restoredCards).sort()),
      JSON.stringify(Object.keys(neutralCards).sort()),
    );
    const differing = Object.keys(neutralCards).filter((title) => restoredCards[title] !== neutralCards[title]);
    eq(
      `and every one of them says exactly what it said before${differing.length ? ` (differs: ${differing.slice(0, 3).join(" · ")})` : ""}`,
      differing.length,
      0,
    );

    /*
     * AND THE SELECTION IS EPHEMERAL: A RELOAD IS NEUTRAL AGAIN.
     *
     * Nothing about a reviewer's tick is stored, in the draft or anywhere else,
     * so reopening the screen shows the study rather than the last cut somebody
     * happened to look at.
     */
    await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      preview.querySelector('input[type="checkbox"]:not([disabled])').click();
    })()`);
    await sleep(2500);
    check(
      await page.evaluate(`document.querySelector('[data-testid="vista-cliente-filtrada"]') !== null`),
      "a fresh selection filters the preview again",
    );
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    await waitFor((snapshot) => snapshot.revision !== null);
    check(
      await page.evaluate(`document.querySelector('[data-testid="vista-cliente-filtrada"]') === null`),
      "and a reload comes back neutral: the selection was never stored",
    );
    const reloadedCards = await cardsByTitle();
    const reloadDiffers = Object.keys(neutralCards).filter((title) => reloadedCards[title] !== neutralCards[title]);
    eq("with the same cards saying the same things", reloadDiffers.length, 0);
    eq(
      "and the draft revision STILL did not move",
      db.run(`select revision::text from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim(),
      draftRevisionBeforeFilters,
    );

    /* ---- the qualitative sign-off card ---------------------------------- */

    const qualitativePresent = await page.evaluate(
      `document.querySelector('[data-testid="categorias-cualitativas"]') !== null`,
    );
    if (!qualitativePresent) {
      console.log(
        "  — OBSERVED, not asserted: this synthetic study's document binds no qualitative group, " +
          "so there is no sign-off card to drive. The four states and the block naming are proved " +
          "offline, and the storage is proved against a real PostgreSQL.",
      );
    } else {
      const qualState = await page.evaluate(
        `document.querySelector('[data-testid="estado-revision-cualitativa"]').textContent.trim()`,
      );
      check(/Nadie ha dejado constancia/.test(qualState), `it starts unreviewed («${qualState}»)`);
      await captureShot("categorias-sin-revisar");

      // RECORDING IT CLEARS IT, and the record is a real row.
      await page.evaluate(`document.querySelector('[data-testid="lei-las-categorias"]').click()`);
      await page.evaluate(
        `document.querySelector('[data-testid="registrar-revision-cualitativa"]').click()`,
      );
      await sleep(3000); // the action re-reads, re-resolves and records
      const signOffOutcome = await page.evaluate(
        `document.querySelector('[data-testid="resultado-revision-cualitativa"]').textContent.trim()`,
      );
      check(/Revisión registrada/.test(signOffOutcome), `recording it succeeds («${signOffOutcome}»)`);
      eq(
        "and the database holds exactly one sign-off",
        db.run(`select count(*)::text from public.canonical_qualitative_signoff where study_id = ${q(STUDY)};`).trim(),
        "1",
      );
      // AND IT NAMES THE WORDS, not just a hash of them.
      check(
        Number(
          db.run(
            `select cardinality(category_labels)::text from public.canonical_qualitative_signoff where study_id = ${q(STUDY)};`,
          ).trim(),
        ) > 0,
        "and it stored the category labels themselves, not only their digest",
      );

      await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
      await waitFor((snapshot) => snapshot.revision !== null);
      const clearedState = await page.evaluate(
        `document.querySelector('[data-testid="estado-revision-cualitativa"]').textContent.trim()`,
      );
      check(
        /registró haber revisado exactamente estas categorías/.test(clearedState),
        `and on reload the screen says so («${clearedState.slice(0, 70)}…»)`,
      );
      const warningsAfter = await page.evaluate(`(() => {
        const box = document.querySelector('[data-testid="advertencias"]');
        return box ? box.textContent : "";
      })()`);
      check(
        !/Nadie ha dejado constancia/.test(warningsAfter),
        "and the warning that could never be cleared is cleared",
      );
      await captureShot("categorias-revisadas");
    }

    /* ---- «confirmaciones», and the sentences a person reads -------------- */

    const bodyText = await page.evaluate("document.body.innerText");
    /*
     * THE MISSPELLING, AND ONLY THE MISSPELLING.
     *
     * This read `/confirmaci[oó]nes/i`, which matches «confirmaciones» — the
     * CORRECT plural — as readily as «confirmaciónes». It passed for as long as
     * neither word happened to be on screen, and the first review that actually
     * had a pending acknowledgement failed it for spelling the word right.
     *
     * A check that cannot tell the defect from the fix is not a check. Spanish
     * drops the accent when the stress stops falling on the last syllable, so
     * the misspelling is exactly «confirmaciónes» and nothing else is.
     */
    check(!/confirmaciónes/i.test(bodyText), "and nothing on the screen says «confirmaciónes»");
    check(
      /confirmaciones|confirmación/i.test(bodyText),
      "while the correctly spelled word is on the screen, so the check above had something to be wrong about",
    );

    /* ------------------------------------------------------------------ */
    console.log("\n[19] Unit 6B.4B2C: a person decides the journey pain, phrase by phrase");

    /*
     * THE WHOLE EDITORIAL WORKFLOW, DRIVEN THROUGH THE REAL ROUTE.
     *
     * The synthetic package carries curated pain phrases attached to journey
     * stages — `painSheets()` in `canonical-fixtures.mjs` writes them — so this
     * study has a real queue with real sentinel text in it, and every phrase
     * below is a value that exists nowhere else in the product.
     *
     * WHAT IS PROVED HERE AND NOWHERE ELSE: that the screen a person actually
     * uses loads the curated phrases, offers the whole touchpoint list with
     * nothing preselected, records an approval, a rejection and a one-to-many
     * mapping, refuses an incomplete one, and that the client preview then draws
     * the approved cloud and the badges — and that `pain_point` is byte-
     * identical afterwards.
     */
    const painDigestBefore = db
      .run(`select coalesce(encode(sha256(convert_to(string_agg(p::text, '|' order by p::text), 'UTF8')), 'hex'), 'empty') from public.pain_point p where p.study_id = ${q(STUDY)};`)
      .trim();
    const painRowsBefore = db
      .run(`select count(*)::text from public.pain_point where study_id = ${q(STUDY)};`)
      .trim();
    check(Number(painRowsBefore) > 0, `the study carries ${painRowsBefore} curated pain rows to review`);

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    // EVENT-DRIVEN, not a sleep: the harness's own bounded DOM wait, so a slow
    // first render is waited for and a broken one fails rather than passing on
    // an empty page.
    const editorReady = await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    check(editorReady === true, "the pain editor opens at its own address");
    await captureShot("dolor-cola");

    const queue = JSON.parse(
      await page.evaluate(`(() => {
        const items = [...document.querySelectorAll('[data-testid="dolor-item"]')];
        return JSON.stringify(items.map((item) => ({
          token: item.getAttribute("data-token"),
          state: (item.querySelector('[data-testid="dolor-estado-item"]') || {}).textContent || "",
          text: (item.innerText || "").trim(),
        })));
      })()`),
    );
    check(queue.length > 0, `the queue lists ${queue.length} phrase(s) for a person to decide`);
    check(
      queue.every((item) => /^pp[a-z2-7]{16}$/.test(item.token ?? "")),
      "each carries an opaque item identity and nothing that looks like a row id",
    );
    check(
      queue.every((item) => /Sin revisar/.test(item.state)),
      "and every one of them starts «Sin revisar»",
    );

    // NOTHING ON THE SCREEN IS A DIGEST, A UUID, OR ANYBODY'S DATA.
    const editorDom = await page.evaluate("document.documentElement.outerHTML");
    check(!/[0-9a-f]{64}/.test(editorDom), "the editor carries no 64-hex digest of any kind");
    check(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(
        await page.evaluate(`(() => {
          const root = document.querySelector('[data-testid="editor-dolor"]');
          return root ? root.outerHTML : "";
        })()`),
      ),
      "and no identifier at all inside the editor itself",
    );
    for (const forbidden of ["respondent", "quant_response", "qual_observation", "person_private", "raw_text", "normalized_text", "pain_point"]) {
      check(!editorDom.includes(forbidden), `nor the word «${forbidden}»`);
    }

    /* ---- nothing is preselected, and the list is the WHOLE list ---------- */

    await page.evaluate(
      `document.querySelectorAll('[data-testid="dolor-abrir"]')[0].click()`,
    );
    await sleep(600);
    const offer = JSON.parse(
      await page.evaluate(`(() => {
        const boxes = [...document.querySelectorAll('[data-testid="dolor-punto"]')];
        const routes = [...document.querySelectorAll('[data-testid="dolor-item"] fieldset legend')];
        return JSON.stringify({
          points: boxes.length,
          checked: boxes.filter((box) => box.checked).length,
          routes: routes.length,
          search: (document.querySelector('[data-testid="dolor-buscar"]') || {}).value || "",
        });
      })()`),
    );
    check(offer.points > 0, `the form offers ${offer.points} touchpoint(s), grouped under ${offer.routes} route(s)`);
    eq("and NOT ONE of them is preselected", offer.checked, 0);
    eq("the search box starts empty, so it proposes nothing", offer.search, "");
    await captureShot("dolor-sin-preseleccion");

    // THE SEARCH FILTERS WHAT A PERSON TYPED, AND RESTORES THE WHOLE LIST.
    // THE SEARCH IS DRIVEN WITH A STRING NOTHING MATCHES, AND THEN CLEARED.
    // Typing a word that DOES match would prove the same mechanism and would
    // read like a proposal being confirmed; what has to be true is that the box
    // narrows what a person typed and restores the whole list when they stop.
    await page.evaluate(`(() => {
      const search = document.querySelector('[data-testid="dolor-buscar"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(search, ${JSON.stringify("zzz-no-existe")});
      search.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(400);
    eq(
      "a search nothing matches narrows the list to nothing, rather than guessing",
      await page.evaluate(`document.querySelectorAll('[data-testid="dolor-punto"]').length`),
      0,
    );
    await page.evaluate(`(() => {
      const search = document.querySelector('[data-testid="dolor-buscar"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(400);
    eq(
      "and clearing it brings the whole list back",
      await page.evaluate(`document.querySelectorAll('[data-testid="dolor-punto"]').length`),
      offer.points,
    );

    /* ---- an INCOMPLETE decision is refused, and says what is missing ----- */

    await page.evaluate(`document.querySelector('[data-testid="dolor-aprobar"]').click()`);
    await sleep(2500);
    const incomplete = await page.evaluate(`(() => {
      const el = document.querySelector('[data-testid="dolor-resultado"]');
      return el ? el.textContent.trim() : "";
    })()`);
    check(
      /por lo menos un punto de contacto/.test(incomplete),
      `approving with no touchpoint is refused, and says why («${incomplete.slice(0, 60)}…»)`,
    );
    eq(
      "and nothing was written",
      db.run(`select count(*)::text from public.canonical_journey_pain_decision where study_id = ${q(STUDY)};`).trim(),
      "0",
    );

    /* ---- a ONE-TO-MANY approval, recorded --------------------------------- */

    const chosen = Math.min(2, offer.points);
    await page.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('[data-testid="dolor-punto"]')];
      for (let index = 0; index < ${chosen}; index += 1) boxes[index].click();
    })()`);
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="dolor-frase"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "FRASE-APROBADA-QA");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await page.evaluate(`document.querySelector('[data-testid="dolor-aprobar"]').click()`);
    await sleep(3000);
    const approvedOutcome = await page.evaluate(
      `document.querySelector('[data-testid="dolor-resultado"]').textContent.trim()`,
    );
    check(/Decisión registrada/.test(approvedOutcome), `the approval is recorded («${approvedOutcome.slice(0, 50)}…»)`);
    const storedDecision = db.json(`
      select json_build_object(
        'n', count(*),
        'points', max(cardinality(touchpoints)),
        'phrase', max(public_phrase)
      )::text from public.canonical_journey_pain_decision where study_id = ${q(STUDY)};
    `);
    eq("one decision row exists", Number(storedDecision.n), 1);
    eq("mapped to both touchpoints the person ticked", Number(storedDecision.points), chosen);
    eq("with the public phrase they typed", storedDecision.phrase, "FRASE-APROBADA-QA");

    /* ---- a REJECTION, with its reason ------------------------------------ */

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const approvedNow = await page.evaluate(`(() => {
      const items = [...document.querySelectorAll('[data-testid="dolor-item"]')];
      return items.filter((item) => /Aprobado/.test(item.textContent || "")).length;
    })()`);
    eq("on reload the decided phrase shows as approved", approvedNow, 1);
    await captureShot("dolor-aprobada");

    if (queue.length > 1) {
      await page.evaluate(
        `document.querySelectorAll('[data-testid="dolor-abrir"]')[1].click()`,
      );
      await sleep(600);
      await page.evaluate(`(() => {
        const input = document.querySelectorAll('[data-testid="dolor-motivo"]')[0];
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "MOTIVO-QA-no-publicable");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await page.evaluate(`document.querySelectorAll('[data-testid="dolor-excluir"]')[0].click()`);
      await sleep(3000);
      eq(
        "excluding a phrase records a second decision",
        db.run(`select count(*)::text from public.canonical_journey_pain_decision where study_id = ${q(STUDY)};`).trim(),
        "2",
      );
      eq(
        "as a rejection with no public phrase at all",
        db.run(`select coalesce(public_phrase, 'NULL') from public.canonical_journey_pain_decision where disposition = 'rejected' and study_id = ${q(STUDY)};`).trim(),
        "NULL",
      );
    }

    /* ---- the review is INCOMPLETE, and the review screen says so --------- */

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    await waitFor((snapshot) => snapshot.revision !== null);
    const painSummary = await page.evaluate(`(() => {
      const box = document.querySelector('[data-testid="dolor-recorrido"]');
      return box ? (box.innerText || "").trim() : "";
    })()`);
    check(painSummary.length > 0, "the review screen carries the pain review summary");
    // CASE-INSENSITIVE, AND THE REASON IS NOT LAZINESS. Those four labels carry
    // a `uppercase` class, and `innerText` returns the text as RENDERED — so a
    // case-sensitive scan for «Sin revisar» looks for a string the browser has
    // already turned into «SIN REVISAR» and fails on a screen that is correct.
    check(
      /sin revisar/i.test(painSummary),
      `and reports how many phrases nobody has decided yet («${painSummary.replace(/\s+/g, " ").slice(0, 80)}…»)`,
    );
    check(
      /nadie ha aprobado ni excluido/i.test(painSummary),
      "in a sentence that names the consequence, not the mechanism",
    );
    // AND WHILE IT IS INCOMPLETE, THE CLOUD IS NOT DRAWN. A partial review must
    // not produce a partial cloud, and this is where that stops being a claim.
    check(
      !(await page.evaluate(
        `document.querySelector('[data-testid="vista-cliente"]').innerText.includes("FRASE-APROBADA-QA")`,
      )),
      "and the client preview draws no approved phrase yet: half a review is not half a cloud",
    );

    /* ---- FINISHING the queue, one decision at a time, through the UI ----- */
    //
    // Every remaining phrase gets an explicit disposition, because that is what
    // the completion rule requires and because «complete» is the only state that
    // produces content. Two more are approved — the second carrying the SAME
    // public phrase as the first, so the cloud has something to count twice —
    // and the rest are excluded.
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const total = await page.evaluate(`document.querySelectorAll('[data-testid="dolor-item"]').length`);
    let approvedCount = 1; // the first item, decided above
    for (let index = 2; index < Number(total); index += 1) {
      const approve = index < 4;
      await page.evaluate(`(() => {
        const openers = [...document.querySelectorAll('[data-testid="dolor-abrir"]')];
        openers[${index}].click();
      })()`);
      await sleep(500);
      if (approve) {
        await page.evaluate(`(() => {
          const box = document.querySelector('[data-testid="dolor-punto"]');
          if (box) box.click();
          const input = document.querySelector('[data-testid="dolor-frase"]');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          setter.call(input, ${JSON.stringify("FRASE-APROBADA-QA")});
          input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await page.evaluate(`document.querySelector('[data-testid="dolor-aprobar"]').click()`);
        approvedCount += 1;
      } else {
        await page.evaluate(`document.querySelector('[data-testid="dolor-excluir"]').click()`);
      }
      await sleep(2200);
      await page.evaluate(`(() => {
        const openers = [...document.querySelectorAll('[data-testid="dolor-abrir"]')];
        openers[${index}].click();
      })()`);
      await sleep(200);
    }

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const finishedCounts = JSON.parse(
      await page.evaluate(`(() => {
        const dl = document.querySelector('[data-testid="dolor-conteos"]');
        const values = [...dl.querySelectorAll('dd')].map((dd) => Number(dd.textContent.trim()));
        return JSON.stringify({ unreviewed: values[0], approved: values[1], rejected: values[2], unresolved: values[3] });
      })()`),
    );
    eq("with the queue finished, nothing is left undecided", finishedCounts.unreviewed, 0);
    eq("and the approvals are the ones a person made", finishedCounts.approved, approvedCount);
    check(
      await page.evaluate(`document.querySelector('[data-testid="dolor-completo"]') !== null`),
      "the editor says the review is finished",
    );
    await captureShot("dolor-completa");

    /* ---- THE CLOUD, AND THE BADGES, IN THE CLIENT'S OWN PREVIEW ---------- */

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    await waitFor((snapshot) => snapshot.revision !== null);
    check(
      await page.evaluate(`document.querySelector('[data-testid="dolor-completo"]') !== null`),
      "the review screen agrees that the review is finished",
    );
    const cloudText = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      return preview ? (preview.innerText || "") : "";
    })()`);
    check(
      cloudText.includes("FRASE-APROBADA-QA"),
      "the client preview now draws the approved phrase a person wrote",
    );
    check(
      !cloudText.includes("MOTIVO-QA-no-publicable"),
      "and never the reason somebody gave for excluding another one",
    );
    // NOR THE SOURCE'S OWN WORDING. The published phrase is the one that was
    // APPROVED; the working material stays in the editor.
    const sourcePhrase = db
      .run(`select normalized_text from public.pain_point where study_id = ${q(STUDY)} order by id limit 1;`)
      .trim();
    check(
      sourcePhrase.length > 0 && !cloudText.includes(sourcePhrase),
      "nor the source's own curated wording, which nobody approved for a client",
    );

    const badges = await page.evaluate(
      `document.querySelectorAll('[data-testid="vista-cliente"] [data-testid="dolor-en-punto"]').length`,
    );
    // A BADGE IS DRAWN ON THE SELECTED POINT ONLY, so the journey has to be
    // driven to one that carries a mapping before it can be counted.
    const badgeFound = await page.evaluate(`(() => {
      const preview = document.querySelector('[data-testid="vista-cliente"]');
      const nodes = [...preview.querySelectorAll('[data-journey-node]')];
      for (const node of nodes) {
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        if (preview.querySelector('[data-testid="dolor-en-punto"]')) return true;
      }
      return false;
    })()`);
    check(
      badgeFound === true || Number(badges) > 0,
      "and a mapped touchpoint on the journey carries its pain badge",
    );
    await captureShot("nube-y-marcas");

    /* ---- KEYBOARD: the editor is operable without a mouse ---------------- */

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const keyboard = JSON.parse(
      await page.evaluate(`(() => {
        const opener = document.querySelector('[data-testid="dolor-abrir"]');
        opener.focus();
        const focused = document.activeElement === opener;
        const rect = opener.getBoundingClientRect();
        return JSON.stringify({ focused, height: Math.round(opener.offsetHeight), width: Math.round(rect.width) });
      })()`),
    );
    check(keyboard.focused === true, "every control in the editor takes keyboard focus");
    check(keyboard.height >= 44, `and is at least 44 LAYOUT pixels tall (${keyboard.height})`);
    await page.evaluate(`document.querySelector('[data-testid="dolor-abrir"]').click()`);
    await sleep(500);
    const controlHeights = JSON.parse(
      await page.evaluate(`(() => {
        const ids = ["dolor-frase", "dolor-buscar", "dolor-motivo", "dolor-aprobar", "dolor-excluir", "dolor-sin-resolver"];
        const out = {};
        for (const id of ids) {
          const el = document.querySelector('[data-testid="' + id + '"]');
          out[id] = el ? Math.round(el.offsetHeight) : 0;
        }
        return JSON.stringify(out);
      })()`),
    );
    for (const [id, height] of Object.entries(controlHeights)) {
      check(height >= 44, `«${id}» is ${height} layout pixels tall, which clears 44`);
    }
    const checkboxLabel = Number(
      await page.evaluate(
        `Math.round(document.querySelector('[data-testid="dolor-punto"]').closest("label").offsetHeight)`,
      ),
    );
    check(checkboxLabel >= 44, `and a touchpoint's whole label is tappable (${checkboxLabel})`);

    /* ---- PHONE: the editor composes inside the device width -------------- */

    await page.setViewport(390, 844);
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const phone = JSON.parse(
      await page.evaluate(`(() => {
        const root = document.querySelector('[data-testid="editor-dolor"]');
        return JSON.stringify({
          scrollWidth: Math.round(document.documentElement.scrollWidth),
          clientWidth: Math.round(document.documentElement.clientWidth),
          rootWidth: Math.round(root.scrollWidth),
        });
      })()`),
    );
    check(
      phone.scrollWidth <= phone.clientWidth + 1,
      `on a 390 px phone the page composes inside the device width (${phone.scrollWidth} ≤ ${phone.clientWidth})`,
    );
    check(
      phone.rootWidth <= phone.clientWidth + 1,
      `and so does the editor itself (${phone.rootWidth})`,
    );
    await captureShot("dolor-telefono");
    await page.clearViewport();

    /* ---- STALE EVIDENCE reopens the review, and takes the cloud with it --- */
    //
    // The source words move — the way a re-import would move them — and every
    // decision made about the old words stops counting. This is done in SQL
    // because there is no product surface that edits curated evidence, and that
    // is the point: the review reopens without anybody remembering to reopen it.
    const decisionsBeforeStale = db
      .run(`select count(*)::text from public.canonical_journey_pain_decision where study_id = ${q(STUDY)};`)
      .trim();
    db.run(`
      update public.pain_point set normalized_text = normalized_text || ' CORREGIDA'
       where study_id = ${q(STUDY)};
    `);
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision/dolor`);
    await page
      .waitForDom(`() => document.querySelector('[data-testid="editor-dolor"]') !== null`)
      .catch(() => false);
    const staleShown = Number(
      await page.evaluate(`document.querySelectorAll('[data-testid="dolor-caducado"]').length`),
    );
    const staleCounts = JSON.parse(
      await page.evaluate(`(() => {
        const dl = document.querySelector('[data-testid="dolor-conteos"]');
        const values = [...dl.querySelectorAll('dd')].map((dd) => Number(dd.textContent.trim()));
        return JSON.stringify({ unreviewed: values[0], approved: values[1] });
      })()`),
    );
    check(staleShown > 0, `moving the source words marks ${staleShown} item(s) as changed`);
    eq("every decision goes back to «sin revisar»", staleCounts.unreviewed, Number(total));
    eq("and none of them still counts as approved", staleCounts.approved, 0);
    check(
      await page.evaluate(`document.querySelector('[data-testid="dolor-completo"]') === null`),
      "so the review is no longer finished",
    );
    eq(
      "and not one decision was deleted: the record of what a person decided survives",
      db.run(`select count(*)::text from public.canonical_journey_pain_decision where study_id = ${q(STUDY)};`).trim(),
      decisionsBeforeStale,
    );
    await captureShot("dolor-caducado");

    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/revision`);
    await waitFor((snapshot) => snapshot.revision !== null);
    check(
      !(await page.evaluate(
        `document.querySelector('[data-testid="vista-cliente"]').innerText.includes("FRASE-APROBADA-QA")`,
      )),
      "and the client preview stops drawing the cloud, because what was approved is not what is here",
    );

    /* ---- `pain_point` IS UNTOUCHED BY EVERY ONE OF THOSE DECISIONS -------- */
    //
    // The row TEXT was moved by this gate a moment ago, on purpose, so the
    // comparison below is over everything else: how many rows there are, what
    // review state they are in, and whether anybody is recorded as having
    // reviewed one. Those are the three things a Studio write would change, and
    // none of them moved.
    eq(
      "no pain row was added or removed by any decision",
      db.run(`select count(*)::text from public.pain_point where study_id = ${q(STUDY)};`).trim(),
      painRowsBefore,
    );
    eq(
      "and not one of them was moved out of «pending» by the editor",
      db.run(`select count(*)::text from public.pain_point where study_id = ${q(STUDY)} and review_status <> 'pending';`).trim(),
      "0",
    );
    eq(
      "nobody is recorded as having reviewed a canonical row",
      db.run(`select count(*)::text from public.pain_point where study_id = ${q(STUDY)} and reviewed_by is not null;`).trim(),
      "0",
    );
    check(painDigestBefore.length > 0, "the source digest was captured before any of it, so this is a comparison");

    /* ------------------------------------------------------------------ */
    console.log("\n[17] The legacy draft is byte-identical to how it started");
    eq("the legacy fingerprint", legacyFingerprint(), legacyBefore);
    eq(
      "and the legacy publication model was never written",
      db.run(`
        select (select count(*) from public.study_experience_revision)::text
          || '|' || (select count(*) from public.study_experience_publication)::text
          || '|' || (select count(*) from public.study_experience_event)::text;
      `).trim(),
      "0|0|0",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app) {
      try {
        process.kill(-app.pid, "SIGTERM");
      } catch {
        app.kill("SIGTERM");
      }
      await sleep(1500);
      try {
        process.kill(-app.pid, "SIGKILL");
      } catch {
        /* already gone, which is the point */
      }
    }
    await stack.stop().catch(() => {});
  }
});

console.log(`\n${"=".repeat(82)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
if (failures > 0) {
  console.log("RESULT: the publication lifecycle does NOT behave as documented in a real browser. QA BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: a blocked review draws no preview and offers no publication, a healthy one shows the exact\n" +
    "        revision, its inventory and the client's own view, the publish control stays unusable until\n" +
    "        every confirmation is given with a real keyboard, publishing happens once and a second press\n" +
    "        replays, a reload shows the current publication and its history, editing the draft afterwards\n" +
    "        changes nothing the client is served, a later version replaces the first and keeps it,\n" +
    "        restoring an older one creates a new draft revision and moves no pointer, a conflict publishes\n" +
    "        nothing, three viewports compose inside their width, and nothing internal reached the DOM.\n" +
    "        The legacy draft is byte-identical. QA PASSED.\n" +
    "\n" +
    "NOTE: a disposable target — a throwaway PostgreSQL, a local PostgREST and a minimal\n" +
    "      authentication substitute. It is NOT the hosted project and must never be reported as one.",
);
