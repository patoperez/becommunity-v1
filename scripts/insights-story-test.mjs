import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let checks = 0;
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function has(source, pattern, message) { assert.match(source, pattern, message); checks += 1; }
function lacks(source, pattern, message) { assert.doesNotMatch(source, pattern, message); checks += 1; }

const [home, detail, filters, card, trends, pivot, narrative, findings, pdf, pkg] = await Promise.all([
  read("src/app/insights/page.tsx"), read("src/app/insights/e/[studyId]/page.tsx"),
  read("src/lib/insights/filters.ts"), read("src/app/dashboard/StudyCard.tsx"),
  read("src/app/dashboard/LongitudinalTrends.tsx"), read("src/app/dashboard/PivotExplorer.tsx"),
  read("src/app/dashboard/NarrativeHome.tsx"), read("src/app/dashboard/PanoramaFindings.tsx"),
  read("src/lib/reporting/pdf.ts"), read("package.json"),
]);

has(home, /dashboard\/page/, "Insights home reuses the authorized dashboard composition");
has(detail, /z\.string\(\)\.uuid/, "detail rejects malformed study ids");
has(detail, /auth\.getUser\(\)/, "detail authenticates with getUser");
has(detail, /profile\.role === "internal"/, "internal users are sent to Studio preview");
has(detail, /loadAuthorizedStudyData\(supabase, studyId\)/, "detail uses the RLS-authorized loader");
has(detail, /\.eq\("tenant_id", study\.tenant_id\)[\s\S]*\.eq\("status", "published"\)/, "history is tenant and publication bounded");
has(filters, /parseReportFilters\(query\)/, "screen delegates to the report filter grammar");
has(filters, /query\.set\(`f\.\$\{key\}`/, "canonical links use the report f.* grammar");
has(card, /filterQuery\(filters\)/, "screen and report derive from one filter state");
has(card, /window\.history\.replaceState/, "filter state is reflected in the URL");
has(trends, /selected\.points\.length < 4 \? <TrendList/, "short histories use a trend list");
has(trends, /<TrendChart series=\{selected\}/, "long histories use a chart");
has(trends, /Ver los periodos en una tabla/, "trend has a table alternative");
has(trends, /tabIndex=\{0\}/, "chart points are keyboard reachable");
lacks(trends, /`n=/, "trend never exposes technical n= copy");
has(pivot, /computeStudyPivot\(studyId, filters, intent\)/, "comparison preserves the server computation contract");
has(pivot, /validatePivotIntent\(intent, allowlist\)/, "comparison preserves the allowlist");
has(pivot, /Compara por\.\.\./, "comparison uses plain-language framing");
has(pivot, /Intentar de nuevo/, "comparison failure has a recovery action");
has(pivot, /sampleCopy\("suppressed", null\)/, "comparison uses canonical privacy copy");
has(findings, /interpretation: string \| null/, "finding contract includes a human interpretation slot");
has(narrative, /interpretation: null/, "missing interpretation remains silent for clients");
has(pdf, /import \{ sampleCopy \}/, "PDF uses the canonical sample vocabulary");
lacks(pdf, /Base pequena|Muestra insuficiente|Base distinta n=/, "retired sample phrases are absent from PDF source");
has(pkg, /test:insights-story/, "the focused gate is registered");

console.log(`insights-story: PASS (${checks} checks)`);
