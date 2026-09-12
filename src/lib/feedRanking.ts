import { Event, UserPreferences } from "../types";
import { feedbackBias, FeedbackRecord } from "../services/feedback";
import { dedupeSameDayDuplicates } from "./dedupe";
import { effectiveStart } from "./time-windows";
import { preferenceSignalBias, PreferenceSignal } from "../services/preferenceSignals";

export interface RankedEvent extends Event {
  rank_score: number;
  matchReasons: string[];
  matchConfidence: "Strong match" | "Good match" | "Worth a look";
}

type FeedbackMap = Record<string, FeedbackRecord>;

const INTENT_MAP: Record<string, { categories: string[]; tags: string[]; label: string }> = {
  easy: { categories: ["food", "movies", "arts"], tags: ["chill", "seated"], label: "easygoing" },
  social: { categories: ["community", "nightlife"], tags: ["social", "singles"], label: "social" },
  live: { categories: ["music", "arts"], tags: ["live-music", "comedy"], label: "live entertainment" },
  learn: { categories: ["arts", "community"], tags: ["class", "workshop", "lecture"], label: "something to learn" },
  active: { categories: ["fitness", "sports", "outdoors"], tags: ["active", "outdoor"], label: "active" },
  free: { categories: [], tags: ["free"], label: "free" },
  culture: { categories: ["arts", "movies", "community"], tags: ["museum", "theater"], label: "arts and culture" },
  food: { categories: ["food"], tags: ["food", "tasting"], label: "food and drink" },
};

function sourceQuality(source: string): number {
  return ({ ticketmaster: 10, meetup: 9, university: 8, municipal: 8, espn: 7, pickleheads: 7, highschool: 6, scraped: 5, claude: 5, community: 4, reddit: 3 } as Record<string, number>)[source] ?? 3;
}

function priceLabel(event: Event): string | null {
  if (event.is_free) return "free";
  if (event.price_min != null) return `$${Math.round(event.price_min)}`;
  return null;
}

function scheduleMatches(event: Event, prefs: UserPreferences): boolean {
  const wanted = prefs.timePreferences ?? prefs.onboarding?.timePreferences ?? [];
  if (!wanted.length || wanted.includes("anytime")) return true;
  const d = effectiveStart(event);
  const hour = d.getHours();
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return wanted.some((slot) => {
    if (slot === "weekday-daytime") return !weekend && hour >= 9 && hour < 17;
    if (slot === "weekday-evenings") return !weekend && hour >= 17;
    if (slot === "weekend-mornings") return weekend && hour < 12;
    if (slot === "weekend-afternoons") return weekend && hour >= 12 && hour < 18;
    if (slot === "weekend-evenings") return weekend && hour >= 18;
    return false;
  });
}

function scoreOne(event: Event, prefs: UserPreferences, feedback: FeedbackMap, signals: PreferenceSignal[]): RankedEvent {
  let score = 28;
  const reasons: string[] = [];
  const tags = new Set((event.tags ?? []).map((t) => t.toLowerCase()));
  const intents = prefs.intents ?? prefs.onboarding?.intents ?? [];
  const selectedCategories = new Set(prefs.categories ?? []);

  if (selectedCategories.has(event.category)) {
    score += 17;
    reasons.push(`matches your ${event.category} interest`);
  }

  for (const intent of intents) {
    const spec = INTENT_MAP[intent];
    if (!spec) continue;
    const matches = spec.categories.includes(event.category) || spec.tags.some((tag) => tags.has(tag)) || (intent === "free" && event.is_free);
    if (matches) {
      score += 9;
      if (reasons.length < 2) reasons.push(spec.label);
    }
  }

  if (scheduleMatches(event, prefs)) {
    score += 12;
    if ((prefs.timePreferences?.length ?? 0) > 0 && reasons.length < 2) reasons.push("fits your available time");
  } else {
    score -= 9;
  }

  const radius = Math.max(1, prefs.radius || 10);
  if (event.distance != null) {
    const closeness = Math.max(0, 1 - event.distance / radius);
    score += closeness * 12;
    if (closeness >= 0.65 && reasons.length < 2) reasons.push("close to you");
  }

  const budgetMax = prefs.budgetMax ?? prefs.onboarding?.budgetMax;
  if (event.is_free) {
    score += 8;
    if (reasons.length < 2) reasons.push("free to attend");
  } else if (budgetMax != null && event.price_min != null) {
    if (event.price_min <= budgetMax) {
      score += 8;
      if (reasons.length < 2) reasons.push(`${priceLabel(event)} fits your budget`);
    } else {
      score -= 16;
    }
  }

  score += sourceQuality(event.source);
  if (event.source_url || event.ticket_url) score += 4;
  if (event.image_url) score += 3;
  if ((event.description?.length ?? 0) >= 80) score += 3;
  if (event.is_recurring) score -= 5;
  score += Math.max(-12, Math.min(12, feedbackBias(event, feedback) * 2));
  score += preferenceSignalBias(event, signals);

  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push(event.distance != null && event.distance <= radius ? "nearby and coming up" : "coming up soon");
  return {
    ...event,
    rank_score: rounded,
    matchReasons: reasons.slice(0, 2),
    matchConfidence: rounded >= 72 ? "Strong match" : rounded >= 56 ? "Good match" : "Worth a look",
  };
}

/** Rank once, then diversify so one venue, category, or recurring series cannot monopolize the top results. */
export function rankEvents(events: Event[], prefs: UserPreferences, feedback: FeedbackMap = {}, signals: PreferenceSignal[] = []): RankedEvent[] {
  const ageEligible = events.filter((event) => !(
    prefs.ageBand !== "21+" && (event.tags ?? []).some((tag) => tag === "21+" || tag === "21-plus")
  ));
  const ranked = dedupeSameDayDuplicates(ageEligible)
    .map((event) => scoreOne(event, prefs, feedback, signals))
    .sort((a, b) => b.rank_score - a.rank_score || effectiveStart(a).getTime() - effectiveStart(b).getTime());

  const output: RankedEvent[] = [];
  const venueCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  let recurringCount = 0;

  const take = (event: RankedEvent, relaxed: boolean) => {
    const venue = event.venue_id || event.venue?.name || event.address;
    if (!relaxed && venue && (venueCounts.get(venue) ?? 0) >= 2) return false;
    if (!relaxed && (categoryCounts.get(event.category) ?? 0) >= Math.max(3, Math.ceil((output.length + 1) * 0.35))) return false;
    if (!relaxed && event.is_recurring && recurringCount >= Math.max(2, Math.ceil((output.length + 1) * 0.4))) return false;
    output.push(event);
    if (venue) venueCounts.set(venue, (venueCounts.get(venue) ?? 0) + 1);
    categoryCounts.set(event.category, (categoryCounts.get(event.category) ?? 0) + 1);
    if (event.is_recurring) recurringCount++;
    return true;
  };

  ranked.forEach((event) => take(event, false));
  if (output.length < Math.min(20, ranked.length)) {
    const used = new Set(output.map((event) => event.id));
    ranked.forEach((event) => { if (!used.has(event.id) && output.length < 30) take(event, true); });
  }
  return output;
}

export function rankReason(event: RankedEvent): string {
  return event.matchReasons.length > 1
    ? `${event.matchReasons[0]} · ${event.matchReasons[1]}`
    : event.matchReasons[0];
}
