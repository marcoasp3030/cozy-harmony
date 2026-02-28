import { useState } from "react";
import { Play, Pause, BarChart3, Loader2, RotateCw, MoreVertical, Copy, Pencil, Trash2 } from "lucide-react";
import CampaignReportDialog from "./CampaignReportDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface CampaignStats {
  total: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
}

export interface Campaign {
  id: string;
  name: string;
  status: string;
  stats: CampaignStats | null;
  created_at: string;
  description: string | null;
  message_type: string;
  message_content: string | null;
  media_url: string | null;
  instance_id: string | null;
  settings: any;
}

export const statusConfig: Record<string, { label: string; className: string }> = {
  running: { label: "Em execução", className: "bg-success/15 text-success" },
  completed: { label: "Concluída", className: "bg-primary/15 text-primary" },
  paused: { label: "Pausada", className: "bg-warning/15 text-warning" },
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground" },
  scheduled: { label: "Agendada", className: "bg-info/15 text-info" },
  cancelled: { label: "Cancelada", className: "bg-destructive/15 text-destructive" },
};

interface CampaignCardProps {
  campaign: Campaign;
  executing: boolean;
  onExecute: (campaignId: string, action: "start" | "resume" | "pause") => void;
  onEdit: (campaign: Campaign) => void;
  onDuplicate: (campaign: Campaign) => void;
  onDeleted: () => void;
}

export default function CampaignCard({ campaign, executing, onExecute, onEdit, onDuplicate, onDeleted }: CampaignCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const s = (campaign.stats as CampaignStats) || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  const progress = s.total > 0 ? ((s.sent + s.failed) / s.total) * 100 : 0;
  const config = statusConfig[campaign.status] || statusConfig.draft;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await supabase.from("campaign_contacts").delete().eq("campaign_id", campaign.id);
      const { error } = await supabase.from("campaigns").delete().eq("id", campaign.id);
      if (error) throw error;
      toast.success("Campanha excluída!");
      onDeleted();
    } catch (err: any) {
      toast.error("Erro ao excluir: " + (err.message || "Tente novamente"));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const canEdit = campaign.status === "draft" || campaign.status === "scheduled";

  return (
    <>
      <Card className="transition-all duration-200 hover:shadow-md">
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
            <div className="flex gap-2 flex-wrap items-center">
              {(campaign.status === "draft" || campaign.status === "scheduled") && (
                <Button size="sm" onClick={() => onExecute(campaign.id, "start")} disabled={executing}>
                  {executing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                  Iniciar
                </Button>
              )}
              {campaign.status === "running" && (
                <Button size="sm" variant="outline" onClick={() => onExecute(campaign.id, "pause")} disabled={executing}>
                  <Pause className="mr-1 h-3 w-3" />
                  Pausar
                </Button>
              )}
              {campaign.status === "paused" && (
                <Button size="sm" onClick={() => onExecute(campaign.id, "resume")} disabled={executing}>
                  {executing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
                  Retomar
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
                <BarChart3 className="mr-1 h-3 w-3" />
                Relatório
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onClick={() => onEdit(campaign)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => onDuplicate(campaign)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir a campanha "{campaign.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CampaignReportDialog open={reportOpen} onOpenChange={setReportOpen} campaign={campaign} />
    </>
  );
}
