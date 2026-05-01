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
