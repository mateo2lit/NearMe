# NearMe — App Design Spec

**Date:** 2026-04-16
**Status:** Approved (pending user final review)
**Scope:** Comprehensive visual & interaction redesign. Approach A+B: visual-system refinement plus rows-based discovery.

---

## Goals

1. Make the app easier to scan — more events per screen without losing appeal.
2. Clarify the tag system so users filter by dimensions that match how they think (when / who / vibe / cost).
3. Reduce visual noise — replace the current rainbow palette with one accent + semantic colors.
4. Turn Discover from a flat feed into a discovery experience (rows above a fallback feed).
5. Collapse Search into Discover via a search pill — free up tab bar slot.
6. Give every event context a "View original" link back to the source.

## Non-goals

- Swipe-deck card UX (wrong mode for event discovery).
- Backend changes beyond what's already in the data model.
- Auth/cloud-synced saves (future concern).
- Category taxonomy changes — categories stay as-is.

---

## 1. Information architecture

**Tabs (5 → 4):** Discover · Map · Saved · Settings.

Search collapses into Discover via a persistent search pill in the header. Rationale: Discover and Search both answer "find events"; two tabs forces users to guess mode.

**Tag taxonomy — flat → 4 dimensions.** Filter sheet groups by question:

| Dimension | Question | Tags |
|---|---|---|
| **When** | What time? | Tonight, Tomorrow, This Weekend, Late Night, Daytime |
| **Who** | Who's it for? | 21+, 18+, All Ages, Singles, Family |
| **Vibe** | What's the energy? | Date Night, Active, Outdoor, Chill, Live Music |
| **Cost** | How much? | Free, Under $20, Ticketed |

Tags removed (redundant with category): `food` (category already covers), standalone `live-music` kept as a vibe tag but `music` category is separate.

**Category stays** as a coarse lane filter — the noun. Tags are adjectives.

**"When" becomes a first-class primary control** — segmented control directly under header on Discover and Map, not buried in filters.

**When presets:** Tonight (now → 3am), Tomorrow, This Weekend (Sat/Sun), Next 7 Days, Pick a date.

## 2. Visual system

**Color — one accent, semantic rest.**

| Token | Role | Value |
|---|---|---|
| `accent` | Selected, CTAs, active | `#7c6cf0` |
| `success` | Free, chill, available | `#2ed8a3` |
| `warm` | Price, soon | `#ffb347` |
| `hot` | Saved, packed, urgent | `#ff6b6b` |
| `text` / `muted` / `border` | Neutrals | unchanged |

**Category colors stay** but usage becomes restrained: a 4px glyph/dot on cards, not a full pill background over images.

**Tags become monochrome** — muted when on a card, accent when selected in filter. No per-tag colors.

**Surface levels (3 max):**
- L0 `#0f0f1a` (screen bg)
- L1 `#1a1a2e` (cards)
- L2 `#222240` (elevated / inputs inside cards) — lock `cardAlt` usage here

**Type scale (6 steps):**
- Display 28 / weight 800 / tracking −0.5 (screen titles)
- Title 20 / 800 / −0.3 (card titles, detail title is 28)
- Body 15 / 500 (default)
- Meta 13 / 600 (rows)
- Micro 11 / 700 / tracking +0.5 (labels, tag rows, section headers)
- Numeric: tabular-lining variant (times, prices, distance)

**Radius:** `sm 10`, `md 16`, `lg 24`, `pill 999`. Drop `xl 32`.

**Spacing:** keep existing 4/8/16/24/32 scale.

**Elevation:** flatten. Remove `shadowColor: COLORS.accent` glow on cards. Replace with subtle border + near-black shadow (opacity 0.2, radius 8). Dark-theme depth should come from surface tone, not bloom.

## 3. Discover screen

**Structure top-to-bottom:**

1. **Header:** "NearMe · Boca Raton ▾" + search pill + settings glyph. Tap city → location picker.
2. **"When" segmented control** — sticky on scroll. Options: Tonight · Tomorrow · Weekend · Week · Pick.
3. **Active filters row** — tappable line: "Category · Vibe · Free [3]". Tap opens filter sheet. Only visible if any filters active.
4. **Discovery rows** (data-driven, hidden if <3 events match):
   - ✨ **Picked for you** — uses onboarding.goals scoring (existing logic)
   - 🔥 **Happening now** — starts within next 2h
   - 🎟 **Free tonight** — `is_free && same_day`
   - 📍 **Within 1 mile** — `distance < 1`
   - 🆕 **New this week** — added to db in last 7 days
   - 📅 **This weekend** — Sat/Sun events (only shown Mon–Fri)
5. **Divider:** `── All events ──`
6. **Flat feed** — full-width cards, fallback browse.

**Row rules:**
- Max 4 rows visible at a time — prioritize in order: Picked for you → Happening now → Free tonight → Within 1 mile → New this week → This weekend.
- Each row has 3–8 hero-variant cards.
- Empty rows hide, never render empty carousels.

**Search pill** in header opens a search overlay (current Search screen content moves here as a modal).

## 4. Card design

Two variants share tokens, differ in density.

