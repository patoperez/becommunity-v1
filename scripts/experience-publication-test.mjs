// =============================================================================
// The publication, version-history and rollback gate
// =============================================================================
// Deterministic, credentials-free, and it never touches a database. It proves
// the claims this milestone makes that a reviewer would otherwise have to take
// on trust:
//
//   1  a canonical hash names an arrangement, is stable under key order, and
//      changes when anything stored changes;
//   2  an idempotency key is the same for the same attempt and different for a
//      different one — including a different acknowledgement;
//   3  a blocker is something the page would be lying about and cannot be
//      acknowledged; a warning is a judgement and is acknowledged BY EXACT
//      CODE, in both directions;
//   4  the structural diff reports what a reader would notice, by identifier,
//      and ignores what nobody ever sees;
//   5  contract C11 holds for a composed experience: nothing that would have
//      produced an internal sentence reaches a client, and the separators and
//      headings around it go too;
//   6  the inventory describes an arrangement without judging it;
//   7  migration 0025 is reversible, keeps least privilege, refuses an UPDATE
//      on the immutable tables, and does not make a study undeletable;
//   8  no publication Server Action calls `revalidatePath`, every one of them
//      re-authorizes, and the client route falls back to the legacy dashboard
//      rather than to an error page;
//   9  the canvas fits itself automatically without taking the choice away or
//      shrinking a 44 px target.
//
// It reads the pure modules for behaviour and the sources for the structural
// facts a database or a DOM would otherwise be needed to observe.
// =============================================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  definitionHash,
  prepareIdempotencyKey,
  selectionIdempotencyKey,
  sha256Hex,
  shortHash,
  studyFingerprint,
  IDEMPOTENCY_KEY_PATTERN,
  SHA256_HEX,
  STUDY_FINGERPRINT_PATTERN,
} from "../src/lib/experience/fingerprint.ts";
import {
  acknowledgementMatches,
  publicationPreflight,
  CLIENT_UNSUPPORTED_BLOCKS,
  PUBLICATION_BLOCKER_CODES,
  PUBLICATION_WARNING_CODES,
} from "../src/lib/experience/preflight.ts";
import { structuralDiff, summariseDiff } from "../src/lib/experience/diff.ts";
import {
  blockReachesClient,
  dataHasContent,
  visibleBlocksForClient,
  visiblePagesForClient,
} from "../src/lib/experience/client-visibility.ts";
import { experienceInventory } from "../src/lib/experience/inventory.ts";
import { newBlock, newExperience, newIdentity, newPage } from "../src/lib/experience/defaults.ts";
import { fixtureRegistry } from "../src/lib/experience/fixtures.ts";
import { parseExperienceDefinition, EXPERIENCE_SCHEMA_VERSION } from "../src/lib/experience/definition.ts";
import { serializeExperienceDefinition } from "../src/lib/experience/serialize.ts";
import { dataKeyForBlock } from "../src/lib/experience/data.ts";
import { LEGACY_SAMPLE_POLICY, DEFAULT_SAMPLE_POLICY } from "../src/lib/experience/sample-policy.ts";
import { mintId } from "../src/lib/experience/ids.ts";

let checks = 0;
function ok(what) {
  checks += 1;
  console.log(`  ok  ${what}`);
}
function section(title) {
  console.log(`\n${title}`);
}

const registry = fixtureRegistry();
const STUDY = registry.scope.studyId;
const TENANT = registry.scope.tenantId;
const metric = registry.metrics[0];
const dimension = registry.dimensions.find((entry) => entry.filterEligible && entry.values.length > 0);
assert.ok(metric && dimension, "the fixture registry has to carry a result and a characteristic");

const EVIDENCE = {
  approvedThemes: [{ label: "Tema aprobado", count: 4, n: 3 }],
  approvedSources: ["encuesta"],
};

/** A document with one visible page carrying one metric block. */
function baseDocument(overrides = {}) {
  const document = newExperience({
    seed: "gate",
    title: "Experiencia de prueba",
    studyId: STUDY,
    tenantId: TENANT,
  });
  const page = newPage("page-a", "Panorama", 0);
  const block = newBlock({
    type: "metric",
    seed: "metric-a",
    order: 0,
    registry,
    metricId: metric.id,
  });
  assert.ok(block, "the fixture registry has to support a metric block");
  page.blocks = [block];
  return { ...document, pages: [page], ...overrides };
}

function metricData(blockId, { value = 42, n = 30 } = {}) {
  return {
    [dataKeyForBlock(blockId)]: {
      ok: true,
      data: {
        blockId,
        metricLabel: metric.label,
        unit: "percent",
        decimals: 1,
        categoryLabel: null,
        seriesLabel: null,
        categories: [],
        series: [],
        overall: { categoryKey: "", value, n },
        omittedCategories: 0,
        detail: [],
      },
    },
  };
}

const SUMMARY = { themes: [], crossableResults: 3, reportAvailable: true };

// =============================================================================
section("1. The canonical hash");
// =============================================================================
{
  const document = baseDocument();
  const hash = await definitionHash(document);
  assert.match(hash, SHA256_HEX, "a definition hash is 64 lower-case hex characters");
  ok("a definition hash is lower-case hex, exactly 64 characters");

  // Key order is an accident of construction. Rebuilding the same document with
  // its top-level keys in a different order must not change its identity.
  const shuffled = Object.fromEntries(Object.entries(document).reverse());
  assert.equal(await definitionHash(shuffled), hash, "key order changed the hash");
  ok("the hash is independent of the order the document's keys happen to be in");

  assert.equal(
    serializeExperienceDefinition(document),
    serializeExperienceDefinition(shuffled),
    "the canonical bytes differ under a different key order",
  );
  ok("the canonical serialization the hash is taken over is itself key-sorted");

  const renamed = { ...document, title: `${document.title} ` };
  assert.notEqual(await definitionHash(renamed), hash, "a trailing space did not change the hash");
  ok("any change to the stored document changes the hash, including one space");

  const hidden = structuredClone(document);
  hidden.pages[0].blocks[0].visible = false;
  assert.notEqual(await definitionHash(hidden), hash, "hiding a block did not change the hash");
  ok("hiding a block changes the hash, because a hidden block is a different document");

  assert.equal(shortHash(hash), hash.slice(0, 8), "the short form is the first eight characters");
  assert.equal(shortHash(`sha256:${hash}`), hash.slice(0, 8), "a prefixed hash shortens the same way");
  ok("the short form for a screen is the first eight characters, prefixed or not");

  // Two independent implementations of the same digest must agree, or the
  // hash cannot be checked by anybody outside this process.
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "the digest disagrees with the published SHA-256 of the empty string",
  );
  ok("the digest agrees with the published SHA-256 of the empty string");
}

