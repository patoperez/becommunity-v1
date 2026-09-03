// =============================================================================
// A local PostgREST stack — the closest honest substitute for `supabase start`
// =============================================================================
// This machine has no container runtime and no `sudo`, and nothing may be
// installed on it. `supabase start` is therefore unavailable. What IS available
// is the piece that actually matters for level 3: PostgREST itself, as a single
// static binary run as an ordinary user, in front of the same disposable
// PostgreSQL cluster the level-2 gate already creates.
//
// -----------------------------------------------------------------------------
// WHAT THIS REPRODUCES FAITHFULLY
// -----------------------------------------------------------------------------
//   * the HTTP request/response path: supabase-js -> JSON body -> PostgREST ->
//     the function -> a jsonb result -> supabase-js's parsed shape;
//   * PostgREST's error mapping: a `raise … using errcode/message` becomes a
//     JSON body with `code`, `message`, `details`, `hint`, which is what
//     `safeErrorCode` reads;
//   * the KEY path: a JWT carrying `role: service_role` makes PostgREST issue
//     `SET LOCAL ROLE service_role` for that request, so the privileges are the
//     database's, not the connection's;
//   * the request BODY: the plan travels as bytes over a socket, which the psql
//     transport never does because it hands the server a file path.
//
// -----------------------------------------------------------------------------
// WHAT IT DOES NOT REPRODUCE, AND MUST NEVER BE SAID TO
// -----------------------------------------------------------------------------
//   * the hosted API gateway (Kong/Envoy + Cloudflare) and therefore ITS body
//     limit — the only body limit measured here is PostgREST's own;
//   * the hosted project's `statement_timeout` for `service_role`;
//   * Supabase's own extensions, roles and default privileges;
//   * GoTrue — deliberately. T9 needs anon and authenticated JWTs signed with
//     the stack's secret, which are minted here; GoTrue issues user sessions and
//     proves nothing extra about whether the four RPCs refuse those roles.
//
// -----------------------------------------------------------------------------
// THE PATH SHIM, AND WHY THE PRODUCT'S CLIENT IS NOT ADJUSTED
// -----------------------------------------------------------------------------
// supabase-js builds `${url}/rest/v1/rpc/<name>`; a bare PostgREST serves
// `/rpc/<name>`. On a real project Kong strips that prefix. Changing the
// product's client construction to fit the harness would mean the test no longer
// exercises the product, so the difference is absorbed HERE: a ~40-line loopback
// shim strips `/rest/v1` and forwards everything else byte for byte.
//
// Nothing here listens on anything but 127.0.0.1, nothing is installed, and
// `stop()` leaves no process and no file behind.
// =============================================================================

import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class LocalStackError extends Error {}

const refuse = (reason) => {
  throw new LocalStackError(reason);
};

/** The API origin `hosted-target.mjs` recognises for the literal ref `local`. */
export const SHIM_PORT = 54321;
export const POSTGREST_PORT = 3000;

/**
 * Mint an HS256 JWT for one PostgREST role.
 *
 * PostgREST reads `role` (jwt-role-claim-key defaults to `$.role`) and switches
 * to that database role for the request. `exp` is optional but set anyway, so a
 * token cannot outlive the run that made it. No dependency: `node:crypto` and
 * base64url are all a JWT is.
 */
