# Great Family — implemented design

## Overview

This single-page interface gives the Great Family community a focused ETH/GFAM swap flow. The supplied “Hello. We are the Great Family.” line informs a warm, restrained identity: cream canvas, deep green actions, a simple family mark and a CSS illustration of three people. These visual choices are implementation assumptions, not a previously approved brand system.

Source of truth: `web/src/styles.css` and the component patterns in `web/src/App.tsx`. The desktop introduction and swap panel form two columns; live market information follows. The swap remains the only filled primary action. This document is under `docs/` because the assignment's explicit path budget prohibits a repository-root `DESIGN.md`.

## Colors

The source uses hex primitives with semantic roles. Reuse the role token, rather than borrowing a primitive whose present value happens to match.

| Role | Implemented token/value | Use |
| --- | --- | --- |
| Page | `--page` → `--neutral-100`, `#f5f4ee` | Canvas |
| Surface | `--surface` → `--neutral-0`, `#ffffff` | Swap panel, selected direction, token badges |
| Input | `--field` → `--neutral-50`, `#fafaf7` | Editable amount surface |
| Text | `--text` → `--neutral-900`, `#243c2d` | Headings, values, labels |
| Secondary text | `--muted` → `--neutral-600`, `#606c60` | Explanations, captions |
| Placeholder | `--placeholder` → `--neutral-400`, `#818a7f` | Large empty amounts |
| Structural line | `--border` → `--neutral-200`, `#e1e3d9` | Noninteractive separators |
| Control boundary | `--control-border`, `#778371` | Amount field, outlined buttons, selected direction, slippage |
| Primary | `--accent` → `--green-700`, `#1f513c` | Primary action, identity |
| Primary hover | `--accent-hover` → `--green-800`, `#153e2c` | Enabled action hover |
| Soft accent | `--accent-soft` → `--green-100`, `#e5edda` | Review summary and secondary hover |
| Decorative accent | `--art` → `--green-200`, `#d9ecb1` | Family mark and illustration |
| Focus | `--focus`, `#235dbe` | 3px keyboard outline with 4px offset |
| Warning | `--warning-bg` `#fff3d4`, `--warning-text` `#795414` | Wrong network / read failures |
| Error | `--error-bg` `#fcf0ea`, `--error-text` `#923e2c` | Persistent action errors |

The readonly receive field uses `#f1f4eb`; the ETH symbol uses `#52628f` on `#edf0f7`; the third decorative person uses `#a9be8e`. These local decorative colors are not alternate action/status colors. This is an intentional light interface (`color-scheme: light`) with no theme switch. The focus treatment retains system `Highlight` in forced colors.

Measured rendered pairs and limitations are in `docs/evidence/contrast-measurements.json` and `docs/VALIDATION.md`. Do not infer contrast from unrelated token pairs or treat a hidden/nonfocused outline as the focused state.

## Typography

The local Latin Manrope variable WOFF2 comes from `@fontsource-variable/manrope`, supports weights 200–800 and is declared in `styles.css` with `font-display: swap`. The UI uses weights 400–800, disables synthetic faces, and falls back to Manrope/system sans. No external font request is needed. Font loading was checked in the browser.

- Display heading: 600 weight, `clamp(2.9rem, 4.7vw, 4.2rem)`, 1.09 line height, −0.065em tracking; responsive rules adjust the size to the available column.
- Panel heading: 1.3rem, 700 weight, −0.04em; 1.15rem at the narrow breakpoint. Section heading: 1.55rem, 600 weight, −0.035em; 1.3rem on compact layouts.
- Descriptive body: `--text-body: .9375rem` (15px), line height 1.6, capped at 37ch in the introduction and 75ch in expanded deployment prose.
- UI roles: `--text-small: .8125rem` (13px), `--text-caption: .75rem` (12px); auxiliary labels/captions use 10–11px. These compact captions are secondary to the 12–16px transaction descriptions and controls.
- Editable amount: 1.9rem desktop, 1.6rem narrow; slippage input remains 16px. Financial amounts, rates and addresses use tabular figures. Exact unrounded amounts remain available in the confirmation text/titles; only display summaries are abbreviated.

Headings balance, prose wraps naturally, long hashes wrap anywhere, and source identifiers use the system monospace stack. Useful text stays selectable. Decorative text/graphics have no reading-order role.

## Layout

`.page-width` is capped at 1180px with 96px total desktop gutters. `.hero-grid` uses `minmax(0,1fr)` and a 380–460px swap column with an 80px gap. Panel padding is 28px, field padding 16px; groups commonly use 20–32px separation and 6–12px internal gaps.