// =============================================================================
section("2. The study fingerprint");
// =============================================================================
{
  const base = {
    registryVersion: registry.registryVersion,
    samplePolicy: DEFAULT_SAMPLE_POLICY,
    categorySignature: null,
  };
  const stamp = await studyFingerprint(base);
  assert.match(stamp, STUDY_FINGERPRINT_PATTERN, "a study fingerprint is a prefixed digest");
  assert.ok(stamp.length <= 200, "a study fingerprint has to fit the column's own bound");
  ok("a study fingerprint is a prefixed digest and fits the stored bound");

  assert.equal(await studyFingerprint(base), stamp, "the same inputs produced two stamps");
  ok("the same registry, rule and grouping always produce the same stamp");

  assert.notEqual(
    await studyFingerprint({ ...base, samplePolicy: LEGACY_SAMPLE_POLICY }),
    stamp,
    "changing the disclosure rule did not change the stamp",
  );
  ok("changing the disclosure rule changes what a review was carried out against");

  assert.notEqual(
    await studyFingerprint({ ...base, registryVersion: `${registry.registryVersion}x` }),
    stamp,
    "changing the registry did not change the stamp",
  );
  ok("changing the study's results or their names changes the stamp");

  assert.notEqual(
    await studyFingerprint({ ...base, categorySignature: "grouped" }),
    stamp,
    "acquiring a category signature did not change the stamp",
  );
  ok("acquiring a category grouping signature changes the stamp");
}

// =============================================================================
section("3. Idempotency keys");
// =============================================================================
{
  const hash = await definitionHash(baseDocument());
  const attempt = {
    studyId: STUDY,
    sourceDraftRevision: 7,
    definitionSha256: hash,
    acknowledgedWarnings: ["hidden_page", "low_sample"],
  };
  const key = await prepareIdempotencyKey(attempt);
  assert.match(key, IDEMPOTENCY_KEY_PATTERN, "a prepare key has to satisfy the column's own check");
  ok("a prepare key satisfies the shape the database independently checks");

  assert.equal(await prepareIdempotencyKey(attempt), key, "the same attempt produced two keys");
  ok("a retry of the same attempt carries the same key, so it finds its own first write");

  assert.equal(
    await prepareIdempotencyKey({ ...attempt, acknowledgedWarnings: ["low_sample", "hidden_page"] }),
    key,
    "the order the warnings arrived in changed the key",
  );
  ok("the order the acknowledged warnings arrive in does not change the attempt");

  assert.notEqual(
    await prepareIdempotencyKey({ ...attempt, acknowledgedWarnings: ["hidden_page"] }),
    key,
    "acknowledging one fewer warning produced the same key",
  );
  ok("acknowledging a different set of warnings is a different attempt, never a replay");

  assert.notEqual(
    await prepareIdempotencyKey({ ...attempt, sourceDraftRevision: 8 }),
    key,
    "a different draft revision produced the same key",
  );
  ok("preparing a different draft revision is a different attempt");

  const publish = {
    kind: "pub",
    studyId: STUDY,
    revisionId: "11111111-1111-4111-8111-111111111111",
    expectedActiveRevisionId: null,
  };
  const pubKey = selectionIdempotencyKey(publish);
  assert.match(pubKey, IDEMPOTENCY_KEY_PATTERN, "a publish key has to satisfy the same check");
  assert.equal(selectionIdempotencyKey(publish), pubKey, "pressing publish twice is two acts");
  ok("pressing publish twice on the same screen is one act, not two");

  assert.notEqual(
    selectionIdempotencyKey({ ...publish, expectedActiveRevisionId: "22222222-2222-4222-8222-222222222222" }),
    pubKey,
    "publishing the same revision after a rollback replayed the earlier event",
  );
  ok("publishing the same revision again after a rollback is a new act");

  assert.notEqual(
    selectionIdempotencyKey({ ...publish, kind: "rst" }),
    pubKey,
    "a restoration and a publication of the same revision shared a key",
  );
  ok("a restoration is never mistaken for the publication of the same revision");
}

