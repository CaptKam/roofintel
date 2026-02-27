import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Activity,
  Globe,
  Phone,
  Search,
  Shield,
  FileText,
  ShieldCheck,
  Fingerprint,
  Ban,
  ShieldOff,
} from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";

function CoverageBar({ label, value, total, icon }: { label: string; value: number; total: number; icon?: JSX.Element }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {icon}
          {label}
        </div>
        <span className="text-xs text-muted-foreground">{value.toLocaleString()} / {total.toLocaleString()} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function CompliancePanel() {
  const { toast } = useToast();
  const DFW_MARKET_ID = "89c5b2b9-32f9-4e7f-8d57-e05a2a9bd5da";
  const [consentSearchQuery, setConsentSearchQuery] = useState("");
  const [consentSearchResult, setConsentSearchResult] = useState<any>(null);
  const [consentSearchLoading, setConsentSearchLoading] = useState(false);

  const [newSuppression, setNewSuppression] = useState({
    entityName: "",
    phone: "",
    email: "",
    channel: "all",
    reason: "",
    expiresInDays: 0,
  });

  const { data: complianceReport, isLoading: reportLoading } = useQuery<{
    totalLeads: number;
    consented: number;
    unconsented: number;
    revoked: number;
    denied: number;
    dncRegistered: number;
    suppressed: number;
    withValidTokens: number;
    withExpiredTokens: number;
    byTokenType: Record<string, number>;
    byChannel: Record<string, number>;
    consentRate: number;
    complianceScore: number;
  }>({
    queryKey: [`/api/admin/compliance/report?marketId=${DFW_MARKET_ID}`],
  });

  const { data: suppressionStats } = useQuery<{
    totalActive: number;
    byChannel: Record<string, number>;
    bySource: Record<string, number>;
    byReason: Record<string, number>;
  }>({
    queryKey: ["/api/suppression/stats"],
  });

  const { data: suppressionItems, isLoading: suppressionListLoading } = useQuery<Array<{
    id: string;
    leadId: string | null;
    entityName: string | null;
    phone: string | null;
    email: string | null;
    channel: string;
    reason: string;
    source: string;
    addedAt: string;
    expiresAt: string | null;
    isActive: boolean;
  }>>({
    queryKey: ["/api/suppression/list"],
  });

  const { data: phoneValidationSummary, isLoading: phoneLoading } = useQuery<{
    totalPhones: number;
    validatedCount: number;
    invalidCount: number;
    mobileCount: number;
    landlineCount: number;
    voipCount: number;
    unknownCount: number;
    validatedPct: number;
    mobilePct: number;
    landlinePct: number;
    voipPct: number;
    invalidPct: number;
  }>({
    queryKey: [`/api/admin/phone-validation/summary?marketId=${DFW_MARKET_ID}`],
  });

  const { data: batchValidationStatus } = useQuery<{
    processed: number;
    total: number;
    running: boolean;
  }>({
    queryKey: ["/api/admin/phone-validation/status"],
    refetchInterval: (query) => {
      const d = query.state.data as { running: boolean } | undefined;
      return d?.running ? 2000 : false;
    },
  });

  const addSuppressionMutation = useMutation({
    mutationFn: async (entry: typeof newSuppression) => {
      const body: any = {
        channel: entry.channel,
        reason: entry.reason,
        source: "manual",
      };
      if (entry.entityName) body.entityName = entry.entityName;
      if (entry.phone) body.phone = entry.phone;
      if (entry.email) body.email = entry.email;
      if (entry.expiresInDays > 0) {
        body.expiresAt = new Date(Date.now() + entry.expiresInDays * 86400000).toISOString();
      }
      const res = await apiRequest("POST", "/api/suppression/add", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Added to suppression list" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppression/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppression/stats"] });
      setNewSuppression({ entityName: "", phone: "", email: "", channel: "all", reason: "", expiresInDays: 0 });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add suppression", description: err.message, variant: "destructive" });
    },
  });

  const removeSuppressionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/suppression/${id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Removed from suppression list" });
      queryClient.invalidateQueries({ queryKey: ["/api/suppression/list"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppression/stats"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove", description: err.message, variant: "destructive" });
    },
  });

  const startBatchValidationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/phone-validation/batch", { limit: 100 });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Batch phone validation started" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/phone-validation/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to start batch validation", description: err.message, variant: "destructive" });
    },
  });

  const handleConsentSearch = async () => {
    if (!consentSearchQuery.trim()) return;
    setConsentSearchLoading(true);
    setConsentSearchResult(null);
    try {
      const searchRes = await fetch(`/api/leads?search=${encodeURIComponent(consentSearchQuery.trim())}&limit=1`);
      if (!searchRes.ok) throw new Error("Search failed");
      const searchData = await searchRes.json();
      const leads = searchData.leads || searchData;
      if (!leads || leads.length === 0) {
        setConsentSearchResult({ error: "No lead found matching that query" });
        return;
      }
      const leadId = leads[0].id;
      const auditRes = await fetch(`/api/leads/${leadId}/consent/audit`);
      if (!auditRes.ok) throw new Error("Failed to fetch audit trail");
      const audit = await auditRes.json();
      setConsentSearchResult({ lead: leads[0], audit });
    } catch (err: any) {
      setConsentSearchResult({ error: err.message });
    } finally {
      setConsentSearchLoading(false);
    }
  };

  const pieData = complianceReport ? [
    { name: "Consented", value: complianceReport.consented, fill: "#10b981" },
    { name: "Unconsented", value: complianceReport.unconsented, fill: "#94a3b8" },
    { name: "DNC", value: complianceReport.dncRegistered, fill: "#ef4444" },
    { name: "Suppressed", value: complianceReport.suppressed, fill: "#f59e0b" },
    { name: "Revoked", value: complianceReport.revoked, fill: "#8b5cf6" },
  ].filter(d => d.value > 0) : [];

  const batchRunning = batchValidationStatus?.running || false;
  const batchPct = batchValidationStatus && batchValidationStatus.total > 0
    ? Math.round((batchValidationStatus.processed / batchValidationStatus.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm" data-testid="card-compliance-overview">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Compliance Overview
            </CardTitle>
            <Badge variant="outline" data-testid="badge-compliance-score">
              Score: {complianceReport?.complianceScore ?? 0}%
            </Badge>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {reportLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-40 w-full" />
              </div>
            ) : complianceReport ? (
              <div className="flex flex-col items-center gap-4">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs w-full">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Leads</span>
                    <span className="font-medium" data-testid="text-compliance-total">{complianceReport.totalLeads.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Consent Rate</span>
                    <span className="font-medium" data-testid="text-consent-rate">{(complianceReport.consentRate * 100).toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-emerald-600">Consented</span>
                    <span className="font-medium" data-testid="text-consented">{complianceReport.consented.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unconsented</span>
                    <span className="font-medium" data-testid="text-unconsented">{complianceReport.unconsented.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-red-500">DNC Registered</span>
                    <span className="font-medium" data-testid="text-dnc">{complianceReport.dncRegistered.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amber-500">Suppressed</span>
                    <span className="font-medium" data-testid="text-suppressed">{complianceReport.suppressed.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-purple-500">Revoked</span>
                    <span className="font-medium" data-testid="text-revoked">{complianceReport.revoked.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valid Tokens</span>
                    <span className="font-medium" data-testid="text-valid-tokens">{complianceReport.withValidTokens.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No compliance data available</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="card-compliance-report">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Compliance Report
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0">
            {reportLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : complianceReport ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  <CoverageBar
                    label="Consented"
                    value={complianceReport.consented}
                    total={complianceReport.totalLeads}
                    icon={<ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />}
                  />
                  <CoverageBar
                    label="DNC Registered"
                    value={complianceReport.dncRegistered}
                    total={complianceReport.totalLeads}
                    icon={<Ban className="w-3.5 h-3.5 text-red-500" />}
                  />
                  <CoverageBar
                    label="Suppressed"
                    value={complianceReport.suppressed}
                    total={complianceReport.totalLeads}
                    icon={<ShieldOff className="w-3.5 h-3.5 text-amber-500" />}
                  />
                </div>

                {Object.keys(complianceReport.byChannel).length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-xs font-medium mb-2 text-muted-foreground">By Channel</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(complianceReport.byChannel).map(([channel, count]) => (
                        <div key={channel} className="flex justify-between bg-muted/30 rounded-md p-2" data-testid={`channel-${channel}`}>
                          <span>{channel}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(complianceReport.byTokenType).length > 0 && (
                  <div className="pt-3 border-t">
                    <p className="text-xs font-medium mb-2 text-muted-foreground">By Token Type</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(complianceReport.byTokenType).map(([type, count]) => (
                        <div key={type} className="flex justify-between bg-muted/30 rounded-md p-2" data-testid={`token-type-${type}`}>
                          <span>{type}</span>
                          <span className="font-medium">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm" data-testid="card-consent-search">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Search className="w-4 h-4" />
            Consent Search
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Input
              placeholder="Search by address or lead ID..."
              value={consentSearchQuery}
              onChange={(e) => setConsentSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleConsentSearch()}
              data-testid="input-consent-search"
            />
            <Button
              onClick={handleConsentSearch}
              disabled={consentSearchLoading || !consentSearchQuery.trim()}
              data-testid="button-consent-search"
            >
              {consentSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Search
            </Button>
          </div>

          {consentSearchResult && (
            <div className="space-y-3" data-testid="consent-search-results">
              {consentSearchResult.error ? (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                  {consentSearchResult.error}
                </div>
              ) : (
                <>
                  <div className="p-3 rounded-md bg-muted/50 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-medium" data-testid="text-search-lead-address">{consentSearchResult.lead.address}</p>
                        <p className="text-xs text-muted-foreground">{consentSearchResult.lead.city}, {consentSearchResult.lead.state} {consentSearchResult.lead.zipCode}</p>
                      </div>
                      <Badge
                        variant={consentSearchResult.audit.currentStatus === "granted" ? "default" : "secondary"}
                        data-testid="badge-consent-status"
                      >
                        {consentSearchResult.audit.currentStatus}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">Consent Date:</span>{" "}
                        <span>{consentSearchResult.audit.consentDate ? new Date(consentSearchResult.audit.consentDate).toLocaleDateString() : "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Channel:</span>{" "}
                        <span>{consentSearchResult.audit.consentChannel || "N/A"}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">DNC:</span>{" "}
                        <span>{consentSearchResult.audit.dncRegistered ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </div>

                  {consentSearchResult.audit.tokens && consentSearchResult.audit.tokens.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Consent Tokens</p>
                      {consentSearchResult.audit.tokens.map((token: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30" data-testid={`consent-token-${i}`}>
                          <div className="flex items-center gap-2">
                            <Fingerprint className="w-3 h-3 text-muted-foreground" />
                            <span className="font-medium">{token.tokenType}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge
                              variant={token.verificationResult === "valid" ? "default" : "destructive"}
                              className="text-[10px]"
                            >
                              {token.verificationResult}
                            </Badge>
                            <span className="text-muted-foreground">{token.createdAt ? new Date(token.createdAt).toLocaleDateString() : ""}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {consentSearchResult.audit.consentRecords && consentSearchResult.audit.consentRecords.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Consent Records</p>
                      {consentSearchResult.audit.consentRecords.map((rec: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30" data-testid={`consent-record-${i}`}>
                          <div className="flex items-center gap-2">
                            <span>{rec.channel}</span>
                            <Badge variant="outline" className="text-[10px]">{rec.consentStatus}</Badge>
                          </div>
                          <span className="text-muted-foreground">{rec.consentDate ? new Date(rec.consentDate).toLocaleDateString() : ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm" data-testid="card-suppression-manager">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShieldOff className="w-4 h-4" />
            Suppression List Manager
          </CardTitle>
          <Badge variant="secondary" data-testid="badge-suppression-count">
            {suppressionStats?.totalActive ?? 0} active
          </Badge>
        </CardHeader>
        <CardContent className="p-6 pt-0 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Entity Name</Label>
              <Input
                placeholder="Name..."
                value={newSuppression.entityName}
                onChange={(e) => setNewSuppression(p => ({ ...p, entityName: e.target.value }))}
                data-testid="input-suppression-entity"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Phone</Label>
              <Input
                placeholder="Phone..."
                value={newSuppression.phone}
                onChange={(e) => setNewSuppression(p => ({ ...p, phone: e.target.value }))}
                data-testid="input-suppression-phone"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                placeholder="Email..."
                value={newSuppression.email}
                onChange={(e) => setNewSuppression(p => ({ ...p, email: e.target.value }))}
                data-testid="input-suppression-email"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Channel</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newSuppression.channel}
                onChange={(e) => setNewSuppression(p => ({ ...p, channel: e.target.value }))}
                data-testid="select-suppression-channel"
              >
                <option value="all">All</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="mail">Mail</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason</Label>
              <Input
                placeholder="Reason..."
                value={newSuppression.reason}
                onChange={(e) => setNewSuppression(p => ({ ...p, reason: e.target.value }))}
                data-testid="input-suppression-reason"
              />
            </div>
            <Button
              onClick={() => addSuppressionMutation.mutate(newSuppression)}
              disabled={addSuppressionMutation.isPending || !newSuppression.reason}
              data-testid="button-add-suppression"
            >
              {addSuppressionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Add
            </Button>
          </div>

          {suppressionListLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : suppressionItems && suppressionItems.length > 0 ? (
            <div className="max-h-[300px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-2 px-1">Entity / ID</th>
                    <th className="text-left py-2 px-1">Phone</th>
                    <th className="text-left py-2 px-1">Email</th>
                    <th className="text-left py-2 px-1">Channel</th>
                    <th className="text-left py-2 px-1">Reason</th>
                    <th className="text-left py-2 px-1">Added</th>
                    <th className="text-left py-2 px-1">Expires</th>
                    <th className="text-right py-2 px-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {suppressionItems.map((item) => (
                    <tr key={item.id} className="border-b border-muted/50" data-testid={`suppression-row-${item.id}`}>
                      <td className="py-1.5 px-1 truncate max-w-[120px]">{item.entityName || item.leadId || "-"}</td>
                      <td className="py-1.5 px-1">{item.phone || "-"}</td>
                      <td className="py-1.5 px-1 truncate max-w-[140px]">{item.email || "-"}</td>
                      <td className="py-1.5 px-1">
                        <Badge variant="outline" className="text-[10px]">{item.channel}</Badge>
                      </td>
                      <td className="py-1.5 px-1 truncate max-w-[120px]">{item.reason}</td>
                      <td className="py-1.5 px-1 text-muted-foreground">{item.addedAt ? new Date(item.addedAt).toLocaleDateString() : "-"}</td>
                      <td className="py-1.5 px-1 text-muted-foreground">{item.expiresAt ? new Date(item.expiresAt).toLocaleDateString() : "Never"}</td>
                      <td className="py-1.5 px-1 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSuppressionMutation.mutate(item.id)}
                          disabled={removeSuppressionMutation.isPending}
                          data-testid={`button-remove-suppression-${item.id}`}
                        >
                          <XCircle className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">No active suppressions</p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm" data-testid="card-phone-validation-summary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Phone className="w-4 h-4" />
              Phone Validation Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            {phoneLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : phoneValidationSummary ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-center mb-4">
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3" data-testid="stat-validated-phones">
                    <div className="text-xl font-bold text-emerald-600">{phoneValidationSummary.validatedPct}%</div>
                    <div className="text-[11px] text-muted-foreground">Validated</div>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3" data-testid="stat-mobile-phones">
                    <div className="text-xl font-bold text-blue-600">{phoneValidationSummary.mobilePct}%</div>
                    <div className="text-[11px] text-muted-foreground">Mobile</div>
                  </div>
                  <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3" data-testid="stat-invalid-phones">
                    <div className="text-xl font-bold text-red-600">{phoneValidationSummary.invalidPct}%</div>
                    <div className="text-[11px] text-muted-foreground">Invalid</div>
                  </div>
                </div>

                <CoverageBar
                  label="Validated"
                  value={phoneValidationSummary.validatedCount}
                  total={phoneValidationSummary.totalPhones}
                  icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                />
                <CoverageBar
                  label="Mobile"
                  value={phoneValidationSummary.mobileCount}
                  total={phoneValidationSummary.totalPhones}
                  icon={<Phone className="w-3.5 h-3.5 text-blue-500" />}
                />
                <CoverageBar
                  label="Landline"
                  value={phoneValidationSummary.landlineCount}
                  total={phoneValidationSummary.totalPhones}
                  icon={<Phone className="w-3.5 h-3.5 text-amber-500" />}
                />
                <CoverageBar
                  label="VoIP"
                  value={phoneValidationSummary.voipCount}
                  total={phoneValidationSummary.totalPhones}
                  icon={<Globe className="w-3.5 h-3.5 text-purple-500" />}
                />
                <CoverageBar
                  label="Invalid"
                  value={phoneValidationSummary.invalidCount}
                  total={phoneValidationSummary.totalPhones}
                  icon={<XCircle className="w-3.5 h-3.5 text-red-500" />}
                />

                <div className="pt-2 text-xs text-muted-foreground">
                  Total phones: {phoneValidationSummary.totalPhones.toLocaleString()}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">No phone validation data</p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm" data-testid="card-batch-validation">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Batch Phone Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 pt-0 space-y-4">
            <p className="text-xs text-muted-foreground">
              Validate phone numbers via Twilio Lookup API. Determines line type (mobile/landline/VoIP), carrier, and validity.
            </p>

            <Button
              onClick={() => startBatchValidationMutation.mutate()}
              disabled={batchRunning || startBatchValidationMutation.isPending}
              data-testid="button-start-batch-validation"
            >
              {batchRunning || startBatchValidationMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Phone className="w-4 h-4" />
              )}
              {batchRunning ? "Validating..." : "Start Batch Validation"}
            </Button>

            {batchRunning && batchValidationStatus && (
              <div className="space-y-2" data-testid="batch-validation-progress">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="font-medium">Validating phones...</span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {batchValidationStatus.processed} / {batchValidationStatus.total}
                  </span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${batchPct}%` }}
                    data-testid="progress-batch-validation"
                  />
                </div>
                <div className="text-xs text-muted-foreground text-right">{batchPct}% complete</div>
              </div>
            )}

            {!batchRunning && batchValidationStatus && batchValidationStatus.total > 0 && batchValidationStatus.processed > 0 && (
              <div className="p-3 rounded-lg bg-muted/50 space-y-1" data-testid="batch-validation-complete">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  Last batch complete
                </div>
                <p className="text-xs text-muted-foreground">
                  {batchValidationStatus.processed} phones processed out of {batchValidationStatus.total}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
