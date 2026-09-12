import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../../src/constants/theme";
import { geocodeAddress, refreshLocation, useLocation } from "../../src/hooks/useLocation";
import { usePreferences } from "../../src/hooks/usePreferences";
import { track } from "../../src/services/analytics";
import { configureIap, hasActiveEntitlement, restorePurchases } from "../../src/services/iap";
import { markSubscribed } from "../../src/services/subscription";
import { ensurePermissions, syncReminders } from "../../src/services/reminders";
import { getSavedEvents } from "../../src/services/savedStore";
import { EventCategory, UserPreferences } from "../../src/types";

const INTERESTS: Array<{ id: EventCategory; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "music", label: "Music", icon: "musical-notes-outline" }, { id: "food", label: "Food", icon: "restaurant-outline" },
  { id: "arts", label: "Arts & culture", icon: "color-palette-outline" }, { id: "community", label: "Community", icon: "people-outline" },
  { id: "fitness", label: "Fitness", icon: "barbell-outline" }, { id: "sports", label: "Sports", icon: "football-outline" },
  { id: "outdoors", label: "Outdoors", icon: "leaf-outline" }, { id: "movies", label: "Movies", icon: "film-outline" },
  { id: "nightlife", label: "Nightlife", icon: "moon-outline" },
];

const PURPOSES = [
  ["easy", "Easygoing"], ["social", "Meet people"], ["live", "Live entertainment"], ["learn", "Learn something"],
  ["active", "Get active"], ["culture", "Culture"], ["food", "Food experiences"], ["free", "Free plans"],
] as const;
const ACCESS = [["seated", "Seating"], ["step-free", "Step-free"], ["quiet", "Lower noise"], ["outdoor", "Outdoor"]] as const;
const RADII = [3, 5, 10, 15, 25, 50];

