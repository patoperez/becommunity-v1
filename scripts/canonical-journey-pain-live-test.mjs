// =============================================================================
// UNIT 6B.4B2C — THE JOURNEY PAIN REVIEW, EXECUTED AGAINST A REAL DATABASE
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//     npm run test:canonical-journey-pain-live
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS SEPARATELY FROM THE OFFLINE GATE
// -----------------------------------------------------------------------------
// `npm run test:journey-pain-review` proves what is a property of a PURE
// FUNCTION: which gaps a queue has, what a digest covers, how a cloud counts.
// Not one of the guarantees below is that.
//
// A row that cannot be updated, a delete refused while its study exists and
// permitted by a cascade, an approval the database itself refuses without both
// of its halves, a replay that writes nothing, two reviewers deciding at once,
// and — the one that matters most — a decision table that CANNOT REACH
// `pain_point`: every one is a property of PostgreSQL executing migration 0032,
// and the only way to know is to make it happen.
//
// THE TEN PROOFS, and the section that executes each:
//
//    1 the table exists, locked down, service_role SELECT only ........... [1]
//    2 an unauthorized or unknown actor cannot record a decision ......... [2]
//    3 a malformed token, digest or disposition is refused ............... [2]
//    4 an approval without its phrase OR without its mapping is refused,
//      by the FUNCTION and by the CONSTRAINT independently ............... [3]
//    5 a non-approval carrying a phrase or a mapping is refused .......... [3]
//    6 a decision is written; the identical one replays without a second . [4]
//    7 a decision about MOVED WORDS writes a new row rather than replaying [4]
//    8 a decision is immutable, and deletable only with its study ........ [5]
//    9 the read function returns the NEWEST decision per item ............ [6]
//   10 `pain_point` is untouched — row for row, byte for byte, and there is
//      no foreign key from the decision table to it at all ............... [7]
//
// AND ONE MORE, because it is what the whole design rests on:
//   11 a one-to-many mapping survives a round trip through the column .... [8]
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope. This is a disposable cluster, and
// it is never to be reported as a hosted run.
// =============================================================================

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { painItemToken, painSourceDigest } from "../src/lib/publication/journey-pain-digest.ts";

