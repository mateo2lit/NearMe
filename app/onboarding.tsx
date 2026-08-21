import { useEffect, useState } from "react";
import { ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppColors, BOCA_RATON, RADIUS, SPACING, TYPE, useAppTheme } from "../src/constants/theme";
import { geocodeAddress, refreshLocation, setManualLocation, useLocation } from "../src/hooks/useLocation";
import { usePreferences } from "../src/hooks/usePreferences";
import { track } from "../src/services/analytics";
import { fetchNearbyEvents } from "../src/services/events";
import { EventCategory } from "../src/types";

const INTERESTS: Array<{ id: EventCategory; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "music", label: "Live music", icon: "musical-notes-outline" }, { id: "food", label: "Food", icon: "restaurant-outline" },
  { id: "arts", label: "Arts & culture", icon: "color-palette-outline" }, { id: "community", label: "Community", icon: "people-outline" },
  { id: "fitness", label: "Fitness", icon: "barbell-outline" }, { id: "sports", label: "Sports", icon: "football-outline" },
  { id: "outdoors", label: "Outdoors", icon: "leaf-outline" }, { id: "movies", label: "Movies", icon: "film-outline" },
  { id: "nightlife", label: "Nightlife", icon: "moon-outline" },
];
const PURPOSES = [["easy", "Unwind"], ["social", "Meet people"], ["live", "See something live"], ["learn", "Learn"], ["active", "Move"], ["free", "Keep it free"]] as const;
const TIMES = [["weekday-daytime", "Weekday daytime"], ["weekday-evenings", "Weekday evenings"], ["weekend-mornings", "Weekend mornings"], ["weekend-afternoons", "Weekend afternoons"], ["weekend-evenings", "Weekend evenings"], ["anytime", "I'm flexible"]] as const;
const ACCESS = [["seated", "Seating"], ["step-free", "Step-free"], ["quiet", "Lower noise"], ["outdoor", "Outdoor"]] as const;

