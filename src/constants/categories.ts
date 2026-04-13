import { CategoryOption } from "../types";

export const CATEGORIES: CategoryOption[] = [
  { id: "nightlife", label: "Nightlife", icon: "moon", color: "#6c5ce7" },
  { id: "music", label: "Music", icon: "musical-notes", color: "#e84393" },
  { id: "sports", label: "Sports", icon: "football", color: "#00b894" },
  { id: "food", label: "Food & Drink", icon: "restaurant", color: "#ffa502" },
  { id: "arts", label: "Arts & Culture", icon: "color-palette", color: "#fd79a8" },
  { id: "outdoors", label: "Outdoors", icon: "leaf", color: "#00cec9" },
  { id: "movies", label: "Movies", icon: "film", color: "#a29bfe" },
  { id: "fitness", label: "Fitness", icon: "barbell", color: "#ff6b6b" },
  { id: "community", label: "Community", icon: "people", color: "#fdcb6e" },
];

export const CATEGORY_MAP = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
) as Record<string, CategoryOption>;
