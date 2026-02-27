import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  Send,
  Loader2,
  X,
  Wrench,
  ExternalLink,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actions?: Array<{ tool: string; args: any }>;
  confidence?: number;
  timestamp?: string;
}

interface GrokChatPanelProps {
  leadId: string;
  leadAddress: string;
  onClose: () => void;
}

export function GrokChatPanel({ leadId, leadAddress, onClose }: GrokChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const askMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/grok-ask`, {
        prompt,
        sessionId: sessionId || undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.plan,
          actions: data.actions?.map((a: any) => ({ tool: a.tool, args: a.args })),
          confidence: data.confidence,
          timestamp: new Date().toISOString(),
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ["/api/ops/grok-cost-summary"] });
    },
  });

  const handleSend = () => {
    if (!input.trim() || askMutation.isPending) return;
    const prompt = input.trim();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: prompt, timestamp: new Date().toISOString() },
    ]);
    setInput("");
    askMutation.mutate(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, askMutation.isPending]);

  const TOOL_LABELS: Record<string, string> = {
    query_leads: "Searched database",
    trigger_roi_batch: "Ran ROI engine",
    recompute_zip_tiles: "Recomputed ZIP tiles",
    trigger_pipeline: "Triggered pipeline",
    web_search: "Searched the web",
  };

  return (
    <div
      className="flex flex-col h-full border-l bg-card"
      data-testid="grok-chat-panel"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <div>
            <div className="text-sm font-medium">Ask Grok</div>
            <div className="text-[10px] text-muted-foreground truncate max-w-[200px]">
              {leadAddress}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          data-testid="button-close-grok-chat"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && !askMutation.isPending && (
          <div className="text-center py-8 space-y-3" data-testid="grok-chat-empty">
            <Sparkles className="h-8 w-8 text-purple-300 mx-auto" />
            <div className="text-sm text-muted-foreground">
              Ask Grok anything about this property
            </div>
            <div className="space-y-1">
              {[
                "What's the storm damage risk for this property?",
                "Find the decision maker for this owner",
                "Is this property worth enriching?",
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setInput(suggestion)}
                  className="block w-full text-left text-xs text-muted-foreground hover:text-foreground py-1 px-2 rounded hover:bg-muted/50 transition-colors"
                  data-testid={`button-suggestion-${i}`}
                >
                  "{suggestion}"
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`chat-message-${i}`}
          >
            <div
              className={`rounded-lg px-3 py-2 max-w-[85%] text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>

              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/30 pt-1">
                  {msg.actions.map((a, j) => (
                    <div
                      key={j}
                      className="flex items-center gap-1 text-[10px] text-muted-foreground"
                    >
                      <Wrench className="h-3 w-3" />
                      {TOOL_LABELS[a.tool] || a.tool}
                    </div>
                  ))}
                </div>
              )}

              {msg.confidence !== undefined && (
                <div className="mt-1">
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4"
                  >
                    {msg.confidence >= 75 ? "High" : msg.confidence >= 50 ? "Medium" : "Low"} confidence
                  </Badge>
                </div>
              )}
            </div>
          </div>
        ))}

        {askMutation.isPending && (
          <div className="flex justify-start" data-testid="grok-chat-thinking">
            <div className="bg-muted rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analyzing...
            </div>
          </div>
        )}

        {askMutation.isError && (
          <div className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 rounded p-2" data-testid="grok-chat-error">
            Failed to get response. Please try again.
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t p-3 flex items-end gap-2">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this property..."
          className="min-h-[40px] max-h-[100px] resize-none text-sm"
          rows={1}
          data-testid="input-lead-grok-prompt"
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || askMutation.isPending}
          size="icon"
          className="h-[40px] w-[40px] shrink-0 bg-purple-600 hover:bg-purple-700"
          data-testid="button-lead-grok-send"
        >
          {askMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
