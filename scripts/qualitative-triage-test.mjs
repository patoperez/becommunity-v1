import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { suggestTheme, normalizeTheme } from "../src/lib/qualitative/suggest.ts";

assert.equal(suggestTheme("El trato del personal fue muy amable"), "atencion_y_servicio");
assert.equal(suggestTheme("Necesitamos mejores avisos y comunicación"), "comunicacion");
assert.equal(suggestTheme("Texto sin coincidencias", "Tema General"), "tema_general");
assert.equal(normalizeTheme("  Comunicación / Familias  "), "comunicacion_familias");

const migration = readFileSync(new URL("../supabase/migrations/0008_qualitative_triage.sql", import.meta.url), "utf8");
assert.match(migration, /revoke all privileges on table public\.qual_observation from anon, authenticated/i);
assert.match(migration, /review_status = 'confirmed'/i);
assert.match(migration, /case when observation\.quote_approved then observation\.quote else null end/i);
assert.match(migration, /profile\.tenant_id = observation\.tenant_id/i);
assert.match(migration, /profile\.role = 'client'/i);
assert.match(migration, /revoke all on function public\.review_qual_observations[\s\S]*from public, anon, authenticated/i);

console.log("P4B qualitative triage tests passed: heuristics, human gate, quote gate, and tenant-safe publication.");
