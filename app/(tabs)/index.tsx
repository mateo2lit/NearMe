import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PlanCard from "../../src/components/PlanCard";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../../src/constants/theme";
import { useLocation } from "../../src/hooks/useLocation";
import { usePreferences } from "../../src/hooks/usePreferences";
import { getAllFeedback } from "../../src/services/feedback";
import { applyHiddenFilter, fetchNearbyEvents, filterHappyHour } from "../../src/services/events";
import { cancelReminderForEvent, scheduleReminderForEvent } from "../../src/services/reminders";
import { track } from "../../src/services/analytics";
import { useSaved } from "../../src/services/savedStore";
import { RankedEvent, rankEvents } from "../../src/lib/feedRanking";
import { isThisWeekend, isTonight } from "../../src/lib/time-windows";
import { Event, UserPreferences } from "../../src/types";
import { dismissedEventIds, getPreferenceSignals, PreferenceSignal, recordPreferenceSignal, removePreferenceSignal } from "../../src/services/preferenceSignals";

const INTENTS: Array<{ id: string; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "easy", label: "Easy", icon: "cafe-outline" },
  { id: "social", label: "Social", icon: "people-outline" },
  { id: "live", label: "Live", icon: "musical-notes-outline" },
  { id: "learn", label: "Learn", icon: "bulb-outline" },
  { id: "active", label: "Active", icon: "walk-outline" },
  { id: "free", label: "Free", icon: "pricetag-outline" },
];

const DISMISS_REASONS = [
  ["too_far", "Too far", "navigate-outline"],
  ["too_expensive", "Too expensive", "cash-outline"],
  ["not_my_vibe", "Not my vibe", "options-outline"],
  ["already_seen", "I already saw this", "eye-off-outline"],
] as const;

function uniqueSection(source: RankedEvent[], used: Set<string>, predicate: (event: RankedEvent) => boolean, limit = 5) {
  const output: RankedEvent[] = [];
  for (const event of source) {
    if (output.length >= limit) break;
    if (!used.has(event.id) && predicate(event)) {
      used.add(event.id);
      output.push(event);
    }
  }
  return output;
}

