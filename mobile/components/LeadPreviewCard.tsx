import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, typography, getScoreColor, formatValue } from "@/lib/theme";
import { ScoreBadge } from "@/components/ScoreBadge";
import type { NearbyLead } from "@/lib/api";

interface LeadPreviewCardProps {
  lead: NearbyLead;
  onClose: () => void;
}

export function LeadPreviewCard({ lead, onClose }: LeadPreviewCardProps) {
  const router = useRouter();

  const handleNavigate = () => {
    const scheme = Platform.select({
      ios: `maps:0,0?q=${lead.latitude},${lead.longitude}`,
      android: `geo:${lead.latitude},${lead.longitude}?q=${lead.latitude},${lead.longitude}(${encodeURIComponent(lead.address)})`,
    });
    if (scheme) Linking.openURL(scheme);
  };

  const handleDetails = () => {
    router.push(`/lead/${lead.id}`);
  };

  return (
    <View style={styles.container}>
      <View style={styles.handle} />
      <TouchableOpacity style={styles.closeBtn} onPress={onClose} data-testid="button-close-preview">
        <Ionicons name="close" size={20} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.header}>
        <ScoreBadge score={lead.leadScore} size="lg" />
        <View style={styles.headerText}>
          <Text style={styles.address} numberOfLines={2} data-testid="text-lead-address">
            {lead.address}
          </Text>
          <Text style={styles.city} data-testid="text-lead-city">{lead.city}</Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Ionicons name="home-outline" size={16} color={colors.textMuted} />
          <Text style={styles.statLabel}>Roof Area</Text>
          <Text style={styles.statValue}>
            {lead.estimatedRoofArea ? `${lead.estimatedRoofArea.toLocaleString()} sqft` : "N/A"}
          </Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="person-outline" size={16} color={colors.textMuted} />
          <Text style={styles.statLabel}>Owner</Text>
          <Text style={styles.statValue} numberOfLines={1}>{lead.ownerName || "Unknown"}</Text>
        </View>
        {lead.totalValue ? (
          <View style={styles.stat}>
            <Ionicons name="cash-outline" size={16} color={colors.textMuted} />
            <Text style={styles.statLabel}>Value</Text>
            <Text style={styles.statValue}>{formatValue(lead.totalValue)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.navigateBtn]}
          onPress={handleNavigate}
          data-testid="button-navigate"
        >
          <Ionicons name="navigate" size={18} color={colors.white} />
          <Text style={styles.navigateBtnText}>Navigate</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.detailsBtn]}
          onPress={handleDetails}
          data-testid="button-details"
        >
          <Ionicons name="document-text-outline" size={18} color={colors.actionBlue} />
          <Text style={styles.detailsBtnText}>Details</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    paddingTop: spacing.md,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.surfaceHover,
    borderRadius: radius.full,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  closeBtn: {
    position: "absolute",
    top: spacing.md,
    right: spacing.lg,
    padding: spacing.xs,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerText: {
    flex: 1,
  },
  address: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  city: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stats: {
    flexDirection: "row",
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  statLabel: {
    ...typography.micro,
    color: colors.textMuted,
  },
  statValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "600",
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  navigateBtn: {
    backgroundColor: colors.actionBlue,
  },
  navigateBtnText: {
    ...typography.subtitle,
    color: colors.white,
  },
  detailsBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsBtnText: {
    ...typography.subtitle,
    color: colors.actionBlue,
  },
});
