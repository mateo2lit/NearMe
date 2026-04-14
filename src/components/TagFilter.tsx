import { ScrollView, StyleSheet } from "react-native";
import { TAGS } from "../constants/tags";
import { SPACING } from "../constants/theme";
import TagBadge from "./TagBadge";

interface TagFilterProps {
  selectedTags: string[];
  onToggle: (tag: string) => void;
}

export default function TagFilter({ selectedTags, onToggle }: TagFilterProps) {
  // Sort: selected tags first, then unselected
  const sorted = [...TAGS].sort((a, b) => {
    const aSelected = selectedTags.includes(a.id) ? 0 : 1;
    const bSelected = selectedTags.includes(b.id) ? 0 : 1;
    return aSelected - bSelected;
  });

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {sorted.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag.id}
          selected={selectedTags.includes(tag.id)}
          onPress={() => onToggle(tag.id)}
          size="md"
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
});
