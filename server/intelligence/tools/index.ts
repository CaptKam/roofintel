import * as dbQuery from "./db-query.tool";
import * as roiTrigger from "./roi-trigger.tool";
import * as zipCompute from "./zip-compute.tool";
import * as pipelineTrigger from "./pipeline-trigger.tool";
import * as webSearch from "./web-search.tool";
import type OpenAI from "openai";

export interface Tool {
  name: string;
  schema: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  };
  execute: (args: any) => Promise<any>;
}

export const ALL_TOOLS: Tool[] = [
  dbQuery,
  roiTrigger,
  zipCompute,
  pipelineTrigger,
  webSearch,
];

export function getToolSchemas(): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return ALL_TOOLS.map(t => t.schema as OpenAI.Chat.Completions.ChatCompletionTool);
}

export function findTool(name: string): Tool | undefined {
  return ALL_TOOLS.find(t => t.name === name);
}
