# Workout builder: responsive UI redesign brief

This package is everything needed to redesign the user interface of **Workout builder** without access to its code base. Read this file first; the folders hold the evidence.

| Folder | Contents |
|---|---|
| `screens/` | The current UI, every screen and state, at laptop and phone size, light and dark. `screens/INDEX.md` lists the states. |
| `screens/full-page/` | Whole pages (plan, levels plan, template) top to bottom, and the A4 print sheet. |
| `content/` | Real content: `exercises-sample.json` (typical and extreme exercises), `workouts-sample.json` (a generated, a levels and a template workout), `catalogue-stats.json` (counts, longest strings, lists). |
| `assets/drawings/` | Movement drawings as standalone SVGs (the app draws them in code; see §7). |
| `assets/fonts/` | The fonts the app ships today (Barlow, Barlow Condensed; SIL Open Font License). |
| `reference/` | The current `index.html`, `styles.css`, `app.js`, and `workout-builder.html`: the complete working app in one file. Open it in a browser to try everything (saving needs the local server, so the Save and Saved workouts features are hidden there). |

The screenshots are regenerated with `uv run --with playwright python tools/redesign_package.py`.

---

## 1. The product

A web app that builds full-body functional workouts: strength, plyometrics (jumps and throws), combos, sprints, partner moves, obstacle courses and grip work, matched to the equipment you have. It has 1041 exercises; every one has 3-5 written steps, a cue, often an "avoid", and 2-4 movement drawings.

**Who uses it.** Experienced athletes who train alone or with a partner, at a gym or at home. They judge their own limits; the app isn't a beginner's coach. The owner trains with it several times a week.

**Where it's used.**
- **Planning** (laptop or phone, seated): choose settings, build or put together a workout, swap moves, read instructions, save, print, evaluate afterwards.
- **Training** (phone, often propped up 1-2 m away, sweaty hands, between sets): the follow-along overlay with timers. This is the most important screen on the phone.
- **Print**: some people train from a printed sheet.

**Three ways to build a workout** ("How to build it" at the top):
1. **Generate it**: the app builds the whole workout from the settings.
2. **Generate, levels 1 to 4**: generated, but every block has four moves of rising difficulty (Beginner → Intermediate → Advanced → Beast).
3. **Put it together myself**: an empty template with slots; each slot is filled by hand (**Choose**) or automatically (**Auto**); blocks and moves can be added, removed and reordered. Unfinished templates are saved as **drafts**.

**A workout** = warm-up (5 timed moves) → optional obstacle course (1-2) → 1-6 blocks of 3-4 moves done for 3-4 rounds with set rests → optional grip finisher (2 moves) → cool-down (stretches, 1-3 long "yin" holds, a calm finish). Templates allow any number of blocks (up to 6 main blocks), extra course and grip blocks anywhere, and 1-8 warm-up and cool-down moves.

## 2. Goal of the redesign

1. **Responsive, not scaled.** On a laptop use the whole screen with a real multi-pane layout; on a phone a single column designed for one hand. Don't shrink the laptop design: text must stay readable at every size.
2. **Pixel-perfect, high-resolution design** for every screen and state listed in §5, at the breakpoints in §4, in light and dark.
3. A **calmer, more athletic, more premium** look than today's, which grew feature by feature. The owner likes the current dark mode, the condensed headings and the yellow "plyo" accent; none of it is sacred.
4. **The follow-along overlay readable from 2 m** on a phone, and usable with one thumb.
5. Everything stays as functional as today: no feature or piece of information may be lost (§5 lists what each screen must show).

**Creative freedom:** layout, typography, colour palette, spacing, iconography, the shapes of controls, grouping of settings (e.g. an "Advanced" disclosure), wording of labels (keep meaning). **Fixed:** the features, the content, the movement drawing style (§7; colours may follow new tokens), light and dark themes, the technical constraints (§3).

## 3. Technical constraints (the design must be buildable within these)

