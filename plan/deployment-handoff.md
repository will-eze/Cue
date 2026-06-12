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

## Build commands & per-OS requirement

You must build each installer **on its own OS** — `maker-dmg` only runs on
macOS, `maker-squirrel` needs Windows (or Wine + .NET). One Mac cannot produce
the Windows installer and vice-versa. Use two machines or a CI matrix.

```bash
npm run make        # builds the installer for the CURRENT OS
```

Output lands in `out/make/`.

> After any Electron version bump, run `npm run rebuild` first (recompiles
> `better-sqlite3` and `grandi`).

### Native modules / NDI note
`forge.config.js` unpacks `@grandi` and `better-sqlite3` from the asar so the
NDI runtime library (`libndi.dylib`/`.dll`) sits next to its `.node` binary —
without that, NDI silently fails in packaged builds. Don't remove the
`asar.unpack` rule.

---

## Still outstanding (decide later)

- **macOS ad-hoc signing** — add `osxSign: {}` to `forge.config.js` so Apple
  Silicon Macs launch the build. *(Free, currently missing.)*
- **App icon** — `packagerConfig` has no `icon`; builds ship the default
  Electron icon.
- **$99 Apple notarization** — only needed if you want clean **browser-download**
  installs on macOS. Not needed for USB/share distribution.
