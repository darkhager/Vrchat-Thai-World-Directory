/**
 * VRChat Thailand schedule — Google Apps Script backend.
 *
 *   buildPayload()  — reads the schedule sheet → { days:[{key,en,th,dow,venues:[…]}] }.
 *   buildEvents()   — reads the Form-responses sheet's APPROVED rows → { events:[…] }.
 *   doGet()         — live schedule JSON endpoint (the site uses this as a FALLBACK).
 *   publishJson()/publishEvents()/publishAll() — commit schedule.json /
 *                     approved_events.json to the repo (the site's data). Timer runs publishAll.
 *   setupApprovalColumn() — run ONCE to add the Approved/Rejected dropdown to the responses sheet.
 *   installTrigger()— run ONCE to create the 15-min timer.
 *
 * Secrets live in Project Settings → Script properties (never in the repo):
 *   GITHUB_TOKEN — fine-grained PAT, Contents:Read-and-write on this repo only.
 *
 * It exposes ONLY this sheet's schedule (text, status, Discord link, note) —
 * nothing else in the spreadsheet — so the sheet can be made private.
 */

const SHEET_ID   = '1RyoXnE6UYlYZBDRS2OXDpRDZTQ1PxaJD0bSoXjIRm-U';
const SHEET_NAME = '';   // '' = first sheet; or put the tab name here

const GH_OWNER  = 'darkhager';
const GH_REPO   = 'Vrchat-Thai-World-Directory';
const GH_BRANCH = 'main';
const GH_PATH   = 'schedule.json';

// Event Feeds (Google Form responses) → approved_events.json
const EVENTS_SHEET_ID = '18H3DEjQFcUTnxYWiCKNN9IihyNLrUrI9xAZ01m0TNKI';
const EVENTS_PATH     = 'approved_events.json';
const STATUS_HEADER   = 'Status';   // admin sets this per row: Approved / Rejected / (blank = pending)

// Day rows are matched by the English name in column A (robust to row inserts).
const DAYS = [
  { key: 'mon', en: 'Monday',          th: 'วันจันทร์',      dow: 1 },
  { key: 'tue', en: 'Tuesday',         th: 'วันอังคาร',      dow: 2 },
  { key: 'wed', en: 'Wednesday',       th: 'วันพุธ',         dow: 3 },
  { key: 'thu', en: 'Thursday',        th: 'วันพฤหัสบดี',    dow: 4 },
  { key: 'fri', en: 'Friday',          th: 'วันศุกร์',       dow: 5 },
  { key: 'sat', en: 'Saturday',        th: 'วันเสาร์',       dow: 6 },
  { key: 'sun', en: 'Sunday',          th: 'วันอาทิตย์',     dow: 0 },
  { key: 'spc', en: 'Special Pattern', th: 'ร้านเปิดตามหมายเหตุ', dow: -1 },
];

/** Read the sheet → { days:[{key,en,th,dow,venues:[…]}] } (final shape). */
function buildPayload() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  const range = sheet.getDataRange();

  const text   = range.getDisplayValues();   // cell text
  const colors = range.getFontColors();      // "#rrggbb" per cell → status
  const notes  = range.getNotes();           // cell note → opening conditions
  const rich   = range.getRichTextValues();  // for the Discord hyperlink

  // Match each day to the first row whose column A names it.
  const rowFor = {};
  for (var r = 0; r < text.length; r++) {
    var a = (text[r][0] || '').toLowerCase();
    DAYS.forEach(function (d) {
      var name = d.en.toLowerCase().split(' ')[0];   // "monday" … "special"
      if (a.indexOf(name) !== -1 && !(d.key in rowFor)) rowFor[d.key] = r;
    });
  }

  const days = DAYS.map(function (d) {
    var venues = [];
    var r = rowFor[d.key];
    if (r != null) {
      for (var c = 1; c < text[r].length; c++) {       // c=0 is the day-label column
        var t = (text[r][c] || '').trim();
        if (!t) continue;
        var tn = splitTimeName(t);
        if (!tn.name) continue;
        venues.push({
          time: tn.time,
          name: tn.name,
          status: statusFromHex(colors[r][c]),
          discord: cellLink(rich[r][c]) || '',
          note: (notes[r][c] || '').trim(),
        });
      }
    }
    return { key: d.key, en: d.en, th: d.th, dow: d.dow, venues: venues };
  });

  return { days: days };
}

