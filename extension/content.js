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
  // fresh copy take over: it removes the dead widget (and any dead Save popup)
  // and carries on, instead of leaving a widget that reacts but does nothing.
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

  console.log('[RollTrack] Meeting attendee detector active on this page.');

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

  // Icon-font words that appear as text ("mic_off", "more_vert", "call_end", ...).
  // Never a person's name, whatever element they sit in.
  const LIGATURE_WORDS = new Set(['mic', 'videocam', 'keep', 'close', 'info', 'add', 'check', 'search', 'remove', 'send', 'chat', 'apps']);
  function isLigature(t) {
    if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(t)) return true; // underscore words: mic_off, more_vert, ...
    return LIGATURE_WORDS.has(t); // single all-lowercase icon words
  }

  function isIconEl(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'I' || tag === 'svg' || tag === 'SVG' || tag === 'STYLE' || tag === 'SCRIPT') return true;
    // NOT aria-hidden / role="img": real Meet tiles put the visible name label in
    // such elements, and treating them as icons made every name vanish (0 attendees).
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
  function pickName(texts) {
    for (const t of texts) {
      const cleaned = t.replace(/\s*\(you\)\s*$/i, '').trim();
      if (!cleaned || NOISE_RE.test(cleaned) || isLigature(cleaned)) continue;
      return cleaned;
    }
    return '';
  }

  function readPerson(el) {
    const segs = textSegments(el);
    const strict = segs.filter((x) => !x.icon).map((x) => x.text);
    // Loose: every text piece, including ones inside aria-hidden / icon-class
    // elements. Used only when the strict pass finds no name.
    const loose = segs.map((x) => x.text);
    let isSelf = el.hasAttribute('data-self-name');
    if (loose.some((t) => /^\(?you\)?$/i.test(t))) isSelf = true;

    if (loose.some((t) => PRESENTATION_RE.test(t))) return { name: '', isSelf, isPresentation: true };

    let name = pickName(strict) || pickName(loose);
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
      version: '1.6.3',
      platform,
      url: location.href,
      at: new Date().toISOString(),
      inCall: platform === 'Google Meet' ? inCallNow() : null,
      selfFallback: people.length === 1 && people[0].id === 'self',
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
      // Raw page elements that SHOULD hold names, taken straight from the page even when
      // no person could be read from them. This is what tells us why detection found nobody.
      domSamples: {
        participantIdElements: document.querySelectorAll('[data-participant-id]').length,
        selfNameElements: document.querySelectorAll('[data-self-name]').length,
        listItems: document.querySelectorAll('[role="listitem"]').length,
        firstParticipantIdElements: Array.from(document.querySelectorAll('[data-participant-id]')).slice(0, 2).map((e) => clip(e.outerHTML, 2500)),
        firstSelfNameElement: (() => { const e = document.querySelector('[data-self-name]'); return e ? clip(e.outerHTML, 2500) : null; })(),
        firstListItems: Array.from(document.querySelectorAll('[role="listitem"]')).slice(0, 2).map((e) => clip(e.outerHTML, 2000)),
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
    let attendees = reconcile(rows);
    // Last resort: nobody could be read from the page, but we ARE in the call (the
    // hang-up button is there). The user is in the room, so count them instead of
    // reporting an empty meeting. The headcount pill still warns if others are present.
    let selfFallback = false;
    if (attendees.length === 0 && platform === 'Google Meet' && inCallNow()) {
      attendees = [{ id: 'self', name: 'You', isSelf: true }];
      selfFallback = true;
    }
    const rc = readReportedCount();
    const out = { attendees, reportedCount: rc.count, reportedSource: rc.source, selfFallback };
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
  let callTimer = null;

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
    [snapshotTimer, syncTimer, aliveTimer, callTimer, tickTimer].forEach((t) => t && clearInterval(t));
    snapshotTimer = syncTimer = aliveTimer = callTimer = tickTimer = null;
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
        if (widgetRefs.warn) widgetRefs.warn.hidden = true;
      }
    } catch (e) {}
    console.info('[RollTrack] Extension was reloaded or turned off. This page reconnects automatically when it is back on.');
  }

  function sendMessageSafe(msg, cb) {
    if (!isContextValid()) return noteInvalidContext();
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (isInvalidationError(err)) return noteInvalidContext();
          // "Message port closed" just means background.js did not send a reply
          // (many commands are fire-and-forget). That is normal, NOT a broken
          // extension, so it must not disable the widget or the Save popup.
          if (!/port closed|no response|before a response/i.test(String(err.message || err))) return; // transient: retry next tick
        }
        if (cb) cb(res);
      });
    } catch (e) {
      if (isInvalidationError(e)) noteInvalidContext();
    }
  }

  // Self-check: while tracking in a Meet call, warn when nobody (or far fewer
  // people than Meet reports) is being detected, usually the People panel is closed.
  let weakTicks = 0;
  function checkDetectionHealth(scan) {
    if (!widgetRefs || !widgetRefs.warn) return;
    let weak = false;
    if (platform === 'Google Meet' && trackingOn && inCallNow()) {
      const got = scan.attendees.length;
      const rep = scan.reportedCount;
      weak = got === 0 || (rep != null && rep - got >= 2);
    }
    weakTicks = weak ? weakTicks + 1 : 0;
    const show = weakTicks >= 8; // ~16 s
    if (widgetRefs.warn.hidden === show) {
      widgetRefs.warn.hidden = !show;
      widgetRefs.mdot.classList.toggle('warnon', show);
      if (show && widgetRefs.expand) widgetRefs.expand();
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
    checkDetectionHealth(scan);
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
  let tickStart = null;

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
    host.style.left = '0px';
    host.style.top = '0px';
    host.style.zIndex = '2147483647';
    document.documentElement.appendChild(host);
    widgetHost = host;
    markAlive();

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
        .tab {
          display: block;
          background: linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04)), rgba(19,19,23,0.62);
          -webkit-backdrop-filter: blur(18px) saturate(170%); backdrop-filter: blur(18px) saturate(170%);
          color: #f5f5f5; border: 1px solid rgba(255,255,255,0.14);
          padding: 0; border-radius: 14px;
          box-shadow: 0 8px 28px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06);
          user-select: none; position: relative;
          cursor: grab; touch-action: none;
          transition: width .55s cubic-bezier(.22,1,.36,1), height .55s cubic-bezier(.22,1,.36,1), border-radius .55s cubic-bezier(.22,1,.36,1), opacity .45s ease, box-shadow .5s ease, border-color .5s ease;
          will-change: width, height;
        }
        .clip { position: relative; display: block; width: 100%; height: 100%; border-radius: inherit; overflow: hidden; }
        .tab.dragging { cursor: grabbing; }
        .full { display: flex; align-items: center; gap: 8px; padding: 8px 12px 8px 8px; white-space: nowrap;
          opacity: 1; transform: none; transition: opacity .35s ease .14s, transform .55s cubic-bezier(.22,1,.36,1) .06s; }
        .grip { display: flex; align-items: center; color: #5f5f6a; flex-shrink: 0; }
        .mini { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #b4b4bd;
          opacity: 0; transform: scale(.55) rotate(-25deg); pointer-events: none; transition: opacity .3s ease, transform .5s cubic-bezier(.22,1,.36,1); }
        .mdot { position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%; background: #5f5f6a; border: 2px solid #131317; opacity: 0; transform: scale(.4); transition: opacity .3s ease, transform .45s cubic-bezier(.22,1,.36,1); z-index: 2; }
        .tab.collapsed .mdot { opacity: 1; transform: none; }
        .warn { font-size: 11px; font-weight: 600; color: #f3d38a; background: rgba(243,211,138,.12); border: 1px solid rgba(243,211,138,.3); padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
        .warn[hidden] { display: none; }
        .mdot.warnon { background: #ecbb55; }
        .mdot.on { background: #34d399; animation: mpulse 2s ease-out infinite; }
        @keyframes mpulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); } 70% { box-shadow: 0 0 0 7px rgba(52,211,153,0); } 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } }
        .tab.live { border-color: rgba(52,211,153,.45); box-shadow: 0 8px 28px rgba(0,0,0,0.45), 0 0 22px rgba(52,211,153,.28), inset 0 1px 0 rgba(255,255,255,0.1); }
        .tab.just-on { animation: gl 1.2s ease-out 1; }
        @keyframes gl { 0% { transform: scale(.94); } 40% { transform: scale(1.06); } 100% { transform: scale(1); } }
        .tab.collapsed { width: 30px; height: 30px; border-radius: 15px; opacity: .78; }
        .tab.collapsed:hover { opacity: 1; }
        .tab.collapsed .full { position: absolute; left: 0; top: 0; opacity: 0; transform: scale(.92); pointer-events: none; transition: opacity .2s ease, transform .45s cubic-bezier(.22,1,.36,1); }
        .tab.collapsed .mini { opacity: 1; transform: none; pointer-events: auto; transition-delay: .12s; }
        .home-btn {
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; flex-shrink: 0; padding: 0;
          background: transparent; border: none; border-radius: 6px;
          color: #8f8f9a; cursor: pointer;
        }
        .home-btn:hover { background: #2a2a31; color: #f5f5f5; }
        .home-btn:focus-visible { outline: 2px solid #6c7bf7; outline-offset: 1px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #5f5f6a; flex-shrink: 0; }
        .dot.on { background: #34d399; animation: pulse 1.4s infinite; }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); }
          70% { box-shadow: 0 0 0 6px rgba(52,211,153,0); }
          100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
        }
        .label { font-size: 11px; font-weight: 700; white-space: nowrap; }
        .elapsed { font-variant-numeric: tabular-nums; font-size: 11px; color: #8f8f9a; white-space: nowrap; min-width: 34px; text-align: right; }
        .count { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 99px; background: #2a2a31; color: #8f8f9a; white-space: nowrap; }
        .count.ok { background: rgba(52,211,153,.15); color: #34d399; }
        .count.warn { background: rgba(251,191,36,.18); color: #fbbf24; }
        .diag-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; padding: 0; background: transparent; border: none; border-radius: 6px; color: #8f8f9a; cursor: pointer; }
        .diag-btn:hover { background: #2a2a31; color: #f5f5f5; }
        .diag { position: fixed; top: 16px; right: 230px; width: 380px; max-height: 78vh; overflow: auto; background: #0e0e12; color: #e5e7eb; border: 1px solid #2a2a31; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 12px; font-size: 11px; line-height: 1.4; }
        .diag[hidden] { display: none; }
        .diag h4 { margin: 0 0 6px; font-size: 12px; }
        .diag .row { display: flex; gap: 6px; padding: 2px 0; border-bottom: 1px solid #1b1b21; }
        .diag .row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .diag .n { flex: 1; } .diag .s { width: 44px; color: #8f8f9a; } .diag .i { width: 70px; color: #6b7280; font-family: monospace; } 
        .diag .warnline { color: #fbbf24; margin: 4px 0; }
        .diag .btns { display: flex; gap: 6px; margin-top: 8px; }
        .diag button { background: #2a2a31; color: #f5f5f5; border: 1px solid #3a3a42; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; }
        .diag button:hover { background: #2f2f37; }
        .switch { position: relative; width: 30px; height: 17px; flex-shrink: 0; }
        .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
        .slider { position: absolute; inset: 0; background: #3a3a42; border-radius: 99px; transition: .15s; cursor: pointer; }
        .slider:before { content: ''; position: absolute; width: 13px; height: 13px; left: 2px; top: 2px; background: #fff; border-radius: 50%; transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
        input:checked + .slider { background: #34d399; }
        input:checked + .slider:before { transform: translateX(13px); }
        .switch input:focus-visible + .slider { outline: 2px solid #6c7bf7; outline-offset: 2px; }
      </style>
      <div class="tab" id="tab" role="group" aria-label="RollTrack">
        <span class="mdot" id="mdot"></span>
        <div class="clip">
        <span class="mini" id="mini" title="RollTrack">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </span>
        <div class="full" id="full">
        <span class="grip" title="Drag to move"><svg viewBox="0 0 24 24" width="10" height="14" fill="currentColor"><circle cx="8" cy="5" r="1.8"/><circle cx="16" cy="5" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="19" r="1.8"/><circle cx="16" cy="19" r="1.8"/></svg></span>
        <button class="home-btn" id="homeBtn" type="button" title="Open RollTrack dashboard" aria-label="Open RollTrack dashboard">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 11.5 12 4l9 7.5"/>
            <path d="M5.5 10v9a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-9"/>
          </svg>
        </button>
        <span class="dot" id="dot"></span>
        <span class="label">RollTrack</span>
        <span class="count" id="count" title="People detected / people Meet says are in the call"></span>
        <span class="warn" id="warn" hidden>Open People panel</span>
        <span class="elapsed" id="elapsed"></span>
        <button class="diag-btn" id="diagBtn" type="button" title="RollTrack diagnostic" aria-label="RollTrack diagnostic">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        </button>
        <label class="switch">
          <input type="checkbox" id="toggle" aria-label="Tracking on/off" />
          <span class="slider"></span>
        </label>
        </div>
        </div>
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
      // Safety net: if the Save popup message is missed, fetch the finished session.
      if (!e.target.checked) setTimeout(syncStateFromBackground, 1200);
    });

    diagBtn.addEventListener('click', () => {
      diagEl.hidden = !diagEl.hidden;
      if (!diagEl.hidden) renderDiag();
    });

    // ---- Auto-hide into a small icon + drag to move ------------------------
    const AUTO_HIDE_MS = 5500; // idle time before shrinking to the small icon
    const POS_KEY = 'rolltrack_widget_pos';
    const tab = root.getElementById('tab');
    const mdot = root.getElementById('mdot');
    // Position is stored as distance from the nearest side edge + top, so the
    // widget stays on that side when it shrinks / grows.
    let pos = { anchor: 'r', dx: 6, y: Math.max(0, Math.round(window.innerHeight / 2 - 18)) };
    let collapsed = false;
    let hovering = false;
    let hideTimer = null;
    let drag = null;

    function render() {
      const w = host.offsetWidth, h = host.offsetHeight;
      const dx = Math.min(Math.max(0, pos.dx), Math.max(0, window.innerWidth - w));
      const top = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - h));
      // Anchoring to the nearer side edge means the widget grows / shrinks from
      // that edge on its own, frame by frame, while it animates.
      if (pos.anchor === 'l') { host.style.left = dx + 'px'; host.style.right = 'auto'; }
      else { host.style.right = dx + 'px'; host.style.left = 'auto'; }
      host.style.top = top + 'px';
    }

    let animTimer = null;
    function setCollapsed(c) {
      if (collapsed === c) return;
      const w0 = tab.offsetWidth, h0 = tab.offsetHeight;
      clearTimeout(animTimer);
      // Pin the current size, flip state, measure the target, then let CSS animate.
      tab.style.transition = 'none';
      tab.style.width = w0 + 'px';
      tab.style.height = h0 + 'px';
      collapsed = c;
      tab.classList.toggle('collapsed', c);
      let w1 = 30, h1 = 30;
      if (!c) {
        tab.style.width = 'auto';
        tab.style.height = 'auto';
        w1 = tab.offsetWidth;
        h1 = tab.offsetHeight;
        tab.style.width = w0 + 'px';
        tab.style.height = h0 + 'px';
      }
      void tab.offsetWidth; // commit the pinned size
      tab.style.transition = '';
      tab.style.width = w1 + 'px';
      tab.style.height = h1 + 'px';
      animTimer = setTimeout(() => {
        tab.style.width = '';
        tab.style.height = '';
        render();
      }, 620);
    }

    function scheduleHide(ms) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        const a = root.activeElement;
        const kbFocus = a && a.matches && a.matches(':focus-visible');
        if (drag || hovering || !diagEl.hidden || kbFocus) return scheduleHide(2500);
        setCollapsed(true);
      }, ms == null ? AUTO_HIDE_MS : ms);
    }
    function showFull() {
      clearTimeout(hideTimer);
      setCollapsed(false);
    }

    function savePos() {
      if (!isContextValid()) return;
      try { chrome.storage.local.set({ [POS_KEY]: pos }); } catch (e) {}
    }

    // Hover intent: expand only if the pointer rests on the icon for a moment,
    // so brushing past it does not make the widget flicker open.
    let hoverTimer = null;
    tab.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      hovering = true;
      clearTimeout(hideTimer);
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(showFull, collapsed ? 220 : 0);
    });
    tab.addEventListener('pointerleave', () => {
      hovering = false;
      clearTimeout(hoverTimer);
      scheduleHide(3000);
    });
    tab.addEventListener('focusin', showFull);
    tab.addEventListener('focusout', () => scheduleHide(3000));
    diagBtn.addEventListener('click', () => (diagEl.hidden ? scheduleHide(3000) : showFull()));
    toggle.addEventListener('change', () => scheduleHide(4000));

    tab.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('button, label, input')) return; // controls keep working
      const r = host.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
      tab.style.transition = 'opacity .3s ease'; // no size animation lag while dragging
      try { tab.setPointerCapture(e.pointerId); } catch (err) {}
    });
    tab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      clearTimeout(hideTimer);
      tab.classList.add('dragging');
      const w = host.offsetWidth, h = host.offsetHeight;
      const left = Math.min(Math.max(0, drag.ox + dx), Math.max(0, window.innerWidth - w));
      const top = Math.min(Math.max(0, drag.oy + dy), Math.max(0, window.innerHeight - h));
      host.style.left = left + 'px';
      host.style.right = 'auto';
      host.style.top = top + 'px';
      e.preventDefault();
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      tab.style.transition = '';
      tab.classList.remove('dragging');
      if (moved) {
        const r = host.getBoundingClientRect();
        pos = r.left + r.width / 2 > window.innerWidth / 2
          ? { anchor: 'r', dx: Math.max(0, Math.round(window.innerWidth - r.right)), y: Math.round(r.top) }
          : { anchor: 'l', dx: Math.max(0, Math.round(r.left)), y: Math.round(r.top) };
        savePos();
      } else {
        showFull(); // plain tap on the small icon opens it
      }
      scheduleHide();
    };
    tab.addEventListener('pointerup', endDrag);
    tab.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', render);

    // Restore the last position the user dragged it to.
    try {
      if (isContextValid()) {
        chrome.storage.local.get(POS_KEY, (res) => {
          if (chrome.runtime.lastError) return;
          const p = res && res[POS_KEY];
          if (p && (p.anchor === 'l' || p.anchor === 'r') && isFinite(p.dx) && isFinite(p.y)) {
            pos = p;
            render();
          }
        });
      }
    } catch (e) {}

    const expandWidget = () => { showFull(); scheduleHide(8000); };
    render();
    scheduleHide(); // show full bar briefly on load, then shrink to the icon

    // Opens (or focuses) the RollTrack dashboard tab — the same "home page"
    // the toolbar popup shows — without leaving this meeting tab. Handled by
    // background.js since content scripts can't open tabs directly.
    homeBtn.addEventListener('click', () => {
      sendMessageSafe({ type: 'ROLLTRACK_OPEN_HOME' });
    });

    widgetRefs = { tab: root.getElementById('tab'), warn: root.getElementById('warn'), dot, mdot, elapsedEl, toggle, homeBtn, countEl, diagEl, expand: expandWidget };
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
    widgetRefs.mdot.classList.toggle('on', trackingOn);
    if (widgetRefs.tab) {
      const wasLive = widgetRefs.tab.classList.contains('live');
      widgetRefs.tab.classList.toggle('live', trackingOn);
      if (trackingOn && !wasLive) {
        widgetRefs.tab.classList.add('just-on');
        setTimeout(() => widgetRefs.tab && widgetRefs.tab.classList.remove('just-on'), 1300);
      }
    }
    widgetRefs.toggle.checked = trackingOn;
    // The elapsed time is sampled 4x per second and the text is rewritten only when
    // the displayed second actually changes. A once-per-second timer started at an
    // arbitrary moment (and restarted on every state sync) lands near a second
    // boundary, so ordinary jitter showed 1, 3, 4, 6... A timer that is already
    // running for this session is left alone.
    if (trackingOn && trackingStartedAt) {
      if (!tickTimer || tickStart !== trackingStartedAt) {
        clearInterval(tickTimer);
        tickStart = trackingStartedAt;
        let last = '';
        const tick = () => {
          const t = fmtElapsed(Date.now() - trackingStartedAt);
          if (t !== last) {
            last = t;
            widgetRefs.elapsedEl.textContent = t;
          }
        };
        tick();
        tickTimer = setInterval(tick, 250);
      }
    } else {
      clearInterval(tickTimer);
      tickTimer = null;
      tickStart = null;
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
        * { box-sizing: border-box; font-family: Inter, system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif; }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; padding: 16px; }
        .card { width: 100%; max-width: 420px; background: linear-gradient(145deg, rgba(40,40,52,.88), rgba(19,19,23,.86)); -webkit-backdrop-filter: blur(26px) saturate(170%); backdrop-filter: blur(26px) saturate(170%); animation: cardIn .45s cubic-bezier(.22,1,.36,1) both; color: #e5e7eb; border: 1px solid #2a2a31; border-radius: 22px; box-shadow: 0 30px 80px rgba(0,0,0,.65), inset 0 1px 0 rgba(255,255,255,.06); overflow: hidden; }
        .head { display: flex; align-items: center; gap: 10px; padding: 14px 18px; background: #0e0e12; border-bottom: 1px solid #2a2a31; }
        .dot { width: 30px; height: 30px; border-radius: 8px; background: rgba(239,68,68,.18); border: 1px solid rgba(239,68,68,.4); display: flex; align-items: center; justify-content: center; }
        .dot i { width: 9px; height: 9px; border-radius: 50%; background: #f87171; display: block; }
        h3 { margin: 0; font-size: 15px; font-weight: 600; color: #fff; }
        .sub { margin: 2px 0 0; font-size: 11px; color: #8f8f9a; }
        .body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; }
        label.t { font-size: 12px; font-weight: 600; color: #b4b4bd; display: block; margin-bottom: 5px; }
        input[type=text] { width: 100%; padding: 9px 12px; font-size: 13px; background: #09090b; color: #f1f5f9; border: 1px solid #2a2a31; border-radius: 10px; outline: none; }
        input[type=text]:focus { border-color: #6c7bf7; }
        .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
        .stat { background: #0e0e12; border: 1px solid #232329; border-radius: 10px; padding: 8px 10px; }
        .stat span { display: block; font-size: 10px; color: #8f8f9a; text-transform: uppercase; letter-spacing: .04em; }
        .stat b { font-size: 15px; color: #fff; font-variant-numeric: tabular-nums; }
        .warn { font-size: 11px; color: #fcd34d; background: rgba(120,53,15,.2); border: 1px solid rgba(180,83,9,.4); border-radius: 10px; padding: 8px 10px; line-height: 1.45; }
        .warn p { margin: 0 0 4px; } .warn p:last-of-type { margin-bottom: 0; }
        .warn label { display: flex; gap: 7px; align-items: flex-start; margin-top: 8px; color: #e2e8f0; cursor: pointer; }
        .msg { margin: 0; font-size: 12px; color: #a5b0ff; min-height: 16px; }
        .msg.err { color: #fca5a5; } .msg.ok { color: #6ee7b7; }
        .btns { display: flex; justify-content: flex-end; gap: 8px; padding-top: 12px; border-top: 1px solid #2a2a31; }
        button { font-size: 13px; font-weight: 600; border: none; border-radius: 10px; padding: 9px 16px; cursor: pointer; }
        button.cancel { background: transparent; color: #8f8f9a; } button.cancel:hover { background: #232329; color: #e2e8f0; }
        button.save { background: linear-gradient(180deg,#7585ff,#5565ea); color: #fff; } button.save:hover { background: #6c7bf7; }
        button:disabled { opacity: .55; cursor: default; }
        @keyframes cardIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes draw { to { stroke-dashoffset: 0; } }
        @keyframes pop { 0% { transform: scale(.6); opacity: 0; } 60% { transform: scale(1.08); } 100% { transform: scale(1); opacity: 1; } }
        .msg.busy::before { content: ''; display: inline-block; width: 11px; height: 11px; margin-right: 7px; vertical-align: -1px; border: 2px solid rgba(165,176,255,.3); border-top-color: #a5b0ff; border-radius: 50%; animation: spin .7s linear infinite; }
        .done { display: none; flex-direction: column; align-items: center; gap: 10px; padding: 26px 0 14px; }
        .done .ring { width: 64px; height: 64px; border-radius: 50%; background: rgba(52,211,153,.14); border: 1px solid rgba(52,211,153,.4); display: flex; align-items: center; justify-content: center; animation: pop .5s cubic-bezier(.22,1,.36,1) both; box-shadow: 0 0 36px rgba(52,211,153,.35); }
        .done svg path { stroke-dasharray: 30; stroke-dashoffset: 30; animation: draw .5s .25s ease-out forwards; }
        .done b { font-size: 15px; color: #fff; }
        .card.saved .body > :not(.done) { display: none; }
        .card.saved .done { display: flex; }
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
            <div class="done"><div class="ring"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><b>Saved</b></div>
          </div>
        </div>
      </div>`;

    const $ = (id) => root.getElementById(id);
    $('sub').textContent = p.platform;
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
      setMsg('Saving\u2026', 'busy');
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
            setMsg('', 'ok');
            const cardEl = root.querySelector('.card');
            if (cardEl) cardEl.classList.add('saved');
            setTimeout(() => finishSave(p), 1500);
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
      // Meet sent us from the call page to its home / landing page while tracking
      // was ON: the call is over, so stop and offer to save.
      if (platform === 'Google Meet' && trackingOn && !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i.test(location.pathname)) {
        handleCallEnded();
      }
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

  // ---------------------------------------------------------------------
  // Call-end detection (Google Meet). When the person leaves / ends the call
  // while tracking is ON, tracking is switched OFF through the exact same
  // message as the widget toggle (source 'widget'), so background.js freezes
  // the session and the Save popup appears right here on the Meet screen.
  // ---------------------------------------------------------------------
  const LEAVE_SEL =
    'button[aria-label*="Leave call" i], button[aria-label*="End call" i], [data-tooltip*="Leave call" i]';
  const LEFT_TEXT =
    /you left the meeting|you['\u2019]ve left the meeting|you['\u2019]ve been removed|meeting has ended|call has ended|return to home screen/i;
  let sawInCall = false;
  let noCallTicks = 0;
  let callEndHandled = false;

  function inCallNow() {
    if (document.querySelector(LEAVE_SEL)) return true;
    // Language-independent fallback: Meet's red hang-up button uses the "call_end" icon.
    const icons = document.querySelectorAll('button i, button span.google-material-icons, button .material-icons');
    for (const el of icons) {
      if ((el.textContent || '').trim() === 'call_end') return true;
    }
    return false;
  }

  function leftScreenShown() {
    try {
      return LEFT_TEXT.test((document.body && document.body.innerText) || '');
    } catch (e) {
      return false;
    }
  }

  function handleCallEnded() {
    if (callEndHandled || !trackingOn || myTabId == null) return;
    callEndHandled = true;
    const fresh = scanNow(false);
    sendMessageSafe({
      type: 'ROLLTRACK_SET_TRACKING',
      tabId: myTabId,
      on: false,
      platform,
      source: 'widget',
      snapshot: {
        attendees: fresh.attendees.map((a) => ({ id: a.id, name: a.name })),
        reportedCount: fresh.reportedCount,
      },
    });
  }

  if (platform === 'Google Meet') {
    callTimer = setInterval(() => {
      if (!isContextValid()) return;
      if (inCallNow()) {
        sawInCall = true;
        noCallTicks = 0;
        callEndHandled = false; // rejoined: ready for the next call end
        return;
      }
      if (!sawInCall || !trackingOn) return;
      noCallTicks++;
      // Leave button gone for ~3 s, or the "you left" screen is showing for ~1.5 s.
      if (noCallTicks >= 3 || (noCallTicks >= 2 && leftScreenShown())) {
        sawInCall = false;
        noCallTicks = 0;
        handleCallEnded();
      }
    }, 1000);
  }

  // Periodic heartbeat (2 s: shorter visits are still caught)
  snapshotTimer = setInterval(sendSnapshot, 2000);
  sendSnapshot();

  createWidget();
  syncStateFromBackground();
  syncTimer = setInterval(syncStateFromBackground, 5000); // cheap periodic reconcile, e.g. after a reload
  aliveTimer = setInterval(markAlive, 1000);
})();
