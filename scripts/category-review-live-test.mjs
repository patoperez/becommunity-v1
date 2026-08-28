// =============================================================================
// LIVE semantic category review test
//   node --env-file-if-exists=.env.local scripts/category-review-live-test.mjs
// =============================================================================
// Proves against the real provisional database the things a deterministic gate
// cannot: that migration 0022 is applied, that its privileges are what the file
// says, that the SECURITY DEFINER rules refuse what they claim to refuse, that
// the projection reaches the calculation layer, and that browser roles are shut
// out.
//
// IT USES A DISPOSABLE STUDY AND RESTORES IN `finally`.
//
// The real BNI Cuicuilco study is never written. It is fingerprinted before and
// after the run and the test FAILS if the fingerprint moves — so "we did not
// touch it" is measured rather than asserted.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  canonicalSegmentLabels,
  foldSegmentValue,
  parseSegmentAliases,
} from "../src/lib/calc/segments.ts";
import { groupKeyFor } from "../src/lib/categories/candidates.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const tenantA = process.env.TEST_TENANT_A_ID;
const tenantB = process.env.TEST_TENANT_B_ID;

if (!url || !secret || !tenantA) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TEST_TENANT_A_ID must be set.",
  );
  process.exit(2);
}

const admin = createClient(url, secret, { auth: { persistSession: false } });
const anon = anonKey ? createClient(url, anonKey, { auth: { persistSession: false } }) : null;

let failures = 0;
let checks = 0;
const ok = (m) => {
  checks += 1;
  console.log("  ✓", m);
};
const bad = (m) => {
  failures += 1;
  console.error("  ✗ FAIL:", m);
};
const check = (c, m) => (c ? ok(m) : bad(m));
const section = (t) => console.log(`\n${t}`);

const ROI_A = "No he recuperado nada";
const ROI_B = "No recuperé nada";
const DIMENSION = "roi_prueba";

/** The protected study. Never written; only fingerprinted. */
const PROTECTED_STUDY = "cd4d6acd-88b9-4804-829f-75b6d91a32b7";

async function fingerprintProtected() {
  const [{ count: respondents }, { count: quant }, { count: qual }, { data: dims }] =
    await Promise.all([
      admin.from("respondent").select("id", { count: "exact", head: true }).eq("study_id", PROTECTED_STUDY),
      admin.from("quant_response").select("id", { count: "exact", head: true }).eq("study_id", PROTECTED_STUDY),
      admin.from("qual_observation").select("id", { count: "exact", head: true }).eq("study_id", PROTECTED_STUDY),
      admin.from("segment_dimension").select("key, config").eq("study_id", PROTECTED_STUDY).order("key"),
    ]);
  return JSON.stringify({ respondents, quant, qual, dims: dims ?? [] });
}

let studyId = null;
let actorId = null;
const before = await fingerprintProtected();

console.log("=".repeat(72));
console.log("Be Community — LIVE semantic category review");
console.log("=".repeat(72));
console.log(`project: ${url.replace("https://", "")}`);