export default function YouScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const location = useLocation();
  const { preferences, savePreferences, loading } = usePreferences();
  const [address, setAddressInput] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [premium, setPremium] = useState(false);
  const [purchaseBusy, setPurchaseBusy] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("@nearme_notif_permission").then((value) => setNotifications(value === "granted"));
    configureIap().then(async () => {
      setPremium(await hasActiveEntitlement());
    }).catch(() => {});
  }, []);

  const patchPreferences = (patch: Partial<UserPreferences>) => savePreferences({ ...preferences, ...patch });
  const toggleValue = (key: "intents" | "accessibilityNeeds", value: string) => {
    const current = preferences[key] ?? [];
    patchPreferences({ [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  };
  const toggleInterest = (category: EventCategory) => patchPreferences({ categories: preferences.categories.includes(category) ? preferences.categories.filter((item) => item !== category) : [...preferences.categories, category] });

  const submitAddress = async () => {
    if (!address.trim()) return;
    setGeocoding(true);
    const result = await geocodeAddress(address.trim());
    setGeocoding(false);
    if (!result) {
      Alert.alert("Location not found", "Try a full city and state or a street address.");
      return;
    }
    await patchPreferences({ lat: result.lat, lng: result.lng, customLocation: result });
    await refreshLocation();
    setAddressInput("");
    track("location_changed", { mode: "custom", label: result.label }).catch(() => {});
  };

  const useGps = async () => {
    await patchPreferences({ customLocation: null });
    await refreshLocation();
    track("location_changed", { mode: "gps" }).catch(() => {});
  };

  const changeNotifications = async (value: boolean) => {
    if (value) {
      const granted = await ensurePermissions();
      setNotifications(granted);
      if (granted) await syncReminders(getSavedEvents(), { quietHours: { start: 22, end: 8 } });
    } else {
      setNotifications(false);
      await AsyncStorage.setItem("@nearme_notif_permission", "denied");
    }
  };

  const restore = async () => {
    setPurchaseBusy("restore");
    try {
      const result = await restorePurchases();
      setPremium(result.active);
      if (result.active) {
        await markSubscribed();
        track("subscription_restored").catch(() => {});
      }
      Alert.alert(result.active ? "Purchase restored" : "No active plan found", result.active ? "Your subscription is active on this device." : "Use the Apple ID that originally purchased the subscription.");
    } catch {
      Alert.alert("Restore unavailable", "Please check your connection and try again.");
    } finally { setPurchaseBusy(null); }
  };

  const reset = () => Alert.alert("Start over?", "This clears preferences and locally saved plans from this device.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear data", style: "destructive", onPress: async () => {
      await AsyncStorage.clear();
      // AsyncStorage.clear() also wipes the cached entitlement. Re-establish it
      // so a paying subscriber is not asked to buy the app a second time.
      try { if (await hasActiveEntitlement()) await markSubscribed(); } catch { /* re-verified on next launch */ }
      router.replace("/onboarding");
    } },
  ]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 130 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Text style={styles.eyebrow}>Your NearMe</Text><Text style={styles.title}>Tune your picks</Text><Text style={styles.subtitle}>These controls are constraints, not suggestions. Distance, price and accessibility stay honest.</Text></View>

      <Section title="Location & travel" icon="navigate-outline" styles={styles} colors={colors}>
        <View style={styles.locationRow}><View style={styles.iconCircle}><Ionicons name="location" size={21} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{location.cityName || preferences.customLocation?.label || "Location not set"}</Text><Text style={styles.rowBody}>{preferences.customLocation ? "Custom location" : "Current device location"}</Text></View><Pressable style={styles.smallButton} onPress={useGps}><Text style={styles.smallButtonText}>Use GPS</Text></Pressable></View>
        <Text style={styles.fieldLabel}>Use another city or address</Text>
        <View style={styles.inputRow}><TextInput style={styles.input} value={address} onChangeText={setAddressInput} onSubmitEditing={submitAddress} placeholder="City, state or address" placeholderTextColor={colors.muted} returnKeyType="search" accessibilityLabel="City or address" /><Pressable style={[styles.submit, (!address.trim() || geocoding) && styles.disabled]} onPress={submitAddress} disabled={!address.trim() || geocoding}>{geocoding ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="arrow-forward" size={22} color="#FFFFFF" />}</Pressable></View>
        <Text style={styles.fieldLabel}>Search radius</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{RADII.map((radius) => <Choice key={radius} label={`${radius} mi`} selected={preferences.radius === radius} onPress={() => patchPreferences({ radius })} styles={styles} />)}</ScrollView>
        <Text style={styles.helper}>The default 10-mile search may include clearly labeled suggestions up to 100 miles away when local plans are scarce. Other radii stay within your selection.</Text>
      </Section>

      <Section title="What you enjoy" icon="sparkles-outline" styles={styles} colors={colors}>
        <Text style={styles.fieldLabel}>Purpose</Text>
        <View style={styles.wrap}>{PURPOSES.map(([id, label]) => <Choice key={id} label={label} selected={(preferences.intents ?? []).includes(id)} onPress={() => toggleValue("intents", id)} styles={styles} />)}</View>
        <Text style={styles.fieldLabel}>Interests</Text>
        <View style={styles.interestGrid}>{INTERESTS.map((item) => { const selected = preferences.categories.includes(item.id); return <Pressable key={item.id} onPress={() => toggleInterest(item.id)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.interest, selected && styles.interestSelected]}><Ionicons name={item.icon} size={22} color={selected ? colors.accent : colors.muted} /><Text style={[styles.interestText, selected && styles.interestTextSelected]}>{item.label}</Text></Pressable>; })}</View>
      </Section>

      <Section title="Comfort & budget" icon="options-outline" styles={styles} colors={colors}>
        <Text style={styles.fieldLabel}>Social energy</Text>
        <View style={styles.wrap}>{[["quiet", "Quiet"], ["easygoing", "Easygoing"], ["lively", "Lively"]].map(([id, label]) => <Choice key={id} label={label} selected={preferences.socialEnergy === id} onPress={() => patchPreferences({ socialEnergy: preferences.socialEnergy === id ? null : id })} styles={styles} />)}</View>
        <Text style={styles.fieldLabel}>Age eligibility</Text>
        <View style={styles.wrap}>{[["18-20", "18–20"], ["21+", "21+"]].map(([id, label]) => <Choice key={id} label={label} selected={preferences.ageBand === id} onPress={() => patchPreferences({ ageBand: id as "18-20" | "21+" })} styles={styles} />)}</View>
        <Text style={styles.fieldLabel}>Maximum event price</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choiceRow}>{[[0, "Free"], [25, "$25"], [50, "$50"], [100, "$100"], [null, "Any"]].map(([value, label]) => <Choice key={label as string} label={label as string} selected={preferences.budgetMax === value || (value === null && preferences.budgetMax == null)} onPress={() => patchPreferences({ budgetMax: value as number | null })} styles={styles} />)}</ScrollView>
        <Text style={styles.fieldLabel}>Accessibility and setting</Text>
        <View style={styles.wrap}>{ACCESS.map(([id, label]) => <Choice key={id} label={label} selected={(preferences.accessibilityNeeds ?? []).includes(id)} onPress={() => toggleValue("accessibilityNeeds", id)} styles={styles} />)}</View>
        <ToggleRow icon="wine-outline" title="Happy hours & recurring specials" body="Keep venue specials in a separate, lower-priority lane." value={preferences.happyHourEnabled ?? true} onValueChange={(value: boolean) => patchPreferences({ happyHourEnabled: value })} styles={styles} colors={colors} />
      </Section>

      <Section title="Alerts" icon="notifications-outline" styles={styles} colors={colors}>
        <ToggleRow icon="calendar-outline" title="Saved-plan reminders" body="A day before and the morning of. Quiet hours are 10 PM–8 AM." value={notifications} onValueChange={changeNotifications} styles={styles} colors={colors} />
      </Section>

      <Section title="Subscription" icon="diamond-outline" styles={styles} colors={colors}>
        {premium ? <View style={styles.premiumActive}><Ionicons name="checkmark-circle" size={24} color={colors.success} /><View style={{ flex: 1 }}><Text style={styles.rowTitle}>Your subscription is active</Text><Text style={styles.rowBody}>Manage or cancel in your Apple ID settings. Changes take effect at the end of the current period.</Text></View></View> : <><Text style={styles.plusLead}>Your subscription is not active on this device.</Text><Text style={styles.helper}>If you subscribed with a different Apple ID, tap Restore purchases below.</Text></>}
        {premium && <Pressable style={styles.linkButton} onPress={() => Linking.openURL("https://apps.apple.com/account/subscriptions").catch(() => {})} accessibilityRole="link"><Text style={styles.linkText}>Manage subscription</Text></Pressable>}
        <Pressable style={styles.linkButton} onPress={restore}><Text style={styles.linkText}>{purchaseBusy === "restore" ? "Restoring…" : "Restore purchases"}</Text></Pressable>
      </Section>

      <Section title="About & privacy" icon="shield-checkmark-outline" styles={styles} colors={colors}>
        <LinkRow label="Privacy policy" onPress={() => Linking.openURL("https://mateo2lit.github.io/NearMe/privacy.html")} styles={styles} colors={colors} />
        <LinkRow label="Terms of use" onPress={() => Linking.openURL("https://mateo2lit.github.io/NearMe/terms.html")} styles={styles} colors={colors} />
        {/* The privacy policy promises this path, so the app has to offer it. */}
        <LinkRow label="Request your data or deletion" onPress={() => Linking.openURL("mailto:dbh28tekkit@gmail.com?subject=NearMe%20data%20request").catch(() => {})} styles={styles} colors={colors} />
        <Pressable style={styles.dangerRow} onPress={reset}><Ionicons name="trash-outline" size={21} color={colors.hot} /><Text style={styles.dangerText}>Clear local data and start over</Text></Pressable>
      </Section>
    </ScrollView>
  );
}

