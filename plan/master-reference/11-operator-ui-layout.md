## 11. Operator UI Layout

```
┌─── Titlebar (38px, draggable) ───────────────────────────────────┐
│ Cue │ [Operator] [Settings]                     GO  Clear  Logo  │  ← transport bar (40px)
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─── Rundown ──────┐  │  ┌─── Preview/Live ──────────────────┐ │
│  │  Service select   │  │  │ PREVIEW mon.  │  LIVE mon.        │ │
│  │  [DnD item list]  │  │  ├───────────────┼───────────────────┤ │
│  │                   │  │  │ Preview slides│  Live slides      │ │
│  └───────────────────┘  │  └───────────────────────────────────┘ │
│                                                                   │
├─── horizontal resize ─────────────────────────────────────────────┤  ← 3px drag
│  ┌─── Library (full width) ──────────────────────────────────────┐ │
│  │  [Songs][Media][Scripture][Presentations][Graphics][Scenes]   │ │  ← ⌘. / ⌘, cycle tabs
│  └───────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

Panel boundaries are user-resizable:
- **Horizontal** (Rundown width / Preview+Live width): default 25% / 75%, clamped 22–72%.
- **Vertical** (top panels / Library): default 62% / 38%, clamped 35–80%.
- Resize state is **persisted to `localStorage`** (`layout_h_pct`, `layout_v_pct`) — survives reloads.

---
