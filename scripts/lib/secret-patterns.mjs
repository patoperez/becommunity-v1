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
  return missed;
}