export function mintJwt(secret, role, ttlSeconds = 3600) {
  const b64u = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${b64u({ alg: "HS256", typ: "JWT" })}.` +
    b64u({ role, iss: "becommunity-local", iat: now, exp: now + ttlSeconds });
  return `${signingInput}.${createHmac("sha256", secret).update(signingInput, "utf8").digest("base64url")}`;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `check()` resolves true, or refuse after `timeoutMs`. */
async function waitFor(label, check, timeoutMs = 30_000, diagnose = null) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) refuse(`${label} did not become ready within ${timeoutMs} ms. ${diagnose?.() ?? ""}`);
    await delay(250);
  }
}

/**
 * The loopback path shim.
 *
 * It exists only to strip the `/rest/v1` prefix supabase-js hardcodes, which a
 * hosted project's gateway strips for it. Method, headers and body are
 * forwarded unchanged, so the request PostgREST sees is the request the product
 * built.
 */
function startShim(port, upstreamPort) {
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url.startsWith("/rest/v1") ? incoming.url.slice("/rest/v1".length) || "/" : incoming.url;
    const headers = { ...incoming.headers };
    delete headers.host;
    const upstream = httpRequest(
      { host: "127.0.0.1", port: upstreamPort, method: incoming.method, path, headers },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.on("error", (error) => {
      outgoing.writeHead(502, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ message: `shim upstream error: ${error.code ?? error.message}` }));
    });
    incoming.pipe(upstream);
  });
  server.listen(port, "127.0.0.1");
  return server;
}

/**
 * Start PostgREST and the shim in front of one disposable database.
 *
 * `db` is a `DisposablePostgres`. The caller has already applied the bootstrap
 * and every migration; this adds only the login role PostgREST needs, which
 * Supabase calls `authenticator`.
 */
export async function startLocalStack(db, { binary, target }) {
  if (!existsSync(binary)) {
    refuse(
      `no PostgREST binary at ${binary}. Fetch the official static release first; ` +
        "this module downloads nothing by itself.",
    );
  }
  if (!target.isSocket) refuse("the local stack runs only against a unix-socket cluster.");

  // A fresh secret per run, never written anywhere but the 0600 config file.
  const secret = randomBytes(48).toString("base64url");

  // The login role PostgREST authenticates as. `noinherit` matches Supabase's
  // own `authenticator`: it holds the three roles but has none of their rights
  // until PostgREST issues `SET LOCAL ROLE` for the request's JWT claim.
  db.run(
    `do $auth$
     begin
       if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticator') then
         create role authenticator login noinherit;
       end if;
     end $auth$;
     grant anon, authenticated, service_role to authenticator;
     grant usage on schema public to authenticator;
     -- Supabase's PostgREST runs with db-extra-search-path = public,extensions,
     -- and refuses to build its schema cache if a named schema is missing. The
     -- disposable cluster has no Supabase extensions, but the SCHEMA is part of
     -- the configuration under test, so it exists here and stays empty.
     create schema if not exists extensions;
     grant usage on schema extensions to anon, authenticated, service_role, authenticator;`,
  );

  const scratch = mkdtempSync(join(tmpdir(), "bc-postgrest-"));
  const configPath = join(scratch, "postgrest.conf");
  writeFileSync(
    configPath,
    [
      // libpq keyword/value form: a unix-socket directory is a path, and a path
      // in a URI would have to be percent-encoded. PostgREST accepts both.
      `db-uri = "host=${target.host} user=authenticator dbname=${db.database}"`,
      'db-schemas = "public"',
      'db-anon-role = "anon"',
      'db-extra-search-path = "public, extensions"',
      `jwt-secret = "${secret}"`,
      `server-host = "127.0.0.1"`,
      `server-port = ${POSTGREST_PORT}`,
      "db-pool = 4",
      "db-max-rows = 100000",
      // `info` is available through BECOMMUNITY_POSTGREST_LOG when a run needs to
      // see why the schema cache failed; the default stays quiet.
      `log-level = "${process.env.BECOMMUNITY_POSTGREST_LOG ?? "error"}"`,
    ].join("\n") + "\n",
    { mode: 0o600 },
  );

  const child = spawn(binary, [configPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdout.on("data", (chunk) => (stderr += chunk));

  const shim = startShim(SHIM_PORT, POSTGREST_PORT);
  const serviceKey = mintJwt(secret, "service_role");

  const reachable = async () => {
    try {
      const answer = await fetch(`http://127.0.0.1:${SHIM_PORT}/rest/v1/`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      return answer.status < 500;
    } catch {
      if (child.exitCode !== null) refuse(`PostgREST exited (${child.exitCode}). ${stderr.slice(-400)}`);
      return false;
    }
  };
  await waitFor("PostgREST", reachable, 30_000, () =>
    `exit=${child.exitCode} stderr=${stderr.trim().slice(0, 1400) || "(silent)"}`);

  return {
    apiOrigin: `http://127.0.0.1:${SHIM_PORT}`,
    serviceKey,
    anonKey: mintJwt(secret, "anon"),
    authenticatedKey: mintJwt(secret, "authenticated"),
    /** The PostgREST version, read from its own `Server` header. */
    async serverHeader() {
      try {
        const answer = await fetch(`http://127.0.0.1:${SHIM_PORT}/rest/v1/`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        return answer.headers.get("server");
      } catch {
        return null;
      }
    },
    async stop() {
      shim.close();
      child.kill("SIGTERM");
      await delay(300);
      if (child.exitCode === null) child.kill("SIGKILL");
      rmSync(scratch, { recursive: true, force: true });
    },
  };
}