export default function ForYouScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const location = useLocation();
  const { preferences, savePreferences, loading: preferencesLoading } = usePreferences();
  const { savedIds, toggleSave } = useSaved();
  const [events, setEvents] = useState<Event[]>([]);
  const [feedback, setFeedback] = useState<Record<string, any>>({});
  const [signals, setSignals] = useState<PreferenceSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [dismissTarget, setDismissTarget] = useState<RankedEvent | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (location.lat == null || location.lng == null) return;
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      if (!refresh) {
        const cached = await fetchNearbyEvents(location.lat, location.lng, preferences.radius, undefined, undefined, { cachedOnly: true });
        if (cached.length) setEvents(cached);
      }
      const [fresh, history, learnedSignals] = await Promise.all([
        fetchNearbyEvents(location.lat, location.lng, preferences.radius),
        getAllFeedback(),
        getPreferenceSignals(),
      ]);
      setEvents(fresh);
      setFeedback(history);
      setSignals(learnedSignals);
      setHiddenIds(dismissedEventIds(learnedSignals));
      track("feed_loaded", { count: fresh.length, radius: preferences.radius, city: location.cityName }).catch(() => {});
    } catch {
      setError("We couldn't refresh events. Check your connection and try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [location.lat, location.lng, location.cityName, preferences.radius]);

  useEffect(() => {
    if (!location.loading && !preferencesLoading && location.lat != null && location.lng != null) load();
  }, [location.loading, preferencesLoading, location.lat, location.lng, load]);

  const effectivePreferences = useMemo<UserPreferences>(() => ({
    ...preferences,
    intents: intent ? [intent, ...(preferences.intents ?? []).filter((item) => item !== intent)] : preferences.intents,
  }), [preferences, intent]);

  const ranked = useMemo(() => {
    const visible = filterHappyHour(
      applyHiddenFilter(events, preferences.hiddenCategories, preferences.hiddenTags),
      preferences.happyHourEnabled ?? true,
    ).filter((event) => !hiddenIds.has(event.id));
    return rankEvents(visible, effectivePreferences, feedback, signals);
  }, [events, preferences, effectivePreferences, feedback, signals, hiddenIds]);

  const sections = useMemo(() => {
    const used = new Set<string>();
    const best = ranked.slice(0, 3);
    best.forEach((event) => used.add(event.id));
    const now = new Date();
    const tonight = uniqueSection(ranked, used, (event) => isTonight(event, now));
    const weekend = uniqueSection(ranked, used, (event) => isThisWeekend(event, now));
    const newNear = uniqueSection(ranked, used, () => true);
    return { best, tonight, weekend, newNear };
  }, [ranked]);

  useEffect(() => {
    if (!sections.best.length) return;
    track("feed_impression", { placements: sections.best.map((event, index) => ({ event_id: event.id, position: index + 1, score: event.rank_score })) }).catch(() => {});
  }, [sections.best.map((event) => event.id).join(",")]);

  const openEvent = (event: RankedEvent, placement: string) => {
    track("event_opened", { event_id: event.id, placement, score: event.rank_score }).catch(() => {});
    router.push(`/event/${event.id}`);
  };

  const saveEvent = async (event: RankedEvent) => {
    const saved = await toggleSave(event);
    if (saved) {
      await recordPreferenceSignal(event, "save");
    } else await removePreferenceSignal(event.id, "save");
    setSignals(await getPreferenceSignals());
    track(saved ? "event_saved" : "event_unsaved", { event_id: event.id, score: event.rank_score }).catch(() => {});
    if (saved) scheduleReminderForEvent(event, { quietHours: { start: 22, end: 8 } }).catch(() => {});
    else cancelReminderForEvent(event.id).catch(() => {});
  };

  const dismiss = async (reason: string) => {
    if (!dismissTarget) return;
    setHiddenIds((ids) => new Set(ids).add(dismissTarget.id));
    await recordPreferenceSignal(dismissTarget, "dismiss", reason);
    setSignals(await getPreferenceSignals());
    track("event_dismissed", { event_id: dismissTarget.id, reason, score: dismissTarget.rank_score }).catch(() => {});
    setDismissTarget(null);
  };

  const chooseIntent = (next: string) => {
    const value = intent === next ? null : next;
    setIntent(value);
    track("intent_selected", { intent: value || "cleared" }).catch(() => {});
  };

  const expandRadius = async () => {
    await savePreferences({ ...preferences, radius: preferences.radius < 25 ? 25 : 50 });
  };

  if (location.loading || preferencesLoading) {
    return <View style={[styles.center, { paddingTop: insets.top }]}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Finding your location…</Text></View>;
  }

  if (location.needsSetup || location.lat == null || location.lng == null) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <View style={styles.emptyIcon}><Ionicons name="location-outline" size={34} color={colors.accent} /></View>
        <Text style={styles.emptyTitle}>Choose where to explore</Text>
        <Text style={styles.emptyBody}>Set a city or use your location to find plans around you.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.push("/(tabs)/settings")} accessibilityRole="button"><Text style={styles.primaryButtonText}>Set location</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: 120 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{location.cityName || "Near you"}</Text>
            <Text style={styles.heading}>Plans worth your time</Text>
          </View>
          <Pressable style={styles.tuneButton} onPress={() => router.push("/(tabs)/settings")} accessibilityRole="button" accessibilityLabel="Tune recommendations">
            <Ionicons name="options-outline" size={23} color={colors.text} />
          </Pressable>
        </View>

        <Text style={styles.prompt}>What fits today?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.intentRow}>
          {INTENTS.map((item) => {
            const selected = intent === item.id;
            return (
              <Pressable key={item.id} onPress={() => chooseIntent(item.id)} accessibilityRole="button" accessibilityState={{ selected }} style={({ pressed }) => [styles.intent, selected && styles.intentSelected, pressed && styles.pressed]}>
                <Ionicons name={item.icon} size={19} color={selected ? colors.card : colors.text} />
                <Text style={[styles.intentText, selected && styles.intentTextSelected]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!preferences.ageBand && <Pressable style={styles.notice} onPress={() => router.push("/(tabs)/settings")} accessibilityRole="button"><Ionicons name="shield-checkmark-outline" size={21} color={colors.accent} /><Text style={styles.noticeText}>21+ listings are hidden until you set age eligibility in You.</Text><Ionicons name="chevron-forward" size={19} color={colors.muted} /></Pressable>}

        {error && <Pressable style={styles.error} onPress={() => load(true)} accessibilityRole="button"><Ionicons name="cloud-offline-outline" size={20} color={colors.hot} /><Text style={styles.errorText}>{error} Tap to retry.</Text></Pressable>}

        {loading && events.length === 0 ? (
          <View style={styles.loadingBlock}><ActivityIndicator color={colors.accent} /><Text style={styles.loadingText}>Checking trusted local sources…</Text></View>
        ) : sections.best.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="map-outline" size={34} color={colors.accent} />
            <Text style={styles.emptyTitle}>No verified plans inside {preferences.radius} miles yet</Text>
            <Text style={styles.emptyBody}>Try another distance, or pull down later as local sources update. Any suggestions beyond the default radius show how far away they are.</Text>
            <Pressable style={styles.secondaryButton} onPress={expandRadius} accessibilityRole="button"><Text style={styles.secondaryButtonText}>Expand to {preferences.radius < 25 ? 25 : 50} miles</Text></Pressable>
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Your best 3</Text><Text style={styles.sectionSubtitle}>Ranked for fit, distance and trust</Text></View><View style={styles.countPill}><Text style={styles.countText}>{ranked.length} plans</Text></View></View>
            <View style={styles.cardStack}>
              {sections.best.map((event, index) => <PlanCard key={event.id} event={event} index={index + 1} saved={savedIds.has(event.id)} onOpen={() => openEvent(event, "best_three")} onSave={() => saveEvent(event)} onDismiss={() => setDismissTarget(event)} />)}
            </View>

            {([
              ["Tonight", "Ready when you are", sections.tonight],
              ["This weekend", "A little more room to plan", sections.weekend],
              ["More worth a look", "Unique picks, no repeats", sections.newNear],
            ] as const).map(([title, subtitle, list]) => list.length > 0 && (
              <View key={title} style={styles.section}>
                <View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View></View>
                <View style={styles.compactStack}>{list.map((event) => <PlanCard key={event.id} compact event={event} saved={savedIds.has(event.id)} onOpen={() => openEvent(event, title.toLowerCase())} onSave={() => saveEvent(event)} />)}</View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={!!dismissTarget} transparent animationType="fade" onRequestClose={() => setDismissTarget(null)}>
        <Pressable style={styles.scrim} onPress={() => setDismissTarget(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={(event) => event.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Why isn't this for you?</Text>
            <Text style={styles.sheetBody}>Your answer immediately improves future picks.</Text>
            {DISMISS_REASONS.map(([id, label, icon]) => (
              <Pressable key={id} style={({ pressed }) => [styles.reasonRow, pressed && styles.pressed]} onPress={() => dismiss(id)} accessibilityRole="button">
                <Ionicons name={icon} size={22} color={colors.text} /><Text style={styles.reasonText}>{label}</Text><Ionicons name="chevron-forward" size={19} color={colors.muted} />
              </Pressable>
            ))}
            <Pressable style={styles.cancelButton} onPress={() => setDismissTarget(null)} accessibilityRole="button"><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  content: { paddingHorizontal: SPACING.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, backgroundColor: c.bg, gap: SPACING.md },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md, marginBottom: SPACING.lg },
  eyebrow: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800", marginBottom: 3 },
  heading: { color: c.text, fontSize: TYPE.hero, lineHeight: 38, letterSpacing: -1.1, fontWeight: "900" },
  tuneButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  prompt: { color: c.text, fontSize: TYPE.body, fontWeight: "800", marginBottom: 10 },
  intentRow: { gap: 8, paddingBottom: SPACING.lg },
  intent: { minHeight: 46, paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 7 },
  intentSelected: { backgroundColor: c.accent, borderColor: c.accent },
  intentText: { color: c.text, fontSize: TYPE.meta, fontWeight: "700" },
  intentTextSelected: { color: c.card },
  pressed: { opacity: 0.72 },
  section: { marginTop: SPACING.xl },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 },
  sectionTitle: { color: c.text, fontSize: TYPE.section, lineHeight: 30, fontWeight: "900", letterSpacing: -0.5 },
  sectionSubtitle: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 },
  countPill: { backgroundColor: c.accentSoft, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6 },
  countText: { color: c.accent, fontSize: TYPE.caption, fontWeight: "800" },
  cardStack: { gap: SPACING.md },
  compactStack: { gap: 12 },
  loadingBlock: { minHeight: 280, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: c.muted, fontSize: TYPE.meta, lineHeight: 22, textAlign: "center" },
  error: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.hotSoft, borderRadius: RADIUS.md, padding: 14, marginBottom: SPACING.md },
  notice: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.accentSoft, borderRadius: RADIUS.md, paddingHorizontal: 12, marginBottom: SPACING.md },
  noticeText: { flex: 1, color: c.accent, fontSize: TYPE.caption, lineHeight: 19, fontWeight: "700" },
  errorText: { flex: 1, color: c.hot, fontSize: TYPE.meta, lineHeight: 21 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" },
  emptyCard: { alignItems: "center", padding: SPACING.xl, borderRadius: RADIUS.lg, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, gap: 12 },
  emptyTitle: { color: c.text, fontSize: TYPE.section, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, textAlign: "center" },
  primaryButton: { minHeight: 50, borderRadius: RADIUS.pill, paddingHorizontal: 24, justifyContent: "center", backgroundColor: c.accent },
  primaryButtonText: { color: "#FFFFFF", fontSize: TYPE.body, fontWeight: "800" },
  secondaryButton: { minHeight: 48, borderRadius: RADIUS.pill, paddingHorizontal: 20, justifyContent: "center", borderWidth: 1, borderColor: c.accent },
  secondaryButtonText: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  scrim: { flex: 1, backgroundColor: c.scrim, justifyContent: "flex-end" },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.lg, gap: 8 },
  handle: { width: 42, height: 5, borderRadius: 3, backgroundColor: c.border, alignSelf: "center", marginBottom: 8 },
  sheetTitle: { color: c.text, fontSize: TYPE.section, fontWeight: "900" },
  sheetBody: { color: c.muted, fontSize: TYPE.meta, lineHeight: 22, marginBottom: 8 },
  reasonRow: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderTopColor: c.border },
  reasonText: { flex: 1, color: c.text, fontSize: TYPE.body, fontWeight: "700" },
  cancelButton: { minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 8 },
  cancelText: { color: c.accent, fontSize: TYPE.body, fontWeight: "800" },
}); }
