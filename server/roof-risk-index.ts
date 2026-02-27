import { db } from "./storage";
import { leads } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

interface RoofLifespan {
  material: string;
  minYears: number;
  maxYears: number;
  avgYears: number;
}

const ROOF_LIFESPANS: Record<string, RoofLifespan> = {
  "Built-Up (BUR)": { material: "Built-Up (BUR)", minYears: 20, maxYears: 30, avgYears: 25 },
  "EPDM": { material: "EPDM", minYears: 20, maxYears: 25, avgYears: 22 },
  "TPO": { material: "TPO", minYears: 15, maxYears: 20, avgYears: 17 },
  "Metal": { material: "Metal", minYears: 25, maxYears: 35, avgYears: 30 },
  "Shingle": { material: "Shingle", minYears: 15, maxYears: 25, avgYears: 20 },
  "Modified Bitumen": { material: "Modified Bitumen", minYears: 15, maxYears: 20, avgYears: 17 },
  "Flat": { material: "Flat", minYears: 15, maxYears: 25, avgYears: 20 },
};

const DEFAULT_LIFESPAN: RoofLifespan = { material: "Unknown", minYears: 18, maxYears: 25, avgYears: 22 };

export function getRoofLifespan(roofType: string | null | undefined): RoofLifespan {
  if (!roofType) return DEFAULT_LIFESPAN;
  return ROOF_LIFESPANS[roofType] || DEFAULT_LIFESPAN;
}

export interface RoofRiskResult {
  score: number;
  tier: "Low" | "Moderate" | "High" | "Critical";
  exposureWindow: string;
  roofAgeSource?: "record" | "permit" | "naip_imagery" | "year_built" | "default";
  breakdown: {
    ageRisk: { score: number; max: number; detail: string };
    stormRisk: { score: number; max: number; detail: string };
    permitSilence: { score: number; max: number; detail: string };
    climateStress: { score: number; max: number; detail: string };
    portfolioConcentration: { score: number; max: number; detail: string };
  };
}

export interface PortfolioInfo {
  propertyCount: number;
  yearBuiltArray: number[];
  roofTypes: string[];
}

function getTier(score: number): "Low" | "Moderate" | "High" | "Critical" {
  if (score >= 81) return "Critical";
  if (score >= 61) return "High";
  if (score >= 31) return "Moderate";
  return "Low";
}

function computeExposureWindow(estimatedAge: number, lifespan: RoofLifespan): string {
  const yearsRemaining = lifespan.maxYears - estimatedAge;
  const yearsRemainingMin = lifespan.minYears - estimatedAge;

  if (yearsRemainingMin <= 0 && yearsRemaining <= 0) {
    return `Past expected lifespan (${lifespan.material} rated ${lifespan.minYears}–${lifespan.maxYears} yrs). Replacement overdue.`;
  }
  if (yearsRemainingMin <= 0) {
    const monthsMax = Math.max(yearsRemaining * 12, 0);
    return `In active replacement window now — 0 to ${monthsMax} months remaining (${lifespan.material}).`;
  }
  const monthsMin = yearsRemainingMin * 12;
  const monthsMax = yearsRemaining * 12;
  return `Estimated ${monthsMin}–${monthsMax} months to replacement window (${lifespan.material} rated ${lifespan.minYears}–${lifespan.maxYears} yrs).`;
}

