export const name = "web_search";

export const schema = {
  type: "function" as const,
  function: {
    name: "web_search",
    description: "Search the web for information about a property, owner, or company. Uses Google search via Serper API. Useful for finding decision-maker contacts, company details, management companies, or property ownership information.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string (e.g., 'ABC Holdings LLC Dallas TX property management')" },
        numResults: { type: "number", description: "Number of results to return (default: 5, max: 10)" },
      },
      required: ["query"],
    },
  },
};

export async function execute(args: any): Promise<any> {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    return {
      success: false,
      error: "Web search not available — SERPER_API_KEY not configured",
      suggestion: "Configure SERPER_API_KEY to enable web search capabilities",
    };
  }

  try {
    const numResults = Math.min(args.numResults || 5, 10);

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: args.query,
        num: numResults,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Serper API error: ${response.status}` };
    }

    const data = await response.json();
    const results = (data.organic || []).slice(0, numResults).map((r: any) => ({
      title: r.title,
      snippet: r.snippet,
      link: r.link,
    }));

    return {
      success: true,
      query: args.query,
      resultCount: results.length,
      results,
      knowledgeGraph: data.knowledgeGraph || null,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Web search failed",
    };
  }
}
