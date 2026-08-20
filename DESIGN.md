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
- Density: controls belong to the section they affect. The builder is a three-region workspace nested inside the existing guide card, not a second dashboard: a collapsible section library, the document map and selected card, and a candidate-inspector panel. The candidate panel only contains an uncommitted proposal and its evidence state; it is never a saved-document inspector.
- Scroll ownership: the page owns vertical scrolling. Section cards, toolbars, and image pickers must not create nested horizontal scrolling at 1280px, 768px, or 375px.

### Builder Workspace
- Structure: `.detail-builder-workspace` is a `list-detail`-style grid. At wide widths it uses `var(--detail-builder-library-min) minmax(var(--detail-builder-main-min), 1fr) var(--detail-builder-candidate-min)`; all three children have `min-inline-size: 0`.
- Library: category templates, all supported section types, and a natural-language add field. A template/direct/add action produces a candidate only; library controls do not mutate the ordered document.
- Document map: the ordered list retains every manual affordance. Drag is a progressive enhancement; text buttons and keyboard actions remain the authority.
- Candidate inspector: shows status, evidence warnings, editable candidate copy, selected template proposals, and an explicit “apply to document” button. Applying a candidate changes local editor state and uses the existing revision-aware save path; creating, polling, cancelling, or discarding one never does.
- Sizes: `--detail-builder-library-min: 208px`; `--detail-builder-main-min: 360px`; `--detail-builder-candidate-min: 272px`; `--detail-builder-drawer-max: 352px`; `--control-min: 44px`.
- States: idle, preparing, ready, needs-evidence, failed, stale, cancelled, and expired. Status text remains in a `role="status"` region and failures name a recovery action.

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

### Candidate Proposal
- Structure: candidate title, immutable operation label, evidence state, editable heading/body/bullets where allowed, and an explicit apply/discard action row.
- Safety: proposed IDs never become document IDs. Regeneration can alter only the mode's allowed fields; visible state, source, section identity, and ordering stay owned by the document.
- Evidence: review, numeric, certification, ingredient, warranty, comparison, and before/after claims display a blocked state until the request contains a verifiable reference.

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
| Drawer | 200ms | cubic-bezier(0.2, 0, 0, 1) | Tablet section-library panel, opacity/translate only |

### Rules
- Animate only transform and opacity.
- Respect `prefers-reduced-motion`.
- Loading states must keep layout dimensions stable.
- Do not animate section order, height, or text fields. A moved card updates immediately and receives focus.
- Autosave and server preview updates announce state without stealing focus.
- The builder library uses a semantic dialog/drawer below the wide breakpoint. Escape and the close button restore focus to its trigger; on reduced motion it opens and closes without a transform transition.

## 7. Detail Editor Adaptive Contract

### Personas
- Keyboard-only seller: can reach, edit, reorder, save, preview, resolve conflict, and choose an image without drag or pointer input.
- Low-vision seller at 200% zoom: section labels, validation messages, and save status remain adjacent to their controls, with no clipped toolbar actions.
- Reduced-motion seller: receives the same state changes with zero transition duration and no animated reordering.
- Korean/CJK catalog seller: long unbroken names and mixed Korean/English copy wrap inside cards without horizontal overflow.

### Responsive Behavior
- At 1180px and above, the builder displays its library, document map, and candidate inspector together. The editor toolbar may align tabs, status, and save action in one row; section content may use a two-column text/image arrangement only when the section layout asks for it.
- From 760px through 1179px, the library becomes a left dialog/drawer with an overlay; the document map and candidate inspector form a two-region grid. The page remains the vertical scroll owner.
- Below 760px, toolbar groups and section action rows wrap to full-width lines. Builder pane tabs switch between Structure, Edit, and Candidate; no primary action relies on hover or a hidden overflow menu.
- At 375px, every field and button uses `var(--control-min)` where practical, image thumbnails stay within the card, and `min-width: 0` is applied to all grid/flex children.

### Verification Matrix
- 1280 × 900: full edit flow, toolbar alignment, section reorder, image assignment, preview/export.
- 768 × 900: library drawer, document/candidate workspace, wrapped toolbar/actions, image dialog, no horizontal overflow.
- 375 × 900: builder pane tabs, single-column cards, long Korean copy, keyboard focus visibility, no horizontal overflow.
- Reduced motion: tab, drawer, save state, and section changes remain complete with transitions disabled.

## 8. Depth & Surface

### Strategy
Flat, print-like, and monochrome. Structure comes from the thick rounded main panel, dotted guide-card borders, dotted dividers, and light gray circular affordances. Shadows are avoided except temporary floating UI such as toast/dialog overlays.

| Level | Value | Usage |
|-------|-------|-------|
| Border/default | 1px solid var(--border) | Inputs and internal rules |
| Border/strong | 2px solid var(--border-strong) | Main panel and primary outlines |
| Border/dotted | 1px dashed var(--border-dotted) | Guide cards and ghost frame |
| Shadow/raised | 0 8px 28px rgba(17, 17, 17, 0.12) | Dialogs and toast only |

## 8. Brand Kit Contract

### Content color
- Brand colors belong only to seller content: swatches, the scoped Brand Preview, and generated Brand Output.
- Brand colors never recolor app chrome, structural controls, status semantics, focus rings, or the monochrome guide-card shell.
- Swatches always show a visible hex value or text label; color is never the only carrier of meaning.

### Typography
- Brand typography is selected only by the fixed display/body IDs in `assets/brand-kit-options.js`; raw family names, CSS, font URLs, uploads, and hosted font dependencies are outside the contract.
- Display options use the emitted fixed stack at weight 700. Body options use the emitted fixed stack at weight 400. System fallback is expected and does not change the selected ID.
- App chrome keeps the design-system font. Brand font stacks apply only inside the scoped preview and generated output.

### Components and layout
- The product form places a native Brand Kit select, Manage action, labelled apply switch, logo/swatches/revision/default summary, retry/error/loading status, and override badge/reset after Generation Mode and before ad-only options.
- The separately labelled manager dialog contains a kit list, editor, scoped live preview, and persistent status/action footer. Its header and footer remain visible; its body is the dialog's only scroll owner.
- At 1280px the selector stays compact and the dialog uses list plus editor/preview columns. At 768px and 375px both stack without horizontal overflow; 375px uses a 12px viewport inset and full-width actions.
- Loading, empty, ready/default, ready/alternate, disabled, dirty override, stale/deleted, validation, failure, and conflict states remain distinguishable without changing the surrounding chrome.

### Motion, keyboard, and WCAG
- Brand Kit motion is limited to opacity and transform, lasts at most 150ms, and is disabled under `prefers-reduced-motion`.
- Opening the dialog records the opener and scroll position, makes the background inert, locks page scroll, and moves focus into a trapped tab sequence. Escape closes unless discard confirmation is active; close restores scroll and focus.
- Every input has a visible label; field errors are programmatically associated; asynchronous status uses a live region; critical actions use text labels. Text/background pairs meet WCAG AA 4.5:1 and focus remains visibly indicated.
- Brand Kit UI has zero accepted design, functional, accessibility, responsive, or interaction debt. A deviation must be fixed or explicitly revise this contract before release.
