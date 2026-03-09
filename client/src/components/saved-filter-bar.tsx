import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Plus, X, Star, Trash2 } from "lucide-react";
import type { SavedFilter } from "@shared/schema";

interface FilterState {
  [key: string]: string | boolean | number | undefined;
}

interface SavedFilterBarProps {
  currentFilters: FilterState;
  onApplyFilter: (filters: FilterState) => void;
  onClearFilters: () => void;
}

const FILTER_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316",
];

const SMART_PRESETS: Array<{ name: string; icon: string; filters: FilterState; color: string }> = [
  {
    name: "Hot Claim Windows",
    icon: "\uD83D\uDD25",
    filters: { lastHailWithin: 12, minRoofAge: 15, claimWindowOpen: true },
    color: "#ef4444",
  },
  {
    name: "Big Box Warehouses",
    icon: "\uD83C\uDFE2",
    filters: { minRoofArea: 50000, zoning: "Commercial" },
    color: "#3b82f6",
  },
  {
    name: "High Value Targets",
    icon: "\uD83D\uDCB0",
    filters: { minPropertyValue: 5000000, minScore: 60 },
    color: "#10b981",
  },
  {
    name: "Storm Damaged",
    icon: "\u26A1",
    filters: { lastHailWithin: 6, riskTier: "critical" },
    color: "#f59e0b",
  },
  {
    name: "Ready to Contact",
    icon: "\uD83D\uDCDE",
    filters: { hasPhone: true, minScore: 60, status: "new" },
    color: "#8b5cf6",
  },
];

function hasActiveFilters(filters: FilterState): boolean {
  return Object.entries(filters).some(([key, val]) => {
    if (key === "limit" || key === "offset" || key === "search") return false;
    if (val === undefined || val === "" || val === false) return false;
    if (val === "all" || val === "any") return false;
    return true;
  });
}

function filtersMatch(a: FilterState, b: FilterState): boolean {
  const keysToCompare = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keysToCompare) {
    if (key === "limit" || key === "offset" || key === "search") continue;
    const va = a[key];
    const vb = b[key];
    const emptyA = va === undefined || va === "" || va === false || va === "all" || va === "any";
    const emptyB = vb === undefined || vb === "" || vb === false || vb === "all" || vb === "any";
    if (emptyA && emptyB) continue;
    if (String(va) !== String(vb)) return false;
  }
  return true;
}

export function SavedFilterBar({ currentFilters, onApplyFilter, onClearFilters }: SavedFilterBarProps) {
  const { toast } = useToast();
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveName, setSaveName] = useState("");

  const { data: savedFilters } = useQuery<SavedFilter[]>({
    queryKey: ["/api/saved-filters"],
  });

  const createFilter = useMutation({
    mutationFn: async (data: { name: string; filters: FilterState; color: string }) => {
      const res = await apiRequest("POST", "/api/saved-filters", {
        name: data.name,
        filters: data.filters,
        color: data.color,
        isDefault: false,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters"] });
      toast({ title: "Filter saved" });
      setShowSaveInput(false);
      setSaveName("");
    },
    onError: () => {
      toast({ title: "Failed to save filter", variant: "destructive" });
    },
  });

  const deleteFilter = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-filters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/saved-filters"] });
      toast({ title: "Filter deleted" });
    },
  });

  const handleSave = () => {
    if (!saveName.trim()) return;
    const cleanFilters: FilterState = {};
    for (const [key, val] of Object.entries(currentFilters)) {
      if (key === "limit" || key === "offset" || key === "search") continue;
      if (val === undefined || val === "" || val === false || val === "all" || val === "any") continue;
      cleanFilters[key] = val;
    }
    const color = FILTER_COLORS[Math.floor(Math.random() * FILTER_COLORS.length)];
    createFilter.mutate({ name: saveName.trim(), filters: cleanFilters, color });
  };

  const activeFilterCount = Object.entries(currentFilters).filter(([key, val]) => {
    if (key === "limit" || key === "offset" || key === "search") return false;
    if (val === undefined || val === "" || val === false || val === "all" || val === "any") return false;
    return true;
  }).length;

  const hasUnsavedActive = hasActiveFilters(currentFilters) &&
    !(savedFilters || []).some(sf => filtersMatch(sf.filters as FilterState, currentFilters));

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="saved-filter-bar">
      <Bookmark className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

      {SMART_PRESETS.map((preset) => {
        const isActive = filtersMatch(preset.filters, currentFilters);
        return (
          <Button
            key={preset.name}
            variant={isActive ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs rounded-full px-3 gap-1"
            onClick={() => {
              if (isActive) {
                onClearFilters();
              } else {
                onApplyFilter(preset.filters);
              }
            }}
            data-testid={`button-preset-${preset.name.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <span>{preset.icon}</span>
            {preset.name}
          </Button>
        );
      })}

      {(savedFilters || []).length > 0 && (
        <div className="w-px h-5 bg-border shrink-0" />
      )}

      {(savedFilters || []).map((sf) => {
        const isActive = filtersMatch(sf.filters as FilterState, currentFilters);
        return (
          <div key={sf.id} className="group relative">
            <Button
              variant={isActive ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs rounded-full px-3 gap-1.5"
              onClick={() => {
                if (isActive) {
                  onClearFilters();
                } else {
                  onApplyFilter(sf.filters as FilterState);
                }
              }}
              data-testid={`button-saved-filter-${sf.id}`}
            >
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: sf.color || "#3b82f6" }}
              />
              {sf.name}
              {sf.isDefault && <Star className="w-2.5 h-2.5 opacity-50" />}
            </Button>
            <button
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                deleteFilter.mutate(sf.id);
              }}
              data-testid={`button-delete-filter-${sf.id}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      {hasUnsavedActive && !showSaveInput && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs rounded-full px-3 border-dashed"
          onClick={() => setShowSaveInput(true)}
          data-testid="button-save-current-filter"
        >
          <Plus className="w-3 h-3 mr-1" />
          Save Filter
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-[9px] px-1 py-0 h-4">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      )}

      {showSaveInput && (
        <div className="flex items-center gap-1.5">
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Filter name..."
            className="h-7 text-xs w-36 rounded-full"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") { setShowSaveInput(false); setSaveName(""); }
            }}
            data-testid="input-save-filter-name"
          />
          <Button
            variant="default"
            size="sm"
            className="h-7 text-xs rounded-full px-2"
            onClick={handleSave}
            disabled={!saveName.trim() || createFilter.isPending}
            data-testid="button-confirm-save-filter"
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-full"
            onClick={() => { setShowSaveInput(false); setSaveName(""); }}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
