## 10. Design System

### Design philosophy
Mission-control broadcast engineering: dark, precise, information-dense. Not a consumer app. Material Design 3 semantic roles.

### Colour tokens (Tailwind custom colours in `tailwind.config.js`)

| Token | Hex | Semantic use |
|---|---|---|
| `background` | `#111317` | Page background |
| `surface-container-lowest` | `#0c0e12` | Input fields |
| `surface-container-low` | `#1a1c20` | Panel backgrounds, modal shells |
| `surface-container` | `#1e2024` | Cards, section rows |
| `surface-container-high` | `#282a2e` | Panel headers, footers, toolbars |
| `surface-container-highest` | `#333539` | Hover states, active tabs |
| `surface-variant` | `#333539` | Same as highest — hover bg |
| `outline-variant` | `#424754` | Dividers, inactive borders |
| `outline` | `#8c909f` | Secondary borders |
| `on-surface` | `#e2e2e8` | Primary text |
| `on-surface-variant` | `#c2c6d6` | Secondary text |
| `primary` | `#adc6ff` | Preview / staged / selected (blue) |
| `primary-container` | `#4d8eff` | Primary button bg |
| `on-primary` | `#002e6a` | Text on primary |
| `secondary` | `#ffb3ad` | Live / on-air / danger (red-coral) |
| `secondary-container` | `#a40217` | LIVE badge bg |
| `on-secondary` | `#68000a` | Text on secondary |
| `tertiary` | `#4ae176` | GO / success / active output (green) |
| `tertiary-container` | `#00a74b` | Save button bg |
| `on-tertiary` | `#003915` | Text on tertiary |
| `error` | `#ffb4ab` | Destructive actions |
| `error-container` | `#93000a` | Error bg |

**Never use:** `bg-slate-*`, `border-slate-*`, `text-indigo-*`, `bg-indigo-*`, or any purple/violet accent.

### Typography tokens

| Token | Font | Size | Weight | Treatment |
|---|---|---|---|---|
| `text-headline-md` | Inter | 20px / 28px | 600 | — |
| `text-display-lg` | Inter | 32px / 40px | 700 | tracking -0.02em |
| `text-body-md` | Inter | 14px / 20px | 400 | — |
| `text-label-sm` | Inter | 12px / 16px | 500 | uppercase tracking-[0.05em] |
| `font-label-sm` | Inter | — | — | Pairs with `text-label-sm` |

Typography is **Inter everywhere** — body, headlines, and all labels/chips/badges/buttons/timecodes. The `mono`, `label-sm`, and `timecode-lg` Tailwind font-family tokens all resolve to Inter (the token names are retained for the many existing `font-mono` usages, but they are NOT a monospace face); apply the `tabular-nums` utility where digits must align. Inter is bundled in `src/fonts/` (`fonts.css`, loaded in the operator and every output window), so it always resolves. No monospace face is used for UI chrome. Operator UI, `index.css` (`.section-chip`, `.kbd-hint`), the stage template (`stage.css`), and the `PreviewLivePanel` monitor labels all use Inter.

Oswald is reserved for output window templates only. Do not use in operator UI.

### Spacing tokens
`xs=4px` `sm=8px` `md=16px` `lg=24px` `xl=32px` `gutter=12px`

### CSS utility classes (`src/renderer/index.css`)

| Class | Effect |
|---|---|
| `.monitor-preview` | Blue border + blue glow on monitor frame |
| `.monitor-live` | Red-coral border + red glow |
| `.monitor-idle` | Dark neutral border |
| `.tally-live` | 4px red left border + red bg tint on rundown rows |
| `.tally-preview` | 4px blue left border + blue bg tint |
| `.tally-idle` | Transparent left border |
| `.dot-pulse` | Pulsing opacity animation (ON AIR dot) |
| `.live-pulse` | Pulsing box-shadow animation |
| `@keyframes cue-ticker-crawl` | `translateX(0)`→`translateX(-100%)` horizontal crawl; ticker previews (gallery tiles, editor, live monitor, card thumbs) animate with it, duration = `scrollWidth/speed`, mirroring the output crawl |
| `.drag-handle` | `cursor: grab` |
| `.titlebar-drag` | `-webkit-app-region: drag` |
| `.titlebar-nodrag` | `-webkit-app-region: no-drag` |
| `.section-chip` | JetBrains Mono label chip style |
| Custom scrollbar | 6px, `surface-container-low` track, `surface-container-highest` thumb |

### Component rules
- **Borders:** `border border-outline-variant/30` on containers. `/20`–`/40` opacity suffixes preferred.
- **Border radius:** `rounded-lg` (0.25rem) for cards/panels. `rounded-xl` (0.5rem) for modals.
- **No box shadows on flat surfaces.** Depth is expressed via surface lightness levels.
- **Tally bars:** `border-l-4` coloured left edge on rundown items.
- **Modals:** `fixed inset-0 bg-background/80 backdrop-blur-sm`. Container: `bg-surface-container-low rounded-xl border border-outline-variant/30 shadow-2xl ring-1 ring-white/5`.
- **Inputs:** `bg-surface-container-lowest border border-outline-variant/50 rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/30`.
- **Toasts:** the one transient-notification system is `components/Toast.jsx` — a `ToastProvider` mounted once at the root (`main.jsx`) exposing `useToast()` with `success`/`error`/`info`/`show`. `show({ message, kind, duration, action: { label, onClick } })` supports an action button (used for Undo). Settings pages and the operator use it; do **not** reintroduce per-page inline toast `<div>`s. The rundown remove/clear undo and the operator's add-confirmations route through it.
- **Error boundaries:** `components/ErrorBoundary.jsx` wraps each top-level view in `App.jsx` separately, so a render throw in one view shows a recoverable fallback ("Reload UI") instead of blanking the operator — output windows are separate processes and keep running. `main.jsx` also installs `window.onerror`/`unhandledrejection` loggers.

### Responsive toolbars (`components/ResponsiveToolbar.jsx`)
Cue runs full-screen on any monitor, including small/laptop panels, so a horizontal row of controls must never render buttons off-screen. `ResponsiveToolbar` is the shared "priority-plus" primitive for dense button rows: it measures each item's natural width in a hidden off-screen row, compares it to the container's content width (via `ResizeObserver`), then adapts in two stages — (1) drop button labels to icon-only (items with `keepLabel` opt out), then (2) collapse the trailing, non-`pinned` items into a "⋯" overflow menu (an `AnchoredMenu`, portaled + clamped on-screen). It is **descriptor-driven** (an `items` array of `{ kind: 'button'|'divider'|'spacer'|'custom', id, icon, label, onClick, pinned, keepLabel, active, danger, className, render, menuRender }`) so a collapsed item can render a proper menu row. `pinned` items stay inline (primary actions like GO / Save); the menu always shows each collapsed item's icon + label so nothing reachable on a big screen becomes unreachable on a small one. Currently drives the Presentation Editor element toolbar and the Library tab bar (active tab pinned). For rows that aren't worth a full descriptor conversion, the lighter equivalent is: give the flexible middle (title/subtitle) `min-w-0 truncate` and mark action clusters `shrink-0`, so the label shrinks and the buttons keep their space — never the reverse.

---
