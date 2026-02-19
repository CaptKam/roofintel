import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function ScoreBadge({ score, className }: { score: number; className?: string }) {
  const getScoreColor = (s: number) => {
    if (s >= 80) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    if (s >= 60) return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    if (s >= 40) return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
    return "bg-muted text-muted-foreground";
  };

  const getLabel = (s: number) => {
    if (s >= 80) return "Hot";
    if (s >= 60) return "Warm";
    if (s >= 40) return "Cool";
    return "Cold";
  };

  return (
    <Badge
      variant="secondary"
      className={cn("no-default-hover-elevate no-default-active-elevate font-mono text-xs", getScoreColor(score), className)}
    >
      {score} - {getLabel(score)}
    </Badge>
  );
}

export function ScoreDot({ score }: { score: number }) {
  const getColor = (s: number) => {
    if (s >= 80) return "bg-emerald-500";
    if (s >= 60) return "bg-amber-500";
    if (s >= 40) return "bg-orange-500";
    return "bg-muted-foreground/50";
  };

  return <div className={cn("w-2 h-2 rounded-full", getColor(score))} />;
}
