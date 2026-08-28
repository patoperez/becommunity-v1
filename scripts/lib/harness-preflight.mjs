// =============================================================================
// Live-suite preflight — fail for the RIGHT reason, before anything is created.
// =============================================================================
// Two environment faults used to reach the suites disguised as product
// failures, and both cost more to diagnose than they should have:
//
//   STALE FIXTURE CREDENTIALS. A synthetic account removed from Supabase Auth
//   made every sign-in return `invalid_credentials`, the run aborted, and the
//   report said the suite was red. The suite was never exercised at all.
//
//   AN INCOHERENT SERVED BUILD. `next build` and the OpenNext build write into
//   the same `.next` directory, and `next start` serves whatever is there. Run
//   them in the wrong order, or leave an older server running, and the browser
//   is handed client assets from one build while the server resolves Server
//   Actions from another. Actions then fail with "Failed to find Server Action"
//   — which looks exactly like a broken workflow.
//
// Neither is a finding about the product, so neither may be reported as one.
// These checks run BEFORE any fixture object is created and name the exact
// thing to fix. They never print a credential.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";

/** Auth reached, and the account exists with that password. */
async function canSignIn(supabaseUrl, anonKey, email, password, signal) {
  const response = await fetch(new URL("/auth/v1/token?grant_type=password", supabaseUrl), {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal,
  });
  if (response.ok) return { ok: true };
  let code = String(response.status);
  try {
    const body = await response.json();
    // Supabase's own fixed error code. Never the message, which can echo input.
    if (typeof body?.error_code === "string") code = body.error_code;
    else if (typeof body?.error === "string") code = body.error;
  } catch {
    /* the status alone is enough to tell the operator what happened */
  }
  return { ok: false, code };
}

/**
 * Prove every configured synthetic account can still authenticate.
 *
 * `credentials` is `{ actorId: { email, password, envEmail, envPassword } }`.
 * A failure names the ENVIRONMENT VARIABLES, never their values, and says how
 * to restore the account.
 */
export async function assertFixtureCredentials({ supabaseUrl, anonKey, credentials, signal, log = () => {} }) {
  if (!supabaseUrl || !anonKey) {
    throw new Error("preflight: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  const stale = [];
  for (const [actorId, creds] of Object.entries(credentials)) {
    if (!creds?.email || !creds?.password) {
      stale.push(`${actorId}: ${creds?.envEmail ?? "email"} / ${creds?.envPassword ?? "password"} is not set`);
      continue;
    }
    const result = await canSignIn(supabaseUrl, anonKey, creds.email, creds.password, signal);
    if (result.ok) log(`  ${actorId}: the synthetic account authenticates`);
    else stale.push(`${actorId}: ${creds.envEmail} / ${creds.envPassword} rejected (${result.code})`);
  }
  if (stale.length > 0) {
    throw new Error(
      "the synthetic fixture credentials are stale, so NO check could run and the suite is not red:\n" +
        stale.map((line) => `    - ${line}`).join("\n") +
        "\n  These are throwaway accounts in the synthetic project. Recreate them with" +
        "\n  `node --env-file-if-exists=.env.local scripts/seed-test-data.mjs`, or correct the" +
        "\n  environment variables named above. No client, respondent or real user is involved.",
    );
  }
}

/**
 * Prove the running server is serving the build that is on disk.
 *
 * Only meaningful when the suite and the server share a filesystem, so a remote
 * origin is reported and skipped rather than guessed at. `next build` writes
 * `.next/BUILD_ID`, and every page it serves references that same id in its
 * asset URLs; a server left running from an earlier build does not.
 */
export async function assertServedBuildIsCoherent({ origin, signal, log = () => {} }) {
  const host = new URL(origin).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    log(`  build coherence: ${origin} is not local, so the served build cannot be compared to this checkout`);
    return;
  }
  if (!existsSync(".next/BUILD_ID")) {
    throw new Error(
      "preflight: .next/BUILD_ID is missing — there is no build to serve.\n" +
        "  Run the documented order: `rm -rf .next && npm run build && npm run start`.",
    );
  }
  const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  const response = await fetch(new URL("/login", origin), { signal, cache: "no-store" });
  const html = await response.text();
  if (!html.includes(buildId)) {
    throw new Error(
      "preflight: the running server is NOT serving this checkout's build.\n" +
        "  Its pages reference a different build id than .next/BUILD_ID, which means the\n" +
        "  browser would be handed client assets from one build while Server Actions are\n" +
        "  resolved from another — every action then fails with \"Failed to find Server\n" +
        "  Action\" and looks like a broken workflow.\n" +
        "  Stop the running server and repeat the documented order:\n" +
        "    rm -rf .next && npm run build && npm run start\n" +
        "  Never start the app from a `.next` that the OpenNext build has since rewritten:\n" +
        "  run `npm run cf:build` AFTER the live suites, or rebuild before starting.",
    );
  }
  log(`  build coherence: the server is serving this checkout's build`);
}