function Section({ title, icon, children, styles, colors }: any) { return <View style={styles.sectionWrap}><View style={styles.sectionTitleRow}><Ionicons name={icon} size={22} color={colors.accent} /><Text style={styles.sectionTitle}>{title}</Text></View><View style={styles.card}>{children}</View></View>; }
function Choice({ label, selected, onPress, styles }: any) { return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.choice, selected && styles.choiceSelected]}><Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text></Pressable>; }
function ToggleRow({ icon, title, body, value, onValueChange, styles, colors }: any) { return <View style={styles.toggleRow}><View style={styles.iconCircle}><Ionicons name={icon} size={21} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowBody}>{body}</Text></View><Switch value={value} onValueChange={onValueChange} trackColor={{ false: colors.border, true: colors.accent }} thumbColor="#FFFFFF" accessibilityLabel={title} /></View>; }
function LinkRow({ label, onPress, styles, colors }: any) { return <Pressable style={styles.linkRow} onPress={onPress} accessibilityRole="link"><Text style={styles.rowTitle}>{label}</Text><Ionicons name="open-outline" size={20} color={colors.muted} /></Pressable>; }

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  header: { paddingHorizontal: SPACING.md, paddingBottom: 4 }, eyebrow: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  title: { color: c.text, fontSize: TYPE.hero, lineHeight: 39, fontWeight: "900", letterSpacing: -1 }, subtitle: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, marginTop: 5 },
  sectionWrap: { marginTop: SPACING.lg, paddingHorizontal: SPACING.md }, sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }, sectionTitle: { color: c.text, fontSize: TYPE.title, fontWeight: "900" },
  card: { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, padding: SPACING.md, gap: 12 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 10 }, iconCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.accentSoft },
  rowTitle: { color: c.text, fontSize: TYPE.body, lineHeight: 22, fontWeight: "800" }, rowBody: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 },
  smallButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }, smallButtonText: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  fieldLabel: { color: c.text, fontSize: TYPE.meta, fontWeight: "800", marginTop: 6 }, helper: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19 },
  inputRow: { flexDirection: "row", gap: 8 }, input: { flex: 1, minHeight: 50, borderRadius: RADIUS.sm, backgroundColor: c.cardAlt, borderWidth: 1, borderColor: c.border, color: c.text, fontSize: TYPE.body, paddingHorizontal: 14 },
  submit: { width: 50, height: 50, borderRadius: RADIUS.sm, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" }, disabled: { opacity: 0.42 },
  choiceRow: { gap: 8 }, wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  choiceSelected: { borderColor: c.accent, backgroundColor: c.accentSoft }, choiceText: { color: c.text, fontSize: TYPE.meta, fontWeight: "700" }, choiceTextSelected: { color: c.accent },
  interestGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, interest: { width: "48%", minHeight: 54, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 }, interestSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
  interestText: { flex: 1, color: c.text, fontSize: TYPE.meta, lineHeight: 20, fontWeight: "700" }, interestTextSelected: { color: c.accent },
  toggleRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 },
  plusLead: { color: c.text, fontSize: TYPE.body, lineHeight: 24 }, premiumActive: { flexDirection: "row", gap: 10, padding: 12, borderRadius: RADIUS.sm, backgroundColor: c.successSoft },
  planRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12 }, planPrice: { color: c.text, fontSize: TYPE.body, fontWeight: "900" },
  linkButton: { minHeight: 48, alignItems: "center", justifyContent: "center" }, linkText: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  linkRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: c.border },
  dangerRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10 }, dangerText: { color: c.hot, fontSize: TYPE.body, fontWeight: "700" },
}); }
