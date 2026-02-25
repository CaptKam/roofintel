import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors, spacing, radius, typography, formatDriveTime, formatValue } from "@/lib/theme";
import { getQueue, recordAction, NearbyLead, QueueResponse } from "@/lib/api";
import { QueueItem } from "@/components/QueueItem";

export default function QueueScreen() {
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  const fetchQueue = useCallback(async (lat?: number, lng?: number) => {
    try {
      setError(null);
      const data = await getQueue(lat, lng);
      setQueue(data);
    } catch (e: any) {
      setError(e.message || "Failed to load queue");
    }
  }, []);

  const loadLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        await fetchQueue();
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = location.coords;
      setCoords({ latitude, longitude });
      await fetchQueue(latitude, longitude);
    } catch {
      await fetchQueue();
    }
  }, [fetchQueue]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadLocation();
      setLoading(false);
    })();
  }, [loadLocation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadLocation();
    setRefreshing(false);
  }, [loadLocation]);

  const handleComplete = useCallback(
    async (leadId: string) => {
      try {
        await recordAction(leadId, "completed", coords?.latitude, coords?.longitude);
        setQueue((prev) => {
          if (!prev) return prev;
          const filtered = prev.leads.filter((l) => l.id !== leadId);
          return {
            ...prev,
            leads: filtered,
            summary: { ...prev.summary, count: filtered.length },
          };
        });
      } catch {}
    },
    [coords]
  );

  const handleSkip = useCallback(
    async (leadId: string) => {
      try {
        await recordAction(leadId, "skipped", coords?.latitude, coords?.longitude);
        setQueue((prev) => {
          if (!prev) return prev;
          const filtered = prev.leads.filter((l) => l.id !== leadId);
          return {
            ...prev,
            leads: filtered,
            summary: { ...prev.summary, count: filtered.length },
          };
        });
      } catch {}
    },
    [coords]
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.actionBlue} />
          <Text style={styles.loadingText}>Building your queue...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={48} color={colors.alertRed} />
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retryText} onPress={onRefresh}>
            Tap to retry
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const summary = queue?.summary;
  const leads = queue?.leads ?? [];

  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Today's Queue</Text>
          <Text style={styles.headerSubtitle}>
            {leads.length} {leads.length === 1 ? "lead" : "leads"} prioritized
          </Text>
        </View>

        {summary && leads.length > 0 && (
          <View style={styles.summaryCard} data-testid="queue-summary-card">
            <View style={styles.summaryItem}>
              <Ionicons name="location-outline" size={20} color={colors.actionBlue} />
              <Text style={styles.summaryValue}>{summary.count}</Text>
              <Text style={styles.summaryLabel}>Leads</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="car-outline" size={20} color={colors.scoreAmber} />
              <Text style={styles.summaryValue}>
                {summary.totalDriveHours >= 1
                  ? `${summary.totalDriveHours.toFixed(1)}h`
                  : formatDriveTime(summary.totalDriveMin)}
              </Text>
              <Text style={styles.summaryLabel}>Drive Time</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Ionicons name="business-outline" size={20} color={colors.scoreGreen} />
              <Text style={styles.summaryValue}>{formatValue(summary.totalPropertyValue)}</Text>
              <Text style={styles.summaryLabel}>Value</Text>
            </View>
          </View>
        )}

        {leads.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="checkmark-done-circle-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Queue is clear</Text>
            <Text style={styles.emptySubtitle}>
              No leads in your queue right now. Pull down to refresh.
            </Text>
          </View>
        ) : (
          <FlatList
            data={leads}
            keyExtractor={(item) => item.id}
            renderItem={({ item, index }) => (
              <QueueItem
                lead={item}
                index={index}
                onComplete={handleComplete}
                onSkip={handleSkip}
              />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.actionBlue}
              />
            }
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  summaryCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
  },
  summaryValue: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  summaryLabel: {
    ...typography.micro,
    color: colors.textMuted,
  },
  summaryDivider: {
    width: 0.5,
    backgroundColor: colors.borderSubtle,
  },
  listContent: {
    paddingBottom: spacing.xxxl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.alertRed,
    textAlign: "center",
  },
  retryText: {
    ...typography.caption,
    color: colors.actionBlue,
    marginTop: spacing.sm,
  },
  emptyTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
