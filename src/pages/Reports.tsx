import { Download, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const weekData = [
  { day: "Seg", enviadas: 320, entregues: 305, lidas: 210 },
  { day: "Ter", enviadas: 450, entregues: 430, lidas: 300 },
  { day: "Qua", enviadas: 280, entregues: 270, lidas: 190 },
  { day: "Qui", enviadas: 510, entregues: 490, lidas: 350 },
  { day: "Sex", enviadas: 390, entregues: 375, lidas: 260 },
  { day: "Sáb", enviadas: 120, entregues: 115, lidas: 80 },
  { day: "Dom", enviadas: 60, entregues: 58, lidas: 40 },
];

const Reports = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Relatórios</h1>
          <p className="text-sm text-muted-foreground">Análise de desempenho do seu sistema</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Calendar className="mr-2 h-4 w-4" />
            Últimos 7 dias
          </Button>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: "Total Enviadas", value: "2.130" },
          { label: "Taxa de Entrega", value: "96.2%" },
          { label: "Taxa de Leitura", value: "68.8%" },
          { label: "Tempo Médio Resposta", value: "4min 32s" },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4 text-center">
              <p className="font-heading text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Mensagens por Dia da Semana</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={weekData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" />
              <YAxis stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="enviadas" fill="hsl(88, 52%, 51%)" radius={[4, 4, 0, 0]} name="Enviadas" />
              <Bar dataKey="entregues" fill="hsl(88, 52%, 36%)" radius={[4, 4, 0, 0]} name="Entregues" />
              <Bar dataKey="lidas" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} name="Lidas" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default Reports;
