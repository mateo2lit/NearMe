import { useEffect, useRef } from "react";
import { View, Animated, StyleSheet, Dimensions } from "react-native";
import { COLORS, RADIUS } from "../constants/theme";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;

/**
 * Shimmer-animated placeholder that matches FeedCard dimensions.
 * Used instead of a full-page spinner to make loading feel fast.
 */
export default function SkeletonCard() {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const opacity = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.9],
  });

  return (
    <View style={styles.card}>
      {/* Image area */}
      <Animated.View style={[styles.image, { opacity }]} />

      {/* Info block */}
      <View style={styles.info}>
        <View style={styles.row}>
          <Animated.View style={[styles.dateBlock, { opacity }]} />
          <View style={{ flex: 1 }}>
            <Animated.View style={[styles.line, { width: "65%", opacity }]} />
            <Animated.View style={[styles.line, { width: "85%", opacity, marginTop: 6 }]} />
          </View>
          <Animated.View style={[styles.priceBlock, { opacity }]} />
        </View>
        <View style={styles.tagRow}>
          <Animated.View style={[styles.tagChip, { opacity }]} />
          <Animated.View style={[styles.tagChip, { opacity, width: 72 }]} />
          <Animated.View style={[styles.tagChip, { opacity, width: 90 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  image: {
    width: "100%",
    height: 200,
    backgroundColor: COLORS.cardAlt,
  },
  info: {
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dateBlock: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.cardAlt,
  },
  priceBlock: {
    width: 56,
    height: 20,
    borderRadius: 4,
    backgroundColor: COLORS.cardAlt,
  },
  line: {
    height: 12,
    borderRadius: 4,
    backgroundColor: COLORS.cardAlt,
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
  },
  tagChip: {
    width: 60,
    height: 22,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.cardAlt,
  },
});
