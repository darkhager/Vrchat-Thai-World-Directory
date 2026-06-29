# VRChat Thailand — Roleplay World Schedule

A single-file website (`index.html`) that shows the weekly schedule of VRChat
roleplay venues in Thailand, styled from the Google Sheet and able to **sync
itself live** from that sheet (times, venue names, status colors, Discord links).

- **The whole site is `index.html`.** No build step. Open it in a browser, or host it anywhere static (e.g. GitHub Pages).
- The schedule shown when offline / before sync lives in the `SCHEDULE` list near the bottom of `index.html`.

---

## Turn on live sync (one-time, ~5 minutes)

The site reads the sheet through a **Google Apps Script** web app — no API key
lives in the page. The script runs as you, reads the sheet, and returns only the
schedule as JSON, so you can keep the sheet **private**.

### 1. Create the script
1. Open **https://script.google.com** → **New project**.
2. Delete the sample code, paste everything from **`apps-script.gs`** (next to this file), **Save**.

### 2. Deploy it as a Web app
1. **Deploy → New deployment → gear icon → Web app.**
2. Set **Execute as: Me** and **Who has access: Anyone** → **Deploy**.
3. **Authorize access** → pick your account → **Allow**.
4. Copy the **Web app URL** (it ends in `/exec`).

### 3. Paste the URL into the site
Open `index.html`, find the `CONFIG` block near the top of the `<script>`:

```js
const CONFIG = {
  scriptUrl: "",         // ← PASTE YOUR /exec URL HERE between the quotes
  refreshMinutes: 15,    // re-pull from the sheet this often (0 = on load only)
};
```

Paste the URL between the quotes on the `scriptUrl` line and save.

### 4. Test
Open the page. The footer should change from
"⚙ Live sync off" to **"● Live · synced from the Google Sheet at HH:MM"**.
It re-syncs on every page load and every `refreshMinutes` minutes.

> **Editing the script later:** Deploy → **Manage deployments** → edit the existing
> one → Version **New version** → Deploy. The `/exec` URL stays the same.

---

## How it reads the sheet

- **Rows:** the script returns the whole used range; the site matches the 8 day
  rows by the day **name** in column A, so adding/moving rows won't break it.
- **Each cell** becomes a venue: the leading time (e.g. `20:00-22:00` or `??:??`)
  is split from the venue name automatically.
- **Font color → status** (matches the sheet's legend):
  - green → free entry · grey → renovating · red → closed this week · blue → reserve
- **A hyperlink on the cell → the venue's Discord link** (the name becomes clickable).
- **A note on the cell → shown under the venue** (e.g. Special Pattern opening rules).

So once sync is on, you just edit the Google Sheet as usual and the website follows.
