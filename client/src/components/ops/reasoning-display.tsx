import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Wrench,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";

interface Action {
  tool: string;
  args: Record<string, any>;
  result: any;
}

interface ReasoningDisplayProps {
  plan: string;
  actions: Action[];
  confidence: number;
  evidence: string[];
  totalTokens: number;
  totalCostUsd: number;
  onDismiss: () => void;
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 75)
    return (
      <Badge variant="default" className="bg-emerald-600" data-testid="badge-confidence-high">
        High Confidence ({score}%)
      </Badge>
    );
  if (score >= 50)
    return (
      <Badge variant="secondary" className="bg-amber-500 text-white" data-testid="badge-confidence-medium">
        Medium Confidence ({score}%)
      </Badge>
    );
  return (
    <Badge variant="destructive" data-testid="badge-confidence-low">
      Low Confidence ({score}%)
    </Badge>
  );
}

const TOOL_LABELS: Record<string, string> = {
  query_leads: "Searched database",
  trigger_roi_batch: "Ran ROI engine",
  recompute_zip_tiles: "Recomputed ZIP tiles",
  trigger_pipeline: "Triggered pipeline",
  web_search: "Searched the web",
};

export function ReasoningDisplay({
  plan,
  actions,
  confidence,
  evidence,
  totalTokens,
  totalCostUsd,
  onDismiss,
}: ReasoningDisplayProps) {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div
      className="border rounded-lg bg-card shadow-lg overflow-hidden"
      data-testid="reasoning-display"
    >
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium">Grok Response</span>
          <ConfidenceBadge score={confidence} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {totalTokens.toLocaleString()} tokens / ${totalCostUsd.toFixed(4)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onDismiss}
            data-testid="button-dismiss-reasoning"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-3 max-h-[50vh] overflow-y-auto">
        <div className="text-sm whitespace-pre-wrap leading-relaxed" data-testid="text-grok-response">
          {plan}
        </div>

        {actions.length > 0 && (
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs gap-1 px-0"
              onClick={() => setShowTrace(!showTrace)}
              data-testid="button-toggle-trace"
            >
              <Wrench className="h-3 w-3" />
              {actions.length} tool{actions.length !== 1 ? "s" : ""} used
              {showTrace ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>

            {showTrace && (
              <div className="mt-2 space-y-2">
                {actions.map((action, i) => (
                  <div
                    key={i}
                    className="border rounded p-2 bg-muted/30 text-xs"
                    data-testid={`trace-action-${i}`}
                  >
                    <div className="font-medium text-muted-foreground">
                      {TOOL_LABELS[action.tool] || action.tool}
                    </div>
                    {action.args && Object.keys(action.args).length > 0 && (
                      <div className="text-muted-foreground mt-1">
                        Args: {JSON.stringify(action.args)}
                      </div>
                    )}
                    {action.result?.count !== undefined && (
                      <div className="mt-1">
                        Returned {action.result.count} result{action.result.count !== 1 ? "s" : ""}
                      </div>
                    )}
                    {action.result?.error && (
                      <div className="mt-1 text-red-500">{action.result.error}</div>
                    )}
                    {action.result?.success === true && (
                      <div className="mt-1 text-emerald-600">Completed successfully</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {evidence.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Evidence Sources</div>
            {evidence.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                data-testid={`link-evidence-${i}`}
              >
                <ExternalLink className="h-3 w-3" />
                {url.length > 60 ? url.substring(0, 60) + "..." : url}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
