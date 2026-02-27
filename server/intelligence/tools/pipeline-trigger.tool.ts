export const name = "trigger_pipeline";

export const schema = {
  type: "function" as const,
  function: {
    name: "trigger_pipeline",
    description: "Trigger the data enrichment pipeline to process leads. Can run a full batch reprocess or target specific phases. The pipeline has 10 phases: owner-intel, tx-filing, phone-enrich, web-research, google-places, portfolio-detect, entity-resolve, compliance-check, score-recalc, roi-gate.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["full_batch", "single_phase"],
          description: "Run full pipeline or a single phase",
        },
        phase: {
          type: "string",
          description: "Phase ID to run (only used when mode=single_phase). Options: owner-intel, tx-filing, phone-enrich, web-research, google-places, portfolio-detect, entity-resolve, compliance-check, score-recalc, roi-gate",
        },
        limit: { type: "number", description: "Max leads to process (default: 50)" },
      },
      required: [],
    },
  },
};

export async function execute(args: any): Promise<any> {
  try {
    if (args.mode === "single_phase" && args.phase) {
      const { runPipelinePhase } = await import("../../pipeline-orchestrator");
      const result = await runPipelinePhase(args.phase, args.limit || 50);
      return { success: true, phase: args.phase, ...result };
    }

    const { runBatchReprocess } = await import("../../pipeline-orchestrator");
    const result = await runBatchReprocess(args.limit || 50);
    return { success: true, mode: "full_batch", ...result };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to trigger pipeline",
    };
  }
}
