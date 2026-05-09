import { useState, useEffect, useRef } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import {
  requestNativeReview, submitFeedback, markRated, markFeedbackSent, markDismissed,
} from "../services/rating";

interface Props {
  visible: boolean;
  userId: string;
  onClose: () => void;
}

type Mode = "prefilter" | "feedback" | "thanks";

export function RatingPrompt({ visible, userId, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("prefilter");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const thanksTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset transient state every time the modal becomes visible so a re-fire
  // (e.g. streak after a prior dismissal) starts in prefilter mode, not in
  // whatever state it was last closed in.
  useEffect(() => {
    if (visible) {
      setMode("prefilter");
      setFeedback("");
      setSubmitting(false);
    }
  }, [visible]);

  // Clean up the thanks-mode auto-dismiss timer on unmount.
  useEffect(() => {
    return () => {
      if (thanksTimerRef.current) clearTimeout(thanksTimerRef.current);
    };
  }, []);

  if (!visible) return null;

  const handleClose = async () => {
    if (thanksTimerRef.current) {
      clearTimeout(thanksTimerRef.current);
      thanksTimerRef.current = null;
    }
    await markDismissed();
    onClose();
  };

  const handleThumbsUp = async () => {
    await markRated();
    await requestNativeReview();
    onClose();
  };

  const handleThumbsDown = () => {
    setMode("feedback");
  };

  const handleSubmitFeedback = async () => {
    if (!feedback.trim() || submitting) return;
    setSubmitting(true);
    const ok = await submitFeedback(feedback, userId);
    setSubmitting(false);
    if (ok) {
      await markFeedbackSent();
      setMode("thanks");
      if (thanksTimerRef.current) clearTimeout(thanksTimerRef.current);
      thanksTimerRef.current = setTimeout(() => {
        thanksTimerRef.current = null;
        onClose();
      }, 1500);
    }
    // On failure, stay in feedback mode so user can retry.
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={10}>
            <Ionicons name="close" size={20} color={COLORS.muted} />
          </TouchableOpacity>

          {mode === "prefilter" && (
            <>
              <Text style={styles.title}>Is NearMe earning its keep?</Text>
              <Text style={styles.body}>Honest answer — it helps us tune what you see.</Text>
              <View style={styles.thumbsRow}>
                <TouchableOpacity style={styles.thumbBtn} onPress={handleThumbsDown} activeOpacity={0.75}>
                  <Ionicons name="thumbs-down-outline" size={26} color={COLORS.muted} style={{ marginBottom: 6 }} />
                  <Text style={styles.thumbLabel}>Not really</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.thumbBtn, styles.thumbBtnUp]} onPress={handleThumbsUp} activeOpacity={0.75}>
                  <Ionicons name="thumbs-up" size={26} color={COLORS.accent} style={{ marginBottom: 6 }} />
                  <Text style={[styles.thumbLabel, styles.thumbLabelUp]}>Loving it</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {mode === "feedback" && (
            <>
              <Text style={styles.title}>What's not working?</Text>
              <Text style={styles.body}>We read every message — it goes straight to the founder.</Text>
              <TextInput
                style={styles.input}
                placeholder="Tell us what would make NearMe better…"
                placeholderTextColor={COLORS.muted}
                value={feedback}
                onChangeText={setFeedback}
                multiline
                numberOfLines={4}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.submitBtn, (!feedback.trim() || submitting) && styles.submitBtnDisabled]}
                onPress={handleSubmitFeedback}
                disabled={!feedback.trim() || submitting}
              >
                <Text style={styles.submitBtnText}>{submitting ? "Sending…" : "Send feedback"}</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === "thanks" && (
            <>
              <Text style={styles.title}>Got it — thank you</Text>
              <Text style={styles.body}>We read every note. Already on it.</Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,15,26,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.md,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 20,
    lineHeight: 20,
  },
  thumbsRow: {
    flexDirection: "row",
    gap: 12,
  },
  thumbBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.cardAlt,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  thumbBtnUp: {
    backgroundColor: COLORS.accent + "20",
    borderColor: COLORS.accent,
  },
  thumbLabel: { fontSize: 13, fontWeight: "700", color: COLORS.muted },
  thumbLabelUp: { color: COLORS.accent },
  input: {
    minHeight: 100,
    backgroundColor: COLORS.cardAlt,
    borderRadius: RADIUS.md,
    padding: 12,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
