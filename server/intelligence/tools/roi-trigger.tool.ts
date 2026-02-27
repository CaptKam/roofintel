export const name = "trigger_roi_batch";

export const schema = {
  type: "function" as const,
  function: {
    name: "trigger_roi_batch",
    description: "Run the Enrichment ROI Engine on leads for a market. Evaluates each lead's expected value vs enrichment cost and assigns ROI tiers (skip, tier1, tier2, tier3, premium). Optionally filter by ZIP code.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "Market ID to run ROI on (default: DFW)" },
        zipCode: { type: "string", description: "Optional: limit to a specific ZIP code" },
      },
      required: [],
    },
  },
};

export async function execute(args: any): Promise<any> {
  try {
    const { runBatch } = await import("../../enrichment-roi-agent");
    const marketId = args.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
    const result = await runBatch(marketId, undefined, args.zipCode);
    return {
      success: true,
      ...result,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to run ROI batch",
    };
  }
}
