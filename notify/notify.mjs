// Posts a Discord alert when a VRChat Thailand venue opens.
// No dependencies — runs on GitHub Actions (Node 18+ has global fetch).
//
// This script does NOT decide when to alert. Apps Script is the clock: its 5-minute
// trigger detects the opening, de-dups it, and fires a repository_dispatch carrying
// the venues. We just relay that to Discord.
//
// Why: GitHub's `schedule` cron is best-effort. A `*/10` cron was actually firing
// about every 2 hours, so the old 10-minute detection window missed ~91% of openings
// (and exited 0 every time, so nothing ever looked broken). `repository_dispatch` is
// not throttled. Apps Script can't POST to Discord itself (Cloudflare blocks it,
// error 40333), which is why this Action still exists — as the transport.
//
// Config (env):
//   DISCORD_WEBHOOK_URL  the Discord webhook to post to (required unless DRY_RUN)
//   ALERT_PAYLOAD        repository_dispatch client_payload: { venues:[{name,time,discord}] }
//   SCHEDULE_URL         override the schedule source (TEST_SEND only)
//   DRY_RUN=1            print the payload instead of POSTing
//   TEST_SEND=1          post one sample alert regardless of payload (manual verify)

const SCHEDULE_URL = process.env.SCHEDULE_URL
  || 'https://darkhager.github.io/Vrchat-Thai-World-Directory/schedule.json';
const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || '').replace(/^﻿/, '').trim();
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
  if (!WEBHOOK && !DRY_RUN) {
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
  const fields = venues.map((v) => ({
    name: `🟢 ${v.name}`,
    value: `เปิดแล้ว ${startText(v.time)} / open now`
      + (v.discord ? `\n[Discord](${v.discord})` : ''),
  }));
  const payload = {
    username: 'ตารางหนีเที่ยว Vrchat',
    embeds: [{
      title: (isTest ? '🧪 ' : '🟢 ') + 'เปิดแล้ว / Now open',
      color: 0x2ecc71,
      fields,
      footer: { text: 'darkhager.github.io/Vrchat-Thai-World-Directory' + (isTest ? ' · test' : '') },
    }],
  };

  if (DRY_RUN) { console.log('[DRY_RUN] payload:\n' + JSON.stringify(payload, null, 2)); return; }

  const r = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) die(`Discord webhook POST failed: HTTP ${r.status} ${await r.text()}`);
}

main().catch(e => die(String((e && e.stack) || e)));
