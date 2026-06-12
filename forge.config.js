const fs = require('fs');
const path = require('path');

// ─── Native module packaging ────────────────────────────────────────────────
// The Forge Vite plugin sets packagerConfig.ignore to drop everything except the
// /.vite build output, so node_modules never makes it into the package. The main
// bundle keeps these modules EXTERNAL (they can't be bundled — better-sqlite3 and
// grandi are native .node addons; tar does dynamic requires), so without help they
// are missing at runtime and the packaged app dies on `require()` at launch.
//
// We copy the full production dependency closure of each external into the
// packaged node_modules ourselves (in packageAfterPrune, so Forge's prune step
// can't strip them again). grandi's platform binary lives in an optionalDependency
// @grandi/<os>-<arch>; only the one installed for the current build OS resolves,
// so the closure naturally copies the right binary per platform.
const NATIVE_EXTERNALS = ['better-sqlite3', 'grandi', 'tar'];

function resolvePkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

function collectClosure(names, projectDir, seen = new Set(), out = new Map()) {
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const pkgDir = resolvePkgDir(name, projectDir);
    if (!pkgDir) continue; // not installed (e.g. a non-matching platform binary)
    out.set(name, pkgDir);
    const pj = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    collectClosure(
      [...Object.keys(pj.dependencies || {}), ...Object.keys(pj.optionalDependencies || {})],
      projectDir, seen, out
    );
  }
  return out;
}

module.exports = {
  packagerConfig: {
    // Native addons must live OUTSIDE the asar. grandi.node links to a sibling
    // libndi.dylib/.dll via an @loader_path rpath, so the binary and its NDI
    // runtime library have to stay together on the real filesystem; better-sqlite3
    // resolves its .node relative to its own on-disk location. Everything we copy
    // into node_modules is native-related, so unpacking the whole tree keeps each
    // module's internal layout intact and loadable.
    asar: {
      unpack: '**/node_modules/**',
    },
    name: 'Cue',
    executableName: 'cue',
    // App icon. Forge appends the per-platform extension: assets/icon.icns on
    // macOS (embedded in the .app bundle, shown in Dock/Finder/DMG) and
    // assets/icon.ico on Windows (embedded in cue.exe → taskbar/Explorer).
    // Generated from logo/ via sips + iconutil; assets/icon.png is the renderer
    // favicon and the dev-mode Dock icon (see src/main/index.js).
    icon: './assets/icon',
    // Bundled public-domain Bible translations (KJV + WEB) and the GHS hymnal
    // seed. Copied into the app's Resources/ dir (outside the asar); Bibles seed
    // on first run, GHS imports on demand from Library → Import → GHS Hymnal.
    extraResource: ['./resources/bible', './resources/ghs'],
  },
  rebuildConfig: {
    extraModules: ['better-sqlite3', 'grandi'],
  },
  hooks: {
    // macOS ad-hoc code signature (free, no Apple Developer ID). Apple Silicon
    // refuses to launch a repackaged Electron app whose original signature was
    // invalidated by packaging — without this it shows "Cue is damaged and can't
    // be opened" even from a clean USB copy. Forge's `osxSign` packagerConfig
    // option silently no-ops here (leaves Electron's broken linker signature), so
    // we sign explicitly: `codesign --deep --force --sign -` reseals the whole
    // bundle (identifier com.electron.cue, sealed resources). This runs in
    // postPackage — AFTER the .app is built but BEFORE the dmg maker — so the dmg
    // ships the signed app. It does NOT clear the download quarantine tag (that
    // needs $99 notarization, irrelevant for USB/network-share distribution).
    postPackage: async (_forgeConfig, options) => {
      if (options.platform !== 'darwin') return;
      const { execFileSync } = require('child_process');
      for (const outDir of options.outputPaths) {
        const app = path.join(outDir, 'Cue.app');
        if (!fs.existsSync(app)) continue;
        execFileSync('codesign', ['--deep', '--force', '--sign', '-', app], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
      }
    },
    packageAfterPrune: async (_forgeConfig, buildPath) => {
      // 1. Native externals (+ their dependency closure) into the packaged
      //    node_modules. Runs after Forge's prune so the modules survive into the asar.
      const closure = collectClosure(NATIVE_EXTERNALS, __dirname);
      for (const [name, src] of closure) {
        const dest = path.join(buildPath, 'node_modules', name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true, dereference: true });
      }

      // 2. Plain-DOM output windows (src/output/*.html + their js/css) and the
      //    fonts they pull in (src/fonts). These are NOT bundled by Vite, and the
      //    output loader reads them from app.getAppPath()/src/output at runtime, so
      //    they must sit at the same relative path inside the asar. Without this,
      //    every projection / lower-third / stage output is a blank ERR_FILE_NOT_FOUND.
      for (const dir of ['src/output', 'src/fonts']) {
        fs.cpSync(path.join(__dirname, dir), path.join(buildPath, dir), { recursive: true });
      }
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      // setupIcon → the Setup.exe installer icon; loadingGif/iconUrl could be
      // added later. The packaged app's own icon comes from packagerConfig.icon.
      config: { name: 'cue', setupIcon: './assets/icon.ico' },
    },
    {
      name: '@electron-forge/maker-dmg',
      config: { name: 'Cue', icon: './assets/icon.icns' },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main/index.js',
            config: 'vite.main.config.js',
            target: 'main',
          },
          {
            entry: 'src/main/preload.js',
            config: 'vite.preload.config.js',
            target: 'preload',
          },
          {
            entry: 'src/main/output-preload.js',
            config: 'vite.preload.config.js',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.js',
          },
        ],
      },
    },
  ],
};
