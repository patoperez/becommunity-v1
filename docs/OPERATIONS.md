# Operations — anti-pause & monitoring

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
client data never goes in the test environment. The dev project used during build
(ref `lyidmvmxqiwkakdcrytj`) should not hold production data; provision a fresh
project for production and apply the migrations there (see
[DEPLOYMENT.md](DEPLOYMENT.md)).