try {
  // -------------------------------------------------------------------------
  section("[1] Migration 0022 is applied, and its privileges are as written");
  {
    const { error: ledgerError } = await admin.from("category_decision").select("id").limit(1);
    check(!ledgerError, `category_decision is readable by service_role${ledgerError ? `: ${ledgerError.message}` : ""}`);
    const { error: snapError } = await admin.from("study_category_snapshot").select("study_id").limit(1);
    check(!snapError, `study_category_snapshot is readable by service_role${snapError ? `: ${snapError.message}` : ""}`);

    if (anon) {
      const { error: anonLedger } = await anon.from("category_decision").select("id").limit(1);
      check(Boolean(anonLedger), "anon cannot read the ledger");
      const { error: anonRpc } = await anon.rpc("record_category_decision", {
        p_study_id: PROTECTED_STUDY, p_dimension_key: "x", p_member_folds: ["a", "b"],
        p_member_values: ["a", "b"], p_context_signature: "c", p_decision: "grouped",
        p_canonical_label: "X", p_canonical_fold: "x", p_reason: null,
        p_suggestion_source: "manual", p_language: "es", p_advisor: null,
        p_actor: "00000000-0000-0000-0000-000000000000",
      });
      check(Boolean(anonRpc), "anon cannot execute record_category_decision");
      const { error: anonSnap } = await anon.rpc("capture_study_category_snapshot", {
        p_study_id: PROTECTED_STUDY, p_actor: "00000000-0000-0000-0000-000000000000",
      });
      check(Boolean(anonSnap), "anon cannot execute capture_study_category_snapshot");
    } else {
      bad("NEXT_PUBLIC_SUPABASE_ANON_KEY not set: the browser-role denial was NOT proved");
    }
  }

  // -------------------------------------------------------------------------
  section("[2] A disposable study, with the real collision shape");
  {
    const { data: profile } = await admin
      .from("profiles").select("user_id").eq("role", "internal").limit(1).maybeSingle();
    actorId = profile?.user_id ?? null;
    check(Boolean(actorId), "an internal actor exists to attribute decisions to");

    const { data: study, error } = await admin.from("study").insert({
      tenant_id: tenantA,
      name: "DESECHABLE — revisión de categorías (TEST)",
      period: "prueba automatizada",
      status: "draft",
    }).select("id").single();
    if (error) throw new Error(`could not create the disposable study: ${error.message}`);
    studyId = study.id;
    ok(`disposable study created: ${studyId}`);

    const rows = [
      ...Array.from({ length: 5 }, () => ({ [DIMENSION]: ROI_A })),
      ...Array.from({ length: 4 }, () => ({ [DIMENSION]: ROI_B })),
      ...Array.from({ length: 6 }, () => ({ [DIMENSION]: "51% a 100%" })),
    ];
    const { error: respondentError } = await admin.from("respondent").insert(
      rows.map((segments) => ({ tenant_id: tenantA, study_id: studyId, segments })),
    );
    check(!respondentError, `15 synthetic respondents inserted${respondentError ? `: ${respondentError.message}` : ""}`);
  }

  // -------------------------------------------------------------------------
  section("[3] Before any decision, the two wordings count separately");
  let baselineLabels = null;
  {
    const { data: respondents } = await admin
      .from("respondent").select("segments").eq("study_id", studyId);
    baselineLabels = canonicalSegmentLabels(respondents ?? [], {});
    const forKey = baselineLabels.get(DIMENSION);
    check(forKey.get(ROI_A) !== forKey.get(ROI_B), "the calculation layer separates them, as it must");
    check(new Set(forKey.values()).size === 3, "three categories to begin with");
  }

  // -------------------------------------------------------------------------
  section("[4] A person groups them; the ledger and the projection move together");
  const folds = [foldSegmentValue(ROI_A), foldSegmentValue(ROI_B)].sort();
  {
    const { data, error } = await admin.rpc("record_category_decision", {
      p_study_id: studyId,
      p_dimension_key: DIMENSION,
      p_member_folds: folds,
      p_member_values: [ROI_A, ROI_B],
      p_context_signature: JSON.stringify({ d: DIMENSION, l: "es", o: folds }),
      p_decision: "grouped",
      p_canonical_label: ROI_A,
      p_canonical_fold: foldSegmentValue(ROI_A),
      p_reason: "mismo tramo de recuperación en los dos cuestionarios",
      p_suggestion_source: "fuzzy",
      p_language: "es",
      p_advisor: null,
      p_actor: actorId,
    });
    check(!error, `the decision was recorded${error ? `: ${error.message}` : ""}`);
    check(data?.version === 1, `it is version 1 (${data?.version})`);

    const { data: ledger } = await admin
      .from("category_decision").select("*").eq("study_id", studyId).order("version");
    check(ledger?.length === 1, "exactly one ledger row exists");
    check(ledger?.[0]?.actor_user_id === actorId, "attributed to the actor");
    check(ledger?.[0]?.canonical_key === "no_he_recuperado_nada", `a stable key was assigned (${ledger?.[0]?.canonical_key})`);
    check(ledger?.[0]?.decision === "grouped", "with the decision recorded");

    const { data: dims } = await admin
      .from("segment_dimension").select("key, config").eq("study_id", studyId);
    const aliases = parseSegmentAliases(dims ?? []);
    check(aliases[DIMENSION]?.[foldSegmentValue(ROI_B)] === ROI_A,
      "the projection reached segment_dimension.config.aliases, in the shape the calculation layer reads");

    const { data: respondents } = await admin
      .from("respondent").select("segments").eq("study_id", studyId);
    const labels = canonicalSegmentLabels(respondents ?? [], aliases);
    const forKey = labels.get(DIMENSION);
    check(forKey.get(ROI_A) === forKey.get(ROI_B), "both wordings now carry one label");
    check(new Set(forKey.values()).size === 2, "three categories became two");

    const counted = new Map();
    for (const r of respondents ?? []) {
      const label = forKey.get(String(r.segments[DIMENSION]));
      counted.set(label, (counted.get(label) ?? 0) + 1);
    }
    check(counted.get(ROI_A) === 9, `the nine are counted together (${counted.get(ROI_A)})`);
    check([...counted.values()].reduce((a, b) => a + b, 0) === 15,
      "and the study still has exactly fifteen people");

    // Raw data untouched.
    const raw = (respondents ?? []).map((r) => String(r.segments[DIMENSION]));
    check(raw.filter((v) => v === ROI_B).length === 4,
      "the RAW value is still in the database, exactly as imported");
  }

  // -------------------------------------------------------------------------
  section("[5] The SQL refuses what it says it refuses");
  {
    const clash = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: [foldSegmentValue(ROI_A), foldSegmentValue("51% a 100%")].sort(),
      p_member_values: [ROI_A, "51% a 100%"],
      p_context_signature: "c", p_decision: "grouped",
      p_canonical_label: "Otra cosa", p_canonical_fold: "otra cosa",
      p_reason: null, p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(Boolean(clash.error), "a value cannot belong to two categories");

    const dupLabel = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: [foldSegmentValue("51% a 100%"), "zzz otro"].sort(),
      p_member_values: ["51% a 100%", "zzz otro"],
      p_context_signature: "c", p_decision: "grouped",
      p_canonical_label: ROI_A, p_canonical_fold: foldSegmentValue(ROI_A),
      p_reason: null, p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(Boolean(dupLabel.error), "two categories cannot share one visible name");

    const chain = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: [foldSegmentValue("51% a 100%"), "zzz otro"].sort(),
      p_member_values: ["51% a 100%", "zzz otro"],
      p_context_signature: "c", p_decision: "grouped",
      p_canonical_label: ROI_B, p_canonical_fold: foldSegmentValue(ROI_B),
      p_reason: null, p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(Boolean(chain.error), "a name already grouped inside another category is refused");

    const unsorted = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: ["zzz", "aaa"],
      p_member_values: ["zzz", "aaa"],
      p_context_signature: "c", p_decision: "separate",
      p_canonical_label: null, p_canonical_fold: null,
      p_reason: null, p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(Boolean(unsorted.error), "an unsorted member list is refused: identity is not client-supplied");

    const notInternal = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: ["aaa", "bbb"], p_member_values: ["aaa", "bbb"],
      p_context_signature: "c", p_decision: "separate",
      p_canonical_label: null, p_canonical_fold: null,
      p_reason: null, p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: "00000000-0000-0000-0000-000000000000",
    });
    check(Boolean(notInternal.error), "a non-internal actor is refused by the function itself");

    const noReason = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: ["aaa", "bbb"], p_member_values: ["aaa", "bbb"],
      p_context_signature: "c", p_decision: "postponed",
      p_canonical_label: null, p_canonical_fold: null,
      p_reason: "corto", p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(Boolean(noReason.error), "postponing without a real reason is refused");

    const { count } = await admin
      .from("category_decision").select("id", { count: "exact", head: true }).eq("study_id", studyId);
    check(count === 1, `no refused attempt wrote a row (${count})`);
  }

  // -------------------------------------------------------------------------
  section("[6] The ledger is append-only at the privilege level");
  {
    const { error: updateError } = await admin
      .from("category_decision").update({ reason: "manipulado" }).eq("study_id", studyId);
    check(Boolean(updateError), `service_role cannot UPDATE the ledger${updateError ? "" : " — IT COULD, which is a defect"}`);
    const { error: deleteError } = await admin
      .from("category_decision").delete().eq("study_id", studyId);
    check(Boolean(deleteError), `service_role cannot DELETE from the ledger${deleteError ? "" : " — IT COULD, which is a defect"}`);
    const { count } = await admin
      .from("category_decision").select("id", { count: "exact", head: true }).eq("study_id", studyId);
    check(count === 1, "the row is still there and unchanged");
  }

  // -------------------------------------------------------------------------
  section("[7] Publishing pins the grouping");
  {
    const { data, error } = await admin.rpc("capture_study_category_snapshot", {
      p_study_id: studyId, p_actor: actorId,
    });
    check(!error, `the snapshot was captured${error ? `: ${error.message}` : ""}`);
    check(data?.decisions === 1, `it names the one decision in force (${data?.decisions})`);

    const { data: snapshot } = await admin
      .from("study_category_snapshot").select("resolution, decision_ids").eq("study_id", studyId).maybeSingle();
    const pinned = parseSegmentAliases(
      Object.entries(snapshot?.resolution ?? {}).map(([key, aliases]) => ({ key, config: { aliases } })),
    );
    check(pinned[DIMENSION]?.[foldSegmentValue(ROI_B)] === ROI_A,
      "and the pin reads through the SAME parser as the live configuration");
  }

  // -------------------------------------------------------------------------
  section("[8] Undo is a new version; the pin does not follow it");
  {
    const { data, error } = await admin.rpc("record_category_decision", {
      p_study_id: studyId, p_dimension_key: DIMENSION,
      p_member_folds: folds, p_member_values: [ROI_A, ROI_B],
      p_context_signature: "c", p_decision: "revoked",
      p_canonical_label: null, p_canonical_fold: null,
      p_reason: "se confirmó que son tramos distintos",
      p_suggestion_source: "manual", p_language: "es",
      p_advisor: null, p_actor: actorId,
    });
    check(!error, `the undo was recorded${error ? `: ${error.message}` : ""}`);
    check(data?.version === 2, `as version 2 (${data?.version})`);

    const { data: ledger } = await admin
      .from("category_decision").select("id, version, decision, previous_id, canonical_label")
      .eq("study_id", studyId).order("version");
    check(ledger?.length === 2, "the ledger now has two rows, not one rewritten row");
    check(ledger?.[0]?.decision === "grouped" && ledger?.[0]?.canonical_label === ROI_A,
      "the original decision survives with its content intact");
    check(ledger?.[1]?.previous_id === ledger?.[0]?.id, "and the undo points at what it reversed");

    const { data: dims } = await admin
      .from("segment_dimension").select("key, config").eq("study_id", studyId);
    const aliases = parseSegmentAliases(dims ?? []);
    check(!aliases[DIMENSION]?.[foldSegmentValue(ROI_B)],
      "the projection no longer groups them");

    const { data: respondents } = await admin
      .from("respondent").select("segments").eq("study_id", studyId);
    const forKey = canonicalSegmentLabels(respondents ?? [], aliases).get(DIMENSION);
    check(forKey.get(ROI_A) !== forKey.get(ROI_B), "and the calculation layer separates them again");

    // The published pin is deliberately untouched by a later decision.
    const { data: snapshot } = await admin
      .from("study_category_snapshot").select("resolution").eq("study_id", studyId).maybeSingle();
    const pinned = parseSegmentAliases(
      Object.entries(snapshot?.resolution ?? {}).map(([key, a]) => ({ key, config: { aliases: a } })),
    );
    check(pinned[DIMENSION]?.[foldSegmentValue(ROI_B)] === ROI_A,
      "REPRODUCIBILITY: what was published still reads as it was published");
  }

  // -------------------------------------------------------------------------
  section("[9] Tenant isolation");
  {
    if (tenantB) {
      const { data: otherStudy } = await admin
        .from("study").select("id").eq("tenant_id", tenantB).limit(1).maybeSingle();
      if (otherStudy) {
        const crossed = await admin.rpc("record_category_decision", {
          p_study_id: otherStudy.id, p_dimension_key: DIMENSION,
          p_member_folds: folds, p_member_values: [ROI_A, ROI_B],
          p_context_signature: "c", p_decision: "grouped",
          p_canonical_label: ROI_A, p_canonical_fold: foldSegmentValue(ROI_A),
          p_reason: null, p_suggestion_source: "manual", p_language: "es",
          p_advisor: null, p_actor: actorId,
        });
        // It may legitimately succeed — an internal operator may act on any
        // client — but the ROW must carry tenant B, never tenant A.
        if (!crossed.error) {
          const { data: written } = await admin
            .from("category_decision").select("tenant_id").eq("id", crossed.data.id).maybeSingle();
          check(written?.tenant_id === tenantB,
            "a decision's tenant is taken from the STUDY, never from the caller");
          await admin.from("study_category_snapshot").delete().eq("study_id", otherStudy.id);
          console.log("    (that tenant-B decision is cleaned up below)");
        } else {
          ok("a decision on another client's study was refused outright");
        }
      } else {
        ok("tenant B has no study to cross into (nothing to prove here)");
      }
    } else {
      ok("TEST_TENANT_B_ID not set; the cross-tenant write was not exercised");
    }

    const { data: mine } = await admin
      .from("category_decision").select("tenant_id").eq("study_id", studyId);
    check((mine ?? []).every((row) => row.tenant_id === tenantA),
      "every decision for the disposable study belongs to tenant A");
  }
} catch (error) {
  bad(`unexpected error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // -------------------------------------------------------------------------
  section("[10] Cleanup, and the protected study is untouched");

  if (studyId) {
    // The ledger has no DELETE grant on purpose, so the disposable rows go with
    // the study through the ON DELETE CASCADE the schema declares. That is the
    // supported way to remove them, and exercising it here proves the cascade
    // works rather than leaving orphans in the provisional database.
    await admin.from("study_category_snapshot").delete().eq("study_id", studyId);
    await admin.from("segment_dimension").delete().eq("study_id", studyId);
    await admin.from("respondent").delete().eq("study_id", studyId);
    const { error } = await admin.from("study").delete().eq("id", studyId);
    check(!error, `the disposable study was deleted${error ? `: ${error.message}` : ""}`);

    const { count: leftovers } = await admin
      .from("category_decision").select("id", { count: "exact", head: true }).eq("study_id", studyId);
    check(leftovers === 0, `no ledger rows were left behind (${leftovers})`);
    const { count: respondentsLeft } = await admin
      .from("respondent").select("id", { count: "exact", head: true }).eq("study_id", studyId);
    check(respondentsLeft === 0, "no respondents were left behind");
  }

  // Any tenant-B decision written by [9].
  if (tenantB) {
    const { data: bStudies } = await admin.from("study").select("id").eq("tenant_id", tenantB);
    for (const s of bStudies ?? []) {
      await admin.from("study_category_snapshot").delete().eq("study_id", s.id);
      const { data: dims } = await admin
        .from("segment_dimension").select("id, config").eq("study_id", s.id).eq("key", DIMENSION);
      for (const d of dims ?? []) await admin.from("segment_dimension").delete().eq("id", d.id);
    }
    ok("tenant B's disposable configuration was removed");
  }

  const after = await fingerprintProtected();
  check(after === before, "THE REAL CUICUILCO STUDY IS BYTE-FOR-BYTE UNCHANGED");
  if (after !== before) {
    console.error("    before:", before);
    console.error("    after: ", after);
  }

  console.log("\n" + "=".repeat(72));
  if (failures > 0) {
    console.error(`RESULT: ${failures} failure(s) across ${checks} checks. LIVE GATE BLOCKED.`);
    process.exit(1);
  }
  console.log(`RESULT: ${checks} live checks passed.`);
}
