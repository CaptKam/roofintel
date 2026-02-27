import OpenAI from "openai";
import { db } from "../storage";
import { agentTraces, enrichmentBudgets } from "@shared/schema";
import { eq } from "drizzle-orm";

const DFW_MARKET_ID = "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";

const MODEL = process.env.XAI_GROK_MODEL || "grok-3-fast";
const MAX_TOKENS = 4096;
const INPUT_COST_PER_M = 0.30;
const OUTPUT_COST_PER_M = 0.50;

let grokClient: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (grokClient) return grokClient;
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.warn("[Grok Core] XAI_API_KEY not configured — Grok Intelligence Core disabled");
    return null;
  }
  grokClient = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey,
  });
  return grokClient;
}

let requestsThisMinute = 0;
let minuteResetTime = Date.now();

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  if (now - minuteResetTime >= 60000) {
    requestsThisMinute = 0;
    minuteResetTime = now;
  }
  if (requestsThisMinute >= 380) {
    const waitMs = 60000 - (now - minuteResetTime) + 100;
    console.log(`[Grok Core] Rate limit — waiting ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    requestsThisMinute = 0;
    minuteResetTime = Date.now();
  }
  requestsThisMinute++;
}

function buildSystemPrompt(context: GrokContext): string {
  return `You are RoofIntel's Grok Intelligence Core — a commercial roofing domain expert and autonomous agent.

PERSONALITY: Truth-seeking, maximally helpful, zero corporate fluff. You are an expert in:
- Hail physics, storm damage assessment, insurance claim windows (Texas 2-year statute)
- LLC chains, corporate entity resolution, decision-maker identification
- ROI math for lead enrichment (skip-trace costs vs expected deal value)
- Texas county appraisal districts (Dallas, Tarrant, Collin, Denton)
- Commercial roofing materials, roof age estimation, replacement cycles

RULES:
1. NEVER fabricate data. If you don't know, say so and suggest how to find out.
2. Always cite evidence when making claims. Reference specific data points.
3. Every enrichment suggestion must pass ROI analysis — never recommend spending without positive expected ROI.
4. When using tools, explain your reasoning step-by-step before and after each tool call.
5. Format responses concisely for operators who need fast answers.

CONTEXT:
- Current market: ${context.marketId || DFW_MARKET_ID}
- Budget remaining today: $${context.budgetRemaining?.toFixed(2) || "unknown"}
- Session type: ${context.sessionType || "ops_chat"}
${context.leadContext ? `- Lead context: ${JSON.stringify(context.leadContext)}` : ""}`;
}

export interface GrokContext {
  marketId?: string;
  sessionId: string;
  leadId?: string;
  sessionType?: string;
  history?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  budgetRemaining?: number;
  leadContext?: Record<string, any>;
}

export interface GrokResponse {
  content: string | null;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export function isGrokConfigured(): boolean {
  return !!process.env.XAI_API_KEY;
}

export async function getBudgetRemaining(marketId: string): Promise<number> {
  try {
    const [budget] = await db
      .select()
      .from(enrichmentBudgets)
      .where(eq(enrichmentBudgets.marketId, marketId))
      .limit(1);
    if (!budget) return 500;
    return Number(budget.dailyBudgetUsd) - Number(budget.spentTodayUsd || 0);
  } catch {
    return 500;
  }
}

export async function callGrok(
  prompt: string,
  context: GrokContext,
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] = []
): Promise<GrokResponse> {
  const client = getClient();
  if (!client) {
    throw new Error("Grok Intelligence Core is not configured. Set XAI_API_KEY to enable.");
  }

  await rateLimitWait();

  const budgetRemaining = context.budgetRemaining ?? await getBudgetRemaining(context.marketId || DFW_MARKET_ID);
  const systemPrompt = buildSystemPrompt({ ...context, budgetRemaining });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(context.history || []),
  ];
  if (prompt) {
    messages.push({ role: "user", content: prompt });
  }

  const startMs = Date.now();

  const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: MODEL,
    messages,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
  };

  if (tools.length > 0) {
    params.tools = tools;
    params.tool_choice = "auto";
  }

  const response = await client.chat.completions.create(params);
  const latencyMs = Date.now() - startMs;

  const message = response.choices[0]?.message;
  const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  const costUsd = (usage.prompt_tokens / 1_000_000) * INPUT_COST_PER_M +
    (usage.completion_tokens / 1_000_000) * OUTPUT_COST_PER_M;

  try {
    await db.insert(agentTraces).values({
      sessionId: context.sessionId,
      agentName: "grok-core",
      prompt: prompt.substring(0, 2000),
      response: message as any,
      toolCalls: message?.tool_calls ? (message.tool_calls as any) : null,
      tokensUsed: usage.total_tokens,
      costUsd: costUsd.toFixed(6),
      latencyMs,
    });
  } catch (err) {
    console.error("[Grok Core] Failed to log trace:", err);
  }

  return {
    content: message?.content || null,
    toolCalls: message?.tool_calls || null,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    costUsd,
  };
}
