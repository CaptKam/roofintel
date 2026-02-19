import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, Building2, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Lead } from "@shared/schema";

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

export default function Export() {
  const { toast } = useToast();
  const [minScore, setMinScore] = useState<string>("");
  const [county, setCounty] = useState<string>("");
  const [zoning, setZoning] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  const params = new URLSearchParams();
  if (minScore) params.set("minScore", minScore);
  if (county) params.set("county", county);
  if (zoning) params.set("zoning", zoning);
  const filterString = params.toString();
  const countParams = new URLSearchParams(params);
  countParams.set("limit", "1");
  const countQuery = countParams.toString();

  const { data } = useQuery<LeadsResponse>({
    queryKey: [`/api/leads?${countQuery}`],
  });
  const totalCount = data?.total ?? 0;

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/leads/export?${filterString}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roofIntel-leads-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: `${totalCount} leads exported to CSV` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setExporting(false);
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Export Leads</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Download filtered lead data as CSV for CRM import or direct mail campaigns
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-primary" />
                Export Filters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Min Score</label>
                  <Select value={minScore} onValueChange={setMinScore}>
                    <SelectTrigger data-testid="select-export-min-score">
                      <SelectValue placeholder="Any score" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any score</SelectItem>
                      <SelectItem value="80">80+ (Hot)</SelectItem>
                      <SelectItem value="60">60+ (Warm)</SelectItem>
                      <SelectItem value="40">40+ (Cool)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">County</label>
                  <Select value={county} onValueChange={setCounty}>
                    <SelectTrigger data-testid="select-export-county">
                      <SelectValue placeholder="All counties" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All counties</SelectItem>
                      <SelectItem value="Dallas">Dallas</SelectItem>
                      <SelectItem value="Tarrant">Tarrant</SelectItem>
                      <SelectItem value="Collin">Collin</SelectItem>
                      <SelectItem value="Denton">Denton</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Zoning</label>
                  <Select value={zoning} onValueChange={setZoning}>
                    <SelectTrigger data-testid="select-export-zoning">
                      <SelectValue placeholder="All zoning" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All zoning</SelectItem>
                      <SelectItem value="Commercial">Commercial</SelectItem>
                      <SelectItem value="Multi-Family">Multi-Family</SelectItem>
                      <SelectItem value="Industrial">Industrial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 pt-2 border-t flex-wrap">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {data ? `${totalCount.toLocaleString()} leads match your filters` : "Loading..."}
                  </span>
                </div>
                <Button
                  onClick={handleExport}
                  disabled={exporting || !data || totalCount === 0}
                  data-testid="button-export-csv"
                >
                  <Download className="w-4 h-4 mr-1.5" />
                  {exporting ? "Exporting..." : "Export CSV"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Export Fields
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">The CSV export includes these data fields:</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Address", "City", "County", "Zip", "Sqft", "Year Built",
                  "Zoning", "Roof Year", "Roof Material", "Hail Events",
                  "Last Hail", "Owner Name", "Owner Type", "LLC",
                  "Phone", "Email", "Score", "Status", "Total Value",
                ].map((field) => (
                  <Badge key={field} variant="secondary" className="text-[10px]">{field}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