interface ChosenLocation { label: string; lat: number; lng: number }

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const { preferences, savePreferences, completeOnboarding } = usePreferences();
  const [step, setStep] = useState(0);
  const [location, setLocation] = useState<ChosenLocation | null>(null);
  const [categories, setCategories] = useState<EventCategory[]>([]);
  const [intents, setIntents] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>(["anytime"]);
  const [energy, setEnergy] = useState<string>("easygoing");
  const [budget, setBudget] = useState<number | null>(50);
  const [radius, setRadius] = useState(10);
  const [accessibility, setAccessibility] = useState<string[]>([]);
  const [ageBand, setAgeBand] = useState<"18-20" | "21+" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { track("onboarding_started").catch(() => {}); }, []);

  const toggle = (items: string[], value: string, setter: (value: any) => void) => setter(items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  const toggleCategory = (value: EventCategory) => setCategories((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  const toggleTime = (value: string) => setTimes((items) => {
    if (value === "anytime") return ["anytime"];
    const withoutAny = items.filter((item) => item !== "anytime");
    return withoutAny.includes(value) ? withoutAny.filter((item) => item !== value) : [...withoutAny, value];
  });

  const finish = async () => {
    if (!location) return;
    setSaving(true);
    const next = {
      ...preferences,
      categories,
      intents,
      timePreferences: times.length ? times : ["anytime"],
      socialEnergy: energy,
      budgetMax: budget,
      accessibilityNeeds: accessibility,
      ageBand,
      radius,
      lat: location.lat,
      lng: location.lng,
      customLocation: location,
      happyHourEnabled: true,
      onboarding: {
        goals: intents,
        vibe: energy,
        social: null,
        schedule: times[0] ?? "anytime",
        blocker: null,
        budget: budget == null ? "any" : String(budget),
        happyHour: true,
        intents,
        socialEnergy: energy,
        company: null,
        timePreferences: times,
        budgetMax: budget,
        accessibilityNeeds: accessibility,
        alcoholPreference: null,
        ageBand,
      },
    };
    await savePreferences(next);
    await completeOnboarding();
    track("onboarding_completed", { category_count: categories.length, intent_count: intents.length, radius, budget_max: budget, accessibility_count: accessibility.length }).catch(() => {});
    fetchNearbyEvents(location.lat, location.lng, radius).catch(() => {});
    router.replace("/(tabs)");
  };

  if (step === 0) return (
    <View style={[styles.welcome, { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) }]}>
      <View style={styles.brand}><Ionicons name="navigate" size={25} color="#FFFFFF" /></View>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={styles.kicker}>NEARME</Text>
        <Text style={styles.hero}>Three plans worth leaving home for.</Text>
        <Text style={styles.heroBody}>Tell us what fits your life. We'll rank nearby events by time, distance, budget and trust—not by who paid to appear.</Text>
        <View style={styles.promiseList}>
          <Promise icon="location-outline" text="Your radius is always respected" styles={styles} colors={colors} />
          <Promise icon="options-outline" text="Useful for quiet afternoons through lively nights" styles={styles} colors={colors} />
          <Promise icon="lock-open-outline" text="Free to explore. No subscription required" styles={styles} colors={colors} />
        </View>
      </View>
      <View><Pressable style={styles.primary} onPress={() => setStep(1)} accessibilityRole="button"><Text style={styles.primaryText}>Find my plans</Text><Ionicons name="arrow-forward" size={21} color="#FFFFFF" /></Pressable><Text style={styles.ageNote}>By continuing, you confirm that you are at least 18 years old.</Text></View>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.progressHeader}>
        <Pressable style={styles.back} onPress={() => setStep((value) => Math.max(0, value - 1))} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="arrow-back" size={24} color={colors.text} /></Pressable>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>
        <Text style={styles.stepText}>{step}/3</Text>
      </View>
      {step === 1 && <LocationStep value={location} onChange={setLocation} onNext={() => setStep(2)} styles={styles} colors={colors} />}
      {step === 2 && (
        <QuestionLayout title="What makes a plan worth it?" body="Pick at least three interests. Add any purpose that matters today." onNext={() => setStep(3)} nextDisabled={categories.length < 3} styles={styles}>
          <Text style={styles.label}>INTERESTS · PICK 3+</Text>
          <View style={styles.grid}>{INTERESTS.map((item) => { const selected = categories.includes(item.id); return <Pressable key={item.id} onPress={() => toggleCategory(item.id)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.interest, selected && styles.interestSelected]}><Ionicons name={item.icon} size={25} color={selected ? colors.accent : colors.muted} /><Text style={[styles.interestText, selected && styles.selectedText]}>{item.label}</Text>{selected && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}</Pressable>; })}</View>
          <Text style={styles.label}>PURPOSE · OPTIONAL</Text>
          <View style={styles.wrap}>{PURPOSES.map(([id, label]) => <Choice key={id} label={label} selected={intents.includes(id)} onPress={() => toggle(intents, id, setIntents)} styles={styles} />)}</View>
        </QuestionLayout>
      )}
      {step === 3 && (
        <QuestionLayout title="Make it fit real life" body="These are hard constraints where data is available. You can change them anytime." onNext={finish} nextDisabled={saving || !ageBand} nextLabel={saving ? "Building your feed…" : "Show my best three"} styles={styles}>
          <Text style={styles.label}>AGE ELIGIBILITY</Text><View style={styles.wrap}>{[["18-20", "I'm 18–20"], ["21+", "I'm 21+"]].map(([id, label]) => <Choice key={id} label={label} selected={ageBand === id} onPress={() => setAgeBand(id as "18-20" | "21+")} styles={styles} />)}</View>
          <Text style={styles.label}>WHEN</Text><View style={styles.wrap}>{TIMES.map(([id, label]) => <Choice key={id} label={label} selected={times.includes(id)} onPress={() => toggleTime(id)} styles={styles} />)}</View>
          <Text style={styles.label}>SOCIAL ENERGY</Text><View style={styles.wrap}>{[["quiet", "Quiet"], ["easygoing", "Easygoing"], ["lively", "Lively"]].map(([id, label]) => <Choice key={id} label={label} selected={energy === id} onPress={() => setEnergy(id)} styles={styles} />)}</View>
          <Text style={styles.label}>MAX EVENT PRICE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrap}>{[[0, "Free"], [25, "$25"], [50, "$50"], [100, "$100"], [null, "Any"]].map(([value, label]) => <Choice key={label as string} label={label as string} selected={budget === value} onPress={() => setBudget(value as number | null)} styles={styles} />)}</ScrollView>
          <Text style={styles.label}>MAX DISTANCE</Text><View style={styles.wrap}>{[5, 10, 15, 25].map((value) => <Choice key={value} label={`${value} miles`} selected={radius === value} onPress={() => setRadius(value)} styles={styles} />)}</View>
          <Text style={styles.label}>ACCESS & SETTING · OPTIONAL</Text><View style={styles.wrap}>{ACCESS.map(([id, label]) => <Choice key={id} label={label} selected={accessibility.includes(id)} onPress={() => toggle(accessibility, id, setAccessibility)} styles={styles} />)}</View>
        </QuestionLayout>
      )}
    </View>
  );
}

