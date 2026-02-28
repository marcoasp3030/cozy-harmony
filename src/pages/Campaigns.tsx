import { Plus, Play, Pause, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

const mockCampaigns = [
  {
    id: "1",
    name: "Black Friday 2024",
    status: "running",
    total: 1000,
    sent: 680,
    delivered: 650,
    read: 420,
    failed: 12,
    createdAt: "20/01/2025 14:30",
  },
  {
    id: "2",
    name: "Promoção de Janeiro",
    status: "completed",
    total: 500,
    sent: 500,
    delivered: 485,
    read: 310,
    failed: 5,
    createdAt: "15/01/2025 09:00",
  },
  {
    id: "3",
    name: "Boas-vindas Novos",
    status: "paused",
    total: 200,
    sent: 80,
    delivered: 78,
    read: 45,
    failed: 2,
    createdAt: "22/01/2025 10:15",
  },
  {
    id: "4",
    name: "Reativação Q1",
    status: "draft",
    total: 1500,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    createdAt: "25/01/2025 16:00",
  },
];

const statusConfig: Record<string, { label: string; className: string }> = {
  running: { label: "Em execução", className: "bg-success/15 text-success" },
  completed: { label: "Concluída", className: "bg-primary/15 text-primary" },
  paused: { label: "Pausada", className: "bg-warning/15 text-warning" },
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelada", className: "bg-destructive/15 text-destructive" },
};

const Campaigns = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Crie e gerencie campanhas de disparo em massa
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      <div className="grid gap-4">
        {mockCampaigns.map((campaign) => {
          const progress = campaign.total > 0 ? (campaign.sent / campaign.total) * 100 : 0;
          const config = statusConfig[campaign.status];

          return (
            <Card
              key={campaign.id}
              className="transition-all duration-200 hover:shadow-md"
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-heading font-semibold">
                      📢 {campaign.name}
                    </span>
                    <Badge variant="secondary" className={config.className}>
                      {config.label}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {campaign.status === "running" && (
                      <Button size="sm" variant="outline">
                        <Pause className="mr-1 h-3 w-3" />
                        Pausar
                      </Button>
                    )}
                    {campaign.status === "paused" && (
                      <Button size="sm" variant="outline">
                        <Play className="mr-1 h-3 w-3" />
                        Retomar
                      </Button>
                    )}
                    <Button size="sm" variant="outline">
                      <BarChart3 className="mr-1 h-3 w-3" />
                      Relatório
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progresso</span>
                    <span className="font-medium">
                      {progress.toFixed(0)}% ({campaign.sent}/{campaign.total})
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                <div className="mt-4 flex items-center gap-6 text-sm">
                  <span>
                    ✓ Enviadas:{" "}
                    <strong>{campaign.sent.toLocaleString()}</strong>
                  </span>
                  <span>
                    ✓ Entregues:{" "}
                    <strong>{campaign.delivered.toLocaleString()}</strong>
                  </span>
                  <span>
                    👁 Lidas:{" "}
                    <strong>{campaign.read.toLocaleString()}</strong>
                  </span>
                  <span className="text-destructive">
                    ✗ Falhas:{" "}
                    <strong>{campaign.failed.toLocaleString()}</strong>
                  </span>
                </div>

                <p className="mt-3 text-xs text-muted-foreground">
                  Criada: {campaign.createdAt}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Campaigns;
