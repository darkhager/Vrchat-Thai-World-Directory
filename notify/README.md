# Discord open alerts

Posts a Discord message when a venue opens. No server, no bot token — just a Discord
**webhook**, the Apps Script timer you already run, and this Action as the transport.

## How it works

**Apps Script is the clock. The Action is just the mailman.**

1. Apps Script's `checkOpenings()` trigger runs every 5 minutes, reads the sheet, and
   finds `status: "open"` venues whose start time has passed within the last hour and
   that it hasn't announced yet today.
2. It fires a GitHub `repository_dispatch` (`event_type: venue-open`) carrying those venues.
3. `.github/workflows/notify.yml` wakes on that dispatch and runs `notify/notify.mjs`,
   which POSTs the embed to the Discord webhook.

### Why it's built this way

- **GitHub's `schedule` cron cannot be trusted as a clock.** It's best-effort. A `*/10`
  cron on this repo actually fired about **once every 2 hours** (50 runs where 578 were
  due — 8.7%). The previous design used a 10-minute detection window sized to that cron,
  so it missed **~91% of openings** — and exited `0` every time, so nothing looked broken.
  `repository_dispatch` is **not** throttled.
- **Apps Script can't POST to Discord** — Cloudflare blocks it (error `40333`). Hence the
  Action: it's the only piece that can actually reach the webhook.

### The reliability guarantee

De-dup state (`ALERTED`) lives in Apps Script Properties and is saved **only after a
successful dispatch**. So:

- A **late** tick still announces (anything opened within the last `ALERT_MAX_LATE_MIN`).
- A **failed** dispatch leaves the state unsaved, so the next tick retries it.
- A venue is announced **at most once per day** (keyed on `name|time`, reset at midnight GMT+7).

Tick frequency controls *how late* an alert is — never *whether* it arrives.

## One-time setup (you do this)

1. **Create the webhook** in the Discord server you want alerts in:
   Server Settings → Integrations → Webhooks → New Webhook → pick the channel → **Copy Webhook URL**.
2. **Add it to GitHub as a secret** (never commit it, never paste it in chat):
   repo → Settings → Secrets and variables → Actions → New repository secret →
   Name: `DISCORD_WEBHOOK_URL`, Value: the copied URL.
3. **Push this workflow to `main` first.** `repository_dispatch` only triggers workflows
   that already exist on the default branch.
4. **Update the Apps Script** with the new `apps-script.gs`, then run **`installTrigger()`
   once** (authorize when prompted). It installs both timers: `publishAll` every 15 min,
   `checkOpenings` every 5 min.
5. **Test the transport:** repo → Actions → *Discord open alerts* → Run workflow → tick
   **test** → Run. A 🧪 sample alert should appear in the channel within a minute.
6. **Test the clock:** in Apps Script, run `checkOpenings()` manually while a venue is
   within an hour of its open time. Use `resetAlerted()` to clear the de-dup and retry.

The existing `GITHUB_TOKEN` script property already has the right scope —
`repository_dispatch` requires only **Contents: write**, which the fine-grained PAT has.

## Tuning

- `ALERT_MAX_LATE_MIN` in `apps-script.gs` (default `60`) — how stale an opening can be
  and still be announced. This also stops a first-ever run from dumping the whole day.
- Trigger interval in `installTrigger()` (default `5` min) — alert latency. Apps Script
  accepts `1, 5, 10, 15, 30`. Raise it to `10` if you get script-runtime quota warnings.

## More than one Discord

Add another webhook secret and a second step that points `DISCORD_WEBHOOK_URL` at it.
Both receive the same dispatch payload.