/** Split a cell like "20:00-22:00\nVenue" (or "20:00 Venue") into {time,name}. */
function splitTimeName(text) {
  var lines = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
  var time = '', name = '';
  if (lines.length >= 2) { time = lines[0]; name = lines.slice(1).join(' '); }
  else {
    var m = (lines[0] || '').match(/^([\d\s:：?–\-]+?)([^\d\s:：?–\-].*)$/);
    if (m) { time = m[1]; name = m[2]; } else { name = lines[0] || ''; }
  }
  return {
    time: time.replace(/\s+/g, ' ').replace(/\s*[-–]\s*/g, '–').trim(),
    name: name.replace(/\s+/g, ' ').trim(),
  };
}

/** "#rrggbb" font color → status string (matches the sheet legend). */
function statusFromHex(hex) {
  if (!hex) return '';
  var m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return '';
  var r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 0.22) return '';                                    // black-ish → no status
  if (max - min < 0.12) return 'renovate';                      // grey
  if (g >= r && g >= b && g - Math.max(r, b) > 0.08) return 'open';    // green
  if (r >= g && r >= b && r - Math.max(g, b) > 0.08) return 'closed';  // red
  if (b >= r && b >= g) return 'reserve';                       // blue
  return '';
}

/** The Discord link on a cell (whole-cell link, or a link on part of it). */
function cellLink(rt) {
  if (!rt) return null;
  var link = rt.getLinkUrl();
  if (link) return link;
  var runs = rt.getRuns();
  for (var i = 0; i < runs.length; i++) {
    var u = runs[i].getLinkUrl();
    if (u) return u;
  }
  return null;
}

/** Live endpoint — the website falls back to this if schedule.json is missing. */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify(buildPayload()))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Commit `json` to `path` in the repo via the GitHub contents API. Skips no-op commits. */
function ghCommit(path, json) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Set GITHUB_TOKEN in Project Settings → Script properties.');

  const api = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + path;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // Fetch the current file: gives us its sha, and lets us skip no-op commits.
  var sha = null;
  const getRes = UrlFetchApp.fetch(api + '?ref=' + GH_BRANCH, {
    method: 'get', headers: headers, muteHttpExceptions: true,
  });
  if (getRes.getResponseCode() === 200) {
    const cur = JSON.parse(getRes.getContentText());
    sha = cur.sha;
    const curJson = Utilities.newBlob(
      Utilities.base64Decode(cur.content.replace(/\s/g, ''))
    ).getDataAsString();
    if (curJson === json) return 'unchanged';   // identical → no commit
  }

  const body = {
    message: 'Update ' + path + ' (' + new Date().toISOString() + ')',
    content: Utilities.base64Encode(json, Utilities.Charset.UTF_8),
    branch: GH_BRANCH,
  };
  if (sha) body.sha = sha;

  const putRes = UrlFetchApp.fetch(api, {
    method: 'put', headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error('GitHub commit failed (' + code + '): ' + putRes.getContentText());
  }
  return 'committed';
}

function publishJson()   { return ghCommit(GH_PATH,     JSON.stringify(buildPayload(), null, 2)); }
function publishEvents() { return ghCommit(EVENTS_PATH, JSON.stringify(buildEvents(),  null, 2)); }

/** Publish both data files, then push new approvals to Discord + the calendar.
 *  This is what the timer runs. Notify/sync is wrapped so a Discord or Calendar
 *  hiccup can never block the core publish. */
function publishAll() {
  var out = 'schedule:' + publishJson() + ' | events:' + publishEvents();
  try { out += ' | ' + notifyAndSyncEvents(); }
  catch (e) { out += ' | notify error: ' + e; }
  return out;
}

/* ── Event Feeds (from the Google Form responses sheet) ─────────────────────── */

