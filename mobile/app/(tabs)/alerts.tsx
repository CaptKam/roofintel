import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, RefreshControl, Pressable, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, typography, formatValue } from "@/lib/theme";
import { getActiveStormRuns, getStormRuns, type StormRun } from "@/lib/api";

function StormCard({ storm, onChase }: { storm: StormRun; onChase: () => void }) {
  const isPredicted = storm.status === "predicted";
  const severity = storm.maxSevereProb >= 50 ? "high" : storm.maxHailProb >= 60 ? "medium" : "low";
  const borderColor = severity === "high" ? colors.alertRed : severity === "medium" ? colors.scoreOrange : colors.scoreAmber;
  const timeAgo = storm.detectedAt
    ? formatTimeAgo(new Date(storm.detectedAt))
    : "Unknown";

  return (
    <View style={[styles.stormCard, { borderLeftColor: borderColor }]}>
      <View style={styles.stormHeader}>
        <View style={styles.stormBadge}>
          <Ionicons
            name={isPredicted ? "eye-outline" : "thunderstorm"}
            size={16}
            color={isPredicted ? colors.stormPurple : borderColor}
          />
          <Text style={[styles.stormType, { color: isPredicted ? colors.stormPurple : borderColor }]}>
            {isPredicted ? "Predicted" : "Detected"}
          </Text>
        </View>
        <Text style={styles.stormTime}>{timeAgo}</Text>
      </View>

      <View style={styles.stormStats}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{storm.maxHailProb}%</Text>
          <Text style={styles.statLabel}>Hail Prob</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{storm.maxSevereProb}%</Text>
          <Text style={styles.statLabel}>Severe</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{storm.radarSignatureCount}</Text>
          <Text style={styles.statLabel}>Signatures</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, storm.affectedLeadCount > 0 && { color: colors.scoreAmber }]}>
            {storm.affectedLeadCount}
          </Text>
          <Text style={styles.statLabel}>Leads</Text>
        </View>
      </View>

      {storm.affectedLeadCount > 0 && (
        <Pressable
          style={({ pressed }) => [styles.chaseButton, pressed && styles.chaseButtonPressed]}
          onPress={onChase}
        >
          <Ionicons name="navigate" size={16} color={colors.white} />
          <Text style={styles.chaseButtonText}>Chase This Storm</Text>
        </Pressable>
      )}
    </View>
  );
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AlertsScreen() {
  const router = useRouter();
  const [storms, setStorms] = useState<StormRun[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchStorms = useCallback(async () => {
    try {
      const [active, all] = await Promise.all([
        getActiveStormRuns().catch(() => []),
        getStormRuns().catch(() => []),
      ]);
      const combined = [...active];
      const activeIds = new Set(active.map(s => s.id));
      for (const s of all) {
        if (!activeIds.has(s.id)) combined.push(s);
      }
      combined.sort((a, b) =>
        new Date(b.detectedAt || 0).getTime() - new Date(a.detectedAt || 0).getTime()
      );
      setStorms(combined.slice(0, 20));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStorms();
    const interval = setInterval(fetchStorms, 30000);
    return () => clearInterval(interval);
  }, [fetchStorms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStorms();
    setRefreshing(false);
  }, [fetchStorms]);

  const activeCount = storms.filter(s => s.status === "active" || s.status === "predicted").length;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Storm Alerts</Text>
        {activeCount > 0 && (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{activeCount} active</Text>
          </View>
        )}
      </View>

      {storms.length === 0 && !loading ? (
        <View style={styles.emptyState}>
          <Ionicons name="sunny-outline" size={48} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No active storms</Text>
          <Text style={styles.emptySubtitle}>You'll be notified when one hits your area</Text>
        </View>
      ) : (
        <FlatList
          data={storms}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <StormCard
              storm={item}
              onChase={() => {
                router.push("/(tabs)/map");
              }}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textSecondary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  activeBadge: {
    backgroundColor: colors.alertRed + "20",
    borderColor: colors.alertRed,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  activeBadgeText: {
    ...typography.micro,
    color: colors.alertRed,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  stormCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 3,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  stormHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  stormBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  stormType: {
    ...typography.caption,
    fontWeight: "600",
  },
  stormTime: {
    ...typography.caption,
    color: colors.textMuted,
  },
  stormStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  statItem: {
    alignItems: "center",
  },
  statValue: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.micro,
    color: colors.textMuted,
    marginTop: 2,
  },
  chaseButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.actionBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  chaseButtonPressed: {
    opacity: 0.8,
  },
  chaseButtonText: {
    ...typography.caption,
    fontWeight: "600",
    color: colors.white,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 100,
  },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  emptySubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
