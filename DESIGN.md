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

### Detail Page Editor
- Structure: one detail-only workspace inside the existing result guide card. A compact toolbar contains an edit/preview tablist, revision-aware save status, and explicit save action; the active panel remains mounted while its sibling is hidden.
- Routing: completed `detail-page` jobs open this workspace. `ad-set` jobs continue to use the current read-only result surface.
- Authority: the ordered section document is the only editable source. Preview and Markdown/HTML/JSON exports are server-rendered from the last accepted revision.
- Density: controls belong to the section they affect. Avoid a second dashboard, floating inspector, or permanently visible asset library.
- Scroll ownership: the page owns vertical scrolling. Section cards, toolbars, and image pickers must not create nested horizontal scrolling at 1280px, 768px, or 375px.

### Editor Tablist
- Structure: two native buttons with `role="tab"`, `aria-selected`, `aria-controls`, roving `tabindex`, and two persistent `role="tabpanel"` regions.
- Keyboard: Left/Right, Home, and End move focus and selection; pointer activation follows the same state transition.
- Visual: use the existing monochrome segmented-control language. The active indicator may transition with opacity/transform only and is instant under reduced motion.

### Section Card
- Structure: stable section number and kind, visible heading label/input, body textarea, optional newline list field, layout choice, image slot, and a local action row.
- Actions: move up/down, show/hide, remove, and image choose/remove/edit. Every action is a native text button whose accessible name includes the current section heading or position.
- Reorder: drag is an enhancement only. Up/down buttons are always present; after a keyboard move, focus returns to the moved heading and a polite live region announces its new position.
- Safety: at least one visible section is required. The last visible section cannot be hidden or removed, and the reason is shown next to the attempted action.
- States: clean, dirty, saving, saved, validation error, and revision conflict. State changes must not resize the toolbar.

### Section Image Picker
- Structure: a bounded dialog opened from one section card and populated only by generated or edited output images already owned by Store Maker.
- Selection: choosing an asset assigns at most one image to the originating section. Removing it keeps the section text. Editing an assigned image returns the edited output to the same section.
- Accessibility: native dialog semantics, visible title naming the section, Escape close, trapped focus, and focus restoration to the opening control.

### Save & Conflict Feedback
- Structure: `role="status"` for clean/dirty/saving/saved feedback and a nearby `role="alert"` conflict panel when the server rejects a stale revision.
- Conflict actions: reload the server revision or explicitly overwrite using the latest known revision. Autosave pauses while a conflict is unresolved.
- Timing: local edits debounce for 600ms before autosave; the explicit save button is always available and shares the same single-flight request.

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
- Do not animate section order, height, or text fields. A moved card updates immediately and receives focus.
- Autosave and server preview updates announce state without stealing focus.

## 7. Detail Editor Adaptive Contract

### Personas
- Keyboard-only seller: can reach, edit, reorder, save, preview, resolve conflict, and choose an image without drag or pointer input.
- Low-vision seller at 200% zoom: section labels, validation messages, and save status remain adjacent to their controls, with no clipped toolbar actions.
- Reduced-motion seller: receives the same state changes with zero transition duration and no animated reordering.
- Korean/CJK catalog seller: long unbroken names and mixed Korean/English copy wrap inside cards without horizontal overflow.

### Responsive Behavior
- At 1180px and above, the editor toolbar may align tabs, status, and save action in one row; section content may use a two-column text/image arrangement only when the section layout asks for it.
- Below 760px, toolbar groups and section action rows wrap to full-width lines; no action relies on hover.
- At 375px, every field and button remains at least 44px high where practical, image thumbnails stay within the card, and `min-width: 0` is applied to all grid/flex children.

### Verification Matrix
- 1280 × 900: full edit flow, toolbar alignment, section reorder, image assignment, preview/export.
- 768 × 900: wrapped toolbar/actions, image dialog, no horizontal overflow.
- 375 × 900: single-column cards, long Korean copy, keyboard focus visibility, no horizontal overflow.
- Reduced motion: tab changes, save state, and section changes remain complete with transitions disabled.

## 8. Depth & Surface

### Strategy
Flat, print-like, and monochrome. Structure comes from the thick rounded main panel, dotted guide-card borders, dotted dividers, and light gray circular affordances. Shadows are avoided except temporary floating UI such as toast/dialog overlays.

| Level | Value | Usage |
|-------|-------|-------|
| Border/default | 1px solid var(--border) | Inputs and internal rules |
| Border/strong | 2px solid var(--border-strong) | Main panel and primary outlines |
| Border/dotted | 1px dashed var(--border-dotted) | Guide cards and ghost frame |
| Shadow/raised | 0 8px 28px rgba(17, 17, 17, 0.12) | Dialogs and toast only |
