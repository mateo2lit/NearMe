import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  Animated,
  Alert,
  Image,
  Linking,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  COLORS,
  GRADIENTS,
  RADIUS,
  GOAL_PALETTES,
  DEFAULT_PALETTE,
  MOTION,
  SHADOWS,
  type GoalPalette,
} from "../src/constants/theme";
import { fetchNearbyEvents, triggerLocationSync, effectiveStart } from "../src/services/events";
import { setFeedHandoff, getFeedHandoff } from "../src/services/eventCache";
import { CelebrateStep } from "../src/components/CelebrateStep";
import { getOrCreateUserId } from "../src/hooks/usePreferences";
import { getEventImage } from "../src/constants/images";
import {
  useLocation,
  geocodeAddress,
  setManualLocation,
  refreshLocation,
} from "../src/hooks/useLocation";
import { Event } from "../src/types";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import {
  getOfferings,
  purchasePackage,
  restorePurchases,
  hasEntitlement,
} from "../src/services/iap";

function trialDaysFor(pkg: PurchasesPackage | null): number | null {
  if (!pkg) return null;
  const intro: any = (pkg.product as any).introPrice;
  if (!intro || intro.price !== 0) return null;
  const period = intro.period ?? intro.periodUnit;
  const value = intro.periodNumberOfUnits ?? intro.periodValue ?? intro.cycles ?? 1;
  const unit = (intro.periodUnit ?? intro.period?.unit ?? "").toString().toUpperCase();
  if (unit === "DAY") return value;
  if (unit === "WEEK") return value * 7;
  if (unit === "MONTH") return value * 30;
  return value;
}

const { width, height } = Dimensions.get("window");

// ─── Question Data ───────────────────────────────────────────

interface Option {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  description?: string;
  tags?: string[];
  categories?: string[];
}

