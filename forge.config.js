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
// onnxruntime-node is the scripture-detection embedding runtime. It is N-API
// (ABI-stable across Node/Electron) so — unlike better-sqlite3 — it needs NO
// @electron/rebuild step; it only needs its prebuilt .node + libs copied into the
// packaged node_modules (handled by the closure copy below), kept out of the asar
// by the asar.unpack rule. @huggingface/transformers is the Whisper ASR runtime
// (dynamic-imported in main; depends on onnxruntime-node) — its dependency closure
// is copied the same way so the auto-download ASR pipeline resolves in a packaged app.
const NATIVE_EXTERNALS = ['better-sqlite3', 'grandi', 'tar', 'onnxruntime-node', '@huggingface/transformers'];

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
    // Scripture detection captures the service audio via getUserMedia; macOS denies
    // mic access in a packaged app without this Info.plist usage string. (Dev works
    // off Electron.app's own plist, so this gap is invisible until packaged.)
    extendInfo: {
      NSMicrophoneUsageDescription: 'Cue listens to the service audio to auto-detect spoken scripture references and quotes.',
      NSCameraUsageDescription: 'Cue captures your video feed (camera or capture device) to composite the broadcast stream.',
    },
    name: 'Cue',
    executableName: 'cue',
    // Windows version-resource strings → the exe's display name in Explorer /
    // taskbar and the Squirrel shortcut label. Pin them to "Cue" so the lowercase
    // executableName (cue.exe) never surfaces to users there either.
    win32metadata: {
      CompanyName: 'William Eze',
      ProductName: 'Cue',
      FileDescription: 'Cue',
      InternalName: 'Cue',
    },
    // App icon. Forge appends the per-platform extension: assets/icon.icns on
    // macOS (embedded in the .app bundle, shown in Dock/Finder/DMG) and
    // assets/icon.ico on Windows (embedded in cue.exe → taskbar/Explorer).
    // Generated from logo/ via sips + iconutil; assets/icon.png is the renderer
    // favicon and the dev-mode Dock icon (see src/main/index.js).
    icon: './assets/icon',
    // Bundled public-domain Bible translations (KJV + WEB) and the GHS hymnal
    // seed. Copied into the app's Resources/ dir (outside the asar); Bibles seed
    // on first run, GHS imports on demand from Library → Import → GHS Hymnal.
    // The YouTube player's yt-dlp + ffmpeg are NOT bundled — `src/main/youtube/bin.js`
    // auto-downloads them into userData/bin on first use (keeps yt-dlp fresh; ~85 MB
    // current-platform only, vs a stale baked-in copy). So nothing for them here.
    extraResource: ['./resources/bible', './resources/ghs', './resources/themes', './resources/graphics', './resources/media-manifest.json'],
  },
  rebuildConfig: {
    extraModules: ['better-sqlite3', 'grandi'],
  },
  hooks: {
    // Rebuild native addons against Electron's ABI before they get packaged.
    //
    // better-sqlite3 is a V8-ABI (NAN) addon: its .node is tied to a specific
    // NODE_MODULE_VERSION. `npm ci` installs the prebuilt for the host *Node*
    // (e.g. Node 20 → ABI 115), but the app runs under *Electron 30* (ABI 123),
    // so the unmatched binary throws "compiled against a different Node.js
    // version" the moment initDb() calls require('better-sqlite3') — which is
    // BEFORE createMainWindow() in app.whenReady(), so the app dies with only a
    // Dock icon and no window.
    //
    // Forge's own native-rebuild step can't save us here: the Vite plugin strips
    // node_modules from the package, so Forge rebuilds an empty tree (no-op), and
    // the real module is copied from the project root in packageAfterPrune below.
    // That copy is only correct if the project-root build is already Electron-ABI
    // — true on a dev machine that ran `npm run rebuild`, false on a clean CI
    // checkout. So we rebuild the project root explicitly here, before the copy,
    // making every build path (CI + local, macOS + Windows) correct.
    //
    // grandi is N-API (ABI-stable across Node/Electron), so it needs no rebuild.
    prePackage: async () => {
      // Version-sync guard. Two stores hold the version: the in-app footer is
      // computed (schema MAJOR + VERSION_MINOR/PATCH + git Build N, see
      // vite.renderer.config.js), while package.json.version drives the installer
      // filenames and the .app/.exe metadata. They have no shared source, so they
      // silently drifted before (package.json sat at 0.1.0 while the app showed
      // 19.x). Assert package.json.version === the computed MAJOR.MINOR.PATCH and
      // fail the build loudly on mismatch, so a forgotten edit can't ship a
      // mislabelled installer. (MAJOR stays schema-derived per CLAUDE.md.)
      const schemaSrc = fs.readFileSync(path.join(__dirname, 'src/main/db/schema.js'), 'utf8');
      const major = Math.max(...[...schemaSrc.matchAll(/function\s+v(\d+)\s*\(/g)].map((m) => Number(m[1])));
      const viteSrc = fs.readFileSync(path.join(__dirname, 'vite.renderer.config.js'), 'utf8');
      const minor = Number(/VERSION_MINOR\s*=\s*(\d+)/.exec(viteSrc)[1]);
      const patch = Number(/VERSION_PATCH\s*=\s*(\d+)/.exec(viteSrc)[1]);
      const computed = `${major}.${minor}.${patch}`;
      const pkgVersion = require('./package.json').version;
      if (pkgVersion !== computed) {
        throw new Error(
          `Version mismatch: package.json is "${pkgVersion}" but the computed app ` +
          `version is "${computed}" (schema v${major} + VERSION_MINOR.${minor}.${patch}). ` +
          `Set package.json "version" to "${computed}".`
        );
      }

      // @electron/rebuild ships as ESM-only — require() throws ERR_REQUIRE_ESM
      // from this CommonJS config, so load it via dynamic import().
      const { rebuild } = await import('@electron/rebuild');
      const electronVersion = require('electron/package.json').version;
      await rebuild({
        buildPath: __dirname,
        electronVersion,
        force: true,
        onlyModules: ['better-sqlite3'],
      });
    },
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
        // Fix the user-facing label. @electron/packager hardwires
        // CFBundleDisplayName to executableName ('cue', lowercase) and applies it
        // AFTER extendInfo, so it can't be set through packagerConfig — Finder /
        // Dock / Launchpad would show "cue". Patch the plist to "Cue" here, before
        // codesign reseals the bundle so the signature covers the edit. (The
        // lowercase 'cue' remains only as the internal binary, Contents/MacOS/cue.)
        execFileSync('/usr/libexec/PlistBuddy',
          ['-c', 'Set :CFBundleDisplayName Cue', path.join(app, 'Contents', 'Info.plist')],
          { stdio: 'inherit' });
        execFileSync('codesign', ['--deep', '--force', '--sign', '-', app], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
      }
    },
    // Build the Windows NSIS wizard installer. Runs after `make` (so the app is
    // packaged at out/Cue-win32-x64) and only on Windows. Emits
    // out/make/nsis/Cue-<ver>.Setup.exe — the release workflow's out/make/**/*.exe
    // glob then uploads it, and the in-app updater's /setup\.exe$/i still matches.
    // NSIS ships with the GitHub windows runner (only bundled includes are used —
    // MUI2/LogicLib/Sections — no external plugins), with a choco fallback in CI.
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform !== 'win32') return makeResults;
      const { execFileSync } = require('child_process');
      const version = require('./package.json').version;
      const appDir = path.join(__dirname, 'out', 'Cue-win32-x64');
      if (!fs.existsSync(appDir)) {
        throw new Error(`NSIS: packaged app dir not found at ${appDir}`);
      }
      const outDir = path.join(__dirname, 'out', 'make', 'nsis');
      fs.mkdirSync(outDir, { recursive: true });

      // Resolve makensis: PATH first, then the default install location (NSIS does
      // not add itself to PATH). CI ensures it exists before `make`.
      const candidates = [
        'makensis',
        'C:\\Program Files (x86)\\NSIS\\makensis.exe',
        'C:\\Program Files\\NSIS\\makensis.exe',
      ];
      let makensis = null;
      for (const c of candidates) {
        try { execFileSync(c, ['/VERSION'], { stdio: 'ignore' }); makensis = c; break; } catch {}
      }
      if (!makensis) throw new Error('NSIS makensis not found (install NSIS on the build machine).');

      execFileSync(makensis, [
        `/DVERSION=${version}`,
        `/DAPPDIR=${appDir}`,
        `/DOUTDIR=${outDir}`,
        path.join(__dirname, 'installer', 'cue.nsi'),
      ], { stdio: 'inherit' });

      const setupExe = path.join(outDir, `Cue-${version}.Setup.exe`);
      if (!fs.existsSync(setupExe)) throw new Error(`NSIS build produced no ${setupExe}`);
      // Register the artifact so `make` reports it (upload uses the out/make glob).
      makeResults.push({
        artifacts: [setupExe],
        packageJSON: require('./package.json'),
        platform: 'win32',
        arch: 'x64',
      });
      return makeResults;
    },
    packageAfterPrune: async (_forgeConfig, buildPath, _electronVersion, platform, arch) => {
      // 1. Native externals (+ their dependency closure) into the packaged
      //    node_modules. Runs after Forge's prune so the modules survive into the asar.
      const closure = collectClosure(NATIVE_EXTERNALS, __dirname);
      for (const [name, src] of closure) {
        const dest = path.join(buildPath, 'node_modules', name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true, dereference: true });
      }

      // 1b. Prune onnxruntime-node's prebuilt binaries to THIS build's platform/arch.
      //     The closure copy above brings the WHOLE bin/napi-v6 tree — darwin, linux
      //     and win32 × x64/arm64, ~210 MB — but a per-platform installer can only
      //     ever load one of them (bin/napi-v6/<platform>/<arch>). The other four are
      //     ~135 MB of dead weight in the installed app AND the compressed installer
      //     (a Windows x64 build was shipping the macOS/Linux/ARM ONNX runtimes).
      //     `platform`/`arch` come from Forge's afterPrune args (Node's process.*
      //     values: win32/darwin/linux × x64/arm64) — exactly onnxruntime's dir names.
      const buildPlatform = platform || process.platform;
      const buildArch = arch || process.arch;
      const ortBin = path.join(buildPath, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
      if (fs.existsSync(ortBin)) {
        for (const plat of fs.readdirSync(ortBin)) {
          const platDir = path.join(ortBin, plat);
          if (!fs.statSync(platDir).isDirectory()) continue;
          if (plat !== buildPlatform) { fs.rmSync(platDir, { recursive: true, force: true }); continue; }
          for (const a of fs.readdirSync(platDir)) {
            if (a !== buildArch) fs.rmSync(path.join(platDir, a), { recursive: true, force: true });
          }
        }
      }

      // 2. Plain-DOM output windows (src/output/*.html + their js/css) and the
      //    fonts they pull in (src/fonts). These are NOT bundled by Vite, and the
      //    output loader reads them from app.getAppPath()/src/output at runtime, so
      //    they must sit at the same relative path inside the asar. Without this,
      //    every projection / lower-third / stage output is a blank ERR_FILE_NOT_FOUND.
      for (const dir of ['src/output', 'src/fonts']) {
        fs.cpSync(path.join(__dirname, dir), path.join(buildPath, dir), { recursive: true });
      }

      // 3. The embedding worker (embed-worker.js). It is NOT bundled by Vite — it
      //    runs as a worker_thread loaded by path from app.getAppPath() (see
      //    content-match.js), exactly like the output windows above. CommonJS, so
      //    it loads in the type:commonjs project. Without this the verse-vector
      //    build/match path dies with a missing-worker error in packaged builds.
      const workerRel = path.join('src', 'main', 'scripture-detect', 'embed-worker.js');
      fs.mkdirSync(path.dirname(path.join(buildPath, workerRel)), { recursive: true });
      fs.copyFileSync(path.join(__dirname, workerRel), path.join(buildPath, workerRel));
    },
  },
  makers: [
    {
      // Windows distributables are built by the NSIS wizard in the postMake hook
      // below (install-location picker + component checkboxes + optional module
      // prefetch — things Squirrel.Windows can't do). Forge still needs a
      // win32-capable maker so `npm run make` completes its package step; the zip
      // is a harmless by-product (not uploaded — the release glob matches *.exe).
      // maker-zip is cross-platform, so it also emits a mac .zip we likewise ignore.
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    {
      name: '@electron-forge/maker-dmg',
      config: { name: 'Cue', icon: './assets/icon.icns' },
    },
    {
      name: '@electron-forge/maker-deb',
      config: { options: { name: 'cue', productName: 'Cue', icon: './assets/icon.png' } },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: { options: { name: 'cue', productName: 'Cue', icon: './assets/icon.png' } },
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
