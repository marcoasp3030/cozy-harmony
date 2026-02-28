import { useState } from "react";
import { Plus, X, Send, UserPlus, Tag, ArrowRight, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface StageAction {
  type: "send_template" | "assign_agent" | "add_tag" | "auto_move";
  config: Record<string, string>;
}

interface StageActionsEditorProps {
  actions: StageAction[];
  onChange: (actions: StageAction[]) => void;
  stages?: { id: string; name: string; color: string }[];
}

const ACTION_TYPES = [
  { value: "send_template", label: "Enviar Template", icon: Send, color: "text-blue-500" },
  { value: "assign_agent", label: "Atribuir Atendente", icon: UserPlus, color: "text-green-500" },
  { value: "add_tag", label: "Adicionar Tag", icon: Tag, color: "text-purple-500" },
  { value: "auto_move", label: "Mover após tempo", icon: Clock, color: "text-orange-500" },
];

const StageActionsEditor = ({ actions, onChange, stages }: StageActionsEditorProps) => {
  const [adding, setAdding] = useState(false);

  const addAction = (type: StageAction["type"]) => {
    onChange([...actions, { type, config: {} }]);
    setAdding(false);
  };

  const removeAction = (idx: number) => {
    onChange(actions.filter((_, i) => i !== idx));
  };

  const updateConfig = (idx: number, key: string, value: string) => {
    const updated = [...actions];
    updated[idx] = { ...updated[idx], config: { ...updated[idx].config, [key]: value } };
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">Ações automáticas ao entrar na etapa</Label>
      
      {actions.map((action, idx) => {
        const actionType = ACTION_TYPES.find(t => t.value === action.type);
        const Icon = actionType?.icon || ArrowRight;
        
        return (
          <div key={idx} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
            <Icon className={`h-4 w-4 shrink-0 ${actionType?.color || ''}`} />
            <span className="text-xs font-medium shrink-0">{actionType?.label}</span>
            
            {action.type === "send_template" && (
              <Input
                value={action.config.template_name || ""}
                onChange={e => updateConfig(idx, "template_name", e.target.value)}
                placeholder="Nome do template"
                className="h-7 text-xs flex-1"
              />
            )}
            
            {action.type === "assign_agent" && (
              <Input
                value={action.config.agent_email || ""}
                onChange={e => updateConfig(idx, "agent_email", e.target.value)}
                placeholder="Email do atendente"
                className="h-7 text-xs flex-1"
              />
            )}
            
            {action.type === "add_tag" && (
              <Input
                value={action.config.tag_name || ""}
                onChange={e => updateConfig(idx, "tag_name", e.target.value)}
                placeholder="Nome da tag"
                className="h-7 text-xs flex-1"
              />
            )}
            
            {action.type === "auto_move" && (
              <div className="flex items-center gap-1 flex-1">
                <Input
                  type="number"
                  min="1"
                  value={action.config.hours || ""}
                  onChange={e => updateConfig(idx, "hours", e.target.value)}
                  placeholder="Horas"
                  className="h-7 text-xs w-16"
                />
                <span className="text-xs text-muted-foreground">h →</span>
                {stages && stages.length > 0 ? (
                  <Select
                    value={action.config.target_stage_id || ""}
                    onValueChange={v => updateConfig(idx, "target_stage_id", v)}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder="Etapa destino" />
                    </SelectTrigger>
                    <SelectContent>
                      {stages.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <div className="flex items-center gap-1.5">
                            <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={action.config.target_stage_id || ""}
                    onChange={e => updateConfig(idx, "target_stage_id", e.target.value)}
                    placeholder="ID da etapa"
                    className="h-7 text-xs flex-1"
                  />
                )}
              </div>
            )}
            
            <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => removeAction(idx)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        );
      })}

      {adding ? (
        <div className="flex flex-wrap gap-1.5">
          {ACTION_TYPES.map(t => {
            const Icon = t.icon;
            return (
              <Button key={t.value} size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => addAction(t.value as StageAction["type"])}>
                <Icon className={`h-3 w-3 ${t.color}`} />
                {t.label}
              </Button>
            );
          })}
          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setAdding(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3" /> Ação
        </Button>
      )}
    </div>
  );
};

export default StageActionsEditor;
