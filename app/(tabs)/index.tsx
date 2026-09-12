import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl,
  Animated, Easing, AccessibilityInfo, ScrollView,
} from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
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
import { SyncStatusBanner } from "../../src/components/SyncStatusBanner";
import { BouncingDots } from "../../src/components/BouncingDots";
import { fetchNearbyEvents, applyHiddenFilter, filterPastEvents, filterHappyHour, sortByStartTime, dedupeSameDayDuplicates, balanceSources, balanceCategories, getLastFetchError, clearLastFetchError, formatDistance } from "../../src/services/events";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../src/services/supabase";
import { getFeedHandoff, clearFeedHandoff } from "../../src/services/eventCache";
import { useLocation } from "../../src/hooks/useLocation";
import { useSyncStatus } from "../../src/hooks/useSyncStatus";
import { useWhenFilter, WhenFilter } from "../../src/hooks/useWhenFilter";
import { COLORS, RADIUS, DEFAULT_RADIUS_MILES } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { buildDiscoveryRows } from "../../src/lib/rows";
import { isTonight, isTomorrow, isThisWeekend, effectiveStart, isHappeningNow, isHappeningNowOrSoon } from "../../src/lib/time-windows";
import { useClaudeRefresh, applyRanking } from "../../src/hooks/useClaudeRefresh";
import { ClaudeRefreshOverlay } from "../../src/components/ClaudeRefreshOverlay";
import { getOrCreateUserId } from "../../src/hooks/usePreferences";
import { useRatingTriggers } from "../../src/hooks/useRatingTriggers";
import { RatingPrompt } from "../../src/components/RatingPrompt";
import { geohashEncode } from "../../src/lib/geohash";
import {
  cancelReminderForEvent, ensurePermissions, scheduleReminderForEvent,
} from "../../src/services/reminders";

const FIRST_REFRESH_KEY = "@nearme_first_claude_refresh_done";

type MoodKey = "any" | "play" | "drinks" | "party" | "meet" | "cheap" | "hidden";

interface MoodOption {
  key: MoodKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  categories: string[];
  tags: string[];
  accent: string;
}

const MOODS: MoodOption[] = [
  { key: "any", label: "Anything", icon: "sparkles", categories: [], tags: [], accent: COLORS.accentLight },
  { key: "play", label: "Play", icon: "football", categories: ["sports", "fitness", "outdoors"], tags: ["active", "outdoor"], accent: COLORS.success },
  { key: "drinks", label: "Drinks", icon: "beer", categories: ["nightlife", "food"], tags: ["drinking", "21+"], accent: COLORS.warm },
  { key: "party", label: "Party", icon: "flash", categories: ["nightlife", "music"], tags: ["late-night", "drinking", "live-music", "21+"], accent: COLORS.hot },
  { key: "meet", label: "Meet", icon: "people", categories: ["community", "nightlife", "sports", "fitness"], tags: ["singles", "date-night", "active"], accent: "#3b9cff" },
  { key: "cheap", label: "Free", icon: "gift", categories: [], tags: ["free"], accent: COLORS.success },
  { key: "hidden", label: "Different", icon: "planet", categories: ["arts", "community", "movies", "outdoors"], tags: ["live-music", "outdoor"], accent: "#ff6b9d" },
];

const MOOD_BY_KEY = Object.fromEntries(MOODS.map((m) => [m.key, m])) as Record<MoodKey, MoodOption>;

