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
  Fingerprint,
} from "lucide-react";
import type { Lead } from "@shared/schema";

const PAGE_SIZE = 50;

interface LeadsResponse {
  leads: Lead[];
  total: number;
}

export default function Leads() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Leads</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isLoading ? "Loading..." : `${total.toLocaleString()} properties`} in your pipeline
          </p>
          {!isLoading && leads && (
            <p className="text-xs text-muted-foreground mt-1">
              {leads.filter(l => l.managingMember).length} unmasked
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search address, owner, or city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
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
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
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
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-4">
                  <Skeleton className="w-2 h-2 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-64 mb-2" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-5 w-20" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : leads && leads.length > 0 ? (
        <div className="space-y-1.5">
          {leads.map((lead) => (
            <Link key={lead.id} href={`/leads/${lead.id}`}>
              <Card className="hover-elevate cursor-pointer transition-colors" data-testid={`card-lead-${lead.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <ScoreDot score={lead.leadScore} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium" data-testid={`text-address-${lead.id}`}>{lead.address}</p>
                        {lead.ownerType === "LLC" && (
                          <Badge variant="outline" className="text-[10px]">{lead.llcName || "LLC"}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {lead.city}, {lead.county} Co.
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Ruler className="w-3 h-3" />
                          {lead.sqft.toLocaleString()} sqft
                          {lead.stories > 1 && ` (~${Math.round(lead.sqft / lead.stories).toLocaleString()} roof)`}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {lead.zoning}
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
                            {lead.hailEvents} hail hit{lead.hailEvents > 1 ? "s" : ""}
                            {lead.claimWindowOpen && (
                              <Badge variant="default" className="text-[9px] ml-0.5">Claimable</Badge>
                            )}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {lead.ownerName}
                        </span>
                        {lead.managingMember && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Fingerprint className="w-3 h-3" />
                            {lead.managingMember}
                          </span>
                        )}
                        {(lead.ownerPhone || lead.contactPhone) && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <Phone className="w-3 h-3" />
                            {lead.ownerPhone || lead.contactPhone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={lead.status} />
                      <ScoreBadge score={lead.leadScore} />
                      <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-4 pt-3">
              <p className="text-xs text-muted-foreground">
                Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <div className="flex items-center gap-1 px-2">
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
                      <Button
                        key={pageNum}
                        variant={pageNum === page ? "default" : "ghost"}
                        size="icon"
                        onClick={() => setPage(pageNum)}
                        data-testid={`button-page-${pageNum}`}
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>
                <Button
                  variant="outline"
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
        <Card>
          <CardContent className="p-12 text-center">
            <Building2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No leads found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              {hasFilters ? "Try adjusting your filters" : "Leads will appear here once data is loaded"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
