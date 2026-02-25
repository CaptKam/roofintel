import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, Pressable, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { colors, spacing, radius, typography } from "@/lib/theme";
import { setServerUrl, getServerUrl, testConnection } from "@/lib/api";

const RADIUS_OPTIONS = [1, 3, 5, 10];

export default function SettingsScreen() {
  const [serverUrl, setUrl] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  const [alertRadius, setAlertRadius] = useState(5);
  const [minScore, setMinScore] = useState(50);
  const [stormAlerts, setStormAlerts] = useState(true);
  const [scoreAlerts, setScoreAlerts] = useState(true);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [darkMode, setDarkMode] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    const url = await getServerUrl();
    setUrl(url);
    try {
      const raw = await AsyncStorage.getItem("alert_settings");
      if (raw) {
        const s = JSON.parse(raw);
        setAlertRadius(s.radiusMiles || 5);
        setMinScore(s.minScore || 50);
        setStormAlerts(s.stormAlerts ?? true);
        setScoreAlerts(s.scoreAlerts ?? true);
        setQuietStart(s.quietStart || "22:00");
        setQuietEnd(s.quietEnd || "07:00");
      }
      const profile = await AsyncStorage.getItem("profile");
      if (profile) {
        const p = JSON.parse(profile);
        setName(p.name || "");
        setPhone(p.phone || "");
      }
    } catch {}
  }

  async function saveSettings() {
    await AsyncStorage.setItem("alert_settings", JSON.stringify({
      enabled: true,
      radiusMiles: alertRadius,
      minScore,
      stormAlerts,
      scoreAlerts,
      quietStart,
      quietEnd,
    }));
    await AsyncStorage.setItem("profile", JSON.stringify({ name, phone }));
    Alert.alert("Saved", "Settings updated");
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      await setServerUrl(serverUrl);
      const ok = await testConnection();
      setConnected(ok);
    } catch {
      setConnected(false);
    }
    setTesting(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Settings</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SERVER CONNECTION</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={serverUrl}
              onChangeText={setUrl}
              placeholder="https://your-server.replit.app"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          <View style={styles.connectionRow}>
            <Pressable
              style={({ pressed }) => [styles.testButton, pressed && { opacity: 0.7 }]}
              onPress={handleTestConnection}
            >
              <Text style={styles.testButtonText}>
                {testing ? "Testing..." : "Test Connection"}
              </Text>
            </Pressable>
            {connected !== null && (
              <View style={[styles.statusDot, { backgroundColor: connected ? colors.scoreGreen : colors.alertRed }]} />
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ALERT PREFERENCES</Text>

          <Text style={styles.label}>Alert Radius</Text>
          <View style={styles.radiusRow}>
            {RADIUS_OPTIONS.map(r => (
              <Pressable
                key={r}
                style={[styles.radiusChip, alertRadius === r && styles.radiusChipActive]}
                onPress={() => setAlertRadius(r)}
              >
                <Text style={[styles.radiusChipText, alertRadius === r && styles.radiusChipTextActive]}>
                  {r} mi
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>Minimum Score: {minScore}</Text>
          <View style={styles.scoreRow}>
            <Pressable onPress={() => setMinScore(Math.max(20, minScore - 10))} style={styles.scoreBtn}>
              <Ionicons name="remove" size={18} color={colors.textPrimary} />
            </Pressable>
            <View style={styles.scoreBar}>
              <View style={[styles.scoreFill, { width: `${(minScore / 100) * 100}%` }]} />
            </View>
            <Pressable onPress={() => setMinScore(Math.min(100, minScore + 10))} style={styles.scoreBtn}>
              <Ionicons name="add" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Storm Alerts</Text>
            <Switch
              value={stormAlerts}
              onValueChange={setStormAlerts}
              trackColor={{ false: colors.surfaceHover, true: colors.actionBlue + "60" }}
              thumbColor={stormAlerts ? colors.actionBlue : colors.textMuted}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Score Change Alerts</Text>
            <Switch
              value={scoreAlerts}
              onValueChange={setScoreAlerts}
              trackColor={{ false: colors.surfaceHover, true: colors.actionBlue + "60" }}
              thumbColor={scoreAlerts ? colors.actionBlue : colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>QUIET HOURS</Text>
          <View style={styles.quietRow}>
            <View style={styles.quietInput}>
              <Text style={styles.quietLabel}>Start</Text>
              <TextInput
                style={styles.timeInput}
                value={quietStart}
                onChangeText={setQuietStart}
                placeholder="22:00"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
            <View style={styles.quietInput}>
              <Text style={styles.quietLabel}>End</Text>
              <TextInput
                style={styles.timeInput}
                value={quietEnd}
                onChangeText={setQuietEnd}
                placeholder="07:00"
                placeholderTextColor={colors.textMuted}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROFILE</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={[styles.input, { marginTop: spacing.sm }]}
            value={phone}
            onChangeText={setPhone}
            placeholder="Your phone"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
          />
        </View>

        <Pressable
          style={({ pressed }) => [styles.saveButton, pressed && { opacity: 0.8 }]}
          onPress={saveSettings}
        >
          <Text style={styles.saveButtonText}>Save Settings</Text>
        </Pressable>

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.micro,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  inputRow: {
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },
  connectionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  testButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  testButtonText: {
    ...typography.caption,
    color: colors.actionBlue,
    fontWeight: "600",
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  radiusRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  radiusChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  radiusChipActive: {
    backgroundColor: colors.actionBlue + "20",
    borderColor: colors.actionBlue,
  },
  radiusChipText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  radiusChipTextActive: {
    color: colors.actionBlue,
    fontWeight: "600",
  },
  scoreRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  scoreBtn: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 3,
    overflow: "hidden",
  },
  scoreFill: {
    height: "100%",
    backgroundColor: colors.actionBlue,
    borderRadius: 3,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderSubtle,
  },
  switchLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  quietRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  quietInput: {
    flex: 1,
  },
  quietLabel: {
    ...typography.micro,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  timeInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    ...typography.body,
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: colors.actionBlue,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    marginTop: spacing.md,
  },
  saveButtonText: {
    ...typography.subtitle,
    color: colors.white,
  },
});
