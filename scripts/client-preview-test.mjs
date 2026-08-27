import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The internal client preview.
 *
 * P8.2 gave the preview a second address inside the study it belongs to
 * (`/studio/e/[studyId]/vista-cliente`) and moved the rendering into ONE shared
 * component, so the two addresses cannot show a client two different things.
 * This gate therefore proves three things instead of one:
 *
 *   1. the shared view keeps every data boundary it had — tenant-constrained
 *      history, aggregate DTOs only, the same client portal components;
 *   2. BOTH routes authorize an internal role BEFORE loading the study;
 *   3. publication is reachable from the preview, and the study configurator
 *      still leads to it.
 */

const view = await readFile(new URL("../src/components/studio/ClientPreviewView.tsx", import.meta.url), "utf8");
const legacyRoute = await readFile(new URL("../src/app/admin/preview/[studyId]/page.tsx", import.meta.url), "utf8");
const studioRoute = await readFile(new URL("../src/app/studio/e/[studyId]/vista-cliente/page.tsx", import.meta.url), "utf8");
/** Comments removed: a header explaining a rule must not satisfy — or fail — an
 *  assertion about the code that implements it. */
const codeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const studioGuard = codeOf(
  await readFile(new URL("../src/lib/studio/guard.ts", import.meta.url), "utf8"),
);
const configurator = await readFile(new URL("../src/app/admin/studies/StudyConfigurator.tsx", import.meta.url), "utf8");
const studiesPage = await readFile(new URL("../src/app/admin/studies/page.tsx", import.meta.url), "utf8");

// --- 1. the shared view's data boundaries ----------------------------------
assert.match(view, /\.eq\("tenant_id", study\.tenant_id\)/, "history must be explicitly constrained to the selected tenant");
assert.match(view, /candidate\.status === "published" \|\| candidate\.id === study\.id/, "preview history must exclude unrelated drafts");
assert.match(view, /buildStudyDashboard/, "preview must reuse the aggregate dashboard boundary");
assert.doesNotMatch(view, /rows=\{|qualitative=\{/, "raw rows must not cross into preview Client Components");
assert.match(view, /<NarrativeHome[\s\S]*<LongitudinalTrends[\s\S]*<StudyCard/, "preview must reuse the client portal components");
assert.match(view, /audience="preview"/, "the preview keeps the internal readiness notices the client never sees");

// --- 2. both routes authorize before loading -------------------------------
assert.match(legacyRoute, /auth\.getUser\(\)/, "the legacy preview must verify the session server-side");
assert.match(legacyRoute, /profile\?\.role !== "internal"/, "the legacy preview must be restricted to internal users");
assert.ok(
  legacyRoute.indexOf('profile?.role !== "internal"') < legacyRoute.indexOf("<ClientPreviewView"),
  "internal authorization must precede study loading",
);
assert.match(studioRoute, /await requireInternal\(\)/, "the Studio preview must run the internal gate");
assert.ok(
  studioRoute.indexOf("await requireInternal()") < studioRoute.indexOf("<ClientPreviewView"),
  "internal authorization must precede study loading",
);
assert.match(studioGuard, /auth\.getUser\(\)/, "the Studio gate must verify the session with getUser");
assert.doesNotMatch(studioGuard, /getSession\(/, "the Studio gate must never decide authorization from getSession");
assert.match(studioGuard, /profile\?\.role !== "internal"/, "the Studio gate must read the role from the database");
assert.ok(
  studioGuard.indexOf('profile?.role !== "internal"') < studioGuard.indexOf("createAdminClient()"),
  "the privileged client must be created only after the role check",
);

// --- 3. publication is reached THROUGH the preview -------------------------
for (const [name, source] of [["legacy", legacyRoute], ["studio", studioRoute]]) {
  assert.match(source, /studioStudyPublish\(studyId\)/, `the ${name} preview must lead to the publication decision`);
}
assert.match(configurator, /previewHref/, "each study must expose a preview action");
assert.match(studiesPage, /\/admin\/preview\/\$\{study\.id\}/, "the study list must keep its preview link");

console.log("P6D client preview gate passed: internal-only, tenant-constrained, aggregated, portal-component parity, and one implementation behind two addresses.");
