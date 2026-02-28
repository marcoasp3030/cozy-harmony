import { useState, useEffect, useCallback } from "react";
import {
  Heart,
  TrendingUp,
  TrendingDown,
  MessageSquare,
  CheckCircle2,
  Eye,
  Ban,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Lightbulb,
  Activity,
  Clock,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

interface HealthMetrics {
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  blockedContacts: number;
  totalContacts: number;
  avgResponseTime: number; // minutes
  messagesLast24h: number;
  messagesLast7d: number;
  dailyAvg7d: number;
  deliveryTrend: "up" | "down" | "stable";
  readTrend: "up" | "down" | "stable";
  failureTrend: "up" | "down" | "stable";
}

type HealthLevel = "excellent" | "good" | "warning" | "critical";

const getOverallHealth = (m: HealthMetrics): { level: HealthLevel; score: number; label: string } => {
  let score = 100;

  // Delivery rate impact (max -40)
  if (m.deliveryRate < 80) score -= 40;
  else if (m.deliveryRate < 90) score -= 20;
  else if (m.deliveryRate < 95) score -= 10;

  // Read rate impact (max -20)
  if (m.readRate < 20) score -= 20;
  else if (m.readRate < 40) score -= 10;
  else if (m.readRate < 60) score -= 5;

  // Failure rate impact (max -25)
  if (m.failureRate > 10) score -= 25;
  else if (m.failureRate > 5) score -= 15;
  else if (m.failureRate > 2) score -= 5;

  // Block rate impact (max -15)
  const blockRate = m.totalContacts > 0 ? (m.blockedContacts / m.totalContacts) * 100 : 0;
  if (blockRate > 5) score -= 15;
  else if (blockRate > 2) score -= 8;
  else if (blockRate > 1) score -= 3;

  score = Math.max(0, Math.min(100, score));

  const level: HealthLevel =
    score >= 85 ? "excellent" : score >= 65 ? "good" : score >= 40 ? "warning" : "critical";
  const label =
    level === "excellent" ? "Excelente" : level === "good" ? "Bom" : level === "warning" ? "Atenção" : "Crítico";

  return { level, score, label };
};

const getRecommendations = (m: HealthMetrics): { icon: typeof Lightbulb; text: string; severity: "info" | "warn" | "critical" }[] => {
  const recs: { icon: typeof Lightbulb; text: string; severity: "info" | "warn" | "critical" }[] = [];

  if (m.deliveryRate < 90) {
    recs.push({
      icon: AlertTriangle,
      text: "Taxa de entrega abaixo de 90%. Reduza o volume de envio diário e aumente os intervalos entre mensagens.",
      severity: m.deliveryRate < 80 ? "critical" : "warn",
    });
  }

  if (m.failureRate > 5) {
    recs.push({
      icon: Ban,
      text: "Taxa de falha elevada. Verifique se os números dos contatos são válidos e se sua instância está conectada.",
      severity: m.failureRate > 10 ? "critical" : "warn",
    });
  }

  if (m.readRate < 30) {
    recs.push({
      icon: Eye,
      text: "Taxa de leitura baixa. Personalize mais suas mensagens e envie em horários comerciais (8h-18h).",
      severity: "warn",
    });
  }

  const blockRate = m.totalContacts > 0 ? (m.blockedContacts / m.totalContacts) * 100 : 0;
  if (blockRate > 2) {
    recs.push({
      icon: ShieldAlert,
      text: `${m.blockedContacts} contatos bloqueados (${blockRate.toFixed(1)}%). Revise sua lista e remova números inválidos.`,
      severity: blockRate > 5 ? "critical" : "warn",
    });
  }

  if (m.messagesLast24h > 500) {
    recs.push({
      icon: Zap,
      text: "Alto volume de envio nas últimas 24h. Considere distribuir os envios ao longo de mais dias.",
      severity: m.messagesLast24h > 1000 ? "critical" : "warn",
    });
  }

  if (m.dailyAvg7d > 200) {
    recs.push({
      icon: Clock,
      text: "Média diária elevada. Meta recomenda crescimento gradual. Use o modo warm-up para números novos.",
      severity: "warn",
    });
  }

  if (recs.length === 0) {
    recs.push({
      icon: ShieldCheck,
      text: "Todos os indicadores estão saudáveis! Continue seguindo as boas práticas de envio.",
      severity: "info",
    });
  }

  return recs;
};

const HEALTH_COLORS: Record<HealthLevel, string> = {
  excellent: "hsl(142, 71%, 45%)",
  good: "hsl(88, 52%, 51%)",
  warning: "hsl(38, 92%, 50%)",
  critical: "hsl(0, 84%, 60%)",
};

const useHealthMetrics = () => {
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 3600000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 24 * 3600000).toISOString();
    const d14 = new Date(now.getTime() - 14 * 24 * 3600000).toISOString();

    const [
      { data: msgs7d },
      { data: msgs14d },
      { count: blockedCount },
      { count: totalCount },
      { count: msgs24hCount },
    ] = await Promise.all([
      supabase.from("messages").select("status, direction, created_at").gte("created_at", d7),
      supabase.from("messages").select("status, direction").gte("created_at", d14).lt("created_at", d7),
      supabase.from("contacts").select("*", { count: "exact", head: true }).eq("is_blocked", true),
      supabase.from("contacts").select("*", { count: "exact", head: true }),
      supabase.from("messages").select("*", { count: "exact", head: true }).gte("created_at", h24).eq("direction", "outbound"),
    ]);

    const out7d = (msgs7d || []).filter((m: any) => m.direction === "outbound");
    const total7d = out7d.length || 1;
    const delivered7d = out7d.filter((m: any) => ["delivered", "read"].includes(m.status || "")).length;
    const read7d = out7d.filter((m: any) => m.status === "read").length;
    const failed7d = out7d.filter((m: any) => m.status === "failed").length;

    const out14d = (msgs14d || []).filter((m: any) => m.direction === "outbound");
    const total14d = out14d.length || 1;
    const delivered14d = out14d.filter((m: any) => ["delivered", "read"].includes(m.status || "")).length;
    const read14d = out14d.filter((m: any) => m.status === "read").length;
    const failed14d = out14d.filter((m: any) => m.status === "failed").length;

    const deliveryRate = Math.round((delivered7d / total7d) * 1000) / 10;
    const readRate = Math.round((read7d / total7d) * 1000) / 10;
    const failureRate = Math.round((failed7d / total7d) * 1000) / 10;

    const prevDelivery = Math.round((delivered14d / total14d) * 1000) / 10;
    const prevRead = Math.round((read14d / total14d) * 1000) / 10;
    const prevFailure = Math.round((failed14d / total14d) * 1000) / 10;

    const trend = (curr: number, prev: number): "up" | "down" | "stable" =>
      Math.abs(curr - prev) < 1 ? "stable" : curr > prev ? "up" : "down";

    setMetrics({
      deliveryRate,
      readRate,
      failureRate,
      blockedContacts: blockedCount ?? 0,
      totalContacts: totalCount ?? 0,
      avgResponseTime: 0,
      messagesLast24h: msgs24hCount ?? 0,
      messagesLast7d: out7d.length,
      dailyAvg7d: Math.round(out7d.length / 7),
      deliveryTrend: trend(deliveryRate, prevDelivery),
      readTrend: trend(readRate, prevRead),
      failureTrend: trend(failureRate, prevFailure),
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { metrics, loading };
};

const TrendIcon = ({ trend, inverse }: { trend: "up" | "down" | "stable"; inverse?: boolean }) => {
  if (trend === "stable") return <Activity className="h-3 w-3 text-muted-foreground" />;
  const isGood = inverse ? trend === "down" : trend === "up";
  return isGood
    ? <TrendingUp className="h-3 w-3 text-success" />
    : <TrendingDown className="h-3 w-3 text-destructive" />;
};

const WhatsAppHealthPanel = () => {
  const { metrics, loading } = useHealthMetrics();

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Carregando saúde do número...
        </CardContent>
      </Card>
    );
  }

  if (!metrics) return null;

  const health = getOverallHealth(metrics);
  const recommendations = getRecommendations(metrics);
  const blockRate = metrics.totalContacts > 0
    ? Math.round((metrics.blockedContacts / metrics.totalContacts) * 1000) / 10
    : 0;

  const metricCards = [
    {
      label: "Taxa de Entrega",
      value: `${metrics.deliveryRate}%`,
      icon: CheckCircle2,
      trend: metrics.deliveryTrend,
      good: metrics.deliveryRate >= 95,
      warn: metrics.deliveryRate < 90,
    },
    {
      label: "Taxa de Leitura",
      value: `${metrics.readRate}%`,
      icon: Eye,
      trend: metrics.readTrend,
      good: metrics.readRate >= 50,
      warn: metrics.readRate < 30,
    },
    {
      label: "Taxa de Falha",
      value: `${metrics.failureRate}%`,
      icon: Ban,
      trend: metrics.failureTrend,
      inverse: true,
      good: metrics.failureRate <= 2,
      warn: metrics.failureRate > 5,
    },
    {
      label: "Bloqueados",
      value: `${metrics.blockedContacts}`,
      sub: `${blockRate}% dos contatos`,
      icon: ShieldAlert,
      good: blockRate <= 1,
      warn: blockRate > 2,
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg flex items-center gap-2">
            <Heart className="h-5 w-5 text-primary" />
            Saúde do Número WhatsApp
          </CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                className="gap-1.5 text-xs font-bold border-0"
                style={{
                  backgroundColor: `${HEALTH_COLORS[health.level]}20`,
                  color: HEALTH_COLORS[health.level],
                }}
              >
                <div
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ backgroundColor: HEALTH_COLORS[health.level] }}
                />
                {health.score}/100 — {health.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Score de saúde baseado em entrega, leitura, falhas e bloqueios</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        {/* Overall health bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Score geral</span>
            <span className="font-bold" style={{ color: HEALTH_COLORS[health.level] }}>
              {health.score}%
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${health.score}%`,
                backgroundColor: HEALTH_COLORS[health.level],
              }}
            />
          </div>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {metricCards.map((m) => (
            <div
              key={m.label}
              className={cn(
                "rounded-lg border p-3 space-y-1 transition-colors",
                m.warn && "border-destructive/30 bg-destructive/5",
                m.good && "border-success/30 bg-success/5",
                !m.warn && !m.good && "border-border"
              )}
            >
              <div className="flex items-center justify-between">
                <m.icon className={cn("h-4 w-4", m.warn ? "text-destructive" : m.good ? "text-success" : "text-muted-foreground")} />
                {m.trend && <TrendIcon trend={m.trend} inverse={m.inverse} />}
              </div>
              <p className="text-xl font-bold font-heading">{m.value}</p>
              <p className="text-[10px] text-muted-foreground leading-tight">{m.label}</p>
              {m.sub && <p className="text-[9px] text-muted-foreground">{m.sub}</p>}
            </div>
          ))}
        </div>

        {/* Volume info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            <span><strong className="text-foreground">{metrics.messagesLast24h}</strong> últimas 24h</span>
          </div>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            <span><strong className="text-foreground">{metrics.dailyAvg7d}</strong>/dia (média 7d)</span>
          </div>
          <div className="h-3 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            <span><strong className="text-foreground">{metrics.messagesLast7d}</strong> últimos 7 dias</span>
          </div>
        </div>

        {/* Recommendations */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" />
            Recomendações
          </p>
          <div className="space-y-1.5">
            {recommendations.map((rec, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-lg px-3 py-2 text-xs",
                  rec.severity === "critical" && "bg-destructive/10 text-destructive",
                  rec.severity === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  rec.severity === "info" && "bg-success/10 text-success"
                )}
              >
                <rec.icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{rec.text}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default WhatsAppHealthPanel;
