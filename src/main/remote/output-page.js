// Remote OUTPUT page — a view-only browser mirror of Cue's live program.
//
// Served at GET /output. It re-renders the SAME program payloads the local output
// windows receive, using the SAME plain-DOM templates (fullscreen.js / media-player.js
// / transitions.js / graphics-overlay.js, served from /output/assets), so what a phone
// shows matches the auditorium screen. The inline shim below replaces the Electron
// `window.cueOutput` IPC bridge with a Server-Sent-Events feed (/output/stream) and
// points media at the http /output/media endpoint instead of cue-media://.
//
// Two browser realities this handles:
//   • Clock skew — a phone's Date.now() differs from the host's, which would desync the
//     machine-clock media player + countdowns. Every SSE frame carries serverNow; the
//     shim learns the offset and rebases incoming timestamps so the templates' local
//     Date.now() math stays correct (templates are used UNMODIFIED).
//   • Autoplay-with-audio — browsers block it until a user gesture. A "Tap to view"
//     gate gives the page user-activation before any media plays, then connects.

export const OUTPUT_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <title>Cue — Live Output</title>
  <link rel="stylesheet" href="/output/fonts/fonts.css" />
  <link rel="stylesheet" href="/output/assets/fullscreen.css" />
  <style>
    html, body { width:100%; height:100%; margin:0; background:#000; overflow:hidden; }
    /* Phones/laptops aren't 16:9. The output templates are authored against a fixed
       1920×1080 design space (px fonts, % text boxes, the overlay's px bars), so we
       host them in a 1920×1080 box and CSS-zoom it UNIFORM-FIT + CENTRE (letterbox) to
       the device — what the phone shows then matches the auditorium screen pixel-for-pixel.
       Same pattern as stream-feed.js's compositor (zoom, NOT transform: scale, so text
       re-rasterises crisply). #stage's own absolute inset:0 (from fullscreen.css)
       resolves against this relative 1920x1080 frame, so no stage override is needed. */
    body { display:flex; align-items:center; justify-content:center; }
    #cue-frame {
      position: relative;
      width: 1920px; height: 1080px; flex: none;
      overflow: hidden; background:#000;
    }
    /* fullscreen.js's scaleSlideCanvas() scales #slide-elements by window/1920 — that's a
       SECOND scale on top of the frame zoom. Neutralise it (the inline transform it sets is
       beaten by !important); the frame zoom already provides the design scale. */
    #slide-elements { transform: none !important; }
    /* graphics-overlay.js creates #cue-gfx as position:fixed inset:0 (viewport). Re-homed
       into #cue-frame below; make it absolute so it tracks the letterboxed design box. */
    #cue-gfx { position: absolute !important; }
    #cue-gate {
      position: fixed; inset: 0; z-index: 2147483600;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 18px; background:#0a0c10; color:#e7ecf3;
      font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-align: center; padding: 24px;
    }
    #cue-gate h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
    #cue-gate p  { font-size: 13px; color:#8a94a6; max-width: 340px; line-height: 1.5; }
    #cue-gate button {
      margin-top: 4px; padding: 14px 30px; font-size: 15px; font-weight: 600;
      color:#fff; background:#1f6feb; border:none; border-radius: 12px; cursor:pointer;
      font-family: inherit;
    }
    #cue-gate button:active { transform: scale(0.98); }
    #cue-gate.hide { display:none; }
    #cue-conn {
      position: fixed; top: 10px; right: 12px; z-index: 2147483500;
      display:flex; align-items:center; gap:6px; padding:4px 9px; border-radius:999px;
      background: rgba(10,12,16,0.6); color:#cdd5e0; font-size:11px; opacity:0;
      transition: opacity .3s; pointer-events:none;
      font-family: Inter, -apple-system, sans-serif;
    }
    #cue-conn.show { opacity: 1; }
    #cue-conn .dot { width:7px; height:7px; border-radius:50%; background:#e5484d; }
    #cue-conn.on .dot { background:#30a46c; }
  </style>