export function calculateRoofRiskIndex(lead: any, portfolioInfo?: PortfolioInfo): RoofRiskResult {
  const currentYear = new Date().getFullYear();
  const lifespan = getRoofLifespan(lead.roofType || lead.roof_type);

  let bestRoofYear: number | null = null;
  let roofYearSource = "";
  let roofAgeSource: "record" | "permit" | "naip_imagery" | "year_built" | "default" = "default";

  const roofLastReplaced = lead.roofLastReplaced || lead.roof_last_replaced;
  const lastRoofingPermitDate = lead.lastRoofingPermitDate || lead.last_roofing_permit_date;
  const yearBuilt = lead.yearBuilt || lead.year_built;
  const roofAgeSourceField = lead.roofAgeSource || lead.roof_age_source;
  const naipEstimatedYear = lead.naipEstimatedYear || lead.naip_estimated_year;

  if (roofLastReplaced) {
    bestRoofYear = roofLastReplaced;
    if (roofAgeSourceField === "naip_imagery" || roofAgeSourceField === "naip_change_detection") {
      roofYearSource = "NAIP satellite imagery detection";
      roofAgeSource = "naip_imagery";
    } else {
      roofYearSource = "roof replacement record";
      roofAgeSource = "record";
    }
  } else if (lastRoofingPermitDate) {
    const permitYear = parseInt(lastRoofingPermitDate.substring(0, 4));
    if (permitYear > 1950) {
      bestRoofYear = permitYear;
      roofYearSource = "roofing permit";
      roofAgeSource = "permit";
    }
  }

  if (!bestRoofYear && naipEstimatedYear) {
    bestRoofYear = naipEstimatedYear;
    roofYearSource = "NAIP satellite imagery detection";
    roofAgeSource = "naip_imagery";
  }

  if (!bestRoofYear && yearBuilt) {
    bestRoofYear = yearBuilt;
    roofYearSource = "year built (no replacement record)";
    roofAgeSource = "year_built";
  }

  const estimatedAge = bestRoofYear ? currentYear - bestRoofYear : 25;

  // ── PILLAR 1: Age Risk (0–25) ──
  let ageRiskScore = 0;
  let ageDetail = "";

  if (bestRoofYear) {
    const ageRatio = estimatedAge / lifespan.avgYears;
    if (ageRatio >= 1.5) {
      ageRiskScore = 25;
      ageDetail = `${estimatedAge}yr old roof, far past ${lifespan.material} lifespan (${lifespan.avgYears}yr avg). Source: ${roofYearSource}.`;
    } else if (ageRatio >= 1.0) {
      ageRiskScore = Math.round(20 + (ageRatio - 1.0) * 10);
      ageDetail = `${estimatedAge}yr old, past expected ${lifespan.material} lifespan of ${lifespan.minYears}–${lifespan.maxYears}yr. Source: ${roofYearSource}.`;
    } else if (ageRatio >= 0.75) {
      ageRiskScore = Math.round(12 + (ageRatio - 0.75) * 32);
      ageDetail = `${estimatedAge}yr old ${lifespan.material} roof approaching end-of-life (${Math.round(ageRatio * 100)}% of avg lifespan). Source: ${roofYearSource}.`;
    } else if (ageRatio >= 0.5) {
      ageRiskScore = Math.round(5 + (ageRatio - 0.5) * 28);
      ageDetail = `${estimatedAge}yr old ${lifespan.material} roof, mid-life (${Math.round(ageRatio * 100)}% of avg lifespan). Source: ${roofYearSource}.`;
    } else {
      ageRiskScore = Math.round(ageRatio * 10);
      ageDetail = `${estimatedAge}yr old ${lifespan.material} roof, relatively new. Source: ${roofYearSource}.`;
    }
  } else {
    ageRiskScore = 15;
    ageDetail = "No roof age data available — moderate risk assumed.";
  }
  ageRiskScore = Math.min(ageRiskScore, 25);

  // ── PILLAR 2: Storm Risk (0–25) ──
  let stormScore = 0;
  let stormDetail = "";
  const stormDetails: string[] = [];

  const hailEvents = lead.hailEvents || lead.hail_events || 0;
  const lastHailDate = lead.lastHailDate || lead.last_hail_date;
  const lastHailSize = lead.lastHailSize || lead.last_hail_size || 0;
  const floodZone = lead.floodZone || lead.flood_zone;
  const isFloodHighRisk = lead.isFloodHighRisk || lead.is_flood_high_risk;

  if (lastHailSize >= 2.0) { stormScore += 10; stormDetails.push(`${lastHailSize}" hail (severe)`); }
  else if (lastHailSize >= 1.5) { stormScore += 7; stormDetails.push(`${lastHailSize}" hail (significant)`); }
  else if (lastHailSize >= 1.0) { stormScore += 4; stormDetails.push(`${lastHailSize}" hail (moderate)`); }
  else if (lastHailSize > 0) { stormScore += 2; stormDetails.push(`${lastHailSize}" hail (minor)`); }

  if (hailEvents >= 20) { stormScore += 8; stormDetails.push(`${hailEvents} hail events (extreme frequency)`); }
  else if (hailEvents >= 10) { stormScore += 6; stormDetails.push(`${hailEvents} hail events (high frequency)`); }
  else if (hailEvents >= 5) { stormScore += 4; stormDetails.push(`${hailEvents} hail events`); }
  else if (hailEvents >= 1) { stormScore += 2; stormDetails.push(`${hailEvents} hail event(s)`); }

  if (lastHailDate) {
    const daysSince = Math.floor((Date.now() - new Date(lastHailDate).getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince <= 365) { stormScore += 4; stormDetails.push(`last hail ${daysSince}d ago (recent)`); }
    else if (daysSince <= 1095) { stormScore += 3; stormDetails.push(`last hail ${Math.round(daysSince / 365)}yr ago`); }
    else if (daysSince <= 1825) { stormScore += 1; stormDetails.push(`last hail ${Math.round(daysSince / 365)}yr ago`); }
  }

  if (isFloodHighRisk) { stormScore += 3; stormDetails.push("High flood risk zone"); }
  else if (floodZone && floodZone !== "X" && floodZone !== "NONE") { stormScore += 1; stormDetails.push(`Flood zone: ${floodZone}`); }

  stormScore = Math.min(stormScore, 25);
  stormDetail = stormDetails.length > 0 ? stormDetails.join(". ") + "." : "No storm exposure data.";

  // ── PILLAR 3: Permit Silence (0–20) ──
  let permitScore = 0;
  let permitDetail = "";

  const permitCount = lead.permitCount || lead.permit_count || 0;

  if (lastRoofingPermitDate) {
    const permitYear = parseInt(lastRoofingPermitDate.substring(0, 4));
    const yearsSincePermit = currentYear - permitYear;
    if (yearsSincePermit >= 15) {
      permitScore = 18;
      permitDetail = `Last roofing permit ${yearsSincePermit}yr ago (${permitYear}). Long silence suggests deferred maintenance.`;
    } else if (yearsSincePermit >= 10) {
      permitScore = 15;
      permitDetail = `Last roofing permit ${yearsSincePermit}yr ago (${permitYear}). Extended gap.`;
    } else if (yearsSincePermit >= 5) {
      permitScore = 8;
      permitDetail = `Last roofing permit ${yearsSincePermit}yr ago (${permitYear}).`;
    } else {
      permitScore = 0;
      permitDetail = `Recent roofing permit (${permitYear}). Roof likely in good condition.`;
    }
  } else if (estimatedAge >= 25) {
    permitScore = 20;
    permitDetail = `No roofing permits on record for ${estimatedAge}yr old building. Strong indicator of deferred maintenance or undocumented work.`;
  } else if (estimatedAge >= 15) {
    permitScore = 16;
    permitDetail = `No roofing permits on record for ${estimatedAge}yr old building. Approaching replacement window without documented maintenance.`;
  } else if (estimatedAge >= 10) {
    permitScore = 10;
    permitDetail = `No roofing permits on record for ${estimatedAge}yr old building.`;
  } else {
    permitScore = 4;
    permitDetail = `No roofing permits but building is relatively new (${estimatedAge}yr).`;
  }
  permitScore = Math.min(permitScore, 20);

  // ── PILLAR 4: Climate / Financial Stress (0–15) ──
  let stressScore = 0;
  const stressDetails: string[] = [];

  if (isFloodHighRisk) { stressScore += 5; stressDetails.push("High flood risk zone — insurance pressure"); }
  else if (floodZone && floodZone !== "X" && floodZone !== "NONE") { stressScore += 2; stressDetails.push(`Flood zone ${floodZone}`); }

  if (lead.taxDelinquent || lead.tax_delinquent) { stressScore += 4; stressDetails.push("Tax delinquent — financial stress"); }
  if ((lead.lienCount || lead.lien_count || 0) >= 3) { stressScore += 3; stressDetails.push(`${lead.lienCount || lead.lien_count} liens filed`); }
  else if ((lead.lienCount || lead.lien_count || 0) >= 1) { stressScore += 1; stressDetails.push(`${lead.lienCount || lead.lien_count} lien(s)`); }
  if (lead.foreclosureFlag || lead.foreclosure_flag) { stressScore += 2; stressDetails.push("Foreclosure flag"); }
  if ((lead.openViolations || lead.open_violations || 0) >= 3) { stressScore += 2; stressDetails.push(`${lead.openViolations || lead.open_violations} open violations`); }
  else if ((lead.openViolations || lead.open_violations || 0) >= 1) { stressScore += 1; stressDetails.push(`${lead.openViolations || lead.open_violations} violation(s)`); }

  stressScore = Math.min(stressScore, 15);
  const stressDetail = stressDetails.length > 0 ? stressDetails.join(". ") + "." : "No financial stress signals detected.";

  // ── PILLAR 5: Portfolio Concentration Risk (0–15) ──
  let portfolioScore = 0;
  let portfolioDetail = "";

  if (portfolioInfo && portfolioInfo.propertyCount >= 3) {
    const years = portfolioInfo.yearBuiltArray.filter(y => y > 0);
    let eraConcentration = 0;

    if (years.length >= 3) {
      const avgYear = Math.round(years.reduce((a, b) => a + b, 0) / years.length);
      const withinEra = years.filter(y => Math.abs(y - avgYear) <= 5).length;
      eraConcentration = Math.round((withinEra / years.length) * 100);

      if (eraConcentration >= 70) {
        portfolioScore += Math.round((eraConcentration / 100) * 10);
      } else if (eraConcentration >= 50) {
        portfolioScore += Math.round((eraConcentration / 100) * 6);
      }
    }

    if (portfolioInfo.propertyCount >= 12) { portfolioScore += 5; }
    else if (portfolioInfo.propertyCount >= 5) { portfolioScore += 3; }
    else { portfolioScore += 1; }

    const roofTypeSet = new Set(portfolioInfo.roofTypes.filter(Boolean));
    const dominantType = roofTypeSet.size === 1 ? portfolioInfo.roofTypes[0] : null;

    portfolioScore = Math.min(portfolioScore, 15);
    portfolioDetail = `Portfolio: ${portfolioInfo.propertyCount} properties, ${eraConcentration}% built in same era${dominantType ? `, all ${dominantType}` : `, ${roofTypeSet.size} roof types`}. ${portfolioInfo.propertyCount >= 12 ? "Systemic failure risk across portfolio." : "Moderate concentration risk."}`;
  } else {
    portfolioDetail = "Not part of a multi-property portfolio (or <3 properties).";
  }

  const totalScore = Math.min(ageRiskScore + stormScore + permitScore + stressScore + portfolioScore, 100);
  const tier = getTier(totalScore);
  const exposureWindow = computeExposureWindow(estimatedAge, lifespan);

  return {
    score: totalScore,
    tier,
    exposureWindow,
    roofAgeSource,
    breakdown: {
      ageRisk: { score: ageRiskScore, max: 25, detail: ageDetail },
      stormRisk: { score: stormScore, max: 25, detail: stormDetail },
      permitSilence: { score: permitScore, max: 20, detail: permitDetail },
      climateStress: { score: stressScore, max: 15, detail: stressDetail },
      portfolioConcentration: { score: portfolioScore, max: 15, detail: portfolioDetail },
    },
  };
}

export interface BatchComputeProgress {
  running: boolean;
  processed: number;
  total: number;
  startedAt: string | null;
  completedAt: string | null;
  distribution: { low: number; moderate: number; high: number; critical: number };
}

export let batchProgress: BatchComputeProgress = {
  running: false, processed: 0, total: 0,
  startedAt: null, completedAt: null,
  distribution: { low: 0, moderate: 0, high: 0, critical: 0 },
};

export async function batchComputeRoofRisk(): Promise<void> {
  if (batchProgress.running) throw new Error("Roof risk computation already running");

  batchProgress = {
    running: true, processed: 0, total: 0,
    startedAt: new Date().toISOString(), completedAt: null,
    distribution: { low: 0, moderate: 0, high: 0, critical: 0 },
  };

  try {
    console.log("[roof-risk] Starting batch computation...");

    const allLeads = (await db.execute(sql`
      SELECT id, year_built, roof_type, roof_last_replaced, last_roofing_permit_date,
             hail_events, last_hail_date, last_hail_size, flood_zone, is_flood_high_risk,
             tax_delinquent, lien_count, foreclosure_flag, open_violations,
             permit_count, last_permit_date
      FROM leads
    `)) as any;
    const leadRows = allLeads.rows;
    batchProgress.total = leadRows.length;

    console.log(`[roof-risk] Loading portfolio data for ${leadRows.length} leads...`);

    const portfolioData = (await db.execute(sql`
      SELECT pl.lead_id, p.property_count,
        (SELECT ARRAY_AGG(l2.year_built) FROM portfolio_leads pl2 JOIN leads l2 ON l2.id = pl2.lead_id WHERE pl2.portfolio_id = p.id) as year_built_array,
        (SELECT ARRAY_AGG(l2.roof_type) FROM portfolio_leads pl2 JOIN leads l2 ON l2.id = pl2.lead_id WHERE pl2.portfolio_id = p.id) as roof_type_array
      FROM portfolio_leads pl
      JOIN portfolios p ON p.id = pl.portfolio_id
      WHERE p.property_count >= 3
    `)) as any;

    const portfolioMap = new Map<string, PortfolioInfo>();
    for (const row of portfolioData.rows) {
      portfolioMap.set(row.lead_id, {
        propertyCount: row.property_count,
        yearBuiltArray: (row.year_built_array || []).filter((y: any) => y != null),
        roofTypes: (row.roof_type_array || []).filter((t: any) => t != null),
      });
    }

    console.log(`[roof-risk] Loaded ${portfolioMap.size} portfolio memberships. Computing scores...`);

    const BATCH_SIZE = 500;
    for (let i = 0; i < leadRows.length; i += BATCH_SIZE) {
      if (!batchProgress.running) break;

      const batch = leadRows.slice(i, i + BATCH_SIZE);
      const updates: { id: string; score: number; breakdown: any }[] = [];

      for (const lead of batch) {
        const portfolio = portfolioMap.get(lead.id);
        const result = calculateRoofRiskIndex(lead, portfolio);
        updates.push({ id: lead.id, score: result.score, breakdown: result });

        if (result.tier === "Critical") batchProgress.distribution.critical++;
        else if (result.tier === "High") batchProgress.distribution.high++;
        else if (result.tier === "Moderate") batchProgress.distribution.moderate++;
        else batchProgress.distribution.low++;
      }

      for (const u of updates) {
        await db.execute(sql`
          UPDATE leads SET roof_risk_index = ${u.score}, roof_risk_breakdown = ${JSON.stringify(u.breakdown)}
          WHERE id = ${u.id}
        `);
        try {
          await db.execute(sql`
            INSERT INTO property_roof (property_id, roof_risk_index, roof_risk_breakdown, source, updated_at)
            VALUES (${u.id}, ${u.score}, ${JSON.stringify(u.breakdown)}::jsonb, 'roof_risk_engine', NOW())
            ON CONFLICT (property_id) DO UPDATE SET
              roof_risk_index = EXCLUDED.roof_risk_index,
              roof_risk_breakdown = EXCLUDED.roof_risk_breakdown,
              source = EXCLUDED.source,
              updated_at = NOW()
          `);
        } catch {}
      }

      batchProgress.processed = Math.min(i + BATCH_SIZE, leadRows.length);
      if (batchProgress.processed % 2000 === 0 || batchProgress.processed === leadRows.length) {
        console.log(`[roof-risk] Processed ${batchProgress.processed}/${leadRows.length}`);
      }
    }

    batchProgress.running = false;
    batchProgress.completedAt = new Date().toISOString();
    const d = batchProgress.distribution;
    console.log(`[roof-risk] Complete: ${leadRows.length} leads scored. Critical: ${d.critical}, High: ${d.high}, Moderate: ${d.moderate}, Low: ${d.low}`);
  } catch (error: any) {
    console.error("[roof-risk] Fatal error:", error.message);
    batchProgress.running = false;
    batchProgress.completedAt = new Date().toISOString();
  }
}
