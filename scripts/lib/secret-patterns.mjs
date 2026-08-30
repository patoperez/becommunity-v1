// =============================================================================
// Shared secret-class matcher (P7 Suite D).
// =============================================================================
// One matcher, used by BOTH `scripts/secret-leak-test.mjs` (build artifacts) and
// `scripts/suite-d-supply-chain.mjs` (git history), so the two scanners can never
// disagree about what counts as a secret.
//
// Reporting contract: every function here returns CATEGORY + COUNT metadata only.
// A matched value, a fragment of one, or a decoded token payload is NEVER
// returned, logged, or thrown. Callers print the class id and the location.
// =============================================================================

/** Bytes that mark a blob as binary — skipped rather than scanned as text. */
export function looksBinary(buf) {
  const probe = buf.subarray(0, Math.min(buf.length, 8192));
  for (const byte of probe) if (byte === 0) return true;
  return false;
}

function decodeJwtSegment(segment) {
  try {
    const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Classify a JWT-shaped string WITHOUT disclosing it. Returns the role claim
 * only, which is a fixed vocabulary ("service_role" / "anon" / …) and is not
 * itself secret. Returns null when the string is not a decodable JWT — this is
 * what keeps long base64 chunks in a bundle from being reported as tokens.
 */
export function classifyJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const header = decodeJwtSegment(parts[0]);
  const payload = decodeJwtSegment(parts[1]);
  if (!header || !payload || typeof payload !== "object") return null;
  if (typeof payload.role !== "string" && typeof payload.iss !== "string") return null;
  return typeof payload.role === "string" ? payload.role : "unknown";
}

/**
 * The ways this codebase legitimately READS a privileged variable rather than
 * writing one down. Anchored at the start of the bound expression and followed
 * by a member access, so `env.FOO` matches and `envelope` does not.
 */
const ENV_READ =
  /^(?:globalThis\.process\.env|process\.env|import\.meta\.env|Deno\.env|os\.environ|env)[.[]/;

// Every class is a *value* pattern. None of them match a bare environment
// variable NAME: `process.env.SUPABASE_SERVICE_ROLE_KEY` is legitimate server
// code and must stay allowed. Only a name bound to a literal value is a finding.
export const SECRET_CLASSES = [
  {
    id: "supabase-secret-key",
    description: "Supabase secret/service key in the new `sb_secret_…` format",
    pattern: /sb_secret_[A-Za-z0-9_-]{12,}/g,
  },
  {
    id: "private-key-block",
    description: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: "assigned-secret-env",
    description: "A secret-bearing environment variable bound to a literal value",
    pattern:
      /(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|CLOUDFLARE_API_TOKEN|SUPABASE_DB_PASSWORD)\s*[=:]\s*["']?[A-Za-z0-9_.-]{16,}/g,
    // A NAME BOUND TO A READ OF THE ENVIRONMENT IS NOT A VALUE.
    //
    // The pattern above is deliberately a *value* pattern, and the comment at
    // the head of this list says so — but it only ever tested what came before
    // the separator. `SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY`
    // is an ordinary object literal in a live test harness collecting the
    // variables it requires: the right-hand side is a READ of the environment,
    // is thirty-seven characters of `[A-Za-z0-9_.-]`, and matched. That is the
    // shape the historical blob of `scripts/journey-editor-live-test.mjs`
    // carries, and no rewrite of history can remove it from a reachable commit.
    //
    // This confirm removes exactly that false positive and nothing else:
    //
    //   - a QUOTED right-hand side is a literal by construction and is still a
    //     finding, whatever it contains — which is the shape a real leaked key
    //     takes in a `.env` file, a compiled bundle or a CI definition;
    //   - an UNQUOTED right-hand side is a finding unless it begins with a
    //     recognised read of the environment, anchored at its first character.
    //
    // It is a precision fix, not a relaxation. `isPrivilegedSupabaseKey`, the
    // value-independent `privilegedEnvNames` snapshot check and every other
    // class here are untouched, and `selfTest()` below now carries both the
    // positive control (a literal is still reported) and the negative control
    // (an environment read is not), so the fix cannot silently regress.
    confirm: (match) => {
      const bound = match.slice(match.search(/[=:]/) + 1).trim();
      if (/^["']/.test(bound)) return true;
      return !ENV_READ.test(bound);
    },
  },
  {
    id: "postgres-url-password",
    description: "Postgres connection string carrying an inline password",
    pattern: /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/"']+@/g,
  },
  {
    id: "service-role-jwt",
    description: "JWT whose payload claims the `service_role` role",
    pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    // Only a decodable JWT that actually claims service_role is a finding; the
    // anon key is public by design and legitimately ships to the browser.
    confirm: (match) => classifyJwt(match) === "service_role",
  },
];

/**
 * Scan text and return `[{ id, count }]` — never the matched text.
 */
export function scanText(text) {
  const findings = [];
  for (const cls of SECRET_CLASSES) {
    let count = 0;
    for (const match of text.matchAll(cls.pattern)) {
      if (cls.confirm && !cls.confirm(match[0])) continue;
      count += 1;
    }
    if (count > 0) findings.push({ id: cls.id, count });
  }
  return findings;
}

/**
 * Positive control. Builds synthetic samples AT RUNTIME so that no credential-
 * shaped literal is ever committed to this file (which the history scanner
 * itself reads). Returns `[]` when the matcher works, or the ids it failed to
 * detect. Never prints the samples.
 */
export function selfTest() {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const syntheticServiceJwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ role: "service_role", iss: "supabase", ref: "canary" }),
    "CANARYSIGNATURENOTREAL",
  ].join(".");
  const syntheticAnonJwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ role: "anon", iss: "supabase", ref: "canary" }),
    "CANARYSIGNATURENOTREAL",
  ].join(".");

  const dashes = "-".repeat(5);
  const samples = {
    "supabase-secret-key": "sb_secret_" + "CANARY".repeat(3),
    "private-key-block": `${dashes}BEGIN PRIVATE` + ` KEY${dashes}`,
    "assigned-secret-env": 'SUPABASE_SERVICE_ROLE_KEY="' + "CANARYVALUE".repeat(2) + '"',
    "postgres-url-password": "postgresql://user:" + "canarypw" + "@db.example.invalid:5432/postgres",
    "service-role-jwt": syntheticServiceJwt,
  };

  const missed = [];
  for (const [id, sample] of Object.entries(samples)) {
    if (!scanText(sample).some((f) => f.id === id)) missed.push(id);
  }
  // Negative control: the public anon key must NOT be reported.
  if (scanText(syntheticAnonJwt).some((f) => f.id === "service-role-jwt")) {
    missed.push("negative-control:anon-jwt-must-not-match");
  }

  // `assigned-secret-env` distinguishes a WRITTEN value from a READ of the
  // environment. Both directions are controlled, because a fix that only
  // stopped reporting things would be indistinguishable from switching the
  // class off.
  // EVERY sample is assembled at runtime, for the reason this function's header
  // gives: the history scanner reads THIS FILE, so a credential-shaped literal
  // written here would be a finding about the matcher's own controls. The first
  // version of these controls contained one, and Suite D said so.
  const quote = String.fromCharCode(34);
  const literalForms = [
    "SUPABASE_SERVICE_ROLE" + "_KEY=" + quote + "CANARYVALUE".repeat(2) + quote,
    "SUPABASE_SERVICE_ROLE" + "_KEY=" + "CANARYVALUE".repeat(2),
    "CLOUDFLARE_API" + "_TOKEN: " + quote + "CANARYVALUE".repeat(2) + quote,
    // A quoted right-hand side is a literal even when its TEXT looks like code.
    "SUPABASE_SECRET" + "_KEY: " + quote + "process." + "env.CANARYVALUE" + quote,
  ];
  for (const form of literalForms) {
    if (!scanText(form).some((f) => f.id === "assigned-secret-env")) {
      missed.push("assigned-secret-env:literal-must-match");
    }
  }
  // These are the shape the historical blob carries. They match the pattern and
  // must NOT be reported; each is still assembled rather than written out, so
  // the controls stay controls rather than becoming findings of their own.
  const read = (name, expression) => name + ": " + expression + name;
  const environmentReads = [
    read("SUPABASE_SERVICE_ROLE" + "_KEY", "process." + "env."),
    "SUPABASE_SERVICE_ROLE" + "_KEY = " + "process." + "env." + "SUPABASE_SERVICE_ROLE_KEY;",
    read("CLOUDFLARE_API" + "_TOKEN", "env."),
    "SUPABASE_DB" + "_PASSWORD: " + "process." + "env[" + quote + "SUPABASE_DB_PASSWORD" + quote + "]",
    read("SUPABASE_SECRET" + "_KEY", "import.meta." + "env."),
  ];
  for (const form of environmentReads) {
    if (scanText(form).some((f) => f.id === "assigned-secret-env")) {
      missed.push("negative-control:environment-read-must-not-match");
    }
  }

  // The build-time env snapshot check is value-independent, so it needs its own
  // controls: a privileged NAME must be reported even with a harmless value,
  // and the two public NEXT_PUBLIC_ names must never be.
  const poisoned = 'export const production = {"SUPABASE_SERVICE_ROLE_KEY":"x"};';
  const clean =
    'export const production = {"NEXT_PUBLIC_SUPABASE_URL":"https://example.invalid",' +
    '"NEXT_PUBLIC_SUPABASE_ANON_KEY":"public"};';
  if (!privilegedEnvNames(poisoned).includes("SUPABASE_SERVICE_ROLE_KEY")) {
    missed.push("env-snapshot:privileged-name-must-match");
  }
  if (privilegedEnvNames(clean).length !== 0) {
    missed.push("negative-control:public-env-names-must-not-match");
  }
  if (!isPrivilegedSupabaseKey("sb_secret_" + "CANARY".repeat(3))) {
    missed.push("key-format:sb_secret-must-be-recognised");
  }
  if (isPrivilegedSupabaseKey("sb_publishable_" + "CANARY".repeat(3))) {
    missed.push("negative-control:publishable-key-is-not-privileged");
  }

  return missed;
}