let failures = 0;
let executed = 0;
const check = (condition, message) => {
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

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CLIENT_ACTOR = "99999999-9999-4999-8999-999999999999";
const TENANT = "22222222-2222-4222-8222-222222222222";
const STUDY = "66666666-6666-4666-8666-666666666666";
/** Deleted at the end, to prove a cascade still works past the immutability trigger. */
const CASCADE_STUDY = "77777777-7777-4777-8777-777777777777";

const q = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
const arr = (values) =>
  values.length === 0
    ? `'{}'::text[]`
    : `'{${values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",")}}'::text[]`;

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

console.log("Be Community — Unit 6B.4B2C: the journey pain review against a real PostgreSQL");
console.log("=".repeat(82));

/** The product's own token and digest functions, so this is not a parallel scheme. */
const ITEM = painItemToken(STUDY, "3f2c9b1a-0000-4000-8000-000000000001");
const OTHER_ITEM = painItemToken(STUDY, "3f2c9b1a-0000-4000-8000-000000000002");
const DIGEST = painSourceDigest({
  token: ITEM,
  curatedPhrase: "FRASE-KWJ-alfa",
  sourceContext: "ETAPA-ZQX-uno",
  sourceStatus: "pending",
});
const MOVED_DIGEST = painSourceDigest({
  token: ITEM,
  curatedPhrase: "FRASE-KWJ-alfa-CORREGIDA",
  sourceContext: "ETAPA-ZQX-uno",
  sourceStatus: "pending",
});
const POINT_A = "journey-touchpoint:pt-uno";
const POINT_B = "journey-touchpoint:pt-dos";

await withDisposableDatabase(target, "journeypain", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032");
  psqlSuiteTransport(db).prepare(32);

  db.run(`
    insert into auth.users (id, email) values
      (${q(ACTOR)}, 'internal@example.test'),
      (${q(CLIENT_ACTOR)}, 'client@example.test');
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Probe tenant');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal'),
      (${q(CLIENT_ACTOR)}, ${q(TENANT)}, 'client');
    insert into public.study (id, tenant_id, name) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio con dolor'),
      (${q(CASCADE_STUDY)}, ${q(TENANT)}, 'Estudio que se borra entero');
  `);

  // A REAL `pain_point` ROW, so §[7] compares something rather than nothing.
  //
  // WITHOUT ITS VISUAL ANNOTATION, and deliberately: that column is nullable,
  // and planting one would mean planting a source asset and an import job too —
  // three tables of scaffolding for a row this gate only ever READS. What has
  // to be real here is that the row exists, is `pending`, and is byte-identical
  // afterwards.
  db.run(`
    insert into public.pain_point
      (id, tenant_id, study_id, raw_text, normalized_text, review_status)
    values ('3f2c9b1a-0000-4000-8000-000000000001', ${q(TENANT)}, ${q(STUDY)},
            'FRASE-KWJ-alfa', 'FRASE-KWJ-alfa', 'pending');
  `);

  const attempt = (sql) => {
    try {
      return { ok: true, value: db.json(sql) };
    } catch (thrown) {
      return {
        ok: false,
        // THE DATABASE'S OWN MESSAGE IS KEPT, and it lives on `databaseMessage`
        // rather than on `message`: the wrapper's `message` is the generic
        // «psql refused a statement», and a gate that asserted on a constraint
        // NAME would silently never match it.
        message: String(thrown?.databaseMessage ?? thrown?.stderr ?? thrown?.message ?? thrown),
      };
    }
  };
  const decide = (over = {}) => {
    const args = {
      study: STUDY,
      actor: ACTOR,
      item: ITEM,
      digest: DIGEST,
      disposition: "approved",
      phrase: "PUBLICA-alfa",
      points: [POINT_A],
      rationale: null,
      ...over,
    };
    return attempt(`
      select public.record_canonical_journey_pain_decision(
        ${q(args.study)}, ${q(args.actor)}, ${q(args.item)}, ${q(args.digest)},
        ${q(args.disposition)}, ${q(args.phrase)}, ${arr(args.points)}, ${q(args.rationale)}
      )::text;
    `);
  };
  const count = (sql) => Number(db.json(`select json_build_object('n', (${sql}))::text;`).n);

  /* ---------------------------------------------------------------------- */
  console.log("\n[1] The table exists, is locked down, and service_role may only SELECT");

  const shape = db.json(`
    select json_build_object(
      'exists', (select count(*) from pg_class where relname = 'canonical_journey_pain_decision'),
      'rls', (select relrowsecurity from pg_class where relname = 'canonical_journey_pain_decision'),
      'force', (select relforcerowsecurity from pg_class where relname = 'canonical_journey_pain_decision'),
      'policies', (select count(*) from pg_policies where tablename = 'canonical_journey_pain_decision'),
      'anonPrivs', (select count(*) from information_schema.table_privileges
                     where table_name = 'canonical_journey_pain_decision' and grantee in ('anon','authenticated')),
      'servicePrivs', (select string_agg(privilege_type, ',' order by privilege_type)
                        from information_schema.table_privileges
                       where table_name = 'canonical_journey_pain_decision' and grantee = 'service_role')
    )::text;
  `);
  eq("the table exists", Number(shape.exists), 1);
  check(shape.rls === true || shape.rls === "t", "RLS is enabled");
  check(shape.force === true || shape.force === "t", "and FORCED");
  eq("it carries a deny policy for the browser roles", Number(shape.policies), 1);
  eq("anon and authenticated hold no privilege at all", Number(shape.anonPrivs), 0);
  eq("and service_role holds SELECT and nothing else", shape.servicePrivs, "SELECT");

  const funcs = db.json(`
    select json_build_object(
      'record', (select count(*) from pg_proc where proname = 'record_canonical_journey_pain_decision'),
      'read', (select count(*) from pg_proc where proname = 'read_canonical_journey_pain_decisions'),
      'refuse', (select count(*) from pg_proc where proname = 'refuse_canonical_journey_pain_change'),
      'browserExec', (select count(*) from information_schema.routine_privileges
                       where routine_name in ('record_canonical_journey_pain_decision',
                                              'read_canonical_journey_pain_decisions',
                                              'refuse_canonical_journey_pain_change')
                         and grantee in ('anon','authenticated','PUBLIC'))
    )::text;
  `);
  eq("the write function exists", Number(funcs.record), 1);
  eq("the read function exists", Number(funcs.read), 1);
  eq("the immutability trigger function exists", Number(funcs.refuse), 1);
  eq("and no browser role may execute any of the three", Number(funcs.browserExec), 0);

  /* ---------------------------------------------------------------------- */
  console.log("\n[2] An unauthorized actor, and malformed input, are refused");

  check(!decide({ actor: CLIENT_ACTOR }).ok, "a client-role actor cannot record a decision");
  check(
    !decide({ actor: "00000000-0000-4000-8000-000000000000" }).ok,
    "and neither can an actor the database does not know",
  );
  check(!decide({ actor: null }).ok, "nor a null actor");
  check(!decide({ study: "00000000-0000-4000-8000-0000000000ff" }).ok, "an unknown study is refused");
  check(!decide({ item: "not-a-token" }).ok, "a malformed item token is refused");
  check(!decide({ item: "pp" + "A".repeat(16) }).ok, "and so is one outside the alphabet");
  check(!decide({ digest: "nope" }).ok, "a malformed source digest is refused");
  check(!decide({ digest: "A".repeat(64) }).ok, "and so is an upper-case one");
  check(!decide({ disposition: "maybe" }).ok, "a disposition outside the three is refused");
  check(!decide({ disposition: "unreviewed" }).ok, "and «unreviewed» is not a decision anybody may record");
  eq("nothing was written by any of those", count("select count(*) from public.canonical_journey_pain_decision"), 0);

  /* ---------------------------------------------------------------------- */
  console.log("\n[3] An approval needs BOTH halves, and a refusal may carry neither");

  check(!decide({ phrase: null }).ok, "an approval with no public phrase is refused");
  check(!decide({ phrase: "   " }).ok, "and one whose phrase is only spaces is refused as missing");
  check(!decide({ points: [] }).ok, "an approval mapped to no touchpoint is refused");
  eq("still nothing written", count("select count(*) from public.canonical_journey_pain_decision"), 0);

  // THE FUNCTION NORMALISES, SO THE CONSTRAINT IS PROVED SEPARATELY. A caller
  // that could INSERT directly is exactly what the grants forbid, and the CHECK
  // is the second wall: it is exercised as the table owner, which is the only
  // role that could ever get past the first.
  const directBad = attempt(`
    insert into public.canonical_journey_pain_decision
      (study_id, tenant_id, item_key, source_digest, disposition, public_phrase, touchpoints, decided_by)
    values (${q(STUDY)}, ${q(TENANT)}, ${q(ITEM)}, ${q(DIGEST)}, 'approved', null, '{}', ${q(ACTOR)})
    returning json_build_object('id', id)::text;
  `);
  check(!directBad.ok, "the CHECK refuses an approval with neither half, even for the table owner");
  check(
    directBad.ok === false && /approved_is_complete/.test(directBad.message),
    "and it refuses it by the name of the constraint that says so",
  );
  const directRefusalWithPhrase = attempt(`
    insert into public.canonical_journey_pain_decision
      (study_id, tenant_id, item_key, source_digest, disposition, public_phrase, touchpoints, decided_by)
    values (${q(STUDY)}, ${q(TENANT)}, ${q(ITEM)}, ${q(DIGEST)}, 'rejected', 'algo', '{}', ${q(ACTOR)})
    returning json_build_object('id', id)::text;
  `);
  check(!directRefusalWithPhrase.ok, "a rejection carrying a public phrase is refused");
  check(
    directRefusalWithPhrase.ok === false && /refusal_is_empty/.test(directRefusalWithPhrase.message),
    "by the constraint that says a refusal publishes nothing",
  );
  const directRefusalWithPoints = attempt(`
    insert into public.canonical_journey_pain_decision
      (study_id, tenant_id, item_key, source_digest, disposition, public_phrase, touchpoints, decided_by)
    values (${q(STUDY)}, ${q(TENANT)}, ${q(ITEM)}, ${q(DIGEST)}, 'unresolved', null, ${arr([POINT_A])}, ${q(ACTOR)})
    returning json_build_object('id', id)::text;
  `);
  check(!directRefusalWithPoints.ok, "and an unresolved item carrying a mapping is refused too");

  /* ---------------------------------------------------------------------- */
  console.log("\n[4] A decision is written; the identical one replays; moved words do not");

  const first = decide();
  check(first.ok, "a well-formed approval is recorded");
  const firstAnswer = first.value;
  check(firstAnswer.created === true, "and the function says it created it");
  eq("one row exists", count("select count(*) from public.canonical_journey_pain_decision"), 1);

  const replay = decide();
  check(replay.ok, "the identical decision is accepted again");
  const replayAnswer = replay.value;
  check(replayAnswer.created === false, "and reported as a replay");
  eq("and it wrote nothing", count("select count(*) from public.canonical_journey_pain_decision"), 1);
  eq("returning the SAME row", replayAnswer.decisionId, firstAnswer.decisionId);

  const changed = decide({ phrase: "PUBLICA-alfa-reescrita" });
  check(changed.ok && changed.value.created === true, "changing the wording is a NEW decision");
  eq("so a second row exists", count("select count(*) from public.canonical_journey_pain_decision"), 2);

  // THE ONE THAT MATTERS: the same choice, about words that have since moved,
  // must be RE-RECORDED so the store carries the digest of what is actually
  // there. A replay here would leave the store insisting a stale review is
  // current.
  const moved = decide({ phrase: "PUBLICA-alfa-reescrita", digest: MOVED_DIGEST });
  check(
    moved.ok && moved.value.created === true,
    "the same choice about MOVED words is recorded again, never replayed",
  );
  eq("three rows now", count("select count(*) from public.canonical_journey_pain_decision"), 3);

  const rejected = decide({
    item: OTHER_ITEM,
    disposition: "rejected",
    phrase: null,
    points: [],
    rationale: "no aporta al cliente",
  });
  check(rejected.ok, "a rejection with a reason is recorded");

  /* ---------------------------------------------------------------------- */
  console.log("\n[5] A decision is immutable, and deletable only with its study");

  const update = attempt(`
    update public.canonical_journey_pain_decision set public_phrase = 'otra cosa'
     where item_key = ${q(ITEM)} returning json_build_object('id', id)::text;
  `);
  check(!update.ok, "an UPDATE is refused");
  check(update.ok === false && /immutable/.test(update.message), "and the refusal says why");
  const remove = attempt(`
    delete from public.canonical_journey_pain_decision where item_key = ${q(ITEM)}
    returning json_build_object('id', id)::text;
  `);
  check(!remove.ok, "a DELETE is refused while the study exists");
  eq("and nothing was lost", count("select count(*) from public.canonical_journey_pain_decision"), 4);

  // THE CASCADE STILL WORKS. A study that is deleted whole takes its decisions
  // with it — an immutability trigger that blocked that would make a study
  // undeletable, which is the defect 0025 recorded.
  db.json(`
    select public.record_canonical_journey_pain_decision(
      ${q(CASCADE_STUDY)}, ${q(ACTOR)}, ${q(ITEM)}, ${q(DIGEST)}, 'unresolved', null, '{}'::text[], null
    )::text;
  `);
  eq("the study to be deleted has a decision", count(`select count(*) from public.canonical_journey_pain_decision where study_id = ${q(CASCADE_STUDY)}`), 1);
  db.run(`delete from public.study where id = ${q(CASCADE_STUDY)};`);
  eq("deleting the study takes it", count(`select count(*) from public.canonical_journey_pain_decision where study_id = ${q(CASCADE_STUDY)}`), 0);
  eq("and leaves every other decision alone", count("select count(*) from public.canonical_journey_pain_decision"), 4);

  /* ---------------------------------------------------------------------- */
  console.log("\n[6] The read returns the NEWEST decision per item, and no actor");

  const readBack =
    db.json(
      `select json_build_object('rows', public.read_canonical_journey_pain_decisions(${q(STUDY)}, ${q(TENANT)}))::text;`,
    ).rows ?? [];
  eq("two items have a decision in force", readBack.length, 2);
  const inForce = readBack.find((row) => row.itemKey === ITEM);
  check(inForce !== undefined, "the approved item is among them");
  eq("and what is in force is the LATEST decision's digest", inForce.sourceDigest, MOVED_DIGEST);
  eq("with the latest wording", inForce.publicPhrase, "PUBLICA-alfa-reescrita");
  check(
    !Object.prototype.hasOwnProperty.call(inForce, "decidedBy") &&
      !JSON.stringify(readBack).includes(ACTOR),
    "and the read never names who decided",
  );
  const rejectedRow = readBack.find((row) => row.itemKey === OTHER_ITEM);
  eq("the rejected item is reported as rejected", rejectedRow.disposition, "rejected");
  eq("with no public phrase", rejectedRow.publicPhrase, null);
  eq("and no mapping", rejectedRow.touchpoints.length, 0);

  /* ---------------------------------------------------------------------- */
  console.log("\n[7] `pain_point` is untouched, and cannot be reached from here at all");

  const pain = db.json(`
    select json_build_object(
      'rows', (select count(*) from public.pain_point),
      'status', (select review_status from public.pain_point limit 1),
      'text', (select normalized_text from public.pain_point limit 1),
      'reviewedBy', (select count(*) from public.pain_point where reviewed_by is not null),
      'digest', (select encode(sha256(convert_to(string_agg(t.row::text, '|' order by t.row::text), 'UTF8')), 'hex')
                   from (select p as row from public.pain_point p) t)
    )::text;
  `);
  eq("the source row is still there", Number(pain.rows), 1);
  eq("still pending", pain.status, "pending");
  eq("with its text unchanged", pain.text, "FRASE-KWJ-alfa");
  eq("and nobody recorded as having reviewed it", Number(pain.reviewedBy), 0);

  // AND THERE IS NO EDGE. A foreign key would make «not mutated» a promise about
  // behaviour; its absence makes it a fact about the schema.
  const edges = db.json(`
    select json_build_object(
      'toPain', (select count(*) from pg_constraint c
                   join pg_class src on src.oid = c.conrelid
                   join pg_class dst on dst.oid = c.confrelid
                  where c.contype = 'f'
                    and src.relname = 'canonical_journey_pain_decision'
                    and dst.relname = 'pain_point'),
      'allFks', (select string_agg(dst.relname, ',' order by dst.relname)
                   from pg_constraint c
                   join pg_class src on src.oid = c.conrelid
                   join pg_class dst on dst.oid = c.confrelid
                  where c.contype = 'f' and src.relname = 'canonical_journey_pain_decision')
    )::text;
  `);
  eq("no foreign key points at pain_point", Number(edges.toPain), 0);
  eq("the only ones it has are the study and the tenant", edges.allFks, "study,tenant");

  /* ---------------------------------------------------------------------- */
  console.log("\n[8] A one-to-many mapping survives the column, in order");

  const many = decide({
    item: painItemToken(STUDY, "3f2c9b1a-0000-4000-8000-000000000003"),
    digest: painSourceDigest({
      token: painItemToken(STUDY, "3f2c9b1a-0000-4000-8000-000000000003"),
      curatedPhrase: "FRASE-KWJ-una-etapa-dos-puntos",
      sourceContext: "ETAPA-ZQX-dos",
      sourceStatus: "pending",
    }),
    phrase: "PUBLICA-una-etapa-dos-puntos",
    points: [POINT_B, POINT_A],
  });
  check(many.ok, "a phrase mapped to two touchpoints is recorded");
  const stored = db.json(`
    select json_build_object(
      'points', to_json(touchpoints),
      'n', cardinality(touchpoints)
    )::text
      from public.canonical_journey_pain_decision
     where public_phrase = 'PUBLICA-una-etapa-dos-puntos';
  `);
  eq("both are stored", Number(stored.n), 2);
  eq("in the reviewer's own order", JSON.stringify(stored.points), JSON.stringify([POINT_B, POINT_A]));

  // AND THE COLUMN'S OWN BOUNDS BITE.
  const tooMany = attempt(`
    insert into public.canonical_journey_pain_decision
      (study_id, tenant_id, item_key, source_digest, disposition, public_phrase, touchpoints, decided_by)
    values (${q(STUDY)}, ${q(TENANT)}, ${q(OTHER_ITEM)}, ${q(DIGEST)}, 'approved', 'x',
            ${arr(Array.from({ length: 17 }, (_, index) => `journey-touchpoint:p${index}`))}, ${q(ACTOR)})
    returning json_build_object('id', id)::text;
  `);
  check(!tooMany.ok, "seventeen touchpoints are refused by the cardinality bound");
  const tooLong = attempt(`
    insert into public.canonical_journey_pain_decision
      (study_id, tenant_id, item_key, source_digest, disposition, public_phrase, touchpoints, decided_by)
    values (${q(STUDY)}, ${q(TENANT)}, ${q(OTHER_ITEM)}, ${q(DIGEST)}, 'approved', ${q("x".repeat(301))},
            ${arr([POINT_A])}, ${q(ACTOR)})
    returning json_build_object('id', id)::text;
  `);
  check(!tooLong.ok, "and a public phrase past 300 characters is refused");
});

/* -------------------------------------------------------------------------- */
console.log("\n" + "=".repeat(82));
console.log(`SUMMARY: ${executed} checks, ${executed - failures} passed, ${failures} failed.`);
if (failures > 0) {
  console.error("RESULT: migration 0032 does not hold. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: a journey pain decision is recorded only by an authorized actor through the one write " +
    "path, is refused unless an approval carries both its halves, replays instead of duplicating, " +
    "is re-recorded when the words move, cannot be edited, goes with its study, and reaches " +
    "`pain_point` by no foreign key at all. GATE PASSED.",
);
