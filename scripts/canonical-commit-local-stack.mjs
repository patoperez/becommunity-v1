// =============================================================================
// Drive the HOSTED gate against a LOCAL PostgREST stack
//   BECOMMUNITY_POSTGREST_BIN=$HOME/becommunity-postgrest/postgrest \
//   CANONICAL_COMMIT_TEST_PGHOST=$HOME/becommunity-pg/socket \
//   CANONICAL_COMMIT_TEST_PGUSER=$(id -un) \
//     npm run test:canonical-commit-local-stack
// =============================================================================
// This machine has no container runtime and no `sudo`, so `supabase start` is
// unavailable. This is the substitute: the same disposable PostgreSQL cluster
// the level-2 gate uses, with the real PostgREST binary in front of it and
// locally minted role JWTs, driving the SAME hosted runner that a real project
// would get.
//
// It creates one disposable database, applies the bootstrap and migrations
// 0000-0024 verbatim, starts PostgREST and the path shim, then executes
// `scripts/canonical-commit-hosted-test.mjs` as a child process with the
// environment that gate demands — so the gate's own authorization guard is
// exercised for real rather than bypassed.
//
// EVERY KEY IS MINTED FOR THIS RUN AND DIES WITH IT. Nothing is read from a
// file, nothing is written to one, and no key is printed.
//
// A GREEN RUN HERE IS NOT LEVEL 3. It proves PostgREST, the JSON body, the
// error mapping and the role-JWT path. It does NOT prove the hosted API
// gateway's body limit, the hosted statement timeout, or Supabase's own
// catalogue. Those stay hosted-only.
// =============================================================================

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import {
  ENV_ACKNOWLEDGE,
  ENV_ANON_KEY,
  ENV_API_URL,
  ENV_AUTHENTICATED_KEY,
  ENV_PREFIX,
  ENV_REF,
  ENV_SERVICE_KEY,
  LOCAL_REF,
  acknowledgementFor,
} from "./lib/hosted-target.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const BINARY = process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

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

console.log("Be Community — hosted gate over a LOCAL PostgREST stack");
console.log("=".repeat(78));
console.log(`  postgrest binary: ${BINARY}`);

let exitCode = 1;

await withDisposableDatabase(target, "localstack", async (db) => {
  console.log("\n[stack] applying the bootstrap and migrations 0000-0024");
  psqlSuiteTransport(db).prepare();

  console.log("[stack] starting PostgREST and the /rest/v1 path shim");
  const stack = await startLocalStack(db, { binary: BINARY, target });
  console.log(`  api: ${stack.apiOrigin}   server: ${(await stack.serverHeader()) ?? "unreported"}`);

  try {
    exitCode = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", join(ROOT, "scripts", "canonical-commit-hosted-test.mjs")],
        {
          stdio: "inherit",
          env: {
            ...process.env,
            [ENV_REF]: LOCAL_REF,
            [ENV_ACKNOWLEDGE]: acknowledgementFor(LOCAL_REF),
            [ENV_API_URL]: stack.apiOrigin,
            [ENV_SERVICE_KEY]: stack.serviceKey,
            [ENV_ANON_KEY]: stack.anonKey,
            [ENV_AUTHENTICATED_KEY]: stack.authenticatedKey,
            [ENV_PREFIX]: "U4-LOCAL1",
          },
        },
      );
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally {
    console.log("\n[stack] stopping PostgREST and the shim");
    await stack.stop();
  }
});

console.log(
  "\nNOTE: this is the local substitute for `supabase start`, not a hosted run.\n" +
    "      The gateway body limit, the hosted statement timeout, timeout recovery,\n" +
    "      0022's index against a populated respondent table and catalogue parity\n" +
    "      with Supabase's own extensions remain UNPROVED.",
);
process.exit(exitCode);
