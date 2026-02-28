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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

const statsCards = [
  {
    title: "Mensagens Hoje",
    value: "1.234",
    change: "+12%",
    trend: "up",
    icon: MessageSquare,
  },
  {
    title: "Taxa de Entrega",
    value: "95.8%",
    change: "+2.1%",
    trend: "up",
    icon: CheckCircle2,
  },
  {
    title: "Taxa de Leitura",
    value: "78.2%",
    change: "-1.4%",
    trend: "down",
    icon: Eye,
  },
  {
    title: "Contatos Ativos",
    value: "8.456",
    change: "+156",
    trend: "up",
    icon: Users,
  },
  {
    title: "Campanhas Ativas",
    value: "3",
    change: "",
    trend: "up",
    icon: Megaphone,
  },
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
                    {stat.trend === "up" ? (
                      <TrendingUp className="h-3 w-3" />
                    ) : (
                      <TrendingDown className="h-3 w-3" />
                    )}
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

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Mensagens (últimos 30 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="enviadas"
                  stroke="hsl(88, 52%, 51%)"
                  strokeWidth={2}
                  dot={false}
                  name="Enviadas"
                />
                <Line
                  type="monotone"
                  dataKey="entregues"
                  stroke="hsl(88, 52%, 36%)"
                  strokeWidth={2}
                  dot={false}
                  name="Entregues"
                />
                <Line
                  type="monotone"
                  dataKey="lidas"
                  stroke="hsl(217, 91%, 60%)"
                  strokeWidth={2}
                  dot={false}
                  name="Lidas"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-lg">
              Status das Mensagens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {pieData.map((item) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
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
          <CardTitle className="font-heading text-lg">
            Top 5 Campanhas por Desempenho
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 12 }}
                width={120}
                stroke="hsl(var(--muted-foreground))"
              />
              <Tooltip />
              <Bar dataKey="desempenho" fill="hsl(88, 52%, 51%)" radius={[0, 6, 6, 0]} name="Desempenho %" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