// ---------------------------------------------------------------------------
// Build-time env snapshot (P9).
// ---------------------------------------------------------------------------
// The OpenNext Cloudflare adapter compiles the project's `.env` FILES into
// `.open-next/cloudflare/next-env.mjs` and replays them into `process.env`
// inside the Worker. That file therefore ships whatever a `.env.local` on the
// build machine happened to contain — which is how a service_role key reached
// a Worker bundle. Worker secrets are applied FIRST at runtime and take
// precedence, so the snapshot is not needed for a privileged value and must
// never carry one.
//
// This check is deliberately VALUE-INDEPENDENT: a privileged variable NAME in
// the snapshot is a finding even when the value is a canary, because the same
// build performed with the real value would ship the real value.

/** Names that must only ever be resolved from a runtime secret binding. */
const PRIVILEGED_NAME = /\b(?!NEXT_PUBLIC_)[A-Z][A-Z0-9_]*(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE_KEY|API_TOKEN|ACCESS_TOKEN)[A-Z0-9_]*\b/g;

/**
 * Return the privileged environment-variable NAMES declared in a build-time env
 * snapshot. Names are not secret; values are never read, returned or logged.
 */
export function privilegedEnvNames(text) {
  return [...new Set([...text.matchAll(PRIVILEGED_NAME)].map((m) => m[0]))].sort();
}

/**
 * True when a key is a Supabase privileged credential in either supported
 * format — the legacy `service_role` JWT or the current `sb_secret_…` key.
 * Used to tell a real key from a synthetic CI canary WITHOUT printing either.
 */
export function isPrivilegedSupabaseKey(token) {
  if (typeof token !== "string" || token === "") return false;
  if (classifyJwt(token) === "service_role") return true;
  return /^sb_secret_[A-Za-z0-9_-]{12,}$/.test(token);
}