function eventsSheet_() {
  const ss = SpreadsheetApp.openById(EVENTS_SHEET_ID);
  return ss.getSheetByName('Form Responses 1') || ss.getSheets()[0];
}

/** Run ONCE: add the "Status" column with an Approved/Rejected dropdown. */
function setupApprovalColumn() {
  const sheet = eventsSheet_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf(STATUS_HEADER) + 1;          // 0 → not present
  if (col === 0) {
    col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(STATUS_HEADER);
  }
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Approved', 'Rejected'], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  return 'Status dropdown at column ' + col;
}

/** Read approved form rows → { events:[{name,by,type,date,time,link,note}] }.
 *  Never includes the submitter email or timestamp. */
function buildEvents() {
  const sheet = eventsSheet_();
  const data = sheet.getDataRange().getDisplayValues();
  if (data.length < 2) return { events: [] };
  const headers = data[0];
  function col(substr) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).toLowerCase().indexOf(substr) !== -1) return i;
    }
    return -1;
  }
  const cName = col('event name'), cBy = col('event by'), cLink = col('event links'),
        cType = col('event type'),
        cOtD = col('one time event date'), cOtT = col('one time event time'),
        cWkD = col('weekly event date'),   cWkT = col('weekly event time'),
        cSpD = col('special pattern'),      cSpT = col('special event time'),
        cNote = col('note'), cStatus = col('status');

  const events = [];
  for (var r = 1; r < data.length; r++) {
    const row = data[r];
    if (cStatus < 0 || String(row[cStatus]).trim().toLowerCase() !== 'approved') continue;
    const name = cName >= 0 ? String(row[cName]).trim() : '';
    if (!name) continue;
    function pick(a, b, c) {
      return (a >= 0 && String(row[a]).trim()) ||
             (b >= 0 && String(row[b]).trim()) ||
             (c >= 0 && String(row[c]).trim()) || '';
    }
    events.push({
      name: name,
      by:   cBy   >= 0 ? String(row[cBy]).trim()   : '',
      type: cType >= 0 ? String(row[cType]).trim() : '',
      date: pick(cOtD, cWkD, cSpD),
      time: pick(cOtT, cWkT, cSpT),
      link: cLink >= 0 ? String(row[cLink]).trim() : '',
      note: cNote >= 0 ? String(row[cNote]).trim() : '',
    });
  }
  return { events: events };
}

/* ── Discord broadcast bot + Google Calendar sync ────────────────────────────
   When a row is APPROVED, post it once to a Discord ANNOUNCEMENT channel via a
   bot, auto-publish it so every server that "Follows" the channel gets it, and
   add it to a calendar. Idempotent: each row is marked so the timer never repeats.

   Project Settings → Script properties:
     DISCORD_BOT_TOKEN  — the bot's token (Developer Portal → Bot → Reset Token).
     DISCORD_CHANNEL_ID — id of the Announcement channel the bot posts to.
     CALENDAR_ID        — (optional) a specific calendar id; otherwise a dedicated
                          "VRChat Thailand Events" calendar is created on first run.

   The bot needs only SEND_MESSAGES in that channel, and the channel must be an
   Announcement channel in a Community-enabled server (so others can Follow it).
   Run setupEventTracking() ONCE: it adds the marker columns, creates the
   calendar, and triggers the one-time Calendar authorization prompt. No
   redeploy is needed — the timer runs the latest SAVED code. */

const ANNOUNCED_HEADER = 'Announced';    // Discord post marker (ISO timestamp)
const CAL_ID_HEADER    = 'CalEventId';   // Google Calendar event / series id
const CAL_NAME         = 'VRChat Thailand Events';
const EVENT_HOURS      = 2;              // default duration for a timed event

/** Run ONCE: add the marker columns + create the calendar (prompts Calendar auth). */
function setupEventTracking() {
  const sheet = eventsSheet_();
  ensureColumn_(sheet, ANNOUNCED_HEADER);
  ensureColumn_(sheet, CAL_ID_HEADER);
  const cal = eventsCalendar_();
  Logger.log('Calendar ready: "%s"  (id: %s)', cal.getName(), cal.getId());
  Logger.log('To let people subscribe: Google Calendar → Settings for this ' +
             'calendar → make it public, then copy the public iCal / subscribe URL.');
  return 'tracking columns + calendar ready (see Logs for the calendar id)';
}

