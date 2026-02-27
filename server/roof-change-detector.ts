import sharp from "sharp";
import type { RoofCrop } from "./naip-imagery-agent";

export interface ColorStats {
  meanR: number;
  meanG: number;
  meanB: number;
  brightness: number;
  stdBrightness: number;
  colorClass: "dark" | "medium" | "light" | "white";
  rbRatio: number;
  uniformity: number;
}

export interface ChangeTransition {
  fromYear: number;
  toYear: number;
  brightnessDelta: number;
  brightnessPercent: number;
  rbRatioDelta: number;
  uniformityDelta: number;
  fromStats: ColorStats;
  toStats: ColorStats;
  score: number;
  changeType: string;
}

export interface RoofChangeResult {
  estimatedYear: number | null;
  confidence: number;
  changeType: string;
  brightnessDelta: number;
  fromColor: string;
  toColor: string;
  fromYear: number;
  toYear: number;
  transitions: ChangeTransition[];
}

function classifyColor(brightness: number): "dark" | "medium" | "light" | "white" {
  if (brightness < 80) return "dark";
  if (brightness < 140) return "medium";
  if (brightness < 200) return "light";
  return "white";
}

export async function analyzeRoofCrop(imageBuffer: Buffer): Promise<ColorStats> {
  const { data, info } = await sharp(imageBuffer)
    .resize(64, 64, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  let sumR = 0, sumG = 0, sumB = 0;
  const brightnessValues: number[] = [];

  for (let i = 0; i < data.length; i += 3) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    brightnessValues.push(0.299 * r + 0.587 * g + 0.114 * b);
  }

  const meanR = sumR / pixelCount;
  const meanG = sumG / pixelCount;
  const meanB = sumB / pixelCount;
  const brightness = brightnessValues.reduce((a, b) => a + b, 0) / pixelCount;

  const variance = brightnessValues.reduce((sum, v) => sum + Math.pow(v - brightness, 2), 0) / pixelCount;
  const stdBrightness = Math.sqrt(variance);

  const rbRatio = meanB > 0 ? meanR / meanB : 1;
  const uniformity = 1 - Math.min(stdBrightness / 128, 1);

  return {
    meanR: Math.round(meanR * 10) / 10,
    meanG: Math.round(meanG * 10) / 10,
    meanB: Math.round(meanB * 10) / 10,
    brightness: Math.round(brightness * 10) / 10,
    stdBrightness: Math.round(stdBrightness * 10) / 10,
    colorClass: classifyColor(brightness),
    rbRatio: Math.round(rbRatio * 100) / 100,
    uniformity: Math.round(uniformity * 100) / 100,
  };
}

export function detectRoofChanges(
  snapshots: Array<{ year: number; stats: ColorStats }>
): ChangeTransition[] {
  if (snapshots.length < 2) return [];

  const sorted = [...snapshots].sort((a, b) => a.year - b.year);
  const transitions: ChangeTransition[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];

    const brightnessDelta = to.stats.brightness - from.stats.brightness;
    const brightnessPercent = from.stats.brightness > 0
      ? Math.abs(brightnessDelta) / from.stats.brightness * 100
      : 0;
    const rbRatioDelta = to.stats.rbRatio - from.stats.rbRatio;
    const uniformityDelta = to.stats.uniformity - from.stats.uniformity;

    let score = 0;
    let changeType = "none";

    if (brightnessPercent > 50) {
      score += 50;
      changeType = brightnessDelta > 0 ? "dark_to_light" : "light_to_dark";
    } else if (brightnessPercent > 35) {
      score += 35;
      changeType = brightnessDelta > 0 ? "dark_to_light" : "light_to_dark";
    } else if (brightnessPercent > 20) {
      score += 20;
      changeType = "moderate_change";
    }

    if (Math.abs(rbRatioDelta) > 0.3) {
      score += 15;
      if (changeType === "none") changeType = "color_shift";
    } else if (Math.abs(rbRatioDelta) > 0.15) {
      score += 8;
    }

    if (uniformityDelta > 0.15) {
      score += 15;
    } else if (uniformityDelta > 0.08) {
      score += 8;
    }

    if (from.stats.colorClass === "dark" && (to.stats.colorClass === "light" || to.stats.colorClass === "white")) {
      score += 20;
      changeType = "dark_to_white_reroof";
    }

    if (from.stats.colorClass === "medium" && to.stats.colorClass === "white") {
      score += 15;
      changeType = "medium_to_white_reroof";
    }

    transitions.push({
      fromYear: from.year,
      toYear: to.year,
      brightnessDelta: Math.round(brightnessDelta * 10) / 10,
      brightnessPercent: Math.round(brightnessPercent * 10) / 10,
      rbRatioDelta: Math.round(rbRatioDelta * 100) / 100,
      uniformityDelta: Math.round(uniformityDelta * 100) / 100,
      fromStats: from.stats,
      toStats: to.stats,
      score: Math.min(score, 100),
      changeType,
    });
  }

  return transitions;
}

export function estimateReplacementYear(transitions: ChangeTransition[]): RoofChangeResult {
  if (transitions.length === 0) {
    return {
      estimatedYear: null,
      confidence: 0,
      changeType: "no_data",
      brightnessDelta: 0,
      fromColor: "unknown",
      toColor: "unknown",
      fromYear: 0,
      toYear: 0,
      transitions: [],
    };
  }

  const best = transitions.reduce((max, t) => t.score > max.score ? t : max, transitions[0]);

  const confidence = Math.min(best.score, 100);
  const midYear = Math.round((best.fromYear + best.toYear) / 2);

  return {
    estimatedYear: confidence >= 30 ? midYear : null,
    confidence,
    changeType: best.changeType,
    brightnessDelta: best.brightnessDelta,
    fromColor: best.fromStats.colorClass,
    toColor: best.toStats.colorClass,
    fromYear: best.fromYear,
    toYear: best.toYear,
    transitions,
  };
}

export async function analyzePropertyRoof(
  leadId: string,
  crops: RoofCrop[]
): Promise<RoofChangeResult> {
  const { storeSnapshot } = await import("./naip-imagery-agent");

  const snapshots: Array<{ year: number; stats: ColorStats }> = [];

  for (const crop of crops) {
    const stats = await analyzeRoofCrop(crop.imageBuffer);

    await storeSnapshot({
      leadId,
      captureYear: crop.year,
      captureDate: crop.date,
      naipItemId: crop.itemId,
      imageUrl: crop.tileUrl,
      meanBrightness: stats.brightness,
      meanR: stats.meanR,
      meanG: stats.meanG,
      meanB: stats.meanB,
      stdBrightness: stats.stdBrightness,
      colorClass: stats.colorClass,
      colorStats: stats,
    });

    snapshots.push({ year: crop.year, stats });
  }

  const transitions = detectRoofChanges(snapshots);
  const result = estimateReplacementYear(transitions);

  if (result.estimatedYear && result.confidence >= 30) {
    const { storeChange } = await import("./naip-imagery-agent");
    await storeChange({
      leadId,
      estimatedYear: result.estimatedYear,
      confidence: result.confidence,
      changeType: result.changeType,
      brightnessDelta: result.brightnessDelta,
      fromColor: result.fromColor,
      toColor: result.toColor,
      fromYear: result.fromYear,
      toYear: result.toYear,
      details: { transitions: result.transitions },
    });
  }

  return result;
}
