import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScoringRule {
  id: string;
  funnel_id: string;
  event_type: string;
  condition: Record<string, any>;
  points: number;
  description: string | null;
  is_active: boolean;
}

const EVENT_TYPES = [
  { value: "message_received", label: "Mensagem recebida" },
  { value: "message_sent", label: "Mensagem enviada" },
  { value: "reply_received", label: "Resposta do contato" },
  { value: "inactivity", label: "Inatividade (por hora)" },
  { value: "media_received", label: "Mídia recebida" },
  { value: "keyword_match", label: "Palavra-chave detectada" },
];

const ScoringRulesEditor = ({ funnelId }: { funnelId: string }) => {
  const [rules, setRules] = useState<ScoringRule[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRules = async () => {
    const { data } = await supabase
      .from("scoring_rules")
      .select("*")
      .eq("funnel_id", funnelId)
      .order("created_at");
    setRules((data || []) as ScoringRule[]);
    setLoading(false);
  };

  useEffect(() => { loadRules(); }, [funnelId]);

  const addRule = async () => {
    const { error } = await supabase.from("scoring_rules").insert({
      funnel_id: funnelId,
      event_type: "message_received",
      points: 5,
      description: "Nova regra",
    });
    if (error) toast.error("Erro ao criar regra");
    else loadRules();
  };

  const updateRule = async (rule: ScoringRule) => {
    const { error } = await supabase
      .from("scoring_rules")
      .update({
        event_type: rule.event_type,
        points: rule.points,
        description: rule.description,
        is_active: rule.is_active,
        condition: rule.condition,
      })
      .eq("id", rule.id);
    if (error) toast.error("Erro ao atualizar");
    else toast.success("Regra salva");
  };

  const deleteRule = async (id: string) => {
    await supabase.from("scoring_rules").delete().eq("id", id);
    loadRules();
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin mx-auto" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          Regras de Pontuação (Lead Scoring)
        </Label>
        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={addRule}>
          <Plus className="h-3 w-3" /> Regra
        </Button>
      </div>

      {rules.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-3">
          Nenhuma regra de pontuação. Adicione para pontuar leads automaticamente.
        </p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={rule.is_active}
              onCheckedChange={(v) => {
                const updated = { ...rule, is_active: v };
                setRules(rs => rs.map(r => r.id === rule.id ? updated : r));
                updateRule(updated);
              }}
            />
            <Input
              value={rule.description || ""}
              onChange={e => setRules(rs => rs.map(r => r.id === rule.id ? { ...r, description: e.target.value } : r))}
              onBlur={() => updateRule(rule)}
              placeholder="Descrição da regra"
              className="h-7 text-xs flex-1"
            />
            <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => deleteRule(rule.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={rule.event_type}
              onValueChange={v => {
                const updated = { ...rule, event_type: v };
                setRules(rs => rs.map(r => r.id === rule.id ? updated : r));
                updateRule(updated);
              }}
            >
              <SelectTrigger className="h-7 text-xs w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="number"
                value={rule.points}
                onChange={e => {
                  const updated = { ...rule, points: Number(e.target.value) };
                  setRules(rs => rs.map(r => r.id === rule.id ? updated : r));
                }}
                onBlur={() => updateRule(rule)}
                className="h-7 text-xs w-16"
              />
              <span className="text-xs text-muted-foreground">pts</span>
            </div>

            {rule.event_type === "keyword_match" && (
              <Input
                value={(rule.condition as any)?.keywords || ""}
                onChange={e => {
                  const updated = { ...rule, condition: { ...rule.condition, keywords: e.target.value } };
                  setRules(rs => rs.map(r => r.id === rule.id ? updated : r));
                }}
                onBlur={() => updateRule(rule)}
                placeholder="palavras separadas por vírgula"
                className="h-7 text-xs flex-1 min-w-[140px]"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ScoringRulesEditor;
