# Cue

A unified graphics engine for live production — worship lyric presentation and broadcast overlay graphics in a single app. Replaces EasyWorship/ProPresenter and UNO, with both use cases running simultaneously.

---

## Install

> [!IMPORTANT]
> Cue is ad-hoc-signed, not notarised. If you download the installer in a **web browser**, macOS quarantines it and Gatekeeper will block it from opening. The commands below avoid that — a command-line download is never quarantined, so the app launches cleanly. After the first install, use the built-in **Settings → Check for Updates** to update.

### macOS

Paste this into **Terminal** (downloads the latest `Cue.dmg`, installs to `/Applications`, and opens it):

```bash
curl -fsSL "$(curl -fsSL https://api.github.com/repos/will-eze/Cue/releases | grep -o 'https://[^"]*\.dmg' | head -1)" -o /tmp/Cue.dmg \
  && hdiutil attach /tmp/Cue.dmg -nobrowse -quiet \
  && cp -R "/Volumes/Cue/Cue.app" /Applications/ \
  && hdiutil detach "/Volumes/Cue" -quiet \
  && xattr -dr com.apple.quarantine /Applications/Cue.app \
  && rm /tmp/Cue.dmg \
  && open /Applications/Cue.app
```

### Windows

Paste this into **PowerShell** (downloads the latest `Setup.exe` and runs the installer):

```powershell
$u=(irm https://api.github.com/repos/will-eze/Cue/releases)[0].assets|?{$_.name -like '*Setup.exe'}|select -First 1 -Expand browser_download_url;$o="$env:TEMP\CueSetup.exe";iwr $u -OutFile $o;Start-Process $o
```

> [!NOTE]
> These commands always fetch the **newest** release (including prereleases). To install a specific version instead, grab the installer from the [Releases page](https://github.com/will-eze/Cue/releases) — but note a browser-downloaded `.dmg` will be quarantined and need `xattr -dr com.apple.quarantine /Applications/Cue.app` before it will open.

---

## Updating

Once installed, update from inside the app: **Settings → Check for Updates**. It pulls the newest GitHub release, downloads the installer, strips quarantine on macOS, and relaunches — no terminal needed.

---

## Development

```bash
npm install
npm start          # dev server
npm run make       # build distributable
npm run package    # bundle only (fast packaging check)
```

After any Electron version bump: `npm run rebuild` (recompiles native modules).

See `CLAUDE.md` for architecture rules and `plan/cue-master-reference.md` for the full technical reference.