function LocationStep({ value, onChange, onNext, styles, colors }: any) {
  const live = useLocation();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const choose = async (loc: ChosenLocation) => { await setManualLocation(loc); onChange(loc); };
  const gps = async () => { setBusy(true); await refreshLocation(); setBusy(false); };
  useEffect(() => { if (live.lat != null && live.lng != null && !value) onChange({ label: live.cityName || "Current location", lat: live.lat, lng: live.lng }); }, [live.lat, live.lng]);
  const search = async () => { if (!input.trim()) return; Keyboard.dismiss(); setBusy(true); const found = await geocodeAddress(input.trim()); setBusy(false); if (found) { await choose(found); setInput(""); } };
  return <QuestionLayout title="Where should we look?" body="We'll only show events inside the radius you choose." onNext={onNext} nextDisabled={!value} styles={styles}>
    <Pressable style={styles.locationButton} onPress={gps}><View style={styles.locationIcon}><Ionicons name="navigate" size={24} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.locationTitle}>{busy ? "Finding you…" : "Use current location"}</Text><Text style={styles.locationBody}>Best for plans close to where you are now</Text></View>{busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="chevron-forward" size={21} color={colors.muted} />}</Pressable>
    <Text style={styles.label}>OR ENTER A CITY OR ADDRESS</Text><View style={styles.searchRow}><TextInput value={input} onChangeText={setInput} onSubmitEditing={search} placeholder="City, state or address" placeholderTextColor={colors.muted} style={styles.input} returnKeyType="search" accessibilityLabel="City or address" /><Pressable style={[styles.searchButton, !input.trim() && styles.disabled]} onPress={search} disabled={!input.trim()}><Ionicons name="search" size={22} color="#FFFFFF" /></Pressable></View>
    <Text style={styles.label}>QUICK CHOICES</Text><View style={styles.wrap}><Choice label="Boca Raton" selected={value?.label?.includes("Boca")} onPress={() => choose({ label: "Boca Raton, FL", ...BOCA_RATON })} styles={styles} /><Choice label="Miami" selected={value?.label?.includes("Miami")} onPress={() => choose({ label: "Miami, FL", lat: 25.7617, lng: -80.1918 })} styles={styles} /></View>
    {value && <View style={styles.selectedLocation}><Ionicons name="checkmark-circle" size={23} color={colors.success} /><View style={{ flex: 1 }}><Text style={styles.locationTitle}>{value.label}</Text><Text style={styles.locationBody}>Your selected starting point</Text></View></View>}
  </QuestionLayout>;
}

