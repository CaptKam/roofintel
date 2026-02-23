import { storage, db } from "./storage";
import { importNoaaHailData } from "./noaa-importer";
import { calculateScore } from "./seed";
import { contactEvidence } from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";

async function ensureDefaultJobs() {
  const existing = await storage.getJobByName("noaa_hail_sync");
  if (!existing) {
    await storage.createJob({
      name: "noaa_hail_sync",
      type: "noaa_import",
      schedule: "daily",
      isActive: true,
      config: { description: "Fetch latest NOAA hail events for all active markets" },
    });
  }

  const scoreJob = await storage.getJobByName("lead_score_recalc");
  if (!scoreJob) {
    await storage.createJob({
      name: "lead_score_recalc",
      type: "score_recalc",
      schedule: "daily",
      isActive: true,
      config: { description: "Recalculate lead scores based on latest hail data" },
    });
  }
}

async function runNoaaSync() {
  console.log("[Job] Running NOAA hail sync...");
  const job = await storage.getJobByName("noaa_hail_sync");
  if (!job || !job.isActive) return;

  await storage.updateJob(job.id, { status: "running", lastRunAt: new Date() });

  try {
    const markets = await storage.getMarkets();
    const currentYear = new Date().getFullYear();

    for (const market of markets) {
      if (!market.isActive) continue;
      const targetCounties = new Set(market.counties.map((c: string) => c.toUpperCase()));
      await importNoaaHailData(currentYear, market.id, targetCounties);
    }

    await storage.updateJob(job.id, { status: "idle" });
    console.log("[Job] NOAA hail sync complete");
  } catch (error) {
    console.error("[Job] NOAA sync error:", error);
    await storage.updateJob(job.id, { status: "error" });
  }
}

async function runScoreRecalc() {
  console.log("[Job] Running lead score recalculation...");
  const job = await storage.getJobByName("lead_score_recalc");
  if (!job || !job.isActive) return;

  await storage.updateJob(job.id, { status: "running", lastRunAt: new Date() });

  try {
    const { leads: allLeads } = await storage.getLeads();
    let updated = 0;

    for (const lead of allLeads) {
      const newScore = calculateScore(lead);
      if (newScore !== lead.leadScore) {
        await storage.updateLeadScore(lead.id, newScore);
        updated++;
      }
    }

    await storage.updateJob(job.id, { status: "idle" });
    console.log(`[Job] Score recalc complete: ${updated} leads updated`);
  } catch (error) {
    console.error("[Job] Score recalc error:", error);
    await storage.updateJob(job.id, { status: "error" });
  }
}

async function runContactFreshnessCheck() {
  console.log("[Job] Running contact freshness check...");
  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const result = await db
      .update(contactEvidence)
      .set({
        validationStatus: "STALE",
        validationDetail: "Contact data over 60 days old — needs re-verification",
      })
      .where(
        and(
          eq(contactEvidence.isActive, true),
          lt(contactEvidence.extractedAt, sixtyDaysAgo),
          sql`${contactEvidence.validationStatus} IS DISTINCT FROM 'STALE'`
        )
      );

    console.log("[Job] Contact freshness check complete");
  } catch (error) {
    console.error("[Job] Contact freshness check error:", error);
  }
}

const FOUR_HOURS = 4 * 60 * 60 * 1000;

export function startJobScheduler() {
  ensureDefaultJobs().catch(console.error);

  setInterval(async () => {
    try {
      await runNoaaSync();
      await runScoreRecalc();
      await runContactFreshnessCheck();
    } catch (error) {
      console.error("[Scheduler] Error:", error);
    }
  }, FOUR_HOURS);

  console.log("[Scheduler] Job scheduler started (runs every 4 hours)");
}
