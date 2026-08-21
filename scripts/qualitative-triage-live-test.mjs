import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const emailA = process.env.TEST_USER_A_EMAIL;
const passwordA = process.env.TEST_USER_A_PASSWORD;
const emailB = process.env.TEST_USER_B_EMAIL;
const passwordB = process.env.TEST_USER_B_PASSWORD;
assert.ok(url && anon && service && emailA && passwordA && emailB && passwordB, "qualitative live-test env is incomplete");

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
async function signedIn(email, password) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? "empty user"}`);
  return { client, user: data.user };
}

const { client: clientA, user: userA } = await signedIn(emailA, passwordA);
const { client: clientB } = await signedIn(emailB, passwordB);
const { data: profileA, error: profileError } = await clientA.from("profiles").select("tenant_id").eq("user_id", userA.id).single();
if (profileError || !profileA?.tenant_id) throw new Error(`tenant fixture unavailable: ${profileError?.message ?? "empty tenant"}`);
const { data: reviewer, error: reviewerError } = await admin.from("profiles").select("user_id").eq("role", "internal").limit(1).single();
if (reviewerError || !reviewer) throw new Error(`internal reviewer unavailable: ${reviewerError?.message ?? "empty reviewer"}`);

let studyId;
try {
  const { data: study, error: studyError } = await admin.from("study").insert({
    tenant_id: profileA.tenant_id,
    name: `P4B LIVE ${Date.now()}`,
    status: "draft",
  }).select("id").single();
  if (studyError || !study) throw new Error(`study insert failed: ${studyError?.message ?? "empty study"}`);
  studyId = study.id;
  const { data: observation, error: observationError } = await admin.from("qual_observation").insert({
    tenant_id: profileA.tenant_id,
    study_id: studyId,
    source: "encuesta",
    theme: "trato",
    suggested_theme: "atencion_y_servicio",
    quote: "CITA P4B PRIVADA",
  }).select("id").single();
  if (observationError || !observation) throw new Error(`observation insert failed: ${observationError?.message ?? "empty observation"}`);

  const raw = await clientA.from("qual_observation").select("quote").eq("id", observation.id);
  assert.equal(raw.error?.code, "42501", "client must be denied access to raw qualitative text");
  const before = await clientA.from("confirmed_qual_observation").select("*").eq("id", observation.id);
  assert.ifError(before.error);
  assert.equal(before.data.length, 0, "pending suggestion must not be client-visible");

  const deniedRpc = await clientA.rpc("review_qual_observations", {
    p_ids: [observation.id], p_study_id: studyId, p_mode: "accept", p_theme: "",
    p_stage_key: "", p_quote_ids: [], p_reviewer: userA.id,
  });
  assert.ok(deniedRpc.error && ["42501", "PGRST202"].includes(deniedRpc.error.code), "client must not execute review RPC");

  const accepted = await admin.rpc("review_qual_observations", {
    p_ids: [observation.id], p_study_id: studyId, p_mode: "accept", p_theme: "",
    p_stage_key: "admision", p_quote_ids: [], p_reviewer: reviewer.user_id,
  });
  assert.ifError(accepted.error);
  assert.equal(accepted.data, 1);
  const confirmed = await clientA.from("confirmed_qual_observation").select("theme, stage_key, quote").eq("id", observation.id).single();
  assert.ifError(confirmed.error);
  assert.deepEqual(confirmed.data, { theme: "atencion_y_servicio", stage_key: "admision", quote: null });

  const published = await admin.rpc("review_qual_observations", {
    p_ids: [observation.id], p_study_id: studyId, p_mode: "retag", p_theme: "servicio_confirmado",
    p_stage_key: "admision", p_quote_ids: [observation.id], p_reviewer: reviewer.user_id,
  });
  assert.ifError(published.error);
  const withQuote = await clientA.from("confirmed_qual_observation").select("theme, quote").eq("id", observation.id).single();
  assert.ifError(withQuote.error);
  assert.deepEqual(withQuote.data, { theme: "servicio_confirmado", quote: "CITA P4B PRIVADA" });
  const crossTenant = await clientB.from("confirmed_qual_observation").select("id").eq("id", observation.id);
  assert.ifError(crossTenant.error);
  assert.equal(crossTenant.data.length, 0, "another tenant must not see the publication");

  console.log("P4B live gate passed: raw denial, human gate, quote gate, RPC denial, and cross-tenant isolation.");
} finally {
  if (studyId) await admin.from("study").delete().eq("id", studyId);
}
