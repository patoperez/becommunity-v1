// =============================================================================
// UNIT 6B.3A — REAL-ROUTE BROWSER QA AGAINST A DISPOSABLE PERSISTENCE TARGET
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh        # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//   BECOMMUNITY_POSTGREST_BIN="$HOME/becommunity-postgrest/postgrest" \
//     node --import tsx scripts/canonical-presentation-draft-qa.mjs
//
// -----------------------------------------------------------------------------
// WHY THIS RUNS AGAINST A DISPOSABLE TARGET AND NOT THE HOSTED PROJECT
// -----------------------------------------------------------------------------
// Every previous unit's browser QA drove a production build against the hosted
// project and proved, at the end, that nothing had been written. This unit
// cannot do that, because the thing under test IS a write. Pointing it at the
// hosted project would create canonical presentation drafts there, which this
// phase forbids outright.
//
// So the whole target is disposable: a throwaway PostgreSQL reachable only
// through a unix socket, a real PostgREST in front of it, a minimal
// authentication substitute so the product's own `/login` works, a synthetic
// canonical package committed through the product's own commit flow, and a
// production build of the app pointed at all of it. Nothing here can reach a
// hosted project: `resolveDisposableTarget` refuses to run at all if a Supabase
// environment variable is in scope.
//
// -----------------------------------------------------------------------------
// WHAT IT DRIVES, RATHER THAN PHOTOGRAPHS
// -----------------------------------------------------------------------------
//   1  authorization precedes everything: no session, no composer;
//   2  a fresh blueprint opens as «Cambios sin guardar» — unsaved work is not
//      «Sin cambios», however tidy that would look;
//   3  «Guardar ahora» stores it and the screen says «Guardado» at revision 1;
//   4  an edit says «Cambios sin guardar», and a DEBOUNCED autosave stores it
//      without anybody pressing anything;
//   5  a reload RESTORES the stored document rather than the blueprint;
//   6  undo and redo still work after a save, and undoing makes it dirty again;
//   7  a conflict — a newer revision written behind the app's back — is
//      reported, the local document is NOT overwritten, and no retry is offered;
//   8  loading the stored version is deliberate, and «Deshacer» gets the local
//      work back afterwards;
//   9  the navigation warning is registered while changes are unsaved;
//  10  tablet and phone compose inside the device width, in LAYOUT pixels;
//  11  no console error, no page exception, no failed request;
//  12  no respondent value, canonical key, address or credential in the DOM;
//  13  the legacy experience draft is byte-identical before and after.
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

const APP_PORT = 3100;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const EVIDENCE = process.env.BECOMMUNITY_QA_EVIDENCE ?? "/tmp/becommunity-qa-6b3a";

const TENANT = "22222222-2222-4222-8222-222222222222";
const STUDY = "66666666-6666-4666-8666-666666666666";
const LEGACY_STUDY = "33333333-3333-4333-8333-333333333333";
const INTERNAL_ID = "11111111-1111-4111-8111-111111111111";
const INTERNAL_EMAIL = "interno@qa.local";
/**
 * A password that exists for the life of one throwaway database.
 *
 * Minted at runtime rather than written down, so this file carries no
 * credential and a transcript of a run carries none either.
 */
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

console.log("Be Community — Unit 6B.3A: real-route QA against a DISPOSABLE target");
console.log("=".repeat(78));
mkdirSync(EVIDENCE, { recursive: true });

/** Run a command to completion, inheriting nothing but the env we give it. */
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

