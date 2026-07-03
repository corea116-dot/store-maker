# Store Maker Design System

## 1. Atmosphere & Identity

Store Maker is a quiet local command center for Korean commerce operators. It should feel precise, private, and operational rather than promotional. The signature is provenance-first generation: every result is visually tied back to the selected engine, prompt payload, market target, and execution log.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/primary | --bg | #FAFAFA | #111111 | App background |
| Surface/secondary | --surface | #FFFFFF | #171717 | Cards, panels, inputs |
| Surface/muted | --surface-muted | #F5F5F5 | #202020 | Status panels, segmented controls |
| Text/primary | --fg | #111111 | #FAFAFA | Main text |
| Text/secondary | --muted | #6B6B6B | #A3A3A3 | Help text and metadata |
| Border/default | --border | #E5E5E5 | #2A2A2A | Cards, table rules, inputs |
| Accent/primary | --accent | #2F6FEB | #6EA8FF | Primary actions and focus |
| Accent/hover | --accent-hover | #285FCB | #8CBCFF | Primary hover |
| Status/success | --success | #17A34A | #31C66B | Positive status |
| Status/warning | --warn | #B98900 | #EAB308 | Missing or waiting state |
| Status/error | --danger | #DC2626 | #FF6B6B | Failed runs |

### Rules
- Accent blue is used only for actions, focus, active selections, and provenance highlights.
- Neutral surfaces carry the product; avoid decorative gradients and one-note color washes.
- Raw hex values belong here only. UI files must use CSS tokens.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | 32px | 700 | 1.2 | 0 | Page title |
| H2 | 24px | 700 | 1.25 | 0 | Panel titles |
| H3 | 20px | 700 | 1.3 | 0 | Card titles |
| Body | 16px | 400 | 1.55 | 0 | Forms and preview |
| Body/sm | 14px | 400 | 1.5 | 0 | Help text |
| Caption | 12px | 600 | 1.4 | 0.04em | Table headers, chips |

### Font Stack
- Primary: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
- Mono: ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace

### Rules
- Korean text must not use negative letter spacing.
- Body and form text never drop below 14px.
- Mono text is reserved for commands, routes, and logs.

## 4. Spacing & Layout

### Base Unit
All spacing derives from 4px.

| Token | Value | Usage |
|-------|-------|-------|
| --space-1 | 4px | Tight icon/text separation |
| --space-2 | 8px | Control internals |
| --space-3 | 12px | Compact gaps |
| --space-4 | 16px | Default field/card gap |
| --space-5 | 20px | Panel padding |
| --space-6 | 24px | Major grouped spacing |
| --space-8 | 32px | Section spacing |
| --space-12 | 48px | Page bottom spacing |

### Grid
- Max content width: 1200px
- Desktop: two-column workspace with the input/engine side wider than the preview/log side.
- Tablet and mobile: single-column flow with controls before preview.
- Breakpoints: 640px, 900px, 1080px.

### Rules
- App sections are unframed page bands or first-level cards. Do not nest decorative cards inside cards.
- Tables can scroll horizontally on mobile, but primary form actions must not require horizontal scrolling.

## 5. Components

### Button
- Structure: native `button` or `a` with `.btn`.
- Variants: default, primary, danger, ghost.
- States: hover border change, active 1px translate, visible focus ring, disabled dimming.
- Accessibility: text labels only; no icon-only critical actions.

### Field
- Structure: label above control, optional help below.
- States: focus ring, error text below, disabled state.
- Accessibility: every input has a visible label.

### Attachment Role Panel
- Structure: role title, short constraint text, dashed dropzone, upload button, and file list.
- Roles: product image, design reference image, supporting material.
- Rules: product images preserve actual product shape/color/logo/components; design references influence only mood/composition/background/layout.
- Accessibility: each dropzone is keyboard focusable and each upload input has visible role copy nearby.

### Provider Card
- Structure: button with provider label, status chip, and short description.
- Variants: active, missing, untested, failed.
- Motion: color and border transitions only.

### Log Row
- Structure: timestamp, task label, status chip, message, optional command/prompt preview.
- Variants: info, success, warning, error.
- Accessibility: logs render as a list with live status updates.

## 6. Motion & Interaction

| Type | Duration | Easing | Usage |
|------|----------|--------|-------|
| Micro | 150ms | ease-out | Button press, provider select |
| Standard | 200ms | cubic-bezier(0.2, 0, 0, 1) | Status and preview changes |

### Rules
- Animate only transform and opacity.
- Respect `prefers-reduced-motion`.
- Loading states must keep layout dimensions stable.

## 7. Depth & Surface

### Strategy
Mixed, but restrained: borders define structure; subtle tonal shift defines status panels. Shadows are used only for toast/export affordances.

| Level | Value | Usage |
|-------|-------|-------|
| Border/default | 1px solid var(--border) | Cards, tables, inputs |
| Shadow/raised | 0 2px 8px rgba(17, 17, 17, 0.08) | Toasts and floating export menu |
