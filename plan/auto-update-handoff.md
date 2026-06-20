# Cue — In-App Update Handoff

How to let Cue **pull its own updates** across a fleet of devices you own, instead
of hand-carrying a `.dmg`/`.exe` to each machine. This is a design/decision handoff:
the options, the constraints that actually decide between them, and an implementation
sketch for the recommended path. Companion to `deployment-handoff.md` (which covers
building and signing).

---

## TL;DR

- **Don't shell out to the `gh` CLI from the app.** It needs `gh` installed +
  `gh auth login` on every device, only downloads the installer, and ships a dev
  tool inside the app. Wrong tool.
- `will-eze/Cue` is a **public** repo → any device can read releases and download
  assets over plain HTTPS with **no auth, no token, no `gh`**.
- **Recommended: Option A — an in-app "Check for Updates" button** that hits the
  GitHub Releases API, compares versions, downloads the right installer, and
  launches it. Simple, cross-platform, no new signing requirements.
- **Option B (true silent auto-update)** is blocked on macOS until you buy an Apple
  Developer ID ($99/yr) — Squirrel.Mac refuses to update an ad-hoc-signed app.

---

## The deciding constraints (read first)

These are why the recommendation is what it is — they're specific to how Cue is
built today.

| Fact | Source | Consequence |
|---|---|---|
| Repo is **public** | `will-eze/Cue` | No token/auth needed to list releases or download assets. `update.electronjs.org` (free) is usable. |
| macOS build is **ad-hoc signed only** (`codesign --sign -`, free) | `forge.config.js` postPackage | Squirrel.Mac **silent auto-update will not work** — it requires a real Apple Developer ID + notarization. |
| Windows uses **`maker-squirrel`** | `forge.config.js` makers | Already emits the `RELEASES` + `.nupkg` files that Electron `autoUpdater` needs. Windows silent update works without an EV cert (SmartScreen warnings aside). |
| CI publishes **prereleases** | `.github/workflows/build-installers.yml` (`prerelease: true`) | GitHub's `/releases/latest` endpoint **skips prereleases** — a version check must query `/releases` and take index 0, or the workflow must switch to full releases. |
| Release assets | `maker-dmg` + `maker-squirrel` | mac: `Cue-<ver>-<arch>.dmg`; win: `Cue-<ver> Setup.exe` (+ `RELEASES`, `*.nupkg`). |

The macOS signing line is the decisive one: it rules out fully-silent auto-update
on Mac for free, which is why Option A (manual one-click install, no Squirrel) is
the pragmatic fleet answer.

---

## Option A — In-app "Check for Updates" button  ✅ recommended

A button (Settings footer, next to the version string) that does the whole
download-and-launch in the main process. No Squirrel, no background daemon, no
signing requirements beyond what shipping the installer already needs.

**Flow**
1. Renderer button → `window.cue.settings.checkForUpdate()` (new IPC).
2. Main `GET https://api.github.com/repos/will-eze/Cue/releases` (public, anonymous;
   send a `User-Agent` header — GitHub requires it). Take the newest entry
   (index 0, since `/latest` ignores prereleases).
3. Parse the tag (`v25.1.0` → `25.1.0`), compare to `app.getVersion()` with a
   semver compare. If not newer → report "up to date".
4. If newer → pick the asset for this platform/arch from `release.assets`
   (`process.platform` = `darwin`/`win32`, `process.arch` = `arm64`/`x64`),
   download it (`https.get`, follow redirects to the S3 asset URL) to
   `app.getPath('temp')`, streaming to disk.
5. `shell.openPath(installerPath)` to launch the dmg/Setup.exe, then optionally
   `app.quit()` so the user can replace the running app. User clicks through the
   normal installer; next launch is the new version.

**Why it fits**
- ~100 lines in main + one button + one IPC method.
- Cross-platform identical UX.
- No Apple Developer ID needed — it's just automating the existing manual install.
- No persistent token (public repo).

