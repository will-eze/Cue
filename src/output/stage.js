const stageEl     = document.getElementById('stage');
const statusEl    = document.getElementById('status');
const statusText  = document.getElementById('status-text');
const clockEl     = document.getElementById('clock');
const currentEl   = document.getElementById('current');
const currentLbl  = document.getElementById('current-label');
const nextWrap    = document.getElementById('next-wrap');
const nextEl      = document.getElementById('next');
const nextLbl     = document.getElementById('next-label');

// The stage display is a confidence monitor: it keeps showing the most recent
// content (dimmed) when the audience output is cleared or on the logo, so the
// presenter can still read what is/was on screen.
let lastContent = { text: '', label: '', nextText: '', nextLabel: '' };

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function nl2br(str) {
  return esc(str).replace(/\n/g, '<br>');
}

function renderContent() {
  currentEl.innerHTML = nl2br(lastContent.text);
  currentLbl.textContent = (lastContent.label || '').toUpperCase();

  const hasNext = !!(lastContent.nextText && lastContent.nextText.trim());
  nextEl.innerHTML = nl2br(lastContent.nextText);
  nextLbl.textContent = (lastContent.nextLabel || '').toUpperCase();
  nextWrap.classList.toggle('empty', !hasNext);
}

function setStatus(mode) {
  // mode: 'live' | 'cleared' | 'logo' | 'idle'
  statusEl.className = `status-${mode}`;
  statusText.textContent = mode === 'live'    ? 'LIVE'
                         : mode === 'cleared' ? 'CLEARED'
                         : mode === 'logo'    ? 'LOGO'
                         : 'STANDBY';
  // Dim the current slide when audience output isn't actively showing it.
  stageEl.classList.toggle('muted', mode === 'cleared' || mode === 'logo');
}

function tickClock() {
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  clockEl.textContent = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
}
tickClock();
setInterval(tickClock, 1000);

window.cueOutput.onSlideUpdate((payload) => {
  const { type, text, sectionLabel, nextText, nextSectionLabel } = payload;

  if (type === 'content') {
    lastContent = {
      text:      text || '',
      label:     sectionLabel || '',
      nextText:  nextText || '',
      nextLabel: nextSectionLabel || '',
    };
    renderContent();
    setStatus('live');
    return;
  }

  if (type === 'logo') {
    // Keep the last lyric visible (dimmed) — the presenter still needs it.
    renderContent();
    setStatus('logo');
    return;
  }

  // type === 'clear' — also the idle state. If we never had content, stay blank.
  const isIdle = !lastContent.text && !lastContent.nextText;
  renderContent();
  setStatus(isIdle ? 'idle' : 'cleared');
});