At 68rem, total gutters become 64px and the hero gap becomes 40px. At 53rem, gutters become 48px, navigation collapses, the introduction centers, the decorative illustration hides, and the swap panel sits in a single column capped at 480px. The information grid becomes two columns. At 34rem, total gutters become 32px and panel padding becomes 20px; the header wallet group stacks, details wrap and the footer adapts. Main content remains in normal flow, with no sticky action covering it.

Observed at 1440, 768, 390 and 320 CSS pixels: no horizontal overflow; form, error, quote, live read and wallet sections remain reachable. Browser-native 200% zoom, text enlargement, RTL/localization and physical-device checks were not performed.

## Elevation & Depth

The page is mostly flat. `.swap-panel` uses a 1px pale outline plus `0 4px 8px #243c2d03, 0 15px 45px #243c2d07`. Selected direction uses a small shadow and a control-contrast inset outline. Separators structure the information section. There are no modals, overlays, tooltips hiding essential instructions, gradients behind functional text, or fixed transaction controls.

## Shapes

Reusable radii: `--radius-small: 10px`, `--radius-medium: 16px`, `--radius-panel: 26px`. The mobile panel is 24px. Primary buttons are 12px, amount fields 16px (14px narrow), direction group 12px with 9px inner buttons. Token badges and status dots are circular/pill shapes. Family people and elliptical orbits are decorative CSS geometry; icons are inline SVG and inherit `currentColor`.

## Components

`App.tsx` contains these reusable local patterns, not a separately exported component library:

| Pattern | Source API/class | Behavior |
| --- | --- | --- |
| Family identity | `FamilyMark({small})` | Main logo and small token/footer variant; decorative SVG |
| Icons | `Icon({name,size})` | Seven consistently stroked icons; decorative semantics |
| Token identity | `TokenIcon({token})`, `.token-pill` | Native currency or GFAM badge; display only |
| Address | `AddressLink({address,explorer,label})` | Checksum, shortened visible address, full title/accessible name, copy, explorer link |
| Primary action | `.primary.swap-action` | Connect → switch → quote → exact approvals → confirm; one action at a time |
| Direction | `.direction-control` | Native buttons with `aria-pressed`; quote invalidation on change |
| Amount entry | `.amount-box`, real label/input | Decimal keyboard; validation, inline error and focus on invalid field |
| Quote review | `.quote-details`, `.review-copy` | Estimated output, exact minimum, rate, expiry and approval explanation |
| Progress/error | `.transaction-status`, `.error-box` | Polite status, persistent alert, receipt hash link; action stays disabled while pending |
| Information | `.stats-grid`, `.wallet-details` | Live state or explicit unavailable state; refresh control |
| Disclosure | `.deployment-details` | Native `details`/`summary`; contract links, provenance, faucets |

Interactive elements use native semantics and natural tab order, with an initial skip link and visible focus. Connection/network changes return focus to the main action. Submit errors focus the relevant field. Buttons have hover, active, disabled and pending treatments. Amount/direction/slippage changes invalidate reviewed quotes. No modal focus trap is necessary.

Motion is opt-in via `prefers-reduced-motion: no-preference`: a 150ms background/transform transition, 0.96 press scale and a 1-second pending spinner. Reduced motion keeps static text/status feedback. There are no entrance animations or autoplaying media.

## Do's and Don'ts

- Start related content with `.page-width`, existing heading roles and spacing; let narrow layouts wrap before adding fixed widths.
- Use the filled primary style for the next transaction-flow action, outlined/neutral controls for supporting actions, and explicit text for status.
- Keep real labels, native buttons, exact transaction review values and visible errors. Preserve keyboard focus and reduced-motion behavior.
- Use `--control-border` for interactive boundaries; keep `--border` for structure. Measure both default and hover backgrounds when changing either.
- Continue fetching all deployed configuration and ABIs through `config.ts`. Never put a deployment address, rate or invented USD price in a visual component.
- A future related page should reuse the header/identity and layout tokens, expose one clear primary action, and repeat the narrow-width and interaction checks. Do not invent additional themes or animation systems to match a screenshot.

## Attribution

Design review used Jakub Krehel's Better Interface at `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). This implementation-specific document adapts the documentation method from Paul Bakaus's Impeccable at `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0; Copyright 2025 Paul Bakaus). Ethereum UX guidance is adapted from Austin Griffith's ethskills at `06ea4efa08076ff04f6ca4945ef4a2ca881115b0` (MIT). Retained notices/licenses are in `docs/licenses/`; runtime dependency/font notices ship in `dist/THIRD-PARTY-NOTICES.txt`.
