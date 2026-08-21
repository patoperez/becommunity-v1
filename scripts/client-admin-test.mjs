import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const actions = await readFile(new URL("../src/app/admin/clients/actions.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/admin/clients/page.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");

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
assert.match(dashboard, /href="\/admin\/clients"/, "internal users need a path to the backoffice");

console.log("Client and user backoffice gate: PASS");
