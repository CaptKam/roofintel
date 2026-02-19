import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  new: { label: "New", className: "bg-primary/15 text-primary" },
  contacted: { label: "Contacted", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
  qualified: { label: "Qualified", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  proposal: { label: "Proposal", className: "bg-purple-500/15 text-purple-700 dark:text-purple-400" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.new;
  return (
    <Badge
      variant="secondary"
      className={cn("no-default-hover-elevate no-default-active-elevate text-xs", config.className)}
    >
      {config.label}
    </Badge>
  );
}
