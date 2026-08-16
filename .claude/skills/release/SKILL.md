---
name: release
description: "Cut a Cue release end-to-end: INFER the version bump (patch vs minor) from the session's work, bump the version (both stores), commit + push to main, tag v<version> to trigger the CI installer build, wait for it to finish, then download the macOS dmg + Windows exe into ./installers. Trigger: /release"
---

# Release — Cue

Cut a full release. Execute the steps **in order**; do not skip. **You infer the bump
type yourself** from what changed this session (Step 2) — the user does not pass it.
Per CLAUDE.md, **MAJOR is schema-derived and moves on its own** — never bump it here.

`$ARGUMENTS` is normally empty. Honour it only as an explicit override if the user
typed `patch` or `minor`; otherwise infer.

---

## Step 1 — Preconditions (stop on any failure)

```bash
git rev-parse --abbrev-ref HEAD        # must be: main
git fetch origin && git status -sb     # must be up to date with origin/main; review pending changes
gh auth status                         # gh CLI must be authenticated
```

- If not on `main`, stop and tell the user — releases cut from `main` only.
- If behind `origin/main`, `git pull --ff-only` first.
- Any uncommitted work shown by `git status` will be folded into the release commit in
  Step 4 — confirm it's all intended to ship. If something shouldn't ship, stop and ask.

Quick sanity that the renderer still compiles (cheap; the real build happens in CI):

```bash
npx vite build --config vite.renderer.config.js 2>&1 | tail -3
```

---

## Step 2 — Infer the bump, then compute the new version

First read the current version stores and the last released tag:

```bash
MAJOR=$(grep -oE 'function v[0-9]+' src/main/db/schema.js | grep -oE '[0-9]+' | sort -n | tail -1)
MINOR=$(grep -oE 'VERSION_MINOR\s*=\s*[0-9]+' vite.renderer.config.js | grep -oE '[0-9]+')
PATCH=$(grep -oE 'VERSION_PATCH\s*=\s*[0-9]+' vite.renderer.config.js | grep -oE '[0-9]+')
LAST_TAG=$(git tag --list 'v*' --sort=-v:refname | head -1)
echo "current: $MAJOR.$MINOR.$PATCH  (package.json: $(node -p "require('./package.json').version"))  last tag: $LAST_TAG"
```

Now look at **everything that changed since the last release** — both committed and not —
to classify the bump. Read enough of the diff to actually judge it, don't guess:

```bash
git log --oneline ${LAST_TAG}..HEAD 2>/dev/null
git status -sb
git diff --stat ${LAST_TAG}..HEAD 2>/dev/null
git diff --stat                                   # uncommitted (will ship in this release)
git diff ${LAST_TAG}..HEAD -- src/main/db/schema.js   # did a NEW vN migration land?
git diff -- src/main/db/schema.js
```

**Classify (first match wins):**

1. **A new `vN` migration was added** since the last release (schema MAJOR is now higher
   than the last tag's MAJOR) → this is a **MAJOR release**. MAJOR already moved on its
   own; the new version is `MAJOR.0.0`. Per CLAUDE.md the migration commit should already
   have reset `VERSION_MINOR`/`VERSION_PATCH` to `0` — verify they're `0` (fix them in
   Step 3 if not). Do **not** add a further bump.

2. Otherwise, a **new user-facing feature / capability** landed — a new component, panel,
   IPC channel, setting, keyboard shortcut, or any new behaviour the operator can use →
   **minor**: `MINOR = MINOR + 1`, `PATCH = 0`.

3. Otherwise, **only fixes / docs / refactors / chores / styling** → **patch**:
   `PATCH = PATCH + 1` (MINOR unchanged).

If the user passed `patch` or `minor` in `$ARGUMENTS`, use that instead of the inference.

**State the inferred bump and cite the evidence** (e.g. "minor — adds verse-jump
shortcuts, undo/redo, customisable top bar; no schema migration") before editing, so the
choice is reviewable. The new version is `NEW="$MAJOR.$NEW_MINOR.$NEW_PATCH"`.

> Sanity: `package.json.version` should currently equal `$MAJOR.$MINOR.$PATCH`. If it
> already diverges, the previous release was left inconsistent — fix that first.

---

## Step 3 — Edit the two version stores (must stay identical)

Use the **Edit** tool (not sed) on each:

1. `vite.renderer.config.js` — bump the relevant constant:
   - patch: `const VERSION_PATCH = <new>;`
   - minor: set `const VERSION_MINOR = <new>;` **and** `const VERSION_PATCH = 0;`
2. `package.json` — set `"version": "<NEW>"` to the identical `MAJOR.MINOR.PATCH`.

The `prePackage` guard in `forge.config.js` fails the CI build if these diverge, so they
**must** match. MAJOR is read from `schema.js`; never hardcode it in either file.

---

## Step 4 — Commit + push to main

```bash
git add -A
git commit -m "$(cat <<'EOF'
release: v<NEW>

<one line summarising what's in this release>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013KRX5RvK7e4Z5FZrvX9gER
EOF
)"
git push origin main
```

Replace `<NEW>` and the summary line. Confirm the push succeeded before tagging.

---

## Step 5 — Tag and trigger CI

A clean tag is required (one release per version). If `v<NEW>` somehow already exists,
delete it first: `gh release delete v<NEW> --cleanup-tag -y` (ignore "release not found").

```bash
git tag -a v<NEW> -m "Cue v<NEW>"
git push origin v<NEW>
```

The `v*` tag push triggers `.github/workflows/build-installers.yml`, which builds the
dmg (macOS arm64 runner) + exe (Windows runner) and publishes a GitHub Release named
`Cue v<NEW>`.

The workflow's `softprops/action-gh-release` step sets a fixed `body:` with the
Windows PowerShell install one-liner + macOS drag-to-Applications instructions, so
**every** release carries the install notes automatically — do not hand-edit release
notes for this. If the install steps change, edit that `body:` in the workflow, not
individual releases.

---

## Step 6 — Wait for the build to finish

Find the run started by the tag push and watch it to completion (this takes several
minutes — both OS runners build natively):

```bash
sleep 8   # give GitHub a moment to register the run
RUN=$(gh run list --workflow="Build installers" -L 5 --json databaseId,headBranch,event,status \
        --jq '[.[] | select(.event=="push")][0].databaseId')
gh run watch "$RUN" --exit-status
```

- `gh run watch --exit-status` blocks and returns non-zero if the workflow fails.
- If it fails, report which job failed (`gh run view "$RUN"`) and **stop** — do not
  attempt the download. Common cause: a packaged-only ABI/native break (see CLAUDE.md
  `packageAfterPrune` / `prePackage` notes).

---

## Step 7 — Download both installers (clean) into ./installers

`installers/` must hold **only the two installers for this release** — nothing from a
prior version. Wipe it first, then download:

```bash
rm -rf installers && mkdir -p installers
gh release download v<NEW> -R will-eze/Cue -D installers
ls -la installers
```

A `gh` CLI download sets **no macOS quarantine xattr / no Windows mark-of-the-web**, so
the `.dmg` and `.exe` arrive ready to run (unlike a browser download). Confirm `installers/`
contains **exactly two files** — one `*.dmg` and one `*Setup.exe`, both for `v<NEW>`. If
anything else is present, remove it.

---

## Step 8 — Report

Tell the user: the new version, the release URL (`gh release view v<NEW> --web` or the
`html_url`), and the two downloaded files. Remind them, per CLAUDE.md, to **launch the
packaged app once per OS before distributing** — ABI/packaging breaks are invisible in
`npm start` and a dev `npm run package`.
