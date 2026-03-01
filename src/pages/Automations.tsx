import { useState, useEffect, useCallback } from "react";
import { Plus, Zap, Pencil, Trash2, Loader2, Play, Pause, Copy, History, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWhatsAppInstances } from "@/hooks/useWhatsAppInstances";
import FlowBuilder from "@/components/automations/FlowBuilder";
import AutomationLogsDialog from "@/components/automations/AutomationLogsDialog";
import { getNodeTypeConfig } from "@/components/automations/nodeTypes";
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

  // ── Flow Builder Mode ──
  if (showBuilder && editingAutomation) {
    const flow = editingAutomation.flow as { nodes?: Node[]; edges?: Edge[] } | null;
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setShowBuilder(false); fetchAutomations(); }}>
              ← Voltar
            </Button>
            <div>
              <h2 className="font-heading text-lg font-bold">{editingAutomation.name}</h2>
              {editingAutomation.description && (
                <p className="text-xs text-muted-foreground">{editingAutomation.description}</p>
              )}
            </div>
          </div>
          <Badge variant={editingAutomation.is_active ? "default" : "secondary"}>
            {editingAutomation.is_active ? "Ativo" : "Inativo"}
          </Badge>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Automações</h1>
          <p className="text-sm text-muted-foreground">
            Configure fluxos automáticos de atendimento com editor visual
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nova Automação
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : automations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Zap className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h3 className="font-heading font-semibold text-lg">Nenhuma automação criada</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              Crie fluxos automáticos para responder mensagens, classificar contatos e muito mais.
            </p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Criar Primeira Automação
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {automations.map((auto) => {
            const stats = auto.stats as { executions?: number; success?: number; failed?: number } | null;
            const nodeCount = (auto.flow as { nodes?: any[] })?.nodes?.length || 0;
            return (
              <Card key={auto.id} className="transition-all duration-200 hover:shadow-md group">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <Zap className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-heading font-semibold">{auto.name}</h3>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {auto.description || "Sem descrição"}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={!!auto.is_active}
                      onCheckedChange={() => toggleActive(auto)}
                    />
                  </div>

                  <div className="mt-4 flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary">
                      {TRIGGER_LABELS[auto.trigger_type] || auto.trigger_type}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {nodeCount} nós
                    </Badge>
                    {auto.instance_id ? (
                      <Badge variant="outline" className="text-[10px] gap-1">
                        <Smartphone className="h-2.5 w-2.5" />
                        {instances.find(i => i.id === auto.instance_id)?.name || "Instância"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Todas instâncias
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {(stats?.executions || 0).toLocaleString()} exec.
                    </span>
                  </div>

                  <div className="mt-3 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => openEditor(auto)}>
                      <Pencil className="h-3 w-3" /> Editar Fluxo
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => duplicateAutomation(auto)}>
                      <Copy className="h-3 w-3" /> Duplicar
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setLogsAutomation(auto)}>
                      <History className="h-3 w-3" /> Logs
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs h-7 gap-1 text-destructive hover:text-destructive" onClick={() => deleteAutomation(auto.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Automação</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Ex: Boas-vindas" />
            </div>
            <div className="space-y-2">
              <Label>Descrição</Label>
              <Textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="O que essa automação faz?" />
            </div>
            <div className="space-y-2">
              <Label>Gatilho principal</Label>
              <Select value={formTrigger} onValueChange={setFormTrigger}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="message">Mensagem recebida</SelectItem>
                  <SelectItem value="keyword">Palavra-chave</SelectItem>
                  <SelectItem value="first_contact">Primeiro contato</SelectItem>
                  <SelectItem value="schedule">Agendamento</SelectItem>
                </SelectContent>
              </Select>
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
              <p className="text-xs text-muted-foreground">
                Vincule a uma instância específica ou deixe em "Todas" para executar em qualquer uma.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancelar</Button>
            <Button onClick={createAutomation} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
