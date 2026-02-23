import { db } from "./storage";
import { contactEvidence } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

export async function suppressContact(
  evidenceId: string,
  reason: string,
  suppressedBy: string = "contractor"
): Promise<void> {
  await db
    .update(contactEvidence)
    .set({
      suppressedAt: new Date(),
      suppressedReason: reason,
      suppressedBy,
      isActive: false,
      computedScore: 0,
      confidence: 0,
      validationStatus: "INVALID",
      validationDetail: `Suppressed: ${reason}`,
    })
    .where(eq(contactEvidence.id, evidenceId));
}

export async function unsuppressContact(evidenceId: string): Promise<void> {
  await db
    .update(contactEvidence)
    .set({
      suppressedAt: null,
      suppressedReason: null,
      suppressedBy: null,
      isActive: true,
      validationStatus: "UNVERIFIED",
      validationDetail: "Unsuppressed — needs re-verification",
    })
    .where(eq(contactEvidence.id, evidenceId));
}

export async function markWrongNumber(
  evidenceId: string,
  feedback: string = "Wrong number reported by contractor"
): Promise<{ suppressed: string; promoted: string | null }> {
  const [ev] = await db
    .select()
    .from(contactEvidence)
    .where(eq(contactEvidence.id, evidenceId));

  if (!ev) throw new Error("Evidence not found");

  await suppressContact(evidenceId, feedback, "contractor");

  const alternatives = await db
    .select()
    .from(contactEvidence)
    .where(
      and(
        eq(contactEvidence.leadId, ev.leadId),
        eq(contactEvidence.contactType, ev.contactType),
        eq(contactEvidence.isActive, true)
      )
    );

  const remaining = alternatives.filter(a => a.id !== evidenceId && !a.suppressedAt);
  remaining.sort((a, b) => (b.computedScore ?? 0) - (a.computedScore ?? 0));

  let promoted: string | null = null;
  if (remaining.length > 0) {
    const best = remaining[0];
    await db
      .update(contactEvidence)
      .set({
        computedScore: Math.min((best.computedScore ?? 50) * 1.15, 100),
      })
      .where(eq(contactEvidence.id, best.id));
    promoted = best.id;
  }

  return { suppressed: evidenceId, promoted };
}

export async function markConfirmedGood(
  evidenceId: string,
  confirmedBy: string = "contractor"
): Promise<void> {
  await db
    .update(contactEvidence)
    .set({
      validationStatus: "CONFIRMED",
      validationDetail: `Confirmed good by ${confirmedBy}`,
      lastVerifiedAt: new Date(),
      computedScore: 95,
      confidence: 95,
    })
    .where(eq(contactEvidence.id, evidenceId));
}
