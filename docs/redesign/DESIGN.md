# Workout builder: the redesign as built

This answers the brief in [SPEC.md](SPEC.md). The design is implemented directly in `web/` (`index.html`, `css/styles.css`, the markup in `js/app.js`), so the app itself is the reference. This file records the decisions, tokens and component rules behind it. The owner's answers in SPEC §11: a star-jump logo, palette C ("mono + orange"), settings that fold away on phones, tablet layouts only for the key screens.

## 1. Direction

Calm, athletic and easy to read at a glance. Neutral greys carry everything; the only colour is orange, which means **plyometrics / power** (plyo tags and bars, the Auto and Fill buttons, the plyo follow-along state, highlights in the drawings). Strength is near-black, warm-up and cool-down are mid grey. A training partner in the drawings is the one blue. One typeface (Inter) in weights 400 to 800, no condensed or display faces, so text stays legible on a phone at arm's length.

## 2. Tokens

All colours and key sizes are custom properties on `:root`. Dark mode overrides the colours under `@media (prefers-color-scheme: dark)` (for `:root:not([data-theme="light"])`) and again under `:root[data-theme="dark"]`. Print forces the light palette.

### Colour

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | `#F4F5F7` | `#0E1013` | Page, drawing tiles, sheets |
| `--surface` | `#FFFFFF` | `#16191D` | Cards, lists, inputs |
| `--surface-2` | `#ECEEF1` | `#1E2227` | Hover, chips, step numbers, meters |
| `--ink` | `#15181C` | `#ECEEF0` | Text, selected segments, near-side limbs |
| `--muted` | `#59616A` | `#9CA4AD` | Secondary text, equipment in drawings |
| `--line` | `#DFE2E6` | `#262B31` | Hairlines, button borders |
| `--line-strong` | `#868E97` | `#646C75` | Input borders, combo tags (3:1 on surface) |
| `--strength` | `#2E343B` | `#D9DDE2` | Strength bars, primary buttons |
| `--on-strength` | `#FFFFFF` | `#0E1013` | Text on `--strength` |
| `--strength-soft` | `#E9EBEE` | `#23272C` | Selected mode card, selected picker row |
| `--jump` | `#E8620F` | `#FF8A3D` | Plyometrics: tags, bars, plyo state, logo head |
| `--jump-ink` | `#2B0F00` | `#2B0F00` | Text on `--jump` |
| `--soft` | `#8A929B` | `#5F6771` | Warm-up / cool-down in the timeline, rest bar |
| `--focus` | `#2E343B` | `#D9DDE2` | Focus ring (3px, offset 2px) |
| `--danger` | `#B3261E` | `#F2B8B5` | Remove / delete, errors, "not finished" |
| `--star` | `#B4470A` | `#FF8A3D` | Star ratings |
| `--partner` | `#3D6FB6` | `#86AAE6` | Partner figure in drawings |
| `--fig-far`, `--fig2-far` | `#A0A8B0`, `#A9C0E3` | `#5E6770`, `#3A5680` | Far-side limbs (person, partner) |
| `--prop-fill`, `--arrow`, `--floor` | `#E7EAEE`, `#C2510F`, `#E3E6EA` | `#252A30`, `#FF8A3D`, `#1C2025` | Equipment fill, arrows, floor band |
| `--shadow`, `--shadow-lg`, `--scrim` | soft two-layer, 12/40 drop, 50% black | none, 60% black drop, 60% black | Cards, dialogs, backdrops |

Contrast (checked with a script against WCAG 2.x): every text pair is at least 4.5:1 in both themes, and controls, inputs, focus and the timeline colours are at least 3:1. The one exception is `--fig-far` on `--bg` (2.2:1 in light), which belongs to the fixed drawing style. Colour is never the only signal: plyo moves carry a "Plyo" tag, plyo bars in the timeline are taller, and the follow-along plyo state adds a text badge.

### Type

Inter 4.001 (variable, weights 100-900, Latin subset, 73 KB WOFF2, OFL), `--font`, with system fallbacks including Tahoma. Numbers that change (clocks, steppers, counts) use `font-variant-numeric: tabular-nums`.

| Style | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| Clock | `clamp(104px, 34vw, 240px)` / .9 | 700 | -.05em | Follow-along countdown and short prescriptions |
| Clock long / extra long | `clamp(56px,15vw,128px)` / `clamp(34px,9vw,72px)` | 700 | -.035 / -.025em | Prescriptions over 5 / 14 characters |
| Move name, follow-along | `clamp(30px, 8.5vw, 60px)` / 1.05 | 800 | -.03em | |
| Big number | 44px / 1.05 | 700 | -.03em | Minutes of hard work |
| `--fs-2xl` | 32px | 700 | | (reserve) |
| `--fs-xl` | 24px / 1.2 | 700 | -.015em | Section headings, dialog and picker titles |
| `--fs-lg` | 20px | 700 | | Settings heading, template status |
| `--fs-md` | 17px / 1.3 | 600 | | Move names in lists, primary buttons |
| `--fs-base` | 16px / 1.5 | 400 | | Body text (never smaller on phones) |
| `--fs-sm` | 14px | 400-600 | | Meta lines, notes, buttons, labels |
| `--fs-xs` | 13px | 400-700 | | Hints, legends, captions; uppercase eyebrows at .06em |

