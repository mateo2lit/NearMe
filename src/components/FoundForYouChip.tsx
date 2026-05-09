import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../constants/theme";

export function FoundForYouChip() {
  return (
    <View style={styles.chip} accessibilityLabel="Hand-picked for you by AI">
      <Ionicons name="sparkles" size={11} color={COLORS.accentLight} />
      <Text style={styles.text}>Hand-picked</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent + "55",
  },
  text: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
