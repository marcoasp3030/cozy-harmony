import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, CheckCircle2, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

interface RealtimeMetrics {
  messagesPerHour: { hour: string; total: number; inbound: number; outbound: number }[];
  avgResponseTimeMin: number;
  resolutionRate: number;
  totalResolved: number;
  totalConversations: number;
  currentHourMessages: number;
}

const RealtimeMetricsPanel = () => {
  const [metrics, setMetrics] = useState<RealtimeMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: msgs }, { data: convs }] = await Promise.all([
      supabase
        .from("messages")
        .select("created_at, direction, contact_id")
        .gte("created_at", last24h)
        .order("created_at", { ascending: true }),
      supabase
        .from("conversations")
        .select("status, created_at, updated_at")
    ]);

    // Messages per hour (last 24h)
    const hourMap = new Map<string, { total: number; inbound: number; outbound: number }>();
    for (let i = 23; i >= 0; i--) {
      const h = new Date(now.getTime() - i * 60 * 60 * 1000);
      const key = `${String(h.getHours()).padStart(2, "0")}:00`;
      hourMap.set(key, { total: 0, inbound: 0, outbound: 0 });
    }

    const msgList = msgs || [];
    for (const msg of msgList as any[]) {
      const d = new Date(msg.created_at);
      const key = `${String(d.getHours()).padStart(2, "0")}:00`;
      const entry = hourMap.get(key);
      if (entry) {
        entry.total++;
        if (msg.direction === "inbound") entry.inbound++;
        else entry.outbound++;
      }
    }

    const messagesPerHour = Array.from(hourMap.entries()).map(([hour, data]) => ({ hour, ...data }));

    // Current hour messages
    const currentHourKey = `${String(now.getHours()).padStart(2, "0")}:00`;
    const currentHourMessages = hourMap.get(currentHourKey)?.total || 0;

    // Average response time: for each inbound message, find the next outbound for the same contact
    const responseTimes: number[] = [];
    const contactMsgs = new Map<string, any[]>();
    for (const msg of msgList as any[]) {
      if (!msg.contact_id) continue;
      if (!contactMsgs.has(msg.contact_id)) contactMsgs.set(msg.contact_id, []);
      contactMsgs.get(msg.contact_id)!.push(msg);
    }

    for (const [, cMsgs] of contactMsgs) {
      for (let i = 0; i < cMsgs.length; i++) {
        if (cMsgs[i].direction === "inbound") {
          for (let j = i + 1; j < cMsgs.length; j++) {
            if (cMsgs[j].direction === "outbound") {
              const diff = (new Date(cMsgs[j].created_at).getTime() - new Date(cMsgs[i].created_at).getTime()) / 60000;
              if (diff > 0 && diff < 1440) responseTimes.push(diff);
              break;
            }
          }
        }
      }
    }

    const avgResponseTimeMin = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    // Resolution rate
    const allConvs = convs || [];
    const totalConversations = allConvs.length;
    const totalResolved = allConvs.filter((c: any) => c.status === "resolved" || c.status === "closed").length;
    const resolutionRate = totalConversations > 0 ? Math.round((totalResolved / totalConversations) * 100) : 0;

    setMetrics({
      messagesPerHour,
      avgResponseTimeMin,
      resolutionRate,
      totalResolved,
      totalConversations,
      currentHourMessages,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, [load]);

  const formatResponseTime = (min: number) => {
    if (min === 0) return "—";
    if (min < 60) return `${min}min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Carregando métricas em tempo real...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Métricas em Tempo Real
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] gap-1 animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Ao vivo
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-accent/30 border-0">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold font-heading">{metrics?.currentHourMessages ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">Msgs esta hora</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-accent/30 border-0">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold font-heading">{formatResponseTime(metrics?.avgResponseTimeMin ?? 0)}</p>
                <p className="text-[11px] text-muted-foreground">Tempo médio resposta</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-accent/30 border-0">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold font-heading">{metrics?.resolutionRate ?? 0}%</p>
                <p className="text-[11px] text-muted-foreground">
                  Resolução ({metrics?.totalResolved}/{metrics?.totalConversations})
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Messages per hour chart */}
        <div>
          <p className="text-sm font-medium mb-3 text-muted-foreground">Mensagens por Hora (últimas 24h)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics?.messagesPerHour || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 10 }}
                stroke="hsl(var(--muted-foreground))"
                interval={2}
              />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="inbound" stackId="a" fill="hsl(217, 91%, 60%)" name="Recebidas" radius={[0, 0, 0, 0]} />
              <Bar dataKey="outbound" stackId="a" fill="hsl(88, 52%, 51%)" name="Enviadas" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
};

export default RealtimeMetricsPanel;
