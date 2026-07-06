# Linux Share Manager Design System

## 1. Atmosphere & Identity

Linux Share Manager feels like a quiet command center for risky infrastructure work. The signature is restrained operational depth: dense tables, exact status language, and dark surfaces separated by tonal shifts so administrators can scan risk without visual noise.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
| --- | --- | --- | --- | --- |
| Surface/base | `--surface-base` | `#f7f8fa` | `#08090a` | App background |
| Surface/panel | `--surface-panel` | `#ffffff` | `#101113` | Sidebar, page panels |
| Surface/elevated | `--surface-elevated` | `#f1f3f6` | `#181a1d` | Repeated cards, forms |
| Surface-muted | `--surface-muted` | `#e7eaf0` | `#22252a` | Hover and selected rows |
| Text/primary | `--text-primary` | `#111318` | `#f7f8f8` | Main text |
| Text/secondary | `--text-secondary` | `#4f5663` | `#c6ccd6` | Secondary copy |
| Text/muted | `--text-muted` | `#7b8494` | `#858c98` | Metadata |
| Border/subtle | `--border-subtle` | `#dfe3ea` | `rgba(255,255,255,0.06)` | Fine separation |
| Border/default | `--border-default` | `#cfd5df` | `rgba(255,255,255,0.1)` | Inputs, cards |
| Accent/primary | `--accent-primary` | `#4856d6` | `#7170ff` | Primary actions, focus |
| Accent/hover | `--accent-hover` | `#3443bd` | `#8988ff` | Primary hover |
| Status/success | `--status-success` | `#168a45` | `#35c46b` | Healthy shares |
| Status/warning | `--status-warning` | `#b86b00` | `#f0a22a` | Risk and partial states |
| Status/error | `--status-error` | `#c83232` | `#ff6b6b` | Failures |
| Status/info | `--status-info` | `#2463c7` | `#64a4ff` | Neutral information |

### Rules

- Accent color appears only on interactive elements, active navigation, and focus rings.
- Status colors are reserved for infrastructure state.
- No raw color literals outside this document and `src/web/styles/global.css`.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| H1 | 32px | 600 | 1.15 | 0 | Page title |
| H2 | 24px | 600 | 1.25 | 0 | Section title |
| H3 | 18px | 600 | 1.35 | 0 | Panel title |
| Body | 15px | 400 | 1.55 | 0 | Default text |
| Body/sm | 14px | 400 | 1.5 | 0 | Tables and forms |
| Caption | 12px | 500 | 1.4 | 0 | Labels, metadata |
| Mono | 13px | 400 | 1.5 | 0 | IDs, hosts, paths |

### Font Stack

- Primary: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- Mono: `"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace`

## 4. Spacing & Layout

### Base Unit

All spacing derives from 4px.

| Token | Value | Usage |
| --- | --- | --- |
| `--space-1` | 4px | Inline icon gaps |
| `--space-2` | 8px | Tight controls |
| `--space-3` | 12px | Input padding |
| `--space-4` | 16px | Compact panels |
| `--space-5` | 20px | Form groups |
| `--space-6` | 24px | Default panel padding |
| `--space-8` | 32px | Page groups |
| `--space-10` | 40px | Major sections |

### Grid

- Max content width: 1440px.
- Shell: fixed sidebar at desktop, top bar on small screens.
- Breakpoints: 720px and 1040px.

## 5. Components

### Button

- **Structure**: native `button` with optional icon and text.
- **Variants**: primary, secondary, ghost, danger.
- **Spacing**: `--space-2` horizontal gap, `--space-3` x-padding.
- **States**: default, hover, active, focus, disabled, loading.
- **Accessibility**: visible focus ring and disabled state.
- **Motion**: 120ms color and transform transition.

### Text Field

- **Structure**: label, input, optional hint/error.
- **Variants**: text, password, number.
- **Spacing**: label gap `--space-2`, input padding `--space-3`.
- **States**: default, hover, focus, disabled, error.
- **Accessibility**: label is always visible.
- **Motion**: 120ms border/background transition.

### Status Badge

- **Structure**: dot plus label.
- **Variants**: success, warning, error, info, neutral.
- **Spacing**: `--space-2`.
- **States**: static.
- **Accessibility**: color is paired with text.
- **Motion**: none.

### Data Panel

- **Structure**: header, optional toolbar, content area.
- **Variants**: default, compact, empty, error.
- **Spacing**: `--space-4` to `--space-6`.
- **States**: hover only for interactive rows.
- **Accessibility**: semantic headings and table markup where appropriate.
- **Motion**: none unless content changes.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
| --- | --- | --- | --- |
| Micro | 120ms | ease-out | Buttons, fields |
| Standard | 180ms | ease-in-out | Panels and menus |

- Animate only `transform`, `opacity`, `background-color`, and `border-color`.
- Respect `prefers-reduced-motion`.
- No decorative motion; every motion must signal interaction or state.

## 7. Depth & Surface

### Strategy

Use mixed tonal shift plus subtle borders. Shadows are reserved for modal-level surfaces.

| Type | Value | Usage |
| --- | --- | --- |
| Border subtle | `1px solid var(--border-subtle)` | Panel separation |
| Border default | `1px solid var(--border-default)` | Inputs and elevated cards |
| Radius small | `6px` | Inputs, buttons |
| Radius panel | `8px` | Cards and panels |
