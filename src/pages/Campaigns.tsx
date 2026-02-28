import { useState, useEffect } from "react";
import { Plus, Play, Pause, BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import CreateCampaignDialog from "@/components/campaigns/CreateCampaignDialog";

interface Campaign {
  id: string;
  name: string;
  status: string;
  stats: { total: number; sent: number; delivered: number; read: number; failed: number } | null;
  created_at: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  running: { label: "Em execução", className: "bg-success/15 text-success" },
  completed: { label: "Concluída", className: "bg-primary/15 text-primary" },
  paused: { label: "Pausada", className: "bg-warning/15 text-warning" },
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendada", className: "bg-info/15 text-info" },
  cancelled: { label: "Cancelada", className: "bg-destructive/15 text-destructive" },
};

const Campaigns = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadCampaigns = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, status, stats, created_at")
      .order("created_at", { ascending: false });
    setCampaigns((data as Campaign[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    loadCampaigns();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Crie e gerencie campanhas de disparo em massa
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground">Nenhuma campanha criada ainda.</p>
            <Button variant="outline" className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Criar primeira campanha
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => {
            const s = (campaign.stats as any) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
            const progress = s.total > 0 ? (s.sent / s.total) * 100 : 0;
            const config = statusConfig[campaign.status] || statusConfig.draft;

            return (
              <Card key={campaign.id} className="transition-all duration-200 hover:shadow-md">
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
                        {progress.toFixed(0)}% ({s.sent}/{s.total})
                      </span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  <div className="mt-4 flex items-center gap-6 text-sm flex-wrap">
                    <span>✓ Enviadas: <strong>{s.sent.toLocaleString()}</strong></span>
                    <span>✓ Entregues: <strong>{s.delivered.toLocaleString()}</strong></span>
                    <span>👁 Lidas: <strong>{s.read.toLocaleString()}</strong></span>
                    <span className="text-destructive">✗ Falhas: <strong>{s.failed.toLocaleString()}</strong></span>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    Criada: {new Date(campaign.created_at).toLocaleString("pt-BR")}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={loadCampaigns}
      />
    </div>
  );
};

export default Campaigns;
