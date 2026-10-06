# RollTrack

Attendance for online classes. RollTrack is a Chrome extension that watches a Google Meet call, registers who is in the room while you have tracking switched on, saves it as a meeting, and then matches the attendees against your Excel student roster to produce **met / missed roll-number lists** and CSV exports.

> **Live demo:** `https://YOUR-USERNAME.github.io/rolltrack/` (GitHub Pages) or your Vercel URL. The demo is the dashboard only, with sample data. **Real meeting tracking needs the extension**, see below.

## What is in this repository

| Folder | What it is |
|---|---|
| [`extension/`](extension) | **The real product**, version 1.6.3. A ready-to-load Chrome extension (compiled build). |
| [`docs/`](docs) | The dashboard as a static website (the web demo for GitHub Pages / Vercel). Generated from `extension/`. |
| [`source-1.3.2/`](source-1.3.2) | TypeScript + React source of an **earlier** version (1.3.2). See the note below. |
| [`scripts/`](scripts) | `build-demo.mjs` rebuilds `docs/`; `demo-seed.js` is the demo's sample data. |

> **Important note about the source.** `extension/` (1.6.3) is a compiled build. The TypeScript source that produced the 1.6.x features (theme switch, backup, search, widget collapse and so on) is **not** in this repository. `source-1.3.2/` is the last full source available and does not contain those features. If you have the 1.6.x source, add it as a new folder and point the README at it.

## Install the extension (Chrome)

1. Download or clone this repository (or download the zip from the **Releases** page).
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and choose the **`extension/`** folder.
4. Open a Google Meet. A small RollTrack widget appears on the page.

After you reload or update the extension, open meeting tabs reconnect on their own; you do not need to refresh them.

## How to use it

1. **Add your roster** (dashboard, *Add List*): an Excel file with `Name`, `Roll No` and `Division` columns.
2. Join your Meet. Open the **People** panel so everyone is listed.
3. Flip the widget switch **ON** when you want attendance to start counting. Everyone in the room at that moment is registered from that moment, and anyone who joins later is registered from their own join time.
4. Flip it **OFF** (or end the call). A **Save** popup appears on the meeting page.
5. Open the dashboard, pick the meeting, set the attendance goal and press **Confirm**. Matching against the roster happens now, not when saving. Divisions with no matches are not shown.
6. Copy the roll numbers or export the CSV.

## Privacy

Everything stays in your browser: meetings and rosters are stored locally (`chrome.storage` / `localStorage`). The build makes **no network requests**; the only external URLs inside it are XML namespace identifiers in the spreadsheet library. The web demo stores its sample data in your browser only.

## Known limitations

- **Detection depends on Google Meet's page structure.** It reads names and participant IDs from the page, which Google can change. If nobody is detected, click the magnifier icon on the widget and **Copy report**: it lists what the extension can see and is the way to adjust detection.
- Zoom and Microsoft Teams support is basic and untested on live calls.
- The web demo cannot track meetings. A website cannot read a Meet tab; only the installed extension can.
- Matching is by name, so the Excel `Name` column must match what people show in the meeting.

## Web demo

`docs/` is plain static files. Open `docs/index.html` through any static server, or deploy it:

- **GitHub Pages:** Settings, Pages, deploy from branch `main`, folder `/docs`.
- **Vercel:** import the repository; `vercel.json` already points to `docs/`.

Step by step instructions are in [DEPLOY.md](DEPLOY.md). After changing `extension/`, run `node scripts/build-demo.mjs` to refresh `docs/`. Open the demo with `?empty` for no sample data or `?reset` to restore it.

## Working on the older source

```bash
cd source-1.3.2
npm install
npm run build      # produces source-1.3.2/dist (a 1.3.2 extension)
```

## License

No license file is included yet. Until you add one, the code is "all rights reserved". Choose a license (for example MIT) and add a `LICENSE` file.
