# P7 supply-chain review — dependency advisories, Suite D, and CI

> **Scope:** P7 PR 3 (`p7b-supply-chain`). Per-advisory reachability analysis,
> the remediation actually applied, and the gate that keeps the result enforced.
> Read `CLAUDE.md` and `docs/CURRENT_STATE.md` first; this document does not
> replace them.
>
> **Inventory date:** 2026-08-22, against `origin/main` `d87ce6a`.
> **Node 24.11.1 · npm 11.6.2.**

---

## 1. Result

| | Before | After |
|---|---|---|
| critical | 0 | **0** |
| high | **9** | **0** |
| moderate | 3 | **2** |
| low | 0 | 0 |

Every high advisory is remediated by a **patched, non-major** version. No
`npm audit fix --force` was used, no dependency was downgraded, and no exception
was taken: `security/dependency-exceptions.json` is **empty**, and nothing in
this PR requires human exception approval.

Two moderate advisories remain. They share one root cause (`uuid` reached
through `exceljs`), the only offered fix is a **semver-major downgrade** of a
runtime dependency, and the vulnerable code path is not reachable. They are
**residual, documented and unexcepted** — recorded in §3, never approved away.
Suite D blocks on critical/high only, so no exception was needed or created.

---

## 2. Advisory-by-advisory analysis

Reachability classes: **Worker runtime** (code that can execute inside the
deployed Worker) · **build-time** (runs during `next build` / `cf:build`, never
shipped) · **dev-only** (local tooling and tests).