**Caveats / decisions**
- **Prereleases:** either query `/releases` and take `[0]`, or flip the workflow to
  publish full releases so `/releases/latest` works cleanly. Pick one before
  building (see "Open decisions" below).
- **macOS quarantine:** a file the app downloads over HTTPS gets the `com.apple.
  quarantine` xattr, so Gatekeeper will prompt on first launch of the new version
  (same as a browser download — the `gh`-CLI trick that avoids quarantine is *not*
  in play here). Acceptable for an owned fleet; the app is ad-hoc signed so it
  launches after the one prompt.
- **In-use replacement:** on macOS the user drags-to-Applications over the running
  app (fine after quit); on Windows the Squirrel `Setup.exe` handles replacement.
- Rate limit: anonymous GitHub API is 60 req/hr/IP — irrelevant for a manual button.

**IPC shape (suggested)**
| Method | Returns | Notes |
|---|---|---|
| `settings.checkForUpdate()` | `{ current, latest, isNewer, asset } \| { current, upToDate:true }` | Main does the API query + semver compare only. |
| `settings.downloadAndInstall(asset)` | `void` (progress via event) | Streams the asset to temp, `shell.openPath`, then `app.quit()`. |
| event `update:progress` | `{ received, total }` | For a progress bar in the button. |

---

## Option B — True silent auto-update (Electron `autoUpdater`)

Background download + apply on relaunch, no button. The "proper" mechanism, but
gated by signing.

- **Free feed exists:** `update-electron-app` → `update.electronjs.org` works
  *because the repo is public* (it proxies public GitHub releases; no token).
  Alternatively Forge's `@electron-forge/publisher-github` + Electron's native
  `autoUpdater`.
- **Windows:** works today. `maker-squirrel` already produces the `RELEASES`/
  `.nupkg` artifacts `autoUpdater` consumes. Updates apply silently; SmartScreen
  may warn on first install of an unsigned/self-signed build.
- **macOS: blocked.** Squirrel.Mac **only** updates an app signed with an Apple
  **Developer ID** and **notarized**. Cue is ad-hoc signed (free), so
  `autoUpdater.checkForUpdates()` on Mac silently no-ops. Fixing this = Apple
  Developer Program, **$99/yr** (see `deployment-handoff.md`).
- **Prereleases:** `update.electronjs.org` serves the latest *full* release only —
  prereleases are ignored, so the CI workflow must publish full releases for this
  path to see anything.

**Net:** Option B is asymmetric — ship it on Windows now, but macOS stays manual
until you decide to pay for Apple signing. Only worth it if you want hands-off
background updates *and* are buying the Developer ID anyway.

---

## Recommendation

Build **Option A**. For self-distribution across your own devices it delivers the
one-click "pull the latest" you want, sidesteps the macOS signing wall entirely,
and needs no token or `gh`. Revisit **Option B** if/when you buy an Apple Developer
ID — at that point both platforms can go fully silent.

A reasonable middle path later: ship Option A everywhere now, and *additionally*
enable Option B's silent path on Windows only.

---

## Open decisions (resolve before implementing)

1. **Prerelease vs full release.** Option A is cleanest if CI publishes **full**
   releases (`prerelease: false` in `build-installers.yml`), so a version check can
   use `/releases/latest`. Keep prereleases only if you want a manual "promote"
   step — then the button must query `/releases` and take index 0.
2. **Channel / opt-in.** Always auto-check on launch, or only on button press?
   Button-only is least surprising for a fleet.
3. **Quit-to-install UX.** Auto-quit after launching the installer, or let the user
   finish first? (macOS can't replace a running `.app` cleanly.)

---

## Related

- `deployment-handoff.md` — building, signing (ad-hoc vs Developer ID), quarantine,
  the `gh release download` clean-pull workflow, release/versioning rules.
- `.github/workflows/build-installers.yml` — the tag-triggered build that publishes
  the GitHub Release this feature reads from.
