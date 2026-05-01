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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS, GRADIENTS, RADIUS } from "../src/constants/theme";
import { fetchNearbyEvents, triggerLocationSync, effectiveStart } from "../src/services/events";
import { setFeedHandoff } from "../src/services/eventCache";
import { getEventImage } from "../src/constants/images";
import { useLocation } from "../src/hooks/useLocation";
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
  emoji: string;
  description?: string;
  tags?: string[];
  categories?: string[];
}

const GOALS: Option[] = [
  { id: "meet-people", label: "Meet new people", emoji: "🤝", description: "Social mixers, groups, new friends", tags: ["social"], categories: ["community", "nightlife"] },
  { id: "find-partner", label: "Find a partner", emoji: "💕", description: "Singles events, date ideas, mixers", tags: ["date-night"], categories: ["nightlife", "food", "arts"] },
  { id: "get-active", label: "Get more active", emoji: "💪", description: "Pickup sports, fitness, running clubs", tags: ["active"], categories: ["sports", "fitness"] },
  { id: "drinks-nightlife", label: "Go out more", emoji: "🍻", description: "Bars, happy hours, nightlife", tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
  { id: "live-music", label: "Discover music", emoji: "🎶", description: "Concerts, live bands, DJ sets", tags: ["live-music"], categories: ["music"] },
  { id: "try-food", label: "Try new foods", emoji: "🍽️", description: "Restaurants, food events, tastings", tags: ["food"], categories: ["food"] },
  { id: "explore-arts", label: "Explore culture", emoji: "🎨", description: "Galleries, theater, museums", tags: [], categories: ["arts", "movies"] },
  { id: "family-fun", label: "Family time", emoji: "👨‍👩‍👧", description: "Activities for the whole family", tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
  { id: "outdoor-fun", label: "Get outdoors", emoji: "🌳", description: "Parks, hikes, outdoor adventures", tags: ["outdoor"], categories: ["outdoors", "fitness"] },
];

const VIBES: Option[] = [
  { id: "chill", label: "Chill & relaxed", emoji: "😌", description: "Low-key hangs, coffee shops, quiet spots" },
  { id: "social", label: "Social & lively", emoji: "🎉", description: "Packed bars, groups, lively scenes" },
  { id: "adventurous", label: "Adventurous", emoji: "🚀", description: "Try new things, meet strangers" },
  { id: "romantic", label: "Romantic", emoji: "🌹", description: "Intimate, date-night vibes" },
  { id: "energetic", label: "High-energy", emoji: "⚡", description: "Dancing, parties, late nights" },
];

const SCHEDULES: Option[] = [
  { id: "weekday-evenings", label: "Weekday evenings", emoji: "🌆", description: "After-work hangs" },
  { id: "weekend-mornings", label: "Weekend mornings", emoji: "☀️", description: "Brunch, markets, runs" },
  { id: "weekend-afternoons", label: "Weekend afternoons", emoji: "🌞", description: "Day drinking, activities" },
  { id: "weekend-nights", label: "Weekend nights", emoji: "🌙", description: "The main event" },
  { id: "anytime", label: "I'm flexible", emoji: "🤷", description: "Show me everything" },
];

const BUDGETS: Option[] = [
  { id: "free", label: "Free stuff only", emoji: "🆓", description: "$0 - keep it cheap", tags: ["free"] },
  { id: "budget", label: "Budget friendly", emoji: "💵", description: "Under $25" },
  { id: "moderate", label: "Happy to spend", emoji: "💳", description: "$25 - $75" },
  { id: "premium", label: "Money's no issue", emoji: "💎", description: "Whatever looks good" },
];

const SOCIAL_STYLES: Option[] = [
  { id: "solo", label: "Solo explorer", emoji: "🧭", description: "Comfortable going alone, meet new people" },
  { id: "small-group", label: "Close friends", emoji: "👯", description: "Prefer hanging with 1-3 friends" },
  { id: "big-group", label: "The whole crew", emoji: "🎊", description: "Love big group energy" },
  { id: "mix", label: "Mix of both", emoji: "🎭", description: "Depends on the night" },
];

const BLOCKERS: Option[] = [
  { id: "dont-know", label: "Don't know what's happening", emoji: "🤷", description: "This is why we built this" },
  { id: "no-one", label: "No one to go with", emoji: "😔", description: "We'll show social & singles events" },
  { id: "too-busy", label: "Too busy to plan ahead", emoji: "⏰", description: "We'll show what's tonight/this week" },
  { id: "too-expensive", label: "Too expensive", emoji: "💸", description: "We'll surface free & cheap events", tags: ["free"] },
  { id: "wrong-scene", label: "Can't find my scene", emoji: "🎯", description: "Our AI will get it right" },
];

const HAPPY_HOUR_OPTIONS: Option[] = [
  {
    id: "show",
    label: "Show happy hours",
    emoji: "🍸",
    description: "Bar specials, $2 off, 2-for-1, weekday wind-downs — all in the feed.",
  },
  {
    id: "hide",
    label: "Hide happy hours",
    emoji: "🙅",
    description: "Keep the feed focused on bigger events — concerts, singles nights, food events, sports.",
  },
];

// ─── Main Component ──────────────────────────────────────────

type StepKey = "welcome" | "goals" | "vibe" | "social" | "schedule" | "blocker" | "budget" | "happy-hour" | "building" | "teaser" | "paywall";
const STEPS: StepKey[] = ["welcome", "goals", "vibe", "social", "schedule", "blocker", "budget", "happy-hour", "building", "teaser", "paywall"];

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

    await AsyncStorage.setItem(
      "@nearme_preferences",
      JSON.stringify({
        categories: Array.from(categorySet),
        tags: Array.from(tagSet),
        radius: 10,
        lat: 26.3587,
        lng: -80.0831,
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
    router.replace("/(tabs)");
  };

  // Step routing
  if (step === "welcome") return <WelcomeStep onNext={goNext} />;
  if (step === "building") {
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

  // Question steps share the same UI shell
  return (
    <View style={styles.container}>
      <Header progress={progress} onBack={goBack} stepIdx={stepIdx} totalSteps={8} />

      {step === "goals" && (
        <QuestionStep
          title="What brings you here?"
          subtitle="NearMe's AI will curate events that help you hit your goals. Pick all that apply."
          options={GOALS}
          multi
          selected={goals}
          onChange={setGoals}
          onNext={goNext}
          canContinue={goals.length > 0}
          continueLabel={goals.length > 0 ? `Continue (${goals.length} selected)` : "Pick at least one"}
        />
      )}

      {step === "vibe" && (
        <QuestionStep
          title="What's your vibe?"
          subtitle="This helps our AI match you to the right scene"
          options={VIBES}
          selected={vibe ? [vibe] : []}
          onChange={(arr) => setVibe(arr[0] || "")}
          onNext={goNext}
          canContinue={!!vibe}
          continueLabel="Continue"
        />
      )}

      {step === "social" && (
        <QuestionStep
          title="How do you like to go out?"
          subtitle="Solo, with friends, or a mix?"
          options={SOCIAL_STYLES}
          selected={social ? [social] : []}
          onChange={(arr) => setSocial(arr[0] || "")}
          onNext={goNext}
          canContinue={!!social}
          continueLabel="Continue"
        />
      )}

      {step === "schedule" && (
        <QuestionStep
          title="When are you free?"
          subtitle="We'll prioritize events during your available times"
          options={SCHEDULES}
          selected={schedule ? [schedule] : []}
          onChange={(arr) => setSchedule(arr[0] || "")}
          onNext={goNext}
          canContinue={!!schedule}
          continueLabel="Continue"
        />
      )}

      {step === "blocker" && (
        <QuestionStep
          title="What's holding you back?"
          subtitle="What's the hardest part about going out more? We'll fix it."
          options={BLOCKERS}
          selected={blocker ? [blocker] : []}
          onChange={(arr) => setBlocker(arr[0] || "")}
          onNext={goNext}
          canContinue={!!blocker}
          continueLabel="Continue"
        />
      )}

      {step === "budget" && (
        <QuestionStep
          title="What's your budget?"
          subtitle="One more question after this"
          options={BUDGETS}
          selected={budget ? [budget] : []}
          onChange={(arr) => setBudget(arr[0] || "")}
          onNext={goNext}
          canContinue={!!budget}
          continueLabel="Continue"
        />
      )}

      {step === "happy-hour" && (
        <QuestionStep
          title="Happy hours in your feed?"
          subtitle="Bars publish a lot of these — up to you whether they belong in your feed."
          options={HAPPY_HOUR_OPTIONS}
          selected={happyHour ? [happyHour] : []}
          onChange={(arr) => setHappyHour(arr[0] || "")}
          onNext={goNext}
          canContinue={!!happyHour}
          continueLabel="Build my feed"
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
  const bounceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const translateY = bounceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -10],
  });

  return (
    <View style={[styles.container, { justifyContent: "center", paddingHorizontal: 32 }]}>
      <Animated.View style={{ alignItems: "center", transform: [{ translateY }] }}>
        <View style={styles.welcomeIconWrap}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={StyleSheet.absoluteFillObject}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <Text style={styles.welcomeEmoji}>✨</Text>
        </View>
      </Animated.View>

      <Text style={styles.welcomeTitle}>AI-powered event discovery</Text>
      <Text style={styles.welcomeSubtitle}>
        Tell us your goals. We'll find the perfect events to help you meet people, get active, and actually go out more.
      </Text>

      <View style={styles.welcomeFeatures}>
        {[
          { icon: "🧠", text: "AI matched to your goals" },
          { icon: "📍", text: "Real-time events near you" },
          { icon: "🎯", text: "No scrolling — just the good stuff" },
        ].map((f, i) => (
          <View key={i} style={styles.welcomeFeature}>
            <Text style={styles.welcomeFeatureIcon}>{f.icon}</Text>
            <Text style={styles.welcomeFeatureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onNext} activeOpacity={0.85}>
        <LinearGradient
          colors={GRADIENTS.accent as any}
          style={styles.btnGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      <Text style={styles.takesText}>Takes about a minute</Text>
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

function QuestionStep({ title, subtitle, options, selected, onChange, onNext, canContinue, continueLabel, multi, contextBlock, footerNote }: QuestionStepProps) {
  const toggle = (id: string) => {
    if (multi) {
      onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
    } else {
      onChange([id]);
    }
  };

  return (
    <>
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSubtitle}>{subtitle}</Text>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 180 }}>
          {contextBlock ? <View style={styles.contextWrap}>{contextBlock}</View> : null}
          <View style={styles.optionList}>
            {options.map((opt) => {
              const isSelected = selected.includes(opt.id);
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                  onPress={() => toggle(opt.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.optionEmoji}>{opt.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.optionLabel, isSelected && { color: COLORS.accent }]}>
                      {opt.label}
                    </Text>
                    {opt.description && <Text style={styles.optionDescription}>{opt.description}</Text>}
                  </View>
                  {isSelected && (
                    <View style={styles.optionCheck}>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
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
          style={[styles.primaryBtn, !canContinue && { opacity: 0.4 }]}
          onPress={onNext}
          disabled={!canContinue}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={canContinue ? (GRADIENTS.accent as any) : [COLORS.muted, COLORS.muted]}
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

  // Dynamic task list based on user's actual answers
  const goalLabels = goals
    .map((id) => GOALS.find((g) => g.id === id)?.label.toLowerCase())
    .filter((s): s is string => Boolean(s));
  const primaryGoals =
    goalLabels.length === 0
      ? "your goals"
      : goalLabels.length === 1
        ? `"${goalLabels[0]}"`
        : goalLabels.length === 2
          ? `"${goalLabels[0]}" + "${goalLabels[1]}"`
          : `"${goalLabels[0]}", "${goalLabels[1]}" +${goalLabels.length - 2} more`;
  const vibeLabel = VIBES.find((v) => v.id === vibe)?.label.toLowerCase() || vibe || "custom";
  const blockerLabel = BLOCKERS.find((b) => b.id === blocker)?.label.toLowerCase();

  const tasks = [
    `Reading what matters: ${primaryGoals}`,
    "Sweeping venues within 15 miles of you",
    blockerLabel
      ? `Solving for "${blockerLabel}"`
      : "Matching events to your preferences",
    `Calibrating for a ${vibeLabel} vibe`,
    "Ranking your top picks",
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

    // Schedule tasks to advance with natural pacing — slower on last step so it doesn't stall
    const taskTimings = [1200, 1400, 1600, 1800]; // cumulative delays between tasks
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

        const minTotal = taskElapsed + 1200; // min 8s total
        const elapsedNow = taskElapsed;
        const remainder = Math.max(0, minTotal - elapsedNow);

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

  // Honest subtitle based on current task
  const statusLines = [
    "Reviewing your answers...",
    "Calling local venues...",
    "Scoring events for your goals...",
    "Matching to your vibe...",
    "Finalizing your picks...",
    "Ready!",
  ];

  return (
    <View style={[styles.container, { justifyContent: "center", paddingHorizontal: 32 }]}>
      <View style={styles.buildingIconWrap}>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={styles.buildingRing}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        </Animated.View>
        <View style={styles.buildingCore}>
          <Text style={{ fontSize: 40 }}>🧠</Text>
        </View>
      </View>

      <Text style={styles.buildingTitle}>Curating your feed</Text>
      <Text style={styles.buildingCount}>
        {statusLines[Math.min(currentTask, statusLines.length - 1)]}
      </Text>

      <View style={styles.buildingProgress}>
        <Animated.View style={[styles.buildingProgressFill, { width: progressWidth }]}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
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
                i < currentTask && styles.taskDotDone,
                i === currentTask && styles.taskDotActive,
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

function scoreEventForGoals(event: Event, selectedGoalIds: string[]): number {
  const goalDefs = GOALS.filter((g) => selectedGoalIds.includes(g.id));
  let score = 0;

  for (const g of goalDefs) {
    // Tag matches (high weight)
    for (const t of g.tags || []) {
      if (event.tags?.includes(t)) score += 3;
    }
    // Category matches
    for (const c of g.categories || []) {
      if (event.category === c) score += 2;
    }
  }

  // Extra boost for singles events when user wants to find a partner
  if (selectedGoalIds.includes("find-partner") && event.tags?.includes("singles")) {
    score += 10;
  }

  // Small bonus for happening soon
  if (event.start_time) {
    const hoursUntil = (effectiveStart(event).getTime() - Date.now()) / 3600000;
    if (hoursUntil > 0 && hoursUntil < 48) score += 1;
  }

  return score;
}

function pickBestMatch(events: Event[], goals: string[]): Event | undefined {
  if (!events.length) return undefined;
  const scored = events.map((e) => ({ event: e, score: scoreEventForGoals(e, goals) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].event;
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
    .filter((e) => e.id !== teaserEvent?.id)
    .map((e) => ({ event: e, score: scoreEventForGoals(e, goals) }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.event);

  // Real count — no fabrication
  const totalMatches = events.length;

  const goalEmojis: Record<string, string> = {
    "meet-people": "🤝",
    "find-partner": "💕",
    "get-active": "💪",
    "drinks-nightlife": "🍻",
    "live-music": "🎶",
    "try-food": "🍽️",
    "explore-arts": "🎨",
    "family-fun": "👨‍👩‍👧",
    "outdoor-fun": "🌳",
  };

  return (
    <View style={[styles.container, { paddingTop: 60 }]}>
      <Animated.ScrollView
        style={{ opacity: fadeAnim }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 160 }}
      >
        <View style={styles.teaserHero}>
          <View style={styles.teaserBadge}>
            <Ionicons name="sparkles" size={14} color={COLORS.accent} />
            <Text style={styles.teaserBadgeText}>YOUR AI MATCHES</Text>
          </View>
          {totalMatches > 0 ? (
            <>
              <Text style={styles.teaserTitle}>
                Found <Text style={{ color: COLORS.accent }}>{totalMatches}</Text>{"\n"}
                event{totalMatches === 1 ? "" : "s"} near you
              </Text>
              <Text style={styles.teaserSubtitle}>
                Matched to your goals and vibe. Here's your top pick.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.teaserTitle}>
                Your feed is{"\n"}being built
              </Text>
              <Text style={styles.teaserSubtitle}>
                We're gathering fresh events in your area right now.
              </Text>
            </>
          )}

          {/* Goals bubble */}
          {goals.length > 0 && (
            <View style={styles.goalBubbles}>
              {goals.slice(0, 4).map((g) => (
                <View key={g} style={styles.goalBubble}>
                  <Text style={{ fontSize: 14 }}>{goalEmojis[g] || "⭐"}</Text>
                </View>
              ))}
              {goals.length > 4 && (
                <View style={[styles.goalBubble, { backgroundColor: COLORS.accent + "20" }]}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: COLORS.accent }}>+{goals.length - 4}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Only show teaser if we have a real event */}
        {teaserEvent && <TeaserCard event={teaserEvent} />}

        {/* If no events found at all, show an honest message */}
        {!teaserEvent && (
          <View style={styles.noEventsCard}>
            <View style={styles.noEventsIcon}>
              <Ionicons name="radio" size={28} color={COLORS.accent} />
            </View>
            <Text style={styles.noEventsTitle}>Still syncing your area</Text>
            <Text style={styles.noEventsText}>
              Our AI is still gathering events for your location. Start your trial and your feed will fill up in a minute or two.
            </Text>
          </View>
        )}

        {/* Locked cards — only show if there ARE real events to lock */}
        {remainingEvents.length > 0 && (
          <View style={styles.lockedSection}>
            <View style={styles.lockedDivider}>
              <View style={styles.lockedLine} />
              <View style={styles.lockedCountBadge}>
                <Ionicons name="lock-closed" size={12} color={COLORS.accent} />
                <Text style={styles.lockedCountText}>
                  {remainingEvents.length} MORE MATCH{remainingEvents.length === 1 ? "" : "ES"}
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

      {/* Sticky bottom CTA */}
      <View style={styles.teaserBottomBar}>
        <LinearGradient
          colors={["transparent", COLORS.bg] as any}
          style={styles.teaserGradientFade}
          pointerEvents="none"
        />
        <TouchableOpacity style={styles.primaryBtn} onPress={onUnlock} activeOpacity={0.85}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Ionicons name="lock-open" size={18} color="#fff" />
            <Text style={styles.primaryBtnText}>
              {totalMatches > 1
                ? `Unlock all ${totalMatches} events`
                : totalMatches === 1
                ? "Unlock the full feed"
                : "Continue"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        <Text style={styles.teaserBottomText}>
          Start your free trial to see all events
        </Text>
      </View>
    </View>
  );
}

function TeaserCard({ event }: { event: Event }) {
  const img = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description);
  const startDate = new Date(event.start_time);
  const dayName = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const dayNum = startDate.getDate();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <View style={styles.teaserCard}>
      <View style={styles.teaserCardImage}>
        <Image source={{ uri: img }} style={{ width: "100%", height: "100%" }} />
        <LinearGradient
          colors={["transparent", "rgba(15,15,26,0.95)"]}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={styles.teaserMatchBadge}>
          <Ionicons name="flash" size={12} color="#fff" />
          <Text style={styles.teaserMatchText}>98% MATCH</Text>
        </View>
        <View style={styles.teaserCardTitleWrap}>
          <Text style={styles.teaserCardTitle} numberOfLines={2}>{event.title}</Text>
        </View>
      </View>

      <View style={styles.teaserCardMeta}>
        <View style={styles.teaserDateBlock}>
          <Text style={styles.teaserDateDay}>{dayName}</Text>
          <Text style={styles.teaserDateNum}>{dayNum}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.teaserMetaRow}>
            <Ionicons name="time-outline" size={14} color={COLORS.accent} />
            <Text style={styles.teaserMetaText}>{timeStr}</Text>
          </View>
          <View style={styles.teaserMetaRow}>
            <Ionicons name="location-outline" size={14} color={COLORS.accent} />
            <Text style={styles.teaserMetaText} numberOfLines={1}>
              {event.venue?.name || event.address?.split(",")[0] || "Boca Raton"}
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
  const img = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description);
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
  const weeklyTrialDays = trialDaysFor(weeklyPkg) ?? 3;
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
          <View style={styles.paywallIconWrap}>
            <LinearGradient
              colors={GRADIENTS.accent as any}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={{ fontSize: 48 }}>🔓</Text>
          </View>
          <Text style={styles.paywallTitle}>Unlock your matches</Text>
          <Text style={styles.paywallSubtitle}>
            Your AI has curated events to help you hit your goals. Start your free trial to see them all.
          </Text>
        </View>

        {/* Real data proof */}
        <View style={styles.dataProofCard}>
          <Text style={styles.dataProofHeader}>POWERED BY</Text>
          <View style={styles.dataProofSources}>
            <View style={styles.dataSourceChip}>
              <Ionicons name="ticket" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>Ticketmaster</Text>
            </View>
            <View style={styles.dataSourceChip}>
              <Ionicons name="musical-notes" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>SeatGeek</Text>
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
              <Ionicons name="sparkles" size={13} color={COLORS.accent} />
              <Text style={styles.dataSourceText}>AI scanner</Text>
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

        {__DEV__ && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onSubscribe}
            style={styles.devSkipBtn}
          >
            <Ionicons name="code-slash" size={12} color={COLORS.muted} />
            <Text style={styles.devSkipText}>Dev: Skip paywall</Text>
          </TouchableOpacity>
        )}
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
    width: 120,
    height: 120,
    borderRadius: 60,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    overflow: "hidden",
  },
  welcomeEmoji: {
    fontSize: 56,
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -1,
    marginBottom: 12,
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
  welcomeFeatureIcon: {
    fontSize: 24,
  },
  welcomeFeatureText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: "600",
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
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  stepSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    marginBottom: 20,
    lineHeight: 21,
  },
  optionList: {
    gap: 10,
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
    gap: 14,
    padding: 16,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  optionCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent + "12",
  },
  optionEmoji: {
    fontSize: 28,
  },
  optionLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
  optionDescription: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
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
    width: 140,
    height: 140,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  buildingRing: {
    width: 140,
    height: 140,
    borderRadius: 70,
    position: "absolute",
  },
  buildingCore: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  buildingTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  buildingCount: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 28,
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
    gap: 5,
    backgroundColor: COLORS.accent + "20",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    marginBottom: 16,
  },
  teaserBadgeText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  teaserTitle: {
    fontSize: 34,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    letterSpacing: -1,
    marginBottom: 10,
    lineHeight: 40,
  },
  teaserSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 16,
  },
  goalBubbles: {
    flexDirection: "row",
    gap: 6,
  },
  goalBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    borderWidth: 2,
    borderColor: COLORS.accent + "40",
    overflow: "hidden",
    elevation: 10,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    marginBottom: 4,
  },
  teaserCardImage: {
    width: "100%",
    height: 180,
    position: "relative",
  },
  teaserMatchBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.success + "ee",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  teaserMatchText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  teaserCardTitleWrap: {
    position: "absolute",
    bottom: 12,
    left: 14,
    right: 14,
  },
  teaserCardTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  teaserCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  teaserDateBlock: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  teaserDateDay: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.accent,
    letterSpacing: 0.5,
  },
  teaserDateNum: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: -2,
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
  devSkipBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "center",
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: "dashed",
  },
  devSkipText: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