// =============================================================================
section("4. Blockers cannot be acknowledged; warnings must be, exactly");
// =============================================================================
{
  const codes = new Set(PUBLICATION_BLOCKER_CODES);
  for (const code of PUBLICATION_WARNING_CODES) {
    assert.ok(!codes.has(code), `“${code}” is declared as both a blocker and a warning`);
  }
  ok("no code is both a blocker and a warning");

  for (const code of [...PUBLICATION_BLOCKER_CODES, ...PUBLICATION_WARNING_CODES]) {
    assert.match(code, /^[a-z0-9_]{1,64}$/, `“${code}” cannot be stored in the acknowledgement column`);
  }
  ok("every declared code fits the vocabulary the database constrains the column to");

  const clean = publicationPreflight({ definition: baseDocument(), registry, evidence: EVIDENCE });
  assert.equal(clean.blockers.length, 0, `a complete document blocked: ${JSON.stringify(clean.blockers)}`);
  ok("a complete, visible, well-referenced arrangement produces no blocker");

  // Nothing to publish.
  const empty = baseDocument();
  empty.pages = [];
  const emptyReport = publicationPreflight({ definition: empty, registry, evidence: EVIDENCE });
  assert.ok(
    emptyReport.blockerCodes.includes("no_visible_content"),
    "an experience with no pages was allowed to publish",
  );
  ok("an experience with no visible page is blocked");

  // A hidden page is a judgement, not a lie.
  const hiddenPage = baseDocument();
  hiddenPage.pages = [{ ...hiddenPage.pages[0], visible: false }, newPage("page-b", "Otra", 1)];
  hiddenPage.pages[1].blocks = [
    newBlock({ type: "metric", seed: "metric-b", order: 0, registry, metricId: metric.id }),
  ];
  const hiddenReport = publicationPreflight({ definition: hiddenPage, registry, evidence: EVIDENCE });
  assert.ok(hiddenReport.warningCodes.includes("hidden_page"), "a hidden page was not reported");
  assert.ok(!hiddenReport.blockerCodes.includes("hidden_page"), "a hidden page blocked publication");
  ok("a hidden page is a warning a person may acknowledge, never a blocker");

  // The identity layer says it shows something it does not have.
  const brokenIdentity = baseDocument();
  brokenIdentity.identity = {
    ...newIdentity({ title: "Estudio", organization: "Cliente" }),
    organization: null,
    show: { title: true, organization: true, period: false, description: false, mark: false },
  };
  const identityReport = publicationPreflight({
    definition: brokenIdentity,
    registry,
    evidence: EVIDENCE,
  });
  assert.ok(
    identityReport.blockerCodes.includes("identity_incomplete"),
    "a cover promising a client name it does not have was allowed to publish",
  );
  ok("a cover configured to show something it does not have is blocked");

  // A part switched OFF is a decision, and C11 says a decision is silence.
  const quietIdentity = baseDocument();
  quietIdentity.identity = {
    ...quietIdentity.identity,
    organization: null,
    show: { ...quietIdentity.identity.show, organization: false },
  };
  const quietReport = publicationPreflight({
    definition: quietIdentity,
    registry,
    evidence: EVIDENCE,
  });
  assert.ok(
    !quietReport.blockerCodes.includes("identity_incomplete"),
    "choosing not to show the client name was treated as a defect",
  );
  ok("choosing not to show part of the cover is a decision, never a finding");

  // A schema this build's client renderer does not implement.
  const future = { ...baseDocument(), schemaVersion: EXPERIENCE_SCHEMA_VERSION + 1 };
  const futureReport = publicationPreflight({ definition: future, registry, evidence: EVIDENCE });
  assert.ok(
    futureReport.blockerCodes.includes("schema_version_unsupported"),
    "a document from a newer schema was allowed to publish",
  );
  ok("a document the client renderer's schema does not cover is blocked");

  // Qualitative content nobody approved.
  const cloud = baseDocument();
  const cloudBlock = newBlock({ type: "theme_cloud", seed: "cloud-a", order: 1, registry });
  if (cloudBlock) {
    cloud.pages[0].blocks = [...cloud.pages[0].blocks, cloudBlock];
    const noThemes = publicationPreflight({
      definition: cloud,
      registry,
      evidence: { approvedThemes: [], approvedSources: [] },
    });
    assert.ok(
      noThemes.blockerCodes.includes("unapproved_qualitative"),
      "a cloud over a study with no confirmed theme was allowed to publish",
    );
    ok("a qualitative block over content nobody confirmed is blocked");

    const withThemes = publicationPreflight({ definition: cloud, registry, evidence: EVIDENCE });
    assert.ok(
      !withThemes.blockerCodes.includes("unapproved_qualitative"),
      "a cloud over confirmed themes was blocked anyway",
    );
    ok("the same block over confirmed themes publishes");
  }

  // The staleness rule, which the database also enforces.
  const stale = publicationPreflight({
    definition: baseDocument(),
    registry,
    evidence: EVIDENCE,
    prepared: { sourceDraftRevision: 4, studyFingerprint: "sha256:x" },
    currentDraftRevision: 5,
    currentStudyFingerprint: "sha256:x",
  });
  assert.ok(stale.blockerCodes.includes("draft_moved_on"), "a stale review was publishable");
  ok("a prepared revision whose draft has moved on is blocked");

  const fresh = publicationPreflight({
    definition: baseDocument(),
    registry,
    evidence: EVIDENCE,
    prepared: { sourceDraftRevision: 5, studyFingerprint: "sha256:x" },
    currentDraftRevision: 5,
    currentStudyFingerprint: "sha256:x",
  });
  assert.ok(!fresh.blockerCodes.includes("draft_moved_on"), "a current review was called stale");
  ok("a prepared revision still describing the saved draft is not stale");

  const moved = publicationPreflight({
    definition: baseDocument(),
    registry,
    evidence: EVIDENCE,
    prepared: { sourceDraftRevision: 5, studyFingerprint: "sha256:a" },
    currentDraftRevision: 5,
    currentStudyFingerprint: "sha256:b",
  });
  assert.ok(
    moved.warningCodes.includes("study_configuration_moved"),
    "the study's configuration moving under a review went unreported",
  );
  assert.ok(
    !moved.blockerCodes.includes("study_configuration_moved"),
    "the study's configuration moving blocked publication outright",
  );
  ok("the study's own configuration moving under a review is said, and does not block");

  // Acknowledgement is exact in both directions.
  assert.equal(acknowledgementMatches(["a", "b"], ["a", "b"]).ok, true);
  ok("an acknowledgement of exactly the warnings on screen is accepted");
  const missing = acknowledgementMatches(["a", "b"], ["a"]);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ["b"], "the missing code was not named");
  ok("a missing acknowledgement is refused and the missing code is named");
  const extra = acknowledgementMatches(["a"], ["a", "b"]);
  assert.equal(extra.ok, false);
  assert.deepEqual(extra.unexpected, ["b"], "the unexpected code was not named");
  ok("an acknowledgement about a different document is refused, not silently narrowed");
  assert.equal(acknowledgementMatches([], []).ok, true);
  ok("a document with no warnings needs no acknowledgement");
}

