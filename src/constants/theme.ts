export const COLORS = {
  // Surfaces (3 levels)
  bg: "#0f0f1a",      // L0 — screen background
  card: "#1a1a2e",    // L1 — cards
  cardAlt: "#222240", // L2 — elevated elements / inputs inside cards

  // Text
  text: "#eeeef6",
  muted: "#9090b0",
  border: "#2e2e4a",

  // Accent (single)
  accent: "#7c6cf0",
  accentLight: "#b0a4ff",

  // Semantic
  success: "#2ed8a3",  // free, chill, available
  warm: "#ffb347",     // price, soon
  hot: "#ff6b6b",      // saved, packed, urgent

  // Legacy compatibility (used by some existing code — keep for now)
  secondary: "#00d4cd",
  pink: "#ff6b9d",
  overlay: "rgba(15, 15, 26, 0.85)",
};

export const GRADIENTS = {
  accent: ["#7c6cf0", "#b06cf0"] as const,
  card: ["transparent", "rgba(15, 15, 26, 0.95)"] as const,
  hero: ["transparent", "rgba(15, 15, 26, 0.7)", "rgba(15, 15, 26, 0.98)"] as const,
};

export const RADIUS = {
  sm: 10,     // chips inside cards
  md: 16,     // cards
  lg: 24,     // hero / sheets
  pill: 999,
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const BOCA_RATON = {
  lat: 26.3587,
  lng: -80.0831,
};

export const DEFAULT_RADIUS_MILES = 5;
