import type OpenAI from "openai";
import { callGrok, isGrokConfigured, getBudgetRemaining, type GrokContext } from "./grok-proxy";
import { getToolSchemas, findTool } from "./tools/index";
import { storage } from "../storage";

const DFW_MARKET_ID = "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
const MAX_STEPS = 8;

export interface SupervisorContext {
  marketId?: string;
  sessionId: string;
  leadId?: string;
  sessionType?: string;
  history?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  leadContext?: Record<string, any>;
}

export interface SupervisorResult {
  plan: string;
  actions: Array<{ tool: string; args: any; result: any }>;
  confidence: number;
  evidence: string[];
  sessionId: string;
  history: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  totalTokens: number;
  totalCostUsd: number;
  error?: string;
}

function sanitizeMessagesForApi(
  messages: any[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages
    .filter((m: any) => m && m.role)
    .map((m: any) => {
      if (m.role === "user") {
        return { role: "user" as const, content: m.content || "" };
      }
      if (m.role === "assistant") {
        const msg: any = { role: "assistant" as const, content: m.content || null };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        return msg;
      }
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          tool_call_id: m.tool_call_id,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        };
      }
      return { role: m.role, content: m.content || "" };
    });
}

export async function runSupervisor(
  userPrompt: string,
  context: SupervisorContext
): Promise<SupervisorResult> {
  if (!isGrokConfigured()) {
    return {
      plan: "Grok Intelligence Core is not configured. Set XAI_API_KEY to enable AI-powered operations.",
      actions: [],
      confidence: 0,
      evidence: [],
      sessionId: context.sessionId,
      history: [],
      totalTokens: 0,
      totalCostUsd: 0,
      error: "not_configured",
    };
  }

  const marketId = context.marketId || DFW_MARKET_ID;
  const budgetRemaining = await getBudgetRemaining(marketId);

  let session = await storage.getAgentSession(context.sessionId);
  if (!session) {
    session = await storage.createAgentSession({
      sessionId: context.sessionId,
      marketId,
      leadId: context.leadId || null,
      sessionType: context.sessionType || "ops_chat",
      title: userPrompt.substring(0, 100),
      messages: [],
      metadata: {},
    });
  }

  const priorMessages = sanitizeMessagesForApi(
    context.history || (session.messages as any[]) || []
  );

  const history: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    ...priorMessages,
    { role: "user", content: userPrompt },
  ];

  const tools = getToolSchemas();
  const actions: SupervisorResult["actions"] = [];
  const evidence: string[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;
  let stepsRemaining = MAX_STEPS;
  let finalContent = "";

  while (stepsRemaining-- > 0) {
    const grokContext: GrokContext = {
      marketId,
      sessionId: context.sessionId,
      leadId: context.leadId,
      sessionType: context.sessionType,
      history,
      budgetRemaining,
      leadContext: context.leadContext,
    };

    let response;
    try {
      response = await callGrok("", grokContext, tools);
    } catch (err: any) {
      console.error("[Grok Core] API call failed:", err.message);
      if (finalContent) break;
      return {
        plan: `Grok API error: ${err.message || "Unknown error"}. Please try again.`,
        actions,
        confidence: 0,
        evidence,
        sessionId: context.sessionId,
        history,
        totalTokens,
        totalCostUsd,
        error: "api_error",
      };
    }

    totalTokens += response.totalTokens;
    totalCostUsd += response.costUsd;

    if (response.content) {
      finalContent = response.content;
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      if (response.content) {
        history.push({ role: "assistant", content: response.content });
      }
      break;
    }

    const assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "assistant",
      content: response.content || null,
      tool_calls: response.toolCalls,
    } as any;
    history.push(assistantMessage);

    for (const toolCall of response.toolCalls) {
      const tool = findTool(toolCall.function.name);
      if (!tool) {
        const errorResult = { error: `Unknown tool: ${toolCall.function.name}` };
        history.push({
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(errorResult),
        });
        continue;
      }

      let args: any;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        args = {};
      }

      console.log(`[Grok Core] Executing tool: ${tool.name}`, args);

      try {
        const result = await tool.execute(args);
        actions.push({ tool: tool.name, args, result });

        if (result.results) {
          for (const r of result.results) {
            if (r.link) evidence.push(r.link);
          }
        }

        history.push({
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      } catch (err: any) {
        const errorResult = { error: err.message || "Tool execution failed" };
        actions.push({ tool: tool.name, args, result: errorResult });
        history.push({
          role: "tool" as const,
          tool_call_id: toolCall.id,
          content: JSON.stringify(errorResult),
        });
      }
    }
  }

  const confidence = calculateConfidence(actions, finalContent);

  const storedMessages = [
    ...((session.messages as any[]) || []),
    { role: "user", content: userPrompt },
    {
      role: "assistant",
      content: finalContent,
      ...(actions.length > 0
        ? {
            tool_calls: actions.map((a, i) => ({
              id: `tool_${i}`,
              type: "function",
              function: { name: a.tool, arguments: JSON.stringify(a.args) },
            })),
          }
        : {}),
    },
  ];

  await storage.updateAgentSession(context.sessionId, {
    messages: storedMessages as any,
    title: session.title || userPrompt.substring(0, 100),
  });

  return {
    plan: finalContent,
    actions,
    confidence,
    evidence,
    sessionId: context.sessionId,
    history,
    totalTokens,
    totalCostUsd,
  };
}

function calculateConfidence(
  actions: SupervisorResult["actions"],
  content: string
): number {
  let score = 50;

  if (actions.length > 0) score += 15;
  if (actions.every(a => a.result && !a.result.error)) score += 15;
  if (content && content.length > 100) score += 10;
  if (actions.some(a => a.result?.count > 0 || a.result?.success)) score += 10;

  return Math.min(100, score);
}
