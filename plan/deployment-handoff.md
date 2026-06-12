# Cue — Internal Deployment Handoff

How to build and distribute Cue across an **internal fleet** of mixed macOS and
Windows machines that you own. This is for private/internal use — not public
distribution to strangers — which changes what's worth paying for (mostly
nothing).

---

## TL;DR — the free workflow

1. Build a `.dmg` (macOS) / `.exe` installer (Windows).
2. **Transfer by USB drive or LAN/network share** — *not* a browser download,
   email, or AirDrop.
3. Install (drag app to Applications / run the installer).
4. No security warnings, no paid certificates.

The only thing free distribution *can't* give you is a clean **browser-download**
experience on macOS — that requires Apple's $99/yr notarization. Via file
transfer, free covers you completely.

| | macOS | Windows |
|---|---|---|
| Build | `.dmg` (`maker-dmg`) | `.exe` installer (`maker-squirrel`) |
| **Required** | **ad-hoc sign** (free) so Apple Silicon launches it | nothing |
| Transfer | USB / network share | USB / network share |
| Install | drag app → Applications | run the installer |
| Result | opens, no warning | opens, no warning |

---

## Certificates & cost

| Platform | Paid option | Free option |
|---|---|---|
| **macOS** | Apple Developer Program — **$99/year**. Developer ID + notarization → zero warnings even on browser download. The *only* truly trusted Mac signature. | Ad-hoc / self-signed (`codesign --sign -`). Free, but does **not** clear download quarantine. |
| **Windows** | Authenticode OV cert — ~$200–400/yr (hardware token required since 2023), EV more. Not worth it internally. | Self-signed cert (`New-SelfSignedCertificate`). Free; trusted only if you install it into Trusted Publishers on each PC. |

**Self-signing is free on both.** The catch: self-signing fixes *identity*
("unknown publisher"), but it does **not** remove the **download tag**. The
download tag is about *where the file came from*, not whether it's signed.

---

## The two separate problems

1. **Download tag** (the source of the scary warnings):
   - macOS: `com.apple.quarantine` extended attribute → Gatekeeper
     "can't be opened, Apple cannot check it for malicious software".
   - Windows: Mark-of-the-Web (`Zone.Identifier` alternate data stream) →
     SmartScreen "Windows protected your PC".
   - Applied by **whatever downloaded the file from the internet** (browser,
     mail, AirDrop). **Not** applied by USB/network-share/`scp` copies.
   - Signing does **not** remove it. Only notarization (mac) clears it cleanly;
     otherwise you strip the tag manually (see below).

2. **Apple Silicon signature requirement** (macOS only, separate issue):
   - arm64 Macs refuse to launch any executable with an invalid signature, and
     repackaging Electron breaks its original signature.
   - Without at least a **free ad-hoc signature**, an M-series Mac shows
     **"Cue is damaged and can't be opened"** even from a clean USB copy.
   - Fix is free: `osxSign: {}` in `forge.config.js`, or `codesign --sign -`.
   - Windows has no equivalent — unsigned `.exe` runs fine.

---

## Transfer method matters

| Method | macOS quarantine? | Windows MOTW? |
|---|---|---|
| USB drive | ❌ no | ❌ no |
| SMB / network share | ❌ no | ❌ no (intranet zone) |
| `scp` / `rsync` | ❌ no | ❌ no |
| **Browser download** | ✅ yes | ✅ yes |
| **AirDrop** | ✅ yes | n/a |
| Email attachment | ✅ yes | ✅ yes |

Tip: if you keep builds on GitHub Releases, download once, **clear the tag on
that one machine**, then redistribute the cleaned copy by USB/share to the rest.

---

## Clearing the download tag (when you DID download from a browser/GitHub)

Yes — possible on **both** platforms, and free.

### macOS — remove quarantine

```bash
# Clear quarantine from an installed app (recursively):
xattr -dr com.apple.quarantine /Applications/Cue.app

# Or from the .dmg / downloaded file before installing:
xattr -dr com.apple.quarantine ~/Downloads/Cue.dmg

# Check whether the tag is present:
xattr -l /Applications/Cue.app        # look for com.apple.quarantine
```

GUI alternative (one-time, per machine): right-click the app → **Open** →
confirm. After the first approved launch macOS remembers it.

> Note: clearing quarantine does **not** satisfy the Apple Silicon signature
> requirement — the app must still be at least ad-hoc signed to launch.

### Windows — remove Mark-of-the-Web

```powershell
# Unblock a single downloaded installer:
Unblock-File -Path "$env:USERPROFILE\Downloads\Cue-Setup.exe"

# Unblock every file in a folder (e.g. an extracted build):
Get-ChildItem -Path "C:\path\to\folder" -Recurse | Unblock-File
```

GUI alternative: right-click the `.exe` → **Properties** → tick **Unblock** at
the bottom → **Apply**.

`Unblock-File` deletes the `Zone.Identifier` alternate data stream, which is what
SmartScreen reads. After that the installer runs without the "protected your PC"
prompt (a brand-new build with no reputation may still show one "Run anyway"
click until the self-signed cert is trusted on the machine).

---

## Optional: free self-signed signing for Windows

Removes the "Unknown publisher" flag on PCs where the cert is trusted. One-time
setup per cert, then trust it on each PC (manually or via Group Policy).

