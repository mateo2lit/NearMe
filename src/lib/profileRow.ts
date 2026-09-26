/**
 * The `user_profiles` row for a set of preferences.
 *
 * claude-rank reads this row and returns 404 when it is missing, which the
 * client turns into an unranked feed with no error. The May onboarding saved
 * preferences to AsyncStorage only, so no production device ever had a row and
 * "picked for you" never ran. Both save paths build the row here so they
 * cannot drift apart again.
 */

export interface ProfileInput {
  categories?: string[];
  tags?: string[];
  hiddenCategories?: string[];
  hiddenTags?: string[];
  lat?: number | null;
  lng?: number | null;
  onboarding?: {
    goals?: string[];
    vibe?: string | null;
    social?: string | null;
    schedule?: string | null;
    blocker?: string | null;
    budget?: string | null;
    // Onboarding stores the chip id ("show" / "hide"); saved prefs store a boolean.
    happyHour?: boolean | string | null;
  };
}

function happyHourEnabled(v: boolean | string | null | undefined): boolean {
  if (typeof v === "boolean") return v;
  return v !== "hide";
}

export function buildProfileRow(userId: string, prefs: ProfileInput, now: Date = new Date()) {
  const o = prefs.onboarding ?? {};
  return {
    id: userId,
    goals: o.goals ?? [],
    vibe: o.vibe ?? null,
    social: o.social ?? null,
    schedule: o.schedule ?? null,
    blocker: o.blocker ?? null,
    budget: o.budget ?? null,
    happy_hour: happyHourEnabled(o.happyHour),
    categories: prefs.categories ?? [],
    tags: prefs.tags ?? [],
    hidden_categories: prefs.hiddenCategories ?? [],
    hidden_tags: prefs.hiddenTags ?? [],
    default_lat: prefs.lat ?? null,
    default_lng: prefs.lng ?? null,
    // claude-rank keys its score cache on this, so every save must move it.
    updated_at: now.toISOString(),
  };
}
