import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { PurchasesOffering, PurchasesPackage } from "react-native-purchases";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../constants/theme";
import { getOfferings, hasEntitlement, purchasePackage, restorePurchases } from "../services/iap";
import { track } from "../services/analytics";
import { trialDaysFor } from "../lib/trialOffer";

// GitHub Pages paths are case sensitive: the repo is `NearMe`, so the lowercase
// spelling 404s. Verified live 2026-09-11. Keep these in sync with the links in
// marketing/app-store-listing.md, which is what gets pasted into App Store
// Connect — guideline 3.1.2(c) rejects a listing whose links do not resolve.
const TERMS_URL = "https://mateo2lit.github.io/NearMe/terms.html";
const PRIVACY_URL = "https://mateo2lit.github.io/NearMe/privacy.html";

const BENEFITS: Array<{ icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }> = [
  { icon: "sparkles-outline", text: "Three plans picked for you, with the reason each one fits" },
  { icon: "navigate-outline", text: "Real distance and price before you commit to anything" },
  { icon: "notifications-outline", text: "Reminders before your saved plans start" },
  { icon: "refresh-outline", text: "Fresh local inventory from ticketing, venues and campuses" },
];

interface Props {
  /** Called only after an entitlement is confirmed active. */
  onSubscribed: () => void;
  onBack: () => void;
}

