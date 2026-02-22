export interface SourceTrustEntry {
  name: string;
  baseScore: number;
  type: "API" | "HTML" | "PDF" | "MANUAL";
  category: "government" | "corporate_registry" | "official_website" | "cre_listing" | "directory" | "aggregator" | "public_record" | "user_input";
  description: string;
}

export const SOURCE_TRUST: Record<string, SourceTrustEntry> = {
  "DCAD ArcGIS": {
    name: "DCAD ArcGIS",
    baseScore: 95,
    type: "API",
    category: "government",
    description: "Dallas Central Appraisal District official property records",
  },
  "TX Comptroller PIR": {
    name: "TX Comptroller PIR",
    baseScore: 92,
    type: "API",
    category: "government",
    description: "Texas Comptroller Public Information Request for franchise tax/entity data",
  },
  "TX Comptroller Sales Tax": {
    name: "TX Comptroller Sales Tax",
    baseScore: 88,
    type: "API",
    category: "government",
    description: "Texas Comptroller sales tax permit records via TX Open Data Portal",
  },
  "TX SOS": {
    name: "TX SOS",
    baseScore: 90,
    type: "API",
    category: "corporate_registry",
    description: "Texas Secretary of State filing records",
  },
  "TREC License": {
    name: "TREC License",
    baseScore: 88,
    type: "API",
    category: "government",
    description: "Texas Real Estate Commission license lookup",
  },
  "TDLR License": {
    name: "TDLR License",
    baseScore: 88,
    type: "API",
    category: "government",
    description: "Texas Department of Licensing and Regulation records",
  },
  "Property Tax Records": {
    name: "Property Tax Records",
    baseScore: 90,
    type: "API",
    category: "government",
    description: "County property tax mailing address records",
  },
  "HUD Multifamily": {
    name: "HUD Multifamily",
    baseScore: 92,
    type: "API",
    category: "government",
    description: "HUD multifamily housing database",
  },
  "NOAA SWDI": {
    name: "NOAA SWDI",
    baseScore: 95,
    type: "API",
    category: "government",
    description: "NOAA Severe Weather Data Inventory for hail events",
  },
  "Google Places": {
    name: "Google Places",
    baseScore: 75,
    type: "API",
    category: "directory",
    description: "Google Places API for business information",
  },
  "Google Business": {
    name: "Google Business",
    baseScore: 72,
    type: "API",
    category: "directory",
    description: "Google Business Profile data",
  },
  "OpenCorporates": {
    name: "OpenCorporates",
    baseScore: 70,
    type: "API",
    category: "aggregator",
    description: "OpenCorporates corporate entity database",
  },
  "BBB Direct": {
    name: "BBB Direct",
    baseScore: 65,
    type: "HTML",
    category: "directory",
    description: "Better Business Bureau direct lookup",
  },
  "Serper Web Search": {
    name: "Serper Web Search",
    baseScore: 45,
    type: "API",
    category: "aggregator",
    description: "Serper search API for general web research",
  },
  "TCEQ": {
    name: "TCEQ",
    baseScore: 85,
    type: "API",
    category: "government",
    description: "Texas Commission on Environmental Quality records",
  },
  "Dallas Building Permits": {
    name: "Dallas Building Permits",
    baseScore: 90,
    type: "API",
    category: "government",
    description: "City of Dallas building permit records",
  },
  "Fort Worth Building Permits": {
    name: "Fort Worth Building Permits",
    baseScore: 90,
    type: "API",
    category: "government",
    description: "City of Fort Worth building permit records",
  },
  "Dallas 311": {
    name: "Dallas 311",
    baseScore: 85,
    type: "API",
    category: "government",
    description: "City of Dallas 311 code violations",
  },
  "WHOIS/RDAP": {
    name: "WHOIS/RDAP",
    baseScore: 55,
    type: "API",
    category: "public_record",
    description: "Domain registration records",
  },
  "LLC Chain": {
    name: "LLC Chain",
    baseScore: 85,
    type: "API",
    category: "corporate_registry",
    description: "Multi-level LLC chain tracing through TX SOS/Comptroller",
  },
  "Skip Trace": {
    name: "Skip Trace",
    baseScore: 60,
    type: "API",
    category: "aggregator",
    description: "Multi-source skip trace agent",
  },
  "Web Research": {
    name: "Web Research",
    baseScore: 50,
    type: "HTML",
    category: "official_website",
    description: "Direct website scraping for contact information",
  },
  "Email Discovery": {
    name: "Email Discovery",
    baseScore: 55,
    type: "API",
    category: "aggregator",
    description: "Email pattern matching and MX verification",
  },
  "Court Records": {
    name: "Court Records",
    baseScore: 80,
    type: "API",
    category: "government",
    description: "Public court record filings",
  },
  "Reverse Address": {
    name: "Reverse Address",
    baseScore: 65,
    type: "API",
    category: "directory",
    description: "Reverse address lookup via Google Places",
  },
  "Social Intel": {
    name: "Social Intel",
    baseScore: 55,
    type: "API",
    category: "aggregator",
    description: "Social intelligence pipeline for LinkedIn/professional profiles",
  },
  "Manual Entry": {
    name: "Manual Entry",
    baseScore: 80,
    type: "MANUAL",
    category: "user_input",
    description: "Manually entered by user/admin",
  },
  "CAD CSV Import": {
    name: "CAD CSV Import",
    baseScore: 88,
    type: "API",
    category: "government",
    description: "County Appraisal District CSV property records",
  },
  "Xweather": {
    name: "Xweather",
    baseScore: 90,
    type: "API",
    category: "aggregator",
    description: "Xweather/Vaisala predictive hail data",
  },
};

export function getSourceTrust(sourceName: string): SourceTrustEntry {
  const normalized = Object.keys(SOURCE_TRUST).find(
    (k) => k.toLowerCase() === sourceName.toLowerCase()
  );
  if (normalized && SOURCE_TRUST[normalized]) {
    return SOURCE_TRUST[normalized];
  }
  return {
    name: sourceName,
    baseScore: 40,
    type: "API",
    category: "aggregator",
    description: `Unknown source: ${sourceName}`,
  };
}

export function computeEvidenceScore(params: {
  sourceTrustScore: number;
  recencyFactor: number;
  corroborationCount: number;
  domainMatchFactor: number;
  extractionQuality: number;
}): number {
  const { sourceTrustScore, recencyFactor, corroborationCount, domainMatchFactor, extractionQuality } = params;
  const corroborationBonus = Math.min(corroborationCount - 1, 3) * 5;
  const domainBonus = domainMatchFactor * 15;
  const base = sourceTrustScore * recencyFactor * extractionQuality;
  return Math.round(Math.min(base + corroborationBonus + domainBonus, 100));
}

export function computeRecencyFactor(extractedAt: Date): number {
  const now = new Date();
  const daysSince = (now.getTime() - extractedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 30) return 1.0;
  if (daysSince < 90) return 0.95;
  if (daysSince < 180) return 0.85;
  if (daysSince < 365) return 0.7;
  return 0.5;
}

export const CONFLICT_AUTO_RESOLVE_MARGIN = 15;