function QuestionLayout({ title, body, children, onNext, nextDisabled, nextLabel = "Continue", styles }: any) { return <><ScrollView style={{ flex: 1 }} contentContainerStyle={styles.question} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><Text style={styles.questionTitle}>{title}</Text><Text style={styles.questionBody}>{body}</Text><View style={styles.questions}>{children}</View></ScrollView><Pressable style={[styles.primary, nextDisabled && styles.disabled]} onPress={onNext} disabled={nextDisabled} accessibilityRole="button" accessibilityState={{ disabled: nextDisabled }}><Text style={styles.primaryText}>{nextLabel}</Text>{!nextDisabled && <Ionicons name="arrow-forward" size={21} color="#FFFFFF" />}</Pressable></>; }
function Choice({ label, selected, onPress, styles }: any) { return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.selectedText]}>{label}</Text></Pressable>; }
function Promise({ icon, text, styles, colors }: any) { return <View style={styles.promise}><View style={styles.promiseIcon}><Ionicons name={icon} size={22} color={colors.accent} /></View><Text style={styles.promiseText}>{text}</Text></View>; }

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: SPACING.md }, welcome: { flex: 1, backgroundColor: c.bg, paddingHorizontal: SPACING.lg },
  brand: { width: 52, height: 52, borderRadius: 16, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }, kicker: { color: c.accent, fontSize: TYPE.meta, letterSpacing: 2, fontWeight: "900", marginBottom: 12 }, ageNote: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, textAlign: "center", marginTop: 10 },
  hero: { color: c.text, fontSize: 42, lineHeight: 47, letterSpacing: -1.8, fontWeight: "900" }, heroBody: { color: c.muted, fontSize: 18, lineHeight: 28, marginTop: 18 }, promiseList: { gap: 14, marginTop: 28 }, promise: { flexDirection: "row", alignItems: "center", gap: 12 }, promiseIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }, promiseText: { flex: 1, color: c.text, fontSize: TYPE.body, lineHeight: 23, fontWeight: "700" },
  primary: { minHeight: 54, borderRadius: RADIUS.pill, backgroundColor: c.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 20 }, primaryText: { color: "#FFFFFF", fontSize: TYPE.body, fontWeight: "900" }, disabled: { opacity: 0.42 },
  progressHeader: { height: 52, flexDirection: "row", alignItems: "center", gap: 12 }, back: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" }, progressTrack: { flex: 1, height: 6, backgroundColor: c.cardAlt, borderRadius: 3, overflow: "hidden" }, progressFill: { height: "100%", backgroundColor: c.accent }, stepText: { color: c.muted, fontSize: TYPE.caption, fontWeight: "800", width: 32, textAlign: "right" },
  question: { paddingTop: SPACING.lg, paddingBottom: SPACING.xl }, questionTitle: { color: c.text, fontSize: TYPE.hero, lineHeight: 39, letterSpacing: -1, fontWeight: "900" }, questionBody: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, marginTop: 10 }, questions: { gap: 14, marginTop: SPACING.xl }, label: { color: c.muted, fontSize: TYPE.caption, letterSpacing: 0.8, fontWeight: "900", marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, interest: { width: "48%", minHeight: 78, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, gap: 6 }, interestSelected: { borderColor: c.accent, backgroundColor: c.accentSoft }, interestText: { color: c.text, fontSize: TYPE.meta, lineHeight: 20, fontWeight: "800" }, selectedText: { color: c.accent },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choice: { minHeight: 46, justifyContent: "center", paddingHorizontal: 15, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card }, choiceSelected: { borderColor: c.accent, backgroundColor: c.accentSoft }, choiceText: { color: c.text, fontSize: TYPE.meta, fontWeight: "700" },
  locationButton: { minHeight: 74, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 }, locationIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }, locationTitle: { color: c.text, fontSize: TYPE.body, fontWeight: "900" }, locationBody: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 },
  searchRow: { flexDirection: "row", gap: 8 }, input: { flex: 1, minHeight: 52, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, color: c.text, fontSize: TYPE.body, paddingHorizontal: 14 }, searchButton: { width: 52, height: 52, borderRadius: RADIUS.sm, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }, selectedLocation: { minHeight: 66, borderRadius: RADIUS.md, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.successSoft },
}); }