| # | Package (installed → now) | Advisory / severity | Dependency path from the root | Class | Reachability evidence | Remediation | Residual |
|---|---|---|---|---|---|---|---|
| 1 | `next` 16.2.9 → **16.3.2** | GHSA-6gpp-xcg3-4w24 middleware/proxy bypass · **high** (+ GHSA-m99w-x7hq-7vfj DoS, GHSA-89xv-2m56-2m9x SSRF, GHSA-p9j2-gv94-2wf4 rewrite SSRF, 5 moderate) | direct `dependencies.next` | **Worker runtime** | The Worker *is* the Next server. `src/middleware.ts` is the session/auth gate. See §4 for the dedicated analysis | Patched minor 16.3.2 (≥16.2.11 clears the advisories; 16.3.2 additionally carries patched `postcss`) | none |
| 2 | `postcss` 8.5.15 / 8.4.31 → **8.5.26 / 8.5.23** | GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849 arbitrary `.map` read via `sourceMappingURL` · **high** | `@tailwindcss/postcss` → `postcss` (dev) **and** `next` → `postcss` (pinned exactly by Next) | **build-time** | PostCSS runs in the Tailwind/Next CSS pipeline during `next build`; the deployed Worker serves precompiled CSS and never parses author CSS. The attack needs attacker-controlled CSS, which only the repository provides | `next` 16.3.2 pins `postcss` 8.5.23; `@tailwindcss/postcss` 4.3.3 resolves 8.5.26 | none |
| 3 | `nanoid` 3.3.15 → **3.3.18** | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 infinite loop on non-positive size · **high** | `postcss` → `nanoid` | **build-time** | Reached only through PostCSS's source-map machinery at build; no application code calls `nanoid`, and `size` is never attacker-supplied | in-range lockfile update | none |
| 4 | `brace-expansion` 1.1.15 / 2.1.1 / 5.0.7 → **1.1.18 / 2.1.4 / 5.0.9** | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 glob DoS · **high** | `eslint`/`glob` → `minimatch` → `brace-expansion` (dev); `@opennextjs/cloudflare` → `minimatch` → … (build); `exceljs` → `archiver` → `readdir-glob` → `minimatch` → … (prod tree) | **build-time / dev-only** | Glob patterns come from `eslint.config.mjs`, OpenNext's file tracing, and ExcelJS's archiver — all repository-controlled. The Worker never expands a user-supplied glob; ExcelJS's *write*/archive path is not used at all (we only read `.xlsx`, through the browser build) | in-range lockfile update on all five nodes | none |
| 5 | `js-yaml` 4.3.0 → **4.3.1** | GHSA-5p4m-2wfm-xmqj quadratic CPU in `!!omap` · **high** | `eslint` → `@eslint/eslintrc` → `js-yaml` | **dev-only** | Loaded only when ESLint reads a YAML config. This repository's ESLint config is `eslint.config.mjs`; no YAML is parsed from an untrusted source | in-range lockfile update | none |
| 6 | `sharp` 0.34.5 → **0.35.3** (and 0.35.2 under miniflare) | GHSA-f88m-g3jw-g9cj inherited libvips CVEs · **high** | `next` → `sharp` (optional, image optimization) and `wrangler` → `miniflare` → `sharp` | **build-time / dev-only** | `sharp` is a native Node addon. It cannot load in workerd, so it is unreachable in the deployed Worker by construction; the app also serves no optimized images through it | `next` 16.3.2 + `wrangler` 4.125.0 | none |
| 7 | `undici` 7.28.0 → **7.29.0** | GHSA-4cwx-7wf7-3272 cross-user disclosure via cache directives · **high** (+4 moderate) | `wrangler` → `miniflare` → `undici` | **dev-only** | Used by Miniflare for the local `wrangler dev` preview. The deployed Worker uses workerd's own `fetch`, not `undici` | `wrangler` 4.125.0 | none |
| 8 | `miniflare` 4.20260630.0 → **5.20260820.0-alpha** | via `sharp` + `undici` · **high** | `wrangler` → `miniflare` | **dev-only** | Local Worker emulator only; never deployed. The alpha-tagged version is `wrangler` 4.125.0's own exact pin, not a range resolution of ours | `wrangler` 4.125.0 | none |
| 9 | `wrangler` 4.106.0 → **4.125.0** | via `miniflare` · **high** | direct `devDependencies.wrangler` | **dev-only** | Deploy/preview CLI. Not part of the Worker bundle | patched minor | none |
| 10 | `@tailwindcss/postcss` 4.3.1 → **4.3.3** | via `postcss` · **moderate** | direct `devDependencies` | **build-time** | Same reasoning as #2 | patched patch release (with `tailwindcss` 4.3.3, which it pins exactly) | none |
| 11 | `uuid` 8.3.2 | GHSA-w5hq-g745-h8pq missing buffer bounds check · **moderate** | `exceljs` → `uuid` | **Worker runtime (dependency), unreachable code path** | The advisory affects `v3`/`v5`/`v6` **when a `buf` argument is passed**. ExcelJS's only call site is `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`, which calls `v4()` with no arguments, on the conditional-formatting **write** path. We only read `.xlsx`, and we load ExcelJS's **prebuilt browser bundle** (`exceljs/dist/exceljs.min.js`, see `src/lib/ingestion/parse.ts`), which carries its own bundled copy — an `overrides` entry would not change the shipped code | **None applied.** npm's only fix is `exceljs@3.4.0`, a semver-major **downgrade** of a runtime dependency | **Moderate — residual, documented, unexcepted** (see §3) |
| 12 | `exceljs` 4.4.0 | inherits #11 · **moderate** | direct `dependencies` | same as #11 | same as #11 | same as #11 | **Moderate — residual, documented, unexcepted** |

---

## 3. Residual advisories

