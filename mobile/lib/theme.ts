export const colors = {
  bg: "#0A0A0B",
  surface: "#18181B",
  surfaceElevated: "#27272A",
  surfaceHover: "#3F3F46",
  border: "#3F3F46",
  borderSubtle: "#27272A",

  textPrimary: "#FAFAFA",
  textSecondary: "#A1A1AA",
  textMuted: "#71717A",

  scoreGreen: "#10B981",
  scoreAmber: "#F59E0B",
  scoreOrange: "#F97316",
  scoreCold: "#6B7280",

  alertRed: "#EF4444",
  stormPurple: "#A855F7",
  actionBlue: "#3B82F6",
  locationBlue: "#60A5FA",

  white: "#FFFFFF",
  black: "#000000",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
};

export const typography = {
  hero: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: "600" as const, letterSpacing: -0.3 },
  subtitle: { fontSize: 16, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  caption: { fontSize: 13, fontWeight: "400" as const },
  micro: { fontSize: 11, fontWeight: "500" as const, letterSpacing: 0.3, textTransform: "uppercase" as const },
};

export function getScoreColor(score: number): string {
  if (score >= 80) return colors.scoreGreen;
  if (score >= 60) return colors.scoreAmber;
  if (score >= 40) return colors.scoreOrange;
  return colors.scoreCold;
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "< 0.1 mi";
  return `${miles.toFixed(1)} mi`;
}

export function formatDriveTime(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
}

export function formatValue(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}
