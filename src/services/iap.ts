import { Platform } from "react-native";
import Purchases, {
  PurchasesOffering,
  PurchasesPackage,
  CustomerInfo,
  PURCHASES_ERROR_CODE,
} from "react-native-purchases";

export const ENTITLEMENT_ID = "premium";

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || "";

let configured = false;

export function isConfigured() {
  return configured;
}

export async function configureIap() {
  if (configured) return;
  if (Platform.OS !== "ios") return;
  if (!IOS_KEY) return;
  Purchases.configure({ apiKey: IOS_KEY });
  configured = true;
}

export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current ?? null;
}

export async function purchasePackage(
  pkg: PurchasesPackage
): Promise<{ ok: true; info: CustomerInfo } | { ok: false; cancelled: boolean; message?: string }> {
  try {
    const result = await Purchases.purchasePackage(pkg);
    return { ok: true, info: result.customerInfo };
  } catch (e: any) {
    const cancelled =
      e?.userCancelled === true || e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR;
    return { ok: false, cancelled, message: e?.message };
  }
}

export async function restorePurchases(): Promise<{ active: boolean; info: CustomerInfo }> {
  const info = await Purchases.restorePurchases();
  return { active: hasEntitlement(info), info };
}

export async function refreshCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  return Purchases.getCustomerInfo();
}

export function hasEntitlement(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;
  return Boolean(info.entitlements?.active?.[ENTITLEMENT_ID]);
}

export async function hasActiveEntitlement(): Promise<boolean> {
  const info = await refreshCustomerInfo();
  return hasEntitlement(info);
}
