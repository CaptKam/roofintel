import { db } from "../storage";
import { sourceBlocklist } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const BLOCKED_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "spokeo.com",
  "whitepages.com",
  "beenverified.com",
  "truepeoplesearch.com",
  "fastpeoplesearch.com",
  "peoplefinders.com",
  "intelius.com",
  "mylife.com",
  "pipl.com",
  "radaris.com",
  "zabasearch.com",
]);

const RATE_LIMITS: Record<string, { maxPerMinute: number; maxPerHour: number }> = {
  "maps.googleapis.com": { maxPerMinute: 30, maxPerHour: 500 },
  "data.texas.gov": { maxPerMinute: 20, maxPerHour: 200 },
  "mycpa.cpa.state.tx.us": { maxPerMinute: 10, maxPerHour: 100 },
  "direct.sos.state.tx.us": { maxPerMinute: 10, maxPerHour: 100 },
  "api.opencorporates.com": { maxPerMinute: 5, maxPerHour: 50 },
  "google.serper.dev": { maxPerMinute: 15, maxPerHour: 150 },
  "default": { maxPerMinute: 20, maxPerHour: 300 },
};

const requestCounts = new Map<string, { minute: number[]; hour: number[] }>();

export const USER_AGENT = "RoofIntel/1.0 (Commercial Property Intelligence; +https://roofintel.com; contact@roofintel.com)";

export function isDomainBlocked(url: string): boolean {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    return BLOCKED_DOMAINS.has(domain);
  } catch {
    return false;
  }
}

export async function isDomainBlocklisted(domain: string): Promise<boolean> {
  try {
    const cleanDomain = domain.replace(/^www\./, "").toLowerCase();
    if (BLOCKED_DOMAINS.has(cleanDomain)) return true;
    const rows = await db
      .select()
      .from(sourceBlocklist)
      .where(
        and(
          eq(sourceBlocklist.domain, cleanDomain),
          eq(sourceBlocklist.isActive, true)
        )
      );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function isEntityBlocklisted(entityName: string): Promise<boolean> {
  try {
    const rows = await db
      .select()
      .from(sourceBlocklist)
      .where(
        and(
          eq(sourceBlocklist.entityName, entityName),
          eq(sourceBlocklist.isActive, true)
        )
      );
    return rows.length > 0;
  } catch {
    return false;
  }
}

export function checkRateLimit(url: string): { allowed: boolean; retryAfterMs?: number } {
  try {
    const domain = new URL(url).hostname;
    const limits = RATE_LIMITS[domain] || RATE_LIMITS["default"];
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const oneHourAgo = now - 3600000;

    if (!requestCounts.has(domain)) {
      requestCounts.set(domain, { minute: [], hour: [] });
    }
    const counts = requestCounts.get(domain)!;

    counts.minute = counts.minute.filter(t => t > oneMinuteAgo);
    counts.hour = counts.hour.filter(t => t > oneHourAgo);

    if (counts.minute.length >= limits.maxPerMinute) {
      const oldestInMinute = Math.min(...counts.minute);
      return { allowed: false, retryAfterMs: oldestInMinute + 60000 - now };
    }
    if (counts.hour.length >= limits.maxPerHour) {
      const oldestInHour = Math.min(...counts.hour);
      return { allowed: false, retryAfterMs: oldestInHour + 3600000 - now };
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

export function recordRequest(url: string): void {
  try {
    const domain = new URL(url).hostname;
    const now = Date.now();
    if (!requestCounts.has(domain)) {
      requestCounts.set(domain, { minute: [], hour: [] });
    }
    const counts = requestCounts.get(domain)!;
    counts.minute.push(now);
    counts.hour.push(now);
  } catch {}
}

const robotsTxtCache = new Map<string, { allowed: boolean; cachedAt: number }>();
const ROBOTS_CACHE_TTL = 3600000;

export async function checkRobotsTxt(url: string, path?: string): Promise<boolean> {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname;
    const targetPath = path || parsed.pathname;
    const cacheKey = `${domain}:${targetPath}`;
    const cached = robotsTxtCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ROBOTS_CACHE_TTL) {
      return cached.allowed;
    }

    const robotsUrl = `${parsed.protocol}//${domain}/robots.txt`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(robotsUrl, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        robotsTxtCache.set(cacheKey, { allowed: true, cachedAt: Date.now() });
        return true;
      }

      const text = await res.text();
      const allowed = !isPathDisallowed(text, targetPath);
      robotsTxtCache.set(cacheKey, { allowed, cachedAt: Date.now() });
      return allowed;
    } catch {
      clearTimeout(timeout);
      robotsTxtCache.set(cacheKey, { allowed: true, cachedAt: Date.now() });
      return true;
    }
  } catch {
    return true;
  }
}

function isPathDisallowed(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split("\n");
  let inOurAgent = false;
  let inWildcard = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.toLowerCase().startsWith("user-agent:")) {
      const agent = line.substring(11).trim().toLowerCase();
      inOurAgent = agent === "roofintel" || agent === "roofintel/1.0";
      inWildcard = agent === "*";
    }
    if ((inOurAgent || inWildcard) && line.toLowerCase().startsWith("disallow:")) {
      const disallowed = line.substring(9).trim();
      if (!disallowed) continue;
      if (path.startsWith(disallowed)) return true;
    }
  }
  return false;
}

export async function policyFetch(url: string, options?: RequestInit): Promise<Response> {
  if (isDomainBlocked(url)) {
    throw new Error(`[SourcePolicy] Domain blocked: ${url}`);
  }

  const domainCheck = await isDomainBlocklisted(new URL(url).hostname);
  if (domainCheck) {
    throw new Error(`[SourcePolicy] Domain in blocklist: ${url}`);
  }

  const rateCheck = checkRateLimit(url);
  if (!rateCheck.allowed) {
    const waitMs = rateCheck.retryAfterMs || 5000;
    console.log(`[SourcePolicy] Rate limited for ${url}, waiting ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
  }

  const robotsAllowed = await checkRobotsTxt(url);
  if (!robotsAllowed) {
    throw new Error(`[SourcePolicy] Disallowed by robots.txt: ${url}`);
  }

  recordRequest(url);

  return fetch(url, {
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      ...(options?.headers || {}),
    },
  });
}

export function getRateLimitStatus(): Record<string, { minuteCount: number; hourCount: number; limits: { maxPerMinute: number; maxPerHour: number } }> {
  const status: Record<string, any> = {};
  const now = Date.now();
  requestCounts.forEach((counts, domain) => {
    const minuteCount = counts.minute.filter((t: number) => t > now - 60000).length;
    const hourCount = counts.hour.filter((t: number) => t > now - 3600000).length;
    status[domain] = {
      minuteCount,
      hourCount,
      limits: RATE_LIMITS[domain] || RATE_LIMITS["default"],
    };
  });
  return status;
}
