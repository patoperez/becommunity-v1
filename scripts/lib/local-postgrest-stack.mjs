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
export function mintJwt(secret, role, ttlSeconds = 3600, claims = {}) {
  const b64u = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    `${b64u({ alg: "HS256", typ: "JWT" })}.` +
    b64u({ ...claims, role, iss: "becommunity-local", iat: now, exp: now + ttlSeconds });
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
function startShim(port, upstreamPort, auth = null) {
  const server = createServer((incoming, outgoing) => {
    if (auth && incoming.url.startsWith("/auth/v1")) {
      serveAuth(auth, incoming, outgoing);
      return;
    }
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

/* -------------------------------------------------------------------------- */
/* THE AUTHENTICATION SUBSTITUTE — opt-in, and deliberately minimal            */
/* -------------------------------------------------------------------------- */
/**
 * WHAT THIS IS, AND WHY IT IS NOT A SECURITY HOLE.
 *
 * Browser QA of anything behind a login needs a login. `supabase start` would
 * bring GoTrue; this machine has no container runtime, so level-3 QA of the
 * durable draft had a choice between running against the HOSTED project — which
 * for this unit would mean writing canonical drafts into it, which is exactly
 * what the phase forbids — and standing up the smallest believable substitute
 * for GoTrue in front of the disposable cluster. This is that substitute.
 *
 * It is safe for four reasons, and every one of them is asserted rather than
 * asserted-to-be:
 *
 *   IT IS OFF UNLESS ASKED. `startLocalStack` builds it only when a caller
 *   passes `authUsers`. Every existing caller passes nothing and gets exactly
 *   the stack it had before.
 *
 *   IT ONLY EVER SITS IN FRONT OF A DISPOSABLE UNIX-SOCKET CLUSTER. The stack
 *   refuses any other target, and `resolveDisposableTarget` refuses to produce
 *   one at all if a Supabase environment variable is in scope.
 *
 *   IT MINTS NOTHING IT WAS NOT GIVEN. The identities are passed in by the
 *   caller and signed with the per-run random secret this module already
 *   generates for PostgREST. There is no user store, no registration, no
 *   password reset and no way to become a user nobody named.
 *
 *   IT LISTENS ON LOOPBACK ONLY, on the shim this module already starts.
 *
 * It is NOT GoTrue and must never be described as one: no refresh rotation, no
 * email confirmation, no MFA, no session revocation, no rate limiting.
 */
function serveAuth(auth, incoming, outgoing) {
  const send = (status, body) => {
    const text = JSON.stringify(body ?? {});
    outgoing.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
    outgoing.end(text);
  };
  const url = new URL(incoming.url, "http://127.0.0.1");
  const path = url.pathname.slice("/auth/v1".length) || "/";

  if (path === "/health" || path === "/settings") return send(200, { version: "becommunity-local" });

  const sessionFor = (user) => {
    const accessToken = mintJwt(auth.secret, "authenticated", 3600, {
      sub: user.id,
      email: user.email,
      aud: "authenticated",
      // GoTrue puts the role here too; supabase-js reads `user.role` from the
      // user object rather than the claim, so both are supplied.
      user_metadata: {},
      app_metadata: { provider: "email" },
    });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `local-refresh-${user.id}`,
      user: publicUser(user),
    };
  };

  const publicUser = (user) => ({
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email,
    email_confirmed_at: "2020-01-01T00:00:00.000Z",
    phone: "",
    confirmed_at: "2020-01-01T00:00:00.000Z",
    last_sign_in_at: "2020-01-01T00:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2020-01-01T00:00:00.000Z",
    updated_at: "2020-01-01T00:00:00.000Z",
    is_anonymous: false,
  });

  const bearerUser = () => {
    const header = incoming.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // VERIFY THE SIGNATURE. A shim that accepted any well-shaped token would
    // make the QA it supports meaningless: the product's own `getUser()` is the
    // thing under test on every authorized route.
    const expected = createHmac("sha256", auth.secret)
      .update(`${parts[0]}.${parts[1]}`, "utf8")
      .digest("base64url");
    if (expected !== parts[2]) return null;
    let claims;
    try {
      claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    } catch {
      return null;
    }
    if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return auth.users.find((candidate) => candidate.id === claims.sub) ?? null;
  };

  if (path === "/user" && incoming.method === "GET") {
    const user = bearerUser();
    return user ? send(200, publicUser(user)) : send(401, { code: 401, message: "invalid claim" });
  }

  if (path === "/logout") return send(204, null);

  if (path === "/token" && incoming.method === "POST") {
    let raw = "";
    incoming.on("data", (chunk) => (raw += chunk));
    incoming.on("end", () => {
      let body = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        return send(400, { error: "invalid_request" });
      }
      const grant = url.searchParams.get("grant_type");
      if (grant === "refresh_token") {
        const user = auth.users.find((candidate) => `local-refresh-${candidate.id}` === body.refresh_token);
        return user
          ? send(200, sessionFor(user))
          : send(400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      }
      const user = auth.users.find(
        (candidate) => candidate.email === body.email && candidate.password === body.password,
      );
      return user
        ? send(200, sessionFor(user))
        : send(400, { error: "invalid_grant", error_description: "Invalid login credentials" });
    });
    return;
  }

  return send(404, { message: "not found" });
}

/**
 * Start PostgREST and the shim in front of one disposable database.
 *
 * `db` is a `DisposablePostgres`. The caller has already applied the bootstrap
 * and every migration; this adds only the login role PostgREST needs, which
 * Supabase calls `authenticator`.
 */
export async function startLocalStack(db, { binary, target, authUsers = null }) {
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

  const shim = startShim(
    SHIM_PORT,
    POSTGREST_PORT,
    authUsers ? { secret, users: authUsers } : null,
  );
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