export default function PaywallStep({ onSubscribed, onBack }: Props) {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [plan, setPlan] = useState<"yearly" | "weekly">("yearly");
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"purchase" | "restore" | null>(null);

  useEffect(() => { track("subscription_viewed").catch(() => {}); }, []);

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
    return () => { cancelled = true; };
  }, []);

  const annualPkg = offering?.annual ?? null;
  const weeklyPkg = offering?.weekly ?? null;
  const selectedPkg = plan === "yearly" ? annualPkg : weeklyPkg;

  // Fallbacks are display-only and never used to complete a purchase. If the
  // store did not load, handleSubscribe refuses rather than guessing a price.
  const annualPrice = annualPkg?.product.priceString ?? "$79.99";
  const weeklyPrice = weeklyPkg?.product.priceString ?? "$4.99";
  const annualPerMonth = annualPkg
    ? `${annualPkg.product.currencyCode === "USD" ? "$" : ""}${(annualPkg.product.price / 12).toFixed(2)}/mo`
    : "$6.67/mo";
  // Never invent a trial. If StoreKit reports no free introductory offer for
  // the selected product, we advertise the price alone. Claiming "3 days free"
  // against a product Apple will charge immediately is the disclosure mismatch
  // that guideline 3.1.2(c) rejects.
  const trialDays = trialDaysFor(selectedPkg);
  const renewal = plan === "yearly"
    ? `${annualPrice} per year (${annualPerMonth})`
    : `${weeklyPrice} per week`;
  const priceLine = trialDays != null
    ? `${trialDays} days free, then ${renewal}`
    : `${renewal}, billed immediately`;
  const ctaLabel = trialDays != null ? `Start ${trialDays}-day free trial` : `Subscribe ${renewal}`;

  const handleSubscribe = async () => {
    if (busy) return;
    if (!selectedPkg) {
      Alert.alert("Store unavailable", "We couldn't load subscription options. Check your connection and try again.");
      return;
    }
    setBusy("purchase");
    const result = await purchasePackage(selectedPkg);
    setBusy(null);

    if (result.ok) {
      if (hasEntitlement(result.info)) {
        track("subscription_started", { plan }).catch(() => {});
        onSubscribed();
      } else {
        Alert.alert("Purchase incomplete", "Your purchase didn't activate. Try again, or tap Restore purchases.");
      }
      return;
    }
    if (result.cancelled) return;
    Alert.alert("Purchase failed", result.message ?? "Something went wrong. Please try again.");
  };

  const handleRestore = async () => {
    if (busy) return;
    setBusy("restore");
    try {
      const { active } = await restorePurchases();
      if (active) {
        track("subscription_restored", { placement: "paywall" }).catch(() => {});
        onSubscribed();
      } else {
        Alert.alert("Restore purchases", "No active subscription found on this Apple ID.");
      }
    } catch (e: any) {
      Alert.alert("Restore failed", e?.message ?? "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Ionicons name="navigate" size={30} color="#FFFFFF" />
        </View>
        <Text style={styles.title}>{trialDays != null ? "Start your free trial" : "Subscribe to NearMe"}</Text>
        <Text style={styles.lead}>
          NearMe keeps local inventory fresh and ranks it against your actual constraints.
          {trialDays != null
            ? " Your trial starts now and you can cancel any time before it ends."
            : " You can cancel any time in your Apple ID settings."}
        </Text>

        <View style={styles.benefits}>
          {BENEFITS.map((item) => (
            <View key={item.text} style={styles.benefit}>
              <Ionicons name={item.icon} size={21} color={colors.accent} />
              <Text style={styles.benefitText}>{item.text}</Text>
            </View>
          ))}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading plans" />
            <Text style={styles.loadingText}>Loading plans…</Text>
          </View>
        ) : (
          <View style={styles.plans}>
            <PlanOption
              label="Yearly"
              price={annualPrice}
              detail={`${annualPerMonth} · best value`}
              selected={plan === "yearly"}
              onPress={() => setPlan("yearly")}
              styles={styles}
              colors={colors}
            />
            <PlanOption
              label="Weekly"
              price={weeklyPrice}
              detail="Billed every week"
              selected={plan === "weekly"}
              onPress={() => setPlan("weekly")}
              styles={styles}
              colors={colors}
            />
          </View>
        )}

        <Text style={styles.disclosure}>{priceLine}</Text>
        <Text style={styles.fineprint}>
          Payment is charged to your Apple ID at confirmation. The subscription renews automatically unless cancelled at least 24 hours before the period ends. Manage or cancel in your Apple ID settings.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          style={[styles.primary, busy === "purchase" && styles.dim]}
          onPress={handleSubscribe}
          disabled={busy != null}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy != null }}
          accessibilityLabel={`${ctaLabel}. ${priceLine}`}
        >
          <Text style={styles.primaryText}>{busy === "purchase" ? "Starting…" : ctaLabel}</Text>
        </Pressable>
        <View style={styles.links}>
          <Pressable onPress={handleRestore} disabled={busy != null} accessibilityRole="button" style={styles.link}>
            <Text style={styles.linkText}>{busy === "restore" ? "Restoring…" : "Restore purchases"}</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(TERMS_URL).catch(() => {})} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkText}>Terms</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})} accessibilityRole="link" style={styles.link}>
            <Text style={styles.linkText}>Privacy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function PlanOption({ label, price, detail, selected, onPress, styles, colors }: any) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${price}, ${detail}`}
      style={[styles.plan, selected && styles.planSelected]}
    >
      <Ionicons
        name={selected ? "radio-button-on" : "radio-button-off"}
        size={23}
        color={selected ? colors.accent : colors.muted}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.planLabel}>{label}</Text>
        <Text style={styles.planDetail}>{detail}</Text>
      </View>
      <Text style={styles.planPrice}>{price}</Text>
    </Pressable>
  );
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, paddingHorizontal: SPACING.md },
  topBar: { height: 52, justifyContent: "center" },
  back: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  body: { paddingBottom: SPACING.xl },
  hero: { width: 62, height: 62, borderRadius: 20, backgroundColor: c.accent, alignItems: "center", justifyContent: "center" },
  title: { color: c.text, fontSize: TYPE.hero, lineHeight: 39, letterSpacing: -1, fontWeight: "900", marginTop: 18 },
  lead: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, marginTop: 10 },
  benefits: { gap: 12, marginTop: SPACING.lg },
  benefit: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  benefitText: { flex: 1, color: c.text, fontSize: TYPE.meta, lineHeight: 22, fontWeight: "700" },
  loading: { minHeight: 140, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: c.muted, fontSize: TYPE.meta },
  plans: { gap: 10, marginTop: SPACING.lg },
  plan: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card },
  planSelected: { borderColor: c.accent, backgroundColor: c.accentSoft },
  planLabel: { color: c.text, fontSize: TYPE.body, fontWeight: "900" },
  planDetail: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 },
  planPrice: { color: c.text, fontSize: TYPE.body, fontWeight: "900" },
  disclosure: { color: c.text, fontSize: TYPE.meta, lineHeight: 21, fontWeight: "800", marginTop: 16 },
  fineprint: { color: c.muted, fontSize: TYPE.caption, lineHeight: 18, marginTop: 8 },
  footer: { gap: 10, paddingBottom: 6 },
  primary: { minHeight: 54, borderRadius: RADIUS.pill, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  primaryText: { color: "#FFFFFF", fontSize: TYPE.body, fontWeight: "900" },
  dim: { opacity: 0.5 },
  links: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10 },
  linkText: { color: c.accent, fontSize: TYPE.caption, fontWeight: "800" },
}); }
