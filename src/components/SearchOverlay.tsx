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
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close search"
          >
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
              <TouchableOpacity
                onPress={() => setQuery("")}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Clear search"
              >
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
