import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/lib/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 0.5,
          height: 84,
          paddingBottom: 28,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.actionBlue,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="map"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "compass" : "compass-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="queue"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "list" : "list-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "thunderstorm" : "thunderstorm-outline"} size={26} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "settings" : "settings-outline"} size={26} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
