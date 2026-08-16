; Cue — Windows installer (NSIS / Modern UI 2)
; ---------------------------------------------------------------------------
; Replaces the choiceless Squirrel.Windows Setup.exe with a real wizard:
;   - install-location picker (per-user; no admin/UAC so auto-update stays silent)
;   - component checkboxes: Desktop shortcut, launch-at-startup, and OPTIONAL
;     pre-download of the normally download-on-demand modules (media tools + the
;     scripture-detection models) by running `cue.exe --prefetch=...` at install.
;
; Built by forge.config.js's postMake hook, which passes:
;   /DVERSION=<x.y.z>   app version (also the Setup filename + DisplayVersion)
;   /DAPPDIR=<path>     the forge-packaged app folder (out/Cue-win32-x64)
;   /DOUTDIR=<path>     where to drop Cue-<ver>.Setup.exe (out/make/nsis)
; Defaults let it also be built by hand from the repo root for a smoke test.

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef APPDIR
  !define APPDIR "..\out\Cue-win32-x64"
!endif
!ifndef OUTDIR
  !define OUTDIR "."
!endif

!define APP_NAME "Cue"
!define EXE_NAME "cue.exe"           ; forge executableName is lowercase 'cue'
!define PUBLISHER "William Eze"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APP_NAME} ${VERSION}"
OutFile "${OUTDIR}\${APP_NAME}-${VERSION}.Setup.exe"
Unicode true

; Per-user install: no admin rights, so the in-app updater can re-run this Setup
; without a UAC prompt and without file-lock fights over a Program Files exe.
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_NAME}" "InstallDir"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "Sections.nsh"

!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_ABORTWARNING

; Finish page: offer to launch Cue.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ─── Sections ──────────────────────────────────────────────────────────────

Section "!${APP_NAME} (required)" SEC_CORE
  SectionIn RO
  SetOutPath "$INSTDIR"
  ; Silent update: the in-app auto-updater launches this Setup with `/S` and then
  ; quits Cue ~1.2s later. The old cue.exe may still be exiting, and Windows can't
  ; overwrite a running exe — wait a moment so the File overwrite below succeeds.
  ${If} ${Silent}
    Sleep 2500
  ${EndIf}
  ; Wipe a prior version's files first so a reinstall/update can't leave stale
  ; DLLs behind, then lay down the freshly packaged app.
  RMDir /r "$INSTDIR\resources\app.asar.unpacked"
  File /r "${APPDIR}\*.*"

  ; Start-Menu shortcut (always created for a required app).
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"

  ; Uninstaller + Add/Remove Programs entry (per-user hive).
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\${APP_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Desktop shortcut" SEC_DESKTOP
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
SectionEnd

Section /o "Launch ${APP_NAME} when Windows starts" SEC_STARTUP
  WriteRegStr HKCU "${RUN_KEY}" "${APP_NAME}" '"$INSTDIR\${EXE_NAME}"'
SectionEnd

SectionGroup "Pre-download optional modules" SEC_MODULES
  Section /o "Media tools (yt-dlp + ffmpeg, ~85 MB)" SEC_BINS
  SectionEnd
  Section /o "Scripture-detection speech + verse models" SEC_ASR
  SectionEnd
SectionGroupEnd

; Hidden section (leading '-') runs LAST: fetch whichever optional modules were
; ticked by re-invoking the just-installed app headlessly. Skipped entirely if
; none were selected, so a normal install downloads nothing extra.
Section "-Prefetch"
  StrCpy $0 ""
  ${If} ${SectionIsSelected} ${SEC_BINS}
    StrCpy $0 "bins"
  ${EndIf}
  ${If} ${SectionIsSelected} ${SEC_ASR}
    ${If} $0 == ""
      StrCpy $0 "asr"
    ${Else}
      StrCpy $0 "$0,asr"
    ${EndIf}
  ${EndIf}
  ${If} $0 != ""
    DetailPrint "Downloading selected modules — this can take several minutes…"
    ExecWait '"$INSTDIR\${EXE_NAME}" --prefetch=$0'
  ${EndIf}
SectionEnd

; After a SILENT (auto-update) install the Finish page — and its "Launch Cue"
; checkbox — never shows, so the app wouldn't restart on its own. Relaunch it.
; Interactive installs skip this and use the Finish-page RUN option instead.
Section "-Relaunch"
  ${If} ${Silent}
    Exec '"$INSTDIR\${EXE_NAME}"'
  ${EndIf}
SectionEnd

; Component descriptions (hover text on the components page).
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_CORE}    "The ${APP_NAME} application (required)."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_DESKTOP} "Add a shortcut to your Desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_STARTUP} "Start ${APP_NAME} automatically when you sign in to Windows."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MODULES} "Optional. These are normally downloaded on first use; tick to fetch them now instead."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_BINS}    "yt-dlp + ffmpeg, used for YouTube cues and media processing."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_ASR}     "The offline speech model + verse-embedding model for scripture auto-detection (large)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ─── Uninstaller ─────────────────────────────────────────────────────────────
; Removes the installed app + shortcuts + registry. Leaves the user's data
; (cue.db, media, downloaded models under %APPDATA%\Cue) untouched by design.

Section "Uninstall"
  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP_NAME}"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\${APP_NAME}"
  RMDir /r "$INSTDIR"
SectionEnd
