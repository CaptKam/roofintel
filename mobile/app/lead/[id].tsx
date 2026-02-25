import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Image, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { colors, spacing, radius, typography, getScoreColor, formatValue, formatDistance } from "@/lib/theme";
import { getLeadSummary, recordAction, type LeadSummary } from "@/lib/api";
import { ScoreBadge } from "@/components/ScoreBadge";

const ACTIONS = [
  { key: "called", label: "Called", icon: "call" as const, color: colors.scoreGreen },
  { key: "knocked", label: "Knocked", icon: "hand-left" as const, color: colors.actionBlue },
  { key: "left_card", label: "Card", icon: "card" as const, color: colors.scoreAmber },
  { key: "scheduled", label: "Scheduled", icon: "calendar" as const, color: colors.stormPurple },
  { key: "not_interested", label: "Skip", icon: "close-circle" as const, color: colors.textMuted },
];

function InfoRow({ icon, label, value }: { icon: string; label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon as any} size={16} color={colors.textMuted} />
      <View style={styles.infoContent}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<LeadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      getLeadSummary(id)
        .then(setLead)
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [id]);

  const handleCall = useCallback(() => {
    const phone = lead?.phone;
    if (!phone) {
      Alert.alert("No Phone", "No phone number available for this lead");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL(`tel:${phone.replace(/[^\d+]/g, "")}`);
  }, [lead]);

  const handleNavigate = useCallback(() => {
    if (!lead) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const url = `https://maps.apple.com/?daddr=${lead.latitude},${lead.longitude}`;
    Linking.openURL(url);
  }, [lead]);

  const handleAction = useCallback(async (action: string) => {
    if (!id || actionLoading) return;
    setActionLoading(action);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await recordAction(id, action);
      Alert.alert("Done", `Marked as "${action.replace("_", " ")}"`);
      router.back();
    } catch {
      Alert.alert("Error", "Failed to record action");
    }
    setActionLoading(null);
  }, [id, actionLoading, router]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.actionBlue} size="large" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (!lead) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorState}>
          <Text style={styles.errorText}>Lead not found</Text>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const satelliteUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lead.longitude - 0.001},${lead.latitude - 0.0007},${lead.longitude + 0.001},${lead.latitude + 0.0007}&size=800,400&f=image&format=jpg`;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.dragHandle} />

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: satelliteUrl }} style={styles.satelliteImage} resizeMode="cover" />

        <View style={styles.headerSection}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.address}>{lead.address}</Text>
              <Text style={styles.city}>{lead.city}, {lead.state} {lead.zipCode}</Text>
            </View>
            <ScoreBadge score={lead.leadScore} size="lg" />
          </View>
        </View>

        <View style={styles.mainActions}>
          <Pressable
            style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.8 }]}
            onPress={handleCall}
          >
            <Ionicons name="call" size={20} color={colors.white} />
            <View>
              <Text style={styles.callButtonText}>
                {lead.phone || "No phone"}
              </Text>
              <Text style={styles.callButtonSub}>{lead.primaryContact}</Text>
            </View>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.navButton, pressed && { opacity: 0.8 }]}
            onPress={handleNavigate}
          >
            <Ionicons name="navigate" size={20} color={colors.actionBlue} />
          </Pressable>
        </View>

        <View style={styles.intelGrid}>
          <View style={styles.intelItem}>
            <Text style={styles.intelValue}>
              {lead.estimatedRoofArea ? `${lead.estimatedRoofArea.toLocaleString()}` : "—"}
            </Text>
            <Text style={styles.intelLabel}>Roof sqft</Text>
          </View>
          <View style={styles.intelItem}>
            <Text style={styles.intelValue}>
              {lead.roofAge ? `${lead.roofAge}yr` : "—"}
            </Text>
            <Text style={styles.intelLabel}>Roof Age</Text>
          </View>
          <View style={styles.intelItem}>
            <Text style={[styles.intelValue, lead.hailEvents > 0 && { color: colors.scoreAmber }]}>
              {lead.hailEvents || 0}
            </Text>
            <Text style={styles.intelLabel}>Hail Events</Text>
          </View>
          <View style={styles.intelItem}>
            <Text style={styles.intelValue}>
              {lead.totalValue ? formatValue(lead.totalValue) : "—"}
            </Text>
            <Text style={styles.intelLabel}>Value</Text>
          </View>
        </View>

        <View style={styles.detailSection}>
          <InfoRow icon="business" label="Owner" value={lead.ownerName} />
          <InfoRow icon="layers" label="Type" value={lead.ownerType} />
          <InfoRow icon="home" label="Roof Type" value={lead.roofType} />
          <InfoRow icon="calendar" label="Last Hail" value={
            lead.lastHailDate
              ? `${lead.lastHailDate} (${lead.lastHailSize}" hail)`
              : null
          } />
          <InfoRow icon="shield-checkmark" label="Claim Window" value={
            lead.claimWindowOpen ? "Open" : lead.claimWindowOpen === false ? "Closed" : null
          } />
          <InfoRow icon="grid" label="Structure" value={lead.ownershipStructure} />
        </View>

        <View style={styles.actionSection}>
          <Text style={styles.actionTitle}>FIELD ACTION</Text>
          <View style={styles.actionRow}>
            {ACTIONS.map(a => (
              <Pressable
                key={a.key}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { borderColor: a.color },
                  pressed && { backgroundColor: a.color + "20" },
                ]}
                onPress={() => handleAction(a.key)}
                disabled={!!actionLoading}
              >
                {actionLoading === a.key ? (
                  <ActivityIndicator size="small" color={a.color} />
                ) : (
                  <Ionicons name={a.icon} size={18} color={a.color} />
                )}
                <Text style={[styles.actionLabel, { color: a.color }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ height: spacing.xxxl * 2 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  dragHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.surfaceHover,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  satelliteImage: {
    width: "100%",
    height: 200,
    backgroundColor: colors.surface,
  },
  headerSection: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  address: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  city: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  mainActions: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xl,
  },
  callButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.scoreGreen,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  callButtonText: {
    ...typography.body,
    fontWeight: "600",
    color: colors.white,
  },
  callButtonSub: {
    ...typography.micro,
    color: colors.white,
    opacity: 0.8,
    textTransform: "none",
  },
  navButton: {
    backgroundColor: colors.actionBlue + "20",
    borderRadius: radius.md,
    width: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  intelGrid: {
    flexDirection: "row",
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  intelItem: {
    flex: 1,
    alignItems: "center",
  },
  intelValue: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  intelLabel: {
    ...typography.micro,
    color: colors.textMuted,
    marginTop: 2,
  },
  detailSection: {
    marginHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderSubtle,
  },
  infoContent: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  infoLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  infoValue: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: "500",
  },
  actionSection: {
    marginHorizontal: spacing.xl,
  },
  actionTitle: {
    ...typography.micro,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.md,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    ...typography.subtitle,
    color: colors.textSecondary,
  },
  backButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  backButtonText: {
    ...typography.caption,
    color: colors.actionBlue,
  },
});
