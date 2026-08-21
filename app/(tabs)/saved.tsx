import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PlanCard from "../../src/components/PlanCard";
import { DidYouGo } from "../../src/components/DidYouGo";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../../src/constants/theme";
import { effectiveEnd, effectiveStart } from "../../src/lib/time-windows";
import { track } from "../../src/services/analytics";
import { cancelReminderForEvent } from "../../src/services/reminders";
import { useSaved } from "../../src/services/savedStore";
import { removePreferenceSignal } from "../../src/services/preferenceSignals";

type Segment = "upcoming" | "past";

export default function PlansScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const { savedIds, savedEvents, loaded, toggleSave } = useSaved();
  const [segment, setSegment] = useState<Segment>("upcoming");

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    return {
      upcoming: savedEvents.filter((event) => effectiveEnd(event).getTime() > now).sort((a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime()),
      past: savedEvents.filter((event) => effectiveEnd(event).getTime() <= now).sort((a, b) => effectiveStart(b).getTime() - effectiveStart(a).getTime()),
    };
  }, [savedEvents]);

  const data = segment === "upcoming" ? upcoming : past;
  const remove = async (event: any) => {
    await toggleSave(event);
    await removePreferenceSignal(event.id, "save");
    cancelReminderForEvent(event.id).catch(() => {});
    track("event_unsaved", { event_id: event.id, placement: "plans" }).catch(() => {});
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Things you chose</Text>
        <Text style={styles.title}>Plans</Text>
        <Text style={styles.subtitle}>Keep the promising ones together, then tell NearMe what was actually worth it.</Text>
        <View style={styles.segment}>
          {(["upcoming", "past"] as Segment[]).map((value) => (
            <Pressable key={value} onPress={() => setSegment(value)} accessibilityRole="button" accessibilityState={{ selected: segment === value }} style={[styles.segmentButton, segment === value && styles.segmentSelected]}>
              <Text style={[styles.segmentText, segment === value && styles.segmentTextSelected]}>{value === "upcoming" ? `Upcoming ${upcoming.length}` : `Past ${past.length}`}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, data.length === 0 && styles.emptyList]}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <PlanCard compact event={item} saved={savedIds.has(item.id)} onOpen={() => { track("event_opened", { event_id: item.id, placement: "plans" }).catch(() => {}); router.push(`/event/${item.id}`); }} onSave={() => remove(item)} />
            {segment === "past" && <DidYouGo eventId={item.id} category={item.category} tags={item.tags} />}
          </View>
        )}
        ListEmptyComponent={loaded ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name={segment === "upcoming" ? "bookmark-outline" : "time-outline"} size={36} color={colors.accent} /></View>
            <Text style={styles.emptyTitle}>{segment === "upcoming" ? "No plans saved yet" : "No past plans to rate"}</Text>
            <Text style={styles.emptyBody}>{segment === "upcoming" ? "Save anything promising. NearMe will keep it here and remind you before it starts." : "After a saved event ends, it appears here so your feedback can improve future picks."}</Text>
            {segment === "upcoming" && <Pressable style={styles.primary} onPress={() => router.push("/(tabs)/map")} accessibilityRole="button"><Text style={styles.primaryText}>Explore nearby</Text></Pressable>}
          </View>
        ) : null}
      />
    </View>
  );
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  header: { paddingHorizontal: SPACING.md, paddingBottom: 14 },
  eyebrow: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  title: { color: c.text, fontSize: TYPE.hero, lineHeight: 39, fontWeight: "900", letterSpacing: -1 },
  subtitle: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, marginTop: 5, maxWidth: 560 },
  segment: { flexDirection: "row", padding: 4, borderRadius: RADIUS.pill, backgroundColor: c.cardAlt, marginTop: 18 },
  segmentButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill },
  segmentSelected: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  segmentText: { color: c.muted, fontSize: TYPE.meta, fontWeight: "700" },
  segmentTextSelected: { color: c.text },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  emptyList: { flexGrow: 1 },
  item: { backgroundColor: c.card, borderRadius: RADIUS.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: c.text, fontSize: TYPE.section, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, textAlign: "center" },
  primary: { minHeight: 50, paddingHorizontal: 22, justifyContent: "center", borderRadius: RADIUS.pill, backgroundColor: c.accent },
  primaryText: { color: "#FFFFFF", fontSize: TYPE.body, fontWeight: "800" },
}); }
