import { storage } from "./storage";
import { createGunzip } from "zlib";
import { Readable } from "stream";
import type { InsertHailEvent } from "@shared/schema";

const NOAA_BASE_URL = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";

const DFW_COUNTIES = new Set([
  "DALLAS", "TARRANT", "COLLIN", "DENTON", "ELLIS", "JOHNSON",
  "KAUFMAN", "PARKER", "ROCKWALL", "WISE", "HOOD", "HUNT",
]);

function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseNoaaDate(dateStr: string): string {
  const match = dateStr.match(/(\d{2})-([A-Z]{3})-(\d{2})\s/);
  if (!match) return "";
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const day = match[1];
  const month = months[match[2]] || "01";
  const yearShort = parseInt(match[3]);
  const year = yearShort >= 50 ? 1900 + yearShort : 2000 + yearShort;
  return `${year}-${month}-${day}`;
}

async function fetchAndDecompress(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);

    readable.pipe(gunzip)
      .on("data", (chunk: Buffer) => chunks.push(chunk))
      .on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
      .on("error", reject);
  });
}

async function discoverFileForYear(year: number): Promise<string | null> {
  try {
    const response = await fetch(NOAA_BASE_URL);
    const html = await response.text();
    const pattern = new RegExp(`StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`);
    const match = html.match(pattern);
    return match ? match[0] : null;
  } catch (error) {
    console.error(`Failed to discover NOAA file for year ${year}:`, error);
    return null;
  }
}

interface NoaaImportResult {
  year: number;
  totalProcessed: number;
  imported: number;
  skippedDuplicate: number;
  skippedNoCoords: number;
  errors: string[];
}

const STATE_ABBREV_TO_FULL: Record<string, string> = {
  TX: "TEXAS", CO: "COLORADO", OK: "OKLAHOMA", KS: "KANSAS",
  NE: "NEBRASKA", NM: "NEW MEXICO", AR: "ARKANSAS", LA: "LOUISIANA",
  MO: "MISSOURI", MS: "MISSISSIPPI", AL: "ALABAMA", GA: "GEORGIA",
  FL: "FLORIDA", SC: "SOUTH CAROLINA", NC: "NORTH CAROLINA",
  TN: "TENNESSEE", KY: "KENTUCKY", VA: "VIRGINIA", WV: "WEST VIRGINIA",
  OH: "OHIO", IN: "INDIANA", IL: "ILLINOIS", IA: "IOWA",
  MN: "MINNESOTA", WI: "WISCONSIN", MI: "MICHIGAN", PA: "PENNSYLVANIA",
  NY: "NEW YORK", NJ: "NEW JERSEY", CT: "CONNECTICUT", MA: "MASSACHUSETTS",
  WY: "WYOMING", MT: "MONTANA", SD: "SOUTH DAKOTA", ND: "NORTH DAKOTA",
  AZ: "ARIZONA", UT: "UTAH", NV: "NEVADA", ID: "IDAHO",
  OR: "OREGON", WA: "WASHINGTON", CA: "CALIFORNIA",
};

