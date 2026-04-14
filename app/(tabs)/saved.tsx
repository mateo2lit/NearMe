import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../../src/types";
import { getEventTimeLabel } from "../../src/services/events";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { getEventImage } from "../../src/constants/images";
import TagBadge from "../../src/components/TagBadge";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";

export default function SavedScreen() {
  const router = useRouter();
  const [savedEvents, setSavedEvents] = useState<Event[]>([]);

  const loadSaved = useCallback(async () => {
    const data = await AsyncStorage.getItem("@nearme_saved_events");
    if (data) {
      setSavedEvents(JSON.parse(data));
    } else {
      setSavedEvents([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSaved();
    }, [loadSaved])
  );

  const removeSaved = async (eventId: string) => {
    const newEvents = savedEvents.filter((e) => e.id !== eventId);
    setSavedEvents(newEvents);
    await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(newEvents));
    const ids = newEvents.map((e) => e.id);
    await AsyncStorage.setItem("@nearme_saved", JSON.stringify(ids));
  };

  const renderItem = ({ item }: { item: Event }) => {
    const timeInfo = getEventTimeLabel(item);
    const category = CATEGORY_MAP[item.category];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/event/${item.id}`)}
        activeOpacity={0.8}
      >
        <Image
          source={{ uri: getEventImage(item.image_url, item.category, item.subcategory, item.title, item.description) }}
          style={styles.cardImage}
        />
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.cardMeta}>
            <Text style={[styles.timeText, { color: timeInfo.color }]}>
              {timeInfo.label}
            </Text>
            {category && (
              <View
                style={[styles.categoryDot, { backgroundColor: category.color }]}
              />
            )}
            {category && (
              <Text style={styles.categoryText}>{category.label}</Text>
            )}
          </View>
          {(item.tags || []).length > 0 && (
            <View style={styles.cardTags}>
              {(item.tags || []).slice(0, 2).map((tag) => (
                <TagBadge key={tag} tag={tag} selected />
              ))}
            </View>
          )}
        </View>
        <TouchableOpacity
          style={styles.removeBtn}
          onPress={() => removeSaved(item.id)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="heart-dislike" size={18} color={COLORS.hot} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved</Text>
        <View style={styles.headerCountBadge}>
          <Text style={styles.headerCount}>
            {savedEvents.length} event{savedEvents.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      {savedEvents.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name="heart-outline" size={40} color={COLORS.accent} />
          </View>
          <Text style={styles.emptyTitle}>No saved events yet</Text>
          <Text style={styles.emptySubtitle}>
            Swipe right on events you like{"\n"}and they'll show up here
          </Text>
        </View>
      ) : (
        <FlatList
          data={savedEvents}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  headerCountBadge: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerCount: {
    fontSize: 13,
    color: COLORS.muted,
    fontWeight: "600",
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardImage: {
    width: 95,
    height: 95,
    borderTopLeftRadius: RADIUS.md,
    borderBottomLeftRadius: RADIUS.md,
  },
  cardContent: {
    flex: 1,
    padding: 12,
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 4,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  timeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  categoryDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  categoryText: {
    fontSize: 12,
    color: COLORS.muted,
  },
  cardTags: {
    flexDirection: "row",
    gap: 4,
    marginTop: 4,
  },
  removeBtn: {
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 20,
  },
});