// =============================================================================
section("5. The structural diff");
// =============================================================================
{
  const before = baseDocument();
  assert.equal(structuralDiff(before, before).identical, true, "a document differed from itself");
  assert.equal(summariseDiff(structuralDiff(before, before)), "Sin cambios estructurales.");
  ok("a document compared with itself reports no change");

  // Bookkeeping a reader never sees is not a change.
  const bookkept = structuredClone(before);
  bookkept.review = { ...bookkept.review, revision: bookkept.review.revision + 1 };
  bookkept.publication = { ...bookkept.publication, publishedAt: new Date(0).toISOString() };
  assert.equal(
    structuralDiff(before, bookkept).identical,
    true,
    "editor bookkeeping was reported as a change a client would notice",
  );
  ok("review and publication bookkeeping is not a structural change");

  const renamedPage = structuredClone(before);
  renamedPage.pages[0].title = "Resumen";
  const renameDiff = structuralDiff(before, renamedPage);
  assert.ok(
    renameDiff.changes.some((change) => change.kind === "page" && change.action === "renamed"),
    "renaming a page was not reported as a rename",
  );
  assert.ok(
    !renameDiff.changes.some((change) => change.action === "removed"),
    "renaming a page was reported as a removal and an addition",
  );
  ok("renaming a page is a rename, because identity is the opaque id and not the title");

  const hiddenBlock = structuredClone(before);
  hiddenBlock.pages[0].blocks[0].visible = false;
  assert.ok(
    structuralDiff(before, hiddenBlock).changes.some(
      (change) => change.kind === "block" && change.action === "hidden",
    ),
    "hiding a block was not reported as hiding it",
  );
  assert.ok(
    structuralDiff(hiddenBlock, before).changes.some(
      (change) => change.kind === "block" && change.action === "restored",
    ),
    "showing a block again was not reported as restoring it",
  );
  ok("hiding a block and restoring it are two different, named changes");

  const secondPage = structuredClone(before);
  const extraPage = newPage("page-c", "Detalle", 1);
  extraPage.blocks = [
    newBlock({ type: "metric", seed: "metric-c", order: 0, registry, metricId: metric.id }),
  ];
  secondPage.pages = [...secondPage.pages, extraPage];
  const addDiff = structuralDiff(before, secondPage);
  assert.ok(
    addDiff.changes.some((change) => change.kind === "page" && change.action === "added"),
    "adding a page was not reported",
  );
  assert.ok(
    addDiff.changes.some((change) => change.kind === "block" && change.action === "added"),
    "the blocks that arrived with a new page were not reported",
  );
  ok("adding a page reports the page and the blocks that came with it");

  const reordered = structuredClone(secondPage);
  reordered.pages[0].order = 5;
  const reorderDiff = structuralDiff(secondPage, reordered);
  const reorders = reorderDiff.changes.filter((change) => change.action === "reordered");
  assert.equal(reorders.length, 1, "reordering pages was reported once per page");
  ok("reordering pages is reported once, naming what the reader now meets first");

  const moved = structuredClone(secondPage);
  const carried = moved.pages[0].blocks[0];
  moved.pages[0].blocks = [];
  moved.pages[1].blocks = [carried, ...moved.pages[1].blocks];
  assert.ok(
    structuralDiff(secondPage, moved).changes.some(
      (change) => change.kind === "block" && change.action === "moved",
    ),
    "moving a block between pages was reported as a delete and an add",
  );
  ok("moving a block to another page is a move, not a deletion and an addition");

  const policy = structuredClone(before);
  policy.sampleVisibilityPolicy = { ...LEGACY_SAMPLE_POLICY };
  assert.ok(
    structuralDiff(before, policy).changes.some((change) => change.kind === "sample_policy"),
    "changing the disclosure rule was not reported",
  );
  ok("changing the study's disclosure rule is reported: it decides what is shown");

  const identity = structuredClone(before);
  identity.identity = { ...identity.identity, organization: "Otro cliente" };
  assert.ok(
    structuralDiff(before, identity).changes.some((change) => change.kind === "identity"),
    "changing the cover was not reported",
  );
  ok("changing the cover is reported");

  const query = structuredClone(before);
  if (query.pages[0].blocks[0].query) {
    query.pages[0].blocks[0].query.aggregation =
      metric.aggregations.find((entry) => entry !== metric.defaultAggregation) ?? metric.defaultAggregation;
    const queryDiff = structuralDiff(before, query);
    assert.ok(
      queryDiff.changes.some((change) => change.kind === "query"),
      "changing how a result is calculated was not reported",
    );
    ok("changing how a result is calculated is reported as a result change");
  }

  const summary = summariseDiff(structuralDiff(before, secondPage));
  assert.ok(summary.includes("Páginas"), "the one-line summary did not name what changed");
  assert.ok(!summary.includes("{"), "the one-line summary leaked a JSON fragment");
  ok("the one-line summary names the kinds that changed and prints no JSON");
}

