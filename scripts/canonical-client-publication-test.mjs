// =============================================================================
// Unit 6B.4B2I — THE CLIENT'S PUBLISHED READ PATH, as an OFFLINE contract
// =============================================================================
//   npm run test:canonical-client-publication
//
// -----------------------------------------------------------------------------
// WHAT THIS GATE IS, AND WHAT IT IS NOT
// -----------------------------------------------------------------------------
// Its companion `test:canonical-client-publication-live` makes a real
// publication in a real PostgreSQL and reads it back as a real client. Every
// guarantee there is a property of a database executing a migration, and the
// only way to know is to make it happen.
//
// This one is the half that needs no database: the SHAPE of the contract, the
// closed vocabularies, the projection the SQL itself defines, and the three
// structural claims the route rests on — that the client reader cannot read the
// editable draft, that the reading surface calculates nothing, and that the
// unreadable branch never falls back to the legacy engine.
//
// It runs offline so it can run on every commit, and so a change that quietly
// widens the client's surface is refused before anybody has to remember to
// start a database.
// =============================================================================

import { readFileSync } from "node:fs";

import {
  PUBLISHED_READ_DETAIL,
  PUBLISHED_SELECTION_DETAIL,
} from "../src/lib/publication/client-read.ts";

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

const read = (path) => readFileSync(path, "utf8");
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const READER = "src/lib/studies/published-presentation.ts";
const CONTRACT = "src/lib/publication/client-read.ts";
const ACTION = "src/app/insights/e/[studyId]/actions.ts";
const PAGE = "src/app/insights/e/[studyId]/page.tsx";
const VIEW = "src/components/insights/PublishedStudyView.tsx";
const MIGRATION = "supabase/migrations/0030_canonical_publication.sql";

console.log("Be Community — Unit 6B.4B2I: the client's published read path, offline");
console.log("=".repeat(82));

/* -------------------------------------------------------------------------- */
console.log("\n[1] The closed vocabularies, and a sentence for every member");

const READ_REFUSALS = ["publication_read_refused", "publication_malformed"];
const SELECTION_REFUSALS = [
  "study_moved_since_publication",
  "selection_not_available",
  "recomputation_refused",
];
eq("the read refusals are exactly two", Object.keys(PUBLISHED_READ_DETAIL).sort().join(","), READ_REFUSALS.slice().sort().join(","));
eq(
  "the selection refusals are exactly three",
  Object.keys(PUBLISHED_SELECTION_DETAIL).sort().join(","),
  SELECTION_REFUSALS.slice().sort().join(","),
);
for (const [code, sentence] of Object.entries({ ...PUBLISHED_READ_DETAIL, ...PUBLISHED_SELECTION_DETAIL })) {
  // A SENTENCE FOR A PERSON, never a code. These strings are the only thing a
  // client ever sees when something is wrong, and a reader handed
  // `study_moved_since_publication` has been told nothing.
  check(sentence.length >= 40, `«${code}» has a real sentence (${sentence.length} characters)`);
  check(!sentence.includes("_"), `and «${code}» does not leak its own code into it`);
  check(!/\b(sha256|uuid|tenant|binding|digest|rpc|null)\b/i.test(sentence), `and «${code}» names nothing internal`);
}
// THE DRIFT SENTENCE MUST SAY THE STUDY IS STILL COMPLETE. It is the one
// refusal a reader meets while looking at real figures, and «no pudimos» alone
// would read as «these numbers are broken».
check(
  /estudio completo/i.test(PUBLISHED_SELECTION_DETAIL.study_moved_since_publication),
  "and the drift sentence tells the reader they are still seeing the whole study",
);

/* -------------------------------------------------------------------------- */
console.log("\n[2] The contract file is PURE, so a browser bundle may hold it");

