import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Download, Calendar as CalendarIcon, MessageSquare, Megaphone, Users, TrendingUp, Send, CheckCircle2, Eye, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import NPSDashboard from "@/components/reports/NPSDashboard";
import CampaignContactsReport from "@/components/reports/CampaignContactsReport";

type DateRange = { from: Date; to: Date };

const PRESETS = [
  { label: "7 dias", days: 7 },
  { label: "14 dias", days: 14 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
];

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(142, 76%, 36%)",
  "hsl(0, 84%, 60%)",
  "hsl(45, 93%, 47%)",
];

const Reports = () => {
  const [range, setRange] = useState<DateRange>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });
  const [calendarOpen, setCalendarOpen] = useState(false);

  const rangeISO = useMemo(() => ({
    from: startOfDay(range.from).toISOString(),
    to: endOfDay(range.to).toISOString(),
  }), [range]);

  const days = useMemo(
    () => eachDayOfInterval({ start: range.from, end: range.to }),
    [range]
  );

  // ── Messages data ──
  const { data: messages = [] } = useQuery({
    queryKey: ["report-messages", rangeISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("messages")
        .select("direction, status, type, created_at")
        .gte("created_at", rangeISO.from)
        .lte("created_at", rangeISO.to)
        .order("created_at", { ascending: true })
        .limit(5000);
      return data || [];
    },
  });

  // ── Campaigns data ──
  const { data: campaigns = [] } = useQuery({
    queryKey: ["report-campaigns", rangeISO],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaigns")
        .select("id, name, status, stats, created_at, started_at, completed_at")
        .gte("created_at", rangeISO.from)
        .lte("created_at", rangeISO.to)
        .order("created_at", { ascending: false });
      return data || [];
    },
  });

  // ── Attendant data ──
  const { data: attendantData } = useQuery({
    queryKey: ["report-attendants", rangeISO],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      if (!roles?.length) return { attendants: [], conversations: [] };

      const ids = roles.map((r: any) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", ids);

      const { data: convs } = await supabase
        .from("conversations")
        .select("assigned_to, status, created_at, last_message_at")
        .in("assigned_to", ids)
        .gte("created_at", rangeISO.from)
        .lte("created_at", rangeISO.to);

      const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.name]));

      const byUser = new Map<string, { name: string; resolved: number; active: number; total: number }>();
      for (const r of roles) {
        byUser.set(r.user_id, {
          name: profileMap.get(r.user_id) || "Sem nome",
          resolved: 0,
          active: 0,
          total: 0,
        });
      }
      for (const c of (convs || []) as any[]) {
        const entry = byUser.get(c.assigned_to);
        if (!entry) continue;
        entry.total++;
        if (c.status === "resolved" || c.status === "closed") entry.resolved++;
        else entry.active++;
      }

      return {
        attendants: Array.from(byUser.values()),
        conversations: convs || [],
      };
    },
  });

  // ── Computed stats ──
  const msgStats = useMemo(() => {
    const outbound = messages.filter((m: any) => m.direction === "outbound");
    const inbound = messages.filter((m: any) => m.direction === "inbound");
    const sent = outbound.length;
    const delivered = outbound.filter((m: any) => m.status === "delivered" || m.status === "read").length;
    const read = outbound.filter((m: any) => m.status === "read").length;
    const failed = outbound.filter((m: any) => m.status === "error" || m.status === "failed").length;

    // Messages per day
    const byDay = new Map<string, { inbound: number; outbound: number }>();
    for (const d of days) {
      byDay.set(format(d, "yyyy-MM-dd"), { inbound: 0, outbound: 0 });
    }
    for (const m of messages as any[]) {
      const key = format(parseISO(m.created_at), "yyyy-MM-dd");
      const entry = byDay.get(key);
      if (entry) {
        if (m.direction === "inbound") entry.inbound++;
        else entry.outbound++;
      }
    }

    const dailyData = Array.from(byDay.entries()).map(([date, counts]) => ({
      date: format(parseISO(date), "dd/MM", { locale: ptBR }),
      Recebidas: counts.inbound,
      Enviadas: counts.outbound,
    }));

    // By type
    const typeCounts = new Map<string, number>();
    for (const m of messages as any[]) {
      const t = m.type || "text";
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }
    const typeData = Array.from(typeCounts.entries())
      .map(([name, value]) => ({ name: name === "text" ? "Texto" : name === "image" ? "Imagem" : name === "audio" ? "Áudio" : name === "video" ? "Vídeo" : name === "document" ? "Documento" : name === "note" ? "Nota" : name, value }))
      .sort((a, b) => b.value - a.value);

    return { sent, delivered, read, failed, inbound: inbound.length, total: messages.length, dailyData, typeData };
  }, [messages, days]);

  const campStats = useMemo(() => {
    let totalSent = 0, totalDelivered = 0, totalRead = 0, totalFailed = 0;
    for (const c of campaigns as any[]) {
      const s = c.stats || {};
      totalSent += s.sent || 0;
      totalDelivered += s.delivered || 0;
      totalRead += s.read || 0;
      totalFailed += s.failed || 0;
    }

    const statusCounts = { draft: 0, scheduled: 0, running: 0, completed: 0, paused: 0 };
    for (const c of campaigns as any[]) {
      const key = c.status as keyof typeof statusCounts;
      if (key in statusCounts) statusCounts[key]++;
    }

    const statusData = [
      { name: "Rascunho", value: statusCounts.draft, color: "hsl(var(--muted-foreground))" },
      { name: "Agendada", value: statusCounts.scheduled, color: "hsl(45, 93%, 47%)" },
      { name: "Executando", value: statusCounts.running, color: "hsl(var(--primary))" },
      { name: "Concluída", value: statusCounts.completed, color: "hsl(142, 76%, 36%)" },
      { name: "Pausada", value: statusCounts.paused, color: "hsl(0, 84%, 60%)" },
    ].filter((d) => d.value > 0);

    return { totalSent, totalDelivered, totalRead, totalFailed, total: campaigns.length, statusData };
  }, [campaigns]);

  const attStats = useMemo(() => {
    const atts = attendantData?.attendants || [];
    const sorted = [...atts].sort((a, b) => b.resolved - a.resolved);
    const chartData = sorted.map((a) => ({
      name: a.name.split(" ")[0],
      Resolvidas: a.resolved,
      Ativas: a.active,
    }));
    const totalResolved = atts.reduce((s, a) => s + a.resolved, 0);
    const totalActive = atts.reduce((s, a) => s + a.active, 0);
    return { chartData, totalResolved, totalActive, count: atts.length };
  }, [attendantData]);

  const handleExportPDF = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Análise de desempenho com dados em tempo real</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Period Presets */}
          {PRESETS.map((p) => (
            <Button
              key={p.days}
              variant="outline"
              size="sm"
              className={cn(
                "text-xs",
                Math.round((range.to.getTime() - range.from.getTime()) / 86400000) === p.days &&
                  "border-primary text-primary"
              )}
              onClick={() => setRange({ from: subDays(new Date(), p.days), to: new Date() })}
            >
              {p.label}
            </Button>
          ))}

          {/* Custom Range */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="text-xs">
                <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                {format(range.from, "dd/MM", { locale: ptBR })} — {format(range.to, "dd/MM", { locale: ptBR })}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={{ from: range.from, to: range.to }}
                onSelect={(r: any) => {
                  if (r?.from && r?.to) {
                    setRange({ from: r.from, to: r.to });
                    setCalendarOpen(false);
                  } else if (r?.from) {
                    setRange((prev) => ({ ...prev, from: r.from }));
                  }
                }}
                numberOfMonths={2}
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          <Button variant="outline" size="sm" onClick={handleExportPDF}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="mensagens" className="w-full">
        <TabsList>
          <TabsTrigger value="mensagens"><MessageSquare className="mr-1.5 h-4 w-4" /> Mensagens</TabsTrigger>
          <TabsTrigger value="campanhas"><Megaphone className="mr-1.5 h-4 w-4" /> Campanhas</TabsTrigger>
          <TabsTrigger value="atendentes"><Users className="mr-1.5 h-4 w-4" /> Atendentes</TabsTrigger>
          <TabsTrigger value="nps">📊 NPS</TabsTrigger>
        </TabsList>

        {/* ═══════ MENSAGENS ═══════ */}
        <TabsContent value="mensagens" className="space-y-6 mt-4">
          <div className="grid gap-4 sm:grid-cols-5">
            {[
              { label: "Total", value: msgStats.total, icon: MessageSquare, color: "text-foreground" },
              { label: "Enviadas", value: msgStats.sent, icon: Send, color: "text-blue-500" },
              { label: "Entregues", value: msgStats.delivered, icon: CheckCircle2, color: "text-emerald-500" },
              { label: "Lidas", value: msgStats.read, icon: Eye, color: "text-primary" },
              { label: "Falhas", value: msgStats.failed, icon: XCircle, color: "text-destructive" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className={cn("h-6 w-6 shrink-0", s.color)} />
                  <div>
                    <p className="font-heading text-2xl font-bold">{s.value.toLocaleString("pt-BR")}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="font-heading text-lg">Evolução Diária</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={msgStats.dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                    />
                    <Line type="monotone" dataKey="Enviadas" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="Recebidas" stroke="hsl(142, 76%, 36%)" strokeWidth={2} dot={{ r: 3 }} />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Por Tipo</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={msgStats.typeData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {msgStats.typeData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ═══════ CAMPANHAS ═══════ */}
        <TabsContent value="campanhas" className="space-y-6 mt-4">
          <div className="grid gap-4 sm:grid-cols-5">
            {[
              { label: "Campanhas", value: campStats.total, icon: Megaphone, color: "text-foreground" },
              { label: "Enviadas", value: campStats.totalSent, icon: Send, color: "text-blue-500" },
              { label: "Entregues", value: campStats.totalDelivered, icon: CheckCircle2, color: "text-emerald-500" },
              { label: "Lidas", value: campStats.totalRead, icon: Eye, color: "text-primary" },
              { label: "Falhas", value: campStats.totalFailed, icon: XCircle, color: "text-destructive" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className={cn("h-6 w-6 shrink-0", s.color)} />
                  <div>
                    <p className="font-heading text-2xl font-bold">{s.value.toLocaleString("pt-BR")}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Status das Campanhas</CardTitle>
              </CardHeader>
              <CardContent>
                {campStats.statusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={campStats.statusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {campStats.statusData.map((d, i) => (
                          <Cell key={i} fill={d.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                    Nenhuma campanha no período
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-heading text-lg">Desempenho por Campanha</CardTitle>
              </CardHeader>
              <CardContent>
                {campaigns.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={(campaigns as any[]).slice(0, 10).map((c) => {
                        const s = c.stats || {};
                        return {
                          name: c.name.length > 15 ? c.name.slice(0, 15) + "…" : c.name,
                          Enviadas: s.sent || 0,
                          Entregues: s.delivered || 0,
                          Lidas: s.read || 0,
                        };
                      })}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" width={120} stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="Enviadas" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Entregues" fill="hsl(142, 76%, 36%)" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="Lidas" fill="hsl(45, 93%, 47%)" radius={[0, 4, 4, 0]} />
                      <Legend />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                    Nenhuma campanha no período
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Campaign contacts detail */}
          <CampaignContactsReport campaigns={campaigns as any} />
        </TabsContent>

        {/* ═══════ ATENDENTES ═══════ */}
        <TabsContent value="atendentes" className="space-y-6 mt-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Atendentes Ativos", value: attStats.count, icon: Users, color: "text-primary" },
              { label: "Conversas Resolvidas", value: attStats.totalResolved, icon: CheckCircle2, color: "text-emerald-500" },
              { label: "Conversas Ativas", value: attStats.totalActive, icon: TrendingUp, color: "text-blue-500" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className={cn("h-6 w-6 shrink-0", s.color)} />
                  <div>
                    <p className="font-heading text-2xl font-bold">{s.value}</p>
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-lg">Desempenho por Atendente</CardTitle>
            </CardHeader>
            <CardContent>
              {attStats.chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={attStats.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 12 }} />
                    <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="Resolvidas" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Ativas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Legend />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-[350px] items-center justify-center text-sm text-muted-foreground">
                  Nenhum atendente com conversas no período
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════ NPS ═══════ */}
        <TabsContent value="nps" className="mt-4">
          <NPSDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Reports;
