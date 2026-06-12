// Self-contained control surface served at GET / by the remote server. No build
// step, no external assets — a single HTML string. It carries no secret: the
// pairing token is read from the page URL (?token=…) and cached in localStorage,
// then sent on every /api call. Kept deliberately neutral/dark; this is a remote
// control page, independent of the operator UI's design system.

export const CONTROL_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="theme-color" content="#0d0f12" />
<title>Cue Remote</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0d0f12; color: #e8eaed;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    display: flex; flex-direction: column; min-height: 100%;
  }
  header {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid #20242b;
    position: sticky; top: 0; background: #0d0f12; z-index: 2;
  }
  .brand { font-weight: 800; letter-spacing: .5px; color: #6ea8ff; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #3a3f48; }
  .dot.live { background: #ff5a52; box-shadow: 0 0 8px #ff5a5288; }
  .status { font: 600 12px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 1px; color: #8b9099; }
  .status.live { color: #ff5a52; }
  main { flex: 1; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  .card { background: #14171c; border: 1px solid #20242b; border-radius: 14px; padding: 14px; }
  .lbl { font: 600 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 1.5px; color: #5e636c; margin-bottom: 6px; }
  .cur { font-size: 20px; font-weight: 600; line-height: 1.3; min-height: 26px; white-space: pre-wrap; word-break: break-word; }
  .nxt { font-size: 14px; color: #9aa0a8; margin-top: 10px; white-space: pre-wrap; word-break: break-word; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  button { font-family: inherit; cursor: pointer; border: none; }
  .btn {
    border-radius: 14px; padding: 20px 0; font-size: 17px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1px; color: #e8eaed;
    background: #1b1f26; border: 1px solid #2a2f38; transition: transform .05s, filter .1s;
  }
  .btn:active { transform: scale(.96); filter: brightness(1.25); }
  .btn.go   { background: #1f7a3d; border-color: #2aa353; grid-column: 1 / -1; font-size: 22px; padding: 26px 0; }
  .btn.clear{ border-color: #5a2b2b; color: #ff8a82; }
  .btn.logo { border-color: #2a3f63; color: #8fb6ff; }
  .btn.live { border-color: #5a2b2b; }
  .btn.live.on { background: #3a1d1d; border-color: #b34a44; color: #ff8a82; }
  .nav { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .nav .btn { font-size: 24px; padding: 24px 0; }
  .items { display: flex; flex-direction: column; gap: 8px; max-height: 52vh; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .row { display: flex; flex-direction: column; }
  .item {
    text-align: left; width: 100%; padding: 12px 14px; border-radius: 10px; background: #1b1f26;
    border: 1px solid #2a2f38; color: #cfd3d9; font-size: 15px; display: flex; align-items: center; gap: 10px;
  }
  .item.live { border-color: #b34a44; color: #ff8a82; }
  .item .tag { font: 600 9px ui-monospace, monospace; text-transform: uppercase; letter-spacing: 1px; color: #5e636c; }
  .item .lab { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chev { color: #5e636c; font-size: 11px; transition: transform .15s; flex-shrink: 0; }
  .chev.open { transform: rotate(90deg); }
  .slides { display: flex; flex-direction: column; gap: 6px; padding: 8px 0 4px 12px; }
  .slide {
    text-align: left; width: 100%; padding: 10px 12px; border-radius: 9px; background: #13161b;
    border: 1px solid #242932; color: #aeb4bd; font-size: 13px; display: flex; gap: 9px; align-items: baseline;
  }
  .slide.live { border-color: #b34a44; background: #2a1717; color: #ff8a82; }
  .slide .sl { font: 600 10px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .5px; color: #6ea8ff; flex-shrink: 0; min-width: 56px; }
  .slide.live .sl { color: #ff8a82; }
  .slide .sp { flex: 1; min-width: 0; color: #7d828b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #5e636c; font-size: 14px; padding: 8px 2px; }
  #gate { position: fixed; inset: 0; background: #0d0f12; display: none; align-items: center; justify-content: center; padding: 24px; z-index: 10; }
  #gate .card { width: 100%; max-width: 360px; }
  #gate input { width: 100%; margin-top: 8px; padding: 12px; border-radius: 10px; border: 1px solid #2a2f38; background: #0d0f12; color: #e8eaed; font: 15px ui-monospace, monospace; }
  #gate button { width: 100%; margin-top: 12px; padding: 14px; border-radius: 10px; background: #1f7a3d; color: #fff; font-weight: 700; }
  .conn { font: 600 10px ui-monospace, monospace; color: #5e636c; text-align: center; padding-bottom: 8px; }
  .conn.off { color: #ff8a82; }
</style>
</head>
<body>
  <header>
    <span class="brand">CUE</span>
    <span id="dot" class="dot"></span>
    <span id="status" class="status">Idle</span>
    <span style="flex:1"></span>
    <span id="outputs" class="status"></span>
  </header>

  <main>
    <div class="card">
      <div class="lbl">On Air</div>
      <div id="cur" class="cur">—</div>
      <div id="nxt" class="nxt"></div>
    </div>

    <div class="nav">
      <button class="btn" onclick="cmd('prev')">‹ Prev</button>
      <button class="btn" onclick="cmd('next')">Next ›</button>
    </div>

    <div class="grid">
      <button class="btn go" onclick="cmd('go')">GO</button>
      <button class="btn clear" onclick="cmd('clear')">Clear</button>
      <button class="btn logo" onclick="cmd('logo')">Logo</button>
      <button id="liveBtn" class="btn live" onclick="cmd('live')">Live</button>
      <button class="btn" onclick="cmd('go')" style="visibility:hidden"></button>
    </div>

    <div class="card">
      <div class="lbl">Rundown</div>
      <div id="items" class="items"><div class="empty">No items.</div></div>
    </div>
  </main>

  <div id="conn" class="conn off">connecting…</div>

  <div id="gate">
    <div class="card">
      <div class="lbl">Pairing Token</div>
      <input id="tokenInput" type="text" placeholder="Enter token from Cue settings" autocomplete="off" autocapitalize="off" />
      <button onclick="saveToken()">Connect</button>
    </div>
  </div>

<script>
(function () {
  var params = new URLSearchParams(location.search);
  var token = params.get('token') || localStorage.getItem('cueRemoteToken') || '';
  if (token) localStorage.setItem('cueRemoteToken', token);

  function $(id) { return document.getElementById(id); }

  window.saveToken = function () {
    var t = $('tokenInput').value.trim();
    if (!t) return;
    token = t; localStorage.setItem('cueRemoteToken', t);
    $('gate').style.display = 'none';
    connect();
  };

  function gate() {
    $('gate').style.display = 'flex';
    $('tokenInput').value = token;
  }

  window.cmd = function (action, extra) {
    var body = Object.assign({ action: action }, extra || {});
    // Fire-and-forget. We do NOT render the command's HTTP response: it returns
    // the state captured before the renderer has applied the change, so rendering
    // it would briefly show the pre-press state (a visible flicker on toggles like
    // Logo/Live). The SSE stream is the single source of truth and pushes the real
    // state the instant it changes.
    fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Cue-Token': token },
      body: JSON.stringify(body)
    }).then(function (r) { if (r.status === 401) gate(); }).catch(function () {});
  };

  // Which rundown items are expanded to show their slides. The live item is
  // auto-expanded when it changes; the user can still toggle any item open/closed.
  var expanded = {};
  var lastLive = null;
  var lastState = null;

  function render(s) {
    lastState = s;
    $('dot').className = 'dot' + (s.isLive ? ' live' : '');
    $('status').className = 'status' + (s.isLive ? ' live' : '');
    $('status').textContent = s.isLive ? (s.displayMode === 'logo' ? 'Logo' : s.displayMode === 'cleared' ? 'Cleared' : 'Live') : 'Idle';
    $('outputs').textContent = s.outputsEnabled ? '' : 'OUTPUTS OFF';
    $('cur').textContent = (s.current && s.current.text) ? s.current.text : (s.current && s.current.title ? s.current.title : '—');
    $('nxt').textContent = (s.next && s.next.text) ? ('Next: ' + s.next.text) : '';

    var lb = $('liveBtn');
    lb.className = 'btn live' + (s.outputsEnabled ? ' on' : '');

    renderRundown(s.rundown || { items: [] });
  }

  function renderRundown(rd) {
    // Auto-expand the item that just went live so its verses are immediately visible.
    if (rd.liveItemId != null && rd.liveItemId !== lastLive) {
      expanded[rd.liveItemId] = true;
      lastLive = rd.liveItemId;
    }

    var host = $('items');
    if (!rd.items || !rd.items.length) { host.innerHTML = '<div class="empty">No items.</div>'; return; }
    host.innerHTML = '';

    rd.items.forEach(function (it) {
      var hasSlides = it.slides && it.slides.length > 0;
      var isOpen = !!expanded[it.id];
      var row = document.createElement('div'); row.className = 'row';

      // Item header. Items with multiple slides expand/collapse on tap; single-slide
      // items (media, one-liners) go live directly.
      var head = document.createElement('button');
      head.className = 'item' + (it.id === rd.liveItemId ? ' live' : '');
      var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = it.type || '';
      var lab = document.createElement('span'); lab.className = 'lab'; lab.textContent = it.label || 'Item';
      head.appendChild(tag); head.appendChild(lab);
      if (hasSlides) {
        var chev = document.createElement('span');
        chev.className = 'chev' + (isOpen ? ' open' : '');
        chev.textContent = '\\u25B6';
        head.appendChild(chev);
        head.onclick = function () { expanded[it.id] = !expanded[it.id]; renderRundown(lastState.rundown || { items: [] }); };
      } else {
        head.onclick = function () { cmd('select', { itemId: it.id }); };
      }
      row.appendChild(head);

      // Expanded slide list — tap a verse/section to jump straight to it, live.
      if (hasSlides && isOpen) {
        var box = document.createElement('div'); box.className = 'slides';
        it.slides.forEach(function (sl) {
          var b = document.createElement('button');
          var liveSlide = (it.id === rd.liveItemId && sl.index === rd.liveSlideIdx);
          b.className = 'slide' + (liveSlide ? ' live' : '');
          var n = document.createElement('span'); n.className = 'sl'; n.textContent = sl.label || ('#' + (sl.index + 1));
          var p = document.createElement('span'); p.className = 'sp'; p.textContent = sl.preview || '';
          b.appendChild(n); b.appendChild(p);
          b.onclick = function () { cmd('select', { itemId: it.id, slideIdx: sl.index }); };
          box.appendChild(b);
        });
        row.appendChild(box);
      }
      host.appendChild(row);
    });
  }

  var es = null;
  function setConn(ok, msg) {
    var c = $('conn');
    c.className = 'conn' + (ok ? '' : ' off');
    c.textContent = ok ? 'connected' : (msg || 'disconnected');
  }

  function connect() {
    if (!token) { gate(); return; }
    if (es) { es.close(); es = null; }
    es = new EventSource('/api/stream?token=' + encodeURIComponent(token));
    es.onopen = function () { setConn(true); };
    es.onmessage = function (e) { try { render(JSON.parse(e.data)); } catch (x) {} };
    es.onerror = function () {
      setConn(false, 'reconnecting…');
      // Validate the token: a 401 means re-pair, anything else is a transient drop.
      fetch('/api/state', { headers: { 'X-Cue-Token': token } }).then(function (r) {
        if (r.status === 401) { es.close(); es = null; gate(); }
      }).catch(function () {});
    };
  }

  connect();
})();
</script>
</body>
</html>`;
