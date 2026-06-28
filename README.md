# VRChat Thailand — Roleplay World Schedule

A single-file website (`index.html`) that shows the weekly schedule of VRChat
roleplay venues in Thailand, styled from the Google Sheet and able to **sync
itself live** from that sheet (times, venue names, status colors, Discord links).

- **The whole site is `index.html`.** No build step. Open it in a browser, or host it anywhere static (e.g. GitHub Pages).
- The schedule shown when offline / before sync lives in the `SCHEDULE` list near the bottom of `index.html`.

---

## Turn on live sync (one-time, ~5 minutes)

The site reads the sheet through the **Google Sheets API**, which needs a free
API key. The sheet is already shared "anyone with the link can view," which is
all the key needs.

### 1. Create the API key
1. Go to **https://console.cloud.google.com/** and sign in.
2. Top bar → **Select a project** → **New Project** → name it anything → **Create**.
3. Search bar → type **"Google Sheets API"** → open it → **Enable**.
4. Left menu → **APIs & Services → Credentials** → **+ Create credentials → API key**.
5. Copy the key it shows you.

### 2. (Recommended) Lock the key down
Still on the Credentials page, click your new key → **Edit**:
- **Application restrictions → Websites** → add the sites that may use it, e.g.
  - `http://127.0.0.1:8753/*` and `http://localhost/*` (for local testing)
  - `https://YOURNAME.github.io/*` (once it's on GitHub Pages)
- **API restrictions → Restrict key →** check **Google Sheets API** only.
- **Save.**

> The key will be visible in the page source — that's expected for this setup.
> Restricting it to your site + read-only Sheets keeps the risk low (it can only
> read this already-public sheet).

### 3. Paste the key into the site
Open `index.html`, find the `CONFIG` block near the top of the `<script>`:

```js
const CONFIG = {
  sheetId: "1RyoXnE6UYlYZBDRS2OXDpRDZTQ1PxaJD0bSoXjIRm-U",
  apiKey: "",            // ← PASTE YOUR API KEY HERE between the quotes
  range: "A3:M10",       // the day rows in the sheet (Monday … Special)
  refreshMinutes: 15,    // re-pull from the sheet this often (0 = on load only)
};
```

Paste the key between the quotes on the `apiKey` line and save.

### 4. Test
Open the page. The footer should change from
"⚙ Live sync off" to **"● Live · synced from the Google Sheet at HH:MM"**.
It re-syncs on every page load and every `refreshMinutes` minutes.

---

## How it reads the sheet

- **Rows:** `range: "A3:M10"` = the 8 day rows (Monday … Special Pattern), in order.
  If you add/remove day rows in the sheet, update this range.
- **Each cell** becomes a venue: the leading time (e.g. `20:00-22:00` or `??:??`)
  is split from the venue name automatically.
- **Text color → status** (matches the sheet's legend):
  - green → free entry · grey → renovating · red → closed this week · blue → reserve
- **A hyperlink on the cell → the venue's Discord link** (the name becomes clickable).

So once sync is on, you just edit the Google Sheet as usual and the website follows.
