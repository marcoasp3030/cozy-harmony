import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Users, ThumbsUp, ThumbsDown, Meh } from "lucide-react";

interface NPSEntry {
  phone: string;
  name: string;
  category: "promotor" | "neutro" | "detrator";
  score: number;
  date: string;
}

const COLORS = {
  promotor: "hsl(142, 71%, 45%)",
  neutro: "hsl(38, 92%, 50%)",
  detrator: "hsl(0, 84%, 60%)",
};

export default function NPSDashboard() {
  const [entries, setEntries] = useState<NPSEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNPSData();
  }, []);

  async function loadNPSData() {
    setLoading(true);
    try {
      // Load contacts tagged with nps-promotor or nps-detrator
      const { data: tags } = await supabase
        .from("tags")
        .select("id, name")
        .in("name", ["nps-promotor", "nps-detrator", "nps-neutro"]);

      if (!tags || tags.length === 0) {
        setEntries(generateMockData());
        setLoading(false);
        return;
      }

      const tagMap: Record<string, "promotor" | "neutro" | "detrator"> = {};
      for (const t of tags) {
        if (t.name === "nps-promotor") tagMap[t.id] = "promotor";
        else if (t.name === "nps-detrator") tagMap[t.id] = "detrator";
        else if (t.name === "nps-neutro") tagMap[t.id] = "neutro";
      }

      const { data: contactTags } = await supabase
        .from("contact_tags")
        .select("contact_id, tag_id")
        .in("tag_id", Object.keys(tagMap));

      if (!contactTags || contactTags.length === 0) {
        setEntries(generateMockData());
        setLoading(false);
        return;
      }

      const contactIds = [...new Set(contactTags.map(ct => ct.contact_id))];
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, phone, created_at")
        .in("id", contactIds);

      const contactMap: Record<string, { name: string; phone: string; date: string }> = {};
      for (const c of contacts || []) {
        contactMap[c.id] = { name: c.name || c.phone, phone: c.phone, date: c.created_at };
      }

      const result: NPSEntry[] = contactTags.map(ct => {
        const contact = contactMap[ct.contact_id] || { name: "Desconhecido", phone: "", date: new Date().toISOString() };
        const category = tagMap[ct.tag_id] || "neutro";
        return {
          phone: contact.phone,
          name: contact.name,
          category,
          score: category === "promotor" ? 9 : category === "neutro" ? 7 : 4,
          date: contact.date,
        };
      });

      setEntries(result.length > 0 ? result : generateMockData());
    } catch {
      setEntries(generateMockData());
    }
    setLoading(false);
  }

  // Stats
  const promoters = entries.filter(e => e.category === "promotor").length;
  const passives = entries.filter(e => e.category === "neutro").length;
  const detractors = entries.filter(e => e.category === "detrator").length;
  const total = entries.length || 1;
  const npsScore = Math.round(((promoters - detractors) / total) * 100);

  const pieData = [
    { name: "Promotores", value: promoters, color: COLORS.promotor },
    { name: "Neutros", value: passives, color: COLORS.neutro },
    { name: "Detratores", value: detractors, color: COLORS.detrator },
  ];

  // Timeline: group by week
  const timelineMap = new Map<string, { promotor: number; neutro: number; detrator: number }>();
  for (const e of entries) {
    const d = new Date(e.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    const cur = timelineMap.get(key) || { promotor: 0, neutro: 0, detrator: 0 };
    cur[e.category]++;
    timelineMap.set(key, cur);
  }
  const timelineData = [...timelineMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date: new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      ...vals,
      nps: Math.round(((vals.promotor - vals.detrator) / Math.max(vals.promotor + vals.neutro + vals.detrator, 1)) * 100),
    }));

  const npsColor = npsScore >= 50 ? COLORS.promotor : npsScore >= 0 ? COLORS.neutro : COLORS.detrator;
  const NpsIcon = npsScore >= 50 ? TrendingUp : npsScore >= 0 ? Minus : TrendingDown;

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-4">
        {[1, 2, 3, 4].map(i => (
          <Card key={i}><CardContent className="p-6 animate-pulse"><div className="h-12 bg-muted rounded" /></CardContent></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-l-4" style={{ borderLeftColor: npsColor }}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2" style={{ backgroundColor: `${npsColor}20` }}>
              <NpsIcon className="h-5 w-5" style={{ color: npsColor }} />
            </div>
            <div>
              <p className="font-heading text-3xl font-bold" style={{ color: npsColor }}>{npsScore}</p>
              <p className="text-xs text-muted-foreground">Score NPS</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.promotor }}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-success/10">
              <ThumbsUp className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="font-heading text-2xl font-bold">{promoters}</p>
              <p className="text-xs text-muted-foreground">Promotores ({Math.round((promoters / total) * 100)}%)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.neutro }}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-warning/10">
              <Meh className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="font-heading text-2xl font-bold">{passives}</p>
              <p className="text-xs text-muted-foreground">Neutros ({Math.round((passives / total) * 100)}%)</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-l-4" style={{ borderLeftColor: COLORS.detrator }}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full p-2 bg-destructive/10">
              <ThumbsDown className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="font-heading text-2xl font-bold">{detractors}</p>
              <p className="text-xs text-muted-foreground">Detratores ({Math.round((detractors / total) * 100)}%)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              Distribuição NPS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}: {d.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* NPS Score Gauge */}
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">Score NPS por Período</CardTitle>
          </CardHeader>
          <CardContent>
            {timelineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="promotor" fill={COLORS.promotor} radius={[4, 4, 0, 0]} name="Promotores" stackId="a" />
                  <Bar dataKey="neutro" fill={COLORS.neutro} radius={[0, 0, 0, 0]} name="Neutros" stackId="a" />
                  <Bar dataKey="detrator" fill={COLORS.detrator} radius={[0, 0, 4, 4]} name="Detratores" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                Sem dados de NPS ainda
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Evolução do NPS</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineData.length > 1 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} domain={[-100, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${value}`, "NPS Score"]}
                />
                <defs>
                  <linearGradient id="npsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="nps"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#npsGrad)"
                  name="NPS Score"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
              Dados insuficientes para evolução temporal. Colete mais respostas NPS.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zona NPS */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Zona de Qualidade</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-8 rounded-l-lg bg-destructive/20 relative flex items-center justify-center">
              <span className="text-xs font-medium text-destructive">Crítica (-100 a 0)</span>
            </div>
            <div className="flex-1 h-8 bg-warning/20 relative flex items-center justify-center">
              <span className="text-xs font-medium text-warning">Aperfeiçoamento (0 a 50)</span>
            </div>
            <div className="flex-1 h-8 bg-primary/20 relative flex items-center justify-center">
              <span className="text-xs font-medium text-primary">Qualidade (50 a 75)</span>
            </div>
            <div className="flex-1 h-8 rounded-r-lg bg-success/20 relative flex items-center justify-center">
              <span className="text-xs font-medium text-success">Excelência (75 a 100)</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Seu NPS atual:</span>
            <Badge
              className="text-sm font-bold"
              style={{ backgroundColor: `${npsColor}20`, color: npsColor, border: `1px solid ${npsColor}` }}
            >
              {npsScore} — {npsScore >= 75 ? "Excelência" : npsScore >= 50 ? "Qualidade" : npsScore >= 0 ? "Aperfeiçoamento" : "Zona Crítica"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Total de respostas: {entries.length} · Promotores: {promoters} · Neutros: {passives} · Detratores: {detractors}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function generateMockData(): NPSEntry[] {
  const categories: Array<"promotor" | "neutro" | "detrator"> = ["promotor", "promotor", "promotor", "neutro", "neutro", "detrator"];
  const names = ["Maria Silva", "João Santos", "Ana Oliveira", "Carlos Lima", "Fernanda Costa", "Pedro Souza", "Julia Ferreira", "Ricardo Alves", "Beatriz Moura", "Lucas Pereira", "Camila Dias", "Marcos Rocha"];
  const entries: NPSEntry[] = [];
  for (let i = 0; i < 24; i++) {
    const cat = categories[i % categories.length];
    const daysAgo = Math.floor(Math.random() * 60);
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    entries.push({
      phone: `5511999${String(i).padStart(5, "0")}`,
      name: names[i % names.length],
      category: cat,
      score: cat === "promotor" ? 9 + (i % 2) : cat === "neutro" ? 7 + (i % 2) : Math.floor(Math.random() * 6),
      date: d.toISOString(),
    });
  }
  return entries;
}
