import { useState, useEffect, useCallback } from "react";
import {
  Plus, Zap, Pencil, Trash2, Loader2, Copy, History, Smartphone,
  Search, MoreHorizontal, Activity, CheckCircle2, XCircle, Power,
  LayoutTemplate, ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import FlowBuilder from "@/components/automations/FlowBuilder";
import AutomationLogsDialog from "@/components/automations/AutomationLogsDialog";
import { getNodeTypeConfig } from "@/components/automations/nodeTypes";
import { ALL_TEMPLATES, type FlowTemplate } from "@/components/automations/flowTemplates";
import type { Node, Edge } from "@xyflow/react";
import type { Json } from "@/integrations/supabase/types";

interface Automation {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: any;
  flow: any;
  is_active: boolean | null;
  stats: any;
  created_at: string;
  instance_id: string | null;
}

const TRIGGER_LABELS: Record<string, string> = {
  message: "Mensagem",
  keyword: "Palavra-chave",
  first_contact: "Primeiro contato",
  schedule: "Agendamento",
};

const TRIGGER_ICONS: Record<string, string> = {
  message: "💬",
  keyword: "🔍",
  first_contact: "👤",
  schedule: "⏰",
};

const Automations = () => {
  const { user } = useAuth();
  const { instances } = useWhatsAppInstances();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logsAutomation, setLogsAutomation] = useState<Automation | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");

  // Create form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTrigger, setFormTrigger] = useState("message");
  const [formInstanceId, setFormInstanceId] = useState<string>("all");

  const fetchAutomations = useCallback(async () => {
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setAutomations(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  const openCreate = () => {
    setFormName("");
    setFormDesc("");
    setFormTrigger("message");
    setFormInstanceId("all");
    setEditingAutomation(null);
    setShowCreateDialog(true);
  };

  const createAutomation = async () => {
    if (!formName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    const triggerNodeType = `trigger_${formTrigger === "message" ? "message" : formTrigger}`;
    const initialNode: Node = {
      id: `${triggerNodeType}_init`,
      type: "flowNode",
      position: { x: 250, y: 50 },
      data: { nodeType: triggerNodeType },
    };

    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: formName.trim(),
        description: formDesc.trim() || null,
        trigger_type: formTrigger,
        trigger_config: {} as Json,
        flow: { nodes: [initialNode], edges: [] } as unknown as Json,
        is_active: false,
        created_by: user?.id || null,
        instance_id: formInstanceId === "all" ? null : formInstanceId,
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      toast.error("Erro ao criar automação: " + error.message);
      return;
    }
    toast.success("Automação criada!");
    setShowCreateDialog(false);
    if (data) {
      setEditingAutomation(data);
      setShowBuilder(true);
    }
    fetchAutomations();
  };

  const openEditor = (auto: Automation) => {
    setEditingAutomation(auto);
    setShowBuilder(true);
  };

  const saveFlow = async (nodes: Node[], edges: Edge[]) => {
    if (!editingAutomation) return;
    const { error } = await supabase
      .from("automations")
      .update({
        flow: { nodes, edges } as unknown as Json,
        trigger_type: determineTrigger(nodes),
      })
      .eq("id", editingAutomation.id);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
    } else {
      toast.success("Fluxo salvo com sucesso!");
      fetchAutomations();
    }
  };

  const determineTrigger = (nodes: Node[]): string => {
    const triggerNode = nodes.find((n) => {
      const cfg = getNodeTypeConfig(n.data?.nodeType as string);
      return cfg?.category === "trigger";
    });
    if (!triggerNode) return "message";
    const type = triggerNode.data?.nodeType as string;
    return type.replace("trigger_", "");
  };

  const toggleActive = async (auto: Automation) => {
    const { error } = await supabase
      .from("automations")
      .update({ is_active: !auto.is_active })
      .eq("id", auto.id);
    if (error) {
      toast.error("Erro ao atualizar");
    } else {
      setAutomations((prev) =>
        prev.map((a) => (a.id === auto.id ? { ...a, is_active: !a.is_active } : a))
      );
    }
  };

  const deleteAutomation = async (id: string) => {
    const { error } = await supabase.from("automations").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir");
    } else {
      toast.success("Automação excluída");
      setAutomations((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const duplicateAutomation = async (auto: Automation) => {
    const { error } = await supabase.from("automations").insert({
      name: auto.name + " (cópia)",
      description: auto.description,
      trigger_type: auto.trigger_type,
      trigger_config: auto.trigger_config as Json,
      flow: auto.flow as Json,
      is_active: false,
      created_by: user?.id || null,
    });
    if (!error) {
      toast.success("Automação duplicada!");
      fetchAutomations();
    }
  };

  const createFromTemplate = async (template: FlowTemplate) => {
    setSaving(true);
    const { data, error } = await supabase
      .from("automations")
      .insert({
        name: template.name,
        description: template.description,
        trigger_type: template.triggerType,
        trigger_config: {} as Json,
        flow: { nodes: template.nodes, edges: template.edges } as unknown as Json,
        is_active: false,
        created_by: user?.id || null,
      })
      .select()
      .single();

    setSaving(false);
    if (error) {
      toast.error("Erro ao criar: " + error.message);
      return;
    }
    toast.success(`Template "${template.name}" criado com sucesso!`);
    if (data) {
      setEditingAutomation(data);
      setShowBuilder(true);
    }
    fetchAutomations();
  };

  const updateInstanceId = async (autoId: string, instanceId: string | null) => {
    const { error } = await supabase
      .from("automations")
      .update({ instance_id: instanceId })
      .eq("id", autoId);
    if (error) {
      toast.error("Erro ao atualizar instância");
      return;
    }
    setAutomations((prev) =>
      prev.map((a) => (a.id === autoId ? { ...a, instance_id: instanceId } : a))
    );
    if (editingAutomation?.id === autoId) {
      setEditingAutomation((prev) => prev ? { ...prev, instance_id: instanceId } : prev);
    }
    toast.success("Instância atualizada!");
  };

  // Filtered automations
  const filteredAutomations = automations.filter((a) => {
    const matchSearch = !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase()) || (a.description || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchStatus = filterStatus === "all" || (filterStatus === "active" ? a.is_active : !a.is_active);
    return matchSearch && matchStatus;
  });

  const activeCount = automations.filter((a) => a.is_active).length;
  const totalExecs = automations.reduce((sum, a) => sum + ((a.stats as any)?.executions || 0), 0);

  if (showBuilder && editingAutomation) {
    const flow = editingAutomation.flow as { nodes?: Node[]; edges?: Edge[] } | null;
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-card/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => { setShowBuilder(false); fetchAutomations(); }}>
              ← Voltar
            </Button>
            <div className="h-5 w-px bg-border" />
            <div>
              <h2 className="font-heading text-sm font-bold leading-tight">{editingAutomation.name}</h2>
              {editingAutomation.description && (
                <p className="text-[11px] text-muted-foreground">{editingAutomation.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={editingAutomation.instance_id || "all"}
              onValueChange={(v) => updateInstanceId(editingAutomation.id, v === "all" ? null : v)}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <Smartphone className="h-3 w-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas instâncias</SelectItem>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>{inst.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Badge
              variant={editingAutomation.is_active ? "default" : "secondary"}
              className="gap-1"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${editingAutomation.is_active ? "bg-primary-foreground animate-pulse" : "bg-muted-foreground"}`} />
              {editingAutomation.is_active ? "Ativo" : "Inativo"}
            </Badge>
          </div>
        </div>
        <div className="flex-1">
          <FlowBuilder
            initialNodes={flow?.nodes || []}
            initialEdges={flow?.edges || []}
            onSave={saveFlow}
          />
        </div>
      </div>
    );
  }

  // ── List Mode ──
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Automações</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fluxos automáticos de atendimento com editor visual drag-and-drop
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2 shadow-md">
          <Plus className="h-4 w-4" />
          Nova Automação
        </Button>
      </div>

      {/* Stats bar */}
      {automations.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{automations.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Total</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
              <Power className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{activeCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Ativas</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
              <Activity className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{totalExecs.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Execuções</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      {automations.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar automação..."
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center rounded-lg border bg-card p-0.5">
            {(["all", "active", "inactive"] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filterStatus === status
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {status === "all" ? "Todas" : status === "active" ? "Ativas" : "Inativas"}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Carregando automações...</p>
        </div>
      ) : automations.length === 0 ? (
        <div className="space-y-8">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 mb-5">
              <Zap className="h-10 w-10 text-primary" />
            </div>
            <h3 className="font-heading font-bold text-xl">Crie sua primeira automação</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md">
              Automatize o atendimento com fluxos visuais ou comece com um template pronto.
            </p>
            <Button className="mt-6 gap-2 shadow-md" size="lg" onClick={openCreate}>
              <Plus className="h-5 w-5" />
              Criar do Zero
            </Button>
          </div>

          {/* Templates section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <LayoutTemplate className="h-5 w-5 text-primary" />
              <h3 className="font-heading font-semibold text-lg">Templates Prontos</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Comece rapidamente com um fluxo pré-configurado. Você pode personalizar depois.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              {ALL_TEMPLATES.map((createTemplate) => {
                const tpl = createTemplate();
                return (
                  <Card
                    key={tpl.id}
                    className="group cursor-pointer transition-all hover:shadow-lg hover:border-primary/30"
                    onClick={() => createFromTemplate(tpl)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-3">
                        <span className="text-3xl">{tpl.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-heading font-semibold text-sm">{tpl.name}</h4>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{tpl.description}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <Badge variant="secondary" className="text-[10px]">
                          {tpl.nodes.length} nós
                        </Badge>
                        <span className="text-xs text-primary font-medium flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Usar <ArrowRight className="h-3 w-3" />
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>
      ) : filteredAutomations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhuma automação encontrada</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredAutomations.map((auto) => {
            const stats = auto.stats as { executions?: number; success?: number; failed?: number } | null;
            const nodeCount = (auto.flow as { nodes?: any[] })?.nodes?.length || 0;
            const instanceName = instances.find((i) => i.id === auto.instance_id)?.name;
            const successRate = stats?.executions
              ? Math.round(((stats.success || 0) / stats.executions) * 100)
              : null;

            return (
              <Card
                key={auto.id}
                className={`group transition-all duration-200 hover:shadow-lg cursor-pointer border-l-4 ${
                  auto.is_active ? "border-l-primary" : "border-l-muted-foreground/20"
                }`}
                onClick={() => openEditor(auto)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                        auto.is_active ? "bg-primary/10" : "bg-muted"
                      }`}>
                        {TRIGGER_ICONS[auto.trigger_type] || "⚡"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-heading font-semibold text-sm leading-tight truncate">{auto.name}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {auto.description || "Sem descrição"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <Switch
                              checked={!!auto.is_active}
                              onCheckedChange={() => toggleActive(auto)}
                              className="scale-90"
                            />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          {auto.is_active ? "Desativar" : "Ativar"}
                        </TooltipContent>
                      </Tooltip>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openEditor(auto)} className="gap-2">
                            <Pencil className="h-3.5 w-3.5" /> Editar fluxo
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => duplicateAutomation(auto)} className="gap-2">
                            <Copy className="h-3.5 w-3.5" /> Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLogsAutomation(auto)} className="gap-2">
                            <History className="h-3.5 w-3.5" /> Ver logs
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteAutomation(auto.id)}
                            className="gap-2 text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Meta info */}
                  <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                    <Badge variant="secondary" className="text-[10px] gap-1 font-medium">
                      {TRIGGER_LABELS[auto.trigger_type] || auto.trigger_type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {nodeCount} nós
                    </Badge>
                    {instanceName && (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Smartphone className="h-2.5 w-2.5" />
                        {instanceName}
                      </Badge>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="mt-3 pt-3 border-t flex items-center justify-between text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {(stats?.executions || 0).toLocaleString()} exec
                      </span>
                      {successRate !== null && (
                        <span className="flex items-center gap-1">
                          {successRate >= 90 ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500" />
                          ) : (
                            <XCircle className="h-3 w-3 text-amber-500" />
                          )}
                          {successRate}% sucesso
                        </span>
                      )}
                    </div>
                    <span className="text-[10px]">
                      {new Date(auto.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Templates section (always visible when not loading) */}
      {!loading && automations.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center gap-2 mb-3">
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-heading font-semibold text-sm text-muted-foreground">Criar a partir de template</h3>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {ALL_TEMPLATES.map((createTemplate) => {
              const tpl = createTemplate();
              return (
                <button
                  key={tpl.id}
                  onClick={() => createFromTemplate(tpl)}
                  disabled={saving}
                  className="flex items-center gap-3 rounded-xl border bg-card/50 p-3 text-left hover:bg-card hover:shadow-md hover:border-primary/30 transition-all group"
                >
                  <span className="text-xl">{tpl.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{tpl.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{tpl.description}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <Zap className="h-4 w-4 text-primary" />
              </div>
              Nova Automação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Boas-vindas" />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="O que essa automação faz?" rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Gatilho principal</Label>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFormTrigger(key)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-all text-sm ${
                      formTrigger === key
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "hover:border-primary/30 hover:bg-muted/50"
                    }`}
                  >
                    <span className="text-base">{TRIGGER_ICONS[key]}</span>
                    <span className="font-medium text-xs">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Instância WhatsApp</Label>
              <Select value={formInstanceId} onValueChange={setFormInstanceId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as instâncias</SelectItem>
                  {instances.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      <span className="flex items-center gap-1.5">
                        <Smartphone className="h-3 w-3" />
                        {inst.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={createAutomation} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar e Editar Fluxo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      {logsAutomation && (
        <AutomationLogsDialog
          automationId={logsAutomation.id}
          automationName={logsAutomation.name}
          open={!!logsAutomation}
          onOpenChange={(open) => !open && setLogsAutomation(null)}
        />
      )}
    </div>
  );
};

export default Automations;