// =============================================================================
section("6. Contract C11 — absence is not a client-facing finding");
// =============================================================================
{
  const document = baseDocument();
  const block = document.pages[0].blocks[0];

  assert.equal(
    blockReachesClient({ block, definition: document, data: metricData(block.id), evidence: SUMMARY }),
    true,
    "a block with a real number did not reach the client",
  );
  ok("a block with a real number reaches the client");

  assert.equal(
    blockReachesClient({ block, definition: document, data: {}, evidence: SUMMARY }),
    false,
    "a block whose numbers were never computed reached the client",
  );
  ok("a block whose numbers were never computed renders as nothing at all");

  assert.equal(
    blockReachesClient({
      block,
      definition: document,
      data: { [dataKeyForBlock(block.id)]: { ok: false, reason: "unknown_metric" } },
      evidence: SUMMARY,
    }),
    false,
    "a block pointing at a result the study no longer produces reached the client",
  );
  ok("a block pointing at a result the study no longer has renders as nothing");

  assert.equal(
    blockReachesClient({
      block,
      definition: document,
      data: metricData(block.id, { value: null, n: 0 }),
      evidence: SUMMARY,
    }),
    false,
    "a block nobody answered reached the client",
  );
  ok("a result nobody answered renders as nothing, not as an empty card");

  // A withheld result is silence; a warned one is still shown, with its caveat.
  const strict = { ...document, sampleVisibilityPolicy: { ...LEGACY_SAMPLE_POLICY } };
  assert.equal(
    dataHasContent(metricData(block.id, { value: 30, n: 2 })[dataKeyForBlock(block.id)], strict, block),
    false,
    "a result the study's own rule withholds was rendered anyway",
  );
  ok("a result the study's disclosure rule withholds entirely renders as nothing");

  const warned = { ...document, sampleVisibilityPolicy: { ...DEFAULT_SAMPLE_POLICY, mode: "warn_below" } };
  assert.equal(
    dataHasContent(metricData(block.id, { value: 30, n: 2 })[dataKeyForBlock(block.id)], warned, block),
    true,
    "a result shown WITH a caveat was silenced",
  );
  ok("a result shown with a small-base caveat still renders — that caveat is honesty, not an omission");

  // A download that does not exist is never offered.
  const download = baseDocument();
  /*
   * THE FOUR BLOCK TYPES THAT DESCRIBE THE CLIENT'S EXPERIENCE TO THE AUTHOR.
   *
   * Internally each renders as a bordered sentence about what the client will
   * get. The first published client screen printed those sentences TO the
   * client, including "El cliente los ve plegados, para revisarlos si quiere."
   * They are refused at publication and, as a second line, never drawn here.
   */
  for (const type of CLIENT_UNSUPPORTED_BLOCKS) {
    const describing = baseDocument();
    const block = newBlock({ type, seed: `unsupported-${type}`, order: 1, registry });
    if (!block) continue;
    describing.pages[0].blocks = [...describing.pages[0].blocks, block];
    assert.equal(
      blockReachesClient({ block, definition: describing, data: {}, evidence: SUMMARY }),
      false,
      `“${type}” describes the client's experience to the author and reached the client`,
    );
    const report = publicationPreflight({ definition: describing, registry, evidence: EVIDENCE });
    assert.ok(
      report.blockerCodes.includes("not_rendered_for_client"),
      `publishing a page carrying “${type}” was allowed`,
    );
  }
  ok("the four blocks that describe the client's experience are refused at publication, and drawn to nobody");

  // The frame around a hole goes with the hole.
  const titledOnly = baseDocument();
  const paragraph = newBlock({
    type: "rich_text",
    seed: "prose",
    order: 1,
    registry,
    title: "Un encabezado sin texto",
  });
  if (paragraph) {
    titledOnly.pages[0].blocks = [...titledOnly.pages[0].blocks, paragraph];
    assert.equal(
      blockReachesClient({ block: paragraph, definition: titledOnly, data: {}, evidence: SUMMARY }),
      false,
      "a paragraph block with a title and no paragraph reached the client",
    );
    const written = structuredClone(paragraph);
    written.copy = { ...written.copy, body: "Lo que este estudio encontró." };
    assert.equal(
      blockReachesClient({ block: written, definition: titledOnly, data: {}, evidence: SUMMARY }),
      true,
      "a paragraph block with a paragraph was hidden from the client",
    );
    ok("a paragraph with no paragraph is unfinished work and renders as nothing, not as an instruction");
  }

  const framed = baseDocument();
  const heading = newBlock({ type: "section", seed: "sec", order: 0, registry, title: "Sección" });
  const rule = newBlock({ type: "divider", seed: "div", order: 2, registry });
  const chart = framed.pages[0].blocks[0];
  chart.layout.desktop.order = 1;
  framed.pages[0].blocks = [heading, chart, rule].filter(Boolean);
  const trimmed = visibleBlocksForClient({
    page: framed.pages[0],
    definition: framed,
    data: {},
    evidence: SUMMARY,
  });
  assert.equal(
    trimmed.length,
    0,
    `a heading and a rule survived the block they framed: ${trimmed.map((entry) => entry.type).join(",")}`,
  );
  ok("a heading over nothing and a trailing rule are dropped with the block they framed");

  const kept = visibleBlocksForClient({
    page: framed.pages[0],
    definition: framed,
    data: metricData(chart.id),
    evidence: SUMMARY,
  });
  assert.deepEqual(
    kept.map((entry) => entry.type),
    ["section", "metric"],
    "the heading was dropped even though its block rendered",
  );
  ok("the same heading is kept when the block under it renders, and the trailing rule still is not");

  const pages = visiblePagesForClient({ definition: framed, data: {}, evidence: SUMMARY });
  assert.equal(pages.length, 0, "a page whose every block was dropped was still offered");
  ok("a page left with nothing on it is not offered to the client at all");
}

