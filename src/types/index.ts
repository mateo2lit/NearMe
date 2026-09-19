export interface Venue {
  id: string;
  google_place_id: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string;
  category: VenueCategory;
  phone: string | null;
  website: string | null;
  photo_url: string | null;
  rating: number | null;
  price_level: number | null;
  hours: Record<string, string> | null;
  live_busyness: number | null;
}

export interface Event {
  id: string;
  venue_id: string | null;
  venue?: Venue;
  source: EventSource;
  source_id: string | null;
  title: string;
  description: string;
  category: EventCategory;
  subcategory: string;
  lat: number;
  lng: number;
  address: string;
  image_url: string | null;
  start_time: string;
  end_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  is_free: boolean;
  price_min: number | null;
  price_max: number | null;
  ticket_url: string | null;
  attendance: number | null;
  source_url: string | null;
  // Written by the sync pipeline (migration 015). Present on the detail
  // screen, which selects the whole row; absent from the feed RPC's column
  // list, so treat both as optional.
  last_verified_at?: string | null;
  verification_status?: string | null;
  tags: string[];
  rank_score?: number;
  blurb?: string;
  distance?: number; // computed, in miles
  // Alternate showtimes from same-day duplicate events merged into this one.
  // ISO strings, sorted ascending. Excludes the primary start_time.
  additionalStartTimes?: string[];
}

export type EventCategory =
  | "nightlife"
  | "sports"
  | "food"
  | "outdoors"
  | "arts"
  | "music"
  | "community"
  | "movies"
  | "fitness";

export type VenueCategory =
  | "bar"
  | "restaurant"
  | "theater"
  | "stadium"
  | "park"
  | "gym"
  | "club"
  | "venue"
  | "cinema"
  | "other";

export type EventSource =
  | "ticketmaster"
  | "google_places"
  | "scraped"
  | "municipal"
  | "community"
  | "reddit"
  | "claude"
  | "meetup"
  | "espn"
  | "pickleheads"
  | "university"
  | "highschool"
  | "google_events";

export type SwipeAction = "save" | "skip";

export interface CustomLocation {
  label: string;
  lat: number;
  lng: number;
}

export interface OnboardingAnswers {
  goals: string[];
  vibe: string | null;
  social: string | null;
  schedule: string | null;
  blocker: string | null;
  budget: string | null;
  happyHour: boolean;
}

export interface UserPreferences {
  categories: EventCategory[];
  tags: string[];
  radius: number; // miles
  // Null until a real location is resolved — never a hardcoded city.
  lat: number | null;
  lng: number | null;
  customLocation?: CustomLocation | null;
  onboarding?: OnboardingAnswers;
  hiddenCategories?: string[];
  hiddenTags?: string[];
}

export interface CategoryOption {
  id: EventCategory;
  label: string;
  icon: string;
  color: string;
}