### Hero card (160w × 220h, used in row carousels)

```
┌──────────────────┐
│     [image]      │   160w × 140h, top radius only
│  🎵              │   Category glyph top-left (white, 16px, subtle shadow)
├──────────────────┤
│  FRI · 9:00 PM   │   Micro, accent color
│  Karaoke Night   │   Title 15/700, max 2 lines
│  Dusty's · 0.4mi │   Meta 12, muted
│  FREE            │   Success chip, only if applicable
└──────────────────┘
```

### Full card (full-width, flat feed)

```
┌─────────────────────────────────────┐
│            [image 160h]          ❤ │   Save button 28×28, top-right
├─────────────────────────────────────┤
│  FRI, APR 17 · 9:00 PM · 0.4 mi     │   Meta row
│  Karaoke Night at Dusty's            │   Title 18/700
│  🎵 Nightlife                        │   Category row (icon + label, color)
│                                      │
│  Date Night · Live Music · 21+       │   Tags inline, bullet separators
│                             FREE     │   Cost chip right-aligned
└─────────────────────────────────────┘
```

**Changes from current `FeedCard`:**

- Image 200h → 160h → 2.5 cards visible per screen.
- Title below image, not overlaid — removes text-shadow fight with image.
- Category as a small row (icon + label + category color), not a filled pill overlay.
- Tags inline text with `·` separators — no colored pills per tag.
- Single meta row replaces dateBlock + detailsCol + priceBlock split.
- Remove recurrence badge from card (moves to detail).
- Remove live busyness chip from card (moves to detail).
- Save button visual size 40×40 → 28×28, top-right only (not stacked with other badges). Hit slop extends tappable area to 44×44 for accessibility.

## 5. Event detail

**Top-to-bottom:**

1. **Floating header** (back · save · share) over hero image.
2. **Hero image 300h** with gradient → title overlaid (single focal element works here).
3. **Meta row under title:** category glyph + label + one "Who" dimension tag if present (e.g. "🎵 Nightlife · 21+"). If no Who tag, show category alone.
4. **Three parallel blocks — the three primary questions:**
   - 📅 **When** — day, full time range, "repeats weekly" if recurring.
   - 📍 **Where** — venue name, address, distance. Static map preview 120h below, tap to expand to full map sheet.
   - 💵 **Cost** — Free / $15 / $15–$40 / "Tickets from $X".
5. **About** section — description, body text, line-height 1.5.
6. **Tags** section — inline tappable text. Tap a tag → back to Discover with that filter applied.
7. **Vibe tonight** — only if busyness known. Dot + text: "🟢 Chill — 30% capacity".
8. **Similar nearby** — horizontal carousel of 3 hero cards. Predicate: same category OR shared ≥2 tags, within radius.
9. **Sticky bottom action bar:** Directions · Get Tickets (only if `ticket_url`) — two primary actions.
10. **View original link** (see §9).

**Map preview:** static tile, not live MapView (render cost). Tap → bottom sheet with full interactive map centered on the event.

**Removed from detail:** any ambiguous source/metadata block buried in middle sections — moved to the View original link at bottom.

## 6. Map tab

**Layout:**

1. **Header:** city picker + search pill (same component as Discover).
2. **Full-screen map** (dark custom style, unchanged).
3. **Clusters at zoom-out:** count bubbles (⓷, ⓹) instead of overlapping pins. Tap → zoom to cluster. Use `react-native-map-clustering`.
4. **Pins at zoom-in:** 28px circle, white category glyph, category color border. No more plain `pinColor` dots.
5. **Selected pin:** ring + `scale(1.15)`, 150ms ease-out.
6. **Floating "When" chip row** (glass bg, 80% opacity over map) — sticky above bottom carousel.
7. **Bottom horizontal carousel** of events visible in viewport (hero card variant). Pan map → carousel updates. Swipe card → pin selects + map pans.
8. **Recenter button** bottom-right (unchanged).

**Removed:** custom location marker when `showsUserLocation` is available; single selected-event card (replaced by carousel).

**Shared state with Discover:** "When" filter selection is shared — change on Map → changes Discover and vice versa.

## 7. Saved

**Layout:**

1. **Header:** "Saved" + count badge.
2. **Segmented control:** All · Upcoming · Past.
3. **Sections (Upcoming mode default):**
   - `THIS WEEK` (today → Sunday)
   - `NEXT WEEK` (Mon → following Sun)
   - `LATER`
   - `ANYTIME` (undated/recurring, only if any)
   - `PAST` — collapsed by default, tappable row showing count.

**Card style** — current compact horizontal card with tweaks:
- Day-of-week tag (FRI, SAT) top-right of card body.
- 3px accent-colored left border if event starts within 24h.
- Tap card → detail. `heart-dislike` button → replaced by chevron-right.
- Remove/Share actions revealed via swipe-left OR long-press (iOS convention).

**Empty state copy:**
*"Tap the heart on events you want to remember. They'll show up here, grouped by date."*
(Current "swipe right" copy is wrong — no swipe gesture exists.)

## 8. Filters, empty states, motion, microcopy

