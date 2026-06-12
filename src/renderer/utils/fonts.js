import { useEffect, useState } from 'react';

// Bundled fonts are available synchronously (exposed on the preload); user-
// installed fonts load over IPC. This module both injects the user @font-face
// rules into the operator document and hands the merged list to the pickers.

const BUNDLED = window.cue.fonts.list;

let injected = false;

// Inject (or refresh) the user @font-face <style> in the operator document so
// custom families render in every editor preview just like on the output.
export async function injectUserFontFaces() {
  try {
    const css = await window.cue.fonts.css();
    let el = document.getElementById('cue-user-fonts');
    if (!el) {
      el = document.createElement('style');
      el.id = 'cue-user-fonts';
      document.head.appendChild(el);
    }
    el.textContent = css || '';
    injected = true;
  } catch { /* ignore — bundled fonts still work */ }
}

// Returns the merged [bundled…, user…] font list. User fonts arrive async and
// carry category 'custom' so the picker groups them under their own heading.
// `bump` forces a reload after an import/delete in Settings.
export function useFonts(bump = 0) {
  const [userFonts, setUserFonts] = useState([]);
  useEffect(() => {
    let alive = true;
    window.cue.fonts.listUser().then((list) => {
      if (!alive) return;
      setUserFonts((list || []).map((f) => ({ family: f.family, label: f.label || f.family, category: 'custom', user: true })));
      if (!injected) injectUserFontFaces();
    }).catch(() => {});
    return () => { alive = false; };
  }, [bump]);
  return [...BUNDLED, ...userFonts];
}
