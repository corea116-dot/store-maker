# Store Maker Design System

## 1. Atmosphere & Identity

Store Maker now follows a monochrome design-guide aesthetic inspired by whoisguilty's layout reference: a gray browser-like page, one large white rounded panel, dotted cards, thick black headings, and hand-drawn line previews. It should feel like a structured design manual wrapped around a working commerce generation tool, not a generic SaaS dashboard.

## 2. Color

### Palette

| Role | Token | Light | Dark | Usage |
|------|-------|-------|------|-------|
| Surface/page | --bg | #E9E9E9 | n/a | App background |
| Surface/panel | --surface | #FBFBFB | n/a | Main rounded panel and dialogs |
| Surface/muted | --surface-muted | #F0F0F0 | n/a | Pills, inactive controls, quiet panels |
| Text/primary | --fg | #0B0B0B | n/a | Main text and heavy headings |
| Text/secondary | --muted | #5F5F5F | n/a | Help text and metadata |
| Border/default | --border | #C8C8C8 | n/a | Inputs and internal rules |
| Border/strong | --border-strong | #2F2F2F | n/a | Main panel, buttons, sketch strokes |
| Border/dotted | --border-dotted | #B8B8B8 | n/a | Guide cards and ghost frame |
| Accent/primary | --accent | #111111 | n/a | Primary actions and active tabs |
| Accent/hover | --accent-hover | #2F2F2F | n/a | Primary hover |
| Status/success | --success | #17A34A | #31C66B | Positive status |
| Status/warning | --warn | #B98900 | #EAB308 | Missing or waiting state |
| Status/error | --danger | #DC2626 | #FF6B6B | Failed runs |

### Rules
- Do not use blue for structural UI in this theme. Lines, boxes, and primary actions are black or gray.
- Color is reserved for status only. Product/generated images may contain color because they are content.
- Raw hex values belong here only. UI files must use CSS tokens.

## 3. Typography

### Scale

| Level | Size | Weight | Line Height | Tracking | Usage |
|-------|------|--------|-------------|----------|-------|
| H1 | clamp(48px, 7vw, 104px) | 900 | 0.92 | 0 | Main panel title |
| H2 | 32px | 900 | 1.1 | 0 | Section titles |
| H3 | 20px | 800 | 1.2 | 0 | Card titles |
| Body | 16px | 400 | 1.55 | 0 | Forms and preview |
| Body/sm | 14px | 400 | 1.5 | 0 | Help text |
| Caption | 12px | 600 | 1.4 | 0.04em | Table headers, chips |

### Font Stack
- Primary: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif
- Mono: ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, monospace

### Rules
- Korean text must not use negative letter spacing.
- Body and form text never drop below 14px.
- Mono text is used for breadcrumbs, card labels, metadata, commands, routes, and logs.

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
- Max content width: 1560px including the gray outer browser frame.
- Main app surface is one large rounded white panel under a small breadcrumb navigation.
- Desktop: form/result/log sections become a guide-card grid inside the panel.
- Tablet and mobile: cards stack in one column inside the rounded panel.
- Breakpoints: 640px, 760px, 1080px, 1180px.

### Rules
- App sections are dotted guide cards inside one first-level rounded panel.
- Tables can scroll horizontally on mobile, but primary form actions must not require horizontal scrolling.

## 5. Components

### Button
- Structure: native `button` or `a` with `.btn`.
- Variants: default, primary, danger, ghost.
- Visual: square-corner controls with black/gray border inside rounded guide cards.
- States: hover border change, active 1px translate, visible focus ring, disabled dimming.
- Accessibility: text labels only; no icon-only critical actions.

### Field
- Structure: label above control, optional help below.
- Visual: square input boxes, gray borders, white fills, mono uppercase labels.
- States: focus ring, error text below, disabled state.
- Accessibility: every input has a visible label.

### Main Panel
- Structure: `.app-shell` as one large rounded white panel with a thick dark border and a dashed ghost frame behind it.
- Includes a top-right non-interactive circular close glyph as a visual reference motif.
- Page title and health status sit at the top of this panel.

### Guide Card
- Structure: `.card` sections use dotted borders, large radius, white background, internal sketch/controls/content, and a small pale circular dot in the lower-right.
- Variants: product input, options, result preview, history, logs, export.
- The guide-card motif replaces dense nested dashboard cards.

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

### Sketch Motif
- Structure: CSS pseudo-elements or inline decorative areas that resemble hand-drawn black UI wireframes.
- Usage: card-level visual anchors only; they must not replace real controls or generated image content.
- Accessibility: decorative sketches are hidden from assistive tech.

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
Flat, print-like, and monochrome. Structure comes from the thick rounded main panel, dotted guide-card borders, dotted dividers, and light gray circular affordances. Shadows are avoided except temporary floating UI such as toast/dialog overlays.

| Level | Value | Usage |
|-------|-------|-------|
| Border/default | 1px solid var(--border) | Inputs and internal rules |
| Border/strong | 2px solid var(--border-strong) | Main panel and primary outlines |
| Border/dotted | 1px dashed var(--border-dotted) | Guide cards and ghost frame |
| Shadow/raised | 0 8px 28px rgba(17, 17, 17, 0.12) | Dialogs and toast only |
