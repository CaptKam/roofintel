import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 8192;

let requestsThisSecond = 0;
let lastResetTime = Date.now();

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  if (now - lastResetTime >= 1000) {
    requestsThisSecond = 0;
    lastResetTime = now;
  }
  if (requestsThisSecond >= 8) {
    const waitMs = 1000 - (now - lastResetTime) + 50;
    await new Promise(r => setTimeout(r, waitMs));
    requestsThisSecond = 0;
    lastResetTime = Date.now();
  }
  requestsThisSecond++;
}

export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export async function askClaude(
  prompt: string,
  systemPrompt?: string,
  retries = 3
): Promise<AiResponse> {
  await rateLimitWait();

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const params: Anthropic.MessageCreateParams = {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      };
      if (systemPrompt) {
        params.system = systemPrompt;
      }

      const message = await anthropic.messages.create(params);

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text)
        .join("");

      return {
        text,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      };
    } catch (error: any) {
      const isRateLimit = error?.status === 429 ||
        error?.message?.includes("429") ||
        error?.message?.toLowerCase()?.includes("rate limit");

      if (isRateLimit && attempt < retries - 1) {
        const backoff = Math.pow(2, attempt + 1) * 1000;
        console.log(`[ai-client] Rate limited, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`);
        await new Promise(r => setTimeout(r, backoff));
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

export async function askClaudeJson<T = any>(
  prompt: string,
  systemPrompt?: string
): Promise<{ data: T; tokens: number }> {
  const response = await askClaude(prompt, systemPrompt);

  let jsonStr = response.text;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const braceStart = jsonStr.indexOf("{");
    const bracketStart = jsonStr.indexOf("[");
    const start = braceStart >= 0 && (bracketStart < 0 || braceStart < bracketStart)
      ? braceStart
      : bracketStart;
    if (start >= 0) {
      const isArray = jsonStr[start] === "[";
      const end = isArray ? jsonStr.lastIndexOf("]") : jsonStr.lastIndexOf("}");
      if (end >= 0) {
        jsonStr = jsonStr.substring(start, end + 1);
      }
    }
  }

  try {
    const data = JSON.parse(jsonStr) as T;
    return { data, tokens: response.totalTokens };
  } catch {
    console.error("[ai-client] Failed to parse JSON response:", response.text.substring(0, 200));
    throw new Error("AI returned invalid JSON");
  }
}

export function estimateCost(totalTokens: number): number {
  return totalTokens * 0.0000008;
}
