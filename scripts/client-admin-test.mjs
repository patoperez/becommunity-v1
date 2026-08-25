import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const actions = await readFile(new URL("../src/app/admin/clients/actions.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/admin/clients/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const studioHome = await readFile(new URL("../src/components/studio/StudioHomeView.tsx", import.meta.url), "utf8");
const studioRoutes = await readFile(new URL("../src/lib/studio/routes.ts", import.meta.url), "utf8");
const studioClientPage = await readFile(new URL("../src/app/studio/clientes/[tenantId]/page.tsx", import.meta.url), "utf8");
const studioPeople = await readFile(new URL("../src/components/studio/ClientPeopleList.tsx", import.meta.url), "utf8");

const roleCheck = actions.indexOf('profile?.role !== "internal"');
const adminClient = actions.indexOf("return { user, admin: createAdminClient() }");
assert.ok(roleCheck >= 0 && adminClient > roleCheck, "service-role access must follow an internal-role check");
assert.match(actions, /inviteUserByEmail/, "client accounts must use the invitation flow");
assert.match(actions, /role: "client"/, "the admin flow may provision client accounts only");
assert.match(actions, /\.upsert\([\s\S]*?onConflict: "user_id"/, "auth-trigger profiles must be completed idempotently");
assert.doesNotMatch(actions, /role:\s*formData/, "role must never be accepted from user input");
assert.match(actions, /parseDataScope/, "scope must use the same fail-closed parser as the enforcement boundary");
assert.match(actions, /deleteUser\(invited\.user\.id\)/, "profile failure must roll back the invited auth account");
assert.match(actions, /\.eq\("role", "client"\)/, "updates must be constrained to client profiles");
assert.match(actions, /accountEmail !== confirmation\.data/, "account deletion must require the exact email");

assert.match(page, /ownProfile\?\.role !== "internal"/, "the page must deny non-internal sessions");
assert.match(page, /data_scope/, "the backoffice must expose data-scope configuration");
assert.match(page, /confirmation_email/, "destructive account deletion must require typed confirmation");
// P8.2 moved the internal home into one shared view rendered by BOTH `/studio`
// and `/dashboard`, and the client backoffice gained its own Studio address.
// The requirement is unchanged — an internal user must be able to reach client
// administration from the home — so the assertion follows the link rather than
// being dropped, and the legacy address is asserted to still be the alias.
assert.match(dashboard, /<StudioHomeView \/>/, "the internal home must render the shared Studio home");
assert.match(studioHome, /STUDIO_CLIENTS/, "internal users need a path to the backoffice");
assert.match(
  studioRoutes,
  /studio: STUDIO_CLIENTS, admin: "\/admin\/clients"/,
  "the legacy client backoffice address must remain a recorded alias",
);
assert.match(studioClientPage, /requireInternal\(\)/, "the Studio client page must deny non-internal sessions");
assert.match(studioPeople, /exactTextFieldName="confirmation_email"/, "destructive account deletion must require typed confirmation");
assert.match(studioPeople, /suspendClientUser/, "suspending access must be a separate, findable action from deletion");
assert.match(studioPeople, /restoreClientUser/, "suspension must be reversible from the same list");

console.log("Client and user backoffice gate: PASS");
