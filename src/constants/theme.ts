import { useColorScheme } from "react-native";

export interface AppColors {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentLight: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warm: string;
  warmSoft: string;
  hot: string;
  hotSoft: string;
  pink: string;
  overlay: string;
  scrim: string;
}

export const LIGHT_COLORS: AppColors = {
  bg: "#F7F6F2", card: "#FFFFFF", cardAlt: "#EFEEE9",
  text: "#17191C", muted: "#5F646D", border: "#DEDDD7",
  accent: "#5146E5", accentLight: "#7068EC", accentSoft: "#ECEAFF",
  success: "#0B7557", successSoft: "#DFF5EC",
  warm: "#9A5000", warmSoft: "#FFF0D9",
  hot: "#C43E4D", hotSoft: "#FCE5E8", pink: "#C43E72",
  overlay: "rgba(247,246,242,0.90)", scrim: "rgba(16,17,20,0.56)",
};

export const DARK_COLORS: AppColors = {
  bg: "#101114", card: "#191B20", cardAlt: "#24272E",
  text: "#F4F2ED", muted: "#A9ADB5", border: "#343841",
  accent: "#948BFF", accentLight: "#B3ADFF", accentSoft: "#292641",
  success: "#60D6AC", successSoft: "#17372E",
  warm: "#FFB965", warmSoft: "#3D2B18",
  hot: "#FF7D89", hotSoft: "#42242A", pink: "#FF8AB7",
  overlay: "rgba(16,17,20,0.90)", scrim: "rgba(0,0,0,0.64)",
};

// Stable fallback for legacy components. Rebuilt screens use system theming.
export const COLORS = DARK_COLORS;

export function useAppTheme() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  return { colors: dark ? DARK_COLORS : LIGHT_COLORS, dark };
}

export const GRADIENTS = {
  accent: ["#5146E5", "#756AF3"] as const,
  card: ["transparent", "rgba(16,17,20,0.94)"] as const,
  hero: ["transparent", "rgba(16,17,20,0.68)", "rgba(16,17,20,0.98)"] as const,
  iridescent: ["#5146E5", "#756AF3", "#0B7557", "#5146E5"] as const,
  aurora: ["rgba(81,70,229,0.22)", "rgba(11,117,87,0.10)", "rgba(81,70,229,0)"] as const,
};

export interface GoalPalette {
  from: string;
  to: string;
  solid: string;
  tint: string;
  edge: string;
  emoji: string;
}

const palette = (solid: string, to: string, tint: string, edge: string): GoalPalette => ({ from: solid, to, solid, tint, edge, emoji: "" });

export const GOAL_PALETTES: Record<string, GoalPalette> = {
  "meet-people": palette("#3979C6", "#67A2E3", "rgba(57,121,198,0.14)", "rgba(57,121,198,0.55)"),
  "find-partner": palette("#C43E72", "#DC7199", "rgba(196,62,114,0.14)", "rgba(196,62,114,0.55)"),
  "get-active": palette("#B15C16", "#D98238", "rgba(177,92,22,0.14)", "rgba(177,92,22,0.55)"),
  "drinks-nightlife": palette("#7151BD", "#9473D4", "rgba(113,81,189,0.14)", "rgba(113,81,189,0.55)"),
  "live-music": palette("#A84B96", "#CE70BC", "rgba(168,75,150,0.14)", "rgba(168,75,150,0.55)"),
  "try-food": palette("#B85D20", "#DA8550", "rgba(184,93,32,0.14)", "rgba(184,93,32,0.55)"),
  "explore-arts": palette("#5146E5", "#7B73ED", "rgba(81,70,229,0.14)", "rgba(81,70,229,0.55)"),
  "family-fun": palette("#987000", "#C79A27", "rgba(152,112,0,0.14)", "rgba(152,112,0,0.55)"),
  "outdoor-fun": palette("#0B7557", "#3E9B7C", "rgba(11,117,87,0.14)", "rgba(11,117,87,0.55)"),
};

export const DEFAULT_PALETTE = palette("#5146E5", "#756AF3", "rgba(81,70,229,0.14)", "rgba(81,70,229,0.55)");
export const RADIUS = { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 };
export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const TYPE = { caption: 13, meta: 15, body: 16, title: 20, section: 24, hero: 32 };
export const HIT_SLOP = { top: 10, right: 10, bottom: 10, left: 10 };

export const SHADOWS = {
  sm: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 1 },
  md: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.10, shadowRadius: 12, elevation: 3 },
  tabBar: { shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 8 },
  glow: (_rgba: string) => ({ shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 2 }),
} as const;

export const OPACITY = { disabled: 0.42, pressed: 0.72, overlay: 0.9, borderSubtle: "1F", borderEmphasis: "55" } as const;
export const MOTION = { quick: 160, normal: 240, slow: 360, loop: 2400 } as const;
export const SHEET_HEIGHT = "85%" as const;
export const BOCA_RATON = { lat: 26.3587, lng: -80.0831 };
export const DEFAULT_RADIUS_MILES = 10;
