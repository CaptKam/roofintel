import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { useRouter } from "expo-router";
import { ScoreBadge } from "./ScoreBadge";
import { colors, spacing, radius, typography, formatDistance, formatDriveTime, formatValue } from "@/lib/theme";
import { NearbyLead, recordAction } from "@/lib/api";

interface QueueItemProps {
  lead: NearbyLead;
  index: number;
  onComplete: (id: string) => void;
  onSkip: (id: string) => void;
}

function RightAction() {
  return (
    <View style={[styles.swipeAction, styles.completeAction]}>
      <Ionicons name="checkmark-circle" size={28} color={colors.white} />
      <Text style={styles.swipeText}>Complete</Text>
    </View>
  );
}

function LeftAction() {
  return (
    <View style={[styles.swipeAction, styles.skipAction]}>
      <Text style={styles.swipeText}>Skip</Text>
      <Ionicons name="arrow-forward-circle" size={28} color={colors.white} />
    </View>
  );
}

export function QueueItem({ lead, index, onComplete, onSkip }: QueueItemProps) {
  const router = useRouter();

  const handleSwipeRight = () => {
    onComplete(lead.id);
  };

  const handleSwipeLeft = () => {
    onSkip(lead.id);
  };

  return (
    <Swipeable
      renderRightActions={RightAction}
      renderLeftActions={LeftAction}
      onSwipeableRightOpen={handleSwipeRight}
      onSwipeableLeftOpen={handleSwipeLeft}
      overshootRight={false}
      overshootLeft={false}
    >
      <Pressable
        style={styles.container}
        onPress={() => router.push(`/lead/${lead.id}`)}
        data-testid={`queue-item-${lead.id}`}
      >
        <View style={styles.rankBadge}>
          <Text style={styles.rankText}>{index + 1}</Text>
        </View>

        <View style={styles.content}>
          <Text style={styles.address} numberOfLines={1}>
            {lead.address}
          </Text>
          <Text style={styles.city} numberOfLines={1}>
            {lead.city}
          </Text>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <Ionicons name="navigate-outline" size={14} color={colors.textMuted} />
              <Text style={styles.metaText}>{formatDistance(lead.distanceMiles)}</Text>
            </View>

            {lead.estimatedDriveMin !== undefined && (
              <View style={styles.metaItem}>
                <Ionicons name="car-outline" size={14} color={colors.textMuted} />
                <Text style={styles.metaText}>{formatDriveTime(lead.estimatedDriveMin)}</Text>
              </View>
            )}

            {lead.totalValue !== null && lead.totalValue !== undefined && (
              <View style={styles.metaItem}>
                <Ionicons name="business-outline" size={14} color={colors.textMuted} />
                <Text style={styles.metaText}>{formatValue(lead.totalValue)}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.scoreContainer}>
          <ScoreBadge score={lead.leadScore} size="sm" />
        </View>

        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderSubtle,
    gap: spacing.md,
  },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    ...typography.micro,
    color: colors.textSecondary,
    fontSize: 11,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  address: {
    ...typography.subtitle,
    color: colors.textPrimary,
    fontSize: 15,
  },
  city: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  metaText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
  scoreContainer: {
    marginRight: spacing.xs,
  },
  swipeAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 100,
    flexDirection: "row",
    gap: spacing.sm,
  },
  completeAction: {
    backgroundColor: colors.scoreGreen,
  },
  skipAction: {
    backgroundColor: colors.surfaceHover,
  },
  swipeText: {
    ...typography.caption,
    color: colors.white,
    fontWeight: "600",
  },
});
