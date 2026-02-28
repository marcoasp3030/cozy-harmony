import { useState, useEffect, useCallback } from "react";
import { TrendingUp, Users, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface StageData {
  name: string;
  color: string;
  count: number;
}

interface ScoreBucket {
  range: string;
  count: number;
}

const FunnelLeadsPanel = () => {
  const [stageData, setStageData] = useState<StageData[]>([]);
  const [scoreBuckets, setScoreBuckets] = useState<ScoreBucket[]>([]);
  const [totalLeads, setTotalLeads] = useState(0);
  const [avgScore, setAvgScore] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: convs }, { data: stages }, { data: funnels }] = await Promise.all([
      supabase.from("conversations").select("funnel_id, funnel_stage_id, score"),
      supabase.from("funnel_stages").select("id, name, color, funnel_id, position").order("position"),
      supabase.from("funnels").select("id, name"),
    ]);

    if (!convs || !stages) { setLoading(false); return; }

    // Count conversations per stage
    const stageCounts = new Map<string, number>();
    for (const c of convs) {
      if (c.funnel_stage_id) {
        stageCounts.set(c.funnel_stage_id, (stageCounts.get(c.funnel_stage_id) || 0) + 1);
      }
    }

    const stageChart: StageData[] = stages
      .filter(s => stageCounts.has(s.id))
      .map(s => ({
        name: s.name,
        color: s.color,
        count: stageCounts.get(s.id) || 0,
      }));

    // Also include stages with 0 from active funnels
    const activeFunnelIds = new Set(convs.filter(c => c.funnel_id).map(c => c.funnel_id));
    for (const s of stages) {
      if (activeFunnelIds.has(s.funnel_id) && !stageCounts.has(s.id)) {
        stageChart.push({ name: s.name, color: s.color, count: 0 });
      }
    }

    setStageData(stageChart);

    // Score distribution
    const scores = convs.map(c => (c.score as number) || 0);
    const withScore = scores.filter(s => s > 0);
    setTotalLeads(withScore.length);
    setAvgScore(withScore.length > 0 ? Math.round(withScore.reduce((a, b) => a + b, 0) / withScore.length) : 0);

    const buckets: ScoreBucket[] = [
      { range: "0", count: scores.filter(s => s === 0).length },
      { range: "1-10", count: scores.filter(s => s >= 1 && s <= 10).length },
      { range: "11-25", count: scores.filter(s => s >= 11 && s <= 25).length },
      { range: "26-50", count: scores.filter(s => s >= 26 && s <= 50).length },
      { range: "51-100", count: scores.filter(s => s >= 51 && s <= 100).length },
      { range: "100+", count: scores.filter(s => s > 100).length },
    ].filter(b => b.count > 0);

    setScoreBuckets(buckets);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground text-sm">
          Carregando dados do funil...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Leads por Etapa */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Leads por Etapa do Funil
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {stageData.reduce((a, b) => a + b.count, 0)} conversas
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {stageData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stageData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="count" name="Leads" radius={[6, 6, 0, 0]}>
                    {stageData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              {/* Legend */}
              <div className="mt-3 flex flex-wrap gap-2">
                {stageData.filter(s => s.count > 0).map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5 text-xs">
                    <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-muted-foreground">{s.name}</span>
                    <span className="font-semibold">{s.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-8 text-muted-foreground/50">
              <BarChart3 className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">Nenhuma conversa em funis</p>
              <p className="text-xs mt-1">Atribua conversas a um funil para ver dados aqui</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Distribuição de Score */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="font-heading text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Distribuição de Score
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs gap-1">
                <Users className="h-3 w-3" /> {totalLeads} leads
              </Badge>
              {avgScore > 0 && (
                <Badge variant="secondary" className="text-xs">
                  Média: {avgScore}pts
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {scoreBuckets.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={scoreBuckets}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="count"
                    nameKey="range"
                    label={({ range, count }) => `${range} (${count})`}
                  >
                    {scoreBuckets.map((_, index) => {
                      const colors = [
                        "hsl(var(--muted-foreground))",
                        "hsl(210, 60%, 55%)",
                        "hsl(170, 55%, 45%)",
                        "hsl(88, 52%, 51%)",
                        "hsl(45, 90%, 50%)",
                        "hsl(0, 75%, 55%)",
                      ];
                      return <Cell key={index} fill={colors[index % colors.length]} />;
                    })}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 flex flex-wrap gap-2 justify-center">
                {scoreBuckets.map((b, i) => {
                  const colors = [
                    "hsl(var(--muted-foreground))",
                    "hsl(210, 60%, 55%)",
                    "hsl(170, 55%, 45%)",
                    "hsl(88, 52%, 51%)",
                    "hsl(45, 90%, 50%)",
                    "hsl(0, 75%, 55%)",
                  ];
                  return (
                    <div key={b.range} className="flex items-center gap-1.5 text-xs">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                      <span className="text-muted-foreground">{b.range} pts</span>
                      <span className="font-semibold">{b.count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center py-8 text-muted-foreground/50">
              <TrendingUp className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm">Nenhum lead com pontuação</p>
              <p className="text-xs mt-1">Configure regras de scoring nos Funis</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default FunnelLeadsPanel;
