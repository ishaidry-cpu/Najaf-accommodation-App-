# Design system: Fatemi stone

The visual system of the Faiz-e-Husaini Najaf accommodation app. Tokens live in `src/index.css` (`@theme`),
shared pieces in `src/components/ui.tsx`, the shell in `src/components/Navbar.tsx`.

## The world

Reception staff use this at a desk in a bright office in Najaf, all day, and on a phone while walking the
buildings. So: a light theme, calm surfaces, large enough type, and colour that always means something.

The look comes from the Fatemi masjids: a deep emerald rail (teak doors, the crest's green), a warm sandstone
ground, near-white work surfaces, and gold used the way gilding is used on stone, sparingly and only for the
brand and "you are here". Geometry (the eight-pointed star) appears twice: as the faint lattice at the head of
the rail and as the marker beside the current screen. Nowhere else.

## Colour

Every Tailwind colour family is retuned in `@theme`; use the family names, never hex.

| Family | Meaning | Typical use |
|---|---|---|
| `stone` | Sandstone neutrals | Text, borders, quiet fills. `stone-400` and darker pass 4.5:1 on white. |
| `brand` | Emerald | Rail, primary buttons, selection, links. |
| `gold` | Gilding | Crest rim, current-place marker, starred zaereen. Never a content fill or a warning. |
| `emerald` | Good / settled | Room allotted, vacant and ready, sent, approved, done. |
| `amber` | Waiting / look here | Departing, pending, room changed, needs a room, warnings. |
| `rose` | Problem | Errors, conflicts, destructive actions. (`red` maps to the same scale.) |
| `blue` | Arriving / information | New arrivals, informational notes. (`sky`, `cyan`, `indigo` map here.) |
| `purple` | Special handling | Same-day turnover. (`violet`, `fuchsia` map here.) |
| `orange` | Late / overdue | Rare. |

Rules:
- Surfaces: page ground is `bg-canvas`; cards are `bg-white`; an inset inside a card is `bg-stone-50`. `white`
  is a warm near-white, so `bg-white` and `text-white` are both correct to use.
- One meaning per colour. A neutral action is never amber or purple; a person or a room that is simply
  "occupied" is neutral or emerald, not purple.
- Text on a tinted chip uses the 700 or 800 step of the same family on its 50 step.
- Body text is `stone-900`/`stone-800`; secondary text `stone-600`; meta text `stone-500`. `stone-400` is for
  placeholders and icons only. Never lighter than `stone-400` for anything that must be read.

## Type

- UI face: Hanken Grotesk (`font-sans`). Display face: Reem Kufi (`font-display` or the `type-display` class),
  used only for the page title, large figures (KPI numbers, room numbers on cards) and the wordmark.
- Fixed scale, in px: page title 34 (28 on phones) · section title 18 · card or group title 15 or 16 · body 14 ·
  dense body 13 · small 12. **12px is the floor.** 11px is allowed only inside room-timeline cells and count
  badges. (A stylesheet rule already lifts older `text-[9px]`/`text-[10px]`/`text-[11px]` classes; new code
  should not use them.)
- Weights: 400 body, 500 controls and labels, 600 titles and emphasis. `font-bold` only for a key value in a
  row (room number, ITS). No `font-black`, no `font-extrabold` on screen.
- Sentence case everywhere on screen. No uppercase labels, no letter-spaced labels. (Printed slips keep theirs.)
- Numbers that line up (ITS, rooms, dates, counts) get `tabular-nums`.
- Dates read `28 Nov` or `28 Nov 2026`, times `11:00 AM`, where the code formats them for display.

## Shape, depth, spacing

- Radius: cards `rounded-2xl`, inset panels `rounded-xl`, controls `rounded-lg`, chips `rounded-full`.
- Depth: cards carry `border-stone-200` and `shadow-xs`. Menus and pop-overs `shadow-xl`, dialogs `shadow-2xl`.
  Nothing else has a shadow.
- **One level of card.** Inside a card, separate with a divider (`border-t border-stone-200`), spacing, or a
  `bg-stone-50` panel. Never a bordered box inside a bordered box inside a card.
- Spacing: sections 24px apart (`space-y-6`), card padding 20–24px (16px on phones), groups inside a card 16px,
  related items 8px. More space above a heading than below it.
- Touch: anything tappable is at least 40px tall on phones (32px is acceptable for compact buttons in dense
  desktop rows).

## Components (import from `./ui`)

- **Buttons** `btn.primary | secondary | ghost` (40px) and `btnSm.primary | secondary | ghost | danger` (32px),
  `btnDanger` for a destructive confirm. One primary per region. Icons are lucide, 16px, before the label.
  Labels name the action in sentence case ("Allot family", "Switch room").
- **Chips** `chip('ok' | 'wait' | 'bad' | 'info' | 'special' | 'gold' | 'neutral' | 'brand')`. One shape for
  every status. Use a chip for state, not for plain facts: dates, counts and names are text.
- **Cards and panels** `card`, `panel`.
- **Fields** `field` (40px), `fieldSm` (36px), `fieldLabel`. Labels sit above the field. Borders are
  `stone-300`. Focus rings come from the stylesheet; do not add custom ones.
- **Headers** `PageHeader` once per screen; `SectionHeader` for blocks inside it.
- **Menus** `Dropdown`, `MenuItem`, `MenuDivider`, `MenuHeading`.
- **Dialogs** `modalScrim`, `modalCard` (add a `max-w-*`), `modalHeader`, `modalTitle`, `modalClose`,
  `modalFooter`. Title top-left, close top-right, actions bottom-right with the primary last.
- **Tables** header row `bg-stone-50 text-xs font-semibold text-stone-600`; body rows at least 44px, divided by
  `border-stone-200`, `hover:bg-stone-50`; the key column `font-semibold text-stone-950`; no zebra.
- **Empty states** say what will appear here and how to make it appear, in one or two lines, with the action.

## Shell

- Desktop (1024px and wider): emerald rail on the left, 236px, collapsible to 68px. Three groups: Reception
  (Overview, Zaereen, Rooms), Planning (AI Planner, Approvals, B→A shifts), NKERP (NKERP sync, Najaf emails).
  The foot of the rail holds Sync to NKERP, Pull from NKERP, Print and export, and the account switch.
- Phones and tablets: emerald top bar (crest, Sync, menu) and a bottom bar with Overview, Zaereen, Rooms,
  Planner and More. The page leaves room for the rail through the `--rail-w` variable.

## Motion

150–250ms, ease-out, only in answer to an action: menus and dialogs opening, a tab settling, the marker
gliding to the chosen screen, the gold thread while a sync or email run works. `prefers-reduced-motion` turns
it off.

## Printed slips

`ReceptionDailySlipModal` and `AccountsRequestSlipModal` contain printed documents. Their printable areas keep
their own compact sizes, capitals and layout; only the on-screen chrome around them follows this system.
