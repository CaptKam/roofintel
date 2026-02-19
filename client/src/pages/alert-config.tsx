import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Bell, Plus, Trash2, Phone, Mail, Shield, Zap, Radio, RefreshCw } from "lucide-react";
import type { StormAlertConfig, AlertHistoryRecord } from "@shared/schema";

interface XweatherStatus {
  running: boolean;
  configured: boolean;
  lastFetchedAt: string | null;
  activeThreats: number;
  totalAffectedLeads: number;
}

export default function AlertConfig() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("Default Alert");
  const [newMinHailSize, setNewMinHailSize] = useState("1.0");
  const [newMinProbSevere, setNewMinProbSevere] = useState("40");
  const [newSms, setNewSms] = useState(true);
  const [newEmail, setNewEmail] = useState(false);
  const [newPredictiveAlerts, setNewPredictiveAlerts] = useState(true);
  const [recipientType, setRecipientType] = useState<"sms" | "email">("sms");
  const [recipientValue, setRecipientValue] = useState("");
  const [newRecipients, setNewRecipients] = useState<Array<{ type: string; value: string }>>([]);

  const { data: configs, isLoading } = useQuery<StormAlertConfig[]>({
    queryKey: ["/api/storm/alert-configs"],
  });

  const { data: alertHistoryData } = useQuery<AlertHistoryRecord[]>({
    queryKey: ["/api/storm/alert-history"],
  });

  const { data: monitorStatus } = useQuery<{ running: boolean }>({
    queryKey: ["/api/storm/status"],
    refetchInterval: 30000,
  });

  const { data: xweatherStatus } = useQuery<XweatherStatus>({
    queryKey: ["/api/xweather/status"],
    refetchInterval: 30000,
  });

  const createConfig = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/storm/alert-configs", {
        name: newName,
        minHailSize: parseFloat(newMinHailSize) || 1.0,
        minProbSevere: parseInt(newMinProbSevere) || 40,
        predictiveAlerts: newPredictiveAlerts,
        notifySms: newSms,
        notifyEmail: newEmail,
        recipients: newRecipients,
        isActive: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
      toast({ title: "Alert config created" });
      setShowCreate(false);
      setNewRecipients([]);
      setNewName("Default Alert");
    },
    onError: () => {
      toast({ title: "Failed to create config", variant: "destructive" });
    },
  });

  const toggleConfig = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/storm/alert-configs/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
    },
  });

  const deleteConfig = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/storm/alert-configs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/alert-configs"] });
      toast({ title: "Alert config deleted" });
    },
  });

  const startXweather = useMutation({
    mutationFn: () => apiRequest("POST", "/api/xweather/monitor/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/status"] });
      toast({ title: "Predictive hail monitor started" });
    },
  });

  const stopXweather = useMutation({
    mutationFn: () => apiRequest("POST", "/api/xweather/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/xweather/status"] });
      toast({ title: "Predictive hail monitor stopped" });
    },
  });

  const startNoaa = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/start"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "NOAA storm monitor started" });
    },
  });

  const stopNoaa = useMutation({
    mutationFn: () => apiRequest("POST", "/api/storm/monitor/stop"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storm/status"] });
      toast({ title: "NOAA storm monitor stopped" });
    },
  });

  const addRecipient = () => {
    if (!recipientValue.trim()) return;
    setNewRecipients([...newRecipients, { type: recipientType, value: recipientValue.trim() }]);
    setRecipientValue("");
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">Alert Configuration</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure storm monitors, alert thresholds, and notification recipients</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(!showCreate)} data-testid="button-new-config">
          <Plus className="w-3 h-3 mr-1" />
          New Alert Rule
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="w-4 h-4" />
              NOAA Storm Monitor
            </CardTitle>
            <Badge variant={monitorStatus?.running ? "default" : "secondary"} className="text-xs">
              {monitorStatus?.running ? "Active" : "Off"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Polls NOAA SWDI radar every 10 minutes for active hail signatures in your market area. Triggers alerts when hail is currently falling near leads.
            </p>
            <div className="flex items-center gap-2">
              {monitorStatus?.running ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => stopNoaa.mutate()}
                  disabled={stopNoaa.isPending}
                  data-testid="button-stop-noaa"
                >
                  Stop Monitor
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => startNoaa.mutate()}
                  disabled={startNoaa.isPending}
                  data-testid="button-start-noaa"
                >
                  Start Monitor
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Predictive Hail Monitor
              <Badge variant="outline" className="text-[10px]">Xweather</Badge>
            </CardTitle>
            <Badge variant={xweatherStatus?.running ? "default" : "secondary"} className="text-xs">
              {xweatherStatus?.running ? "Active" : xweatherStatus?.configured ? "Off" : "Not Configured"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Lightning-based nowcasting predicts hail 30-60 minutes before radar detection. Polls every 2 minutes for threat polygons and sends pre-storm alerts to give your team a head start.
            </p>
            {!xweatherStatus?.configured ? (
              <div className="text-xs text-muted-foreground p-3 border rounded-md bg-muted/30">
                Add <code className="text-[11px] bg-muted px-1 rounded">XWEATHER_CLIENT_ID</code> and <code className="text-[11px] bg-muted px-1 rounded">XWEATHER_CLIENT_SECRET</code> secrets to enable predictive monitoring.
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {xweatherStatus?.running ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => stopXweather.mutate()}
                    disabled={stopXweather.isPending}
                    data-testid="button-stop-xweather"
                  >
                    Stop Monitor
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => startXweather.mutate()}
                    disabled={startXweather.isPending}
                    data-testid="button-start-xweather"
                  >
                    Start Monitor
                  </Button>
                )}
              </div>
            )}
            {xweatherStatus?.lastFetchedAt && (
              <p className="text-[10px] text-muted-foreground">
                Last checked: {new Date(xweatherStatus.lastFetchedAt).toLocaleString()}
                {xweatherStatus.activeThreats > 0 && ` | ${xweatherStatus.activeThreats} active threats`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Alert Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Rule Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Sales Team DFW"
                  data-testid="input-config-name"
                />
              </div>
              <div className="space-y-2">
                <Label>Min Hail Size (inches)</Label>
                <Input
                  type="number"
                  value={newMinHailSize}
                  onChange={(e) => setNewMinHailSize(e.target.value)}
                  placeholder="1.0"
                  min="0.5"
                  max="5"
                  step="0.25"
                  data-testid="input-min-hail-size"
                />
                <p className="text-[10px] text-muted-foreground">Min predicted hail size to trigger alert</p>
              </div>
              <div className="space-y-2">
                <Label>Min Severe Probability (%)</Label>
                <Input
                  type="number"
                  value={newMinProbSevere}
                  onChange={(e) => setNewMinProbSevere(e.target.value)}
                  placeholder="40"
                  min="10"
                  max="100"
                  step="5"
                  data-testid="input-min-prob-severe"
                />
                <p className="text-[10px] text-muted-foreground">Min probability for Xweather prediction alerts</p>
              </div>
            </div>

            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch checked={newSms} onCheckedChange={setNewSms} data-testid="switch-sms" />
                <Label>SMS Alerts</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={newEmail} onCheckedChange={setNewEmail} data-testid="switch-email" />
                <Label>Email Alerts</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={newPredictiveAlerts} onCheckedChange={setNewPredictiveAlerts} data-testid="switch-predictive" />
                <Label>Pre-Storm Alerts</Label>
                <Badge variant="outline" className="text-[10px]">Xweather</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Recipients</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={recipientType}
                  onChange={(e) => setRecipientType(e.target.value as "sms" | "email")}
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  data-testid="select-recipient-type"
                >
                  <option value="sms">SMS</option>
                  <option value="email">Email</option>
                </select>
                <Input
                  value={recipientValue}
                  onChange={(e) => setRecipientValue(e.target.value)}
                  placeholder={recipientType === "sms" ? "+1234567890" : "team@company.com"}
                  className="flex-1"
                  data-testid="input-recipient-value"
                  onKeyDown={(e) => e.key === "Enter" && addRecipient()}
                />
                <Button size="sm" variant="outline" onClick={addRecipient} data-testid="button-add-recipient">Add</Button>
              </div>
              {newRecipients.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-2">
                  {newRecipients.map((r, i) => (
                    <Badge key={i} variant="secondary" className="gap-1">
                      {r.type === "sms" ? <Phone className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
                      {r.value}
                      <button onClick={() => setNewRecipients(newRecipients.filter((_, j) => j !== i))} className="ml-1 opacity-60 hover:opacity-100">
                        x
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => createConfig.mutate()} disabled={createConfig.isPending || newRecipients.length === 0} data-testid="button-save-config">
                Save Alert Rule
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground text-center py-8">Loading alert configs...</div>
        ) : !configs || configs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No alert rules configured yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Create one to get notified when storms hit your lead zones.</p>
            </CardContent>
          </Card>
        ) : (
          configs.map((config) => {
            const recipients = (config.recipients as Array<{ type: string; value: string }>) || [];
            return (
              <Card key={config.id} data-testid={`card-config-${config.id}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Bell className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div>
                        <div className="font-medium text-sm">{config.name}</div>
                        <div className="text-xs text-muted-foreground">
                          Min hail: {config.minHailSize}" | Min severe: {config.minProbSevere || 40}%
                          {config.notifySms && " | SMS"}
                          {config.notifyEmail && " | Email"}
                          {config.predictiveAlerts !== false && " | Pre-storm"}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {recipients.map((r, i) => (
                        <Badge key={i} variant="outline" className="text-xs gap-1">
                          {r.type === "sms" ? <Phone className="w-2.5 h-2.5" /> : <Mail className="w-2.5 h-2.5" />}
                          {r.value}
                        </Badge>
                      ))}
                      <Switch
                        checked={config.isActive}
                        onCheckedChange={(checked) => toggleConfig.mutate({ id: config.id, isActive: checked })}
                        data-testid={`switch-toggle-${config.id}`}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteConfig.mutate(config.id)}
                        disabled={deleteConfig.isPending}
                        data-testid={`button-delete-${config.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {alertHistoryData && alertHistoryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alert History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {alertHistoryData.slice(0, 20).map((alert) => (
                <div key={alert.id} className="flex items-center justify-between gap-4 p-2 border rounded-md text-sm flex-wrap" data-testid={`card-alert-history-${alert.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={alert.status === "sent" ? "default" : alert.status === "failed" ? "destructive" : "secondary"} className="text-xs">
                      {alert.status}
                    </Badge>
                    <span className="text-muted-foreground">{alert.channel}</span>
                    <span className="truncate max-w-[200px]">{alert.recipient}</span>
                    {alert.message && alert.message.includes("PREDICTED") && (
                      <Badge variant="outline" className="text-[10px]">
                        <Zap className="w-2.5 h-2.5 mr-0.5" />
                        Predictive
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {alert.sentAt ? new Date(alert.sentAt).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
