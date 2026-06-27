# Cue Graphics Engine — Master Reference (Modular Edition)

*Authoritative technical reference. Read the index below to find relevant sections.*

## Full Documentation Index

The master reference has been converted to a modular structure to reduce context usage and improve maintainability. See **[`master-reference/00-index.md`](./master-reference/00-index.md)** for the complete index and section descriptions.

### Quick Links to Common Sections

**Getting Started / Overview:**
- [What Cue Is](./master-reference/01-what-cue-is.md)
- [Tech Stack](./master-reference/02-tech-stack-exact-versions.md)
- [Process Architecture](./master-reference/03-process-architecture.md)

**Implementation Details:**
- [File Structure](./master-reference/04-file-structure.md)
- [Database Schema](./master-reference/05-database.md)
- [IPC API (`window.cue`)](./master-reference/07-ipc-api-windowcue.md)

**Output & Rendering:**
- [Output Windows](./master-reference/13-output-windows.md)
- [Media Handling](./master-reference/06-media-handling-critical-details.md)
- [Background Resolution](./master-reference/09-background-resolution-order.md)

**Operator UI:**
- [Operator Workflow](./master-reference/12-operator-workflow-preview-live-mechanics.md)
- [UI Layout](./master-reference/11-operator-ui-layout.md)
- [Design System](./master-reference/10-design-system.md)

**Features:**
- [Presentations & PowerPoint](./master-reference/21-presentations-and-powerpoint-import.md)
- [Scripture Module](./master-reference/17-scripture-module.md)
- [Songs & Themes](./master-reference/16-song-editor-details.md)
- [NDI Output](./master-reference/14-ndi.md)

**Operations:**
- [App Startup](./master-reference/19-app-startup-sequence.md)
- [Running the App](./master-reference/20-running-the-app.md)

---

## Knowledge Updates

After significant development sessions, update only the relevant sections:

1. **Identify changed sections** from your work
2. **Update only those `.md` files** in `./master-reference/`
3. **Preserve the modular structure** — don't rewrite the entire reference
4. **Sync `00-index.md`** if the structure changes

This approach keeps context usage lean and diffs reviewable.

**Previous monolithic version:** See `cue-master-reference.md.backup` for the full consolidated reference (no longer actively maintained).