/** Find a header column by exact name, creating it at the end if missing. */
function ensureColumn_(sheet, header) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const at = headers.indexOf(header);
  if (at !== -1) return at + 1;
  const col = sheet.getLastColumn() + 1;
  sheet.getRange(1, col).setValue(header);
  return col;
}

/** The dedicated events calendar (cached id in Script properties). */
function eventsCalendar_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CALENDAR_ID');
  if (id) { const c = CalendarApp.getCalendarById(id); if (c) return c; }
  const found = CalendarApp.getCalendarsByName(CAL_NAME);
  const cal = found.length ? found[0] : CalendarApp.createCalendar(CAL_NAME);
  props.setProperty('CALENDAR_ID', cal.getId());
  return cal;
}

/** For each APPROVED row not yet handled: post to Discord and add to the
 *  calendar, then mark it. Called by publishAll() after publishing. */
function notifyAndSyncEvents() {
  const sheet = eventsSheet_();
  const disp = sheet.getDataRange().getDisplayValues();   // human text
  const vals = sheet.getDataRange().getValues();          // real Date objects
  if (disp.length < 2) return 'no rows';

  const H = disp[0];
  function idx(substr) {
    for (var i = 0; i < H.length; i++) {
      if (String(H[i]).toLowerCase().indexOf(substr) !== -1) return i;
    }
    return -1;
  }
  const cStatus = idx('status'),
        cName = idx('event name'), cBy = idx('event by'),
        cType = idx('event type'), cLink = idx('event links'), cNote = idx('note'),
        cAnn = H.indexOf(ANNOUNCED_HEADER), cCal = H.indexOf(CAL_ID_HEADER);
  if (cStatus < 0 || cAnn < 0 || cCal < 0) return 'run setupEventTracking() first';

  const dateCols = [idx('one time event date'), idx('weekly event date'), idx('special pattern')];
  const timeCols = [idx('one time event time'), idx('weekly event time'), idx('special event time')];
  const props    = PropertiesService.getScriptProperties();
  const botToken = props.getProperty('DISCORD_BOT_TOKEN');
  const channelId = props.getProperty('DISCORD_CHANNEL_ID');

  var posted = 0, synced = 0;
  for (var r = 1; r < disp.length; r++) {
    if (String(disp[r][cStatus]).trim().toLowerCase() !== 'approved') continue;
    const name = cName >= 0 ? String(disp[r][cName]).trim() : '';
    if (!name) continue;

    // Which date group (0=one-time, 1=weekly, 2=special) is filled in?
    var g = -1;
    for (var k = 0; k < dateCols.length; k++) {
      if (dateCols[k] >= 0 && String(disp[r][dateCols[k]]).trim()) { g = k; break; }
    }
    const dateStr = g >= 0 ? String(disp[r][dateCols[g]]).trim() : '';
    const timeStr = g >= 0 && timeCols[g] >= 0 ? String(disp[r][timeCols[g]]).trim() : '';
    const ev = {
      name: name,
      by:   cBy   >= 0 ? String(disp[r][cBy]).trim()   : '',
      type: cType >= 0 ? String(disp[r][cType]).trim() : '',
      link: cLink >= 0 ? String(disp[r][cLink]).trim() : '',
      note: cNote >= 0 ? String(disp[r][cNote]).trim() : '',
      dateStr: dateStr, timeStr: timeStr,
    };

    // 1) Discord — once per row.
    if (botToken && channelId && !String(disp[r][cAnn]).trim()) {
      if (postDiscord_(botToken, channelId, ev)) {
        sheet.getRange(r + 1, cAnn + 1).setValue(new Date().toISOString());
        posted++;
      }
    }

    // 2) Calendar — once per row, only if we can place it on a date.
    if (!String(disp[r][cCal]).trim()) {
      const when = combineDateTime_(
        g >= 0 ? vals[r][dateCols[g]] : '',
        g >= 0 && timeCols[g] >= 0 ? vals[r][timeCols[g]] : '',
        dateStr, timeStr);
      if (when) {
        const id = createCalEvent_(ev, when, g === 1 /* weekly */);
        if (id) { sheet.getRange(r + 1, cCal + 1).setValue(id); synced++; }
      }
    }
  }
  return 'discord:' + posted + ' calendar:' + synced;
}

