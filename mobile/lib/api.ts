import AsyncStorage from "@react-native-async-storage/async-storage";

const DEFAULT_SERVER = "https://your-roofintel-server.replit.app";

let cachedServerUrl: string | null = null;

export async function getServerUrl(): Promise<string> {
  if (cachedServerUrl) return cachedServerUrl;
  const stored = await AsyncStorage.getItem("server_url");
  cachedServerUrl = stored || DEFAULT_SERVER;
  return cachedServerUrl;
}

export async function setServerUrl(url: string): Promise<void> {
  cachedServerUrl = url.replace(/\/$/, "");
  await AsyncStorage.setItem("server_url", cachedServerUrl);
}

async function api<T>(
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface LeadSummary {
  id: string;
  address: string;
  city: string;
  county: string;
  state: string;
  zipCode: string;
  latitude: number;
  longitude: number;
  sqft: number;
  yearBuilt: number;
  leadScore: number;
  ownerName: string;
  ownerType: string;
  ownerPhone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  estimatedRoofArea: number | null;
  roofType: string | null;
  roofLastReplaced: number | null;
  totalValue: number | null;
  hailEvents: number;
  lastHailDate: string | null;
  lastHailSize: number | null;
  claimWindowOpen: boolean | null;
  status: string;
  roofAge: number | null;
  phone: string | null;
  primaryContact: string;
  ownershipStructure: string | null;
  decisionMakers: any[] | null;
}

export interface NearbyLead {
  id: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  leadScore: number;
  ownerName: string;
  ownerPhone: string | null;
  contactPhone: string | null;
  contactName: string | null;
  estimatedRoofArea: number | null;
  yearBuilt: number;
  totalValue: number | null;
  hailEvents: number;
  lastHailDate: string | null;
  lastHailSize: number | null;
  roofType: string | null;
  distanceMiles: number;
  estimatedDriveMin?: number;
}

export interface QueueResponse {
  leads: NearbyLead[];
  summary: {
    count: number;
    totalDriveMin: number;
    totalDriveHours: number;
    totalPropertyValue: number;
  };
}

export interface ProximityResponse {
  leads: NearbyLead[];
  count: number;
}

export interface StormRun {
  id: string;
  maxHailProb: number;
  maxSevereProb: number;
  radarSignatureCount: number;
  affectedLeadCount: number;
  status: string;
  detectedAt: string;
  swathPolygon: any;
}

export async function checkProximity(
  latitude: number,
  longitude: number,
  radiusMiles: number = 5,
  minScore: number = 50,
  userId: string = "default"
): Promise<ProximityResponse> {
  return api("POST", "/api/chase/check-proximity", {
    latitude,
    longitude,
    radiusMiles,
    minScore,
    userId,
  });
}

export async function updateLocation(
  latitude: number,
  longitude: number,
  speedMph?: number,
  heading?: number,
  userId: string = "default"
): Promise<void> {
  await api("POST", "/api/chase/update-location", {
    latitude,
    longitude,
    speedMph,
    heading,
    userId,
  });
}

export async function registerDevice(
  pushToken: string,
  platform: string,
  userId: string = "default"
): Promise<void> {
  await api("POST", "/api/chase/register-device", {
    pushToken,
    platform,
    userId,
  });
}

export async function getQueue(
  latitude?: number,
  longitude?: number,
  userId: string = "default"
): Promise<QueueResponse> {
  const params = new URLSearchParams({ userId });
  if (latitude) params.set("latitude", String(latitude));
  if (longitude) params.set("longitude", String(longitude));
  return api("GET", `/api/chase/queue?${params}`);
}

export async function recordAction(
  leadId: string,
  action: string,
  latitude?: number,
  longitude?: number,
  notes?: string,
  userId: string = "default"
): Promise<void> {
  await api("POST", "/api/chase/action", {
    leadId,
    action,
    latitude,
    longitude,
    notes,
    userId,
  });
}

export async function getLeadSummary(leadId: string): Promise<LeadSummary> {
  return api("GET", `/api/chase/lead/${leadId}/summary`);
}

export async function getStormRuns(): Promise<StormRun[]> {
  return api("GET", "/api/storm/runs");
}

export async function getActiveStormRuns(): Promise<StormRun[]> {
  return api("GET", "/api/storm/runs/active");
}

export async function testConnection(): Promise<boolean> {
  try {
    await api("GET", "/api/storm/status");
    return true;
  } catch {
    return false;
  }
}
