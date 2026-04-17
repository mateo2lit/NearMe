import { View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CATEGORY_MAP } from "../constants/categories";
import { COLORS } from "../constants/theme";
import { EventCategory } from "../types";

interface Props {
  category: EventCategory;
  selected?: boolean;
}

export default function MapPin({ category, selected }: Props) {
  const cat = CATEGORY_MAP[category];
  const color = cat?.color || COLORS.accent;
  const icon = cat?.icon || "location";
  const size = selected ? 36 : 28;
  return (
    <View
      style={[
        styles.wrap,
        {
          width: size, height: size, borderRadius: size / 2,
          borderColor: color,
          transform: [{ scale: selected ? 1.15 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon as any} size={selected ? 18 : 14} color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "rgba(15,15,26,0.85)",
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
