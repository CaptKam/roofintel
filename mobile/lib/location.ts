import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { checkProximity, updateLocation } from "./api";

let locationSubscription: Location.LocationSubscription | null = null;
let lastCheckTime = 0;
let lastSpeed = 0;

function getCheckInterval(): number {
  if (lastSpeed > 5) return 5 * 60 * 1000;
  return 15 * 60 * 1000;
}

export async function requestPermissions(): Promise<boolean> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== "granted") return false;

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return bgStatus === "granted";
}

export async function startTracking(): Promise<void> {
  if (locationSubscription) return;

  locationSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 100,
      timeInterval: 30000,
    },
    async (location) => {
      const { latitude, longitude, speed, heading } = location.coords;
      const speedMph = speed ? speed * 2.237 : 0;
      lastSpeed = speedMph;

      const now = Date.now();
      const interval = getCheckInterval();

      if (now - lastCheckTime >= interval) {
        lastCheckTime = now;

        try {
          await updateLocation(latitude, longitude, speedMph, heading || undefined);

          const settings = await getAlertSettings();
          if (!settings.enabled) return;

          if (isQuietHours(settings.quietStart, settings.quietEnd)) return;

          const result = await checkProximity(
            latitude,
            longitude,
            settings.radiusMiles,
            settings.minScore
          );

          if (result.leads.length > 0) {
            const lead = result.leads[0];
            await sendLocalNotification(lead);
          }
        } catch (e) {
        }
      }
    }
  );
}

export async function stopTracking(): Promise<void> {
  if (locationSubscription) {
    locationSubscription.remove();
    locationSubscription = null;
  }
}

export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
  } catch {
    return null;
  }
}

interface AlertSettings {
  enabled: boolean;
  radiusMiles: number;
  minScore: number;
  stormAlerts: boolean;
  scoreAlerts: boolean;
  quietStart: string | null;
  quietEnd: string | null;
}

async function getAlertSettings(): Promise<AlertSettings> {
  try {
    const raw = await AsyncStorage.getItem("alert_settings");
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    enabled: true,
    radiusMiles: 5,
    minScore: 50,
    stormAlerts: true,
    scoreAlerts: true,
    quietStart: null,
    quietEnd: null,
  };
}

function isQuietHours(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  if (s <= e) return current >= s && current < e;
  return current >= s || current < e;
}

async function sendLocalNotification(lead: any): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "High-value lead nearby",
      body: `${lead.address} — Score ${lead.leadScore}, ${lead.distanceMiles} mi away`,
      data: { leadId: lead.id },
      sound: "default",
    },
    trigger: null,
  });
}

export async function setupNotifications(): Promise<string | null> {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;

  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}
