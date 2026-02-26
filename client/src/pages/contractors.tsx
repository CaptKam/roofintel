import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { PageMeta } from "@/components/page-meta";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Search,
  Phone,
  Mail,
  MapPin,
  HardHat,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Building2,
  ExternalLink,
  Calendar,
  DollarSign,
} from "lucide-react";

interface Contractor {
  contractor_name: string;
  permit_count: string;
  roofing_permit_count: string;
  most_recent_permit: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface ContractorsResponse {
  contractors: Contractor[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

interface ContractorPermit {
  id: string;
  permit_number: string;
  permit_type: string;
  issued_date: string | null;
  address: string;
  city: string;
  zip_code: string;
  work_description: string;
  estimated_value: number | null;
  sqft: number | null;
  lead_id: string | null;
}

interface LinkedLead {
  id: string;
  address: string;
  city: string;
  owner_name: string;
  lead_score: number;
  total_value: number;
}

function formatContractorName(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(/\s+\d/);
  let name = parts[0].trim();
  name = name.replace(/\\+/g, "").replace(/\s*\/\d+$/, "").replace(/,\s*$/, "").trim();
  return name
    .split(" ")
    .map((w) => {
      if (["LLC", "INC", "DBA", "CO", "LP", "LTD", "CORP"].includes(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(val: number | null): string {
  if (!val) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(val);
}

function ContractorRow({ contractor }: { contractor: Contractor }) {
  const [expanded, setExpanded] = useState(false);
  const displayName = formatContractorName(contractor.contractor_name);
  const permitCount = parseInt(contractor.permit_count);
  const roofingCount = parseInt(contractor.roofing_permit_count);

  const { data: detail } = useQuery<{ permits: ContractorPermit[]; linkedLeads: LinkedLead[] }>({
    queryKey: ["/api/contractors", contractor.contractor_name, "permits"],
    queryFn: async () => {
      const res = await fetch(`/api/contractors/${encodeURIComponent(contractor.contractor_name)}/permits`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: expanded,
  });

  return (
    <div className="border-b last:border-b-0" data-testid={`contractor-row-${contractor.contractor_name.slice(0, 20).trim()}`}>
      <div
        className="flex items-center gap-4 py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <HardHat className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-contractor-name">{displayName}</p>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {contractor.city && contractor.state && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {contractor.city}, {contractor.state}
              </span>
            )}
            {contractor.most_recent_permit && (
              <span className="text-[11px] text-muted-foreground">
                Last: {formatDate(contractor.most_recent_permit)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
          {contractor.phone && (
            <a
              href={`tel:${contractor.phone}`}
              className="text-xs font-mono text-primary hover:underline flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              data-testid="link-contractor-phone"
            >
              <Phone className="w-3 h-3" />
              {contractor.phone}
            </a>
          )}
          {contractor.email && (
            <a
              href={`mailto:${contractor.email}`}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
              data-testid="link-contractor-email"
            >
              <Mail className="w-3 h-3" />
              {contractor.email}
            </a>
          )}
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            {permitCount} permit{permitCount !== 1 ? "s" : ""}
          </Badge>
          {roofingCount > 0 && (
            <Badge variant="outline" className="text-[10px] tabular-nums text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-700">
              {roofingCount} roofing
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1">
          {!detail ? (
            <div className="text-sm text-muted-foreground py-2">Loading permits...</div>
          ) : (
            <div className="space-y-4">
              {detail.linkedLeads.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Properties Worked On</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {detail.linkedLeads.map((lead) => (
                      <Link key={lead.id} href={`/leads/${lead.id}`}>
                        <div className="flex items-center gap-2 p-2 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer" data-testid={`link-lead-${lead.id}`}>
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{lead.address}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{lead.owner_name}</p>
                          </div>
                          <ExternalLink className="w-3 h-3 text-muted-foreground/40 flex-shrink-0" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Permit History ({detail.permits.length})
                </p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {detail.permits.slice(0, 50).map((permit) => (
                    <div key={permit.id} className="flex items-start gap-3 py-1.5 text-xs">
                      <span className="text-muted-foreground tabular-nums flex-shrink-0 w-20">
                        {formatDate(permit.issued_date)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{permit.work_description || permit.permit_type}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5 flex-wrap">
                          <span>{permit.address}{permit.city ? `, ${permit.city}` : ""}</span>
                          {permit.estimated_value && (
                            <span className="flex items-center gap-0.5">
                              <DollarSign className="w-2.5 h-2.5" />
                              {formatCurrency(permit.estimated_value)}
                            </span>
                          )}
                          {permit.lead_id && (
                            <Link href={`/leads/${permit.lead_id}`}>
                              <span className="text-primary hover:underline cursor-pointer flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                                View Lead <ExternalLink className="w-2.5 h-2.5" />
                              </span>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Contractors() {
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const urlSearch = urlParams.get("search") || "";

  const [search, setSearch] = useState(urlSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(urlSearch);
  const [roofingOnly, setRoofingOnly] = useState(false);
  const [sortBy, setSortBy] = useState("permits");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (urlSearch && urlSearch !== debouncedSearch) {
      setSearch(urlSearch);
      setDebouncedSearch(urlSearch);
      setPage(1);
    }
  }, [urlSearch]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout((window as any).__contractorSearchTimeout);
    (window as any).__contractorSearchTimeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  };

  const queryParams = new URLSearchParams();
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (roofingOnly) queryParams.set("roofingOnly", "true");
  if (sortBy) queryParams.set("sortBy", sortBy);
  queryParams.set("page", String(page));

  const { data, isLoading } = useQuery<ContractorsResponse>({
    queryKey: ["/api/contractors", debouncedSearch, roofingOnly, sortBy, page],
    queryFn: async () => {
      const res = await fetch(`/api/contractors?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  return (
    <div className="p-8 space-y-6">
      <PageMeta
        title="Contractors Directory"
        description="Browse contractors from building permit records in the DFW metro area. Find contact information, permit history, and linked properties."
        path="/contractors"
      />
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">Contractors Directory</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Contractors from building permit records — contact info, permit history, and linked properties
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contractors..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9"
                data-testid="input-search-contractor"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="roofing-only"
                checked={roofingOnly}
                onCheckedChange={(v) => { setRoofingOnly(v); setPage(1); }}
                data-testid="switch-roofing-only"
              />
              <Label htmlFor="roofing-only" className="text-xs font-medium cursor-pointer">
                Roofing only
              </Label>
            </div>

            <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1); }}>
              <SelectTrigger className="w-[160px]" data-testid="select-sort">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="permits">Most Permits</SelectItem>
                <SelectItem value="recent">Most Recent</SelectItem>
                <SelectItem value="name">Name A-Z</SelectItem>
              </SelectContent>
            </Select>

            {data && (
              <Badge variant="secondary" className="text-xs">
                {data.pagination.total.toLocaleString()} contractors
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading contractors...</div>
          ) : !data || data.contractors.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No contractors found</div>
          ) : (
            <div className="divide-y divide-border">
              {data.contractors.map((c) => (
                <ContractorRow key={c.contractor_name} contractor={c} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {data.pagination.page} of {data.pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(Math.min(data.pagination.totalPages, page + 1))}
              disabled={page >= data.pagination.totalPages}
              data-testid="button-next-page"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