- **Plain HTML, CSS and JavaScript**, no framework, no build step beyond inlining into one file. One stylesheet using **CSS custom properties** for all colours and key sizes (`:root` for light, `@media (prefers-color-scheme: dark)` plus `:root[data-theme="dark"]` for dark).
- **No external resources at all**: no CDN, no web fonts from other sites, no remote images. The app also ships as a single offline HTML file. Fonts must be **bundled as WOFF2** with an open licence (OFL or similar) and included in the deliverables; at most two families, ideally the current Barlow + Barlow Condensed or replacements of similar weight.
- **Icons as inline SVG** (provide each as a small, single-colour SVG using `currentColor`), no icon fonts, no raster images. The app has no logo today; one is welcome as SVG.
- **Native elements:** `<dialog>` for modals and the picker sheet, `<details>/<summary>` for expandable rows, `<select>` for the rest preset, `<input type="search|date|number|checkbox|radio">`. Custom styling is fine; replacing them with JS widgets isn't.
- The whole UI is rendered by JavaScript as HTML strings with fixed class names and data attributes (§8). The redesign is implemented by restyling and restructuring that markup, so **name the components** and, where possible, deliver HTML/CSS (or exact specs) for each.
- Performance: a workout page can hold 40+ rows with inline SVG drawings; the picker lists up to 900 moves (rendered 40 at a time). Avoid heavy effects (large blurs, backdrop filters on scrolling content).

## 4. Breakpoints and frames

Design these frames (CSS pixels; deliver images at @2x for laptop/tablet and @3x for phone):

