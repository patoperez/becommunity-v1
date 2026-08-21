import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const preview = await readFile(new URL("../src/app/admin/preview/[studyId]/page.tsx", import.meta.url), "utf8");
const configurator = await readFile(new URL("../src/app/admin/studies/StudyConfigurator.tsx", import.meta.url), "utf8");

assert.match(preview, /auth\.getUser\(\)/, "preview must verify the session server-side");
assert.match(preview, /profile\?\.role !== "internal"/, "preview must be restricted to internal users");
assert.ok(preview.indexOf('profile?.role !== "internal"') < preview.indexOf("await loadAuthorizedStudyData"), "internal authorization must precede study loading");
assert.match(preview, /\.eq\("tenant_id", study\.tenant_id\)/, "history must be explicitly constrained to the selected tenant");
assert.match(preview, /candidate\.status === "published" \|\| candidate\.id === study\.id/, "preview history must exclude unrelated drafts");
assert.match(preview, /buildStudyDashboard/, "preview must reuse the aggregate dashboard boundary");
assert.doesNotMatch(preview, /rows=\{|qualitative=\{/, "raw rows must not cross into preview Client Components");
assert.match(preview, /<NarrativeHome[\s\S]*<LongitudinalTrends[\s\S]*<StudyCard/, "preview must reuse the client portal components");
assert.match(configurator, /\/admin\/preview\/\$\{study\.id\}/, "each study must expose a preview action");

console.log("P6D client preview gate passed: internal-only, tenant-constrained, aggregated, and portal-component parity.");