```powershell
# 1. Create a self-signed code-signing cert (run once, keep the .pfx safe):
$cert = New-SelfSignedCertificate -Type CodeSigningCert `
  -Subject "CN=Cue Internal" -CertStoreLocation Cert:\CurrentUser\My
$pwd = ConvertTo-SecureString -String "choose-a-password" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath .\cue-signing.pfx -Password $pwd
Export-Certificate   -Cert $cert -FilePath .\cue-signing.cer

# 2. On EACH PC, trust the public cert (admin PowerShell):
Import-Certificate -FilePath .\cue-signing.cer -CertStoreLocation Cert:\LocalMachine\Root
Import-Certificate -FilePath .\cue-signing.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
```

Wire the `.pfx` into `maker-squirrel` (`certificateFile` / `certificatePassword`)
to sign the installer at build time. Optional — unsigned + USB transfer already
installs cleanly internally.

---

## Recommended: automated builds via GitHub Actions

`.github/workflows/build-installers.yml` builds **both** installers natively and
publishes them as a GitHub Release — the path we actually use. It solves the two
problems a local Mac build can't:

- **Real Windows `.exe`.** `maker-squirrel` needs genuine Windows; Wine on Apple
  Silicon is fragile and sudo-gated (it pulls `gstreamer-runtime`, an admin-only
  `.pkg`). The workflow builds the exe on a real `windows-latest` runner.
- **The 100 MB git limit.** The dmg/exe are ~108–117 MB, over GitHub's hard
  per-file push limit, so they can't live in a branch. They go to a Release.

How it runs:

```bash
# Tag = the app version (vMAJOR.MINOR.PATCH), kept in sync with package.json and
# the in-app footer. A prePackage guard in forge.config.js fails the build if
# package.json drifts from the computed version, so bump them together.
git tag -a v19.2.3 -m "Cue v19.2.3"   # any v* tag; match the app version
git push origin v19.2.3                # triggers the matrix
```

The tag trigger works even while the workflow lives only on a feature branch
(push events use the workflow file at the pushed ref). Once it's on `main`, the
Actions "Run workflow" button (`workflow_dispatch`) also works. The matrix builds
the dmg on `macos-latest` (arm64) and the exe on `windows-latest` (x64), then a
release job publishes both as a **prerelease** Release for that tag.

Two CI specifics worth knowing:

- **`fetch-depth: 0`** in the checkout — the app build number is
  `git rev-list --count HEAD` (`vite.renderer.config.js`); a shallow clone would
  pin every build to 1.
- **`package.json` `author` must be non-empty** — `electron-winstaller` derives
  the NuGet `<authors>` field from it, and an empty string fails the Windows
  build with `Authors is required`.

### Pulling the installers WITHOUT a web mark

The whole point of the gh CLI here: **command-line downloads set no quarantine
xattr and no Windows mark-of-the-web** — only browsers / Mail / AirDrop do. So
pull the Release with `gh` (or `curl`) and the files are clean from the first
byte, no tag to strip:

```bash
gh release download v19.2.3 -R will-eze/Cue -D installers
```

(`installers/` is gitignored.) From there, redistribute by USB / network share —
also web-mark-free — and the macOS app launches straight away (it's ad-hoc signed
in CI, see below); the Windows installer needs at most one "Run anyway".

## Local build (single OS)

You can still build the current OS's installer locally:

```bash
npm run make        # builds the installer for the CURRENT OS
```

Output lands in `out/make/`. `maker-dmg` only runs on macOS and `maker-squirrel`
needs Windows, so one machine can't produce both — which is why CI above is the
default.

> After any Electron version bump, run `npm run rebuild` first (recompiles
> `better-sqlite3` and `grandi`).

### Native modules / NDI note
`forge.config.js` unpacks `@grandi` and `better-sqlite3` from the asar so the
NDI runtime library (`libndi.dylib`/`.dll`) sits next to its `.node` binary —
without that, NDI silently fails in packaged builds. Don't remove the
`asar.unpack` rule.

---

## Status of the macOS launch requirements

- **macOS ad-hoc signing — DONE.** A `postPackage` hook in `forge.config.js`
  runs `codesign --deep --force --sign -` on the packaged `.app` (before the dmg
  maker, so the dmg ships the signed app). Forge's `osxSign` option silently
  no-ops here — it left Electron's broken linker signature, which makes Apple
  Silicon refuse to launch ("Cue is damaged") — so we sign explicitly. Runs in
  CI too (ad-hoc needs no identity/keychain). Verify a build with
  `codesign --verify --deep --strict Cue.app`.
- **App icon — DONE.** `packagerConfig.icon: './assets/icon'`; Forge appends
  `.icns` (macOS) / `.ico` (Windows).

## Still outstanding (decide later)

- **$99 Apple notarization** — only needed if you want clean **browser-download**
  installs on macOS. Not needed for USB/share or `gh`/`curl` distribution (those
  set no quarantine tag at all). Could be run in CI later if the cert is bought.
- **Windows code signing** — the exe is unsigned (one "Run anyway" on first
  launch, or `Unblock-File`). Optional: wire a free self-signed cert into
  `maker-squirrel` (`certificateFile` / `certificatePassword`) per the section
  above, and trust it on each PC.
- **Intel macs / Windows arm64** — CI builds arm64 macOS + x64 Windows only. Add
  matrix entries if the fleet needs `x64` Macs or `arm64` Windows.
