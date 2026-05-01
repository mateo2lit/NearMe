import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  recordSessionDay,
  shouldFireDelayedReprompt,
  shouldFireStreakPrompt,
  markStreakShown,
  isNativeReviewAvailable,
} from "../services/rating";

export type TriggerDecision = "none" | "delayed" | "streak";

/**
 * Pure decision function — exported separately for unit testing.
 * Returns which trigger should fire (delayed re-prompt wins over streak when both eligible).
 */
export async function decideTrigger(): Promise<TriggerDecision> {
  if (await shouldFireDelayedReprompt()) return "delayed";
  if (await shouldFireStreakPrompt()) return "streak";
  return "none";
}

interface UseRatingTriggersResult {
  visible: boolean;
  dismiss: () => void;
}

export function useRatingTriggers(): UseRatingTriggersResult {
  const [visible, setVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // No native review dialog available? Don't bother showing the prefilter.
        if (!(await isNativeReviewAvailable())) return;

        await recordSessionDay();
        const decision = await decideTrigger();
        if (cancelled) return;

        if (decision === "streak") await markStreakShown();
        if (decision !== "none") setVisible(true);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  return { visible, dismiss: () => setVisible(false) };
}