/** Post one event to the Announcement channel as the bot, then auto-publish it
 *  so every server that Follows the channel receives it. allowed_mentions is
 *  emptied so submitter-supplied text can never trigger an @everyone / @role ping.
 *  Returns true if the message posted (publishing is best-effort). */
function postDiscord_(botToken, channelId, ev) {
  var lines = [];
  if (ev.by) lines.push('by ' + ev.by);
  var when = [ev.dateStr, ev.timeStr].filter(Boolean).join(' ');
  if (when)    lines.push('🗓 ' + when);
  if (ev.type) lines.push('🏷 ' + ev.type);
  if (ev.note) lines.push(ev.note);
  if (ev.link) lines.push(ev.link);
  var content = ('**📢 New event: ' + ev.name + '**\n' + lines.join('\n')).slice(0, 1900);

  var base = 'https://discord.com/api/v10/channels/' + channelId + '/messages';
  var headers = {
    Authorization: 'Bot ' + botToken,
    'User-Agent': 'VRChatThaiSchedule (https://darkhager.github.io/Vrchat-Thai-World-Directory, 1.0)',
  };

  var res = UrlFetchApp.fetch(base, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify({ content: content, allowed_mentions: { parse: [] } }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('Discord post failed (%s): %s', code, res.getContentText());
    return false;
  }

  // Auto-publish (crosspost) to followers — needs only SEND_MESSAGES on our own
  // message, and only works if this is an Announcement channel. Best-effort:
  // if it fails the message is still in the channel, just not relayed.
  var msgId = JSON.parse(res.getContentText()).id;
  var cp = UrlFetchApp.fetch(base + '/' + msgId + '/crosspost', {
    method: 'post', headers: headers, muteHttpExceptions: true,
  });
  var cc = cp.getResponseCode();
  if (cc < 200 || cc >= 300) {
    Logger.log('Discord publish failed (%s): %s — message posted but not relayed to followers', cc, cp.getContentText());
  }
  return true;
}

/** Create the calendar entry; returns its id (or null). Weekly → recurring series. */
function createCalEvent_(ev, when, weekly) {
  const cal = eventsCalendar_();
  const title = ev.name + (ev.by ? ' — ' + ev.by : '');
  const opts = { description: [ev.type && ('Type: ' + ev.type), ev.note, ev.link].filter(Boolean).join('\n') };
  try {
    if (weekly) {
      const rec = CalendarApp.newRecurrence().addWeeklyRule();
      return when.allDay
        ? cal.createAllDayEventSeries(title, when.start, rec, opts).getId()
        : cal.createEventSeries(title, when.start, when.end, rec, opts).getId();
    }
    return when.allDay
      ? cal.createAllDayEvent(title, when.start, opts).getId()
      : cal.createEvent(title, when.start, when.end, opts).getId();
  } catch (e) {
    Logger.log('Calendar create failed for "%s": %s', ev.name, e);
    return null;
  }
}

/** Build {start,end,allDay} from sheet cells — uses the real Date when the form
 *  field is a Date/Time question, with a string fallback. Null if unparseable. */
function combineDateTime_(dateVal, timeVal, dateStr, timeStr) {
  var start = null;
  if (dateVal instanceof Date && !isNaN(dateVal)) {
    start = new Date(dateVal.getFullYear(), dateVal.getMonth(), dateVal.getDate());
  } else if (dateStr) {
    var d = new Date(dateStr);
    if (!isNaN(d)) start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  if (!start) return null;

  var hasTime = false;
  if (timeVal instanceof Date && !isNaN(timeVal)) {
    start.setHours(timeVal.getHours(), timeVal.getMinutes(), 0, 0); hasTime = true;
  } else if (timeStr) {
    var m = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (m) {
      var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
      if (m[3]) { if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; }
      start.setHours(h, min, 0, 0); hasTime = true;
    }
  }
  if (!hasTime) return { start: start, end: start, allDay: true };
  return { start: start, end: new Date(start.getTime() + EVENT_HOURS * 3600 * 1000), allDay: false };
}

/* ── Discord open alerts ─────────────────────────────────────────────────────
 * Apps Script is the CLOCK. GitHub's `schedule` cron is best-effort: an every-10-minute
 * cron was actually firing ~every 2h, so notify.mjs's 10-min detection window missed
 * ~91% of openings (silently — it exited 0 every run). repository_dispatch is NOT throttled.
 *
 * Apps Script can't POST to Discord (Cloudflare blocks it, error 40333), so we fire a
 * repository_dispatch and the GitHub Action does the posting.
 *
 * Reliability: de-dup state lives here, and is saved ONLY after a successful dispatch.
 * A late or failed tick therefore retries on the next tick instead of losing the alert.
 * Tick frequency controls latency, never whether the alert fires.                     */

const ALERT_MAX_LATE_MIN = 60;   // never announce a venue that opened >1h ago

/** "20:00–22:00" → 1200 (minute-of-day of the start). null if unparseable. */
function startMinutes_(timeStr) {
  var first = String(timeStr).split(/[–—-]/)[0].trim();
  var m = first.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Timer target: announce venues that have opened since the last tick. */
function checkOpenings() {
  var now    = new Date(Date.now() + 7 * 60 * 60 * 1000);   // GMT+7 wall clock
  var dow    = now.getUTCDay();                             // 0=Sun … matches DAYS[].dow
  var curMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  var today  = now.toISOString().slice(0, 10);

  var props = PropertiesService.getScriptProperties();
  var state = JSON.parse(props.getProperty('ALERTED') || '{}');
  if (state.date !== today) state = { date: today, keys: [] };   // new day → clean slate

  var day = buildPayload().days.filter(function (d) { return d.dow === dow; })[0];
  if (!day) return 'no schedule row for dow=' + dow;

  var hits = [];
  day.venues.forEach(function (v) {
    if (v.status !== 'open') return;
    var start = startMinutes_(v.time);
    if (start == null) return;
    var late = curMin - start;
    if (late < 0 || late > ALERT_MAX_LATE_MIN) return;        // not open yet / stale
    var key = v.name + '|' + v.time;
    if (state.keys.indexOf(key) !== -1) return;               // already announced today
    state.keys.push(key);
    hits.push({ name: v.name, time: v.time, discord: v.discord || '' });
  });

  if (!hits.length) {
    props.setProperty('ALERTED', JSON.stringify(state));      // persist the daily reset
    return 'nothing to announce (dow=' + dow + ', curMin=' + curMin + ')';
  }

  ghDispatch_('venue-open', { venues: hits });   // throws → state unsaved → retried next tick
  props.setProperty('ALERTED', JSON.stringify(state));
  return 'announced ' + hits.length + ' venue(s)';
}

/** Fire a repository_dispatch. Needs only Contents:write — the token we already have. */
function ghDispatch_(eventType, clientPayload) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Set GITHUB_TOKEN in Project Settings → Script properties.');

  var res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/dispatches', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify({ event_type: eventType, client_payload: clientPayload }),
    });

  var code = res.getResponseCode();
  if (code !== 204) throw new Error('repository_dispatch failed: HTTP ' + code + ' ' + res.getContentText());
  return 'dispatched';
}

/** Reset today's alert de-dup (testing: lets an already-announced venue fire again). */
function resetAlerted() {
  PropertiesService.getScriptProperties().deleteProperty('ALERTED');
  return 'alert de-dup cleared';
}

/** Run ONCE to install both timers: publish every 15 min, open-alerts every 5 min. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'publishJson' || h === 'publishEvents' || h === 'publishAll' || h === 'checkOpenings') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('publishAll').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('checkOpenings').timeBased().everyMinutes(5).create();
  return 'triggers installed';
}