### Spacing, shape, motion, layers

- Spacing: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 20, `--s6` 24, `--s7` 32, `--s8` 48 px.
- Radii: `--r-sm` 8 (buttons, inputs), `--r` 12 (larger buttons, cards inside cards), `--r-lg` 16 (cards, sheets), `--r-pill` 999 (chips).
- Borders: 1px hairlines, 1.5px on controls.
- Targets: `--tap` is 40px with a mouse and 44px on touch screens (`pointer: coarse`); follow-along buttons are 76px.
- Motion: `--t-fast` .12s (colours), `--t` .2s with `--ease` `cubic-bezier(.2,.7,.2,1)` (chevrons, bars). Everything is switched off under `prefers-reduced-motion`.
- Layers: header `--z-top` 5, follow-along `--z-follow` 10; dialogs use the top layer.

## 3. Layout

| Range | Grid | Notes |
|---|---|---|
| Phone, under 600 | One column, 16px gutters, max 760 | Order: header, settings card, saved, overview, workout. Settings fold to a summary line after Build. Build button sticks to the bottom of the settings card. Header scrolls away. |
| Tablet, 600-1023 | One centred column, max 760 | Same as phone with wider cards; template header actions on one line; picker is a bottom sheet (92dvh). |
| Laptop, 1024-1279 | Sidebar 300px + one column (max 880) | Sidebar sticky under the 56px header, scrolls on its own, Build pinned at its foot. Overview cards in an auto-fit grid above the workout. |
| Wide, 1280 and up | Sidebar 320 / workout (max 880, centred) / rail 340 | Rail sticky and scrolls on its own. From 1600: 340 / workout / 380. Whole app max 1760px, so 1920 screens get margins, not stretched rows. |

Text measure: notes and steps stop at about 42-60em. Lists (`.list`) are size containers: under 620px rows use two lines and icon-only buttons; from 620px everything sits on one line.

## 4. Components

All class names, ids and data attributes from SPEC §8 still exist with the same roles. New hooks are listed in the last column.

