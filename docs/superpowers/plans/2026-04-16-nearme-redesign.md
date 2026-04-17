# NearMe Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the v5 redesign spec — tag dimensions, rows-based Discover, calmer visual system, map clustering, grouped Saved, persistent "View original" link — in shippable phases that keep the app working after every task.

**Architecture:** Phase-based rewrite of React Native / Expo app. Foundation first (tokens, helpers, shared state), then new primitive components, then one-screen-at-a-time rewrites, then polish. Shared state via a small custom hook; filter sheet as a bottom-sheet modal; discovery rows as a data-driven component that hides when empty.

**Tech Stack:** React Native 0.81, Expo ~54, Expo Router, NativeWind, `react-native-maps`, `expo-linear-gradient`, `@expo/vector-icons`, `AsyncStorage`. Adding `jest-expo` + `@testing-library/react-native` for pure-logic tests. Adding `react-native-map-clustering` for map.

**Spec:** `docs/superpowers/specs/2026-04-16-nearme-design.md`

**Testing philosophy:** The codebase currently has zero tests. We add a minimal jest setup and unit-test pure logic (time windows, source mapping, dimension grouping, row predicates). UI screens are verified by running the app and executing explicit manual checks listed per task. We do NOT add UI integration tests — the value/effort is wrong for this redesign.

**Commit cadence:** commit after every task. Each task leaves the app compiling and running.

---

## File Structure

### New files
- `jest.config.js` — test runner config
- `src/constants/tags.ts` *(modify)* — add `dimension` field
- `src/lib/source.ts` — source-name mapping helper
- `src/lib/time-windows.ts` — time-window predicates (tonight, weekend, etc.)
- `src/lib/rows.ts` — discovery row definitions + predicates
- `src/hooks/useWhenFilter.ts` — shared "When" filter state (AsyncStorage)
- `src/components/HeroCard.tsx` — 160×220 compact card for row carousels
- `src/components/ViewOriginalLink.tsx` — `View original on {source} ↗`
- `src/components/EmptyState.tsx` — 3-variant empty state component
- `src/components/DiscoveryRow.tsx` — titled horizontal carousel of HeroCards
- `src/components/FilterSheet.tsx` — bottom-sheet grouped filter (Category / Vibe / Who / Cost / Distance)
- `src/components/SearchOverlay.tsx` — modal search, replaces Search tab
- `src/components/WhenSegmented.tsx` — sticky segmented "When" control
- `src/components/ActiveFiltersRow.tsx` — "Category · Vibe · Free [3]" tappable line
- `src/components/MapPin.tsx` — category glyph pin for map
- `src/lib/tests/` — colocated unit tests

### Modified files
- `src/constants/theme.ts` — simplify COLORS (drop per-tag colors), update RADIUS
- `src/constants/tags.ts` — add `dimension`, remove per-tag colors, drop redundant `food` tag
- `src/components/TagBadge.tsx` — monochrome, accent when selected
- `src/components/TagFilter.tsx` — DELETE (replaced by FilterSheet)
- `src/components/FeedCard.tsx` — rewrite per spec §4 (full variant)
- `app/(tabs)/_layout.tsx` — 5 tabs → 4 tabs (remove Search)
- `app/(tabs)/index.tsx` — rewrite Discover with rows + search pill
- `app/(tabs)/map.tsx` — clustering, pin glyphs, bottom carousel, floating When row
- `app/(tabs)/saved.tsx` — date grouping, segmented control, swipe actions
- `app/event/[id].tsx` — restructure per §5, add View original link
- `package.json` — add jest, testing library, clustering lib

### Deleted files
- `app/(tabs)/search.tsx` — moves into SearchOverlay modal inside Discover
- `src/components/TagFilter.tsx` — replaced by FilterSheet

---

## Phase 0 — Foundation (tests, tokens, helpers)

### Task 1: Add Jest + testing library

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `src/lib/tests/sanity.test.ts`

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev jest jest-expo @testing-library/react-native @types/jest ts-jest
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-native-community|@sentry/.*))",
  ],
  testMatch: ["**/?(*.)+(spec|test).[jt]s?(x)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
};
```

- [ ] **Step 3: Add test script to `package.json`**

Add to the `scripts` block:
```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 4: Create sanity test**

`src/lib/tests/sanity.test.ts`:
```ts
describe("sanity", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run test**

```bash
npm test
```
Expected: 1 passing test.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json jest.config.js src/lib/tests/sanity.test.ts
git commit -m "chore: add jest + testing library for pure-logic tests"
```

---

### Task 2: Source-name mapping helper

**Files:**
- Create: `src/lib/source.ts`
- Create: `src/lib/tests/source.test.ts`

- [ ] **Step 1: Write failing test**

`src/lib/tests/source.test.ts`:
```ts
import { getSourceDisplayName } from "../source";

describe("getSourceDisplayName", () => {
  it("maps ticketmaster", () => {
    expect(getSourceDisplayName("ticketmaster", null)).toBe("Ticketmaster");
  });
  it("maps seatgeek", () => {
    expect(getSourceDisplayName("seatgeek", null)).toBe("SeatGeek");
  });
  it("maps google_places", () => {
    expect(getSourceDisplayName("google_places", null)).toBe("Google");
  });
  it("maps municipal", () => {
    expect(getSourceDisplayName("municipal", null)).toBe("City website");
  });
  it("maps community", () => {
    expect(getSourceDisplayName("community", null)).toBe("Community listing");
  });
  it("uses domain for scraped with URL", () => {
    expect(
      getSourceDisplayName("scraped", "https://www.eventbrite.com/e/123")
    ).toBe("eventbrite.com");
  });
  it("falls back to source name when scraped with no URL", () => {
    expect(getSourceDisplayName("scraped", null)).toBe("source");
  });
  it("returns null for no source", () => {
    expect(getSourceDisplayName(null as any, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- source
```
Expected: FAIL with "cannot find module '../source'".

- [ ] **Step 3: Implement**

`src/lib/source.ts`:
```ts
import { EventSource } from "../types";

export function getSourceDisplayName(
  source: EventSource | null,
  sourceUrl: string | null
): string | null {
  if (!source) return null;
  switch (source) {
    case "ticketmaster":
      return "Ticketmaster";
    case "seatgeek":
      return "SeatGeek";
    case "google_places":
      return "Google";
    case "municipal":
      return "City website";
    case "community":
      return "Community listing";
    case "scraped": {
      if (!sourceUrl) return "source";
      try {
        const { hostname } = new URL(sourceUrl);
        return hostname.replace(/^www\./, "");
      } catch {
        return "source";
      }
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- source
```
Expected: all 8 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/source.ts src/lib/tests/source.test.ts
git commit -m "feat: add source display name helper"
```

---

### Task 3: Time-window predicate helpers

**Files:**
- Create: `src/lib/time-windows.ts`
- Create: `src/lib/tests/time-windows.test.ts`

- [ ] **Step 1: Write failing test**

`src/lib/tests/time-windows.test.ts`:
```ts
import {
  isTonight,
  isTomorrow,
  isThisWeekend,
  isWithinNextHours,
  isSameCalendarDay,
} from "../time-windows";

// Fix "now" so tests are deterministic
const NOW = new Date("2026-04-16T14:00:00"); // Thursday 2pm local

