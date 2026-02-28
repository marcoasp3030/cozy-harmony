import { useState, useEffect, useCallback } from "react";
import {
  MessageSquare,
  CheckCircle2,
  Eye,
  Users,
  Megaphone,
  Wifi,
  WifiOff,
  TrendingUp,
  TrendingDown,
  Shield,
  AlertTriangle,
  Clock,
  Flame,
  ArrowUp,
  ArrowRight,
  ArrowDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { useNavigate } from "react-router-dom";

// ── SLA types & helpers ─────────────────────────────────────────────

interface SlaConversation {
  id: string;
  contact_id: string;
  status: string;
  priority: string;
  sla_hours: number | null;
  last_message_at: string | null;
  contact?: {
    name: string | null;
    phone: string;
    profile_picture: string | null;
  };
}

type SlaStatus = "expired" | "warning" | "ok";

const getSlaInfo = (conv: SlaConversation): { status: SlaStatus; elapsed: number; remaining: number; percent: number } | null => {
  if (!conv.sla_hours || !conv.last_message_at) return null;
  const elapsed = (Date.now() - new Date(conv.last_message_at).getTime()) / 3_600_000;
  const remaining = conv.sla_hours - elapsed;
  const percent = Math.min((elapsed / conv.sla_hours) * 100, 100);
  const status: SlaStatus = remaining <= 0 ? "expired" : percent >= 75 ? "warning" : "ok";
  return { status, elapsed, remaining, percent };
};

const formatDuration = (hours: number): string => {
  const abs = Math.abs(hours);
  if (abs < 1) return `${Math.round(abs * 60)}min`;
  if (abs < 24) return `${Math.round(abs)}h`;
  return `${Math.round(abs / 24)}d`;
};

const PRIORITY_CONFIG: Record<string, { label: string; icon: typeof ArrowUp; color: string }> = {
  urgent: { label: "Urgente", icon: AlertTriangle, color: "#ef4444" },
  high: { label: "Alta", icon: ArrowUp, color: "#f97316" },
  normal: { label: "Normal", icon: ArrowRight, color: "#6b7280" },
  low: { label: "Baixa", icon: ArrowDown, color: "#3b82f6" },
};

// ── Static data ─────────────────────────────────────────────────────

const statsCards = [
  { title: "Mensagens Hoje", value: "1.234", change: "+12%", trend: "up", icon: MessageSquare },
  { title: "Taxa de Entrega", value: "95.8%", change: "+2.1%", trend: "up", icon: CheckCircle2 },
  { title: "Taxa de Leitura", value: "78.2%", change: "-1.4%", trend: "down", icon: Eye },
  { title: "Contatos Ativos", value: "8.456", change: "+156", trend: "up", icon: Users },
  { title: "Campanhas Ativas", value: "3", change: "", trend: "up", icon: Megaphone },
];

const lineData = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1}`,
  enviadas: Math.floor(Math.random() * 500 + 300),
  entregues: Math.floor(Math.random() * 450 + 280),
  lidas: Math.floor(Math.random() * 350 + 200),
}));

const pieData = [
  { name: "Entregues", value: 650, color: "hsl(88, 52%, 51%)" },
  { name: "Lidas", value: 420, color: "hsl(88, 52%, 36%)" },
  { name: "Pendentes", value: 80, color: "hsl(38, 92%, 50%)" },
  { name: "Falhas", value: 12, color: "hsl(0, 84%, 60%)" },
];

const barData = [
  { name: "Black Friday", desempenho: 95 },
  { name: "Natal 2024", desempenho: 88 },
  { name: "Promoção Jan", desempenho: 82 },
  { name: "Lançamento", desempenho: 76 },
  { name: "Reativação", desempenho: 71 },
];

// ── SLA Panel Component ─────────────────────────────────────────────

const SlaSummaryPanel = () => {
  const [conversations, setConversations] = useState<SlaConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const { data: convs } = await supabase
      .from("conversations")
      .select("id, contact_id, status, priority, sla_hours, last_message_at")
      .not("sla_hours", "is", null)
      .order("last_message_at", { ascending: true });

    if (!convs || convs.length === 0) { setConversations([]); setLoading(false); return; }

    const contactIds = [...new Set(convs.map((c: any) => c.contact_id))];
    const { data: contacts } = await supabase
      .from("contacts")
      .select("id, name, phone, profile_picture")
      .in("id", contactIds);

    const contactMap = new Map((contacts || []).map((c: any) => [c.id, c]));
    const enriched: SlaConversation[] = (convs as any[]).map((c) => ({
      ...c,
      priority: c.priority || "normal",
      contact: contactMap.get(c.contact_id),
    }));

    setConversations(enriched);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const withSla = conversations.map((c) => ({ conv: c, sla: getSlaInfo(c)! })).filter((x) => x.sla);
  const expired = withSla.filter((x) => x.sla.status === "expired");
  const warning = withSla.filter((x) => x.sla.status === "warning");
  const ok = withSla.filter((x) => x.sla.status === "ok");

  const getInitials = (name: string | null, phone: string) => {
    if (name) return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    return phone.slice(-2);
  };

  const SlaRow = ({ conv, sla }: { conv: SlaConversation; sla: ReturnType<typeof getSlaInfo> }) => {
    if (!sla) return null;
    const prio = PRIORITY_CONFIG[conv.priority] || PRIORITY_CONFIG.normal;
    const PrioIcon = prio.icon;

    return (
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
        onClick={() => navigate("/inbox")}
      >
        <Avatar className="h-8 w-8 shrink-0">
          {conv.contact?.profile_picture && <AvatarImage src={conv.contact.profile_picture} />}
          <AvatarFallback className="text-[10px] font-bold bg-muted">
            {getInitials(conv.contact?.name || null, conv.contact?.phone || "")}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <PrioIcon className="h-3 w-3 shrink-0" style={{ color: prio.color }} />
              </TooltipTrigger>
              <TooltipContent className="text-xs">{prio.label}</TooltipContent>
            </Tooltip>
            <span className="text-sm font-medium truncate">
              {conv.contact?.name || conv.contact?.phone || "Desconhecido"}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">
            SLA: {conv.sla_hours}h • Esperando: {formatDuration(sla.elapsed)}
          </p>
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          <div className="w-16 h-1.5 rounded-full bg-border/50 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${sla.percent}%`,
                backgroundColor: sla.status === "expired" ? "#ef4444" : sla.status === "warning" ? "#f59e0b" : "#22c55e",
              }}
            />
          </div>
          <span
            className={cn(
              "text-[10px] font-bold min-w-[40px] text-right",
              sla.status === "expired" && "text-destructive",
              sla.status === "warning" && "text-amber-500",
              sla.status === "ok" && "text-muted-foreground"
            )}
          >
            {sla.status === "expired" ? `-${formatDuration(Math.abs(sla.remaining))}` : formatDuration(sla.remaining)}
          </span>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Carregando SLA...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Painel de SLA
          </CardTitle>
          <div className="flex items-center gap-2">
            {expired.length > 0 && (
              <Badge variant="destructive" className="text-[10px] gap-1">
                <Flame className="h-3 w-3" /> {expired.length} expirado{expired.length > 1 ? "s" : ""}
              </Badge>
            )}
            {warning.length > 0 && (
              <Badge className="text-[10px] gap-1 bg-amber-500/10 text-amber-600 border-amber-500/30 hover:bg-amber-500/20">
                <Clock className="h-3 w-3" /> {warning.length} próximo{warning.length > 1 ? "s" : ""}
              </Badge>
            )}
            {withSla.length === 0 && (
              <Badge variant="secondary" className="text-[10px]">Nenhum SLA ativo</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {withSla.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-muted-foreground/50">
            <Shield className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm font-medium">Nenhuma conversa com SLA definido</p>
            <p className="text-xs mt-1">Defina SLAs no Kanban para monitorar aqui</p>
          </div>
        ) : (
          <div className="space-y-1">
            {expired.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-destructive px-3 py-1 flex items-center gap-1">
                  <Flame className="h-3 w-3" /> SLA Excedido ({expired.length})
                </p>
                <ScrollArea className={expired.length > 3 ? "max-h-[160px]" : ""}>
                  {expired.map(({ conv, sla }) => <SlaRow key={conv.id} conv={conv} sla={sla} />)}
                </ScrollArea>
              </div>
            )}

            {warning.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-amber-500 px-3 py-1 flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" /> Próximo de expirar ({warning.length})
                </p>
                <ScrollArea className={warning.length > 3 ? "max-h-[160px]" : ""}>
                  {warning.map(({ conv, sla }) => <SlaRow key={conv.id} conv={conv} sla={sla} />)}
                </ScrollArea>
              </div>
            )}

            {ok.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase text-muted-foreground px-3 py-1 flex items-center gap-1 mt-1">
                  <CheckCircle2 className="h-3 w-3" /> Dentro do prazo ({ok.length})
                </p>
                <ScrollArea className={ok.length > 3 ? "max-h-[160px]" : ""}>
                  {ok.map(({ conv, sla }) => <SlaRow key={conv.id} conv={conv} sla={sla} />)}
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// ── Dashboard ───────────────────────────────────────────────────────

const Dashboard = () => {
  const isConnected = true;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visão geral do seu sistema de mensagens
          </p>
        </div>
        <Card className="flex items-center gap-3 px-4 py-2">
          {isConnected ? (
            <>
              <Wifi className="h-4 w-4 text-success" />
              <div>
                <p className="text-xs font-medium text-success">Conectado</p>
                <p className="text-xs text-muted-foreground">+55 11 99999-9999</p>
              </div>
            </>
          ) : (
            <>
              <WifiOff className="h-4 w-4 text-destructive" />
              <div>
                <p className="text-xs font-medium text-destructive">Desconectado</p>
                <Button size="sm" variant="outline" className="mt-1 h-6 text-xs">
                  Reconectar
                </Button>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {statsCards.map((stat) => (
          <Card key={stat.title} className="transition-all duration-200 hover:shadow-md">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <stat.icon className="h-8 w-8 text-primary opacity-80" />
                {stat.change && (
                  <span
                    className={`flex items-center gap-1 text-xs font-medium ${
                      stat.trend === "up" ? "text-success" : "text-destructive"
                    }`}
                  >
                    {stat.trend === "up" ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {stat.change}
                  </span>
                )}
              </div>
              <p className="mt-2 font-heading text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* SLA Panel */}
      <SlaSummaryPanel />

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">Mensagens (últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Line type="monotone" dataKey="enviadas" stroke="hsl(88, 52%, 51%)" strokeWidth={2} dot={false} name="Enviadas" />
                <Line type="monotone" dataKey="entregues" stroke="hsl(88, 52%, 36%)" strokeWidth={2} dot={false} name="Entregues" />
                <Line type="monotone" dataKey="lidas" stroke="hsl(217, 91%, 60%)" strokeWidth={2} dot={false} name="Lidas" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Status das Mensagens</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-muted-foreground">{item.name}</span>
                  <span className="ml-auto font-medium">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Campaigns */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Top 5 Campanhas por Desempenho</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} stroke="hsl(var(--muted-foreground))" />
              <RechartsTooltip />
              <Bar dataKey="desempenho" fill="hsl(88, 52%, 51%)" radius={[0, 6, 6, 0]} name="Desempenho %" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
