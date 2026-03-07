import { useState, useEffect, useRef, useCallback } from "react";
import { Loader2, Users, Send, CheckCheck, Eye, XCircle, Clock, Activity, Zap, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, AreaChart, Area,
} from "recharts";
import { type Campaign, type CampaignStats, statusConfig } from "./CampaignCard";

interface ContactRow {
  id: string;
  phone: string;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  error: string | null;
  contact_id: string | null;
}

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(142 71% 45%)",
  "hsl(217 91% 60%)",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

function groupByMinute(contacts: ContactRow[]) {
  const map = new Map<string, { time: string; sent: number; delivered: number; read: number; failed: number }>();

  contacts.forEach((c) => {
    const ts = c.sent_at || c.delivered_at || c.read_at;
    if (!ts) return;
    const d = new Date(ts);
    const key = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (!map.has(key)) {
      map.set(key, { time: key, sent: 0, delivered: 0, read: 0, failed: 0 });
    }
    const entry = map.get(key)!;
    if (c.status === "sent" || c.status === "delivered" || c.status === "read") entry.sent++;
    if (c.status === "delivered" || c.status === "read") entry.delivered++;
    if (c.status === "read") entry.read++;
    if (c.status === "failed") entry.failed++;
  });

  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
}

function groupByHour(contacts: ContactRow[]) {
  const hourMap = new Map<string, { hour: string; sent: number; delivered: number; read: number; failed: number }>();

  contacts.forEach((c) => {
    const ts = c.sent_at || c.delivered_at || c.read_at;
    if (!ts) return;
    const d = new Date(ts);
    const key = `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${String(d.getHours()).padStart(2, "0")}h`;
    if (!hourMap.has(key)) {
      hourMap.set(key, { hour: key, sent: 0, delivered: 0, read: 0, failed: 0 });
    }
    const entry = hourMap.get(key)!;
    if (c.status === "sent" || c.status === "delivered" || c.status === "read") entry.sent++;
    if (c.status === "delivered" || c.status === "read") entry.delivered++;
    if (c.status === "read") entry.read++;
    if (c.status === "failed") entry.failed++;
  });

  return Array.from(hourMap.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

function calcSpeed(contacts: ContactRow[]): { perMinute: number; elapsed: string } {
  const sentContacts = contacts.filter((c) => c.sent_at);
  if (sentContacts.length < 2) return { perMinute: 0, elapsed: "0s" };

  const times = sentContacts.map((c) => new Date(c.sent_at!).getTime()).sort((a, b) => a - b);
  const firstSent = times[0];
  const lastSent = times[times.length - 1];
  const elapsedMs = lastSent - firstSent;
  const elapsedMin = elapsedMs / 60000;

  const elapsed = elapsedMs < 60000
    ? `${Math.round(elapsedMs / 1000)}s`
    : elapsedMs < 3600000
      ? `${Math.round(elapsedMin)}min`
      : `${(elapsedMin / 60).toFixed(1)}h`;

  return {
    perMinute: elapsedMin > 0 ? Math.round(sentContacts.length / elapsedMin) : sentContacts.length,
    elapsed,
  };
}

export default function CampaignReportDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
}) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveStats, setLiveStats] = useState<CampaignStats | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const isRunning = campaign.status === "running" || liveStats !== null && (liveStats as any)?._status === "running";

  const loadContacts = useCallback(async () => {
    const { data } = await supabase
      .from("campaign_contacts")
      .select("id, phone, status, sent_at, delivered_at, read_at, error, contact_id")
      .eq("campaign_id", campaign.id)
      .order("sent_at", { ascending: true });
    setContacts((data as unknown as ContactRow[]) || []);
    setLastRefresh(new Date());
  }, [campaign.id]);

  const loadLiveStats = useCallback(async () => {
    const { data } = await supabase
      .from("campaigns")
      .select("stats, status")
      .eq("id", campaign.id)
      .single();
    if (data) {
      const s = data.stats as any;
      setLiveStats({ ...s, _status: data.status } as any);
    }
  }, [campaign.id]);

  // Initial load
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([loadContacts(), loadLiveStats()]).finally(() => setLoading(false));
  }, [open, campaign.id, loadContacts, loadLiveStats]);

  // Real-time polling for running campaigns
  useEffect(() => {
    if (!open) return;

    const currentStatus = (liveStats as any)?._status || campaign.status;
    const shouldPoll = currentStatus === "running" || currentStatus === "paused";

    if (shouldPoll) {
      pollingRef.current = setInterval(() => {
        loadContacts();
        loadLiveStats();
      }, currentStatus === "running" ? 3000 : 8000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [open, campaign.status, (liveStats as any)?._status, loadContacts, loadLiveStats]);

  const stats = (liveStats || campaign.stats as CampaignStats) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  const currentStatus = (liveStats as any)?._status || campaign.status;
  const pending = stats.total - stats.sent - stats.failed;
  const progress = stats.total > 0 ? ((stats.sent + stats.failed) / stats.total) * 100 : 0;
  const config = statusConfig[currentStatus] || statusConfig.draft;
  const speed = calcSpeed(contacts);

  const pieData = [
    { name: "Enviadas", value: stats.sent - stats.delivered },
    { name: "Entregues", value: stats.delivered - stats.read },
    { name: "Lidas", value: stats.read },
    { name: "Falhas", value: stats.failed },
    { name: "Pendentes", value: Math.max(0, pending) },
  ].filter((d) => d.value > 0);

  const minuteData = groupByMinute(contacts);
  const hourData = groupByHour(contacts);
  const timelineData = minuteData.length > 60 ? hourData : minuteData;
  const timelineLabel = minuteData.length > 60 ? "hour" : "time";

  const deliveryRate = stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(1) : "0";
  const readRate = stats.delivered > 0 ? ((stats.read / stats.delivered) * 100).toFixed(1) : "0";
  const failRate = stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(1) : "0";

  const failedContacts = contacts.filter((c) => c.status === "failed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <DialogTitle className="font-heading text-xl">
              {currentStatus === "running" ? "⚡" : "📊"} {currentStatus === "running" ? "Dashboard ao Vivo" : "Relatório"}: {campaign.name}
            </DialogTitle>
            <Badge variant="secondary" className={config.className}>
              {config.icon}
              {config.label}
            </Badge>
            {currentStatus === "running" && (
              <Badge variant="outline" className="gap-1 text-[10px] animate-pulse border-success/50 text-success">
                <Activity className="h-3 w-3" />
                AO VIVO
              </Badge>
            )}
          </div>
          {(currentStatus === "running" || currentStatus === "paused") && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              Atualizado: {lastRefresh.toLocaleTimeString("pt-BR")}
              {currentStatus === "running" && " · Atualizando a cada 3s"}
            </p>
          )}
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 px-6 pb-6" style={{ maxHeight: "75vh" }}>
            {/* Live Progress Bar */}
            {stats.total > 0 && (
              <div className="mb-5">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Progresso Geral</span>
                  <span className="font-bold tabular-nums text-lg">
                    {progress.toFixed(0)}%
                    <span className="text-xs font-normal text-muted-foreground ml-1.5">
                      ({stats.sent + stats.failed}/{stats.total})
                    </span>
                  </span>
                </div>
                <Progress value={progress} className="h-3" />
                {pending > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {pending.toLocaleString()} contato(s) restante(s)
                  </p>
                )}
              </div>
            )}

            {/* KPI Cards with speed */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
              <KpiCard icon={<Users className="h-4 w-4" />} label="Total" value={stats.total} />
              <KpiCard icon={<Send className="h-4 w-4" />} label="Enviadas" value={stats.sent} color="text-primary" />
              <KpiCard icon={<CheckCheck className="h-4 w-4" />} label="Entregues" value={stats.delivered} color="text-success" />
              <KpiCard icon={<Eye className="h-4 w-4" />} label="Lidas" value={stats.read} color="text-info" />
              <KpiCard icon={<XCircle className="h-4 w-4" />} label="Falhas" value={stats.failed} color="text-destructive" />
              <KpiCard
                icon={<Zap className="h-4 w-4" />}
                label="Velocidade"
                value={speed.perMinute}
                suffix="/min"
                color="text-warning"
              />
            </div>

            {/* Rates + Speed */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <RateCard label="Taxa de Entrega" value={`${deliveryRate}%`} />
              <RateCard label="Taxa de Leitura" value={`${readRate}%`} />
              <RateCard label="Taxa de Falha" value={`${failRate}%`} />
              <RateCard label="Tempo Decorrido" value={speed.elapsed} />
            </div>

            <Tabs defaultValue="timeline" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="timeline">
                  <Activity className="h-3.5 w-3.5 mr-1.5" />
                  Tempo Real
                </TabsTrigger>
                <TabsTrigger value="distribution">Distribuição</TabsTrigger>
                <TabsTrigger value="failures">Falhas ({failedContacts.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline">
                {timelineData.length > 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-muted-foreground">
                          {minuteData.length > 60 ? "Envios por hora" : "Envios por minuto"}
                        </p>
                        {currentStatus === "running" && (
                          <Badge variant="outline" className="text-[10px] gap-1 animate-pulse">
                            <span className="h-1.5 w-1.5 rounded-full bg-success animate-ping" />
                            Atualizando
                          </Badge>
                        )}
                      </div>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey={timelineLabel} className="text-xs" tick={{ fontSize: 10 }} />
                          <YAxis className="text-xs" tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              color: "hsl(var(--popover-foreground))",
                            }}
                          />
                          <Area type="monotone" dataKey="sent" name="Enviadas" fill="hsl(var(--primary) / 0.2)" stroke="hsl(var(--primary))" strokeWidth={2} />
                          <Area type="monotone" dataKey="delivered" name="Entregues" fill="hsl(142 71% 45% / 0.2)" stroke="hsl(142 71% 45%)" strokeWidth={2} />
                          <Area type="monotone" dataKey="read" name="Lidas" fill="hsl(217 91% 60% / 0.2)" stroke="hsl(217 91% 60%)" strokeWidth={2} />
                          <Area type="monotone" dataKey="failed" name="Falhas" fill="hsl(var(--destructive) / 0.2)" stroke="hsl(var(--destructive))" strokeWidth={2} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ) : (
                  <EmptyState message="Nenhum dado de envio disponível ainda." />
                )}

                {/* Per-minute bar chart for running campaigns */}
                {currentStatus === "running" && minuteData.length > 0 && minuteData.length <= 60 && (
                  <Card className="mt-4">
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground mb-4">Throughput por minuto</p>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={minuteData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              color: "hsl(var(--popover-foreground))",
                            }}
                          />
                          <Bar dataKey="sent" name="Enviadas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="failed" name="Falhas" fill="hsl(var(--destructive))" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="distribution">
                {pieData.length > 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground mb-4">Distribuição dos status</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={3}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              color: "hsl(var(--popover-foreground))",
                            }}
                          />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                ) : (
                  <EmptyState message="Nenhum dado disponível." />
                )}
              </TabsContent>

              <TabsContent value="failures">
                {failedContacts.length > 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground mb-4">Detalhes das falhas de envio</p>
                      <div className="rounded-lg border border-border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-muted/50">
                              <th className="text-left px-4 py-2 font-medium">Telefone</th>
                              <th className="text-left px-4 py-2 font-medium">Erro</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {failedContacts.slice(0, 50).map((c) => (
                              <tr key={c.id} className="hover:bg-muted/30">
                                <td className="px-4 py-2 font-mono text-xs">{c.phone}</td>
                                <td className="px-4 py-2 text-xs text-destructive">{c.error || "Erro desconhecido"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {failedContacts.length > 50 && (
                          <p className="px-4 py-2 text-xs text-muted-foreground">
                            Exibindo 50 de {failedContacts.length} falhas.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <EmptyState message="Nenhuma falha registrada! 🎉" />
                )}
              </TabsContent>
            </Tabs>

            <p className="mt-4 text-xs text-muted-foreground">
              Criada: {new Date(campaign.created_at).toLocaleString("pt-BR")} · {contacts.length} contatos processados
            </p>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({ icon, label, value, color, suffix }: { icon: React.ReactNode; label: string; value: number; color?: string; suffix?: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-col items-center text-center gap-1">
        <div className={`${color || "text-muted-foreground"}`}>{icon}</div>
        <span className="text-lg font-bold tabular-nums">
          {value.toLocaleString()}
          {suffix && <span className="text-xs font-normal text-muted-foreground">{suffix}</span>}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3 text-center">
        <span className="text-xl font-bold">{value}</span>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-12">
        <p className="text-muted-foreground text-sm">{message}</p>
      </CardContent>
    </Card>
  );
}
