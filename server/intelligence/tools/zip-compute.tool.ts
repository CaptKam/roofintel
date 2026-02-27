export const name = "recompute_zip_tiles";

export const schema = {
  type: "function" as const,
  function: {
    name: "recompute_zip_tiles",
    description: "Recompute ZIP-code-level composite scores for a market. Scores combine storm risk, roof age, data gaps, property value, and lead density. Use this when the user wants updated ZIP priority rankings.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "Market ID (default: DFW)" },
      },
      required: [],
    },
  },
};

export async function execute(args: any): Promise<any> {
  try {
    const { computeZipTiles } = await import("../../zip-tile-scorer");
    const marketId = args.marketId || "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
    const result = await computeZipTiles(marketId);
    return {
      success: true,
      ...result,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Failed to compute ZIP tiles",
    };
  }
}
