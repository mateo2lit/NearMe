export interface TagOption {
  id: string;
  label: string;
  icon: string; // Ionicons name
  color: string;
}

export const TAGS: TagOption[] = [
  { id: "21+", label: "21+", icon: "wine", color: "#6c5ce7" },
  { id: "18+", label: "18+", icon: "alert-circle", color: "#a29bfe" },
  { id: "all-ages", label: "All Ages", icon: "happy", color: "#00b894" },
  { id: "drinking", label: "Drinking", icon: "beer", color: "#ffa502" },
  { id: "live-music", label: "Live Music", icon: "musical-notes", color: "#e84393" },
  { id: "outdoor", label: "Outdoor", icon: "sunny", color: "#00cec9" },
  { id: "food", label: "Food", icon: "restaurant", color: "#ff9f43" },
  { id: "active", label: "Active", icon: "fitness", color: "#ff6b6b" },
  { id: "free", label: "Free", icon: "gift", color: "#00b894" },
  { id: "date-night", label: "Date Night", icon: "heart", color: "#fd79a8" },
  { id: "family", label: "Family", icon: "people", color: "#fdcb6e" },
  { id: "late-night", label: "Late Night", icon: "moon", color: "#6c5ce7" },
  { id: "daytime", label: "Daytime", icon: "sunny", color: "#feca57" },
  { id: "ticketed", label: "Ticketed", icon: "ticket", color: "#a29bfe" },
];

export const TAG_MAP = Object.fromEntries(
  TAGS.map((t) => [t.id, t])
) as Record<string, TagOption>;
