/**
 * VRChat Thailand schedule — Google Apps Script backend.
 *
 *   buildPayload()  — reads the sheet → { rows:[[{text,color,link,note}…]] }.
 *   doGet()         — live JSON endpoint (the site uses this as a FALLBACK).
 *   publishJson()   — writes schedule.json into the GitHub repo (the site's
 *                     PRIMARY data source). Run on a 15-min timer trigger.
 *   installTrigger()— run ONCE to create that timer.
 *
 * Secrets live in Project Settings → Script properties (never in the repo):
 *   GITHUB_TOKEN — fine-grained PAT, Contents:Read-and-write on this repo only.
 *
 * It exposes ONLY this sheet's cell text, font color, Discord link and note —
 * nothing else in the spreadsheet — so the sheet can be made private.
 */

const SHEET_ID   = '1RyoXnE6UYlYZBDRS2OXDpRDZTQ1PxaJD0bSoXjIRm-U';
const SHEET_NAME = '';   // '' = first sheet; or put the tab name here

const GH_OWNER  = 'darkhager';
const GH_REPO   = 'Vrchat-Thai-World-Directory';
const GH_BRANCH = 'main';
const GH_PATH   = 'schedule.json';

/** Read the sheet grid into { rows:[[{text,color,link,note}…]] }. */
function buildPayload() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
  const range = sheet.getDataRange();

  const text   = range.getDisplayValues();   // cell text
  const colors = range.getFontColors();      // "#rrggbb" per cell  → status
  const notes  = range.getNotes();           // cell note           → opening conditions
  const rich   = range.getRichTextValues();  // for the Discord hyperlink

  const rows = text.map(function (line, r) {
    return line.map(function (t, c) {
      var link = null;
      var rt = rich[r][c];
      if (rt) {
        link = rt.getLinkUrl();              // whole-cell link
        if (!link) {                         // or a link on part of the cell (the name)
          var runs = rt.getRuns();
          for (var i = 0; i < runs.length; i++) {
            var u = runs[i].getLinkUrl();
            if (u) { link = u; break; }
          }
        }
      }
      return { text: t, color: colors[r][c], link: link, note: notes[r][c] || '' };
    });
  });

  return { rows: rows };
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

/* ── PHASE 1 SETUP (one time) ───────────────────────────────────────────────
 * 1. Create a GitHub token: github.com/settings/personal-access-tokens/new
 *      - Resource owner: darkhager
 *      - Only select repositories → Vrchat-Thai-World-Directory
 *      - Repository permissions → Contents → Read and write
 *    Generate, copy it.
 * 2. Here in Apps Script: Project Settings (gear) → Script properties →
 *    Add property  name: GITHUB_TOKEN  value: <the token>  → Save.
 * 3. Select publishJson in the toolbar → Run → authorize. Check the repo for
 *    schedule.json.
 * 4. Select installTrigger → Run once (creates the 15-min timer).
 * ─────────────────────────────────────────────────────────────────────────── */
