/**
 * VRChat Thailand schedule — Google Apps Script backend.
 *
 *   buildPayload()  — reads the sheet → final-shape { days:[{key,en,th,dow,venues:[
 *                     {time,name,status,discord,note}…]}] }.
 *   doGet()         — live JSON endpoint (the site uses this as a FALLBACK).
 *   publishJson()   — writes schedule.json into the GitHub repo (the site's
 *                     PRIMARY data source). Run on a 15-min timer trigger.
 *   installTrigger()— run ONCE to create that timer.
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

/** Write schedule.json to GitHub. Skips the commit when nothing changed. */
function publishJson() {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Set GITHUB_TOKEN in Project Settings → Script properties.');

  const json = JSON.stringify(buildPayload(), null, 2);
  const api  = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + GH_PATH;
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
    if (curJson === json) return 'unchanged';   // schedule identical → no commit
  }

  const body = {
    message: 'Update schedule.json (' + new Date().toISOString() + ')',
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

/** Run ONCE to publish schedule.json every 15 minutes. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'publishJson') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('publishJson').timeBased().everyMinutes(15).create();
  return 'trigger installed';
}
