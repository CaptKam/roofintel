import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, History, ChevronUp } from "lucide-react";
import { ReasoningDisplay } from "./reasoning-display";

interface GrokResult {
  plan: string;
  actions: Array<{ tool: string; args: any; result: any }>;
  confidence: number;
  evidence: string[];
  sessionId: string;
  totalTokens: number;
  totalCostUsd: number;
  error?: string;
}

const EXAMPLE_PROMPTS = [
  "Find top 10 leads in 75001 with hail damage",
  "Which ZIP codes have the highest storm risk?",
  "Run ROI analysis on leads over $5M value",
  "How many leads have phone numbers in Dallas county?",
];

export function NaturalLanguageBar() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<GrokResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: sessions } = useQuery<any[]>({
    queryKey: ["/api/ops/grok-sessions"],
    enabled: showHistory,
  });

  const askMutation = useMutation({
    mutationFn: async (userPrompt: string) => {
      const res = await apiRequest("POST", "/api/ops/grok-ask", {
        prompt: userPrompt,
        sessionId: sessionId || undefined,
      });
      return res.json();
    },
    onSuccess: (data: GrokResult) => {
      setResult(data);
      setSessionId(data.sessionId);
      queryClient.invalidateQueries({ queryKey: ["/api/ops/grok-sessions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ops/grok-cost-summary"] });
    },
  });

  const handleSubmit = () => {
    if (!prompt.trim() || askMutation.isPending) return;
    askMutation.mutate(prompt.trim());
    setPrompt("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + "px";
    }
  }, [prompt]);

  return (
    <div className="space-y-3" data-testid="natural-language-bar">
      {result && (
        <ReasoningDisplay
          plan={result.plan}
          actions={result.actions}
          confidence={result.confidence}
          evidence={result.evidence}
          totalTokens={result.totalTokens}
          totalCostUsd={result.totalCostUsd}
          onDismiss={() => setResult(null)}
        />
      )}

      {askMutation.isError && (
        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-2" data-testid="text-grok-error">
          {(askMutation.error as any)?.message || "Failed to get response from Grok"}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Grok about your leads, storms, or operations..."
            className="min-h-[44px] max-h-[120px] resize-none pr-10 text-sm"
            rows={1}
            data-testid="input-grok-prompt"
          />
          {!prompt && !askMutation.isPending && (
            <div className="absolute bottom-1 left-3 flex gap-1 pointer-events-none">
              {EXAMPLE_PROMPTS.slice(0, 2).map((ex, i) => (
                <span key={i} className="text-[10px] text-muted-foreground/40">
                  {i > 0 ? " | " : ""}e.g. "{ex}"
                </span>
              ))}
            </div>
          )}
        </div>

        <Button
          onClick={() => setShowHistory(!showHistory)}
          variant="ghost"
          size="icon"
          className="h-[44px] w-[44px] shrink-0"
          data-testid="button-grok-history"
        >
          <History className="h-4 w-4" />
        </Button>

        <Button
          onClick={handleSubmit}
          disabled={!prompt.trim() || askMutation.isPending}
          className="h-[44px] w-[44px] shrink-0 bg-purple-600 hover:bg-purple-700"
          size="icon"
          data-testid="button-grok-send"
        >
          {askMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>

      {askMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse" data-testid="text-grok-thinking">
          <Sparkles className="h-4 w-4 text-purple-500" />
          Grok is thinking...
        </div>
      )}

      {showHistory && sessions && sessions.length > 0 && (
        <div className="border rounded-lg bg-card p-2 space-y-1 max-h-[200px] overflow-y-auto" data-testid="grok-session-history">
          <div className="text-xs font-medium text-muted-foreground px-2 pb-1">Recent Conversations</div>
          {sessions.slice(0, 10).map((s: any) => (
            <button
              key={s.sessionId}
              className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors truncate"
              onClick={() => {
                setSessionId(s.sessionId);
                setShowHistory(false);
              }}
              data-testid={`button-session-${s.sessionId}`}
            >
              <div className="truncate text-xs font-medium">{s.title || "Untitled"}</div>
              <div className="text-[10px] text-muted-foreground">
                {s.sessionType} | {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString() : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
