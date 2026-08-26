import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(url && serviceRole, "P8.4 live-test environment is incomplete");

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const marker = `P8E LIVE ${Date.now()}`;
let studyId;

async function transition(actor, action, content = null) {
  const { data, error } = await admin.rpc("transition_study_interpretation", {
    p_study_id: studyId,
    p_actor: actor,
    p_action: action,
    p_content: content,
  });
  assert.ifError(error);
  assert.equal(data.action, action);
}

try {
  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("user_id")
    .eq("role", "internal")
    .limit(1)
    .single();
  assert.ifError(actorError);
  assert.ok(actor?.user_id, "an internal reviewer is required");

  const { data: tenant, error: tenantError } = await admin
    .from("tenant")
    .select("id")
    .limit(1)
    .single();
  assert.ifError(tenantError);

  const { data: study, error: studyError } = await admin
    .from("study")
    .insert({ tenant_id: tenant.id, name: marker, status: "draft" })
    .select("id")
    .single();
  assert.ifError(studyError);
  studyId = study.id;

  const first = {
    whatHappened: "La confianza aparece como el punto que conviene observar.",
    whyItMatters: "Puede influir en cómo las personas viven la experiencia.",
    whatNext: "Conversar con los grupos y contrastar este indicio.",
    evidence: [{ kind: "metric", key: "confidence", label: "Confianza" }],
  };
  await transition(actor.user_id, "draft_saved", first);
  await transition(actor.user_id, "submitted");
  await transition(actor.user_id, "approved");
  await transition(actor.user_id, "published");

  let result = await admin
    .from("study_interpretation")
    .select("review_status, draft_content, published_content")
    .eq("study_id", studyId)
    .single();
  assert.ifError(result.error);
  assert.equal(result.data.review_status, "approved");
  assert.deepEqual(result.data.published_content, first);

  const second = { ...first, whatNext: "Preparar una conversación nueva antes de reemplazar la lectura publicada." };
  await transition(actor.user_id, "draft_saved", second);
  result = await admin
    .from("study_interpretation")
    .select("review_status, draft_content, published_content")
    .eq("study_id", studyId)
    .single();
  assert.ifError(result.error);
  assert.equal(result.data.review_status, "draft");
  assert.deepEqual(result.data.draft_content, second);
  assert.deepEqual(result.data.published_content, first, "a new draft must not replace the client snapshot");

  await transition(actor.user_id, "unpublished");
  result = await admin
    .from("study_interpretation")
    .select("published_content")
    .eq("study_id", studyId)
    .single();
  assert.ifError(result.error);
  assert.equal(result.data.published_content, null);

  const events = await admin
    .from("study_interpretation_event")
    .select("action")
    .eq("study_id", studyId)
    .order("occurred_at", { ascending: true });
  assert.ifError(events.error);
  assert.deepEqual(events.data.map(({ action }) => action), [
    "draft_saved", "submitted", "approved", "published", "draft_saved", "unpublished",
  ]);

  console.log("P8.4 live interpretation lifecycle: PASS");
} finally {
  if (studyId) {
    const deletion = await admin.from("study").delete().eq("id", studyId);
    assert.ifError(deletion.error);
    const residue = await admin.from("study_interpretation_event").select("id").eq("study_id", studyId);
    assert.ifError(residue.error);
    assert.equal(residue.data.length, 0, "P8.4 live test left interpretation residue");
  }
}
