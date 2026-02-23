import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScoreBadge, ScoreDot } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Building2,
  MapPin,
  Ruler,
  Calendar,
  CloudLightning,
  SlidersHorizontal,
  X,
  ChevronRight,
  ChevronLeft,
  User,
  Phone,
  Mail,
  Fingerprint,
  HardHat,
  Download,
} from "lucide-react";
import type { Lead } from "@shared/schema";

const PAGE_SIZE = 50;

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

export default function Leads() {
  const { toast } = useToast();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [county, setCounty] = useState<string>(urlParams.get("county") || "");
  const [minScore, setMinScore] = useState<string>(urlParams.get("minScore") || "");
  const [zoning, setZoning] = useState<string>(urlParams.get("zoning") || "");
  const [status, setStatus] = useState<string>(urlParams.get("status") || "");
  const [hasPhone, setHasPhone] = useState(urlParams.get("hasPhone") === "true");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(!!urlParams.get("minScore") || !!urlParams.get("county") || !!urlParams.get("zoning") || !!urlParams.get("status") || urlParams.get("hasPhone") === "true");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const fresh = new URLSearchParams(searchString);
    const newMinScore = fresh.get("minScore") || "";
    const newCounty = fresh.get("county") || "";
    const newZoning = fresh.get("zoning") || "";
    const newStatus = fresh.get("status") || "";
    const newHasPhone = fresh.get("hasPhone") === "true";
    setMinScore(newMinScore);
    setCounty(newCounty);
    setZoning(newZoning);
    setStatus(newStatus);
    setHasPhone(newHasPhone);
    if (newMinScore || newCounty || newZoning || newStatus || newHasPhone) {
      setShowFilters(true);
    }
    setPage(1);
  }, [searchString]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, county, minScore, zoning, status, hasPhone]);

  const params = new URLSearchParams();
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (county) params.set("county", county);
  if (minScore) params.set("minScore", minScore);
  if (zoning) params.set("zoning", zoning);
  if (status) params.set("status", status);
  if (hasPhone) params.set("hasPhone", "true");
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String((page - 1) * PAGE_SIZE));

  const queryString = params.toString();

  const { data, isLoading } = useQuery<LeadsResponse>({
    queryKey: [`/api/leads?${queryString}`],
  });

  const leads = data?.leads;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasFilters = county || minScore || zoning || status || hasPhone;

  const clearFilters = () => {
    setCounty("");
    setMinScore("");
    setZoning("");
    setStatus("");
    setHasPhone(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportParams = new URLSearchParams();
      if (county) exportParams.set("county", county);
      if (minScore) exportParams.set("minScore", minScore);
      if (zoning) exportParams.set("zoning", zoning);
      const res = await fetch(`/api/leads/export?${exportParams.toString()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roofIntel-leads-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: `${total} leads exported to CSV` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
    setExporting(false);
  };

  const unmaskedCount = !isLoading && leads ? leads.filter(l => l.managingMember).length : 0;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Leads</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-sm text-muted-foreground">
              {isLoading ? "Loading..." : `${total.toLocaleString()} properties`} in your pipeline
            </p>
            {!isLoading && leads && unmaskedCount > 0 && (
              <Badge variant="secondary" className="no-default-hover-elevate no-default-active-elevate text-[10px] font-normal" data-testid="badge-unmasked-count">
                {unmaskedCount} unmasked
              </Badge>
            )}
          </div>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exporting || isLoading || total === 0}
          data-testid="button-export-csv"
        >
          <Download className="w-4 h-4 mr-1.5" />
          {exporting ? "Exporting..." : "Export CSV"}
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <Input
            placeholder="Search address, owner, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl bg-card"
            data-testid="input-search-leads"
          />
        </div>
        <Button
          variant={showFilters ? "secondary" : "outline"}
          onClick={() => setShowFilters(!showFilters)}
          data-testid="button-toggle-filters"
        >
          <SlidersHorizontal className="w-4 h-4 mr-1.5" />
          Filters
          {hasFilters && (
            <Badge variant="secondary" className="ml-1.5 text-[10px]">
              Active
            </Badge>
          )}
        </Button>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
            <X className="w-3 h-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {showFilters && (
        <Card>
          <CardContent className="p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">County</label>
                <Select value={county} onValueChange={setCounty}>
                  <SelectTrigger data-testid="select-county">
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Min Score</label>
                <Select value={minScore} onValueChange={setMinScore}>
                  <SelectTrigger data-testid="select-min-score">
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
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Zoning</label>
                <Select value={zoning} onValueChange={setZoning}>
                  <SelectTrigger data-testid="select-zoning">
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
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="contacted">Contacted</SelectItem>
                    <SelectItem value="qualified">Qualified</SelectItem>
                    <SelectItem value="proposal">Proposal</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Contact Info</label>
                <Button
                  variant={hasPhone ? "default" : "outline"}
                  className="w-full toggle-elevate"
                  onClick={() => setHasPhone(!hasPhone)}
                  data-testid="button-filter-has-phone"
                >
                  <Phone className="w-4 h-4 mr-1.5" />
                  Has Phone
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-0">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-4 border-b border-border/50">
              <Skeleton className="w-2 h-2 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-64 mb-2" />
                <Skeleton className="h-3 w-40" />
              </div>
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : leads && leads.length > 0 ? (
        <div>
          {leads.map((lead) => (
            <Link key={lead.id} href={`/leads/${lead.id}`}>
              <div
                className="flex items-center gap-4 py-4 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                data-testid={`card-lead-${lead.id}`}
              >
                <ScoreDot score={lead.leadScore} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium" data-testid={`text-address-${lead.id}`}>{lead.address}</p>
                    {lead.ownerType === "LLC" && (
                      <Badge variant="outline" className="text-[10px]">{lead.llcName || "LLC"}</Badge>
                    )}
                    {lead.claimWindowOpen && (
                      <Badge variant="default" className="text-[9px]" data-testid={`badge-claimable-${lead.id}`}>Claimable</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {lead.city}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Ruler className="w-3 h-3" />
                      {lead.sqft.toLocaleString()} sqft
                    </span>
                    {lead.roofLastReplaced && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Roof: {lead.roofLastReplaced}
                      </span>
                    )}
                    {lead.hailEvents > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <CloudLightning className="w-3 h-3" />
                        {lead.hailEvents} hail
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                      {lead.ownerName}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {(lead.ownerPhone || lead.contactPhone) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-phone-${lead.id}`}>
                        <Phone className="w-2.5 h-2.5" />
                        Phone
                      </span>
                    )}
                    {(lead.ownerEmail || lead.contactEmail) && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-email-${lead.id}`}>
                        <Mail className="w-2.5 h-2.5" />
                        Email
                      </span>
                    )}
                    {lead.managingMember && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-dm-${lead.id}`}>
                        <Fingerprint className="w-2.5 h-2.5" />
                        DM
                      </span>
                    )}
                    {(lead as any).permitContractors && (lead as any).permitContractors.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded" data-testid={`signal-permits-${lead.id}`}>
                        <HardHat className="w-2.5 h-2.5" />
                        {(lead as any).permitContractors.length}
                      </span>
                    )}
                    {lead.totalValue && lead.totalValue > 0 && (
                      <span className="text-[10px] text-muted-foreground ml-1 tabular-nums">
                        {lead.totalValue >= 1_000_000 ? `$${(lead.totalValue / 1_000_000).toFixed(1)}M` : `$${(lead.totalValue / 1_000).toFixed(0)}K`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <StatusBadge status={lead.status} />
                  <ScoreBadge score={lead.leadScore} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground/30" />
                </div>
              </div>
            </Link>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-6">
              <p className="text-xs text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <div className="flex items-center gap-0.5 px-2">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let pageNum: number;
                    if (totalPages <= 7) {
                      pageNum = i + 1;
                    } else if (page <= 4) {
                      pageNum = i + 1;
                    } else if (page >= totalPages - 3) {
                      pageNum = totalPages - 6 + i;
                    } else {
                      pageNum = page - 3 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        className={`min-w-[2rem] h-8 text-sm rounded-lg transition-colors ${
                          pageNum === page
                            ? "bg-primary text-primary-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => setPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-20 text-center">
          <Building2 className="w-10 h-10 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-base font-medium text-muted-foreground">No leads found</p>
          <p className="text-sm text-muted-foreground/60 mt-1.5">
            {hasFilters ? "Try adjusting your filters" : "Leads will appear here once data is loaded"}
          </p>
        </div>
      )}
    </div>
  );
}
