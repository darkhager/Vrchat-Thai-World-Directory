// Posts Discord alerts on behalf of Apps Script, which can't reach discord.com
// itself (Cloudflare blocks it, error 40333) — this Action is the transport.
// No dependencies — runs on GitHub Actions (Node 18+ has global fetch).
//
// Two unrelated things get dispatched here, distinguished by DISPATCH_TYPE
// (github.event.action — the repository_dispatch event_type):
//   "venue-open"         — a schedule venue just opened (the original alert).
//   "event-announcement" — a community-submitted event got Approved.
// Both post to the same webhook/channel. Apps Script decides *when*; this
// script only relays to Discord.
//
// Why repository_dispatch: GitHub's `schedule` cron is best-effort. A `*/10` cron
// was actually firing about every 2 hours, so the old 10-minute detection window
// missed ~91% of venue openings (and exited 0 every time, so nothing ever looked
// broken). repository_dispatch is not throttled.
//
// Config (env):
//   DISCORD_WEBHOOK_URL  the Discord webhook(s) to post to, comma-separated for
//                        more than one server/channel (required unless DRY_RUN)
//   DISPATCH_TYPE        which dispatch fired this run ("venue-open" / "event-announcement")
//   ALERT_PAYLOAD        repository_dispatch client_payload — shape depends on DISPATCH_TYPE
//   SCHEDULE_URL         override the schedule source (TEST_SEND only)
//   DRY_RUN=1            print the payload instead of POSTing
//   TEST_SEND=1          post one sample venue-open alert regardless of payload (manual verify)

const SCHEDULE_URL = process.env.SCHEDULE_URL
  || 'https://darkhager.github.io/Vrchat-Thai-World-Directory/schedule.json';
const WEBHOOKS = (process.env.DISCORD_WEBHOOK_URL || '').replace(/^﻿/, '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const DISPATCH_TYPE = process.env.DISPATCH_TYPE || 'venue-open';
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const TEST_SEND = /^(1|true|yes)$/i.test(process.env.TEST_SEND || '');

const die = (msg) => { console.error(msg); process.exit(1); };

const startText = (timeStr) => String(timeStr).split(/[–—-]/)[0].trim();

/** Venues carried by the repository_dispatch. Empty for workflow_dispatch (payload is "null"). */
function dispatchedVenues() {
  const raw = process.env.ALERT_PAYLOAD;
  if (!raw || raw === 'null') return [];
  let p;
  try { p = JSON.parse(raw); } catch { return []; }
  return Array.isArray(p && p.venues) ? p.venues : [];
}

async function main() {
  if (DISPATCH_TYPE === 'event-announcement') return sendEventAnnouncement();

  if (!WEBHOOKS.length && !DRY_RUN) {
    if (TEST_SEND) die('Set the DISCORD_WEBHOOK_URL secret first.');
    console.log('No DISCORD_WEBHOOK_URL configured; skipping.');
    return;
  }

  if (TEST_SEND) {
    // Manual verification: always post one sample so "Run workflow" is visibly working.
    const res = await fetch(SCHEDULE_URL + (SCHEDULE_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now());
    if (!res.ok) die(`Failed to fetch schedule.json: HTTP ${res.status}`);
    const days = (await res.json()).days || [];
    const sample = days.flatMap(d => d.venues || []).find(v => v.status === 'open');
    if (!sample) die('No open venue found to build a test message.');
    await send([sample], true);
    console.log('Test alert sent.');
    return;
  }

  const venues = dispatchedVenues();
  if (!venues.length) { console.log('No venues in the dispatch payload; nothing to do.'); return; }
  await send(venues, false);
  console.log(`Sent alert for ${venues.length} venue(s).`);
}

async function send(venues, isTest) {
  // Single venue: its name leads as the embed title. Multiple at once can't all
  // fit in one title, so fall back to the generic title with each shop named per field.
  const single = venues.length === 1;
  const fields = venues.map((v) => ({
    name: single ? '​' : `🟢 ${v.name}`,
    value: `เปิดแล้ว ${startText(v.time)} / open now`
      + (v.discord ? `\n[Discord](${v.discord})` : ''),
  }));
  const title = (isTest ? '🧪 ' : '🟢 ') + (single ? venues[0].name : 'เปิดแล้ว / Now open');
  const payload = {
    username: 'ตารางหนีเที่ยว Vrchat',
    embeds: [{
      title,
      color: 0x2ecc71,
      fields,
      footer: { text: 'darkhager.github.io/Vrchat-Thai-World-Directory' + (isTest ? ' · test' : '') },
    }],
  };

  if (DRY_RUN) { console.log('[DRY_RUN] payload:\n' + JSON.stringify(payload, null, 2)); return; }

  for (const url of WEBHOOKS) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) die(`Discord webhook POST failed: HTTP ${r.status} ${await r.text()}`);
  }
}

/** event-announcement dispatch: client_payload is one event
 *  { name, by, link, note, dateStr, timeStr } — see apps-script.gs's notifyAndSyncEvents(). */
async function sendEventAnnouncement() {
  if (!WEBHOOKS.length && !DRY_RUN) {
    console.log('No DISCORD_WEBHOOK_URL configured; skipping.');
    return;
  }

  const raw = process.env.ALERT_PAYLOAD;
  if (!raw || raw === 'null') { console.log('No event in the dispatch payload; nothing to do.'); return; }
  let ev;
  try { ev = JSON.parse(raw); } catch { console.log('Unparseable event payload; nothing to do.'); return; }
  if (!ev || !ev.name) { console.log('Event payload missing a name; nothing to do.'); return; }

  const lines = [];
  if (ev.by) lines.push(`by ${ev.by}`);
  const when = [ev.dateStr, ev.timeStr].filter(Boolean).join(' ');
  if (when) lines.push(`🗓 ${when}`);
  if (ev.note) lines.push(ev.note);
  if (ev.link) lines.push(ev.link);
  const payload = {
    content: (`**📢 New event: ${ev.name}**\n` + lines.join('\n')).slice(0, 1900),
    allowed_mentions: { parse: [] },   // submitter-supplied text can never ping @everyone/@role
  };

  if (DRY_RUN) { console.log('[DRY_RUN] event payload:\n' + JSON.stringify(payload, null, 2)); return; }

  for (const url of WEBHOOKS) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) die(`Discord webhook POST failed: HTTP ${r.status} ${await r.text()}`);
  }
  console.log(`Sent event announcement for "${ev.name}" to ${WEBHOOKS.length} webhook(s).`);
}

main().catch(e => die(String((e && e.stack) || e)));
