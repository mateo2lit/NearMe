import React from "react";
import { View, Text, StyleSheet } from "react-native";

export function FoundForYouChip() {
  return (
    <View style={styles.chip} accessibilityLabel="Found for you by AI">
      <Text style={styles.text}>✨ Found for you</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
