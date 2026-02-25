import { View, Text, StyleSheet } from "react-native";
import { colors, getScoreColor, radius } from "@/lib/theme";

interface ScoreBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ score, size = "md" }: ScoreBadgeProps) {
  const color = getScoreColor(score);
  const dim = size === "lg" ? 48 : size === "sm" ? 28 : 36;
  const fontSize = size === "lg" ? 18 : size === "sm" ? 12 : 15;

  return (
    <View style={[styles.badge, { width: dim, height: dim, backgroundColor: color + "20", borderColor: color }]}>
      <Text style={[styles.text, { fontSize, color }]}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontWeight: "700",
  },
});