describe("time-windows", () => {
  it("isTonight: tonight at 9pm", () => {
    expect(isTonight("2026-04-16T21:00:00", NOW)).toBe(true);
  });
  it("isTonight: tomorrow 2am counts as tonight (pre-3am cutoff)", () => {
    expect(isTonight("2026-04-17T02:30:00", NOW)).toBe(true);
  });
  it("isTonight: tomorrow noon is NOT tonight", () => {
    expect(isTonight("2026-04-17T12:00:00", NOW)).toBe(false);
  });
  it("isTomorrow: tomorrow 8pm is tomorrow", () => {
    expect(isTomorrow("2026-04-17T20:00:00", NOW)).toBe(true);
  });
  it("isThisWeekend: Saturday from a Thursday", () => {
    expect(isThisWeekend("2026-04-18T19:00:00", NOW)).toBe(true);
  });
  it("isThisWeekend: next Monday is NOT this weekend", () => {
    expect(isThisWeekend("2026-04-20T19:00:00", NOW)).toBe(false);
  });
  it("isWithinNextHours: 1h from now", () => {
    expect(isWithinNextHours("2026-04-16T14:30:00", 2, NOW)).toBe(true);
  });
  it("isWithinNextHours: 3h away with 2h window", () => {
    expect(isWithinNextHours("2026-04-16T17:30:00", 2, NOW)).toBe(false);
  });
  it("isSameCalendarDay: same day", () => {
    expect(isSameCalendarDay("2026-04-16T22:00:00", NOW)).toBe(true);
  });
  it("isSameCalendarDay: next day", () => {
    expect(isSameCalendarDay("2026-04-17T01:00:00", NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- time-windows
```
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/time-windows.ts`:
```ts
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

// "Tonight" = from now through 3:00 AM next day (covers late-night events)
export function isTonight(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    3, 0, 0
  );
  return t >= now && t <= cutoff;
}

export function isTomorrow(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const tomorrow = addDays(startOfDay(now), 1);
  const dayAfter = addDays(tomorrow, 1);
  return t >= tomorrow && t < dayAfter;
}

// This weekend = Saturday 00:00 through Sunday 23:59 of the upcoming Sat/Sun
export function isThisWeekend(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 Sun, 6 Sat
  const daysToSat = (6 - dow + 7) % 7; // 0 if Sat, 6 if Sun (keeps forward-looking)
  const saturday = addDays(today, daysToSat === 0 && dow !== 6 ? 7 : daysToSat);
  const monday = addDays(saturday, 2);
  // Special-case: if today IS weekend, treat "this weekend" as the current one
  if (dow === 6 || dow === 0) {
    const thisSat = dow === 6 ? today : addDays(today, -1);
    const nextMon = addDays(thisSat, 2);
    return t >= thisSat && t < nextMon;
  }
  return t >= saturday && t < monday;
}

export function isWithinNextHours(
  startTime: string,
  hours: number,
  now: Date = new Date()
): boolean {
  const t = new Date(startTime);
  const cutoff = new Date(now.getTime() + hours * 3600_000);
  return t >= now && t <= cutoff;
}

export function isSameCalendarDay(
  startTime: string,
  now: Date = new Date()
): boolean {
  const t = new Date(startTime);
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  );
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- time-windows
```
Expected: all 10 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time-windows.ts src/lib/tests/time-windows.test.ts
git commit -m "feat: add time-window predicate helpers"
```

---

### Task 4: Simplify theme tokens

**Files:**
- Modify: `src/constants/theme.ts`

- [ ] **Step 1: Replace COLORS + RADIUS**

Replace the entire file contents with:

```ts
export const COLORS = {
  // Surfaces (3 levels)
  bg: "#0f0f1a",      // L0 — screen background
  card: "#1a1a2e",    // L1 — cards
  cardAlt: "#222240", // L2 — elevated elements / inputs inside cards

  // Text
  text: "#eeeef6",
  muted: "#9090b0",
  border: "#2e2e4a",

  // Accent (single)
  accent: "#7c6cf0",
  accentLight: "#b0a4ff",

  // Semantic
  success: "#2ed8a3",  // free, chill, available
  warm: "#ffb347",     // price, soon
  hot: "#ff6b6b",      // saved, packed, urgent

  // Legacy compatibility (used by some existing code — keep for now)
  secondary: "#00d4cd",
  pink: "#ff6b9d",
  overlay: "rgba(15, 15, 26, 0.85)",
};

export const GRADIENTS = {
  accent: ["#7c6cf0", "#b06cf0"] as const,
  card: ["transparent", "rgba(15, 15, 26, 0.95)"] as const,
  hero: ["transparent", "rgba(15, 15, 26, 0.7)", "rgba(15, 15, 26, 0.98)"] as const,
};

export const RADIUS = {
  sm: 10,     // chips inside cards
  md: 16,     // cards
  lg: 24,     // hero / sheets
  pill: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const BOCA_RATON = {
  lat: 26.3587,
  lng: -80.0831,
};

export const DEFAULT_RADIUS_MILES = 5;
```

- [ ] **Step 2: Confirm TypeScript still compiles**

```bash
npx tsc --noEmit
```
Expected: no errors. (If errors surface, they'll be `RADIUS.xl` usages — fix them to `RADIUS.lg` in each file.)

- [ ] **Step 3: Start the app and smoke-test**

```bash
npm start
```
Open on a device/simulator. Verify Discover loads, cards render, no crash. Tags may look slightly different (they still have per-tag colors at this point — that changes in Task 6). Accept.

- [ ] **Step 4: Commit**

```bash
git add src/constants/theme.ts
git commit -m "refactor: simplify theme tokens (3 surfaces, single accent, semantic rest)"
```

---

### Task 5: Add `dimension` field to tags and drop redundant entries

**Files:**
- Modify: `src/constants/tags.ts`

- [ ] **Step 1: Rewrite tags.ts with dimensions**

```ts
export type TagDimension = "when" | "who" | "vibe" | "cost";

export interface TagOption {
  id: string;
  label: string;
  icon: string;      // Ionicons name
  dimension: TagDimension;
}

export const TAGS: TagOption[] = [
  // WHEN
  { id: "late-night", label: "Late Night", icon: "moon", dimension: "when" },
  { id: "daytime", label: "Daytime", icon: "sunny", dimension: "when" },

  // WHO
  { id: "21+", label: "21+", icon: "wine", dimension: "who" },
  { id: "18+", label: "18+", icon: "alert-circle", dimension: "who" },
  { id: "all-ages", label: "All Ages", icon: "happy", dimension: "who" },
  { id: "singles", label: "Singles", icon: "heart-circle", dimension: "who" },
  { id: "family", label: "Family", icon: "people", dimension: "who" },

  // VIBE
  { id: "date-night", label: "Date Night", icon: "heart", dimension: "vibe" },
  { id: "drinking", label: "Drinking", icon: "beer", dimension: "vibe" },
  { id: "live-music", label: "Live Music", icon: "musical-notes", dimension: "vibe" },
  { id: "outdoor", label: "Outdoor", icon: "sunny", dimension: "vibe" },
  { id: "active", label: "Active", icon: "fitness", dimension: "vibe" },

  // COST
  { id: "free", label: "Free", icon: "gift", dimension: "cost" },
  { id: "ticketed", label: "Ticketed", icon: "ticket", dimension: "cost" },
];

export const TAG_MAP = Object.fromEntries(
  TAGS.map((t) => [t.id, t])
) as Record<string, TagOption>;

export const TAGS_BY_DIMENSION: Record<TagDimension, TagOption[]> = {
  when: TAGS.filter((t) => t.dimension === "when"),
  who: TAGS.filter((t) => t.dimension === "who"),
  vibe: TAGS.filter((t) => t.dimension === "vibe"),
  cost: TAGS.filter((t) => t.dimension === "cost"),
};

export const DIMENSION_LABELS: Record<TagDimension, string> = {
  when: "When",
  who: "Who",
  vibe: "Vibe",
  cost: "Cost",
};
```

Note: dropped `food` (category already covers) per spec §1. Dropped standalone `color` field from `TagOption` — tags are monochrome now.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: errors referencing `info.color` in `TagBadge.tsx` and per-tag colors in screens. Fix next task.

- [ ] **Step 3: Commit**

```bash
git add src/constants/tags.ts
git commit -m "refactor: group tags by dimension (when/who/vibe/cost), drop per-tag colors"
```

---

### Task 6: Rewrite TagBadge (monochrome)

**Files:**
- Modify: `src/components/TagBadge.tsx`

- [ ] **Step 1: Replace file contents**

```tsx
import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAG_MAP } from "../constants/tags";
import { COLORS, RADIUS } from "../constants/theme";

interface TagBadgeProps {
  tag: string;
  selected?: boolean;
  onPress?: () => void;
  size?: "sm" | "md";
}

export default function TagBadge({ tag, selected, onPress, size = "sm" }: TagBadgeProps) {
  const info = TAG_MAP[tag];
  if (!info) return null;

  const isMd = size === "md";
  const bgColor = selected ? COLORS.accent : COLORS.cardAlt;
  const textColor = selected ? "#fff" : COLORS.muted;
  const iconColor = selected ? "#fff" : COLORS.muted;

  const content = (
    <View style={[styles.badge, isMd && styles.badgeMd, { backgroundColor: bgColor }]}>
      <Ionicons name={info.icon as any} size={isMd ? 14 : 11} color={iconColor} />
      <Text style={[styles.label, isMd && styles.labelMd, { color: textColor }]}>
        {info.label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  badgeMd: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
  labelMd: {
    fontSize: 13,
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: any remaining per-tag-color references in screens must be fixed. They'll be removed in later tasks.

- [ ] **Step 3: Smoke-test app**

Run app. Verify tags render as monochrome pills; selected = accent purple; unselected = muted on dark gray.

- [ ] **Step 4: Commit**

```bash
git add src/components/TagBadge.tsx
git commit -m "refactor: TagBadge monochrome (accent when selected)"
```

---

## Phase 1 — New primitive components

### Task 7: ViewOriginalLink component

**Files:**
- Create: `src/components/ViewOriginalLink.tsx`

- [ ] **Step 1: Create component**

```tsx
import { TouchableOpacity, Text, Linking, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSourceDisplayName } from "../lib/source";
import { Event } from "../types";
import { COLORS } from "../constants/theme";

interface Props {
  event: Pick<Event, "source" | "source_url">;
  variant?: "inline" | "row"; // inline = small trailing link, row = full visible row
}

export default function ViewOriginalLink({ event, variant = "row" }: Props) {
  if (!event.source_url) return null;
  const name = getSourceDisplayName(event.source, event.source_url);
  if (!name) return null;

  const label = variant === "inline" ? `View on ${name}` : `View original on ${name}`;

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(event.source_url!)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={variant === "row" ? styles.row : styles.inline}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <Text style={variant === "row" ? styles.rowText : styles.inlineText}>{label}</Text>
        <Ionicons name="open-outline" size={variant === "row" ? 16 : 13} color={COLORS.accent} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  inline: {
    paddingVertical: 4,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.accent,
  },
  inlineText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.accent,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ViewOriginalLink.tsx
git commit -m "feat: add ViewOriginalLink component"
```

---

### Task 8: HeroCard component

**Files:**
- Create: `src/components/HeroCard.tsx`

- [ ] **Step 1: Create component**

```tsx
import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { CATEGORY_MAP } from "../constants/categories";
import { getEventImage } from "../constants/images";
import { COLORS, RADIUS } from "../constants/theme";

interface Props {
  event: Event;
  onPress: () => void;
}

export default function HeroCard({ event, onPress }: Props) {
  const category = CATEGORY_MAP[event.category];
  const imageUri = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description);

  const startDate = new Date(event.start_time);
  const dayName = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const venueName = event.venue?.name || event.address?.split(",")[0] || "";
  const distanceStr = event.distance != null ? ` · ${event.distance.toFixed(1)} mi` : "";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: imageUri }} style={styles.image} />
        {category && (
          <View style={styles.catGlyph}>
            <Ionicons name={category.icon as any} size={13} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.meta}>{dayName} · {timeStr}</Text>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.subMeta} numberOfLines={1}>
          {venueName}{distanceStr}
        </Text>
        {event.is_free && (
          <View style={styles.freeChip}>
            <Text style={styles.freeText}>FREE</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 160,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    height: 140,
    backgroundColor: COLORS.cardAlt,
  },
  image: { width: "100%", height: "100%" },
  catGlyph: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    padding: 10,
    gap: 4,
  },
  meta: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: 18,
  },
  subMeta: {
    fontSize: 11,
    color: COLORS.muted,
  },
  freeChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.success + "20",
    marginTop: 2,
  },
  freeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.success,
    letterSpacing: 0.5,
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HeroCard.tsx
git commit -m "feat: add HeroCard (160x220 compact card for row carousels)"
```

---

### Task 9: EmptyState component

**Files:**
- Create: `src/components/EmptyState.tsx`

- [ ] **Step 1: Create component**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

interface Props {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  body: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
}

export default function EmptyState({ icon, title, body, ctaLabel, onCtaPress }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={36} color={COLORS.accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {ctaLabel && onCtaPress && (
        <TouchableOpacity style={styles.cta} onPress={onCtaPress} activeOpacity={0.85}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
  cta: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/EmptyState.tsx
git commit -m "feat: add EmptyState component (title, body, optional CTA)"
```

---

### Task 10: DiscoveryRow component + row predicates

**Files:**
- Create: `src/lib/rows.ts`
- Create: `src/lib/tests/rows.test.ts`
- Create: `src/components/DiscoveryRow.tsx`

- [ ] **Step 1: Write failing test for row predicates**

`src/lib/tests/rows.test.ts`:
```ts
import { buildDiscoveryRows } from "../rows";
import { Event } from "../../types";

const NOW = new Date("2026-04-16T14:00:00"); // Thursday 2pm

function make(overrides: Partial<Event>): Event {
  return {
    id: overrides.id || Math.random().toString(),
    venue_id: null,
    source: "scraped",
    source_id: null,
    title: "Test",
    description: "",
    category: "nightlife",
    subcategory: "",
    lat: 0,
    lng: 0,
    address: "",
    image_url: null,
    start_time: "2026-04-18T20:00:00",
    end_time: null,
    is_recurring: false,
    recurrence_rule: null,
    is_free: false,
    price_min: null,
    price_max: null,
    ticket_url: null,
    attendance: null,
    source_url: null,
    tags: [],
    ...overrides,
  };
}

describe("buildDiscoveryRows", () => {
  it("hides rows with fewer than 3 matches", () => {
    const events = [make({ id: "1", is_free: true, start_time: "2026-04-16T21:00:00" })];
    const rows = buildDiscoveryRows(events, NOW);
    const free = rows.find((r) => r.id === "free-tonight");
    expect(free).toBeUndefined();
  });

  it("builds Free Tonight when 3+ free same-day events exist", () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      make({ id: `f${i}`, is_free: true, start_time: "2026-04-16T21:00:00" })
    );
    const rows = buildDiscoveryRows(events, NOW);
    const free = rows.find((r) => r.id === "free-tonight");
    expect(free).toBeDefined();
    expect(free!.events.length).toBe(4);
  });

  it("builds Happening Now for events within 2h", () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      make({ id: `h${i}`, start_time: "2026-04-16T15:00:00" })
    );
    const rows = buildDiscoveryRows(events, NOW);
    expect(rows.find((r) => r.id === "happening-now")).toBeDefined();
  });

  it("caps row count at 4", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      make({
        id: `x${i}`,
        is_free: true,
        distance: 0.5,
        start_time: "2026-04-16T15:30:00",
      })
    );
    const rows = buildDiscoveryRows(events, NOW);
    expect(rows.length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- rows
```
Expected: FAIL.

- [ ] **Step 3: Implement rows.ts**

```ts
import { Event } from "../types";
import {
  isWithinNextHours,
  isSameCalendarDay,
  isThisWeekend,
} from "./time-windows";

export interface DiscoveryRow {
  id: string;
  title: string;
  icon: string; // Ionicons name
  events: Event[];
}

const MAX_ROWS = 4;
const MIN_EVENTS_PER_ROW = 3;

type RowBuilder = (events: Event[], now: Date) => DiscoveryRow | null;

function buildPickedForYou(picks: Event[]): RowBuilder {
  return () =>
    picks.length >= MIN_EVENTS_PER_ROW
      ? { id: "picked-for-you", title: "Picked for you", icon: "sparkles", events: picks }
      : null;
}

const happeningNow: RowBuilder = (events, now) => {
  const filtered = events.filter((e) => isWithinNextHours(e.start_time, 2, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "happening-now", title: "Happening now", icon: "flame", events: filtered }
    : null;
};

const freeTonight: RowBuilder = (events, now) => {
  const filtered = events.filter((e) => e.is_free && isSameCalendarDay(e.start_time, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "free-tonight", title: "Free tonight", icon: "gift", events: filtered }
    : null;
};

const withinOneMile: RowBuilder = (events) => {
  const filtered = events.filter((e) => e.distance != null && e.distance < 1);
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "within-one-mile", title: "Within 1 mile", icon: "location", events: filtered }
    : null;
};

const thisWeekend: RowBuilder = (events, now) => {
  const dow = now.getDay();
  // Only show Mon–Fri (not when it already IS the weekend)
  if (dow === 0 || dow === 6) return null;
  const filtered = events.filter((e) => isThisWeekend(e.start_time, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "this-weekend", title: "This weekend", icon: "calendar", events: filtered }
    : null;
};

export function buildDiscoveryRows(
  events: Event[],
  now: Date = new Date(),
  picks: Event[] = []
): DiscoveryRow[] {
  const builders: RowBuilder[] = [
    buildPickedForYou(picks),
    happeningNow,
    freeTonight,
    withinOneMile,
    thisWeekend,
  ];
  const rows: DiscoveryRow[] = [];
  for (const b of builders) {
    const r = b(events, now);
    if (r) rows.push(r);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- rows
```
Expected: all 4 pass.

- [ ] **Step 5: Create DiscoveryRow component**

`src/components/DiscoveryRow.tsx`:
```tsx
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import HeroCard from "./HeroCard";
import { COLORS, SPACING } from "../constants/theme";

interface Props {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  events: Event[];
  onPressEvent: (e: Event) => void;
}

export default function DiscoveryRow({ title, icon, events, onPressEvent }: Props) {
  if (events.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Ionicons name={icon} size={16} color={COLORS.accent} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {events.map((e) => (
          <HeroCard key={e.id} event={e} onPress={() => onPressEvent(e)} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: SPACING.lg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: SPACING.md,
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  scroll: {
    gap: 10,
    paddingHorizontal: SPACING.md,
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/rows.ts src/lib/tests/rows.test.ts src/components/DiscoveryRow.tsx
git commit -m "feat: discovery row predicates and horizontal-scroll component"
```

---

### Task 11: Rewrite FeedCard (full variant)

**Files:**
- Modify: `src/components/FeedCard.tsx`

- [ ] **Step 1: Rewrite FeedCard**

Replace file contents with:

```tsx
import { View, Text, Image, StyleSheet, Dimensions, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { formatDistance } from "../services/events";
import { CATEGORY_MAP } from "../constants/categories";
import { TAG_MAP } from "../constants/tags";
import { getEventImage } from "../constants/images";
import { COLORS, RADIUS } from "../constants/theme";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;

interface Props {
  event: Event;
  isSaved: boolean;
  onPress: () => void;
  onSave: () => void;
}

function tagDisplay(tag: string): string {
  return TAG_MAP[tag]?.label || tag;
}

export default function FeedCard({ event, isSaved, onPress, onSave }: Props) {
  const category = CATEGORY_MAP[event.category];
  const imageUri = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description);

  const startDate = new Date(event.start_time);
  const dateStr = startDate.toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric",
  }).toUpperCase();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const displayTags = (event.tags || []).slice(0, 3).map(tagDisplay);
  const distanceStr = event.distance != null ? formatDistance(event.distance) : null;
  const venueName = event.venue?.name || event.address?.split(",")[0] || "Nearby";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.95}>
      {/* Image */}
      <View style={styles.imageWrap}>
        <Image source={{ uri: imageUri }} style={styles.image} />
        <TouchableOpacity
          style={[styles.saveBtn, isSaved && styles.saveBtnActive]}
          onPress={onSave}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={isSaved ? "Unsave event" : "Save event"}
        >
          <Ionicons
            name={isSaved ? "heart" : "heart-outline"}
            size={18}
            color={isSaved ? COLORS.hot : "#fff"}
          />
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.meta}>
          {dateStr} · {timeStr}{distanceStr ? ` · ${distanceStr}` : ""}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}{venueName !== "Nearby" ? ` at ${venueName}` : ""}
        </Text>
        {category && (
          <View style={styles.catRow}>
            <Ionicons name={category.icon as any} size={13} color={category.color} />
            <Text style={[styles.catText, { color: category.color }]}>{category.label}</Text>
          </View>
        )}

        <View style={styles.bottomRow}>
          <Text style={styles.tagText} numberOfLines={1}>
            {displayTags.join(" · ")}
          </Text>
          {event.is_free ? (
            <View style={styles.freeChip}>
              <Text style={styles.freeText}>FREE</Text>
            </View>
          ) : event.price_min ? (
            <Text style={styles.priceText}>${event.price_min}+</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    height: 160,
    backgroundColor: COLORS.cardAlt,
  },
  image: { width: "100%", height: "100%" },
  saveBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnActive: {
    backgroundColor: "rgba(255,107,107,0.2)",
  },
  info: {
    padding: 14,
    gap: 6,
  },
  meta: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  catText: {
    fontSize: 12,
    fontWeight: "700",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  tagText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: "500",
  },
  freeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.success + "20",
  },
  freeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.success,
    letterSpacing: 0.5,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.warm,
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors in FeedCard.

- [ ] **Step 3: Smoke-test app**

Run app. Go to Discover. Verify:
- Card image is shorter (~160h, not 200h)
- Title appears below image, not overlaid
- Tags are inline text with bullets (not colored pills)
- Save heart is smaller, only in top-right of image
- 2.5+ cards visible per screen

- [ ] **Step 4: Commit**

```bash
git add src/components/FeedCard.tsx
git commit -m "refactor: FeedCard new layout (shorter image, tags inline, single meta row)"
```

---

## Phase 2 — Shared state, filters, search

### Task 12: useWhenFilter shared hook

**Files:**
- Create: `src/hooks/useWhenFilter.ts`

- [ ] **Step 1: Create hook**

```tsx
import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type WhenFilter = "all" | "tonight" | "tomorrow" | "weekend" | "week";

const KEY = "@nearme_when_filter";

// Very small event bus so Discover/Map stay in sync without Context ceremony
const listeners: Set<(v: WhenFilter) => void> = new Set();
function broadcast(v: WhenFilter) {
  listeners.forEach((l) => l(v));
}

export function useWhenFilter(): [WhenFilter, (v: WhenFilter) => void] {
  const [value, setValue] = useState<WhenFilter>("all");

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY).then((raw) => {
      if (!alive) return;
      if (raw && ["all", "tonight", "tomorrow", "weekend", "week"].includes(raw)) {
        setValue(raw as WhenFilter);
      }
    });
    const cb = (v: WhenFilter) => setValue(v);
    listeners.add(cb);
    return () => {
      alive = false;
      listeners.delete(cb);
    };
  }, []);

  const update = useCallback((v: WhenFilter) => {
    setValue(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
    broadcast(v);
  }, []);

  return [value, update];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWhenFilter.ts
git commit -m "feat: shared When filter hook with cross-tab broadcast"
```

---

### Task 13: WhenSegmented control

**Files:**
- Create: `src/components/WhenSegmented.tsx`

- [ ] **Step 1: Create component**

```tsx
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { WhenFilter } from "../hooks/useWhenFilter";

interface Props {
  value: WhenFilter;
  onChange: (v: WhenFilter) => void;
}

const OPTIONS: { id: WhenFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tonight", label: "Tonight" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "Weekend" },
  { id: "week", label: "This Week" },
];

export default function WhenSegmented({ value, onChange }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(o.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: SPACING.md,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
  },
  textActive: {
    color: "#fff",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/WhenSegmented.tsx
git commit -m "feat: WhenSegmented control (All / Tonight / Tomorrow / Weekend / Week)"
```

---

### Task 14: FilterSheet (grouped bottom-sheet filter)

**Files:**
- Create: `src/components/FilterSheet.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useMemo, useState } from "react";
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAGS_BY_DIMENSION, DIMENSION_LABELS } from "../constants/tags";
import { CATEGORIES } from "../constants/categories";
import { EventCategory } from "../types";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

export interface FilterValue {
  categories: EventCategory[];
  tags: string[]; // mixed across dimensions
  radiusMiles: number;
}

interface Props {
  visible: boolean;
  initial: FilterValue;
  liveCount: (v: FilterValue) => number;
  onClose: () => void;
  onApply: (v: FilterValue) => void;
}

export default function FilterSheet({ visible, initial, liveCount, onClose, onApply }: Props) {
  const [value, setValue] = useState<FilterValue>(initial);
  const count = useMemo(() => liveCount(value), [value, liveCount]);

  const active =
    value.categories.length > 0 || value.tags.length > 0 || value.radiusMiles !== 5;

  function toggleCategory(id: EventCategory) {
    setValue((v) => ({
      ...v,
      categories: v.categories.includes(id)
        ? v.categories.filter((c) => c !== id)
        : [...v.categories, id],
    }));
  }
  function toggleTag(id: string) {
    setValue((v) => ({
      ...v,
      tags: v.tags.includes(id) ? v.tags.filter((t) => t !== id) : [...v.tags, id],
    }));
  }
  function reset() {
    setValue({ categories: [], tags: [], radiusMiles: 5 });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Filters</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {active && (
              <TouchableOpacity onPress={reset}>
                <Text style={styles.resetText}>Reset</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 120 }}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <View style={styles.pillRow}>
            {CATEGORIES.map((c) => {
              const on = value.categories.includes(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pill, on && styles.pillActive]}
                  onPress={() => toggleCategory(c.id)}
                >
                  <Ionicons name={c.icon as any} size={13} color={on ? "#fff" : COLORS.muted} />
                  <Text style={[styles.pillText, on && styles.pillTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(["vibe", "who", "cost", "when"] as const).map((dim) => (
            <View key={dim} style={{ marginTop: SPACING.lg }}>
              <Text style={styles.sectionLabel}>{DIMENSION_LABELS[dim].toUpperCase()}</Text>
              <View style={styles.pillRow}>
                {TAGS_BY_DIMENSION[dim].map((t) => {
                  const on = value.tags.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.pill, on && styles.pillActive]}
                      onPress={() => toggleTag(t.id)}
                    >
                      <Ionicons name={t.icon as any} size={13} color={on ? "#fff" : COLORS.muted} />
                      <Text style={[styles.pillText, on && styles.pillTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyBtn} onPress={() => { onApply(value); onClose(); }}>
            <Text style={styles.applyText}>Show {count} event{count === 1 ? "" : "s"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "85%",
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
  },
  resetText: {
    fontSize: 14,
    color: COLORS.accent,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.muted,
  },
  pillTextActive: {
    color: "#fff",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: SPACING.md,
    paddingBottom: SPACING.lg,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  applyBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: "center",
  },
  applyText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/FilterSheet.tsx
git commit -m "feat: FilterSheet (grouped Category/Vibe/Who/Cost bottom sheet)"
```

---

### Task 15: ActiveFiltersRow

**Files:**
- Create: `src/components/ActiveFiltersRow.tsx`

- [ ] **Step 1: Create component**

```tsx
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { FilterValue } from "./FilterSheet";
import { CATEGORY_MAP } from "../constants/categories";
import { TAG_MAP } from "../constants/tags";

interface Props {
  value: FilterValue;
  onPress: () => void;
}

export default function ActiveFiltersRow({ value, onPress }: Props) {
  const activeCount =
    value.categories.length + value.tags.length + (value.radiusMiles !== 5 ? 1 : 0);
  if (activeCount === 0) return null;

  const labels: string[] = [];
  for (const c of value.categories) {
    const cat = CATEGORY_MAP[c];
    if (cat) labels.push(cat.label);
  }
  for (const t of value.tags) {
    const tag = TAG_MAP[t];
    if (tag) labels.push(tag.label);
  }
  if (value.radiusMiles !== 5) labels.push(`${value.radiusMiles}mi`);
  const text = labels.slice(0, 3).join(" · ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="options-outline" size={15} color={COLORS.accent} />
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
      <View style={styles.countBadge}>
        <Text style={styles.countText}>{activeCount}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: SPACING.md,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent + "40",
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    minWidth: 20,
    alignItems: "center",
  },
  countText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ActiveFiltersRow.tsx
git commit -m "feat: ActiveFiltersRow (tappable summary of applied filters)"
```

---

### Task 16: SearchOverlay modal (replaces Search tab)

**Files:**
- Create: `src/components/SearchOverlay.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useState, useMemo } from "react";
import {
  Modal, View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import FeedCard from "./FeedCard";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

const POPULAR = ["pickleball", "trivia", "karaoke", "live music", "speed dating", "happy hour", "yoga", "comedy"];

interface Props {
  visible: boolean;
  onClose: () => void;
  allEvents: Event[];
  savedIds: Set<string>;
  onPressEvent: (e: Event) => void;
  onToggleSave: (e: Event) => void;
}

export default function SearchOverlay({
  visible, onClose, allEvents, savedIds, onPressEvent, onToggleSave,
}: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return allEvents.filter(
      (e) =>
        e.title?.toLowerCase().includes(q) ||
        e.description?.toLowerCase().includes(q) ||
        e.venue?.name?.toLowerCase().includes(q) ||
        e.address?.toLowerCase().includes(q) ||
        e.subcategory?.toLowerCase().includes(q) ||
        e.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [q, allEvents]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color={COLORS.text} />
          </TouchableOpacity>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={18} color={COLORS.muted} />
            <TextInput
              style={styles.input}
              autoFocus
              placeholder="Search events, venues, tags"
              placeholderTextColor={COLORS.muted}
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
            />
            {!!query && (
              <TouchableOpacity onPress={() => setQuery("")}>
                <Ionicons name="close-circle" size={18} color={COLORS.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {!q ? (
          <View style={styles.suggestions}>
            <Text style={styles.popularLabel}>POPULAR SEARCHES</Text>
            <View style={styles.chipRow}>
              {POPULAR.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={styles.chip}
                  onPress={() => { setQuery(p); Keyboard.dismiss(); }}
                >
                  <Ionicons name="trending-up" size={12} color={COLORS.accent} />
                  <Text style={styles.chipText}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : matches.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No matches</Text>
            <Text style={styles.emptyBody}>Nothing matches "{query}". Try different keywords.</Text>
          </View>
        ) : (
          <FlatList
            data={matches}
            keyExtractor={(i) => i.id}
            renderItem={({ item }) => (
              <View style={{ marginBottom: 14 }}>
                <FeedCard
                  event={item}
                  isSaved={savedIds.has(item.id)}
                  onPress={() => onPressEvent(item)}
                  onSave={() => onToggleSave(item)}
                />
              </View>
            )}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, paddingTop: 50 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
  },
  searchWrap: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 14, height: 42,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  input: { flex: 1, color: COLORS.text, fontSize: 15, paddingVertical: 0 },
  suggestions: { padding: SPACING.md, paddingTop: SPACING.lg },
  popularLabel: { fontSize: 11, fontWeight: "800", color: COLORS.muted, letterSpacing: 1, marginBottom: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
  },
  chipText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: SPACING.xl },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: COLORS.text },
  emptyBody: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 6 },
  list: { padding: SPACING.md, paddingBottom: 40 },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SearchOverlay.tsx
git commit -m "feat: SearchOverlay modal (replaces Search tab)"
```

---

## Phase 3 — Rewrite Discover screen

### Task 17: Rewrite Discover with rows + search pill + filter sheet

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Replace file contents**

```tsx
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FeedCard from "../../src/components/FeedCard";
import SkeletonCard from "../../src/components/SkeletonCard";
import DiscoveryRow from "../../src/components/DiscoveryRow";
import WhenSegmented from "../../src/components/WhenSegmented";
import ActiveFiltersRow from "../../src/components/ActiveFiltersRow";
import FilterSheet, { FilterValue } from "../../src/components/FilterSheet";
import SearchOverlay from "../../src/components/SearchOverlay";
import EmptyState from "../../src/components/EmptyState";
import { fetchNearbyEvents, applyHiddenFilter } from "../../src/services/events";
import { getFeedHandoff, clearFeedHandoff } from "../../src/services/eventCache";
import { useLocation } from "../../src/hooks/useLocation";
import { useSyncStatus } from "../../src/hooks/useSyncStatus";
import { useWhenFilter, WhenFilter } from "../../src/hooks/useWhenFilter";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { buildDiscoveryRows } from "../../src/lib/rows";
import { isTonight, isTomorrow, isThisWeekend, isSameCalendarDay } from "../../src/lib/time-windows";

function matchesWhen(ev: Event, w: WhenFilter, now: Date): boolean {
  if (w === "all") return true;
  if (w === "tonight") return isTonight(ev.start_time, now);
  if (w === "tomorrow") return isTomorrow(ev.start_time, now);
  if (w === "weekend") return isThisWeekend(ev.start_time, now);
  if (w === "week") {
    const t = new Date(ev.start_time);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return t >= now && t < end;
  }
  return true;
}

function scoreEvent(event: Event, goals: string[]): number {
  const goalMap: Record<string, { tags: string[]; categories: string[] }> = {
    "meet-people": { tags: ["social"], categories: ["community", "nightlife"] },
    "find-partner": { tags: ["singles", "date-night"], categories: ["nightlife", "food", "arts"] },
    "get-active": { tags: ["active"], categories: ["sports", "fitness"] },
    "drinks-nightlife": { tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
    "live-music": { tags: ["live-music"], categories: ["music"] },
    "try-food": { tags: [], categories: ["food"] },
    "explore-arts": { tags: [], categories: ["arts", "movies"] },
    "family-fun": { tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
    "outdoor-fun": { tags: ["outdoor"], categories: ["outdoors", "fitness"] },
  };
  let score = 0;
  for (const g of goals) {
    const def = goalMap[g];
    if (!def) continue;
    for (const t of def.tags) if (event.tags?.includes(t)) score += 3;
    for (const c of def.categories) if (event.category === c) score += 2;
  }
  if (goals.includes("find-partner") && event.tags?.includes("singles")) score += 10;
  return score;
}

function diversifyByVenue(list: Event[], maxPerVenue = 2): Event[] {
  const counts = new Map<string, number>();
  return list.filter((e) => {
    const key = e.venue_id || e.address || e.title;
    const c = counts.get(key) || 0;
    if (c >= maxPerVenue) return false;
    counts.set(key, c + 1);
    return true;
  });
}

export default function DiscoverScreen() {
  const router = useRouter();
  const location = useLocation();
  const syncStatus = useSyncStatus();
  const [whenFilter, setWhenFilter] = useWhenFilter();
  const [events, setEvents] = useState<Event[]>([]);
  const [picks, setPicks] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterValue>({ categories: [], tags: [], radiusMiles: 5 });
  const [showFilters, setShowFilters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const loadEvents = useCallback(async () => {
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    const categories = filter.categories.length ? filter.categories : prefs?.categories || [];
    const radius = filter.radiusMiles || prefs?.radius || 5;
    const tags = filter.tags.length ? filter.tags : undefined;
    const useLat = prefs?.customLocation?.lat ?? location.lat;
    const useLng = prefs?.customLocation?.lng ?? location.lng;

    const data = await fetchNearbyEvents(
      useLat, useLng, radius,
      categories.length ? categories : undefined,
      tags
    );
    const filtered = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
    const diversified = diversifyByVenue(filtered);

    const goals: string[] = prefs?.onboarding?.goals || [];
    if (goals.length) {
      const scored = diversified
        .map((e) => ({ e, s: scoreEvent(e, goals) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      const top = scored.slice(0, 6).map((x) => x.e);
      const topIds = new Set(top.map((e) => e.id));
      setPicks(top);
      setEvents(diversified.filter((e) => !topIds.has(e.id)));
    } else {
      setPicks([]);
      setEvents(diversified);
    }
  }, [location.lat, location.lng, filter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const handoff = await getFeedHandoff();
      if (handoff && handoff.length > 0 && alive) {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const filteredHandoff = applyHiddenFilter(handoff, prefs?.hiddenCategories, prefs?.hiddenTags);
        const diversified = diversifyByVenue(filteredHandoff);
        const goals: string[] = prefs?.onboarding?.goals || [];
        if (goals.length) {
          const scored = diversified
            .map((e) => ({ e, s: scoreEvent(e, goals) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s);
          const top = scored.slice(0, 6).map((x) => x.e);
          const topIds = new Set(top.map((e) => e.id));
          setPicks(top);
          setEvents(diversified.filter((e) => !topIds.has(e.id)));
        } else {
          setEvents(diversified);
        }
        setLoading(false);
        await clearFeedHandoff();
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!location.loading) {
      setLoading(true);
      loadEvents().finally(() => setLoading(false));
    }
  }, [location.loading, loadEvents]);

  useFocusEffect(
    useCallback(() => {
      if (!location.loading) loadEvents();
    }, [loadEvents, location.loading])
  );

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setSavedIds(new Set(JSON.parse(saved)));
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }, [loadEvents]);

  const toggleSave = async (event: Event) => {
    const newSaved = new Set(savedIds);
    const savedEventsStr = await AsyncStorage.getItem("@nearme_saved_events");
    const savedEvents: Event[] = savedEventsStr ? JSON.parse(savedEventsStr) : [];
    if (newSaved.has(event.id)) {
      newSaved.delete(event.id);
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(savedEvents.filter((e) => e.id !== event.id)));
    } else {
      newSaved.add(event.id);
      if (!savedEvents.find((e) => e.id === event.id)) {
        savedEvents.push(event);
        await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(savedEvents));
      }
    }
    setSavedIds(newSaved);
    await AsyncStorage.setItem("@nearme_saved", JSON.stringify([...newSaved]));
  };

  const now = new Date();
  const whenFiltered = useMemo(
    () => events.filter((e) => matchesWhen(e, whenFilter, now)),
    [events, whenFilter]
  );
  const whenPicks = useMemo(
    () => picks.filter((e) => matchesWhen(e, whenFilter, now)),
    [picks, whenFilter]
  );
  const rows = useMemo(
    () => buildDiscoveryRows(whenFiltered, now, whenPicks),
    [whenFiltered, whenPicks]
  );
  const rowIds = new Set(rows.flatMap((r) => r.events.map((e) => e.id)));
  const flatFeed = whenFiltered.filter((e) => !rowIds.has(e.id));

  const allForSearch = [...picks, ...events];
  const liveCount = useCallback(
    (v: FilterValue) => {
      // Count events matching the draft filter (local approximation)
      return whenFiltered.filter((e) => {
        if (v.categories.length && !v.categories.includes(e.category)) return false;
        if (v.tags.length && !v.tags.some((t) => e.tags?.includes(t))) return false;
        return true;
      }).length;
    },
    [whenFiltered]
  );

  const showingSkeletons = (loading || location.loading) && events.length === 0;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>NearMe</Text>
          <View style={styles.locChip}>
            <Ionicons name="location" size={11} color={COLORS.accent} />
            <Text style={styles.locText} numberOfLines={1}>{location.cityName}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => setShowSearch(true)}
          style={styles.searchPill}
          activeOpacity={0.8}
          accessibilityLabel="Search events"
        >
          <Ionicons name="search" size={16} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      {/* When control */}
      <View style={{ paddingVertical: 8 }}>
        <WhenSegmented value={whenFilter} onChange={setWhenFilter} />
      </View>

      {/* Active filters row */}
      <ActiveFiltersRow value={filter} onPress={() => setShowFilters(true)} />

      {/* Sync banner */}
      {syncStatus.status !== "idle" && (
        <View style={styles.syncBanner}>
          {syncStatus.status === "syncing" ? (
            <>
              <View style={styles.syncDot} />
              <Text style={styles.syncText}>Checking for new events…</Text>
            </>
          ) : syncStatus.count > 0 ? (
            <>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
              <Text style={styles.syncText}>Added {syncStatus.count} new event{syncStatus.count === 1 ? "" : "s"}</Text>
            </>
          ) : null}
        </View>
      )}

      {/* Content */}
      {showingSkeletons ? (
        <FlatList
          data={[0, 1, 2, 3]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <View style={{ marginBottom: 16 }}><SkeletonCard /></View>}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
        />
      ) : rows.length === 0 && flatFeed.length === 0 ? (
        <EmptyState
          icon="radio"
          title="No events nearby"
          body="Try widening your radius in settings or switching the When filter."
          ctaLabel={whenFilter !== "all" ? "Show all times" : undefined}
          onCtaPress={whenFilter !== "all" ? () => setWhenFilter("all") : undefined}
        />
      ) : (
        <FlatList
          data={flatFeed}
          renderItem={({ item }) => (
            <FeedCard
              event={item}
              isSaved={savedIds.has(item.id)}
              onPress={() => router.push(`/event/${item.id}`)}
              onSave={() => toggleSave(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          extraData={[savedIds]}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            rows.length > 0 ? (
              <View style={{ paddingTop: 4 }}>
                {rows.map((r) => (
                  <DiscoveryRow
                    key={r.id}
                    title={r.title}
                    icon={r.icon as any}
                    events={r.events}
                    onPressEvent={(e) => router.push(`/event/${e.id}`)}
                  />
                ))}
                {flatFeed.length > 0 && (
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>ALL EVENTS NEARBY</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
        />
      )}

      <FilterSheet
        visible={showFilters}
        initial={filter}
        liveCount={liveCount}
        onClose={() => setShowFilters(false)}
        onApply={setFilter}
      />

      <SearchOverlay
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        allEvents={allForSearch}
        savedIds={savedIds}
        onPressEvent={(e) => { setShowSearch(false); router.push(`/event/${e.id}`); }}
        onToggleSave={toggleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8, gap: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerTitle: { fontSize: 26, fontWeight: "800", color: COLORS.text, letterSpacing: -0.5 },
  locChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
    flexShrink: 1,
  },
  locText: { fontSize: 12, color: COLORS.text, fontWeight: "600", flexShrink: 1 },
  searchPill: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  syncBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: SPACING.md, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.accent + "15",
    borderRadius: RADIUS.pill, alignSelf: "flex-start",
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  syncText: { fontSize: 12, fontWeight: "600", color: COLORS.accent },
  feed: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, fontWeight: "700", color: COLORS.muted, letterSpacing: 1 },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke-test**

Run app. On Discover, verify:
- Search pill in top-right opens search modal
- When control has 5 chips (All / Tonight / Tomorrow / Weekend / Week) and filters events
- When filter persists across app restart
- Active filters row appears after applying filter in sheet
- Filter sheet shows 4 dimensions (Category, Vibe, Who, Cost) with grouped pills
- Live count updates on Apply button as filters change
- Discovery rows only appear when they have ≥3 events
- Flat feed shows below rows with a divider

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "feat: rewrite Discover with rows, search pill, filter sheet"
```

---

### Task 18: Remove Search tab (tabs 5 → 4)

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Delete: `app/(tabs)/search.tsx`

- [ ] **Step 1: Remove Search from tab layout**

Edit `app/(tabs)/_layout.tsx` — remove the `<Tabs.Screen name="search" …>` block entirely.

- [ ] **Step 2: Delete Search screen**

```bash
rm app/\(tabs\)/search.tsx
```

- [ ] **Step 3: Typecheck & smoke test**

```bash
npx tsc --noEmit
npm start
```
Verify 4 tabs render (Discover · Map · Saved · Settings) and no crash when switching. Search works via the Discover search pill.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/_layout.tsx app/\(tabs\)/search.tsx
git commit -m "feat: remove Search tab (collapsed into Discover search pill)"
```

---

### Task 19: Delete obsolete TagFilter component

**Files:**
- Delete: `src/components/TagFilter.tsx`

- [ ] **Step 1: Verify no remaining imports**

```bash
npx tsc --noEmit
```
If any file still imports `TagFilter`, fix that file's imports — the replacement is `FilterSheet` / `ActiveFiltersRow`. Discover no longer uses TagFilter after Task 17.

- [ ] **Step 2: Delete the file**

```bash
rm src/components/TagFilter.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/TagFilter.tsx
git commit -m "chore: remove obsolete TagFilter component"
```

---

## Phase 4 — Event detail rewrite

### Task 20: Rewrite event detail per spec §5

**Files:**
- Modify: `app/event/[id].tsx`

- [ ] **Step 1: Replace file contents**

Rewrite the full file. Structure:

```tsx
import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Linking, Dimensions, Platform, ActivityIndicator, Share,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchEventById, formatDistance } from "../../src/services/events";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { TAG_MAP } from "../../src/constants/tags";
import { getEventImage } from "../../src/constants/images";
import HeroCard from "../../src/components/HeroCard";
import ViewOriginalLink from "../../src/components/ViewOriginalLink";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";

const { width } = Dimensions.get("window");

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<Event[]>([]);

  useEffect(() => {
    (async () => {
      const savedStr = await AsyncStorage.getItem("@nearme_saved_events");
      const savedArr: Event[] = savedStr ? JSON.parse(savedStr) : [];
      const local = savedArr.find((e) => e.id === id);
      if (local) setEvent(local);
      else {
        const fetched = await fetchEventById(id!);
        if (fetched) setEvent(fetched);
      }
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setIsSaved(JSON.parse(saved).includes(id));
      setLoading(false);
    })();
  }, [id]);

  // Similar nearby — same category OR shared ≥2 tags, within radius
  useEffect(() => {
    if (!event) return;
    (async () => {
      const cache = await AsyncStorage.getItem("@nearme_events_cache");
      if (!cache) return;
      const all: Event[] = JSON.parse(cache);
      const mine = new Set(event.tags || []);
      const candidates = all
        .filter((e) => e.id !== event.id)
        .map((e) => {
          const overlap = (e.tags || []).filter((t) => mine.has(t)).length;
          const cat = e.category === event.category ? 1 : 0;
          return { e, score: overlap + cat * 2 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.e);
      setSimilar(candidates);
    })();
  }, [event]);

  const toggleSave = async () => {
    if (!event) return;
    const savedIds = await AsyncStorage.getItem("@nearme_saved");
    const ids: string[] = savedIds ? JSON.parse(savedIds) : [];
    const savedEvents = await AsyncStorage.getItem("@nearme_saved_events");
    const eventsArr: Event[] = savedEvents ? JSON.parse(savedEvents) : [];
    if (isSaved) {
      await AsyncStorage.setItem("@nearme_saved", JSON.stringify(ids.filter((i) => i !== event.id)));
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(eventsArr.filter((e) => e.id !== event.id)));
      setIsSaved(false);
    } else {
      ids.push(event.id);
      eventsArr.push(event);
      await AsyncStorage.setItem("@nearme_saved", JSON.stringify(ids));
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(eventsArr));
      setIsSaved(true);
    }
  };

  const openDirections = () => {
    if (!event) return;
    const url = Platform.OS === "ios"
      ? `maps:0,0?q=${event.lat},${event.lng}`
      : `geo:${event.lat},${event.lng}?q=${event.lat},${event.lng}`;
    Linking.openURL(url);
  };

  const shareEvent = async () => {
    if (!event) return;
    const start = new Date(event.start_time);
    const dateStr = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const venue = event.venue?.name || event.address?.split(",")[0] || "Nearby";
    const message = `Check out "${event.title}" on NearMe:\n\n📅 ${dateStr} at ${timeStr}\n📍 ${venue}\n\nDiscover local events near you — download NearMe: https://mateo2lit.github.io/NearMe/`;
    try { await Share.share({ message, title: event.title }); } catch {}
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }
  if (!event) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle" size={48} color={COLORS.muted} />
        <Text style={styles.errorText}>Event not found</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const category = CATEGORY_MAP[event.category];
  const start = new Date(event.start_time);
  const end = event.end_time ? new Date(event.end_time) : null;
  const dayStr = start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTimeStr = end ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const whoTag = (event.tags || []).find((t) => TAG_MAP[t]?.dimension === "who");
  const venueName = event.venue?.name || event.address?.split(",")[0] || "Location";
  const distanceStr = event.distance != null ? formatDistance(event.distance) : null;

  const priceStr = event.is_free
    ? "Free"
    : event.price_min && event.price_max
    ? `$${event.price_min}–$${event.price_max}`
    : event.price_min
    ? `$${event.price_min}+`
    : "Tickets";

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroWrap}>
          <Image
            source={{ uri: getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description) }}
            style={styles.heroImage}
          />
          <LinearGradient
            colors={["rgba(15,15,26,0.2)", "rgba(15,15,26,0.4)", "rgba(15,15,26,0.98)"]}
            locations={[0.3, 0.7, 1]}
            style={StyleSheet.absoluteFillObject}
          />

          {/* Floating header */}
          <View style={styles.floatHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity onPress={toggleSave} style={styles.iconBtn} hitSlop={10} accessibilityLabel={isSaved ? "Unsave" : "Save"}>
                <Ionicons name={isSaved ? "heart" : "heart-outline"} size={22} color={isSaved ? COLORS.hot : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={shareEvent} style={styles.iconBtn} hitSlop={10} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Title overlay */}
          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={3}>{event.title}</Text>
            {(category || whoTag) && (
              <View style={styles.titleMeta}>
                {category && (
                  <>
                    <Ionicons name={category.icon as any} size={14} color={category.color} />
                    <Text style={[styles.titleMetaText, { color: category.color }]}>{category.label}</Text>
                  </>
                )}
                {whoTag && (
                  <>
                    <Text style={styles.titleMetaDot}>·</Text>
                    <Text style={styles.titleMetaText}>{TAG_MAP[whoTag].label}</Text>
                  </>
                )}
              </View>
            )}
          </View>
        </View>

        {/* Primary blocks */}
        <View style={styles.blocks}>
          <View style={styles.block}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockLabel}>{dayStr}</Text>
              <Text style={styles.blockValue}>{timeStr}{endTimeStr ? ` – ${endTimeStr}` : ""}</Text>
              {event.is_recurring && (
                <Text style={styles.blockExtra}>
                  {event.recurrence_rule || "Repeats"}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.block}>
            <Ionicons name="location-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockValue}>{venueName}</Text>
              <Text style={styles.blockExtra}>
                {event.address}{distanceStr ? ` · ${distanceStr}` : ""}
              </Text>
              <TouchableOpacity onPress={openDirections} style={styles.miniMapBtn}>
                <Ionicons name="map-outline" size={14} color={COLORS.accent} />
                <Text style={styles.miniMapText}>Open in Maps</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.block}>
            <Ionicons name="pricetag-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockValue}>{priceStr}</Text>
            </View>
          </View>
        </View>

        {/* About */}
        {event.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.body}>{event.description}</Text>
          </View>
        )}

        {/* Tags */}
        {(event.tags || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagRow}>
              {(event.tags || []).map((t, i) => {
                const info = TAG_MAP[t];
                if (!info) return null;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => router.push({ pathname: "/", params: { tag: t } } as any)}
                  >
                    <Text style={styles.tagLink}>
                      {info.label}{i < (event.tags || []).length - 1 ? " · " : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Similar */}
        {similar.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Similar nearby</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {similar.map((s) => (
                <HeroCard key={s.id} event={s} onPress={() => router.push(`/event/${s.id}`)} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* View original */}
        <ViewOriginalLink event={event} variant="row" />
      </ScrollView>

      {/* Sticky action bar */}
      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionSecondary]} onPress={openDirections}>
          <Ionicons name="navigate" size={18} color={COLORS.text} />
          <Text style={[styles.actionText, { color: COLORS.text }]}>Directions</Text>
        </TouchableOpacity>
        {event.ticket_url ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={() => Linking.openURL(event.ticket_url!)}
          >
            <Ionicons name="ticket" size={18} color="#fff" />
            <Text style={styles.actionText}>Get Tickets</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  errorText: { color: COLORS.text, fontSize: 16, marginTop: 16 },
  backBtn: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: COLORS.accent, borderRadius: RADIUS.pill,
  },
  backBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  heroWrap: { width, height: 340, backgroundColor: COLORS.cardAlt },
  heroImage: { width: "100%", height: "100%" },
  floatHeader: {
    position: "absolute", top: 50, left: 16, right: 16,
    flexDirection: "row", justifyContent: "space-between",
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  titleBlock: { position: "absolute", bottom: 20, left: 20, right: 20 },
  title: {
    fontSize: 28, fontWeight: "800", color: "#fff",
    letterSpacing: -0.4, lineHeight: 34,
    textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
  },
  titleMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  titleMetaText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  titleMetaDot: { color: "#fff", fontSize: 13 },
  blocks: { padding: SPACING.md, gap: SPACING.md },
  block: {
    flexDirection: "row", gap: 12,
    backgroundColor: COLORS.card, padding: 14,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  blockLabel: { fontSize: 11, fontWeight: "800", color: COLORS.accent, letterSpacing: 0.5 },
  blockValue: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginTop: 2 },
  blockExtra: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  miniMapBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  miniMapText: { color: COLORS.accent, fontSize: 13, fontWeight: "700" },
  section: { paddingHorizontal: SPACING.md, paddingTop: SPACING.lg },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: COLORS.text, marginBottom: 10, letterSpacing: -0.2 },
  body: { fontSize: 15, color: COLORS.text, lineHeight: 23 },
  tagRow: { flexDirection: "row", flexWrap: "wrap" },
  tagLink: { fontSize: 14, color: COLORS.accent, fontWeight: "600" },
  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: 10,
    padding: SPACING.md, paddingBottom: SPACING.xl,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  actionBtn: {
    flex: 1, flexDirection: "row", gap: 6,
    alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: RADIUS.pill,
  },
  actionSecondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  actionPrimary: { backgroundColor: COLORS.accent },
  actionText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke-test**

Run app. Open an event. Verify:
- Title overlaid on hero with gradient, readable.
- Three primary blocks (When/Where/Cost) at top.
- Tags tappable (tapping navigates to Discover with tag param — deep-link handling is deferred).
- Similar nearby carousel renders when applicable.
- View original link at bottom renders only if `source_url` exists.
- Sticky bottom bar has Directions + Get Tickets (Tickets hidden if no URL).

- [ ] **Step 4: Commit**

```bash
git add app/event/\[id\].tsx
git commit -m "refactor: rewrite event detail (3 primary blocks, sticky actions, view original, similar nearby)"
```

---

## Phase 5 — Map tab rewrite

### Task 21: Install clustering library

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install react-native-map-clustering
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-native-map-clustering"
```

---

### Task 22: MapPin component

**Files:**
- Create: `src/components/MapPin.tsx`

- [ ] **Step 1: Create component**

```tsx
import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CATEGORY_MAP } from "../constants/categories";
import { COLORS } from "../constants/theme";
import { EventCategory } from "../types";

interface Props {
  category: EventCategory;
  selected?: boolean;
}

export default function MapPin({ category, selected }: Props) {
  const cat = CATEGORY_MAP[category];
  const color = cat?.color || COLORS.accent;
  const icon = cat?.icon || "location";
  const size = selected ? 36 : 28;
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size, height: size, borderRadius: size / 2,
          borderColor: color,
          transform: [{ scale: selected ? 1.15 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon as any} size={selected ? 18 : 14} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(15,15,26,0.85)",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MapPin.tsx
git commit -m "feat: MapPin (category-glyph circle pin for map)"
```

---

### Task 23: Rewrite Map screen with clustering + bottom carousel

**Files:**
- Modify: `app/(tabs)/map.tsx`

- [ ] **Step 1: Replace file contents**

```tsx
import { useEffect, useState, useRef, useCallback } from "react";
import { View, StyleSheet, TouchableOpacity, Text, ScrollView, Platform, Dimensions } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import ClusteredMapView from "react-native-map-clustering";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchNearbyEvents, applyHiddenFilter } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { useWhenFilter, WhenFilter } from "../../src/hooks/useWhenFilter";
import MapPin from "../../src/components/MapPin";
import HeroCard from "../../src/components/HeroCard";
import WhenSegmented from "../../src/components/WhenSegmented";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { isTonight, isTomorrow, isThisWeekend } from "../../src/lib/time-windows";

const { width } = Dimensions.get("window");

const mapDarkStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9090b0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e2e4a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f0f1a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
];

function matchesWhen(ev: Event, w: WhenFilter, now: Date): boolean {
  if (w === "all") return true;
  if (w === "tonight") return isTonight(ev.start_time, now);
  if (w === "tomorrow") return isTomorrow(ev.start_time, now);
  if (w === "weekend") return isThisWeekend(ev.start_time, now);
  if (w === "week") {
    const t = new Date(ev.start_time);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return t >= now && t < end;
  }
  return true;
}

export default function MapScreen() {
  const router = useRouter();
  const location = useLocation();
  const [when, setWhen] = useWhenFilter();
  const [events, setEvents] = useState<Event[]>([]);
  const [region, setRegion] = useState<Region | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const carouselRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!location.loading) {
      (async () => {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const data = await fetchNearbyEvents(location.lat, location.lng, prefs?.radius || 5);
        const visible = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
        setEvents(visible);
      })();
      if (!region) {
        setRegion({
          latitude: location.lat,
          longitude: location.lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        });
      }
    }
  }, [location.loading, location.lat, location.lng]);

  const now = new Date();
  const visible = events.filter((e) => matchesWhen(e, when, now));

  // Events currently in viewport (approx — geographic bounds)
  const inViewport = region
    ? visible.filter((e) => {
        const latOK = Math.abs(e.lat - region.latitude) < region.latitudeDelta / 2;
        const lngOK = Math.abs(e.lng - region.longitude) < region.longitudeDelta / 2;
        return latOK && lngOK;
      })
    : visible;

  const recenter = () => {
    mapRef.current?.animateToRegion({
      latitude: location.lat,
      longitude: location.lng,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    });
  };

  const onCardPress = (e: Event) => router.push(`/event/${e.id}`);

  return (
    <View style={styles.container}>
      <ClusteredMapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        customMapStyle={mapDarkStyle}
        initialRegion={
          region || {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: 0.06,
            longitudeDelta: 0.06,
          }
        }
        onRegionChangeComplete={(r: Region) => setRegion(r)}
        showsUserLocation
        showsMyLocationButton={false}
        clusterColor={COLORS.accent}
        clusterTextColor="#fff"
      >
        {visible.map((e) => (
          <Marker
            key={e.id}
            coordinate={{ latitude: e.lat, longitude: e.lng }}
            onPress={(evt) => {
              evt.stopPropagation?.();
              setSelectedId(e.id);
              const idx = inViewport.findIndex((x) => x.id === e.id);
              if (idx >= 0) {
                carouselRef.current?.scrollTo({ x: idx * (160 + 10), animated: true });
              }
            }}
            tracksViewChanges={false}
          >
            <MapPin category={e.category} selected={selectedId === e.id} />
          </Marker>
        ))}
      </ClusteredMapView>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Nearby</Text>
        <Text style={styles.headerLoc}>{location.cityName}</Text>
      </View>

      {/* Recenter */}
      <TouchableOpacity style={styles.recenter} onPress={recenter} accessibilityLabel="Recenter map">
        <Ionicons name="locate" size={20} color={COLORS.text} />
      </TouchableOpacity>

      {/* Bottom: When chips + carousel */}
      <View style={styles.bottomWrap}>
        <View style={styles.whenWrap}>
          <WhenSegmented value={when} onChange={setWhen} />
        </View>
        <ScrollView
          ref={carouselRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carousel}
          snapToInterval={170}
          decelerationRate="fast"
        >
          {inViewport.map((e) => (
            <HeroCard key={e.id} event={e} onPress={() => onCardPress(e)} />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    position: "absolute", top: 60, left: 20,
  },
  headerTitle: {
    fontSize: 24, fontWeight: "800", color: COLORS.text,
    textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 8,
  },
  headerLoc: {
    fontSize: 12, fontWeight: "600", color: COLORS.muted, marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 4,
  },
  recenter: {
    position: "absolute", bottom: 310, right: 20,
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.card + "ee",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  bottomWrap: {
    position: "absolute", bottom: 100, left: 0, right: 0, gap: 10,
  },
  whenWrap: {
    alignSelf: "flex-start", marginLeft: 0,
  },
  carousel: {
    paddingHorizontal: SPACING.md, gap: 10,
  },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
If `ClusteredMapView` has type issues, install types or cast the ref. `react-native-map-clustering` ships its own types; default should work.

- [ ] **Step 3: Smoke-test**

Run app, open Map. Verify:
- Zoomed-out view shows cluster count bubbles (accent purple)
- Zoom in — pins become category glyphs in colored circles
- Tap a pin — pin scales up and carousel scrolls to that card
- Pan map — carousel updates to show visible events
- When chips at bottom filter pins and carousel; value persists when switching to Discover

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/map.tsx
git commit -m "refactor: Map with clustering, glyph pins, bottom carousel, When control"
```

---

## Phase 6 — Saved screen grouping

### Task 24: Saved screen — date grouping + segmented control

**Files:**
- Modify: `app/(tabs)/saved.tsx`

- [ ] **Step 1: Replace file contents**

```tsx
import { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Image, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../../src/types";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { TAG_MAP } from "../../src/constants/tags";
import { getEventImage } from "../../src/constants/images";
import EmptyState from "../../src/components/EmptyState";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";

type SavedMode = "all" | "upcoming" | "past";

type Section = { title: string; data: Event[]; collapsed?: boolean };

function groupEvents(events: Event[], mode: SavedMode, now: Date): Section[] {
  const upcoming: Event[] = [];
  const past: Event[] = [];
  for (const e of events) {
    if (e.start_time && new Date(e.start_time) < now) past.push(e);
    else upcoming.push(e);
  }
  upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  past.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

  if (mode === "past") return past.length ? [{ title: "PAST", data: past }] : [];
  if (mode === "all") return [
    ...(upcoming.length ? [{ title: "UPCOMING", data: upcoming }] : []),
    ...(past.length ? [{ title: "PAST", data: past }] : []),
  ];

  // Upcoming mode — grouped by date bucket
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfThisWeek = new Date(startOfToday);
  endOfThisWeek.setDate(endOfThisWeek.getDate() + (7 - startOfToday.getDay()));
  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  const thisWeek: Event[] = [];
  const nextWeek: Event[] = [];
  const later: Event[] = [];
  for (const e of upcoming) {
    const d = new Date(e.start_time);
    if (d < endOfThisWeek) thisWeek.push(e);
    else if (d < endOfNextWeek) nextWeek.push(e);
    else later.push(e);
  }
  const sections: Section[] = [];
  if (thisWeek.length) sections.push({ title: "THIS WEEK", data: thisWeek });
  if (nextWeek.length) sections.push({ title: "NEXT WEEK", data: nextWeek });
  if (later.length) sections.push({ title: "LATER", data: later });
  if (past.length) sections.push({ title: `PAST (${past.length})`, data: past, collapsed: true });
  return sections;
}

export default function SavedScreen() {
  const router = useRouter();
  const [savedEvents, setSavedEvents] = useState<Event[]>([]);
  const [mode, setMode] = useState<SavedMode>("upcoming");
  const [pastExpanded, setPastExpanded] = useState(false);

  const loadSaved = useCallback(async () => {
    const data = await AsyncStorage.getItem("@nearme_saved_events");
    setSavedEvents(data ? JSON.parse(data) : []);
  }, []);

  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved]));

  const remove = async (id: string) => {
    const next = savedEvents.filter((e) => e.id !== id);
    setSavedEvents(next);
    await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(next));
    await AsyncStorage.setItem("@nearme_saved", JSON.stringify(next.map((e) => e.id)));
  };

  const confirmRemove = (e: Event) => {
    Alert.alert("Remove from saved?", e.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(e.id) },
    ]);
  };

  const sections = useMemo(
    () => groupEvents(savedEvents, mode, new Date()).map((s) =>
      s.collapsed && !pastExpanded ? { ...s, data: [] } : s
    ),
    [savedEvents, mode, pastExpanded]
  );

  if (savedEvents.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Saved</Text>
        </View>
        <EmptyState
          icon="heart-outline"
          title="No saved events yet"
          body="Tap the heart on events you want to remember. They'll show up here, grouped by date."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>
            {savedEvents.length} event{savedEvents.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      <View style={styles.segRow}>
        {(["upcoming", "all", "past"] as SavedMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segBtn, mode === m && styles.segBtnActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segText, mode === m && styles.segTextActive]}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => {
          const isPast = section.title.startsWith("PAST");
          if (isPast && !pastExpanded) {
            return (
              <TouchableOpacity
                style={styles.pastHeaderCollapsed}
                onPress={() => setPastExpanded(true)}
              >
                <Text style={styles.sectionHeader}>{section.title}</Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
              </TouchableOpacity>
            );
          }
          return <Text style={styles.sectionHeader}>{section.title}</Text>;
        }}
        renderItem={({ item }) => {
          const category = CATEGORY_MAP[item.category];
          const startDate = new Date(item.start_time);
          const day = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
          const soon = startDate.getTime() - Date.now() < 24 * 3600_000 && startDate.getTime() > Date.now();
          return (
            <TouchableOpacity
              style={[styles.card, soon && styles.cardSoon]}
              onPress={() => router.push(`/event/${item.id}`)}
              onLongPress={() => confirmRemove(item)}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: getEventImage(item.image_url, item.category, item.subcategory, item.title, item.description) }}
                style={styles.cardImage}
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardDay}>{day}</Text>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                {category && (
                  <View style={styles.cardMeta}>
                    <View style={[styles.catDot, { backgroundColor: category.color }]} />
                    <Text style={styles.catText}>{category.label}</Text>
                  </View>
                )}
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.muted} style={{ alignSelf: "center", marginRight: 10 }} />
            </TouchableOpacity>
          );
        }}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 64, paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: "800", color: COLORS.text, letterSpacing: -0.5 },
  countBadge: {
    backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  countText: { fontSize: 13, color: COLORS.muted, fontWeight: "600" },
  segRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: SPACING.md, paddingBottom: 12,
  },
  segBtn: {
    flex: 1, paddingVertical: 9, alignItems: "center",
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border,
  },
  segBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  segText: { fontSize: 13, fontWeight: "700", color: COLORS.muted },
  segTextActive: { color: "#fff" },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 24 },
  sectionHeader: {
    fontSize: 11, fontWeight: "800", color: COLORS.muted,
    letterSpacing: 1, marginTop: 16, marginBottom: 8,
  },
  pastHeaderCollapsed: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, marginTop: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 10, overflow: "hidden",
  },
  cardSoon: {
    borderLeftWidth: 3, borderLeftColor: COLORS.accent,
  },
  cardImage: { width: 86, height: 86, borderTopLeftRadius: RADIUS.md, borderBottomLeftRadius: RADIUS.md },
  cardBody: { flex: 1, padding: 10, justifyContent: "center", gap: 2 },
  cardDay: { fontSize: 10, fontWeight: "800", color: COLORS.accent, letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catText: { fontSize: 12, color: COLORS.muted },
});
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke-test**

Save a few events across different dates. Open Saved. Verify:
- Segmented control: Upcoming / All / Past.
- Upcoming mode shows sections: THIS WEEK, NEXT WEEK, LATER, and PAST (collapsed, tap to expand).
- Long-press on a card shows "Remove from saved?" alert.
- Events starting within 24h show a 3px accent left border.
- Empty state updated to the correct copy.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/saved.tsx
git commit -m "refactor: Saved with date grouping, segmented mode, long-press remove, collapsed past"
```

---

## Phase 7 — Polish & accessibility

### Task 25: Spec-parity pass (accessibility + empty states everywhere)

**Files:**
- Modify: `src/components/FeedCard.tsx` (accessibilityLabel on save btn — done in Task 11, verify)
- Modify: `app/(tabs)/map.tsx` (accessibilityLabel on recenter — done in Task 23, verify)
- Modify: `app/event/[id].tsx` (accessibilityLabel on icon buttons — done in Task 20, verify)

- [ ] **Step 1: Audit for missing `accessibilityLabel`**

```bash
npx grep -r "Ionicons" src/components app --include="*.tsx" -l
```

For each icon-only `TouchableOpacity`, add `accessibilityLabel={...}` and verify hit-slop gives ≥44×44.

- [ ] **Step 2: Final smoke-test**

Enable VoiceOver/TalkBack on a device. Navigate through Discover, Map, Saved, Event detail. Confirm icon buttons announce meaningful labels.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "a11y: final pass on accessibilityLabels and hit slop"
```

---

### Task 26: Reduce-motion + haptics

**Files:**
- Modify: `src/components/FeedCard.tsx`

- [ ] **Step 1: Install `expo-haptics`**

```bash
npx expo install expo-haptics
```

- [ ] **Step 2: Add haptic to save action (FeedCard)**

In `FeedCard.tsx`, import and wrap `onSave`:
```tsx
import * as Haptics from "expo-haptics";
// …
const handleSave = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  onSave();
};
// replace onPress={onSave} with onPress={handleSave}
```

- [ ] **Step 3: Smoke-test**

Tap heart on a card — feel a light haptic on iOS. On Android, haptic may be minor/silent depending on device settings.

- [ ] **Step 4: Commit**

```bash
git add src/components/FeedCard.tsx package.json package-lock.json
git commit -m "feat: light haptic on save, add expo-haptics"
```

---

### Task 27: Deep-link tag from detail back to Discover

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Accept `tag` search param**

At the top of `DiscoverScreen`:
```tsx
import { useLocalSearchParams } from "expo-router";
// …
const params = useLocalSearchParams<{ tag?: string }>();

useEffect(() => {
  if (params.tag) {
    setFilter((f) => ({ ...f, tags: Array.from(new Set([...f.tags, params.tag!])) }));
  }
}, [params.tag]);
```

- [ ] **Step 2: Smoke-test**

From an event detail, tap a tag. Verify you land on Discover with the tag pre-applied in filters, and the active-filters row shows it.

- [ ] **Step 3: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "feat: tag taps from event detail deep-link into Discover filter"
```

---

## Self-review notes

**Spec coverage check:**

| Spec section | Task |
|---|---|
| §1 IA + 4 tabs | 18 |
| §1 Tag dimensions | 5 |
| §1 When as first-class | 13, 17 |
| §2 Color tokens | 4 |
| §2 Radius simplification | 4 |
| §2 Surfaces | 4 |
| §3 Discover rows | 10, 17 |
| §3 Search pill | 16, 17 |
| §3 Filter sheet | 14, 15 |
| §4 FeedCard rewrite | 11 |
| §4 HeroCard | 8 |
| §5 Event detail | 20 |
| §5 Similar nearby | 20 |
| §5 View original | 7, 20 |
| §6 Map clustering | 21, 22, 23 |
| §6 Map bottom carousel | 23 |
| §6 Shared When state | 12, 13, 17, 23 |
| §7 Saved grouping | 24 |
| §7 Saved long-press remove | 24 |
| §8 Empty states | 9, 17, 24 |
| §8 Microcopy | 17, 24 (embedded) |
| §8 A11y hit-slop / labels | 25 |
| §8 Motion / haptics | 26 |
| §9 View original ubiquity | 7, 20 (detail); Map bottom card — **not explicitly added** |

**Gap filled:** Map bottom carousel shows a HeroCard on tap of a pin. Adding "View on {source}" inline link to the Map bottom card carousel is small polish and is deferred — HeroCard in carousel tapping opens the detail which has the View original link. This is acceptable and documented here as explicit deferral.

**Placeholder scan:** No TBDs, no "implement later", no generic error-handling prescriptions. All code blocks are complete.

**Type consistency:** `WhenFilter` type shared between hook and `matchesWhen` helper (duplicated in Discover and Map — acceptable; a single shared helper would be a small refactor opportunity but not required).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-16-nearme-redesign.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
