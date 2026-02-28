import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, GripVertical, Save, X, Loader2, ArrowRight, Zap, Clock, Brain, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import StageActionsEditor, { type StageAction } from "@/components/funnels/StageActionsEditor";
import ScoringRulesEditor from "@/components/funnels/ScoringRulesEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import SmartFunnelSettings from "@/components/funnels/SmartFunnelSettings";

interface Funnel {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

interface FunnelStage {
  id: string;
  funnel_id: string;
  name: string;
  color: string;
  position: number;
  auto_move_on_reply: boolean;
  notify_after_hours: number | null;
  actions: StageAction[];
  score_threshold: number | null;
  auto_move_stage_id: string | null;
}

const STAGE_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#6b7280",
];

const FunnelDialog = ({
  open,
  onOpenChange,
  funnel,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  funnel?: Funnel | null;
  onSave: () => void;
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(funnel?.name || "");
      setDescription(funnel?.description || "");
    }
  }, [open, funnel]);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      if (funnel) {
        const { error } = await supabase
          .from("funnels")
          .update({ name: name.trim(), description: description.trim() || null })
          .eq("id", funnel.id);
        if (error) throw error;
        toast.success("Funil atualizado!");
      } else {
        const { data, error } = await supabase
          .from("funnels")
          .insert({ name: name.trim(), description: description.trim() || null })
          .select()
          .single();
        if (error) throw error;
        // Create default stages
        const defaultStages = [
          { name: "Entrada", color: "#22c55e", position: 0 },
          { name: "Em Andamento", color: "#3b82f6", position: 1 },
          { name: "Finalizado", color: "#6b7280", position: 2 },
        ];
        await supabase.from("funnel_stages").insert(
          defaultStages.map((s) => ({ ...s, funnel_id: data.id }))
        );
        toast.success("Funil criado com etapas padrão!");
      }
      onSave();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro: " + (err.message || "Tente novamente"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{funnel ? "Editar Funil" : "Novo Funil"}</DialogTitle>
          <DialogDescription>
            {funnel ? "Edite o nome e descrição do funil" : "Crie um novo funil de atendimento com etapas personalizadas"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nome *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Vendas, Suporte, Onboarding" />
          </div>
          <div className="space-y-2">
            <Label>Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o objetivo do funil" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const StageEditor = ({
  funnelId,
  stages,
  onReload,
}: {
  funnelId: string;
  stages: FunnelStage[];
  onReload: () => void;
}) => {
  const [editingStage, setEditingStage] = useState<FunnelStage | null>(null);
  const [newStageName, setNewStageName] = useState("");
  const [adding, setAdding] = useState(false);

  const addStage = async () => {
    if (!newStageName.trim()) return;
    setAdding(true);
    try {
      const nextPosition = stages.length > 0 ? Math.max(...stages.map((s) => s.position)) + 1 : 0;
      const color = STAGE_COLORS[nextPosition % STAGE_COLORS.length];
      const { error } = await supabase.from("funnel_stages").insert({
        funnel_id: funnelId,
        name: newStageName.trim(),
        color,
        position: nextPosition,
      });
      if (error) throw error;
      setNewStageName("");
      toast.success("Etapa adicionada!");
      onReload();
    } catch (err: any) {
      toast.error("Erro: " + err.message);
    } finally {
      setAdding(false);
    }
  };

  const deleteStage = async (stageId: string) => {
    const { error } = await supabase.from("funnel_stages").delete().eq("id", stageId);
    if (error) {
      toast.error("Erro ao excluir etapa");
    } else {
      toast.success("Etapa excluída");
      onReload();
    }
  };

  const updateStage = async (stage: FunnelStage) => {
    const { error } = await supabase
      .from("funnel_stages")
      .update({
        name: stage.name,
        color: stage.color,
        auto_move_on_reply: stage.auto_move_on_reply,
        notify_after_hours: stage.notify_after_hours,
        actions: stage.actions as any,
        score_threshold: stage.score_threshold,
      })
      .eq("id", stage.id);
    if (error) {
      toast.error("Erro ao atualizar");
    } else {
      toast.success("Etapa atualizada!");
      setEditingStage(null);
      onReload();
    }
  };

  const moveStage = async (stageId: string, direction: "up" | "down") => {
    const sorted = [...stages].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((s) => s.id === stageId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const updates = [
      { id: sorted[idx].id, position: sorted[swapIdx].position },
      { id: sorted[swapIdx].id, position: sorted[idx].position },
    ];

    for (const u of updates) {
      await supabase.from("funnel_stages").update({ position: u.position }).eq("id", u.id);
    }
    onReload();
  };

  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-3">
      {/* Stage list */}
      <div className="space-y-2">
        {sortedStages.map((stage, idx) => (
          <div
            key={stage.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-background p-3"
          >
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => moveStage(stage.id, "up")}
                disabled={idx === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs"
              >
                ▲
              </button>
              <button
                onClick={() => moveStage(stage.id, "down")}
                disabled={idx === sortedStages.length - 1}
                className="text-muted-foreground hover:text-foreground disabled:opacity-30 text-xs"
              >
                ▼
              </button>
            </div>
            <div
              className="h-4 w-4 rounded-full shrink-0"
              style={{ backgroundColor: stage.color }}
            />

            {editingStage?.id === stage.id ? (
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    value={editingStage.name}
                    onChange={(e) => setEditingStage({ ...editingStage, name: e.target.value })}
                    className="h-8 text-sm flex-1 min-w-[120px]"
                  />
                  <input
                    type="color"
                    value={editingStage.color}
                    onChange={(e) => setEditingStage({ ...editingStage, color: e.target.value })}
                    className="h-8 w-8 cursor-pointer rounded border-0"
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingStage.auto_move_on_reply}
                      onCheckedChange={(v) => setEditingStage({ ...editingStage, auto_move_on_reply: v })}
                    />
                    <span className="text-xs text-muted-foreground">Auto-avançar</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      placeholder="h"
                      value={editingStage.notify_after_hours ?? ""}
                      onChange={(e) =>
                        setEditingStage({
                          ...editingStage,
                          notify_after_hours: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="h-8 w-16 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">Alertar (h)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min="0"
                      placeholder="pts"
                      value={editingStage.score_threshold ?? ""}
                      onChange={(e) =>
                        setEditingStage({
                          ...editingStage,
                          score_threshold: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="h-8 w-16 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">Score mín.</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => updateStage(editingStage)}>
                    <Save className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingStage(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <StageActionsEditor
                  actions={editingStage.actions || []}
                  onChange={(actions) => setEditingStage({ ...editingStage, actions })}
                  stages={sortedStages.map(s => ({ id: s.id, name: s.name, color: s.color }))}
                />
              </div>
            ) : (
              <>
                <span className="text-sm font-medium flex-1">{stage.name}</span>
                <div className="flex items-center gap-1.5">
                  {stage.auto_move_on_reply && (
                    <Badge variant="outline" className="text-[10px] h-5 gap-1">
                      <Zap className="h-3 w-3" /> Auto
                    </Badge>
                  )}
                  {stage.notify_after_hours && (
                    <Badge variant="outline" className="text-[10px] h-5 gap-1">
                      <Clock className="h-3 w-3" /> {stage.notify_after_hours}h
                    </Badge>
                  )}
                  {stage.score_threshold && (
                    <Badge variant="outline" className="text-[10px] h-5 gap-1">
                      <TrendingUp className="h-3 w-3" /> ≥{stage.score_threshold}pts
                    </Badge>
                  )}
                  {stage.actions && stage.actions.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                      {stage.actions.length} ações
                    </Badge>
                  )}
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingStage(stage)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => deleteStage(stage.id)}
                  disabled={stages.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Add stage */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Nova etapa..."
          value={newStageName}
          onChange={(e) => setNewStageName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addStage()}
          className="h-8 text-sm"
        />
        <Button size="sm" onClick={addStage} disabled={adding || !newStageName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar
        </Button>
      </div>
    </div>
  );
};

const FunnelsPage = () => {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stages, setStages] = useState<Record<string, FunnelStage[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFunnel, setEditingFunnel] = useState<Funnel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Funnel | null>(null);
  const [expandedFunnel, setExpandedFunnel] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [{ data: funnelData }, { data: stageData }] = await Promise.all([
      supabase.from("funnels").select("*").order("created_at"),
      supabase.from("funnel_stages").select("*").order("position"),
    ]);

    setFunnels((funnelData || []) as Funnel[]);

    const grouped: Record<string, FunnelStage[]> = {};
    for (const s of (stageData || []) as unknown as FunnelStage[]) {
      if (!grouped[s.funnel_id]) grouped[s.funnel_id] = [];
      // Ensure actions is always an array
      s.actions = Array.isArray(s.actions) ? s.actions : [];
      grouped[s.funnel_id].push(s);
    }
    setStages(grouped);
    setLoading(false);

    // Auto-expand first funnel
    if (!expandedFunnel && funnelData && funnelData.length > 0) {
      setExpandedFunnel(funnelData[0].id);
    }
  }, [expandedFunnel]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteFunnel = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from("funnels").delete().eq("id", deleteTarget.id);
    if (error) {
      toast.error("Erro ao excluir funil");
    } else {
      toast.success("Funil excluído");
      if (expandedFunnel === deleteTarget.id) setExpandedFunnel(null);
      loadData();
    }
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">Funis de Atendimento</h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Crie e gerencie funis com etapas personalizadas e automações
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditingFunnel(null); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Novo Funil
        </Button>
      </div>

      <div className="space-y-4">
        {funnels.map((funnel) => {
          const funnelStages = stages[funnel.id] || [];
          const isExpanded = expandedFunnel === funnel.id;

          return (
            <Card key={funnel.id}>
              <CardHeader
                className="cursor-pointer"
                onClick={() => setExpandedFunnel(isExpanded ? null : funnel.id)}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="font-heading flex items-center gap-2">
                      {funnel.name}
                      {funnel.is_default && (
                        <Badge variant="secondary" className="text-xs">Padrão</Badge>
                      )}
                    </CardTitle>
                    {funnel.description && (
                      <CardDescription>{funnel.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Stage preview dots */}
                    <div className="flex items-center gap-1 mr-2">
                      {funnelStages
                        .sort((a, b) => a.position - b.position)
                        .map((s, i) => (
                          <div key={s.id} className="flex items-center">
                            <div
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: s.color }}
                              title={s.name}
                            />
                            {i < funnelStages.length - 1 && (
                              <ArrowRight className="h-3 w-3 text-muted-foreground/40 mx-0.5" />
                            )}
                          </div>
                        ))}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {funnelStages.length} etapas
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingFunnel(funnel);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!funnel.is_default && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(funnel);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent>
                  <Tabs defaultValue="stages" className="w-full">
                    <TabsList className="mb-3">
                      <TabsTrigger value="stages" className="text-xs gap-1">
                        <ArrowRight className="h-3 w-3" /> Etapas
                      </TabsTrigger>
                      <TabsTrigger value="scoring" className="text-xs gap-1">
                        <TrendingUp className="h-3 w-3" /> Scoring
                      </TabsTrigger>
                      <TabsTrigger value="ai" className="text-xs gap-1">
                        <Brain className="h-3 w-3" /> IA
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="stages">
                      <StageEditor
                        funnelId={funnel.id}
                        stages={funnelStages}
                        onReload={loadData}
                      />
                    </TabsContent>
                    <TabsContent value="scoring">
                      <ScoringRulesEditor funnelId={funnel.id} />
                    </TabsContent>
                    <TabsContent value="ai">
                      <SmartFunnelSettings />
                    </TabsContent>
                  </Tabs>
                </CardContent>
              )}
            </Card>
          );
        })}

        {funnels.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-lg font-medium">Nenhum funil criado</p>
            <p className="text-sm">Crie seu primeiro funil para organizar o atendimento</p>
          </div>
        )}
      </div>

      <FunnelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        funnel={editingFunnel}
        onSave={loadData}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir funil "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as etapas serão excluídas. Conversas associadas perderão a referência ao funil.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteFunnel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default FunnelsPage;
