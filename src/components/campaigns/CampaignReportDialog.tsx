import { useState, useEffect } from "react";
import { Loader2, Users, Send, CheckCheck, Eye, XCircle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  "hsl(var(--success, 142 71% 45%))",
  "hsl(var(--info, 217 91% 60%))",
  "hsl(var(--destructive))",
  "hsl(var(--muted-foreground))",
];

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

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("campaign_contacts")
      .select("id, phone, status, sent_at, delivered_at, read_at, error, contact_id")
      .eq("campaign_id", campaign.id)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        setContacts((data as unknown as ContactRow[]) || []);
        setLoading(false);
      });
  }, [open, campaign.id]);

  const stats = (campaign.stats as CampaignStats) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  const pending = stats.total - stats.sent - stats.failed;
  const config = statusConfig[campaign.status] || statusConfig.draft;

  const pieData = [
    { name: "Enviadas", value: stats.sent - stats.delivered },
    { name: "Entregues", value: stats.delivered - stats.read },
    { name: "Lidas", value: stats.read },
    { name: "Falhas", value: stats.failed },
    { name: "Pendentes", value: Math.max(0, pending) },
  ].filter((d) => d.value > 0);

  const timelineData = groupByHour(contacts);

  const deliveryRate = stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(1) : "0";
  const readRate = stats.delivered > 0 ? ((stats.read / stats.delivered) * 100).toFixed(1) : "0";
  const failRate = stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(1) : "0";

  const failedContacts = contacts.filter((c) => c.status === "failed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <DialogTitle className="font-heading text-xl">📊 Relatório: {campaign.name}</DialogTitle>
            <Badge variant="secondary" className={config.className}>{config.label}</Badge>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="flex-1 px-6 pb-6" style={{ maxHeight: "75vh" }}>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <KpiCard icon={<Users className="h-4 w-4" />} label="Total" value={stats.total} />
              <KpiCard icon={<Send className="h-4 w-4" />} label="Enviadas" value={stats.sent} color="text-primary" />
              <KpiCard icon={<CheckCheck className="h-4 w-4" />} label="Entregues" value={stats.delivered} color="text-success" />
              <KpiCard icon={<Eye className="h-4 w-4" />} label="Lidas" value={stats.read} color="text-info" />
              <KpiCard icon={<XCircle className="h-4 w-4" />} label="Falhas" value={stats.failed} color="text-destructive" />
            </div>

            {/* Rates */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <RateCard label="Taxa de Entrega" value={`${deliveryRate}%`} />
              <RateCard label="Taxa de Leitura" value={`${readRate}%`} />
              <RateCard label="Taxa de Falha" value={`${failRate}%`} />
            </div>

            <Tabs defaultValue="timeline" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="timeline">Linha do Tempo</TabsTrigger>
                <TabsTrigger value="distribution">Distribuição</TabsTrigger>
                <TabsTrigger value="failures">Falhas ({failedContacts.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="timeline">
                {timelineData.length > 0 ? (
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground mb-4">Envios ao longo do tempo</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="hour" className="text-xs" tick={{ fontSize: 11 }} />
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

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="p-3 flex flex-col items-center text-center gap-1">
        <div className={`${color || "text-muted-foreground"}`}>{icon}</div>
        <span className="text-lg font-bold">{value.toLocaleString()}</span>
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