function eventText(e: Event): string {
  return `${e.title} ${e.description || ""} ${e.subcategory || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
}

function eventMatchesMood(e: Event, moodKey: MoodKey): boolean {
  if (moodKey === "any") return true;
  const mood = MOOD_BY_KEY[moodKey];
  if (!mood) return true;
  const text = eventText(e);
  if (moodKey === "cheap") return e.is_free || e.tags?.includes("free") || text.includes("free ");
  if (mood.categories.includes(e.category)) return true;
  if ((e.tags || []).some((t) => mood.tags.includes(t))) return true;
  if (moodKey === "play") return /(pickleball|basketball|soccer|volleyball|tennis|run club|running|yoga|pickup)/.test(text);
  if (moodKey === "drinks") return /(happy hour|brewery|cocktail|wine|beer|bar|tasting)/.test(text);
  if (moodKey === "party") return /(dj|dance|club|party|latin night|salsa|bachata|late night)/.test(text);
  if (moodKey === "meet") return /(singles|mixer|trivia|game night|open mic|meetup|social)/.test(text);
  if (moodKey === "hidden") return /(popup|pop-up|gallery|festival|comedy|open mic|market|workshop|oddities)/.test(text);
  return false;
}

function moodMatchScore(e: Event, moodKey: MoodKey): number {
  if (moodKey === "any") return 0;
  const mood = MOOD_BY_KEY[moodKey];
  if (!mood) return 0;
  let score = 0;
  if (mood.categories.includes(e.category)) score += 12;
  for (const tag of e.tags || []) if (mood.tags.includes(tag)) score += 8;
  if (eventMatchesMood(e, moodKey)) score += 5;
  return score;
}

function eventUrgencyScore(e: Event, now: Date, moodKey: MoodKey): number {
  const start = effectiveStart(e).getTime();
  const minutes = Math.round((start - now.getTime()) / 60000);
  let score = moodMatchScore(e, moodKey);
  if (isHappeningNow(e, now)) score += 120;
  else if (minutes >= 0 && minutes <= 60) score += 95;
  else if (minutes <= 180) score += 72;
  else if (minutes <= 360) score += 48;
  else if (isTonight(e, now)) score += 28;
  if (e.distance != null) score += Math.max(0, 24 - e.distance * 2);
  if (e.source === "ticketmaster" || e.source === "meetup" || e.source === "university") score += 8;
  if (e.source === "scraped" || e.source === "claude") score += 4;
  if (e.is_free) score += 5;
  if (e.image_url) score += 3;
  return score;
}

function buildNowQueue(events: Event[], now: Date, moodKey: MoodKey): Event[] {
  const pool = events.filter((e) =>
    isHappeningNowOrSoon(e, 6, now) || isTonight(e, now)
  );
  return [...pool]
    .sort((a, b) => eventUrgencyScore(b, now, moodKey) - eventUrgencyScore(a, now, moodKey))
    .slice(0, 5);
}

function urgentLabel(e: Event, now: Date): string {
  if (isHappeningNow(e, now)) return "Happening now";
  const start = effectiveStart(e).getTime();
  const mins = Math.max(0, Math.round((start - now.getTime()) / 60000));
  if (mins < 60) return `Starts in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours <= 6) return `Starts in ${hours}h`;
  return isTonight(e, now) ? "Tonight" : "Next up";
}

