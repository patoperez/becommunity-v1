import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Missing Supabase live-test environment.");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: owner, error: ownerError } = await db.from("profiles").select("user_id").eq("role", "internal").limit(1).maybeSingle();
const { data: tenant, error: tenantError } = await db.from("tenant").select("id").limit(1).maybeSingle();
if (ownerError || !owner || tenantError || !tenant) throw new Error("Live test needs one internal profile and one tenant.");

let templateId;
let studyId;
try {
  const payloadV1 = {
    version: 1,
    metricSet: ["nps"],
    segmentationDimensions: [],
    recodingTables: [],
    columnMappings: [],
    journeyDefinition: {},
    dashboardConfig: { sections: ["summary"] },
    qualitativeCategories: [],
  };
  const { data: saved, error: saveError } = await db.rpc("save_study_template", {
    p_template_id: null,
    p_created_by: owner.user_id,
    p_name: `P3 live probe ${Date.now()}`,
    p_description: "temporary automated probe",
    p_preview: { metrics: 1 },
    p_payload: payloadV1,
    p_created_from: null,
  });
  if (saveError) throw saveError;
  templateId = saved.id;
  assert.equal(saved.version, 1);

  const { data: created, error: createError } = await db.rpc("instantiate_study_template", {
    p_template_id: templateId,
    p_created_by: owner.user_id,
    p_tenant_id: tenant.id,
    p_name: `P3 copy probe ${Date.now()}`,
    p_period: null,
  });
  if (createError) throw createError;
  studyId = created.id;

  const payloadV2 = structuredClone(payloadV1);
  payloadV2.metricSet.push("cri");
  const { data: updated, error: updateError } = await db.rpc("save_study_template", {
    p_template_id: templateId,
    p_created_by: owner.user_id,
    p_name: "P3 updated probe",
    p_description: "temporary automated probe",
    p_preview: { metrics: 2 },
    p_payload: payloadV2,
    p_created_from: null,
  });
  if (updateError) throw updateError;
  assert.equal(updated.version, 2);

  const { data: study, error: studyError } = await db.from("study")
    .select("template_snapshot, template_origin_id, template_origin_version")
    .eq("id", studyId).single();
  if (studyError) throw studyError;
  assert.deepEqual(study.template_snapshot.metricSet, ["nps"]);
  assert.equal(study.template_origin_id, templateId);
  assert.equal(study.template_origin_version, 1);
  console.log("Live template test passed: v1 study snapshot stayed unchanged after template advanced to v2.");
} finally {
  if (studyId) await db.from("study").delete().eq("id", studyId);
  if (templateId) await db.from("study_template").delete().eq("id", templateId);
}