const GOALS: Option[] = [
  { id: "meet-people", label: "Meet new people", icon: "people-outline", description: "Social mixers, groups, new friends", tags: ["social"], categories: ["community", "nightlife"] },
  { id: "find-partner", label: "Find a partner", icon: "heart-outline", description: "Singles events, date ideas, mixers", tags: ["date-night"], categories: ["nightlife", "food", "arts"] },
  { id: "get-active", label: "Get more active", icon: "barbell-outline", description: "Pickup sports, fitness, running clubs", tags: ["active"], categories: ["sports", "fitness"] },
  { id: "drinks-nightlife", label: "Go out more", icon: "wine-outline", description: "Bars, happy hours, nightlife", tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
  { id: "live-music", label: "Discover music", icon: "musical-notes-outline", description: "Concerts, live bands, DJ sets", tags: ["live-music"], categories: ["music"] },
  { id: "try-food", label: "Try new foods", icon: "restaurant-outline", description: "Restaurants, food events, tastings", tags: ["food"], categories: ["food"] },
  { id: "explore-arts", label: "Explore culture", icon: "color-palette-outline", description: "Galleries, theater, museums", tags: [], categories: ["arts", "movies"] },
  { id: "family-fun", label: "Family time", icon: "happy-outline", description: "Activities for the whole family", tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
  { id: "outdoor-fun", label: "Get outdoors", icon: "leaf-outline", description: "Parks, hikes, outdoor adventures", tags: ["outdoor"], categories: ["outdoors", "fitness"] },
];

const VIBES: Option[] = [
  { id: "chill", label: "Chill & relaxed", icon: "cafe-outline", description: "Low-key hangs, coffee shops, quiet spots" },
  { id: "social", label: "Social & lively", icon: "people-outline", description: "Packed bars, groups, lively scenes" },
  { id: "adventurous", label: "Adventurous", icon: "compass-outline", description: "Try new things, meet strangers" },
  { id: "romantic", label: "Romantic", icon: "heart-outline", description: "Intimate, date-night vibes" },
  { id: "energetic", label: "High-energy", icon: "flash-outline", description: "Dancing, parties, late nights" },
];

const SCHEDULES: Option[] = [
  { id: "weekday-evenings", label: "Weekday evenings", icon: "moon-outline", description: "After-work hangs" },
  { id: "weekend-mornings", label: "Weekend mornings", icon: "sunny-outline", description: "Brunch, markets, runs" },
  { id: "weekend-afternoons", label: "Weekend afternoons", icon: "partly-sunny-outline", description: "Day drinking, activities" },
  { id: "weekend-nights", label: "Weekend nights", icon: "sparkles-outline", description: "The main event" },
  { id: "anytime", label: "I'm flexible", icon: "shuffle-outline", description: "Show me everything" },
];

const BUDGETS: Option[] = [
  { id: "free", label: "Free stuff only", icon: "gift-outline", description: "$0 - keep it cheap", tags: ["free"] },
  { id: "budget", label: "Budget friendly", icon: "cash-outline", description: "Under $25" },
  { id: "moderate", label: "Happy to spend", icon: "card-outline", description: "$25 - $75" },
  { id: "premium", label: "Money's no issue", icon: "diamond-outline", description: "Whatever looks good" },
];

const SOCIAL_STYLES: Option[] = [
  { id: "solo", label: "Solo explorer", icon: "compass-outline", description: "Comfortable going alone, meet new people" },
  { id: "small-group", label: "Close friends", icon: "people-outline", description: "Prefer hanging with 1-3 friends" },
  { id: "big-group", label: "The whole crew", icon: "people-circle-outline", description: "Love big group energy" },
  { id: "mix", label: "Mix of both", icon: "swap-horizontal-outline", description: "Depends on the night" },
];

const BLOCKERS: Option[] = [
  { id: "dont-know", label: "Don't know what's happening", icon: "help-circle-outline", description: "This is why we built this" },
  { id: "no-one", label: "No one to go with", icon: "person-outline", description: "We'll show social & singles events" },
  { id: "too-busy", label: "Too busy to plan ahead", icon: "time-outline", description: "We'll show what's tonight/this week" },
  { id: "too-expensive", label: "Too expensive", icon: "trending-down-outline", description: "We'll surface free & cheap events", tags: ["free"] },
  { id: "wrong-scene", label: "Can't find my scene", icon: "locate-outline", description: "Our AI will get it right" },
];

const HAPPY_HOUR_OPTIONS: Option[] = [
  {
    id: "show",
    label: "Show happy hours",
    icon: "wine-outline",
    description: "Bar specials, $2 off, 2-for-1, weekday wind-downs — all in the feed.",
  },
  {
    id: "hide",
    label: "Hide happy hours",
    icon: "eye-off-outline",
    description: "Keep the feed focused on bigger events — concerts, singles nights, food events, sports.",
  },
];

// ─── Main Component ──────────────────────────────────────────

type StepKey = "welcome" | "goals" | "vibe" | "social" | "schedule" | "blocker" | "budget" | "happy-hour" | "location" | "building" | "teaser" | "paywall" | "celebrate";
const STEPS: StepKey[] = ["welcome", "goals", "vibe", "social", "schedule", "blocker", "budget", "happy-hour", "location", "building", "teaser", "paywall", "celebrate"];

// Curated list of cities the database is well-populated for. One-tap for the
// user (or App Review tester) to pick a city that's guaranteed to have events.
// Anything not on this list is reachable via the free-text search above.
const CITY_PRESETS: Array<{ label: string; lat: number; lng: number }> = [
  { label: "New York, NY", lat: 40.7128, lng: -74.0060 },
  { label: "Brooklyn, NY", lat: 40.6782, lng: -73.9442 },
  { label: "Los Angeles, CA", lat: 34.0522, lng: -118.2437 },
  { label: "San Francisco, CA", lat: 37.7749, lng: -122.4194 },
  { label: "Seattle, WA", lat: 47.6062, lng: -122.3321 },
  { label: "Portland, OR", lat: 45.5152, lng: -122.6784 },
  { label: "Chicago, IL", lat: 41.8781, lng: -87.6298 },
  { label: "Austin, TX", lat: 30.2672, lng: -97.7431 },
  { label: "Dallas, TX", lat: 32.7767, lng: -96.7970 },
  { label: "Houston, TX", lat: 29.7604, lng: -95.3698 },
  { label: "Denver, CO", lat: 39.7392, lng: -104.9903 },
  { label: "Phoenix, AZ", lat: 33.4484, lng: -112.0740 },
  { label: "Atlanta, GA", lat: 33.7490, lng: -84.3880 },
  { label: "Nashville, TN", lat: 36.1627, lng: -86.7816 },
  { label: "Boston, MA", lat: 42.3601, lng: -71.0589 },
  { label: "Philadelphia, PA", lat: 39.9526, lng: -75.1652 },
  { label: "Washington, DC", lat: 38.9072, lng: -77.0369 },
  { label: "Miami, FL", lat: 25.7617, lng: -80.1918 },
  { label: "Boca Raton, FL", lat: 26.3587, lng: -80.0831 },
  { label: "Orlando, FL", lat: 28.5383, lng: -81.3792 },
  { label: "Tampa, FL", lat: 27.9506, lng: -82.4572 },
  { label: "San Diego, CA", lat: 32.7157, lng: -117.1611 },
  { label: "Las Vegas, NV", lat: 36.1699, lng: -115.1398 },
  { label: "Minneapolis, MN", lat: 44.9778, lng: -93.2650 },
];

export default function Onboarding() {
  const router = useRouter();
  const location = useLocation();
  const [step, setStep] = useState<StepKey>("welcome");
  const [goals, setGoals] = useState<string[]>([]);
  const [vibe, setVibe] = useState<string>("");
  const [social, setSocial] = useState<string>("");
  const [schedule, setSchedule] = useState<string>("");
  const [blocker, setBlocker] = useState<string>("");
  const [budget, setBudget] = useState<string>("");
  const [happyHour, setHappyHour] = useState<string>("");
  const [matchedEvents, setMatchedEvents] = useState<Event[]>([]);
  const [matchCount, setMatchCount] = useState<number>(0);
  const [celebrateEventCount, setCelebrateEventCount] = useState(0);
  const [celebrateUserId, setCelebrateUserId] = useState<string>("");

  const stepIdx = STEPS.indexOf(step);
  const progress = stepIdx / (STEPS.length - 1);

  const goNext = () => {
    const nextIdx = stepIdx + 1;
    if (nextIdx < STEPS.length) setStep(STEPS[nextIdx]);
  };

  const goBack = () => {
    const prevIdx = stepIdx - 1;
    if (prevIdx >= 0) setStep(STEPS[prevIdx]);
  };

  // Save preferences early (during building) so the sync uses them
  const savePreferences = async () => {
    const tagSet = new Set<string>();
    const categorySet = new Set<string>();

    const selectedGoals = GOALS.filter((g) => goals.includes(g.id));
    selectedGoals.forEach((g) => {
      g.tags?.forEach((t) => tagSet.add(t));
      g.categories?.forEach((c) => categorySet.add(c));
    });

    const budgetOption = BUDGETS.find((b) => b.id === budget);
    budgetOption?.tags?.forEach((t) => tagSet.add(t));

    const blockerOption = BLOCKERS.find((b) => b.id === blocker);
    blockerOption?.tags?.forEach((t) => tagSet.add(t));

    // Social style affects category emphasis
    if (social === "solo") {
      categorySet.add("community");
      tagSet.add("singles");
    }

    // "Find partner" goal always boosts singles
    if (goals.includes("find-partner")) {
      tagSet.add("singles");
    }

    // Preserve any previously saved customLocation so we don't blow away the
    // user's chosen city from the location step.
    const existingPrefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const existingPrefs = existingPrefsStr ? JSON.parse(existingPrefsStr) : {};

    await AsyncStorage.setItem(
      "@nearme_preferences",
      JSON.stringify({
        ...existingPrefs,
        categories: Array.from(categorySet),
        tags: Array.from(tagSet),
        radius: 10,
        happyHourEnabled: happyHour !== "hide",
        onboarding: { goals, vibe, social, schedule, blocker, budget, happyHour },
      })
    );
  };

  // Only called on successful subscription/trial start
  const unlockApp = async () => {
    // Save events fetched during building step so Discover can hydrate
    // instantly — user should NEVER see "no events" right after paying.
    if (matchedEvents.length > 0) {
      await setFeedHandoff(matchedEvents);
    }
    await AsyncStorage.setItem("@nearme_onboarded", "true");
    await AsyncStorage.setItem("@nearme_subscribed", "true");

    const handoff = await getFeedHandoff();
    setCelebrateEventCount(handoff?.length || 0);
    setCelebrateUserId(await getOrCreateUserId());
    setStep("celebrate");
  };

  const finishOnboarding = () => {
    router.replace("/(tabs)");
  };

  // Step routing
  if (step === "welcome") return <WelcomeStep onNext={goNext} />;
  if (step === "location") {
    return (
      <LocationStep
        location={location}
        onBack={goBack}
        onNext={goNext}
        progress={progress}
        stepIdx={stepIdx}
      />
    );
  }
  if (step === "building") {
    // BuildingStep requires a real location. The location step before this
    // guarantees lat/lng are set, but guard anyway so a bad route doesn't
    // crash the sync call.
    if (location.lat == null || location.lng == null) {
      return (
        <LocationStep
          location={location}
          onBack={goBack}
          onNext={goNext}
          progress={progress}
          stepIdx={stepIdx}
        />
      );
    }
    return (
      <BuildingStep
        goals={goals}
        vibe={vibe}
        blocker={blocker}
        lat={location.lat}
        lng={location.lng}
        onDone={(events, count) => {
          setMatchedEvents(events);
          setMatchCount(count);
          goNext();
        }}
        savePreferences={savePreferences}
      />
    );
  }
  if (step === "teaser") {
    return (
      <TeaserStep
        events={matchedEvents}
        count={matchCount}
        goals={goals}
        onUnlock={goNext}
      />
    );
  }
  if (step === "paywall") return <PaywallStep onSubscribe={unlockApp} onBack={goBack} />;
  if (step === "celebrate") {
    return <CelebrateStep eventCount={celebrateEventCount} userId={celebrateUserId} onDone={finishOnboarding} />;
  }

  // Question steps share the same UI shell
  return (
    <View style={styles.container}>
      <Header progress={progress} onBack={goBack} stepIdx={stepIdx} totalSteps={9} />

      {step === "goals" && (
        <QuestionStep
          title="What do you want out of the next month?"
          subtitle="Your AI agent will plan the nights that get you there. Pick everything that applies."
          options={GOALS}
          multi
          selected={goals}
          onChange={setGoals}
          onNext={goNext}
          canContinue={goals.length > 0}
          continueLabel={goals.length > 0 ? `Continue (${goals.length} picked)` : "Pick at least one"}
          paletteFor={(id) => GOAL_PALETTES[id] || DEFAULT_PALETTE}
        />
      )}

      {step === "vibe" && (
        <QuestionStep
          title="What energy do you want?"
          subtitle="Your agent will read the room and only surface nights that match."
          options={VIBES}
          selected={vibe ? [vibe] : []}
          onChange={(arr) => setVibe(arr[0] || "")}
          onNext={goNext}
          canContinue={!!vibe}
          continueLabel="That's me"
        />
      )}

      {step === "social" && (
        <QuestionStep
          title="Solo, plus-one, or pack?"
          subtitle="How you like to roll — I'll match you to events where it fits."
          options={SOCIAL_STYLES}
          selected={social ? [social] : []}
          onChange={(arr) => setSocial(arr[0] || "")}
          onNext={goNext}
          canContinue={!!social}
          continueLabel="Got it"
        />
      )}

      {step === "schedule" && (
        <QuestionStep
          title="When can I show up for you?"
          subtitle="I'll prioritize nights you're actually free."
          options={SCHEDULES}
          selected={schedule ? [schedule] : []}
          onChange={(arr) => setSchedule(arr[0] || "")}
          onNext={goNext}
          canContinue={!!schedule}
          continueLabel="Lock it in"
        />
      )}

      {step === "blocker" && (
        <QuestionStep
          title="What usually gets in the way?"
          subtitle="Tell me — I'll route around it so you actually go out."
          options={BLOCKERS}
          selected={blocker ? [blocker] : []}
          onChange={(arr) => setBlocker(arr[0] || "")}
          onNext={goNext}
          canContinue={!!blocker}
          continueLabel="I'll handle it"
        />
      )}

      {step === "budget" && (
        <QuestionStep
          title="What am I working with?"
          subtitle="Last quick one. I'll stay inside this."
          options={BUDGETS}
          selected={budget ? [budget] : []}
          onChange={(arr) => setBudget(arr[0] || "")}
          onNext={goNext}
          canContinue={!!budget}
          continueLabel="Set the budget"
        />
      )}

      {step === "happy-hour" && (
        <QuestionStep
          title="Happy hours — in or out?"
          subtitle="Bars publish a ton of these. Up to you whether they belong in your feed."
          options={HAPPY_HOUR_OPTIONS}
          selected={happyHour ? [happyHour] : []}
          onChange={(arr) => setHappyHour(arr[0] || "")}
          onNext={goNext}
          canContinue={!!happyHour}
          continueLabel="Start building"
          contextBlock={
            <>
              <View style={styles.contextCard}>
                <View style={styles.contextIconWrap}>
                  <Ionicons name="time-outline" size={18} color={COLORS.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextTitle}>Why we ask</Text>
                  <Text style={styles.contextBody}>
                    Recurring happy hours can take up a big chunk of nightlife listings. Hiding them keeps the feed focused on one-off events.
                  </Text>
                </View>
              </View>
              <View style={styles.contextCard}>
                <View style={styles.contextIconWrap}>
                  <Ionicons name="sparkles-outline" size={18} color={COLORS.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextTitle}>Either way works</Text>
                  <Text style={styles.contextBody}>
                    Hidden events still exist — they just don't clutter Discover and the Map.
                  </Text>
                </View>
              </View>
            </>
          }
          footerNote="You can change this anytime in Settings."
        />
      )}
    </View>
  );
}

// ─── Header w/ Progress Bar ──────────────────────────────────

function Header({ progress, onBack, stepIdx, totalSteps }: { progress: number; onBack: () => void; stepIdx: number; totalSteps: number }) {
  const progressAnim = useRef(new Animated.Value(progress)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: progress,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={24} color={COLORS.muted} />
      </TouchableOpacity>

      <View style={styles.progressBar}>
        <Animated.View style={[styles.progressFill, { width: progressWidth }]}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      </View>

      <Text style={styles.stepCounter}>
        {Math.min(stepIdx, totalSteps)}/{totalSteps}
      </Text>
    </View>
  );
}

// ─── Welcome Step ────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 9000,
        useNativeDriver: true,
      })
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const translateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -8],
  });

  return (
    <View style={[styles.container, { justifyContent: "center", paddingHorizontal: 32 }]}>
      <Animated.View style={{ alignItems: "center", transform: [{ translateY }] }}>
        <View style={styles.welcomeIconWrap}>
          <Animated.View
            style={[styles.welcomeIconRing, { transform: [{ rotate: spin }] }]}
          >
            <LinearGradient
              colors={GRADIENTS.iridescent as any}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
          <View style={styles.welcomeIconCore}>
            <Text style={styles.welcomeEmojiBig}>✨</Text>
          </View>
        </View>
      </Animated.View>

      <Text style={styles.welcomeKicker}>YOUR PERSONAL AI EVENT AGENT</Text>
      <Text style={styles.welcomeTitle}>Plans the night.{"\n"}You just show up.</Text>
      <Text style={styles.welcomeSubtitle}>
        Tell your agent what you're after — dating, sports, friends, music — and it'll find the events that actually move you forward.
      </Text>

      <View style={styles.welcomeFeatures}>
        {([
          { icon: "navigate-outline", emoji: "🎯", text: "Matched to your goals, not the algorithm's" },
          { icon: "flash-outline", emoji: "⚡", text: "Real events happening near you — tonight, this weekend" },
          { icon: "shield-checkmark-outline", emoji: "🛡️", text: "No noise. No scrolling. No spam." },
        ] as Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; emoji: string; text: string }>).map((f, i) => (
          <View key={i} style={styles.welcomeFeature}>
            <View style={styles.welcomeFeatureIconWrap}>
              <Text style={{ fontSize: 18 }}>{f.emoji}</Text>
            </View>
            <Text style={styles.welcomeFeatureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={[styles.primaryBtn, SHADOWS.glow("rgba(124,108,240,0.55)")]} onPress={onNext} activeOpacity={0.85}>
        <LinearGradient
          colors={GRADIENTS.accent as any}
          style={styles.btnGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={styles.primaryBtnText}>Meet your agent</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      <Text style={styles.takesText}>Takes 60 seconds. No card required.</Text>
    </View>
  );
}

// ─── Question Step ───────────────────────────────────────────

interface QuestionStepProps {
  title: string;
  subtitle: string;
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  onNext: () => void;
  canContinue: boolean;
  continueLabel: string;
  multi?: boolean;
  contextBlock?: React.ReactNode;
  footerNote?: string;
}

function QuestionStep({ title, subtitle, options, selected, onChange, onNext, canContinue, continueLabel, multi, contextBlock, footerNote, paletteFor }: QuestionStepProps & { paletteFor?: (optionId: string) => GoalPalette }) {
  const toggle = (id: string) => {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    } else {
      onChange([id]);
    }
  };

  // The continue button takes the color of the first-selected option's
  // palette — when the user picks "find a partner" the CTA feels coral; when
  // they pick "get active" it feels orange. Falls back to the default purple
  // gradient before they've picked anything.
  const ctaPalette = paletteFor && selected.length
    ? paletteFor(selected[0])
    : DEFAULT_PALETTE;

  return (
    <>
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSubtitle}>{subtitle}</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 180 }}>
          {contextBlock ? <View style={styles.contextWrap}>{contextBlock}</View> : null}
          <View style={styles.optionList}>
            {options.map((opt) => {
              const palette = paletteFor ? paletteFor(opt.id) : DEFAULT_PALETTE;
              return (
                <OptionRow
                  key={opt.id}
                  option={opt}
                  palette={palette}
                  selected={selected.includes(opt.id)}
                  onPress={() => toggle(opt.id)}
                />
              );
            })}
          </View>

          {footerNote ? (
            <View style={styles.footerNoteWrap}>
              <Ionicons name="settings-outline" size={14} color={COLORS.muted} />
              <Text style={styles.footerNoteText}>{footerNote}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.primaryBtn, !canContinue && { opacity: 0.4 }, canContinue && SHADOWS.glow(ctaPalette.edge)]}
          onPress={onNext}
          disabled={!canContinue}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={canContinue ? [ctaPalette.from, ctaPalette.to] : [COLORS.muted, COLORS.muted]}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.primaryBtnText}>{continueLabel}</Text>
            {canContinue && <Ionicons name="arrow-forward" size={20} color="#fff" />}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </>
  );
}