| Component | Spec | New hooks |
|---|---|---|
| Header | 56px, logo 30px + "Workout builder" 18/700. Sticky from 600px. | `.top`, `.brand`, `.logo` |
| Settings | Groups: How to build it (stacked cards with a one-line description), blocks (6 equal tiles), level (2×2), "Mix it up" group (equal-width tiles, 2 columns when 4 options), equipment chips (pill, tick when selected) with Select all as a link. Labels are 14/600 with a 13px muted hint below. | `#setup`, `.setuphead`, `#setupSum`, `#setupToggle`, `#setupBody`, `.setupfoot`, `.seg.cards / .nums / .fill / .chips`, `.group`, `.grouprow` |
| Empty start | Centred logo 56px, "Build a full-body workout", the old lede. | `#empty` |
| Time card | Eyebrow "Hard work", 44px minutes, sentence with warm-up / cool-down / total, timeline strip (40px; bars at 35 / 65 / 100% height for warm, strength, plyo), legend, summary line. | `.card.timebox`, `.eyebrow`, `.sub` |
| Actions | Start workout full width 56px (play icon); New workout / Print as a pair. | `.actions .go` |
| Save form | Card; name field full width, Save (ink) and Save draft (outline) below. | `.card` around `.saveform` |
| What you'll need | Card with a checklist; ticked items fade and strike through. | `.card > .gear` |
| Section | Heading 24/700 with a muted fact beside it (rounds, number of moves), note 14px, list card. | `.sechead`, `.secmeta`, `.sec.k-warm / k-main / k-course / k-grip / k-cool` |
| Move row | Name 17/600 + meta 14. Tags (12/600, 6px radius; Plyo and Sprint orange, Combo / Slow + fast / Partner outlined). Swap and Choose: 36px (44 touch) outlined buttons with icons, icon-only under 620px. 4px orange bar on plyo rows. Chevron rotates when open. | `details.mv`, `.rfoot`, `.rtags`, `.racts` |
| Move opened | Drawing tiles (bg, 1px line, 12 radius, caption 13/500), numbered steps with 22px number discs, "CUE" / "AVOID" eyebrows (avoid in red). | `.how .cue`, `.how .avoid` |
| Template header | Card: "17 of 22 slots empty" (20/700), 6px fill meter, then Fill the rest (orange outline, bolt), Start, New template, Print. | `.thead`, `.meter`, `.fillrest` |
| Template block toolbar | Joined stepper (− value +), Rest select, block up / down / remove (bin; icon-only on phones). Phones: two lines (rounds + move/remove, then rest). | `.tround`, `.tsel` |
| Template rows | Second line on narrow lists with up / down / remove (remove 12px apart, red). Warm-up and cool-down rows have only remove, kept on the first line. | `.tctl`, `.tctl.inl` |
| Empty slot | Diagonal stripes, "Empty slot" + category, Choose and Auto (orange outline with bolt). | `.tslot`, `.tbtn.auto` |
| Add / insert | Dashed full-width "+ Exercise"; between sections a dashed rule with pill buttons. | `.addrow`, `.tins` |
| Picker | Phone full screen; tablet bottom sheet; laptop centred dialog (max 1120 × 86dvh) with the list (max 500px) left and the detail right. Search with icon. Chip rows per group; sideways scrolling on narrow screens. Rows 72px with a 64×60 drawing thumbnail; "in use" badge; selected row tinted with a 3px bar. Detail: back link (narrow only), name 24/700, tags + meta, drawings, numbered steps, cue, level buttons (2×2, 1×4 from 600px) with reps, pinned "Use this" (52px). | `#pSide`, `.pmain`, `.psearchwrap`, `.indetail`, `.psteps`, `.pusebar`, `.pempty` |
| Follow-along | Top: "Step n of m" + 44px close, 6px progress. Head: section (17px muted), plyo badge (orange pill with bolt), name. Clock (see type). 12px draining bar for every countdown (orange on plyo, grey on rest). Switch-sides pill. Cue 18-24px. "How to do it" disclosure. Bottom: 76px bar, Back / primary / Next (Back and Next disabled at the ends; the primary turns orange on plyo). Landscape (640px+) and laptop: name, cue and how-to left, clock right; short landscape scales the clock by height. Finished: 72px orange check, "Nice work.", time, Evaluate. | `.fhead`, `.fplyo`, `.fclock`, `.fbar`, `#fbarfill`, `.fswitch`, `.fhow`, `.fdone`, `.fdoneic`; `.isrest`, `.isdone`, `#follow.paused` |
| Saved workouts | Top of the rail, collapsed card (bookmark icon, count). Drafts first with a "DRAFT" badge. Rows: name 16/600, meta 14, stars; Open (ink), Evaluate (star), Print and Delete as icons, Delete red and pushed right. List scrolls inside (max 60vh). | `.badge`, `.isdraft`, `.rowbtns .open` |
| Evaluations | Card per evaluation: date + stars (20px), time vs estimate, score chips, comment with a left rule, "not finished" in red. | `.evhead`, `.scores`, `.unfinished` |
| Evaluation dialog | Phone full screen, else 600px. Date and minutes side by side, "I finished" as a 44px bordered row, every choice group as equal-width 44px segments (stars with an icon), low / high descriptions at the ends, pinned Cancel / Save evaluation (1:2). | `.dlgbar` |
| Print | Unchanged structure, Inter, always black on white. | |

States everywhere: hover darkens borders and fills `--surface-2`; pressed moves 1px down; selected is `--ink` fill with `--bg` text (mode cards: `--strength-soft` with a 2px `--strength` outline); disabled at 30-40% opacity; focus is a 3px `--focus` ring offset 2px (inset inside lists). Errors use `--danger` text under the field.

## 5. Icons and logo

One sprite of `<symbol>`s at the top of `index.html`, drawn on a 24px grid with 2px round strokes in `currentColor` (`#i-play` and `#i-star` are filled): logo, swap, choose, chev, x, up, down, plus, trash, play, pause, print, redo, sliders, clock, check, star, back, next, bolt, save, search, gear, edit. `ic(name)` in `app.js` inserts one. Icon-only buttons keep their `aria-label`.

The logo is a jumping jack in mid-air on a rounded ink tile with the head in `--jump` (`#i-logo`, styled through the tokens, so it inverts in dark mode). The favicon is the same drawing as a data URI with fixed colours.

## 6. New behaviour

- `fold()` collapses the settings below 1024px after Build and on load when a workout exists; `syncSum()` keeps the summary line current. The toggle is hidden from 1024px.
- `render()` fills `#brief` (overview) and `#plan` (workout) separately; `#empty` shows until something is built.
- `countdown(secs, done, total)` drains `#fbarfill`; `togglePause()` sets `#follow.paused`.
- From 1024px the picker shows the detail beside the list and keeps it while searching or filtering.
- Swap and Auto show their "No other options" / "Nothing fits" text even when their label is hidden (class `says`).

Not done: confirmation prompts (replace a template, remove a block, delete) still use the browser's `confirm()`; a styled dialog would need a promise-based replacement.
