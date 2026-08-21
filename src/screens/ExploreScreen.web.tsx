import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import PlanCard from "../components/PlanCard";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../constants/theme";
import { useLocation } from "../hooks/useLocation";
import { usePreferences } from "../hooks/usePreferences";
import { fetchNearbyEvents } from "../services/events";
import { rankEvents } from "../lib/feedRanking";
import { useSaved } from "../services/savedStore";
import { recordPreferenceSignal, removePreferenceSignal } from "../services/preferenceSignals";

/** Web keeps Explore useful without bundling react-native-maps' native code. */
export default function ExploreWebScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const location = useLocation();
  const { preferences, loading: prefsLoading } = usePreferences();
  const { savedIds, toggleSave } = useSaved();
  const [events, setEvents] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (location.lat == null || location.lng == null || prefsLoading) return;
    fetchNearbyEvents(location.lat, location.lng, preferences.radius)
      .then((items) => setEvents(rankEvents(items, preferences)))
      .finally(() => setLoading(false));
  }, [location.lat, location.lng, preferences.radius, prefsLoading]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? events.filter((event) => `${event.title} ${event.venue?.name || ""} ${event.address}`.toLowerCase().includes(q)) : events;
  }, [events, query]);

  const save = async (event: any) => {
    const value = await toggleSave(event);
    if (value) await recordPreferenceSignal(event, "save");
    else await removePreferenceSignal(event.id, "save");
  };

  return <View style={styles.screen}>
    <View style={styles.header}><Text style={styles.eyebrow}>{location.cityName || "Near you"}</Text><Text style={styles.title}>Explore</Text><Text style={styles.subtitle}>Map view is available in the iOS and Android apps.</Text>
      <View style={styles.search}><Ionicons name="search" size={21} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search events or venues" placeholderTextColor={colors.muted} style={styles.input} accessibilityLabel="Search events" /></View>
    </View>
    {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /></View> : <FlatList data={filtered.slice(0, 60)} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ItemSeparatorComponent={() => <View style={{ height: 12 }} />} renderItem={({ item }) => <PlanCard compact event={item} saved={savedIds.has(item.id)} onOpen={() => router.push(`/event/${item.id}`)} onSave={() => save(item)} />} />}
  </View>;
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, header: { padding: SPACING.lg, gap: 5 }, eyebrow: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" }, title: { color: c.text, fontSize: TYPE.hero, fontWeight: "900" }, subtitle: { color: c.muted, fontSize: TYPE.body, lineHeight: 24 },
  search: { minHeight: 50, marginTop: 12, borderRadius: RADIUS.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14 }, input: { flex: 1, minHeight: 48, color: c.text, fontSize: TYPE.body },
  center: { flex: 1, alignItems: "center", justifyContent: "center" }, list: { paddingHorizontal: SPACING.lg, paddingBottom: 120 },
}); }