function matchesWhen(ev: Event, w: WhenFilter, now: Date): boolean {
  if (w === "all") return true;
  if (w === "tonight") return isTonight(ev, now);
  if (w === "tomorrow") return isTomorrow(ev, now);
  if (w === "weekend") return isThisWeekend(ev, now);
  if (w === "week") {
    const t = effectiveStart(ev);
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

// Drop-in animation for newly-arrived events (D5). Mounts at translateY=12,
// opacity=0 and animates to rest. Reduced-motion users get an instant render.
function AnimatedFeedRow({
  children,
  animate,
}: {
  children: React.ReactNode;
  animate: boolean;
}) {
  const value = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      reduceMotion.current = v;
    });
  }, []);

  useEffect(() => {
    if (!animate) return;
    Animated.timing(value, {
      toValue: 1,
      duration: reduceMotion.current ? 0 : 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animate, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View style={{ opacity: value, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

function applyVenueCap(list: Event[], maxPerVenue: number): Event[] {
  const counts = new Map<string, number>();
  return list.filter((e) => {
    const key = e.venue_id || e.address || e.title;
    const c = counts.get(key) || 0;
    if (c >= maxPerVenue) return false;
    counts.set(key, c + 1);
    return true;
  });
}

// Two-mode venue diversification:
//   variety mode (cap=3): preferred when supply is ≥ target
//   volume  mode (cap=8): fallback when tight cap drops us below target
// Pack-the-feed memory: floor of ~20 events trumps variety. Above the floor,
// tighten to keep clusters in check.
function diversifyByVenue(list: Event[], targetCount = 20): Event[] {
  const tight = applyVenueCap(list, 3);
  if (tight.length >= targetCount) return tight;
  return applyVenueCap(list, 8);
}

function MoodRail({
  active,
  onChange,
}: {
  active: MoodKey;
  onChange: (mood: MoodKey) => void;
}) {
  return (
    <View style={styles.moodWrap}>
      <Text style={styles.moodEyebrow}>What are you trying to do?</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moodScroll}
      >
        {MOODS.map((mood) => {
          const selected = mood.key === active;
          return (
            <TouchableOpacity
              key={mood.key}
              style={[
                styles.moodChip,
                selected && {
                  backgroundColor: mood.accent + "22",
                  borderColor: mood.accent + "AA",
                },
              ]}
              onPress={() => onChange(mood.key)}
              activeOpacity={0.78}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`Show ${mood.label.toLowerCase()} events`}
            >
              <Ionicons
                name={mood.icon}
                size={15}
                color={selected ? mood.accent : COLORS.muted}
              />
              <Text style={[styles.moodText, selected && { color: COLORS.text }]}>
                {mood.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function NowRail({
  events,
  activeMood,
  cityName,
  onPressEvent,
  onScout,
  scouting,
}: {
  events: Event[];
  activeMood: MoodKey;
  cityName?: string | null;
  onPressEvent: (e: Event) => void;
  onScout: () => void;
  scouting: boolean;
}) {
  const primary = events[0];
  const mood = MOOD_BY_KEY[activeMood];
  const locationLabel = cityName ? `near ${cityName}` : "near you";
  const title = activeMood === "any" ? "Happening now & soon" : `${mood.label} happening soon`;

  return (
    <View style={styles.nowRail}>
      <View style={styles.nowRailHeader}>
        <View style={styles.nowRailTitleWrap}>
          <View style={styles.nowRailTitleRow}>
            <View style={styles.nowLiveDot} />
            <Text style={styles.nowRailTitle}>{title}</Text>
          </View>
          <Text style={styles.nowRailSub}>
            {primary ? `${events.length} good option${events.length === 1 ? "" : "s"} ${locationLabel}` : `Scout can check deeper ${locationLabel}`}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.scoutMiniButton, scouting && styles.scoutButtonActive]}
          onPress={onScout}
          activeOpacity={0.75}
          disabled={scouting}
          accessibilityLabel="Scout for more events right now"
        >
          <Ionicons
            name={scouting ? "radio" : "sparkles"}
            size={16}
            color={scouting ? COLORS.success : COLORS.accentLight}
          />
          <Text style={styles.scoutMiniText}>{scouting ? "Scouting" : "Scout"}</Text>
        </TouchableOpacity>
      </View>

      {events.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.nowCardScroll}
        >
          {events.map((event) => (
            <TouchableOpacity
              key={event.id}
              style={styles.nowCard}
              onPress={() => onPressEvent(event)}
              activeOpacity={0.86}
              accessibilityLabel={`Open ${event.title}`}
            >
              <Text style={styles.nowCardTime}>{urgentLabel(event, new Date())}</Text>
              <Text style={styles.nowCardTitle} numberOfLines={2}>
                {event.title}
              </Text>
              <Text style={styles.nowCardMeta} numberOfLines={1}>
                {(event.venue?.name || event.address?.split(",")[0] || "Nearby")}
                {event.distance != null ? ` · ${formatDistance(event.distance)}` : ""}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : (
        <TouchableOpacity
          style={styles.nowInlineEmpty}
          onPress={onScout}
          activeOpacity={0.78}
          disabled={scouting}
          accessibilityLabel="Scout for events happening tonight"
        >
          <Ionicons name="radio-outline" size={17} color={COLORS.muted} />
          <Text style={styles.nowInlineEmptyText}>
            No right-now picks loaded yet. Scout can look deeper.
          </Text>
          <Ionicons name="chevron-forward" size={17} color={COLORS.muted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

interface PipelinePrefs {
  hiddenCategories?: string[];
  hiddenTags?: string[];
  happyHourEnabled?: boolean;
  onboarding?: { goals?: string[] };
  hiddenRowIds?: string[];
}

interface PipelineResult {
  diversified: Event[];
  picks: Event[];
  goals: string[];
  hiddenRowIds: string[];
}

// Single source of truth for turning raw events into the diversified feed
// + goal-based picks. Used by both loadEvents() and the onboarding handoff
// effect so they can never drift.
function applyFeedPipeline(raw: Event[], prefs: PipelinePrefs | null): PipelineResult {
  const happyHourEnabled = prefs?.happyHourEnabled ?? true;
  const hidden = applyHiddenFilter(raw, prefs?.hiddenCategories, prefs?.hiddenTags);
  const filteredHH = filterHappyHour(hidden, happyHourEnabled);
  const deduped = dedupeSameDayDuplicates(filteredHH);
  const diversified = balanceCategories(
    balanceSources(diversifyByVenue(deduped), deduped),
    deduped,
  );
  const goals: string[] = prefs?.onboarding?.goals || [];
  let picks: Event[] = [];
  if (goals.length) {
    picks = diversified
      .map((e) => ({ e, s: scoreEvent(e, goals) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map((x) => x.e);
  }
  return { diversified, picks, goals, hiddenRowIds: prefs?.hiddenRowIds || [] };
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
  const [filter, setFilter] = useState<FilterValue>({ categories: [], tags: [], radiusMiles: DEFAULT_RADIUS_MILES });
  const [showFilters, setShowFilters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [activeMood, setActiveMood] = useState<MoodKey>("any");
  const [goals, setGoals] = useState<string[]>([]);
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [userInterests, setUserInterests] = useState<{ categories: string[]; tags: string[]; goals: string[] }>({ categories: [], tags: [], goals: [] });

  const claude = useClaudeRefresh({ supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });

  const ratingTrigger = useRatingTriggers();
  const [ratingUserId, setRatingUserId] = useState<string>("");
  useEffect(() => {
    getOrCreateUserId().then(setRatingUserId);
  }, []);

  const params = useLocalSearchParams<{ tag?: string }>();
  useEffect(() => {
    if (params.tag) {
      setFilter((f) => ({ ...f, tags: Array.from(new Set([...f.tags, params.tag!])) }));
    }
  }, [params.tag]);

  const loadEvents = useCallback(async () => {
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    // Settings (prefs.radius) is the user's primary radius control. FilterSheet's
    // value is dead-weight today (no radius UI in the sheet) — it just defaults to
    // DEFAULT_RADIUS_MILES. Prefs wins so the Settings slider actually applies.
    const radius = prefs?.radius || filter.radiusMiles || DEFAULT_RADIUS_MILES;
    const useLat = prefs?.customLocation?.lat ?? location.lat;
    const useLng = prefs?.customLocation?.lng ?? location.lng;

    // No usable location — leave the feed empty so the empty-state CTA can
    // route the user to Settings to set one. Don't pass null lat/lng to the
    // RPC, which would silently return [].
    if (useLat == null || useLng == null) {
      setEvents([]);
      setPicks([]);
      return;
    }

    // Only the FilterSheet narrows the server-side query. Onboarding interests
    // (prefs.categories) curate via scoring, not by removing events.
    const explicitCategories = filter.categories.length ? filter.categories : undefined;
    const explicitTags = filter.tags.length ? filter.tags : undefined;

    clearLastFetchError();
    const data = await fetchNearbyEvents(useLat, useLng, radius, explicitCategories, explicitTags);
    setFetchError(getLastFetchError());
    const result = applyFeedPipeline(data, prefs);
    setGoals(result.goals);
    setHiddenRowIds(result.hiddenRowIds);
    setPicks(result.picks);
    setUserInterests({
      categories: prefs?.categories || [],
      tags: prefs?.tags || [],
      goals: result.goals,
    });
    // events is the canonical full list — picks are derived for the row
    // builder, but they still appear in the chronological list below.
    setEvents(result.diversified);
  }, [location.lat, location.lng, filter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const handoff = await getFeedHandoff();
      if (handoff && handoff.length > 0 && alive) {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const fresh = filterPastEvents(handoff);
        const result = applyFeedPipeline(fresh, prefs);
        setGoals(result.goals);
        setHiddenRowIds(result.hiddenRowIds);
        setPicks(result.picks);
        setEvents(result.diversified);
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
    if (!location.lat || !location.lng) return;
    // Guard against concurrent starts: if a prior refresh is still streaming
    // (phase1/phase2) or about to, ignore this trigger. Otherwise re-focusing
    // the tab can fire claude.start() while the previous run is still active.
    if (claude.state.state !== "idle" && claude.state.state !== "done" && claude.state.state !== "error") {
      return;
    }
    const userId = await getOrCreateUserId();
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    await claude.start({
      userId,
      lat: location.lat,
      lng: location.lng,
      radiusMiles: prefs?.radius || filter.radiusMiles || DEFAULT_RADIUS_MILES,
      geohash: geohashEncode(location.lat, location.lng, 5),
      knownEventIds: events.map((e) => e.id),
      neighborhood: syncStatus.context.neighborhood,
      wellCovered: syncStatus.context.wellCovered,
      underRepresented: syncStatus.context.underRepresented,
    });
    await loadEvents();
  }, [location.lat, location.lng, filter.radiusMiles, events, claude, loadEvents, syncStatus.context]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const done = await AsyncStorage.getItem(FIRST_REFRESH_KEY);
        if (done || cancelled || !location.lat) return;
        await onRefresh();
        await AsyncStorage.setItem(FIRST_REFRESH_KEY, "true");
      })();
      return () => { cancelled = true; };
    }, [location.lat, onRefresh])
  );

  const toggleSave = async (event: Event) => {
    // Read-once: the previous version read @nearme_saved_events twice when
    // unsaving, and conditionally wrote when saving. Now we read once, mutate
    // a local array, and write the final state back.
    const newSaved = new Set(savedIds);
    const savedEventsStr = await AsyncStorage.getItem("@nearme_saved_events");
    const savedEvents: Event[] = savedEventsStr ? JSON.parse(savedEventsStr) : [];
    let nextSavedEvents = savedEvents;
    const isUnsave = newSaved.has(event.id);
    if (isUnsave) {
      newSaved.delete(event.id);
      nextSavedEvents = savedEvents.filter((e) => e.id !== event.id);
    } else {
      newSaved.add(event.id);
      if (!savedEvents.find((e) => e.id === event.id)) {
        nextSavedEvents = [...savedEvents, event];
      }
    }
    setSavedIds(newSaved);
    await AsyncStorage.multiSet([
      ["@nearme_saved_events", JSON.stringify(nextSavedEvents)],
      ["@nearme_saved", JSON.stringify([...newSaved])],
    ]);

    // Reminder side-effect — fire-and-forget so the heart toggles instantly.
    // Reads remindersEnabled + quietHours each time so a Settings change
    // takes effect immediately on the next save.
    (async () => {
      try {
        if (isUnsave) {
          await cancelReminderForEvent(event.id);
          return;
        }
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        if (prefs?.remindersEnabled === false) return;
        const granted = await ensurePermissions();
        if (!granted) return;
        await scheduleReminderForEvent(event, {
          quietHours: prefs?.quietHours || { start: 22, end: 8 },
        });
      } catch { /* best-effort */ }
    })();
  };

  const now = new Date();
  const moodFilteredEvents = useMemo(() => {
    if (activeMood === "any") return events;
    return events.filter((e) => eventMatchesMood(e, activeMood));
  }, [events, activeMood]);
  const whenFiltered = useMemo(
    () => moodFilteredEvents.filter((e) => matchesWhen(e, whenFilter, now)),
    [moodFilteredEvents, whenFilter]
  );
  const whenPicks = useMemo(
    () => picks
      .filter((e) => eventMatchesMood(e, activeMood))
      .filter((e) => matchesWhen(e, whenFilter, now)),
    [picks, activeMood, whenFilter]
  );
  const nowQueue = useMemo(
    () => buildNowQueue(whenFiltered, now, activeMood),
    [whenFiltered, activeMood]
  );
  const rows = useMemo(
    () => buildDiscoveryRows(whenFiltered, now, whenPicks, goals, hiddenRowIds),
    [whenFiltered, whenPicks, goals, hiddenRowIds]
  );
  // Show ALL events chronologically below the curated rows. Rows are
  // highlights overlaying this list, not a partition that subtracts from
  // it — users want the canonical full list always visible.
  const flatFeed = useMemo(() => {
    if (!claude.state.ranking.length) return sortByStartTime(whenFiltered);
    const merged = applyRanking(whenFiltered, claude.state.ranking);
    const claudeOnes = merged.filter((e) => e.source === "claude");
    const others = merged.filter((e) => e.source !== "claude");
    return [...claudeOnes, ...others];
  }, [whenFiltered, claude.state.ranking]);

  const allForSearch = events;
  const liveCount = useCallback(
    (v: FilterValue) => {
      return whenFiltered.filter((e) => {
        if (v.categories.length && !v.categories.includes(e.category)) return false;
        if (v.tags.length && !v.tags.some((t) => e.tags?.includes(t))) return false;
        return true;
      }).length;
    },
    [whenFiltered]
  );

  const showingSkeletons = (loading || location.loading) && events.length === 0;

  // Track newly-arrived event IDs so AnimatedFeedRow only animates those
  // (otherwise the initial 20-event render would all animate at once).
  // The Set is owned by a ref and only rebuilt when flatFeed actually changes,
  // not on every unrelated re-render.
  const newIdsRef = useRef<Set<string>>(new Set());
  const prevIdsRef = useRef<Set<string>>(new Set());
  const flatFeedKey = useMemo(() => flatFeed.map((e) => e.id).join("|"), [flatFeed]);

  useEffect(() => {
    const currentIds = new Set(flatFeed.map((e) => e.id));
    if (prevIdsRef.current.size > 0) {
      const fresh = new Set<string>();
      currentIds.forEach((id) => {
        if (!prevIdsRef.current.has(id)) fresh.add(id);
      });
      newIdsRef.current = fresh;
    }
    prevIdsRef.current = currentIds;
    // Clear after animation duration so subsequent re-renders don't reanimate
    const t = setTimeout(() => { newIdsRef.current = new Set(); }, 400);
    return () => clearTimeout(t);
  }, [flatFeedKey]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>NearMe</Text>
          <TouchableOpacity
            style={styles.locChip}
            onPress={() => router.push("/(tabs)/settings")}
            activeOpacity={0.7}
          >
            <Ionicons name="location" size={11} color={COLORS.accent} />
            <Text style={styles.locText} numberOfLines={1}>
              {location.cityName || "Set location"}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => {
              if (events.length === 0) return;
              const pick = events[Math.floor(Math.random() * events.length)];
              router.push(`/event/${pick.id}`);
            }}
            style={[styles.searchPill, styles.luckyPill]}
            activeOpacity={0.8}
            accessibilityLabel="Pick something random for me"
          >
            <Ionicons name="shuffle" size={16} color={COLORS.accentLight} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowSearch(true)}
            style={styles.searchPill}
            activeOpacity={0.8}
            accessibilityLabel="Search events"
          >
            <Ionicons name="search" size={16} color={COLORS.muted} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ paddingVertical: 8 }}>
        <WhenSegmented value={whenFilter} onChange={setWhenFilter} />
      </View>

      <ActiveFiltersRow value={filter} onPress={() => setShowFilters(true)} />

      <SyncStatusBanner
        syncing={
          syncStatus.status === "syncing" ||
          claude.state.state === "phase1" ||
          claude.state.state === "phase2"
        }
        doneCount={syncStatus.status === "done" ? syncStatus.count : 0}
        foundCount={claude.state.foundEvents.length}
      />

      {showingSkeletons ? (
        <FlatList
          data={[0, 1, 2, 3]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <View style={{ marginBottom: 16 }}><SkeletonCard /></View>}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
        />
      ) : location.needsSetup || (location.lat == null && !location.loading) ? (
        <EmptyState
          icon="location-outline"
          title="Set your location to see events"
          body="We need a location to find events near you. Allow GPS or pick a city in Settings."
          ctaLabel="Open Settings"
          onCtaPress={() => router.push("/(tabs)/settings")}
        />
      ) : rows.length === 0 && flatFeed.length === 0 && fetchError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't reach the feed"
          body="Connection hiccup or our service is briefly down. Pull down to retry."
          ctaLabel="Retry"
          onCtaPress={() => {
            setLoading(true);
            loadEvents().finally(() => setLoading(false));
          }}
        />
      ) : activeMood !== "any" && rows.length === 0 && flatFeed.length === 0 ? (
        <EmptyState
          icon={MOOD_BY_KEY[activeMood].icon}
          title={`No ${MOOD_BY_KEY[activeMood].label.toLowerCase()} picks right now`}
          body="Try another mood, show everything nearby, or Scout for fresh events happening tonight."
          ctaLabel="Show anything"
          onCtaPress={() => setActiveMood("any")}
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
            <AnimatedFeedRow animate={newIdsRef.current.has(item.id)}>
              <FeedCard
                event={item}
                isSaved={savedIds.has(item.id)}
                onPress={() => router.push(`/event/${item.id}`)}
                onSave={() => toggleSave(item)}
                userInterests={userInterests}
              />
            </AnimatedFeedRow>
          )}
          keyExtractor={(item) => item.id}
          extraData={[savedIds]}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            flatFeed.length > 0 || rows.length > 0 ? (
              <View style={{ paddingTop: 4 }}>
                <MoodRail active={activeMood} onChange={setActiveMood} />
                <NowRail
                  events={nowQueue}
                  activeMood={activeMood}
                  cityName={location.cityName}
                  onPressEvent={(e) => router.push(`/event/${e.id}`)}
                  onScout={onRefresh}
                  scouting={claude.state.state === "phase1" || claude.state.state === "phase2"}
                />
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
            <RefreshControl
              refreshing={claude.state.state === "phase1" || claude.state.state === "phase2"}
              onRefresh={onRefresh}
              tintColor={COLORS.accent}
            />
          }
          ListFooterComponent={
            syncStatus.status === "syncing" ||
            claude.state.state === "phase1" ||
            claude.state.state === "phase2" ? (
              <View style={styles.loadingFooter}>
                <Ionicons name="sparkles" size={13} color={COLORS.accentLight} />
                <Text style={styles.loadingFooterText}>
                  {claude.state.foundEvents.length > 0
                    ? `Still finding more — ${claude.state.foundEvents.length} fresh pick${claude.state.foundEvents.length === 1 ? "" : "s"} added`
                    : "Still finding more for you…"}
                </Text>
                <BouncingDots size={7} />
              </View>
            ) : syncStatus.status === "done" && syncStatus.count > 0 ? (
              <View style={styles.loadingFooter}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                <Text style={[styles.loadingFooterText, { color: COLORS.success }]}>
                  Found {syncStatus.count} more for you
                </Text>
              </View>
            ) : null
          }
        />
      )}

      <FilterSheet
        visible={showFilters}
        initial={filter}
        liveCount={liveCount}
        onClose={() => setShowFilters(false)}
        onApply={async (next) => {
          setFilter(next);
          // Persist radius back to prefs so loadEvents (which reads prefs.radius
          // first) actually honors what the user just picked. Without this the
          // FilterSheet radius is dead-weight against the Settings slider.
          try {
            const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
            const prefs = prefsStr ? JSON.parse(prefsStr) : {};
            prefs.radius = next.radiusMiles;
            await AsyncStorage.setItem("@nearme_preferences", JSON.stringify(prefs));
          } catch { /* best-effort */ }
        }}
      />

      <SearchOverlay
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        allEvents={allForSearch}
        savedIds={savedIds}
        onPressEvent={(e) => { setShowSearch(false); router.push(`/event/${e.id}`); }}
        onToggleSave={toggleSave}
      />

      <ClaudeRefreshOverlay
        state={claude.state.state}
        status={claude.state.status}
        foundCount={claude.state.foundEvents.length}
      />
      <RatingPrompt
        visible={ratingTrigger.visible}
        userId={ratingUserId}
        onClose={ratingTrigger.dismiss}
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
  headerActions: { flexDirection: "row", gap: 8 },
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
  luckyPill: {
    backgroundColor: COLORS.accent + "1A",
    borderColor: COLORS.accent + "55",
  },
  feed: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  nowRail: {
    marginBottom: 18,
  },
  nowRailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  nowRailTitleWrap: {
    flex: 1,
  },
  nowRailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  nowRailTitle: {
    color: COLORS.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
    letterSpacing: 0,
  },
  nowRailSub: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontWeight: "600",
  },
  scoutMiniButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.accent + "55",
  },
  scoutButtonActive: {
    borderColor: COLORS.success + "88",
    backgroundColor: COLORS.success + "18",
  },
  scoutMiniText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "800",
  },
  nowLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.hot,
  },
  nowCardScroll: {
    gap: 10,
    paddingRight: 4,
  },
  nowCard: {
    width: 216,
    minHeight: 104,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    justifyContent: "space-between",
  },
  nowCardTime: {
    alignSelf: "flex-start",
    color: COLORS.warm,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  nowCardTitle: {
    color: COLORS.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    marginTop: 5,
  },
  nowCardMeta: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 7,
  },
  nowInlineEmpty: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  nowInlineEmptyText: {
    flex: 1,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  moodWrap: {
    marginBottom: 18,
  },
  moodEyebrow: {
    paddingHorizontal: 2,
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 9,
  },
  moodScroll: {
    gap: 8,
    paddingRight: 4,
  },
  moodChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 13,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  moodText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, fontWeight: "700", color: COLORS.muted, letterSpacing: 1 },
  loadingFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 24,
  },
  loadingFooterText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
});