export async function importNoaaHailData(
  year: number,
  marketId: string,
  targetCounties?: Set<string>,
  targetState?: string
): Promise<NoaaImportResult> {
  const result: NoaaImportResult = {
    year,
    totalProcessed: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedNoCoords: 0,
    errors: [],
  };

  const counties = targetCounties || DFW_COUNTIES;

  const importRun = await storage.createImportRun({
    type: "noaa_hail",
    status: "running",
    startedAt: new Date(),
    metadata: { year, marketId },
  });

  try {
    const filename = await discoverFileForYear(year);
    if (!filename) {
      const errMsg = `No NOAA file found for year ${year}`;
      result.errors.push(errMsg);
      await storage.updateImportRun(importRun.id, {
        status: "failed",
        completedAt: new Date(),
        errors: errMsg,
      });
      return result;
    }

    console.log(`Downloading NOAA data: ${filename}...`);
    const csvData = await fetchAndDecompress(`${NOAA_BASE_URL}${filename}`);
    const lines = csvData.split("\n");

    if (lines.length < 2) {
      throw new Error("Empty NOAA CSV file");
    }

    const headers = parseCSVLine(lines[0]);
    const headerMap = new Map(headers.map((h, i) => [h, i]));

    const stateIdx = headerMap.get("STATE") ?? -1;
    const eventTypeIdx = headerMap.get("EVENT_TYPE") ?? -1;
    const magnitudeIdx = headerMap.get("MAGNITUDE") ?? -1;
    const beginLatIdx = headerMap.get("BEGIN_LAT") ?? -1;
    const beginLonIdx = headerMap.get("BEGIN_LON") ?? -1;
    const czNameIdx = headerMap.get("CZ_NAME") ?? -1;
    const eventIdIdx = headerMap.get("EVENT_ID") ?? -1;
    const episodeIdIdx = headerMap.get("EPISODE_ID") ?? -1;
    const beginDateIdx = headerMap.get("BEGIN_DATE_TIME") ?? -1;

    if (stateIdx === -1 || eventTypeIdx === -1) {
      throw new Error("Missing required columns in NOAA CSV");
    }

    const batchToInsert: InsertHailEvent[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);

      const state = fields[stateIdx]?.toUpperCase();
      const eventType = fields[eventTypeIdx]?.toLowerCase();

      const fullStateName = targetState ? (STATE_ABBREV_TO_FULL[targetState.toUpperCase()] || targetState.toUpperCase()) : "TEXAS";
      if (state !== fullStateName || eventType !== "hail") continue;

      const countyRaw = fields[czNameIdx]?.toUpperCase() || "";
      if (!counties.has(countyRaw)) continue;

      result.totalProcessed++;

      const lat = parseFloat(fields[beginLatIdx] || "");
      const lon = parseFloat(fields[beginLonIdx] || "");

      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) {
        result.skippedNoCoords++;
        continue;
      }

      const magnitude = parseFloat(fields[magnitudeIdx] || "0");
      const eventId = fields[eventIdIdx] || "";
      const episodeId = fields[episodeIdIdx] || "";
      const dateStr = parseNoaaDate(fields[beginDateIdx] || "");

      if (!dateStr) continue;

      if (eventId) {
        const existing = await storage.getHailEventByNoaaId(eventId);
        if (existing) {
          result.skippedDuplicate++;
          continue;
        }
      }

      batchToInsert.push({
        eventDate: dateStr,
        latitude: lat,
        longitude: lon,
        hailSize: magnitude,
        county: titleCase(countyRaw),
        city: titleCase(fields[czNameIdx] || ""),
        state: "TX",
        source: "NOAA",
        noaaEventId: eventId || null,
        noaaEpisodeId: episodeId || null,
        marketId,
      });
    }

    if (batchToInsert.length > 0) {
      result.imported = await storage.createHailEventsBatch(batchToInsert);
    }

    await storage.updateImportRun(importRun.id, {
      status: "completed",
      completedAt: new Date(),
      recordsProcessed: result.totalProcessed,
      recordsImported: result.imported,
      recordsSkipped: result.skippedDuplicate + result.skippedNoCoords,
    });

    console.log(`NOAA ${year}: ${result.imported} hail events imported (${result.skippedDuplicate} duplicates, ${result.skippedNoCoords} no coords)`);

  } catch (error: any) {
    const errMsg = error.message || String(error);
    result.errors.push(errMsg);
    await storage.updateImportRun(importRun.id, {
      status: "failed",
      completedAt: new Date(),
      errors: errMsg,
    });
    console.error(`NOAA import error for ${year}:`, errMsg);
  }

  return result;
}

export async function importNoaaMultiYear(
  startYear: number,
  endYear: number,
  marketId: string,
  targetCounties?: Set<string>,
  targetState?: string
): Promise<NoaaImportResult[]> {
  const results: NoaaImportResult[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const result = await importNoaaHailData(year, marketId, targetCounties, targetState);
    results.push(result);
  }
  return results;
}
