# Discord open alerts

A scheduled GitHub Action posts a Discord message when a venue opens.
No server or bot token — just a Discord **webhook** and the public `schedule.json`.

## How it works

- `.github/workflows/notify.yml` runs `notify/notify.mjs` every 10 minutes.
- The script reads `schedule.json`, finds `status: "open"` venues whose start time is
  within the alert window, and POSTs to the Discord webhook.
- De-dup is stateless: each venue's minutes-until-open crosses the window once per day,
  so it alerts once. (A skipped scheduled run can occasionally miss one — that's the
  trade for having no database. Lower the cron interval + `WINDOW_MIN` together for tighter timing.)

## One-time setup (you do this)

1. **Create the webhook** in the Discord server you want alerts in:
   Server Settings → Integrations → Webhooks → New Webhook → pick the channel → **Copy Webhook URL**.
2. **Add it to GitHub as a secret** (never commit it, never paste it in chat):
   repo → Settings → Secrets and variables → Actions → New repository secret →
   Name: `DISCORD_WEBHOOK_URL`, Value: the copied URL.
3. **Test it:** repo → Actions → *Discord open alerts* → Run workflow → tick **test** → Run.
   A 🧪 sample alert should appear in the channel within a minute.

That's it. Real alerts then fire automatically as each venue opens.

## Tuning

Edit `.github/workflows/notify.yml`:

- `THRESHOLD_MIN` — minutes before open to alert; `0` = at open time (default `0`).
- Cron interval + `WINDOW_MIN` — keep these equal (both `10` by default).

## More than one Discord

Add another webhook secret and a second job/step that points `DISCORD_WEBHOOK_URL` at it
with its own `THRESHOLD_MIN`. Each Discord's threshold lives here in the repo (there's no
in-Discord settings command, since there's no hosted bot).
