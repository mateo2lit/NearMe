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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS, GRADIENTS, RADIUS } from "../src/constants/theme";

const { width, height } = Dimensions.get("window");

// ─── Question Data ───────────────────────────────────────────

interface Option {
  id: string;
  label: string;
  emoji: string;
  description?: string;
  tags?: string[]; // maps to tag filters
  categories?: string[]; // maps to event categories
}

const GOALS: Option[] = [
  { id: "meet-people", label: "Meet new people", emoji: "🤝", description: "Social mixers, groups, events", tags: ["social"], categories: ["community", "nightlife"] },
  { id: "play-sports", label: "Play sports", emoji: "🏀", description: "Pickup games, leagues, fitness", tags: ["active"], categories: ["sports", "fitness"] },
  { id: "drinks-nightlife", label: "Grab drinks", emoji: "🍻", description: "Bars, happy hours, nightlife", tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
  { id: "live-music", label: "See live music", emoji: "🎶", description: "Concerts, jams, open mics", tags: ["live-music"], categories: ["music"] },
  { id: "try-food", label: "Try new food", emoji: "🍽️", description: "Restaurants, food events", tags: ["food"], categories: ["food"] },
  { id: "date-night", label: "Find date ideas", emoji: "💕", description: "Romantic spots, things to do", tags: ["date-night"], categories: ["arts", "nightlife", "food"] },
  { id: "family-fun", label: "Family activities", emoji: "👨‍👩‍👧", description: "Kid-friendly events", tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
  { id: "explore-arts", label: "Explore arts", emoji: "🎨", description: "Galleries, theater, culture", tags: [], categories: ["arts", "movies"] },
  { id: "outdoor-fun", label: "Get outside", emoji: "🌳", description: "Parks, hikes, outdoor events", tags: ["outdoor"], categories: ["outdoors", "fitness"] },
];

const VIBES: Option[] = [
  { id: "chill", label: "Chill & relaxed", emoji: "😌", description: "Low-key hangs, coffee shops, quiet spots" },
  { id: "social", label: "Social & lively", emoji: "🎉", description: "Packed bars, lively scenes, groups" },
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

// ─── Main Component ──────────────────────────────────────────

type StepKey = "welcome" | "goals" | "vibe" | "schedule" | "budget" | "building" | "paywall";

const STEPS: StepKey[] = ["welcome", "goals", "vibe", "schedule", "budget", "building", "paywall"];

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState<StepKey>("welcome");
  const [goals, setGoals] = useState<string[]>([]);
  const [vibe, setVibe] = useState<string>("");
  const [schedule, setSchedule] = useState<string>("");
  const [budget, setBudget] = useState<string>("");

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

  const completeOnboarding = async () => {
    // Gather tags/categories from answers
    const tagSet = new Set<string>();
    const categorySet = new Set<string>();

    const selectedGoals = GOALS.filter((g) => goals.includes(g.id));
    selectedGoals.forEach((g) => {
      g.tags?.forEach((t) => tagSet.add(t));
      g.categories?.forEach((c) => categorySet.add(c));
    });

    const budgetOption = BUDGETS.find((b) => b.id === budget);
    budgetOption?.tags?.forEach((t) => tagSet.add(t));

    await AsyncStorage.setItem(
      "@nearme_preferences",
      JSON.stringify({
        categories: Array.from(categorySet),
        tags: Array.from(tagSet),
        radius: 10,
        lat: 26.3587,
        lng: -80.0831,
        onboarding: { goals, vibe, schedule, budget },
      })
    );
    await AsyncStorage.setItem("@nearme_onboarded", "true");
    router.replace("/(tabs)");
  };

  // Step routing
  if (step === "welcome") return <WelcomeStep onNext={goNext} />;
  if (step === "building") return <BuildingStep onDone={goNext} />;
  if (step === "paywall") return <PaywallStep onContinue={completeOnboarding} />;

  // Question steps share the same UI shell
  return (
    <View style={styles.container}>
      <Header progress={progress} onBack={goBack} stepIdx={stepIdx} totalSteps={STEPS.length - 2} />

      {step === "goals" && (
        <QuestionStep
          title="What are you looking for?"
          subtitle="Pick as many as you want — we'll surface events that match"
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
          subtitle="How do you like to hang out?"
          options={VIBES}
          selected={vibe ? [vibe] : []}
          onChange={(arr) => setVibe(arr[0] || "")}
          onNext={goNext}
          canContinue={!!vibe}
          continueLabel="Continue"
        />
      )}

      {step === "schedule" && (
        <QuestionStep
          title="When are you free?"
          subtitle="Tell us when you typically go out"
          options={SCHEDULES}
          selected={schedule ? [schedule] : []}
          onChange={(arr) => setSchedule(arr[0] || "")}
          onNext={goNext}
          canContinue={!!schedule}
          continueLabel="Continue"
        />
      )}

      {step === "budget" && (
        <QuestionStep
          title="What's your budget?"
          subtitle="We'll prioritize events in your range"
          options={BUDGETS}
          selected={budget ? [budget] : []}
          onChange={(arr) => setBudget(arr[0] || "")}
          onNext={goNext}
          canContinue={!!budget}
          continueLabel="Continue"
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
        {stepIdx}/{totalSteps}
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

      <Text style={styles.welcomeTitle}>Let's find your people</Text>
      <Text style={styles.welcomeSubtitle}>
        Answer a few quick questions and we'll build you a personalized feed of events happening near you right now.
      </Text>

      <View style={styles.welcomeFeatures}>
        {[
          { icon: "🎯", text: "Tailored to your interests" },
          { icon: "⚡", text: "Real-time local events" },
          { icon: "🗺️", text: "Discover hidden gems" },
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
          <Text style={styles.primaryBtnText}>Let's go</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>

      <Text style={styles.takesText}>Takes 30 seconds</Text>
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
}

function QuestionStep({ title, subtitle, options, selected, onChange, onNext, canContinue, continueLabel, multi }: QuestionStepProps) {
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

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 180 }}
        >
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
                    {opt.description && (
                      <Text style={styles.optionDescription}>{opt.description}</Text>
                    )}
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

// ─── Building Step (fake AI analysis) ────────────────────────

function BuildingStep({ onDone }: { onDone: () => void }) {
  const [currentTask, setCurrentTask] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  const tasks = [
    "Analyzing your preferences",
    "Scanning nearby venues",
    "Finding events that match your vibe",
    "Filtering by your schedule",
    "Curating your personal feed",
  ];

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 2000, useNativeDriver: true })
    ).start();

    const interval = setInterval(() => {
      setCurrentTask((prev) => {
        if (prev >= tasks.length - 1) {
          clearInterval(interval);
          setTimeout(onDone, 800);
          return prev;
        }
        return prev + 1;
      });
    }, 900);

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: tasks.length * 900 + 500,
      useNativeDriver: false,
    }).start();

    return () => clearInterval(interval);
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

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
          <Text style={{ fontSize: 40 }}>✨</Text>
        </View>
      </View>

      <Text style={styles.buildingTitle}>Building your feed</Text>
      <Text style={styles.buildingSubtitle}>This will take a moment...</Text>

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

// ─── Paywall ─────────────────────────────────────────────────

function PaywallStep({ onContinue }: { onContinue: () => void }) {
  const [plan, setPlan] = useState<"yearly" | "weekly">("yearly");

  const handleContinue = () => {
    if (plan === "yearly") {
      Alert.alert(
        "Start 7-Day Free Trial",
        "You'll get full access for 7 days. After that, you'll be charged $49.99/year unless you cancel.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start Trial", onPress: onContinue },
        ]
      );
    } else {
      Alert.alert(
        "Subscribe Weekly",
        "You'll be charged $6.99 per week. Cancel anytime.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Subscribe", onPress: onContinue },
        ]
      );
    }
  };

  return (
    <View style={styles.paywallContainer}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 200 }}>
        <View style={styles.paywallHero}>
          <View style={styles.paywallIconWrap}>
            <LinearGradient
              colors={GRADIENTS.accent as any}
              style={StyleSheet.absoluteFillObject}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <Text style={{ fontSize: 48 }}>👑</Text>
          </View>
          <Text style={styles.paywallTitle}>Unlock NearMe Premium</Text>
          <Text style={styles.paywallSubtitle}>
            Your personal feed is ready. Get full access to discover everything happening around you.
          </Text>
        </View>

        <View style={styles.benefitList}>
          {[
            { icon: "infinite", color: COLORS.accent, text: "Unlimited events & swipes" },
            { icon: "flash", color: COLORS.warm, text: "Real-time event notifications" },
            { icon: "bookmark", color: COLORS.pink, text: "Save unlimited events" },
            { icon: "filter", color: COLORS.secondary, text: "Advanced filters & tags" },
            { icon: "people", color: COLORS.success, text: "Priority venue access" },
            { icon: "sparkles", color: COLORS.accentLight, text: "AI-powered recommendations" },
          ].map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <View style={[styles.benefitIcon, { backgroundColor: b.color + "20" }]}>
                <Ionicons name={b.icon as any} size={18} color={b.color} />
              </View>
              <Text style={styles.benefitText}>{b.text}</Text>
            </View>
          ))}
        </View>

        {/* Plan cards */}
        <View style={styles.planList}>
          <PlanCard
            selected={plan === "yearly"}
            onSelect={() => setPlan("yearly")}
            title="7-Day Free Trial"
            price="$49.99"
            period="/year after"
            subtext="Just $0.96/week · Cancel anytime"
            badge="BEST VALUE · SAVE 86%"
            highlighted
          />
          <PlanCard
            selected={plan === "weekly"}
            onSelect={() => setPlan("weekly")}
            title="Weekly"
            price="$6.99"
            period="/week"
            subtext="$363/year · Billed weekly"
          />
        </View>

        <View style={styles.savingsCallout}>
          <Ionicons name="trending-up" size={18} color={COLORS.success} />
          <Text style={styles.savingsText}>
            <Text style={{ color: COLORS.success, fontWeight: "800" }}>Save 86%</Text>
            <Text> with the yearly plan ($313/year less than weekly)</Text>
          </Text>
        </View>
      </ScrollView>

      <View style={styles.paywallBottomBar}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue} activeOpacity={0.85}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            style={styles.btnGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Text style={styles.primaryBtnText}>
              {plan === "yearly" ? "Start Free Trial" : "Continue"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={styles.paywallFootnote}>
          Recurring. Cancel anytime in Settings. Terms & Privacy apply.
        </Text>
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
    fontSize: 34,
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
    marginBottom: 48,
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
  // Shared button
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
    marginBottom: 32,
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
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.text,
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  buildingSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 32,
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
  // Paywall
  paywallContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 60,
    paddingHorizontal: 20,
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
  benefitList: {
    gap: 10,
    marginVertical: 24,
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  benefitText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: "500",
  },
  planList: {
    gap: 10,
  },
  savingsCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    marginTop: 14,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.success + "12",
    borderWidth: 1,
    borderColor: COLORS.success + "30",
  },
  savingsText: {
    fontSize: 13,
    color: COLORS.text,
    flex: 1,
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
  paywallFootnote: {
    fontSize: 11,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 12,
  },
});
