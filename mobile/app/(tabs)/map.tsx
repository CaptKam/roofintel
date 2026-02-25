import { useEffect, useState, useRef, useCallback } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { colors, getScoreColor, typography, spacing } from "@/lib/theme";
import { checkProximity, type NearbyLead } from "@/lib/api";
import { LeadPreviewCard } from "@/components/LeadPreviewCard";

const DEFAULT_REGION = {
  latitude: 32.7767,
  longitude: -96.797,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export default function MapScreen() {
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [leads, setLeads] = useState<NearbyLead[]>([]);
  const [selectedLead, setSelectedLead] = useState<NearbyLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission required");
        setLoading(false);
        return;
      }

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation(loc);
        fetchLeads(loc.coords.latitude, loc.coords.longitude);
      } catch {
        setError("Could not get location");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const fetchLeads = useCallback(async (lat: number, lng: number) => {
    try {
      const result = await checkProximity(lat, lng, 10, 0);
      setLeads(result.leads || []);
    } catch {
      setLeads([]);
    }
  }, []);

  const handleMarkerPress = useCallback((lead: NearbyLead) => {
    setSelectedLead(lead);
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.actionBlue} />
        <Text style={styles.loadingText}>Getting location...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  const region = location
    ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }
    : DEFAULT_REGION;

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton
        userInterfaceStyle="dark"
        onPress={() => setSelectedLead(null)}
        data-testid="map-view"
      >
        {leads.map((lead) => (
          <Marker
            key={lead.id}
            coordinate={{
              latitude: lead.latitude,
              longitude: lead.longitude,
            }}
            pinColor={getScoreColor(lead.leadScore)}
            onPress={() => handleMarkerPress(lead)}
            data-testid={`marker-lead-${lead.id}`}
          />
        ))}
      </MapView>

      {selectedLead && (
        <LeadPreviewCard
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  map: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.body,
    color: colors.alertRed,
  },
});