`uuid` (#11) and `exceljs` (#12) — one root cause, two rows.

- **Residual, documented, unexcepted.** `security/dependency-exceptions.json` is
  empty. Suite D blocks on critical/high only, so these two do not need — and
  have not received — a §6.3 human approval. They are carried openly in this
  document, not accepted through the register. Nothing in this PR may be
  described as an approved or accepted exception.
- **Not remediated**, because the only offered remediation is a major downgrade
  of a runtime dependency, which would be a larger risk than the advisory.
- **Re-check trigger:** any `exceljs` release that moves off `uuid@8`, or a
  backport to the `uuid@8` line.

---

## 4. The Next.js middleware advisory (human-review zone)

GHSA-6gpp-xcg3-4w24 describes a **middleware/proxy bypass in App Router
applications using Turbopack and a single locale**. Our build does run Turbopack
(`▲ Next.js 16.3.2 (Turbopack)`), so the advisory is treated as applicable and
patched rather than argued away. For completeness, `next.config.ts` configures no
`i18n` and the app has no locale segment, so the "single locale" precondition is
not met here either.

**The upgrade requires no authorization redesign, and none was made:**

- `src/middleware.ts` keeps the **`middleware`** file convention on the **Edge**
  runtime. The `proxy` convention still forces the Node runtime, which OpenNext
  rejects; Next 16.3.2 emits the same deprecation notice as 16.2.9 and continues
  to support `middleware.ts`. The build output still reports `ƒ Proxy
  (Middleware)`, and the route table is byte-for-byte unchanged.
- `src/lib/supabase/middleware.ts` is untouched: the same `matcher`, the same
  per-request CSP nonce forwarded on request headers, the same
  `supabase.auth.getUser()` call (never `getSession()`), and the same
  public-route list (`/login`, `/`, `/api/health`).
- **No middleware check was relaxed, skipped, or reordered to make the upgrade
  build.** Nothing in `src/**` changed in this PR at all.
- The bypass class is contained by design even when it lands: middleware is
  documented as *one* layer. Every protected Server Component re-checks
  authorization server-side, and RLS enforces tenant isolation at the database.
  That is not a reason to skip the patch; it is why the patch is not the only
  control.

---

## 5. Suite D — what the gate actually asserts

`npm run suite:d` (`scripts/suite-d-supply-chain.mjs`). Deterministic, no
credentials, no network mutation, no writes to the repository.

| Check | Assertion | Fails when |
|---|---|---|
| **D-a** audit | `npm audit --json`, parsed | any **critical or high** advisory that is not matched by a *complete, human-approved* §6.3 register entry. Moderate/low are reported, never blocking |
| **D-b** pins | every `dependencies` / `devDependencies` / `optionalDependencies` value is an exact `x.y.z` | any range (`^`, `~`, `*`, tag, URL) survives — this is R14 made executable |
| **D-c** lockfile | `lockfileVersion ≥ 3`; every resolved package carries an `integrity` hash; every package resolves to `registry.npmjs.org`; `npm ci --dry-run` succeeds | a tampered, hand-edited, or out-of-sync lockfile, or a package pulled from an unexpected host |
| **D-d** history | not a shallow clone; `.gitignore` excludes `.env*`; no `.env` file was ever tracked in any reachable commit; every reachable blob is scanned for secret classes | a secret was ever committed. **A short read is a failure**: the check compares blobs-scanned against blobs-found and goes red on any shortfall, so it can never pass vacuously |
| **D-e** artifacts | delegates to `scripts/secret-leak-test.mjs` over `.next/static` **and** `.open-next` | either artifact is missing, or either contains secret material |
| **D-f** toolchain | `package.json` declares `packageManager: "npm@10.9.2"`; CI pins Node `24.11.1`, installs that exact npm, reads `npm --version` back and exits non-zero on a mismatch, and does so **before** `npm ci`; no other `npm@<spec>` appears in the workflow | the declaration and the workflow drift apart, the npm version floats (`latest`, `^10`, a tag), the pin is installed but never verified, or `npm ci` runs before it |

**Why D-f exists.** npm 10 and npm 11 resolve peer edges beneath a
platform-excluded optional dependency differently. npm 11 prunes those nodes out
of the lockfile; npm 10's `npm ci` still walks the edges and aborts with
`EUSAGE … Missing: @emnapi/runtime@1.11.3 from lock file` before any build runs.
Cloudflare's build image runs **npm 10.9.2**, so a lockfile regenerated under
npm 11 passed every gate here and still broke the deploy build. D-c cannot catch
that on its own: its `npm ci --dry-run` inherits whichever npm invoked it, so it
was green on a developer machine and on CI while the deploy was red.

The fix is one declared authoring version rather than a lockfile edit that any
`npm install` could undo. **Regenerate the lockfile only under npm 10.9.2.** A
regeneration under npm 11 silently drops the compatibility nodes again.

Like the exception matcher, D-f carries its own positive and negative control: a
pure `evaluateToolchain()` is run against a correct pin and against ten synthetic
drift cases (declaration missing, drifted or naming another package manager;
workflow missing; pin removed, floated, unverified or ordered after `npm ci`;
lockfile install removed; Node pin drifted) on **every invocation**, so a
detector that stops detecting shows up as a red gate rather than a silent pass.

**Exception register.** `security/dependency-exceptions.json` requires all seven
§6.3 fields per entry. An entry missing a field, naming a placeholder approver
(`TBD`, an agent name, …), carrying a past `review_date`, or using a
`reachability` value outside `Worker runtime | build-time only | dev-only` is
**rejected and counted as a failure** — an incomplete exception makes the gate
redder, not greener.

Identity is matched **exactly**, never by substring
(`scripts/lib/dependency-exceptions.mjs`). An entry excuses one advisory, on one
package, at one installed version, at one severity: `package_and_version` is
parsed as `name@x.y.z` and the version must be one actually installed per the
lockfile; `advisory_id_and_severity` is parsed as `<GHSA-…|CVE-…> <severity>` and
both halves must match what npm reports. A free-text field that merely *contains*
the package name and the advisory id excuses nothing — which is what the previous
`includes()` matcher would have allowed. A self-test covering wrong version,
wrong severity, wrong advisory id, wrong package, a name containing the
vulnerable one, placeholder approver, expired review date, missing field and
invalid reachability runs inside **D-a on every invocation**, so a regression in
the matcher shows up as a red gate rather than as a silently widened exception.

### The two Suite D commands

Mirrors the §5.1 pattern, for the same reason: a partial run must never be
quotable as a green suite.

| Command | Contains | Exit | Role |
|---|---|---|---|
| `npm run suite:d` | D-a … D-e, including the OpenNext scan | 0 only if everything passed; **fails loudly if a build artifact is missing** | **The merge gate.** Runs on Linux CI |
| `npm run suite:d:local` | D-a … D-d plus the *client-only* artifact scan | 0 on that subset, printing a banner that it is **not** the complete Suite D | The documented Windows path, where `cf:build` cannot run |

Likewise `npm run test:secrets` (complete) versus `npm run test:secrets:client`
(client bundle only, banner, never the gate).

---

## 6. Secret scanning — one matcher, no disclosure

`scripts/lib/secret-patterns.mjs` is the single matcher shared by the artifact
scanner and the history scanner, so the two can never disagree about what counts
as a secret.

Classes: `supabase-secret-key` (`sb_secret_…`) · `service-role-jwt` (a JWT whose
decoded payload claims `role: "service_role"`) · `private-key-block` (PEM) ·
`assigned-secret-env` (a secret-bearing variable **bound to a literal value**) ·
`postgres-url-password`.

Two properties matter:

- **No value is ever printed.** Every function returns class ids and counts.
  Callers print *path + class*, and the artifact scanner additionally searches
  for the configured key by value without ever echoing it. Failure messages name
  files and classes only.
- **The environment-variable NAME stays legal where it is legitimate.** No class
  matches a bare `process.env.SUPABASE_SERVICE_ROLE_KEY`; only a name bound to a
  literal value is a finding. That is why the server bundle may reference the
  variable while an inlined value fails the gate. In the client bundle the bar is
  higher: even the `service_role` identifier is rejected, since a browser asset
  has no reason to name it.
- **A positive and a negative control run on every invocation.** `selfTest()`
  builds synthetic samples *at runtime* — so no credential-shaped literal is
  committed to a file the history scanner itself reads — asserts each class is
  detected, and asserts that a public `anon` JWT is **not** flagged. If the
  matcher breaks, the gate goes red instead of silently passing everything.

### Finding: a local OpenNext build inlines your whole `.env.local`

Extending the scan to `.open-next` immediately proved its worth. On a local
`cf:build` run with `.env.local` present, OpenNext generated:

```
.open-next/cloudflare/next-env.mjs
```

containing `production` and `development` objects with **every variable from
`.env.local` as a literal** — the `service_role` key and the synthetic test-user
passwords included. The new gate fails on it.

- This is a **local build artifact**, gitignored and never committed. It is not
  evidence that the deployed Worker leaks: Cloudflare's build checks out the
  repository, where no `.env*` file exists, so there is nothing to inline. The
  values reach the running Worker as bindings at runtime.
- It **does** mean that `npm run cf:deploy` from a developer machine that has a
  populated `.env.local` would publish a Worker bundle containing those secrets.
  Treat local OpenNext output as secret-bearing: never deploy from it, never
  upload it as a CI artifact, and purge it after a check
  (`docs/CURRENT_STATE.md` already warns about this; the gate now enforces it).
- CI is arranged so the check stays meaningful: no `.env` file is created on the
  runner, so OpenNext inlines nothing, and the canary needle is genuinely
  expected to be absent.

### The history scan caught this PR's own files

On its first run against the committed branch, D-d flagged two blobs — both
added by this PR:

| Blob | Class | Why it matched |
|---|---|---|
| `.github/workflows/ci.yml` | `assigned-secret-env` | the workflow bound `SUPABASE_SERVICE_ROLE_KEY:` directly to a literal canary |
| `scripts/lib/secret-patterns.mjs` | `private-key-block` | the self-test carried a literal PEM header |

Neither was a real credential, and neither pattern was relaxed to clear them.
**The sources were changed instead:** the workflow now carries the needle in a
neutrally named `CI_CANARY_NEEDLE` and binds it to the real variable name only
in the command itself, and the PEM sample is assembled at runtime like the other
samples. Because a committed blob stays reachable, the two gate commits were
re-created before the branch was pushed rather than fixed in a follow-up commit —
a later fix would not have removed the flagged blobs from history, and the gate
would have stayed red forever.

The scanner's positive control still detects every class after the change, which
is the check that this fix did not quietly neuter it.

---

## 7. CI (RD3 / R26) — and what it deliberately does not prove

### The three gate commands

One definition each, composed rather than duplicated:

| Command | Chain | Needs credentials? |
|---|---|---|
| `npm run gates:offline` | `typecheck · lint · npm test · next build · cf:build · suite:d` | **No** |
| `npm run gates:live` | `test:qualitative-live · test:isolation` | **Yes** |
| `npm run gates` | `gates:offline` then `gates:live` | Yes (via `gates:live`) |

`test:secrets` is **not** called separately after `suite:d`: Suite D's D-e already
owns the complete artifact scan, and running it twice would imply two authorities
over the same check. `test:secrets` and `test:secrets:client` remain available on
their own for a focused run.

`npm run gates` therefore requires a successful `cf:build`, so it is
**Linux-capable and currently unavailable on the Windows development machine**,
where `cf:build` hits the documented `EPERM: symlink` limitation. That is stated
rather than worked around: Suite D is not weakened, and `suite:d:local` is never
substituted into a chain that claims to be complete.

**`gates:offline` is credentials-free — it is not network-independent.** It
contacts neither the application, nor Supabase, nor Cloudflare, and it holds no
credential. But `npm audit` inside Suite D queries the npm advisory service, and
`npm ci --dry-run` consults the registry, so the chain needs outbound network
access to npm and its result can change as advisories are published.

### The workflow

`.github/workflows/ci.yml`: one job on `pull_request`, `permissions: contents:
read`, full-history checkout (Suite D needs it), the explicit runner image
`ubuntu-24.04`, and Node pinned to the exact `24.11.1` this branch was verified
against. `actions/checkout` and `actions/setup-node` are referenced by immutable
commit SHA, with the reviewed v4 release named in a comment beside each.

**npm is pinned as deliberately as Node.** `actions/setup-node` does not select
an npm version, and the runner's default is npm 11 — the resolver that produced
the broken lockfile. The job therefore installs exactly `npm@10.9.2`, asserts
`npm --version` is exactly `10.9.2`, and only then runs `npm ci`, so the lockfile
is always validated by the same npm Cloudflare will install it with. The version
is never a range or a tag, and D-f fails if this step and `package.json` drift
apart.

After `npm ci` the job runs **`npm run gates:offline` and nothing else**. There is
one canonical chain, defined in `package.json`; the workflow does not restate the
steps, so CI and a developer's machine cannot drift apart.

**Excluded, and still manual:** `gates:live` (`test:qualitative-live`,
`test:isolation`) plus `test:atomic-live`, `test:templates-live`,
`test:client-admin-live`, `test:tenant-branding-live`, `test:import-center-live`
and `test:responsive-live` — and therefore `npm run gates`, which composes
`gates:live`. Putting synthetic identity credentials into CI would create a new
secret-handling surface for no gain (RD3).

Only obvious canary values are supplied, and only where a check needs a
well-formed input. No repository secret is consumed. Nothing is deployed, no
artifact is uploaded, and neither Supabase nor Cloudflare is contacted.

**`npm run gates` was not weakened to make CI green.** It gained `lint`, and it
still composes every live suite, so it can only be run by a human with
credentials. A green CI run is **not** a green `npm run gates`, and no document
may claim otherwise.

---

## 8. Rollback

The dependency change and the lockfile are one unit:

```bash
git revert <dependency commit>   # package.json + package-lock.json together
npm ci                           # restore the previous tree exactly
```

`package-lock.json` is the rollback artifact — the previous lockfile pins the
exact prior tree. Verify with `npm test` and one bounded health pass (§9.2).
Reverting the gate commit separately is safe and independent: it removes checks
without touching the dependency tree.
