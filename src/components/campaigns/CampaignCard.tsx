import { useState } from "react";
import { Play, Pause, BarChart3, Loader2, RotateCw, MoreVertical, Copy, Pencil, Trash2, Clock, Send, CheckCheck, Eye, AlertTriangle, CalendarDays, Smartphone } from "lucide-react";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import CampaignReportDialog from "./CampaignReportDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  scheduled_at: string | null;
}

export const statusConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  running: { label: "Em execução", className: "bg-success/15 text-success border-success/30", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { label: "Concluída", className: "bg-primary/15 text-primary border-primary/30", icon: <CheckCheck className="h-3 w-3" /> },
  paused: { label: "Pausada", className: "bg-warning/15 text-warning border-warning/30", icon: <Pause className="h-3 w-3" /> },
  draft: { label: "Rascunho", className: "bg-muted text-muted-foreground border-border", icon: <Pencil className="h-3 w-3" /> },
  scheduled: { label: "Agendada", className: "bg-info/15 text-info border-info/30", icon: <Clock className="h-3 w-3" /> },
  cancelled: { label: "Cancelada", className: "bg-destructive/15 text-destructive border-destructive/30", icon: <AlertTriangle className="h-3 w-3" /> },
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
  const { instances } = useWhatsAppInstances();
  const instanceName = campaign.instance_id
    ? instances.find((i) => i.id === campaign.instance_id)?.name
    : null;

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

  const statItems = [
    { icon: <Send className="h-3.5 w-3.5" />, label: "Enviadas", value: s.sent, color: "text-primary" },
    { icon: <CheckCheck className="h-3.5 w-3.5" />, label: "Entregues", value: s.delivered, color: "text-success" },
    { icon: <Eye className="h-3.5 w-3.5" />, label: "Lidas", value: s.read, color: "text-info" },
    { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "Falhas", value: s.failed, color: "text-destructive" },
  ];

  return (
    <>
      <Card className="group transition-all duration-200 hover:shadow-lg hover:border-primary/20 border">
        <CardContent className="p-0">
          {/* Top section */}
          <div className="flex items-start justify-between gap-3 p-4 pb-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-1">
                <h3 className="text-base font-heading font-semibold truncate">
                  {campaign.name}
                </h3>
                <Badge variant="outline" className={`text-[10px] shrink-0 gap-1 ${config.className}`}>
                  {config.icon}
                  {config.label}
                </Badge>
              </div>
              {campaign.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{campaign.description}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  {new Date(campaign.created_at).toLocaleDateString("pt-BR")}
                </span>
                {campaign.scheduled_at && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Agendada: {new Date(campaign.scheduled_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {s.total > 0 && (
                  <span className="font-medium">{s.total.toLocaleString()} contatos</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {(campaign.status === "draft" || campaign.status === "scheduled") && (
                <Button size="sm" className="h-8 text-xs" onClick={() => onExecute(campaign.id, "start")} disabled={executing}>
                  {executing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                  Iniciar
                </Button>
              )}
              {campaign.status === "running" && (
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => onExecute(campaign.id, "pause")} disabled={executing}>
                  <Pause className="mr-1 h-3 w-3" />
                  Pausar
                </Button>
              )}
              {campaign.status === "paused" && (
                <Button size="sm" className="h-8 text-xs" onClick={() => onExecute(campaign.id, "resume")} disabled={executing}>
                  {executing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCw className="mr-1 h-3 w-3" />}
                  Retomar
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setReportOpen(true)}>
                <BarChart3 className="h-3.5 w-3.5" />
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
                  <DropdownMenuItem onClick={() => setReportOpen(true)}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Relatório
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

          {/* Progress bar */}
          {s.total > 0 && (
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span className="text-muted-foreground">Progresso</span>
                <span className="font-semibold tabular-nums">{progress.toFixed(0)}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          )}

          {/* Stats row */}
          {s.total > 0 && (
            <div className="border-t bg-muted/30 px-4 py-2.5 flex items-center gap-1 flex-wrap">
              {statItems.map((item) => (
                <Tooltip key={item.label}>
                  <TooltipTrigger asChild>
                    <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium ${item.color} bg-background border border-border/50`}>
                      {item.icon}
                      <span className="tabular-nums">{item.value.toLocaleString()}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{item.label}: {item.value.toLocaleString()}</p>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
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