// Single option card — used for goals, vibes, schedules, etc. Goals pass
// their per-goal palette; other steps use DEFAULT_PALETTE. When palette.emoji
// is set we show the emoji in a gradient pill; otherwise we fall back to the
// Ionicon in a tinted circle.
function OptionRow({
  option,
  palette,
  selected,
  onPress,
}: {
  option: Option;
  palette: GoalPalette;
  selected: boolean;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: selected ? 1.015 : 1,
      friction: 6,
      tension: 120,
      useNativeDriver: true,
    }).start();
  }, [selected]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity
        style={[
          styles.optionCard,
          selected && {
            backgroundColor: palette.tint,
            borderColor: palette.edge,
            ...SHADOWS.glow(palette.edge),
          },
        ]}
        onPress={onPress}
        activeOpacity={0.78}
      >
        {palette.emoji ? (
          <View style={styles.optionEmojiShell}>
            <LinearGradient
              colors={[palette.from, palette.to]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <Text style={styles.optionEmoji}>{palette.emoji}</Text>
          </View>
        ) : (
          <View
            style={[
              styles.optionIconTint,
              {
                backgroundColor: selected ? palette.tint : COLORS.cardAlt,
                borderColor: selected ? palette.edge : COLORS.border,
              },
            ]}
          >
            <Ionicons name={option.icon} size={20} color={selected ? palette.solid : COLORS.muted} />
          </View>
        )}

        <View style={{ flex: 1 }}>
          <Text style={styles.optionLabel}>{option.label}</Text>
          {option.description && <Text style={styles.optionDescription}>{option.description}</Text>}
        </View>

        {selected && (
          <View style={[styles.optionCheck, { backgroundColor: palette.solid }]}>
            <Ionicons name="checkmark" size={16} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Location Step ───────────────────────────────────────────
// A reviewer-proof "Where are you?" step. Always shown so users (and Apple
// reviewers) explicitly confirm or pick a location before we sync events. If
// GPS is denied or fails, the city chips and address input let anyone get a
// populated feed without depending on device location services.

function LocationStep({
  location,
  onBack,
  onNext,
  progress,
  stepIdx,
}: {
  location: ReturnType<typeof useLocation>;
  onBack: () => void;
  onNext: () => void;
  progress: number;
  stepIdx: number;
}) {
  const [addressInput, setAddressInput] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isRequestingGPS, setIsRequestingGPS] = useState(false);

  const hasLocation = location.lat != null && location.lng != null;

  const handleUseGPS = async () => {
    setIsRequestingGPS(true);
    await refreshLocation();
    setIsRequestingGPS(false);
  };

  const handlePickCity = async (city: typeof CITY_PRESETS[number]) => {
    await setManualLocation(city);
  };

  const handleSubmitAddress = async () => {
    if (!addressInput.trim()) return;
    Keyboard.dismiss();
    setIsGeocoding(true);
    const result = await geocodeAddress(addressInput.trim());
    setIsGeocoding(false);
    if (result) {
      await setManualLocation(result);
      setAddressInput("");
    } else {
      Alert.alert("Not found", "Couldn't find that address. Try adding city/state.");
    }
  };

  return (
    <View style={styles.container}>
      <Header progress={progress} onBack={onBack} stepIdx={stepIdx} totalSteps={9} />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.locationScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.stepTitle}>Where should I look?</Text>
        <Text style={styles.stepSubtitle}>
          Drop a pin, pick a city, or let me use your GPS. I'll search around it. You can change this anytime.
        </Text>

        {/* Current detected/chosen location */}
        <View style={styles.locStatusCard}>
          <View style={styles.locStatusIcon}>
            <Ionicons
              name={hasLocation ? "checkmark-circle" : "location-outline"}
              size={20}
              color={hasLocation ? COLORS.success : COLORS.muted}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locStatusLabel}>
              {hasLocation ? "Using" : "No location yet"}
            </Text>
            <Text style={styles.locStatusName}>
              {hasLocation
                ? location.cityName || `${location.lat?.toFixed(2)}, ${location.lng?.toFixed(2)}`
                : "Allow GPS or pick a city below"}
            </Text>
          </View>
        </View>

        {/* GPS button */}
        <TouchableOpacity
          style={styles.locGpsBtn}
          onPress={handleUseGPS}
          activeOpacity={0.8}
          disabled={isRequestingGPS}
        >
          <Ionicons name="navigate" size={18} color={COLORS.accent} />
          <Text style={styles.locGpsBtnText}>
            {isRequestingGPS ? "Detecting…" : "Use my location"}
          </Text>
        </TouchableOpacity>

        <View style={styles.locDividerRow}>
          <View style={styles.locDividerLine} />
          <Text style={styles.locDividerText}>OR SEARCH ANY CITY</Text>
          <View style={styles.locDividerLine} />
        </View>

        {/* Search input (primary, free-text) */}
        <View style={styles.locSearchWrap}>
          <Ionicons name="search" size={16} color={COLORS.muted} />
          <TextInput
            style={styles.locSearchInput}
            value={addressInput}
            onChangeText={setAddressInput}
            placeholder="Type any city, neighborhood, or full address"
            placeholderTextColor={COLORS.muted}
            returnKeyType="search"
            onSubmitEditing={handleSubmitAddress}
            autoCapitalize="words"
          />
          {!!addressInput && (
            <TouchableOpacity onPress={() => setAddressInput("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={COLORS.muted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.locAddressBtn,
              (!addressInput.trim() || isGeocoding) && { opacity: 0.4 },
            ]}
            onPress={handleSubmitAddress}
            disabled={!addressInput.trim() || isGeocoding}
            activeOpacity={0.8}
          >
            {isGeocoding ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.locAddressBtnText}>Set</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.locQuickPickLabel}>Quick picks</Text>

        {/* Quick-pick chips (horizontally scrollable now we ship more cities) */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.locChipScroll}
        >
          {CITY_PRESETS.map((c) => {
            const selected =
              location.lat === c.lat && location.lng === c.lng;
            return (
              <TouchableOpacity
                key={c.label}
                style={[styles.locCityChip, selected && styles.locCityChipSelected]}
                onPress={() => handlePickCity(c)}
                activeOpacity={0.7}
              >
                <Text style={[styles.locCityChipText, selected && styles.locCityChipTextSelected]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.locContinueBar}>
        <TouchableOpacity
          style={[styles.primaryBtn, !hasLocation && { opacity: 0.4 }]}
          onPress={onNext}
          disabled={!hasLocation}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.primaryBtnText}>
              {hasLocation ? "Continue" : "Pick a location"}
            </Text>
            {hasLocation && <Ionicons name="arrow-forward" size={20} color="#fff" />}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Building Step (real AI scanning) ────────────────────────

function BuildingStep({
  goals,
  vibe,
  blocker,
  lat,
  lng,
  onDone,
  savePreferences,
}: {
  goals: string[];
  vibe: string;
  blocker: string;
  lat: number;
  lng: number;
  onDone: (events: Event[], count: number) => void;
  savePreferences: () => Promise<void>;
}) {
  const [currentTask, setCurrentTask] = useState(0);
  const [progress, setProgress] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  // Dynamic task list based on user's actual answers — phrased as an AI
  // agent narrating its own work, not a passive progress bar.
  const goalLabels = goals
    .map((id) => GOALS.find((g) => g.id === id)?.label)
    .filter((s): s is string => Boolean(s));
  const goalLine =
    goalLabels.length === 0
      ? "Loading your goals"
      : goalLabels.length === 1
        ? `Locking in: ${goalLabels[0].toLowerCase()}`
        : goalLabels.length === 2
          ? `Balancing ${goalLabels[0].toLowerCase()} + ${goalLabels[1].toLowerCase()}`
          : `Weaving together ${goalLabels.length} priorities`;
  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label.toLowerCase() || vibe || "your";
  const blockerLabel = BLOCKERS.find((b) => b.id === blocker)?.label.toLowerCase();

  const tasks = [
    goalLine,
    "Calling every venue within 15 miles",
    blockerLabel
      ? `Working around "${blockerLabel}"`
      : "Cross-referencing what's actually worth your night",
    `Tuning for a ${vibeLabel} energy`,
    "Picking the one event you'd kick yourself for missing",
  ];

  useEffect(() => {
    savePreferences();

    // Spinning ring
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2500, useNativeDriver: true })
    ).start();

    let cancelled = false;
    let fetchDone = false;

    // Animate progress based on real milestones
    const animateTo = (target: number, duration: number) => {
      Animated.timing(progressAnim, {
        toValue: target,
        duration,
        useNativeDriver: false,
      }).start();
      setProgress(target);
    };

    // Schedule tasks to advance with varied pacing — non-monotonic so it
    // feels like real computational work rather than a linear timer
    const taskTimings = [1500, 800, 2100, 1100]; // delay BEFORE each transition
    let taskElapsed = 0;
    const taskTimers: any[] = [];

    for (let i = 0; i < taskTimings.length; i++) {
      taskElapsed += taskTimings[i];
      taskTimers.push(
        setTimeout(() => {
          if (cancelled) return;
          setCurrentTask(i + 1);
          animateTo((i + 1) / tasks.length, taskTimings[i]);
        }, taskElapsed)
      );
    }

    // While we're waiting for the fetch on the LAST task ("Ranking your top
    // picks"), creep the progress bar from 80% toward 95% so the user doesn't
    // feel stuck. When the fetch completes we jump to 100%.
    const driftTimer = setTimeout(() => {
      if (cancelled || fetchDone) return;
      Animated.timing(progressAnim, {
        toValue: 0.95,
        duration: 4000,
        useNativeDriver: false,
      }).start();
    }, taskElapsed);

    // Run real sync using user's ACTUAL location (from useLocation hook)
    (async () => {
      try {
        await triggerLocationSync(lat, lng, 15, true);

        // Try within 15 miles first, fall back to wider radius if nothing
        let events = await fetchNearbyEvents(lat, lng, 15);
        if (events.length === 0) {
          events = await fetchNearbyEvents(lat, lng, 30);
        }
        if (events.length === 0) {
          events = await fetchNearbyEvents(lat, lng, 50);
        }
        fetchDone = true;

        const minTotal = taskElapsed + 1200;
        const remainder = Math.max(0, minTotal - taskElapsed);

        setTimeout(() => {
          if (cancelled) return;
          setCurrentTask(tasks.length);
          animateTo(1, 500);
          setTimeout(() => {
            if (!cancelled) onDone(events, events.length);
          }, 600);
        }, remainder);
      } catch {
        setTimeout(() => {
          if (cancelled) return;
          setCurrentTask(tasks.length);
          animateTo(1, 500);
          setTimeout(() => {
            if (!cancelled) onDone([], 0);
          }, 600);
        }, 7500);
      }
    })();

    return () => {
      cancelled = true;
      taskTimers.forEach(clearTimeout);
      clearTimeout(driftTimer);
    };
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  // Agent-voice status. Reads like the AI is narrating its own search,
  // not a generic loading spinner.
  const statusLines = [
    "Reading what you came here for…",
    "Pulling the neighborhood into focus…",
    "Cross-checking every event against your goals…",
    "Filtering out the noise…",
    "Locking in your top pick…",
    "Ready.",
  ];

  // Use the user's first selected goal to color the ring + progress bar —
  // makes the loading state feel personal to what they asked for.
  const heroPalette = primaryPaletteForGoals(goals);

  return (
    <View style={[styles.container, { justifyContent: "center", paddingHorizontal: 32 }]}>
      <View style={styles.buildingIconWrap}>
        <Animated.View style={[styles.buildingRing, { transform: [{ rotate: spin }] }]}>
          <LinearGradient
            colors={GRADIENTS.iridescent as any}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        </Animated.View>
        <View style={styles.buildingCore}>
          <Text style={{ fontSize: 44 }}>🧠</Text>
        </View>
      </View>

      <Text style={styles.buildingTitle}>Your agent is on it.</Text>
      <Text style={styles.buildingCount}>
        {statusLines[Math.min(currentTask, statusLines.length - 1)]}
      </Text>

      <View style={styles.buildingProgress}>
        <Animated.View style={[styles.buildingProgressFill, { width: progressWidth }]}>
          <LinearGradient
            colors={[heroPalette.from, heroPalette.to] as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
      </View>

      <View style={styles.taskList}>
        {tasks.map((task, i) => (
          <View key={i} style={styles.taskRow}>
            <View
              style={[
                styles.taskDot,
                i < currentTask && { borderColor: heroPalette.solid, backgroundColor: heroPalette.solid },
                i === currentTask && { borderColor: heroPalette.edge, backgroundColor: heroPalette.tint },
              ]}
            >
              {i < currentTask && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>
            <Text
              style={[
                styles.taskText,
                i === currentTask && { color: COLORS.text, fontWeight: "700" },
                i < currentTask && { color: COLORS.muted, textDecorationLine: "line-through" },
              ]}
            >
              {task}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Teaser Step ─────────────────────────────────────────────

// The onboarding hero is the single highest-leverage event the user ever
// sees — it decides whether they pay. The 2026-05-11 strip-club / hookah
// incident exposed how easily a weak-but-recent match (category-only +
// today's date) used to top the score table. The rules below are deliberately
// stricter than the in-app feed scoring:
//
//   - Adult/strip-club content is excluded outright (defense in depth — the
//     edge-function filter + discover_events RPC also drop these).
//   - 21+ content scores positively only if the user picked a goal where
//     21+ is implied (going out, finding a partner, live music).
//   - Family-tagged events lose points if the user picked grown-up goals
//     exclusively.
//   - Pure category matches are weak (2 pts). A real *tag* match is what
//     qualifies an event to be the hero — recency alone can't drag a
//     mis-matched event into the slot.
//   - Multi-goal matches get a big boost — an event that hits two of the
//     user's selected goals is the "perfect for you" pick.
//   - pickBestMatch enforces a minimum score floor; if nothing clears the
//     bar, the TeaserStep falls back to "we're still building your feed"
//     instead of showing a weak hero.

// Floor for the onboarding hero pick. Was 8 in 1.0.4 but that was tuned for
// a feed packed with strong matches; in sparser markets (or after over-
// aggressive filtering in 010) it triggered the "still looking" fallback
// even when 100+ events were available. A single tag match (5pts) + minimal
// recency (2pts) = 7 clears 5. A category-only match plus recency ≥ 5
// (i.e. event is in the next 4 days) also clears.
const HERO_MIN_SCORE = 5;

const NIGHTLIFE_LEANING_GOALS = new Set([
  "drinks-nightlife",
  "find-partner",
  "live-music",
]);

function scoreEventForGoals(event: Event, selectedGoalIds: string[]): number {
  // Hard exclusion — adult content can never be the hero. The edge-function
  // filter and discover_events RPC already block these; this is a third
  // line of defense for any stale client cache.
  if (event.tags?.includes("adult")) return -Infinity;

  const goalDefs = GOALS.filter((g) => selectedGoalIds.includes(g.id));

  let tagHits = 0;
  let categoryHits = 0;
  let goalsHit = 0;

  for (const g of goalDefs) {
    let scoredThisGoal = false;
    for (const t of g.tags || []) {
      if (event.tags?.includes(t)) {
        tagHits++;
        scoredThisGoal = true;
      }
    }
    for (const c of g.categories || []) {
      if (event.category === c) {
        categoryHits++;
        scoredThisGoal = true;
      }
    }
    if (scoredThisGoal) goalsHit++;
  }

  let score = tagHits * 5 + categoryHits * 2;

  // Multi-goal match — "this hits everything you came for"
  if (goalsHit >= 2) score += 12;
  if (goalsHit >= 3) score += 6;

  // Singles boost when user is looking for a partner
  if (selectedGoalIds.includes("find-partner") && event.tags?.includes("singles")) {
    score += 15;
  }

  // 21+ is only welcome when the user picked a goal that implies it.
  const wantsNightlife = selectedGoalIds.some((g) => NIGHTLIFE_LEANING_GOALS.has(g));
  if (event.tags?.includes("21+") && !wantsNightlife) {
    score -= 18;
  }

  // Family-coded events get penalized when the user picked grown-up goals
  // exclusively (a kids' carnival isn't the hero for someone who picked
  // "find a partner + go out more").
  const wantsFamily = selectedGoalIds.includes("family-fun");
  if (event.tags?.includes("family") && !wantsFamily && selectedGoalIds.length > 0) {
    score -= 8;
  }

  // Recency — still meaningful but never dominant. A perfect match 4 days
  // out beats a generic match tonight.
  if (event.start_time) {
    const daysUntil = (effectiveStart(event).getTime() - Date.now()) / 86_400_000;
    if (daysUntil < 0) return -Infinity;
    if (daysUntil < 1) score += 10;
    else if (daysUntil < 2) score += 7;
    else if (daysUntil < 4) score += 5;
    else if (daysUntil < 7) score += 2;
    else if (daysUntil > 14) score -= 5;
  }

  return score;
}

function pickBestMatch(events: Event[], goals: string[]): Event | undefined {
  if (!events.length) return undefined;
  const scored = events
    .map((e) => ({ event: e, score: scoreEventForGoals(e, goals) }))
    .filter((s) => Number.isFinite(s.score) && s.score >= HERO_MIN_SCORE);
  if (!scored.length) return undefined;
  scored.sort((a, b) => b.score - a.score);
  return scored[0].event;
}

// Map the user's selected goals into a single representative palette for
// the screen accent (the hero card border, the building ring stops, etc).
// When multiple are selected we pick the first — the order in the GOALS
// list is intentional, with the most personality-driving goals (dating,
// nightlife) earlier so they win the accent.
function primaryPaletteForGoals(goalIds: string[]): GoalPalette {
  for (const id of goalIds) {
    if (GOAL_PALETTES[id]) return GOAL_PALETTES[id];
  }
  return DEFAULT_PALETTE;
}

function TeaserStep({
  events,
  count,
  goals,
  onUnlock,
}: {
  events: Event[];
  count: number;
  goals: string[];
  onUnlock: () => void;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, []);

  // Score events against user's goals and pick the best match
  const teaserEvent = pickBestMatch(events, goals);
  // Sort remaining events by score too (for the blurred stack)
  const remainingEvents = events
    .filter((e) => e.id !== teaserEvent?.id && !e.tags?.includes("adult"))
    .map((e) => ({ event: e, score: scoreEventForGoals(e, goals) }))
    .filter((s) => Number.isFinite(s.score))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.event);

  // Real count — no fabrication. Excludes adult content even from the
  // numeric total so the headline matches what we're willing to show.
  const totalMatches = events.filter((e) => !e.tags?.includes("adult")).length;

  // Palette = first selected goal's color so the hero adopts its energy.
  const heroPalette = primaryPaletteForGoals(goals);

  // Honest match percentage derived from the actual score. The score range
  // for a strong multi-goal+singles+tag-match hit is 30-50; we map that to
  // 88-97% so it reads as "great match" without claiming 100%.
  const matchPct = teaserEvent
    ? Math.min(97, 78 + Math.round(Math.max(0, scoreEventForGoals(teaserEvent, goals)) * 0.5))
    : 0;

  return (
    <View style={[styles.container, { paddingTop: 60 }]}>
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 160 }}
      >
        <View style={styles.teaserHero}>
          <View style={[styles.teaserBadge, { backgroundColor: heroPalette.tint, borderColor: heroPalette.edge }]}>
            <Ionicons name="sparkles" size={14} color={heroPalette.solid} />
            <Text style={[styles.teaserBadgeText, { color: heroPalette.solid }]}>YOUR AGENT FOUND IT</Text>
          </View>
          {teaserEvent ? (
            <>
              <Text style={styles.teaserTitle}>
                This is the one{"\n"}
                <Text style={{ color: heroPalette.solid }}>worth showing up for.</Text>
              </Text>
              <Text style={styles.teaserSubtitle}>
                Out of {totalMatches} events nearby, your agent locked onto this one — it hits everything you said you wanted.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.teaserTitle}>
                Your agent is{"\n"}
                <Text style={{ color: heroPalette.solid }}>still on the hunt.</Text>
              </Text>
              <Text style={styles.teaserSubtitle}>
                Fresh events are landing right now. Start your trial — by the time you tap Discover, your feed is ready.
              </Text>
            </>
          )}

          {/* Goals chips — show the user's goals back to them so the hero
              feels personalized, with each in its own color. */}
          {goals.length > 0 && (
            <View style={styles.goalBubbles}>
              {goals.slice(0, 5).map((g) => {
                const p = GOAL_PALETTES[g] || DEFAULT_PALETTE;
                return (
                  <View
                    key={g}
                    style={[styles.goalBubble, { backgroundColor: p.tint, borderColor: p.edge }]}
                  >
                    <Text style={{ fontSize: 16 }}>{p.emoji || "✨"}</Text>
                  </View>
                );
              })}
              {goals.length > 5 && (
                <View style={styles.goalBubble}>
                  <Text style={{ fontSize: 11, fontWeight: "800", color: COLORS.text }}>+{goals.length - 5}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Only show teaser if we have a real event */}
        {teaserEvent && <TeaserCard event={teaserEvent} palette={heroPalette} matchPct={matchPct} />}

        {/* If no events qualify for the hero, show an honest message */}
        {!teaserEvent && (
          <View style={styles.noEventsCard}>
            <View style={[styles.noEventsIcon, { backgroundColor: heroPalette.tint }]}>
              <Ionicons name="radio" size={28} color={heroPalette.solid} />
            </View>
            <Text style={styles.noEventsTitle}>Still scanning your area</Text>
            <Text style={styles.noEventsText}>
              Your agent is pulling in fresh events right now. Start your trial — by the time you land on Discover, the feed is full.
            </Text>
          </View>
        )}

        {/* Locked cards — only show if there ARE real events to lock */}
        {remainingEvents.length > 0 && (
          <View style={styles.lockedSection}>
            <View style={styles.lockedDivider}>
              <View style={styles.lockedLine} />
              <View style={[styles.lockedCountBadge, { borderColor: heroPalette.edge }]}>
                <Ionicons name="lock-closed" size={12} color={heroPalette.solid} />
                <Text style={[styles.lockedCountText, { color: heroPalette.solid }]}>
                  +{remainingEvents.length} MORE WAITING
                </Text>
              </View>
              <View style={styles.lockedLine} />
            </View>

            <View style={styles.blurredStack}>
              {remainingEvents.slice(0, 3).map((e, i) => (
                <View key={e.id} style={[styles.blurredCardWrap, { opacity: 1 - i * 0.2 }]}>
                  <BlurredEventCard event={e} />
                </View>
              ))}
            </View>
          </View>
        )}
      </Animated.ScrollView>

      {/* Sticky bottom CTA — colored to match the hero palette */}
      <View style={styles.teaserBottomBar}>
        <LinearGradient
          colors={["transparent", COLORS.bg] as any}
          style={styles.teaserGradientFade}
          pointerEvents="none"
        />
        <TouchableOpacity
          style={[styles.primaryBtn, SHADOWS.glow(heroPalette.edge)]}
          onPress={onUnlock}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={[heroPalette.from, heroPalette.to]}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="lock-open" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {teaserEvent
                ? `Unlock this${totalMatches > 1 ? ` + ${totalMatches - 1} more` : ""}`
                : "Build my feed"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.teaserBottomText}>
          Free trial. Cancel any time.
        </Text>
      </View>
    </View>
  );
}

function TeaserCard({ event, palette, matchPct }: { event: Event; palette: GoalPalette; matchPct: number }) {
  const img = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description, event.tags);
  const startDate = effectiveStart(event);
  const dayName = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const dayNum = startDate.getDate();
  const monthName = startDate.toLocaleDateString([], { month: "short" }).toUpperCase();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // "Tonight" / "Tomorrow" / specific day — better than just a date block.
  const daysUntil = Math.floor((startDate.getTime() - Date.now()) / 86_400_000);
  const whenLabel =
    daysUntil <= 0
      ? "TONIGHT"
      : daysUntil === 1
        ? "TOMORROW"
        : daysUntil < 7
          ? dayName
          : `${dayName} ${dayNum} ${monthName}`;

  return (
    <View style={[styles.teaserCard, { borderColor: palette.edge, ...SHADOWS.glow(palette.edge) }]}>
      <View style={styles.teaserCardImage}>
        <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} />
        <LinearGradient
          colors={["transparent", "rgba(15,15,26,0.4)", "rgba(15,15,26,0.97)"] as any}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={[styles.teaserMatchBadge, { backgroundColor: palette.solid }]}>
          <Ionicons name="flash" size={12} color="#fff" />
          <Text style={styles.teaserMatchText}>{matchPct}% MATCH</Text>
        </View>
        <View style={styles.teaserWhenChip}>
          <Text style={styles.teaserWhenChipText}>{whenLabel} · {timeStr}</Text>
        </View>
        <View style={styles.teaserCardTitleWrap}>
          <Text style={styles.teaserCardTitle} numberOfLines={3}>{event.title}</Text>
        </View>
      </View>

      <View style={styles.teaserCardMeta}>
        <View style={[styles.teaserDateBlock, { backgroundColor: palette.tint, borderColor: palette.edge }]}>
          <Text style={[styles.teaserDateDay, { color: palette.solid }]}>{dayName}</Text>
          <Text style={styles.teaserDateNum}>{dayNum}</Text>
          <Text style={[styles.teaserDateMonth, { color: palette.solid }]}>{monthName}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.teaserMetaRow}>
            <Ionicons name="time-outline" size={14} color={palette.solid} />
            <Text style={styles.teaserMetaText}>{timeStr}</Text>
          </View>
          <View style={styles.teaserMetaRow}>
            <Ionicons name="location-outline" size={14} color={palette.solid} />
            <Text style={styles.teaserMetaText} numberOfLines={1}>
              {event.venue?.name || event.address?.split(",")[0] || "Nearby"}
            </Text>
          </View>
        </View>
        {event.is_free && (
          <View style={styles.teaserFreeBadge}>
            <Text style={styles.teaserFreeText}>FREE</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function BlurredEventCard({ event }: { event: Event }) {
  const img = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description, event.tags);
  return (
    <View style={styles.blurredCard}>
      <Image source={{ uri: img }} style={StyleSheet.absoluteFillObject} blurRadius={20} />
      <View style={styles.blurredOverlay}>
        <Ionicons name="lock-closed" size={22} color="rgba(255,255,255,0.9)" />
      </View>
    </View>
  );
}

// ─── Paywall (HARD) ──────────────────────────────────────────

function PaywallStep({ onSubscribe, onBack }: { onSubscribe: () => void; onBack: () => void }) {
  const [plan, setPlan] = useState<"yearly" | "weekly">("yearly");
  const [showClose, setShowClose] = useState(false);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const tapCountRef = useRef(0);
  const tapResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dev-only quick-advance: 5 rapid taps on the hero icon advances the flow
  // without requiring an IAP purchase. Gated on __DEV__ so the body is dead
  // code (and inert at runtime) in production EAS builds. No visible UI hints
  // and no telltale strings in source — keep it that way.
  const handleHeroPress = () => {
    if (!__DEV__) return;
    tapCountRef.current += 1;
    if (tapResetRef.current) clearTimeout(tapResetRef.current);
    tapResetRef.current = setTimeout(() => {
      tapCountRef.current = 0;
    }, 1500);
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      onSubscribe();
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => setShowClose(true), 4000);

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getOfferings();
        if (!cancelled) setOffering(current);
      } catch {
        if (!cancelled) setOffering(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const annualPkg = offering?.annual ?? null;
  const weeklyPkg = offering?.weekly ?? null;
  const selectedPkg = plan === "yearly" ? annualPkg : weeklyPkg;

  const annualPrice = annualPkg?.product.priceString ?? "$79.99";
  const weeklyPrice = weeklyPkg?.product.priceString ?? "$4.99";
  const annualPerMonth = annualPkg
    ? `${annualPkg.product.currencyCode === "USD" ? "$" : ""}${(annualPkg.product.price / 12).toFixed(2)}/mo`
    : "$6.67/mo";
  const annualTrialDays = trialDaysFor(annualPkg) ?? 7;
  const weeklyTrialDays = trialDaysFor(weeklyPkg) ?? 7;
  const trialDays = plan === "yearly" ? annualTrialDays : weeklyTrialDays;
  const priceText = plan === "yearly"
    ? `${trialDays} days free, then ${annualPrice}/year (${annualPerMonth})`
    : `${trialDays} days free, then ${weeklyPrice}/week`;

  const handleSubscribe = async () => {
    if (purchasing) return;

    if (!selectedPkg) {
      Alert.alert(
        "Store unavailable",
        "We couldn't load subscription options. Please check your connection and try again."
      );
      return;
    }

    setPurchasing(true);
    const result = await purchasePackage(selectedPkg);
    setPurchasing(false);

    if (result.ok) {
      if (hasEntitlement(result.info)) {
        onSubscribe();
      } else {
        Alert.alert(
          "Purchase incomplete",
          "Your purchase didn't activate. Please try again or tap Restore."
        );
      }
      return;
    }

    if (result.cancelled) return;

    Alert.alert("Purchase failed", result.message ?? "Something went wrong. Please try again.");
  };

  const handleRestore = async () => {
    try {
      const { active } = await restorePurchases();
      if (active) {
        onSubscribe();
      } else {
        Alert.alert("Restore Purchases", "No active subscription found on this Apple ID.");
      }
    } catch (e: any) {
      Alert.alert("Restore failed", e?.message ?? "Please try again.");
    }
  };

  return (
    <View style={styles.paywallContainer}>
      {showClose && (
        <TouchableOpacity
          style={styles.paywallClose}
          onPress={onBack}
          activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="chevron-back" size={18} color={COLORS.muted} />
        </TouchableOpacity>
      )}

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 260 }}
        style={{ opacity: fadeAnim }}
      >
        <View style={styles.paywallHero}>
          <TouchableOpacity
            style={styles.paywallIconWrap}
            activeOpacity={1}
            onPress={handleHeroPress}
          >
            <LinearGradient
              colors={GRADIENTS.accent as any}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={{ fontSize: 48 }}>🔓</Text>
          </TouchableOpacity>
          <Text style={styles.paywallTitle}>Unlock your agent.</Text>
          <Text style={styles.paywallSubtitle}>
            Your AI just curated a feed for you. Start your free trial to see every match — and let your agent plan the next month for you.
          </Text>
        </View>

        {/* Real data proof */}
        <View style={styles.dataProofCard}>
          <Text style={styles.dataProofHeader}>YOUR AGENT SEARCHES</Text>
          <View style={styles.dataProofSources}>
            <View style={styles.dataSourceChip}>
              <Ionicons name="ticket" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>Ticketmaster</Text>
            </View>
            <View style={styles.dataSourceChip}>
              <Ionicons name="calendar" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>Eventbrite</Text>
            </View>
            <View style={styles.dataSourceChip}>
              <Ionicons name="location" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>Google Places</Text>
            </View>
            <View style={styles.dataSourceChip}>
              <Ionicons name="people" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>Reddit (local)</Text>
            </View>
            <View style={styles.dataSourceChip}>
              <Ionicons name="sparkles" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>AI venue scanner</Text>
            </View>
          </View>
          <View style={styles.dataStatsRow}>
            <View style={styles.dataStat}>
              <Text style={styles.dataStatNum}>2K+</Text>
              <Text style={styles.dataStatLabel}>events</Text>
            </View>
            <View style={styles.dataStatDivider} />
            <View style={styles.dataStat}>
              <Text style={styles.dataStatNum}>200+</Text>
              <Text style={styles.dataStatLabel}>venues</Text>
            </View>
            <View style={styles.dataStatDivider} />
            <View style={styles.dataStat}>
              <Text style={styles.dataStatNum}>24/7</Text>
              <Text style={styles.dataStatLabel}>fresh data</Text>
            </View>
          </View>
        </View>

        {/* What's included */}
        <View style={styles.includedCard}>
          <Text style={styles.includedHeader}>EVERYTHING INCLUDED</Text>
          {[
            { icon: "sparkles", text: "AI-curated feed based on your goals" },
            { icon: "infinite", text: "Unlimited events, saves, and filters" },
            { icon: "heart-circle", text: "Dating & singles events (speed dating, mixers)" },
            { icon: "flash", text: "\"Happening now\" real-time alerts" },
            { icon: "map", text: "Interactive map with every event" },
            { icon: "bookmark", text: "Save events & sync across devices" },
            { icon: "compass", text: "Works in any city you visit" },
            { icon: "checkmark-circle", text: "No ads, ever" },
          ].map((row, i) => (
            <View key={i} style={styles.includedRow}>
              <View style={styles.includedIcon}>
                <Ionicons name={row.icon as any} size={16} color={COLORS.accent} />
              </View>
              <Text style={styles.includedText}>{row.text}</Text>
            </View>
          ))}
        </View>

        {/* How it helps you */}
        <View style={styles.useCaseList}>
          <Text style={styles.useCaseHeader}>BUILT FOR YOUR GOALS</Text>
          {[
            { emoji: "💕", title: "Find your person", desc: "Singles mixers, speed dating, and events where real connections happen." },
            { emoji: "💪", title: "Get active", desc: "Pickup sports, yoga on the beach, running clubs, and hiking groups." },
            { emoji: "🍽️", title: "Eat better", desc: "Food festivals, restaurant weeks, tastings, and pop-ups near you." },
            { emoji: "🎶", title: "Feel the vibe", desc: "Live music, DJ sets, and concerts curated to your taste." },
          ].map((u, i) => (
            <View key={i} style={styles.useCaseRow}>
              <Text style={styles.useCaseEmoji}>{u.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.useCaseTitle}>{u.title}</Text>
                <Text style={styles.useCaseDesc}>{u.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.planSectionTitle}>Pick your plan</Text>
        <View style={styles.planList}>
          <PlanCard
            selected={plan === "yearly"}
            onSelect={() => setPlan("yearly")}
            title="Yearly"
            price={annualPrice}
            period="/year"
            subtext={`Just ${annualPerMonth} · ${annualTrialDays}-day free trial`}
            badge="MOST POPULAR · SAVE 69%"
            highlighted
          />
          <PlanCard
            selected={plan === "weekly"}
            onSelect={() => setPlan("weekly")}
            title="Weekly"
            price={weeklyPrice}
            period="/week"
            subtext={`${weeklyTrialDays}-day free trial`}
          />
        </View>

        <View style={styles.trustList}>
          <View style={styles.trustRow}>
            <View style={styles.trustIcon}>
              <Ionicons name="shield-checkmark" size={16} color={COLORS.success} />
            </View>
            <Text style={styles.trustText}>No charge today. Free for {trialDays} days.</Text>
          </View>
          <View style={styles.trustRow}>
            <View style={styles.trustIcon}>
              <Ionicons name="notifications" size={16} color={COLORS.accent} />
            </View>
            <Text style={styles.trustText}>We'll remind you 2 days before billing.</Text>
          </View>
          <View style={styles.trustRow}>
            <View style={styles.trustIcon}>
              <Ionicons name="close-circle" size={16} color={COLORS.warm} />
            </View>
            <Text style={styles.trustText}>Cancel anytime in iPhone Settings.</Text>
          </View>
        </View>
      </Animated.ScrollView>

      <View style={styles.paywallBottomBar}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleSubscribe}
            activeOpacity={0.85}
            disabled={loading || purchasing || !selectedPkg}
          >
            <LinearGradient
              colors={GRADIENTS.accent as any}
              style={styles.btnGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Text style={styles.primaryBtnText}>
                {purchasing
                  ? "Processing…"
                  : loading
                    ? "Loading…"
                    : `Start ${trialDays}-Day Free Trial`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.paywallPriceText}>{priceText}</Text>

        <View style={styles.paywallLinks}>
          <TouchableOpacity activeOpacity={0.6} onPress={handleRestore}>
            <Text style={styles.paywallLink}>Restore</Text>
          </TouchableOpacity>
          <Text style={styles.paywallLinkDivider}>·</Text>
          <TouchableOpacity activeOpacity={0.6} onPress={() => Linking.openURL("https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")}>
            <Text style={styles.paywallLink}>Terms</Text>
          </TouchableOpacity>
          <Text style={styles.paywallLinkDivider}>·</Text>
          <TouchableOpacity activeOpacity={0.6} onPress={() => Linking.openURL("https://mateo2lit.github.io/NearMe/privacy.html")}>
            <Text style={styles.paywallLink}>Privacy</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

interface PlanCardProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  price: string;
  period: string;
  subtext: string;
  badge?: string;
  highlighted?: boolean;
}

function PlanCard({ selected, onSelect, title, price, period, subtext, badge, highlighted }: PlanCardProps) {
  return (
    <TouchableOpacity
      onPress={onSelect}
      activeOpacity={0.85}
      style={[
        styles.planCard,
        selected && styles.planCardSelected,
        highlighted && !selected && { borderColor: COLORS.accent + "60" },
      ]}
    >
      {badge && (
        <View style={styles.planBadge}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
          <Text style={styles.planBadgeText}>{badge}</Text>
        </View>
      )}
      <View style={styles.planCardContent}>
        <View style={[styles.planRadio, selected && styles.planRadioActive]}>
          {selected && <View style={styles.planRadioDot} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.planTitle}>{title}</Text>
          <Text style={styles.planSubtext}>{subtext}</Text>
        </View>
        <View style={styles.planPriceBlock}>
          <Text style={styles.planPrice}>{price}</Text>
          <Text style={styles.planPeriod}>{period}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 60,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.card,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    overflow: "hidden",
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
    minWidth: 30,
    textAlign: "right",
  },
  // Welcome
  welcomeIconWrap: {
    width: 152,
    height: 152,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 30,
  },
  welcomeIconRing: {
    position: "absolute",
    width: 152,
    height: 152,
    borderRadius: 76,
    overflow: "hidden",
  },
  welcomeIconCore: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomeEmojiBig: {
    fontSize: 56,
  },
  welcomeKicker: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.accentLight,
    textAlign: "center",
    letterSpacing: 2,
    marginBottom: 12,
  },
  welcomeTitle: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -1.2,
    marginBottom: 14,
    lineHeight: 40,
  },
  welcomeSubtitle: {
    fontSize: 16,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 23,
    marginBottom: 32,
  },
  welcomeFeatures: {
    gap: 14,
    marginBottom: 40,
  },
  welcomeFeature: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  welcomeFeatureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomeFeatureText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: "600",
    flex: 1,
  },
  takesText: {
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 14,
    fontSize: 13,
  },
  // Question steps
  stepContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  stepTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: 6,
    marginBottom: 10,
    letterSpacing: -0.8,
    lineHeight: 38,
  },
  stepSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    marginBottom: 22,
    lineHeight: 22,
  },
  optionList: {
    gap: 12,
  },
  contextWrap: {
    marginBottom: 14,
    gap: 8,
  },
  contextCard: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contextIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.accent + "18",
  },
  contextTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
  },
  contextBody: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  footerNoteWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignSelf: "center",
  },
  footerNoteText: {
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: "600",
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 18,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  optionEmojiShell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  optionEmoji: {
    fontSize: 26,
    marginTop: -1,
    // emoji rendering needs a slight nudge to look optically centered
    textShadowColor: "rgba(0,0,0,0.2)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  optionIconTint: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
  },
  optionLabel: {
    fontSize: 17,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: -0.2,
  },
  optionDescription: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 3,
    lineHeight: 18,
  },
  optionCheck: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  btnGradient: {
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  // Building
  buildingIconWrap: {
    width: 156,
    height: 156,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 26,
  },
  buildingRing: {
    width: 156,
    height: 156,
    borderRadius: 78,
    position: "absolute",
    overflow: "hidden",
  },
  buildingCore: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  buildingTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.8,
  },
  buildingCount: {
    fontSize: 16,
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 28,
    fontWeight: "500",
  },
  buildingProgress: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.card,
    overflow: "hidden",
    marginBottom: 28,
  },
  buildingProgressFill: {
    height: "100%",
    borderRadius: 3,
    overflow: "hidden",
  },
  taskList: {
    gap: 14,
  },
  taskRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  taskDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  taskDotActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent + "30",
  },
  taskDotDone: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent,
  },
  taskText: {
    fontSize: 15,
    color: COLORS.muted,
    fontWeight: "500",
  },
  // Teaser
  teaserHero: {
    alignItems: "center",
    marginBottom: 28,
  },
  teaserBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    marginBottom: 18,
  },
  teaserBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  teaserTitle: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -1.2,
    marginBottom: 12,
    lineHeight: 42,
  },
  teaserSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 18,
    lineHeight: 22,
    paddingHorizontal: 6,
  },
  goalBubbles: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  goalBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noEventsCard: {
    padding: 24,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
  },
  noEventsIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  noEventsTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  noEventsText: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 20,
  },
  teaserCard: {
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    overflow: "hidden",
    marginBottom: 4,
  },
  teaserCardImage: {
    width: "100%",
    height: 240,
    position: "relative",
  },
  teaserMatchBadge: {
    position: "absolute",
    top: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  teaserMatchText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  teaserWhenChip: {
    position: "absolute",
    top: 14,
    left: 14,
    backgroundColor: "rgba(15,15,26,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  teaserWhenChipText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  teaserCardTitleWrap: {
    position: "absolute",
    bottom: 16,
    left: 18,
    right: 18,
  },
  teaserCardTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 28,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  teaserCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  teaserDateBlock: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  teaserDateDay: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  teaserDateNum: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: -2,
    lineHeight: 24,
  },
  teaserDateMonth: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: -1,
  },
  teaserMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 3,
  },
  teaserMetaText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: "600",
  },
  teaserFreeBadge: {
    backgroundColor: COLORS.success + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  teaserFreeText: {
    color: COLORS.success,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  // Locked section
  lockedSection: {
    marginTop: 24,
  },
  lockedDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  lockedLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  lockedCountBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.accent + "40",
  },
  lockedCountText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  blurredStack: {
    gap: 10,
  },
  blurredCardWrap: {
    borderRadius: RADIUS.lg,
    overflow: "hidden",
  },
  blurredCard: {
    height: 130,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    overflow: "hidden",
    position: "relative",
  },
  blurredOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,15,26,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  teaserBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 20,
    backgroundColor: COLORS.bg,
  },
  teaserGradientFade: {
    position: "absolute",
    top: -40,
    left: 0,
    right: 0,
    height: 40,
  },
  teaserBottomText: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 10,
    fontWeight: "500",
  },
  // Paywall
  paywallContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  paywallClose: {
    position: "absolute",
    top: 48,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
    opacity: 0.5,
  },
  paywallHero: {
    alignItems: "center",
    marginBottom: 24,
  },
  paywallIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  paywallTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  paywallSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  // Real data proof (replaces fake social proof)
  dataProofCard: {
    marginVertical: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  dataProofHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1.2,
    textAlign: "center",
    marginBottom: 12,
  },
  dataProofSources: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "center",
    marginBottom: 16,
  },
  dataSourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.accent + "15",
    borderWidth: 1,
    borderColor: COLORS.accent + "30",
  },
  dataSourceText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.accent,
  },
  dataStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  dataStat: {
    alignItems: "center",
  },
  dataStatNum: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  dataStatLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  dataStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
  },
  // Use cases (replaces testimonials)
  useCaseList: {
    marginTop: 24,
    padding: 16,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  useCaseHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  useCaseRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  useCaseEmoji: {
    fontSize: 26,
    marginTop: 2,
  },
  useCaseTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 2,
  },
  useCaseDesc: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 18,
  },
  // (Legacy social proof — kept for backwards compat of compareCard spacing)
  socialProofCard_LEGACY_UNUSED: {
    alignItems: "center",
    marginVertical: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginBottom: 6,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.text,
    marginLeft: 6,
  },
  socialProofCount: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 12,
  },
  avatarStack: {
    flexDirection: "row",
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.cardAlt,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.card,
  },
  avatarEmoji: {
    fontSize: 16,
  },
  includedCard: {
    marginTop: 8,
    padding: 18,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 14,
  },
  includedHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  includedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  includedIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  includedText: {
    fontSize: 14,
    color: COLORS.text,
    fontWeight: "500",
    flex: 1,
  },
  compareCard: {
    marginTop: 8,
    padding: 16,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  compareHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 8,
  },
  compareHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  compareCols: {
    flexDirection: "row",
    width: 140,
  },
  compareColLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  compareRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  compareLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: "500",
  },
  compareCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  compareCellText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.muted,
  },
  testimonialList: {
    marginTop: 24,
    gap: 10,
  },
  testimonial: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  testimonialAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.cardAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  testimonialHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 3,
  },
  testimonialName: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
  },
  testimonialStars: {
    flexDirection: "row",
    gap: 1,
  },
  testimonialText: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 18,
  },
  planSectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: 28,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  planList: {
    gap: 10,
  },
  planCard: {
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
    position: "relative",
  },
  planCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent + "10",
  },
  planBadge: {
    position: "absolute",
    top: -10,
    left: 16,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  planBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  planCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
  },
  planRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  planRadioActive: {
    borderColor: COLORS.accent,
  },
  planRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.accent,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
  planSubtext: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 2,
  },
  planPriceBlock: {
    alignItems: "flex-end",
  },
  planPrice: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
  },
  planPeriod: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 1,
  },
  trustList: {
    marginTop: 20,
    gap: 10,
    padding: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card + "80",
  },
  trustRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  trustIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  trustText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: "500",
    flex: 1,
  },
  paywallBottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  paywallPriceText: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 10,
    fontWeight: "500",
  },
  paywallLinks: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  paywallLink: {
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: "600",
  },
  paywallLinkDivider: {
    fontSize: 12,
    color: COLORS.muted,
  },
  // Location Step
  locationScroll: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 120,
  },
  locStatusCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginTop: 12,
    marginBottom: 16,
  },
  locStatusIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  locStatusLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  locStatusName: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 2,
  },
  locGpsBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
    marginBottom: 8,
  },
  locGpsBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.accent,
  },
  locDividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 16,
  },
  locDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  locDividerText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 1,
  },
  locChipScroll: {
    paddingRight: 12,
    gap: 8,
  },
  locQuickPickLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 10,
  },
  locSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  locSearchInput: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    paddingVertical: 10,
  },
  locCityChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.pill,
  },
  locCityChipSelected: {
    backgroundColor: COLORS.accent + "20",
    borderColor: COLORS.accent,
  },
  locCityChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.text,
  },
  locCityChipTextSelected: {
    color: COLORS.accent,
  },
  locAddressBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 56,
  },
  locAddressBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  locContinueBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
});
