import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, Play, Pause, BarChart3, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import CreateCampaignDialog from "@/components/campaigns/CreateCampaignDialog";

interface CampaignStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  stats: CampaignStats | null;
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
  const [executing, setExecuting] = useState<Record<string, boolean>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = useCallback(async () => {
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, status, stats, created_at")
      .order("created_at", { ascending: false });
    setCampaigns((data as unknown as Campaign[]) || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadCampaigns().finally(() => setLoading(false));
  }, [loadCampaigns]);

  // Poll while any campaign is running
  useEffect(() => {
    const hasRunning = campaigns.some((c) => c.status === "running");
    if (hasRunning) {
      pollingRef.current = setInterval(loadCampaigns, 3000);
    } else if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [campaigns, loadCampaigns]);

  const executeCampaign = async (campaignId: string, action: "start" | "resume" | "pause") => {
    setExecuting((prev) => ({ ...prev, [campaignId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("campaign-execute", {
        body: { action, campaignId },
      });

      if (error) throw error;

      if (data?.error) {
        // Show specific anti-block messages
        if (data.code === "OUTSIDE_BUSINESS_HOURS") {
          toast.warning("⏰ " + data.error, { duration: 8000 });
        } else if (data.code === "DAILY_LIMIT_REACHED") {
          toast.warning(`🛡️ ${data.error}`, { duration: 8000 });
        } else {
          toast.error(data.error);
        }
      } else if (action === "pause") {
        toast.info("Campanha pausada.");
      } else if (data?.autoPaused) {
        toast.warning(`⚠️ ${data.autoPausedReason}`, { duration: 10000 });
      } else {
        const remaining = data?.remaining ?? 0;
        if (remaining > 0) {
          const cooldown = (data?.cooldownSec || 15) * 1000;
          toast.success(
            `🛡️ Lote processado: ${data.sent} enviadas, ${data.failed} falhas. Restam ${remaining}. Aguardando ${data.cooldownSec || 15}s...`,
            { duration: cooldown },
          );
          // Auto-continue with cooldown between batches
          setTimeout(() => executeCampaign(campaignId, "resume"), cooldown);
        } else {
          toast.success("✅ Campanha concluída!");
        }
      }

      await loadCampaigns();
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setExecuting((prev) => ({ ...prev, [campaignId]: false }));
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">Campanhas</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Crie e gerencie campanhas de disparo em massa
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
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
            const s = (campaign.stats as CampaignStats) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
            const progress = s.total > 0 ? ((s.sent + s.failed) / s.total) * 100 : 0;
            const config = statusConfig[campaign.status] || statusConfig.draft;
            const isExec = executing[campaign.id];

            return (
              <Card key={campaign.id} className="transition-all duration-200 hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-base md:text-lg font-heading font-semibold">
                        📢 {campaign.name}
                      </span>
                      <Badge variant="secondary" className={config.className}>
                        {config.label}
                      </Badge>
                      {campaign.status === "running" && (
                        <Loader2 className="h-4 w-4 animate-spin text-success" />
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {(campaign.status === "draft" || campaign.status === "scheduled") && (
                        <Button
                          size="sm"
                          onClick={() => executeCampaign(campaign.id, "start")}
                          disabled={isExec}
                        >
                          {isExec ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1 h-3 w-3" />
                          )}
                          Iniciar
                        </Button>
                      )}
                      {campaign.status === "running" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => executeCampaign(campaign.id, "pause")}
                          disabled={isExec}
                        >
                          <Pause className="mr-1 h-3 w-3" />
                          Pausar
                        </Button>
                      )}
                      {campaign.status === "paused" && (
                        <Button
                          size="sm"
                          onClick={() => executeCampaign(campaign.id, "resume")}
                          disabled={isExec}
                        >
                          {isExec ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="mr-1 h-3 w-3" />
                          )}
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
                        {progress.toFixed(0)}% ({s.sent + s.failed}/{s.total})
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
