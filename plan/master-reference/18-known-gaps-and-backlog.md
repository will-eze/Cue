## 18. Known Gaps and Backlog

| Item | Priority | Notes |
|---|---|---|
| ~~NDI publish~~ | ~~High~~ | Implemented. See §14. |
| `linked_channel_id` logic | Medium | Field exists, settable, never read. Sync lower-third to fullscreen channel. |
| ~~Stage display / confidence monitor~~ | ~~High~~ | Implemented — `stage` template, StagePanel (timer + immediate + scheduled messages), VIDEO countdown. |
| ~~Scheduled / timed stage messages~~ | ~~Medium~~ | Implemented — queue a message to appear after a countdown or at a wall-clock time, with optional auto-clear; collisions surfaced (later-start wins). In-memory state, anchors resolved once in main, template ticks locally. `src/shared/stage-schedule.js`. |
| ~~Tag CRUD UI~~ | ~~Medium~~ | Implemented — `TagSettings.jsx` (Settings → Tags) for create/rename/recolour/delete; plus inline tag creation in `SongEditor`. |
| ~~Song background picker in Song Editor~~ | ~~Medium~~ | Implemented. Media picker in `SlidePreview` calls `songs:setBackground`. |
| ~~Song import~~ | ~~Medium~~ | Implemented — OpenLyrics / ChordPro / text / EasyWorship + bundled GHS hymnal. See §16. |
| ~~Network control API~~ | ~~Medium~~ | Implemented — localhost/LAN HTTP + SSE server, token-gated. Phone control page + Companion HTTP verbs. See §7 `window.cue.remote`, `src/main/remote/`. |
| Disk space warning | Low | Warn when < 2GB free on import. Not implemented. |
| ~~Media unused-asset cleanup~~ | ~~Low~~ | Implemented — `MediaCleanup.jsx` (Settings → Media) scans via `media.findUnused` (songs/service_items/channels/themes/settings) and bulk-deletes. |
| ~~Auto-advance / timed loops~~ | ~~Medium~~ | Implemented — `service_items.advance_seconds/advance_loop/advance_wrap`, renderer-side scheduler in `OperatorView.handleAutoAdvance`. See §12. |
| ~~Presentations (native slides) + PowerPoint import~~ | ~~High~~ | Implemented — multi-element slide editor + LibreOffice/pdfjs PPTX→image import. See §21. |
| ~~Scenes — multi-output state recall~~ | ~~Low~~ | Implemented (reframed from the roadmap's "macros" proposal — recorded timed playback + event triggers deliberately dropped). `scenes` table (v24), `ScenesPanel` capture-driven editor, number-key 1–9 recall, atomic `applyScene`. See §5/§7/§13. |
| ~~Transition / animation library~~ | ~~Low~~ | Implemented — `transitions.js` engine + Settings → Motion (`output_transitions`). Per-trigger (slide/logo/clear) fade/slide/zoom, foreground-only fade-in over a solid background, video swaps always hard-cut. See §13. |
| Presentation user-saved templates | Low | `presentation_templates` table + IPC exist; only built-in layouts wired into the editor so far. |
| Drag asset from Library onto rundown item | Medium | Background override currently only via context menu. |
| `operator_preview_layout` setting | Low | Side-by-side monitor layout toggle. Setting key exists, no UI toggle. |

---