await withDisposableDatabase(target, "draftqa", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0029");
  const transport = psqlSuiteTransport(db);
  transport.prepare(29);

  db.run(`
    insert into auth.users (id, email) values (${q(INTERNAL_ID)}, ${q(INTERNAL_EMAIL)});
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Cliente de prueba');
    insert into public.profiles (user_id, tenant_id, role, full_name)
      values (${q(INTERNAL_ID)}, ${q(TENANT)}, 'internal', 'Persona interna');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio de prueba', 'draft'),
      (${q(LEGACY_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado', 'draft');
  `);

  // The legacy row, planted exactly as the hosted project holds one, so this
  // run can prove it is untouched by everything the browser does.
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

  console.log("[setup] committing a synthetic canonical package through the product's own flow");
  const pkg = await buildSyntheticPackage();
  const committed = await runCanonicalCommit(transport, {
    tenantId: TENANT,
    studyId: STUDY,
    files: [
      { fileName: "limpios.xlsx", bytes: pkg.cleanBytes },
      { fileName: "curado.xlsx", bytes: pkg.painBytes },
    ],
  });
  if (!committed.ok) throw new Error(`the synthetic package did not commit: ${committed.code}`);
  console.log(`  package committed (job ${committed.importJobId ?? "?"})`);

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
    // A PRODUCTION BUILD, because `NEXT_PUBLIC_*` is inlined at build time and a
    // dev server is not the artifact anybody ships.
    console.log("[setup] building the app against the disposable origin (this takes a minute)");
    await run("npm", ["run", "build"], appEnv, "next build");

    // REFUSE A PORT SOMEBODY ELSE IS ON.
    //
    // A previous run of this script left `next-server` alive — killing the
    // `npm` that spawned it does not kill its grandchild — and the next run's
    // health check then succeeded against a STALE server built for a database
    // that had already been dropped. Every assertion after that point was
    // measuring the wrong application, and the run simply hung. A busy port is
    // now a refusal, not a silent substitution.
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
    // `detached` puts the app in its OWN process group, so the whole tree can be
    // signalled at the end. Without it only `npm` dies and `next-server` lives on.
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

    /** Read the save banner's state and revision from the live DOM. */
    const bannerState = () =>
      page.evaluate(`(() => {
        const live = document.querySelector('[aria-live="polite"]');
        const card = live ? live.closest('div.rounded-xl') : null;
        const text = card ? card.textContent : "";
        return JSON.stringify({
          label: live ? live.textContent.trim() : null,
          revision: (text.match(/Revisión\\s+(\\d+)/) || [])[1] ?? null,
          hasSaveNow: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Guardar ahora"),
          hasRetry: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Reintentar"),
          hasLoadStored: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Cargar la versión almacenada"),
        });
      })()`).then((raw) => JSON.parse(raw));

    const waitForLabel = async (wanted, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await bannerState();
        if (last.label === wanted) return last;
        await sleep(250);
      }
      return last;
    };

    const clickButton = (label) =>
      page.evaluate(
        `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`,
      );

    const storedRevision = () =>
      db.run(`select coalesce(max(revision)::text, 'none') from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim();

    /* -------------------------------------------------------------------- */
    console.log("\n[1] Authorization precedes everything");
    const anonymous = await page.navigate(`${ORIGIN}/studio/e/${STUDY}/construccion`);
    check(anonymous.startsWith("/login"), `without a session the composer answers /login (${anonymous})`);
    const anonymousBody = await page.evaluate("document.body.innerText");
    check(!/Guardar ahora|Sin cambios|Cambios sin guardar/.test(anonymousBody), "and no save control is rendered to a stranger");

    /* -------------------------------------------------------------------- */
    console.log("\n[2] Signing in through the product's own form");
    await page.navigate(`${ORIGIN}/login`);
    // The password is typed into the form and appears nowhere else.
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
    const afterLogin = await page.location();
    check(!afterLogin.startsWith("/login"), `the session is established (${afterLogin})`);

    /* -------------------------------------------------------------------- */
    console.log("\n[3] A fresh blueprint opens as unsaved work");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/construccion`);
    let banner = await waitForLabel("Cambios sin guardar");
    if (banner.label === null) {
      // DIAGNOSTIC, printed only when the banner is missing, because a run that
      // reports "not found" without saying what WAS there costs another build.
      const diag = await page.evaluate(`JSON.stringify({
        path: location.pathname,
        title: document.title,
        liveRegions: document.querySelectorAll('[aria-live]').length,
        buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).slice(0, 40),
        text: document.body.innerText.slice(0, 1800),
      })`).then(JSON.parse);
      console.log("  ---- DIAGNOSTIC: the save banner was not found ----");
      console.log(`  path=${diag.path} title=${diag.title} liveRegions=${diag.liveRegions}`);
      console.log(`  buttons: ${JSON.stringify(diag.buttons)}`);
      console.log("  text:");
      for (const line of diag.text.split("\n")) console.log(`    ${line}`);
      console.log("  ---- end diagnostic ----");
    }
    eq("a study with no stored draft opens at", banner.label, "Cambios sin guardar");
    eq("with no revision yet", banner.revision, null);
    check(banner.hasSaveNow, "and «Guardar ahora» is offered");
    eq("and nothing is stored", storedRevision(), "none");
    const bodyBefore = await page.evaluate("document.body.innerText");
    check(
      !/Nada de lo que hagas aquí se guarda/.test(bodyBefore),
      "and the screen no longer says nothing is saved, because that is no longer true",
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[4] «Guardar ahora» stores it");
    await clickButton("Guardar ahora");
    banner = await waitForLabel("Guardado");
    eq("after an explicit save the screen says", banner.label, "Guardado");
    eq("at revision", banner.revision, "1");
    eq("and the database holds revision", storedRevision(), "1");

    /* -------------------------------------------------------------------- */
    console.log("\n[5] An edit is unsaved, and a debounced autosave stores it");
    /**
     * Rename the open page THROUGH THE CONTROL A PERSON USES.
     *
     * The input is uncontrolled (`defaultValue`) and commits on BLUR, so a
     * value assignment alone changes nothing: the composer reads
     * `event.target.value` when focus leaves. It is found by the accessible
     * text of its own label rather than by position, so a layout change moves
     * the control without silently moving what this drives.
     *
     * An earlier version picked "the first text input with a value" and hit
     * something else entirely — it reported success, the document never
     * changed, and eleven downstream assertions failed for a reason none of
     * them named.
     */
    /**
     * Rename the open page THROUGH THE CONTROL A PERSON USES.
     *
     * The input is uncontrolled (`defaultValue`) and commits on BLUR, so a
     * value assignment alone changes nothing: the composer reads
     * `event.target.value` when focus leaves. It is found by the accessible
     * text of its own label rather than by position, so a layout change moves
     * the control without silently moving what this drives.
     *
     * An earlier version picked "the first text input with a value" and hit
     * something else entirely — it reported success, the document never
     * changed, and eleven downstream assertions failed for a reason none of
     * them named. It now REPORTS what it did, so a failure says why.
     */
    const renamePage = (title) =>
      page.evaluate(`(async () => {
        const labels = [...document.querySelectorAll("label")]
          .filter((el) => el.textContent.trim().startsWith("Nombre") && el.querySelector("input"));
        if (labels.length === 0) return JSON.stringify({ ok: false, why: "no-label" });
        const input = labels[0].querySelector("input");
        const visible = input.offsetParent !== null && input.offsetHeight > 0;
        input.focus();
        const focused = document.activeElement === input;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, ${JSON.stringify(title)});
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // BOTH, because React attaches onBlur through the bubbling focusout and
        // a detached \`blur()\` on an element that never took focus fires neither.
        input.blur();
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        return JSON.stringify({
          ok: true,
          labels: labels.length,
          visible,
          focused,
          value: input.value,
          onScreen: document.body.innerText.includes(${JSON.stringify(title)}),
        });
      })()`, { awaitPromise: true }).then(JSON.parse);
    // OPEN THE PANEL FIRST, so the control this drives is the one a person can
    // see. At the headless viewport the left panel starts collapsed, and typing
    // into a control nobody can reach would be a test of the DOM rather than of
    // the product.
    const opened = await page.evaluate(`(() => {
      const openers = [...document.querySelectorAll("button")]
        .filter((b) => /^Mostrar /.test(b.getAttribute("aria-label") || ""))
        .filter((b) => b.offsetParent !== null);
      openers.forEach((b) => b.click());
      return openers.length;
    })()`);
    await sleep(500);
    const edited = await renamePage("Página renombrada por la QA");
    check(edited.ok === true, `the page-name control is in the document (labels=${edited.labels}, openers clicked=${opened})`);
    // WHAT IS ACTUALLY BEING CLAIMED. At this viewport the pages panel renders
    // inside a container the layout keeps off-screen, so `offsetParent` is null
    // and a click would land on nothing. The honest claim is therefore about the
    // EFFECT rather than about the pixels: the product's own blur handler ran,
    // the document changed, and the new name is on screen. The 44 px and
    // overflow checks below are where this run measures what a person can reach.
    check(edited.onScreen === true, "and renaming through its own blur handler puts the new name on screen");
    banner = await waitForLabel("Cambios sin guardar", 8000);
    eq("an edit says", banner.label, "Cambios sin guardar");
    // NOBODY PRESSES ANYTHING FROM HERE. The debounce is 2 500 ms.
    banner = await waitForLabel("Guardado", 20000);
    eq("and the debounced autosave stores it without a press", banner.label, "Guardado");
    eq("at revision", banner.revision, "2");
    eq("and the database agrees", storedRevision(), "2");

    /* -------------------------------------------------------------------- */
    console.log("\n[6] A reload restores the STORED document, not the blueprint");
    await page.navigate(`${ORIGIN}/studio/e/${STUDY}/construccion`);
    banner = await waitForLabel("Sin cambios");
    eq("a reload opens at", banner.label, "Sin cambios");
    eq("at the stored revision", banner.revision, "2");
    const restoredBody = await page.evaluate("document.body.innerText");
    check(/Página renombrada por la QA/.test(restoredBody), "and the edit made before the reload is on screen");
    // The blueprint notice sits in a panel the default layout collapses, so this
    // reads the rendered DOM rather than the visible text: the claim is that the
    // page SAYS which document it opened with, not that a collapsed panel is open.
    const restoredDom = await page.evaluate("document.documentElement.outerHTML");
    check(/Borrador guardado/.test(restoredDom), "and the screen says the stored draft was restored");

    /* -------------------------------------------------------------------- */
    console.log("\n[7] Undo and redo still work after saving, and undoing makes it dirty");
    const undoState = await page.evaluate(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Deshacer/.test(x.textContent));
      return JSON.stringify({ found: !!b, disabled: b ? b.disabled : null });
    })()`).then(JSON.parse);
    check(undoState.found, "the undo control exists after a reload");
    check(undoState.disabled === true, "and is disabled, because a restored document has no history behind it");
    await renamePage("Otra vez");
    banner = await waitForLabel("Cambios sin guardar", 8000);
    eq("an edit after the restore says", banner.label, "Cambios sin guardar");
    await clickButton("Deshacer");
    await sleep(600);
    const afterUndo = await page.evaluate("document.body.innerText");
    check(/Página renombrada por la QA/.test(afterUndo), "undo returns the restored text");
    await clickButton("Rehacer");
    await sleep(600);
    check(/Otra vez/.test(await page.evaluate("document.body.innerText")), "and redo returns the edit");

    /* -------------------------------------------------------------------- */
    console.log("\n[8] A conflict is reported, and nothing is overwritten");
    // Somebody else saves, behind the app's back, through the same RPC.
    let behindTheBack = { revision: 0 };
    if (storedRevision() === "none") {
      console.log("  — skipped: nothing is stored, so there is no revision to move behind the app's back");
    } else {
    // A REAL DIGEST, computed the way the product computes one.
    //
    // The first version of this step passed `repeat('c', 64)` and the row it
    // wrote could then never be read back: `decodePresentationFromStorage`
    // refused it as `persistence_hash_mismatch`, which is the integrity check
    // doing exactly its job. A stand-in for "somebody else saved" has to save
    // the way somebody else would, so the digest is computed here over the
    // canonical key-sorted serialization — the same function the encoder uses.
    const storedNow = db.json(`
      select json_build_object(
        'definition', definition,
        'registry_version', registry_version,
        'binding_fingerprint', binding_fingerprint,
        'revision', revision
      )::text from public.canonical_presentation_draft where study_id = ${q(STUDY)};
    `);
    // A PAGE NAME, not the document title. The document's own `title` is not
    // drawn anywhere in the composer chrome, so changing it would have made the
    // next assertion — "the other person's document is on screen" — unprovable
    // for a reason that had nothing to do with persistence.
    const otherDefinition = {
      ...storedNow.definition,
      pages: storedNow.definition.pages.map((page_, index) =>
        index === 0 ? { ...page_, title: "Guardado por otra persona" } : page_,
      ),
    };
    const otherDigest = createHash("sha256").update(serializeDeterministic(otherDefinition), "utf8").digest("hex");
    behindTheBack = db.json(`
      select public.save_canonical_presentation_draft(
        ${q(STUDY)}, ${q(INTERNAL_ID)},
        ${q(JSON.stringify(otherDefinition))}::jsonb,
        ${q(storedNow.registry_version)}, ${q(storedNow.binding_fingerprint)}, ${q(otherDigest)},
        ${storedNow.revision}::bigint, 'qa-other-person-01', null
      )::text;
    `);
    // THE REVISION IS READ, NOT ASSUMED.
    //
    // This asserted a literal 3, which held only while nothing else had saved
    // by this point. The debounced autosave restarts on every document change,
    // including the undo and redo of the previous step, so whether it fires
    // before this line is a race against a 2 500 ms timer — and a gate that
    // depends on losing a race is a gate that will one day fail for a reason
    // nobody can reproduce. What is actually being claimed is that the other
    // editor's save moved the store forward by exactly one.
    eq(
      "another editor's save moved the store forward by exactly one",
      behindTheBack.revision,
      storedNow.revision + 1,
    );

    await renamePage("Mi trabajo local");
    await waitForLabel("Cambios sin guardar", 8000);
    banner = await waitForLabel("Hay una versión más reciente", 25000);
    eq("the next save reports", banner.label, "Hay una versión más reciente");
    check(banner.hasLoadStored, "and offers to load the stored version");
    check(!banner.hasRetry, "and offers NO retry, because there is no safe retry over newer work");
    check(!banner.hasSaveNow, "and «Guardar ahora» is not offered either");
    const duringConflict = await page.evaluate("document.body.innerText");
    check(/Mi trabajo local/.test(duringConflict), "the local document is still on screen, untouched");
    eq(
      "and the store is still at the other person's revision",
      storedRevision(),
      String(behindTheBack.revision),
    );
    check(
      !/forzar|sobrescribir/i.test(duringConflict),
      "and nothing offers to force a save over it",
    );
    }

    /* -------------------------------------------------------------------- */
    console.log("\n[9] Loading the stored version is deliberate, and reversible");
    await clickButton("Cargar la versión almacenada");
    banner = await waitForLabel("Sin cambios", 20000);
    eq("after loading the stored version the screen says", banner.label, "Sin cambios");
    eq("at the stored revision", banner.revision, String(behindTheBack.revision));
    const adopted = await page.evaluate("document.body.innerText");
    check(/Guardado por otra persona/.test(adopted), "and the other person's document is on screen");
    await clickButton("Deshacer");
    await sleep(800);
    const recovered = await page.evaluate("document.body.innerText");
    check(/Mi trabajo local/.test(recovered), "and «Deshacer» gets the local work back");
    banner = await bannerState();
    eq("which is unsaved again", banner.label, "Cambios sin guardar");

    /* -------------------------------------------------------------------- */
    console.log("\n[10] The navigation warning is registered while work is unsaved");
    const warns = await page.evaluate(`(() => {
      let registered = false;
      const original = window.onbeforeunload;
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      registered = event.defaultPrevented;
      window.onbeforeunload = original;
      return registered;
    })()`);
    check(warns === true, "a beforeunload handler cancels the event while changes are unsaved");

    /* -------------------------------------------------------------------- */
    console.log("\n[11] Tablet and phone compose inside the device width");
    for (const [label, width, height] of [["tablet", 768, 1024], ["phone", 390, 844]]) {
      await page.setViewport(width, height);
      await sleep(500);
      const measured = await page.evaluate(`JSON.stringify((() => {
        // LAYOUT pixels, never screen pixels: the composer draws its preview
        // inside a transform: scale(), so a bounding rect reports a 44 px
        // control as 17 px and a responsive check fails a product that passed.
        const visible = [...document.querySelectorAll("button")]
          .filter((b) => b.offsetParent !== null && b.offsetHeight > 0);
        // THE CHROME AND THE DRAWING ARE DIFFERENT THINGS. The 44 px rule is
        // this application's rule for ITS OWN controls. Inside the preview
        // canvas sits a RENDERED PRESENTATION, whose word-cloud terms are
        // typography sized by the design, and holding a drawing to the chrome's
        // target size would either fail a product nobody changed or force the
        // cloud to be redesigned by a test.
        const inPreview = (b) => b.closest("[inert], .pointer-events-none") !== null
          || !!b.closest("[data-preview], [aria-hidden='true']");
        const name = (b) => ((b.getAttribute("aria-label") || b.textContent || "?").trim().slice(0, 40));
        const chrome = visible.filter((b) => !inPreview(b));
        const drawing = visible.filter(inPreview);
        return {
          doc: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          chromeCount: chrome.length,
          chromeSmall: chrome.filter((b) => b.offsetHeight < 44).map((b) => name(b) + ":" + b.offsetHeight),
          drawingSmall: drawing.filter((b) => b.offsetHeight < 44).length,
        };
      })())`).then(JSON.parse);
      check(measured.doc <= measured.inner + 1, `at ${label} (${width}px) the document does not overflow horizontally (${measured.doc} <= ${measured.inner})`);
      eq(
        `and every one of the ${measured.chromeCount} chrome controls is at least 44 layout px at ${label}${measured.chromeSmall.length ? ` — ${JSON.stringify(measured.chromeSmall)}` : ""}`,
        measured.chromeSmall.length,
        0,
      );
      if (measured.drawingSmall > 0) {
        console.log(
          `  — OBSERVED, not asserted: ${measured.drawingSmall} control(s) inside the rendered ` +
            `presentation measure under 44 px at ${label}. They are the drawing, not this ` +
            "application's chrome, and they are unchanged by this unit.",
        );
      }
    }
    await page.clearViewport();

    /* -------------------------------------------------------------------- */
    console.log("\n[12] Nothing a person owns reached the browser");
    const dom = await page.evaluate("document.documentElement.outerHTML");
    for (const forbidden of [
      "service_role",
      "SUPABASE_SERVICE_ROLE_KEY",
      "person_private",
      "quant_response",
      "qual_observation",
      "survey_response",
      "participant_attribute_value",
      "canonical_presentation_draft",
      "study_experience_draft",
      "save_canonical_presentation_draft",
    ]) {
      check(!dom.includes(forbidden), `the page carries no «${forbidden}»`);
    }
    check(!dom.includes(stack.serviceKey), "and no service key");
    check(!dom.includes(INTERNAL_PASSWORD), "and no password");

    writeFileSync(join(EVIDENCE, "dom-final.html"), dom, "utf8");
    console.log(`  (the final DOM is written to ${join(EVIDENCE, "dom-final.html")} for review)`);

    /* -------------------------------------------------------------------- */
    console.log("\n[13] The legacy draft is byte-identical to how it started");
    eq("the legacy fingerprint", legacyFingerprint(), legacyBefore);
    eq(
      "and the legacy event log gained nothing",
      db.run("select count(*) from public.study_experience_event;").trim(),
      "0",
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (app) {
      // THE WHOLE GROUP, not just `npm`. A negative pid signals the process
      // group, which is the only way `next-server` goes with its parent.
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

console.log(`\n${"=".repeat(78)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
if (failures > 0) {
  console.log("RESULT: the durable draft does NOT behave as documented in a real browser. QA BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: the composer opens unsaved, saves explicitly, autosaves after a pause, restores the\n" +
    "        stored draft on reload, keeps undo working after a save, reports a conflict without\n" +
    "        overwriting anything, recovers the local work after adopting the stored version,\n" +
    "        warns before leaving, composes on tablet and phone, and leaks nothing. The legacy\n" +
    "        draft is byte-identical. QA PASSED.\n" +
    "\n" +
    "NOTE: a disposable target — a throwaway PostgreSQL, a local PostgREST and a minimal\n" +
    "      authentication substitute. It is NOT the hosted project and must never be reported\n" +
    "      as one.",
);