</head>
<body>
  <!-- Fixed 1920×1080 design frame, zoom-fit + centred (letterbox) to the device.
       Same program structure fullscreen.js expects (it queries these by id at load). -->
  <div id="cue-frame">
    <div id="stage">
      <div id="background"></div>
      <div id="scrim"></div>
      <div id="content">
        <div id="text-wrap"><div id="text"></div></div>
        <div id="slide-elements"></div>
        <div id="logo-wrap"></div>
        <div id="copyright"></div>
      </div>
    </div>
  </div>

  <div id="cue-conn"><span class="dot"></span><span id="cue-conn-label">reconnecting…</span></div>

  <div id="cue-gate">
    <h1>Cue — Live Output</h1>
    <p id="cue-gate-msg">Tap to view the live program with sound.</p>
    <button id="cue-gate-btn">Tap to view</button>
  </div>

  <!-- Shim FIRST: defines window.cueOutput + media base before any template runs. -->
  <script>
  (function () {
    var params = new URLSearchParams(location.search);
    var vt = params.get('vt') || localStorage.getItem('cueViewToken') || '';
    if (vt) localStorage.setItem('cueViewToken', vt);

    // Media resolves to the http endpoint (fullscreen.js pathToUrl honours these).
    window.CUE_MEDIA_BASE   = location.origin + '/output/media';
    window.CUE_MEDIA_SUFFIX = vt ? ('?vt=' + encodeURIComponent(vt)) : '';

    var slideCbs = [], graphicCbs = [], transportCbs = [];

    // ── Clock-offset correction ──────────────────────────────────────────────
    // offset ≈ serverClock − clientClock. Host timestamps (transport startAt/pausedAt,
    // countdown endsAt/startAt) are in the host epoch; subtract offset so the templates'
    // local Date.now() arithmetic yields the right playhead / remaining time.
    var offset = null;
    function updateOffset(serverNow) {
      if (typeof serverNow !== 'number') return;
      var s = serverNow - Date.now();
      offset = (offset == null) ? s : (offset * 0.8 + s * 0.2);
    }
    function reTs(t) { return (typeof t === 'number' && offset != null) ? (t - offset) : t; }
    function reTransport(tr) {
      if (!tr) return tr;
      var o = Object.assign({}, tr);
      if (typeof o.startAt === 'number')  o.startAt  = reTs(o.startAt);
      if (o.pausedAt != null)             o.pausedAt = reTs(o.pausedAt);
      return o;
    }
    function reSlide(p) {
      if (!p) return p;
      if (p.transport) { p = Object.assign({}, p); p.transport = reTransport(p.transport); }
      return p;
    }
    function reOverlay(ov) {
      if (!ov) return ov;
      var o = Object.assign({}, ov);
      if (o.countdown) {
        o.countdown = Object.assign({}, o.countdown);
        if (o.countdown.endsAt   != null) o.countdown.endsAt   = reTs(o.countdown.endsAt);
        if (o.countdown.startAt  != null) o.countdown.startAt  = reTs(o.countdown.startAt);
        if (o.countdown.frozenAt != null) o.countdown.frozenAt = reTs(o.countdown.frozenAt);
      }
      return o;
    }

    var noop = function () {};
    var unsub = function () { return noop; };
    // Mirror of the output-preload contextBridge surface; only the program buses are
    // wired, everything else (audio tap, stream, stage, sink device) is inert.
    window.cueOutput = {
      onSlideUpdate:    function (cb) { slideCbs.push(cb); },
      onGraphicUpdate:  function (cb) { graphicCbs.push(cb); },
      onMediaTransport: function (cb) { transportCbs.push(cb); return noop; },
      onContentMode:    noop,
      onAudioOutputDevice: unsub,
      onAudioTap:       unsub,
      onStageTimer:     noop, onStageMessage: noop, onStageSchedule: noop,
      onStreamInput:    unsub, onStreamLayout: unsub, onStreamAudioTap: unsub,
      onLiveFrame:      unsub, // live NDI input frames never cross the network mirror
      onLiveAudio:      unsub,

      sendAudioPcm:     noop, sendStreamAudioPcm: noop, sendStreamLevels: noop,
      getWorkletSource: function () { return Promise.resolve(''); },
    };

    function dispatch(frame) {
      updateOffset(frame.serverNow);
      if (frame.slide != null)     { var p = reSlide(frame.slide);     slideCbs.forEach(function (cb) { try { cb(p); } catch (e) {} }); }
      if (frame.transport != null) { var t = reTransport(frame.transport); transportCbs.forEach(function (cb) { try { cb(t); } catch (e) {} }); }
      if ('overlay' in frame)      { var o = reOverlay(frame.overlay); graphicCbs.forEach(function (cb) { try { cb(o); } catch (e) {} }); }
    }

    // ── Connection ────────────────────────────────────────────────────────────
    var conn = document.getElementById('cue-conn');
    var connLabel = document.getElementById('cue-conn-label');
    var hideTimer = null;
    function setStatus(on, label) {
      conn.classList.add('show');
      conn.classList.toggle('on', !!on);
      connLabel.textContent = label || (on ? 'live' : 'reconnecting…');
      clearTimeout(hideTimer);
      if (on) hideTimer = setTimeout(function () { conn.classList.remove('show'); }, 1500);
    }

    var es = null;
    function connect() {
      if (es) return;
      es = new EventSource('/output/stream?vt=' + encodeURIComponent(vt));
      es.onopen    = function () { setStatus(true, 'live'); };
      es.onmessage = function (e) { try { dispatch(JSON.parse(e.data)); } catch (x) {} };
      es.onerror   = function () { setStatus(false); };
    }
    window.__cueConnect = connect;
    window.__cueHasToken = !!vt;
  })();
  </script>

  <!-- Reuse the SAME plain-DOM output templates the local windows use. -->
  <script src="/output/assets/media-player.js"></script>
  <script src="/output/assets/transitions.js"></script>
  <script src="/output/assets/fullscreen.js"></script>
  <script src="/output/assets/graphics-overlay.js"></script>

  <!-- Letterbox fit: zoom the 1920×1080 frame UNIFORM-FIT to the device and re-home the
       graphics overlay into it so it scales with the program (it was created on body). -->
  <script>
  (function () {
    var frame = document.getElementById('cue-frame');
    var gfx = document.getElementById('cue-gfx');           // created by graphics-overlay.js above
    if (gfx && gfx.parentNode !== frame) frame.appendChild(gfx);
    function fitFrame() {
      // zoom (not transform) participates in layout, so body's flexbox keeps the box centred.
      frame.style.zoom = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    }
    window.addEventListener('resize', fitFrame);
    window.addEventListener('orientationchange', fitFrame);
    fitFrame();
  })();
  </script>

  <!-- Gate: a user gesture unlocks autoplay-with-audio, then we connect. -->
  <script>
  (function () {
    var gate = document.getElementById('cue-gate');
    var btn  = document.getElementById('cue-gate-btn');
    var msg  = document.getElementById('cue-gate-msg');
    if (!window.__cueHasToken) {
      msg.textContent = 'This link is missing its access token. Re-open it from the QR code or full URL shown in Cue.';
      btn.style.display = 'none';
      return;
    }
    btn.addEventListener('click', function () {
      gate.classList.add('hide');
      window.__cueConnect();
    });
  })();
  </script>
</body>
</html>`;
