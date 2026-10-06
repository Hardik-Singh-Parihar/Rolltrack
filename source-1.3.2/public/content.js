// RollTrack Chrome Extension Content Script
// Injected into Google Meet, Zoom Web, and Microsoft Teams to detect live
// participants, report them to the background service worker, and show an
// on-page floating widget whose ON/OFF toggle is the single source of truth
// for whether this tab is being tracked. The popup mirrors this same state
// (via background.js) rather than keeping its own — see LiveMeetingCard.tsx.
(function () {
  // ---------------------------------------------------------------------
  // One live copy per page. After the extension is reloaded, updated or
  // switched off and on again, Chrome leaves the OLD copy of this script
  // running in the page with a dead connection. The old copy marks its widget
  // `data-dead`, and background.js injects a fresh copy. This guard lets the
  // fresh copy take over: it removes the dead widget (and any dead Save
  // popup) and carries on, instead of leaving a widget that does nothing.
  // A copy that is still alive (heartbeat in the last 6 s) is left alone.
  // ---------------------------------------------------------------------
  const existingHost = document.getElementById('rolltrack-widget-host');
  if (existingHost) {
    const alive = Number(existingHost.getAttribute('data-alive') || 0);
    const dead = existingHost.getAttribute('data-dead') === '1';
    if (!dead && Date.now() - alive < 6000) return;
    existingHost.remove();
    const oldPopup = document.getElementById('rolltrack-save-host');
    if (oldPopup) oldPopup.remove();
  }

  console.debug('[RollTrack] Meeting attendee detector active on this page.');

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('meet.google.com')) return 'Google Meet';
    if (host.includes('zoom.us')) return 'Zoom';
    if (host.includes('teams.microsoft.com')) return 'Microsoft Teams';
    return 'Unknown';
  }

  const platform = detectPlatform();

  // ---------------------------------------------------------------------
  // Detection (v1.2.2)
  //
  // Identity is the platform's participant ID when we can read one (Meet puts
  // it in `data-participant-id`), NOT the display name. That keeps two
  // students called "Rahul" apart and stops a renamed student splitting in two.
  // When no ID is readable we fall back to the name.
  //
  // Names are read from text nodes only, skipping icon glyphs (Meet draws
  // icons as text such as "mic_off"), so an icon can't leak into a name.
  //
  // Sources, per scan:
  //   panel - rows of the People/Participants list (lists everyone, even
  //           people whose video tile is not on screen)
  //   tile  - video tiles that are currently drawn
  //   other - Zoom / Teams selectors
  // All selectors are best-effort: use the diagnostic panel on the widget to
  // see what a real meeting actually gives us, and adjust here.
  // ---------------------------------------------------------------------

  const ICON_CLASS_RE = /(google-symbols|material-icons|material-symbols|gm-icon)/i;
  const NOISE_RE = /^(you|\(you\)|meeting host|host|presenting|pinned|presentation|co-host|guest)$/i;
  const PRESENTATION_RE = /\(presentation\)\s*$|^your presentation$/i;
  const PANEL_LABEL_RE = /participant|people|in the (call|meeting)|contributors/i;

  function normName(n) {
    return String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isIconEl(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'I' || tag === 'svg' || tag === 'SVG' || tag === 'STYLE' || tag === 'SCRIPT') return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.getAttribute('role') === 'img') return true;
    const cls = el.getAttribute('class');
    return !!(cls && ICON_CLASS_RE.test(cls));
  }

  // Text pieces under `root`, each flagged as icon text or real text.
  function textSegments(root) {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      let icon = false;
      for (let el = n.parentElement; el; el = el.parentElement) {
        if (isIconEl(el)) {
          icon = true;
          break;
        }
        if (el === root) break;
      }
      out.push({ text: t, icon });
    }
    return out;
  }

  // Pull { name, isSelf, isPresentation } out of a tile/row element.
  function readPerson(el) {
    const segs = textSegments(el);
    const real = segs.filter((x) => !x.icon).map((x) => x.text);
    let isSelf = el.hasAttribute('data-self-name');
    if (real.some((t) => /^\(?you\)?$/i.test(t))) isSelf = true;

    if (real.some((t) => PRESENTATION_RE.test(t))) return { name: '', isSelf, isPresentation: true };

    let name = '';
    for (const t of real) {
      const cleaned = t.replace(/\s*\(you\)\s*$/i, '').trim();
      if (!cleaned || NOISE_RE.test(cleaned)) continue;
      name = cleaned;
      break;
    }
    if (!name && isSelf) name = 'You';
    if (!name) {
      const attr = el.getAttribute('data-self-name') || el.getAttribute('aria-label') || '';
      name = attr.replace(/\s*\(you\)\s*$/i, '').trim();
      if (PRESENTATION_RE.test(name)) return { name: '', isSelf, isPresentation: true };
    }
    // A whole tile's worth of text is not a name.
    if (name.length > 80) name = '';
    return { name, isSelf, isPresentation: false };
  }

  function findPanelLists() {
    const lists = [];
    document.querySelectorAll('[role="list"]').forEach((l) => {
      const holder = l.closest('[role="dialog"], [role="region"], [aria-label]');
      const label = (l.getAttribute('aria-label') || '') + ' ' + (holder ? holder.getAttribute('aria-label') || '' : '');
      if (PANEL_LABEL_RE.test(label)) lists.push(l);
    });
    return lists;
  }

  function rowId(el) {
    if (el.hasAttribute('data-participant-id')) return el.getAttribute('data-participant-id');
    const inner = el.querySelector('[data-participant-id]');
    return inner ? inner.getAttribute('data-participant-id') : null;
  }

  // Every person-like element on the page, tagged with where it came from.
  function collectRows() {
    const rows = [];
    const seenEls = new Set();
    const add = (el, source) => {
      if (seenEls.has(el)) return;
      seenEls.add(el);
      const p = readPerson(el);
      // A "(Presentation)" tile is a screen share, not a person.
      if (p.isPresentation || !p.name) return;
      rows.push({ source, id: rowId(el), name: p.name, isSelf: p.isSelf, el });
    };

    if (platform === 'Google Meet') {
      const lists = findPanelLists();
      lists.forEach((l) => l.querySelectorAll('[role="listitem"]').forEach((r) => add(r, 'panel')));
      const inPanel = (el) => lists.some((l) => l.contains(el));
      document
        .querySelectorAll('[data-participant-id], [data-self-name], [jsname="W297wb"]')
        .forEach((el) => {
          if (!inPanel(el)) add(el, 'tile');
        });
    } else if (platform === 'Zoom') {
      document.querySelectorAll('.participants-item__display-name, .item-user-name').forEach((el) => add(el, 'other'));
    } else if (platform === 'Microsoft Teams') {
      document
        .querySelectorAll('[data-tid="participant-name"], .ui-chat__item__author')
        .forEach((el) => add(el, 'other'));
    }
    return rows;
  }

  // Turn raw rows into one identity per real person. Per name we take the
  // larger of the panel / tile row counts, use real IDs where present, and
  // only synthesise "n:<name>" ids for the shortfall.
  function reconcile(rows) {
    const byName = new Map();
    for (const r of rows) {
      const norm = normName(r.name);
      let e = byName.get(norm);
      if (!e) {
        e = { name: r.name, isSelf: false, tile: [], panel: [], other: [] };
        byName.set(norm, e);
      }
      if (r.isSelf) e.isSelf = true;
      e[r.source].push(r.id);
    }
    const people = [];
    for (const [norm, e] of byName) {
      const need = Math.max(e.tile.length, e.panel.length, e.other.length);
      let ids = [];
      for (const id of [...e.tile, ...e.panel, ...e.other]) {
        if (id && !ids.includes(id)) ids.push(id);
      }
      if (ids.length > need) ids = ids.slice(0, need);
      while (ids.length < need) ids.push('n:' + norm + (ids.length ? '#' + (ids.length + 1) : ''));
      ids.forEach((id) => people.push({ id, name: e.name, isSelf: e.isSelf }));
    }
    return people;
  }

  // Meet's own participant total (badge on the People button, or a
  // "(12)" in the panel heading). null when we can't find one.
  function readReportedCount() {
    const btns = document.querySelectorAll(
      'button[aria-label*="People" i], button[aria-label*="Show everyone" i], button[aria-label*="participants" i]'
    );
    for (const b of btns) {
      const scope = b.parentElement || b;
      for (const el of [b, scope]) {
        for (const seg of textSegments(el)) {
          if (/^\d{1,4}$/.test(seg.text)) return { count: parseInt(seg.text, 10), source: 'people-button' };
        }
      }
    }
    for (const l of findPanelLists()) {
      const holder = l.closest('[role="dialog"], [role="region"]') || l.parentElement;
      if (!holder) continue;
      const m = (holder.textContent || '').match(/\((\d{1,4})\)/);
      if (m) return { count: parseInt(m[1], 10), source: 'panel-heading' };
    }
    return { count: null, source: null };
  }

  function clip(html, n) {
    return html.length > n ? html.slice(0, n) + '…' : html;
  }

  function buildReport(rows, people, rc) {
    const lists = platform === 'Google Meet' ? findPanelLists() : [];
    const btn = document.querySelector(
      'button[aria-label*="People" i], button[aria-label*="Show everyone" i], button[aria-label*="participants" i]'
    );
    const of = (src) => rows.filter((r) => r.source === src);
    return {
      version: '1.2.2',
      platform,
      url: location.href,
      at: new Date().toISOString(),
      captured: people.length,
      reportedCount: rc.count,
      reportedSource: rc.source,
      rowCounts: { panel: of('panel').length, tile: of('tile').length, other: of('other').length },
      panelListsFound: lists.length,
      rows: rows.slice(0, 300).map((r) => ({
        source: r.source,
        name: r.name,
        id: r.id,
        self: r.isSelf,
      })),
      samples: {
        panelList: lists[0] ? clip(lists[0].cloneNode(false).outerHTML, 400) : null,
        panelRows: of('panel').slice(0, 2).map((r) => clip(r.el.outerHTML, 2500)),
        tiles: of('tile').slice(0, 2).map((r) => clip(r.el.outerHTML, 2500)),
        peopleButton: btn ? clip((btn.parentElement || btn).outerHTML, 1200) : null,
      },
    };
  }

  // One fresh look at the room. `attendees` is what background.js consumes.
  function scanNow(includeReport) {
    let rows = [];
    try {
      rows = collectRows();
    } catch (e) {
      console.warn('[RollTrack] scan failed', e);
    }
    const attendees = reconcile(rows);
    const rc = readReportedCount();
    const out = { attendees, reportedCount: rc.count, reportedSource: rc.source };
    if (includeReport) out.report = buildReport(rows, attendees, rc);
    return out;
  }

  // ---------------------------------------------------------------------
  // Messaging helpers, defensive against "Extension context invalidated"
  // (thrown when the extension is reloaded/updated while this tab is still
  // open — a routine, expected situation, not a real error).
  // ---------------------------------------------------------------------

  let contextInvalidated = false;
  let snapshotTimer = null;
  let syncTimer = null;
  let aliveTimer = null;

  function isContextValid() {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  }

  // Only a dead connection counts. Other lastError values (for example the
  // service worker restarting for a moment) are transient: try again next tick.
  function isInvalidationError(err) {
    const m = String((err && err.message) || err || '');
    return /context invalidated|Extension context/i.test(m) || !isContextValid();
  }

  function stopTimers() {
    [snapshotTimer, syncTimer, aliveTimer, tickTimer].forEach((t) => t && clearInterval(t));
    snapshotTimer = syncTimer = aliveTimer = tickTimer = null;
  }

  // The extension was reloaded, updated or switched off. Expected, not an
  // error: stop all work, mark this copy dead so a fresh copy can replace it,
  // and show that the widget is disconnected. No scary console output.
  function noteInvalidContext() {
    if (contextInvalidated) return;
    contextInvalidated = true;
    stopTimers();
    try {
      if (saveHost) {
        saveHost.remove();
        saveHost = null;
      }
      saveShown = null;
    } catch (e) {}
    try {
      if (widgetHost) widgetHost.setAttribute('data-dead', '1');
      if (widgetRefs) {
        widgetRefs.tab.style.opacity = '0.4';
        widgetRefs.tab.title = 'RollTrack is disconnected (extension reloaded or turned off). It reconnects by itself when it is back on.';
        widgetRefs.toggle.disabled = true;
        widgetRefs.countEl.textContent = 'offline';
        widgetRefs.countEl.className = 'count';
      }
    } catch (e) {}
    console.info('[RollTrack] Extension was reloaded or turned off. This page reconnects automatically when it is back on.');
  }

  function sendMessageSafe(msg, cb) {
    if (!isContextValid()) return noteInvalidContext();
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          if (isInvalidationError(chrome.runtime.lastError)) noteInvalidContext();
          return;
        }
        if (cb) cb(res);
      });
    } catch (e) {
      if (isInvalidationError(e)) noteInvalidContext();
    }
  }

  // Heartbeat on the widget element itself. A fresh copy of this script reads
  // it to tell a live copy from a dead one left over after an extension reload.
  function markAlive() {
    if (widgetHost && widgetHost.isConnected && !contextInvalidated) {
      widgetHost.setAttribute('data-alive', String(Date.now()));
    }
  }

  function sendSnapshot() {
    if (contextInvalidated) return;
    const scan = scanNow(false);
    updateCountPill(scan);
    if (scan.attendees.length === 0 && scan.reportedCount == null) return;
    sendMessageSafe({
      type: 'ROLLTRACK_ATTENDEES_SNAPSHOT',
      platform,
      url: location.href,
      attendees: scan.attendees.map((a) => ({ id: a.id, name: a.name })),
      reportedCount: scan.reportedCount,
    });
  }

  // ---------------------------------------------------------------------
  // Floating widget. Its ON/OFF is the single source of truth for tracking:
  // flipping it sends ROLLTRACK_SET_TRACKING to background.js, which stamps
  // trackingStartedAt at that exact moment. The popup's own toggle calls the
  // identical message, so there is exactly one place this state is decided.
  // ---------------------------------------------------------------------

  const WIDGET_ID = 'rolltrack-widget-host';
  let widgetRefs = null;
  let widgetHost = null;
  let myTabId = null; // learned from background.js's response
  let trackingOn = false;
  let trackingStartedAt = null;
  let tickTimer = null;

  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    if (platform === 'Unknown') return;

    const host = document.createElement('div');
    host.id = WIDGET_ID;
    host.style.all = 'initial';
    host.style.position = 'fixed';
    host.style.top = '50%';
    host.style.right = '0px';
    host.style.zIndex = '2147483647';
    document.documentElement.appendChild(host);
    widgetHost = host;
    markAlive();

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
        .tab {
          display: flex; align-items: center; gap: 8px;
          background: #151922; color: #f5f5f5; border: 1px solid #232836;
          padding: 8px 12px 8px 10px; border-radius: 10px 0 0 10px;
          box-shadow: -2px 2px 10px rgba(0,0,0,0.35);
          user-select: none;
          transform: translateY(-50%);
          transition: transform 150ms ease-out;
        }
        .tab:hover { transform: translateY(-50%) scale(1.03); }
        .home-btn {
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; flex-shrink: 0; padding: 0;
          background: transparent; border: none; border-radius: 6px;
          color: #9aa0ad; cursor: pointer;
        }
        .home-btn:hover { background: #232836; color: #f5f5f5; }
        .home-btn:focus-visible { outline: 2px solid #3b82f6; outline-offset: 1px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #5f6473; flex-shrink: 0; }
        .dot.on { background: #34d399; animation: pulse 1.4s infinite; }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); }
          70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
          100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
        }
        .label { font-size: 11px; font-weight: 700; white-space: nowrap; }
        .elapsed { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #9aa0ad; white-space: nowrap; min-width: 34px; text-align: right; }
        .count { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 99px; background: #232836; color: #9aa0ad; white-space: nowrap; }
        .count.ok { background: rgba(52,211,153,.15); color: #34d399; }
        .count.warn { background: rgba(251,191,36,.18); color: #fbbf24; }
        .diag-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; padding: 0; background: transparent; border: none; border-radius: 6px; color: #9aa0ad; cursor: pointer; }
        .diag-btn:hover { background: #232836; color: #f5f5f5; }
        .diag { position: fixed; top: 16px; right: 230px; width: 380px; max-height: 78vh; overflow: auto; background: #0f131b; color: #e5e7eb; border: 1px solid #232836; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 12px; font-size: 11px; line-height: 1.4; }
        .diag[hidden] { display: none; }
        .diag h4 { margin: 0 0 6px; font-size: 12px; }
        .diag .row { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid #1a2030; }
        .diag .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .diag .n { flex: 1; } .diag .s { width: 44px; color: #9aa0ad; } .diag .i { width: 70px; color: #6b7280; font-family: monospace; } 
        .diag .warnline { color: #fbbf24; margin: 4px 0; }
        .diag .btns { display: flex; gap: 6px; margin-top: 8px; }
        .diag button { background: #232836; color: #f5f5f5; border: 1px solid #333b4d; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
        .diag button:hover { background: #2b3245; }
        .switch { position: relative; width: 30px; height: 17px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .slider { position: absolute; inset: 0; background: #333b4d; border-radius: 99px; transition: .15s; cursor: pointer; }
        .slider:before { content: ''; position: absolute; width: 13px; height: 13px; left: 2px; top: 2px; background: #fff; border-radius: 50%; transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
        input:checked + .slider { background: #34d399; }
        input:checked + .slider:before { transform: translateX(13px); }
        .switch input:focus-visible + .slider { outline: 2px solid #3b82f6; outline-offset: 2px; }
      </style>
      <div class="tab" id="tab" role="group" aria-label="RollTrack">
        <button class="home-btn" id="homeBtn" type="button" title="Open RollTrack dashboard" aria-label="Open RollTrack dashboard">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 11.5 12 4l9 7.5"/>
            <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9"/>
          </svg>
        </button>
        <span class="dot" id="dot"></span>
        <span class="label">RollTrack</span>
        <span class="count" id="count" title="People detected / people Meet says are in the call"></span>
        <span class="elapsed" id="elapsed"></span>
        <button class="diag-btn" id="diagBtn" type="button" title="RollTrack diagnostic" aria-label="RollTrack diagnostic">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>
        <label class="switch">
          <input type="checkbox" id="toggle" aria-label="Tracking on/off" />
          <span class="slider"></span>
        </label>
      </div>
      <div class="diag" id="diag" hidden></div>
    `;

    const dot = root.getElementById('dot');
    const elapsedEl = root.getElementById('elapsed');
    const toggle = root.getElementById('toggle');
    const homeBtn = root.getElementById('homeBtn');
    const countEl = root.getElementById('count');
    const diagBtn = root.getElementById('diagBtn');
    const diagEl = root.getElementById('diag');

    toggle.addEventListener('change', (e) => {
      if (myTabId == null) {
        e.preventDefault();
        e.target.checked = trackingOn; // revert visually — we don't know our tab ID yet
        return;
      }
      // Take a fresh headcount at the exact moment of the click so the
      // start / stop of the session is registered from what is on the page
      // right now, not from the last 2-second heartbeat.
      const fresh = scanNow(false);
      sendMessageSafe({
        type: 'ROLLTRACK_SET_TRACKING',
        tabId: myTabId,
        on: e.target.checked,
        platform,
        source: 'widget',
        snapshot: {
          attendees: fresh.attendees.map((a) => ({ id: a.id, name: a.name })),
          reportedCount: fresh.reportedCount,
        },
      });
    });

    diagBtn.addEventListener('click', () => {
      diagEl.hidden = !diagEl.hidden;
      if (!diagEl.hidden) renderDiag();
    });

    // Opens (or focuses) the RollTrack dashboard tab — the same "home page"
    // the toolbar popup shows — without leaving this meeting tab. Handled by
    // background.js since content scripts can't open tabs directly.
    homeBtn.addEventListener('click', () => {
      sendMessageSafe({ type: 'ROLLTRACK_OPEN_HOME' });
    });

    widgetRefs = { tab: root.getElementById('tab'), dot, elapsedEl, toggle, homeBtn, countEl, diagEl };
    applyTrackingUI();
  }

  // "64/70" pill: people we identified / people Meet says are in the call.
  function updateCountPill(scan) {
    if (!widgetRefs) return;
    const el = widgetRefs.countEl;
    const got = scan.attendees.length;
    if (scan.reportedCount == null) {
      el.textContent = String(got);
      el.className = 'count';
      el.title = "People detected. Couldn't read Meet's participant count.";
      return;
    }
    const missing = scan.reportedCount - got;
    el.textContent = got + '/' + scan.reportedCount;
    el.className = 'count ' + (missing === 0 ? 'ok' : 'warn');
    el.title =
      missing > 0
        ? missing + ' person(s) in the call could not be identified. Open the People panel.'
        : missing < 0
          ? 'Detected more names than Meet reports. Possible duplicates.'
          : 'Everyone in the call is identified.';
    if (widgetRefs.diagEl && !widgetRefs.diagEl.hidden) renderDiag();
  }

  function esc(t) {
    return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        return;
      }
    } catch (e) {}
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    ta.remove();
  }

  // Diagnostic panel: what the extension actually sees, per person.
  function renderDiag() {
    if (!widgetRefs || !widgetRefs.diagEl) return;
    const scan = scanNow(true);
    const r = scan.report;
    const missing = r.reportedCount == null ? null : r.reportedCount - r.captured;
    const rowsHtml = r.rows
      .map(
        (x) =>
          '<div class="row"><span class="n" title="' + esc(x.name) + '">' + esc(x.name) + (x.self ? ' (you)' : '') +
          '</span><span class="s">' + x.source + '</span><span class="i" title="' + esc(x.id || '') + '">' +
          esc((x.id || '—').slice(-9)) + '</span></div>'
      )
      .join('');
    widgetRefs.diagEl.innerHTML =
      '<h4>RollTrack diagnostic</h4>' +
      '<div>Identified: <b>' + r.captured + '</b> · Meet says: <b>' + (r.reportedCount == null ? 'not found' : r.reportedCount) +
      '</b>' + (r.reportedSource ? ' (' + r.reportedSource + ')' : '') + '</div>' +
      '<div>Rows: panel ' + r.rowCounts.panel + ' · tiles ' + r.rowCounts.tile + ' · other ' + r.rowCounts.other +
      ' · People list found: ' + (r.panelListsFound ? 'yes' : 'no') + '</div>' +
      (missing > 0 ? '<div class="warnline">' + missing + ' in the call not identified. Open the People panel.</div>' : '') +
      (r.rowCounts.panel === 0 && platform === 'Google Meet' ? '<div class="warnline">People panel not readable. Open it (People icon).</div>' : '') +
      '<div style="margin-top:6px">' + (rowsHtml || '<i>No rows found.</i>') + '</div>' +
      '<div class="btns"><button id="dCopy">Copy report</button><button id="dClose">Close</button></div>';
    const root = widgetRefs.diagEl;
    root.querySelector('#dCopy').onclick = () => {
      copyText(JSON.stringify(r, null, 2));
      root.querySelector('#dCopy').textContent = 'Copied';
    };
    root.querySelector('#dClose').onclick = () => (widgetRefs.diagEl.hidden = true);
  }

  function applyTrackingUI() {
    if (!widgetRefs) return;
    widgetRefs.dot.classList.toggle('on', trackingOn);
    widgetRefs.toggle.checked = trackingOn;
    clearInterval(tickTimer);
    if (trackingOn && trackingStartedAt) {
      const tick = () => (widgetRefs.elapsedEl.textContent = fmtElapsed(Date.now() - trackingStartedAt));
      tick();
      tickTimer = setInterval(tick, 1000);
    } else {
      widgetRefs.elapsedEl.textContent = '';
    }
  }

  // Learn our own tab ID and current tracking state from background.js —
  // chrome.tabs isn't available to content scripts, so we ask indirectly.
  // ---------------------------------------------------------------------
  // Save popup: shown ON THE MEETING PAGE when tracking is turned OFF here.
  //
  // The dashboard is not opened or focused. background.js has already frozen
  // the session (who was there and for how long) into a pending
  // save; this is only the UI for the save action, and it stays the timing
  // authority. Save turns the frozen session into a saved meeting (raw
  // attendance, no roster matching); Cancel discards it.
  // ---------------------------------------------------------------------
  const saveQueue = [];
  const handledSaveIds = new Set();
  let saveShown = null;
  let saveHost = null;

  function fmtDuration(sec) {
    const m = Math.floor(sec / 60);
    return m + ':' + String(sec % 60).padStart(2, '0');
  }

  function enqueueSave(p) {
    if (!p || !p.id || handledSaveIds.has(p.id)) return;
    if ((saveShown && saveShown.id === p.id) || saveQueue.some((q) => q.id === p.id)) return;
    saveQueue.push(p);
    showNextSave();
  }

  function closeSavePopup() {
    if (saveHost) {
      saveHost.remove();
      saveHost = null;
    }
    saveShown = null;
  }

  function finishSave(p) {
    handledSaveIds.add(p.id);
    closeSavePopup();
    showNextSave();
  }

  function showNextSave() {
    if (saveShown || saveQueue.length === 0 || contextInvalidated) return;
    saveShown = saveQueue.shift();
    renderSavePopup(saveShown);
  }

  function renderSavePopup(p) {
    const host = document.createElement('div');
    host.id = 'rolltrack-save-host';
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const missingEnd = p.missingAtEnd || 0;
    const missingStart = p.missingAtStart || 0;
    const peak = p.peakMissing || 0;
    const warn = [];
    if (p.reportedCount != null) {
      warn.push('Identified ' + p.attendees.length + ' name' + (p.attendees.length === 1 ? '' : 's') + '; the call had ' + p.reportedCount + ' when you stopped.');
    }
    if (missingStart > 0) warn.push(missingStart + ' in the call could not be identified when tracking started.');
    if (missingEnd > 0) warn.push(missingEnd + ' in the call could not be identified when tracking stopped.');
    if (missingEnd === 0 && peak > 0) warn.push('At one point up to ' + peak + ' could not be identified (they may have left since).');
    const showWarn = warn.length > 0 && (missingEnd > 0 || missingStart > 0 || peak > 0);

    root.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.62); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .card { width: 100%; max-width: 420px; background: #111722; color: #e5e7eb; border: 1px solid #232b3b; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; }
        .head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: #0d121c; border-bottom: 1px solid #232b3b; }
        .dot { width: 30px; height: 30px; border-radius: 8px; background: rgba(239,68,68,.18); border: 1px solid rgba(239,68,68,.4); display: flex; align-items: center; justify-content: center; }
        .dot i { width: 9px; height: 9px; border-radius: 50%; background: #f87171; display: block; }
        h3 { margin: 0; font-size: 15px; font-weight: 600; color: #fff; }
        .sub { margin: 2px 0 0; font-size: 11px; color: #94a3b8; }
        .body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
        label.t { font-size: 12px; font-weight: 600; color: #cbd5e1; display: block; margin-bottom: 5px; }
        input[type=text] { width: 100%; padding: 9px 12px; font-size: 13px; background: #0b0e14; color: #f1f5f9; border: 1px solid #232b3b; border-radius: 10px; outline: none; }
        input[type=text]:focus { border-color: #3b82f6; }
        .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .stat { background: #0c1017; border: 1px solid #1c2433; border-radius: 10px; padding: 8px 10px; }
        .stat span { display: block; font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
        .stat b { font-size: 15px; color: #fff; font-family: ui-monospace, monospace; }
        .warn { font-size: 11px; color: #fcd34d; background: rgba(120,53,15,.2); border: 1px solid rgba(180,83,9,.4); border-radius: 10px; padding: 8px 10px; line-height: 1.45; }
        .warn p { margin: 0 0 4px; } .warn p:last-of-type { margin-bottom: 0; }
        .warn label { display: flex; gap: 7px; align-items: flex-start; margin-top: 8px; color: #e2e8f0; cursor: pointer; }
        .msg { margin: 0; font-size: 12px; color: #93c5fd; min-height: 16px; }
        .msg.err { color: #fca5a5; } .msg.ok { color: #6ee7b7; }
        .btns { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid #232b3b; }
        button { font-size: 13px; font-weight: 600; border: none; border-radius: 10px; padding: 9px 16px; cursor: pointer; }
        button.cancel { background: transparent; color: #94a3b8; } button.cancel:hover { background: #1c2433; color: #e2e8f0; }
        button.save { background: #2563eb; color: #fff; } button.save:hover { background: #3b82f6; }
        button:disabled { opacity: .55; cursor: default; }
      </style>
      <div class="overlay">
        <div class="card" role="dialog" aria-modal="true" aria-label="Save meeting">
          <div class="head">
            <div class="dot"><i></i></div>
            <div><h3>Save meeting?</h3><p class="sub" id="sub"></p></div>
          </div>
          <div class="body">
            <div><label class="t" for="title">Meeting title</label><input id="title" type="text" maxlength="120" /></div>
            <div class="stats">
              <div class="stat"><span>Duration</span><b id="dur"></b></div>
              <div class="stat"><span>People</span><b id="ppl"></b></div>
            </div>
            <div class="warn" id="warn" hidden></div>
            <p class="msg" id="msg"></p>
            <div class="btns"><button class="cancel" id="cancel" type="button">Cancel</button><button class="save" id="save" type="button">Save meeting</button></div>
          </div>
        </div>
      </div>`;

    const $ = (id) => root.getElementById(id);
    $('sub').textContent = 'Tracking stopped · ' + p.platform;
    $('dur').textContent = fmtDuration(p.durationSeconds || 0);
    $('ppl').textContent = String(p.attendees.length);
    const titleInput = $('title');
    titleInput.value = p.title || '';

    let placeholders = null;
    if (showWarn) {
      const w = $('warn');
      w.hidden = false;
      w.innerHTML = '';
      warn.forEach((t) => {
        const el = document.createElement('p');
        el.textContent = t;
        w.appendChild(el);
      });
      const tip = document.createElement('p');
      tip.textContent = 'Tip: keep the People panel open during the meeting.';
      tip.style.opacity = '.7';
      w.appendChild(tip);
      if (missingEnd > 0) {
        const lab = document.createElement('label');
        placeholders = document.createElement('input');
        placeholders.type = 'checkbox';
        const txt = document.createElement('span');
        txt.textContent = 'Add ' + missingEnd + ' \u201CUnidentified participant\u201D ' + (missingEnd === 1 ? 'entry' : 'entries') + ' (0 min, time unknown)';
        lab.appendChild(placeholders);
        lab.appendChild(txt);
        w.appendChild(lab);
      }
    }

    // The meeting page has its own keyboard shortcuts: keep typing to ourselves.
    ['keydown', 'keyup', 'keypress'].forEach((ev) => host.addEventListener(ev, (e) => e.stopPropagation()));

    const setMsg = (text, cls) => {
      $('msg').textContent = text;
      $('msg').className = 'msg' + (cls ? ' ' + cls : '');
    };

    $('cancel').addEventListener('click', () => {
      // Discard: the frozen session is dropped.
      sendMessageSafe({ type: 'ROLLTRACK_REMOVE_PENDING_SAVE', id: p.id });
      finishSave(p);
    });

    $('save').addEventListener('click', () => {
      const saveBtn = $('save');
      saveBtn.disabled = true;
      $('cancel').disabled = true;
      setMsg('Saving\u2026');
      let answered = false;
      const guard = setTimeout(() => {
        if (answered) return;
        setMsg('Could not save. Try again.', 'err');
        saveBtn.disabled = false;
        $('cancel').disabled = false;
      }, 6000);
      sendMessageSafe(
        {
          type: 'ROLLTRACK_SAVE_PENDING',
          id: p.id,
          title: titleInput.value,
          addPlaceholders: !!(placeholders && placeholders.checked),
        },
        (res) => {
          answered = true;
          clearTimeout(guard);
          if (res && res.ok) {
            // Stay on the meeting page: no navigation anywhere.
            setMsg('Saved. Open RollTrack to view it.', 'ok');
            setTimeout(() => finishSave(p), 1400);
          } else {
            setMsg('Could not save. Try again.', 'err');
            saveBtn.disabled = false;
            $('cancel').disabled = false;
          }
        }
      );
    });

    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('save').click();
    });

    saveHost = host;
    document.documentElement.appendChild(host);
    titleInput.focus();
    titleInput.select();
  }

  function syncStateFromBackground() {
    sendMessageSafe({ type: 'ROLLTRACK_WHOAMI' }, (res) => {
      if (!res) return;
      myTabId = res.tabId;
      trackingOn = !!res.trackingOn;
      trackingStartedAt = res.trackingStartedAt || null;
      applyTrackingUI();
      // Sessions turned OFF on this page that still need their Save popup
      // (covers a page reload while the popup was open, or a missed message).
      const pending = Array.isArray(res.pending) ? res.pending : [];
      pending.forEach(enqueueSave);
      // Saved or dropped somewhere else in the meantime: stop offering it.
      const live = new Set(pending.map((x) => x.id));
      for (let i = saveQueue.length - 1; i >= 0; i--) if (!live.has(saveQueue[i].id)) saveQueue.splice(i, 1);
      if (saveShown && !live.has(saveShown.id) && !handledSaveIds.has(saveShown.id)) {
        // Only close if it is not mid-save (buttons disabled while saving).
        const btn = saveHost && saveHost.shadowRoot && saveHost.shadowRoot.getElementById('save');
        if (btn && !btn.disabled) finishSave(saveShown);
      }
    });
  }

  // Background broadcasts changes (including ones made from the popup) —
  // apply them if they're about us, so the widget and popup never disagree.
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // background.js asks for a fresh headcount when tracking is switched
      // from the dashboard, so ON/OFF is still registered from a live scan.
      if (message && message.type === 'ROLLTRACK_SCAN_NOW') {
        const fresh = scanNow(false);
        sendResponse({
          attendees: fresh.attendees.map((a) => ({ id: a.id, name: a.name })),
          reportedCount: fresh.reportedCount,
        });
        return false;
      }
      // background.js checks that this page's script is alive (and re-injects a
      // fresh copy when it is not).
      if (message && message.type === 'ROLLTRACK_PING') {
        sendResponse({ alive: !contextInvalidated });
        return false;
      }
      if (message && message.type === 'ROLLTRACK_SHOW_SAVE') {
        enqueueSave(message.pending);
        return false;
      }
      if (message && message.type === 'ROLLTRACK_TRACKING_CHANGED') {
        trackingOn = !!message.on;
        trackingStartedAt = message.trackingStartedAt || null;
        applyTrackingUI();
      }
    });
  }

  // Periodic heartbeat (2 s: shorter visits are still caught)
  snapshotTimer = setInterval(sendSnapshot, 2000);
  sendSnapshot();

  createWidget();
  syncStateFromBackground();
  syncTimer = setInterval(syncStateFromBackground, 5000); // cheap periodic reconcile, e.g. after a reload
  aliveTimer = setInterval(markAlive, 1000);
})();
