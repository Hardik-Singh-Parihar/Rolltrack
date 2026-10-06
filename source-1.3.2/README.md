# RollTrack — Meeting Attendance & Division Roster Matcher

A Chrome extension (Manifest V3) that detects live participants on Google Meet, Zoom, and Microsoft Teams, matches them against an Excel roster (Name / Roll No / Division), and exports attendance summaries.

## Test it locally (unpacked extension)

1. Install dependencies:
   ```
   npm install
   ```
2. Build:
   ```
   npm run build
   ```
   This produces a `dist/` folder containing the built dashboard **and** `manifest.json`, `background.js`, `content.js`, and the icons (Vite copies everything in `public/` into `dist/` automatically) — `dist/` is a complete, loadable extension.
3. In Chrome, go to `chrome://extensions`, enable **Developer mode** (top right), click **Load unpacked**, and select the `dist/` folder.
4. Open a meeting at `meet.google.com`, `*.zoom.us`, or `teams.microsoft.com`. Once RollTrack sees participant names on the page it will show up under "Detected meeting tabs" in the popup — click the toolbar icon to open it.
5. After editing source, re-run `npm run build` and hit the refresh icon on the extension's card in `chrome://extensions` to pick up the change.

## Known limitation

The DOM selectors in `public/content.js` that detect attendee names are best-effort and may need adjusting against the current live markup of each platform, since Meet/Zoom/Teams change their internal class names/attributes without notice. If "Detected meeting tabs" stays empty on a real call, that selector is the first place to check (open DevTools on the meeting tab and confirm the selectors still match a participant element).

## Preview the dashboard as a plain web page (no extension)

```
npm run dev
```

Runs the same UI at `http://localhost:3000` outside the extension shell, useful for quick UI iteration. Live-detection features naturally show nothing here since there's no content script running.