// =============================================================================
section("7. The inventory describes, and never judges");
// =============================================================================
{
  const document = baseDocument();
  document.pages = [
    document.pages[0],
    { ...newPage("page-hidden", "Anexo", 1), visible: false },
  ];
  const inventory = experienceInventory(document, registry);
  assert.equal(inventory.totals.pages, 2);
  assert.equal(inventory.totals.visiblePages, 1);
  assert.equal(inventory.totals.hiddenPages, 1);
  ok("the inventory counts visible and hidden pages separately");

  assert.equal(inventory.totals.visibleBlocks, 1, "the visible block count is wrong");
  ok("the inventory counts what a client would see");

  assert.equal(inventory.pages[0].blocks[0].result, metric.label, "the result was not named in words");
  assert.ok(
    !JSON.stringify(inventory).includes(metric.id),
    "the inventory printed an opaque identifier where a person reads",
  );
  ok("the inventory names results in the reader's words, never by identifier");

  assert.equal(
    inventory.samplePolicy.mode,
    document.sampleVisibilityPolicy.mode,
    "the disclosure rule was not carried into the inventory",
  );
  ok("the inventory states the disclosure rule the arrangement would publish under");

  assert.equal(inventory.identity.organization, document.identity.organization);
  ok("the inventory states whose study the cover says it is");
}

