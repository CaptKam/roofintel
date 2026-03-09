import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2, X, Wand2 } from "lucide-react";

interface AIFilterBarProps {
  marketId?: string;
  onApplyFilters: (filters: Record<string, any>) => void;
}

const SUGGESTIONS = [
  "Hot leads in Dallas with hail damage",
  "Commercial properties with old roofs over 20 years",
  "High value leads with open claim windows",
  "TPO roofs in Tarrant county scored above 70",
];

export function AIFilterBar({ marketId, onApplyFilters }: AIFilterBarProps) {
  const [query, setQuery] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<Record<string, any> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseMutation = useMutation({
    mutationFn: async (userQuery: string) => {
      const res = await apiRequest("POST", "/api/leads/ai-filter", {
        query: userQuery,
        marketId,
      });
      return res.json();
    },
    onSuccess: (data: { filters: Record<string, any>; query: string }) => {
      const filterCount = Object.keys(data.filters).length;
      if (filterCount > 0) {
        onApplyFilters(data.filters);
        setAppliedFilters(data.filters);
        setLastQuery(data.query);
      } else {
        setAppliedFilters({});
        setLastQuery(data.query);
      }
    },
  });

  const handleSubmit = () => {
    if (!query.trim() || parseMutation.isPending) return;
    parseMutation.mutate(query.trim());
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClear = () => {
    setAppliedFilters(null);
    setLastQuery("");
    onApplyFilters({});
  };

  const filterLabels: Record<string, string> = {
    county: "County",
    minScore: "Min Score",
    zoning: "Zoning",
    status: "Status",
    hasPhone: "Has Phone",
    hasEmail: "Has Email",
    minRoofAge: "Roof Age",
    minRoofArea: "Roof Area",
    lastHailWithin: "Hail Within",
    claimWindowOpen: "Claim Open",
    minPropertyValue: "Min Value",
    ownershipStructure: "Ownership",
    roofType: "Roof Type",
    riskTier: "Risk Tier",
    sortBy: "Sort By",
  };

  const formatFilterValue = (key: string, value: any): string => {
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (key === "lastHailWithin") return `${value}mo`;
    if (key === "minPropertyValue") return `$${Number(value).toLocaleString()}`;
    if (key === "minRoofArea") return `${Number(value).toLocaleString()} sqft`;
    if (key === "minRoofAge") return `${value}+ yrs`;
    if (key === "minScore") return `${value}+`;
    return String(value);
  };

  return (
    <div className="space-y-2" data-testid="ai-filter-bar">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-500" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Try: 'Show me hot leads with hail damage in Dallas county'"
            className="pl-9 pr-10 h-11 rounded-xl bg-card border-purple-200 dark:border-purple-900 focus-visible:ring-purple-500"
            disabled={parseMutation.isPending}
            data-testid="input-ai-filter"
          />
          {parseMutation.isPending && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-500 animate-spin" />
          )}
        </div>
        <Button
          onClick={handleSubmit}
          disabled={!query.trim() || parseMutation.isPending}
          className="h-11 px-4 bg-purple-600 hover:bg-purple-700 text-white shrink-0"
          data-testid="button-ai-filter-submit"
        >
          {parseMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-1.5" />
              AI Filter
            </>
          )}
        </Button>
      </div>

      {!query && !lastQuery && !parseMutation.isPending && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">Try:</span>
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setQuery(s);
                inputRef.current?.focus();
              }}
              className="text-[11px] text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-300 hover:underline transition-colors"
              data-testid={`button-ai-suggestion-${i}`}
            >
              {s}{i < SUGGESTIONS.length - 1 ? " ·" : ""}
            </button>
          ))}
        </div>
      )}

      {parseMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse" data-testid="text-ai-filter-thinking">
          <Sparkles className="h-3.5 w-3.5 text-purple-500" />
          Parsing your query with AI...
        </div>
      )}

      {appliedFilters && Object.keys(appliedFilters).length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap" data-testid="ai-filter-applied">
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-purple-500" />
            AI applied:
          </span>
          {Object.entries(appliedFilters).map(([key, value]) => (
            <Badge
              key={key}
              variant="secondary"
              className="text-[10px] bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800"
              data-testid={`badge-ai-filter-${key}`}
            >
              {filterLabels[key] || key}: {formatFilterValue(key, value)}
            </Badge>
          ))}
          <button
            onClick={handleClear}
            className="text-[11px] text-muted-foreground hover:text-foreground ml-1"
            data-testid="button-ai-filter-clear"
          >
            <X className="h-3 w-3 inline" /> Clear
          </button>
        </div>
      )}

      {appliedFilters && Object.keys(appliedFilters).length === 0 && lastQuery && (
        <div className="text-[11px] text-amber-600 dark:text-amber-400" data-testid="text-ai-filter-no-match">
          No filters could be extracted from "{lastQuery}". Try being more specific about counties, roof age, hail, scores, etc.
        </div>
      )}

      {parseMutation.isError && (
        <div className="text-[11px] text-red-500" data-testid="text-ai-filter-error">
          {(parseMutation.error as any)?.message || "Failed to parse query. Please try again."}
        </div>
      )}
    </div>
  );
}
