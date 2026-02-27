import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useMarket } from "@/hooks/use-market";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Sparkles,
  Loader2,
  MapPin,
  Target,
} from "lucide-react";
import type { Sector } from "@shared/schema";

interface ZipTile {
  id: string;
  zipCode: string;
  marketId: string;
  compositeScore?: number | null;
}

const SECTOR_COLORS = [
  "#3B82F6",
  "#EF4444",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
  "#14B8A6",
  "#6366F1",
  "#84CC16",
  "#E11D48",
];

function PriorityBadge({ priority }: { priority: string }) {
  const variant = priority === "high" ? "destructive" : priority === "low" ? "outline" : "secondary";
  return (
    <Badge variant={variant} data-testid={`badge-priority-${priority}`}>
      {priority}
    </Badge>
  );
}

interface SectorFormData {
  name: string;
  description: string;
  color: string;
  zipCodes: string[];
  priority: string;
  assignedTo: string;
  notes: string;
}

const defaultFormData: SectorFormData = {
  name: "",
  description: "",
  color: SECTOR_COLORS[0],
  zipCodes: [],
  priority: "medium",
  assignedTo: "",
  notes: "",
};

export function SectorManager() {
  const { activeMarket } = useMarket();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [formData, setFormData] = useState<SectorFormData>(defaultFormData);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const marketId = activeMarket?.id;

  const { data: sectors, isLoading: sectorsLoading } = useQuery<Sector[]>({
    queryKey: ["/api/sectors", marketId],
    queryFn: async () => {
      const res = await fetch(`/api/sectors?marketId=${marketId || ""}`);
      if (!res.ok) throw new Error("Failed to fetch sectors");
      return res.json();
    },
    enabled: !!marketId,
  });

  const { data: zipTiles, isLoading: zipsLoading } = useQuery<ZipTile[]>({
    queryKey: ["/api/zip-tiles", marketId],
    queryFn: async () => {
      const res = await fetch(`/api/zip-tiles?marketId=${marketId || ""}`);
      if (!res.ok) throw new Error("Failed to fetch zip tiles");
      return res.json();
    },
    enabled: !!marketId,
  });

  const availableZips = zipTiles?.map((t) => t.zipCode).sort() || [];

  const usedZips = new Set(
    (sectors || []).flatMap((s) => s.zipCodes).filter(Boolean)
  );

  const createMutation = useMutation({
    mutationFn: async (data: SectorFormData) => {
      const res = await apiRequest("POST", "/api/sectors", {
        ...data,
        marketId,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sector created" });
      queryClient.invalidateQueries({ queryKey: ["/api/sectors", marketId] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create sector", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SectorFormData> }) => {
      const res = await apiRequest("PATCH", `/api/sectors/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sector updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sectors", marketId] });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Failed to update sector", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/sectors/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Sector deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/sectors", marketId] });
      setDeleteConfirmId(null);
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete sector", description: err.message, variant: "destructive" });
    },
  });

  const computeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/sectors/${id}/compute`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Score recomputed" });
      queryClient.invalidateQueries({ queryKey: ["/api/sectors", marketId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to compute score", description: err.message, variant: "destructive" });
    },
  });

  const autoGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sectors/auto-generate", { marketId });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: data.message || "Sectors generated" });
      queryClient.invalidateQueries({ queryKey: ["/api/sectors", marketId] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to auto-generate sectors", description: err.message, variant: "destructive" });
    },
  });

  function openCreateDialog() {
    setEditingSector(null);
    setFormData({
      ...defaultFormData,
      color: SECTOR_COLORS[Math.floor(Math.random() * SECTOR_COLORS.length)],
    });
    setDialogOpen(true);
  }

  function openEditDialog(sector: Sector) {
    setEditingSector(sector);
    setFormData({
      name: sector.name,
      description: sector.description || "",
      color: sector.color,
      zipCodes: sector.zipCodes || [],
      priority: sector.priority,
      assignedTo: sector.assignedTo || "",
      notes: sector.notes || "",
    });
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingSector(null);
    setFormData(defaultFormData);
  }

  function handleSubmit() {
    if (!formData.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (formData.zipCodes.length === 0) {
      toast({ title: "Select at least one ZIP code", variant: "destructive" });
      return;
    }
    if (editingSector) {
      updateMutation.mutate({ id: editingSector.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  }

  function toggleZip(zip: string) {
    setFormData((prev) => ({
      ...prev,
      zipCodes: prev.zipCodes.includes(zip)
        ? prev.zipCodes.filter((z) => z !== zip)
        : [...prev.zipCodes, zip],
    }));
  }

  if (!marketId) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted-foreground" data-testid="text-no-market">
            Select a market to manage sectors.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Target className="w-4 h-4" />
            Sector Management
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => autoGenerateMutation.mutate()}
              disabled={autoGenerateMutation.isPending}
              data-testid="button-auto-generate"
            >
              {autoGenerateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1" />
              )}
              Auto-Generate
            </Button>
            <Button
              size="sm"
              onClick={openCreateDialog}
              data-testid="button-new-sector"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Sector
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          {sectorsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !sectors || sectors.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-sectors">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>No sectors defined for this market.</p>
              <p className="mt-1">Create sectors manually or use Auto-Generate to cluster ZIP codes.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-center">ZIPs</TableHead>
                    <TableHead className="text-center">Score</TableHead>
                    <TableHead className="text-center">Leads</TableHead>
                    <TableHead className="text-center">Priority</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sectors.map((sector) => (
                    <TableRow key={sector.id} data-testid={`row-sector-${sector.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: sector.color }}
                            data-testid={`color-swatch-${sector.id}`}
                          />
                          <span className="font-medium" data-testid={`text-sector-name-${sector.id}`}>
                            {sector.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-zip-count-${sector.id}`}>
                        {sector.zipCodes?.length || 0}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-sector-score-${sector.id}`}>
                        {sector.sectorScore ?? "—"}
                      </TableCell>
                      <TableCell className="text-center" data-testid={`text-lead-count-${sector.id}`}>
                        {sector.leadCount}
                      </TableCell>
                      <TableCell className="text-center">
                        <PriorityBadge priority={sector.priority} />
                      </TableCell>
                      <TableCell data-testid={`text-assigned-${sector.id}`}>
                        {sector.assignedTo || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => computeMutation.mutate(sector.id)}
                            disabled={computeMutation.isPending}
                            data-testid={`button-recompute-${sector.id}`}
                          >
                            {computeMutation.isPending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditDialog(sector)}
                            data-testid={`button-edit-${sector.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleteConfirmId(sector.id)}
                            data-testid={`button-delete-${sector.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingSector ? "Edit Sector" : "New Sector"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. North COS"
                data-testid="input-sector-name"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                placeholder="Optional description"
                className="resize-none"
                data-testid="input-sector-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">Color</Label>
                <div className="flex items-center gap-2 flex-wrap">
                  {SECTOR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`w-6 h-6 rounded-full border-2 transition-all ${formData.color === c ? "border-foreground scale-110" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setFormData((p) => ({ ...p, color: c }))}
                      data-testid={`color-option-${c.replace("#", "")}`}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm">Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(v) => setFormData((p) => ({ ...p, priority: v }))}
                >
                  <SelectTrigger data-testid="select-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Assigned To</Label>
              <Input
                value={formData.assignedTo}
                onChange={(e) => setFormData((p) => ({ ...p, assignedTo: e.target.value }))}
                placeholder="Sales rep name"
                data-testid="input-assigned-to"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">
                ZIP Codes ({formData.zipCodes.length} selected)
              </Label>
              {zipsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : availableZips.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No ZIP tiles found. Compute ZIP tiles first from the Data Quality tab.
                </p>
              ) : (
                <div className="border rounded-md p-2 max-h-48 overflow-y-auto">
                  <div className="flex flex-wrap gap-1.5">
                    {availableZips.map((zip) => {
                      const selected = formData.zipCodes.includes(zip);
                      const usedElsewhere = !selected && usedZips.has(zip) && (!editingSector || !editingSector.zipCodes?.includes(zip));
                      return (
                        <button
                          key={zip}
                          type="button"
                          onClick={() => toggleZip(zip)}
                          disabled={usedElsewhere}
                          className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
                            selected
                              ? "bg-primary text-primary-foreground border-primary"
                              : usedElsewhere
                                ? "bg-muted text-muted-foreground border-muted cursor-not-allowed opacity-50"
                                : "bg-background border-border hover-elevate"
                          }`}
                          data-testid={`zip-option-${zip}`}
                        >
                          {zip}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Optional notes"
                className="resize-none"
                data-testid="input-sector-notes"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} data-testid="button-cancel">
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              data-testid="button-save-sector"
            >
              {(createMutation.isPending || updateMutation.isPending) && (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              )}
              {editingSector ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Sector</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete this sector? This action cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)} data-testid="button-cancel-delete">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