// =============================================================================
section("8. Migration 0025 — additive, reversible, least privilege");
// =============================================================================
{
  const migration = await readFile(
    new URL("../supabase/migrations/0025_experience_publication.sql", import.meta.url),
    "utf8",
  );
  const rollback = await readFile(
    new URL("../supabase/rollbacks/0025_drop_experience_publication.sql", import.meta.url),
    "utf8",
  );

  assert.ok(migration.includes("begin;") && migration.trimEnd().endsWith("commit;"));
  ok("the migration is one transaction");

  // Scanned over the STATEMENTS, with the comments removed. A migration that
  // explains what it is not doing would otherwise fail its own check for doing
  // it, and the fix for that is to read the statements rather than the prose.
  const statements = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  for (const forbidden of [/\bdrop\s+table\b/i, /\btruncate\b/i, /\bdelete\s+from\b/i]) {
    assert.ok(!forbidden.test(statements), `the migration contains ${forbidden}`);
  }
  ok("the migration drops no table, truncates nothing and deletes no row");

  // The ONE table it updates is the pointer it creates, inside the function
  // whose whole job is to move it. Nothing that existed before 0025 is
  // rewritten.
  const updated = [...statements.matchAll(/update\s+(public\.[a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(updated)],
    ["public.study_experience_publication"],
    `the migration rewrites rows of ${[...new Set(updated)].join(", ")}`,
  );
  ok("the only table it ever updates is the pointer it created, which is the one mutable object here");

  assert.ok(
    migration.includes("alter table public.study_experience_publication enable row level security"),
    "the new table did not enable RLS",
  );
  assert.ok(
    migration.includes("alter table public.study_experience_publication force row level security"),
    "the new table did not FORCE RLS",
  );
  ok("the new table enables AND forces row level security");

  assert.ok(
    /create policy "deny_browser_roles" on public\.study_experience_publication[\s\S]*using \(false\) with check \(false\)/.test(
      migration,
    ),
    "the new table does not deny browser roles outright",
  );
  ok("`anon` and `authenticated` are denied outright on the new table");

  assert.ok(
    migration.includes(
      "revoke all privileges on table public.study_experience_publication from service_role",
    )
      && migration.includes("grant select on table public.study_experience_publication to service_role"),
    "the new table did not revoke the default ALL and grant back only SELECT",
  );
  ok("even the privileged role holds only SELECT on the new table: every write goes through a function");

  for (const fn of [
    "prepare_study_experience_revision",
    "publish_study_experience_revision",
    "restore_study_experience_revision",
  ]) {
    assert.ok(migration.includes(`revoke execute on function public.${fn}`), `${fn} keeps the PUBLIC default`);
    assert.ok(migration.includes(`grant execute on function public.${fn}`), `${fn} is not callable`);
    assert.ok(
      new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`).test(
        migration,
      ),
      `${fn} is not a security-definer function with a pinned empty search path`,
    );
  }
  ok("all three write functions are security definer with a pinned empty search path");
  ok("all three revoke the PUBLIC execute default before granting to the one role that may call them");

  assert.ok(
    migration.includes(
      "revoke execute on function public.select_study_experience_revision(uuid, uuid, uuid, uuid, text[], text[], text, text, text)\n  from public, anon, authenticated, service_role;",
    ),
    "the shared body is callable by somebody",
  );
  assert.ok(
    !/grant execute on function public\.select_study_experience_revision/.test(migration),
    "the shared body was granted to a role",
  );
  ok("the body the two entry points share is callable by nobody, not even the privileged role");

  assert.ok(
    migration.includes("perform public.assert_experience_publisher(p_actor)"),
    "a write function does not re-check the actor",
  );
  assert.ok(
    migration.includes("from public.profiles where user_id = p_actor and role = 'internal'"),
    "the actor's role is not re-read from the database",
  );
  ok("every write re-reads the actor's role from the database rather than trusting a claim");

  assert.ok(
    migration.includes("select * into target from public.study where id = p_study_id"),
    "the tenant is not derived from the study row",
  );
  assert.ok(
    !/p_tenant/.test(migration),
    "a tenant identifier is accepted as a parameter",
  );
  ok("the tenant is never a parameter: it is derived from the study row, every time");

  assert.ok(
    migration.includes("errcode = '55000'"),
    "a refusal uses a code the Data API retries instead of delivering",
  );
  assert.ok(
    !/errcode = '40001'/.test(migration),
    "a refusal uses 40001, which PostgREST retries until the gateway gives up",
  );
  ok("every concurrency refusal uses 55000 — the code the Data API actually delivers");

  assert.ok(
    migration.includes("create trigger refuse_update\n  before update on public.study_experience_event"),
    "the audit trail can be rewritten in place",
  );
  assert.ok(
    !/before delete on public\.study_experience_event/.test(migration),
    "a DELETE trigger would make a study undeletable and break every fixture cleanup",
  );
  ok("the audit trail refuses an UPDATE and deliberately does not refuse the cascade a study delete needs");

  assert.ok(
    migration.includes("create unique index if not exists study_experience_event_idempotency_idx"),
    "idempotency is not enforced by a constraint",
  );
  ok("idempotency is a unique index, not a read-then-write with a window in it");

  assert.ok(
    /on delete cascade/.test(migration) && !/active_revision_id[\s\S]{0,200}on delete restrict/.test(migration),
    "a restrict on the publication pointer would make a study undeletable at random",
  );
  ok("no foreign key on this path can make a study undeletable");

  // The rollback reverses exactly what the migration did.
  assert.ok(rollback.includes("drop table if exists public.study_experience_publication"));
  for (const fn of [
    "prepare_study_experience_revision",
    "publish_study_experience_revision",
    "restore_study_experience_revision",
    "select_study_experience_revision",
    "assert_experience_publisher",
  ]) {
    assert.ok(rollback.includes(`drop function if exists public.${fn}`), `${fn} survives the rollback`);
  }
  ok("the rollback drops every object the migration created");

  assert.ok(
    rollback.includes("rename column prepared_by to published_by")
      && rollback.includes("rename column prepared_at to published_at"),
    "the rollback does not reverse the rename",
  );
  ok("the rollback reverses the two renames exactly");

  assert.ok(
    rollback.includes("WHAT THIS DESTROYS"),
    "the rollback does not say what it destroys",
  );
  assert.ok(
    rollback.includes("delete from public.study_experience_event"),
    "the rollback silently leaves rows the narrower constraint would refuse",
  );
  ok("the rollback names the one place evidence is lost instead of burying it");
}

// =============================================================================
section("9. The routes and the actions");
// =============================================================================
{
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

  /**
   * The CODE, without the prose.
   *
   * Every file in this milestone explains at the top what it deliberately does
   * NOT do, and a scan that read the comments would fail each of those files
   * for saying so. The fix is to read the statements — which is also the only
   * scan that means anything, because a comment cannot call a function.
   */
  const code = (source) =>
    source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n");

  const actions = await read("src/app/studio/e/[studyId]/publicar/actions.ts");
  const previewActions = await read("src/app/studio/e/[studyId]/publicar/preview-actions.ts");
  const clientActions = await read("src/app/insights/e/[studyId]/experience-actions.ts");

  for (const [name, source] of [
    ["publicar/actions.ts", actions],
    ["publicar/preview-actions.ts", previewActions],
    ["insights experience-actions.ts", clientActions],
  ]) {
    assert.ok(!/revalidatePath/.test(code(source)), `${name} calls revalidatePath`);
  }
  ok("no publication Server Action calls `revalidatePath` — the defect that took the editor down");

  for (const [name, source] of [
    ["publicar/actions.ts", actions],
    ["publicar/preview-actions.ts", previewActions],
    ["insights experience-actions.ts", clientActions],
  ]) {
    assert.ok(source.includes("auth.getUser()"), `${name} does not revalidate the session`);
    assert.ok(!/getSession\(\)/.test(code(source)), `${name} makes an auth decision on getSession()`);
  }
  ok("every publication action revalidates the session with getUser(), never getSession()");

  for (const [name, source] of [
    ["publicar/actions.ts", actions],
    ["publicar/preview-actions.ts", previewActions],
  ]) {
    assert.ok(
      /\.from\("profiles"\)[\s\S]{0,200}role/.test(source),
      `${name} does not re-read the actor's role from the database`,
    );
  }
  ok("the internal actions re-read the role from the database before creating a privileged client");

  assert.ok(
    actions.includes("acknowledgementMatches"),
    "the prepare action does not re-check the acknowledgement on the server",
  );
  assert.ok(
    actions.includes("preflight.blockers.length > 0"),
    "the actions do not re-derive the blockers on the server",
  );
  ok("the actions re-derive the preflight and the acknowledgement rather than trusting the form");

  assert.ok(
    actions.includes("expected_active"),
    "publication carries no optimistic-concurrency token",
  );
  ok("publication and restoration carry the token the database compares against");

  assert.ok(
    /reasonSchema[\s\S]{0,200}min\(1\)/.test(actions) && actions.includes("p_reason") === false,
    "a restoration can be recorded without a reason",
  );
  assert.ok(actions.includes("restoreRevision"), "restoration does not go through the one write path");
  ok("a restoration requires a stated reason before it reaches the database");

  const clientRoute = await read("src/app/insights/e/[studyId]/page.tsx");
  assert.ok(
    clientRoute.includes("activeComposition"),
    "the client route does not select on an active published revision",
  );
  assert.ok(
    !clientRoute.includes("loadExperienceDraft"),
    "the client route can reach a draft",
  );
  assert.ok(
    !clientRoute.includes("latestRevision"),
    "the client route can reach a revision nobody published",
  );
  ok("the client route reads only the ACTIVE published revision — never a draft, never an unprepared one");

  assert.ok(
    clientRoute.includes('composedLoad.kind === "composed"'),
    "the client route does not branch on whether a composed experience exists",
  );
  ok("a study with no active revision falls through to the legacy dashboard, unchanged");

  const clientLibrary = await read("src/lib/experience/client-experience.ts");
  for (const internal of ["preparedNote", "acknowledgedWarnings", "preparedBy", "studyFingerprint"]) {
    assert.ok(
      !clientLibrary.includes(internal),
      `the client-facing loader carries \`${internal}\` into a client payload`,
    );
  }
  ok("no internal review field — note, acknowledgement, author, fingerprint — reaches a client payload");

  const renderer = await read("src/components/insights/PublishedExperience.tsx");
  for (const internal of ["revisión", "Revisión", "borrador", "publicar", "Studio"]) {
    assert.ok(
      !renderer.includes(`>${internal}`),
      `the client renderer prints the internal word “${internal}”`,
    );
  }
  assert.ok(!renderer.includes("definitionSha256"), "the client renderer prints a definition hash");
  ok("the client renderer prints no revision number, no hash and no internal vocabulary");

  const renderers = await read("src/components/studio/experience/Charts.tsx");
  const blockView = await read("src/components/studio/experience/BlockView.tsx");
  assert.ok(
    renderers.includes("if (useIsClient()) return null;"),
    "the empty-state renderer still prints an author's instruction to a client",
  );
  assert.ok(
    blockView.includes("useIsClient()"),
    "the block renderer cannot tell who it is drawing for",
  );
  assert.ok(
    renderer.includes('AudienceProvider audience="client"'),
    "the client renderer does not declare who is reading",
  );
  ok("the leaf renderers know who is reading, and draw no author's instruction to a client");

  const publicationLib = await read("src/lib/experience/publication.ts");
  assert.ok(publicationLib.startsWith('import "server-only";'), "the publication reader is not server-only");
  ok("the publication reader is server-only, so no bundle can pull it into a browser");

  const historyPage = await read("src/app/studio/e/[studyId]/publicar/historial/page.tsx");
  const revisionPage = await read("src/app/studio/e/[studyId]/publicar/revision/[revisionId]/page.tsx");
  for (const [name, source] of [
    ["historial", historyPage],
    ["revision", revisionPage],
  ]) {
    assert.ok(source.includes("requireInternal()"), `${name} does not authorize before reading`);
  }
  ok("the history and the revision preview authorize server-side before they read anything");

  assert.ok(
    !historyPage.includes("updateRevision") && !historyPage.includes("saveRevision"),
    "the history screen offers a way to edit a revision",
  );
  ok("the history screen has no control that could edit a historical revision");

  assert.ok(historyPage.includes("HISTORY_PAGE_SIZES"), "the history screen does not page");
  ok("the history pages, so a study with a hundred revisions does not silently show ten");
}

// =============================================================================
section("10. The canvas fits itself without taking the choice away");
// =============================================================================
{
  const builder = await readFile(
    new URL("../src/components/studio/experience/ExperienceBuilder.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(builder.includes("zoomChosen"), "the editor cannot tell its own choice from a person's");
  ok("the editor records whether a person chose the scale or it did");

  assert.ok(
    builder.includes("const zoomIsAutomatic = !chrome.zoomChosen && !previewFits;"),
    "the automatic fit does not depend on both facts",
  );
  ok("the fit is automatic only when nobody chose AND the previewed width does not fit");

  assert.ok(
    builder.includes("setChrome({ zoom: next, zoomChosen: true })"),
    "choosing a scale does not stop the editor overriding it",
  );
  ok("choosing a scale — 100 % included — stops the automatic decision for the session");

  assert.ok(
    builder.includes("const previewFits = canvasRoom === 0 || canvasRoom >= previewWidth;"),
    "the fit is decided from something other than measurement",
  );
  assert.ok(builder.includes("onRoom(entry.contentRect.width)"), "the canvas does not report its room");
  ok("the decision is re-answered from measurement, so hiding or restoring a panel recalculates it");

  assert.ok(
    builder.includes('"--canvas-scale": String(scale)'),
    "the canvas does not publish its scale for its own controls to compensate for",
  );
  assert.ok(
    builder.includes('minHeight: "calc(2.75rem / var(--canvas-scale, 1) + 1px)"'),
    "the editor's controls do not compensate for the canvas scale",
  );
  assert.ok(
    builder.includes('minWidth: "calc(2.75rem / var(--canvas-scale, 1) + 1px)"'),
    "the editor's controls compensate in one dimension only",
  );
  ok("the block chrome sizes itself as 44 px divided by the scale, so a target stays 44 px on screen");

  /*
   * THE EXTRA PIXEL, CHECKED ARITHMETICALLY.
   *
   * A live sweep reported the drag handle at "44 x 44" and refused it, because
   * 44 / 0.6125 x 0.6125 comes back as 43.99. The compensation has to clear the
   * threshold rather than meet it, at every scale the fit can produce.
   */
  for (const scale of [0.4, 0.5, 0.6125, 0.75, 0.9, 1]) {
    const physical = (44 / scale + 1) * scale;
    assert.ok(physical >= 44, `a compensated target measures ${physical} at scale ${scale}`);
  }
  ok("the compensation clears 44 px at every scale the automatic fit can produce, not just meets it");

  const explore = await readFile(
    new URL("../src/components/studio/experience/ExploreViews.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    explore.includes("if (!onChange) {"),
    "the canvas still draws a filter control as an operable form element",
  );
  assert.ok(
    !/disabled=\{onChange === null\}/.test(explore),
    "a disabled select is still drawn where nobody is exploring",
  );
  ok("a filter control with nobody exploring is drawn as a picture, not as a disabled form control");

  assert.ok(
    builder.includes("CHROME_PREFERENCE_KEY") && builder.includes("sessionStorage"),
    "the scale is not remembered where the rest of the chrome is",
  );
  assert.ok(
    !/setChrome\([^)]*definition/.test(builder),
    "a chrome preference is written into the document",
  );
  ok("the scale lives in sessionStorage beside the panel state and never touches the document");
}

// =============================================================================
section("11. A published document is still the strict boundary");
// =============================================================================
{
  const document = baseDocument();
  const parsed = parseExperienceDefinition(JSON.parse(JSON.stringify(document)));
  assert.equal(parsed.ok, true, `a document this gate builds is refused: ${JSON.stringify(parsed)}`);
  ok("everything this gate publishes satisfies the same strict boundary a browser's post does");

  const foreign = { ...document, metadata: { ...document.metadata, studyId: mintId("page", "x") } };
  assert.equal(
    parseExperienceDefinition(foreign).ok,
    false,
    "a document naming a study identifier that is not a uuid was accepted",
  );
  ok("a document whose metadata is not a real study reference is refused before anything stores it");
}

console.log(`\nOK — ${checks} publication checks passed.`);
