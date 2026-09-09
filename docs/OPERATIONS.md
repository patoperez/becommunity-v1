# Operations — anti-pause, monitoring & the hosted migration log

## Hosted migration log (ref `ontvqazsqiwisdddblif`)

Every migration applied to the hosted project, with the backup taken immediately
before it. The full evidence for each is in `docs/CURRENT_STATE.md`; this table
is here so an incident restore does not have to read that document first.

| applied (UTC) | migration | sha256 | pre-migration backup |
|---|---|---|---|
| 2026-09-06 | `0026`-`0028` canonical chain | see `docs/CANONICAL_STUDY_MODEL.md` | `~/becommunity-backups/u4p4-pre-0026-20260906T055119Z` |
| 2026-09-08 19:14:40-19:14:45 | `0029_canonical_presentation_draft.sql` | `7c49867a…` | `~/becommunity-backups/u6b3b-pre-0029-20260908T190837Z` (`database.dump` `a73dad0f…`) |
| 2026-09-09 00:20:33-00:20:43 | `0030_canonical_publication.sql` | `4cf35320407f68f60d1329a3004468426bb9e278f4982657cd4dd8d2643bb1e9` | `~/becommunity-backups/u6b4b1-pre-0030-20260909T001339Z` (`database.dump` `a22ddd33…`, 1 169 629 bytes) |

All three were applied with `supabase db push` (CLI `2.115.0`) over the **session**
pooler at `aws-0-us-east-2.pooler.supabase.com:5432`, each after a dry run that
proposed that one file and nothing else. The ledger is now **31 rows,
`0000`-`0030`**.

> **`0030` created publication STORAGE and nothing was published into it.** All
> three canonical publication tables are empty, no study points at a current
> publication, and no publication event exists. A non-zero count in any of them
> means something happened that was never authorized —
> `npm run test:canonical-presentation-hosted-fingerprint` fails on it.

**Restoring from one of these backups.** The artifacts live outside every Git
repository, `0700` on the directory and `0600` on the files, and each carries a
`SHA256SUMS`. The full procedure — verify the digests, provision a disposable
PostgreSQL 17, create the roles the ACLs name, restore `pre-data` and `data`,
populate the `auth.users` stand-in from `schema.sql`, then `post-data` — is in
`docs/CURRENT_STATE.md` §"Unit 6B.4B1". Two things that will waste an hour if
they are not known in advance:

- **Use the versioned client**,
  `~/becommunity-pgclient/unpack/usr/lib/postgresql/17/bin/pg_dump` and
  `pg_restore`. `/usr/bin/pg_dump` in that unpack is a symlink to Debian's
  `pg_wrapper`, which dispatches to the newest version installed and will write
  an archive a 17 client cannot read.
- **Restore into a disposable cluster first.** A backup nobody has restored is a
  hope, not a backup. Every backup in the table above was restored and compared
  against its source before the migration beside it was applied.

Rolling a migration back is a different act from restoring: each has a matching
file under `supabase/rollbacks/`, and `0030_drop_canonical_publication.sql`
touches only `0030`'s own objects.

## The free-tier pause trap (§9.1)

## The free-tier pause trap (§9.1)

Supabase **free-tier** projects auto-pause after **7 days without activity**. The
first request after a pause fails until the project is manually resumed — which is
unacceptable once a client has the link (it would fail in a demo or a real visit).

Two mitigations (§9.1 / §9.2):
1. **Uptime Robot** pings the site every ~5 minutes, generating activity that
   keeps the project awake. Free, ~5 minutes to set up. **(This document.)**
2. **Supabase Pro** (~$25/mo) removes the idle pause entirely and adds daily
   backups. Switch to Pro once the first real client has the link (§9.2).

Do both eventually; Uptime Robot alone is enough to prevent the pause in the
meantime.

## The health endpoint

The app exposes `GET /api/health` ([route](../src/app/api/health/route.ts)). Each
call makes a lightweight request to the Supabase project (GoTrue health), so
pinging it counts as **Supabase activity** — not just frontend traffic. Pinging
the frontend alone would NOT prevent the pause, because the pause is driven by
*Supabase* inactivity.

- Returns **200** `{ "status": "ok", "supabase": true }` when Supabase is reachable.
- Returns **503** `{ "status": "degraded", "supabase": false }` when it is not —
  so the same monitor also alerts on a real outage.
- Uses only the public anon key; contains no secret.

Verify after deploy:
```bash
curl -i https://<your-domain>/api/health
```

## Configure Uptime Robot (step by step)

1. Create a free account at <https://uptimerobot.com> and log in.
2. **+ New monitor**.
3. Monitor type: **HTTP(s)**.
4. Friendly name: `Be Community — keep-alive`.
5. URL: `https://<your-production-domain>/api/health`
6. **Monitoring interval: 5 minutes** (the free plan's minimum; well within the
   7-day window).
7. (Recommended) Advanced → **Keyword** monitoring: alert if the response does
   **not** contain `"supabase":true`. This turns the keep-alive into a real
   health check.
8. Add an alert contact (email) so you're notified if it goes down.
9. **Create monitor.**

That's it — the monitor now keeps the Supabase project awake and alerts you if the
site or database becomes unreachable.

## When to move to Supabase Pro (§9.2)

Rule from the architecture doc: develop and test on free; switch to **Pro** the
moment the **first real client** has the link in hand. Pro removes the idle pause,
adds daily backups and email support. The cost is borne by the business, not the
developer. Keep Uptime Robot running afterward as an uptime/health monitor.

## Environment separation (§6.4)

Keep **separate Supabase projects** for development/staging and production. Real
client data never goes in the test environment. The current dev project is
**`be-community-v2`** (ref `ontvqazsqiwisdddblif`) and holds **test data only**;
provision a separate project for production and apply the migrations there (see
[DEPLOYMENT.md](DEPLOYMENT.md)).

> **Build-time env caveat.** `NEXT_PUBLIC_SUPABASE_URL` and
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` are inlined by `next build`, so they must be set
> as Cloudflare **build** variables (not only runtime "Variables and Secrets") and
> must point at the intended project. A stale build variable once made the branch
> preview authenticate against a **retired** project (logins failed with
> `invalid_credentials`). After any project switch or rebuild, confirm the deploy
> targets the right project with the two non-invasive checks:
> `curl -sI https://<preview-or-domain>/login` → the CSP `connect-src` must show
> the correct project ref, and `GET /api/health` must return `200 {"supabase":true}`.
