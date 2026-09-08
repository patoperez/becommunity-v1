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
  console.log("\n[setup] bootstrap + migrations 0000-0030");
  const transport = psqlSuiteTransport(db);
  transport.prepare(30);

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

  console.log("[setup] committing a synthetic canonical package for two studies");
  const pkg = await buildSyntheticPackage();
  for (const study of [STUDY, DRIFT_STUDY]) {
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
    for (const entry of state.acknowledgements) await clickTestId(entry.id);
    await clickTestId("confirmacion-final");
    await sleep(200);
    state = await reviewState();
    eq("the publish control is usable again", state.publishDisabled, false);
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

    for (const entry of state.acknowledgements) await clickTestId(entry.id);
    await clickTestId("confirmacion-final");
    await sleep(200);
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
        const visible = [...document.querySelectorAll("button, input[type='checkbox'], input[type='text'], a[href]")]
          .filter((el) => el.offsetParent !== null && el.offsetHeight > 0);
        // THE CHROME AND THE DRAWING ARE DIFFERENT THINGS. The 44 px rule is this
        // application's rule for ITS OWN controls; the client preview contains a
        // RENDERED PRESENTATION whose typography is sized by the design.
        const inPreview = (el) => el.closest('[data-testid="vista-cliente"]') !== null;
        const name = (el) => ((el.getAttribute("aria-label") || el.getAttribute("data-testid") || el.textContent || "?").trim().slice(0, 40));
        const chrome = visible.filter((el) => !inPreview(el));
        return {
          doc: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          chromeCount: chrome.length,
          chromeSmall: chrome.filter((el) => el.offsetHeight < 44).map((el) => name(el) + ":" + el.offsetHeight),
          drawingSmall: visible.filter(inPreview).filter((el) => el.offsetHeight < 44).length,
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
    check(!dom.includes(TENANT), "and no tenant identifier");
    // A 64-hex digest anywhere in the DOM would be a binding or a definition
    // hash, and neither belongs in a browser.
    check(!/[0-9a-f]{64}/.test(dom), "and no 64-character digest of any kind");

    writeFileSync(join(EVIDENCE, "dom-final.html"), dom, "utf8");
    console.log(`  (the final DOM is written to ${join(EVIDENCE, "dom-final.html")} for review)`);

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
