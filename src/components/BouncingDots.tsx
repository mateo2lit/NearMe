import { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, Easing } from "react-native";
import { COLORS } from "../constants/theme";

interface Props {
  color?: string;
  size?: number;
}

export function BouncingDots({ color = COLORS.accent, size = 8 }: Props) {
  const v1 = useRef(new Animated.Value(0)).current;
  const v2 = useRef(new Animated.Value(0)).current;
  const v3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: 1, duration: 380, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 380, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay(Math.max(0, 760 - delay)),
        ])
      );
    const a = anim(v1, 0);
    const b = anim(v2, 150);
    const c = anim(v3, 300);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [v1, v2, v3]);

  const dotStyle = (val: Animated.Value) => ({
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
    transform: [
      { translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
    ],
    opacity: val.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }),
  });

  return (
    <View style={[styles.row, { height: size + 8 }]}>
      <Animated.View style={dotStyle(v1)} />
      <Animated.View style={dotStyle(v2)} />
      <Animated.View style={dotStyle(v3)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
});
