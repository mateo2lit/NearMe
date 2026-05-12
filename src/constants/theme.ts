export const COLORS = {
  // Surfaces (3 levels)
  bg: "#0f0f1a",      // L0 — screen background
  card: "#1a1a2e",    // L1 — cards
  cardAlt: "#222240", // L2 — elevated elements / inputs inside cards

  // Text
  text: "#eeeef6",
  muted: "#9090b0",
  border: "#2e2e4a",

  // Accent (single — used outside onboarding's per-goal palettes)
  accent: "#7c6cf0",
  accentLight: "#b0a4ff",

  // Semantic
  success: "#2ed8a3",  // free, chill, available
  warm: "#ffb347",     // price, soon
  hot: "#ff6b6b",      // saved, packed, urgent

  pink: "#ff6b9d",
  overlay: "rgba(15, 15, 26, 0.85)",
};

export const GRADIENTS = {
  accent: ["#7c6cf0", "#b06cf0"] as const,
  card: ["transparent", "rgba(15, 15, 26, 0.95)"] as const,
  hero: ["transparent", "rgba(15, 15, 26, 0.7)", "rgba(15, 15, 26, 0.98)"] as const,
  // Iridescent multi-stop sweep — used on BuildingStep's ring + the
  // welcome screen's "AI agent" feel.
  iridescent: ["#7c6cf0", "#ff5e87", "#ff8a3d", "#3b9cff", "#7c6cf0"] as const,
  // Soft aurora wash — sits behind hero copy to add depth without color noise.
  aurora: ["rgba(124,108,240,0.32)", "rgba(255,94,135,0.18)", "rgba(59,156,255,0.0)"] as const,
};

// Per-goal palette. Each goal gets a distinct accent so the onboarding
// flow feels lively and the user's selections subtly recolor the screen.
// Pick `from`+`to` for gradients; `tint` for translucent card backgrounds.
export interface GoalPalette {
  from: string;
  to: string;
  solid: string;
  tint: string;       // rgba ~14% opacity, for card backgrounds when selected
  edge: string;       // rgba ~55% opacity, for selected borders
  emoji: string;      // shown in the lively goal cards
}

export const GOAL_PALETTES: Record<string, GoalPalette> = {
  "meet-people":     { from: "#3b9cff", to: "#6bb8ff", solid: "#3b9cff", tint: "rgba(59,156,255,0.14)",  edge: "rgba(59,156,255,0.55)",  emoji: "👋" },
  "find-partner":    { from: "#ff5e87", to: "#ff85a5", solid: "#ff5e87", tint: "rgba(255,94,135,0.14)",  edge: "rgba(255,94,135,0.55)",  emoji: "💘" },
  "get-active":      { from: "#ff8a3d", to: "#ffb066", solid: "#ff8a3d", tint: "rgba(255,138,61,0.14)",  edge: "rgba(255,138,61,0.55)",  emoji: "🏃" },
  "drinks-nightlife":{ from: "#9d5bff", to: "#c58aff", solid: "#9d5bff", tint: "rgba(157,91,255,0.14)",  edge: "rgba(157,91,255,0.55)",  emoji: "🍸" },
  "live-music":      { from: "#e04ac1", to: "#ff6fdb", solid: "#e04ac1", tint: "rgba(224,74,193,0.14)",  edge: "rgba(224,74,193,0.55)",  emoji: "🎶" },
  "try-food":        { from: "#ff7a2d", to: "#ffa15c", solid: "#ff7a2d", tint: "rgba(255,122,45,0.14)",  edge: "rgba(255,122,45,0.55)",  emoji: "🍜" },
  "explore-arts":    { from: "#5b6bff", to: "#8c9aff", solid: "#5b6bff", tint: "rgba(91,107,255,0.14)",  edge: "rgba(91,107,255,0.55)",  emoji: "🎨" },
  "family-fun":      { from: "#ffb628", to: "#ffd56e", solid: "#ffb628", tint: "rgba(255,182,40,0.14)",  edge: "rgba(255,182,40,0.55)",  emoji: "🎡" },
  "outdoor-fun":     { from: "#22b97a", to: "#50dba0", solid: "#22b97a", tint: "rgba(34,185,122,0.14)",  edge: "rgba(34,185,122,0.55)",  emoji: "🌲" },
};

// Fallback for any non-goal option card (vibe, schedule, budget, etc.)
export const DEFAULT_PALETTE: GoalPalette = {
  from: "#7c6cf0",
  to: "#b06cf0",
  solid: "#7c6cf0",
  tint: "rgba(124,108,240,0.14)",
  edge: "rgba(124,108,240,0.55)",
  emoji: "",
};

export const RADIUS = {
  sm: 10,     // chips inside cards
  md: 16,     // cards
  lg: 24,     // hero / sheets
  xl: 32,     // hero cover artwork
  pill: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const SHADOWS = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  tabBar: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 12,
  },
  // Coloured glow used on selected onboarding cards + hero buttons.
  glow: (rgba: string) => ({
    shadowColor: rgba,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 10,
  }),
} as const;

export const OPACITY = {
  disabled: 0.4,
  pressed: 0.75,
  overlay: 0.9,
  borderSubtle: "1F", // ~12%
  borderEmphasis: "55",
} as const;

// Motion tokens — keep durations consistent across screens.
export const MOTION = {
  quick: 180,     // press / hover
  normal: 320,    // card select, panel slide
  slow: 600,      // hero entrance, celebration
  loop: 2400,     // looping ambient (spin, pulse)
} as const;

export const SHEET_HEIGHT = "85%" as const;

export const BOCA_RATON = {
  lat: 26.3587,
  lng: -80.0831,
};

export const DEFAULT_RADIUS_MILES = 5;
