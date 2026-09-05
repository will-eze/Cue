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

// Returns the merged [bundled…, downloaded-library…, user…] font list. Library
// and user fonts arrive async; user fonts carry category 'custom' so the picker
// groups them under their own heading. `bump` forces a reload after an
// import/download/delete in Settings.
export function useFonts(bump = 0) {
  const [extraFonts, setExtraFonts] = useState([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      window.cue.fonts.listUser().catch(() => []),
      window.cue.fonts.catalog ? window.cue.fonts.catalog().catch(() => []) : Promise.resolve([]),
    ]).then(([userList, catalog]) => {
      if (!alive) return;
      const lib = (catalog || [])
        .filter((f) => f.downloaded)
        .map((f) => ({ family: f.family, label: f.label || f.family, category: f.category || 'sans-serif', downloaded: true }));
      const user = (userList || []).map((f) => ({ family: f.family, label: f.label || f.family, category: 'custom', user: true }));
      setExtraFonts([...lib, ...user]);
      if (!injected) injectUserFontFaces();
    }).catch(() => {});
    return () => { alive = false; };
  }, [bump]);
  return [...BUNDLED, ...extraFonts];
}
