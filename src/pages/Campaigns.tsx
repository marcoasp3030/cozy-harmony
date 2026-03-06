import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Plus, Loader2, List, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import CreateCampaignDialog from "@/components/campaigns/CreateCampaignDialog";
import CampaignCard, { type Campaign } from "@/components/campaigns/CampaignCard";
import CampaignFilters from "@/components/campaigns/CampaignFilters";
import CampaignCalendar from "@/components/campaigns/CampaignCalendar";

const Campaigns = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [executing, setExecuting] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCampaigns = useCallback(async () => {
    const { data } = await supabase
      .from("campaigns")
      .select("id, name, status, stats, created_at, description, message_type, message_content, media_url, instance_id, settings, scheduled_at")
      .order("created_at", { ascending: false });
    setCampaigns((data as unknown as Campaign[]) || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    loadCampaigns().finally(() => setLoading(false));
  }, [loadCampaigns]);

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

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [campaigns, search, statusFilter]);

  const executeCampaign = async (campaignId: string, action: "start" | "resume" | "pause") => {
    setExecuting((prev) => ({ ...prev, [campaignId]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("campaign-execute", {
        body: { action, campaignId },
      });
      if (error) throw error;
      if (data?.error) {
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
          setTimeout(() => executeCampaign(campaignId, "resume"), cooldown);
        } else {
          toast.success("✅ Campanha concluída!");
        }
      }
      await loadCampaigns();
    } catch (err: any) {
      console.error("campaign-execute error:", err);
      toast.error("Erro ao executar campanha: " + (err.message || JSON.stringify(err) || "Tente novamente"), { duration: 10000 });
    } finally {
      setExecuting((prev) => ({ ...prev, [campaignId]: false }));
    }
  };

  const handleDuplicate = async (campaign: Campaign) => {
    try {
      const { data, error } = await supabase
        .from("campaigns")
        .insert({
          name: `${campaign.name} (cópia)`,
          description: campaign.description,
          message_type: campaign.message_type,
          message_content: campaign.message_content,
          media_url: campaign.media_url,
          instance_id: campaign.instance_id,
          settings: campaign.settings,
          status: "draft",
          stats: { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 } as any,
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      // Copy campaign contacts
      const { data: contacts } = await supabase
        .from("campaign_contacts")
        .select("contact_id, phone, variables")
        .eq("campaign_id", campaign.id);

      if (contacts && contacts.length > 0) {
        const rows = contacts.map((c) => ({
          campaign_id: data!.id,
          contact_id: c.contact_id,
          phone: c.phone,
          variables: c.variables,
          status: "pending",
        }));
        await supabase.from("campaign_contacts").insert(rows);
        await supabase
          .from("campaigns")
          .update({ stats: { total: contacts.length, sent: 0, delivered: 0, read: 0, failed: 0 } as any })
          .eq("id", data!.id);
      }

      toast.success("Campanha duplicada!");
      await loadCampaigns();
    } catch (err: any) {
      toast.error("Erro ao duplicar: " + (err.message || "Tente novamente"));
    }
  };

  const handleEdit = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setDialogOpen(true);
  };

  const handleNewCampaign = () => {
    setEditingCampaign(null);
    setDialogOpen(true);
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
        <Button size="sm" onClick={handleNewCampaign}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Campanha
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="list" className="space-y-4">
          <TabsList>
            <TabsTrigger value="list" className="gap-1.5">
              <List className="h-4 w-4" />
              Lista
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-1.5">
              <CalendarDays className="h-4 w-4" />
              Calendário
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-4">
            {campaigns.length > 0 && (
              <CampaignFilters
                search={search}
                onSearchChange={setSearch}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
              />
            )}

            {campaigns.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-muted-foreground">Nenhuma campanha criada ainda.</p>
                  <Button variant="outline" className="mt-4" onClick={handleNewCampaign}>
                    <Plus className="mr-2 h-4 w-4" />
                    Criar primeira campanha
                  </Button>
                </CardContent>
              </Card>
            ) : filteredCampaigns.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <p className="text-muted-foreground">Nenhuma campanha encontrada com os filtros aplicados.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4">
                {filteredCampaigns.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    executing={!!executing[campaign.id]}
                    onExecute={executeCampaign}
                    onEdit={handleEdit}
                    onDuplicate={handleDuplicate}
                    onDeleted={loadCampaigns}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="calendar">
            <CampaignCalendar
              campaigns={campaigns}
              onCampaignClick={handleEdit}
              onCreateAtDate={(date) => {
                setEditingCampaign(null);
                setDialogOpen(true);
                // Pre-fill scheduled date via a small timeout so dialog mounts first
                setTimeout(() => {
                  const event = new CustomEvent("campaign-prefill-date", { detail: date });
                  window.dispatchEvent(event);
                }, 100);
              }}
              onReload={loadCampaigns}
            />
          </TabsContent>
        </Tabs>
      )}

      <CreateCampaignDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={loadCampaigns}
        editCampaign={editingCampaign}
      />
    </div>
  );
};

export default Campaigns;