{
  const source = read(CONTRACT);
  check(!/^import ["']server-only["']/m.test(source), "the contract is not server-only");
  check(!/@supabase|createClient|\.from\(|\.rpc\(/.test(stripComments(source)), "and it reaches no transport");
  // It may name the render model's TYPE and nothing else from the server half.
  const imports = [...stripComments(source).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  eq("and it imports exactly one thing", imports.length, 1);
  eq("which is the client-safe presentation barrel", imports[0], "@/lib/presentation");
}

/* -------------------------------------------------------------------------- */
console.log("\n[3] The reader cannot reach the editable draft, and says so in its own text");

{
  const source = stripComments(read(READER));
  check(source.startsWith('import "server-only";'), "the reader is server-only, on its first line");
  check(!source.includes("canonical_presentation_draft"), "it never names the draft table");
  check(!source.includes("save_canonical_presentation_draft"), "nor the draft's save function");
  check(!source.includes("publish_canonical_presentation"), "nor any publish function");
  check(!source.includes("restore_canonical_presentation"), "nor the restore function");
  check(
    !source.includes("publication-workspace"),
    "and it takes no import from the module that can publish",
  );

  // THE ONLY TWO TABLES, BY NAME.
  const tables = [...source.matchAll(/\.from\((\w+)\)/g)].map((m) => m[1]);
  eq(
    "the only tables it reads are the pointer and the immutable snapshot, plus the study row it authorizes with",
    [...new Set(tables)].sort().join(","),
    "POINTER_TABLE,REVISION_TABLE",
  );
  check(/\.from\("study"\)/.test(source), "and the study row, read with the reader's OWN session");

  // THE ONE RPC, AND IT IS A READ.
  const rpcs = [...source.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  eq("it calls exactly one RPC", [...new Set(rpcs)].join(","), "read_canonical_publication");
  for (const writer of [".insert(", ".update(", ".upsert(", ".delete(", "revalidatePath"]) {
    check(!source.includes(writer), `and it never performs ${writer}`);
  }

  // NAMED COLUMNS, NEVER A STAR. A `select("*")` on the revision table would put
  // the definition, both digests and the publisher's user id one spread away
  // from a prop.
  check(!/\.select\(\s*["']\*/.test(source), "no read selects a star");

  // EVERY PUBLICATION READ IS SCOPED BY BOTH TENANT AND STUDY.
  const pointerReads = source.split(".from(POINTER_TABLE)").length - 1;
  const revisionReads = source.split(".from(REVISION_TABLE)").length - 1;
  check(pointerReads >= 2 && revisionReads >= 1, `it reads the pointer ${pointerReads}× and the snapshot ${revisionReads}×`);
  eq(
    "and every one of those reads is scoped by study AND tenant",
    (source.match(/\.eq\("study_id", scope\.studyId\)/g) ?? []).length,
    (source.match(/\.eq\("tenant_id", scope\.tenantId\)/g) ?? []).length,
  );

  // THE TENANT IS NEVER AN ARGUMENT FROM OUTSIDE.
  check(
    /authorizeStudy\(requestClient, studyId\)/.test(source),
    "both entry points authorize through the request-scoped client first",
  );
  check(
    // `createAdminClient(` — since Unit 6B.4B2P it takes `{ bounded: true }`.
    source.indexOf("authorizeStudy(requestClient") < source.indexOf("createAdminClient("),
    "and the privileged client is constructed only after that has succeeded",
  );
  check(
    /tenantId: study\.tenant_id/.test(source),
    "the tenant comes from the authorized row, never from a parameter",
  );

  // THE REPRODUCTION CHECK IS THE ONE THAT GATES FILTERING.
  check(
    /renderModelDigest\(neutral\.model\) !== row\.render_model_sha256/.test(source),
    "filtering is gated on reproducing the published render model digest exactly",
  );
  check(
    /model: published\.renderModel/.test(source),
    "and what is SERVED is always the stored snapshot, never the recomputation",
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[4] The page branches three ways, and the failure branch does not fall back");

{
  const source = read(PAGE);
  check(/const published = await loadPublishedClientExperience\(supabase, studyId\)/.test(source),
    "the page asks for the canonical publication");
  // CALL SITES, NOT OCCURRENCES. The import block names both loaders and its
  // order is alphabetical, so comparing bare occurrences compared two `import`
  // lines and said the page loaded legacy rows first — which it does not.
  check(
    source.indexOf("await loadPublishedClientExperience(") < source.indexOf("await loadAuthorizedStudyData("),
    "before it loads a single legacy row",
  );
  check(
    /published\.state !== "not_published"/.test(source),
    "and it leaves the legacy path ONLY when there is no canonical publication",
  );
  // THE LEGACY BRANCH IS UNCHANGED, and the dependency gate asserts the same
  // line for its own reasons. Asserted here too because the two gates protect
  // different things: that one protects the shadow boundary, this one protects
  // the documented fallback.
  check(
    /const \{ legacy: dashboard \} = await loadStudyDashboard\(/.test(source),
    "the legacy fallback is the same call it always was",
  );
  check(
    /PUBLISHED_READ_DETAIL\[published\.reason\]/.test(source),
    "an unreadable publication is explained with its own sentence",
  );
  // AND THE UNREADABLE BRANCH IS INSIDE THE CANONICAL RETURN, so it cannot
  // reach the legacy body. Proved positionally: the canonical `return (` closes
  // before `loadAuthorizedStudyData` is ever called.
  check(
    source.indexOf("PUBLISHED_READ_DETAIL") < source.indexOf("loadAuthorizedStudyData"),
    "and it returns before the legacy engine is consulted",
  );
  check(
    !/loadStudyDashboard[\s\S]{0,400}PUBLISHED_READ_DETAIL/.test(source),
    "there is no path on which an unreadable publication is answered with legacy figures",
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[5] The action accepts a study id and a string, and nothing else");

{
  const source = stripComments(read(ACTION));
  check(/^"use server";/m.test(source), "it is a Server Action");
  check(
    /previewPublishedStudyUnderSelection\(\s*studyId: string,\s*viewerJson: string,\s*\)/.test(source),
    "with exactly two parameters: a study id and a JSON string",
  );
  check(/STUDY_ID\.safeParse\(studyId\)/.test(source), "the study id is validated as a uuid");
  check(/viewerJson\.length > MAX_SELECTION_BYTES/.test(source), "the selection is capped before it is parsed");
  check(/JSON\.parse\(viewerJson\)[\s\S]{0,80}catch/.test(source), "and parsed inside a try/catch");
  check(/auth\.getUser\(\)/.test(source), "it revalidates the session with getUser()");
  check(!/getSession\(/.test(source), "and never with getSession()");
  for (const writer of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath"]) {
    check(!source.includes(writer), `and it never performs ${writer}`);
  }
  // NO DOCUMENT, NO TENANT, NO IDENTITY has anywhere to arrive.
  for (const smuggled of ["definition", "tenantId", "binding", "renderModel", "sha256"]) {
    check(!source.includes(smuggled), `«${smuggled}» is not a name this action can receive`);
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n[6] The reading surface draws and calculates nothing");

{
  const source = read(VIEW);
  const code = stripComments(source);
  check(/^"use client";/m.test(source), "it is a client component");
  check(
    /<PresentationRenderer\s+model=\{shown\.model\}\s+audience="client"/.test(code),
    "it mounts the SAME renderer the internal review approves, with the same audience",
  );
  check(
    /viewer=\{payload\.filtersLive \? viewer : undefined\}/.test(code),
    "and withholds the viewer object entirely when the filters are not live",
  );
  // CONTRACT C1: no aggregation, no arithmetic, no threshold.
  for (const forbidden of ["Math.", ".reduce(", "/ 100", "* 100", "toFixed("]) {
    check(!code.includes(forbidden), `it contains no ${forbidden}`);
  }
  // AND NOTHING INTERNAL CAN ARRIVE AS A PROP.
  for (const internal of ["tenantId", "definition", "binding", "sha256", "revision", "acknowledg"]) {
    check(!code.includes(internal), `«${internal}» is not a name this surface holds`);
  }
  check(
    !/@\/lib\/studies\/published-presentation/.test(code),
    "and it does not import the server-only reader",
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[7] The projection a client receives is defined in SQL, not here");

{
  const sql = read(MIGRATION);
  const body = sql.slice(sql.indexOf("create or replace function public.read_canonical_publication"));
  const fn = body.slice(0, body.indexOf("$read$;") + 7);
  check(fn.includes("language sql"), "the client read is one SQL statement");
  check(fn.includes("stable"), "and it is declared stable, so it cannot write");
  // THE KEYS ARE THE ARGUMENTS THAT OPEN A LINE, not every quoted word in the
  // body: `at time zone 'UTC'` is a time zone, and a scan that could not tell
  // the two apart reported a fourth key the function does not have.
  const keys = [...fn.matchAll(/^\s+'(\w+)',/gm)].map((m) => m[1]);
  eq("it builds exactly three keys", keys.join(","), "version,publishedAt,renderModel");
  for (const internal of [
    "definition",
    "definition_sha256",
    "render_model_sha256",
    "binding_fingerprint",
    "acknowledged_warnings",
    "published_by",
    "source_draft_revision",
    "note",
  ]) {
    check(!fn.includes(internal), `«${internal}» is absent from the projection by construction`);
  }
  check(fn.includes("p.tenant_id = p_tenant_id"), "and the tenant is required, so a study id alone fetches nothing");

  // THE THREE PUBLICATION TABLES GRANT `select` TO service_role AND NOTHING TO
  // A BROWSER ROLE. The reader's admin client is not a convenience — it is the
  // only role that can read them at all.
  check(
    /revoke all privileges on table public\.%I from anon, authenticated/.test(sql),
    "browser roles hold no privilege on the publication tables",
  );
  check(
    /grant select on table public\.%I to service_role/.test(sql),
    "and service_role holds SELECT and nothing more",
  );
  check(
    /grant execute on function public\.read_canonical_publication\(uuid, uuid\)\s*\n?\s*to service_role/.test(sql),
    "the client read is executable by service_role alone",
  );
}

/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(82)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
if (failures > 0) {
  console.log("RESULT: the client's published read contract does NOT hold. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: the client read is server-only, reaches the pointer and the immutable snapshot and nothing else, " +
    "cannot name the draft or any write, hands a browser a finished model and a count, and answers a broken " +
    "publication with a sentence rather than with the legacy engine's numbers.",
);