| Name | Frame | Range it must cover | Layout intent |
|---|---|---|---|
| **Phone** | 390 × 844 | 320-599 | One column, thumb-friendly; bottom-anchored primary actions where it helps; picker and dialogs full screen. Check 360 × 740 and 430 × 932. |
| **Tablet** | 820 × 1180 | 600-1023 | One wide column or two columns; picker as a large sheet. One frame per key screen is enough. |
| **Laptop** | 1440 × 900 | 1024 and up | **Full screen.** Suggested: settings in a left sidebar (sticky, scrolls independently) and the workout in the main area; secondary information (what you'll need, time estimate, saved workouts) in a right rail or header band; the picker as a side panel or large centred dialog. Check 1280 × 800 and 1920 × 1080 (the layout should use extra width sensibly, e.g. a wider main area and max line lengths for text, not stretched rows). |
| **Follow-along** | phone portrait, phone landscape (844 × 390), laptop | | Full screen, huge clock and move name, large buttons. |
| **Print** | A4 portrait (and US Letter check) | | Black on white, compact; see `screens/full-page/print-sheet-a4.png`. Restyle optional. |

Define the grid (columns, gutters, margins) per breakpoint, maximum content and line widths, and how each component reflows between breakpoints.

## 5. Screens and states

Each state has current screenshots at `screens/<laptop|phone>-<light|dark>/<state>.png`. "Must show" is the information that has to survive the redesign.

### 5.1 Settings (`01`-`03`)
Must show, in this order of importance:
- **How to build it**: Generate it / Generate, levels 1 to 4 / Put it together myself.
- **Exercise blocks** 1-6 (template: "to start with"). **Level** Beginner / Intermediate / Advanced / Beast (levels mode: sets rest and rounds only; template: "Auto-fill level").
- **Plyometrics** A sprinkle / In every block; **Sprints** None / A few / One per block; **Combo moves** None / A few / One per block / As many as possible. *Hidden in template mode.*
- **Obstacle course** Skip / One / Two; **Who's training** Just me / With a partner; **Grip finisher** Skip / Add one.
- **Equipment you have**: 27 toggle buttons (multi-select) + Select all / Clear all. Labels range from "TRX" to "Barbell, plates and rack" (`content/catalogue-stats.json → equipment`).
- The main button: **Build workout** / **Create template**.
- Settings are remembered between visits. On a laptop they should stay visible next to the workout.

### 5.2 Generated workout (`04`-`09`)
- **Time estimate**: "About 37 min of hard work", plus warm-up and cool-down minutes and the total.
- **Timeline strip**: one bar per set, coloured by type (warm-up/cool-down, strength, plyometrics) with a legend; gaps between blocks.
- Summary ("4 blocks, 3 plyo moves"), **Start workout**, **New workout**, **Print**.
- **Save** (needs the server): name field + Save workout; after saving, "Saved as … · Evaluate it"; after changing a saved workout, "Changed since you saved it as …".
- **What you'll need**: checklist of equipment and setup items (e.g. "Clear 15 m lane"), each with the moves that use it.
- **Sections**: Warm-up, Obstacle course, Block A…F, Grip finisher, Cool-down; each with a short note (rounds and rest, course advice, yin advice).
- **Move rows** (collapsed): name (up to 50 characters, wraps), prescription ("8 each side", "30s", "3 rounds", "40 double-unders + 15 push-ups, x3"), level name in levels mode, tags (**Plyo**, **Combo**, **Slow + fast**, **Partner**, **Sprint**, **Yin**), **Swap** and **Choose** buttons, expand chevron. Plyo moves are marked with a yellow bar today.
- **Move expanded** (`07`): drawings strip (2-4 drawings, each captioned "Step 1" / "Steps 2–3"; some top-view drawings are twice as wide), numbered steps (3-5, up to 268 characters each), **Cue**, **Avoid**.
- Footer safety note.
- Levels mode (`09`): block note "The moves get harder through the block, from level 1 to level 4", each move shows its level.

### 5.3 Template editor (`10`-`13`)
Everything of 5.2, plus:
- Status line "**14 of 18** slots empty" (+ a one-off note after Fill the rest); actions **Fill the rest**, Start, **New template**, Print. Start/Print are disabled when nothing is filled.
- Save form with **Save draft** and **Save workout** (disabled until every slot is filled); label "Draft "…", saved / changed since you saved it".
- Warm-up and cool-down: **Moves** stepper (1-8).
- Block header: **Rounds** stepper (1-6), **Rest** select (four presets, e.g. "Intermediate: 20s / 75s"), move block up / down, **Remove**.
- **Empty slot**: "Empty" + the slot's category (squat, pull, mobility, yin …), **Choose**, **Auto**, move up / down, remove.
- **Filled slot**: the move row of 5.2 (with its level) plus move up / down / remove.
- **+ Exercise** per block; between all blocks and after the warm-up an insert bar **+ Block · + Obstacle course · + Grip block**.

### 5.4 Exercise picker (`14`-`16`)
A sheet opened by **Choose**. Title depends on the slot ("Choose a move", "Choose a warm-up move" …).
- **Search** (names first, then steps).
- Chips: **category** (block slots: Plyo lower, Plyo upper, Squat, Hinge, Lunge, Push, Pull, Core; warm-up: Pulse, Flow, Mobility; cool-down: Stretch, Yin, Calm), **tags** (Sprint, Combo, Partner; block slots only), **level** (Beginner … Beast; not for warm-up/cool-down). The slot's category and the workout level start selected; tapping a selected chip clears it.
- Count ("84 moves", "Nothing fits …" when empty) and the list: thumbnail of the first drawing, name, "Intermediate+ · Dumbbells or kettlebells", "in use" marker, tags. 40 rows at a time, more on scroll / **Show more (n left)**.
- **Detail**: back link, name, tags, all drawings, cue, **level buttons with the reps at each level** ("Advanced · 10 each side"), **Use this**.

### 5.5 Follow-along (`17`-`21`)
A full-screen overlay that walks through every step.
- Top: "Step 12 of 61", close (×); progress bar.
- Step kinds: **timed** (warm-up/cool-down: countdown, "Switch sides halfway"), **set** (big prescription, "Set done"), **timed hold** ("Start 30s timer" → 5 s get-in-position → countdown), **rest** (countdown, "Next up: …", "Skip rest"), **finished** ("Nice work", minutes it took, Evaluate this workout).
- Section label ("Block B, round 2 of 3", "Obstacle course: rest 60 to 90s between runs"); plyo steps add ". Plyo: full effort, every rep" and are highlighted.
- Move name, cue, "How to do it" (expands to drawings + steps).
- Bottom: **Back**, primary (Pause / Resume / Set done / Skip rest / Start 30s timer / Close), **Next**.
- Beeps at 3-2-1 and at "switch sides" (no visual change needed beyond the text). The screen stays awake.

### 5.6 Saved workouts and evaluations (`22`-`25`)
- A collapsible **Saved workouts** box: drafts first ("Draft · changed 1 Oct 2026 · 3 of 18 slots empty"; Open, Delete), then saved workouts ("29 Sept 2026 · Advanced · 3 blocks · 2 evaluations · ★★★★☆ 4.5"; Open, Print, Evaluate, Delete).
- **Your evaluations** on an opened workout: date, stars, minutes and difference to the estimate, "felt too long", "not finished", scores per criterion, comment.
- **Evaluation dialog**: date, actual minutes (pre-filled after a follow-along run), "I finished the whole workout", the length felt (Too short / About right / Too long), stars 1-5, five criteria each 1-5 with low/high descriptions (Difficulty, Enjoyment, Variety, Flow and setup, Fit to my goals), comment, Cancel / Save evaluation.

### 5.7 Other states to design
- Empty start (nothing built), "Nothing saved yet", errors (save failed, couldn't load), "No other options" feedback on Swap, "Nothing fits" on Auto, confirmation prompts (replace an unsaved template, remove a block with moves, delete a saved workout or draft, start with empty slots).
- Focus, hover, pressed, selected, disabled for every control; keyboard focus must be clearly visible.

## 6. Content and numbers to design for

From `content/catalogue-stats.json` (use the real strings in `content/` for mock-ups, not lorem ipsum):
- Exercise names: median 21 characters, longest 50 ("Kettlebell swing, snatch and overhead walk complex").
- Steps: 3-5 per exercise, median about 100 characters, longest 268. Cue up to 170 characters, avoid up to 117.
- Prescriptions: "8", "8 each side", "30s", "20s each side", "3 rounds", "2 lengths", "4 runs", up to "20 swings + 30s each leg, eyes closed".
- Drawings: median 3, up to 4 per exercise; mostly portrait-ish side views, some wide top views.
- A workout: 5 warm-up + 1-2 course + 3-24 block moves + 0-2 grip + 4-6 cool-down rows. Template: up to 6 main blocks × any number of slots.
- Levels: Beginner (rest 30 s between moves / 90 s between rounds, 3 rounds), Intermediate (20/75, 3), Advanced (15/60, 3), Beast (10/60, 4).
- Numbers in the UI: minutes, seconds countdowns (`0:45`, `12`), step counters, star ratings (½ stars shown as rounded).

## 7. Colour meaning, themes and drawings

Current tokens are in `reference/styles.css` (`:root` and the dark overrides):

| Token | Role today |
|---|---|
| `--bg`, `--surface`, `--ink`, `--muted`, `--line` | Page, cards, text, secondary text, hairlines |
| `--strength` | Strength moves, primary accent (teal) |
| `--jump`, `--jump-ink` | Plyometrics (yellow) and text on it |
| `--soft` | Warm-up and cool-down in the timeline |
| `--focus` | Focus ring |
| `--fig-far`, `--fig2-far`, `--prop-fill`, `--arrow`, `--floor` | Drawings: far-side limbs, partner's far side, equipment fill, arrows, floor |

Keep the **semantic split** strength / plyometrics / warm-up-cool-down (it's used in the timeline, tags and follow-along). Deliver the full token set for light and dark with WCAG AA contrast (4.5:1 text, 3:1 large text and controls).

**Drawings** (`assets/drawings/`) are stick figures drawn in code: thick round strokes (torso 12, limbs 7 units), near side in `--ink`, far side in `--fig-far`, a partner in `--strength`, highlighted body parts as a translucent `--jump` glow, arrows in `--arrow`, equipment outlined in `--muted` on `--prop-fill`, labels in small condensed text. They sit on a `--bg` tile with rounded corners and a caption. Design the tile, the caption and the strip layout; the figure itself only changes through the tokens.

## 8. Implementation contract

The JavaScript looks elements up by these hooks. A redesign may restructure markup freely as long as each hook still exists with the same role (or the deliverable states the new name).

- **Element ids**: `build`, `allEq`, `plan`, `saved`, `savedBox`, `start`, `again`, `print`, `saveForm`, `wname`, `saveDraft`, `saveErr`, `evalBtn`; picker `pickDlg`, `pickTitle`, `pQ`, `pChips`, `pBody`, `pClose`, `pMore`, `pBack`, `pUse`, `pLvLab`; follow-along `follow`, `fpos`, `fclose`, `fprog`, `fmain`, `fclock`, `fswitch`, `fprimary`, `fback`, `fskip`, `evalNow`; evaluation `evalDlg`, `evalTitle`, `evalForm`, `evalCancel`, `evalErr`; print `printSheet`; settings labels `l-mode`, `l-time`, `l-level`, `l-plyo`, `l-sp`, `l-cb`, `l-oc`, `l-pt`, `l-grip`, `l-eq`.
- **Settings**: `.seg[data-key="mode|blocks|level|plyo|sprints|combos|course|partner|grip|equip"]` containing `button[data-v]` with `aria-pressed`; equipment has `data-multi`; fields hidden in template mode carry `data-not="template"`.
- **Plan rows**: `details > summary` with `.nm` (name + `small` meta), tags `.tag` / `.tag.cb`, `.jumpbar` on plyo rows, `.swap[data-where]`, `.choose[data-choose]`, `.chev`; expanded `.how` with `.figs > figure (> svg.fg + figcaption)`, `ol`, cue/avoid paragraphs. Sections are `section.sec > h2 + p.note + .list`. Time box `.timebox`, timeline `.strip > span.w|.s|.j|.gap`, `.legend`, `.summary`, `.actions`, `.gear` checklist, `.saveform`, `.saveline`, `.evals`, `.foot`.
- **Template editor**: buttons `button[data-act]` with `data-where`, `data-b`, `data-d`, `data-kind`, `data-at` (acts: `auto`, `fill`, `up`, `down`, `del`, `additem`, `rounds`, `bup`, `bdown`, `bdel`, `addblock`, `warmcount`, `coolcount`), `select[data-act="rest"]`; classes `.tstat`, `.tbar`, `.tmove`, `.tbtn`, `.stepper`, `.tsel`, `.tslot`, `.tctl` (`.tctl.inl`), `.tins`, `.tnone`.
- **Picker**: `.sheet`, `.pwrap`, `.phead`, `.pfilters`, `.psearch`, chips `button[data-cat|data-tag|data-lv][aria-pressed]`, `.pbody`, `.pcount`, `.plist > li > button.prow[data-id]` with `.pthumb`, `.pinuse`, `.pmore`, `.pdetail`, `.ptags`, `.plab`, `.plevels button[data-plv]`, `.puse`.
- **Saved list**: `.savedlist li` with `.nm` and `.rowbtns` buttons `data-open`, `data-print`, `data-eval`, `data-del`, `data-opendraft`, `data-deldraft`; `.del` for destructive buttons; `.stars`.
- **Follow-along**: `#follow.on` when open, `.fmain.isjump` on plyo steps, `.fkind`, `.fname`, `.fbig` (clock), `.fnext`, `.fcue`, `.fbtns`, `.evalnow`.
- **Evaluation dialog**: `.dlg`, `.row2`, `.hint`, `.check`, `fieldset.pick` with radio `label > input + span`, `.crit .scale .seg`, `.ends`.
- **Drawings**: `svg.fg` with classes `fg-limb`, `fg-torso`, `fg-head`, `fg-n1/f1/n2/f2` (near/far, person/partner), `fg-hi`, `fg-ghost`, `fg-eq`, `fg-eqs`, `fg-eqf`, `fg-arr`, `fg-guide`, `fg-strap`, `fg-me`.

## 9. Accessibility and interaction

- Touch targets at least 44 × 44 px on touch screens; spacing so sweaty thumbs don't hit neighbours (Swap/Choose/↑/↓/× on one row is today's weakest spot).
- Visible focus for keyboard users; all icon-only buttons have text labels for screen readers (the app already sets `aria-label`).
- Respect `prefers-reduced-motion`; no motion is needed to understand anything.
- Text sizes: body at least 16 px on phone; follow-along clock and name readable at 2 m.
- Colour is never the only signal (plyo moves also carry a "Plyo" tag).

## 10. Deliverables expected

1. **Frames** for every state in §5 at Phone and Laptop (and Tablet for the key screens: settings + plan, template editor, picker, follow-along), in light and dark, exported as PNG @2x (laptop, tablet) / @3x (phone).
2. **Design tokens** as CSS custom properties: colours (light and dark), font families and the type scale (size / line height / weight / letter spacing per style), spacing scale, radii, border widths, shadows, z-index layers, motion (durations, easings).
3. **Layout spec** per breakpoint: grid, margins, max widths, sticky areas, scroll containers.
4. **Component specs** for every component in §5 and §8, with dimensions, paddings, and all states (default, hover, focus, pressed, selected, disabled, error), and how they reflow.
5. **Icons** (SVG, `currentColor`) and an optional logo (SVG).
6. **Fonts** as WOFF2 with their licence, if they change.
7. Ideally **HTML/CSS** for the components using the class names of §8 (or a mapping table from new names to old hooks).
8. Notes on anything that needs new behaviour (e.g. a sticky bottom bar, collapsible settings groups) so it can be built in plain JavaScript.

## 11. Open questions for the owner (answer before or during design)

- Name and tone: "Workout builder" (current heading); the tab title is "Full-body workout builder". Is a logo wanted?
  - Answer: Logo design yes please
- Keep teal + yellow as the core accents, or open to a new palette?
  - Answer: Open to new palette
- Should the settings collapse after a workout is built (phone), or stay open?
  - Answer: collapse
- Is a tablet layout needed beyond the key screens?
  - Answer: Key screens only
