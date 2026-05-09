import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { Event } from "../types";
import { effectiveStart } from "../lib/time-windows";

// Lazy/defensive import. expo-notifications must be installed via
// `npx expo install expo-notifications`. If it isn't present yet, every
// function in this module is a safe no-op so the rest of the app keeps
// working — saved events still save, just without reminders.
let Notifications: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Notifications = require("expo-notifications");
} catch { Notifications = null; }

const SCHEDULE_KEY = "@nearme_reminder_ids";
const PERM_KEY = "@nearme_notif_permission";

interface ScheduleMap {
  // eventId -> array of native notification identifiers (we may schedule >1
  // per event: the day-before reminder + the morning-of nudge)
  [eventId: string]: string[];
}

async function loadMap(): Promise<ScheduleMap> {
  try {
    const raw = await AsyncStorage.getItem(SCHEDULE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function persistMap(map: ScheduleMap) {
  try { await AsyncStorage.setItem(SCHEDULE_KEY, JSON.stringify(map)); }
  catch { /* best-effort */ }
}

export async function ensurePermissions(): Promise<boolean> {
  if (!Notifications) return false;
  try {
    const settings = await Notifications.getPermissionsAsync();
    let status: string = settings.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    await AsyncStorage.setItem(PERM_KEY, status);
    return status === "granted";
  } catch {
    return false;
  }
}

export async function configureNotifications() {
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync?.("default", {
        name: "Saved event reminders",
        importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      });
    }
  } catch { /* best-effort */ }
}

interface QuietHours {
  // 24h hour values: e.g. start=22, end=8 means quiet from 10pm to 8am next day
  start: number;
  end: number;
}

function adjustForQuietHours(when: Date, quiet?: QuietHours | null): Date {
  if (!quiet) return when;
  const h = when.getHours();
  const inQuiet = quiet.start < quiet.end
    ? h >= quiet.start && h < quiet.end
    : h >= quiet.start || h < quiet.end;
  if (!inQuiet) return when;
  const adjusted = new Date(when);
  // Push to the moment quiet hours end
  if (quiet.start < quiet.end) {
    adjusted.setHours(quiet.end, 0, 0, 0);
  } else {
    if (h >= quiet.start) {
      // Past start — roll to next day's end-of-quiet
      adjusted.setDate(adjusted.getDate() + 1);
    }
    adjusted.setHours(quiet.end, 0, 0, 0);
  }
  return adjusted;
}

async function scheduleAt(
  when: Date,
  title: string,
  body: string,
): Promise<string | null> {
  if (!Notifications) return null;
  if (when.getTime() <= Date.now() + 30_000) return null;
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { date: when },
    });
    return id || null;
  } catch {
    return null;
  }
}

export async function scheduleReminderForEvent(
  event: Event,
  opts?: { quietHours?: QuietHours | null },
): Promise<void> {
  if (!Notifications) return;
  await cancelReminderForEvent(event.id);

  const start = effectiveStart(event);
  const venue = event.venue?.name || event.address?.split(",")[0] || "";
  const ids: string[] = [];

  // 24h-before reminder
  const dayBefore = new Date(start.getTime() - 24 * 3600_000);
  const dayBeforeAdjusted = adjustForQuietHours(dayBefore, opts?.quietHours);
  const dayId = await scheduleAt(
    dayBeforeAdjusted,
    "Tomorrow on your radar",
    `${event.title}${venue ? ` · ${venue}` : ""}`,
  );
  if (dayId) ids.push(dayId);

  // Morning-of nudge at 9am local (or post-quiet)
  const morning = new Date(start);
  morning.setHours(9, 0, 0, 0);
  if (morning.getTime() < dayBeforeAdjusted.getTime()) {
    // Skip — would land before the day-before notification
  } else {
    const morningAdjusted = adjustForQuietHours(morning, opts?.quietHours);
    const time = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const morningId = await scheduleAt(
      morningAdjusted,
      "On for tonight",
      `${event.title} · ${time}${venue ? ` at ${venue}` : ""}`,
    );
    if (morningId) ids.push(morningId);
  }

  if (ids.length) {
    const map = await loadMap();
    map[event.id] = ids;
    await persistMap(map);
  }
}

export async function cancelReminderForEvent(eventId: string): Promise<void> {
  if (!Notifications) return;
  const map = await loadMap();
  const ids = map[eventId];
  if (!ids?.length) return;
  for (const id of ids) {
    try { await Notifications.cancelScheduledNotificationAsync(id); }
    catch { /* ignore */ }
  }
  delete map[eventId];
  await persistMap(map);
}

/**
 * Reconcile scheduled reminders against the canonical saved-events list.
 * Cancels reminders for unsaved events, schedules for newly-saved ones.
 * Safe to call repeatedly (idempotent).
 */
export async function syncReminders(
  savedEvents: Event[],
  opts?: { quietHours?: QuietHours | null },
): Promise<void> {
  if (!Notifications) return;
  const map = await loadMap();
  const savedIdSet = new Set(savedEvents.map((e) => e.id));

  // Cancel reminders for events that are no longer saved
  for (const id of Object.keys(map)) {
    if (!savedIdSet.has(id)) {
      await cancelReminderForEvent(id);
    }
  }

  // Schedule reminders for newly-saved events that don't have any yet
  for (const e of savedEvents) {
    if (!map[e.id] && effectiveStart(e).getTime() > Date.now()) {
      await scheduleReminderForEvent(e, opts);
    }
  }
}

export function notificationsAvailable(): boolean {
  return !!Notifications;
}
