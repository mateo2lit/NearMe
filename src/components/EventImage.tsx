import { useState } from "react";
import { View, Image, StyleSheet, ImageStyle, StyleProp } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Event } from "../types";
import { CATEGORY_MAP } from "../constants/categories";
import { getEventImage } from "../constants/images";
import { COLORS } from "../constants/theme";

/**
 * Event artwork with a placeholder that stands on its own.
 *
 * Every fallback image in the app is a remote Unsplash URL, and a plain
 * `<Image>` renders nothing at all while one is loading or when it fails —
 * which is how the feed ended up showing blank slabs with a lone category
 * glyph (TestFlight, 2026-09-18). The gradient underneath is local, tinted by
 * category, and always there; the photo fades in over it when it arrives and
 * simply never appears when it doesn't.
 */

interface Props {
  event: Event;
  style?: StyleProp<ImageStyle>;
  /** Hides the category glyph on the placeholder for small cards. */
  compact?: boolean;
}

const CATEGORY_TINTS: Record<string, [string, string]> = {
  music: ["#3a2a5e", "#1a1a2e"],
  sports: ["#1f3a52", "#1a1a2e"],
  nightlife: ["#4a2450", "#1a1a2e"],
  food: ["#4a3420", "#1a1a2e"],
  arts: ["#2a3560", "#1a1a2e"],
  community: ["#26404a", "#1a1a2e"],
  fitness: ["#3d2a3a", "#1a1a2e"],
  outdoors: ["#1f4436", "#1a1a2e"],
  movies: ["#332a4e", "#1a1a2e"],
};

export default function EventImage({ event, style, compact }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const uri = getEventImage(
    event.image_url,
    event.category,
    event.subcategory,
    event.title,
    event.description,
    event.tags,
    `${event.venue?.name || ""} ${event.address || ""}`,
  );
  const category = CATEGORY_MAP[event.category];
  const tint = CATEGORY_TINTS[event.category] || CATEGORY_TINTS.community;

  return (
    <View style={[styles.wrap, style]}>
      <LinearGradient colors={tint} style={StyleSheet.absoluteFill} />
      {!compact && category && !loaded && (
        <View style={styles.glyph}>
          <Ionicons name={category.icon as any} size={26} color="rgba(255,255,255,0.22)" />
        </View>
      )}
      {!failed && !!uri && (
        <Image
          source={{ uri }}
          style={[StyleSheet.absoluteFill, { opacity: loaded ? 1 : 0 }]}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    backgroundColor: COLORS.cardAlt,
  },
  glyph: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});
