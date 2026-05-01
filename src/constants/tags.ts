export type TagDimension = "when" | "who" | "vibe" | "cost";

export interface TagOption {
  id: string;
  label: string;
  icon: string;      // Ionicons name
  dimension: TagDimension;
}

export const TAGS: TagOption[] = [
  // WHEN
  { id: "late-night", label: "Late Night", icon: "moon", dimension: "when" },
  { id: "daytime", label: "Daytime", icon: "sunny", dimension: "when" },

  // WHO
  { id: "21+", label: "21+", icon: "wine", dimension: "who" },
  { id: "18+", label: "18+", icon: "alert-circle", dimension: "who" },
  { id: "all-ages", label: "All Ages", icon: "happy", dimension: "who" },
  { id: "singles", label: "Singles", icon: "heart-circle", dimension: "who" },
  { id: "family", label: "Family", icon: "people", dimension: "who" },

  // VIBE
  { id: "date-night", label: "Date Night", icon: "heart", dimension: "vibe" },
  { id: "drinking", label: "Drinking", icon: "beer", dimension: "vibe" },
  { id: "live-music", label: "Live Music", icon: "musical-notes", dimension: "vibe" },
  { id: "outdoor", label: "Outdoor", icon: "sunny", dimension: "vibe" },
  { id: "active", label: "Active", icon: "fitness", dimension: "vibe" },

  // COST
  { id: "free", label: "Free", icon: "gift", dimension: "cost" },
  { id: "ticketed", label: "Ticketed", icon: "ticket", dimension: "cost" },
];

export const TAG_MAP = Object.fromEntries(
  TAGS.map((t) => [t.id, t])
) as Record<string, TagOption>;

export const TAGS_BY_DIMENSION: Record<TagDimension, TagOption[]> = {
  when: TAGS.filter((t) => t.dimension === "when"),
  who: TAGS.filter((t) => t.dimension === "who"),
  vibe: TAGS.filter((t) => t.dimension === "vibe"),
  cost: TAGS.filter((t) => t.dimension === "cost"),
};

export const DIMENSION_LABELS: Record<TagDimension, string> = {
  when: "When",
  who: "Who",
  vibe: "Vibe",
  cost: "Cost",
};
