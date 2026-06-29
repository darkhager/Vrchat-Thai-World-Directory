/**
 * VRChat Thailand schedule — Google Apps Script backend.
 *
 * Returns the schedule grid as JSON so the website never needs an API key.
 * Deploy this as a Web app (see DEPLOY STEPS at the bottom), then paste the
 * /exec URL into CONFIG.scriptUrl in index.html.
 *
 * It exposes ONLY this sheet's cell text, font color, Discord link and note —
 * nothing else in the spreadsheet — so you can make the sheet private.
 */

const SHEET_ID   = '1RyoXnE6UYlYZBDRS2OXDpRDZTQ1PxaJD0bSoXjIRm-U';
const SHEET_NAME = '';   // '' = first sheet; or put the tab name here

function doGet() {
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

  return ContentService
    .createTextOutput(JSON.stringify({ rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── DEPLOY STEPS (one time) ────────────────────────────────────────────────
 * 1. Open  https://script.google.com  →  New project.
 * 2. Delete the sample code, paste THIS file, Save.
 * 3. Deploy → New deployment → gear icon → "Web app".
 *      - Execute as:        Me
 *      - Who has access:    Anyone
 *    Deploy → Authorize access → pick your account → Allow.
 * 4. Copy the "Web app" URL (ends in /exec). Send it to me, or paste it into
 *    index.html  →  CONFIG.scriptUrl.
 *
 * When you later EDIT this script, you must Deploy → Manage deployments →
 * edit the existing one → Version: "New version" → Deploy (the /exec URL stays
 * the same).
 * ─────────────────────────────────────────────────────────────────────────── */