### Filter sheet

Bottom sheet, opened via active-filters row on Discover.

Groups: Category (3-per-row pills) · Vibe · Who · Cost · Distance (slider 1–25mi).

Sticky CTA at bottom: `[ Show 47 events ]` with live count as filters change. Reset link in header appears only when filters are active.

### Empty states (1 component, 3 variants)

- **No events nearby** (icon: radio) — *"We couldn't find events in this area. Try widening your radius in settings."* [Widen to 10mi →]
- **No matches for filters** — *"No events match these filters. Try removing one."* [Clear filters] or [Remove 'Free']
- **No saved events** — *"Save events by tapping the heart. They'll appear here, grouped by date."* (no CTA)

Each state has a single specific CTA that fixes the condition. No generic "Refresh."

### Motion (200–250ms, ease-out, subtle)

| Interaction | Motion |
|---|---|
| Card press | scale 0.98 |
| Heart save | scale pop 0.8 → 1.15 → 1, color fade, haptic light |
| Filter chip toggle | background color transition, 150ms |
| Row carousel scroll | native momentum, snap to card edges |
| Sheet open | slide up from bottom, backdrop fade to 0.5 |
| Pin select on map | ring + scale(1.15), 150ms |
| Pull-to-refresh | existing behavior |

No parallax, no bounce, no entrance animations on list mount (they slow perceived load). Respect `reduceMotion` — skip scale pops.

### Microcopy rules

- **Time:** "in 2h", "tonight at 9", "tomorrow 8pm", "Fri Apr 17". Never ISO dates.
- **Distance:** "0.4 mi", "1.2 mi", "12 mi". 1 decimal under 10, integer above.
- **Price:** "Free", "$15", "$15–$40", "Tickets" if price unknown.
- **Empty states:** state the fact, never apologize ("Sorry, no events…" is banned).
- **CTA verbs:** "Save", "Directions", "Get Tickets", "View original". Active voice. No "Click to…"

### Accessibility

- All tappable elements ≥ 44×44 hit area (current heart 40×40 bumps to 44).
- Text contrast ≥ 4.5:1.
- `accessibilityLabel` on all icon-only buttons (save, recenter, back, share).
- Respect `reduceMotion` system setting.

## 9. "View original" link

Every event context shows a persistent link back to the source.

**Where it appears:**
- **Event detail** — pinned visible row at the bottom of scroll content (above sticky action bar): `View original on Ticketmaster ↗`
- **Map bottom-card** (when an event is selected) — small trailing link: `View on Ticketmaster ↗`

**Rendering:**
- Text = `View original on {sourceDisplayName} ↗`
- Source display name mapped from `Event.source`:
  - `ticketmaster` → "Ticketmaster"
  - `seatgeek` → "SeatGeek"
  - `municipal` → "City of {City}" (fallback "City website")
  - `community` → "Community listing"
  - `google_places` → "Google"
  - `scraped` → domain of `source_url` (e.g. "eventbrite.com")
- Only render if `source_url` is truthy. If null, show nothing (don't render a broken link).
- Tapping opens `source_url` via `Linking.openURL` (same as existing ticket flow).

## 10. Files that change

Not a complete file map — for the implementation plan to refine. Key touch points:

- `src/constants/theme.ts` — simplify `COLORS` (drop per-tag colors), rework `GRADIENTS` usage, simplify `RADIUS`.
- `src/constants/tags.ts` — add `dimension: "when" | "who" | "vibe" | "cost"` field to `TagOption`, drop per-tag colors.
- `src/constants/categories.ts` — keep colors but update usage guidance.
- `src/components/FeedCard.tsx` — rewrite per §4 (full variant).
- `src/components/HeroCard.tsx` — NEW, per §4.
- `src/components/TagBadge.tsx` — remove per-tag color, monochrome + accent-when-selected.
- `src/components/TagFilter.tsx` — replace with new grouped filter sheet component.
- `src/components/FilterSheet.tsx` — NEW.
- `src/components/DiscoveryRow.tsx` — NEW, horizontal carousel.
- `src/components/EmptyState.tsx` — NEW, 3 variants.
- `src/components/ViewOriginalLink.tsx` — NEW.
- `src/components/SourceDisplayName.ts` — NEW helper.
- `app/(tabs)/_layout.tsx` — 5 tabs → 4 (remove Search tab).
- `app/(tabs)/index.tsx` — rewrite Discover with row architecture + search pill modal.
- `app/(tabs)/map.tsx` — add clustering, pin glyphs, bottom carousel, When chip row.
- `app/(tabs)/saved.tsx` — add segmented control, date grouping, swipe actions.
- `app/(tabs)/search.tsx` — DELETE (moves to Discover modal).
- `app/event/[id].tsx` — restructure per §5, add View original link.
- Shared When-filter state — extract to a hook `useWhenFilter.ts` in `src/hooks`.

## 11. Out of scope (future)

- Authenticated saves in Supabase.
- Push notifications for saved-event reminders.
- Share-to-friends with deep links.
- User-submitted events.
- Category taxonomy changes.
- Widget / lock-screen complications.
