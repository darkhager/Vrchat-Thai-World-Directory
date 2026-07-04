// Posts a Discord alert when a VRChat Thailand venue is about to open.
// No dependencies — runs on GitHub Actions (Node 18+ has global fetch).
//
// Config (env):
//   DISCORD_WEBHOOK_URL  the Discord webhook to post to (required unless DRY_RUN)
//   THRESHOLD_MIN        alert this many minutes before a venue opens   (default 30)
//   WINDOW_MIN           run cadence in minutes; keep equal to the cron  (default 10)
//   SCHEDULE_URL         override the schedule.json source
//   DRY_RUN=1            print the payload instead of POSTing
//   TEST_SEND=1          post one sample alert regardless of the window (manual verify)
//   FORCE_DOW / FORCE_MIN  test-only: pretend it's this weekday / minute-of-day

const SCHEDULE_URL = process.env.SCHEDULE_URL
  || 'https://darkhager.github.io/Vrchat-Thai-World-Directory/schedule.json';
const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || '').replace(/^﻿/, '').trim();
const THRESHOLD_MIN = Number(process.env.THRESHOLD_MIN || 30);
const WINDOW_MIN = Number(process.env.WINDOW_MIN || 10); // should match the cron interval
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');
const TEST_SEND = /^(1|true|yes)$/i.test(process.env.TEST_SEND || '');

const die = (msg) => { console.error(msg); process.exit(1); };

// Current wall-clock time in GMT+7 (Thailand), independent of the runner's timezone.
const nowGmt7 = new Date(Date.now() + 7 * 60 * 60 * 1000);
const dow = process.env.FORCE_DOW !== undefined
  ? Number(process.env.FORCE_DOW)                       // 0=Sun … 1=Mon … matches schedule "dow"
  : nowGmt7.getUTCDay();
const curMin = process.env.FORCE_MIN !== undefined
  ? Number(process.env.FORCE_MIN)
  : nowGmt7.getUTCHours() * 60 + nowGmt7.getUTCMinutes();

// "20:00–21:30" -> 1200 (start minute-of-day). null if unparseable.
function startMinutes(timeStr) {
  const first = String(timeStr).split(/[–—-]/)[0].trim();
  const m = first.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const startText = (timeStr) => String(timeStr).split(/[–—-]/)[0].trim();

async function main() {
  if (!WEBHOOK && !DRY_RUN) {
    if (TEST_SEND) die('Set the DISCORD_WEBHOOK_URL secret first.');
    console.log('No DISCORD_WEBHOOK_URL configured; skipping.');
    return;
  }
  const res = await fetch(SCHEDULE_URL + (SCHEDULE_URL.includes('?') ? '&' : '?') + 'cb=' + Date.now());
  if (!res.ok) die(`Failed to fetch schedule.json: HTTP ${res.status}`);
  const days = (await res.json()).days || [];
  const today = days.find(d => d.dow === dow);

  if (TEST_SEND) {
    // Manual verification: always post one sample so "Run workflow" is visibly working.
    const sample = (today?.venues || []).find(v => v.status === 'open')
      || days.flatMap(d => d.venues || []).find(v => v.status === 'open');
    if (!sample) die('No open venue found to build a test message.');
    await send([{ v: sample, mins: THRESHOLD_MIN }], true);
    console.log('Test alert sent.');
    return;
  }

  if (!today) { console.log(`No schedule entry for dow=${dow}; nothing to do.`); return; }

  // Stateless de-dup: a venue's minutes-until-open passes through this window once per day.
  const lo = THRESHOLD_MIN - WINDOW_MIN; // exclusive
  const hi = THRESHOLD_MIN;              // inclusive
  const hits = [];
  for (const v of today.venues || []) {
    if (v.status !== 'open') continue;
    const start = startMinutes(v.time);
    if (start == null) continue;
    const mins = start - curMin;
    if (mins > lo && mins <= hi) hits.push({ v, mins });
  }

  if (!hits.length) {
    console.log(`No venues in the ${lo}–${hi} min window (dow=${dow}, curMin=${curMin}).`);
    return;
  }
  await send(hits, false);
  console.log(`Sent alert for ${hits.length} venue(s).`);
}

async function send(hits, isTest) {
  const fields = hits.map(({ v, mins }) => ({
    name: `🟢 ${v.name}`,
    value: `เปิด ${startText(v.time)} (อีก ~${mins} นาที / opens in ~${mins} min)`
      + (v.discord ? `\n[Discord](${v.discord})` : ''),
  }));
  const payload = {
    username: 'ตารางหนีเที่ยว Vrchat',
    embeds: [{
      title: (isTest ? '🧪 ' : '🔔 ') + 'เปิดเร็ว ๆ นี้ / Opening soon',
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
