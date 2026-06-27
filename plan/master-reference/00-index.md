# Cue Graphics Engine — Master Reference (Modular)

*Authoritative technical reference. Updated after every significant session. Read the relevant section(s) first.*

## Index of Sections

1. **[What Cue Is](./01-what-cue-is.md)** — Overview and target platforms
2. **[Tech Stack — Exact Versions](./02-tech-stack-exact-versions.md)** — Dependencies, pinned versions, build tools
3. **[Process Architecture](./03-process-architecture.md)** — Main, Renderer, Output processes and security model
4. **[File Structure](./04-file-structure.md)** — Codebase layout and module descriptions
5. **[Database](./05-database.md)** — Schema, migrations, tables, field descriptions
6. **[Media Handling — Critical Details](./06-media-handling-critical-details.md)** — `cue-media://` protocol, URLs, YouTube, thumbnails
7. **[IPC API — `window.cue`](./07-ipc-api-windowcue.md)** — Complete renderer↔main API surface
8. **[Section Style JSON](./08-section-style-json.md)** — Song section styling schema, runs, section splitting
9. **[Background Resolution Order](./09-background-resolution-order.md)** — Background cascade, locks, themes, write-through
10. **[Design System](./10-design-system.md)** — Colors, typography, spacing, component rules
11. **[Operator UI Layout](./11-operator-ui-layout.md)** — Panel structure, resize behavior, keyboard shortcuts
12. **[Operator Workflow — Preview / Live Mechanics](./12-operator-workflow-preview-live-mechanics.md)** — Transport, payload building, go/clear/logo
13. **[Output Windows](./13-output-windows.md)** — Output rendering, media players, transitions, graphics overlay
14. **[NDI](./14-ndi.md)** — NDI output, frame capture, multiview
15. **[Fonts](./15-fonts.md)** — Font loading, bundled fonts, user fonts
16. **[Song Editor Details](./16-song-editor-details.md)** — Editor UI, runs, formatting, tag management
17. **[Scripture Module](./17-scripture-module.md)** — Bible data, verse queries, display, styling
18. **[Known Gaps and Backlog](./18-known-gaps-and-backlog.md)** — Future work, TODOs, architectural debt
19. **[App Startup Sequence](./19-app-startup-sequence.md)** — Boot order, DB init, window creation
20. **[Running the App](./20-running-the-app.md)** — Dev server, packaging, distribution commands
21. **[Presentations & PowerPoint Import](./21-presentations-and-powerpoint-import.md)** — Presentation element model, PPTX pipeline
22. **[Sermon → Slides Import](./22-sermon-to-slides-import.md)** — Sermon document parser (outline detection, reference handling, overflow packing)

## How to Use

When updating knowledge after a session:
1. **Identify which sections were modified** in your work
2. **Only update those corresponding `.md` files** in this directory
3. **Do NOT rewrite the entire master reference** — update only the relevant sections
4. **Keep the 00-index.md file in sync** if section structure changes

This modular approach:
- **Reduces context load** — only relevant sections are loaded into knowledge updates
- **Makes diffs smaller** — reviewing 5KB of changes is faster than 65KB
- **Improves maintainability** — sections stay focused and don't grow unbounded
- **Survives large architectural changes** — refactor one section at a time
